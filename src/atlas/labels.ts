/**
 * Cartographic label placement: text laid out glyph by glyph along curves,
 * per-glyph collision boxes in a spatial index, candidate generation for
 * point, line and area labels, and greedy placement by priority with costs.
 * Pure (text measurement is injected).
 */
import type { Pt } from "./contour";
import type { Measure } from "./model";
import { font as cssFont } from "./style";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextStyle {
  size: number;
  italic?: boolean;
  sc?: boolean;
  /** Extra letter spacing in em. */
  spacing: number;
  color: string;
  /** Halo colour (paper) or "" for none. */
  halo: string;
  haloWidth: number;
  opacity?: number;
  /** Uppercase the text. */
  caps?: boolean;
}

export interface PlacedGlyph {
  ch: string;
  x: number;
  y: number;
  /** Rotation, radians. */
  a: number;
}

export type LabelKind =
  | "realm" | "ocean" | "sea" | "lake" | "bay" | "river" | "range" | "region" | "island"
  | "capital" | "city" | "town" | "village" | "ruin" | "battle" | "note";

export interface PlacedLabel {
  id: string;
  kind: LabelKind;
  text: string;
  style: TextStyle;
  font: string;
  glyphs: PlacedGlyph[];
  boxes: Box[];
  /** Referenced entity for hit-testing (e.g. { type: "settlement", id }). */
  ref?: { type: string; id: number };
}

export function styleFont(st: TextStyle): string {
  return cssFont(st.size, { italic: st.italic, sc: st.sc });
}

export function displayText(text: string, st: TextStyle): string {
  return st.caps ? text.toLocaleUpperCase() : text;
}

/** Spatial index of boxes. */
export class BoxIndex {
  private cells = new Map<number, Box[]>();
  constructor(readonly cell = 32) {}
  private key(i: number, j: number): number {
    return (j + 1024) * 4096 + (i + 1024);
  }
  add(b: Box): void {
    const c = this.cell;
    for (let j = Math.floor(b.y0 / c); j <= Math.floor(b.y1 / c); j++)
      for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++) {
        const k = this.key(i, j);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(b);
      }
  }
  hits(b: Box, pad = 0): boolean {
    const c = this.cell;
    for (let j = Math.floor((b.y0 - pad) / c); j <= Math.floor((b.y1 + pad) / c); j++)
      for (let i = Math.floor((b.x0 - pad) / c); i <= Math.floor((b.x1 + pad) / c); i++) {
        const arr = this.cells.get(this.key(i, j));
        if (!arr) continue;
        for (const o of arr) if (b.x0 - pad < o.x1 && b.x1 + pad > o.x0 && b.y0 - pad < o.y1 && b.y1 + pad > o.y0) return true;
      }
    return false;
  }
  /** All boxes intersecting b. */
  query(b: Box): Box[] {
    const out = new Set<Box>();
    const c = this.cell;
    for (let j = Math.floor(b.y0 / c); j <= Math.floor(b.y1 / c); j++)
      for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++) {
        const arr = this.cells.get(this.key(i, j));
        if (!arr) continue;
        for (const o of arr) if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) out.add(o);
      }
    return [...out];
  }
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

export interface Layout {
  glyphs: PlacedGlyph[];
  boxes: Box[];
  /** Max turn between consecutive glyphs (radians). */
  maxTurn: number;
}

/** Advance widths of the characters of `text` (with letter spacing). */
export function advances(measure: Measure, fnt: string, text: string, spacingPx: number): { chars: string[]; w: number[]; total: number } {
  const chars = Array.from(text);
  const w = chars.map((c) => measure(fnt, c));
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i] + (i < w.length - 1 ? spacingPx : 0);
  return { chars, w, total };
}

function cumulative(path: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return cum;
}

function pointAt(path: Pt[], cum: number[], s: number): { x: number; y: number; a: number } {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = path[lo], b = path[hi];
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  // tangent from a wider window for smoothness
  const ia = Math.max(0, lo - 1), ib = Math.min(path.length - 1, hi + 1);
  const ang = Math.atan2(path[ib][1] - path[ia][1], path[ib][0] - path[ia][0]);
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, a: ang };
}

/** Make a path read left to right. */
export function readable(path: Pt[]): Pt[] {
  if (path.length < 2) return path;
  const a = path[0], b = path[path.length - 1];
  return b[0] < a[0] ? path.slice().reverse() : path;
}

/**
 * Lay text along a path, centred at arc length `centerS` (default: middle).
 * The path is the text's visual centre line. Returns null if it does not fit.
 */
