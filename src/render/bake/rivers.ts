/**
 * Rivers as smooth, meandering, tapered polylines.
 *
 * The drainage graph (`downstream`) links cell centres, which zig-zag. We:
 *  1. split the river network into chains (each chain follows its largest
 *     upstream branch, so main stems stay continuous through junctions);
 *  2. smooth each chain with Chaikin corner cutting (endpoints fixed);
 *  3. resample at even arc length and add meanders (noise offsets normal to
 *     the river, tapering to zero at the ends so tributaries still meet);
 *  4. snap each tributary's mouth onto its (already final) trunk;
 *  5. map from cell space into image space through the inverse warp.
 *
 * Widths are proportional to log discharge.
 */
import { Noise3 } from "../../core/noise";
import { BakeContext, unwarp } from "./context";

export interface RiverPath {
  /** Unit vectors in *image* space (after inverse warp), 3 per point. */
  pts: Float64Array;
  /** Half-width per point, in units of the mean cell spacing (radians / spacing). */
  halfWidth: Float32Array;
  /** Discharge at the path's largest own cell (m³/s). */
  rank: number;
}

export interface RiverOptions {
  /** Minimum river order drawn (default 1). */
  minOrder?: number;
  /** Width multiplier (default 1). */
  width?: number;
  /** Meander amplitude multiplier (default 1). */
  meander?: number;
}

const riverCache = new WeakMap<BakeContext, Map<string, RiverPath[]>>();

