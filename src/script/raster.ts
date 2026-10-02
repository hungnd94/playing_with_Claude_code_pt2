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
  /** Blurred, soft-saturated ink density, normalised to unit length. */
  v: Float32Array;
  norm: number;
  /**
   * Norms of the 4×4-pixel blocks of `v`. By Cauchy–Schwarz,
   * similarity(a, b) ≤ Σ_k a.blocks[k]·b.blocks[k], a cheap exact upper bound
   * used to skip most full comparisons.
   */
  blocks: Float32Array;
}

const BW = RW / 4;
const BH = RH / 4;

/**
 * Rasterise strokes. Glyphs are normalised to a common em frame: x scaled so
 * the glyph box width maps to [0,1] (narrow and wide letters still compare).
 */
const SX = RW / (X1 - X0);
const SY = RH / (Y1 - Y0);

/** Copy a raster (e.g. one made into a scratch buffer) so it can be kept. */
export function keepRaster(r: Raster): Raster {
  return { v: r.v.slice(), norm: r.norm, blocks: r.blocks.slice() };
}

/**
 * Rasterise strokes. Pass `into` (a raster to overwrite) to avoid allocating
 * for throw-away candidates; keep the result with `keepRaster`.
 */
export function rasterize(strokes: Stroke[], boxW: number, into?: Raster): Raster {
  // Accumulate on a grid padded by 2 pixels so the blur needs no edge tests.
  const acc = ACC;
  acc.fill(0);
  const sx = 1 / Math.max(0.3, boxW);
  for (const st of strokes) {
    if (st.dot !== undefined) {
      // Dots count heavily: they distinguish letters in dotted scripts.
      splatPad(acc, st.pts[0][0] * sx, st.pts[0][1], 1.6);
      continue;
    }
    const xy = sampleRaw(st, 0.045).xy;
    for (let i = 0; i < xy.length; i += 2) {
      const fx = (xy[i] * sx - X0) * SX - 0.5 + 2;
      const fy = (xy[i + 1] - Y0) * SY - 0.5 + 2;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix > PW - 2 || iy > PH - 2) continue;
      const tx = fx - ix;
      const ty = fy - iy;
      const o = iy * PW + ix;
      const a = 0.45 * (1 - ty);
      const b = 0.45 * ty;
      acc[o] += a * (1 - tx);
      acc[o + 1] += a * tx;
      acc[o + PW] += b * (1 - tx);
      acc[o + PW + 1] += b * tx;
    }
  }
  // Separable 5-tap binomial blur [1 4 6 4 1] (= two [1 2 1] passes).
  const hb = HB;
  for (let y = 0; y < PH; y++) {
    const o = y * PW;
    for (let x = 2; x < PW - 2; x++) {
      const i = o + x;
      hb[i] = acc[i - 2] + 4 * (acc[i - 1] + acc[i + 1]) + 6 * acc[i] + acc[i + 2];
    }
  }
  const g = into ? into.v : new Float32Array(RW * RH);
  const blocks = into ? into.blocks.fill(0) : new Float32Array(BW * BH);
  const val = VAL;
  let n = 0;
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const i = (y + 2) * PW + x + 2;
      const v = hb[i - 2 * PW] + 4 * (hb[i - PW] + hb[i + PW]) + 6 * hb[i] + hb[i + 2 * PW];
      // Soft-saturate so heavy overlaps do not dominate.
      val[y * RW + x] = Math.sqrt(v);
      n += v;
    }
  }
  const inv = 1 / (Math.sqrt(n) || 1);
  for (let y = 0; y < RH; y++)
    for (let x = 0; x < RW; x++) {
      const i = y * RW + x;
      const v = val[i] * inv;
      g[i] = v;
      blocks[(y >> 2) * BW + (x >> 2)] += v * v;
    }
  for (let k = 0; k < blocks.length; k++) blocks[k] = Math.sqrt(blocks[k]);
  if (into) return into;
  return { v: g, norm: 1, blocks };
}

