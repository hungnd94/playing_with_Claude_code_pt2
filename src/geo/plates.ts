/**
 * Tectonic plates.
 *
 * Plates grow from scattered seeds by a competitive, randomised Dijkstra flood:
 * every plate has its own growth rate (log-normal, so a few plates become huge
 * and several stay small, as on Earth), every cell has a noise-driven
 * "resistance", and every edge a random jitter. The result is a partition with
 * irregular, rough boundaries and strongly varied plate sizes; fast plates can
 * wrap around slow ones, producing small enclosed plates like the Caribbean or
 * Philippine Sea plates.
 *
 * Each plate rotates about its own Euler pole. Boundaries are classified per
 * boundary cell by the relative velocity of the two plates projected on the
 * boundary normal: convergent, divergent or transform, with an intensity.
 */
import type { SphereMesh } from "../core/sphere";
import { Rng, hash01 } from "../core/rng";
import { Noise3 } from "../core/noise";
import { MinHeap } from "../core/heap";
import { BoundaryKind, type Plate } from "../world/types";
import { cellAngle, distanceField } from "./util";

export interface Tectonics {
  plates: Plate[];
  /** Plate id per cell. */
  plate: Uint8Array;
  /** Plate area as a fraction of the sphere. */
  plateArea: Float64Array;
  /** Per plate: buoyancy rank; the denser plate subducts at a convergent boundary. */
  density: Float32Array;
  /** 1 for cells with a neighbour on another plate. */
  isBoundary: Uint8Array;
  /** BoundaryKind for boundary cells (0 elsewhere). */
  kind: Uint8Array;
  /** Normal convergence rate at boundary cells (+ convergent, − divergent), roughly −1.5..1.5. */
  conv: Float32Array;
  /** Tangential (shear) rate at boundary cells. */
  shear: Float32Array;
  /** Plate across the boundary (boundary cells), else -1. */
  other: Int16Array;
  /** Distance (km) from each cell to the nearest boundary cell of its own plate, and that cell. */
  bdist: Float32Array;
  bsrc: Int32Array;
  /** Per plate pair (a*P+b): maturity of a divergent boundary 0..1 (0 = young rift, 1 = wide ocean). */
  pairMaturity: Float32Array;
  /** Plate surface velocity per cell (tangent, flat xyz), radians per time unit. */
  velocity: Float32Array;
}

