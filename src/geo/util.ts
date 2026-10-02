/**
 * Small graph / field helpers shared by the geo pipeline.
 *
 * Everything here works on the CSR adjacency of a `SphereMesh` and on flat
 * typed arrays, so it is cheap enough to call many times per generation.
 */
import type { SphereMesh } from "../core/sphere";
import { MinHeap } from "../core/heap";

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Angular distance (radians) between cells i and j. */
export function cellAngle(mesh: SphereMesh, i: number, j: number): number {
  const p = mesh.xyz;
  const d = p[3 * i] * p[3 * j] + p[3 * i + 1] * p[3 * j + 1] + p[3 * i + 2] * p[3 * j + 2];
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
}

/**
 * Per-half-edge great-circle length (km), aligned with `mesh.adj`.
 * edgeLen[k] = distance between cell i and adj[k] for k in [adjStart[i], adjStart[i+1]).
 */
export function edgeLengthsKm(mesh: SphereMesh, radiusKm: number): Float32Array {
  const out = new Float32Array(mesh.adj.length);
  for (let i = 0; i < mesh.n; i++) {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      out[k] = cellAngle(mesh, i, mesh.adj[k]) * radiusKm;
    }
  }
  return out;
}

/** Cell areas in km². */
export function cellAreasKm2(mesh: SphereMesh, radiusKm: number): Float32Array {
  const out = new Float32Array(mesh.n);
  const r2 = radiusKm * radiusKm;
  for (let i = 0; i < mesh.n; i++) out[i] = mesh.area[i] * r2;
  return out;
}

/**
 * Multi-source Dijkstra over the mesh. Returns distance (km) to the nearest source
 * and the index of that source cell. `allow(i, j)` may restrict traversal (e.g. stay
 * within a plate). Distances beyond `maxDist` are left at `Infinity` / -1.
 */
export function distanceField(
  mesh: SphereMesh,
  edgeLen: Float32Array,
  sources: ArrayLike<number>,
  maxDist = Infinity,
  allow?: (from: number, to: number) => boolean,
  initial?: ArrayLike<number>,
): { dist: Float32Array; src: Int32Array } {
  const n = mesh.n;
  const dist = new Float32Array(n).fill(Infinity);
  const src = new Int32Array(n).fill(-1);
  const heap = new MinHeap(Math.max(1024, sources.length * 2));
  for (let s = 0; s < sources.length; s++) {
    const c = sources[s];
    const d0 = initial ? initial[s] : 0;
    if (d0 < dist[c]) {
      dist[c] = d0;
      src[c] = c;
      heap.push(d0, c);
    }
  }
  const { adjStart, adj } = mesh;
  while (heap.size > 0) {
    const c = heap.pop();
    const dc = heap.lastKey;
    if (dc > dist[c]) continue;
    for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
      const u = adj[k];
      const nd = dc + edgeLen[k];
      if (nd < dist[u] && nd <= maxDist) {
        if (allow && !allow(c, u)) continue;
        dist[u] = nd;
        src[u] = src[c];
        heap.push(nd, u);
      }
    }
  }
  return { dist, src };
}

/** Breadth-first hop distance from the given sources (unreachable = -1). */
export function hopDistance(mesh: SphereMesh, isSource: (i: number) => boolean, maxHops = 32767, allow?: (i: number) => boolean): Int16Array {
  const n = mesh.n;
  const d = new Int16Array(n).fill(-1);
  let frontier = new Int32Array(n);
  let next = new Int32Array(n);
  let fl = 0;
  for (let i = 0; i < n; i++) if (isSource(i)) { d[i] = 0; frontier[fl++] = i; }
  let hop = 0;
  while (fl > 0 && hop < maxHops) {
    hop++;
    let nl = 0;
    for (let f = 0; f < fl; f++) {
      const c = frontier[f];
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (d[u] !== -1) continue;
        if (allow && !allow(u)) continue;
        d[u] = hop;
        next[nl++] = u;
      }
    }
    const t = frontier; frontier = next; next = t; fl = nl;
  }
  return d;
}

/** Laplacian smoothing of a field (in place, `passes` times, blending factor `alpha`). Optional mask limits which cells change. */
export function smoothField(mesh: SphereMesh, f: Float32Array, passes: number, alpha = 0.5, mask?: (i: number) => boolean): void {
  const n = mesh.n;
  const tmp = new Float32Array(n);
  const { adjStart, adj } = mesh;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      if (mask && !mask(i)) { tmp[i] = f[i]; continue; }
      let s = 0;
      const a = adjStart[i], b = adjStart[i + 1];
      for (let k = a; k < b; k++) s += f[adj[k]];
      tmp[i] = f[i] + alpha * (s / (b - a) - f[i]);
    }
    f.set(tmp);
  }
}

