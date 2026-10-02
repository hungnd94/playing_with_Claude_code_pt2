/**
 * Sea level selection.
 *
 * A priority flood from the deepest cell computes, for every cell, the lowest
 * water level at which it becomes connected to the world ocean ("flood level"
 * = minimax elevation along any path from the abyss). The ocean at sea level S
 * is exactly the set of cells with floodLevel < S, so the area-weighted
 * quantile of floodLevel gives the sea level that floods precisely the target
 * fraction of the planet. Closed depressions below S that are not connected
 * to the ocean stay dry (hydrology may fill them with lakes).
 */
import type { SphereMesh } from "../core/sphere";
import { MinHeap } from "../core/heap";

export function floodLevels(mesh: SphereMesh, elevation: Float32Array): Float32Array {
  const n = mesh.n;
  let seed = 0;
  for (let i = 1; i < n; i++) if (elevation[i] < elevation[seed]) seed = i;
  const level = new Float32Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const heap = new MinHeap(n);
  level[seed] = elevation[seed];
  heap.push(elevation[seed], seed);
  while (heap.size > 0) {
    const c = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    const lc = level[c];
    for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
      const u = mesh.adj[k];
      if (done[u]) continue;
      const lu = Math.max(lc, elevation[u]);
      if (lu < level[u]) {
        level[u] = lu;
        heap.push(lu, u);
      }
    }
  }
  return level;
}

/** Sea level such that the ocean (cells connected to the abyss below it) covers `oceanFraction` of the area. */
export function chooseSeaLevel(mesh: SphereMesh, elevation: Float32Array, oceanFraction: number): { seaLevel: number; flood: Float32Array } {
  const flood = floodLevels(mesh, elevation);
  // Bisection on the level. Many cells can share one flood level (a basin that floods
  // all at once when the sea reaches its rim), so in the end choose between including
  // or excluding that whole group, whichever lands closer to the target.
  const n = mesh.n;
  let total = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    total += mesh.area[i];
    if (flood[i] < lo) lo = flood[i];
    if (flood[i] > hi) hi = flood[i];
  }
  const target = oceanFraction * total;
  const areaBelow = (L: number) => {
    let a = 0;
    for (let i = 0; i < n; i++) if (flood[i] < L) a += mesh.area[i];
    return a;
  };
  let a = lo, b = hi + 1e-3; // areaBelow(a) ≤ target < areaBelow(b) (unless degenerate)
  for (let it = 0; it < 60 && b - a > 1e-7; it++) {
    const m = 0.5 * (a + b);
    if (areaBelow(m) <= target) a = m; else b = m;
  }
  const seaLevel = Math.abs(areaBelow(b) - target) < Math.abs(areaBelow(a) - target) ? b : a;
  return { seaLevel, flood };
}

/**
 * Deal with closed depressions that lie below sea level but are not connected
 * to the ocean (they would otherwise be dry land below sea level).
 *  - Large depressions within a few cells of the ocean get a strait carved to
 *    the sea and become inland seas (Black Sea, Baltic, Red Sea style).
 *  - The rest are raised into shallow interior basins whose floors sit a
 *    little below or above sea level (Caspian / Tarim style). Hydrology later
 *    decides whether they hold a lake.
 * Returns true if anything changed (sea level must then be recomputed).
 */
export function resolveDepressions(mesh: SphereMesh, elevation: Float32Array, flood: Float32Array, seaLevel: number, maxStraitHops = 3): boolean {
  const n = mesh.n;
  const { adjStart, adj } = mesh;
  const isolated = (i: number) => elevation[i] < seaLevel && flood[i] >= seaLevel;
  const comp = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  let changed = false;
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1 || !isolated(s)) continue;
    const cells: number[] = [];
    stack.push(s);
    comp[s] = id;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const u = adj[k];
        if (comp[u] === -1 && isolated(u)) { comp[u] = id; stack.push(u); }
      }
    }
    id++;
    let minE = Infinity;
    for (const c of cells) minE = Math.min(minE, elevation[c]);
    // BFS through land from the depression to the nearest ocean cell.
    let path: number[] | null = null;
    if (maxStraitHops > 0 && cells.length >= 6 && minE < seaLevel - 0.25) {
      const prev = new Map<number, number>();
      let frontier = cells.slice();
      for (const c of cells) prev.set(c, -1);
      for (let hop = 0; hop <= maxStraitHops && !path; hop++) {
        const next: number[] = [];
        for (const c of frontier) {
          for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
            const u = adj[k];
            if (prev.has(u)) continue;
            prev.set(u, c);
            if (flood[u] < seaLevel) {
              path = [];
              let w = c;
              while (w !== -1 && comp[w] !== comp[s]) { path.push(w); w = prev.get(w)!; }
              break;
            }
            next.push(u);
          }
          if (path) break;
        }
        frontier = next;
      }
    }
    if (path) {
      for (const c of path) elevation[c] = Math.min(elevation[c], seaLevel - 0.25);
      changed = true;
    } else {
      // Turn into an interior lowland plain draining over its rim, with only the
      // deepest part left as a hollow that may hold a lake (Caspian / Chad / Eyre style).
      for (const c of cells) {
        const rim = Math.max(flood[c], seaLevel + 0.01);
        const t = (seaLevel - elevation[c]) / Math.max(0.05, seaLevel - minE);
        elevation[c] = rim + 0.03 * (1 - t) - 0.12 * Math.max(0, t - 0.75) / 0.25;
      }
    }
  }
  return changed;
}