export function buildPlates(mesh: SphereMesh, numPlates: number, landFraction: number, radiusKm: number, edgeLen: Float32Array, rng: Rng): Tectonics {
  const n = mesh.n;
  const P = Math.max(2, Math.min(250, Math.round(numPlates)));
  const { xyz, adjStart, adj } = mesh;

  // --- Seeds, spread out but not on a grid.
  const seeds: number[] = [];
  let minSep = 0.75 * Math.sqrt((4 * Math.PI) / P);
  const seedRng = rng.fork("seeds");
  while (seeds.length < P) {
    let placed = false;
    for (let attempt = 0; attempt < 300 && !placed; attempt++) {
      const c = seedRng.int(0, n - 1);
      let ok = true;
      for (const s of seeds) if (cellAngle(mesh, c, s) < minSep) { ok = false; break; }
      if (ok) { seeds.push(c); placed = true; }
    }
    if (!placed) minSep *= 0.85;
  }

  // --- Growth rates: log-normal spread; one plate is given a head start to play the Pacific.
  const growRng = rng.fork("growth");
  const rate = new Float64Array(P);
  for (let p = 0; p < P; p++) rate[p] = Math.exp(growRng.normal(0, 0.42));
  rate[growRng.int(0, P - 1)] *= 1.45;
  // Anisotropy: most plates grow faster along a small circle about a random axis,
  // giving elongated, curved plates (and so elongated continents and long margins).
  const aniAxis: number[][] = [];
  const aniStr = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    aniAxis.push(growRng.unitVector());
    aniStr[p] = growRng.next() < 0.75 ? growRng.range(0.8, 3.2) : 0;
  }

  // --- Resistance noise (large scale) makes plate outlines lobed and irregular.
  const noise = new Noise3(rng.fork("plate-noise"));
  const resist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    resist[i] = Math.exp(0.9 * noise.fbm(x * 1.7, y * 1.7, z * 1.7, 4));
  }
  const salt = growRng.int(1, 1 << 30);

  // --- Competitive Dijkstra growth.
  const plate = new Uint8Array(n).fill(255);
  const best = new Float64Array(n).fill(Infinity);
  const bestPlate = new Int16Array(n).fill(-1);
  const heap = new MinHeap(n * 2);
  for (let p = 0; p < P; p++) {
    best[seeds[p]] = 0;
    bestPlate[seeds[p]] = p;
    heap.push(0, seeds[p]);
  }
  while (heap.size > 0) {
    const c = heap.pop();
    const t = heap.lastKey;
    if (plate[c] !== 255 || t > best[c]) continue;
    const p = bestPlate[c];
    plate[c] = p;
    for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
      const u = adj[k];
      if (plate[u] !== 255) continue;
      const a = c < u ? c : u, b = c < u ? u : c;
      const jitter = 0.7 + 0.6 * hash01(a * 65599 + b, salt);
      let aniso = 1;
      if (aniStr[p] > 0) {
        const ax = aniAxis[p];
        const cx = xyz[3 * c], cy = xyz[3 * c + 1], cz = xyz[3 * c + 2];
        // Preferred direction at c: tangent of the small circle about the plate's axis.
        let tx = ax[1] * cz - ax[2] * cy, ty = ax[2] * cx - ax[0] * cz, tz = ax[0] * cy - ax[1] * cx;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        let ex = xyz[3 * u] - cx, ey = xyz[3 * u + 1] - cy, ez = xyz[3 * u + 2] - cz;
        const el = Math.hypot(ex, ey, ez) || 1;
        const al = (ex * tx + ey * ty + ez * tz) / el;
        aniso = 1 / (1 + aniStr[p] * al * al);
      }
      const cost = edgeLen[k] * 0.5 * (resist[c] + resist[u]) * jitter * aniso / rate[p];
      const nt = t + cost;
      if (nt < best[u]) {
        best[u] = nt;
        bestPlate[u] = p;
        heap.push(nt, u);
      }
    }
  }

  // --- Majority filter: remove single-cell spurs and notches along boundaries.
  const votes = new Int32Array(P);
  for (let pass = 0; pass < 2; pass++) {
    const next = plate.slice();
    for (let i = 0; i < n; i++) {
      let bestP = plate[i], bestV = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) votes[plate[adj[k]]]++;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const q = plate[adj[k]];
        if (votes[q] > bestV) { bestV = votes[q]; bestP = q; }
      }
      const deg = adjStart[i + 1] - adjStart[i];
      if (bestP !== plate[i] && bestV * 2 > deg && i !== seeds[plate[i]]) next[i] = bestP;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) votes[plate[adj[k]]] = 0;
    }
    plate.set(next);
  }

  // --- Areas.
  const plateArea = new Float64Array(P);
  for (let i = 0; i < n; i++) plateArea[plate[i]] += mesh.area[i] / (4 * Math.PI);

  // --- Continental selection: enough plates that continental crust clearly exceeds the land target.
  const typeRng = rng.fork("types");
  const order = typeRng.shuffle(Array.from({ length: P }, (_, i) => i));
  let largest = 0;
  for (let p = 1; p < P; p++) if (plateArea[p] > plateArea[largest]) largest = p;
  const target = Math.min(0.85, landFraction * 1.4 + 0.02);
  const maxContPlate = Math.max(0.17, target * 0.45);
  const continental = new Uint8Array(P);
  // Shared boundary length between plates, so continents prefer not to be glued together.
  const shared = new Float64Array(P * P);
  const perim = new Float64Array(P);
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (plate[j] !== plate[i]) { shared[plate[i] * P + plate[j]] += edgeLen[k]; perim[plate[i]] += edgeLen[k]; }
    }
  }
  let contArea = 0;
  const rejected = new Uint8Array(P);
  if (P > 4) rejected[largest] = 1;
  for (let p = 0; p < P; p++) if (plateArea[p] > maxContPlate) rejected[p] = 1;
  for (let guard = 0; guard < P * 2 && contArea < target * 0.92; guard++) {
    const w = new Float64Array(P);
    let any = false;
    for (let p = 0; p < P; p++) {
      if (continental[p] || rejected[p]) continue;
      let sh = 0;
      for (let q = 0; q < P; q++) if (continental[q]) sh += shared[p * P + q];
      w[p] = Math.exp(-3 * sh / Math.max(1e-9, perim[p])) * (0.5 + plateArea[p] * 10);
      any = true;
    }
    if (!any) break;
    const p = typeRng.weightedIndex(w);
    if (contArea + plateArea[p] > target * 1.18 && contArea >= target * 0.55) { rejected[p] = 1; continue; }
    continental[p] = 1;
    contArea += plateArea[p];
  }
  void order;
  if (contArea < target * 0.7) {
    // Fall back: add the smallest remaining plates until close to target.
    const rest = Array.from({ length: P }, (_, i) => i).filter((p) => !continental[p]).sort((a, b) => plateArea[a] - plateArea[b]);
    for (const p of rest) {
      if (contArea >= target * 0.9) break;
      continental[p] = 1;
      contArea += plateArea[p];
    }
  }

  const plates: Plate[] = [];
  const density = new Float32Array(P);
  const motionRng = rng.fork("motion");
  for (let p = 0; p < P; p++) {
    const oceanic = !continental[p];
    const axis = motionRng.unitVector();
    const speed = oceanic ? motionRng.range(0.45, 1.0) : motionRng.range(0.2, 0.6);
    density[p] = (oceanic ? 1 : 0) + motionRng.next() * 0.8;
    plates.push({ id: p, oceanic, axis, speed, seedCell: seeds[p] });
  }

  // --- Velocities.
  const velocity = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const pl = plates[plate[i]];
    const [ax, ay, az] = pl.axis;
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    velocity[3 * i] = pl.speed * (ay * z - az * y);
    velocity[3 * i + 1] = pl.speed * (az * x - ax * z);
    velocity[3 * i + 2] = pl.speed * (ax * y - ay * x);
  }

  // --- Boundary classification.
  const isBoundary = new Uint8Array(n);
  const other = new Int16Array(n).fill(-1);
  const conv = new Float32Array(n);
  const shear = new Float32Array(n);
  const counts = new Int32Array(P);
  for (let i = 0; i < n; i++) {
    const pi = plate[i];
    let any = false;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const pj = plate[adj[k]];
      if (pj !== pi) { counts[pj]++; any = true; }
    }
    if (!any) continue;
    isBoundary[i] = 1;
    let bestP = -1, bestC = 0;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const pj = plate[adj[k]];
      if (pj !== pi && counts[pj] > bestC) { bestC = counts[pj]; bestP = pj; }
    }
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) counts[plate[adj[k]]] = 0;
    other[i] = bestP;
    // Boundary normal: mean tangent direction towards the other plate's cells.
    const px = xyz[3 * i], py = xyz[3 * i + 1], pz = xyz[3 * i + 2];
    let nx = 0, ny = 0, nz = 0;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (plate[j] !== bestP) continue;
      nx += xyz[3 * j] - px; ny += xyz[3 * j + 1] - py; nz += xyz[3 * j + 2] - pz;
    }
    const dd = nx * px + ny * py + nz * pz;
    nx -= dd * px; ny -= dd * py; nz -= dd * pz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const po = plates[bestP];
    const vox = po.speed * (po.axis[1] * pz - po.axis[2] * py);
    const voy = po.speed * (po.axis[2] * px - po.axis[0] * pz);
    const voz = po.speed * (po.axis[0] * py - po.axis[1] * px);
    const rx = vox - velocity[3 * i], ry = voy - velocity[3 * i + 1], rz = voz - velocity[3 * i + 2];
    const sep = rx * nx + ry * ny + rz * nz;
    conv[i] = -sep;
    shear[i] = Math.hypot(rx - sep * nx, ry - sep * ny, rz - sep * nz);
  }
  // Smooth rates along each boundary so that jagged cell-level outlines do not flip classifications.
  const tmpC = new Float32Array(n), tmpS = new Float32Array(n);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      if (!isBoundary[i]) continue;
      let sc = conv[i], ss = shear[i], w = 1;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (!isBoundary[j]) continue;
        // Same boundary: either the same pair seen from the same side, or the opposite side.
        if ((plate[j] === plate[i] && other[j] === other[i]) || (plate[j] === other[i] && other[j] === plate[i])) {
          sc += conv[j]; ss += shear[j]; w++;
        }
      }
      tmpC[i] = sc / w; tmpS[i] = ss / w;
    }
    for (let i = 0; i < n; i++) if (isBoundary[i]) { conv[i] = tmpC[i]; shear[i] = tmpS[i]; }
  }
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!isBoundary[i]) continue;
    const c = conv[i], s = shear[i];
    if (Math.abs(c) >= 0.4 * s && Math.abs(c) > 0.05) kind[i] = c > 0 ? BoundaryKind.Convergent : BoundaryKind.Divergent;
    else kind[i] = BoundaryKind.Transform;
  }

  // Divergent maturity per plate pair: young rifts (East Africa) to wide oceans (Atlantic).
  const pairMaturity = new Float32Array(P * P);
  const matRng = rng.fork("maturity");
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const m = matRng.next();
      const v = m < 0.22 ? m * 0.9 : 0.35 + 0.65 * Math.pow(matRng.next(), 0.7);
      pairMaturity[a * P + b] = v;
      pairMaturity[b * P + a] = v;
    }
  }

  // Distance to nearest boundary within own plate.
  const bcells: number[] = [];
  for (let i = 0; i < n; i++) if (isBoundary[i]) bcells.push(i);
  const { dist: bdist, src: bsrc } = distanceField(mesh, edgeLen, bcells, 4000, (a, b) => plate[a] === plate[b]);
  void radiusKm;

  return { plates, plate, plateArea, density, isBoundary, kind, conv, shear, other, bdist, bsrc, pairMaturity, velocity };
}
