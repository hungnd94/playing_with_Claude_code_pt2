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
 *   pass 1  per pixel: warp, locate, land/water, land colour, land elevation,
 *           sea depth, temperature, lake fractions, colour noise
 *   pass 2  blur land elevation (kills triangle facets) and, at half
 *           resolution, the sea depth (soft shelves; land counts as depth 0,
 *           so coasts shoal naturally and land relief never bleeds into the sea)
 *   pass 3  rolling rows: water colour (depth gradient, tropical shallows,
 *           lakes, procedural sea ice), land detail → hillshade, snow
 *   pass 4  rivers (smoothed, meandering, tapered) composited over land
 */
import { hashInt } from "../../core/rng";
import { Noise3 } from "../../core/noise";
import { Biome, isWaterBiome, type PhysicalWorld } from "../../world/types";
import { blurEquirect } from "./blur";
import { bakeContext, equirectGrid, smoothstep as smoothstepImported, warpRow, type BakeContext } from "./context";
import {
  climateBiome, BIOME_RGB, LAKE_RGB, OCEAN_STOPS, RIVER_RGB, ROCK_RGB, SALT_LAKE_RGB, SEA_ICE_RGB, SNOW_RGB,
  TROPICAL_SHALLOW, TROPICAL_SHELF, BEACH_RGB, LAKE_ICE_RGB, THIN_ICE_RGB, SILT_RGB,
} from "./palette";
import { buildRiverPaths, rasterizeRivers, type RiverOptions } from "./rivers";

// Module-local alias: hot loops call it millions of times, and some module
// systems (CommonJS interop) route imported bindings through getters.
const smoothstep = smoothstepImported;

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
  /** Called with the duration of each stage (ms), for profiling. */
  profile?: (stage: string, ms: number) => void;
}

/** Coast field encoding gain: alpha = 128 + 127·clamp(g·ALPHA_GAIN). */
export const COAST_ALPHA_GAIN = 2.2;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Bake the terrain texture. Returns RGBA8, row 0 = north, column 0 = lon −180°.
 */
export function bakeTerrain(world: PhysicalWorld, width: number, height: number, opts: TerrainBakeOptions = {}): Uint8Array {
  const prof = opts.profile;
  let t0 = now();
  const lap = (stage: string): void => {
    if (!prof) return;
    const t = now();
    prof(stage, t - t0);
    t0 = t;
  };
  const ctx = bakeContext(world);
  lap("context");
  const N = width * height;
  const buf: Buffers = {
    out: new Uint8Array(N * 4),
    elev: new Float32Array(N),
    depthHalf: new Float32Array((width >> 1) * (height >> 1)),
    temp: new Float32Array(N),
    rough: new Uint8Array(N),
    nLow: new Int8Array(N),
    nHigh: new Int8Array(N),
  };
  const cell = prepareCells(ctx);
  const noise = new Noise3(ctx.seedRng.fork("terrain-color"));
  const detailNoise = new Noise3(ctx.seedRng.fork("terrain-detail"));
  const iceNoise = new Noise3(ctx.seedRng.fork("terrain-ice"));
  const texAmt = opts.texture ?? 1;
  lap("cells");

  pass1(ctx, cell, noise, width, height, buf, texAmt);
  lap("pass1");

  // Pass 2: blur the land elevation to smooth the triangle facets; blur the sea
  // depth more widely (at half resolution: it is smooth by nature).
  const spacingPx = ctx.mesh.meanSpacing / (Math.PI / height);
  blurEquirect(buf.elev, width, height, Math.max(1, 0.32 * spacingPx), 3);
  const hw = width >> 1, hh = height >> 1;
  const depthHalf = buf.depthHalf;
  blurEquirect(depthHalf, hw, hh, Math.max(1, 0.42 * spacingPx * 0.5), 3);
  lap("blur");

  // Pass 3: water colour + detail + relief shading + snow.
  pass3(ctx, cell, detailNoise, noise, iceNoise, width, height, buf, depthHalf, opts);
  lap("pass3");

  // Pass 4: rivers.
  if (opts.rivers !== false) {
    const paths = buildRiverPaths(ctx, opts.river);
    const cov = new Uint8Array(N);
    rasterizeRivers(paths, width, height, ctx.mesh.meanSpacing, cov);
    compositeRivers(buf.out, cov, N);
    lap("rivers");
  }
  return buf.out;
}

// ---------------------------------------------------------------------------

