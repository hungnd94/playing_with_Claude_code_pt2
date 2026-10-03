/**
 * Raster sampling of the world under the plate: a regular grid of nodes in
 * screen space, each unprojected onto the sphere and evaluated against the
 * cell mesh.
 *
 *  - `coast`: a signed land field (> 0 land, < 0 water: ocean or lake). It is a
 *    Gaussian-weighted blend of per-cell signed "landness" over the nearest
 *    cell and its neighbours, plus fractal noise and a domain warp applied
 *    *only where land and water cells meet*, so coastlines get detail far finer
 *    than the ~80 km cells, while every cell site keeps its own class.
 *  - `cell`: nearest cell; `landCell`: nearest land cell under an organic warp
 *    (for biome / owner lookups with natural-looking boundaries).
 *  - `elev`: smooth elevation (km).
 *
 * Deterministic: noise is seeded from the world seed and evaluated in sphere
 * coordinates, so the same place gets the same coast in every view.
 */
import { CellLocator } from "../core/sphere";
import { Noise3 } from "../core/noise";
import { Rng } from "../core/rng";
import type { PhysicalWorld } from "../world/types";
import type { Projection } from "./projection";

export interface FieldGrid {
  /** Node counts. */
  gx: number;
  gy: number;
  /** Pixels between nodes. */
  step: number;
  /** Screen position of node (0, 0). */
  x0: number;
  y0: number;
  /** Signed land field (> 0 land). Nodes outside the projectable disc are -1. */
  coast: Float32Array;
  /** 1 where the node is lake water. */
  lake: Uint8Array;
  /** Nearest cell (-1 outside). */
  cell: Int32Array;
  /** Nearest land cell under an organic warp (-1 for water nodes). */
  landCell: Int32Array;
  /** Smoothed elevation, km. */
  elev: Float32Array;
  /** Unit vector of every node on the sphere (0,0,0 outside the projectable disc). */
  ux: Float32Array;
  uy: Float32Array;
  uz: Float32Array;
}

const locatorCache = new WeakMap<object, CellLocator>();
const noiseCache = new Map<string, Noise3>();

export function locatorFor(world: PhysicalWorld): CellLocator {
  let loc = locatorCache.get(world.mesh);
  if (!loc) {
    loc = new CellLocator(world.mesh);
    locatorCache.set(world.mesh, loc);
  }
  return loc;
}

export function noiseFor(seed: string, label: string): Noise3 {
  const k = `${seed}::${label}`;
  let nz = noiseCache.get(k);
  if (!nz) {
    nz = new Noise3(new Rng(seed).fork("atlas").fork(label));
    if (noiseCache.size > 64) noiseCache.clear();
    noiseCache.set(k, nz);
  }
  return nz;
}

/** Signed landness of a cell for the coast field. */
export function cellLandness(world: PhysicalWorld, i: number): number {
  if (world.isLand[i] && world.lakeId[i] < 0) return 0.55 + 0.45 * Math.min(1, Math.max(0, world.elevation[i]) / 0.8);
  if (world.lakeId[i] >= 0) return -0.75;
  return -(0.55 + 0.45 * Math.min(1, Math.max(0, -world.elevation[i]) / 1.2));
}

export interface FieldOptions {
  step: number;
  /** Extra nodes beyond the rect on every side. */
  pad: number;
}

