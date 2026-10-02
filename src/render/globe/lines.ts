/**
 * Polyline layer geometry (pure; no DOM): trade routes, campaign arrows, war
 * fronts, rivers of a selected basin…
 *
 * Each input polyline is resampled along great circles (or a spherical
 * Catmull–Rom spline when `smooth`), mapped through an optional placement
 * function (the inverse warp, so routes meet the markers they connect), and
 * turned into a vertex stream that the line shader expands in screen space
 * (constant pixel width, mitred joins, casing, dashes, dots, arrowheads).
 */
import { parseColor } from "./gl";

export type ColorLike = string | readonly number[];

export type LineStyle = "solid" | "dashed" | "dotted";

export interface GlobeLine {
  /** Points on the unit sphere: flat [x0,y0,z0, x1,…] or a list of [x,y,z]. Joined by great-circle arcs. */
  points: ArrayLike<number> | readonly (readonly [number, number, number])[];
  /** CSS hex or [r,g,b,a(0..1)] (default warm parchment). */
  color?: ColorLike;
  /** Stroke width in CSS px (default 2). */
  width?: number;
  /** "solid" (default), "dashed" or "dotted". */
  style?: LineStyle;
  /** Dark casing (halo) width on each side, CSS px (default 1; 0 = none). */
  casing?: number;
  /** Casing opacity (default 0.55). */
  casingOpacity?: number;
  /** Smooth the polyline (spherical Catmull–Rom) instead of straight great-circle legs. */
  smooth?: boolean;
  /** Arrowhead at the last point (campaigns, migrations). */
  arrow?: boolean;
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Animated flow along the line in CSS px/s (dashed/dotted only; 0 = static). Off under reduced motion. */
  flow?: number;
}

/** Floats per vertex in the line vertex stream. */
export const LINE_STRIDE = 23;
/*
 * Layout (floats):
 *  0  pos.xyz      3  prev.xyz     6  next.xyz
 *  9  side (−1 / +1; arrowhead corners: −1, 0 = tip, +1)
 * 10  dist (arc length from the line start, radians)
 * 11  color.rgba (sRGB 0..1, alpha)
 * 15  width (CSS px)   16 casing (CSS px)   17 style (0 solid, 1 dashed, 2 dotted)
 * 18  kind (0 stroke, 1 arrowhead)
 * 19  lonU: longitude unwrapped continuously along the line (radians)
 * 20  flow (CSS px/s)  21 casing opacity   22 anchor: the line's first longitude
 */

export interface LineGeometry {
  verts: Float32Array;
  indices: Uint32Array;
  /** True if any line flows (needs continuous rendering). */
  animated: boolean;
}

type Place = (x: number, y: number, z: number) => [number, number, number];

/** Max arc length of one resampled piece, radians (~0.6°). */
const MAX_SEG = 0.01;

function readPoints(pts: GlobeLine["points"]): number[] {
  const out: number[] = [];
  const first = (pts as ArrayLike<unknown>)[0];
  if (pts.length > 0 && typeof first === "object" && first !== null) {
    for (const p of pts as readonly (readonly [number, number, number])[]) out.push(p[0], p[1], p[2]);
  } else {
    const a = pts as ArrayLike<number>;
    for (let i = 0; i + 2 < a.length; i += 3) out.push(a[i], a[i + 1], a[i + 2]);
  }
  // Normalise, drop exact duplicates.
  const res: number[] = [];
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    const x = out[i] / l, y = out[i + 1] / l, z = out[i + 2] / l;
    const n = res.length;
    if (n >= 3 && Math.abs(res[n - 3] - x) + Math.abs(res[n - 2] - y) + Math.abs(res[n - 1] - z) < 1e-9) continue;
    res.push(x, y, z);
  }
  return res;
}

/** Great-circle interpolation between unit vectors a and b. */
function slerp(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, out: number[]): void {
  const d = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  const om = Math.acos(d);
  if (om < 1e-9) {
    out.push(ax, ay, az);
    return;
  }
  const s = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  out.push(ax * ka + bx * kb, ay * ka + by * kb, az * ka + bz * kb);
}

/**
 * Resample a polyline: great-circle legs (or Catmull–Rom when smooth), with
 * pieces no longer than MAX_SEG. Returns flat unit vectors.
 */