/**
 * Final exact match of the ocean fraction. A large basin that floods all at
 * once at one sill level can make the plain quantile miss the target by a few
 * percent; this nudges the shallowest coastal sea cells up into coastal flats
 * (or drowns the lowest coastal lowlands) until the ocean area is within a
 * fraction of a cell of the target. Returns the updated flood levels.
 */
export function matchOceanFraction(mesh: SphereMesh, elevation: Float32Array, seaLevel: number, oceanFraction: number, floodIn?: Float32Array): Float32Array {
  const n = mesh.n;
  let flood = floodIn ?? floodLevels(mesh, elevation);
  let total = 0;
  for (let i = 0; i < n; i++) total += mesh.area[i];
  const target = oceanFraction * total;
  const tol = 0.002 * total;
  for (let pass = 0; pass < 6; pass++) {
    let ocean = 0;
    for (let i = 0; i < n; i++) if (flood[i] < seaLevel) ocean += mesh.area[i];
    if (Math.abs(ocean - target) <= tol) break;
    const coastal = (i: number, wantOcean: boolean) => {
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if ((flood[mesh.adj[k]] < seaLevel) !== wantOcean) return true;
      return false;
    };
    const cand: number[] = [];
    if (ocean > target) {
      const isOc = new Uint8Array(n);
      for (let i = 0; i < n; i++) isOc[i] = flood[i] < seaLevel ? 1 : 0;
      for (let i = 0; i < n; i++) if (isOc[i] && coastal(i, true)) cand.push(i);
      cand.sort((a, b) => elevation[b] - elevation[a] || a - b); // shallowest first
      for (const c of cand) {
        if (ocean - target <= tol * 0.25) break;
        // Only "simple" cells: their ocean neighbours form one contiguous arc of the
        // (CCW-ordered) neighbour ring, so turning c into land cannot cut the sea apart.
        const s0 = mesh.adjStart[c], e0 = mesh.adjStart[c + 1], deg = e0 - s0;
        let runs = 0, oc = 0;
        for (let k = 0; k < deg; k++) {
          const a = isOc[mesh.adj[s0 + k]], b = isOc[mesh.adj[s0 + ((k + 1) % deg)]];
          if (a) oc++;
          if (a && !b) runs++;
        }
        if (oc === 0 || runs > 1) continue;
        elevation[c] = seaLevel + 0.004;
        isOc[c] = 0;
        ocean -= mesh.area[c];
      }
    } else {
      for (let i = 0; i < n; i++) if (flood[i] >= seaLevel && coastal(i, false)) cand.push(i);
      cand.sort((a, b) => elevation[a] - elevation[b] || a - b); // lowest first
      for (const c of cand) {
        if (target - ocean <= tol * 0.25) break;
        elevation[c] = seaLevel - 0.01;
        ocean += mesh.area[c];
      }
    }
    flood = floodLevels(mesh, elevation);
  }
  return flood;
}

/**
 * Shallow pockets of sea almost enclosed by land (a cell or two of shelf water
 * with land on most sides) silt up into coastal lowlands. Cleans up the
 * speckled, drowned look of low continental margins without touching real
 * bays, straits or deeper water.
 */
export function fillShallowPockets(mesh: SphereMesh, elevation: Float32Array, flood: Float32Array, seaLevel: number): void {
  const n = mesh.n;
  const isOc = new Uint8Array(n);
  for (let i = 0; i < n; i++) isOc[i] = flood[i] < seaLevel ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    const fill: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!isOc[i] || elevation[i] < seaLevel - 0.2) continue;
      let land = 0;
      const deg = mesh.adjStart[i + 1] - mesh.adjStart[i];
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (!isOc[mesh.adj[k]]) land++;
      if (land >= deg - 1 || (land >= deg - 2 && elevation[i] > seaLevel - 0.08)) fill.push(i);
    }
    if (!fill.length) break;
    for (const c of fill) { isOc[c] = 0; elevation[c] = seaLevel + 0.006; }
  }
}