export function sampleField(world: PhysicalWorld, proj: Projection, opts: FieldOptions): FieldGrid {
  const { mesh } = world;
  const { xyz, adj, adjStart } = mesh;
  const step = opts.step;
  const rect = proj.rect;
  const pad = opts.pad;
  const gx = Math.ceil(rect.w / step) + 1 + 2 * pad;
  const gy = Math.ceil(rect.h / step) + 1 + 2 * pad;
  const x0 = rect.x - pad * step;
  const y0 = rect.y - pad * step;
  const N = gx * gy;
  const coast = new Float32Array(N);
  const lake = new Uint8Array(N);
  const cell = new Int32Array(N).fill(-1);
  const landCell = new Int32Array(N).fill(-1);
  const elev = new Float32Array(N);
  const ux = new Float32Array(N), uy = new Float32Array(N), uz = new Float32Array(N);

  const loc = locatorFor(world);
  const seed = world.params.seed;
  const nCoast = noiseFor(seed, "coast");
  const nWarp = noiseFor(seed, "warp");
  const nOrg = noiseFor(seed, "organic");

  const sp = mesh.meanSpacing;
  const inv = 1 / sp;
  const sig2 = (0.62 * sp) ** 2;
  // Octaves of coast detail down to ~1.5 px.
  const pxPerSpacing = (sp * proj.R) / proj.kmPerPx;
  const octaves = Math.max(2, Math.min(8, Math.ceil(Math.log2(pxPerSpacing / 1.2))));

  const land = new Float32Array(mesh.n);
  for (let i = 0; i < mesh.n; i++) land[i] = cellLandness(world, i);

  // Coarse organic warp lattice (interpolated), for biome/owner lookups.
  const wStep = 4;
  const wgx = Math.ceil(gx / wStep) + 1;
  const wgy = Math.ceil(gy / wStep) + 1;
  const warp = new Float32Array(wgx * wgy * 3);
  const p = new Float64Array(3);
  for (let j = 0; j < wgy; j++) {
    for (let i = 0; i < wgx; i++) {
      const o = 3 * (j * wgx + i);
      if (!proj.inverse(x0 + i * wStep * step, y0 + j * wStep * step, p)) continue;
      const s = inv * 0.7;
      const a = 0.42 * sp;
      warp[o] = a * nOrg.fbm(p[0] * s + 3.1, p[1] * s, p[2] * s, 3);
      warp[o + 1] = a * nOrg.fbm(p[0] * s, p[1] * s + 7.7, p[2] * s, 3);
      warp[o + 2] = a * nOrg.fbm(p[0] * s, p[1] * s, p[2] * s - 5.3, 3);
    }
  }

  let hint = -1;
  let rowHint = -1;
  for (let j = 0; j < gy; j++) {
    hint = rowHint;
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i;
      const sx = x0 + i * step, sy = y0 + j * step;
      if (!proj.inverse(sx, sy, p)) {
        coast[k] = -1;
        continue;
      }
      let px = p[0], py = p[1], pz = p[2];
      ux[k] = px;
      uy[k] = py;
      uz[k] = pz;
      let c = loc.find(px, py, pz, hint);
      hint = c;
      if (i === 0) rowHint = c;
      // Mixed neighbourhood?
      const s0 = adjStart[c], s1 = adjStart[c + 1];
      const own = land[c] > 0;
      let mixed = false;
      for (let q = s0; q < s1; q++) if (land[adj[q]] > 0 !== own) { mixed = true; break; }
      let cc = c;
      // Distance to the nearest site attenuates the perturbations so that sites keep their class.
      let att = 1;
      if (mixed) {
        const ddx = px - xyz[3 * c], ddy = py - xyz[3 * c + 1], ddz = pz - xyz[3 * c + 2];
        att = Math.min(1, Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / (0.38 * sp));
        // Domain warp for organic coast shapes.
        const ws = inv * 0.55;
        const wa = 0.3 * sp * att;
        const qx = px + wa * nWarp.fbm(px * ws + 1.7, py * ws, pz * ws, 3);
        const qy = py + wa * nWarp.fbm(px * ws, py * ws + 4.4, pz * ws, 3);
        const qz = pz + wa * nWarp.fbm(px * ws, py * ws, pz * ws + 9.1, 3);
        const l = Math.hypot(qx, qy, qz);
        px = qx / l; py = qy / l; pz = qz / l;
        cc = loc.find(px, py, pz, c);
      }
      // Gaussian blend over the nearest cell and its ring.
      let ws = 0, vs = 0, es = 0;
      let bestW = -1, bestWater = -1;
      const r0 = adjStart[cc], r1 = adjStart[cc + 1];
      for (let q = r0 - 1; q < r1; q++) {
        const u = q < r0 ? cc : adj[q];
        const dx = px - xyz[3 * u], dy = py - xyz[3 * u + 1], dz = pz - xyz[3 * u + 2];
        // Smooth compact kernel ≈ Gaussian(σ²) (cheaper than exp).
        const q2 = 1 - (dx * dx + dy * dy + dz * dz) / (3.2 * sig2);
        const w = q2 > 0 ? q2 * q2 * q2 + 1e-6 : 1e-6;
        ws += w;
        vs += w * land[u];
        es += w * world.elevation[u];
        if (land[u] < 0 && w > bestW) { bestW = w; bestWater = u; }
      }
      let v = vs / ws;
      if (mixed) {
        const ns = inv * 0.9;
        v += 0.62 * att * nCoast.fbm(px * ns, py * ns, pz * ns, octaves, 2.03, 0.52);
      }
      coast[k] = v;
      cell[k] = c;
      elev[k] = es / ws;
      if (v < 0) {
        if (bestWater >= 0 && world.lakeId[bestWater] >= 0) lake[k] = 1;
      }
    }
  }

  // Organic nearest-land-cell lookup (for biomes and owners).
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i;
      if (coast[k] <= 0 || cell[k] < 0) continue;
      p[0] = ux[k];
      p[1] = uy[k];
      p[2] = uz[k];
      // Bilinear warp.
      const fx = i / wStep, fy = j / wStep;
      const ix = Math.min(wgx - 2, Math.floor(fx)), iy = Math.min(wgy - 2, Math.floor(fy));
      const tx = fx - ix, ty = fy - iy;
      const o00 = 3 * (iy * wgx + ix), o10 = o00 + 3, o01 = o00 + 3 * wgx, o11 = o01 + 3;
      const wx = (1 - ty) * ((1 - tx) * warp[o00] + tx * warp[o10]) + ty * ((1 - tx) * warp[o01] + tx * warp[o11]);
      const wy = (1 - ty) * ((1 - tx) * warp[o00 + 1] + tx * warp[o10 + 1]) + ty * ((1 - tx) * warp[o01 + 1] + tx * warp[o11 + 1]);
      const wz = (1 - ty) * ((1 - tx) * warp[o00 + 2] + tx * warp[o10 + 2]) + ty * ((1 - tx) * warp[o01 + 2] + tx * warp[o11 + 2]);
      let qx = p[0] + wx, qy = p[1] + wy, qz = p[2] + wz;
      const l = Math.hypot(qx, qy, qz);
      qx /= l; qy /= l; qz /= l;
      let c = loc.find(qx, qy, qz, cell[k]);
      if (!(world.isLand[c] && world.lakeId[c] < 0)) {
        c = cell[k];
        if (!(world.isLand[c] && world.lakeId[c] < 0)) {
          // nearest land neighbour
          let best = -1, bd = -2;
          for (let q = adjStart[c]; q < adjStart[c + 1]; q++) {
            const u = adj[q];
            if (!(world.isLand[u] && world.lakeId[u] < 0)) continue;
            const d = p[0] * xyz[3 * u] + p[1] * xyz[3 * u + 1] + p[2] * xyz[3 * u + 2];
            if (d > bd) { bd = d; best = u; }
          }
          c = best;
        }
      }
      landCell[k] = c;
    }
  }

  return { gx, gy, step, x0, y0, coast, lake, cell, landCell, elev, ux, uy, uz };
}

