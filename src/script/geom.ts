/**
 * Geometry for glyph skeletons: stroke constructors, affine transforms,
 * centre-line sampling (arcs + rounded corners) and bounding boxes.
 */
import type { Stroke } from "./types";

export type P = [number, number];

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function line(x0: number, y0: number, x1: number, y1: number): Stroke {
  return { pts: [[x0, y0], [x1, y1]] };
}

export function poly(pts: P[], bend?: number[], closed = false): Stroke {
  const st: Stroke = { pts: pts.map((p) => [p[0], p[1]] as P) };
  const nseg = closed ? pts.length : pts.length - 1;
  if (bend && bend.some((b) => b !== 0)) {
    const b = bend.slice(0, nseg);
    while (b.length < nseg) b.push(0);
    st.bend = b;
  }
  if (closed) st.closed = true;
  return st;
}

export function arc(x0: number, y0: number, x1: number, y1: number, bend: number): Stroke {
  return { pts: [[x0, y0], [x1, y1]], bend: [bend] };
}

/** Full circle as two semicircles starting at the left-most point. */
export function circle(cx: number, cy: number, r: number, ry = r): Stroke {
  if (Math.abs(ry - r) < 1e-6) return { pts: [[cx - r, cy], [cx + r, cy]], bend: [0.5, 0.5], closed: true };
  // Ellipse approximated with four quarter arcs.
  return {
    pts: [[cx - r, cy], [cx, cy - ry], [cx + r, cy], [cx, cy + ry]],
    bend: [0.2071, 0.2071, 0.2071, 0.2071],
    closed: true,
  };
}

