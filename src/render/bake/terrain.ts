/**
 * Terrain texture: a painterly "satellite" rendering of a PhysicalWorld as an
 * equirectangular RGBA image (DOM-free).
 *
 * RGB: colour (sRGB) with baked relief shading lit from the north-west, the
 *      cartographic convention (and consistent with the globe's upper-left sun,
 *      since the globe keeps north up).
 * A:   signed coast field, 128 + 127·clamp(k·g): ≥ 128 ⇔ land. Bilinear
 *      filtering of this channel gives a smooth, sub-texel coastline, which
 *      the globe shader uses for crisp coasts, water glint and to clip
 *      political colours at the shore.
 *
 * Pipeline (see `context.ts` for warp / locate / land decision):
 *   pass 1  per pixel: warp, locate, land/water, base colour, raw elevation, temperature
 *   pass 2  blur the raw elevation (kills triangle facets)
 *   pass 3  rolling rows: + fractal detail → hillshade, snow, rock
 *   pass 4  rivers (smoothed, meandering, tapered) composited over land
 */
import { hashInt } from "../../core/rng";
import { Noise3 } from "../../core/noise";
import { Biome, isWaterBiome } from "../../world/types";
import { blurEquirect } from "./blur";
import { bakeContext, equirectGrid, smoothstep, warpRow, type BakeContext } from "./context";
import {
  climateBiome, BIOME_RGB, LAKE_RGB, OCEAN_STOPS, RIVER_RGB, ROCK_RGB, SALT_LAKE_RGB, SEA_ICE_RGB, SNOW_RGB,
  TROPICAL_SHALLOW, TROPICAL_SHELF, BEACH_RGB,
} from "./palette";
import { buildRiverPaths, rasterizeRivers, type RiverOptions } from "./rivers";

export interface TerrainBakeOptions {
  /** Relief shading strength, 0..2 (default 1). */
  relief?: number;
  /** Vertical exaggeration multiplier for hillshading (default 1). */
  exaggeration?: number;
  /** Draw rivers (default true). */
  rivers?: boolean;
  /** River options (min order, width, meander). */
  river?: RiverOptions;
  /** Painterly colour noise strength, 0..2 (default 1). */
  texture?: number;
  /** Snow on cold peaks (default true). */
  snow?: boolean;
}

/** Coast field encoding gain: alpha = 128 + 127·clamp(g·ALPHA_GAIN). */
export const COAST_ALPHA_GAIN = 2.2;

/**
 * Bake the terrain texture. Returns RGBA8, row 0 = north, column 0 = lon −180°.
 */
export function bakeTerrain(
  world: import("../../world/types").PhysicalWorld,
  width: number,
  height: number,
  opts: TerrainBakeOptions = {},
): Uint8Array {
  const ctx = bakeContext(world);
  const N = width * height;
  const out = new Uint8Array(N * 4);
  const elev = new Float32Array(N);
  const temp = new Float32Array(N);
  /** Relief roughness per pixel, 0..255 (ice is smooth). */
  const rough = new Uint8Array(N);
  const cell = prepareCells(ctx);
  const noise = new Noise3(ctx.seedRng.fork("terrain-color"));
  const detailNoise = new Noise3(ctx.seedRng.fork("terrain-detail"));
  const texAmt = opts.texture ?? 1;

  pass1(ctx, cell, noise, width, height, out, elev, temp, rough, texAmt);

  // Pass 2: blur the raw elevation to smooth the triangle facets.
  const spacingPx = ctx.mesh.meanSpacing / (Math.PI / height);
  blurEquirect(elev, width, height, Math.max(1, 0.32 * spacingPx), 3);

  // Pass 3: detail + relief shading + snow.
  pass3(ctx, detailNoise, noise, width, height, out, elev, temp, rough, opts);

  // Pass 4: rivers.
  if (opts.rivers !== false) {
    const paths = buildRiverPaths(ctx, opts.river);
    const cov = new Uint8Array(N);
    rasterizeRivers(paths, width, height, ctx.mesh.meanSpacing, cov);
    compositeRivers(out, cov, N);
  }
  return out;
}