/** Bilinear sample of a node field at a screen position. */
export function sampleAt(f: FieldGrid, arr: Float32Array, x: number, y: number): number {
  const fx = (x - f.x0) / f.step, fy = (y - f.y0) / f.step;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  if (i > f.gx - 2) i = f.gx - 2;
  if (j > f.gy - 2) j = f.gy - 2;
  const tx = Math.min(1, Math.max(0, fx - i)), ty = Math.min(1, Math.max(0, fy - j));
  const k = j * f.gx + i;
  return (1 - ty) * ((1 - tx) * arr[k] + tx * arr[k + 1]) + ty * ((1 - tx) * arr[k + f.gx] + tx * arr[k + f.gx + 1]);
}

/** Nearest node index for a screen position (clamped). */
export function nodeAt(f: FieldGrid, x: number, y: number): number {
  let i = Math.round((x - f.x0) / f.step), j = Math.round((y - f.y0) / f.step);
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  if (i >= f.gx) i = f.gx - 1;
  if (j >= f.gy) j = f.gy - 1;
  return j * f.gx + i;
}

/** Is the screen point on land (ocean and lakes are not)? */
export function isLandAt(f: FieldGrid, x: number, y: number): boolean {
  return sampleAt(f, f.coast, x, y) > 0;
}
