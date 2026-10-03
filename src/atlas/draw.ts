/**
 * Drawing: turns a PlateModel into ink on a 2D context. Uses only the
 * standard CanvasRenderingContext2D API (works with OffscreenCanvas too).
 *
 * Order: parchment → land tint (relief) → sea wash, ripples, rhumb lines →
 * graticule → coast ink → rivers → forest floor, stipple and terrain glyphs
 * (back to front) → realm washes and coloured edge bands (multiplied over the
 * engraving, like a hand-tinted plate) → borders → routes → settlements and
 * battles → labels → frame, degree band and furniture → ageing (multiplied
 * over everything).
 */
import type { Pt } from "./contour";
import type { PlateModel } from "./model";
import { drawPaperAgeing, drawPaperBase, makeCanvas, type Ctx2D } from "./paper";
import { rgba } from "./style";
import { drawTerrainGlyph, type GlyphEnv } from "./glyphs";
import { riverOutline } from "./rivers";
import { drawBattle, drawPlace, drawRoutes, type IconEnv } from "./icons";
import { drawLabels } from "./text";
import { drawOrnaments } from "./ornaments";
import { drawCartouche, drawCompass, drawGraticuleFrame, drawGraticuleLines, drawInset, drawRhumbs, drawScaleBar, type DecorEnv } from "./decor";

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
  const { pal, k } = m;
  const colour = m.style !== "antique";
  const denv: DecorEnv = { pal, k, colour };
  ctx.save();
  drawPaperBase(ctx, m.width, m.height, pal, m.seed);
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
  if (m.decor.compass && m.style !== "relief") drawRhumbs(ctx, m.decor.compass, m.rect, denv);
  // Ripple lines.
  for (const r of m.water.ripples) {
    ctx.beginPath();
    for (const l of r.lines) tracePts(ctx, l.pts, l.closed);
    ctx.strokeStyle = rgba(pal.waterInk, 0.62 * (1 - r.t) ** 1.2 + 0.06);
    ctx.lineWidth = (0.95 - 0.4 * r.t) * k;
    ctx.stroke();
  }
  ctx.restore();
  if (m.ornaments.length) drawOrnaments(ctx, m.ornaments, pal, k, colour);
  lap("water");

  if (m.decor.graticule.lines.length) drawGraticuleLines(ctx, m.decor.graticule, m.rect, denv);

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
  if (m.forestFloor.length) {
    // Forest floor: one union path of discs, a soft tint so masses read as woods.
    ctx.save();
    clipLand(ctx, m);
    ctx.beginPath();
    const fl = m.forestFloor;
    for (let i = 0; i < fl.length; i += 3) {
      ctx.moveTo(fl[i] + fl[i + 2], fl[i + 1]);
      ctx.arc(fl[i], fl[i + 1], fl[i + 2], 0, Math.PI * 2);
    }
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = colour ? rgba(pal.forestTint, 0.32) : rgba(pal.shadow, 0.1);
    ctx.fill("nonzero");
    ctx.restore();
  }
  ctx.fillStyle = rgba(pal.ink, 0.38);
  const st = m.stipple;
  const ds = 0.75 * k;
  for (let i = 0; i < st.length; i += 2) ctx.fillRect(st[i], st[i + 1], ds, ds);
  let dscale = 1;
  try {
    const t0 = ctx.getTransform();
    dscale = Math.hypot(t0.a, t0.b);
  } catch {
    /* no getTransform: assume 1 */
  }
  const env: GlyphEnv = { pal, k, colour, sprites: Math.max(1, dscale) };
  for (const g of m.glyphs) drawTerrainGlyph(ctx, g, env);
  ctx.restore();
  lap("glyphs");

  // --- Land tint (relief style): biome watercolour and hill-shading, multiplied over the engraving ---
  if (m.shade) {
    const sh = m.shade;
    const cv = makeCanvas(sh.w, sh.h);
    const c2 = cv.getContext("2d") as Ctx2D | null;
    if (c2) {
      const img = c2.createImageData(sh.w, sh.h);
      img.data.set(sh.rgba);
      c2.putImageData(img, 0, 0);
      ctx.save();
      clipLand(ctx, m);
      ctx.globalCompositeOperation = "multiply";
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv as CanvasImageSource, sh.x0 - sh.step / 2, sh.y0 - sh.step / 2, sh.w * sh.step, sh.h * sh.step);
      ctx.restore();
    }
  }
  lap("shade");

  // --- Realms: washes and hand-coloured edge bands, over the engraving (multiplied) ---
  if (m.political && m.political.realms.length) {
    ctx.save();
    clipLand(ctx, m);
    ctx.globalCompositeOperation = "multiply";
    const fillA = pal.realmWash;
    const edgeA = pal.realmEdge;
    for (const r of m.political.realms) {
      if (!r.loops.length) continue;
      const vassal = r.overlord >= 0;
      const col = r.color;
      if (fillA > 0) {
        ctx.beginPath();
        for (const l of r.loops) tracePts(ctx, l, true);
        ctx.fillStyle = rgba(col, fillA * (vassal ? 0.62 : 1) * r.emphasis);
        ctx.fill("evenodd");
      }
      if (edgeA > 0) {
        ctx.save();
        ctx.beginPath();
        for (const l of r.loops) tracePts(ctx, l, true);
        ctx.clip("evenodd");
        ctx.lineJoin = "round";
        const bands: [number, number][] = [[18, 0.1], [11, 0.15], [6, 0.22], [2.6, 0.32]];
        for (const [w, a] of bands) {
          ctx.beginPath();
          for (const l of r.loops) tracePts(ctx, l, true);
          ctx.strokeStyle = rgba(col, a * edgeA * (vassal ? 0.7 : 1) * (0.4 + 0.6 * r.emphasis));
          ctx.lineWidth = w * k;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
  lap("realms");

  // --- Borders, routes, places ----------------------------------------------------
  ctx.save();
  ctx.beginPath();
  rectPath(ctx, m.rect);
  ctx.clip();
  if (m.political) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const kind of ["frontier", "vassal", "realm"] as const) {
      ctx.beginPath();
      for (const b of m.political.borders) if (b.kind === kind) tracePts(ctx, b.pts, false);
      if (kind === "realm") {
        // A soft colour-free underlay so the dashes read over glyphs, then dash-dot ink.
        ctx.strokeStyle = rgba(pal.paper, 0.55);
        ctx.lineWidth = 3.2 * k;
        ctx.stroke();
        ctx.setLineDash([7 * k, 2.4 * k, 1.2 * k, 2.4 * k]);
        ctx.strokeStyle = rgba(pal.ink, 0.85);
        ctx.lineWidth = 1.3 * k;
      } else if (kind === "vassal") {
        ctx.setLineDash([0.4 * k, 2.8 * k]);
        ctx.strokeStyle = rgba(pal.ink, 0.75);
        ctx.lineWidth = 1.3 * k;
      } else {
        ctx.setLineDash([0.3 * k, 3.6 * k]);
        ctx.strokeStyle = rgba(pal.ink, 0.45);
        ctx.lineWidth = 1.1 * k;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  lap("borders");
  const ienv: IconEnv = { pal, k, colour };
  if (m.routes.length) drawRoutes(ctx, m.routes, ienv);
  for (const p of m.places.slice().sort((a, b) => a.y - b.y)) drawPlace(ctx, p, ienv);
  for (const b of m.battles) drawBattle(ctx, b, ienv);
  ctx.restore();
  lap("places");

  drawLabels(ctx, m.labels);
  lap("labels");

  // --- Frame & furniture ------------------------------------------------------------
  drawFrame(ctx, m);
  drawGraticuleFrame(ctx, m.decor.graticule, m.rect, m.frame, denv);
  if (m.decor.inset) drawInset(ctx, m.decor.inset, denv);
  if (m.decor.scale) drawScaleBar(ctx, m.decor.scale, denv);
  if (m.decor.compass) drawCompass(ctx, m.decor.compass, denv);
  if (m.decor.cartouche) drawCartouche(ctx, m.decor.cartouche, denv);
  lap("furniture");
  drawPaperAgeing(ctx, m.width, m.height, pal, m.seed);
  lap("age");
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
    const sh = Math.max(0, nx * 0.6 + ny * 0.8);
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
  // Inner neat line.
  ctx.lineWidth = 0.9 * k;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  // Outer double rule: heavy, then a hairline outside it.
  ctx.lineWidth = 2.4 * k;
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
  const g = 4 * k;
  ctx.lineWidth = 0.6 * k;
  ctx.strokeRect(frame.x - g, frame.y - g, frame.w + 2 * g, frame.h + 2 * g);
  // Corner ornaments: small squares with a saltire.
  const s = 7 * k;
  for (const [cx, cy] of [[frame.x, frame.y], [frame.x + frame.w, frame.y], [frame.x, frame.y + frame.h], [frame.x + frame.w, frame.y + frame.h]] as Pt[]) {
    ctx.beginPath();
    ctx.rect(cx - s, cy - s, 2 * s, 2 * s);
    ctx.fillStyle = pal.paper;
    ctx.fill();
    ctx.lineWidth = 1.1 * k;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s);
    ctx.lineTo(cx - s, cy + s);
    ctx.lineWidth = 0.7 * k;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = pal.paper;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
