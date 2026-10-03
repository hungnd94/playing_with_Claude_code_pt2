/**
 * Marks and modifications: combining signs (vowel signs, pointing, length,
 * virama), diacritics fused into new letters (Ž from Z), Ethiopic-style vowel
 * modifications applied to a consonant's shape, and syllabics rotations.
 */
import type { Rng } from "../core/rng";
import type { DiacriticKind, Family, MarkPos, Stroke, VowelOp } from "./types";
import { cloneStrokes, dot, endpoints, line, poly, sampleRaw, smooth, strokesBBox, transformStrokes, type BBox, type P, mul, translate, rotate, scale, type Mat, circle } from "./geom";
import type { Shape } from "./families";

// ---------------------------------------------------------------------------
// Diacritic shapes (local frame: anchor at (0,0); "above" shapes extend up)
// ---------------------------------------------------------------------------

/** Diacritic strokes drawn above an anchor at (0,0) (negative y). */
export function diacriticAbove(kind: DiacriticKind): Stroke[] {
  switch (kind) {
    case "dot":
      return [dot(0, -0.07, 0.055)];
    case "dots2":
      return [dot(-0.085, -0.07, 0.05), dot(0.085, -0.07, 0.05)];
    case "dots3":
      return [dot(-0.085, -0.05, 0.048), dot(0.085, -0.05, 0.048), dot(0, -0.17, 0.048)];
    case "bar":
      return [line(-0.16, -0.07, 0.16, -0.07)];
    case "stroke":
      return [line(-0.07, -0.02, 0.09, -0.2)];
    case "hook":
      return [smooth([[-0.1, -0.02], [-0.07, -0.16], [0.06, -0.19], [0.1, -0.08]])];
    case "ring":
      return [circle(0, -0.1, 0.07)];
    case "caron":
      return [poly([[-0.12, -0.18], [0, -0.04], [0.12, -0.18]])];
    case "tick":
      return [line(0, -0.02, 0, -0.2)];
    case "tilde":
      return [smooth([[-0.16, -0.05], [-0.08, -0.14], [0.08, -0.04], [0.16, -0.13]])];
    case "dotBelow":
      return [dot(0, 0.07, 0.055)];
    case "hookBelow":
      return [smooth([[0, 0.0], [0.08, 0.1], [0, 0.2], [-0.08, 0.17]])];
  }
}

export function flipToBelow(strokes: Stroke[]): Stroke[] {
  return transformStrokes(strokes, [1, 0, 0, -1, 0, 0]);
}

