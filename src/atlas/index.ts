/**
 * Palimpsest atlas: fantasy-cartography plates of a region at a given year.
 *
 *   const plan = planRealmView(world, history, polityId, year, { aspect: w / h });
 *   const result = renderAtlasPlate(ctx, { world, history, year: plan.year, view: plan.view, subject: plan.subject,
 *                                          width: w, height: h, seed, style: "political" });
 *   hitTest(result.model, x, y)  // → { type: "settlement" | "polity" | "feature" | "battle", id } | null
 *
 * Geometry is computed by the pure `buildPlateModel` (Node-safe) and drawn by
 * `drawPlate`, which only uses the standard 2D context API (works with
 * OffscreenCanvas). Fonts: load ATLAS_FONTS_CSS (IM Fell English + SC) before
 * rendering, or call `ensureAtlasFonts()` in a document. See PROGRESS.md.
 */
import { buildPlateModel, type AtlasInput, type Measure, type PlateModel } from "./model";
import { drawPlate } from "./draw";
import type { Ctx2D } from "./paper";

export type { AtlasInput, Measure, PlateModel } from "./model";
export type { AtlasView, MapRect } from "./projection";
export { Projection } from "./projection";
export type { AtlasStyle } from "./style";
export { buildPlateModel } from "./model";
export { drawPlate } from "./draw";
export type { PlacedLabel } from "./labels";
export {
  fitCells, planContinentView, planRealmView, planRegionView, planWarView, planPointView, largestRealms,
  type PlannedView, type PlateSubject, type FitOptions,
} from "./planner";

export interface AtlasRenderResult {
  model: PlateModel;
  timings: Record<string, number>;
}

export interface AtlasOptions {
  /** Custom text measurement (defaults to ctx.measureText). */
  measure?: Measure;
}

/** Google Fonts stylesheet for the map faces. */
export const ATLAS_FONTS_CSS = "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=block";

/**
 * Wait until the map faces are available (no-op outside a document). Text is
 * measured during layout, so render after this resolves for stable labels.
 */
export async function ensureAtlasFonts(): Promise<void> {
  const fonts = (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load('20px "IM Fell English"'),
      fonts.load('italic 20px "IM Fell English"'),
      fonts.load('20px "IM Fell English SC"'),
    ]);
  } catch {
    /* fall back to Georgia */
  }
}

/** Text measurement backed by a 2D context, with a cache. */
export function contextMeasure(ctx: Ctx2D): Measure {
  const cache = new Map<string, number>();
  return (font: string, text: string) => {
    const key = font + "\u0000" + text;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.save();
      ctx.font = font;
      w = ctx.measureText(text).width;
      ctx.restore();
      cache.set(key, w);
    }
    return w;
  };
}

/** Approximate measurement for Node (tests, tools): IM Fell English metrics, roughly. */
export function approxMeasure(font: string, text: string): number {
  const m = /([\d.]+)px/.exec(font);
  const size = m ? parseFloat(m[1]) : 16;
  const sc = /SC/.test(font);
  let w = 0;
  for (const ch of Array.from(text)) {
    if (ch === " ") w += 0.26;
    else if (/[MWmw]/.test(ch)) w += 0.82;
    else if (/[A-Z]/.test(ch)) w += sc ? 0.72 : 0.68;
    else if (/[iljtf'.,]/.test(ch)) w += 0.28;
    else w += sc ? 0.56 : 0.47;
  }
  return w * size;
}

export function renderAtlasPlate(ctx: Ctx2D, input: AtlasInput, opts: AtlasOptions = {}): AtlasRenderResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const measure = opts.measure ?? contextMeasure(ctx);
  const model = buildPlateModel(input, measure);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const drawT = drawPlate(ctx, model);
  const t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const timings: Record<string, number> = { ...model.timings };
  for (const [k, v] of Object.entries(drawT)) timings["draw." + k] = v;
  timings.model = Math.round(t1 - t0);
  timings.draw = Math.round(t2 - t1);
  timings.total = Math.round(t2 - t0);
  return { model, timings };
}

/** What is under a plate pixel: a label's entity, else a settlement icon, else null. */
export function hitTest(model: PlateModel, x: number, y: number): { type: string; id: number } | null {
  for (let i = model.labels.length - 1; i >= 0; i--) {
    const l = model.labels[i];
    if (!l.ref) continue;
    for (const b of l.boxes) if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) return l.ref;
  }
  for (const p of model.places) if (Math.abs(x - p.x) <= p.r + 2 && Math.abs(y - p.y) <= p.r * 1.6 + 2) return { type: "settlement", id: p.id };
  return null;
}
