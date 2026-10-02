/**
 * Spherical Voronoi / Delaunay mesh.
 *
 * The planet is discretised into `n` roughly equal-area cells (Voronoi regions
 * around jittered Fibonacci-sphere sites). The Delaunay triangulation is built
 * by stereographic projection + Delaunator, then closed by fanning the convex
 * hull to the projection pole.
 *
 * Conventions:
 *  - Unit sphere. +z is the north pole. lat = asin(z), lon = atan2(y, x).
 *  - All triangles are oriented counter-clockwise when viewed from outside.
 *  - Neighbours (`adj`) and Voronoi corners (`cellTris`) of each cell are listed
 *    in counter-clockwise order (viewed from outside), and corner k lies between
 *    neighbour k and neighbour k+1.
 */
import Delaunator from "delaunator";
import { Rng } from "./rng";

export interface SphereMesh {
  /** Number of cells. */
  n: number;
  /** Cell site positions, flat [x0,y0,z0, x1,y1,z1, ...] unit vectors. */
  xyz: Float32Array;
  /** Latitude of each site, radians. */
  lat: Float32Array;
  /** Longitude of each site, radians in (-π, π]. */
  lon: Float32Array;
  /** CSR offsets into `adj` / `cellTris` (length n+1). Each cell has the same number of neighbours as corners. */
  adjStart: Int32Array;
  /** Neighbouring cell indices, CCW around each cell. */
  adj: Int32Array;
  /** Delaunay triangles: flat [a0,b0,c0, a1,b1,c1, ...] cell indices, CCW from outside. */
  triangles: Int32Array;
  /** Number of triangles. */
  numTris: number;
  /** Opposite half-edge for each half-edge (3 per triangle; half-edge 3t+k goes from triangles[3t+k] to triangles[3t+(k+1)%3]). */
  halfedges: Int32Array;
  /** Triangle circumcentres = Voronoi vertices, flat xyz unit vectors (3 per triangle). */
  triCenter: Float32Array;
  /** Voronoi polygon corners (triangle indices), CCW, aligned with `adjStart`. */
  cellTris: Int32Array;
  /** Cell areas in steradians (sum ≈ 4π). */
  area: Float32Array;
  /** Mean angular distance between neighbouring sites, radians. */
  meanSpacing: number;
}

/** Build a jittered Fibonacci-sphere mesh with `n` cells. Deterministic for a given rng. */
export function buildSphereMesh(n: number, rng: Rng, jitter = 0.45): SphereMesh {
  const xyz = fibonacciPoints(n, rng, jitter);
  return buildMeshFromPoints(xyz);
}

export function fibonacciPoints(n: number, rng: Rng, jitter: number): Float32Array {
  const xyz = new Float32Array(3 * n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const spacing = Math.sqrt((4 * Math.PI) / n); // ≈ angular spacing
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(1 - z * z);
    const th = i * golden;
    let x = r * Math.cos(th);
    let y = r * Math.sin(th);
    let zz = z;
    if (jitter > 0) {
      // Offset in the tangent plane.
      const ex = -Math.sin(th), ey = Math.cos(th), ez = 0;
      const nx = -zz * Math.cos(th), ny = -zz * Math.sin(th), nz = r;
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * jitter * spacing;
      x += d * (Math.cos(a) * ex + Math.sin(a) * nx);
      y += d * (Math.cos(a) * ey + Math.sin(a) * ny);
      zz += d * (Math.cos(a) * ez + Math.sin(a) * nz);
      const l = Math.hypot(x, y, zz);
      x /= l; y /= l; zz /= l;
    }
    xyz[3 * i] = x;
    xyz[3 * i + 1] = y;
    xyz[3 * i + 2] = zz;
  }
  return xyz;
}

