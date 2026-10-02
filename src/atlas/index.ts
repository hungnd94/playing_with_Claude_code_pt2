/**
 * Palimpsest atlas: fantasy-cartography plates of a region at a given year.
 *
 *   const result = renderAtlasPlate(ctx, { world, history, year, view, width, height, seed, style, title });
 *
 * Geometry is computed by the pure `buildPlateModel` (Node-safe) and drawn by
 * `drawPlate`, which only uses the standard 2D context API (works with
 * OffscreenCanvas). See src/atlas/PROGRESS.md.
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

export interface AtlasRenderResult {
  model: PlateModel;
  timings: Record<string, number>;
}

export interface AtlasOptions {
  /** Custom text measurement (defaults to ctx.measureText). */
  measure?: Measure;
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
