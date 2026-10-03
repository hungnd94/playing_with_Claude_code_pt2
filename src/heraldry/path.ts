/**
 * Small, dependency-free 2D path toolkit used by the charge artwork and the
 * renderers: number formatting, SVG path parsing / sampling / bounding boxes,
 * smooth closed and open curves through points, tapered "limbs", and point
 * transforms. DOM-free.
 */

export type Pt = [number, number];
/** A spline control point; a third element of 1 marks a sharp corner. */
export type SPt = [number, number] | [number, number, number];

/** Format a number compactly for SVG output (≤ 2 decimals). */
export function f(x: number): string {
  const r = Math.round(x * 100) / 100;
  if (Object.is(r, -0) || r === 0) return "0";
  return String(r);
}
/** Format with 1 decimal (for densely sampled paths). */
export function f1(x: number): string {
  const r = Math.round(x * 10) / 10;
  if (Object.is(r, -0) || r === 0) return "0";
  return String(r);
}

export function polyD(pts: readonly Pt[], close = true, prec: (x: number) => string = f1): string {
  if (pts.length === 0) return "";
  let s = `M${prec(pts[0][0])} ${prec(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) s += `L${prec(pts[i][0])} ${prec(pts[i][1])}`;
  return close ? s + "Z" : s;
}

export function circleD(cx: number, cy: number, r: number): string {
  // clockwise (in SVG's y-down space), matching blob() and polygons built by increasing angle
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 1 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 1 ${f(-2 * r)} 0Z`;
}

export function ellipseD(cx: number, cy: number, rx: number, ry: number, rotDeg = 0, n = 0): string {
  if (rotDeg === 0 && n === 0) {
    return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 1 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 1 ${f(-2 * rx)} 0Z`;
  }
  const pts: Pt[] = [];
  const N = n || 48;
  const c = Math.cos((rotDeg * Math.PI) / 180);
  const s = Math.sin((rotDeg * Math.PI) / 180);
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return polyD(pts);
}

// ---------------------------------------------------------------------------
// Smooth curves

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

function tangentAt(prev: SPt, cur: SPt, next: SPt): Pt {
  const a = norm(sub([cur[0], cur[1]], [prev[0], prev[1]]));
  const b = norm(sub([next[0], next[1]], [cur[0], cur[1]]));
  return norm(add(a, b));
}

/**
 * Smooth curve through points (length-scaled Catmull-Rom → cubic Béziers).
 * Points flagged with a third element `1` are sharp corners.
 */
export function smooth(pts: readonly SPt[], closed: boolean, tension = 1): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2 && !closed) return `M${f1(pts[0][0])} ${f1(pts[0][1])}L${f1(pts[1][0])} ${f1(pts[1][1])}`;
  const k = 0.36 * tension;
  const get = (i: number): SPt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const tan: (Pt | null)[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (p[2] === 1) {
      tan.push(null);
      continue;
    }
    if (!closed && (i === 0 || i === n - 1)) {
      const q = i === 0 ? pts[1] : pts[n - 2];
      const d = i === 0 ? sub([q[0], q[1]], [p[0], p[1]]) : sub([p[0], p[1]], [q[0], q[1]]);
      tan.push(norm(d));
      continue;
    }
    tan.push(tangentAt(get(i - 1), p, get(i + 1)));
  }
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = get(i);
    const b = get(i + 1);
    const ai = i % n;
    const bi = (i + 1) % n;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ta = tan[ai];
    const tb = tan[bi];
    const c1: Pt = ta ? [a[0] + ta[0] * L * k, a[1] + ta[1] * L * k] : [a[0] + (b[0] - a[0]) * 0.2, a[1] + (b[1] - a[1]) * 0.2];
    const c2: Pt = tb ? [b[0] - tb[0] * L * k, b[1] - tb[1] * L * k] : [b[0] - (b[0] - a[0]) * 0.2, b[1] - (b[1] - a[1]) * 0.2];
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(b[0])} ${f1(b[1])}`;
  }
  return closed ? d + "Z" : d;
}

/** Closed smooth blob through points. */
export const blob = (pts: readonly SPt[], tension = 1): string => smooth(pts, true, tension);
/** Open smooth curve through points (for detail lines). */
export const curve = (pts: readonly SPt[], tension = 1): string => smooth(pts, false, tension);

