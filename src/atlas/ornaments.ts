/**
 * Sea ornaments in the manner of old charts: little carracks under sail
 * (preferably on the sea lanes of the trade routes) and, far out in open
 * water, the occasional sea serpent. Placed after the labels in clear water;
 * drawn with the standard 2D API.
 */
import { hash01 } from "../core/rng";
import type { Pt } from "./contour";
import { nodeAt, type FieldGrid } from "./field";
import type { Box, LabelPlacer } from "./labels";
import type { Ctx2D } from "./paper";
import type { RouteLine } from "./places";
import { rgba, type Palette } from "./style";
import type { WaterGeometry } from "./water";
import type { MapRect } from "./projection";

export interface Ornament {
  kind: "ship" | "serpent";
  x: number;
  y: number;
  /** Size (px): ship hull length, serpent length. */
  s: number;
  /** Facing: 1 = towards the right. */
  dir: 1 | -1;
  v: number;
}

export function placeOrnaments(f: FieldGrid, water: WaterGeometry, rect: MapRect, routes: RouteLine[], placer: LabelPlacer, reserved: Box[], k: number, seed: number, compass: { x: number; y: number; r: number } | null): Ornament[] {
  const out: Ornament[] = [];
  const taken: Box[] = [];
  const clearAt = (x: number, y: number) => water.distPx[nodeAt(f, x, y)];
  const free = (b: Box) =>
    b.x0 > rect.x + 6 * k && b.x1 < rect.x + rect.w - 6 * k && b.y0 > rect.y + 6 * k && b.y1 < rect.y + rect.h - 6 * k &&
    !placer.labels.hits(b, 6 * k) && !placer.hard.hits(b, 6 * k) && !reserved.some((r) => b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0) &&
    !taken.some((r) => b.x0 < r.x1 + 40 * k && b.x1 > r.x0 - 40 * k && b.y0 < r.y1 + 40 * k && b.y1 > r.y0 - 40 * k) &&
    !(compass && Math.hypot((b.x0 + b.x1) / 2 - compass.x, (b.y0 + b.y1) / 2 - compass.y) < compass.r * 1.6);
  // Open water area decides how many.
  let wet = 0;
  for (let q = 0; q < f.coast.length; q += 4) if (f.coast[q] <= 0 && water.distPx[q] > 30 * k) wet++;
  const wetFrac = (wet * 4) / f.coast.length;
  const maxShips = wetFrac > 0.45 ? 3 : wetFrac > 0.2 ? 2 : wetFrac > 0.06 ? 1 : 0;
  const S = 30 * k;
  // Candidate points: along sea lanes first, then a coarse lattice of open water.
  const cands: { x: number; y: number; dir: 1 | -1; pr: number }[] = [];
  for (const r of routes) {
    if (r.kind !== "sea") continue;
    for (let i = 2; i < r.pts.length - 2; i += 3) {
      const [x, y] = r.pts[i];
      const [x2] = r.pts[i + 1];
      cands.push({ x, y: y - S * 0.25, dir: x2 >= x ? 1 : -1, pr: 2 + hash01(seed + i, r.id) });
    }
  }
  const stepL = 46 * k;
  for (let y = rect.y + stepL; y < rect.y + rect.h - stepL; y += stepL)
    for (let x = rect.x + stepL; x < rect.x + rect.w - stepL; x += stepL) {
      const u = hash01(Math.round(x * 7 + y * 13), seed);
      cands.push({ x: x + (u - 0.5) * stepL, y: y + (hash01(Math.round(x * 3 + y), seed + 1) - 0.5) * stepL, dir: u < 0.5 ? 1 : -1, pr: u });
    }
  cands.sort((a, b) => b.pr - a.pr || a.x - b.x || a.y - b.y);
  let ships = 0;
  for (const c of cands) {
    if (ships >= maxShips) break;
    const b = { x0: c.x - S * 0.6, y0: c.y - S * 0.95, x1: c.x + S * 0.6, y1: c.y + S * 0.25 };
    if (clearAt(c.x, c.y) < S * 0.9 || clearAt(c.x - S * 0.5, c.y) < S * 0.5 || clearAt(c.x + S * 0.5, c.y) < S * 0.5) continue;
    if (!free(b)) continue;
    out.push({ kind: "ship", x: c.x, y: c.y, s: S, dir: c.dir, v: hash01(Math.round(c.x), Math.round(c.y) + seed) });
    taken.push(b);
    ships++;
  }
  // A serpent only in really open water.
  if (wetFrac > 0.25) {
    const L = 64 * k;
    for (const c of cands) {
      if (c.pr > 1.5) continue;
      const b = { x0: c.x - L * 0.6, y0: c.y - L * 0.35, x1: c.x + L * 0.6, y1: c.y + L * 0.15 };
      if (clearAt(c.x, c.y) < L * 0.9 || clearAt(c.x - L * 0.55, c.y) < L * 0.4 || clearAt(c.x + L * 0.55, c.y) < L * 0.4) continue;
      if (!free(b)) continue;
      out.push({ kind: "serpent", x: c.x, y: c.y, s: L, dir: c.dir, v: c.pr });
      taken.push(b);
      break;
    }
  }
  return out;
}

