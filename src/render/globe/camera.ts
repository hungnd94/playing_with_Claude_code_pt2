/**
 * Camera math for the globe and flat-map views (pure functions; no DOM).
 *
 * The globe is an orthographic view of the unit sphere, always north-up: the
 * point (lat, lon) faces the viewer at the centre of the screen, `east` points
 * right and `north` points up. Screen coordinates are CSS pixels with y down.
 */
export type V3 = [number, number, number];

/** View state; angles in degrees. zoom = 1 shows the whole globe (or the whole map). */
export interface ViewState {
  lat: number;
  lon: number;
  zoom: number;
}

export type ProjectionMode = "globe" | "flat";

export interface Frame {
  mode: ProjectionMode;
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Globe radius in CSS px (globe mode). */
  radius: number;
  /** Radians per CSS px (flat mode). */
  scale: number;
  lat0: number;
  lon0: number;
  center: V3;
  east: V3;
  north: V3;
}

/** Fraction of min(width, height) covered by the globe radius at zoom 1. */
export const GLOBE_FIT = 0.4;

const DEG = Math.PI / 180;

export function makeFrame(state: ViewState, mode: ProjectionMode, width: number, height: number): Frame {
  const lat0 = state.lat * DEG;
  const lon0 = state.lon * DEG;
  const cl = Math.cos(lat0), sl = Math.sin(lat0);
  const co = Math.cos(lon0), so = Math.sin(lon0);
  const center: V3 = [cl * co, cl * so, sl];
  const east: V3 = [-so, co, 0];
  const north: V3 = [-sl * co, -sl * so, cl];
  const radius = GLOBE_FIT * Math.min(width, height) * state.zoom;
  const pxPerRad = Math.min(width / (2 * Math.PI), height / Math.PI) * state.zoom;
  return { mode, width, height, cx: width / 2, cy: height / 2, radius, scale: 1 / pxPerRad, lat0, lon0, center, east, north };
}

/** Wrap an angle to (−π, π]. */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export interface Projected {
  x: number;
  y: number;
  /** Globe: dot(p, view direction) (> 0 on the near side). Flat: 1. */
  depth: number;
}

/** Project a unit vector to screen (CSS px). */
export function project(f: Frame, x: number, y: number, z: number, out: Projected): Projected {
  if (f.mode === "globe") {
    const e = f.east, n = f.north, c = f.center;
    out.x = f.cx + (x * e[0] + y * e[1] + z * e[2]) * f.radius;
    out.y = f.cy - (x * n[0] + y * n[1] + z * n[2]) * f.radius;
    out.depth = x * c[0] + y * c[1] + z * c[2];
  } else {
    const lat = Math.asin(Math.max(-1, Math.min(1, z)));
    const lon = Math.atan2(y, x);
    out.x = f.cx + wrapPi(lon - f.lon0) / f.scale;
    out.y = f.cy - (lat - f.lat0) / f.scale;
    out.depth = 1;
  }
  return out;
}

/** Unit vector under screen point (CSS px), or null if off the globe/map. */
export function unproject(f: Frame, sx: number, sy: number): V3 | null {
  if (f.mode === "globe") {
    const u = (sx - f.cx) / f.radius;
    const v = (f.cy - sy) / f.radius;
    const r2 = u * u + v * v;
    if (r2 > 1) return null;
    const w = Math.sqrt(1 - r2);
    const e = f.east, n = f.north, c = f.center;
    return [u * e[0] + v * n[0] + w * c[0], u * e[1] + v * n[1] + w * c[1], u * e[2] + v * n[2] + w * c[2]];
  }
  const lat = f.lat0 + (f.cy - sy) * f.scale;
  if (lat > Math.PI / 2 || lat < -Math.PI / 2) return null;
  const lon = f.lon0 + (sx - f.cx) * f.scale;
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
}

/** Unit vector → [latDeg, lonDeg]. */
export function toLatLonDeg(p: V3): [number, number] {
  return [Math.asin(Math.max(-1, Math.min(1, p[2]))) / DEG, Math.atan2(p[1], p[0]) / DEG];
}

/** Clamp a view to the legal range for a mode. */
export function clampView(s: ViewState, mode: ProjectionMode, width: number, height: number, minZoom: number, maxZoom: number): ViewState {
  const zoom = Math.max(minZoom, Math.min(maxZoom, s.zoom));
  let lat = s.lat;
  let lon = ((((s.lon + 180) % 360) + 360) % 360) - 180;
  if (mode === "globe") {
    lat = Math.max(-90, Math.min(90, lat));
  } else {
    const pxPerRad = Math.min(width / (2 * Math.PI), height / Math.PI) * zoom;
    const halfH = height / 2 / pxPerRad / DEG;
    const lim = Math.max(0, 90 - halfH);
    lat = Math.max(-lim, Math.min(lim, lat));
  }
  if (!isFinite(lon)) lon = 0;
  return { lat, lon, zoom };
}

/** Great-circle interpolation between two lat/lon points (degrees), t ∈ [0,1]. */
export function slerpLatLon(aLat: number, aLon: number, bLat: number, bLon: number, t: number): [number, number] {
  const a = fromLatLonDeg(aLat, aLon), b = fromLatLonDeg(bLat, bLon);
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(d);
  if (om < 1e-6) return [aLat + (bLat - aLat) * t, aLon + wrapDeg(bLon - aLon) * t];
  const s = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  const p: V3 = [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
  return toLatLonDeg(p);
}

export function fromLatLonDeg(lat: number, lon: number): V3 {
  const la = lat * DEG, lo = lon * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

export function wrapDeg(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** Angular distance between two lat/lon points, radians. */
export function angularDistance(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const a = fromLatLonDeg(aLat, aLon), b = fromLatLonDeg(bLat, bLon);
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}