// ---------------------------------------------------------------------------

interface CellData {
  /** Land colour per cell (sRGB floats), 3 per cell. */
  land: Float32Array;
  /** +1 / −1 per cell, for patchy biome boundaries. */
  sign: Float32Array;
  /** Ocean depth (km, ≥ 0) per water cell; 0 for land. */
  depth: Float32Array;
  /** 1 for lake cells (salt lakes 2). */
  lake: Uint8Array;
  /** Sea ice amount 0..1 per cell. */
  ice: Float32Array;
  /** Dryness 0..1 (desert-ness), drives ochre variation. */
  arid: Float32Array;
  /** 1 for ice sheets (smooth relief), 0 otherwise. */
  glacier: Float32Array;
}

const cellCache = new WeakMap<BakeContext, CellData>();

function prepareCells(ctx: BakeContext): CellData {
  const hit = cellCache.get(ctx);
  if (hit) return hit;
  const w = ctx.world;
  const n = ctx.n;
  const land = new Float32Array(3 * n);
  const sign = new Float32Array(n);
  const depth = new Float32Array(n);
  const lake = new Uint8Array(n);
  const ice = new Float32Array(n);
  const arid = new Float32Array(n);
  const glacier = new Float32Array(n);
  const saltLake = new Uint8Array(w.lakes.length);
  for (const l of w.lakes) if (l.salty) saltLake[l.id] = 1;
  for (let i = 0; i < n; i++) {
    const b = w.biome[i];
    const e = w.elevation[i];
    const t = w.temperature[i];
    const p = w.precipitation[i];
    sign[i] = hashInt(i, 0x51ed) & 1 ? 1 : -1;
    if (ctx.wet[i]) {
      if (w.lakeId[i] >= 0) {
        lake[i] = saltLake[w.lakeId[i]] ? 2 : 1;
        depth[i] = 0.05;
      } else {
        depth[i] = Math.max(0, -e);
      }
      ice[i] = b === Biome.SeaIce ? 1 : 0;
      // Land colour of a water cell: used only for extrapolation; beach-ish.
      land[3 * i] = BEACH_RGB[0];
      land[3 * i + 1] = BEACH_RGB[1];
      land[3 * i + 2] = BEACH_RGB[2];
      continue;
    }
    // A land cell without a land biome (e.g. an unfinished generator): derive one from climate.
    const lb = isWaterBiome(b) || BIOME_RGB[b] === undefined ? climateBiome(t, p, e) : b;
    const base = BIOME_RGB[lb];
    if (lb === Biome.IceSheet) glacier[i] = 1;
    let r = base[0], g = base[1], bl = base[2];
    // Climate nudges: wetter → richer green, drier → ochre; colder → greyer.
    const wetness = smoothstep(200, 2400, p);
    const dry = 1 - smoothstep(150, 700, p);
    arid[i] = dry * smoothstep(5, 22, t);
    if (lb !== Biome.IceSheet) {
      const gk = (wetness - 0.45) * 0.16;
      r *= 1 - gk * 0.9;
      g *= 1 + gk * 0.35;
      bl *= 1 - gk * 0.5;
      // Hot deserts: shift between pale sand and red ochre per cell.
      if (lb === Biome.HotDesert || lb === Biome.Savanna) {
        const h = ((hashInt(i, 0x9a1) & 1023) / 1023) * 2 - 1;
        r += 8 * h;
        g += 2 * h;
        bl -= 5 * h;
      }
      const cold = 1 - smoothstep(-8, 6, t);
      r = r + (124 - r) * cold * 0.25;
      g = g + (122 - g) * cold * 0.25;
      bl = bl + (110 - bl) * cold * 0.25;
      // Altitude: towards bare rock.
      const rock = smoothstep(1.4, 3.6, e) * 0.65;
      r += (ROCK_RGB[0] - r) * rock;
      g += (ROCK_RGB[1] - g) * rock;
      bl += (ROCK_RGB[2] - bl) * rock;
    }
    // Small per-cell variation.
    const v = 1 + (((hashInt(i, 0x77) & 1023) / 1023) * 2 - 1) * 0.035;
    land[3 * i] = r * v;
    land[3 * i + 1] = g * v;
    land[3 * i + 2] = bl * v;
  }
  const res = { land, sign, depth, lake, ice, arid, glacier };
  cellCache.set(ctx, res);
  return res;
}