function waves(ctx: Ctx2D, x0: number, x1: number, y: number, amp: number, n: number): void {
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w;
    ctx.moveTo(a, y);
    ctx.quadraticCurveTo(a + w / 2, y - amp, a + w, y);
  }
}

function drawShip(ctx: Ctx2D, o: Ornament, pal: Palette, k: number, colour: boolean): void {
  const { x, y, s } = o;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.dir, 1);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const ink = pal.ink;
  // Hull: high stern castle on the left, bow to the right.
  const hull: Pt[] = [[-0.5 * s, -0.2 * s], [-0.46 * s, 0.02 * s], [-0.3 * s, 0.1 * s], [0.25 * s, 0.1 * s], [0.48 * s, -0.08 * s], [0.52 * s, -0.12 * s], [0.3 * s, -0.08 * s], [-0.3 * s, -0.08 * s], [-0.36 * s, -0.2 * s]];
  ctx.beginPath();
  ctx.moveTo(hull[0][0], hull[0][1]);
  for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
  ctx.closePath();
  ctx.fillStyle = colour ? rgba(pal.shadow, 0.9) : rgba(ink, 0.55);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.8 * k;
  ctx.stroke();
  // Wale line.
  ctx.beginPath();
  ctx.moveTo(-0.44 * s, -0.02 * s);
  ctx.lineTo(0.38 * s, -0.02 * s);
  ctx.lineWidth = 0.5 * k;
  ctx.stroke();
  // Masts and square sails, billowing to the right.
  const masts: [number, number][] = [[-0.18 * s, 0.82 * s], [0.08 * s, 0.95 * s], [0.3 * s, 0.62 * s]];
  for (const [mx, h] of masts) {
    ctx.beginPath();
    ctx.moveTo(mx, -0.08 * s);
    ctx.lineTo(mx, -0.08 * s - h);
    ctx.lineWidth = 0.7 * k;
    ctx.strokeStyle = ink;
    ctx.stroke();
    for (const [t0, t1, wsc] of [[0.18, 0.5, 1], [0.56, 0.84, 0.75]] as const) {
      const yt = -0.08 * s - h * (1 - t0), yb = -0.08 * s - h * (1 - t1);
      const hw = 0.13 * s * wsc;
      ctx.beginPath();
      ctx.moveTo(mx - hw, yt);
      ctx.lineTo(mx + hw, yt);
      ctx.quadraticCurveTo(mx + hw + 0.06 * s, (yt + yb) / 2, mx + hw, yb);
      ctx.lineTo(mx - hw, yb);
      ctx.quadraticCurveTo(mx - hw + 0.05 * s, (yt + yb) / 2, mx - hw, yt);
      ctx.closePath();
      ctx.fillStyle = pal.paper;
      ctx.fill();
      ctx.lineWidth = 0.6 * k;
      ctx.stroke();
      // a shading stroke along the belly of the sail
      ctx.beginPath();
      ctx.moveTo(mx + hw * 0.5, yt + (yb - yt) * 0.2);
      ctx.quadraticCurveTo(mx + hw * 0.85, (yt + yb) / 2, mx + hw * 0.5, yb - (yb - yt) * 0.2);
      ctx.strokeStyle = rgba(ink, 0.5);
      ctx.lineWidth = 0.45 * k;
      ctx.stroke();
      ctx.strokeStyle = ink;
    }
    // pennant
    ctx.beginPath();
    ctx.moveTo(mx, -0.08 * s - h);
    ctx.quadraticCurveTo(mx - 0.1 * s, -0.08 * s - h + 0.02 * s, mx - 0.2 * s, -0.08 * s - h + 0.05 * s);
    ctx.lineTo(mx, -0.08 * s - h + 0.06 * s);
    ctx.fillStyle = colour ? rgba(pal.red, 0.85) : ink;
    ctx.fill();
  }
  // Bowsprit and rigging.
  ctx.beginPath();
  ctx.moveTo(0.46 * s, -0.1 * s);
  ctx.lineTo(0.66 * s, -0.24 * s);
  ctx.moveTo(0.66 * s, -0.24 * s);
  ctx.lineTo(0.08 * s, -0.08 * s - 0.95 * s);
  ctx.moveTo(-0.5 * s, -0.2 * s);
  ctx.lineTo(-0.18 * s, -0.08 * s - 0.82 * s);
  ctx.strokeStyle = rgba(ink, 0.6);
  ctx.lineWidth = 0.4 * k;
  ctx.stroke();
  // Waves at the waterline.
  ctx.beginPath();
  waves(ctx, -0.62 * s, 0.62 * s, 0.13 * s, 0.05 * s, 6);
  waves(ctx, -0.4 * s, 0.4 * s, 0.22 * s, 0.035 * s, 4);
  ctx.strokeStyle = rgba(pal.waterInk, 0.8);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  ctx.restore();
}

