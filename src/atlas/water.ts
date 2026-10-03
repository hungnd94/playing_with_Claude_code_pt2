/**
 * Coastlines, lake shores and coastal ripple lines from the sampled field.
 */
import { boxBlur, chaikin, decimate, distanceTransform, marchingSquares, polylineLength, toScreen, type Polyline, type Pt } from "./contour";
import type { FieldGrid } from "./field";

export interface WaterGeometry {
  /** Closed loops of the land/water boundary (coasts + lake shores), screen px. Even-odd fill = land. */
  coastLoops: Pt[][];
  /** For each loop: true when it borders a lake rather than the sea. */
  loopIsLake: boolean[];
  /** Offset contour lines, outermost last; `t` in 0..1 (0 = closest to the shore). */
  ripples: { t: number; lines: Polyline[] }[];
  /** Distance (px) from land for water nodes (0 on land). */
  distPx: Float32Array;
}

export function buildWater(f: FieldGrid, opts: { rippleCount: number; rippleGap: number; minLoopPx: number }): WaterGeometry {
  const { gx, gy, step } = f;
  // Coast: marching squares at 0 on the signed field (outside counts as water).
  const raw = marchingSquares(f.coast, gx, gy, 0, -1);
  const coastLoops: Pt[][] = [];
  const loopIsLake: boolean[] = [];
  for (const l of toScreen(raw, f.x0, f.y0, step)) {
    if (l.pts.length < 3) continue;
    const len = polylineLength(l.pts, true);
    if (len < opts.minLoopPx) continue;
    const sm = chaikin(decimate(l, step * 0.35), 2);
    coastLoops.push(sm.pts);
    // Lake shore? Check the water side of a few points.
    let lakeVotes = 0, votes = 0;
    const pts = l.pts;
    for (let q = 0; q < pts.length; q += Math.max(1, Math.floor(pts.length / 12))) {
      const a = pts[q], b = pts[(q + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      // land on the left (dy, -dx); water on the right (-dy, dx)
      const wx = a[0] + (-dy / L) * step * 1.2, wy = a[1] + (dx / L) * step * 1.2;
      const i = Math.round((wx - f.x0) / step), j = Math.round((wy - f.y0) / step);
      if (i < 0 || j < 0 || i >= gx || j >= gy) continue;
      votes++;
      if (f.lake[j * gx + i]) lakeVotes++;
    }
    loopIsLake.push(votes > 0 && lakeVotes / votes > 0.5);
  }

  // Distance from land (in nodes) for ripples.
  const N = gx * gy;
  const dist = distanceTransform(gx, gy, (k) => f.coast[k] > 0);
  // Sub-node refinement near the shore: use the field gradient for the first node.
  const distPx = new Float32Array(N);
  for (let k = 0; k < N; k++) distPx[k] = dist[k] * step;

  // The outer ripples are smooth: contour them on a half-resolution grid.
  const ds = 2;
  const hx = Math.ceil(gx / ds), hy = Math.ceil(gy / ds);
  const half = new Float32Array(hx * hy);
  for (let j = 0; j < hy; j++) for (let i = 0; i < hx; i++) half[j * hx + i] = distPx[Math.min(gy - 1, j * ds) * gx + Math.min(gx - 1, i * ds)];
  const ripples: { t: number; lines: Polyline[] }[] = [];
  for (let r = 0; r < opts.rippleCount; r++) {
    const levelPx = opts.rippleGap * (r + 1) * (1 + r * 0.18);
    const fine = r < 2;
    const st = fine ? step : step * ds;
    const W = fine ? gx : hx, H = fine ? gy : hy;
    const blurNodes = Math.max(1, Math.round((levelPx * 0.22) / st));
    const bl = boxBlur(fine ? distPx : half, W, H, blurNodes, 2);
    // Water nodes beyond the level are "high": contour at level; land stays 0.
    const lines = marchingSquares(bl, W, H, levelPx, 1e6);
    const scr = toScreen(lines, f.x0, f.y0, st)
      .filter((l) => polylineLength(l.pts, l.closed) > Math.max(opts.minLoopPx * 1.5, levelPx * 2.5))
      .map((l) => chaikin(decimate(l, st * 0.5), 2));
    ripples.push({ t: opts.rippleCount > 1 ? r / (opts.rippleCount - 1) : 0, lines: scr });
  }
  return { coastLoops, loopIsLake, ripples, distPx };
}
