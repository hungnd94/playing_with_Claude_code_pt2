/**
 * Rivers as smooth, meandering, tapered ink curves.
 *
 * Chains follow the drainage graph (`downstream`) through cell centres, with
 * each centre displaced by a per-cell offset (shared by every chain that uses
 * the cell, so tributaries meet their stems exactly), Catmull–Rom smoothing,
 * fine meander noise, and clipping to the shore of the sampled field.
 */
import { hash01 } from "../core/rng";
import type { PhysicalWorld } from "../world/types";
import type { Pt } from "./contour";
import { sampleAt, type FieldGrid, noiseFor } from "./field";
import type { Projection } from "./projection";

export interface RiverPath {
  /** Screen points, source → mouth. */
  pts: Pt[];
  /** Width (px) at each point. */
  width: number[];
  /** Cells along the chain (source → mouth) — the uncut chain. */
  cells: number[];
  /** Main stem (chain reaching the sea/lake/end) vs tributary ending at a confluence. */
  endsAtConfluence: boolean;
  /** Peak discharge along the chain. */
  maxFlow: number;
  /** Geo feature id of the named river this chain belongs to, or -1. */
  feature: number;
}

export interface RiverOptions {
  minOrder: number;
  minFlow: number;
  k: number;
}

const OUT = { x: 0, y: 0 };

export function riverWidth(flow: number, k: number): number {
  return k * Math.min(3.4, 0.55 + 0.5 * Math.log2(1 + flow / 260));
}

export function buildRivers(world: PhysicalWorld, proj: Projection, field: FieldGrid, opts: RiverOptions): RiverPath[] {
  const { mesh, downstream, flow, riverOrder, isLand, lakeId } = world;
  const n = mesh.n;
  const xyz = mesh.xyz;
  const margin = mesh.meanSpacing * 3;
  const isRiver = new Uint8Array(n);
  const visible = (i: number) => proj.inCap(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2], margin);
  for (let i = 0; i < n; i++) {
    if (!isLand[i] || lakeId[i] >= 0) continue;
    if (riverOrder[i] < opts.minOrder || flow[i] < opts.minFlow) continue;
    if (!visible(i)) continue;
    isRiver[i] = 1;
  }
  // Main upstream of every cell = river upstream with the largest flow.
  const main = new Int32Array(n).fill(-1);
  const hasUp = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!isRiver[i]) continue;
    const d = downstream[i];
    if (d < 0) continue;
    hasUp[d] = 1;
    if (main[d] < 0 || flow[i] > flow[main[d]] || (flow[i] === flow[main[d]] && i < main[d])) main[d] = i;
  }
  // Feature membership (named rivers).
  const featOf = new Map<number, number>();
  for (const f of world.features) if (f.kind === "river") for (const c of f.cells) if (!featOf.has(c)) featOf.set(c, f.id);

  // Per-cell displaced screen position (shared between chains).
  const sp = mesh.meanSpacing;
  const pxPerSpacing = (sp * proj.R) / proj.kmPerPx;
  const disp = new Map<number, Pt>();
  const posOf = (c: number): Pt | null => {
    let p = disp.get(c);
    if (p) return p;
    if (!proj.forward(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], OUT)) return null;
    const a = hash01(c, 7) * Math.PI * 2;
    const r = Math.sqrt(hash01(c, 11)) * 0.26 * pxPerSpacing;
    p = [OUT.x + Math.cos(a) * r, OUT.y + Math.sin(a) * r];
    disp.set(c, p);
    return p;
  };

  // Chains: start at sources (no river upstream); continue while the cell is the main upstream of its downstream.
  const chains: { cells: number[]; confluence: boolean }[] = [];
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (isRiver[i] && !hasUp[i]) order.push(i);
  // Also start chains at river cells whose upstream is non-river but that are not someone's main (covered above).
  for (const s of order) {
    const cells: number[] = [];
    let c = s;
    let confluence = false;
    for (let guard = 0; guard < 10000; guard++) {
      cells.push(c);
      const d = downstream[c];
      if (d < 0) break;
      if (!isRiver[d]) {
        // mouth (sea or lake) or end of the drawn network
        cells.push(d);
        break;
      }
      if (main[d] !== c) {
        cells.push(d);
        confluence = true;
        break;
      }
      c = d;
    }
    if (cells.length >= 2) chains.push({ cells, confluence });
  }

  const nz = noiseFor(world.params.seed, "meander");
  const built: { pts: Pt[]; wid: number[]; ch: { cells: number[]; confluence: boolean } }[] = [];
  for (const ch of chains) {
    const ctrl: Pt[] = [];
    const fl: number[] = [];
    for (const c of ch.cells) {
      const p = posOf(c);
      if (!p) continue;
      ctrl.push(p);
      fl.push(isLand[c] && lakeId[c] < 0 ? flow[c] : flow[ch.cells[ch.cells.length - 2] ?? c]);
    }
    if (ctrl.length < 2) continue;
    // Catmull–Rom subdivision.
    const pts: Pt[] = [];
    const wid: number[] = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(2, Math.ceil(segLen / (2.5 * opts.k)));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        pts.push([x, y]);
        wid.push(riverWidth(fl[i] + (fl[i + 1] - fl[i]) * t, opts.k));
      }
    }
    pts.push(ctrl[ctrl.length - 1]);
    wid.push(riverWidth(fl[fl.length - 1], opts.k));
    // Fine meander: perpendicular noise, zero at the chain ends.
    const m = pts.length;
    const cum = [0];
    for (let i = 1; i < m; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[m - 1] || 1;
    const seedOff = hash01(ch.cells[0], 3) * 100;
    const meander: Pt[] = pts.map((p, i) => {
      if (i === 0 || i === m - 1) return p;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const s = cum[i];
      const env = Math.min(1, s / 8, (total - s) / 8);
      const amp = (1.0 + 0.25 * wid[i]) * opts.k;
      const big = Math.min(0.09 * pxPerSpacing, 14 * opts.k);
      const off = (big * nz.noise(s / (0.55 * pxPerSpacing), seedOff, 7.5) + amp * (nz.noise(s / (14 * opts.k), seedOff, 0.5) + 0.4 * nz.noise(s / (5 * opts.k), seedOff, 3.5))) * env;
      return [p[0] + nx * off, p[1] + ny * off];
    });
    built.push({ pts: meander, wid, ch });
  }
  // Snap tributary ends onto their stems (the stem meanders through the junction).
  const interiorOf = new Map<number, number>();
  built.forEach((b, idx) => {
    for (let q = 0; q < b.ch.cells.length - 1; q++) interiorOf.set(b.ch.cells[q], idx);
  });
  for (const b of built) {
    if (!b.ch.confluence) continue;
    const j = b.ch.cells[b.ch.cells.length - 1];
    const stem = interiorOf.get(j);
    if (stem === undefined) continue;
    const end = b.pts[b.pts.length - 1];
    let best = -1, bd = Infinity;
    for (let q = 0; q < built[stem].pts.length; q++) {
      const p = built[stem].pts[q];
      const d = (p[0] - end[0]) ** 2 + (p[1] - end[1]) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    if (best >= 0) b.pts[b.pts.length - 1] = built[stem].pts[best];
  }
  const out: RiverPath[] = [];
  for (const b of built) {
    const ch = b.ch;
    // Clip to land: runs on land, ending exactly at the shore.
    const runs = clipToLand(b.pts, b.wid, field);
    for (const r of runs) {
      if (r.pts.length < 2) continue;
      let maxFlow = 0;
      for (const c of ch.cells) if (isLand[c] && lakeId[c] < 0) maxFlow = Math.max(maxFlow, flow[c]);
      let feature = -1;
      for (const c of ch.cells) {
        const f = featOf.get(c);
        if (f !== undefined) { feature = f; break; }
      }
      out.push({ pts: r.pts, width: r.width, cells: ch.cells, endsAtConfluence: ch.confluence && !r.cut, maxFlow, feature });
    }
  }
  return out;
}

