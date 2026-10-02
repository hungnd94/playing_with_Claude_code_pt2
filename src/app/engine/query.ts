/**
 * Read-side helpers over a `History`: values at a year, timeline layer
 * reconstruction, names and titles. Kept DOM-free (also used by the worker and
 * tests). When src/history/query.ts lands these can delegate to it.
 */
import type {
  Culture, Government, History, Id, LayerTimeline, NameRecord, Polity, Settlement, Timeline, WName,
} from "../../history/types";

/** Index of the last entry with `year <= y` in a list sorted by year, or -1. */
export function indexAt(list: readonly { year: number }[], y: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].year <= y) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** The entry in effect at year y (last with year <= y), or the first entry when y precedes all. */
export function entryAt<T extends { year: number }>(list: readonly T[], y: number): T | undefined {
  if (!list.length) return undefined;
  const i = indexAt(list, y);
  return list[i < 0 ? 0 : i];
}

export function nameAt(names: readonly NameRecord[], y: number): WName {
  return entryAt(names, y)?.name ?? { roman: "?", gloss: "", lang: -1 };
}

export function snapshotIndex(tl: Timeline, year: number): number {
  return Math.max(0, Math.min(tl.snapshots - 1, Math.floor(year / tl.step)));
}

/**
 * Reconstructs a per-cell layer at any snapshot. Steps forward incrementally
 * (cheap while playing/scrubbing forwards); jumps reload the nearest keyframe.
 */
export class LayerCursor {
  private cur: Int32Array;
  private s = -1;
  constructor(private layer: LayerTimeline, private keyEvery: number, n: number) {
    this.cur = new Int32Array(n).fill(-1);
  }

  get snapshot(): number {
    return this.s;
  }

  at(s: number): Int32Array {
    if (s === this.s) return this.cur;
    const L = this.layer;
    const k = Math.min(L.keyframes.length - 1, Math.floor(s / this.keyEvery));
    const base = k * this.keyEvery;
    let from: number;
    if (this.s >= base && s > this.s) {
      from = this.s + 1;
    } else {
      const kf = L.keyframes[k];
      if (kf) this.cur.set(kf.subarray(0, this.cur.length));
      from = base + 1;
    }
    const cur = this.cur;
    for (let t = from; t <= s; t++) {
      const dc = L.diffCells[t], dv = L.diffValues[t];
      if (!dc) continue;
      for (let i = 0; i < dc.length; i++) cur[dc[i]] = dv[i];
    }
    this.s = s;
    return cur;
  }
}

export function popAt(s: Settlement, year: number, step: number): number {
  if (year < s.founded || (s.ended >= 0 && year >= s.ended)) return 0;
  const i = Math.floor(year / step) - s.popStart;
  if (i < 0) return s.pop[0] ?? 0;
  if (i >= s.pop.length) return s.pop[s.pop.length - 1] ?? 0;
  const a = s.pop[i], b = s.pop[Math.min(s.pop.length - 1, i + 1)];
  const f = (year - (s.popStart + i) * step) / step;
  return a + (b - a) * Math.max(0, Math.min(1, f));
}

export function seriesAt(series: readonly number[], start: number, year: number, step: number): number {
  const i = Math.floor(year / step) - start;
  if (i < 0 || !series.length) return 0;
  return series[Math.min(series.length - 1, i)];
}

export function alive(founded: number, ended: number, year: number): boolean {
  return year >= founded && (ended < 0 || year < ended);
}

export function govAt(p: Polity, y: number): Government {
  return entryAt(p.governments, y)?.gov ?? "kingdom";
}

const GOV_TITLE: Record<Government, [string, string]> = {
  tribe: ["the", "tribes of"],
  chiefdom: ["the Chiefdom of", ""],
  kingdom: ["the Kingdom of", ""],
  empire: ["the Empire of", ""],
  cityState: ["the City of", ""],
  republic: ["the Republic of", ""],
  theocracy: ["the Holy Realm of", ""],
  confederation: ["the Confederation of", ""],
  horde: ["the Horde of", ""],
  principality: ["the Principality of", ""],
};

export const GOV_NOUN: Record<Government, string> = {
  tribe: "tribal confederacy",
  chiefdom: "chiefdom",
  kingdom: "kingdom",
  empire: "empire",
  cityState: "city-state",
  republic: "republic",
  theocracy: "theocracy",
  confederation: "confederation",
  horde: "horde",
  principality: "principality",
};

/** Short display name of a polity at a year ("Ashkar"). */
export function polityName(h: History, id: Id, y: number): string {
  const p = h.polities[id];
  if (!p) return "?";
  return nameAt(p.names, Math.max(y, p.founded)).roman;
}

/** Formal title ("the Kingdom of Ashkar"). */
export function polityTitle(h: History, id: Id, y: number): string {
  const p = h.polities[id];
  if (!p) return "?";
  const yy = Math.min(Math.max(y, p.founded), p.ended >= 0 ? p.ended - 1 : y);
  const name = nameAt(p.names, yy).roman;
  const g = govAt(p, yy);
  if (g === "tribe") return `the ${cultureAdj(h, p.culture)} tribes`;
  return `${GOV_TITLE[g][0]} ${name}`;
}

export function cultureAdj(h: History, id: Id): string {
  return h.cultures[id]?.adjective ?? "unknown";
}

export function settlementName(h: History, id: Id, y: number): string {
  const s = h.settlements[id];
  if (!s) return "?";
  return nameAt(s.names, Math.max(y, s.founded)).roman;
}

export function langAt(c: Culture, y: number): Id {
  return entryAt(c.languages, y)?.lang ?? -1;
}

export function scriptAt(c: Culture, y: number): Id {
  const e = entryAt(c.scripts, y);
  return e && e.year <= y ? e.script : -1;
}

export function techAt(c: Culture, y: number): number {
  return entryAt(c.tech, y)?.level ?? 0;
}

export function ownerAt(s: Settlement, y: number): Id {
  const e = entryAt(s.owners, y);
  return e && e.year <= y ? e.polity : -1;
}

export function capitalAt(p: Polity, y: number): Id {
  return entryAt(p.capitals, y)?.settlement ?? -1;
}

export function rulerAt(p: Polity, y: number): Id {
  for (const r of p.rulers) if (y >= r.from && y < r.to) return r.person;
  return -1;
}

export const ROMAN = (n: number): string => {
  if (n <= 0) return "";
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
};

/** "Aldric II the Bold" style display name of a person. */
export function personName(h: History, id: Id, opts: { epithet?: boolean } = {}): string {
  const p = h.persons[id];
  if (!p) return "?";
  let s = p.name.roman;
  const ruler = p.regnal > 0 && p.roles.some((r) => r.kind === "ruler");
  // Monarchs are styled by given name and regnal number ("Aldric II the Bold").
  if (ruler) {
    const given = s.split(" ")[0];
    s = p.regnal > 1 ? `${given} ${ROMAN(p.regnal)}` : p.epithet ? given : s;
  }
  if (opts.epithet !== false && p.epithet) s += ` ${p.epithet}`;
  return s;
}

export function formatYear(y: number): string {
  return String(Math.round(y));
}

export function formatPop(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + " million";
  if (n >= 10000) return (Math.round(n / 1000) * 1000).toLocaleString("en-GB");
  if (n >= 1000) return (Math.round(n / 100) * 100).toLocaleString("en-GB");
  return String(Math.round(n / 10) * 10);
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}
