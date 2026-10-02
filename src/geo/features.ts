/**
 * Feature extraction: turns the per-cell physical fields into a curated set of
 * name-able geographic features with facts a writer can use.
 *
 * Land
 *   - Landmasses: connected land (lakes included). Continents are the big ones
 *     (≥ 3.5% of all land, or the largest), the rest islands. Small islands
 *     close together are grouped into archipelagos.
 *   - Peninsulas: land removed by a morphological opening of the landmass
 *     (erode k hops from the coast, dilate back) that is still attached to the
 *     core: thin protrusions such as Italy, Korea or Kamchatka.
 *   - Terrain regions (one per cell, in priority order → `regionOf`): glaciers,
 *     mountain ranges (high relief; long ranges are split), hills, deserts,
 *     marshes, jungles, forests, steppes, tundra and plains. Very large regions
 *     are split into chunks of comparable size.
 *   - Volcanoes: notable individual volcanic peaks.
 *
 * Water
 *   - Oceans: a geodesic Voronoi partition of the sea grown from the points
 *     farthest from land, with fronts that slow down in narrows so that ocean
 *     boundaries settle in straits and between continents.
 *   - Seas, gulfs and bays: a persistence-based watershed on distance-to-land.
 *     Basins whose mouth (the highest saddle to the rest of the sea) is narrow
 *     compared to their own width are semi-enclosed: large ones become seas,
 *     small ones bays/gulfs. Nested basins are kept (a gulf inside a sea).
 *   - Straits: the narrow saddles that separate those basins, when both sides
 *     are sizeable.
 *   - Lakes: one per hydrological lake.
 *   - Rivers: from each significant mouth, the main stem is traced upstream
 *     along the largest discharge; big tributaries become rivers of their own
 *     (cells ordered source → mouth).
 */
import type { SphereMesh } from "../core/sphere";
import { MinHeap } from "../core/heap";
import { BIOME_NAMES, Biome, type GeoFeature, type GeoFeatureKind, type Lake } from "../world/types";
import { cellAngle, components, distanceField } from "./util";

export interface FeatureInputs {
  mesh: SphereMesh;
  radiusKm: number;
  edgeLen: Float32Array;
  areaKm2: Float32Array;
  elevation: Float32Array;
  isLand: Uint8Array;
  lakeId: Int32Array;
  lakes: Lake[];
  coastDist: Int16Array;
  temperature: Float32Array;
  precipitation: Float32Array;
  biome: Uint8Array;
  downstream: Int32Array;
  flow: Float32Array;
  volcanism: Float32Array;
  orogeny: Float32Array;
  oldOrogen: Float32Array;
  rift: Float32Array;
  relief: Float32Array;
  boundary: Uint8Array;
  currentAnom: Float32Array;
  hotspotCells: number[];
}

export interface FeatureResult {
  features: GeoFeature[];
  landmassOf: Int32Array;
  waterBodyOf: Int32Array;
  regionOf: Int32Array;
}

const DEG = 180 / Math.PI;

export function latitudeBand(latRad: number): string {
  const a = Math.abs(latRad) * DEG;
  const h = latRad >= 0 ? "northern" : "southern";
  if (a < 10) return "equatorial";
  if (a < 23.5) return `${h} tropical`;
  if (a < 35) return `${h} subtropical`;
  if (a < 55) return `${h} temperate`;
  if (a < 66.5) return `${h} subpolar`;
  return `${h} polar`;
}