export function layoutOnPath(path: Pt[], adv: { chars: string[]; w: number[]; total: number }, spacingPx: number, size: number, centerS?: number): Layout | null {
  const cum = cumulative(path);
  const L = cum[cum.length - 1];
  if (adv.total > L) return null;
  const c = centerS ?? L / 2;
  let s = c - adv.total / 2;
  if (s < 0 || s + adv.total > L + 0.01) return null;
  const glyphs: PlacedGlyph[] = [];
  const boxes: Box[] = [];
  let prevA: number | null = null;
  let maxTurn = 0;
  const hh = size * 0.36;
  for (let i = 0; i < adv.chars.length; i++) {
    const w = adv.w[i];
    const p = pointAt(path, cum, s + w / 2);
    if (prevA !== null) {
      let d = Math.abs(p.a - prevA);
      if (d > Math.PI) d = 2 * Math.PI - d;
      maxTurn = Math.max(maxTurn, d);
    }
    prevA = p.a;
    glyphs.push({ ch: adv.chars[i], x: p.x, y: p.y, a: p.a });
    if (adv.chars[i].trim() !== "") {
      const ca = Math.abs(Math.cos(p.a)), sa = Math.abs(Math.sin(p.a));
      const hw = (w / 2) * ca + hh * sa, hv = (w / 2) * sa + hh * ca;
      boxes.push({ x0: p.x - hw, y0: p.y - hv, x1: p.x + hw, y1: p.y + hv });
    }
    s += w + spacingPx;
  }
  return { glyphs, boxes, maxTurn };
}

/** Straight horizontal layout with the text's visual centre at (cx, cy). */
export function layoutStraight(cx: number, cy: number, adv: { chars: string[]; w: number[]; total: number }, spacingPx: number, size: number): Layout {
  const path: Pt[] = [[cx - adv.total / 2 - 1, cy], [cx + adv.total / 2 + 1, cy]];
  return layoutOnPath(path, adv, spacingPx, size)!;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface Candidate {
  layout: Layout;
  cost: number;
}

export class LabelPlacer {
  readonly placed: PlacedLabel[] = [];
  readonly labels = new BoxIndex(24);
  readonly hard = new BoxIndex(24);
  constructor(readonly bounds: Box, readonly measure: Measure) {}

  /** Reserve an area no label may enter (cartouche, compass, …). */
  reserve(b: Box): void {
    this.hard.add(b);
  }

  fits(layout: Layout, pad: number): boolean {
    const B = this.bounds;
    for (const b of layout.boxes) {
      if (b.x0 < B.x0 || b.y0 < B.y0 || b.x1 > B.x1 || b.y1 > B.y1) return false;
      if (this.hard.hits(b, 0)) return false;
      if (this.labels.hits(b, pad)) return false;
    }
    return true;
  }

  /** Choose the cheapest fitting candidate; returns the placed label or null. */
  place(id: string, kind: LabelKind, text: string, style: TextStyle, cands: Candidate[], pad: number, ref?: PlacedLabel["ref"]): PlacedLabel | null {
    cands.sort((a, b) => a.cost - b.cost);
    for (const c of cands) {
      if (!this.fits(c.layout, pad)) continue;
      const pl: PlacedLabel = { id, kind, text, style, font: styleFont(style), glyphs: c.layout.glyphs, boxes: c.layout.boxes, ref };
      for (const b of c.layout.boxes) this.labels.add(b);
      this.placed.push(pl);
      return pl;
    }
    return null;
  }

  /** Register a non-label obstacle (e.g. a settlement icon) that labels must avoid. */
  obstacle(b: Box): void {
    this.labels.add(b);
  }
}

/** Positions around a point symbol, in order of cartographic preference. */
export const POINT_POSITIONS: [number, number, number][] = [
  // dx sign, dy sign, cost
  [1, 0, 0],
  [-1, 0, 0.6],
  [1, -1, 0.9],
  [1, 1, 1.0],
  [0, -1, 1.2],
  [0, 1, 1.4],
  [-1, -1, 1.5],
  [-1, 1, 1.6],
];

/** Candidate layouts for a label beside a point symbol of radius r. */
export function pointCandidates(measure: Measure, x: number, y: number, r: number, text: string, st: TextStyle): Candidate[] {
  const fnt = styleFont(st);
  const t = displayText(text, st);
  const sp = st.spacing * st.size;
  const adv = advances(measure, fnt, t, sp);
  const out: Candidate[] = [];
  const gap = 2 + st.size * 0.15;
  const hh = st.size * 0.42;
  for (const [sx, sy, cost] of POINT_POSITIONS) {
    let cx = x, cy = y;
    if (sx !== 0) cx = x + sx * (r + gap + adv.total / 2);
    if (sy !== 0) cy = y + sy * (r + gap * 0.5 + hh);
    if (sx !== 0 && sy !== 0) {
      cx = x + sx * (r * 0.7 + gap * 0.5 + adv.total / 2);
      cy = y + sy * (r * 0.7 + hh);
    }
    out.push({ layout: layoutStraight(cx, cy, adv, sp, st.size), cost });
  }
  return out;
}

/** Sub-path of a polyline between arc lengths s0 and s1. */
export function subPath(path: Pt[], s0: number, s1: number): Pt[] {
  const cum = cumulative(path);
  const out: Pt[] = [];
  const a = pointAt(path, cum, s0);
  out.push([a.x, a.y]);
  for (let i = 0; i < path.length; i++) if (cum[i] > s0 && cum[i] < s1) out.push(path[i]);
  const b = pointAt(path, cum, s1);
  out.push([b.x, b.y]);
  return out;
}

/** Offset a polyline by d along its left normal (screen coords; negative = right). */
export function offsetPath(path: Pt[], d: number): Pt[] {
  const m = path.length;
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(m - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    // screen "up" side for a left-to-right path is the normal (dy, -dx)
    return [p[0] + (dy / L) * d, p[1] + (-dx / L) * d] as Pt;
  });
}

