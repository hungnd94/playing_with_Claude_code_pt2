/**
 * Tool-aware outline rendering: stroke skeletons → filled polygons → SVG path data.
 *
 * Every filled polygon is emitted with the same orientation (positive shoelace
 * in y-down coordinates, i.e. clockwise on screen) so overlapping strokes
 * union correctly under the nonzero fill rule; deliberate holes (the facet of
 * a wedge impression) are emitted reversed.
 *
 *  pen     exact Minkowski sum of the centre-line with the nib segment, split
 *          where the stroke runs parallel to the nib; slanted terminals.
 *  reed    softened broad nib plus a round monoline core (rounded terminals).
 *  brush   pressure profile (press-in, swell, tapered lift), direction bias.
 *  needle  thin monoline with round caps and joins (palm-leaf stylus).
 *  chisel  even width, flared terminals, mitred corners.
 *  knife   curves broken into straight cuts, each a spindle-shaped groove.
 *  stylus  each straight piece becomes a wedge impression (head + tail).
 */
import type { ScriptStyle, Stroke } from "./types";
import { sampleStroke, sampleRaw, type P } from "./geom";

type Poly = number[]; // flat x,y

const TAU = Math.PI * 2;

function area(p: Poly): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a / 2;
}

function reversePoly(p: Poly): Poly {
  const out: Poly = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/** Make a simple (convex-ish) polygon clockwise on screen. */
function cw(p: Poly): Poly {
  return area(p) < 0 ? reversePoly(p) : p;
}

function circlePoly(cx: number, cy: number, r: number, n = 0): Poly {
  const m = n || Math.max(10, Math.min(28, Math.ceil(r * 260)));
  const out: Poly = [];
  for (let i = 0; i < m; i++) {
    const t = (i / m) * TAU;
    out.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
  }
  return cw(out);
}

function ellipsePoly(cx: number, cy: number, rx: number, ry: number, rot: number): Poly {
  const m = 20;
  const out: Poly = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < m; i++) {
    const t = (i / m) * TAU;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push(cx + x * c - y * s, cy + x * s + y * c);
  }
  return cw(out);
}

/** Split a dense polyline at sharp turns (> maxTurn radians). Pieces share the split vertex. */
function splitSharp(xy: number[], closed: boolean, maxTurn: number): { pieces: number[][]; corners: number[] } {
  const n = xy.length / 2;
  const cuts: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const ax = xy[2 * i] - xy[2 * i - 2];
    const ay = xy[2 * i + 1] - xy[2 * i - 1];
    const bx = xy[2 * i + 2] - xy[2 * i];
    const by = xy[2 * i + 3] - xy[2 * i + 1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    const c = (ax * bx + ay * by) / (la * lb);
    if (c < Math.cos(maxTurn)) cuts.push(i);
  }
  const corners = cuts.slice();
  if (closed && n > 2) {
    // closing vertex
    const ax = xy[2 * n - 2] - xy[2 * n - 4];
    const ay = xy[2 * n - 1] - xy[2 * n - 3];
    const bx = xy[2] - xy[0];
    const by = xy[3] - xy[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la > 1e-9 && lb > 1e-9 && (ax * bx + ay * by) / (la * lb) < Math.cos(maxTurn)) corners.push(0);
  }
  const pieces: number[][] = [];
  let start = 0;
  for (const c of cuts) {
    pieces.push(xy.slice(2 * start, 2 * c + 2));
    start = c;
  }
  pieces.push(xy.slice(2 * start));
  return { pieces: pieces.filter((p) => p.length >= 4), corners };
}

/**
 * If a closed polyline (first point == last point) has a sharp corner, rotate it
 * to start and end there so it can be drawn as an open stroke with joins.
 */
function openAtCorner(xy: number[], maxTurn: number): number[] | null {
  const n = xy.length / 2 - 1; // unique points
  if (n < 3) return null;
  let best = -1;
  let bestC = Math.cos(maxTurn);
  for (let i = 0; i < n; i++) {
    const ip = (i - 1 + n) % n;
    const inx = (i + 1) % n;
    const ax = xy[2 * i] - xy[2 * ip];
    const ay = xy[2 * i + 1] - xy[2 * ip + 1];
    const bx = xy[2 * inx] - xy[2 * i];
    const by = xy[2 * inx + 1] - xy[2 * i + 1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    const c = (ax * bx + ay * by) / (la * lb);
    if (c < bestC) {
      bestC = c;
      best = i;
    }
  }
  if (best < 0) return null;
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const i = (best + k) % n;
    out.push(xy[2 * i], xy[2 * i + 1]);
  }
  return out;
}

