/**
 * View planners: choose an `AtlasView` (centre + radius) that frames a realm,
 * a geographic feature, a war or a continent at a given plate aspect ratio,
 * plus a suggested subject for the cartouche. Pure; Node-safe.
 *
 * Fitting works in the tangent plane of a provisional centre (Lambert
 * azimuthal, like the plate itself): the bounding box of the points (robust
 * percentiles for scattered sets) is centred and scaled so that it fits the
 * plate's half-height (`radiusKm` is measured to the nearest edge) and its
 * half-width (= aspect × half-height).
 */
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import { ownerAt, polityAlive } from "./hist";
import type { AtlasView } from "./projection";

/** What a plate is about (drives the cartouche title). */
export type PlateSubject =
  | { kind: "realm"; polity: number }
  | { kind: "feature"; feature: number }
  | { kind: "war"; war: number }
  | { kind: "region" };

export interface PlannedView {
  view: AtlasView;
  year: number;
  subject: PlateSubject;
}

export interface FitOptions {
  /** Plate width / height (map area); default 1600/1100. */
  aspect?: number;
  /** Extra room around the points (fraction); default 0.12. */
  margin?: number;
  /** Percentile trimmed from each side of the extents (0 = exact bbox). */
  trim?: number;
  /** Minimum and maximum radius, km. */
  minKm?: number;
  maxKm?: number;
}

const DEG = 180 / Math.PI;

/** Unit vector of the centre of a set of cells (normalised mean). */
function meanDir(world: PhysicalWorld, cells: ArrayLike<number>, weights?: ArrayLike<number>): [number, number, number] {
  const xyz = world.mesh.xyz;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const w = weights ? weights[i] : 1;
    x += xyz[3 * c] * w;
    y += xyz[3 * c + 1] * w;
    z += xyz[3 * c + 2] * w;
  }
  const L = Math.hypot(x, y, z) || 1;
  return [x / L, y / L, z / L];
}

function frame(c: [number, number, number]): { e: [number, number, number]; n: [number, number, number] } {
  const lat = Math.asin(Math.max(-1, Math.min(1, c[2])));
  const lon = Math.atan2(c[1], c[0]);
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return { e: [-so, co, 0], n: [-sl * co, -sl * so, cl] };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const f = Math.max(0, Math.min(sorted.length - 1, q * (sorted.length - 1)));
  const i = Math.floor(f);
  return sorted[i] + (sorted[Math.min(sorted.length - 1, i + 1)] - sorted[i]) * (f - i);
}

/** Lambert azimuthal plane coordinates (unit sphere) of v around centre c. */
function lambert(c: [number, number, number], fr: ReturnType<typeof frame>, x: number, y: number, z: number): [number, number] {
  const cosc = x * c[0] + y * c[1] + z * c[2];
  const k = Math.sqrt(2 / Math.max(1e-6, 1 + cosc));
  return [k * (x * fr.e[0] + y * fr.e[1] + z * fr.e[2]), k * (x * fr.n[0] + y * fr.n[1] + z * fr.n[2])];
}

/** Inverse Lambert: plane (X, Y) around centre c → unit vector. */
function lambertInv(c: [number, number, number], fr: ReturnType<typeof frame>, X: number, Y: number): [number, number, number] {
  const rho = Math.hypot(X, Y);
  if (rho < 1e-12) return c;
  const th = 2 * Math.asin(Math.min(1, rho / 2));
  const s = Math.sin(th) / rho, cs = Math.cos(th);
  return [
    c[0] * cs + (fr.e[0] * X + fr.n[0] * Y) * s,
    c[1] * cs + (fr.e[1] * X + fr.n[1] * Y) * s,
    c[2] * cs + (fr.e[2] * X + fr.n[2] * Y) * s,
  ];
}

/**
 * Fit a set of cells into a plate. Returns a view whose map area contains the
 * (trimmed) cells with a margin.
 */
export function fitCells(world: PhysicalWorld, cells: ArrayLike<number>, opts: FitOptions = {}): AtlasView {
  const aspect = opts.aspect ?? 1600 / 1100;
  const margin = opts.margin ?? 0.12;
  const trim = opts.trim ?? 0;
  const R = world.params.radiusKm;
  const xyz = world.mesh.xyz;
  if (cells.length === 0) return { centerLat: 0, centerLon: 0, radiusKm: R * 0.5 };
  let c = meanDir(world, cells);
  // Two passes: centre on the bbox of the projected points, re-project.
  let half = 0;
  for (let pass = 0; pass < 2; pass++) {
    const fr = frame(c);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      const q = cells[i];
      const [X, Y] = lambert(c, fr, xyz[3 * q], xyz[3 * q + 1], xyz[3 * q + 2]);
      xs.push(X);
      ys.push(Y);
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const x0 = quantile(xs, trim), x1 = quantile(xs, 1 - trim);
    const y0 = quantile(ys, trim), y1 = quantile(ys, 1 - trim);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    c = lambertInv(c, fr, cx, cy);
    half = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect);
  }
  // Pad by one cell spacing so the outermost cells' area is in view.
  const sp = world.mesh.meanSpacing;
  const planeHalf = half * (1 + margin) + sp * 0.8;
  // Plane distance ρ ↔ angle θ = 2 asin(ρ/2).
  const theta = 2 * Math.asin(Math.min(1, planeHalf / 2));
  let radiusKm = theta * R;
  radiusKm = Math.max(opts.minKm ?? 260, Math.min(opts.maxKm ?? R * 1.6, radiusKm));
  return { centerLat: Math.asin(Math.max(-1, Math.min(1, c[2]))) * DEG, centerLon: Math.atan2(c[1], c[0]) * DEG, radiusKm };
}

