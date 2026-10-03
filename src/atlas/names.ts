/**
 * Names on the plate: feature names at a year (in the tongue of whoever holds
 * the land), realm titles, the cartouche title, and the native unit of the
 * scale bar. Pure.
 */
import type { History, WName } from "../history/types";
import { englishAdjective, polityTitle } from "../history/query";
import type { GeoFeature, PhysicalWorld } from "../world/types";
import { atYear, featureNameAt, nameAt, polityCultureAt } from "./hist";
import type { PlateSubject } from "./planner";

/** A name with its native-script rendering inputs. */
export interface NativeName {
  name: WName;
  /** Culture whose tongue it is (-1 unknown). */
  culture: number;
}

/** Culture holding a cell at a year (owner polity's culture), or -1. */
export function cultureOfCell(h: History, owner: Int32Array | null, cell: number, year: number): number {
  if (!owner || cell < 0) return -1;
  const o = owner[cell];
  if (o < 0) return -1;
  return polityCultureAt(h, o, year);
}

/**
 * Name of a feature at a year as the people who hold its anchor know it,
 * falling back to the most recent name anyone gave it.
 */
export function featureLabel(h: History, owner: Int32Array | null, f: GeoFeature, year: number): NativeName | null {
  let culture = cultureOfCell(h, owner, f.anchor, year);
  if (culture < 0 && owner) {
    // Majority culture over the feature's cells.
    const cnt = new Map<number, number>();
    for (let i = 0; i < f.cells.length; i += Math.max(1, Math.floor(f.cells.length / 64))) {
      const c = cultureOfCell(h, owner, f.cells[i], year);
      if (c >= 0) cnt.set(c, (cnt.get(c) ?? 0) + 1);
    }
    let best = -1, bc = 0;
    for (const [c, k] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) if (k > bc) { bc = k; best = c; }
    culture = best;
  }
  const nm = featureNameAt(h, f.id, year, culture);
  if (!nm || !nm.roman) return null;
  return { name: nm, culture };
}

/** Realm core name at a year. */
export function realmName(h: History, polity: number, year: number): WName | undefined {
  const p = h.polities[polity];
  return p ? nameAt(p.names, year) : undefined;
}

/** "Kingdom of Ashkar" etc. (falls back to the core name on incomplete data). */
export function realmTitle(h: History, polity: number, year: number): string {
  try {
    const t = polityTitle(h, polity, year);
    if (t) return t;
  } catch {
    /* mock or partial data */
  }
  return realmName(h, polity, year)?.roman ?? "";
}

/** Capitalise the first letter of a title ("the Ashkari Empire" → "The Ashkari Empire"). */
export function capFirst(s: string): string {
  return s ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}

export interface PlateTitle {
  /** Small line above the main title, e.g. "The Realms of" (may be ""). */
  pre: string;
  /** Main title, e.g. "the Velm Basin". */
  main: string;
  /** e.g. "in the Year 1182". */
  sub: string;
  /** Native name of the subject and its tongue, if any. */
  native: NativeName | null;
}

const KIND_TITLE: Partial<Record<GeoFeature["kind"], (n: string) => [string, string]>> = {
  continent: (n) => ["The Lands of", n],
  island: (n) => ["The Isle of", n],
  archipelago: (n) => ["The Isles of", n],
  peninsula: (n) => ["The Peninsula of", n],
  mountains: (n) => ["The Realms beneath the", `${n} Mountains`],
  hills: (n) => ["The Country of the", `${n} Hills`],
  volcano: (n) => ["The Lands about", `the Fire-Mountain ${n}`],
  river: (n) => ["The Basin of the", `River ${n}`],
  lake: (n) => ["The Shores of", `Lake ${n}`],
  sea: (n) => ["The Shores of the", `${n} Sea`],
  ocean: (n) => ["The Coasts of the", `${n} Ocean`],
  bay: (n) => ["The Shores of the", `Gulf of ${n}`],
  strait: (n) => ["The Narrows of", n],
  desert: (n) => ["The", `${n} Waste`],
  forest: (n) => ["The Forest of", n],
  jungle: (n) => ["The Wildwood of", n],
  steppe: (n) => ["The Grasslands of", n],
  tundra: (n) => ["The Barrens of", n],
  marsh: (n) => ["The Fens of", n],
  plain: (n) => ["The Plains of", n],
  glacier: (n) => ["The Ice of", n],
};

/** Year phrase, with the age if the history names one. */
export function yearPhrase(h: History | null, year: number): string {
  if (!h) return "";
  const age = h.ages?.find((a) => a.start <= year && year <= a.end);
  const y = `in the Year ${Math.round(year)}`;
  return age && age.name ? `${y}, ${/^the /i.test(age.name) ? age.name : "the " + age.name}` : y;
}

