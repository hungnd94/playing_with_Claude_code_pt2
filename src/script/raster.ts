/**
 * Coarse rasterisation of glyph skeletons, used to keep glyphs within a script
 * mutually distinguishable (cosine similarity of blurred bitmaps) and to
 * reject illegible tangles (strokes running on top of each other).
 */
import type { Stroke } from "./types";
import { sampleRaw } from "./geom";

export const RW = 16;
export const RH = 24;
const X0 = -0.12;
const X1 = 1.12;
const Y0 = -0.55;
const Y1 = 1.55;

export interface Raster {
  v: Float32Array;
  norm: number;
}

function splat(g: Float32Array, x: number, y: number, m: number): void {
  const fx = ((x - X0) / (X1 - X0)) * RW - 0.5;
  const fy = ((y - Y0) / (Y1 - Y0)) * RH - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  for (let dy = 0; dy <= 1; dy++) {
    const yy = iy + dy;
    if (yy < 0 || yy >= RH) continue;
    const wy = dy ? ty : 1 - ty;
    for (let dx = 0; dx <= 1; dx++) {
      const xx = ix + dx;
      if (xx < 0 || xx >= RW) continue;
      g[yy * RW + xx] += m * wy * (dx ? tx : 1 - tx);
    }
  }
}

/**
 * Rasterise strokes. Glyphs are normalised to a common em frame: x scaled so
 * the glyph box width maps to [0,1] (narrow and wide letters still compare).
 */
const TMP = new Float32Array(RW * RH);
const SX = RW / (X1 - X0);
const SY = RH / (Y1 - Y0);

export function rasterize(strokes: Stroke[], boxW: number): Raster {
  const g = new Float32Array(RW * RH);
  const sx = 1 / Math.max(0.3, boxW);
  for (const st of strokes) {
    if (st.dot !== undefined) {
      // Dots count heavily: they distinguish letters in dotted scripts.
      splat(g, st.pts[0][0] * sx, st.pts[0][1], 1.6);
      continue;
    }
    const xy = sampleRaw(st, 0.045).xy;
    for (let i = 0; i < xy.length; i += 2) {
      // inline bilinear splat
      const fx = (xy[i] * sx - X0) * SX - 0.5;
      const fy = (xy[i + 1] - Y0) * SY - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const m = 0.45;
      if (iy >= 0 && iy < RH) {
        if (ix >= 0 && ix < RW) g[iy * RW + ix] += m * (1 - tx) * (1 - ty);
        if (ix + 1 >= 0 && ix + 1 < RW) g[iy * RW + ix + 1] += m * tx * (1 - ty);
      }
      if (iy + 1 >= 0 && iy + 1 < RH) {
        if (ix >= 0 && ix < RW) g[(iy + 1) * RW + ix] += m * (1 - tx) * ty;
        if (ix + 1 >= 0 && ix + 1 < RW) g[(iy + 1) * RW + ix + 1] += m * tx * ty;
      }
    }
  }
  // Separable 5-tap binomial blur [1 4 6 4 1] (= two [1 2 1] passes).
  const tmp = TMP;
  for (let y = 0; y < RH; y++) {
    const o = y * RW;
    for (let x = 0; x < RW; x++) {
      let v = 6 * g[o + x];
      if (x > 0) v += 4 * g[o + x - 1];
      if (x > 1) v += g[o + x - 2];
      if (x < RW - 1) v += 4 * g[o + x + 1];
      if (x < RW - 2) v += g[o + x + 2];
      tmp[o + x] = v;
    }
  }
  let n = 0;
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const i = y * RW + x;
      let v = 6 * tmp[i];
      if (y > 0) v += 4 * tmp[i - RW];
      if (y > 1) v += tmp[i - 2 * RW];
      if (y < RH - 1) v += 4 * tmp[i + RW];
      if (y < RH - 2) v += tmp[i + 2 * RW];
      // Soft-saturate so heavy overlaps do not dominate.
      const sv = Math.sqrt(v);
      g[i] = sv;
      n += v;
    }
  }
  return { v: g, norm: Math.sqrt(n) || 1 };
}

export function similarity(a: Raster, b: Raster): number {
  let s = 0;
  const av = a.v;
  const bv = b.v;
  for (let i = 0; i < av.length; i++) s += av[i] * bv[i];
  return s / (a.norm * b.norm);
}

/** Highest similarity of `r` to any raster in `others` (with early exit above `stop`). */
export function maxSimilarity(r: Raster, others: readonly Raster[], stop = 2): number {
  let best = 0;
  for (const o of others) {
    const s = similarity(r, o);
    if (s > best) {
      best = s;
      if (best > stop) break;
    }
  }
  return best;
}

/**
 * Tangle score: fraction of ink that runs along (within `tol` em of) another
 * stroke for a sustained stretch. Crossings are fine; coincident strokes are not.
 */
export function overlapFraction(strokes: Stroke[], tol = 0.045): number {
  const lines = strokes.filter((s) => s.dot === undefined && s.pts.length >= 2).map((s) => sampleRaw(s, 0.035).xy);
  if (lines.length < 2) return selfOverlap(lines[0] ?? [], tol);
  // Uniform grid hash: cell = tol, so near points are in the 3×3 neighbourhood.
  const inv = 1 / tol;
  const grid = new Map<number, number[]>(); // key → [strokeIndex, x, y, ...]
  const key = (cx: number, cy: number): number => (cx + 1000) * 4096 + (cy + 1000);
  lines.forEach((xy, si) => {
    for (let i = 0; i < xy.length; i += 2) {
      const k = key(Math.floor(xy[i] * inv), Math.floor(xy[i + 1] * inv));
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(si, xy[i], xy[i + 1]);
    }
  });
  let close = 0;
  let total = 0;
  const t2 = tol * tol;
  lines.forEach((xy, si) => {
    for (let i = 0; i < xy.length; i += 2) {
      total++;
      const cx = Math.floor(xy[i] * inv);
      const cy = Math.floor(xy[i + 1] * inv);
      let near = false;
      for (let dx = -1; dx <= 1 && !near; dx++)
        for (let dy = -1; dy <= 1 && !near; dy++) {
          const cell = grid.get(key(cx + dx, cy + dy));
          if (!cell) continue;
          for (let j = 0; j < cell.length; j += 3) {
            if (cell[j] === si) continue;
            const ex = xy[i] - cell[j + 1];
            const ey = xy[i + 1] - cell[j + 2];
            if (ex * ex + ey * ey < t2) {
              near = true;
              break;
            }
          }
        }
      if (near) close++;
    }
  });
  return total ? close / total : 0;
}

function selfOverlap(xy: number[], tol: number): number {
  const n = xy.length / 2;
  if (n < 6) return 0;
  let close = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (Math.abs(i - j) < 5) continue;
      const dx = xy[2 * i] - xy[2 * j];
      const dy = xy[2 * i + 1] - xy[2 * j + 1];
      if (dx * dx + dy * dy < tol * tol * 0.5) {
        close++;
        break;
      }
    }
  }
  return close / n;
}