export function extractFeatures(inp: FeatureInputs): FeatureResult {
  const { mesh, areaKm2, elevation, isLand, lakeId, biome, temperature, precipitation } = inp;
  const n = mesh.n;
  const features: GeoFeature[] = [];
  const landmassOf = new Int32Array(n).fill(-1);
  const waterBodyOf = new Int32Array(n).fill(-1);
  const regionOf = new Int32Array(n).fill(-1);
  const isOcean = (i: number) => !isLand[i];
  const dryLand = (i: number) => isLand[i] === 1 && lakeId[i] < 0;

  const add = (kind: GeoFeatureKind, cells: ArrayLike<number>, anchor: number, size: number, parent: number, attrs: Record<string, number | string>): GeoFeature => {
    const f: GeoFeature = { id: features.length, kind, cells: Int32Array.from(cells), anchor, size, parent, attrs };
    features.push(f);
    return f;
  };
  const areaOf = (cells: ArrayLike<number>) => { let a = 0; for (let k = 0; k < cells.length; k++) a += areaKm2[cells[k]]; return a; };
  /** Cell closest to the area-weighted centroid among `cells`. */
  const centroidCell = (cells: ArrayLike<number>) => {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < cells.length; k++) { const c = cells[k]; x += mesh.xyz[3 * c]; y += mesh.xyz[3 * c + 1]; z += mesh.xyz[3 * c + 2]; }
    let best = cells[0], bd = -Infinity;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const d = x * mesh.xyz[3 * c] + y * mesh.xyz[3 * c + 1] + z * mesh.xyz[3 * c + 2];
      if (d > bd) { bd = d; best = c; }
    }
    return best;
  };
  const meanOf = (cells: ArrayLike<number>, f: ArrayLike<number>) => { let s = 0, a = 0; for (let k = 0; k < cells.length; k++) { const c = cells[k]; s += f[c] * areaKm2[c]; a += areaKm2[c]; } return a ? s / a : 0; };
  const latExtent = (cells: ArrayLike<number>) => {
    let lo = 90, hi = -90;
    for (let k = 0; k < cells.length; k++) { const l = mesh.lat[cells[k]] * DEG; if (l < lo) lo = l; if (l > hi) hi = l; }
    return [lo, hi];
  };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r0 = (x: number) => Math.round(x);
  /** Rough length of a cell set: max great-circle distance from the first-found extreme. */
  const extentKm = (cells: ArrayLike<number>) => {
    if (cells.length < 2) return Math.sqrt(areaOf(cells));
    const c0 = cells[0];
    let a = c0, best = -1;
    for (let k = 0; k < cells.length; k++) { const d = cellAngle(mesh, c0, cells[k]); if (d > best) { best = d; a = cells[k]; } }
    best = -1;
    for (let k = 0; k < cells.length; k++) { const d = cellAngle(mesh, a, cells[k]); if (d > best) best = d; }
    return best * inp.radiusKm + Math.sqrt(areaKm2[c0]);
  };

  // ======================================================================= landmasses
  const lm = components(mesh, (i) => isLand[i] === 1);
  const lmCells: number[][] = Array.from({ length: lm.count }, () => []);
  for (let i = 0; i < n; i++) if (lm.comp[i] >= 0) lmCells[lm.comp[i]].push(i);
  let totalLand = 0;
  for (let i = 0; i < n; i++) if (isLand[i]) totalLand += areaKm2[i];
  const lmArea = lmCells.map(areaOf);
  const lmOrder = Array.from({ length: lm.count }, (_, k) => k).sort((a, b) => lmArea[b] - lmArea[a] || a - b);
  const lmFeature = new Int32Array(lm.count).fill(-1);
  const isContinent = (k: number) => k === lmOrder[0] || lmArea[k] >= 0.035 * totalLand;
  // Island clusters: islands (≤ 40 cells) whose sea gap is ≤ 3 hops.
  const clusterOf = new Int32Array(lm.count).fill(-1);
  {
    const uf = Array.from({ length: lm.count }, (_, k) => k);
    const fnd = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const small = (k: number) => !isContinent(k) && lmCells[k].length <= 40;
    for (let k = 0; k < lm.count; k++) {
      if (!small(k)) continue;
      const seen = new Set<number>(lmCells[k]);
      let fr = lmCells[k].slice();
      for (let h = 0; h < 3; h++) {
        const nx: number[] = [];
        for (const c of fr) for (let t = mesh.adjStart[c]; t < mesh.adjStart[c + 1]; t++) {
          const u = mesh.adj[t];
          if (seen.has(u)) continue;
          seen.add(u);
          if (isLand[u]) {
            const o = lm.comp[u];
            if (o !== k && small(o)) { const a = fnd(o), b = fnd(k); if (a !== b) uf[Math.max(a, b)] = Math.min(a, b); }
          } else nx.push(u);
        }
        fr = nx;
      }
    }
    const members = new Map<number, number[]>();
    for (let k = 0; k < lm.count; k++) if (small(k)) { const r = fnd(k); if (!members.has(r)) members.set(r, []); members.get(r)!.push(k); }
    for (const [r, ks] of members) if (ks.length >= 3) for (const k of ks) clusterOf[k] = r;
  }
  const absorbed = (k: number) => clusterOf[k] >= 0 && lmCells[k].length <= 2;
  for (const k of lmOrder) {
    if (absorbed(k)) continue;
    const cells = lmCells[k];
    const isCont = isContinent(k);
    let peak = cells[0];
    for (const c of cells) if (elevation[c] > elevation[peak]) peak = c;
    const [lo, hi] = latExtent(cells);
    let coast = 0, volc = 0;
    for (const c of cells) { if (inp.coastDist[c] === 1) coast++; volc = Math.max(volc, inp.volcanism[c]); }
    const bcount = new Float64Array(32);
    for (const c of cells) if (lakeId[c] < 0) bcount[biome[c]] += areaKm2[c];
    let dom = 0;
    for (let b = 0; b < 32; b++) if (bcount[b] > bcount[dom]) dom = b;
    const attrs: Record<string, number | string> = {
      area: r0(lmArea[k]),
      highestPoint: r1(elevation[peak] * 1000) / 1000,
      highestCell: peak,
      meanElevation: r1(meanOf(cells, elevation) * 1000) / 1000,
      latitudeMin: r1(lo), latitudeMax: r1(hi),
      latitudeBand: latitudeBand(mesh.lat[centroidCell(cells)]),
      coastlineKm: r0(coast * mesh.meanSpacing * inp.radiusKm),
      dominantBiome: BIOME_NAMES[dom],
      meanTemperature: r1(meanOf(cells, temperature)),
      meanPrecipitation: r0(meanOf(cells, precipitation)),
    };
    if (!isCont && volc > 0.5) attrs.volcanic = 1;
    const f = add(isCont ? "continent" : "island", cells, isCont ? centroidCell(cells) : peak, lmArea[k], -1, attrs);
    lmFeature[k] = f.id;
    for (const c of cells) landmassOf[c] = f.id;
  }
  // Archipelagos (their tiny islets use the archipelago as their landmass).
  {
    const roots = [...new Set(Array.from(clusterOf).filter((r) => r >= 0))].sort((a, b) => a - b);
    for (const r of roots) {
      const ks = [];
      for (let k = 0; k < lm.count; k++) if (clusterOf[k] === r) ks.push(k);
      const cells: number[] = [];
      for (const k of ks) cells.push(...lmCells[k]);
      let volc = 0;
      for (const c of cells) volc = Math.max(volc, inp.volcanism[c]);
      const anchor = centroidCell(cells);
      const a = add("archipelago", cells, anchor, areaOf(cells), -1, {
        islands: ks.length,
        area: r0(areaOf(cells)),
        latitudeBand: latitudeBand(mesh.lat[anchor]),
        origin: volc > 0.5 ? "volcanic" : "continental fragments",
      });
      for (const k of ks) {
        if (absorbed(k)) { for (const c of lmCells[k]) landmassOf[c] = a.id; lmFeature[k] = a.id; }
        else features[lmFeature[k]].attrs.archipelago = a.id;
      }
    }
  }

  // ======================================================================= water: distance to land
  const coastLand: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isLand[i]) continue;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (!isLand[mesh.adj[k]]) { coastLand.push(i); break; }
  }
  const dl = distanceField(mesh, inp.edgeLen, coastLand, Infinity, (_a, b) => !isLand[b]).dist;
  const dKm = new Float32Array(n);
  for (let i = 0; i < n; i++) dKm[i] = isLand[i] ? 0 : (dl[i] === Infinity ? 1e5 : dl[i]);

  // ---- oceans: seeded geodesic partition whose fronts crawl through narrows.
  let oceanArea = 0;
  for (let i = 0; i < n; i++) if (!isLand[i]) oceanArea += areaKm2[i];
  const scale = (inp.radiusKm / 4200) ** 2;
  const nOceans = Math.max(1, Math.min(8, Math.round(oceanArea / (26e6 * scale))));
  const byDist = Array.from({ length: n }, (_, i) => i).filter((i) => !isLand[i]).sort((a, b) => dKm[b] - dKm[a] || a - b);
  const seeds: number[] = [];
  const minSep = (0.5 * Math.PI) * Math.sqrt(1 / Math.max(1, nOceans)) * 1.1;
  for (const c of byDist) {
    if (seeds.length >= nOceans) break;
    if (dKm[c] < 250) break;
    let ok = true;
    for (const s of seeds) if (cellAngle(mesh, c, s) < minSep) { ok = false; break; }
    if (ok) seeds.push(c);
  }
  if (seeds.length === 0 && byDist.length) seeds.push(byDist[0]);
  const oceanOf = new Int32Array(n).fill(-1);
  {
    const best = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap(4096);
    seeds.forEach((s, k) => { best[s] = 0; oceanOf[s] = k; heap.push(0, s); });
    while (heap.size) {
      const c = heap.pop();
      const t = heap.lastKey;
      if (t > best[c]) continue;
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (isLand[u]) continue;
        const sp = Math.min(dKm[c], dKm[u]) + 60;
        const nt = t + inp.edgeLen[k] / (sp * sp);
        if (nt < best[u]) { best[u] = nt; oceanOf[u] = oceanOf[c]; heap.push(nt, u); }
      }
    }
  }

  // ---- watershed hierarchy on dKm for seas / bays / straits.
  // Steepest ascent → peak basins.
  const peakOf = new Int32Array(n).fill(-1);
  for (const c of byDist) {
    // byDist is in decreasing dKm, so the ascent target is resolved before c.
    let up = -1, ud = dKm[c];
    for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
      const u = mesh.adj[k];
      if (isLand[u]) continue;
      if (dKm[u] > ud || (dKm[u] === ud && u < c && peakOf[u] >= 0)) { ud = dKm[u]; up = u; }
    }
    peakOf[c] = up >= 0 && peakOf[up] >= 0 ? peakOf[up] : c;
  }
  // Basin graph: highest saddle between adjacent peak basins.
  const saddle = new Map<number, { s: number; i: number; j: number }>();
  for (let i = 0; i < n; i++) {
    if (isLand[i]) continue;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      if (j <= i || isLand[j] || peakOf[j] === peakOf[i]) continue;
      const a = Math.min(peakOf[i], peakOf[j]), b = Math.max(peakOf[i], peakOf[j]);
      const key = a * n + b;
      const s = Math.min(dKm[i], dKm[j]);
      const cur = saddle.get(key);
      if (!cur || s > cur.s) saddle.set(key, { s, i, j });
    }
  }
  const edges = [...saddle.entries()].map(([key, v]) => ({ a: Math.floor(key / n), b: key % n, ...v }))
    .sort((x, y) => y.s - x.s || x.a - y.a || x.b - y.b);
  // Union–find over peaks with member linked lists and basin stats.
  const parent = new Int32Array(n).fill(-1);
  const head = new Int32Array(n).fill(-1), tail = new Int32Array(n).fill(-1), nextM = new Int32Array(n).fill(-1);
  const bArea = new Float64Array(n), bPeak = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (isLand[i]) continue;
    const p = peakOf[i];
    if (parent[p] === -1) { parent[p] = p; bPeak[p] = dKm[p]; }
    bArea[p] += areaKm2[i];
    if (head[p] === -1) { head[p] = i; tail[p] = i; } else { nextM[tail[p]] = i; tail[p] = i; }
  }
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  type Candidate = { cells: number[]; peak: number; saddle: number; area: number; mouthI: number; mouthJ: number; otherRoot: number };
  const candidates: Candidate[] = [];
  const cellArea = oceanArea / Math.max(1, byDist.length);
  for (const e of edges) {
    let A = find(e.a), B = find(e.b);
    if (A === B) continue;
    // A = the basin with the lower peak (the one that may be enclosed).
    if (bPeak[A] > bPeak[B] || (bPeak[A] === bPeak[B] && A > B)) { const t = A; A = B; B = t; }
    const maxMouth = 3.2 * mesh.meanSpacing * inp.radiusKm; // half-width of the mouth
    const enclosed = e.s < 0.62 * bPeak[A] && e.s < maxMouth && bArea[A] >= 3 * cellArea && bArea[A] < 0.6 * bArea[B];
    if (enclosed) {
      const cells: number[] = [];
      for (let c = head[A]; c !== -1; c = nextM[c]) cells.push(c);
      candidates.push({ cells, peak: bPeak[A], saddle: e.s, area: bArea[A], mouthI: e.i, mouthJ: e.j, otherRoot: B });
    }
    // Merge A into B.
    parent[A] = B;
    bArea[B] += bArea[A];
    bPeak[B] = Math.max(bPeak[B], bPeak[A]);
    if (head[A] !== -1) { if (head[B] === -1) { head[B] = head[A]; tail[B] = tail[A]; } else { nextM[tail[B]] = head[A]; tail[B] = tail[A]; } }
  }

  // Choose seas and bays among candidates (largest first so that nested ones get a parent).
  const seaMin = 30 * cellArea, bayMin = 3 * cellArea;
  const maxSea = 0.18 * oceanArea;
  candidates.sort((x, y) => y.area - x.area || x.cells[0] - y.cells[0]);
  const waterLevel = new Int32Array(n).fill(-1); // most specific sea/bay feature id
  const chosenWater: { f: GeoFeature; cand: Candidate }[] = [];
  let bayCount = 0, seaCount = 0;
  for (const cand of candidates) {
    if (cand.area > maxSea || cand.area < bayMin) continue;
    const enclosure = 1 - cand.saddle / Math.max(1, cand.peak);
    const isSea = cand.area >= seaMin;
    if (!isSea && enclosure < 0.45) continue;
    if (isSea ? seaCount >= 16 : bayCount >= 16) continue;
    // Skip near-duplicates of an already chosen body (≥ 85% the same cells).
    const par = waterLevel[cand.cells[0]];
    if (par >= 0) {
      const pf = features[par];
      if (cand.cells.length > 0.85 * pf.cells.length) continue;
    }
    // Bays must touch the coast meaningfully.
    let coastCells = 0;
    for (const c of cand.cells) if (dKm[c] < 1.2 * mesh.meanSpacing * inp.radiusKm) coastCells++;
    if (!isSea && coastCells < 2) continue;
    let maxDepth = 0;
    for (const c of cand.cells) maxDepth = Math.max(maxDepth, -elevation[c]);
    const kind: GeoFeatureKind = isSea ? "sea" : "bay";
    const anchor = cand.cells.reduce((b, c) => (dKm[c] > dKm[b] ? c : b), cand.cells[0]);
    const attrs: Record<string, number | string> = {
      area: r0(cand.area),
      meanDepth: r1(meanOf(cand.cells, elevation) * -1000) / 1000,
      maxDepth: r1(maxDepth * 1000) / 1000,
      mouthWidthKm: r0(2 * cand.saddle + mesh.meanSpacing * inp.radiusKm),
      enclosure: Math.round(enclosure * 100) / 100,
      latitudeBand: latitudeBand(mesh.lat[anchor]),
      meanTemperature: r1(meanOf(cand.cells, temperature)),
    };
    if (!isSea) attrs.type = cand.area > 25 * cellArea ? "gulf" : cand.area > 8 * cellArea ? "bay" : "inlet";
    const f = add(kind, cand.cells, anchor, cand.area, par >= 0 ? par : -1, attrs);
    chosenWater.push({ f, cand });
    if (isSea) seaCount++; else bayCount++;
    for (const c of cand.cells) waterLevel[c] = f.id;
  }

  // Oceans: the cells of each ocean partition not claimed by seas/bays.
  const oceanFeature: number[] = [];
  for (let k = 0; k < seeds.length; k++) {
    const cells: number[] = [];
    for (let i = 0; i < n; i++) if (!isLand[i] && oceanOf[i] === k) cells.push(i);
    if (!cells.length) { oceanFeature.push(-1); continue; }
    let maxDepth = 0, ice = 0, iceA = 0, area = 0;
    for (const c of cells) {
      maxDepth = Math.max(maxDepth, -elevation[c]);
      area += areaKm2[c];
      if (biome[c] === Biome.SeaIce) ice += areaKm2[c];
      iceA += areaKm2[c];
    }
    const f = add("ocean", cells, seeds[k], area, -1, {
      area: r0(area),
      meanDepth: r1(meanOf(cells, elevation) * -1000) / 1000,
      maxDepth: r1(maxDepth * 1000) / 1000,
      latitudeBand: latitudeBand(mesh.lat[seeds[k]]),
      meanTemperature: r1(meanOf(cells, temperature)),
      iceCover: Math.round((100 * ice) / Math.max(1, iceA)) / 100,
    });
    oceanFeature.push(f.id);
  }
  for (let i = 0; i < n; i++) {
    if (isLand[i]) continue;
    waterBodyOf[i] = waterLevel[i] >= 0 ? waterLevel[i] : oceanOf[i] >= 0 ? oceanFeature[oceanOf[i]] : -1;
  }
  // Seas / bays without a sea parent sit in the ocean that holds most of their cells.
  for (const { f } of chosenWater) {
    if (f.parent >= 0) continue;
    const cnt = new Map<number, number>();
    for (const c of f.cells) { const o = oceanOf[c]; if (o >= 0) cnt.set(o, (cnt.get(o) ?? 0) + 1); }
    let bestO = -1, bc = -1;
    for (const [o, c] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) if (c > bc) { bc = c; bestO = o; }
    if (bestO >= 0) f.parent = oceanFeature[bestO];
  }

  // ---- straits at the narrow mouths of seas/bays and between oceans.
  const straitCells = new Uint8Array(n);
  type StraitCand = { i: number; j: number; s: number; a: number; b: number; score: number };
  const straitCands: StraitCand[] = [];
  const proposeStrait = (i: number, j: number, s: number, sideA: number, sideB: number) => {
    if (s > 1.6 * mesh.meanSpacing * inp.radiusKm || sideA < 0 || sideB < 0) return;
    const score = Math.min(features[sideA].size, features[sideB].size) / (s + 40);
    straitCands.push({ i, j, s, a: sideA, b: sideB, score });
  };
  const addStrait = (i: number, j: number, s: number, sideA: number, sideB: number) => {
    // Cells near the saddle that are narrow (close to land).
    const cells: number[] = [];
    const seen = new Set<number>([i, j]);
    const queue = [i, j];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      if (straitCells[c]) return; // already part of a strait
      cells.push(c);
      if (cells.length >= 8) break;
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (isLand[u] || seen.has(u)) continue;
        if (dKm[u] > s * 1.15 + 1 || cellAngle(mesh, u, i) * inp.radiusKm > 2.2 * mesh.meanSpacing * inp.radiusKm) continue;
        seen.add(u);
        queue.push(u);
      }
    }
    // Which landmasses flank it?
    const flank = new Set<number>();
    for (const c of cells) for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) { const u = mesh.adj[k]; if (isLand[u] && landmassOf[u] >= 0) flank.add(landmassOf[u]); }
    for (const c of cells) straitCells[c] = 1;
    const fl = [...flank].sort((a, b) => a - b);
    let depth = 0;
    for (const c of cells) depth += -elevation[c];
    add("strait", cells, i, r0(2 * s + mesh.meanSpacing * inp.radiusKm), sideB, {
      widthKm: r0(2 * s + mesh.meanSpacing * inp.radiusKm),
      meanDepth: r1((depth / cells.length) * 1000) / 1000,
      connects: `${sideA},${sideB}`,
      between: fl.join(","),
      latitudeBand: latitudeBand(mesh.lat[i]),
    });
  };
  for (const { f, cand } of chosenWater) {
    if (cand.area < 6 * cellArea) continue;
    const outside = waterBodyOf[cand.mouthJ] === f.id ? waterBodyOf[cand.mouthI] : waterBodyOf[cand.mouthJ];
    if (outside < 0 || outside === f.id) continue;
    proposeStrait(cand.mouthI, cand.mouthJ, cand.saddle, f.id, outside);
  }
  // Narrow passages between different oceans: each connected stretch of the boundary
  // between two oceans is a passage; short ones are straits.
  {
    const onBoundary = new Int32Array(n).fill(-1); // other ocean index
    for (let i = 0; i < n; i++) {
      if (isLand[i] || oceanOf[i] < 0 || straitCells[i]) continue;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
        const j = mesh.adj[k];
        if (!isLand[j] && oceanOf[j] >= 0 && oceanOf[j] !== oceanOf[i]) { onBoundary[i] = oceanOf[j]; break; }
      }
    }
    const pairKey = (i: number) => Math.min(oceanOf[i], onBoundary[i]) * 64 + Math.max(oceanOf[i], onBoundary[i]);
    const cc = components(mesh, (i) => onBoundary[i] >= 0, (a, b) => pairKey(a) === pairKey(b));
    const groups: number[][] = Array.from({ length: cc.count }, () => []);
    for (let i = 0; i < n; i++) if (cc.comp[i] >= 0) groups[cc.comp[i]].push(i);
    for (const g of groups) {
      if (g.length > 7) continue; // a wide-open boundary, not a strait
      let s = 0, i0 = g[0];
      for (const c of g) if (dKm[c] > s) { s = dKm[c]; i0 = c; }
      const key = pairKey(g[0]);
      const a = Math.floor(key / 64), b = key % 64;
      let j0 = -1;
      for (let k = mesh.adjStart[i0]; k < mesh.adjStart[i0 + 1]; k++) { const j = mesh.adj[k]; if (!isLand[j] && oceanOf[j] >= 0 && oceanOf[j] !== oceanOf[i0]) { j0 = j; break; } }
      if (j0 < 0) continue;
      proposeStrait(i0, j0, s, oceanFeature[a], oceanFeature[b]);
    }
  }
  straitCands.sort((x, y) => y.score - x.score || x.i - y.i);
  {
    let made = 0;
    const seenPair = new Set<string>();
    for (const c of straitCands) {
      if (made >= 12) break;
      const key = `${Math.min(c.a, c.b)}-${Math.max(c.a, c.b)}`;
      if (seenPair.has(key)) continue;
      const before = features.length;
      addStrait(c.i, c.j, c.s, c.a, c.b);
      if (features.length > before) { made++; seenPair.add(key); }
    }
  }

  // ======================================================================= lakes
  const lakeFeature = new Int32Array(inp.lakes.length).fill(-1);
  for (const lake of inp.lakes) {
    const cells = Array.from(lake.cells);
    let minBed = Infinity;
    for (const c of cells) minBed = Math.min(minBed, elevation[c]);
    let inflow = 0;
    for (const c of cells) inflow = Math.max(inflow, inp.flow[c]);
    const anchor = centroidCell(cells);
    const f = add("lake", cells, anchor, areaOf(cells), landmassOf[cells[0]], {
      area: r0(areaOf(cells)),
      surfaceElevation: Math.round(lake.surface * 1000) / 1000,
      maxDepth: Math.round(Math.max(0.005, lake.surface - minBed) * 1000) / 1000,
      salinity: lake.salty ? "saline" : "fresh",
      endorheic: lake.salty ? 1 : 0,
      discharge: r0(inflow),
      latitudeBand: latitudeBand(mesh.lat[anchor]),
      meanTemperature: r1(meanOf(cells, temperature)),
      frozenInWinter: meanOf(cells, temperature) < 2 ? 1 : 0,
    });
    if (inp.rift[cells[0]] > 0.3 || cells.some((c) => inp.rift[c] > 0.3)) f.attrs.origin = "rift";
    else if (meanOf(cells, temperature) < 3) f.attrs.origin = "glacial";
    else if (lake.salty) f.attrs.origin = "endorheic basin";
    else f.attrs.origin = "tectonic basin";
    lakeFeature[lake.id] = f.id;
    for (const c of cells) waterBodyOf[c] = f.id;
  }

  // ======================================================================= rivers
  {
    const up: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      const j = inp.downstream[i];
      if (j >= 0 && isLand[i] && lakeId[i] < 0) up[j].push(i);
    }
    for (const u of up) u.sort((a, b) => inp.flow[b] - inp.flow[a] || a - b);
    const used = new Uint8Array(n);
    const QMAIN = 900, QTRIB = 1100;
    type Stem = { cells: number[]; endsIn: number; tributaryOf: number; mouthCell: number };
    const stems: Stem[] = [];
    const trace = (mouth: number): number[] => {
      const path = [mouth];
      used[mouth] = 1;
      let c = mouth;
      for (;;) {
        const ups = up[c].filter((u) => !used[u]);
        if (!ups.length) break;
        const nx = ups[0];
        if (inp.flow[nx] < 0.04 * QMAIN) break;
        used[nx] = 1;
        path.push(nx);
        c = nx;
      }
      return path.reverse(); // source → mouth
    };
    // Mouths: river cells draining into the sea or into a lake.
    const mouths: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!dryLand(i)) continue;
      const j = inp.downstream[i];
      if (inp.flow[i] < QMAIN) continue;
      if (j < 0 || !isLand[j] || lakeId[j] >= 0) mouths.push(i);
    }
    mouths.sort((a, b) => inp.flow[b] - inp.flow[a] || a - b);
    const queue: { cells: number[]; parentStem: number }[] = [];
    for (const m of mouths) {
      if (used[m]) continue;
      const cells = trace(m);
      const j = inp.downstream[m];
      const endsIn = j < 0 ? -1 : !isLand[j] ? waterBodyOf[j] : lakeId[j] >= 0 ? lakeFeature[lakeId[j]] : -1;
      stems.push({ cells, endsIn, tributaryOf: -1, mouthCell: m });
      queue.push({ cells, parentStem: stems.length - 1 });
    }
    // Tributaries: big side branches joining a stem.
    for (let q = 0; q < queue.length; q++) {
      const { cells, parentStem } = queue[q];
      for (const c of cells) {
        for (const u of up[c]) {
          if (used[u] || inp.flow[u] < QTRIB) continue;
          const tcells = trace(u);
          tcells.push(c); // the confluence cell closes the tributary
          stems.push({ cells: tcells, endsIn: -2, tributaryOf: parentStem, mouthCell: c });
          queue.push({ cells: tcells.slice(0, -1), parentStem: stems.length - 1 });
        }
      }
    }
    // Rank and keep the significant ones.
    const stemLen = (s: Stem) => s.cells.length;
    const keep = stems.map((s, k) => k).filter((k) => stemLen(stems[k]) >= 4).sort((a, b) => inp.flow[stems[b].mouthCell] - inp.flow[stems[a].mouthCell] || a - b).slice(0, 40);
    keep.sort((a, b) => a - b);
    const stemFeature = new Map<number, number>();
    for (const k of keep) {
      const s = stems[k];
      // Length along the cells.
      let len = 0;
      for (let t = 0; t + 1 < s.cells.length; t++) len += cellAngle(mesh, s.cells[t], s.cells[t + 1]) * inp.radiusKm;
      len += 0.5 * mesh.meanSpacing * inp.radiusKm;
      const mouth = s.tributaryOf >= 0 ? s.cells[s.cells.length - 2] : s.cells[s.cells.length - 1];
      const src = s.cells[0];
      const bnames: string[] = [];
      for (const c of s.cells) { const nm = BIOME_NAMES[biome[c]]; if (bnames[bnames.length - 1] !== nm) bnames.push(nm); }
      const attrs: Record<string, number | string> = {
        lengthKm: r0(len),
        discharge: r0(inp.flow[mouth]),
        sourceElevation: Math.round(elevation[src] * 1000) / 1000,
        latitudeBand: latitudeBand(mesh.lat[mouth]),
        flowsThrough: bnames.slice(0, 6).join(" > "),
      };
      // Upstream drainage area.
      let basin = 0;
      const st = [mouth];
      const seenB = new Set<number>([mouth]);
      while (st.length) {
        const c = st.pop()!;
        basin += areaKm2[c];
        for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
          const u = mesh.adj[k];
          if (!seenB.has(u) && inp.downstream[u] === c) { seenB.add(u); st.push(u); }
        }
      }
      attrs.basinArea = r0(basin);
      const srcLake = (() => { for (let k = mesh.adjStart[src]; k < mesh.adjStart[src + 1]; k++) { const u = mesh.adj[k]; if (lakeId[u] >= 0 && inp.downstream[u] === src) return lakeFeature[lakeId[u]]; } return -1; })();
      if (srcLake >= 0) attrs.sourceLake = srcLake;
      if (s.tributaryOf < 0) {
        attrs.endsIn = s.endsIn;
        const j = inp.downstream[mouth];
        if (j >= 0 && !isLand[j] && inp.flow[mouth] > 4000 && elevation[j] > -0.25) attrs.mouth = "delta";
        else if (j >= 0 && !isLand[j]) attrs.mouth = "estuary";
        else attrs.mouth = "inland";
      }
      const f = add("river", s.cells, mouth, len, landmassOf[mouth], attrs);
      stemFeature.set(k, f.id);
    }
    for (const k of keep) {
      const s = stems[k];
      if (s.tributaryOf < 0) continue;
      let p = s.tributaryOf;
      while (p >= 0 && !stemFeature.has(p)) p = stems[p].tributaryOf;
      const fid = stemFeature.get(k)!;
      if (p >= 0) {
        features[fid].attrs.tributaryOf = stemFeature.get(p)!;
        features[fid].attrs.endsIn = stemFeature.get(p)!;
      } else {
        features[fid].attrs.endsIn = -1;
      }
    }
    // Lakes: note the river draining them.
    for (const f of features) {
      if (f.kind !== "river") continue;
      const sl = f.attrs.sourceLake;
      if (typeof sl === "number" && features[sl].attrs.outflowRiver === undefined) features[sl].attrs.outflowRiver = f.id;
      const e = f.attrs.endsIn;
      if (typeof e === "number" && e >= 0 && features[e].kind === "lake") {
        const prev = features[e].attrs.inflowRivers;
        features[e].attrs.inflowRivers = prev ? `${prev},${f.id}` : `${f.id}`;
      }
    }
  }

  // ======================================================================= terrain regions
  const elevK = (i: number) => Math.max(0, elevation[i]);
  type RegionKind = "glacier" | "mountains" | "hills" | "desert" | "marsh" | "jungle" | "forest" | "steppe" | "tundra" | "plain";
  const regionKindOf = (i: number): RegionKind | null => {
    if (!dryLand(i)) return null;
    const b = biome[i], e = elevK(i), rl = inp.relief[i];
    if (b === Biome.IceSheet) return "glacier";
    if (e >= 1.5 || (e >= 0.9 && rl >= 0.55) || (b === Biome.Alpine && e > 0.8)) return "mountains";
    if ((e >= 0.45 && rl >= 0.28) || (e >= 0.8 && rl >= 0.18)) return "hills";
    if (b === Biome.HotDesert || b === Biome.ColdDesert) return "desert";
    if (b === Biome.Wetland) return "marsh";
    if (b === Biome.Rainforest) return "jungle";
    if (b === Biome.TemperateForest || b === Biome.TemperateRainforest || b === Biome.Taiga || b === Biome.TropicalDryForest) return "forest";
    if (b === Biome.Steppe) return "steppe";
    if (b === Biome.Tundra || b === Biome.Alpine) return "tundra";
    if ((b === Biome.Grassland || b === Biome.Savanna || b === Biome.Mediterranean) && rl < 0.25) return "plain";
    return null;
  };
  const rkind: (RegionKind | null)[] = new Array(n);
  for (let i = 0; i < n; i++) rkind[i] = regionKindOf(i);
  const minCells: Record<RegionKind, number> = { glacier: 8, mountains: 5, hills: 7, desert: 10, marsh: 5, jungle: 12, forest: 14, steppe: 12, tundra: 14, plain: 14 };
  const maxCells: Record<RegionKind, number> = { glacier: 500, mountains: 50, hills: 70, desert: 360, marsh: 140, jungle: 300, forest: 260, steppe: 300, tundra: 320, plain: 240 };
  const maxCount: Record<RegionKind, number> = { glacier: 6, mountains: 24, hills: 12, desert: 12, marsh: 6, jungle: 10, forest: 18, steppe: 10, tundra: 8, plain: 12 };
  const kinds: RegionKind[] = ["glacier", "mountains", "hills", "desert", "marsh", "jungle", "forest", "steppe", "tundra", "plain"];
  for (const kind of kinds) {
    const cc = components(mesh, (i) => rkind[i] === kind, (a, b) => landmassOf[a] === landmassOf[b]);
    const groups: number[][] = Array.from({ length: cc.count }, () => []);
    for (let i = 0; i < n; i++) if (cc.comp[i] >= 0) groups[cc.comp[i]].push(i);
    const parts: number[][] = [];
    for (const g of groups) {
      if (g.length < minCells[kind]) continue;
      if (g.length <= maxCells[kind]) parts.push(g);
      else parts.push(...splitRegion(mesh, g, Math.ceil(g.length / (maxCells[kind] * 0.75))));
    }
    // Most important first (size, and height for relief), keep the top few.
    const imp = (cells: number[]) => {
      if (kind !== "mountains" && kind !== "hills") return cells.length;
      let pk = 0;
      for (const c of cells) pk = Math.max(pk, elevation[c]);
      return Math.sqrt(cells.length) * (0.5 + pk);
    };
    const impV = new Map<number[], number>();
    for (const p of parts) impV.set(p, imp(p));
    parts.sort((a, b) => impV.get(b)! - impV.get(a)! || a[0] - b[0]);
    let made = 0;
    for (const cells of parts) {
      if (cells.length < minCells[kind] || made >= maxCount[kind]) continue;
      made++;
      const fk: GeoFeatureKind = kind === "glacier" ? "glacier" : kind;
      let peak = cells[0];
      for (const c of cells) if (elevation[c] > elevation[peak]) peak = c;
      const anchor = kind === "mountains" || kind === "hills" || kind === "glacier" ? peak : centroidCell(cells);
      const attrs: Record<string, number | string> = {
        area: r0(areaOf(cells)),
        latitudeBand: latitudeBand(mesh.lat[anchor]),
        meanTemperature: r1(meanOf(cells, temperature)),
        meanPrecipitation: r0(meanOf(cells, precipitation)),
        meanElevation: Math.round(meanOf(cells, elevation) * 1000) / 1000,
      };
      if (kind === "mountains" || kind === "hills") {
        attrs.peakElevation = Math.round(elevation[peak] * 1000) / 1000;
        attrs.lengthKm = r0(extentKm(cells));
        let oro = 0, old = 0, vol = 0, rft = 0, ice = 0;
        for (const c of cells) { oro += inp.orogeny[c]; old += inp.oldOrogen[c]; vol = Math.max(vol, inp.volcanism[c]); rft = Math.max(rft, inp.rift[c]); if (biome[c] === Biome.IceSheet || biome[c] === Biome.Alpine) ice++; }
        oro /= cells.length; old /= cells.length;
        attrs.origin = vol > 0.6 ? "volcanic arc" : rft > 0.3 ? "rift shoulders" : oro > 1.2 ? "young fold belt" : old > 0.3 ? "ancient eroded range" : oro > 0.3 ? "uplifted block" : "plateau escarpment";
        if (ice / cells.length > 0.3) attrs.glaciated = 1;
      }
      if (kind === "desert") {
        const coastal = cells.filter((c) => inp.coastDist[c] === 1);
        let cold = 0;
        for (const c of coastal) for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) { const u = mesh.adj[k]; if (!isLand[u] && inp.currentAnom[u] < -2) cold++; }
        const T = meanOf(cells, temperature);
        attrs.type = cold >= 2 ? "coastal fog desert" : T < 8 ? "cold desert" : meanOf(cells, inp.relief) > 0.35 ? "rocky desert" : "sand sea";
      }
      if (kind === "forest" || kind === "jungle" || kind === "steppe" || kind === "plain" || kind === "tundra") {
        const bc = new Map<number, number>();
        for (const c of cells) bc.set(biome[c], (bc.get(biome[c]) ?? 0) + 1);
        let db = biome[cells[0]], dc = 0;
        for (const [b, c] of [...bc.entries()].sort((a, b) => a[0] - b[0])) if (c > dc) { dc = c; db = b; }
        attrs.type = BIOME_NAMES[db];
      }
      const f = add(fk, cells, anchor, areaOf(cells), landmassOf[anchor], attrs);
      for (const c of cells) regionOf[c] = f.id;
    }
  }

  // ======================================================================= volcanoes
  {
    const cand: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!dryLand(i) || inp.volcanism[i] < 0.55) continue;
      let isMax = true;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
        const j = mesh.adj[k];
        if (elevation[j] > elevation[i] && inp.volcanism[j] >= 0.4) { isMax = false; break; }
      }
      if (isMax) cand.push(i);
    }
    const score = (i: number) => inp.volcanism[i] * (0.5 + elevK(i));
    cand.sort((a, b) => score(b) - score(a) || a - b);
    const chosen: number[] = [];
    const minSepV = 3.5 * mesh.meanSpacing;
    for (const c of cand) {
      if (chosen.length >= 16) break;
      if (chosen.some((o) => cellAngle(mesh, c, o) < minSepV)) continue;
      chosen.push(c);
    }
    const hot = new Set(inp.hotspotCells);
    for (const c of chosen) {
      let nearHot = false;
      for (const h of hot) if (cellAngle(mesh, c, h) < 2.5 * mesh.meanSpacing) nearHot = true;
      add("volcano", [c], c, areaKm2[c], landmassOf[c], {
        elevation: Math.round(elevation[c] * 1000) / 1000,
        activity: inp.volcanism[c] > 0.8 ? "active" : inp.volcanism[c] > 0.65 ? "dormant" : "extinct",
        type: nearHot ? "shield volcano" : inp.rift[c] > 0.2 ? "rift volcano" : "stratovolcano",
        island: features[landmassOf[c]]?.kind === "island" ? 1 : 0,
        range: regionOf[c] >= 0 && features[regionOf[c]].kind === "mountains" ? regionOf[c] : -1,
        latitudeBand: latitudeBand(mesh.lat[c]),
      });
    }
  }

  // ======================================================================= peninsulas
  {
    const K = 2;
    const penCands: { g: number[]; fid: number; len: number; tip: number; score: number }[] = [];
    for (let lmi = 0; lmi < lm.count; lmi++) {
      const fid = lmFeature[lmi];
      const cells = lmCells[lmi];
      if (cells.length < 40) continue;
      // Opening: core = cells ≥ K hops from the coast, dilated back by K hops.
      const inCore = new Uint8Array(n);
      let frontier: number[] = [];
      for (const c of cells) if (inp.coastDist[c] > K) { inCore[c] = 1; frontier.push(c); }
      for (let h = 0; h < K; h++) {
        const nx: number[] = [];
        for (const c of frontier) for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
          const u = mesh.adj[k];
          if (!inCore[u] && landmassOf[u] === fid) { inCore[u] = 1; nx.push(u); }
        }
        frontier = nx;
      }
      const cc = components(mesh, (i) => landmassOf[i] === fid && !inCore[i]);
      const groups: number[][] = Array.from({ length: cc.count }, () => []);
      for (let i = 0; i < n; i++) if (cc.comp[i] >= 0) groups[cc.comp[i]].push(i);
      for (const g of groups) {
        if (g.length < 9 || g.length > 0.25 * cells.length) continue;
        // Must be attached to the core (not a separate sliver), and long rather than a thin coastal strip.
        let attach = 0;
        for (const c of g) for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) if (inCore[mesh.adj[k]]) attach++;
        const len = extentKm(g);
        if (attach === 0 || attach > g.length * 0.7 || len < 4.5 * mesh.meanSpacing * inp.radiusKm) continue;
        const cc0 = centroidCell(cells);
        const tip = g.reduce((b, c) => (cellAngle(mesh, c, cc0) > cellAngle(mesh, b, cc0) ? c : b), g[0]);
        const a = areaOf(g);
        // Prefer long, slender, sizeable protrusions.
        penCands.push({ g, fid, len, tip, score: (len * len / a) * Math.sqrt(a) / (1 + attach / g.length) });
      }
    }
    penCands.sort((x, y) => y.score - x.score || x.g[0] - y.g[0]);
    for (const p of penCands.slice(0, 14)) {
      add("peninsula", p.g, centroidCell(p.g), areaOf(p.g), p.fid, {
        area: r0(areaOf(p.g)),
        lengthKm: r0(p.len),
        tipCell: p.tip,
        latitudeBand: latitudeBand(mesh.lat[p.g[0]]),
        meanElevation: Math.round(meanOf(p.g, elevation) * 1000) / 1000,
      });
    }
  }

  // Islands: parent = the water body they sit in (most common adjacent water cell).
  for (const f of features) {
    if (f.kind !== "island" && f.kind !== "archipelago") continue;
    const cnt = new Map<number, number>();
    for (const c of f.cells) for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
      const u = mesh.adj[k];
      if (!isLand[u] && waterBodyOf[u] >= 0) cnt.set(waterBodyOf[u], (cnt.get(waterBodyOf[u]) ?? 0) + 1);
    }
    let best = -1, bc = 0;
    for (const [w, c] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) if (c > bc) { bc = c; best = w; }
    f.parent = best;
  }
  // Water bodies: which landmasses border them.
  for (const f of features) {
    if (f.kind !== "sea" && f.kind !== "bay" && f.kind !== "ocean") continue;
    const set = new Set<number>();
    for (const c of f.cells) for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) { const u = mesh.adj[k]; if (isLand[u] && landmassOf[u] >= 0) set.add(landmassOf[u]); }
    const arr = [...set].sort((a, b) => features[b].size - features[a].size || a - b);
    f.attrs.borders = arr.slice(0, 8).join(",");
    f.attrs.coastCount = arr.length;
  }
  void isOcean;
  return { features, landmassOf, waterBodyOf, regionOf };
}