function clipToLand(pts: Pt[], wid: number[], field: FieldGrid): { pts: Pt[]; width: number[]; cut: boolean }[] {
  const runs: { pts: Pt[]; width: number[]; cut: boolean }[] = [];
  let cur: { pts: Pt[]; width: number[]; cut: boolean } | null = null;
  const land = (p: Pt) => sampleAt(field, field.coast, p[0], p[1]) > 0;
  let prevLand = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const L = land(p);
    if (L) {
      if (!cur) {
        cur = { pts: [], width: [], cut: false };
        if (i > 0) {
          const q = crossing(pts[i - 1], p, field);
          cur.pts.push(q);
          cur.width.push(wid[i]);
        }
      }
      cur.pts.push(p);
      cur.width.push(wid[i]);
    } else if (cur) {
      if (prevLand) {
        const q = crossing(pts[i - 1], p, field);
        cur.pts.push(q);
        cur.width.push(wid[i - 1]);
      }
      cur.cut = true;
      runs.push(cur);
      cur = null;
    }
    prevLand = L;
  }
  if (cur) runs.push(cur);
  // Drop tiny fragments.
  return runs.filter((r) => r.pts.length >= 3);
}

/** Bisection for the shore crossing between a and b (one on land, one in water). */
function crossing(a: Pt, b: Pt, field: FieldGrid): Pt {
  const fa = sampleAt(field, field.coast, a[0], a[1]) > 0;
  let lo = 0, hi = 1;
  for (let it = 0; it < 10; it++) {
    const t = (lo + hi) / 2;
    const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const L = sampleAt(field, field.coast, p[0], p[1]) > 0;
    if (L === fa) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Outline polygon of a tapered river (left side forward, right side back). */
export function riverOutline(r: RiverPath): Pt[] {
  const { pts, width } = r;
  const m = pts.length;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < m; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    // taper the very source to a point
    const src = Math.min(1, i / 6);
    const w = (width[i] / 2) * (0.25 + 0.75 * src);
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  return left.concat(right.reverse());
}