interface Buffers {
  out: Uint8Array;
  /** Land elevation (km, ≥ 0); 0 over water. */
  elev: Float32Array;
  /** Sea depth (km, ≥ 0; 0 over land) at half resolution (2×2 box average). */
  depthHalf: Float32Array;
  temp: Float32Array;
  /** Relief roughness per pixel, 0..255 (ice sheets are smooth). */
  rough: Uint8Array;
  /** Low / high frequency colour noise, ×127. */
  nLow: Int8Array;
  nHigh: Int8Array;
}

interface CellData {
  /** Land colour per cell (sRGB floats), 3 per cell. */
  land: Float32Array;
  /** +1 / −1 per cell, for patchy biome boundaries. */
  sign: Float32Array;
  /** Ocean depth (km, ≥ 0) per water cell; 0 for land. */
  depth: Float32Array;
  /** 1 for lake cells (salt lakes 2). */
  lake: Uint8Array;
  /** Dryness 0..1 (desert-ness), drives ochre variation. */
  arid: Float32Array;
  /** 1 for ice sheets (smooth relief), 0 otherwise. */
  glacier: Float32Array;
  /** Temperature (°C) at which open sea freezes over in this world (from its SeaIce cells). */
  iceT: number;
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
  const arid = new Float32Array(n);
  const glacier = new Float32Array(n);
  const saltLake = new Uint8Array(w.lakes.length);
  for (const l of w.lakes) if (l.salty) saltLake[l.id] = 1;
  // Freezing threshold: midway between the warmest pack-ice cell and the
  // coldest open-sea cell that is warmer than it (so pixels agree with cells).
  let warmestIce = -Infinity;
  for (let i = 0; i < n; i++) if (w.biome[i] === Biome.SeaIce) warmestIce = Math.max(warmestIce, w.temperature[i]);
  let coldestOpen = Infinity;
  if (warmestIce > -Infinity) {
    for (let i = 0; i < n; i++) {
      if (!ctx.wet[i] || w.lakeId[i] >= 0 || w.biome[i] === Biome.SeaIce) continue;
      const t = w.temperature[i];
      if (t >= warmestIce - 3 && t < coldestOpen) coldestOpen = t;
    }
  }
  const iceT = warmestIce === -Infinity ? -1e9 : coldestOpen === Infinity ? warmestIce : 0.5 * (warmestIce + Math.max(warmestIce, coldestOpen));

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
      // Hot deserts: shift between pale sand and ochre per cell.
      if (lb === Biome.HotDesert || lb === Biome.Savanna) {
        const h = ((hashInt(i, 0x9a1) & 1023) / 1023) * 2 - 1;
        r += 7 * h;
        g += 4 * h;
        bl -= 3 * h;
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
  const res = { land, sign, depth, lake, arid, glacier, iceT };
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

/**
 * Evaluate noise every `step` pixels of a row (positions px, py, pz) and
 * interpolate linearly; pixels outside [from, to) are left untouched.
 */
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

/** Noise sampling step along a row: pixels near the poles are narrow on the sphere. */
function rowStep(base: number, cosLat: number, max: number): number {
  return Math.max(1, Math.min(max, Math.round(base / Math.max(cosLat, 1e-3))));
}

function pass1(ctx: BakeContext, cell: CellData, noise: Noise3, W: number, H: number, buf: Buffers, texAmt: number): void {
  const { out, elev, depthHalf, temp, rough, nLow: nLowBuf, nHigh: nHighBuf } = buf;
  const hw = W >> 1, hh = H >> 1;
  const coastOct = ctx.coastOctavesFor(H);
  const grid = equirectGrid(W, H);
  const { triangles } = ctx.mesh;
  const wet = ctx.wet;
  const E = ctx.world.elevation;
  const T = ctx.world.temperature;
  const spacing = ctx.mesh.meanSpacing;
  const bary = new Float64Array(3);
  const pxRad = Math.PI / H;
  const spacingPx = spacing / pxRad;
  const fPatch = 1 / (1.1 * spacing);
  const fLow = 1 / (3.5 * spacing);
  const fHigh = 1 / (5 * pxRad);
  const stepLow0 = Math.max(1, (3.5 * spacingPx) / 5);
  const stepPatch0 = Math.max(1, (1.1 * spacingPx) / 4);
  const wr = new Float64Array(3 * W);
  const qxs = new Float64Array(W), qys = new Float64Array(W), qzs = new Float64Array(W);
  const lowRow = new Float64Array(W), patchRow = new Float64Array(W), highRow = new Float64Array(W);
  let t = ctx.locator.locateTriangle(grid.cosLat[0] * grid.cosLon[0], grid.cosLat[0] * grid.sinLon[0], grid.sinLat[0], bary);
  const land = cell.land, sign = cell.sign, cDepth = cell.depth, cLake = cell.lake, cArid = cell.arid, cGlacier = cell.glacier;
  for (let y = 0; y < H; y++) {
    const cl = grid.cosLat[y], sl = grid.sinLat[y];
    warpRow(ctx.warp, y, H, W, wr);
    for (let x = 0; x < W; x++) {
      qxs[x] = cl * grid.cosLon[x] + wr[3 * x];
      qys[x] = cl * grid.sinLon[x] + wr[3 * x + 1];
      qzs[x] = sl + wr[3 * x + 2];
    }
    coarseRow(noise, qxs, qys, qzs, W, fLow, 0, rowStep(stepLow0, cl, W >> 3), lowRow);
    coarseRow(noise, qxs, qys, qzs, W, fPatch, 31.7, rowStep(stepPatch0, cl, W >> 4), patchRow);
    coarseRow(noise, qxs, qys, qzs, W, fHigh, 17.3, rowStep(2, cl, 16), highRow);
    const rowStartTri = t;
    for (let x = 0; x < W; x++) {
      const qx = qxs[x], qy = qys[x], qz = qzs[x];
      t = ctx.locate(qx, qy, qz, x === 0 ? rowStartTri : t, bary);
      const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2];
      const wa = bary[0], wb = bary[1], wc = bary[2];
      const g = ctx.coastField(qx, qy, qz, t, bary, coastOct);
      const isLand = g >= 0;
      const o = y * W + x;
      temp[o] = wa * T[a] + wb * T[b] + wc * T[c];
      const nLow = lowRow[x];
      const nHigh = highRow[x];
      nLowBuf[o] = Math.round(nLow * 127);
      nHighBuf[o] = Math.round(nHigh * 127);
      const p4 = 4 * o;
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
        let r = ka * land[3 * a] + kb * land[3 * b] + kc * land[3 * c];
        let gg = ka * land[3 * a + 1] + kb * land[3 * b + 1] + kc * land[3 * c + 1];
        let bb = ka * land[3 * a + 2] + kb * land[3 * b + 2] + kc * land[3 * c + 2];
        const arid = ka * cArid[a] + kb * cArid[b] + kc * cArid[c];
        // Value & hue variation, like uneven washes of pigment.
        const vv = 1 + texAmt * (0.07 * nLow + (0.025 + 0.02 * arid) * nHigh);
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
        elev[o] = wa * (E[a] > 0 ? E[a] : 0) + wb * (E[b] > 0 ? E[b] : 0) + wc * (E[c] > 0 ? E[c] : 0);
        const gl = ka * cGlacier[a] + kb * cGlacier[b] + kc * cGlacier[c];
        rough[o] = Math.round(255 * (1 - 0.82 * gl));
        out[p4] = r < 0 ? 0 : r > 255 ? 255 : r;
        out[p4 + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        out[p4 + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
      } else {
        let ka = wet[a] ? wa : 0, kb = wet[b] ? wb : 0, kc = wet[c] ? wc : 0;
        let ks = ka + kb + kc;
        if (ks <= 1e-12) { ka = 1; kb = 0; kc = 0; ks = 1; }
        ka /= ks; kb /= ks; kc /= ks;
        const dep = ka * cDepth[a] + kb * cDepth[b] + kc * cDepth[c];
        if ((y >> 1) < hh && (x >> 1) < hw) depthHalf[(y >> 1) * hw + (x >> 1)] += 0.25 * dep;
        // Lake fraction (R) and salty fraction (G); the colour is made in pass 3.
        const lk = (cLake[a] ? ka : 0) + (cLake[b] ? kb : 0) + (cLake[c] ? kc : 0);
        const salty = (cLake[a] === 2 ? ka : 0) + (cLake[b] === 2 ? kb : 0) + (cLake[c] === 2 ? kc : 0);
        out[p4] = Math.round(Math.min(1, lk * 1.5) * 255);
        out[p4 + 1] = lk > 0 ? Math.round((salty / lk) * 255) : 0;
        out[p4 + 2] = 0;
        rough[o] = 255;
      }
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

/** Bilinear ×2 upsample of one row of a half-resolution equirect image (wrapping in x). */
function upsampleRow(half: Float32Array, hw: number, hh: number, y: number, out: Float32Array, tmp: Float32Array): void {
  const fy = (y + 0.5) / 2 - 0.5;
  const y0f = Math.floor(fy);
  const ty = fy - y0f;
  const y0 = y0f < 0 ? 0 : y0f >= hh ? hh - 1 : y0f;
  const y1 = y0f + 1 >= hh ? hh - 1 : y0f + 1 < 0 ? 0 : y0f + 1;
  const r0 = y0 * hw, r1 = y1 * hw;
  for (let x = 0; x < hw; x++) tmp[x] = half[r0 + x] + (half[r1 + x] - half[r0 + x]) * ty;
  // Pixel 2k sits at k − 1/4, pixel 2k+1 at k + 1/4.
  for (let k = 0; k < hw; k++) {
    const km = k === 0 ? hw - 1 : k - 1, kp = k === hw - 1 ? 0 : k + 1;
    out[2 * k] = 0.75 * tmp[k] + 0.25 * tmp[km];
    out[2 * k + 1] = 0.75 * tmp[k] + 0.25 * tmp[kp];
  }
  if (out.length > 2 * hw) out[out.length - 1] = tmp[hw - 1];
}

function pass3(
  ctx: BakeContext, cell: CellData, detailNoise: Noise3, colorNoise: Noise3, iceNoise: Noise3,
  W: number, H: number, buf: Buffers, depthHalf: Float32Array, opts: TerrainBakeOptions,
): void {
  const { out, elev, temp, rough, nLow: nLowBuf, nHigh: nHighBuf } = buf;
  const grid = equirectGrid(W, H);
  const spacing = ctx.mesh.meanSpacing;
  const pxRad = Math.PI / H;
  const pxKm = pxRad * ctx.world.params.radiusKm;
  const relief = opts.relief ?? 1;
  const texAmt = opts.texture ?? 1;
  const doSnow = opts.snow !== false;
  const iceT = cell.iceT;
  // Vertical exaggeration: tuned so relief reads at globe scale; grows gently with resolution.
  const exag = 24 * (opts.exaggeration ?? 1) * Math.pow(12.9 / pxKm, 0.3);
  // Ridged detail octaves: from ~1.5 cell spacings down to ~2.2 px.
  const fMount = 1 / (1.5 * spacing);
  const fHill = 1 / (0.7 * spacing);
  const fFinest = 1 / (2.2 * pxRad);
  const oct = Math.max(2, Math.min(7, Math.round(Math.log2(fFinest / fMount)) + 1));
  const hw = W >> 1, hh = H >> 1;
  const rows = [new Float32Array(W), new Float32Array(W), new Float32Array(W)];
  const det = [new Float32Array(W), new Float32Array(W), new Float32Array(W)];
  const depthRow = new Float32Array(W);
  const upTmp = new Float32Array(hw);
  const wr = new Float64Array(3 * W);
  const pxs = new Float64Array(W), pys = new Float64Array(W), pzs = new Float64Array(W);
  const ice0 = new Float64Array(W), iceA = new Float64Array(W), iceB = new Float64Array(W), iceF = new Float64Array(W), iceL = new Float64Array(W);
  const oc = new Float64Array(3);
  // Light from the north-west, ~40° above the horizon.
  let lx = -0.62, ly = 0.62, lz = 0.78;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll; ly /= ll; lz /= ll;
  const fSnow = 1 / (0.35 * spacing);
  // Sea ice noise: continent-scale lobes (tens of degrees), tongues, bays, floes, leads.
  const fIce0 = 1.9;
  const fIce1 = 1 / (5 * spacing), fIce2 = 1 / (1.6 * spacing), fFloe = 1 / (0.32 * spacing), fLead = 1 / (2.4 * spacing);
  const pxSpacing = spacing / pxRad;

  /**
   * Height row yy (land: blurred elevation + fractal detail; water: −blurred
   * depth, flat under ice). When `colour` is set, also writes the water
   * albedo of the row into `out`.
   */
  const computeRow = (y: number, dst: Float32Array, dDst: Float32Array, colour: boolean): void => {
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    const cl = grid.cosLat[yy], sl = grid.sinLat[yy];
    const off = yy * W;
    upsampleRow(depthHalf, hw, hh, yy, depthRow, upTmp);
    warpRow(ctx.warp, yy, H, W, wr);
    // Cold water in this row? Then evaluate the ice noise (coarsely near the poles).
    let minT = Infinity;
    for (let x = 0; x < W; x++) if (out[4 * (off + x) + 3] < 128 && temp[off + x] < minT) minT = temp[off + x];
    const iceRow = minT < iceT + 18; // max noise lift (≈ 15 °C) + edge width
    let hasIce = false;
    if (iceRow) {
      for (let x = 0; x < W; x++) {
        pxs[x] = cl * grid.cosLon[x];
        pys[x] = cl * grid.sinLon[x];
        pzs[x] = sl;
      }
      coarseRow(iceNoise, pxs, pys, pzs, W, fIce0, 71.3, rowStep(2 * pxSpacing, cl, W >> 3), ice0);
      coarseRow(iceNoise, pxs, pys, pzs, W, fIce1, 0, rowStep(0.5 * pxSpacing, cl, W >> 3), iceA);
      coarseRow(iceNoise, pxs, pys, pzs, W, fIce2, 13.1, rowStep(0.25 * pxSpacing, cl, W >> 4), iceB);
      // Effective freezing temperature per pixel; fine noise only if some pixel freezes.
      for (let x = 0; x < W; x++) {
        const o = off + x;
        const Te = temp[o] + 10 * ice0[x] + 3.0 * iceA[x] + 1.3 * iceB[x] + 0.6 * (nHighBuf[o] / 127);
        iceA[x] = Te; // reuse: iceA now holds Te (its noise value is folded in)
        if (out[4 * o + 3] < 128 && Te < iceT + 2.6) hasIce = true;
      }
      if (hasIce) {
        coarseRow(iceNoise, pxs, pys, pzs, W, fFloe, 27.9, rowStep(1, cl, 8), iceF);
        coarseRow(iceNoise, pxs, pys, pzs, W, fLead, 41.3, rowStep(1, cl, 8), iceL);
      }
    }
    for (let x = 0; x < W; x++) {
      const o = off + x;
      const p4 = 4 * o;
      if (out[p4 + 3] < 128) {
        // ---- water
        const d = depthRow[x];
        let cover = 0;
        let lead = 0;
        let conc = 0;
        if (hasIce) {
          const Te = iceA[x];
          conc = smoothstep(iceT + 2.6, iceT - 2.2, Te);
          if (conc > 0) {
            // Solid pack inside; towards the edge it breaks into floes.
            cover = conc >= 0.985 ? 1 : smoothstep(0.4, 0.6, conc + 0.5 * iceF[x] * (1 - conc * conc));
            // Leads: thin cracks of open water through the pack.
            // Leads: long thin cracks of open water, only in parts of the pack.
            const ridge = 1 - Math.abs(iceL[x]);
            lead = smoothstep(0.95, 0.993, ridge) * smoothstep(0.6, 0.95, conc) * smoothstep(0.05, 0.45, iceB[x]) * 0.55;
          }
        }
        dst[x] = -d * (1 - cover);
        dDst[x] = 0;
        if (!colour) continue;
        const nLow = nLowBuf[o] / 127, nHigh = nHighBuf[o] / 127;
        const depth = d * (1 + 0.1 * nLow);
        oceanColor(depth, oc);
        let r = oc[0], gg = oc[1], bb = oc[2];
        // Warm shallows go turquoise.
        const tropic = smoothstep(18, 27, temp[o]) * (1 - smoothstep(0.03, 0.45, depth));
        if (tropic > 0) {
          const sh = 1 - smoothstep(0.02, 0.3, depth);
          const tr = TROPICAL_SHELF[0] + (TROPICAL_SHALLOW[0] - TROPICAL_SHELF[0]) * sh;
          const tg = TROPICAL_SHELF[1] + (TROPICAL_SHALLOW[1] - TROPICAL_SHELF[1]) * sh;
          const tb = TROPICAL_SHELF[2] + (TROPICAL_SHALLOW[2] - TROPICAL_SHELF[2]) * sh;
          r += (tr - r) * tropic * 0.85;
          gg += (tg - gg) * tropic * 0.85;
          bb += (tb - bb) * tropic * 0.85;
        }
        const lk = out[p4] / 255;
        if (lk > 0) {
          const sf = out[p4 + 1] / 255;
          let lr = LAKE_RGB[0] + (SALT_LAKE_RGB[0] - LAKE_RGB[0]) * sf;
          let lg = LAKE_RGB[1] + (SALT_LAKE_RGB[1] - LAKE_RGB[1]) * sf;
          let lb = LAKE_RGB[2] + (SALT_LAKE_RGB[2] - LAKE_RGB[2]) * sf;
          // Frozen lakes in the cold.
          const frozen = smoothstep(-3, -9, temp[o] + 2 * nLow);
          lr += (LAKE_ICE_RGB[0] - lr) * frozen;
          lg += (LAKE_ICE_RGB[1] - lg) * frozen;
          lb += (LAKE_ICE_RGB[2] - lb) * frozen;
          r += (lr - r) * lk;
          gg += (lg - gg) * lk;
          bb += (lb - bb) * lk;
        }
        // Very shallow water is turbid: silt and sand bars tint it towards grey-green.
        const silt = (1 - smoothstep(0.0, 0.16, depth)) * (0.45 + 0.4 * nLow + 0.15 * nHigh) * (1 - lk);
        if (silt > 0) {
          r += (SILT_RGB[0] - r) * silt * 0.5;
          gg += (SILT_RGB[1] - gg) * silt * 0.5;
          bb += (SILT_RGB[2] - bb) * silt * 0.5;
        }
        // Shoals and sand bars give shallow water some texture.
        const shoal = 1 - smoothstep(0.03, 0.45, depth);
        const vv = 1 + texAmt * (0.03 * nLow + 0.012 * nHigh + shoal * (0.06 * nHigh + 0.05 * nLow));
        r *= vv; gg *= vv; bb *= vv;
        if (cover > 0) {
          // Pack ice: white, bluer where thin (low concentration), dark leads.
          // Thin young ice near the edge, and mottling inside the pack.
          const thin = Math.max(1 - smoothstep(0.55, 0.95, conc), 0.3 * smoothstep(0.15, 0.75, iceB[x]));
          const shade = 0.95 + 0.035 * ice0[x] + 0.03 * nLow + 0.012 * nHigh;
          const ir = (SEA_ICE_RGB[0] + (THIN_ICE_RGB[0] - SEA_ICE_RGB[0]) * thin) * shade;
          const ig = (SEA_ICE_RGB[1] + (THIN_ICE_RGB[1] - SEA_ICE_RGB[1]) * thin) * shade;
          const ib = (SEA_ICE_RGB[2] + (THIN_ICE_RGB[2] - SEA_ICE_RGB[2]) * thin) * shade;
          const k = cover * (1 - lead);
          r += (ir - r) * k;
          gg += (ig - gg) * k;
          bb += (ib - bb) * k;
        }
        out[p4] = r < 0 ? 0 : r > 255 ? 255 : r;
        out[p4 + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        out[p4 + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        rough[o] = Math.round(255 * (1 - cover));
        continue;
      }
      // ---- land
      const e0 = elev[o];
      const qx = cl * grid.cosLon[x] + wr[3 * x], qy = cl * grid.sinLon[x] + wr[3 * x + 1], qz = sl + wr[3 * x + 2];
      const rk = rough[o] / 255;
      const mount = smoothstep(0.35, 2.4, e0) * rk;
      const hillAmp = (0.012 + 0.16 * smoothstep(0.2, 1.3, e0)) * rk;
      let d = hillAmp * detailNoise.noise(qx * fHill, qy * fHill, qz * fHill);
      if (mount > 0.01) {
        // Ridged multifractal: crests and dendritic valleys.
        let amp = 1, freq = fMount, sum = 0, norm = 0, prev = 1;
        for (let k = 0; k < oct; k++) {
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

  computeRow(-1, rows[0], det[0], false);
  computeRow(0, rows[1], det[1], true);
  for (let y = 0; y < H; y++) {
    computeRow(y + 1, rows[2], det[2], y + 1 < H);
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
      const rk = rough[o] / 255;
      const k = (landPx ? exag : exag * 0.55) * (0.35 + 0.65 * rk);
      const nx = -gx * k, ny = -gy * k;
      const nl = Math.sqrt(nx * nx + ny * ny + 1);
      const shade = (nx * lx + ny * ly + lz) / nl / lz; // 1 on flat ground
      const strength = (landPx ? 0.8 : 0.5 * rk) * relief;
      let m = 1 + strength * (shade - 1);
      m = m < 0.4 ? 0.4 : m > 1.3 ? 1.3 : m;
      let r = out[p4] * m, g = out[p4 + 1] * m, b = out[p4 + 2] * m;
      if (landPx && doSnow) {
        // Temperature at the detailed elevation (lapse rate 6.5 °C/km).
        // (Damped: the fractal detail is exaggerated, and full coupling dots every crest with snow.)
        const tAdj = temp[o] - 4.5 * dmid[x];
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
