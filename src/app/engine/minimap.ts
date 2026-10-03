/**
 * Mini maps for articles: an orthographic close-up of the baked globe
 * textures around an entity, with its territory tinted and outlined, other
 * realms' borders inked faintly, and a graticule. Pure pixel work (no DOM):
 * writes into an RGBA buffer.
 */
import type { BakedGlobe } from "../../render/bake/index";
import { decodeCellId } from "../../render/bake/cellids";

export interface MiniMapSpec {
  width: number;
  height: number;
  /** Centre, degrees. */
  lat: number;
  lon: number;
  /** Angular half-width of the view, degrees. */
  radiusDeg: number;
  /** Cells to tint (membership by cell id), or null. */
  focus: Uint8Array | null;
  /** Owner per cell for context borders, or null. */
  owner: Int32Array | null;
  tint: [number, number, number];
  /** Ink for borders/graticule. */
  ink: [number, number, number];
}

const DEG = Math.PI / 180;

export function renderMiniMap(baked: BakedGlobe, spec: MiniMapSpec, out: Uint8ClampedArray): void {
  const { width: W, height: H } = spec;
  const tex = baked.terrain, ids = baked.cellIds;
  const TW = tex.width, TH = tex.height, IW = ids.width, IH = ids.height;
  const lat0 = spec.lat * DEG, lon0 = spec.lon * DEG;
  const cl = Math.cos(lat0), sl = Math.sin(lat0), co = Math.cos(lon0), so = Math.sin(lon0);
  const c = [cl * co, cl * so, sl];
  const e = [-so, co, 0];
  const nn = [-sl * co, -sl * so, cl];
  // Plane half-extent so the longer side spans ±radius.
  const half = Math.sin(Math.min(80, spec.radiusDeg) * DEG);
  const scale = (2 * half) / Math.max(W, H);
  const cellAt = new Int32Array(W * H).fill(-1);
  const t = spec.tint;
  for (let py = 0; py < H; py++) {
    const v = (H / 2 - py - 0.5) * scale;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5 - W / 2) * scale;
      const o = 4 * (py * W + px);
      const rr = u * u + v * v;
      if (rr >= 1) {
        out[o] = out[o + 1] = out[o + 2] = 0;
        out[o + 3] = 0;
        continue;
      }
      const w = Math.sqrt(1 - rr);
      const x = c[0] * w + e[0] * u + nn[0] * v;
      const y = c[1] * w + e[1] * u + nn[1] * v;
      const z = c[2] * w + e[2] * u + nn[2] * v;
      const lat = Math.asin(Math.max(-1, Math.min(1, z)));
      const lon = Math.atan2(y, x);
      // Bilinear terrain sample.
      const fx = ((lon + Math.PI) / (2 * Math.PI)) * TW - 0.5;
      const fy = ((Math.PI / 2 - lat) / Math.PI) * TH - 0.5;
      const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(TH - 2, Math.floor(fy)));
      const ax = fx - x0, ay = Math.max(0, Math.min(1, fy - y0));
      const xa = ((x0 % TW) + TW) % TW, xb = (xa + 1) % TW;
      const i00 = 4 * (y0 * TW + xa), i10 = 4 * (y0 * TW + xb), i01 = 4 * ((y0 + 1) * TW + xa), i11 = 4 * ((y0 + 1) * TW + xb);
      const d = tex.rgba;
      let r = (d[i00] * (1 - ax) + d[i10] * ax) * (1 - ay) + (d[i01] * (1 - ax) + d[i11] * ax) * ay;
      let g = (d[i00 + 1] * (1 - ax) + d[i10 + 1] * ax) * (1 - ay) + (d[i01 + 1] * (1 - ax) + d[i11 + 1] * ax) * ay;
      let b = (d[i00 + 2] * (1 - ax) + d[i10 + 2] * ax) * (1 - ay) + (d[i01 + 2] * (1 - ax) + d[i11 + 2] * ax) * ay;
      // Cell id (nearest).
      const ix = Math.min(IW - 1, Math.max(0, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * IW)));
      const iy = Math.min(IH - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * IH)));
      const io = 4 * (iy * IW + ix);
      const land = ids.rgba[io + 3] > 200;
      const cell = decodeCellId(ids.rgba, io);
      cellAt[py * W + px] = land ? cell : -1 - 0;
      if (spec.focus && land && spec.focus[cell]) {
        r = r * 0.55 + t[0] * 0.45;
        g = g * 0.55 + t[1] * 0.45;
        b = b * 0.55 + t[2] * 0.45;
      } else if (spec.focus) {
        // Mute everything outside the focus a little.
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        r = r * 0.78 + l * 0.12;
        g = g * 0.78 + l * 0.12;
        b = b * 0.78 + l * 0.12;
      }
      // Limb darkening for a sense of the sphere.
      const k = 0.75 + 0.25 * w;
      out[o] = r * k;
      out[o + 1] = g * k;
      out[o + 2] = b * k;
      out[o + 3] = 255;
    }
  }
  // Borders: focus outline (strong) and other owners (faint).
  const ink = spec.ink;
  const own = spec.owner, foc = spec.focus;
  for (let py = 1; py < H - 1; py++) {
    for (let px = 1; px < W - 1; px++) {
      const i = py * W + px;
      const a = cellAt[i];
      if (a < 0) continue;
      const nb = [cellAt[i - 1], cellAt[i + 1], cellAt[i - W], cellAt[i + W]];
      let focusEdge = false, ownEdge = false;
      for (const q of nb) {
        if (q === a) continue;
        if (foc && q >= 0 && !!foc[q] !== !!foc[a]) focusEdge = true;
        if (foc && q < 0 && foc[a]) focusEdge = true;
        if (own && q >= 0 && own[q] !== own[a] && (own[q] >= 0 || own[a] >= 0)) ownEdge = true;
      }
      const o = 4 * i;
      if (focusEdge) {
        out[o] = t[0] * 0.35;
        out[o + 1] = t[1] * 0.25;
        out[o + 2] = t[2] * 0.2;
      } else if (ownEdge) {
        out[o] = out[o] * 0.55 + ink[0] * 0.45;
        out[o + 1] = out[o + 1] * 0.55 + ink[1] * 0.45;
        out[o + 2] = out[o + 2] * 0.55 + ink[2] * 0.45;
      }
    }
  }
  // Graticule every 10° (5° when zoomed in), faint.
  const stepDeg = spec.radiusDeg > 25 ? 15 : spec.radiusDeg > 10 ? 10 : 5;
  for (let py = 0; py < H; py++) {
    const v = (H / 2 - py - 0.5) * scale;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5 - W / 2) * scale;
      const rr = u * u + v * v;
      if (rr >= 1) continue;
      const w = Math.sqrt(1 - rr);
      const x = c[0] * w + e[0] * u + nn[0] * v;
      const y = c[1] * w + e[1] * u + nn[1] * v;
      const z = c[2] * w + e[2] * u + nn[2] * v;
      const lat = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
      const lon = Math.atan2(y, x) / DEG;
      const pxDeg = (scale / DEG) * 0.9;
      const dl = Math.abs(lat / stepDeg - Math.round(lat / stepDeg)) * stepDeg;
      const dn = Math.abs(lon / stepDeg - Math.round(lon / stepDeg)) * stepDeg * Math.cos(lat * DEG);
      if (dl < pxDeg * 0.5 || dn < pxDeg * 0.5) {
        const o = 4 * (py * W + px);
        out[o] = out[o] * 0.82 + 235 * 0.18;
        out[o + 1] = out[o + 1] * 0.82 + 225 * 0.18;
        out[o + 2] = out[o + 2] * 0.82 + 200 * 0.18;
      }
    }
  }
}

/** Project a unit vector into mini-map pixel coordinates (null if on the far side / outside). */
export function projectMini(spec: MiniMapSpec, p: ArrayLike<number>): [number, number] | null {
  const lat0 = spec.lat * DEG, lon0 = spec.lon * DEG;
  const cl = Math.cos(lat0), sl = Math.sin(lat0), co = Math.cos(lon0), so = Math.sin(lon0);
  const c = [cl * co, cl * so, sl];
  const e = [-so, co, 0];
  const nn = [-sl * co, -sl * so, cl];
  const dc = p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
  if (dc <= 0) return null;
  const u = p[0] * e[0] + p[1] * e[1] + p[2] * e[2];
  const v = p[0] * nn[0] + p[1] * nn[1] + p[2] * nn[2];
  const half = Math.sin(Math.min(80, spec.radiusDeg) * DEG);
  const scale = (2 * half) / Math.max(spec.width, spec.height);
  const x = u / scale + spec.width / 2, y = spec.height / 2 - v / scale;
  if (x < 0 || y < 0 || x > spec.width || y > spec.height) return null;
  return [x, y];
}
