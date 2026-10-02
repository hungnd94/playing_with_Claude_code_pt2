/**
 * Geography as the history simulation sees it: per-cell food potential, site
 * attractiveness, defensibility, travel costs along every mesh edge, coasts,
 * rivers and the features each cell touches. Computed once per world.
 */
import { MinHeap } from "../core/heap";
import { landMoveCost, seaMoveCost, cellDistanceKm } from "../geo/travel";
import { Biome, Resource, type PhysicalWorld } from "../world/types";

export interface Geo {
  n: number;
  /** Cell area, km². */
  areaKm2: Float32Array;
  /** Walkable land: land and not a lake. */
  land: Uint8Array;
  landCells: Int32Array;
  /** Water (ocean, sea or lake). */
  water: Uint8Array;
  /** Per CSR edge (mesh.adj index): walking cost, Infinity unless both cells are walkable land. */
  landCost: Float32Array;
  /** Per CSR edge: sailing / embarking cost, Infinity between two land cells. */
  seaCost: Float32Array;
  /** Land cell touching the open sea (not just a lake). */
  coastal: Uint8Array;
  /** Land cell touching a lake. */
  lakeside: Uint8Array;
  /** An adjacent sea/lake cell for coastal land cells, else -1. */
  shore: Int32Array;
  /** Base food potential (people supported at Neolithic technology). */
  food: Float32Array;
  /** Attractiveness of the cell as a settlement site (≈ 0..2). */
  site: Float32Array;
  /** Defensibility 0..1 (hills, mountains, marsh, river bends). */
  defense: Float32Array;
  /** Main river feature through the cell, or -1. */
  riverOf: Int32Array;
  /** Latitude, degrees. */
  latDeg: Float32Array;
  /** Steppe-like open country suited to herding horsemen. */
  steppe: Uint8Array;
  /** Marginal land prone to famine in cold or dry years (0..1). */
  marginal: Float32Array;
  /** Number of resource bits per cell. */
  resCount: Uint8Array;
  /** Habitable food per landmass feature id. */
  landmassFood: Map<number, number>;
  /** Feature id → kind lookup convenience. */
  featureKind: string[];
  /** Volcano feature ids. */
  volcanoes: number[];
  /** Big rivers (features) sorted by discharge, for floods. */
  bigRivers: number[];
}

/** People per km² of fertility-1 land at technology level 0. */
export const BASE_DENSITY = 1.0;