/** Split a large region into k compact parts (farthest-point seeds + multi-source BFS). */
function splitRegion(mesh: SphereMesh, cells: number[], k: number): number[][] {
  const inSet = new Set(cells);
  const seeds = [cells[0]];
  // Farthest-point sampling (by graph hops).
  const hop = (srcs: number[]) => {
    const d = new Map<number, number>();
    const q: number[] = [];
    for (const s of srcs) { d.set(s, 0); q.push(s); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (let t = mesh.adjStart[c]; t < mesh.adjStart[c + 1]; t++) {
        const u = mesh.adj[t];
        if (!inSet.has(u) || d.has(u)) continue;
        d.set(u, d.get(c)! + 1);
        q.push(u);
      }
    }
    return d;
  };
  // Start from the cell farthest from cells[0].
  let d = hop(seeds);
  let far = cells[0];
  for (const c of cells) if ((d.get(c) ?? -1) > (d.get(far) ?? -1)) far = c;
  seeds[0] = far;
  while (seeds.length < k) {
    d = hop(seeds);
    let best = cells[0], bd = -1;
    for (const c of cells) { const v = d.get(c) ?? -1; if (v > bd) { bd = v; best = c; } }
    if (bd <= 1) break;
    seeds.push(best);
  }
  // Multi-source BFS assignment.
  const owner = new Map<number, number>();
  const q: number[] = [];
  seeds.forEach((s, i) => { owner.set(s, i); q.push(s); });
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (let t = mesh.adjStart[c]; t < mesh.adjStart[c + 1]; t++) {
      const u = mesh.adj[t];
      if (!inSet.has(u) || owner.has(u)) continue;
      owner.set(u, owner.get(c)!);
      q.push(u);
    }
  }
  const parts: number[][] = seeds.map(() => []);
  for (const c of cells) { const o = owner.get(c); if (o !== undefined) parts[o].push(c); }
  return parts.filter((p) => p.length > 0);
}
