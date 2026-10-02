/**
 * Raster helpers for the geo debug maps: equirectangular sampling of per-cell
 * fields with barycentric interpolation, colour ramps, hillshading, AA lines
 * and a tiny bitmap font for labels.
 */
import { CellLocator, type SphereMesh } from "../src/core/sphere";

export type RGB = [number, number, number];

export class Raster {
  readonly rgba: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.rgba = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    if (a >= 1) {
      this.rgba[o] = c[0]; this.rgba[o + 1] = c[1]; this.rgba[o + 2] = c[2]; this.rgba[o + 3] = 255;
    } else if (a > 0) {
      this.rgba[o] += (c[0] - this.rgba[o]) * a;
      this.rgba[o + 1] += (c[1] - this.rgba[o + 1]) * a;
      this.rgba[o + 2] += (c[2] - this.rgba[o + 2]) * a;
      this.rgba[o + 3] = 255;
    }
  }
  get(x: number, y: number): RGB {
    const o = (y * this.w + x) * 4;
    return [this.rgba[o], this.rgba[o + 1], this.rgba[o + 2]];
  }
  /** Anti-aliased disc. Wraps horizontally. */
  disc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
    const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.max(0, Math.min(1, r + 0.5 - d)) * alpha;
        if (a > 0) this.set(((x % this.w) + this.w) % this.w, y, c, a);
      }
    }
  }
  /** Thick AA line by stamping discs. Assumes no wrap (caller splits). */
  line(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB, alpha = 1): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.35, r * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c, alpha);
    }
  }
  /** Line between lon/lat points with antimeridian handling. */
  geoLine(lon0: number, lat0: number, lon1: number, lat1: number, r: number, c: RGB, alpha = 1): void {
    const [x0, y0] = this.project(lon0, lat0);
    let [x1, y1] = this.project(lon1, lat1);
    if (x1 - x0 > this.w / 2) x1 -= this.w;
    else if (x0 - x1 > this.w / 2) x1 += this.w;
    this.line(x0, y0, x1, y1, r, c, alpha);
  }
  project(lon: number, lat: number): [number, number] {
    return [((lon + Math.PI) / (2 * Math.PI)) * this.w, ((Math.PI / 2 - lat) / Math.PI) * this.h];
  }
  text(s: string, x: number, y: number, scale: number, c: RGB, shadow?: RGB): void {
    if (shadow) this.textRaw(s, x + 1, y + 1, scale, shadow);
    this.textRaw(s, x, y, scale, c);
  }
  private textRaw(s: string, x: number, y: number, scale: number, c: RGB): void {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch];
      if (g) {
        for (let r = 0; r < 5; r++) {
          for (let k = 0; k < 3; k++) {
            if (g[r] & (4 >> k)) {
              for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) this.set(cx + k * scale + a, y + r * scale + b, c);
            }
          }
        }
      }
      cx += 4 * scale;
    }
  }
}

/** 3x5 bitmap font (each row 3 bits). */
const FONT: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7], "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7], "6": [7, 4, 7, 5, 7], "7": [7, 1, 1, 2, 2], "8": [7, 5, 7, 5, 7], "9": [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], "-": [0, 0, 7, 0, 0], ".": [0, 0, 0, 0, 2], ":": [0, 2, 0, 2, 0], " ": [0, 0, 0, 0, 0],
  "/": [1, 1, 2, 4, 4], "%": [5, 1, 2, 4, 5], "(": [1, 2, 2, 2, 1], ")": [4, 2, 2, 2, 4], "+": [0, 2, 7, 2, 0],
};

/** Precomputed equirectangular → mesh sampling (triangle vertices + barycentric weights per pixel). */
export class Sampler {
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly c: Int32Array;
  readonly wa: Float32Array;
  readonly wb: Float32Array;
  readonly wc: Float32Array;
  readonly nearest: Int32Array;
  constructor(readonly mesh: SphereMesh, readonly w: number, readonly h: number, locator = new CellLocator(mesh)) {
    const N = w * h;
    this.a = new Int32Array(N); this.b = new Int32Array(N); this.c = new Int32Array(N);
    this.wa = new Float32Array(N); this.wb = new Float32Array(N); this.wc = new Float32Array(N);
    this.nearest = new Int32Array(N);
    const out = new Float64Array(3);
    let hint = -1;
    for (let y = 0; y < h; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < w; x++) {
        const lon = -Math.PI + ((x + 0.5) / w) * 2 * Math.PI;
        const px = cl * Math.cos(lon), py = cl * Math.sin(lon), pz = sl;
        const t = locator.locateTriangle(px, py, pz, out, hint);
        const i = y * w + x;
        const A = mesh.triangles[3 * t], B = mesh.triangles[3 * t + 1], C = mesh.triangles[3 * t + 2];
        this.a[i] = A; this.b[i] = B; this.c[i] = C;
        this.wa[i] = out[0]; this.wb[i] = out[1]; this.wc[i] = out[2];
        const nst = out[0] >= out[1] && out[0] >= out[2] ? A : out[1] >= out[2] ? B : C;
        this.nearest[i] = nst;
        hint = nst;
      }
    }
  }
  /** Interpolate a scalar field to the raster. */
  field(f: ArrayLike<number>): Float32Array {
    const N = this.w * this.h;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = this.wa[i] * f[this.a[i]] + this.wb[i] * f[this.b[i]] + this.wc[i] * f[this.c[i]];
    return out;
  }
}

/** Piecewise-linear colour ramp. stops: [value, [r,g,b]] sorted by value. */
export function ramp(stops: [number, RGB][], v: number): RGB {
  if (v <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (v <= stops[k][0]) {
      const [v0, c0] = stops[k - 1];
      const [v1, c1] = stops[k];
      const t = (v - v0) / (v1 - v0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Hillshade factor per pixel from an elevation raster (km). Light from the
 * north-west, with vertical exaggeration `exag`.
 */
export function hillshade(elev: Float32Array, w: number, h: number, radiusKm: number, exag: number): Float32Array {
  const out = new Float32Array(w * h);
  const kmPerPxY = (Math.PI * radiusKm) / h;
  const lx = -0.6, ly = -0.6, lz = 0.53; // light dir (x east, y south in image, z up)
  const ll = Math.hypot(lx, ly, lz);
  for (let y = 0; y < h; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
    const kmPerPxX = Math.max(0.05, Math.cos(lat)) * (2 * Math.PI * radiusKm) / w;
    const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dzdx = (Math.max(0, elev[y * w + xp]) - Math.max(0, elev[y * w + xm])) / (2 * kmPerPxX) * exag;
      const dzdy = (Math.max(0, elev[yp * w + x]) - Math.max(0, elev[ym * w + x])) / ((yp - ym) * kmPerPxY) * exag;
      // Normal = (-dzdx, -dzdy, 1)
      const nl = Math.hypot(dzdx, dzdy, 1);
      const d = (-dzdx * lx - dzdy * ly + lz) / (nl * ll);
      out[y * w + x] = d;
    }
  }
  return out;
}