/** Closed polyline (first == last) → open polyline that overlaps itself a little past the seam. */
function overlapSeam(xy: number[], extra = 3): number[] {
  const out = xy.slice();
  const n = xy.length / 2;
  for (let k = 1; k <= Math.min(extra, n - 1); k++) out.push(xy[2 * k], xy[2 * k + 1]);
  return out;
}

/** Unit tangents (central differences) for a polyline. */
function tangents(xy: number[], closed: boolean): number[] {
  const n = xy.length / 2;
  const t = new Array<number>(xy.length);
  for (let i = 0; i < n; i++) {
    let i0 = i - 1;
    let i1 = i + 1;
    if (i0 < 0) i0 = closed ? n - 2 : 0;
    if (i1 > n - 1) i1 = closed ? 1 : n - 1;
    let dx = xy[2 * i1] - xy[2 * i0];
    let dy = xy[2 * i1 + 1] - xy[2 * i0 + 1];
    let l = Math.hypot(dx, dy);
    if (l < 1e-12) {
      dx = 1;
      dy = 0;
      l = 1;
    }
    t[2 * i] = dx / l;
    t[2 * i + 1] = dy / l;
  }
  return t;
}

function cumLength(xy: number[]): number[] {
  const n = xy.length / 2;
  const c = [0];
  for (let i = 1; i < n; i++) c.push(c[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]));
  return c;
}

type Cap = "round" | "butt" | "point" | "square";

/**
 * Perpendicular-offset outline with a width per vertex. Left edge forward,
 * end cap, right edge backward, start cap → clockwise on screen.
 */
function offsetStrip(xy: number[], w: number[], capStart: Cap, capEnd: Cap, closed = false): Poly[] {
  const n = xy.length / 2;
  const t = tangents(xy, closed);
  const L: number[] = [];
  const R: number[] = [];
  for (let i = 0; i < n; i++) {
    const nx = t[2 * i + 1];
    const ny = -t[2 * i];
    const h = w[i] / 2;
    L.push(xy[2 * i] + nx * h, xy[2 * i + 1] + ny * h);
    R.push(xy[2 * i] - nx * h, xy[2 * i + 1] - ny * h);
  }
  if (closed) {
    // Two rings: outer orientation positive, inner negative.
    const a = L.slice(0, L.length - 2);
    const b = reversePoly(R.slice(0, R.length - 2));
    const aa = Math.abs(area(a));
    const ab = Math.abs(area(b));
    const outer = aa >= ab ? a : b;
    const inner = aa >= ab ? b : a;
    return [cw(outer), reversePoly(cw(inner))];
  }
  const poly: Poly = [];
  for (let i = 0; i < n; i++) poly.push(L[2 * i], L[2 * i + 1]);
  capPoints(poly, xy, t, w, n - 1, capEnd, false);
  for (let i = n - 1; i >= 0; i--) poly.push(R[2 * i], R[2 * i + 1]);
  capPoints(poly, xy, t, w, 0, capStart, true);
  return [poly];
}