export function buildRiverPaths(ctx: BakeContext, opts: RiverOptions = {}): RiverPath[] {
  const key = `${opts.minOrder ?? 1}|${opts.width ?? 1}|${opts.meander ?? 1}`;
  let m = riverCache.get(ctx);
  if (!m) riverCache.set(ctx, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const res = buildRiverPathsUncached(ctx, opts);
  m.set(key, res);
  return res;
}

interface RawChain {
  cells: number[];
  rank: number;
  /** Junction cell this chain flows into (-1 if it ends in the sea / a lake / nowhere). */
  joins: number;
}

function buildRiverPathsUncached(ctx: BakeContext, opts: RiverOptions): RiverPath[] {
  const world = ctx.world;
  const mesh = ctx.mesh;
  const n = mesh.n;
  const { downstream, flow, riverOrder, lakeId, isLand } = world;
  const minOrder = opts.minOrder ?? 1;
  const widthMul = opts.width ?? 1;
  const meanderMul = opts.meander ?? 1;
  const spacing = mesh.meanSpacing;

  const isRiver = new Uint8Array(n);
  let minFlow = Infinity;
  for (let i = 0; i < n; i++) {
    if (isLand[i] && lakeId[i] < 0 && riverOrder[i] >= minOrder) {
      isRiver[i] = 1;
      if (flow[i] > 0 && flow[i] < minFlow) minFlow = flow[i];
    }
  }
  if (!isFinite(minFlow)) return [];

  // Largest upstream river branch per cell; whether any river flows in; lake inflow per cell.
  const mainUp = new Int32Array(n).fill(-1);
  const hasUp = new Uint8Array(n);
  const lakeUp = new Int32Array(n).fill(-1);
  for (let u = 0; u < n; u++) {
    const d = downstream[u];
    if (d < 0) continue;
    if (isRiver[u]) {
      hasUp[d] = 1;
      const cur = mainUp[d];
      if (cur < 0 || flow[u] > flow[cur] || (flow[u] === flow[cur] && u < cur)) mainUp[d] = u;
    } else if (lakeId[u] >= 0 && isRiver[d]) {
      lakeUp[d] = u;
    }
  }

  const chains: RawChain[] = [];
  for (let s = 0; s < n; s++) {
    if (!isRiver[s] || hasUp[s]) continue;
    const cells: number[] = [];
    if (lakeUp[s] >= 0) cells.push(lakeUp[s]);
    let cur = s;
    let rank = 0;
    let joins = -1;
    for (let guard = 0; guard < n; guard++) {
      cells.push(cur);
      rank = Math.max(rank, flow[cur]);
      const d = downstream[cur];
      if (d < 0) break;
      if (!isRiver[d]) {
        cells.push(d); // mouth: ocean or lake
        break;
      }
      if (mainUp[d] !== cur) {
        cells.push(d);
        joins = d;
        break;
      }
      cur = d;
    }
    if (cells.length >= 2) chains.push({ cells, rank, joins });
  }
  chains.sort((a, b) => b.rank - a.rank || a.cells[0] - b.cells[0]);

  const noise = new Noise3(ctx.seedRng.fork("meander"));
  const { xyz } = mesh;
  /** Final cell-space points of the chain owning each cell (for tributary snapping). */
  const owner = new Int32Array(n).fill(-1);
  const finals: Float64Array[] = [];
  const paths: RiverPath[] = [];
  const tmp = new Float64Array(3);

  for (let ci = 0; ci < chains.length; ci++) {
    const ch = chains[ci];
    const m = ch.cells.length;
    // Raw points [x,y,z,flow].
    let pts: Float64Array = new Float64Array(4 * m);
    for (let k = 0; k < m; k++) {
      const c = ch.cells[k];
      pts[4 * k] = xyz[3 * c];
      pts[4 * k + 1] = xyz[3 * c + 1];
      pts[4 * k + 2] = xyz[3 * c + 2];
      pts[4 * k + 3] = isRiver[c] ? flow[c] : flow[ch.cells[Math.max(0, k - 1)]];
    }
    // Snap a tributary mouth onto its trunk's final curve.
    if (ch.joins >= 0 && owner[ch.joins] >= 0) {
      const tr = finals[owner[ch.joins]];
      const jx = xyz[3 * ch.joins], jy = xyz[3 * ch.joins + 1], jz = xyz[3 * ch.joins + 2];
      let best = -2, bi = 0;
      for (let k = 0; k < tr.length / 4; k++) {
        const d = tr[4 * k] * jx + tr[4 * k + 1] * jy + tr[4 * k + 2] * jz;
        if (d > best) { best = d; bi = k; }
      }
      pts[4 * (m - 1)] = tr[4 * bi];
      pts[4 * (m - 1) + 1] = tr[4 * bi + 1];
      pts[4 * (m - 1) + 2] = tr[4 * bi + 2];
    }
    pts = chaikin(pts, 2);
    pts = resample(pts, 0.14 * spacing);
    pts = meander(pts, noise, ci, 0.16 * spacing * meanderMul);
    pts = chaikin(pts, 1);
    finals.push(pts);
    for (const c of ch.cells) if (isRiver[c] && owner[c] < 0) owner[c] = ci;

    const cnt = pts.length / 4;
    const out = new Float64Array(3 * cnt);
    const hw = new Float32Array(cnt);
    for (let k = 0; k < cnt; k++) {
      unwarp(ctx.warp, pts[4 * k], pts[4 * k + 1], pts[4 * k + 2], tmp);
      out[3 * k] = tmp[0];
      out[3 * k + 1] = tmp[1];
      out[3 * k + 2] = tmp[2];
      const f = Math.max(1, pts[4 * k + 3] / minFlow);
      hw[k] = widthMul * Math.min(0.3, 0.055 + 0.05 * Math.log(f));
    }
    paths.push({ pts: out, halfWidth: hw, rank: ch.rank });
  }
  return paths;
}

/** Chaikin corner cutting on [x,y,z,w] points, endpoints kept, re-normalised to the sphere. */
function chaikin(p: Float64Array, iterations: number): Float64Array {
  let cur: Float64Array = p;
  for (let it = 0; it < iterations; it++) {
    const m = cur.length / 4;
    if (m < 3) return cur;
    const out = new Float64Array(4 * (2 * (m - 1)));
    let o = 0;
    for (let c = 0; c < 4; c++) out[c] = cur[c];
    o = 4;
    for (let k = 0; k < m - 1; k++) {
      const a = 4 * k, b = 4 * (k + 1);
      if (k > 0) {
        for (let c = 0; c < 4; c++) out[o + c] = 0.75 * cur[a + c] + 0.25 * cur[b + c];
        o += 4;
      }
      if (k < m - 2) {
        for (let c = 0; c < 4; c++) out[o + c] = 0.25 * cur[a + c] + 0.75 * cur[b + c];
        o += 4;
      }
    }
    for (let c = 0; c < 4; c++) out[o + c] = cur[4 * (m - 1) + c];
    o += 4;
    cur = normalizeRows(out.subarray(0, o));
  }
  return cur;
}

function normalizeRows(p: Float64Array): Float64Array {
  const out = new Float64Array(p.length);
  for (let k = 0; k < p.length; k += 4) {
    const l = Math.hypot(p[k], p[k + 1], p[k + 2]) || 1;
    out[k] = p[k] / l;
    out[k + 1] = p[k + 1] / l;
    out[k + 2] = p[k + 2] / l;
    out[k + 3] = p[k + 3];
  }
  return out;
}

/** Resample at (approximately) even arc length `step` (radians). */
function resample(p: Float64Array, step: number): Float64Array {
  const m = p.length / 4;
  if (m < 2) return p;
  const res: number[] = [p[0], p[1], p[2], p[3]];
  let carry = 0;
  for (let k = 0; k < m - 1; k++) {
    const a = 4 * k, b = 4 * (k + 1);
    const seg = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    let t = step - carry;
    while (t < seg) {
      const f = t / seg;
      res.push(
        p[a] + f * (p[b] - p[a]),
        p[a + 1] + f * (p[b + 1] - p[a + 1]),
        p[a + 2] + f * (p[b + 2] - p[a + 2]),
        p[a + 3] + f * (p[b + 3] - p[a + 3]),
      );
      t += step;
    }
    carry = seg - (t - step);
  }
  const L = 4 * (m - 1);
  const lastIdx = res.length - 4;
  const dl = Math.hypot(res[lastIdx] - p[L], res[lastIdx + 1] - p[L + 1], res[lastIdx + 2] - p[L + 2]);
  if (dl < step * 0.35 && res.length > 4) res.length -= 4;
  res.push(p[L], p[L + 1], p[L + 2], p[L + 3]);
  return normalizeRows(Float64Array.from(res));
}

/** Offset points along the local normal by 1D noise of arc length; zero at both ends. */
function meander(p: Float64Array, noise: Noise3, salt: number, amp: number): Float64Array {
  const m = p.length / 4;
  if (m < 4) return p;
  const out = Float64Array.from(p);
  const freq = 0.9; // cycles per resampled step ≈ one bend per few cells
  for (let k = 1; k < m - 1; k++) {
    const a = 4 * (k - 1), b = 4 * (k + 1), c = 4 * k;
    // Tangent and normal (in the tangent plane).
    const tx = p[b] - p[a], ty = p[b + 1] - p[a + 1], tz = p[b + 2] - p[a + 2];
    const px = p[c], py = p[c + 1], pz = p[c + 2];
    let nx = py * tz - pz * ty, ny = pz * tx - px * tz, nz = px * ty - py * tx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const s = k * freq * 0.18;
    const nv = noise.noise(s, salt * 7.31 + 0.5, 3.3) * 0.75 + noise.noise(s * 2.7, salt * 3.17, 9.1) * 0.25;
    const ends = Math.min(1, k / 6, (m - 1 - k) / 6);
    const off = amp * nv * ends * ends * (3 - 2 * ends);
    out[c] = px + nx * off;
    out[c + 1] = py + ny * off;
    out[c + 2] = pz + nz * off;
  }
  return normalizeRows(out);
}

/**
 * Rasterise river paths into an 8-bit coverage buffer (max-blended) of an
 * equirectangular image. Widths scale with the image resolution so a river
 * keeps its physical width at any texture size.
 */
export function rasterizeRivers(paths: RiverPath[], width: number, height: number, spacing: number, cov: Uint8Array): void {
  const pxPerRad = height / Math.PI;
  const minHalfPx = 0.42;
  for (const path of paths) {
    const pts = path.pts;
    const m = pts.length / 3;
    let px0 = 0, py0 = 0, hw0 = 0;
    for (let k = 0; k < m; k++) {
      const x = pts[3 * k], y = pts[3 * k + 1], z = pts[3 * k + 2];
      let fx = ((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * width;
      const fy = ((Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, z)))) / Math.PI) * height;
      const hw = Math.max(minHalfPx, path.halfWidth[k] * spacing * pxPerRad);
      if (k > 0) {
        if (fx - px0 > width / 2) fx -= width;
        else if (px0 - fx > width / 2) fx += width;
        drawSegment(cov, width, height, px0, py0, hw0, fx, fy, hw);
        if (fx < 0) fx += width;
        else if (fx >= width) fx -= width;
      }
      px0 = fx; py0 = fy; hw0 = hw;
    }
  }
}