export function resampleLine(p: number[], smooth: boolean, closed: boolean): number[] {
  const m = p.length / 3;
  if (m < 2) return p.slice();
  const out: number[] = [];
  const legs = closed ? m : m - 1;
  const P = (i: number): [number, number, number] => {
    let k = i;
    if (closed) k = ((k % m) + m) % m;
    else k = Math.max(0, Math.min(m - 1, k));
    return [p[3 * k], p[3 * k + 1], p[3 * k + 2]];
  };
  for (let i = 0; i < legs; i++) {
    const a = P(i), b = P(i + 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    const steps = Math.max(1, Math.ceil(ang / MAX_SEG));
    if (!smooth || m < 3) {
      for (let s = 0; s < steps; s++) slerp(a[0], a[1], a[2], b[0], b[1], b[2], s / steps, out);
    } else {
      // Centripetal-ish Catmull–Rom in 3D, re-projected to the sphere.
      const p0 = P(i - 1), p3 = P(i + 2);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const w0 = -0.5 * t3 + t2 - 0.5 * t;
        const w1 = 1.5 * t3 - 2.5 * t2 + 1;
        const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
        const w3 = 0.5 * t3 - 0.5 * t2;
        const x = w0 * p0[0] + w1 * a[0] + w2 * b[0] + w3 * p3[0];
        const y = w0 * p0[1] + w1 * a[1] + w2 * b[1] + w3 * p3[1];
        const z = w0 * p0[2] + w1 * a[2] + w2 * b[2] + w3 * p3[2];
        const l = Math.hypot(x, y, z) || 1;
        out.push(x / l, y / l, z / l);
      }
    }
  }
  const last = closed ? P(0) : P(m - 1);
  out.push(last[0], last[1], last[2]);
  return out;
}

/** Build the vertex/index streams for a set of lines. */
export function buildLineGeometry(lines: readonly GlobeLine[], place?: Place): LineGeometry {
  const v: number[] = [];
  const idx: number[] = [];
  let animated = false;
  for (const line of lines) {
    const raw = readPoints(line.points);
    if (raw.length < 6) continue;
    let pts = resampleLine(raw, !!line.smooth, !!line.closed);
    if (place) {
      const mapped: number[] = [];
      for (let i = 0; i < pts.length; i += 3) {
        const q = place(pts[i], pts[i + 1], pts[i + 2]);
        mapped.push(q[0], q[1], q[2]);
      }
      pts = mapped;
    }
    const m = pts.length / 3;
    const c = parseColor(line.color, [0.96, 0.9, 0.76, 1]);
    const width = line.width ?? 2;
    const casing = line.casing ?? 1;
    const caseA = Math.max(0, Math.min(1, line.casingOpacity ?? 0.55));
    const style = line.style === "dashed" ? 1 : line.style === "dotted" ? 2 : 0;
    const flow = style !== 0 ? line.flow ?? 0 : 0;
    if (flow) animated = true;
    // Unwrapped longitudes (continuous along the line) for the flat map.
    const lonU = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const lon = Math.atan2(pts[3 * k + 1], pts[3 * k]);
      if (k === 0) lonU[k] = lon;
      else {
        let d = lon - (lonU[k - 1] % (2 * Math.PI));
        d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
        lonU[k] = lonU[k - 1] + d;
      }
    }
    let dist = 0;
    const base = v.length / LINE_STRIDE;
    const push = (k: number, side: number, kind: number, d: number, kp: number, kn: number): void => {
      v.push(
        pts[3 * k], pts[3 * k + 1], pts[3 * k + 2],
        pts[3 * kp], pts[3 * kp + 1], pts[3 * kp + 2],
        pts[3 * kn], pts[3 * kn + 1], pts[3 * kn + 2],
        side, d, c[0], c[1], c[2], c[3], width, casing, style, kind, lonU[k], flow, caseA, lonU[0],
      );
    };
    const closedLoop = !!line.closed && m > 3;
    for (let k = 0; k < m; k++) {
      if (k > 0) {
        const a = 3 * (k - 1), b = 3 * k;
        dist += Math.acos(Math.max(-1, Math.min(1, pts[a] * pts[b] + pts[a + 1] * pts[b + 1] + pts[a + 2] * pts[b + 2])));
      }
      // Neighbours for the miter; a closed loop wraps (its last point equals the first).
      let kp = k - 1, kn = k + 1;
      if (closedLoop) {
        if (kp < 0) kp = m - 2;
        if (kn > m - 1) kn = 1;
      } else {
        kp = Math.max(0, kp);
        kn = Math.min(m - 1, kn);
      }
      push(k, -1, 0, dist, kp, kn);
      push(k, 1, 0, dist, kp, kn);
      if (k + 1 < m) {
        const i0 = base + 2 * k;
        idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
    }
    if (line.arrow && m >= 2) {
      const b = v.length / LINE_STRIDE;
      // Direction from a point a little before the tip (≈ 3 resampled pieces) for a stable heading.
      const kp = Math.max(0, m - 4);
      push(m - 1, -1, 1, dist, kp, m - 1);
      push(m - 1, 0, 1, dist, kp, m - 1);
      push(m - 1, 1, 1, dist, kp, m - 1);
      idx.push(b, b + 1, b + 2);
    }
  }
  return { verts: Float32Array.from(v), indices: Uint32Array.from(idx), animated };
}
