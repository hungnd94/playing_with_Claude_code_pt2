/**
 * Glyph factory: produces mutually distinguishable, legible glyph shapes from
 * a script's design family, and registers derived shapes so later glyphs
 * keep their distance from them too.
 */
import type { Rng } from "../core/rng";
import type { Family, ScriptStyle, Stroke } from "./types";
import { genGlyph, type GenCtx, type Shape } from "./families";
import { rasterize, maxSimilarity, overlapFraction, type Raster } from "./raster";
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

  similarityTo(shape: Shape): number {
    return maxSimilarity(rasterize(shape.strokes, shape.w), this.rasters);
  }

  /** A fresh glyph from the family grammar, rejecting look-alikes and tangles. */
  fresh(maxTries = 14, gen?: (rng: Rng) => Shape): Shape {
    maxTries = Math.min(this.rasters.length > 50 ? 16 : 26, maxTries + Math.floor(this.rasters.length / 3));
    let best: Shape | null = null;
    let bestScore = Infinity;
    let bestR: Raster | null = null;
    for (let t = 0; t < maxTries; t++) {
      const s = gen ? gen(this.rng) : genGlyph(this.family, this.rng, this.ctx);
      if (!s.strokes.length) continue;
      const r = rasterize(s.strokes, s.w);
      // Cheap test first (early exit above the threshold), tangles only for survivors.
      const sim = maxSimilarity(r, this.rasters, this.thresh);
      if (sim < this.thresh) {
        const tangle = overlapFraction(s.strokes);
        if (tangle < 0.3) {
          this.rasters.push(r);
          return tidy(s);
        }
        if (tangle > 0.42) continue;
        const score = sim + tangle * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = s;
          bestR = r;
        }
      } else if (sim + 0.15 < bestScore) {
        bestScore = sim + 0.15;
        best = s;
        bestR = r;
      }
    }
    if (!best) {
      best = gen ? gen(this.rng) : genGlyph(this.family, this.rng, this.ctx);
      bestR = rasterize(best.strokes, best.w);
    }
    // Rescue a look-alike with the script's own differentiators (dots, bars, ticks…).
    if (maxSimilarity(bestR!, this.rasters, this.thresh) >= this.thresh) {
      for (const d of this.rescue) {
        const c = differentiate(best, d, this.rng);
        const r = rasterize(c.strokes, c.w);
        if (maxSimilarity(r, this.rasters, this.thresh) < this.thresh) {
          this.rasters.push(r);
          return tidy(c);
        }
      }
      for (const d of this.rescue) {
        const c = differentiate(differentiate(best, d, this.rng), this.rescue[(this.rescue.indexOf(d) + 1) % this.rescue.length], this.rng);
        const r = rasterize(c.strokes, c.w);
        if (maxSimilarity(r, this.rasters, this.thresh) < this.thresh) {
          this.rasters.push(r);
          return tidy(c);
        }
      }
      // Last resort: fresh candidates, each with a differentiator.
      for (let k = 0; k < 20; k++) {
        const g0 = gen ? gen(this.rng) : genGlyph(this.family, this.rng, this.ctx);
        const c = k % 2 ? g0 : differentiate(g0, this.rescue[k % this.rescue.length], this.rng);
        const r = rasterize(c.strokes, c.w);
        if (maxSimilarity(r, this.rasters, this.thresh) < this.thresh) {
          this.rasters.push(r);
          return tidy(c);
        }
      }
    }
    this.rasters.push(bestR!);
    return tidy(best);
  }

  /** Accept a candidate only if distinct enough; returns null otherwise. */
  tryAccept(s: Shape, thresh = this.thresh): Shape | null {
    const r = rasterize(s.strokes, s.w);
    if (maxSimilarity(r, this.rasters, thresh) >= thresh) return null;
    this.rasters.push(r);
    return tidy(s);
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
