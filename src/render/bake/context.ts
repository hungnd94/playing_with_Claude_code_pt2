/**
 * Shared machinery for texture baking (DOM-free; runs in a worker or Node).
 *
 * Every baker samples the world on an equirectangular grid through the same
 * three steps, which is what keeps the terrain texture, the cell-id texture
 * and the GPU overlay consistent with each other:
 *
 *  1. **Warp.** Each pixel direction p is displaced by a smooth vector field
 *     (a fixed-resolution lattice, bilinearly interpolated, quantised exactly
 *     as the GPU will see it) to q = p + warp(p). All world fields are then
 *     evaluated at q, so cell boundaries, coastlines and biome edges stop
 *     looking like a triangulation.
 *  2. **Locate.** q is located in the Delaunay triangulation by a visibility
 *     walk starting from the previous pixel's triangle (almost always 0–1
 *     steps), giving barycentric weights of the three surrounding cells.
 *  3. **Land/water.** `coastField` blends per-cell signed "landness" values
 *     with fractal noise. Triangles whose three cells agree are decided by
 *     the cells alone; only mixed triangles consult the noise, so a land pixel
 *     always has a land cell among its three vertices (and vice versa).
 */
import { Noise3 } from "../../core/noise";
import { Rng } from "../../core/rng";
import { CellLocator, type SphereMesh } from "../../core/sphere";
import type { PhysicalWorld } from "../../world/types";

/** Amplitude bound for the coast noise; < min |cell field| so pure triangles can't flip at shared edges. */
const COAST_NOISE_MAX = 0.47;

export class BakeContext {
  readonly world: PhysicalWorld;
  readonly mesh: SphereMesh;
  readonly n: number;
  /** 1 if the cell is water for rendering purposes (ocean or lake). */
  readonly wet: Uint8Array;
  /** Signed landness per cell: [0.5, 1] for land, [-1, -0.5] for water. */
  readonly field: Float32Array;
  /** Per-triangle edge-plane normals: for edge k (v_k → v_k+1), n = v_k × v_k+1. 9 doubles per triangle. */
  readonly edgeN: Float64Array;
  readonly locator: CellLocator;
  /** Warp lattice (shared with the GPU via `bakeWarp`). */
  readonly warp: WarpLattice;
  readonly coastNoise: Noise3;
  /** Base frequency of the coast noise (≈ 1 / (0.9·cell spacing)). */
  readonly coastFreq: number;
  readonly coastOctaves: number;
  readonly seedRng: Rng;

