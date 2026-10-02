/**
 * Movement costs for the history simulation (expansion, armies, trade).
 *
 * All costs are in "km-equivalents of easy walking": a cost of 100 means a
 * journey as long as walking 100 km across open grassland. A pre-modern party
 * on foot manages roughly 25–30 such km per day, mounted or by cart somewhat
 * more, by boat a great deal more — so costs can be converted to travel days
 * by dividing by ~25.
 *
 *  - `cellDistanceKm(w, i, j)`: great-circle distance between cell centres.
 *  - `landMoveCost(w, i, j)`: walking/riding between adjacent land cells.
 *    Naismith-style climbing penalty (1 km of ascent ≈ 8 km of walking, steep
 *    descents also slow), terrain friction by biome (open plains 1×, forests
 *    1.5–2.6×, marsh 2.8×, deserts 1.7× for lack of water, ice 4×),
 *    ruggedness, a penalty for crossing a river (ford or ferry; bigger rivers
 *    cost more) and a large discount for travelling along a navigable river
 *    (by boat; downstream cheaper than upstream). Infinity if either cell is
 *    open water (ocean or lake).
 *  - `seaMoveCost(w, i, j)`: sailing between adjacent water cells (ocean or
 *    lake) at ~0.3 km-equivalents per km, more on the open ocean far from land
 *    (pre-modern seafaring hugs coasts), more in stormy high latitudes, more
 *    against the prevailing wind; pack ice is nearly impassable. A move between
 *    a coastal land cell and a water cell is an embarkation or landing: a fixed
 *    15 plus the sailing cost of half the distance. Infinity between two land
 *    cells.
 *
 * The functions do not check adjacency; they are meant for neighbouring cells
 * from `mesh.adj` (costs for distant pairs are not meaningful).
 */
import { Biome, type PhysicalWorld } from "../world/types";

const FRICTION: number[] = (() => {
  const f = new Array<number>(32).fill(1.2);
  f[Biome.Grassland] = 1.0;
  f[Biome.Steppe] = 1.0;
  f[Biome.Savanna] = 1.1;
  f[Biome.Mediterranean] = 1.15;
  f[Biome.TemperateForest] = 1.5;
  f[Biome.TropicalDryForest] = 1.5;
  f[Biome.Taiga] = 1.6;
  f[Biome.TemperateRainforest] = 2.0;
  f[Biome.Rainforest] = 2.6;
  f[Biome.Wetland] = 2.8;
  f[Biome.HotDesert] = 1.7;
  f[Biome.ColdDesert] = 1.5;
  f[Biome.Tundra] = 1.4;
  f[Biome.Alpine] = 2.2;
  f[Biome.IceSheet] = 4.0;
  return f;
})();

interface TravelCache {
  rugged: Float32Array;
  riverThreshold: number;
}
const caches = new WeakMap<PhysicalWorld, TravelCache>();

function cache(w: PhysicalWorld): TravelCache {
  let c = caches.get(w);
  if (c) return c;
  const { mesh, elevation } = w;
  const rugged = new Float32Array(mesh.n);
  for (let i = 0; i < mesh.n; i++) {
    let m = 0;
    const ei = Math.max(0, elevation[i]);
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) m = Math.max(m, Math.abs(Math.max(0, elevation[mesh.adj[k]]) - ei));
    rugged[i] = m;
  }
  let thr = Infinity;
  for (let i = 0; i < mesh.n; i++) if (w.riverOrder[i] > 0) thr = Math.min(thr, w.flow[i]);
  c = { rugged, riverThreshold: Number.isFinite(thr) ? thr : 350 };
  caches.set(w, c);
  return c;
}

/** Great-circle distance between the centres of cells i and j, km. */
export function cellDistanceKm(w: PhysicalWorld, i: number, j: number): number {
  const p = w.mesh.xyz;
  const d = p[3 * i] * p[3 * j] + p[3 * i + 1] * p[3 * j + 1] + p[3 * i + 2] * p[3 * j + 2];
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * w.params.radiusKm;
}

const isWater = (w: PhysicalWorld, i: number) => !w.isLand[i] || w.lakeId[i] >= 0;

/** Cost (km-equivalents) of walking/riding from land cell i to adjacent land cell j; Infinity if either is water. */
export function landMoveCost(w: PhysicalWorld, i: number, j: number): number {
  if (isWater(w, i) || isWater(w, j)) return Infinity;
  const c = cache(w);
  const d = cellDistanceKm(w, i, j);
  const dh = w.elevation[j] - w.elevation[i];
  // Along a navigable river: by boat, much cheaper (if the river is not a mountain torrent).
  const along = w.downstream[i] === j ? 1 : w.downstream[j] === i ? -1 : 0;
  if (along !== 0) {
    const q = along > 0 ? w.flow[i] : w.flow[j];
    if (q >= 1000 && Math.abs(dh) < 0.12) return d * (along > 0 ? 0.3 : 0.55);
  }
  const friction = 0.5 * (FRICTION[w.biome[i]] + FRICTION[w.biome[j]]);
  const rugged = 1 + 0.9 * Math.min(2.5, 0.5 * (c.rugged[i] + c.rugged[j]));
  let cost = d * friction * rugged + 8.3 * Math.max(0, dh) + 2.5 * Math.max(0, -dh);
  // Crossing a river (not following it): ford or ferry.
  if (along === 0) {
    const q = Math.max(w.riverOrder[i] > 0 ? w.flow[i] : 0, w.riverOrder[j] > 0 ? w.flow[j] : 0);
    if (q >= c.riverThreshold) cost += 4 + 9 * Math.log10(q / c.riverThreshold + 1);
  }
  return cost;
}

/**
 * Cost (km-equivalents) of sailing from water cell i to adjacent water cell j.
 * One land + one water cell = embarking/landing. Infinity for two land cells.
 */
export function seaMoveCost(w: PhysicalWorld, i: number, j: number): number {
  const wi = isWater(w, i), wj = isWater(w, j);
  if (!wi && !wj) return Infinity;
  const d = cellDistanceKm(w, i, j);
  if (wi !== wj) return 15 + 0.5 * d * 0.3;
  // Lakes are calm.
  if (w.lakeId[i] >= 0 && w.lakeId[j] >= 0) return d * 0.3;
  if (w.biome[i] === Biome.SeaIce || w.biome[j] === Biome.SeaIce) return d * 6;
  let f = 0.3;
  // Open-ocean passages were feared and slow to provision: hugging the coast is cheaper.
  const off = Math.min(-w.coastDist[i], -w.coastDist[j]);
  if (off > 2) f *= 1 + 0.35 * Math.min(4, off - 2);
  // Stormy high latitudes.
  const lat = Math.abs(w.mesh.lat[j]) * 57.29578;
  if (lat > 45) f *= 1 + 0.02 * (lat - 45);
  // Prevailing wind: following winds help, headwinds hinder.
  const p = w.mesh.xyz;
  let dx = p[3 * j] - p[3 * i], dy = p[3 * j + 1] - p[3 * i + 1], dz = p[3 * j + 2] - p[3 * i + 2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const wx = w.wind[3 * i], wy = w.wind[3 * i + 1], wz = w.wind[3 * i + 2];
  const ws = Math.hypot(wx, wy, wz);
  if (ws > 0.5) {
    const along = (wx * dx + wy * dy + wz * dz) / ws; // −1 headwind … +1 tailwind
    f *= 1 - 0.25 * along * Math.min(1, ws / 8);
  }
  return d * f;
}
