/**
 * Glyph factory: produces mutually distinguishable, legible glyph shapes from
 * a script's design family, and registers derived shapes so later glyphs
 * keep their distance from them too.
 */
import type { Rng } from "../core/rng";
import type { Family, ScriptStyle, Stroke } from "./types";
import { genGlyph, type GenCtx, type Shape } from "./families";
import { rasterize, maxSimilarity, overlapFraction, keepRaster, scratchRaster, type Raster } from "./raster";
import { complexity, roundStrokes, strokesBBox } from "./geom";
import { differentiate, type Differentiator } from "./marks";

export class GlyphFactory {
  readonly rasters: Raster[] = [];
  /** Similarity above which a candidate counts as a look-alike. */
  thresh: number;
  /** Differentiators used to rescue a look-alike (family-consistent). */
  rescue: Differentiator[] = ["dotOut", "bar", "tick", "dotIn"];

  constructor(
    readonly rng: Rng,
    readonly family: Family,
    readonly ctx: GenCtx,
    readonly style: ScriptStyle,
  ) {
    // Calibrated on the families' own similarity distributions (median ≈ 0.7–0.8):
    // near-duplicates sit above ≈ 0.95, distinct-but-related letters at 0.85–0.92.
    const T: Partial<Record<Family, number>> = { cursive: 0.95, linear: 0.94, round: 0.93, wedge: 0.93, hanging: 0.925 };
    this.thresh = T[family] ?? 0.92;
  }

  /** Register a shape (inherited or derived) so new glyphs avoid it. */
  register(shape: Shape | Stroke[], w?: number): Raster {
    const strokes = Array.isArray(shape) ? shape : shape.strokes;
    const r = rasterize(strokes, Array.isArray(shape) ? (w ?? 0.8) : shape.w);
    this.rasters.push(r);
    return r;
  }

  /** Highest similarity to a registered glyph (with a `stop`, only a threshold test: see maxSimilarity). */
  similarityTo(shape: Shape, stop = 2): number {
    return maxSimilarity(rasterize(shape.strokes, shape.w, this.scratch), this.rasters, stop);
  }

  /** Register an already rasterised shape (must not be a scratch raster). */
  registerRaster(r: Raster): void {
    this.rasters.push(r);
  }

  /**
   * Effective look-alike threshold: large sign sets (syllabaries) tolerate
   * slightly closer pairs, as real ones do (Linear B, Cherokee, Vai).
   */
  get limit(): number {
    const n = this.rasters.length;
    return this.thresh + 0.02 * Math.max(0, Math.min(1, (n - 40) / 60));
  }

  private gen(gen?: (rng: Rng) => Shape): Shape {
    return gen ? gen(this.rng) : genGlyph(this.family, this.rng, this.ctx);
  }

  /** Accept a shape whose raster `r` (possibly scratch) is known to be distinct. */
  private take(s: Shape, r: Raster): Shape {
    this.rasters.push(r === this.scratch ? keepRaster(r) : r);
    return tidy(s);
  }

  private readonly scratch: Raster = scratchRaster();

  /** A fresh glyph from the family grammar, rejecting look-alikes and tangles. */
  fresh(maxTries = 14, gen?: (rng: Rng) => Shape): Shape {
    maxTries = Math.min(this.rasters.length > 50 ? 12 : 26, maxTries + Math.floor(this.rasters.length / 3));
    const lim = this.limit;
    let best: Shape | null = null;
    let bestScore = Infinity;
    for (let t = 0; t < maxTries; t++) {
      const s = this.gen(gen);
      if (!s.strokes.length) continue;
      const r = rasterize(s.strokes, s.w, this.scratch);
      // Cheap test first (early exit above the threshold), tangles only for survivors.
      const sim = maxSimilarity(r, this.rasters, lim);
      if (sim < lim) {
        const tangle = overlapFraction(s.strokes);
        if (tangle < 0.3) return this.take(s, r);
        if (tangle > 0.42) continue;
        const score = sim + tangle * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      } else if (sim + 0.15 < bestScore) {
        bestScore = sim + 0.15;
        best = s;
      }
    }
    if (!best) best = this.gen(gen);
    const bestR = rasterize(best.strokes, best.w, this.scratch);
    if (maxSimilarity(bestR, this.rasters, lim) < lim) return this.take(best, bestR);
    // Rescue a look-alike with the script's own differentiators (dots, bars, ticks…).
    const tryShape = (c: Shape): Shape | null => {
      const r = rasterize(c.strokes, c.w, this.scratch);
      return maxSimilarity(r, this.rasters, lim) < lim ? this.take(c, r) : null;
    };
    for (const d of this.rescue) {
      const ok = tryShape(differentiate(best, d, this.rng));
      if (ok) return ok;
    }
    for (const d of this.rescue) {
      const e = this.rescue[(this.rescue.indexOf(d) + 1) % this.rescue.length];
      const ok = tryShape(differentiate(differentiate(best, d, this.rng), e, this.rng));
      if (ok) return ok;
    }
    // Last resort: fresh candidates, half of them with a differentiator.
    for (let k = 0; k < 10; k++) {
      const g0 = this.gen(gen);
      const ok = tryShape(k % 2 ? g0 : differentiate(g0, this.rescue[k % this.rescue.length], this.rng));
      if (ok) return ok;
    }
    return this.take(best, rasterize(best.strokes, best.w));
  }

  /** Accept a candidate only if distinct enough; returns null otherwise. */
  tryAccept(s: Shape, thresh = this.thresh): Shape | null {
    const r = rasterize(s.strokes, s.w, this.scratch);
    if (maxSimilarity(r, this.rasters, thresh) >= thresh) return null;
    return this.take(s, r);
  }
}

/** Round coordinates and make sure the box width covers the ink. */
export function tidy(s: Shape): Shape {
  const strokes = roundStrokes(s.strokes.map((st) => ({ ...st, pts: st.pts.map((p) => [p[0], p[1]] as [number, number]) })));
  const bb = strokesBBox(strokes);
  let w = s.w;
  if (bb.x1 > w + 0.02 && !s.exit) w = Math.round(bb.x1 * 1000) / 1000;
  const out: Shape = { strokes, w: Math.round(w * 1000) / 1000 };
  if (s.h !== undefined) out.h = s.h;
  if (s.entry) out.entry = [Math.round(s.entry[0] * 1000) / 1000, Math.round(s.entry[1] * 1000) / 1000];
  if (s.exit) out.exit = [Math.round(s.exit[0] * 1000) / 1000, Math.round(s.exit[1] * 1000) / 1000];
  return out;
}

export function shapeComplexity(s: Shape): number {
  return complexity(s.strokes);
}