/**
 * Least-squares gradient of a scalar field at each cell, as a tangent vector in
 * "field units per km" (flat xyz, 3 per cell).
 */
export function gradientField(mesh: SphereMesh, f: ArrayLike<number>, radiusKm: number, out?: Float32Array): Float32Array {
  const n = mesh.n;
  const g = out ?? new Float32Array(3 * n);
  const { xyz, adjStart, adj } = mesh;
  for (let i = 0; i < n; i++) {
    const px = xyz[3 * i], py = xyz[3 * i + 1], pz = xyz[3 * i + 2];
    // Local frame.
    let ex = -py, ey = px, ez = 0;
    let el = Math.hypot(ex, ey);
    if (el < 1e-9) { ex = 1; ey = 0; el = 1; }
    ex /= el; ey /= el;
    const nx = py * ez - pz * ey, ny = pz * ex - px * ez, nz = px * ey - py * ex;
    let sxx = 0, sxy = 0, syy = 0, sxf = 0, syf = 0;
    const fi = f[i];
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      const dx = (xyz[3 * j] - px) * radiusKm, dy = (xyz[3 * j + 1] - py) * radiusKm, dz = (xyz[3 * j + 2] - pz) * radiusKm;
      const u = dx * ex + dy * ey + dz * ez;
      const v = dx * nx + dy * ny + dz * nz;
      const df = f[j] - fi;
      sxx += u * u; sxy += u * v; syy += v * v; sxf += u * df; syf += v * df;
    }
    const det = sxx * syy - sxy * sxy;
    let gu = 0, gv = 0;
    if (Math.abs(det) > 1e-12) {
      gu = (syy * sxf - sxy * syf) / det;
      gv = (sxx * syf - sxy * sxf) / det;
    }
    g[3 * i] = gu * ex + gv * nx;
    g[3 * i + 1] = gu * ey + gv * ny;
    g[3 * i + 2] = gu * ez + gv * nz;
  }
  return g;
}

/** East / north unit vectors at cell i written to out[0..5]. */
export function localFrame(mesh: SphereMesh, i: number, out: Float64Array): void {
  const px = mesh.xyz[3 * i], py = mesh.xyz[3 * i + 1], pz = mesh.xyz[3 * i + 2];
  let ex = -py, ey = px;
  let el = Math.hypot(ex, ey);
  if (el < 1e-9) { ex = 1; ey = 0; el = 1; }
  ex /= el; ey /= el;
  out[0] = ex; out[1] = ey; out[2] = 0;
  out[3] = -pz * ey; out[4] = pz * ex; out[5] = px * ey - py * ex;
}

/** Connected components of cells satisfying `pred`. Returns component id per cell (-1 if not in pred) and the count. */
export function components(mesh: SphereMesh, pred: (i: number) => boolean, link?: (i: number, j: number) => boolean): { comp: Int32Array; count: number } {
  const n = mesh.n;
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1 || !pred(s)) continue;
    let sp = 0;
    stack[sp++] = s;
    comp[s] = count;
    while (sp > 0) {
      const c = stack[--sp];
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (comp[u] !== -1 || !pred(u)) continue;
        if (link && !link(c, u)) continue;
        comp[u] = count;
        stack[sp++] = u;
      }
    }
    count++;
  }
  return { comp, count };
}

/** Area-weighted quantile: smallest value v such that the area of cells with f ≤ v is ≥ q·total. */
export function areaQuantile(f: ArrayLike<number>, area: ArrayLike<number>, q: number): number {
  const n = f.length;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const arr = Array.from(idx).sort((a, b) => f[a] - f[b] || a - b);
  let total = 0;
  for (let i = 0; i < n; i++) total += area[i];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += area[arr[k]];
    if (acc >= q * total) return f[arr[k]];
  }
  return f[arr[n - 1]];
}

/** Latitude in degrees of cell i. */
export const latDeg = (mesh: SphereMesh, i: number): number => (mesh.lat[i] * 180) / Math.PI;

/** Area-weighted quantile by bisection (no sorting; fast for repeated use). */
export function quantileBisect(f: ArrayLike<number>, area: ArrayLike<number>, q: number): number {
  const n = f.length;
  let lo = Infinity, hi = -Infinity, total = 0;
  for (let i = 0; i < n; i++) {
    if (f[i] < lo) lo = f[i];
    if (f[i] > hi) hi = f[i];
    total += area[i];
  }
  const target = q * total;
  for (let it = 0; it < 40; it++) {
    const m = 0.5 * (lo + hi);
    let a = 0;
    for (let i = 0; i < n; i++) if (f[i] <= m) a += area[i];
    if (a < target) lo = m; else hi = m;
  }
  return hi;
}
