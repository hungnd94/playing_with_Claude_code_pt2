/**
 * Contours on node grids: marching squares with consistent orientation
 * (values above the level lie on the LEFT of the walking direction in screen
 * space, y down), chaining into polylines, smoothing, and the distance
 * transforms used for coastal ripple lines. Pure.
 */

export type Pt = [number, number];

export interface Polyline {
  pts: Pt[];
  closed: boolean;
}

/**
 * Marching squares. `values` is gx×gy, row-major. Nodes outside the grid count
 * as `outside` (default: below the level) so that every contour is closed.
 * Returns polylines in node coordinates.
 */
export function marchingSquares(values: ArrayLike<number>, gx: number, gy: number, level: number, outside = -1e6): Polyline[] {
  // Iterate over cells of the padded grid: (i, j) in [-1, gx-1] × [-1, gy-1].
  const W = gx + 1; // padded cell columns
  const val = (i: number, j: number): number => (i < 0 || j < 0 || i >= gx || j >= gy ? outside : values[j * gx + i]);
  // Edge ids in padded index space: H edge from (i,j) to (i+1,j); V edge from (i,j) to (i,j+1). Shift by +1.
  const hId = (i: number, j: number) => 2 * ((j + 1) * (W + 1) + (i + 1));
  const vId = (i: number, j: number) => 2 * ((j + 1) * (W + 1) + (i + 1)) + 1;
  const pointOf = new Map<number, Pt>();
  const next = new Map<number, number>();
  const interp = (a: number, b: number) => {
    const d = b - a;
    return d === 0 ? 0.5 : Math.min(1, Math.max(0, (level - a) / d));
  };
  const edgePoint = (id: number, i: number, j: number, horizontal: boolean, a: number, b: number): number => {
    if (!pointOf.has(id)) {
      const t = interp(a, b);
      pointOf.set(id, horizontal ? [i + t, j] : [i, j + t]);
    }
    return id;
  };
  for (let j = -1; j < gy; j++) {
    for (let i = -1; i < gx; i++) {
      const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
      const A = a > level ? 1 : 0, B = b > level ? 1 : 0, C = c > level ? 1 : 0, D = d > level ? 1 : 0;
      const idx = (A << 3) | (B << 2) | (C << 1) | D;
      if (idx === 0 || idx === 15) continue;
      // edges: top (a-b), right (b-c), bottom (d-c), left (a-d)
      const top = () => edgePoint(hId(i, j), i, j, true, a, b);
      const right = () => edgePoint(vId(i + 1, j), i + 1, j, false, b, c);
      const bottom = () => edgePoint(hId(i, j + 1), i, j + 1, true, d, c);
      const left = () => edgePoint(vId(i, j), i, j, false, a, d);
      // Orientation: walking from p to q, high values on the LEFT (screen coords, y down → left = (dy, -dx)).
      // Derived per case so high corners are on the left.
      const seg = (p: number, q: number) => next.set(p, q);
      switch (idx) {
        case 1: seg(bottom(), left()); break; // D high
        case 2: seg(right(), bottom()); break; // C high
        case 3: seg(right(), left()); break; // C,D high
        case 4: seg(top(), right()); break; // B high
        case 5: {
          // B, D high (saddle)
          const ctr = (a + b + c + d) / 4;
          if (ctr > level) { seg(top(), left()); seg(bottom(), right()); }
          else { seg(top(), right()); seg(bottom(), left()); }
          break;
        }
        case 6: seg(top(), bottom()); break; // B,C high
        case 7: seg(top(), left()); break; // B,C,D high
        case 8: seg(left(), top()); break; // A high
        case 9: seg(bottom(), top()); break; // A,D high
        case 10: {
          // A, C high (saddle)
          const ctr = (a + b + c + d) / 4;
          if (ctr > level) { seg(left(), bottom()); seg(right(), top()); }
          else { seg(left(), top()); seg(right(), bottom()); }
          break;
        }
        case 11: seg(right(), top()); break; // A,C,D high
        case 12: seg(left(), right()); break; // A,B high
        case 13: seg(bottom(), right()); break; // A,B,D high
        case 14: seg(left(), bottom()); break; // A,B,C high
      }
    }
  }
  // Chain.
  const out: Polyline[] = [];
  const visited = new Set<number>();
  // Open chains first: starts are edges that are nobody's successor.
  const hasPred = new Set<number>();
  for (const q of next.values()) hasPred.add(q);
  const walk = (start: number): Polyline => {
    const pts: Pt[] = [];
    let cur: number | undefined = start;
    let closed = false;
    while (cur !== undefined) {
      if (visited.has(cur)) {
        closed = cur === start;
        break;
      }
      visited.add(cur);
      pts.push(pointOf.get(cur)!);
      cur = next.get(cur);
    }
    return { pts, closed };
  };
  for (const k of next.keys()) if (!hasPred.has(k) && !visited.has(k)) out.push(walk(k));
  for (const k of next.keys()) if (!visited.has(k)) out.push(walk(k));
  return out;
}