/** Which diacritics suit a family (most preferred first). */
export function familyDiacritics(rng: Rng, family: Family): DiacriticKind[] {
  const base: Record<Family, DiacriticKind[]> = {
    stave: ["tick", "stroke", "dot", "bar"],
    geometric: ["dot", "dots2", "bar", "ring", "dots3"],
    hanging: ["dotBelow", "dot", "hook", "stroke", "bar"],
    round: ["ring", "hook", "dot", "tilde", "dots2"],
    square: ["dot", "tick", "stroke", "dots2", "bar"],
    cursive: ["dot", "dots2", "dots3", "dotBelow", "stroke"],
    wedge: ["tick", "stroke", "dot"],
    linear: ["dot", "bar", "dots2", "ring", "caron"],
    tally: ["dot", "tick", "bar"],
    featural: ["dot", "tick", "bar", "dots2"],
    syllabic: ["dot", "ring", "bar", "dots2", "tick"],
  };
  const list = base[family].slice();
  // A little shuffle so sibling scripts differ.
  for (let i = 0; i < list.length - 1; i++) if (rng.chance(0.3)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
  return list;
}

/** Fuse a diacritic onto a glyph shape (a new derived letter). */
export function addDiacritic(shape: Shape, kind: DiacriticKind, where: "above" | "below" | "through" | "right" = "above"): Shape {
  const bb = strokesBBox(shape.strokes);
  const cx = (bb.x0 + bb.x1) / 2;
  let marks: Stroke[];
  if (kind === "dotBelow" || kind === "hookBelow") where = "below";
  if (where === "through") {
    // A bar through the main body (Đ, Ħ, Ł-like).
    const y = (Math.max(0, bb.y0) + Math.min(1, bb.y1)) / 2 - 0.05;
    const hit = horizontalHit(shape.strokes, y);
    const x = hit ?? cx;
    marks = [line(x - 0.17, y + 0.04, x + 0.17, y - 0.04)];
  } else if (where === "right") {
    marks = transformStrokes(diacriticAbove(kind === "dotBelow" ? "dot" : kind), translate(bb.x1 + 0.12, Math.max(0.28, bb.y0 + 0.28)));
  } else if (where === "below") {
    const k: DiacriticKind = kind === "hookBelow" || kind === "dotBelow" ? kind : kind;
    const up = k === "dotBelow" || k === "hookBelow" ? diacriticAbove(k) : flipToBelow(diacriticAbove(k));
    marks = transformStrokes(up, translate(cx, Math.max(1, bb.y1) + 0.1));
  } else {
    marks = transformStrokes(diacriticAbove(kind), translate(cx, Math.min(0, bb.y0) - 0.08));
  }
  return { ...shape, strokes: [...cloneStrokes(shape.strokes), ...marks] };
}

/** x where a horizontal line at y crosses the glyph's ink (closest to the middle). */
function horizontalHit(strokes: Stroke[], y: number): number | null {
  let best: number | null = null;
  let bd = Infinity;
  const bb = strokesBBox(strokes);
  const cx = (bb.x0 + bb.x1) / 2;
  for (const st of strokes) {
    if (st.dot !== undefined) continue;
    const xy = sampleRaw(st, 0.02).xy;
    for (let i = 2; i < xy.length; i += 2) {
      const y0 = xy[i - 1];
      const y1 = xy[i + 1];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
        const t = (y - y0) / (y1 - y0);
        const x = xy[i - 2] + (xy[i] - xy[i - 2]) * t;
        const d = Math.abs(x - cx);
        if (d < bd) {
          bd = d;
          best = x;
        }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Differentiators: systematic shape relations inside a script
// ---------------------------------------------------------------------------

export type Differentiator = "dotIn" | "dotOut" | "bar" | "tick" | "loop" | "double" | "hookEnd" | "dotsOut";

/** Family-appropriate differentiators, most preferred first. */
export function familyDifferentiators(rng: Rng, family: Family): Differentiator[] {
  const base: Record<Family, Differentiator[]> = {
    stave: ["tick", "bar", "hookEnd"],
    geometric: ["dotIn", "dotOut", "bar", "dotsOut"],
    hanging: ["dotOut", "tick", "loop", "bar"],
    round: ["loop", "dotIn", "hookEnd", "tick"],
    square: ["dotIn", "tick", "bar", "hookEnd"],
    cursive: ["dotOut", "dotsOut", "dotIn"],
    wedge: ["tick", "bar"],
    linear: ["dotsOut", "bar", "tick", "dotIn"],
    tally: ["tick"],
    featural: ["bar", "tick", "dotOut"],
    syllabic: ["bar", "tick", "hookEnd"],
  };
  const list = base[family].slice();
  if (rng.chance(0.5) && list.length > 1) [list[0], list[1]] = [list[1], list[0]];
  return list;
}

/** Apply a differentiator to a shape, producing a visibly related new glyph. */
export function differentiate(shape: Shape, d: Differentiator, rng: Rng): Shape {
  const s = cloneStrokes(shape.strokes);
  const bb = strokesBBox(s);
  const cx = (bb.x0 + bb.x1) / 2;
  const ends = endpoints(s);
  switch (d) {
    case "dotIn":
      s.push(dot(cx + (rng.next() - 0.5) * 0.05, (Math.max(0, bb.y0) + Math.min(1, bb.y1)) / 2 + 0.05, 0.055));
      break;
    case "dotOut":
      s.push(dot(cx, Math.min(0, bb.y0) - 0.18, 0.055));
      break;
    case "dotsOut":
      s.push(dot(cx - 0.07, Math.min(0, bb.y0) - 0.18, 0.05), dot(cx + 0.07, Math.min(0, bb.y0) - 0.18, 0.05));
      break;
    case "bar": {
      const y = (Math.max(0, bb.y0) + Math.min(1, bb.y1)) / 2;
      const x = horizontalHit(s, y) ?? cx;
      s.push(line(x - 0.15, y + 0.05, x + 0.15, y - 0.05));
      break;
    }
    case "tick": {
      // A short tick off the top-most endpoint (or the top of the glyph).
      const e = ends.length ? ends.reduce((a, b) => (b.p[1] < a.p[1] ? b : a)) : null;
      if (e) s.push(line(e.p[0], e.p[1], e.p[0] + 0.14, e.p[1] - 0.12));
      else s.push(line(cx, bb.y0, cx + 0.12, bb.y0 - 0.15));
      break;
    }
    case "hookEnd": {
      const e = ends.length ? ends.reduce((a, b) => (b.p[1] > a.p[1] ? b : a)) : null;
      if (e) {
        const [x, y] = e.p;
        s.push(smooth([[x, y], [x + 0.06, y + 0.1], [x + 0.17, y + 0.06]]));
      } else s.push(dot(cx, bb.y1 + 0.15, 0.055));
      break;
    }
    case "loop": {
      const e = ends.length ? ends[rng.int(0, ends.length - 1)] : null;
      if (e) {
        const [x, y] = e.p;
        const r = 0.075;
        s.push(circle(x + e.dir[0] * r, y + e.dir[1] * r, r));
      } else s.push(circle(cx, bb.y0 - 0.12, 0.07));
      break;
    }
    case "double": {
      const off = transformStrokes(s, translate(0.16, 0));
      return { ...shape, strokes: [...s, ...off], w: shape.w + 0.16 };
    }
  }
  return { ...shape, strokes: s };
}

// ---------------------------------------------------------------------------
// Ethiopic-style vowel modifications (fused abugida)
// ---------------------------------------------------------------------------

export const VOWEL_OPS: VowelOp[] = [
  "tickRight",
  "footRight",
  "ring",
  "stem",
  "tickLeft",
  "footLeft",
  "ringTop",
  "barTop",
  "dotRight",
  "hookBottom",
  "loopLeft",
  "kink",
];

function bottomEnds(s: Stroke[]): { p: P; dir: P }[] {
  return endpoints(s).filter((e) => e.p[1] > 0.6);
}

/** Apply vowel modifications to a consonant base, Ethiopic style. */
export function applyVowelOps(shape: Shape, ops: VowelOp[]): Shape {
  let s = cloneStrokes(shape.strokes);
  let w = shape.w;
  for (const op of ops) {
    const bb = strokesBBox(s);
    const be = bottomEnds(s);
    const right = be.length ? be.reduce((a, b) => (b.p[0] > a.p[0] ? b : a)) : null;
    const left = be.length ? be.reduce((a, b) => (b.p[0] < a.p[0] ? b : a)) : null;
    const midY = (Math.max(0, bb.y0) + Math.min(1, bb.y1)) / 2;
    switch (op) {
      case "none":
        break;
      case "tickRight": {
        const x = rightmostAt(s, midY) ?? bb.x1;
        s.push(line(x, midY, x + 0.26, midY));
        w = Math.max(w, x + 0.26);
        break;
      }
      case "tickLeft": {
        const x = leftmostAt(s, midY) ?? bb.x0;
        s.push(line(x, midY, x - 0.24, midY));
        break;
      }
      case "footRight": {
        if (right) s.push(poly([[right.p[0], right.p[1]], [right.p[0] + 0.24, right.p[1]]]));
        else s.push(line(bb.x1 - 0.05, bb.y1, bb.x1 + 0.15, bb.y1));
        break;
      }
      case "footLeft": {
        if (left) s.push(line(left.p[0], left.p[1], left.p[0] - 0.24, left.p[1]));
        else s.push(line(bb.x0 + 0.05, bb.y1, bb.x0 - 0.15, bb.y1));
        break;
      }
      case "ring": {
        const e = right ?? { p: [bb.x1, bb.y1] as P, dir: [0, 1] as P };
        const r = 0.1;
        s.push(circle(e.p[0] + r * 0.95, e.p[1] + r * 0.2, r));
        break;
      }
      case "ringTop": {
        s.push(circle(bb.x1 + 0.06, bb.y0 + 0.04, 0.1));
        break;
      }
      case "stem": {
        if (right) {
          s.push(line(right.p[0], right.p[1], right.p[0] + right.dir[0] * 0.02, right.p[1] + 0.34));
        } else s.push(line(bb.x1, bb.y1 - 0.1, bb.x1, bb.y1 + 0.24));
        break;
      }
      case "barTop": {
        s.push(line(bb.x0 + 0.05, bb.y0 - 0.17, bb.x1 - 0.05, bb.y0 - 0.17));
        break;
      }
      case "dotRight": {
        s.push(dot(bb.x1 + 0.15, midY, 0.07));
        w = Math.max(w, bb.x1 + 0.22);
        break;
      }
      case "hookBottom": {
        const e = left ?? right;
        if (e) s.push(smooth([[e.p[0], e.p[1]], [e.p[0] - 0.06, e.p[1] + 0.16], [e.p[0] + 0.14, e.p[1] + 0.2]]));
        else s.push(smooth([[bb.x0, bb.y1], [bb.x0 + 0.1, bb.y1 + 0.15], [bb.x0 + 0.22, bb.y1 + 0.05]]));
        break;
      }
      case "loopLeft": {
        const x = leftmostAt(s, midY) ?? bb.x0;
        s.push(circle(x - 0.1, midY, 0.1));
        break;
      }
      case "kink": {
        // Bend the lowest-left leg outward.
        const e = left ?? right;
        if (e) s.push(line(e.p[0], e.p[1], e.p[0] - 0.16, e.p[1] - 0.2));
        else s.push(line(bb.x0, bb.y1, bb.x0 - 0.1, bb.y1 - 0.14));
        break;
      }
    }
  }
  s = s.map((x) => x);
  return { ...shape, strokes: s, w };
}

function extremeAt(strokes: Stroke[], y: number, sign: number): number | null {
  let best: number | null = null;
  for (const st of strokes) {
    if (st.dot !== undefined) continue;
    const xy = sampleRaw(st, 0.02).xy;
    for (let i = 0; i < xy.length; i += 2) {
      if (Math.abs(xy[i + 1] - y) < 0.06) {
        if (best === null || xy[i] * sign > best * sign) best = xy[i];
      }
    }
  }
  return best;
}

const rightmostAt = (s: Stroke[], y: number): number | null => extremeAt(s, y, 1);
const leftmostAt = (s: Stroke[], y: number): number | null => extremeAt(s, y, -1);

// ---------------------------------------------------------------------------
// Syllabics orientations (Canadian-style abugida)
// ---------------------------------------------------------------------------

/**
 * Orientation transforms for a shape in a W×1 box: 0 identity, 1 rot180,
 * 2 rot90 cw, 3 rot90 ccw, 4 mirror-x, 5 mirror-y, 6 mirror+rot90, 7 mirror+rot270.
 */
export function orient(shape: Shape, code: number): Shape {
  const bb = strokesBBox(shape.strokes);
  const cx = (bb.x0 + bb.x1) / 2;
  const cy = (bb.y0 + bb.y1) / 2;
  let m: Mat = translate(-cx, -cy);
  const rot = (a: number): void => {
    m = mul(rotate(a), m);
  };
  const mir = (): void => {
    m = mul(scale(-1, 1), m);
  };
  switch (code) {
    case 1:
      rot(Math.PI);
      break;
    case 2:
      rot(Math.PI / 2);
      break;
    case 3:
      rot(-Math.PI / 2);
      break;
    case 4:
      mir();
      break;
    case 5:
      m = mul(scale(1, -1), m);
      break;
    case 6:
      mir();
      rot(Math.PI / 2);
      break;
    case 7:
      mir();
      rot(-Math.PI / 2);
      break;
  }
  const t = transformStrokes(shape.strokes, m);
  const nb = strokesBBox(t);
  const w = nb.x1 - nb.x0;
  const h = nb.y1 - nb.y0;
  // Re-seat in a box: bottom on the baseline, left at 0.
  const s = transformStrokes(t, translate(-nb.x0, 1 - nb.y1 + (h < 1 ? -(1 - h) / 2 : 0)));
  return { strokes: s, w: Math.max(0.3, w) };
}

/** Bounding box helper re-exported for callers. */
export function bbox(strokes: Stroke[]): BBox {
  return strokesBBox(strokes);
}

// ---------------------------------------------------------------------------
// Brahmic vowel signs for headline scripts
// ---------------------------------------------------------------------------

/**
 * A Brahmic-style vowel sign chosen by vowel features: pre-base i with an arc
 * over the letter, post-base stems for ā, ī, o, strokes rising from the
 * headline for e/ai, hooks below for u/ū. `n` picks an alternative when the
 * natural slot is taken. Returns null when nothing natural fits.
 */
export function brahmicSign(v: { height: number; back: number; round: boolean; long: boolean }, n: number): { pos: MarkPos; strokes: Stroke[]; w: number; key: string } | null {
  const stem = line(0.1, 0, 0.1, 1);
  const rise = (x: number): Stroke => smooth([[x + 0.06, 0], [x - 0.06, -0.17], [x - 0.22, -0.3]]);
  const front = v.back === 0;
  const backR = v.back === 2 && v.round;
  const open = v.height >= 5;
  const cands: { pos: MarkPos; strokes: Stroke[]; w: number; key: string }[] = [];
  if (front && v.height <= 1) {
    if (!v.long) cands.push({ pos: "before", key: "i", w: 0.24, strokes: [line(0.12, 0, 0.12, 1), smooth([[0.12, 0], [0.24, -0.27], [0.62, -0.33], [0.88, -0.06]])] });
    cands.push({ pos: "after", key: "ii", w: 0.24, strokes: [stem, smooth([[0.1, 0], [0.0, -0.27], [-0.4, -0.33], [-0.62, -0.06]])] });
  }
  if (front && v.height >= 2 && v.height <= 3) cands.push({ pos: "above", key: "e", w: 0, strokes: [rise(0)] });
  if (front && v.height >= 4) cands.push({ pos: "above", key: "ai", w: 0, strokes: [rise(-0.06), rise(0.12)] });
  if (backR && v.height <= 1) {
    cands.push({ pos: "below", key: v.long ? "uu" : "u", w: 0, strokes: [v.long ? smooth([[0, 0], [0.14, 0.13], [0.0, 0.26], [-0.13, 0.18]]) : smooth([[0, 0], [-0.13, 0.12], [0.02, 0.25], [0.15, 0.16]])] });
    cands.push({ pos: "below", key: "uu2", w: 0, strokes: [smooth([[0, 0], [0.04, 0.16], [0.2, 0.22]]), smooth([[-0.04, 0.08], [0.0, 0.26], [0.18, 0.32]])] });
  }
  if (backR && v.height >= 2 && v.height <= 3) cands.push({ pos: "after", key: "o", w: 0.24, strokes: [stem, rise(0.1)] });
  if (backR && v.height >= 4) cands.push({ pos: "after", key: "au", w: 0.24, strokes: [stem, rise(0.02), rise(0.2)] });
  if (open || (v.long && !front && !backR)) cands.push({ pos: "after", key: "aa", w: 0.24, strokes: [stem] });
  if (v.back === 1 && !open) {
    cands.push({ pos: "above", key: "candra", w: 0, strokes: [smooth([[-0.17, -0.18], [-0.1, -0.06], [0.1, -0.06], [0.17, -0.18]]), dot(0, -0.25, 0.05)] });
    cands.push({ pos: "below", key: "tick", w: 0, strokes: [line(-0.12, 0.05, 0.1, 0.2)] });
  }
  if (v.back === 2 && !v.round) cands.push({ pos: "after", key: "aw", w: 0.3, strokes: [smooth([[0.06, 0.15], [0.26, 0.32], [0.06, 0.55]]), smooth([[0.06, 0.5], [0.26, 0.68], [0.06, 0.92]])] });
  return cands[n] ?? null;
}

// ---------------------------------------------------------------------------
// Combining marks (vowel signs, pointing, virama, length)
// ---------------------------------------------------------------------------

export interface MarkShape {
  strokes: Stroke[];
  pos: MarkPos;
  w: number;
}

/**
 * Generate a combining mark shape for a position. Above/below marks are in
 * an anchor frame (anchor (0,0), above marks extend upward); before/after
 * marks are spacing glyphs in a normal box.
 */
export function genMark(rng: Rng, pos: MarkPos, family: Family, variant: number, headline: boolean): MarkShape {
  if (pos === "above" || pos === "below") {
    const kinds: DiacriticKind[] =
      family === "hanging"
        ? ["stroke", "hook", "bar", "dot", "caron", "tilde", "ring", "dots2"]
        : family === "round"
          ? ["hook", "ring", "tilde", "dot", "stroke", "caron", "dots2", "bar"]
          : family === "cursive"
            ? ["stroke", "dot", "hook", "dots2", "ring", "bar", "caron", "tilde"]
            : ["dot", "bar", "stroke", "dots2", "caron", "hook", "ring", "tilde", "dots3", "tick"];
    const k = kinds[variant % kinds.length];
    let st = diacriticAbove(k);
    if (variant >= kinds.length) st = [...st, ...transformStrokes(st, translate(0.13, -0.05))];
    if (pos === "below") st = flipToBelow(st);
    return { strokes: st, pos, w: 0 };
  }
  if (pos === "after") {
    // Spacing vowel signs: Brahmic-like vertical stems, or small hooks/loops.
    const top = headline ? 0 : 0.1;
    const shapes: Stroke[][] = headline
      ? [
          [line(0.1, top, 0.1, 1)],
          [line(0.1, top, 0.1, 1), smooth([[0.1, top], [0.02, -0.25], [-0.25, -0.3]])],
          [line(0.1, top, 0.1, 1), dot(0.3, 0.45, 0.055)],
          [smooth([[0.04, 0.18], [0.3, 0.3], [0.08, 0.58]]), smooth([[0.04, 0.55], [0.3, 0.68], [0.08, 0.98]])],
          [line(0.1, top, 0.1, 1), line(0.1, 0.5, 0.28, 0.5)],
        ]
      : [
          [smooth([[0.05, 0.25], [0.28, 0.45], [0.05, 0.9]])],
          [circle(0.16, 0.6, 0.12)],
          [line(0.1, 0.1, 0.1, 1)],
          [smooth([[0.05, 0.9], [0.25, 0.65], [0.08, 0.35], [0.24, 0.12]])],
          [line(0.06, 0.2, 0.25, 0.5), line(0.25, 0.5, 0.06, 0.8)],
          [circle(0.15, 0.82, 0.1), line(0.15, 0.72, 0.15, 0.15)],
        ];
    const st = shapes[variant % shapes.length];
    const bb = strokesBBox(st);
    return { strokes: st, pos, w: Math.max(0.22, bb.x1 + 0.08) };
  }
  if (pos === "before") {
    const shapes: Stroke[][] = headline
      ? [
          [line(0.12, 0, 0.12, 1), smooth([[0.12, 0], [0.3, -0.3], [0.75, -0.32], [0.95, -0.05]])],
          [smooth([[0.25, 0.1], [0.05, 0.45], [0.25, 0.9]])],
        ]
      : [
          [smooth([[0.25, 0.1], [0.05, 0.45], [0.25, 0.9]])],
          [circle(0.15, 0.5, 0.12)],
          [smooth([[0.25, 0.25], [0.05, 0.25], [0.05, 0.75], [0.25, 0.75]])],
        ];
    const st = shapes[variant % shapes.length];
    const bb = strokesBBox(st);
    return { strokes: st, pos, w: Math.max(0.22, bb.x1 + 0.06) };
  }
  // right / left / inside: small spacing mark
  return { strokes: [dot(0.1, 0.5, 0.05)], pos, w: 0.2 };
}