function drawSerpent(ctx: Ctx2D, o: Ornament, pal: Palette, k: number, colour: boolean): void {
  const { x, y, s } = o;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(o.dir, 1);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const ink = pal.ink;
  const body = colour ? rgba(pal.forestTint, 0.95) : pal.paper;
  // Three humps rising from the water, tail curl on the left, head on the right.
  const humps: [number, number, number][] = [[-0.3, 0.13, 0.15], [-0.02, 0.15, 0.2], [0.24, 0.12, 0.15]];
  for (const [cx, hw, hh] of humps) {
    const x0 = (cx - hw) * s, x1 = (cx + hw) * s, th = 0.045 * s;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.bezierCurveTo(x0, -hh * s * 1.3, x1, -hh * s * 1.3, x1, 0);
    ctx.lineTo(x1 - th, 0);
    ctx.bezierCurveTo(x1 - th, -hh * s * 1.3 + th * 1.4, x0 + th, -hh * s * 1.3 + th * 1.4, x0 + th, 0);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.75 * k;
    ctx.stroke();
    // scales: little ticks along the hump
    ctx.beginPath();
    for (let t = 0.15; t < 0.9; t += 0.12) {
      const u = 1 - t;
      const bx = u * u * u * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x1 + t * t * t * x1;
      const by = 3 * u * u * t * (-hh * s * 1.3) + 3 * u * t * t * (-hh * s * 1.3);
      ctx.moveTo(bx - th * 0.2, by + th * 0.3);
      ctx.lineTo(bx + th * 0.15, by + th * 0.75);
    }
    ctx.lineWidth = 0.45 * k;
    ctx.stroke();
  }
  // Tail curl.
  ctx.beginPath();
  ctx.moveTo(-0.52 * s, 0);
  ctx.bezierCurveTo(-0.52 * s, -0.12 * s, -0.66 * s, -0.16 * s, -0.62 * s, -0.06 * s);
  ctx.bezierCurveTo(-0.6 * s, -0.01 * s, -0.55 * s, -0.04 * s, -0.57 * s, -0.08 * s);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.1 * k;
  ctx.stroke();
  // Neck and head.
  ctx.beginPath();
  ctx.moveTo(0.4 * s, 0);
  ctx.bezierCurveTo(0.42 * s, -0.2 * s, 0.5 * s, -0.3 * s, 0.6 * s, -0.3 * s);
  ctx.lineTo(0.68 * s, -0.27 * s);
  ctx.lineTo(0.6 * s, -0.25 * s);
  ctx.lineTo(0.66 * s, -0.22 * s);
  ctx.bezierCurveTo(0.56 * s, -0.2 * s, 0.48 * s, -0.12 * s, 0.46 * s, 0);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 0.75 * k;
  ctx.stroke();
  // eye and fin
  ctx.beginPath();
  ctx.arc(0.585 * s, -0.275 * s, 0.9 * k, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.5 * s, -0.26 * s);
  ctx.lineTo(0.47 * s, -0.36 * s);
  ctx.lineTo(0.54 * s, -0.29 * s);
  ctx.stroke();
  // Water around: little wave arcs where the body meets the sea.
  ctx.beginPath();
  for (const [cx, hw] of humps) {
    waves(ctx, (cx - hw - 0.06) * s, (cx - hw + 0.04) * s, 0.02 * s, 0.03 * s, 1);
    waves(ctx, (cx + hw - 0.04) * s, (cx + hw + 0.06) * s, 0.02 * s, 0.03 * s, 1);
  }
  waves(ctx, -0.7 * s, 0.7 * s, 0.07 * s, 0.025 * s, 9);
  ctx.strokeStyle = rgba(pal.waterInk, 0.8);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  ctx.restore();
}

export function drawOrnaments(ctx: Ctx2D, orns: Ornament[], pal: Palette, k: number, colour: boolean): void {
  for (const o of orns) {
    if (o.kind === "ship") drawShip(ctx, o, pal, k, colour);
    else drawSerpent(ctx, o, pal, k, colour);
  }
}
