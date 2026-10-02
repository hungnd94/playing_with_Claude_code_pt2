/**
 * Read-only history queries used by the atlas (the value of change lists at a
 * year, the owner layer at a year, names). Kept local so the atlas works
 * before/independently of src/history/query.ts; semantics follow the
 * conventions documented in src/history/types.ts.
 */
import type { History, LayerTimeline, NameRecord, Polity, Settlement, WName } from "../history/types";

/** Last entry with `year <= y` of a year-sorted change list, or undefined. */
export function atYear<T extends { year: number }>(list: readonly T[] | undefined, y: number): T | undefined {
  if (!list || list.length === 0) return undefined;
  let lo = 0, hi = list.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].year <= y) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? list[best] : undefined;
}

export function nameAt(names: readonly NameRecord[] | undefined, y: number): WName | undefined {
  return (atYear(names, y) ?? names?.[0])?.name;
}

const layerCache = new WeakMap<LayerTimeline, Map<number, Int32Array>>();

/** Reconstruct a timeline layer at snapshot index s. */
export function layerAtSnapshot(tl: LayerTimeline, keyEvery: number, s: number): Int32Array | null {
  if (!tl.keyframes.length) return null;
  let cache = layerCache.get(tl);
  if (!cache) {
    cache = new Map();
    layerCache.set(tl, cache);
  }
  const hit = cache.get(s);
  if (hit) return hit;
  const kf = Math.min(tl.keyframes.length - 1, Math.floor(s / keyEvery));
  const out = Int32Array.from(tl.keyframes[kf]);
  for (let q = kf * keyEvery + 1; q <= s; q++) {
    const cells = tl.diffCells[q], vals = tl.diffValues[q];
    if (!cells || !vals) continue;
    for (let i = 0; i < cells.length; i++) out[cells[i]] = vals[i];
  }
  if (cache.size > 8) cache.clear();
  cache.set(s, out);
  return out;
}

/** Owning polity per cell at a year (-1 = none), or null when the history has no owner layer. */
export function ownerAt(h: History, year: number): Int32Array | null {
  const t = h.timeline;
  if (!t || !t.owner || !t.snapshots) return null;
  const s = Math.max(0, Math.min(t.snapshots - 1, Math.floor(year / t.step)));
  return layerAtSnapshot(t.owner, t.keyEvery, s);
}

export function cultureAt(h: History, year: number): Int32Array | null {
  const t = h.timeline;
  if (!t || !t.culture || !t.snapshots) return null;
  const s = Math.max(0, Math.min(t.snapshots - 1, Math.floor(year / t.step)));
  return layerAtSnapshot(t.culture, t.keyEvery, s);
}

export function polityAlive(p: Polity, y: number): boolean {
  return p.founded <= y && (p.ended < 0 || p.ended > y);
}

export function settlementAlive(s: Settlement, y: number): boolean {
  return s.founded <= y && (s.ended < 0 || s.ended > y);
}

/** Population of a settlement at a year (linear between samples), 0 if unknown. */
export function popAt(h: History, s: Settlement, y: number): number {
  if (!s.pop || s.pop.length === 0) return 0;
  const step = h.sampleStep || 10;
  const f = y / step - s.popStart;
  if (f <= 0) return s.pop[0];
  if (f >= s.pop.length - 1) return s.pop[s.pop.length - 1];
  const i = Math.floor(f);
  return s.pop[i] + (s.pop[i + 1] - s.pop[i]) * (f - i);
}

/** Peak population over the settlement's life (for ruins). */
export function peakPop(s: Settlement): number {
  let m = 0;
  for (const v of s.pop ?? []) if (v > m) m = v;
  return m;
}

export function ownerOfSettlement(s: Settlement, y: number): number {
  return atYear(s.owners, y)?.polity ?? -1;
}

export function capitalAt(p: Polity, y: number): number {
  return atYear(p.capitals, y)?.settlement ?? -1;
}

export function overlordAt(p: Polity, y: number): number {
  return atYear(p.overlords, y)?.overlord ?? -1;
}

export function governmentAt(p: Polity, y: number): string {
  return atYear(p.governments, y)?.gov ?? "kingdom";
}

/**
 * Name of a geographic feature at a year: prefer the name used by `culture`
 * (if it has one by then), else the most recently given name, else none.
 */
export function featureNameAt(h: History, feature: number, y: number, culture = -1): WName | undefined {
  let fn = featureIndex.get(h);
  if (!fn) {
    fn = new Map();
    for (const f of h.featureNames ?? []) fn.set(f.feature, f);
    featureIndex.set(h, fn);
  }
  const rec = fn.get(feature);
  if (!rec || !rec.names.length) return undefined;
  let best: { year: number; culture: number; name: WName } | undefined;
  let bestCult: typeof best;
  for (const n of rec.names) {
    if (n.year > y) continue;
    if (!best || n.year >= best.year) best = n;
    if (culture >= 0 && n.culture === culture && (!bestCult || n.year >= bestCult.year)) bestCult = n;
  }
  return (bestCult ?? best)?.name;
}
const featureIndex = new WeakMap<History, Map<number, History["featureNames"][number]>>();

/** Dominant culture of a polity (its own culture). */
export function polityCulture(h: History, p: number): number {
  return h.polities[p]?.culture ?? -1;
}

/** Language object (src/lang Language) of a culture at a year, if the history carries one. */
export function languageDataAt(h: History, culture: number, y: number): unknown {
  const c = h.cultures[culture];
  if (!c) return undefined;
  const l = atYear(c.languages, y) ?? c.languages?.[0];
  if (!l) return undefined;
  return h.languages[l.lang]?.data;
}