export function dot(x: number, y: number, r: number): Stroke {
  return { pts: [[x, y]], dot: r };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** Affine matrix [a, b, c, d, e, f]: x' = a x + c y + e; y' = b x + d y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  // m ∘ n (apply n first)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
export const shear = (k: number, y0 = 1): Mat => [1, 0, k, 1, -k * y0, 0];

export function apply(m: Mat, p: P): P {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Transform strokes. Reflections reverse orientation, so arc bends flip sign. */
export function transformStrokes(strokes: Stroke[], m: Mat, round = true): Stroke[] {
  const det = m[0] * m[3] - m[1] * m[2];
  const flip = det < 0;
  const sc = Math.sqrt(Math.abs(det));
  return strokes.map((st) => {
    const out: Stroke = {
      pts: st.pts.map((p) => {
        const q = apply(m, p);
        return round ? [r3(q[0]), r3(q[1])] : q;
      }),
    };
    if (st.bend) out.bend = st.bend.map((b) => (flip ? -b : b));
    if (st.closed) out.closed = true;
    if (st.smooth) out.smooth = 1;
    if (st.sharp) out.sharp = st.sharp.slice();
    if (st.dot !== undefined) out.dot = round ? r3(st.dot * sc) : st.dot * sc;
    if (st.w !== undefined) out.w = st.w;
    return out;
  });
}

export function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((st) => {
    const out: Stroke = { pts: st.pts.map((p) => [p[0], p[1]] as P) };
    if (st.bend) out.bend = st.bend.slice();
    if (st.closed) out.closed = true;
    if (st.smooth) out.smooth = 1;
    if (st.sharp) out.sharp = st.sharp.slice();
    if (st.dot !== undefined) out.dot = st.dot;
    if (st.w !== undefined) out.w = st.w;
    return out;
  });
}

export function roundStrokes(strokes: Stroke[]): Stroke[] {
  for (const st of strokes) {
    for (const p of st.pts) {
      p[0] = r3(p[0]);
      p[1] = r3(p[1]);
    }
    if (st.bend) st.bend = st.bend.map((b) => Math.round(b * 1000) / 1000);
    if (st.dot !== undefined) st.dot = r3(st.dot);
  }
  return strokes;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface Polyline {
  /** Flat x,y pairs. */
  xy: number[];
  /** Index (in points) of each original node in xy. */
  nodes: number[];
  closed: boolean;
}

/** Number of segments of a stroke. */
export const segCount = (st: Stroke): number => (st.closed ? st.pts.length : st.pts.length - 1);

/**
 * Sample one segment (from a to b with bend) into points, excluding the start
 * point, appended to out.
 */
function sampleSegment(a: P, b: P, bend: number, step: number, out: number[]): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return;
  if (Math.abs(bend) < 1e-4) {
    const n = Math.max(1, Math.ceil(L / step));
    for (let i = 1; i <= n; i++) out.push(a[0] + (dx * i) / n, a[1] + (dy * i) / n);
    return;
  }
  // Left of travel on screen (y down) = (dy, -dx).
  const nx = dy / L;
  const ny = -dx / L;
  const s = bend * L;
  const mx = (a[0] + b[0]) / 2 + nx * s;
  const my = (a[1] + b[1]) / 2 + ny * s;
  const as = Math.abs(s);
  const R = (L * L) / 4 / (2 * as) + as / 2;
  const sg = Math.sign(s);
  const cx = mx - nx * sg * R;
  const cy = my - ny * sg * R;
  const sweep = 4 * Math.atan((2 * as) / L);
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  // Determine rotation direction: towards mid.
  const am = Math.atan2(my - cy, mx - cx);
  let dir = 1;
  let d = am - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (d < 0) dir = -1;
  const n = Math.max(2, Math.ceil(Math.max((sweep * R) / step, sweep / (Math.PI / 18))));
  for (let i = 1; i <= n; i++) {
    const t = a0 + (dir * sweep * i) / n;
    out.push(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
  }
  // Snap the end exactly.
  out[out.length - 2] = b[0];
  out[out.length - 1] = b[1];
}

export function smooth(pts: P[], sharp?: number[], closed = false): Stroke {
  const st: Stroke = { pts: pts.map((p) => [p[0], p[1]] as P), smooth: 1 };
  if (sharp && sharp.length) st.sharp = sharp.slice();
  if (closed) st.closed = true;
  return st;
}

/** Centripetal Catmull–Rom segment from p1 to p2 (p0, p3 neighbours), appended without p1. */
function sampleCR(p0: P, p1: P, p2: P, p3: P, step: number, out: number[]): void {
  const d01 = Math.max(1e-4, Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5));
  const d12 = Math.max(1e-4, Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5));
  const d23 = Math.max(1e-4, Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5));
  // Tangents (Barry–Goldman form converted to Hermite).
  const m1x = (p1[0] - p0[0]) / d01 - (p2[0] - p0[0]) / (d01 + d12) + (p2[0] - p1[0]) / d12;
  const m1y = (p1[1] - p0[1]) / d01 - (p2[1] - p0[1]) / (d01 + d12) + (p2[1] - p1[1]) / d12;
  const m2x = (p2[0] - p1[0]) / d12 - (p3[0] - p1[0]) / (d12 + d23) + (p3[0] - p2[0]) / d23;
  const m2y = (p2[1] - p1[1]) / d12 - (p3[1] - p1[1]) / (d12 + d23) + (p3[1] - p2[1]) / d23;
  const t1x = m1x * d12;
  const t1y = m1y * d12;
  const t2x = m2x * d12;
  const t2y = m2y * d12;
  const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const n = Math.max(3, Math.ceil((L * 1.3) / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push(h00 * p1[0] + h10 * t1x + h01 * p2[0] + h11 * t2x, h00 * p1[1] + h10 * t1y + h01 * p2[1] + h11 * t2y);
  }
}

function sampleSmooth(st: Stroke, step: number): Polyline {
  const pts = st.pts;
  const n = pts.length;
  const closed = !!st.closed;
  const sharp = new Set(st.sharp ?? []);
  const xy: number[] = [pts[0][0], pts[0][1]];
  const nodes: number[] = [0];
  const nseg = closed ? n : n - 1;
  const refl = (a: P, b: P): P => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  for (let i = 0; i < nseg; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    let p0: P;
    let p3: P;
    if (sharp.has(i) || (!closed && i === 0)) p0 = refl(p1, p2);
    else p0 = pts[(i - 1 + n) % n];
    const j = (i + 1) % n;
    if (sharp.has(j) || (!closed && i + 1 === n - 1)) p3 = refl(p2, p1);
    else p3 = pts[(i + 2) % n];
    sampleCR(p0, p1, p2, p3, step, xy);
    nodes.push(xy.length / 2 - 1);
  }
  return { xy, nodes, closed };
}

/** Raw centre-line through the nodes (arcs sampled), no corner rounding. */
export function sampleRaw(st: Stroke, step = 0.02): Polyline {
  if (st.smooth && st.pts.length >= 2) return sampleSmooth(st, step);
  const xy: number[] = [st.pts[0][0], st.pts[0][1]];
  const nodes: number[] = [0];
  const n = segCount(st);
  for (let i = 0; i < n; i++) {
    const a = st.pts[i];
    const b = st.pts[(i + 1) % st.pts.length];
    sampleSegment(a, b, st.bend?.[i] ?? 0, step, xy);
    nodes.push(xy.length / 2 - 1);
  }
  return { xy, nodes, closed: !!st.closed };
}