function oceanColor(d: number, out: Float64Array): void {
  const s = OCEAN_STOPS;
  if (d <= s[0].d) {
    out[0] = s[0].c[0]; out[1] = s[0].c[1]; out[2] = s[0].c[2];
    return;
  }
  for (let k = 1; k < s.length; k++) {
    if (d <= s[k].d) {
      const t = (d - s[k - 1].d) / (s[k].d - s[k - 1].d);
      const a = s[k - 1].c, b = s[k].c;
      const tt = t * t * (3 - 2 * t);
      out[0] = a[0] + (b[0] - a[0]) * tt;
      out[1] = a[1] + (b[1] - a[1]) * tt;
      out[2] = a[2] + (b[2] - a[2]) * tt;
      return;
    }
  }
  const c = s[s.length - 1].c;
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

/** Evaluate low-frequency noise every `step` pixels of a row and interpolate linearly. */
function coarseRow(
  noise: Noise3, qx: Float64Array, qy: Float64Array, qz: Float64Array,
  W: number, f: number, ox: number, step: number, out: Float64Array,
): void {
  let prevX = 0;
  let prevV = noise.noise(qx[0] * f + ox, qy[0] * f, qz[0] * f);
  out[0] = prevV;
  for (let x = step; ; x += step) {
    const xx = x >= W ? W - 1 : x;
    const v = noise.noise(qx[xx] * f + ox, qy[xx] * f, qz[xx] * f);
    const span = xx - prevX;
    for (let k = 1; k <= span; k++) out[prevX + k] = prevV + ((v - prevV) * k) / span;
    if (xx === W - 1) break;
    prevX = xx;
    prevV = v;
  }
}

function pass1(
  ctx: BakeContext, cell: CellData, noise: Noise3,
  W: number, H: number, out: Uint8Array, elev: Float32Array, temp: Float32Array, rough: Uint8Array, texAmt: number,
): void {
  const grid = equirectGrid(W, H);
  const { triangles } = ctx.mesh;
  const wet = ctx.wet;
  const E = ctx.world.elevation;
  const T = ctx.world.temperature;
  const spacing = ctx.mesh.meanSpacing;
  const bary = new Float64Array(3);
  const oc = new Float64Array(3);
  const pxRad = Math.PI / H;
  const spacingPx = spacing / pxRad;
  const fPatch = 1 / (1.1 * spacing);
  const fLow = 1 / (3.5 * spacing);
  const fHigh = 1 / (5 * pxRad);
  const stepLow = Math.max(1, Math.round((3.5 * spacingPx) / 5));
  const stepPatch = Math.max(1, Math.round((1.1 * spacingPx) / 4));
  const wr = new Float64Array(3 * W);
  const qxs = new Float64Array(W), qys = new Float64Array(W), qzs = new Float64Array(W);
  const lowRow = new Float64Array(W), patchRow = new Float64Array(W), highRow = new Float64Array(W);
  let t = ctx.locator.locateTriangle(grid.cosLat[0] * grid.cosLon[0], grid.cosLat[0] * grid.sinLon[0], grid.sinLat[0], bary);
  const land = cell.land, sign = cell.sign;
  for (let y = 0; y < H; y++) {
    const cl = grid.cosLat[y], sl = grid.sinLat[y];
    warpRow(ctx.warp, y, H, W, wr);
    for (let x = 0; x < W; x++) {
      qxs[x] = cl * grid.cosLon[x] + wr[3 * x];
      qys[x] = cl * grid.sinLon[x] + wr[3 * x + 1];
      qzs[x] = sl + wr[3 * x + 2];
    }
    coarseRow(noise, qxs, qys, qzs, W, fLow, 0, stepLow, lowRow);
    coarseRow(noise, qxs, qys, qzs, W, fPatch, 31.7, stepPatch, patchRow);
    coarseRow(noise, qxs, qys, qzs, W, fHigh, 17.3, 2, highRow);
    const rowStartTri = t;
    for (let x = 0; x < W; x++) {
      const qx = qxs[x], qy = qys[x], qz = qzs[x];
      t = ctx.locate(qx, qy, qz, x === 0 ? rowStartTri : t, bary);
      const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2];
      const wa = bary[0], wb = bary[1], wc = bary[2];
      const g = ctx.coastField(qx, qy, qz, t, bary);
      const isLand = g >= 0;
      const o = y * W + x;
      temp[o] = wa * T[a] + wb * T[b] + wc * T[c];

      let r: number, gg: number, bb: number;
      const nLow = lowRow[x];
      const nHigh = highRow[x];
      if (isLand) {
        // Land vertices only; sharpened, noise-perturbed weights → organic, patchy biome edges.
        const nP = patchRow[x] * 0.85;
        let ka = 0, kb = 0, kc = 0;
        if (!wet[a]) { const m = 1 + nP * sign[a]; ka = wa * wa * m * m; }
        if (!wet[b]) { const m = 1 + nP * sign[b]; kb = wb * wb * m * m; }
        if (!wet[c]) { const m = 1 + nP * sign[c]; kc = wc * wc * m * m; }
        let ks = ka + kb + kc;
        if (ks <= 1e-12) {
          ka = wet[a] ? 0 : 1; kb = wet[b] ? 0 : 1; kc = wet[c] ? 0 : 1;
          ks = ka + kb + kc || 1;
        }
        ka /= ks; kb /= ks; kc /= ks;
        r = ka * land[3 * a] + kb * land[3 * b] + kc * land[3 * c];
        gg = ka * land[3 * a + 1] + kb * land[3 * b + 1] + kc * land[3 * c + 1];
        bb = ka * land[3 * a + 2] + kb * land[3 * b + 2] + kc * land[3 * c + 2];
        const arid = ka * cell.arid[a] + kb * cell.arid[b] + kc * cell.arid[c];
        // Value & hue variation, like uneven washes of pigment.
        const vv = 1 + texAmt * (0.07 * nLow + (0.025 + 0.035 * arid) * nHigh);
        r *= vv * (1 + 0.025 * texAmt * nLow);
        gg *= vv;
        bb *= vv * (1 - 0.035 * texAmt * nLow);
        // Pale soil / beach right at the shore.
        if (g < 0.1) {
          const beach = (1 - g / 0.1) * 0.3 * (0.5 + 0.5 * arid);
          r += (BEACH_RGB[0] - r) * beach;
          gg += (BEACH_RGB[1] - gg) * beach;
          bb += (BEACH_RGB[2] - bb) * beach;
        }
        elev[o] = wa * Math.max(0, E[a]) + wb * Math.max(0, E[b]) + wc * Math.max(0, E[c]);
        const gl = ka * cell.glacier[a] + kb * cell.glacier[b] + kc * cell.glacier[c];
        rough[o] = Math.round(255 * (1 - 0.82 * gl));
      } else {
        let ka = wet[a] ? wa : 0, kb = wet[b] ? wb : 0, kc = wet[c] ? wc : 0;
        let ks = ka + kb + kc;
        if (ks <= 1e-12) { ka = 1; kb = 0; kc = 0; ks = 1; }
        ka /= ks; kb /= ks; kc /= ks;
        const depth0 = ka * cell.depth[a] + kb * cell.depth[b] + kc * cell.depth[c];
        // Shoaling towards the shore (only inside coastal triangles).
        const coastal = g > -0.5 ? smoothstep(-0.5, 0, g) : 0;
        const depth = depth0 * (1 - 0.45 * coastal) * (1 + 0.12 * nLow);
        oceanColor(depth, oc);
        r = oc[0]; gg = oc[1]; bb = oc[2];
        // Warm shallows go turquoise.
        const tropic = smoothstep(18, 27, temp[o]) * (1 - smoothstep(0.02, 0.4, depth));
        if (tropic > 0) {
          const sh = 1 - smoothstep(0.02, 0.3, depth);
          const tr = TROPICAL_SHELF[0] + (TROPICAL_SHALLOW[0] - TROPICAL_SHELF[0]) * sh;
          const tg = TROPICAL_SHELF[1] + (TROPICAL_SHALLOW[1] - TROPICAL_SHELF[1]) * sh;
          const tb = TROPICAL_SHELF[2] + (TROPICAL_SHALLOW[2] - TROPICAL_SHELF[2]) * sh;
          r += (tr - r) * tropic * 0.85;
          gg += (tg - gg) * tropic * 0.85;
          bb += (tb - bb) * tropic * 0.85;
        }
        const lk = (cell.lake[a] ? ka : 0) + (cell.lake[b] ? kb : 0) + (cell.lake[c] ? kc : 0);
        if (lk > 0) {
          const salty = (cell.lake[a] === 2 ? ka : 0) + (cell.lake[b] === 2 ? kb : 0) + (cell.lake[c] === 2 ? kc : 0);
          const sf = salty / lk;
          const lw = Math.min(1, lk * 1.5);
          r += (LAKE_RGB[0] + (SALT_LAKE_RGB[0] - LAKE_RGB[0]) * sf - r) * lw;
          gg += (LAKE_RGB[1] + (SALT_LAKE_RGB[1] - LAKE_RGB[1]) * sf - gg) * lw;
          bb += (LAKE_RGB[2] + (SALT_LAKE_RGB[2] - LAKE_RGB[2]) * sf - bb) * lw;
        }
        const ice = ka * cell.ice[a] + kb * cell.ice[b] + kc * cell.ice[c];
        if (ice > 0) {
          // Solid pack inside; towards the edge it breaks into floes (marginal ice zone).
          const t = ice + 0.32 * nLow + 0.3 * nHigh;
          const edge = Math.max(smoothstep(0.32, 0.62, t), smoothstep(0.85, 1, ice));
          const shade = 0.955 + 0.045 * nLow - 0.03 * (1 - ice);
          r += (SEA_ICE_RGB[0] * shade - r) * edge;
          gg += (SEA_ICE_RGB[1] * shade - gg) * edge;
          bb += (SEA_ICE_RGB[2] * shade - bb) * edge;
        }
        // Shoals and sand bars give shallow water some texture.
        const shoal = 1 - smoothstep(0.03, 0.45, depth);
        const vv = 1 + texAmt * (0.03 * nLow + 0.01 * nHigh + shoal * (0.07 * nHigh + 0.05 * nLow)) * (1 - 0.8 * Math.min(1, ice));
        r *= vv; gg *= vv; bb *= vv;
        // Pack ice floats flat: no sea-floor relief shows through it.
        const iceCover = ice > 0 ? Math.max(smoothstep(0.32, 0.62, ice + 0.32 * nLow + 0.3 * nHigh), smoothstep(0.85, 1, ice)) : 0;
        elev[o] = -depth0 * (1 - 0.6 * coastal) * (1 - iceCover);
        rough[o] = Math.round(255 * (1 - iceCover));
      }
      const p4 = 4 * o;
      out[p4] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[p4 + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
      out[p4 + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
      out[p4 + 3] = encodeCoast(g);
    }
  }
}

/** Encode the signed coast field into alpha; ≥128 ⇔ land. */
export function encodeCoast(g: number): number {
  const s = g * COAST_ALPHA_GAIN;
  if (g >= 0) return 128 + Math.min(127, Math.round(Math.min(1, s) * 127));
  return 127 - Math.min(127, Math.round(Math.min(1, -s) * 127));
}

function pass3(
  ctx: BakeContext, detailNoise: Noise3, colorNoise: Noise3,
  W: number, H: number, out: Uint8Array, elev: Float32Array, temp: Float32Array, rough: Uint8Array, opts: TerrainBakeOptions,
): void {
  const grid = equirectGrid(W, H);
  const spacing = ctx.mesh.meanSpacing;
  const pxRad = Math.PI / H;
  const pxKm = pxRad * ctx.world.params.radiusKm;
  const relief = opts.relief ?? 1;
  const doSnow = opts.snow !== false;
  // Vertical exaggeration: tuned so relief reads at globe scale; grows gently with resolution.
  const exag = 24 * (opts.exaggeration ?? 1) * Math.pow(12.9 / pxKm, 0.3);
  // Ridged detail octaves: from ~1.5 cell spacings down to ~2.2 px.
  const fMount = 1 / (1.5 * spacing);
  const fHill = 1 / (0.7 * spacing);
  const fFinest = 1 / (2.2 * pxRad);
  const oct = Math.max(2, Math.min(7, Math.round(Math.log2(fFinest / fMount)) + 1));
  const rows = [new Float32Array(W), new Float32Array(W), new Float32Array(W)];
  const det = [new Float32Array(W), new Float32Array(W), new Float32Array(W)];
  const wr = new Float64Array(3 * W);
  // Light from the north-west, ~40° above the horizon.
  let lx = -0.62, ly = 0.62, lz = 0.78;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll; ly /= ll; lz /= ll;
  const fSnow = 1 / (0.35 * spacing);

  const computeRow = (y: number, dst: Float32Array, dDst: Float32Array): void => {
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    const cl = grid.cosLat[yy], sl = grid.sinLat[yy];
    const off = yy * W;
    warpRow(ctx.warp, yy, H, W, wr);
    for (let x = 0; x < W; x++) {
      const e0 = elev[off + x];
      if (out[4 * (off + x) + 3] < 128) {
        dDst[x] = 0;
        dst[x] = e0;
        continue;
      }
      const qx = cl * grid.cosLon[x] + wr[3 * x], qy = cl * grid.sinLon[x] + wr[3 * x + 1], qz = sl + wr[3 * x + 2];
      const rk = rough[off + x] / 255;
      const mount = smoothstep(0.35, 2.4, e0) * rk;
      const hillAmp = (0.012 + 0.16 * smoothstep(0.2, 1.3, e0)) * rk;
      let d = hillAmp * detailNoise.noise(qx * fHill, qy * fHill, qz * fHill);
      if (mount > 0.01) {
        // Ridged multifractal: crests and dendritic valleys.
        let amp = 1, freq = fMount, sum = 0, norm = 0, prev = 1;
        for (let o = 0; o < oct; o++) {
          let nn = 1 - Math.abs(detailNoise.noise(qx * freq + 3.7, qy * freq - 1.3, qz * freq + 5.9));
          nn *= nn;
          sum += nn * amp * prev;
          prev = nn;
          norm += amp;
          amp *= 0.5;
          freq *= 2.1;
        }
        d += (sum / norm - 0.28) * 1.7 * mount;
      }
      dDst[x] = d;
      dst[x] = e0 + d;
    }
  };

  computeRow(-1, rows[0], det[0]);
  computeRow(0, rows[1], det[1]);
  for (let y = 0; y < H; y++) {
    computeRow(y + 1, rows[2], det[2]);
    const up = rows[0], mid = rows[1], dn = rows[2], dmid = det[1];
    const cl = Math.max(0.03, grid.cosLat[y]);
    const sl = grid.sinLat[y];
    const dxKm = 2 * pxKm * cl;
    const dyKm = 2 * pxKm;
    const off = y * W;
    for (let x = 0; x < W; x++) {
      const o = off + x;
      const p4 = 4 * o;
      const landPx = out[p4 + 3] >= 128;
      const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
      const gx = (mid[xr] - mid[xl]) / dxKm;
      const gy = (up[x] - dn[x]) / dyKm; // north is up
      const k = (landPx ? exag : exag * 0.3) * (0.35 + 0.65 * rough[o] / 255);
      const nx = -gx * k, ny = -gy * k;
      const nl = Math.sqrt(nx * nx + ny * ny + 1);
      const shade = (nx * lx + ny * ly + lz) / nl / lz; // 1 on flat ground
      const strength = (landPx ? 0.8 : 0.45) * relief;
      let m = 1 + strength * (shade - 1);
      m = m < 0.4 ? 0.4 : m > 1.3 ? 1.3 : m;
      let r = out[p4] * m, g = out[p4 + 1] * m, b = out[p4 + 2] * m;
      if (landPx && doSnow) {
        // Temperature at the detailed elevation (lapse rate 6.5 °C/km).
        const tAdj = temp[o] - 6.5 * dmid[x];
        if (tAdj < 3) {
          const ux = cl * grid.cosLon[x], uy = cl * grid.sinLon[x];
          const sn = colorNoise.noise(ux * fSnow, uy * fSnow, sl * fSnow) * 0.7 +
            colorNoise.noise(ux * fSnow * 3.1, uy * fSnow * 3.1, sl * fSnow * 3.1) * 0.3;
          let snow = smoothstep(-1.5, -9, tAdj + 3.5 * sn);
          // Steep faces shed snow.
          const slope = (Math.sqrt(gx * gx + gy * gy) * k) / 10;
          snow *= 1 - 0.6 * smoothstep(0.5, 1.4, slope);
          if (snow > 0) {
            // Snow keeps the relief: shaded faces go a cool blue-grey.
            const sm = 0.3 + 0.7 * Math.min(1.15, m);
            const cool = Math.max(0, 1 - m) * 0.5;
            r += (SNOW_RGB[0] * sm * (1 - 0.12 * cool) - r) * snow;
            g += (SNOW_RGB[1] * sm * (1 - 0.05 * cool) - g) * snow;
            b += (SNOW_RGB[2] * sm - b) * snow;
          }
        }
      }
      out[p4] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[p4 + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[p4 + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    // Rotate row buffers.
    const tr = rows[0]; rows[0] = rows[1]; rows[1] = rows[2]; rows[2] = tr;
    const td = det[0]; det[0] = det[1]; det[1] = det[2]; det[2] = td;
  }
}

function compositeRivers(out: Uint8Array, cov: Uint8Array, N: number): void {
  for (let o = 0; o < N; o++) {
    const c = cov[o];
    if (c === 0) continue;
    const p4 = 4 * o;
    if (out[p4 + 3] < 128) continue; // over water the river simply merges
    const a = (c / 255) * 0.95;
    // Slightly darker banks: shade the river by the underlying relief.
    const lum = (out[p4] * 0.3 + out[p4 + 1] * 0.59 + out[p4 + 2] * 0.11) / 110;
    const s = 0.8 + 0.25 * Math.min(1.3, lum);
    out[p4] = out[p4] + (RIVER_RGB[0] * s - out[p4]) * a;
    out[p4 + 1] = out[p4 + 1] + (RIVER_RGB[1] * s - out[p4 + 1]) * a;
    out[p4 + 2] = out[p4 + 2] + (RIVER_RGB[2] * s - out[p4 + 2]) * a;
  }
}
