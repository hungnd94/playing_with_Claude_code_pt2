/**
 * Shield outlines and layout frames.
 *
 * All shapes are 200 units wide. A `Frame` is a rectangular box plus the
 * polygon of the area actually visible in it (the shield outline, or a
 * quarter of it after marshalling); layout uses the polygon so that charges
 * shrink and shift to fit tapering bases, round targes and lozenges.
 */
import type { ShieldShape } from "./types";
import { samplePath, polyD, polySpanAt, type Pt } from "./path";

export interface ShapeDef {
  w: number;
  h: number;
  d: string;
  /** Fess point, relative to the box. */
  fess: Pt;
  /** Visual weight centre used to position a single charge. */
  centre: Pt;
}

export const SHAPES: Record<ShieldShape, ShapeDef> = {
  heater: {
    w: 200, h: 236,
    d: "M0 0H200V92C200 158 165 205 100 236C35 205 0 158 0 92Z",
    fess: [100, 104], centre: [100, 104],
  },
  french: {
    w: 200, h: 232,
    d: "M0 0H200V190C200 208 190 214 172 214H128C113 214 104 220 100 232C96 220 87 214 72 214H28C10 214 0 208 0 190Z",
    fess: [100, 108], centre: [100, 108],
  },
  iberian: {
    w: 200, h: 230,
    d: "M0 0H200V130A100 100 0 0 1 0 130Z",
    fess: [100, 108], centre: [100, 110],
  },
  oval: {
    w: 200, h: 250,
    d: "M100 0C155 0 200 56 200 125C200 194 155 250 100 250C45 250 0 194 0 125C0 56 45 0 100 0Z",
    fess: [100, 125], centre: [100, 125],
  },
  lozenge: {
    w: 200, h: 260,
    d: "M100 0L200 130L100 260L0 130Z",
    fess: [100, 130], centre: [100, 130],
  },
  round: {
    w: 200, h: 200,
    d: "M100 0A100 100 0 0 1 100 200A100 100 0 0 1 100 0Z",
    fess: [100, 100], centre: [100, 100],
  },
  german: {
    w: 200, h: 240,
    d:
      "M14 8C70 -4 140 -2 194 12C188 70 202 130 198 172C194 214 150 238 100 240C52 238 8 214 4 172C1 140 6 112 6 86" +
      "C20 84 34 76 37 62C34 50 20 44 6 44C6 30 8 16 14 8Z",
    fess: [104, 112], centre: [106, 114],
  },
  swiss: {
    w: 200, h: 236,
    d: "M0 8Q50 14 100 0Q150 14 200 8V120C200 178 160 216 100 236C40 216 0 178 0 120Z",
    fess: [100, 108], centre: [100, 108],
  },
  square: {
    w: 200, h: 200,
    d: "M0 0H200V200H0Z",
    fess: [100, 100], centre: [100, 100],
  },
  banner: {
    w: 200, h: 250,
    d: "M0 0H200V250H0Z",
    fess: [100, 125], centre: [100, 125],
  },
};

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fess point (absolute). */
  fx: number;
  fy: number;
  /** Visible region polygon (absolute). */
  poly: Pt[];
  /** Visible region as a path (for clipping). */
  d: string;
  /** Unit scale: w / 200. */
  u: number;
  /** True if the visible region is the full rectangle (banners, quarters of square shields). */
  rect: boolean;
}

const polyCache = new Map<string, Pt[]>();

export function shapePoly(shape: ShieldShape): Pt[] {
  let p = polyCache.get(shape);
  if (!p) {
    p = samplePath(SHAPES[shape].d, 16)[0];
    // drop the closing duplicate if any
    const a = p[0], b = p[p.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) p = p.slice(0, -1);
    polyCache.set(shape, p);
  }
  return p;
}

export function shapeFrame(shape: ShieldShape): Frame {
  const s = SHAPES[shape];
  return {
    x: 0, y: 0, w: s.w, h: s.h, fx: s.fess[0], fy: s.fess[1],
    poly: shapePoly(shape), d: s.d, u: s.w / 200,
    rect: shape === "square" || shape === "banner",
  };
}

/** Rectangular frame (banners, flags, cantons). */
export function rectFrame(x: number, y: number, w: number, h: number): Frame {
  const poly: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return { x, y, w, h, fx: x + w / 2, fy: y + h / 2, poly, d: polyD(poly, true), u: w / 200, rect: true };
}

/** Sutherland–Hodgman clip of a polygon by an axis-aligned rectangle. */
export function clipPolyRect(poly: readonly Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  let out: Pt[] = poly.slice() as Pt[];
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cross] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cross(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cross(prev, cur));
    }
    if (out.length === 0) break;
  }
  return out;
}

/** A sub-frame: the part of `parent` inside the given box. */
export function subFrame(parent: Frame, x: number, y: number, w: number, h: number): Frame {
  const poly = parent.rect ? rectFrame(x, y, w, h).poly : clipPolyRect(parent.poly, x, y, x + w, y + h);
  // Fess point of a sub-frame: between the box centre and the visible area's centroid.
  const [gx, gy] = centroid(poly);
  const fx = (x + w / 2) * 0.5 + gx * 0.5;
  const fy = (y + h / 2) * 0.5 + gy * 0.5;
  const full = Math.abs(polyAreaAbs(poly) - w * h) < w * h * 0.01;
  return { x, y, w, h, fx, fy, poly, d: polyD(poly, true), u: w / 200, rect: parent.rect || full };
}

export function centroid(p: readonly Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const cr = p[i][0] * q[1] - q[0] * p[i][1];
    a += cr;
    cx += (p[i][0] + q[0]) * cr;
    cy += (p[i][1] + q[1]) * cr;
  }
  if (Math.abs(a) < 1e-9) return p.length ? [p[0][0], p[0][1]] : [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

function polyAreaAbs(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(a / 2);
}

/** Available horizontal span over a vertical band, shrunk by a margin. */
export function spanOver(fr: Frame, y0: number, y1: number, margin = 0): [number, number] | null {
  let lo = -Infinity, hi = Infinity;
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const y = y0 + ((y1 - y0) * i) / N;
    const s = polySpanAt(fr.poly, y);
    if (!s) return null;
    lo = Math.max(lo, s[0]);
    hi = Math.min(hi, s[1]);
  }
  lo += margin;
  hi -= margin;
  return lo < hi ? [lo, hi] : null;
}

/**
 * Inset (offset inward) a closed polygon by distance d. Works for the convex-ish
 * shield outlines used here; vertices are offset along the bisector normals.
 */
export function insetPoly(poly: readonly Pt[], d: number): Pt[] {
  const n = poly.length;
  // orientation
  let area = 0;
  for (let i = 0; i < n; i++) {
    const q = poly[(i + 1) % n];
    area += poly[i][0] * q[1] - q[0] * poly[i][1];
  }
  const sgn = area > 0 ? 1 : -1; // >0: clockwise on screen
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1x = b[0] - a[0], e1y = b[1] - a[1];
    const e2x = c[0] - b[0], e2y = c[1] - b[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    // inward normals (for clockwise-on-screen polygons the inside is to the right of travel)
    const n1x = (-e1y / l1) * sgn, n1y = (e1x / l1) * sgn;
    const n2x = (-e2y / l2) * sgn, n2y = (e2x / l2) * sgn;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cos = mx * n1x + my * n1y;
    const k = d / Math.max(0.35, cos);
    out.push([b[0] + mx * k, b[1] + my * k]);
  }
  return out;
}