  constructor(world: PhysicalWorld) {
    this.world = world;
    const mesh = (this.mesh = world.mesh);
    const n = (this.n = mesh.n);
    this.seedRng = new Rng(world.params.seed).fork("render-bake");

    const wet = (this.wet = new Uint8Array(n));
    const field = (this.field = new Float32Array(n));
    for (let i = 0; i < n; i++) {
      const isWet = !world.isLand[i] || world.lakeId[i] >= 0;
      wet[i] = isWet ? 1 : 0;
      const e = world.elevation[i];
      if (isWet) {
        const depth = world.lakeId[i] >= 0 ? 0.25 : Math.max(0, -e);
        field[i] = -(0.5 + 0.5 * smoothstep(0, 0.6, depth));
      } else {
        field[i] = 0.5 + 0.5 * smoothstep(0, 0.9, Math.max(0, e));
      }
    }

    const { xyz, triangles, numTris } = mesh;
    const edgeN = (this.edgeN = new Float64Array(9 * numTris));
    for (let t = 0; t < numTris; t++) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * t + k];
        const b = triangles[3 * t + (k === 2 ? 0 : k + 1)];
        const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2];
        const bx = xyz[3 * b], by = xyz[3 * b + 1], bz = xyz[3 * b + 2];
        edgeN[9 * t + 3 * k] = ay * bz - az * by;
        edgeN[9 * t + 3 * k + 1] = az * bx - ax * bz;
        edgeN[9 * t + 3 * k + 2] = ax * by - ay * bx;
      }
    }
    this.locator = new CellLocator(mesh);
    this.warp = buildWarpLattice(mesh, this.seedRng.fork("warp"));
    this.coastNoise = new Noise3(this.seedRng.fork("coast"));
    this.coastFreq = 1 / (0.9 * mesh.meanSpacing);
    // Octaves down to ≈ 1/10 of a cell spacing (bakers may use fewer at low resolution).
    this.coastOctaves = 4;
  }

  /**
   * Find the triangle containing direction (x,y,z) (need not be normalised),
   * walking from triangle `t`. Writes barycentric weights (a, b, c) to `bary`.
   */
  locate(x: number, y: number, z: number, t: number, bary: Float64Array): number {
    const edgeN = this.edgeN;
    const halfedges = this.mesh.halfedges;
    let prev = -1;
    for (let iter = 0; iter < 400; iter++) {
      const o = 9 * t;
      const d0 = edgeN[o] * x + edgeN[o + 1] * y + edgeN[o + 2] * z;
      const d1 = edgeN[o + 3] * x + edgeN[o + 4] * y + edgeN[o + 5] * z;
      const d2 = edgeN[o + 6] * x + edgeN[o + 7] * y + edgeN[o + 8] * z;
      // Leave through the most violated edge (but never straight back).
      let k = -1;
      let worst = -1e-15;
      if (d0 < worst) { worst = d0; k = 0; }
      if (d1 < worst) { worst = d1; k = 1; }
      if (d2 < worst) { worst = d2; k = 2; }
      if (k < 0) {
        // Weight of a vertex = signed volume of the opposite edge's plane.
        const s = d0 + d1 + d2;
        bary[0] = d1 / s; // a (opposite edge b→c)
        bary[1] = d2 / s; // b (opposite edge c→a)
        bary[2] = d0 / s; // c (opposite edge a→b)
        return t;
      }
      const next = (halfedges[3 * t + k] / 3) | 0;
      if (next === prev) {
        // Ping-pong on a near-degenerate edge: accept the current triangle.
        const s = Math.max(1e-300, Math.max(0, d0) + Math.max(0, d1) + Math.max(0, d2));
        bary[0] = Math.max(0, d1) / s;
        bary[1] = Math.max(0, d2) / s;
        bary[2] = Math.max(0, d0) / s;
        return t;
      }
      prev = t;
      t = next;
    }
    // Pathological: fall back to the global locator.
    const l = Math.hypot(x, y, z);
    return this.locator.locateTriangle(x / l, y / l, z / l, bary);
  }

  /**
   * Signed land field at q inside triangle t with weights `bary`:
   * > 0 is land, < 0 water. Pure triangles never consult noise.
   */
  coastField(qx: number, qy: number, qz: number, t: number, bary: Float64Array, octaves = this.coastOctaves): number {
    const tri = this.mesh.triangles;
    const f = this.field;
    const fa = f[tri[3 * t]], fb = f[tri[3 * t + 1]], fc = f[tri[3 * t + 2]];
    const g = bary[0] * fa + bary[1] * fb + bary[2] * fc;
    if ((fa > 0) === (fb > 0) && (fb > 0) === (fc > 0)) return g;
    return g + this.coastNoiseAt(qx, qy, qz, octaves);
  }

  /**
   * Bounded fractal noise for coastlines, in (−COAST_NOISE_MAX, COAST_NOISE_MAX).
   * Bakers pass fewer octaves at low resolution (sub-pixel detail is invisible);
   * images of the same size always agree.
   */
  coastNoiseAt(x: number, y: number, z: number, octaves = this.coastOctaves): number {
    const fr = this.coastFreq;
    const nz = this.coastNoise;
    let amp = 1, freq = fr, sum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * nz.noise(x * freq, y * freq, z * freq);
      freq *= 2.03;
      amp *= 0.55;
    }
    // Soft clamp keeps the shapes, bounds the amplitude.
    return COAST_NOISE_MAX * Math.tanh(sum * 0.95);
  }

  /**
   * Coast noise octaves worth evaluating for an equirectangular image of
   * height H: down to a wavelength of ≈ 1.5 px. Bakes of the same size agree.
   */
  coastOctavesFor(H: number): number {
    const wl0 = (0.9 * this.mesh.meanSpacing) / (Math.PI / H); // px
    return Math.max(2, Math.min(this.coastOctaves, 1 + Math.ceil(Math.log2(wl0 / 1.5) / Math.log2(2.03))));
  }

  /**
   * Same-class cell nearest to q (greedy walk among cells of the pixel's class),
   * starting from the best vertex of triangle t.
   */
  ownerCell(qx: number, qy: number, qz: number, t: number, land: boolean, hint = -1): number {
    const { triangles, xyz, adj, adjStart } = this.mesh;
    const wet = this.wet;
    const want = land ? 0 : 1;
    let cur = -1;
    let best = -Infinity;
    if (hint >= 0 && wet[hint] === want) {
      cur = hint;
      best = xyz[3 * hint] * qx + xyz[3 * hint + 1] * qy + xyz[3 * hint + 2] * qz;
    }
    for (let k = 0; k < 3; k++) {
      const v = triangles[3 * t + k];
      if (wet[v] !== want) continue;
      const d = xyz[3 * v] * qx + xyz[3 * v + 1] * qy + xyz[3 * v + 2] * qz;
      if (d > best) { best = d; cur = v; }
    }
    if (cur < 0) cur = triangles[3 * t]; // cannot happen for a consistent class
    for (let guard = 0; guard < 64; guard++) {
      let next = -1;
      for (let k = adjStart[cur]; k < adjStart[cur + 1]; k++) {
        const u = adj[k];
        if (wet[u] !== want) continue;
        const d = xyz[3 * u] * qx + xyz[3 * u + 1] * qy + xyz[3 * u + 2] * qz;
        if (d > best) { best = d; next = u; }
      }
      if (next < 0) break;
      cur = next;
    }
    return cur;
  }
}