export function buildGeo(w: PhysicalWorld): Geo {
  const { mesh } = w;
  const n = mesh.n;
  const R = w.params.radiusKm;
  const areaKm2 = new Float32Array(n);
  for (let i = 0; i < n; i++) areaKm2[i] = mesh.area[i] * R * R;
  const land = new Uint8Array(n);
  const water = new Uint8Array(n);
  const lc: number[] = [];
  for (let i = 0; i < n; i++) {
    if (w.isLand[i] && w.lakeId[i] < 0) {
      land[i] = 1;
      lc.push(i);
    } else water[i] = 1;
  }
  const E = mesh.adj.length;
  const landCost = new Float32Array(E);
  const seaCost = new Float32Array(E);
  for (let i = 0; i < n; i++) {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      landCost[k] = land[i] && land[j] ? landMoveCost(w, i, j) : Infinity;
      seaCost[k] = water[i] || water[j] ? seaMoveCost(w, i, j) : Infinity;
    }
  }
  const coastal = new Uint8Array(n);
  const lakeside = new Uint8Array(n);
  const shore = new Int32Array(n).fill(-1);
  for (const i of lc) {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      if (!w.isLand[j]) {
        coastal[i] = 1;
        shore[i] = j;
      } else if (w.lakeId[j] >= 0) {
        lakeside[i] = 1;
        if (shore[i] < 0) shore[i] = j;
      }
    }
  }
  const latDeg = new Float32Array(n);
  for (let i = 0; i < n; i++) latDeg[i] = (mesh.lat[i] * 180) / Math.PI;

  // Rivers: the largest river feature through each cell.
  const riverOf = new Int32Array(n).fill(-1);
  const featureKind = w.features.map((f) => f.kind);
  const rivers = w.features.filter((f) => f.kind === "river").sort((a, b) => Number(b.attrs.discharge ?? 0) - Number(a.attrs.discharge ?? 0) || a.id - b.id);
  for (const f of rivers) for (const c of f.cells) if (riverOf[c] < 0) riverOf[c] = f.id;
  const volcanoes = w.features.filter((f) => f.kind === "volcano").map((f) => f.id);
  const bigRivers = rivers.filter((f) => Number(f.attrs.discharge ?? 0) > 4000).map((f) => f.id);

  const food = new Float32Array(n);
  const site = new Float32Array(n);
  const defense = new Float32Array(n);
  const steppe = new Uint8Array(n);
  const marginal = new Float32Array(n);
  const resCount = new Uint8Array(n);
  for (const i of lc) {
    const b = w.biome[i];
    let f = Math.pow(Math.max(0, w.fertility[i]), 1.15);
    const ro = w.riverOrder[i];
    if (ro > 0) f *= 1 + 0.12 * Math.min(5, ro);
    if (coastal[i]) f *= 1.1;
    const res = w.resources[i];
    if (res & Resource.Fish) f *= 1.08;
    if (b === Biome.IceSheet) f = 0;
    food[i] = f * areaKm2[i] * BASE_DENSITY;
    let rc = 0;
    for (let r = res; r; r &= r - 1) rc++;
    resCount[i] = rc;
    // Relief from neighbours.
    let relief = 0;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) relief = Math.max(relief, Math.abs(w.elevation[mesh.adj[k]] - w.elevation[i]));
    const el = w.elevation[i];
    let d = Math.min(1, relief * 0.9) * 0.6 + (el > 1.2 ? 0.25 : el > 0.5 ? 0.12 : 0) + (b === Biome.Wetland ? 0.2 : 0) + (ro >= 2 ? 0.1 : 0);
    if (coastal[i]) d += 0.05;
    defense[i] = Math.min(1, d);
    // Site score.
    let s = 1.6 * Math.min(1, w.fertility[i] * 1.2);
    if (ro > 0) s += 0.35 + 0.08 * Math.min(5, ro);
    if (coastal[i]) s += 0.3;
    if (lakeside[i]) s += 0.2;
    s += 0.06 * rc;
    if (res & (Resource.Salt | Resource.Copper | Resource.Tin | Resource.Iron | Resource.Gold)) s += 0.1;
    s += 0.15 * defense[i];
    if (b === Biome.Wetland) s -= 0.3;
    if (b === Biome.IceSheet) s -= 3;
    if (b === Biome.Alpine) s -= 0.5;
    if (b === Biome.Tundra) s -= 0.3;
    if (b === Biome.HotDesert || b === Biome.ColdDesert) s -= ro > 0 || (res & Resource.Salt) ? 0.1 : 0.4;
    if (w.temperature[i] < -2) s -= 0.4;
    site[i] = s;
    if ((b === Biome.Steppe || b === Biome.Grassland || b === Biome.ColdDesert || (b === Biome.Savanna && w.precipitation[i] < 600)) && el < 2) steppe[i] = 1;
    let m = 0;
    if (w.temperature[i] < 6) m += Math.min(1, (6 - w.temperature[i]) / 10);
    if (w.precipitation[i] < 450) m += Math.min(1, (450 - w.precipitation[i]) / 300);
    marginal[i] = Math.min(1, m);
  }
  const landmassFood = new Map<number, number>();
  for (const i of lc) {
    const lm = w.landmassOf[i];
    if (lm >= 0) landmassFood.set(lm, (landmassFood.get(lm) ?? 0) + food[i]);
  }
  return {
    n, areaKm2, land, landCells: Int32Array.from(lc), water, landCost, seaCost, coastal, lakeside, shore, food, site, defense,
    riverOf, latDeg, steppe, marginal, resCount, landmassFood, featureKind, volcanoes, bigRivers,
  };
}

/**
 * Bounded single-source Dijkstra over land (or land+sea when `sea` is set).
 * Calls `visit(cell, cost)` for every settled cell in order of cost; return
 * false from `visit` to stop early. Scratch buffers are reused between calls.
 */
export class Searcher {
  private dist: Float64Array;
  private stamp: Int32Array;
  private gen = 1;
  private heap = new MinHeap(256);
  constructor(private w: PhysicalWorld, private g: Geo) {
    this.dist = new Float64Array(g.n);
    this.stamp = new Int32Array(g.n);
  }
  run(sources: number[], maxCost: number, visit: (cell: number, cost: number) => boolean | void, mode: "land" | "sea" | "both" = "land", passable?: (cell: number) => boolean): void {
    const { mesh } = this.w;
    const g = this.g;
    const gen = ++this.gen;
    const dist = this.dist, stamp = this.stamp, heap = this.heap;
    heap.clear();
    for (const s of sources) {
      stamp[s] = gen;
      dist[s] = 0;
      heap.push(0, s);
    }
    while (heap.size) {
      const c = heap.pop();
      const d = heap.lastKey;
      if (d > dist[c]) continue;
      if (visit(c, d) === false) return;
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const j = mesh.adj[k];
        let cost: number;
        if (mode === "land") cost = g.landCost[k];
        else if (mode === "sea") cost = g.water[c] || g.water[j] ? g.seaCost[k] : Infinity;
        else cost = Math.min(g.landCost[k], g.seaCost[k]);
        if (cost === Infinity) continue;
        if (passable && !passable(j)) continue;
        const nd = d + cost;
        if (nd > maxCost) continue;
        if (stamp[j] !== gen || nd < dist[j]) {
          stamp[j] = gen;
          dist[j] = nd;
          heap.push(nd, j);
        }
      }
    }
  }
}

export { cellDistanceKm };
