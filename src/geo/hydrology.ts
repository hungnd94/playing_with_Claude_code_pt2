/**
 * Hydrology: drainage network, lakes, river discharge and river order.
 *
 * 1. Runoff = P − AET, with actual evapotranspiration from the Turc–Pike
 *    (Budyko-type) curve AET = P / √(1 + (P/PET)²). Converted to m³/s using
 *    true cell areas.
 * 2. A priority flood from the sea (Barnes et al.) gives every land cell a
 *    receiver on the depression-filled surface plus a topological order.
 *    Shallow pits (< `minLakeDepth`) are treated as sediment-filled flats.
 * 3. Deeper depressions are lake candidates. Walking the order from the
 *    headwaters down, each depression receives the discharge of its whole
 *    catchment (including the outflow of lakes further upstream). If inflow
 *    exceeds open-water evaporation over the full basin, the lake fills to
 *    its spill point and overflows (fresh lake with an outlet). Otherwise it
 *    is endorheic: the lake shrinks to the area where evaporation balances
 *    inflow, grows from the deepest point, and turns saline (Caspian, Aral,
 *    Great Salt Lake, Lake Eyre). Tiny endorheic basins become salt pans.
 * 4. Downstream pointers are rewired so that each endorheic basin drains into
 *    its lake; inside lakes, pointers form a BFS tree towards the outlet (or
 *    the deepest cell). The result is a forest rooted at ocean cells and
 *    endorheic lakes.
 * 5. Discharge is accumulated along the forest (Kahn order). Lake cells carry
 *    the lake's outflow (fresh) or inflow (endorheic).
 * 6. Strahler order is computed on the network of cells whose discharge
 *    exceeds a drawing threshold.
 */
import type { SphereMesh } from "../core/sphere";
import { MinHeap } from "../core/heap";
import type { Lake } from "../world/types";

export interface HydrologyResult {
  downstream: Int32Array;
  flow: Float32Array;
  riverOrder: Uint8Array;
  lakeId: Int32Array;
  lakes: Lake[];
  /** Local runoff, mm/yr. */
  runoff: Float32Array;
  /** Actual evapotranspiration, mm/yr. */
  aet: Float32Array;
  /** Discharge threshold (m³/s) for riverOrder ≥ 1. */
  riverThreshold: number;
}

const SEC_PER_YEAR = 31557600;