export function buildMeshFromPoints(xyz: Float32Array): SphereMesh {
  const n = xyz.length / 3;
  // Rotate so that the last point sits at the north pole for projection.
  const pole = n - 1;
  const px = xyz[3 * pole], py = xyz[3 * pole + 1], pz = xyz[3 * pole + 2];
  const rot = rotationToNorth(px, py, pz);
  const proj = new Float64Array(2 * (n - 1));
  for (let i = 0; i < n - 1; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const rx = rot[0] * x + rot[1] * y + rot[2] * z;
    const ry = rot[3] * x + rot[4] * y + rot[5] * z;
    const rz = rot[6] * x + rot[7] * y + rot[8] * z;
    const d = 1 - rz;
    proj[2 * i] = rx / d;
    proj[2 * i + 1] = ry / d;
  }
  const del = new Delaunator(proj);
  const hull = del.hull;
  const baseTris = del.triangles.length / 3;
  const numTris = baseTris + hull.length;
  const triangles = new Int32Array(3 * numTris);
  triangles.set(del.triangles);
  for (let h = 0; h < hull.length; h++) {
    const a = hull[h];
    const b = hull[(h + 1) % hull.length];
    const t = baseTris + h;
    triangles[3 * t] = a;
    triangles[3 * t + 1] = b;
    triangles[3 * t + 2] = pole;
  }
  // Fix orientation: CCW viewed from outside ⇔ ((b-a)×(c-a))·a > 0.
  for (let t = 0; t < numTris; t++) {
    const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2];
    const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2];
    const bx = xyz[3 * b] - ax, by = xyz[3 * b + 1] - ay, bz = xyz[3 * b + 2] - az;
    const cx = xyz[3 * c] - ax, cy = xyz[3 * c + 1] - ay, cz = xyz[3 * c + 2] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    if (nx * ax + ny * ay + nz * az < 0) {
      triangles[3 * t + 1] = c;
      triangles[3 * t + 2] = b;
    }
  }
  // Half-edges.
  const halfedges = new Int32Array(3 * numTris).fill(-1);
  const edgeMap = new Map<number, number>();
  for (let e = 0; e < 3 * numTris; e++) {
    const a = triangles[e];
    const b = triangles[e % 3 === 2 ? e - 2 : e + 1];
    const key = a * n + b;
    const revKey = b * n + a;
    const o = edgeMap.get(revKey);
    if (o !== undefined) {
      halfedges[e] = o;
      halfedges[o] = e;
      edgeMap.delete(revKey);
    } else {
      edgeMap.set(key, e);
    }
  }
  if (edgeMap.size !== 0) throw new Error(`sphere mesh not closed: ${edgeMap.size} unmatched half-edges`);

  // Circumcentres.
  const triCenter = new Float32Array(3 * numTris);
  for (let t = 0; t < numTris; t++) {
    const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2];
    const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2];
    const bx = xyz[3 * b] - ax, by = xyz[3 * b + 1] - ay, bz = xyz[3 * b + 2] - az;
    const cx = xyz[3 * c] - ax, cy = xyz[3 * c + 1] - ay, cz = xyz[3 * c + 2] - az;
    let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    triCenter[3 * t] = nx;
    triCenter[3 * t + 1] = ny;
    triCenter[3 * t + 2] = nz;
  }

  // One outgoing half-edge per vertex.
  const outEdge = new Int32Array(n).fill(-1);
  for (let e = 0; e < 3 * numTris; e++) {
    const v = triangles[e];
    if (outEdge[v] === -1) outEdge[v] = e;
  }
  // Count degrees by walking around each vertex.
  const adjStart = new Int32Array(n + 1);
  const deg = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const start = outEdge[v];
    if (start < 0) throw new Error(`cell ${v} has no triangles`);
    let e = start;
    let d = 0;
    do {
      d++;
      const prev = e % 3 === 0 ? e + 2 : e - 1;
      e = halfedges[prev];
      if (d > 64) throw new Error(`degenerate fan around cell ${v}`);
    } while (e !== start);
    deg[v] = d;
  }
  for (let v = 0; v < n; v++) adjStart[v + 1] = adjStart[v] + deg[v];
  const adj = new Int32Array(adjStart[n]);
  const cellTris = new Int32Array(adjStart[n]);
  for (let v = 0; v < n; v++) {
    const start = outEdge[v];
    let e = start;
    let k = adjStart[v];
    do {
      const next = e % 3 === 2 ? e - 2 : e + 1;
      adj[k] = triangles[next]; // end of outgoing edge = neighbour
      cellTris[k] = Math.floor(e / 3); // triangle to the left of e, between this neighbour and the next
      k++;
      const prev = e % 3 === 0 ? e + 2 : e - 1;
      e = halfedges[prev];
    } while (e !== start);
  }

  // Areas: fan triangles (site, corner k, corner k+1), spherical excess via L'Huilier-free formula.
  const area = new Float32Array(n);
  let total = 0;
  for (let v = 0; v < n; v++) {
    const sx = xyz[3 * v], sy = xyz[3 * v + 1], sz = xyz[3 * v + 2];
    let A = 0;
    const s = adjStart[v], e = adjStart[v + 1];
    for (let k = s; k < e; k++) {
      const t1 = cellTris[k];
      const t2 = cellTris[k + 1 < e ? k + 1 : s];
      A += sphericalTriangleArea(
        sx, sy, sz,
        triCenter[3 * t1], triCenter[3 * t1 + 1], triCenter[3 * t1 + 2],
        triCenter[3 * t2], triCenter[3 * t2 + 1], triCenter[3 * t2 + 2],
      );
    }
    area[v] = A;
    total += A;
  }

  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = Math.asin(Math.max(-1, Math.min(1, xyz[3 * i + 2])));
    lon[i] = Math.atan2(xyz[3 * i + 1], xyz[3 * i]);
  }

  let spacingSum = 0;
  for (let v = 0; v < n; v++) {
    for (let k = adjStart[v]; k < adjStart[v + 1]; k++) {
      const u = adj[k];
      const d = xyz[3 * v] * xyz[3 * u] + xyz[3 * v + 1] * xyz[3 * u + 1] + xyz[3 * v + 2] * xyz[3 * u + 2];
      spacingSum += Math.acos(Math.max(-1, Math.min(1, d)));
    }
  }
  void total;
  return {
    n, xyz, lat, lon, adjStart, adj, triangles, numTris, halfedges, triCenter, cellTris, area,
    meanSpacing: spacingSum / adjStart[n],
  };
}

