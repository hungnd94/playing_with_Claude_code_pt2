/**
 * Lambert azimuthal equal-area projection centred on the plate's view, mapped
 * to screen pixels. Pure math; no DOM.
 *
 * Screen convention: x to the right, y down; north is up at the centre.
 * `view.radiusKm` is the ground distance from the centre to the nearest edge of
 * the map area (the shorter half-dimension).
 */

export interface AtlasView {
  /** Degrees. */
  centerLat: number;
  /** Degrees. */
  centerLon: number;
  /** Ground distance (km) from the centre to the nearest edge of the map area. */
  radiusKm: number;
}

export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Projection {
  /** Centre and tangent frame (unit vectors). */
  readonly c: [number, number, number];
  readonly e: [number, number, number];
  readonly n: [number, number, number];
  /** Pixels per unit of the (unit-sphere) projection plane. */
  readonly scale: number;
  /** Screen position of the centre. */
  readonly cx: number;
  readonly cy: number;
  /** Kilometres per pixel at the centre. */
  readonly kmPerPx: number;
  /** Planet radius, km. */
  readonly R: number;
  /** Angular radius (rad) of the cap that surely contains the whole map rect. */
  readonly capAngle: number;

  constructor(readonly view: AtlasView, readonly rect: MapRect, planetRadiusKm: number) {
    const lat = (view.centerLat * Math.PI) / 180;
    const lon = (view.centerLon * Math.PI) / 180;
    const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
    this.c = [cl * co, cl * so, sl];
    this.e = [-so, co, 0];
    this.n = [-sl * co, -sl * so, cl];
    this.R = planetRadiusKm;
    const theta = Math.min(Math.PI * 0.98, Math.max(1e-4, view.radiusKm / planetRadiusKm));
    const rho = 2 * Math.sin(theta / 2);
    const half = Math.min(rect.w, rect.h) / 2;
    this.scale = half / rho;
    this.cx = rect.x + rect.w / 2;
    this.cy = rect.y + rect.h / 2;
    // Lambert: near the centre, plane distance ≈ angle, so km/px ≈ R / scale.
    this.kmPerPx = planetRadiusKm / this.scale;
    const halfDiag = Math.hypot(rect.w, rect.h) / 2 / this.scale;
    this.capAngle = halfDiag >= 2 ? Math.PI : 2 * Math.asin(Math.min(1, halfDiag / 2));
  }

  /** Unit vector → screen. Returns false for the antipode (never visible). */
  forward(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    const [cx, cy, cz] = this.c;
    const cosc = x * cx + y * cy + z * cz;
    if (cosc <= -0.9999) return false;
    const k = Math.sqrt(2 / (1 + cosc));
    const px = x * this.e[0] + y * this.e[1] + z * this.e[2];
    const py = x * this.n[0] + y * this.n[1] + z * this.n[2];
    out.x = this.cx + k * px * this.scale;
    out.y = this.cy - k * py * this.scale;
    return true;
  }

  /** Screen → unit vector (written into out[0..2]). Returns false outside the projectable disc. */
  inverse(sx: number, sy: number, out: Float64Array | number[]): boolean {
    const X = (sx - this.cx) / this.scale;
    const Y = (this.cy - sy) / this.scale;
    const r2 = X * X + Y * Y;
    if (r2 >= 4) return false;
    // Lambert azimuthal: θ = 2 asin(ρ/2) ⇒ sin θ / ρ = √(1 − ρ²/4), cos θ = 1 − ρ²/2 (no trigonometry).
    const s = Math.sqrt(1 - r2 / 4), cs = 1 - r2 / 2;
    const e = this.e, n = this.n, c = this.c;
    out[0] = c[0] * cs + (e[0] * X + n[0] * Y) * s;
    out[1] = c[1] * cs + (e[1] * X + n[1] * Y) * s;
    out[2] = c[2] * cs + (e[2] * X + n[2] * Y) * s;
    return true;
  }

  /** lat/lon in radians → screen. */
  forwardLatLon(lat: number, lon: number, out: { x: number; y: number }): boolean {
    const cl = Math.cos(lat);
    return this.forward(cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat), out);
  }

  /** Screen → [latDeg, lonDeg] or null. */
  inverseLatLon(sx: number, sy: number): [number, number] | null {
    const v = [0, 0, 0];
    if (!this.inverse(sx, sy, v)) return null;
    return [(Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180) / Math.PI, (Math.atan2(v[1], v[0]) * 180) / Math.PI];
  }

  /** Angular distance from the centre (radians) of a unit vector. */
  angleFromCenter(x: number, y: number, z: number): number {
    const d = x * this.c[0] + y * this.c[1] + z * this.c[2];
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  /** Is the unit vector inside the cap covering the map (cheap pre-filter)? */
  inCap(x: number, y: number, z: number, marginRad = 0): boolean {
    const d = x * this.c[0] + y * this.c[1] + z * this.c[2];
    return d >= Math.cos(Math.min(Math.PI, this.capAngle + marginRad));
  }
}