/**
 * Title for a plate. `prominent` is the most prominent named feature in view
 * (used for free regions), `realmsInView` the number of realms shown.
 */
export function plateTitle(world: PhysicalWorld, h: History | null, year: number, owner: Int32Array | null, subject: PlateSubject | undefined, prominent: GeoFeature | null, realmsInView: number): PlateTitle {
  if (!h) {
    return { pre: "", main: "Terra Incognita", sub: "a chart of lands not yet named", native: null };
  }
  const sub = yearPhrase(h, year);
  if (subject?.kind === "realm" && h.polities[subject.polity]) {
    const t = capFirst(realmTitle(h, subject.polity, year));
    const nm = realmName(h, subject.polity, year);
    const m = /^(the )?(.*?)( of )(.*)$/i.exec(t);
    const native = nm ? { name: nm, culture: h.polities[subject.polity].culture } : null;
    if (m) return { pre: capFirst(`${m[1] ?? ""}${m[2]}${m[3]}`.trim()), main: m[4], sub, native };
    return { pre: "", main: t, sub, native };
  }
  if (subject?.kind === "war" && h.wars[subject.war]) {
    const w = h.wars[subject.war];
    const nm = w.name.replace(/^the /i, "");
    return { pre: "The Theatre of the", main: nm, sub: `${w.start}–${w.end >= 0 ? w.end : "…"}`, native: null };
  }
  let feat: GeoFeature | null = null;
  if (subject?.kind === "feature") feat = world.features[subject.feature] ?? null;
  if (!feat) feat = prominent;
  if (feat) {
    const nn = featureLabel(h, owner, feat, year);
    if (nn) {
      const fn = KIND_TITLE[feat.kind] ?? ((n: string) => ["The Lands of", n] as [string, string]);
      let [pre, main] = fn(nn.name.roman);
      if (subject?.kind !== "feature" && realmsInView >= 2) {
        if (feat.kind === "sea" || feat.kind === "ocean" || feat.kind === "bay" || feat.kind === "lake") pre = pre.replace(/^The Shores of|^The Coasts of/, "The Realms about");
        else if (feat.kind === "river") pre = "The Realms of the";
        else pre = pre.replace(/^The Lands of|^The Realms beneath the/, (s) => (s.includes("beneath") ? "The Realms beneath the" : "The Realms of"));
      }
      return { pre, main, sub, native: nn };
    }
  }
  return { pre: "", main: "A Chart of the Known Lands", sub, native: null };
}

/** The culture whose people hold most of the plate (for the native unit and the cartouche's tongue). */
export function dominantCulture(h: History, ownerNode: Int32Array | null, year: number): number {
  if (!ownerNode) return -1;
  const cnt = new Map<number, number>();
  for (let i = 0; i < ownerNode.length; i += 3) {
    const o = ownerNode[i];
    if (o < 0) continue;
    const c = polityCultureAt(h, o, year);
    if (c >= 0) cnt.set(c, (cnt.get(c) ?? 0) + 1);
  }
  let best = -1, bc = 0;
  for (const [c, n] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) if (n > bc) { bc = n; best = c; }
  return best;
}

interface LangLike {
  lexicon?: Record<string, { form?: string[] }>;
  orthography?: unknown;
}

/** Romanised word for a concept in a culture's tongue at a year (via the language object), or "". */
export function nativeWord(h: History, culture: number, concept: string, year: number, romanize?: (orth: unknown, w: string[]) => string): string {
  const c = h.cultures[culture];
  if (!c || !romanize) return "";
  const l = atYear(c.languages, year) ?? c.languages?.[0];
  const data = l ? (h.languages[l.lang]?.data as LangLike | undefined) : undefined;
  const form = data?.lexicon?.[concept]?.form;
  if (!form || !data?.orthography) return "";
  try {
    return romanize(data.orthography, form);
  } catch {
    return "";
  }
}

/** The native unit for the scale bar: a day's march in the dominant tongue. */
export interface NativeUnit {
  /** "Days' March of the Ashkari" */
  caption: string;
  /** Native word, e.g. "nas" (may be ""). */
  word: string;
  gloss: string;
  km: number;
}

export function nativeUnit(h: History | null, culture: number, year: number, romanize?: (orth: unknown, w: string[]) => string): NativeUnit {
  if (!h || culture < 0 || !h.cultures[culture]) return { caption: "Days' March", word: "", gloss: "", km: 32 };
  const cu = h.cultures[culture];
  const adj = cu.adjective || englishAdjective(cu.name.roman);
  const word = nativeWord(h, culture, "day", year, romanize);
  return { caption: `${adj} Days' March`, word, gloss: "day", km: 32 };
}
