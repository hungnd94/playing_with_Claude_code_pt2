/** Minimal 3-vector helpers operating on tuples and on flat Float32Arrays. */

export type V3 = [number, number, number];

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Read the i-th vector out of a flat xyz array. */
export const at = (arr: ArrayLike<number>, i: number): V3 => [arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]];

/** Great-circle angle (radians) between two unit vectors. */
export function angleBetween(a: V3, b: V3): number {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(c);
}

/** Great-circle angle between cells i and j of a flat xyz array. */
export function angleIJ(xyz: ArrayLike<number>, i: number, j: number): number {
  const d = xyz[3 * i] * xyz[3 * j] + xyz[3 * i + 1] * xyz[3 * j + 1] + xyz[3 * i + 2] * xyz[3 * j + 2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/** Convert unit vector → [lat, lon] in radians. Convention: +z is the north pole, lon = atan2(y, x). */
export function toLatLon(v: V3): [number, number] {
  return [Math.asin(Math.max(-1, Math.min(1, v[2]))), Math.atan2(v[1], v[0])];
}

/** Convert [lat, lon] radians → unit vector. */
export function fromLatLon(lat: number, lon: number): V3 {
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

/**
 * Local tangent frame at a point on the unit sphere: east and north unit vectors.
 * Degenerate exactly at the poles (east chosen arbitrarily there).
 */
export function tangentFrame(p: V3): { east: V3; north: V3 } {
  let east: V3 = [-p[1], p[0], 0];
  const l = Math.hypot(east[0], east[1]);
  if (l < 1e-9) east = [1, 0, 0];
  else east = [east[0] / l, east[1] / l, 0];
  const north = cross(p, east);
  return { east, north };
}

/** Spherical linear interpolation between unit vectors. */
export function slerp(a: V3, b: V3, t: number): V3 {
  const om = angleBetween(a, b);
  if (om < 1e-9) return a;
  const s = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / s;
  const kb = Math.sin(t * om) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

/** Rodrigues rotation of v around unit axis k by angle θ. */
export function rotate(v: V3, k: V3, theta: number): V3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
}