const PW = RW + 4;
const PH = RH + 4;
const ACC = new Float64Array(PW * PH);
const HB = new Float64Array(PW * PH);
const VAL = new Float64Array(RW * RH);

function splatPad(g: Float64Array, x: number, y: number, m: number): void {
  const fx = (x - X0) * SX - 0.5 + 2;
  const fy = (y - Y0) * SY - 0.5 + 2;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix > PW - 2 || iy > PH - 2) return;
  const tx = fx - ix;
  const ty = fy - iy;
  const o = iy * PW + ix;
  g[o] += m * (1 - ty) * (1 - tx);
  g[o + 1] += m * (1 - ty) * tx;
  g[o + PW] += m * ty * (1 - tx);
  g[o + PW + 1] += m * ty * tx;
}

/** A reusable scratch raster. */
export function scratchRaster(): Raster {
  return { v: new Float32Array(RW * RH), norm: 1, blocks: new Float32Array(BW * BH) };
}

/** Cosine similarity of two rasters (1 = identical ink distribution). */
export function similarity(a: Raster, b: Raster): number {
  let s = 0;
  const av = a.v;
  const bv = b.v;
  for (let i = 0; i < av.length; i++) s += av[i] * bv[i];
  return s;
}

function bound(a: Raster, b: Raster): number {
  const ab = a.blocks;
  const bb = b.blocks;
  let s = 0;
  for (let k = 0; k < ab.length; k++) s += ab[k] * bb[k];
  return s;
}

/**
 * Highest similarity of `r` to any raster in `others`, exact; stops early
 * once it exceeds `stop`. Comparisons whose block bound cannot beat the
 * current best are skipped.
 */
export function maxSimilarity(r: Raster, others: readonly Raster[], stop = 2): number {
  let best = 0;
  for (const o of others) {
    if (bound(r, o) <= best) continue;
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
  const lines: number[][] = [];
  for (const s of strokes) if (s.dot === undefined && s.pts.length >= 2) lines.push(sampleRaw(s, 0.035).xy);
  if (lines.length < 2) return selfOverlap(lines[0] ?? [], tol);
  // Uniform grid (cell = tol) with linked buckets: near points are in the 3×3 neighbourhood.
  let N = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const xy of lines) {
    N += xy.length / 2;
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < x0) x0 = xy[i];
      if (xy[i] > x1) x1 = xy[i];
      if (xy[i + 1] < y0) y0 = xy[i + 1];
      if (xy[i + 1] > y1) y1 = xy[i + 1];
    }
  }
  const inv = 1 / tol;
  const gw = Math.floor((x1 - x0) * inv) + 3;
  const gh = Math.floor((y1 - y0) * inv) + 3;
  const head = new Int32Array(gw * gh).fill(-1);
  const next = new Int32Array(N);
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const ps = new Int32Array(N);
  const pc = new Int32Array(N);
  let k = 0;
  lines.forEach((xy, si) => {
    for (let i = 0; i < xy.length; i += 2) {
      const c = (Math.floor((xy[i + 1] - y0) * inv) + 1) * gw + Math.floor((xy[i] - x0) * inv) + 1;
      px[k] = xy[i];
      py[k] = xy[i + 1];
      ps[k] = si;
      pc[k] = c;
      next[k] = head[c];
      head[c] = k;
      k++;
    }
  });
  const t2 = tol * tol;
  let close = 0;
  for (let p = 0; p < N; p++) {
    const c0 = pc[p];
    let near = false;
    for (let dy = -gw; dy <= gw && !near; dy += gw)
      for (let dx = -1; dx <= 1 && !near; dx++) {
        for (let q = head[c0 + dy + dx]; q >= 0; q = next[q]) {
          if (ps[q] === ps[p]) continue;
          const ex = px[p] - px[q];
          const ey = py[p] - py[q];
          if (ex * ex + ey * ey < t2) {
            near = true;
            break;
          }
        }
      }
    if (near) close++;
  }
  return N ? close / N : 0;
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