const cache = new WeakMap<PhysicalWorld, BakeContext>();

/** Get (or build and cache) the bake context for a world. */
export function bakeContext(world: PhysicalWorld): BakeContext {
  let ctx = cache.get(world);
  if (!ctx) {
    ctx = new BakeContext(world);
    cache.set(world, ctx);
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Warp lattice
// ---------------------------------------------------------------------------

/**
 * A smooth 3D displacement field on a fixed equirectangular lattice. Values are
 * stored quantised to 8 bits (RGB, 128 = 0) exactly as uploaded to the GPU,
 * and the CPU samples it with the same bilinear rule as a LINEAR texture
 * (REPEAT in u, CLAMP_TO_EDGE in v), so CPU and GPU agree on q = p + warp(p).
 */
export interface WarpLattice {
  width: number;
  height: number;
  /** Maximum displacement magnitude per component (unit-sphere units). */
  amp: number;
  /** RGBA8: RGB = displacement (x,y,z) mapped from [-amp, amp] to [0, 255]; A = 255. */
  rgba: Uint8Array;
  /** Decoded displacement (3 floats per texel), for fast CPU sampling. */
  vec: Float32Array;
}

function buildWarpLattice(mesh: SphereMesh, rng: Rng): WarpLattice {
  const spacing = mesh.meanSpacing;
  // ≈ 4 lattice texels per cell spacing (smooth under GPU bilinear filtering),
  // clamped to a sane size; even, so the coarse grid below is exactly half.
  let height = Math.round(Math.PI / (spacing / 4));
  height = Math.max(128, Math.min(1024, height));
  height += height & 1;
  const width = 2 * height;
  // Two octaves: a broad one that bends groups of cells, and a fine one that
  // makes each boundary wiggle. Amplitudes keep |∂warp/∂p| well below 1 so the
  // mapping never folds (no mirrored fragments, and it stays invertible).
  const ampA = 0.15 * spacing, fA = 1 / (3.2 * spacing);
  const ampB = 0.085 * spacing, fB = 1 / (1.2 * spacing);
  const amp = ampA + ampB;
  const nx = new Noise3(rng.fork("x"));
  const ny = new Noise3(rng.fork("y"));
  const nz = new Noise3(rng.fork("z"));
  // The noise is evaluated on a half-resolution grid (≈ 2 samples per cell
  // spacing) and upsampled ×2 with Catmull–Rom, which is 4× cheaper than
  // evaluating every texel and indistinguishable at the scale of a border.
  const hc = height / 2, wc = width / 2;
  const coarse = new Float32Array(3 * wc * hc);
  for (let j = 0; j < hc; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / hc) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < wc; i++) {
      const lon = -Math.PI + ((i + 0.5) / wc) * 2 * Math.PI;
      const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
      const o = 3 * (j * wc + i);
      coarse[o] = ampA * Math.tanh(nx.noise(x * fA, y * fA, z * fA) * 1.3) + ampB * Math.tanh(nx.noise(x * fB + 9.7, y * fB, z * fB) * 1.3);
      coarse[o + 1] = ampA * Math.tanh(ny.noise(x * fA, y * fA, z * fA) * 1.3) + ampB * Math.tanh(ny.noise(x * fB + 9.7, y * fB, z * fB) * 1.3);
      coarse[o + 2] = ampA * Math.tanh(nz.noise(x * fA, y * fA, z * fA) * 1.3) + ampB * Math.tanh(nz.noise(x * fB + 9.7, y * fB, z * fB) * 1.3);
    }
  }
  // Fine texel 2k sits at coarse coordinate k − 1/4, texel 2k+1 at k + 1/4:
  // fixed Catmull–Rom weights (t = 3/4 from k−1, t = 1/4 from k).
  const WE = [-0.0234375, 0.2265625, 0.8671875, -0.0703125]; // taps k−2 … k+1
  const WO = [-0.0703125, 0.8671875, 0.2265625, -0.0234375]; // taps k−1 … k+2
  const mid = new Float32Array(3 * width * hc);
  for (let j = 0; j < hc; j++) {
    const row = 3 * j * wc;
    for (let i = 0; i < width; i++) {
      const k = i >> 1;
      const odd = i & 1;
      const w = odd ? WO : WE;
      const first = odd ? k - 1 : k - 2;
      const o = 3 * (j * width + i);
      let a = 0, b = 0, c = 0;
      for (let t = 0; t < 4; t++) {
        let ci = first + t;
        if (ci < 0) ci += wc;
        else if (ci >= wc) ci -= wc;
        const s = row + 3 * ci;
        a += w[t] * coarse[s];
        b += w[t] * coarse[s + 1];
        c += w[t] * coarse[s + 2];
      }
      mid[o] = a; mid[o + 1] = b; mid[o + 2] = c;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const vec = new Float32Array(width * height * 3);
  for (let j = 0; j < height; j++) {
    const k = j >> 1;
    const odd = j & 1;
    const w = odd ? WO : WE;
    const first = odd ? k - 1 : k - 2;
    for (let i = 0; i < width; i++) {
      const o = j * width + i;
      for (let comp = 0; comp < 3; comp++) {
        let v = 0;
        for (let t = 0; t < 4; t++) {
          let rj = first + t;
          rj = rj < 0 ? 0 : rj >= hc ? hc - 1 : rj;
          v += w[t] * mid[3 * (rj * width + i) + comp];
        }
        const u = Math.max(-1, Math.min(1, v / amp));
        const q = Math.round(127.5 + 127.5 * u);
        rgba[4 * o + comp] = q;
        vec[3 * o + comp] = ((q - 127.5) / 127.5) * amp;
      }
      rgba[4 * o + 3] = 255;
    }
  }
  return { width, height, amp, rgba, vec };
}

/**
 * Bilinear sample of the warp lattice at texture coords (u, v) ∈ [0,1]²,
 * matching GL LINEAR filtering with REPEAT/CLAMP. Writes 3 floats to out.
 */
export function sampleWarp(w: WarpLattice, u: number, v: number, out: Float64Array): void {
  const W = w.width, H = w.height, vec = w.vec;
  const fx = u * W - 0.5;
  const fy = v * H - 0.5;
  const x0f = Math.floor(fx);
  const y0f = Math.floor(fy);
  const tx = fx - x0f, ty = fy - y0f;
  let x0 = x0f % W;
  if (x0 < 0) x0 += W;
  const x1 = x0 + 1 === W ? 0 : x0 + 1;
  const y0 = y0f < 0 ? 0 : y0f >= H ? H - 1 : y0f;
  const y1 = y0f + 1 < 0 ? 0 : y0f + 1 >= H ? H - 1 : y0f + 1;
  const a = 3 * (y0 * W + x0), b = 3 * (y0 * W + x1), c = 3 * (y1 * W + x0), d = 3 * (y1 * W + x1);
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  out[0] = w00 * vec[a] + w10 * vec[b] + w01 * vec[c] + w11 * vec[d];
  out[1] = w00 * vec[a + 1] + w10 * vec[b + 1] + w01 * vec[c + 1] + w11 * vec[d + 1];
  out[2] = w00 * vec[a + 2] + w10 * vec[b + 2] + w01 * vec[c + 2] + w11 * vec[d + 2];
}

/**
 * Warp for every pixel of one equirectangular image row (pixel centres),
 * identical to calling `sampleWarp` per pixel but much cheaper. out: 3·width.
 */
export function warpRow(w: WarpLattice, y: number, height: number, width: number, out: Float64Array): void {
  const W = w.width, H = w.height, vec = w.vec;
  const cols = warpColumns(w, width);
  const fy = ((y + 0.5) / height) * H - 0.5;
  const y0f = Math.floor(fy);
  const ty = fy - y0f;
  const y0 = y0f < 0 ? 0 : y0f >= H ? H - 1 : y0f;
  const y1 = y0f + 1 < 0 ? 0 : y0f + 1 >= H ? H - 1 : y0f + 1;
  // Blend the two lattice rows once, then interpolate along x per pixel.
  const blend = cols.blend;
  const r0 = 3 * y0 * W, r1 = 3 * y1 * W;
  const sy = 1 - ty;
  for (let i = 0; i < 3 * W; i++) blend[i] = sy * vec[r0 + i] + ty * vec[r1 + i];
  blend[3 * W] = blend[0];
  blend[3 * W + 1] = blend[1];
  blend[3 * W + 2] = blend[2];
  const ix = cols.x0, tx = cols.tx;
  for (let x = 0; x < width; x++) {
    const a = 3 * ix[x];
    const t = tx[x], s0 = 1 - t;
    out[3 * x] = s0 * blend[a] + t * blend[a + 3];
    out[3 * x + 1] = s0 * blend[a + 1] + t * blend[a + 4];
    out[3 * x + 2] = s0 * blend[a + 2] + t * blend[a + 5];
  }
}

interface WarpColumns {
  x0: Int32Array;
  tx: Float64Array;
  blend: Float64Array;
}
const colCache = new WeakMap<WarpLattice, Map<number, WarpColumns>>();

/** Per-image-column lattice indices and weights (wrapping), cached per width. */
function warpColumns(w: WarpLattice, width: number): WarpColumns {
  let m = colCache.get(w);
  if (!m) colCache.set(w, (m = new Map()));
  let c = m.get(width);
  if (!c) {
    const W = w.width;
    const x0 = new Int32Array(width);
    const tx = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const fx = ((x + 0.5) / width) * W - 0.5;
      const f = Math.floor(fx);
      tx[x] = fx - f;
      // Index into the blended row, which has the first texel appended at the end (index W).
      x0[x] = f < 0 ? W - 1 : f;
    }
    c = { x0, tx, blend: new Float64Array(3 * (W + 1)) };
    m.set(width, c);
  }
  return c;
}

/** Texture coordinates of a unit vector (u = lon, v = colatitude). */
export function dirToUV(x: number, y: number, z: number, out: Float64Array): void {
  out[0] = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI);
  out[1] = (Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, z)))) / Math.PI;
}

