/**
 * Coarse occupancy raster for symbol placement: rivers, coasts, settlements
 * and labels mark cells; glyph placement asks whether a box is free.
 */
import type { Pt } from "./contour";

export class Occupancy {
  readonly cols: number;
  readonly rows: number;
  readonly grid: Uint8Array;

  constructor(readonly width: number, readonly height: number, readonly cell: number) {
    this.cols = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(height / cell) + 1;
    this.grid = new Uint8Array(this.cols * this.rows);
  }

  private idx(x: number, y: number): number {
    const i = Math.floor(x / this.cell), j = Math.floor(y / this.cell);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  markPoint(x: number, y: number, v = 1): void {
    const k = this.idx(x, y);
    if (k >= 0 && this.grid[k] < v) this.grid[k] = v;
  }

  markBox(x0: number, y0: number, x1: number, y1: number, v = 1): void {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(this.cols - 1, Math.floor(x1 / c));
    const j0 = Math.max(0, Math.floor(y0 / c)), j1 = Math.min(this.rows - 1, Math.floor(y1 / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * this.cols + i;
      if (this.grid[k] < v) this.grid[k] = v;
    }
  }

  /** Mark a polyline with a half-width (px). */
  markLine(pts: Pt[], halfWidth: number, v = 1, closed = false): void {
    const step = this.cell * 0.5;
    const n = pts.length;
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const s = Math.max(1, Math.ceil(L / step));
      for (let q = 0; q <= s; q++) {
        const t = q / s;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        if (halfWidth <= this.cell * 0.5) this.markPoint(x, y, v);
        else this.markBox(x - halfWidth, y - halfWidth, x + halfWidth, y + halfWidth, v);
      }
    }
  }

  /** Max value in a box. */
  maxIn(x0: number, y0: number, x1: number, y1: number): number {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(this.cols - 1, Math.floor(x1 / c));
    const j0 = Math.max(0, Math.floor(y0 / c)), j1 = Math.min(this.rows - 1, Math.floor(y1 / c));
    let m = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = this.grid[j * this.cols + i];
      if (v > m) m = v;
    }
    return m;
  }

  /** Sum of values in a box (for soft costs). */
  sumIn(x0: number, y0: number, x1: number, y1: number): number {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(this.cols - 1, Math.floor(x1 / c));
    const j0 = Math.max(0, Math.floor(y0 / c)), j1 = Math.min(this.rows - 1, Math.floor(y1 / c));
    let s = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) s += this.grid[j * this.cols + i];
    return s;
  }
}

/** Grid-bucketed point set for minimum-distance tests (Poisson-style placement). */
export class PointHash {
  private buckets = new Map<number, number[]>();
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly rs: number[] = [];

  constructor(readonly cell: number) {}

  private key(i: number, j: number): number {
    return (j + 4096) * 16384 + (i + 4096);
  }

  add(x: number, y: number, r: number): void {
    const id = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    this.rs.push(r);
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = []));
    b.push(id);
  }

  /** True if any stored point p satisfies dist²(scaled) < ((r + p.r) * f)². `sy` scales the y distance. */
  conflicts(x: number, y: number, r: number, f = 1, sy = 1, maxR = this.cell): boolean {
    const reach = Math.ceil((r + maxR) * f / this.cell);
    const ci = Math.floor(x / this.cell), cj = Math.floor(y / this.cell);
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        const b = this.buckets.get(this.key(i, j));
        if (!b) continue;
        for (const id of b) {
          const dx = this.xs[id] - x, dy = (this.ys[id] - y) * sy;
          const lim = (r + this.rs[id]) * f;
          if (dx * dx + dy * dy < lim * lim) return true;
        }
      }
    }
    return false;
  }
}
