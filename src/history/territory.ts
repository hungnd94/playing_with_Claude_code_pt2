/**
 * Territory. Every settlement commands a catchment: the cells nearest to it by
 * travel cost (bigger towns reach further), bounded by an administrative reach.
 * A realm's territory is the union of its settlements' catchments, so borders
 * fall where travel is hard — along mountain crests, wide rivers, marshes and
 * deserts — and shift as towns grow, fall and change hands.
 *
 * Also here: per-cell owner/culture/religion layers, border lengths between
 * realms, cultural contacts, travel distance from each town to its capital,
 * and the settlement adjacency graph used by war, trade and diffusion.
 */
import { MinHeap } from "../core/heap";
import type { Sim } from "./sim";
import { pairKey } from "./util";

const heap = new MinHeap(4096);
let keyBuf: Float64Array | null = null;
let pureBuf: Float32Array | null = null;

export function recomputeCatchments(sim: Sim): void {
  const { mesh } = sim.w;
  const g = sim.g;
  const n = sim.n;
  if (!keyBuf || keyBuf.length !== n) {
    keyBuf = new Float64Array(n);
    pureBuf = new Float32Array(n);
  }
  const key = keyBuf, pure = pureBuf!;
  key.fill(Infinity);
  const cellSet = sim.cellSet;
  cellSet.fill(-1);
  const reach = new Float32Array(sim.S.length);
  heap.clear();
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    const C = sim.C[s.culture];
    const lp = Math.log(1 + s.pop / 4000);
    const bonus = 28 * lp;
    reach[sid] = 150 + 55 * lp + 18 * C.tech + (s.owner >= 0 ? 70 : 0) + (C.archetype === "steppe" ? 90 : 0);
    key[s.cell] = -bonus;
    pure[s.cell] = 0;
    cellSet[s.cell] = sid;
    heap.push(-bonus, s.cell);
  }
  const { adjStart, adj } = mesh;
  while (heap.size) {
    const c = heap.pop();
    const k = heap.lastKey;
    if (k > key[c]) continue;
    const s = cellSet[c];
    const R = reach[s];
    const pc = pure[c];
    for (let e = adjStart[c]; e < adjStart[c + 1]; e++) {
      const cost = g.landCost[e];
      if (cost === Infinity) continue;
      const j = adj[e];
      const np = pc + cost;
      if (np > R) continue;
      const nk = k + cost;
      if (nk < key[j]) {
        key[j] = nk;
        pure[j] = np;
        cellSet[j] = s;
        heap.push(nk, j);
      }
    }
  }
  // Catchment lists (counting sort) and food sums.
  const S = sim.S;
  const count = new Int32Array(S.length + 1);
  for (const c of g.landCells) if (cellSet[c] >= 0) count[cellSet[c]]++;
  let acc = 0;
  for (let i = 0; i < S.length; i++) {
    S[i].catchStart = acc;
    acc += count[i];
    S[i].catchLen = 0;
    S[i].food = 0;
  }
  for (const c of g.landCells) {
    const s = cellSet[c];
    if (s < 0) continue;
    const st = S[s];
    sim.catchCells[st.catchStart + st.catchLen++] = c;
    st.food += g.food[c];
  }
  // Settlement adjacency.
  for (const sid of sim.alive()) S[sid].nbrs = [];
  for (const c of g.landCells) {
    const a = cellSet[c];
    if (a < 0) continue;
    for (let e = adjStart[c]; e < adjStart[c + 1]; e++) {
      const b = cellSet[adj[e]];
      if (b < 0 || b === a) continue;
      const nb = S[a].nbrs;
      if (!nb.includes(b)) nb.push(b);
    }
  }
  for (const sid of sim.alive()) S[sid].nbrs.sort((x, y) => x - y);
}

/** Refresh per-cell owner/culture/religion layers from settlement state; border and contact bookkeeping. */
export function refreshLayers(sim: Sim): void {
  const g = sim.g;
  const S = sim.S;
  for (const P of sim.P) {
    P.cells = 0;
    P.area = 0;
  }
  for (const c of g.landCells) {
    const s = sim.cellSet[c];
    if (s < 0 || !S[s].alive) {
      sim.cellOwner[c] = -1;
      sim.cellCulture[c] = -1;
      sim.cellReligion[c] = -1;
      continue;
    }
    const st = S[s];
    sim.cellOwner[c] = st.owner;
    sim.cellCulture[c] = st.culture;
    sim.cellReligion[c] = st.religion;
    if (st.owner >= 0) {
      const P = sim.P[st.owner];
      P.cells++;
      P.area += g.areaKm2[c];
    }
  }
  for (const P of sim.P) if (P.alive && P.area > P.rec.peak.areaKm2) P.rec.peak = { areaKm2: Math.round(P.area), year: sim.year };
}

/** Border lengths between realms, realm adjacency and contacts between peoples (every 10 years). */
export function refreshAdjacency(sim: Sim): void {
  const g = sim.g;
  const { adjStart, adj } = sim.w.mesh;
  // Borders between polities and contacts between cultures.
  sim.borders.clear();
  for (const C of sim.C) C.contacts.clear();
  for (const c of g.landCells) {
    const o = sim.cellOwner[c];
    const cu = sim.cellCulture[c];
    for (let e = adjStart[c]; e < adjStart[c + 1]; e++) {
      const j = adj[e];
      if (j < c || !g.land[j]) continue;
      const o2 = sim.cellOwner[j];
      if (o >= 0 && o2 >= 0 && o !== o2) {
        const k = pairKey(o, o2);
        sim.borders.set(k, (sim.borders.get(k) ?? 0) + 1);
      }
      const cu2 = sim.cellCulture[j];
      if (cu >= 0 && cu2 >= 0 && cu !== cu2) {
        sim.C[cu].contacts.add(cu2);
        sim.C[cu2].contacts.add(cu);
      }
    }
  }
  sim.polNbrs.clear();
  for (const k of sim.borders.keys()) {
    const a = Math.floor(k / 65536), b = k % 65536;
    (sim.polNbrs.get(a) ?? sim.polNbrs.set(a, []).get(a)!).push(b);
    (sim.polNbrs.get(b) ?? sim.polNbrs.set(b, []).get(b)!).push(a);
  }
  for (const v of sim.polNbrs.values()) v.sort((x, y) => x - y);
  seaNeighbours(sim);
}