/**
 * Approximate inverse warp: the pixel direction p whose warped position is s.
 * Use it to place things given in cell space (rivers, markers) onto the image.
 */
export function unwarp(w: WarpLattice, sx: number, sy: number, sz: number, out: Float64Array): void {
  const uv = new Float64Array(2);
  const d = new Float64Array(3);
  // Damped fixed-point iteration on p + warp(p) = s (the warp never folds,
  // so this converges; damping keeps it stable where the warp is steep).
  let px = sx, py = sy, pz = sz;
  for (let it = 0; it < 8; it++) {
    const l = Math.hypot(px, py, pz);
    px /= l; py /= l; pz /= l;
    dirToUV(px, py, pz, uv);
    sampleWarp(w, uv[0], uv[1], d);
    const k = it === 0 ? 1 : 0.7;
    px += k * (sx - px - d[0]);
    py += k * (sy - py - d[1]);
    pz += k * (sz - pz - d[2]);
  }
  const l = Math.hypot(px, py, pz);
  out[0] = px / l;
  out[1] = py / l;
  out[2] = pz / l;
}

/** Hermite smoothstep; works for reversed edges (a > b) too. */
export function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Precomputed trig for an equirectangular grid (pixel centres). */
export interface EquirectGrid {
  width: number;
  height: number;
  cosLon: Float64Array;
  sinLon: Float64Array;
  cosLat: Float64Array;
  sinLat: Float64Array;
}

export function equirectGrid(width: number, height: number): EquirectGrid {
  const cosLon = new Float64Array(width), sinLon = new Float64Array(width);
  const cosLat = new Float64Array(height), sinLat = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    const lon = -Math.PI + ((x + 0.5) / width) * 2 * Math.PI;
    cosLon[x] = Math.cos(lon);
    sinLon[x] = Math.sin(lon);
  }
  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    cosLat[y] = Math.cos(lat);
    sinLat[y] = Math.sin(lat);
  }
  return { width, height, cosLon, sinLon, cosLat, sinLat };
}
