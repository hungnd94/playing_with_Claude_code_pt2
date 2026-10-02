/**
 * Query helpers over a finished History — the functions every consumer
 * (narrative, atlas, UI) needs: values of change lists at a year, fast
 * reconstruction of timeline layers while scrubbing, names and titles at a
 * year, rulers, regnal names, ages, populations.
 *
 * All functions are pure and cheap; `LayerCursor` caches the last
 * reconstruction so scrubbing forward/backward within a keyframe span costs
 * only the diffs in between.
 */
import type {
  EventData, EventType, Government, HEvent, History, Id, LayerTimeline, NameRecord, Person, Polity, Settlement, Timeline, WName,
} from "./types";
import { roman } from "./util";

// ---------------------------------------------------------------------------
// Change lists
// ---------------------------------------------------------------------------

/** Index of the last entry with `year <= y` in a year-sorted list, or -1. */
export function indexAt<T extends { year: number }>(list: readonly T[], y: number): number {
  let lo = 0, hi = list.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (list[m].year <= y) {
      r = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}

/** The entry in force at year `y` (last with year ≤ y), or undefined before the first. */
export function entryAt<T extends { year: number }>(list: readonly T[], y: number): T | undefined {
  const i = indexAt(list, y);
  return i >= 0 ? list[i] : undefined;
}

/** `entryAt(list, y)?.[key]`, with a fallback. */
export function valueAt<T extends { year: number }, K extends keyof T>(list: readonly T[], y: number, key: K, fallback: T[K]): T[K] {
  const e = entryAt(list, y);
  return e ? e[key] : fallback;
}

// ---------------------------------------------------------------------------
// Timeline layers
// ---------------------------------------------------------------------------

/** Snapshot index for a year (clamped; snapshots are at multiples of `timeline.step`). */
export function snapshotIndex(t: Timeline, year: number): number {
  return Math.max(0, Math.min(t.snapshots - 1, Math.floor(year / t.step)));
}

/**
 * Reconstruct a layer at `year` (the state at the latest snapshot ≤ year).
 * Writes into `out` if given (length = cell count) and returns it.
 */
export function layerAt(layer: LayerTimeline, timeline: Timeline, year: number, out?: Int32Array): Int32Array {
  const s = snapshotIndex(timeline, year);
  const kf = Math.floor(s / timeline.keyEvery);
  const key = layer.keyframes[kf];
  const res = out ?? new Int32Array(key.length);
  res.set(key);
  for (let i = kf * timeline.keyEvery + 1; i <= s; i++) {
    const cells = layer.diffCells[i], vals = layer.diffValues[i];
    for (let k = 0; k < cells.length; k++) res[cells[k]] = vals[k];
  }
  return res;
}

/** Stateful reconstruction for scrubbing: reuses the previous state when moving forward within a keyframe span. */
export class LayerCursor {
  private state: Int32Array | null = null;
  private snap = -1;
  constructor(private layer: LayerTimeline, private timeline: Timeline) {}
  /** The layer at `year`; the returned array is owned by the cursor (copy it to keep it). */
  at(year: number): Int32Array {
    const t = this.timeline;
    const s = snapshotIndex(t, year);
    if (this.state && s === this.snap) return this.state;
    const kfOld = Math.floor(this.snap / t.keyEvery);
    const kfNew = Math.floor(s / t.keyEvery);
    if (this.state && s > this.snap && kfOld === kfNew) {
      for (let i = this.snap + 1; i <= s; i++) {
        const cells = this.layer.diffCells[i], vals = this.layer.diffValues[i];
        for (let k = 0; k < cells.length; k++) this.state[cells[k]] = vals[k];
      }
    } else this.state = layerAt(this.layer, t, year, this.state ?? undefined);
    this.snap = s;
    return this.state;
  }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function nameAt(names: readonly NameRecord[], year: number): WName {
  return (entryAt(names, year) ?? names[0]).name;
}

export function settlementName(h: History, id: Id, year: number): WName {
  return nameAt(h.settlements[id].names, year);
}

export function polityName(h: History, id: Id, year: number): WName {
  return nameAt(h.polities[id].names, year);
}

/** Name of a geographic feature at a year: the given culture's own name if it has one, else the oldest name. */
export function featureName(h: History, feature: Id, year: number, culture = -1): WName | undefined {
  const e = h.featureNames.find((f) => f.feature === feature);
  if (!e) return undefined;
  let own: WName | undefined;
  let first: WName | undefined;
  for (const n of e.names) {
    if (n.year > year) continue;
    if (!first) first = n.name;
    if (n.culture === culture) own = n.name;
  }
  return own ?? first;
}

/** All names a feature bore up to `year`, by culture (latest per culture). */
export function featureNamesAt(h: History, feature: Id, year: number): { culture: Id; name: WName }[] {
  const e = h.featureNames.find((f) => f.feature === feature);
  if (!e) return [];
  const m = new Map<Id, WName>();
  for (const n of e.names) if (n.year <= year) m.set(n.culture, n.name);
  return [...m.entries()].map(([culture, name]) => ({ culture, name }));
}

// ---------------------------------------------------------------------------
// English adjectives and titles
// ---------------------------------------------------------------------------

/** English adjective/demonym from a romanised name ("Ashkar" → "Ashkari", "Velma" → "Velman"). */
export function englishAdjective(name: string): string {
  const w = name.split(" ")[0];
  const fold = w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const low = fold.toLowerCase();
  if (/(ish|ese|ian|ic|ar|i)$/.test(low) && low.length > 5) return w;
  if (/[aeiouy]$/.test(low)) {
    if (/ia$/.test(low)) return w + "n";
    if (/a$/.test(low)) return w + "n";
    if (/[ou]$/.test(low)) return w + "an";
    if (/e$/.test(low)) return w.slice(0, -1) + "ean";
    return w + "an";
  }
  if (/(sh|ch|s|z|x|j)$/.test(low)) return w + "i";
  if (/(n|m|l|r)$/.test(low)) return w + (low.length % 2 ? "ese" : "ian");
  if (/(k|g|t|d|p|b|q)$/.test(low)) return w + "i";
  return w + "ian";
}

export function polityAdjective(h: History, id: Id, year: number): string {
  return englishAdjective(polityName(h, id, year).roman);
}

/**
 * The English title of a realm at a year, by government and culture:
 * "Kingdom of Ashkar", "the Ashkari Empire", "Most Serene Republic of Velm", …
 */
export function polityTitle(h: History, id: Id, year: number): string {
  const p = h.polities[id];
  const name = polityName(h, id, year).roman;
  const gov = valueAt(p.governments, year, "gov", p.governments[0].gov);
  const adj = englishAdjective(name);
  const c = h.cultures[p.culture];
  const v = (p.culture * 7 + id) % 3;
  const arch = c?.archetype;
  const old = year - p.founded;
  const overlord = valueAt(p.overlords, year, "overlord", -1);
  switch (gov) {
    case "tribe":
      return v === 0 ? `the ${adj} tribes` : `the tribes of ${name}`;
    case "chiefdom":
      return v === 2 ? `the ${adj} chiefdom` : `Chiefdom of ${name}`;
    case "kingdom":
      if (arch === "steppe") return `Khanate of ${name}`;
      return v === 0 ? `Kingdom of ${name}` : v === 1 ? `Realm of ${name}` : `the ${adj} Kingdom`;
    case "empire":
      if (arch === "steppe") return `the ${adj} Khaganate`;
      return v === 0 ? `the ${adj} Empire` : v === 1 ? `Empire of ${name}` : `High Kingdom of ${name}`;
    case "cityState":
      return v === 0 ? `Free City of ${name}` : `City of ${name}`;
    case "republic":
      if (old > 250 && v !== 2) return `Most Serene Republic of ${name}`;
      return v === 2 ? `Commonwealth of ${name}` : `Republic of ${name}`;
    case "theocracy":
      return v === 0 ? `Holy See of ${name}` : v === 1 ? `Theocracy of ${name}` : `Sacred Realm of ${name}`;
    case "confederation":
      return v === 0 ? `the ${adj} Confederacy` : `League of ${name}`;
    case "horde":
      return `the ${adj} Horde`;
    case "principality":
      return overlord >= 0 && v === 1 ? `Duchy of ${name}` : `Principality of ${name}`;
  }
  return name;
}

/** Ruler's English title for a government ("King", "Emperor", "Khan", "Doge"…). */
export function rulerTitle(h: History, polity: Id, year: number, sex: "m" | "f" = "m"): string {
  const p = h.polities[polity];
  const gov: Government = valueAt(p.governments, year, "gov", p.governments[0].gov);
  const arch = h.cultures[p.culture]?.archetype;
  const f = sex === "f";
  switch (gov) {
    case "tribe":
    case "chiefdom":
      return f ? "Chieftainess" : "Chief";
    case "kingdom":
      return arch === "steppe" ? (f ? "Khatun" : "Khan") : f ? "Queen" : "King";
    case "empire":
      return arch === "steppe" ? (f ? "Khatun" : "Khagan") : f ? "Empress" : "Emperor";
    case "cityState":
      return f ? "Lady" : "Lord";
    case "republic":
      return (polity + p.culture) % 2 ? "Doge" : "Archon";
    case "theocracy":
      return "High Priest" + (f ? "ess" : "");
    case "confederation":
      return f ? "High Chieftainess" : "High Chief";
    case "horde":
      return f ? "Khatun" : "Khan";
    case "principality":
      return f ? "Princess" : "Prince";
  }
  return f ? "Queen" : "King";
}

// ---------------------------------------------------------------------------
// Persons and rulers
// ---------------------------------------------------------------------------

/** The ruler entry of a polity at a year, or undefined (interregnum / not yet founded). */
export function rulerAt(h: History, polity: Id, year: number): { person: Id; from: number; to: number } | undefined {
  const rs = h.polities[polity].rulers;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if (r.from <= year && (r.to >= year || r.to < 0)) return r;
  }
  return undefined;
}

/** Given name of a person (first word). */
export function givenNameOf(p: Person): string {
  return p.name.roman.split(" ")[0];
}

/** "Oshar III the Bold" (regnal number shown when > 1, or 1 when a later namesake exists in the same realm line). */
export function regnalName(h: History, personId: Id, withEpithet = true): string {
  const p = h.persons[personId];
  const given = givenNameOf(p);
  let num = "";
  if (p.regnal > 1) num = ` ${roman(p.regnal)}`;
  else if (p.regnal === 1 && hasLaterNamesake(h, p)) num = " I";
  return `${given}${num}${withEpithet && p.epithet ? " " + p.epithet : ""}`;
}

function hasLaterNamesake(h: History, p: Person): boolean {
  const g = givenNameOf(p);
  for (const role of p.roles) {
    if (role.kind !== "ruler") continue;
    for (const r of h.polities[role.polity].rulers) {
      const q = h.persons[r.person];
      if (q.id !== p.id && q.regnal > 1 && givenNameOf(q) === g && r.from > role.from) return true;
    }
  }
  return false;
}

/** Full styled name: "King Oshar III the Bold of Ashkar". */
export function styledRuler(h: History, personId: Id, polity: Id, year: number): string {
  const p = h.persons[personId];
  return `${rulerTitle(h, polity, year, p.sex)} ${regnalName(h, personId)} of ${polityName(h, polity, year).roman}`;
}

export function ageAt(p: Person, year: number): number {
  return year - p.born;
}

export function isAlive(p: Person, year: number): boolean {
  return p.born <= year && (p.died < 0 || p.died > year);
}

/** Lifespan string "c. 812–867". */
export function lifespan(p: Person): string {
  return `${p.born}–${p.died >= 0 ? p.died : ""}`;
}

// ---------------------------------------------------------------------------
// Places and statistics
// ---------------------------------------------------------------------------

/** Urban population of a settlement at a year (interpolated between samples), 0 outside its life. */
export function populationAt(h: History, s: Settlement | Id, year: number): number {
  const st = typeof s === "number" ? h.settlements[s] : s;
  if (year < st.founded || (st.ended >= 0 && year > st.ended) || !st.pop.length) return 0;
  const f = year / h.sampleStep - st.popStart;
  if (f <= 0) return st.pop[0];
  const i = Math.floor(f);
  if (i >= st.pop.length - 1) return st.pop[st.pop.length - 1];
  const t = f - i;
  return Math.round(st.pop[i] * (1 - t) + st.pop[i + 1] * t);
}

/** A polity statistic at a year (nearest earlier sample). */
export function polityStatAt(h: History, p: Polity | Id, stat: keyof Polity["stats"], year: number): number {
  const pol = typeof p === "number" ? h.polities[p] : p;
  const arr = pol.stats[stat];
  const i = Math.floor(year / h.sampleStep) - pol.statStart;
  if (i < 0 || !arr.length) return 0;
  return arr[Math.min(arr.length - 1, i)];
}

export function ownerAt(h: History, settlement: Id, year: number): Id {
  return valueAt(h.settlements[settlement].owners, year, "polity", -1);
}
export function cultureAt(h: History, settlement: Id, year: number): Id {
  return valueAt(h.settlements[settlement].cultures, year, "culture", -1);
}
export function religionAt(h: History, settlement: Id, year: number): Id {
  return valueAt(h.settlements[settlement].religions, year, "religion", -1);
}
export function capitalAt(h: History, polity: Id, year: number): Id {
  return valueAt(h.polities[polity].capitals, year, "settlement", -1);
}
export function governmentAt(h: History, polity: Id, year: number): Government {
  const p = h.polities[polity];
  return valueAt(p.governments, year, "gov", p.governments[0].gov);
}
export function techAt(h: History, culture: Id, year: number): number {
  return valueAt(h.cultures[culture].tech, year, "level", 0);
}
export function languageAt(h: History, culture: Id, year: number): Id {
  return valueAt(h.cultures[culture].languages, year, "lang", -1);
}
export function scriptAt(h: History, culture: Id, year: number): Id {
  return valueAt(h.cultures[culture].scripts, year, "script", -1);
}

/** Polities alive at a year. */
export function politiesAt(h: History, year: number): Polity[] {
  return h.polities.filter((p) => p.founded <= year && (p.ended < 0 || p.ended > year));
}

/** Settlements alive at a year. */
export function settlementsAt(h: History, year: number): Settlement[] {
  return h.settlements.filter((s) => s.founded <= year && (s.ended < 0 || s.ended > year));
}

/** The named age containing a year. */
export function ageOf(h: History, year: number): History["ages"][number] | undefined {
  return h.ages.find((a) => a.start <= year && year <= a.end);
}

/**
 * Whether an event belongs to legend: the people it concerns had no writing
 * yet. The culture is taken from the event's first culture, else its first
 * polity's culture, else its first settlement's culture at the time.
 */
export function isLegendary(h: History, e: HEvent): boolean {
  let c = e.cultures?.[0] ?? -1;
  if (c < 0 && e.polities?.length) c = h.polities[e.polities[0]].culture;
  if (c < 0 && e.settlements?.length) c = cultureAt(h, e.settlements[0], e.year);
  if (c < 0) return false;
  return scriptAt(h, c, e.year) < 0;
}

/** Typed event payload. */
export function eventData<K extends EventType>(e: HEvent & { type: K }): EventData[K] {
  return e.data as unknown as EventData[K];
}

/** Events touching an entity (by reference arrays), optionally filtered by importance. */
export function eventsFor(h: History, kind: "polities" | "persons" | "settlements" | "cultures" | "religions" | "wars" | "dynasties" | "features", id: Id, minImportance = 1): HEvent[] {
  return h.events.filter((e) => e.importance >= minImportance && (e[kind] as Id[] | undefined)?.includes(id));
}