/** Oosterom–Strackee solid angle of a spherical triangle with unit-vector vertices. */
export function sphericalTriangleArea(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const triple = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  const ab = ax * bx + ay * by + az * bz;
  const bc = bx * cx + by * cy + bz * cz;
  const ca = cx * ax + cy * ay + cz * az;
  return Math.abs(2 * Math.atan2(triple, 1 + ab + bc + ca));
}

/** Row-major 3x3 rotation mapping unit vector (x,y,z) to (0,0,1). */
function rotationToNorth(x: number, y: number, z: number): number[] {
  // Axis = v × north, angle = acos(v·north)
  const ax = y, ay = -x; // (x,y,z) × (0,0,1) = (y, -x, 0)
  const s = Math.hypot(ax, ay);
  const c = z;
  if (s < 1e-12) {
    return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  }
  const kx = ax / s, ky = ay / s, kz = 0;
  const C = 1 - c;
  return [
    c + kx * kx * C, kx * ky * C - kz * s, kx * kz * C + ky * s,
    ky * kx * C + kz * s, c + ky * ky * C, ky * kz * C - kx * s,
    kz * kx * C - ky * s, kz * ky * C + kx * s, c + kz * kz * C,
  ];
}

/** Iterate the neighbours of cell i. */
export function neighbors(mesh: SphereMesh, i: number): Int32Array {
  return mesh.adj.subarray(mesh.adjStart[i], mesh.adjStart[i + 1]);
}

/**
 * Spatial lookup: nearest cell to an arbitrary unit vector.
 * Uses a coarse lat/lon bucket grid for the starting guess, then greedy walks
 * on the Delaunay graph (always converges to the true nearest site).
 */
export class CellLocator {
  private grid: Int32Array;
  private gw: number;
  private gh: number;