/** A continent (or island, or any landmass feature) as a whole. */
export function planContinentView(world: PhysicalWorld, feature: number, year = 0, opts: FitOptions = {}): PlannedView {
  const f = world.features[feature];
  const cells = f ? f.cells : new Int32Array(0);
  return { view: fitCells(world, cells, { margin: 0.06, ...opts }), year, subject: { kind: "feature", feature } };
}

/**
 * A geographic feature (range, sea, lake, desert, forest, river…). Rivers are
 * framed with their whole basin's main stem; small features get a minimum
 * radius so that their surroundings give context.
 */
export function planRegionView(world: PhysicalWorld, feature: number, year = 0, opts: FitOptions = {}): PlannedView {
  const f = world.features[feature];
  const cells = f ? f.cells : new Int32Array(0);
  const minKm = f && (f.kind === "volcano" || f.kind === "lake" || f.kind === "strait") ? 420 : 320;
  return { view: fitCells(world, cells, { margin: 0.35, minKm, trim: f && (f.kind === "ocean") ? 0.15 : 0, ...opts }), year, subject: { kind: "feature", feature } };
}

/** A realm at a year: its territory (trimmed for far-flung colonies) and its capital. */
export function planRealmView(world: PhysicalWorld, h: History, polity: number, year: number, opts: FitOptions = {}): PlannedView {
  const owner = ownerAt(h, year);
  const cells: number[] = [];
  if (owner) for (let i = 0; i < owner.length; i++) if (owner[i] === polity) cells.push(i);
  // Vassals count as part of the realm's sphere.
  const p = h.polities[polity];
  if (owner && p) {
    const vassals = new Set<number>();
    for (const q of h.polities) {
      if (!polityAlive(q, year)) continue;
      const ov = q.overlords.filter((o) => o.year <= year).pop()?.overlord ?? -1;
      if (ov === polity) vassals.add(q.id);
    }
    if (vassals.size) for (let i = 0; i < owner.length; i++) if (vassals.has(owner[i])) cells.push(i);
  }
  if (!cells.length && p) {
    const cap = p.capitals.filter((c) => c.year <= year).pop()?.settlement ?? p.capitals[0]?.settlement ?? -1;
    if (cap >= 0) cells.push(h.settlements[cap].cell);
  }
  const trim = cells.length > 60 ? 0.02 : 0;
  return { view: fitCells(world, cells, { margin: 0.28, trim, minKm: 380, ...opts }), year, subject: { kind: "realm", polity } };
}

/**
 * A war: its battles and the belligerents' capitals (and the territory that
 * changed hands), shown at the war's end (or `year` if given).
 */
export function planWarView(world: PhysicalWorld, h: History, war: number, year?: number, opts: FitOptions = {}): PlannedView {
  const w = h.wars[war];
  const cells: number[] = [];
  const at = year ?? (w ? (w.end >= 0 ? w.end : w.start) : 0);
  if (w) {
    for (const b of w.battles) if (h.battles[b]) cells.push(h.battles[b].cell);
    for (const t of w.transfers) if (h.settlements[t.settlement]) cells.push(h.settlements[t.settlement].cell);
    for (const pid of [...w.attackers, ...w.defenders]) {
      const p = h.polities[pid];
      const cap = p?.capitals.filter((c) => c.year <= at).pop()?.settlement ?? -1;
      if (cap >= 0) cells.push(h.settlements[cap].cell);
    }
  }
  return { view: fitCells(world, cells, { margin: 0.3, minKm: 420, ...opts }), year: at, subject: { kind: "war", war } };
}

/** A free view around a point (degrees), e.g. the globe camera's centre. */
export function planPointView(centerLat: number, centerLon: number, radiusKm: number, year: number): PlannedView {
  return { view: { centerLat, centerLon, radiusKm }, year, subject: { kind: "region" } };
}

/** The largest realms alive at a year, by territory (cells), descending. */
export function largestRealms(h: History, year: number, count = 5): number[] {
  const owner = ownerAt(h, year);
  if (!owner) return [];
  const n = new Map<number, number>();
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0) n.set(owner[i], (n.get(owner[i]) ?? 0) + 1);
  return [...n.entries()]
    .filter(([id]) => h.polities[id] && polityAlive(h.polities[id], year))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, count)
    .map(([id]) => id);
}