/** Resample a polyline to roughly uniform spacing and smooth it (moving average). */
export function smoothPath(path: Pt[], spacing: number, passes = 3): Pt[] {
  const cum = cumulative(path);
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / spacing));
  let pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const p = pointAt(path, cum, (i / n) * L);
    pts.push([p.x, p.y]);
  }
  for (let q = 0; q < passes; q++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const a = pts[i - 1], b = pts[i + 1];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as Pt;
    });
  }
  return pts;
}

export function pathLength(path: Pt[]): number {
  const c = cumulative(path);
  return c[c.length - 1];
}

/** Quadratic curve through three points, sampled. */
export function quadPath(a: Pt, c: Pt, b: Pt, n = 24): Pt[] {
  // c is the midpoint the curve passes through; control = 2c - (a+b)/2
  const cx = 2 * c[0] - (a[0] + b[0]) / 2, cy = 2 * c[1] - (a[1] + b[1]) / 2;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return out;
}

/**
 * Principal-axis analysis of a point set (screen coords): centroid, major axis
 * unit vector, and the spine (mean minor offset per slice along the axis,
 * fitted with a parabola).
 */
export interface AreaAxis {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  /** Extent along the axis (min/max u). */
  u0: number;
  u1: number;
  /** Parabola coefficients for the spine: v(u) = a + b u + c u². */
  a: number;
  b: number;
  c: number;
  /** Typical half-thickness across the axis. */
  half: number;
  count: number;
}

export function areaAxis(xs: ArrayLike<number>, ys: ArrayLike<number>): AreaAxis | null {
  const n = xs.length;
  if (n < 3) return null;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += xs[i]; cy += ys[i]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(th), uy = Math.sin(th);
  // Labels should not be steeper than ~40°: blend towards horizontal.
  const maxA = (40 * Math.PI) / 180;
  let ang = Math.atan2(uy, ux);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  ang = Math.max(-maxA, Math.min(maxA, ang));
  ux = Math.cos(ang); uy = Math.sin(ang);
  const vx = -uy, vy = ux;
  let u0 = Infinity, u1 = -Infinity;
  const us = new Float64Array(n), vs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    us[i] = dx * ux + dy * uy;
    vs[i] = dx * vx + dy * vy;
    if (us[i] < u0) u0 = us[i];
    if (us[i] > u1) u1 = us[i];
  }
  // Least-squares parabola v(u) over slice means.
  const bins = 14;
  const sum = new Float64Array(bins), cnt = new Float64Array(bins), sq = new Float64Array(bins);
  const span = u1 - u0 || 1;
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.floor(((us[i] - u0) / span) * bins));
    sum[b] += vs[i];
    sq[b] += vs[i] * vs[i];
    cnt[b]++;
  }
  // Normal equations for weighted fit.
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0, halfAcc = 0;
  for (let b = 0; b < bins; b++) {
    if (!cnt[b]) continue;
    const u = u0 + ((b + 0.5) / bins) * span;
    const v = sum[b] / cnt[b];
    const w = cnt[b];
    S0 += w; S1 += w * u; S2 += w * u * u; S3 += w * u ** 3; S4 += w * u ** 4;
    T0 += w * v; T1 += w * v * u; T2 += w * v * u * u;
    const varb = sq[b] / cnt[b] - v * v;
    halfAcc += w * Math.sqrt(Math.max(0, varb));
  }
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const D = det(M);
  let a = T0 / S0, bb = 0, c = 0;
  if (Math.abs(D) > 1e-9) {
    a = det([[T0, S1, S2], [T1, S2, S3], [T2, S3, S4]]) / D;
    bb = det([[S0, T0, S2], [S1, T1, S3], [S2, T2, S4]]) / D;
    c = det([[S0, S1, T0], [S1, S2, T1], [S2, S3, T2]]) / D;
  }
  // Keep the curve gentle.
  const maxC = 0.6 / Math.max(1, span);
  c = Math.max(-maxC, Math.min(maxC, c));
  return { cx, cy, ux, uy, u0, u1, a, b: bb, c, half: (halfAcc / S0) * 1.7, count: n };
}

/** Sample the spine of an area axis between u-fractions f0..f1, shifted by dv. */
export function spinePath(ax: AreaAxis, f0: number, f1: number, dv = 0, n = 28): Pt[] {
  const out: Pt[] = [];
  const vx = -ax.uy, vy = ax.ux;
  for (let i = 0; i <= n; i++) {
    const u = ax.u0 + (ax.u1 - ax.u0) * (f0 + (f1 - f0) * (i / n));
    const v = ax.a + ax.b * u + ax.c * u * u + dv;
    out.push([ax.cx + ax.ux * u + vx * v, ax.cy + ax.uy * u + vy * v]);
  }
  return readable(out);
}
