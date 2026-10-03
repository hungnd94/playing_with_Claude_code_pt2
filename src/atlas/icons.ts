/**
 * Point symbols: settlements by size (village dot, town ring, city
 * pictogram of roofs and a spire, capital castle flying the realm's pennant,
 * walls for walled places), ruins, battle sites, and trade routes.
 * Standard 2D context API only.
 */
import type { Pt } from "./contour";
import { prng } from "./glyphs";
import type { Ctx2D } from "./paper";
import type { BattleMark, PlaceMark, RouteLine } from "./places";
import { rgba, type Palette } from "./style";

export interface IconEnv {
  pal: Palette;
  k: number;
  colour: boolean;
}

function roofColour(env: IconEnv): string {
  return env.colour ? rgba(env.pal.red, 0.55) : rgba(env.pal.ink, 0.25);
}

/** A little house: box with a gable roof; (x, y) = bottom centre. */
function house(ctx: Ctx2D, x: number, y: number, w: number, h: number, roofH: number, env: IconEnv): void {
  const { pal, k } = env;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h, w, h);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.lineWidth = 0.7 * k;
  ctx.strokeStyle = pal.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 0.5 * k, y - h);
  ctx.lineTo(x, y - h - roofH);
  ctx.lineTo(x + w / 2 + 0.5 * k, y - h);
  ctx.closePath();
  ctx.fillStyle = roofColour(env);
  ctx.fill();
  ctx.stroke();
}

/** A tower with a pointed (or crenellated) top; (x, y) = bottom centre. */
function tower(ctx: Ctx2D, x: number, y: number, w: number, h: number, env: IconEnv, crenel = false, spire = 0): void {
  const { pal, k } = env;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h, w, h);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.lineWidth = 0.75 * k;
  ctx.strokeStyle = pal.ink;
  ctx.stroke();
  if (crenel) {
    const m = 3;
    const mw = w / (2 * m - 1);
    ctx.beginPath();
    for (let i = 0; i < m; i++) ctx.rect(x - w / 2 + 2 * i * mw, y - h - mw * 1.1, mw, mw * 1.1);
    ctx.fillStyle = pal.paper;
    ctx.fill();
    ctx.stroke();
  }
  if (spire > 0) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 0.4 * k, y - h);
    ctx.lineTo(x, y - h - spire);
    ctx.lineTo(x + w / 2 + 0.4 * k, y - h);
    ctx.closePath();
    ctx.fillStyle = roofColour(env);
    ctx.fill();
    ctx.stroke();
  }
  // window slit
  ctx.beginPath();
  ctx.moveTo(x, y - h * 0.62);
  ctx.lineTo(x, y - h * 0.42);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
}

/** Ground line with a short crenellated wall. */
function wall(ctx: Ctx2D, x: number, y: number, w: number, env: IconEnv): void {
  const { pal, k } = env;
  const h = 2.2 * k;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h, w, h);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.lineWidth = 0.7 * k;
  ctx.strokeStyle = pal.ink;
  ctx.stroke();
  const m = Math.max(3, Math.round(w / (2.2 * k)));
  const mw = w / (2 * m - 1);
  ctx.beginPath();
  for (let i = 0; i < m; i++) ctx.rect(x - w / 2 + 2 * i * mw, y - h - 1.1 * k, mw, 1.1 * k);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.stroke();
}

function pennant(ctx: Ctx2D, x: number, y: number, len: number, color: [number, number, number] | null, env: IconEnv): void {
  const { pal, k } = env;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - len);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - len);
  ctx.quadraticCurveTo(x + len * 0.55, y - len * 0.95, x + len * 0.95, y - len * 0.72);
  ctx.quadraticCurveTo(x + len * 0.5, y - len * 0.68, x, y - len * 0.55);
  ctx.closePath();
  const c = color ?? [154, 53, 36];
  ctx.fillStyle = env.colour ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : rgba(pal.ink, 0.7);
  ctx.fill();
  ctx.lineWidth = 0.5 * k;
  ctx.stroke();
}

/** Ground shadow under pictograms. */
function groundLine(ctx: Ctx2D, x: number, y: number, w: number, env: IconEnv): void {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x + w / 2, y);
  ctx.strokeStyle = env.pal.ink;
  ctx.lineWidth = 0.9 * env.k;
  ctx.stroke();
}