function capPoints(poly: Poly, xy: number[], t: number[], w: number[], i: number, cap: Cap, start: boolean): void {
  const h = w[i] / 2;
  const tx = t[2 * i] * (start ? -1 : 1);
  const ty = t[2 * i + 1] * (start ? -1 : 1);
  const px = xy[2 * i];
  const py = xy[2 * i + 1];
  if (cap === "round") {
    // From left side around the tip to the right side (end) / right to left (start).
    const nx = start ? -ty : ty;
    const ny = start ? tx : -tx;
    // Points between normal side and opposite through the tangent direction.
    const m = Math.max(4, Math.ceil(h * 120));
    for (let k = 1; k < m; k++) {
      const a = (k / m) * Math.PI;
      // start at +normal (left), sweep through tangent to -normal
      const cx = Math.cos(a);
      const sx = Math.sin(a);
      poly.push(px + (nx * cx + tx * sx) * h, py + (ny * cx + ty * sx) * h);
    }
  } else if (cap === "point") {
    poly.push(px + tx * h * 1.1, py + ty * h * 1.1);
  } else if (cap === "square") {
    const nx = start ? -ty : ty;
    const ny = start ? tx : -tx;
    poly.push(px + (nx + tx) * h, py + (ny + ty) * h, px + (-nx + tx) * h, py + (-ny + ty) * h);
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface Ctx {
  style: ScriptStyle;
  W: number; // nib width (em)
  out: Poly[];
  seed: number;
}

function hashf(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Broad-nib Minkowski outline of one smooth piece. */
function penPiece(xy: number[], ctx: Ctx, nibScale = 1, hairExtra = 0): void {
  const a = ctx.style.nibAngle;
  const W = ctx.W * nibScale;
  const hx = (Math.cos(a) * W) / 2;
  const hy = (-Math.sin(a) * W) / 2;
  const hair = Math.max(0.006, ctx.W * (1 - ctx.style.contrast) * 0.55 + hairExtra);
  const n = xy.length / 2;
  const t = tangents(xy, false);
  // Split where the nib side flips.
  let start = 0;
  const side = (i: number): number => {
    const Lx = t[2 * i + 1];
    const Ly = -t[2 * i];
    const d = hx * Lx + hy * Ly;
    return d >= 0 ? 1 : -1;
  };
  let s0 = side(0);
  const emit = (i0: number, i1: number, sg: number): void => {
    const A: number[] = [];
    const B: number[] = [];
    for (let i = i0; i <= i1; i++) {
      const Lx = t[2 * i + 1];
      const Ly = -t[2 * i];
      const px = xy[2 * i];
      const py = xy[2 * i + 1];
      A.push(px + sg * hx + (Lx * hair) / 2, py + sg * hy + (Ly * hair) / 2);
      B.push(px - sg * hx - (Lx * hair) / 2, py - sg * hy - (Ly * hair) / 2);
    }
    const poly: Poly = A.slice();
    for (let i = B.length - 2; i >= 0; i -= 2) poly.push(B[i], B[i + 1]);
    ctx.out.push(poly);
  };
  for (let i = 1; i < n; i++) {
    const s = side(i);
    if (s !== s0) {
      emit(start, Math.min(n - 1, i), s0);
      start = i - 1;
      s0 = s;
    }
  }
  emit(start, n - 1, s0);
}

function brushWidths(cl: number[], total: number, xy: number[], ctx: Ctx, closed: boolean, salt: number): number[] {
  const st = ctx.style;
  const n = cl.length;
  const t = tangents(xy, closed);
  const w: number[] = [];
  const taper = st.taper;
  const r1 = hashf(salt) - 0.5;
  const r2 = hashf(salt + 7) - 0.5;
  const nx = Math.cos(st.nibAngle);
  const ny = -Math.sin(st.nibAngle);
  for (let i = 0; i < n; i++) {
    const u = total > 0 ? cl[i] / total : 0;
    const sAbs = cl[i];
    const sEnd = total - cl[i];
    let f = 1;
    if (!closed) {
      // press-in: quick swell over the first ~0.06 em
      const inL = Math.min(0.08, total * 0.3);
      f *= 0.62 + 0.48 * Math.min(1, sAbs / inL) - 0.1 * Math.max(0, Math.min(1, (sAbs - inL) / inL));
      // lift: taper over the last part
      const outL = Math.min(total * 0.55, 0.06 + 0.22 * taper);
      if (sEnd < outL) {
        const k = sEnd / outL;
        f *= (1 - taper * 0.85) + taper * 0.85 * Math.pow(k, 0.7);
      }
    }
    // gentle irregular swelling along the stroke
    f *= 1 + 0.07 * Math.sin(u * 5.1 + r1 * 6) + 0.05 * r2;
    // direction bias like an angled brush
    const cr = Math.abs(t[2 * i] * ny - t[2 * i + 1] * nx);
    const g = 1 - st.contrast * 0.55 * (1 - cr);
    w.push(Math.max(0.006, ctx.W * f * g));
  }
  return w;
}

function joinBlob(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.out.push(circlePoly(x, y, r, 14));
}

function strokeBrush(xy: number[], closed: boolean, ctx: Ctx, salt: number): void {
  if (closed) {
    const o = openAtCorner(xy, 0.7);
    if (o) {
      strokeBrushOpen(o, ctx, salt, "loop");
      return;
    }
    strokeBrushOpen(xy, ctx, salt, "ring");
    return;
  }
  strokeBrushOpen(xy, ctx, salt, "open");
}

function strokeBrushOpen(xy: number[], ctx: Ctx, salt: number, mode: "open" | "ring" | "loop"): void {
  const cl = cumLength(xy);
  const total = cl[cl.length - 1];
  const w = brushWidths(cl, total, xy, ctx, mode !== "open", salt);
  if (mode === "ring") {
    const o = overlapSeam(xy);
    const wo = w.concat(w.slice(1, 1 + (o.length - xy.length) / 2));
    ctx.out.push(...offsetStrip(o, wo, "butt", "butt"));
    return;
  }
  const { pieces, corners } = splitSharp(xy, false, 0.7);
  let k = 0;
  const endCap: Cap = mode === "loop" ? "butt" : "round";
  for (let pi = 0; pi < pieces.length; pi++) {
    const p = pieces[pi];
    const m = p.length / 2;
    const wp = w.slice(k, k + m);
    k += m - 1;
    ctx.out.push(...offsetStrip(p, wp, pi === 0 ? endCap : "butt", pi === pieces.length - 1 ? endCap : "butt"));
  }
  for (const c of corners) joinBlob(ctx, xy[2 * c], xy[2 * c + 1], w[c] * 0.56);
  if (mode === "loop") joinBlob(ctx, xy[0], xy[1], w[0] * 0.56);
}

function strokeMono(xy: number[], closed: boolean, ctx: Ctx, width: number, cap: Cap, flare: number): void {
  if (closed) {
    const o = openAtCorner(xy, 0.6);
    if (o) {
      strokeMonoOpen(o, false, ctx, width, "butt", 0);
      if (cap === "round") joinBlob(ctx, o[0], o[1], width / 2);
      else miterJoinClosed(ctx, o, width);
      return;
    }
  }
  strokeMonoOpen(xy, closed, ctx, width, cap, flare);
}

function miterJoinClosed(ctx: Ctx, o: number[], width: number): void {
  // Corner at o[0] == o[last]: previous point is o[last-1], next is o[1].
  const n = o.length / 2;
  const tmp = [o[2 * n - 4], o[2 * n - 3], o[0], o[1], o[2], o[3]];
  miterJoin(ctx, tmp, 1, width);
}

function strokeMonoOpen(xy: number[], closed: boolean, ctx: Ctx, width: number, cap: Cap, flare: number): void {
  const cl = cumLength(xy);
  const total = cl[cl.length - 1];
  const w = cl.map((s) => {
    if (closed || flare <= 0) return width;
    const d = Math.min(s, total - s);
    const fl = Math.max(0, 1 - d / (width * 2.4));
    return width * (1 + flare * 0.85 * fl * fl);
  });
  if (closed) {
    const o = overlapSeam(xy);
    ctx.out.push(...offsetStrip(o, o.map(() => width).slice(0, o.length / 2), "butt", "butt"));
    return;
  }
  const { pieces, corners } = splitSharp(xy, false, 0.6);
  let k = 0;
  for (let pi = 0; pi < pieces.length; pi++) {
    const p = pieces[pi];
    const m = p.length / 2;
    const wp = w.slice(k, k + m);
    k += m - 1;
    const first = pi === 0;
    const last = pi === pieces.length - 1;
    ctx.out.push(...offsetStrip(p, wp, first ? cap : "butt", last ? cap : "butt"));
  }
  for (const c of corners) {
    if (cap === "round") joinBlob(ctx, xy[2 * c], xy[2 * c + 1], w[c] / 2);
    else miterJoin(ctx, xy, c, w[c]);
  }
}

function miterJoin(ctx: Ctx, xy: number[], i: number, width: number): void {
  const px = xy[2 * i];
  const py = xy[2 * i + 1];
  const ax = px - xy[2 * i - 2];
  const ay = py - xy[2 * i - 1];
  const bx = xy[2 * i + 2] - px;
  const by = xy[2 * i + 3] - py;
  const la = Math.hypot(ax, ay) || 1;
  const lb = Math.hypot(bx, by) || 1;
  const d1x = ax / la;
  const d1y = ay / la;
  const d2x = bx / lb;
  const d2y = by / lb;
  const h = width / 2;
  const n1x = d1y;
  const n1y = -d1x;
  const n2x = d2y;
  const n2y = -d2x;
  const pts: P[] = [
    [px + n1x * h, py + n1y * h],
    [px - n1x * h, py - n1y * h],
    [px + n2x * h, py + n2y * h],
    [px - n2x * h, py - n2y * h],
  ];
  // miter tip on the outer side
  const bisx = d1x - d2x;
  const bisy = d1y - d2y;
  const bl = Math.hypot(bisx, bisy);
  const cosHalf = Math.sqrt(Math.max(0, (1 + (d1x * -d2x + d1y * -d2y)) / 2)); // half of interior angle
  if (bl > 1e-6 && cosHalf > 0.25) {
    const sinHalf = Math.sqrt(1 - cosHalf * cosHalf);
    const m = Math.min(h / Math.max(0.2, sinHalf), h * 2.2);
    pts.push([px + (bisx / bl) * m, py + (bisy / bl) * m]);
  }
  ctx.out.push(convexHull(pts));
}

function convexHull(pts: P[]): Poly {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const out: Poly = [];
  for (const q of hull) out.push(q[0], q[1]);
  return cw(out);
}

/** Straight runs of an angularised centre-line (curves become a few chords, as when cut or pressed). */
function straightRuns(st: Stroke): P[][] {
  const raw = sampleRaw(st, 0.01).xy;
  const simp = simplify(raw, 0.05);
  const runs: P[][] = [];
  for (let i = 0; i + 3 < simp.length; i += 2) runs.push([[simp[i], simp[i + 1]], [simp[i + 2], simp[i + 3]]]);
  // Very long gentle curves: split chords longer than 0.55 em that deviate from the curve.
  return runs;
}

function knifeCut(ctx: Ctx, a: P, b: P, salt: number, extend: number): void {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return;
  dx /= L;
  dy /= L;
  const ax = a[0] - dx * extend;
  const ay = a[1] - dy * extend;
  const LL = L + 2 * extend;
  const W = ctx.W * (0.92 + 0.16 * hashf(salt));
  const nx = dy;
  const ny = -dx;
  const m = 8;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i <= m; i++) {
    const u = i / m;
    const s = u * LL;
    const inT = Math.min(1, s / Math.min(LL * 0.3, W * 1.4));
    const outT = Math.min(1, (LL - s) / Math.min(LL * 0.35, W * 2.2));
    const f = Math.pow(Math.max(0, inT), 0.55) * Math.pow(Math.max(0, outT), 0.7);
    const h = (W / 2) * Math.max(0.04, f);
    const px = ax + dx * s;
    const py = ay + dy * s;
    left.push(px + nx * h, py + ny * h);
    right.push(px - nx * h, py - ny * h);
  }
  const poly = left.slice();
  for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
  ctx.out.push(poly);
}

function wedge(ctx: Ctx, a: P, b: P, salt: number, small = false): void {
  // Orient so the head is at the upper-left end (impressions point right/down).
  let p0 = a;
  let p1 = b;
  if (b[0] + b[1] * 1.15 < a[0] + a[1] * 1.15) {
    p0 = b;
    p1 = a;
  }
  let dx = p1[0] - p0[0];
  let dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return;
  dx /= L;
  dy /= L;
  const nx = dy;
  const ny = -dx;
  const Hw = ctx.W * (small ? 0.8 : 1.0) * (0.93 + 0.14 * hashf(salt));
  const Hl = Math.min(Hw * 1.0, L * 0.6);
  const t0 = Hw * 0.26;
  const t1 = Hw * 0.08;
  const sx = p0[0] - dx * Hw * 0.15;
  const sy = p0[1] - dy * Hw * 0.15;
  const pt = (u: number, v: number): [number, number] => [sx + dx * u + nx * v, sy + dy * u + ny * v];
  const LL = L + Hw * 0.15;
  const pts: [number, number][] = [
    pt(0, Hw / 2),
    pt(Hl * 0.5, Hw * 0.3),
    pt(Hl, t0 / 2),
    pt(LL * 0.9, t1 * 0.7),
    pt(LL, 0),
    pt(LL * 0.9, -t1 * 0.7),
    pt(Hl, -t0 / 2),
    pt(Hl * 0.5, -Hw * 0.3),
    pt(0, -Hw / 2),
    pt(Hw * 0.12, 0),
  ];
  const poly: Poly = [];
  for (const q of pts) poly.push(q[0], q[1]);
  ctx.out.push(cw(poly));
}

function winkelhaken(ctx: Ctx, x: number, y: number, r: number, salt: number): void {
  const Hw = Math.max(r * 2.4, ctx.W * 1.25) * (0.95 + 0.1 * hashf(salt));
  // A "<" impression (Winkelhaken): apex at left, notched back.
  const pts: P[] = [
    [x - Hw * 0.5, y],
    [x + Hw * 0.42, y - Hw * 0.46],
    [x + Hw * 0.2, y],
    [x + Hw * 0.42, y + Hw * 0.46],
  ];
  const poly: Poly = [];
  for (const q of pts) poly.push(q[0], q[1]);
  ctx.out.push(cw(poly));
}

function renderDot(st: Stroke, ctx: Ctx, salt: number): void {
  const [x, y] = st.pts[0];
  const r0 = st.dot ?? 0.05;
  const tool = ctx.style.tool;
  const W = ctx.W;
  switch (tool) {
    case "pen": {
      const a = ctx.style.nibAngle;
      // A short diagonal pull (between square to the nib and straight down) makes a rhombus, like a calligrapher's dot.
      const len = Math.max(r0 * 1.4, W * 0.95);
      let dx = Math.sin(a);
      let dy = 1 + Math.cos(a);
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const ux = dx * len * 0.5;
      const uy = dy * len * 0.5;
      penPiece([x - ux, y - uy, x, y, x + ux, y + uy], ctx, Math.max(0.85, Math.min(1.1, (r0 * 2.6) / W)), W * 0.25);
      break;
    }
    case "reed": {
      const a = ctx.style.nibAngle;
      const len = Math.max(r0 * 1.2, W * 0.6);
      const ux = Math.sin(a) * len * 0.5;
      const uy = Math.cos(a) * len * 0.5;
      penPiece([x - ux, y - uy, x + ux, y + uy], ctx, Math.max(0.6, Math.min(1, (r0 * 2.2) / W)));
      ctx.out.push(circlePoly(x, y, Math.max(r0, W * 0.38)));
      break;
    }
    case "brush": {
      const r = Math.max(r0, W * 0.55);
      ctx.out.push(ellipsePoly(x, y, r * 1.18, r * 0.86, -ctx.style.nibAngle + 0.3 * (hashf(salt) - 0.5)));
      break;
    }
    case "stylus":
      winkelhaken(ctx, x, y, r0, salt);
      break;
    case "knife": {
      const r = Math.max(r0, W * 0.9);
      knifeCut(ctx, [x - r * 0.25, y - r * 0.7], [x + r * 0.25, y + r * 0.7], salt, 0);
      break;
    }
    case "chisel": {
      const r = Math.max(r0, W * 0.62);
      ctx.out.push(circlePoly(x, y, r));
      break;
    }
    default: {
      ctx.out.push(circlePoly(x, y, Math.max(r0, W * 0.62)));
    }
  }
}

/** Corner-rounding radius (em) for a style. */
export function cornerRadius(style: ScriptStyle): number {
  switch (style.tool) {
    case "knife":
    case "stylus":
      return 0;
    case "chisel":
      return style.cornering * 0.1;
    case "needle":
      return 0.03 + style.cornering * 0.16;
    case "brush":
      return 0.02 + style.cornering * 0.16;
    default:
      return style.cornering * 0.17;
  }
}

/**
 * Outline polygons (em units) for a set of strokes rendered with a style.
 * `weightScale` thins or thickens everything (used for small marks).
 */
export function outlinePolys(strokes: Stroke[], style: ScriptStyle, seed = 0, weightScale = 1): number[][] {
  const ctx: Ctx = { style, W: style.weight * weightScale, out: [], seed };
  const cr = cornerRadius(style);
  strokes.forEach((st, si) => {
    const salt = seed * 31 + si * 7919;
    const sw = st.w ?? 1;
    const W0 = ctx.W;
    ctx.W = W0 * sw;
    if (st.dot !== undefined) {
      renderDot(st, ctx, salt);
      ctx.W = W0;
      return;
    }
    if (st.pts.length < 2) {
      ctx.W = W0;
      return;
    }
    switch (style.tool) {
      case "pen":
      case "reed": {
        let xy = sampleStroke(st, cr, 0.012);
        if (st.closed) xy = overlapSeam(xy, 2);
        const { pieces } = splitSharp(xy, false, 0.5);
        const reed = style.tool === "reed";
        for (const p of pieces) penPiece(p, ctx, reed ? 0.82 : 1, reed ? ctx.W * 0.12 : 0);
        if (reed) {
          // Round monoline core gives soft terminals and corners.
          strokeMono(xy, false, ctx, ctx.W * 0.5, "round", 0);
        }
        break;
      }
      case "brush": {
        const xy = sampleStroke(st, cr, 0.012);
        strokeBrush(xy, !!st.closed, ctx, salt);
        break;
      }
      case "needle": {
        const xy = sampleStroke(st, cr, 0.012);
        strokeMono(xy, !!st.closed, ctx, ctx.W, "round", 0);
        break;
      }
      case "chisel": {
        const xy = sampleStroke(st, cr, 0.012);
        strokeMono(xy, !!st.closed, ctx, ctx.W, "butt", style.serif);
        break;
      }
      case "knife": {
        const runs = straightRuns(st);
        runs.forEach((r, k) => knifeCut(ctx, r[0], r[1], salt + k, ctx.W * 0.35));
        break;
      }
      case "stylus": {
        const runs = straightRuns(st);
        runs.forEach((r, k) => wedge(ctx, r[0], r[1], salt + k, st.w !== undefined && st.w < 1));
        break;
      }
    }
    ctx.W = W0;
  });
  return ctx.out;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function simplify(p: Poly, tol: number): Poly {
  const n = p.length / 2;
  if (n <= 4) return p;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const ax = p[2 * i0];
    const ay = p[2 * i0 + 1];
    const bx = p[2 * i1];
    const by = p[2 * i1 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let best = -1;
    let bd = tol2;
    for (let i = i0 + 1; i < i1; i++) {
      let t = l2 > 0 ? ((p[2 * i] - ax) * dx + (p[2 * i + 1] - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - p[2 * i];
      const ey = ay + dy * t - p[2 * i + 1];
      const d = ex * ex + ey * ey;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  const out: Poly = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}

const fmt = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * SVG path data for polygons. Coordinates are multiplied by `unit`
 * (default 100: one em = 100 user units), rounded to 0.1, relative moves.
 */
export function polysToPath(polys: number[][], unit = 100, tolEm = 0.0011, ox = 0, oy = 0): string {
  const parts: string[] = [];
  for (const p0 of polys) {
    if (p0.length < 6) continue;
    const p = simplify(p0, tolEm);
    if (p.length < 6) continue;
    let px = Math.round((p[0] + ox) * unit * 10) / 10;
    let py = Math.round((p[1] + oy) * unit * 10) / 10;
    const seg: string[] = [`M${fmt(px)} ${fmt(py)}l`];
    const nums: string[] = [];
    for (let i = 2; i < p.length; i += 2) {
      const x = Math.round((p[i] + ox) * unit * 10) / 10;
      const y = Math.round((p[i + 1] + oy) * unit * 10) / 10;
      const dx = x - px;
      const dy = y - py;
      if (dx === 0 && dy === 0) continue;
      nums.push(fmt(dx), fmt(dy));
      px = x;
      py = y;
    }
    if (nums.length < 4) continue;
    seg.push(nums.join(" ").replace(/ -/g, "-"));
    parts.push(seg.join("") + "z");
  }
  return parts.join("");
}