/** Sample a Catmull-Rom spline through points as a dense polyline. */
export function splinePts(pts: readonly Pt[], perSeg = 8): Pt[] {
  const n = pts.length;
  if (n < 2) return pts.slice() as Pt[];
  const out: Pt[] = [];
  const g = (i: number) => pts[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/**
 * A tapered stroke ("limb") along a spine of [x, y, width] points, returned as a
 * closed filled outline. Used for legs, tails, necks, horns, tufts and claws.
 * Caps: "round" (semicircle), "flat", or "point" (width → 0 is also a point).
 */
export function limb(
  spine: readonly [number, number, number][],
  opts: { start?: "round" | "flat"; end?: "round" | "flat"; perSeg?: number } = {},
): string {
  const per = opts.perSeg ?? 8;
  const n = spine.length;
  if (n < 2) return "";
  const centre = splinePts(spine.map((p) => [p[0], p[1]] as Pt), per);
  // Interpolate widths along the same parameterisation.
  const widths: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const tt = t * t * (3 - 2 * t);
      widths.push(spine[i][2] * (1 - tt) + spine[i + 1][2] * tt);
    }
  }
  widths.push(spine[n - 1][2]);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < centre.length; i++) {
    const a = centre[Math.max(0, i - 1)];
    const b = centre[Math.min(centre.length - 1, i + 1)];
    const t = norm(sub(b, a));
    const nrm: Pt = [-t[1], t[0]];
    const w = widths[i] / 2;
    left.push(add(centre[i], mul(nrm, w)));
    right.push(sub(centre[i], mul(nrm, w)));
  }
  const pts: Pt[] = [];
  for (const p of left) pts.push(p);
  // end cap
  const we = widths[widths.length - 1] / 2;
  if ((opts.end ?? "round") === "round" && we > 0.3) {
    const c = centre[centre.length - 1];
    const t = norm(sub(c, centre[centre.length - 2]));
    const a0 = Math.atan2(left[left.length - 1][1] - c[1], left[left.length - 1][0] - c[0]);
    const dir = t[0] * Math.sin(a0) - t[1] * Math.cos(a0) > 0 ? -1 : 1; // sweep through the tangent side
    for (let k = 1; k < 8; k++) {
      const a = a0 + dir * (Math.PI * k) / 8;
      pts.push([c[0] + Math.cos(a) * we, c[1] + Math.sin(a) * we]);
    }
  }
  for (let i = right.length - 1; i >= 0; i--) pts.push(right[i]);
  const ws = widths[0] / 2;
  if ((opts.start ?? "round") === "round" && ws > 0.3) {
    const c = centre[0];
    const t = norm(sub(centre[1], c));
    const a0 = Math.atan2(right[0][1] - c[1], right[0][0] - c[0]);
    const dir = -t[0] * Math.sin(a0) + t[1] * Math.cos(a0) > 0 ? -1 : 1;
    for (let k = 1; k < 8; k++) {
      const a = a0 + dir * (Math.PI * k) / 8;
      pts.push([c[0] + Math.cos(a) * ws, c[1] + Math.sin(a) * ws]);
    }
  }
  return polyD(dedupe(pts));
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 0.05 || Math.abs(q[1] - p[1]) > 0.05) out.push(p);
  }
  return out;
}

/** A tapering pointed tuft/flame from base point to tip, bulging sideways by `bend`. */
export function tuft(x0: number, y0: number, x1: number, y1: number, w: number, bend = 0): string {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  return limb(
    [
      [x0, y0, w],
      [mx + nx * bend, my + ny * bend, w * 0.62],
      [x1, y1, 0],
    ],
    { start: "round", end: "flat" },
  );
}

// ---------------------------------------------------------------------------
// Point transforms

