/**
 * Hydraulic + thermal erosion on the cell graph.
 *
 * Each iteration:
 *  1. Priority-flood from the coast builds a drainage tree for every land cell
 *     (receivers point to the lowest neighbour on the depression-filled
 *     surface) and a topological order (receivers before donors).
 *  2. Drainage area is accumulated in reverse order.
 *  3. The stream-power law dh/dt = −K A^m S is integrated implicitly
 *     (Braun & Willett 2013): unconditionally stable, so big time steps are
 *     fine and the whole thing is O(n) per iteration. Valleys incise where
 *     drainage area is large; ridges between them survive, giving dendritic
 *     relief.
 *  4. Sediment is deposited in closed depressions (partially filling them into
 *     flat basin floors) and in low, gentle terrain (alluvial plains).
 *  5. Thermal erosion relaxes slopes steeper than a talus threshold.
 */
import type { SphereMesh } from "../core/sphere";
import { MinHeap } from "../core/heap";

export interface ErosionOptions {
  iterations: number;
  /** Erodibility (per iteration). */
  K: number;
  /** Drainage-area exponent. */
  m: number;
  /** Talus slope (km per km) above which thermal erosion moves material. */
  talus: number;
  /** Optional rainfall weight per cell (dimensionless, ~1 = average). */
  rain?: Float32Array;
  /** Optional per-cell erodibility multiplier (e.g. hard cratons < 1). */
  erodibility?: Float32Array;
}

export interface DrainageTree {
  /** Receiver per land cell (may be an ocean cell), -1 for ocean. */
  recv: Int32Array;
  /** Land cells in topological order: every receiver precedes its donors. */
  order: Int32Array;
  count: number;
  /** Depression-filled surface. */
  filled: Float32Array;
}

/** Priority-flood (Barnes et al. 2014) with an epsilon gradient from the sea up. */
export function drainageTree(mesh: SphereMesh, elevation: Float32Array, seaLevel: number, eps = 1e-5): DrainageTree {
  const n = mesh.n;
  const { adjStart, adj } = mesh;
  const recv = new Int32Array(n).fill(-1);
  const filled = new Float32Array(n);
  const order = new Int32Array(n);
  const done = new Uint8Array(n);
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    if (elevation[i] >= seaLevel) continue;
    done[i] = 1;
    filled[i] = elevation[i];
    // Seed the flood with ocean cells that touch land.
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      if (elevation[adj[k]] >= seaLevel) { heap.push(seaLevel, i); break; }
    }
  }
  let count = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    const lc = heap.lastKey;
    for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
      const u = adj[k];
      if (done[u]) continue;
      done[u] = 1;
      const lu = Math.max(elevation[u], lc + eps);
      filled[u] = lu;
      recv[u] = c;
      order[count++] = u;
      heap.push(lu, u);
    }
  }
  // Any unreached land (landlocked world with no ocean) drains to itself.
  for (let i = 0; i < n; i++) if (!done[i]) { filled[i] = elevation[i]; }
  return { recv, order, count, filled };
}

export function erode(
  mesh: SphereMesh,
  elevation: Float32Array,
  seaLevel: number,
  areaKm2: Float32Array,
  opts: ErosionOptions,
): void {
  const n = mesh.n;
  const { xyz, adjStart, adj } = mesh;
  const A = new Float64Array(n);
  const radius = Math.sqrt(areaKm2[0] / mesh.area[0]);
  const dist = (i: number, j: number) => {
    const d = xyz[3 * i] * xyz[3 * j] + xyz[3 * i + 1] * xyz[3 * j + 1] + xyz[3 * i + 2] * xyz[3 * j + 2];
    return Math.acos(Math.min(1, d)) * radius;
  };
  const meanArea = areaKm2.reduce((s, v) => s + v, 0) / n;
  const tmp = new Float32Array(n);

  for (let it = 0; it < opts.iterations; it++) {
    const tree = drainageTree(mesh, elevation, seaLevel);
    const { recv, order, count, filled } = tree;
    // Drainage area (in units of mean cell area so K is resolution-independent).
    for (let q = 0; q < count; q++) {
      const i = order[q];
      A[i] = (areaKm2[i] / meanArea) * (opts.rain ? opts.rain[i] : 1);
    }
    for (let q = count - 1; q >= 0; q--) {
      const i = order[q];
      const r = recv[i];
      if (r >= 0 && elevation[r] >= seaLevel) A[r] += A[i];
    }
    // Implicit stream power, receivers first.
    for (let q = 0; q < count; q++) {
      const i = order[q];
      const r = recv[i];
      const hr = elevation[r] >= seaLevel ? elevation[r] : seaLevel;
      const hi = elevation[i];
      if (hi <= hr) continue; // inside a depression: leave for deposition
      const kk = opts.K * (opts.erodibility ? opts.erodibility[i] : 1);
      const F = (kk * Math.pow(A[i], opts.m)) / Math.max(1, dist(i, r) / 60);
      elevation[i] = (hi + F * hr) / (1 + F);
    }
    // Deposition: partially fill closed depressions (sediment traps → flat basin floors).
    for (let q = 0; q < count; q++) {
      const i = order[q];
      const depth = filled[i] - elevation[i];
      if (depth > 1e-4) elevation[i] += depth * 0.35;
    }
    // Thermal erosion: relax over-steep slopes (land only).
    for (let i = 0; i < n; i++) tmp[i] = elevation[i];
    for (let i = 0; i < n; i++) {
      const hi = elevation[i];
      if (hi < seaLevel) continue;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        const d = dist(i, j);
        const ocean = elevation[j] < seaLevel;
        const excess = hi - (ocean ? seaLevel : elevation[j]) - opts.talus * d;
        if (excess > 0) {
          const mv = excess * 0.1;
          tmp[i] -= mv;
          if (!ocean) tmp[j] += mv;
        }
      }
    }
    elevation.set(tmp);
  }
  // Alluvial plains: gentle diffusion of low land, which flattens river lowlands.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) tmp[i] = elevation[i];
    for (let i = 0; i < n; i++) {
      const hi = elevation[i];
      if (hi < seaLevel || hi > seaLevel + 0.6) continue;
      let s = 0, c = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const hj = elevation[adj[k]];
        if (hj >= seaLevel) { s += hj; c++; }
      }
      if (c) {
        const w = 0.35 * (1 - (hi - seaLevel) / 0.6);
        tmp[i] = hi + w * (s / c - hi);
      }
    }
    elevation.set(tmp);
  }
}