  constructor(private mesh: SphereMesh, gw = 0, gh = 0) {
    const n = mesh.n;
    this.gh = gh || Math.max(8, Math.round(Math.sqrt(n / 2)));
    this.gw = gw || this.gh * 2;
    this.grid = new Int32Array(this.gw * this.gh);
    let hint = 0;
    for (let gy = 0; gy < this.gh; gy++) {
      const lat = Math.PI / 2 - ((gy + 0.5) / this.gh) * Math.PI;
      for (let gx = 0; gx < this.gw; gx++) {
        const lon = -Math.PI + ((gx + 0.5) / this.gw) * 2 * Math.PI;
        const c = Math.cos(lat);
        hint = this.walk(c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat), hint);
        this.grid[gy * this.gw + gx] = hint;
      }
    }
  }

  /** Nearest cell to unit vector (x,y,z). Optionally supply a starting hint. */
  find(x: number, y: number, z: number, hint = -1): number {
    if (hint < 0) {
      const lat = Math.asin(Math.max(-1, Math.min(1, z)));
      const lon = Math.atan2(y, x);
      let gy = Math.floor(((Math.PI / 2 - lat) / Math.PI) * this.gh);
      let gx = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * this.gw);
      if (gy >= this.gh) gy = this.gh - 1;
      if (gx >= this.gw) gx = this.gw - 1;
      hint = this.grid[gy * this.gw + gx];
    }
    return this.walk(x, y, z, hint);
  }

  private walk(x: number, y: number, z: number, start: number): number {
    const { xyz, adj, adjStart } = this.mesh;
    let cur = start;
    let best = xyz[3 * cur] * x + xyz[3 * cur + 1] * y + xyz[3 * cur + 2] * z;
    for (;;) {
      let next = -1;
      for (let k = adjStart[cur]; k < adjStart[cur + 1]; k++) {
        const u = adj[k];
        const d = xyz[3 * u] * x + xyz[3 * u + 1] * y + xyz[3 * u + 2] * z;
        if (d > best) {
          best = d;
          next = u;
        }
      }
      if (next < 0) return cur;
      cur = next;
    }
  }

  /**
   * Find the Delaunay triangle containing unit vector p and its barycentric weights.
   * Returns triangle index; writes weights for (a,b,c) into `out`.
   */
  locateTriangle(x: number, y: number, z: number, out: Float64Array, hintCell = -1): number {
    const mesh = this.mesh;
    const { xyz, triangles, halfedges } = mesh;
    const cell = this.find(x, y, z, hintCell);
    let t = mesh.cellTris[mesh.adjStart[cell]];
    for (let iter = 0; iter < 1000; iter++) {
      let moved = false;
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * t + k];
        const b = triangles[3 * t + ((k + 1) % 3)];
        // Edge a→b; p is inside if (a×b)·p ≥ 0
        const ax = xyz[3 * a], ay = xyz[3 * a + 1], az = xyz[3 * a + 2];
        const bx = xyz[3 * b], by = xyz[3 * b + 1], bz = xyz[3 * b + 2];
        const cxp = (ay * bz - az * by) * x + (az * bx - ax * bz) * y + (ax * by - ay * bx) * z;
        if (cxp < -1e-12) {
          t = Math.floor(halfedges[3 * t + k] / 3);
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    // Barycentric via sub-triangle volumes.
    const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2];
    const wa = triple(x, y, z, xyz, b, c);
    const wb = triple(x, y, z, xyz, c, a);
    const wc = triple(x, y, z, xyz, a, b);
    const s = wa + wb + wc || 1;
    out[0] = wa / s;
    out[1] = wb / s;
    out[2] = wc / s;
    return t;
  }
}

function triple(x: number, y: number, z: number, xyz: Float32Array, i: number, j: number): number {
  const ix = xyz[3 * i], iy = xyz[3 * i + 1], iz = xyz[3 * i + 2];
  const jx = xyz[3 * j], jy = xyz[3 * j + 1], jz = xyz[3 * j + 2];
  return Math.max(0, x * (iy * jz - iz * jy) + y * (iz * jx - ix * jz) + z * (ix * jy - iy * jx));
}