/** Map node-space polylines to screen space. */
export function toScreen(lines: Polyline[], x0: number, y0: number, step: number): Polyline[] {
  return lines.map((l) => ({ closed: l.closed, pts: l.pts.map(([i, j]) => [x0 + i * step, y0 + j * step] as Pt) }));
}

/** Chaikin corner cutting. */
export function chaikin(pl: Polyline, iterations = 2): Polyline {
  let pts = pl.pts;
  for (let it = 0; it < iterations; it++) {
    const n = pts.length;
    if (n < 3) break;
    const out: Pt[] = [];
    if (!pl.closed) out.push(pts[0]);
    const m = pl.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!pl.closed) out.push(pts[n - 1]);
    pts = out;
  }
  return { pts, closed: pl.closed };
}

/** Remove points closer than `minDist` to the previous kept point. */
export function decimate(pl: Polyline, minDist: number): Polyline {
  const pts = pl.pts;
  if (pts.length < 3) return pl;
  const out: Pt[] = [pts[0]];
  const m2 = minDist * minDist;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx * dx + dy * dy >= m2) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return { pts: out, closed: pl.closed };
}

/** Signed area (screen coords, y down: positive = clockwise on screen). */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polylineLength(pts: Pt[], closed = false): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}

export function bbox(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------
// Distance transforms & blur
// ---------------------------------------------------------------------------

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    let s: number;
    for (;;) {
      const r = v[k];
      if (f[r] === Infinity) { s = -Infinity; }
      else s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
      if (s <= z[k] && k > 0) k--;
      else break;
    }
    if (f[v[k]] === Infinity) {
      v[k] = q;
      z[k] = -Infinity;
      z[k + 1] = Infinity;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = f[r] === Infinity ? Infinity : (q - r) * (q - r) + f[r];
  }
}

/** Euclidean distance (in nodes) from every node to the nearest node where `seed` is true. */
export function distanceTransform(gx: number, gy: number, seed: (k: number) => boolean): Float32Array {
  const INF = Infinity;
  const g = new Float64Array(gx * gy);
  for (let k = 0; k < gx * gy; k++) g[k] = seed(k) ? 0 : INF;
  const m = Math.max(gx, gy);
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m);
  // columns
  for (let i = 0; i < gx; i++) {
    for (let j = 0; j < gy; j++) f[j] = g[j * gx + i];
    dt1(f, gy, d, v, z);
    for (let j = 0; j < gy; j++) g[j * gx + i] = d[j];
  }
  // rows
  const out = new Float32Array(gx * gy);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) f[i] = g[j * gx + i];
    dt1(f, gx, d, v, z);
    for (let i = 0; i < gx; i++) out[j * gx + i] = Math.sqrt(d[i]);
  }
  return out;
}

/** Separable box blur (repeated `passes` times), in place on a copy. */
export function boxBlur(src: Float32Array, gx: number, gy: number, radius: number, passes = 2): Float32Array {
  const a = Float32Array.from(src);
  if (radius < 1) return a;
  const r = Math.round(radius);
  const b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let j = 0; j < gy; j++) {
      const o = j * gx;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[o + Math.min(gx - 1, Math.max(0, i))];
      for (let i = 0; i < gx; i++) {
        b[o + i] = acc / (2 * r + 1);
        acc += a[o + Math.min(gx - 1, i + r + 1)] - a[o + Math.max(0, i - r)];
      }
    }
    // vertical
    for (let i = 0; i < gx; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += b[Math.min(gy - 1, Math.max(0, j)) * gx + i];
      for (let j = 0; j < gy; j++) {
        a[j * gx + i] = acc / (2 * r + 1);
        acc += b[Math.min(gy - 1, j + r + 1) * gx + i] - b[Math.max(0, j - r) * gx + i];
      }
    }
  }
  return a;
}

/** Point-in-polygon (even-odd) over several loops. */
export function pointInLoops(x: number, y: number, loops: Pt[][]): boolean {
  let inside = false;
  for (const pts of loops) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