function cumLen(xy: number[]): number[] {
  const n = xy.length / 2;
  const c = new Array<number>(n);
  c[0] = 0;
  for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
  return c;
}

function pointAt(xy: number[], cl: number[], s: number): P {
  const n = cl.length;
  if (s <= 0) return [xy[0], xy[1]];
  if (s >= cl[n - 1]) return [xy[2 * n - 2], xy[2 * n - 1]];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cl[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - cl[lo]) / Math.max(1e-12, cl[hi] - cl[lo]);
  return [xy[2 * lo] + (xy[2 * hi] - xy[2 * lo]) * t, xy[2 * lo + 1] + (xy[2 * hi + 1] - xy[2 * lo + 1]) * t];
}

/**
 * Centre-line with corners rounded: each node where the direction turns is
 * replaced by a quadratic curve spanning `radius` on either side (limited to
 * 45% of the adjacent pieces). Returns flat xy.
 */
export function sampleStroke(st: Stroke, radius: number, step = 0.02): number[] {
  const raw = sampleRaw(st, step);
  if (st.pts.length < 2 || radius <= 1e-4) return raw.xy;
  let xy = raw.xy;
  // For closed strokes, rotate so we start mid-segment to round node 0 too.
  const closed = raw.closed;
  const nodeList = closed ? raw.nodes.slice(0, raw.nodes.length - 1) : raw.nodes.slice(1, raw.nodes.length - 1);
  if (nodeList.length === 0) return xy;
  const cl = cumLen(xy);
  const total = cl[cl.length - 1];
  const nodeS = (closed ? raw.nodes : raw.nodes).map((i) => cl[i]);
  // Corner turning angle at each node.
  const turn = (k: number): number => {
    const i = raw.nodes[k];
    const n = xy.length / 2;
    let ip = i - 1;
    let inx = i + 1;
    if (closed) {
      if (ip < 0) ip = n - 2;
      if (inx > n - 1) inx = 1;
    }
    if (ip < 0 || inx > n - 1) return 0;
    const ax = xy[2 * i] - xy[2 * ip];
    const ay = xy[2 * i + 1] - xy[2 * ip + 1];
    const bx = xy[2 * inx] - xy[2 * i];
    const by = xy[2 * inx + 1] - xy[2 * i + 1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
  };
  type Cut = { s0: number; s1: number; k: number };
  const cuts: Cut[] = [];
  const nNodes = raw.nodes.length;
  const ks: number[] = [];
  if (closed) for (let k = 0; k < nNodes - 1; k++) ks.push(k);
  else for (let k = 1; k < nNodes - 1; k++) ks.push(k);
  for (const k of ks) {
    const th = turn(k);
    if (th < 0.12) continue;
    const s = nodeS[k];
    const prevS = closed ? (k === 0 ? nodeS[nNodes - 2] - total : nodeS[k - 1]) : nodeS[k - 1];
    const nextS = nodeS[k + 1];
    const r = Math.min(radius * Math.min(1, th / 1.2 + 0.25), 0.45 * (s - prevS), 0.45 * (nextS - s));
    if (r < 0.004) continue;
    cuts.push({ s0: s - r, s1: s + r, k });
  }
  if (cuts.length === 0) return xy;
  // Rebuild: walk along arclength, replacing cut ranges by quadratic curves.
  if (closed) {
    // Rotate the polyline so it starts at the midpoint of the first segment (not at a node).
    const shift = (nodeS[0] + nodeS[1]) / 2;
    const out: number[] = [];
    const n = xy.length / 2;
    // points with s in [shift, total) then [0, shift]
    const startP = pointAt(xy, cl, shift);
    out.push(startP[0], startP[1]);
    for (let i = 0; i < n; i++) if (cl[i] > shift) out.push(xy[2 * i], xy[2 * i + 1]);
    for (let i = 1; i < n; i++) if (cl[i] < shift) out.push(xy[2 * i], xy[2 * i + 1]);
    out.push(startP[0], startP[1]);
    xy = out;
    const cl2 = cumLen(xy);
    const remap = (s: number): number => {
      let v = s - shift;
      while (v < 0) v += total;
      while (v > total) v -= total;
      return v;
    };
    const cuts2 = cuts.map((c) => ({ s0: remap(c.s0), s1: remap(c.s1), k: c.k })).sort((a, b) => a.s0 - b.s0);
    return applyCuts(xy, cl2, cuts2, step);
  }
  return applyCuts(xy, cl, cuts, step);
}

function applyCuts(xy: number[], cl: number[], cuts: { s0: number; s1: number }[], step: number): number[] {
  const out: number[] = [];
  const n = cl.length;
  let ci = 0;
  let i = 0;
  while (i < n) {
    const s = cl[i];
    if (ci < cuts.length && s >= cuts[ci].s0) {
      const c = cuts[ci];
      const p0 = pointAt(xy, cl, c.s0);
      const p2 = pointAt(xy, cl, c.s1);
      // Control point: the original node (the raw vertex at the middle of the cut).
      let best = i;
      let bd = Infinity;
      for (let j = Math.max(0, i - 2); j < n && cl[j] <= c.s1 + 1e-9; j++) {
        const d = Math.abs(cl[j] - (c.s0 + c.s1) / 2);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      const ctrl: P = [xy[2 * best], xy[2 * best + 1]];
      const len = Math.hypot(ctrl[0] - p0[0], ctrl[1] - p0[1]) + Math.hypot(p2[0] - ctrl[0], p2[1] - ctrl[1]);
      const m = Math.max(3, Math.ceil(len / (step * 0.6)));
      for (let k = 0; k <= m; k++) {
        const t = k / m;
        const u = 1 - t;
        out.push(u * u * p0[0] + 2 * u * t * ctrl[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * ctrl[1] + t * t * p2[1]);
      }
      while (i < n && cl[i] <= c.s1) i++;
      ci++;
      continue;
    }
    out.push(xy[2 * i], xy[2 * i + 1]);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function strokesBBox(strokes: Stroke[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const st of strokes) {
    if (st.dot !== undefined) {
      const [x, y] = st.pts[0];
      x0 = Math.min(x0, x - st.dot);
      x1 = Math.max(x1, x + st.dot);
      y0 = Math.min(y0, y - st.dot);
      y1 = Math.max(y1, y + st.dot);
      continue;
    }
    const xy = sampleRaw(st, 0.05).xy;
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < x0) x0 = xy[i];
      if (xy[i] > x1) x1 = xy[i];
      if (xy[i + 1] < y0) y0 = xy[i + 1];
      if (xy[i + 1] > y1) y1 = xy[i + 1];
    }
  }
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

export function strokeLength(st: Stroke): number {
  if (st.dot !== undefined) return st.dot * 2;
  const xy = sampleRaw(st, 0.05).xy;
  let L = 0;
  for (let i = 2; i < xy.length; i += 2) L += Math.hypot(xy[i] - xy[i - 2], xy[i + 1] - xy[i - 1]);
  return L;
}

/** Ink length + structural weight: a rough visual complexity. */
export function complexity(strokes: Stroke[]): number {
  let c = 0;
  for (const st of strokes) {
    if (st.dot !== undefined) {
      c += 0.25;
      continue;
    }
    c += strokeLength(st) + 0.3 + 0.08 * (st.pts.length - 2);
  }
  return c;
}

/** Endpoints of open strokes. */
export function endpoints(strokes: Stroke[]): { p: P; dir: P; stroke: number; atStart: boolean }[] {
  const out: { p: P; dir: P; stroke: number; atStart: boolean }[] = [];
  strokes.forEach((st, si) => {
    if (st.dot !== undefined || st.closed || st.pts.length < 2) return;
    const raw = sampleRaw(st, 0.03).xy;
    const n = raw.length / 2;
    const s: P = [raw[0], raw[1]];
    const s2: P = [raw[2], raw[3]];
    const e: P = [raw[2 * n - 2], raw[2 * n - 1]];
    const e2: P = [raw[2 * n - 4], raw[2 * n - 3]];
    const norm = (v: P): P => {
      const l = Math.hypot(v[0], v[1]) || 1;
      return [v[0] / l, v[1] / l];
    };
    out.push({ p: s, dir: norm([s[0] - s2[0], s[1] - s2[1]]), stroke: si, atStart: true });
    out.push({ p: e, dir: norm([e[0] - e2[0], e[1] - e2[1]]), stroke: si, atStart: false });
  });
  return out;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
