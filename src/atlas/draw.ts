/**
 * Drawing: turns a PlateModel into ink on a 2D context. Uses only the
 * standard CanvasRenderingContext2D API (works with OffscreenCanvas too).
 */
import { Rng } from "../core/rng";
import type { Pt } from "./contour";
import type { PlateModel } from "./model";
import { drawPaperAgeing, drawPaperBase, type Ctx2D } from "./paper";
import { rgba } from "./style";
import { drawTerrainGlyph, type GlyphEnv } from "./glyphs";
import { riverOutline } from "./rivers";

export function tracePts(ctx: Ctx2D, pts: Pt[], closed: boolean): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

function rectPath(ctx: Ctx2D, r: { x: number; y: number; w: number; h: number }): void {
  ctx.rect(r.x, r.y, r.w, r.h);
}

/** Clip to the water inside the map rect (rect XOR land loops). */
function clipWater(ctx: Ctx2D, m: PlateModel): void {
  ctx.beginPath();
  rectPath(ctx, m.rect);
  for (const l of m.water.coastLoops) tracePts(ctx, l, true);
  ctx.clip("evenodd");
}

function clipLand(ctx: Ctx2D, m: PlateModel): void {
  ctx.beginPath();
  for (const l of m.water.coastLoops) tracePts(ctx, l, true);
  ctx.clip("evenodd");
}

export function drawPlate(ctx: Ctx2D, m: PlateModel): Record<string, number> {
  const timings: Record<string, number> = {};
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let t = now();
  const lap = (name: string) => {
    const t2 = now();
    timings[name] = Math.round((t2 - t) * 10) / 10;
    t = t2;
  };
  const rng = new Rng(m.decoSeed);
  const { pal, k } = m;
  ctx.save();
  drawPaperBase(ctx, m.width, m.height, pal, rng.fork("paper"));
  lap("paper");

  // --- Water -------------------------------------------------------------
  ctx.save();
  clipWater(ctx, m);
  ctx.fillStyle = rgba(pal.water, 0.62);
  ctx.fillRect(m.rect.x, m.rect.y, m.rect.w, m.rect.h);
  // Coastal deepening: wide soft strokes along the shores.
  ctx.lineJoin = "round";
  for (const [w, a] of [[34, 0.07], [20, 0.08], [11, 0.1], [5, 0.12]] as const) {
    ctx.beginPath();
    for (const l of m.water.coastLoops) tracePts(ctx, l, true);
    ctx.strokeStyle = rgba(pal.waterDeep, a);
    ctx.lineWidth = w * k;
    ctx.stroke();
  }
  // Ripple lines.
  for (const r of m.water.ripples) {
    ctx.beginPath();
    for (const l of r.lines) tracePts(ctx, l.pts, l.closed);
    ctx.strokeStyle = rgba(pal.waterInk, 0.62 * (1 - r.t) ** 1.2 + 0.06);
    ctx.lineWidth = (0.95 - 0.4 * r.t) * k;
    ctx.stroke();
  }
  ctx.restore();
  lap("water");

  // --- Coastline ink (varying weight: heavier on the shadow side) ----------
  ctx.save();
  ctx.beginPath();
  rectPath(ctx, m.rect);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = pal.ink;
  for (const loop of m.water.coastLoops) inkVaryingLine(ctx, loop, true, 0.9 * k, 2.1 * k);
  ctx.restore();
  lap("coast");

  // --- Rivers ------------------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  rectPath(ctx, m.rect);
  ctx.clip();
  ctx.fillStyle = pal.river;
  for (const r of m.rivers) {
    const o = riverOutline(r);
    ctx.beginPath();
    tracePts(ctx, o, true);
    ctx.fill();
  }
  ctx.restore();
  lap("rivers");

  // --- Ground stipple & terrain glyphs (back to front) -----------------------
  ctx.save();
  ctx.beginPath();
  rectPath(ctx, m.rect);
  ctx.clip();
  ctx.fillStyle = rgba(pal.ink, 0.38);
  const st = m.stipple;
  const ds = 0.75 * k;
  for (let i = 0; i < st.length; i += 2) ctx.fillRect(st[i], st[i + 1], ds, ds);
  const env: GlyphEnv = { pal, k, colour: m.style !== "antique" };
  for (const g of m.glyphs) drawTerrainGlyph(ctx, g, env);
  ctx.restore();
  lap("glyphs");

  // --- Frame ---------------------------------------------------------------
  drawFrame(ctx, m);
  drawPaperAgeing(ctx, m.width, m.height, pal, rng.fork("age"));
  lap("frame+age");
  ctx.restore();
  return timings;
}

/**
 * Stroke a polyline with a weight that varies with direction (light from the
 * upper left: edges facing lower-right are heavier), in short overlapping runs.
 */
export function inkVaryingLine(ctx: Ctx2D, pts: Pt[], closed: boolean, wMin: number, wMax: number): void {
  const n = pts.length;
  if (n < 2) return;
  const run = 6;
  const total = closed ? n : n - 1;
  for (let s = 0; s < total; s += run) {
    const e = Math.min(total, s + run);
    // Mean direction of the run.
    const a = pts[s], b = pts[e % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    // Land on the left; outward normal (towards water) is on the right: (-dy, dx).
    const nx = -dy / L, ny = dx / L;
    // Shadow side faces down-right (light from the upper-left).
    const sh = Math.max(0, (nx * 0.6 + ny * 0.8));
    ctx.lineWidth = wMin + (wMax - wMin) * sh;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    for (let i = s + 1; i <= e; i++) {
      const p = pts[i % n];
      ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }
}

function drawFrame(ctx: Ctx2D, m: PlateModel): void {
  const { frame, rect, k, pal } = m;
  ctx.save();
  // Paper margin outside the map rect (covers any spill).
  ctx.beginPath();
  ctx.rect(0, 0, m.width, m.height);
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = pal.paper;
  ctx.fill("evenodd");
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 2.2 * k;
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
  ctx.lineWidth = 0.8 * k;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  const g = 3.5 * k;
  ctx.lineWidth = 0.6 * k;
  ctx.strokeRect(frame.x - g, frame.y - g, frame.w + 2 * g, frame.h + 2 * g);
  ctx.restore();
}