/**
 * Realms within sailing reach of each other's coasts (for war, trade and
 * marriage across water). Coastal towns are bucketed on a coarse 3-D grid so
 * only nearby pairs are compared.
 */
function seaNeighbours(sim: Sim): void {
  sim.seaNbrs.clear();
  const S = sim.S;
  const B = 0.22; // bucket size in unit-vector space (~900 km)
  const buckets = new Map<number, number[]>();
  const keyOf = (x: number, y: number, z: number) => ((Math.floor(x / B) + 16) * 64 + (Math.floor(y / B) + 16)) * 64 + (Math.floor(z / B) + 16);
  const coastal: number[] = [];
  for (const sid of sim.alive()) {
    const s = S[sid];
    if (s.owner < 0 || !sim.g.coastal[s.cell] || (s.urban < 600 && !s.port)) continue;
    coastal.push(sid);
    const p = s.rec.pos;
    const k = keyOf(p[0], p[1], p[2]);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(sid);
  }
  const pairs = new Set<number>();
  for (const sid of coastal) {
    const s = S[sid];
    const C = sim.C[s.culture];
    if (C.tech < 1.2 && C.values.seafaring < 0.5) continue;
    const reachKm = Math.min(1800, (300 + 700 * C.values.seafaring) * (1 + 0.3 * C.tech));
    const p = s.rec.pos;
    const bx = Math.floor(p[0] / B), by = Math.floor(p[1] / B), bz = Math.floor(p[2] / B);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = buckets.get(((bx + dx + 16) * 64 + (by + dy + 16)) * 64 + (bz + dz + 16));
      if (!list) continue;
      for (const t of list) {
        const o = S[t].owner;
        if (o === s.owner || o < 0) continue;
        const k = pairKey(s.owner, o);
        if (pairs.has(k) || sim.borders.has(k)) continue;
        if (sim.distKm(s.cell, S[t].cell) <= reachKm) pairs.add(k);
      }
    }
  }
  for (const k of pairs) {
    const a = Math.floor(k / 65536), b = k % 65536;
    (sim.seaNbrs.get(a) ?? sim.seaNbrs.set(a, []).get(a)!).push(b);
    (sim.seaNbrs.get(b) ?? sim.seaNbrs.set(b, []).get(b)!).push(a);
  }
  for (const v of sim.seaNbrs.values()) v.sort((x, y) => x - y);
}

let capKey: Float64Array | null = null;
const capHeap = new MinHeap(4096);

/** Travel cost from every town to its owner's capital through the realm's own land (sea hops estimated). */
export function capitalDistances(sim: Sim): void {
  const n = sim.n;
  if (!capKey || capKey.length !== n) capKey = new Float64Array(n);
  const key = capKey;
  key.fill(Infinity);
  capHeap.clear();
  for (const P of sim.P) {
    if (!P.alive || P.capital < 0) continue;
    const c = sim.S[P.capital].cell;
    key[c] = 0;
    capHeap.push(0, c);
  }
  const g = sim.g;
  const { adjStart, adj } = sim.w.mesh;
  const own = sim.cellOwner;
  while (capHeap.size) {
    const c = capHeap.pop();
    const k = capHeap.lastKey;
    if (k > key[c]) continue;
    const o = own[c];
    for (let e = adjStart[c]; e < adjStart[c + 1]; e++) {
      const cost = g.landCost[e];
      if (cost === Infinity) continue;
      const j = adj[e];
      if (own[j] !== o) continue;
      const nk = k + cost;
      if (nk < key[j]) {
        key[j] = nk;
        capHeap.push(nk, j);
      }
    }
  }
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    if (s.owner < 0) {
      s.capDist = 0;
      continue;
    }
    const d = key[s.cell];
    if (d < Infinity) s.capDist = d;
    else {
      const P = sim.P[s.owner];
      s.capDist = P.capital >= 0 ? sim.distKm(s.cell, sim.S[P.capital].cell) * 0.9 + 150 : 2000;
    }
  }
}

/** A land cell of settlement a's catchment adjacent to settlement b's catchment (a battlefield), or a's own cell. */
export function frontierCell(sim: Sim, a: number, b: number): number {
  const A = sim.S[a];
  const { adjStart, adj } = sim.w.mesh;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = A.catchStart; i < A.catchStart + A.catchLen; i++) {
    const c = sim.catchCells[i];
    for (let e = adjStart[c]; e < adjStart[c + 1]; e++) {
      if (sim.cellSet[adj[e]] !== b) continue;
      // Prefer river crossings and high ground: armies meet at fords and on hills.
      const sc = (sim.w.riverOrder[c] > 0 ? 1 : 0) + sim.g.defense[c] + ((c * 2654435761) % 1000) / 4000;
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
      break;
    }
  }
  return best >= 0 ? best : A.cell;
}