export function drawPlace(ctx: Ctx2D, m: PlaceMark, env: IconEnv): void {
  const { pal, k } = env;
  const r = prng(((m.id * 2654435761) >>> 0) / 4294967296);
  ctx.save();
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  const { x } = m;
  switch (m.tier) {
    case "village": {
      ctx.beginPath();
      ctx.arc(x, m.y, 1.75 * k, 0, Math.PI * 2);
      ctx.fillStyle = pal.ink;
      ctx.fill();
      break;
    }
    case "town": {
      ctx.beginPath();
      ctx.arc(x, m.y, 2.9 * k, 0, Math.PI * 2);
      ctx.fillStyle = pal.paper;
      ctx.fill();
      ctx.lineWidth = 1 * k;
      ctx.strokeStyle = pal.ink;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, m.y, 1.1 * k, 0, Math.PI * 2);
      ctx.fillStyle = pal.ink;
      ctx.fill();
      if (m.walled) {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.moveTo(x + Math.cos(a) * 2.9 * k, m.y + Math.sin(a) * 2.9 * k);
          ctx.lineTo(x + Math.cos(a) * 4.1 * k, m.y + Math.sin(a) * 4.1 * k);
        }
        ctx.lineWidth = 0.8 * k;
        ctx.stroke();
      }
      break;
    }
    case "city": {
      const s = m.great ? 1.2 : 1;
      const y = m.y + 2 * k * s;
      const w = 12 * k * s;
      // houses left and right, spire in the middle
      house(ctx, x - 3.6 * k * s, y, 3.6 * k * s, 3.2 * k * s, 2.2 * k * s, env);
      house(ctx, x + 3.7 * k * s, y, 3.4 * k * s, 2.8 * k * s, 2 * k * s, env);
      tower(ctx, x + 0.1 * k, y, 2.8 * k * s, 6.2 * k * s, env, false, 3.6 * k * s);
      if (m.great) house(ctx, x - 6.4 * k * s, y, 2.4 * k * s, 2.2 * k * s, 1.5 * k * s, env);
      if (m.walled) wall(ctx, x, y + 0.2 * k, w * 1.05, env);
      groundLine(ctx, x, y + 0.2 * k, w * 1.15, env);
      break;
    }
    case "capital": {
      const s = m.great ? 1.15 : 1;
      const y = m.y + 2.6 * k * s;
      const w = 15 * k * s;
      // curtain wall, flanking towers, keep with pennant
      ctx.beginPath();
      ctx.rect(x - w / 2 + 2 * k, y - 4.2 * k * s, w - 4 * k, 4.2 * k * s);
      ctx.fillStyle = pal.paper;
      ctx.fill();
      ctx.lineWidth = 0.75 * k;
      ctx.strokeStyle = pal.ink;
      ctx.stroke();
      // gate
      ctx.beginPath();
      ctx.moveTo(x - 1.3 * k, y);
      ctx.lineTo(x - 1.3 * k, y - 1.8 * k);
      ctx.arc(x, y - 1.8 * k, 1.3 * k, Math.PI, 0);
      ctx.lineTo(x + 1.3 * k, y);
      ctx.fillStyle = pal.ink;
      ctx.fill();
      tower(ctx, x - w / 2 + 2 * k, y, 3.2 * k * s, 7 * k * s, env, true);
      tower(ctx, x + w / 2 - 2 * k, y, 3.2 * k * s, 7 * k * s, env, true);
      tower(ctx, x, y - 4.2 * k * s, 4 * k * s, 5.4 * k * s, env, true);
      pennant(ctx, x, y - 4.2 * k * s - 5.4 * k * s - 1.3 * k, 6.5 * k, m.color, env);
      groundLine(ctx, x, y + 0.2 * k, w * 1.12, env);
      break;
    }
    case "ruin": {
      const y = m.y + 2 * k;
      ctx.strokeStyle = rgba(pal.ink, 0.75);
      ctx.fillStyle = pal.paper;
      ctx.lineWidth = 0.7 * k;
      // two broken columns and an arch fragment
      const hs = [5.4, 3.3];
      for (let i = 0; i < 2; i++) {
        const cx = x + (i ? 2.4 : -2.4) * k;
        const h = hs[i] * k * (0.9 + 0.2 * r());
        ctx.beginPath();
        ctx.moveTo(cx - 0.9 * k, y);
        ctx.lineTo(cx - 0.9 * k, y - h);
        ctx.lineTo(cx + 0.9 * k, y - h + 0.9 * k);
        ctx.lineTo(cx + 0.9 * k, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x - 1.2 * k, y - 4.4 * k, 1.6 * k, Math.PI * 1.05, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4.2 * k, y);
      ctx.lineTo(x + 4.2 * k, y);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.ink, 0.6);
      for (let i = 0; i < 3; i++) ctx.fillRect(x + (r() - 0.5) * 7 * k, y + 0.8 * k + r() * 1.2 * k, 0.8 * k, 0.8 * k);
      break;
    }
  }
  ctx.restore();
}

/** Crossed swords with a small date star. */
export function drawBattle(ctx: Ctx2D, b: BattleMark, env: IconEnv): void {
  const { pal, k } = env;
  const s = 4.6 * k;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = env.colour ? pal.red : pal.ink;
  for (const dir of [1, -1]) {
    // blade
    ctx.beginPath();
    ctx.moveTo(b.x - dir * s, b.y + s);
    ctx.lineTo(b.x + dir * s, b.y - s);
    ctx.lineWidth = 1.1 * k;
    ctx.stroke();
    // cross-guard
    const gx = b.x - dir * s * 0.55, gy = b.y + s * 0.55;
    ctx.beginPath();
    ctx.moveTo(gx - s * 0.32, gy - dir * s * 0.32 * dir);
    ctx.lineTo(gx + s * 0.32, gy + dir * s * 0.32 * dir);
    ctx.moveTo(gx - s * 0.3 * dir, gy - s * 0.3);
    ctx.lineTo(gx + s * 0.3 * dir, gy + s * 0.3);
    ctx.lineWidth = 0.9 * k;
    ctx.stroke();
  }
  ctx.restore();
}

/** Trade routes: dotted roads over land, dashed sea lanes over water. */
export function drawRoutes(ctx: Ctx2D, routes: RouteLine[], env: IconEnv): void {
  const { pal, k } = env;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const r of routes) {
    ctx.beginPath();
    tracePts(ctx, r.pts);
    if (r.kind === "sea") {
      ctx.setLineDash([5 * k, 3.5 * k]);
      ctx.strokeStyle = rgba(pal.routeSea, 0.75);
      ctx.lineWidth = 0.9 * k;
    } else {
      ctx.setLineDash([0.1 * k, 3.2 * k]);
      ctx.strokeStyle = rgba(pal.route, 0.8);
      ctx.lineWidth = 1.5 * k;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function tracePts(ctx: Ctx2D, pts: Pt[]): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}