function drawSegment(
  cov: Uint8Array, W: number, H: number,
  x0: number, y0: number, r0: number,
  x1: number, y1: number, r1: number,
): void {
  const ym = 0.5 * (y0 + y1);
  const lat = Math.PI / 2 - (ym / H) * Math.PI;
  const c = Math.max(0.05, Math.cos(lat));
  const rmax = Math.max(r0, r1) + 1;
  const xmin = Math.floor(Math.min(x0, x1) - rmax / c - 1);
  const xmax = Math.ceil(Math.max(x0, x1) + rmax / c + 1);
  const ymin = Math.max(0, Math.floor(Math.min(y0, y1) - rmax - 1));
  const ymax = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + rmax + 1));
  // Work in an isotropic local frame: x scaled by cos(lat).
  const ax = x0 * c, bx = x1 * c;
  const dx = bx - ax, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let py = ymin; py <= ymax; py++) {
    const cy = py + 0.5;
    for (let pxi = xmin; pxi <= xmax; pxi++) {
      const cx = (pxi + 0.5) * c;
      let t = len2 > 0 ? ((cx - ax) * dx + (cy - y0) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx - cx, qy = y0 + t * dy - cy;
      const d = Math.sqrt(qx * qx + qy * qy);
      const r = r0 + t * (r1 - r0);
      let a = Math.min(r + 0.5 - d, 2 * r);
      if (a <= 0) continue;
      if (a > 1) a = 1;
      let wx = pxi % W;
      if (wx < 0) wx += W;
      const idx = py * W + wx;
      const v = Math.round(a * 255);
      if (v > cov[idx]) cov[idx] = v;
    }
  }
}

/** Compact, transferable river geometry (image space, i.e. already inverse-warped). */
export interface RiverGeometry {
  /** Unit vectors, 3 floats per point, all paths concatenated. */
  pts: Float32Array;
  /** Half-width per point, radians. */
  hw: Float32Array;
  /** Point offset of each path; length = paths + 1. */
  start: Uint32Array;
}

export function packRivers(paths: RiverPath[], spacing: number): RiverGeometry {
  let total = 0;
  for (const p of paths) total += p.halfWidth.length;
  const pts = new Float32Array(3 * total);
  const hw = new Float32Array(total);
  const start = new Uint32Array(paths.length + 1);
  let o = 0;
  paths.forEach((p, i) => {
    start[i] = o;
    pts.set(p.pts, 3 * o);
    for (let k = 0; k < p.halfWidth.length; k++) hw[o + k] = p.halfWidth[k] * spacing;
    o += p.halfWidth.length;
  });
  start[paths.length] = o;
  return { pts, hw, start };
}