export function buildHydrology(
  mesh: SphereMesh,
  elevation: Float32Array,
  isOcean: Uint8Array,
  precipitation: Float32Array,
  pet: Float32Array,
  areaKm2: Float32Array,
  opts: { minLakeDepth?: number; riverThreshold?: number; maxLakes?: number; glacial?: Float32Array; rift?: Float32Array } = {},
): HydrologyResult {
  const n = mesh.n;
  const { adjStart, adj } = mesh;
  const minLakeDepth = opts.minLakeDepth ?? 0.03;

  // ------------------------------------------------------------ runoff
  const runoff = new Float32Array(n);
  const aet = new Float32Array(n);
  const localQ = new Float64Array(n); // m³/s generated in the cell
  const lakeEvap = new Float64Array(n); // m³/s net evaporation if the cell were open water
  const toQ = (mm: number, a: number) => (mm / 1000) * a * 1e6 / SEC_PER_YEAR;
  for (let i = 0; i < n; i++) {
    if (isOcean[i]) continue;
    const P = precipitation[i], E = Math.max(1, pet[i]);
    const a = P / Math.sqrt(1 + (P / E) * (P / E));
    aet[i] = a;
    runoff[i] = Math.max(0, P - a);
    localQ[i] = toQ(runoff[i], areaKm2[i]);
    lakeEvap[i] = toQ(1.1 * E - P, areaKm2[i]); // may be negative (net gain) in wet climates
  }

  // ------------------------------------------------------------ priority flood
  const filled = new Float32Array(n);
  const recv = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  let count = 0;
  {
    const done = new Uint8Array(n);
    const heap = new MinHeap(n);
    for (let i = 0; i < n; i++) {
      if (!isOcean[i]) continue;
      done[i] = 1;
      filled[i] = elevation[i];
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        if (!isOcean[adj[k]]) { heap.push(0, i); break; }
      }
    }
    while (heap.size > 0) {
      const c = heap.pop();
      const lc = heap.lastKey;
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const u = adj[k];
        if (done[u]) continue;
        done[u] = 1;
        const lu = Math.max(elevation[u], lc + 1e-6);
        filled[u] = lu;
        recv[u] = c;
        order[count++] = u;
        heap.push(lu, u);
      }
    }
    // Land unreachable from any ocean (ocean-less world): make the lowest cell of each such region a sink.
    for (let i = 0; i < n; i++) if (!done[i]) { filled[i] = elevation[i]; order[count++] = i; }
  }

  // ------------------------------------------------------------ depressions
  const comp = new Int32Array(n).fill(-1);
  const depCells: number[][] = [];
  {
    const stack: number[] = [];
    for (let q = 0; q < count; q++) {
      const s = order[q];
      if (comp[s] !== -1 || filled[s] - elevation[s] <= 1e-4) continue;
      const id = depCells.length;
      const cells: number[] = [];
      comp[s] = id;
      stack.push(s);
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const u = adj[k];
          if (comp[u] === -1 && !isOcean[u] && filled[u] - elevation[u] > 1e-4) { comp[u] = id; stack.push(u); }
        }
      }
      depCells.push(cells);
    }
  }
  // Classify: most closed depressions are filled with sediment or breached by
  // their outlet over geological time and become flats; only significant ones
  // keep a lake: deep tectonic basins (rifts, interior basins), and the many
  // shallow scoured hollows of formerly glaciated high latitudes.
  const D = depCells.length;
  const isCandidate = new Uint8Array(D);
  const depMin = new Int32Array(D);
  const score = new Float64Array(D);
  const maxLakes = opts.maxLakes ?? 40;
  for (let d = 0; d < D; d++) {
    const cells = depCells[d];
    let mn = cells[0], spill = -Infinity, gl = 0, rf = 0;
    for (const c of cells) {
      if (elevation[c] < elevation[mn]) mn = c;
      spill = Math.max(spill, filled[c]);
      if (opts.glacial) gl = Math.max(gl, opts.glacial[c]);
      if (opts.rift) rf = Math.max(rf, opts.rift[c]);
    }
    depMin[d] = mn;
    const depth = spill - elevation[mn];
    // Broad shallow basins silt up into plains; big lakes need deep basins.
    const need = minLakeDepth * (1 + 2.5 * (1 - Math.max(gl, rf))) * (1 + cells.length / 12);
    if (depth >= need) score[d] = depth * depth * Math.sqrt(cells.length) * (1 + 2 * Math.max(gl, rf));
  }
  const ranked = Array.from({ length: D }, (_, d) => d).filter((d) => score[d] > 0).sort((a, b) => score[b] - score[a] || a - b);
  for (let r = 0; r < ranked.length && r < maxLakes; r++) isCandidate[ranked[r]] = 1;
  for (let d = 0; d < D; d++) {
    if (isCandidate[d]) continue;
    for (const c of depCells[d]) elevation[c] = filled[c] - 1e-5; // sediment-filled flat
  }

  // Exit cell of each depression: the member whose receiver is outside it (first popped).
  const exitCell = new Int32Array(D).fill(-1);
  for (let q = 0; q < count; q++) {
    const c = order[q];
    const d = comp[c];
    if (d >= 0 && exitCell[d] === -1) exitCell[d] = c;
  }

  // ------------------------------------------------------------ lake decisions (headwaters → sea)
  const acc = new Float64Array(n);
  const depInflow = new Float64Array(D);
  const lakeKind = new Int8Array(D); // 0 none, 1 fresh, 2 endorheic
  const lakeSet: number[][] = new Array(D);
  for (let q = count - 1; q >= 0; q--) {
    const c = order[q];
    const d = comp[c];
    const inLake = d >= 0 && isCandidate[d];
    if (!inLake) acc[c] += localQ[c];
    if (inLake && c === exitCell[d]) {
      // All inflow of this basin has arrived (accumulated along the flat into the exit cell).
      const inflow = acc[c];
      depInflow[d] = inflow;
      let fullLoss = 0;
      for (const x of depCells[d]) fullLoss += lakeEvap[x];
      if (inflow >= fullLoss) {
        lakeKind[d] = 1;
        lakeSet[d] = depCells[d];
        acc[c] = inflow - Math.max(0, fullLoss);
      } else {
        lakeKind[d] = 2;
        lakeSet[d] = growLake(mesh, depCells[d], comp, d, depMin[d], elevation, lakeEvap, inflow);
        acc[c] = 0;
      }
    }
    const r = recv[c];
    if (r >= 0 && !isOcean[r]) acc[r] += acc[c];
  }

  // ------------------------------------------------------------ build lakes and downstream pointers
  const downstream = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (!isOcean[i]) downstream[i] = recv[i];
  const lakeId = new Int32Array(n).fill(-1);
  const lakes: Lake[] = [];
  const lakeOfDep = new Int32Array(D).fill(-1);
  for (let d = 0; d < D; d++) {
    if (!lakeKind[d]) continue;
    const cells = lakeSet[d];
    const id = lakes.length;
    lakeOfDep[d] = id;
    for (const c of cells) lakeId[c] = id;
    let surface = -Infinity;
    if (lakeKind[d] === 1) for (const c of cells) surface = Math.max(surface, filled[c]);
    else for (const c of cells) surface = Math.max(surface, elevation[c]);
    const salty = lakeKind[d] === 2;
    const outlet = salty ? -1 : exitCell[d];
    lakes.push({ id, cells: Int32Array.from(cells), surface, salty, outlet });
  }
  // Inside each lake: BFS tree towards the outlet (fresh) or the deepest cell (endorheic).
  for (const lake of lakes) {
    const root = lake.outlet >= 0 ? lake.outlet : lowestCell(lake.cells, elevation);
    if (lake.outlet < 0) downstream[root] = -1;
    const seen = new Set<number>([root]);
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const u = adj[k];
        if (lakeId[u] !== lake.id || seen.has(u)) continue;
        seen.add(u);
        downstream[u] = c;
        queue.push(u);
      }
    }
  }
  // Endorheic basins: re-route the dry part of the basin into the lake by a local flood from the lake.
  for (let d = 0; d < D; d++) {
    if (lakeKind[d] !== 2) continue;
    const id = lakeOfDep[d];
    const heap = new MinHeap(64);
    const done = new Set<number>();
    for (const c of lakes[id].cells) { done.add(c); heap.push(elevation[c], c); }
    while (heap.size > 0) {
      const c = heap.pop();
      const lc = heap.lastKey;
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const u = adj[k];
        if (comp[u] !== d || done.has(u)) continue;
        done.add(u);
        downstream[u] = c;
        heap.push(Math.max(lc, elevation[u]), u);
      }
    }
  }

  // ------------------------------------------------------------ final discharge accumulation (Kahn order)
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const j = downstream[i];
    if (j >= 0 && !isOcean[j]) indeg[j]++;
  }
  const flow = new Float64Array(n);
  const lakeIn = new Float64Array(lakes.length);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (!isOcean[i] && indeg[i] === 0) queue[qt++] = i;
  for (let i = 0; i < n; i++) if (!isOcean[i] && lakeId[i] < 0) flow[i] += localQ[i];
  // Lake cells: collect inflow; the outlet/root resolves the lake balance once all cells are done.
  const lakePending = new Int32Array(lakes.length);
  for (const lake of lakes) lakePending[lake.id] = lake.cells.length;
  while (qh < qt) {
    const c = queue[qh++];
    const L = lakeId[c];
    if (L >= 0) {
      lakeIn[L] += flow[c];
      flow[c] = 0;
      lakePending[L]--;
      const lake = lakes[L];
      const isRoot = lake.outlet >= 0 ? c === lake.outlet : downstream[c] === -1;
      if (isRoot) {
        // All lake cells are upstream of the root in the BFS tree, so every inflow has arrived.
        let loss = 0;
        for (const x of lake.cells) loss += lakeEvap[x];
        const inflow = lakeIn[L];
        const out = lake.salty ? 0 : Math.max(0, inflow - Math.max(0, loss));
        for (const x of lake.cells) flow[x] = lake.salty ? inflow : out;
        if (lake.salty) continue;
        const j = downstream[c];
        if (j >= 0 && !isOcean[j]) {
          flow[j] += out;
          if (--indeg[j] === 0) queue[qt++] = j;
        }
        continue;
      }
      const j = downstream[c];
      if (j >= 0 && !isOcean[j]) {
        // Pass along inside the lake as accumulated inflow.
        lakeIn[L] += 0;
        if (--indeg[j] === 0) queue[qt++] = j;
      }
      continue;
    }
    const j = downstream[c];
    if (j >= 0 && !isOcean[j]) {
      if (lakeId[j] >= 0) lakeIn[lakeId[j]] += flow[c];
      else flow[j] += flow[c];
      if (--indeg[j] === 0) queue[qt++] = j;
    }
  }

  // ------------------------------------------------------------ river order (Strahler on drawable rivers)
  const flowF = new Float32Array(n);
  for (let i = 0; i < n; i++) flowF[i] = flow[i];
  const threshold = opts.riverThreshold ?? 350;
  const riverOrder = new Uint8Array(n);
  {
    // Upstream cell count, so single wet cells do not count as rivers.
    const ups = new Int32Array(n).fill(1);
    {
      const ind0 = new Int32Array(n);
      for (let i = 0; i < n; i++) { const j = downstream[i]; if (j >= 0) ind0[j]++; }
      let h = 0, t = 0;
      for (let i = 0; i < n; i++) if (ind0[i] === 0) queue[t++] = i;
      while (h < t) {
        const c = queue[h++];
        const j = downstream[c];
        if (j >= 0) { ups[j] += ups[c]; if (--ind0[j] === 0) queue[t++] = j; }
      }
    }
    const ind = new Int32Array(n);
    const isRiver = (i: number) => !isOcean[i] && lakeId[i] < 0 && flowF[i] >= threshold && ups[i] >= 4;
    for (let i = 0; i < n; i++) {
      if (!isRiver(i)) continue;
      const j = downstream[i];
      if (j >= 0 && isRiver(j)) ind[j]++;
    }
    const maxChild = new Uint8Array(n);
    const maxCount = new Uint8Array(n);
    let h = 0, t = 0;
    for (let i = 0; i < n; i++) if (isRiver(i) && ind[i] === 0) queue[t++] = i;
    while (h < t) {
      const c = queue[h++];
      const o = maxChild[c] === 0 ? 1 : maxCount[c] >= 2 ? maxChild[c] + 1 : maxChild[c];
      riverOrder[c] = Math.min(255, o);
      const j = downstream[c];
      if (j >= 0 && isRiver(j)) {
        if (o > maxChild[j]) { maxChild[j] = o; maxCount[j] = 1; }
        else if (o === maxChild[j]) maxCount[j]++;
        if (--ind[j] === 0) queue[t++] = j;
      }
    }
  }

  return { downstream, flow: flowF, riverOrder, lakeId, lakes, runoff, aet, riverThreshold: threshold };
}

function lowestCell(cells: ArrayLike<number>, elevation: Float32Array): number {
  let best = cells[0];
  for (let k = 1; k < cells.length; k++) if (elevation[cells[k]] < elevation[best]) best = cells[k];
  return best;
}

/** Grow an endorheic lake from the deepest point until evaporation balances inflow. */
function growLake(
  mesh: SphereMesh,
  basin: number[],
  comp: Int32Array,
  d: number,
  start: number,
  elevation: Float32Array,
  lakeEvap: Float64Array,
  inflow: number,
): number[] {
  const out: number[] = [];
  const heap = new MinHeap(32);
  const seen = new Set<number>([start]);
  heap.push(elevation[start], start);
  let loss = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    out.push(c);
    loss += Math.max(lakeEvap[c], 1e-6);
    if (loss >= inflow) break;
    for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
      const u = mesh.adj[k];
      if (comp[u] !== d || seen.has(u)) continue;
      seen.add(u);
      heap.push(elevation[u], u);
    }
  }
  void basin;
  return out;
}