export function mirrorX(pts: readonly SPt[], cx: number): SPt[] {
  return pts.map((p) => (p.length === 3 ? [2 * cx - p[0], p[1], p[2]] : [2 * cx - p[0], p[1]]) as SPt);
}
export function rotPts(pts: readonly SPt[], deg: number, cx: number, cy: number): SPt[] {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return pts.map((p) => {
    const x = p[0] - cx, y = p[1] - cy;
    const q: SPt = p.length === 3 ? [cx + x * c - y * s, cy + x * s + y * c, p[2]] : [cx + x * c - y * s, cy + x * s + y * c];
    return q;
  });
}
export function movePts(pts: readonly SPt[], dx: number, dy: number, k = 1): SPt[] {
  return pts.map((p) => (p.length === 3 ? [p[0] * k + dx, p[1] * k + dy, p[2]] : [p[0] * k + dx, p[1] * k + dy]) as SPt);
}

// ---------------------------------------------------------------------------
// Path parsing, sampling and bounding boxes (absolute + relative M L H V C S Q T A Z)

type Cmd = { c: string; v: number[] };

export function parsePath(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let cur: Cmd | null = null;
  while ((m = re.exec(d))) {
    if (m[1]) {
      cur = { c: m[1], v: [] };
      out.push(cur);
    } else if (cur) {
      cur.v.push(parseFloat(m[2]));
    }
  }
  return out;
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Sample a path into polylines (one per subpath). `step` is the approximate
 * number of samples per curve segment.
 */
export function samplePath(d: string, step = 12): Pt[][] {
  const cmds = parsePath(d);
  const polys: Pt[][] = [];
  let poly: Pt[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let lcx = 0, lcy = 0; // last control point (for S/T)
  let lastC = "";
  const push = (px: number, py: number) => poly.push([px, py]);
  for (const cmd of cmds) {
    const C = cmd.c.toUpperCase();
    const rel = cmd.c !== C;
    const ar = ARITY[C];
    if (C === "Z") {
      x = sx; y = sy;
      if (poly.length) {
        polys.push(poly);
        poly = [];
      }
      lastC = "Z";
      continue;
    }
    for (let i = 0; i + ar <= cmd.v.length || (ar === 0 && i === 0); i += ar) {
      const v = cmd.v.slice(i, i + ar);
      const ox = rel ? x : 0, oy = rel ? y : 0;
      let cc = C;
      if (C === "M" && i > 0) cc = "L";
      if (cc === "M") {
        if (poly.length) polys.push(poly);
        poly = [];
        x = v[0] + ox; y = v[1] + oy; sx = x; sy = y;
        push(x, y);
      } else if (cc === "L") {
        x = v[0] + ox; y = v[1] + oy;
        push(x, y);
      } else if (cc === "H") {
        x = v[0] + (rel ? x : 0);
        push(x, y);
      } else if (cc === "V") {
        y = v[0] + (rel ? y : 0);
        push(x, y);
      } else if (cc === "C" || cc === "S") {
        let x1: number, y1: number, x2: number, y2: number, ex: number, ey: number;
        if (cc === "C") {
          x1 = v[0] + ox; y1 = v[1] + oy; x2 = v[2] + ox; y2 = v[3] + oy; ex = v[4] + ox; ey = v[5] + oy;
        } else {
          if (lastC === "C" || lastC === "S") { x1 = 2 * x - lcx; y1 = 2 * y - lcy; } else { x1 = x; y1 = y; }
          x2 = v[0] + ox; y2 = v[1] + oy; ex = v[2] + ox; ey = v[3] + oy;
        }
        for (let s = 1; s <= step; s++) {
          const t = s / step, u = 1 - t;
          push(
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
          );
        }
        lcx = x2; lcy = y2; x = ex; y = ey;
      } else if (cc === "Q" || cc === "T") {
        let x1: number, y1: number, ex: number, ey: number;
        if (cc === "Q") {
          x1 = v[0] + ox; y1 = v[1] + oy; ex = v[2] + ox; ey = v[3] + oy;
        } else {
          if (lastC === "Q" || lastC === "T") { x1 = 2 * x - lcx; y1 = 2 * y - lcy; } else { x1 = x; y1 = y; }
          ex = v[0] + ox; ey = v[1] + oy;
        }
        for (let s = 1; s <= step; s++) {
          const t = s / step, u = 1 - t;
          push(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey);
        }
        lcx = x1; lcy = y1; x = ex; y = ey;
      } else if (cc === "A") {
        const ex = v[5] + ox, ey = v[6] + oy;
        for (const p of arcPoints(x, y, v[0], v[1], v[2], v[3], v[4], ex, ey, step * 2)) push(p[0], p[1]);
        x = ex; y = ey;
      }
      lastC = cc;
      if (ar === 0) break;
    }
  }
  if (poly.length) polys.push(poly);
  return polys;
}

function arcPoints(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number, n: number): Pt[] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
  return out;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function pathBBox(d: string): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of samplePath(d, 10)) {
    for (const [x, y] of poly) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** Signed area of a polygon (positive = clockwise in SVG's y-down space). */
export function polyArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Resample a closed polyline at (approximately) uniform arc-length spacing. */
export function resampleClosed(p: readonly Pt[], spacing: number): Pt[] {
  const n = p.length;
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  const m = Math.max(8, Math.round(total / spacing));
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const s = (k / m) * total;
    while (j < n - 1 && cum[j + 1] < s) j++;
    const a = p[j], b = p[(j + 1) % n];
    const seg = cum[j + 1] - cum[j] || 1;
    const t = (s - cum[j]) / seg;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Point-in-polygon (even-odd). */
export function inPoly(pt: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Horizontal extent [xmin, xmax] of a polygon at height y (null if none). */
export function polySpanAt(poly: readonly Pt[], y: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi <= y && yj >= y) || (yj <= y && yi >= y)) {
      const x = yi === yj ? Math.min(xi, xj) : xi + ((y - yi) * (xj - xi)) / (yj - yi);
      const x2 = yi === yj ? Math.max(xi, xj) : x;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x2);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

// ---------------------------------------------------------------------------
// Span tables: fast horizontal extents for layout searches

interface SpanTable {
  y0: number;
  dy: number;
  n: number;
  lo: Float64Array;
  hi: Float64Array;
}

const SPAN_ROWS = 600;
const spanCache = new WeakMap<readonly Pt[], SpanTable>();

/** Horizontal extents of a polygon sampled on a fine grid of rows (cached per polygon object). */
function spanTable(poly: readonly Pt[]): SpanTable {
  let t = spanCache.get(poly);
  if (t) return t;
  let ymin = Infinity, ymax = -Infinity;
  for (const p of poly) {
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  const n = SPAN_ROWS;
  const dy = Math.max(1e-9, (ymax - ymin) / (n - 1));
  const lo = new Float64Array(n).fill(Infinity), hi = new Float64Array(n).fill(-Infinity);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const ya = Math.min(yi, yj), yb = Math.max(yi, yj);
    const k0 = Math.max(0, Math.ceil((ya - ymin) / dy - 1e-9)), k1 = Math.min(n - 1, Math.floor((yb - ymin) / dy + 1e-9));
    for (let k = k0; k <= k1; k++) {
      const y = ymin + k * dy;
      let x0: number, x1: number;
      if (Math.abs(yj - yi) < 1e-12) {
        x0 = Math.min(xi, xj);
        x1 = Math.max(xi, xj);
      } else {
        x0 = x1 = xi + ((y - yi) * (xj - xi)) / (yj - yi);
      }
      if (x0 < lo[k]) lo[k] = x0;
      if (x1 > hi[k]) hi[k] = x1;
    }
  }
  t = { y0: ymin, dy, n, lo, hi };
  spanCache.set(poly, t);
  return t;
}

/**
 * The horizontal extent common to every height in [y0, y1] (the widest box
 * that fits in the polygon between those heights), or null if the polygon
 * does not cover the whole band. Conservative to within a grid row.
 */
export function polySpanBetween(poly: readonly Pt[], y0: number, y1: number): [number, number] | null {
  const t = spanTable(poly);
  if (y1 < y0) [y0, y1] = [y1, y0];
  const ka = Math.floor((y0 - t.y0) / t.dy), kb = Math.ceil((y1 - t.y0) / t.dy);
  if (ka < 0 || kb > t.n - 1) return null;
  let lo = -Infinity, hi = Infinity;
  for (let k = ka; k <= kb; k++) {
    const a = t.lo[k], b = t.hi[k];
    if (a > b) return null;
    if (a > lo) lo = a;
    if (b < hi) hi = b;
  }
  return lo < hi ? [lo, hi] : null;
}
