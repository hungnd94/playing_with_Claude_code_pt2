/**
 * Builders for the families whose glyphs encode phonetics structurally:
 * featural (Hangul-like), syllabics (Canadian-like rotations), tally
 * (Ogham-like notch groups) and cursive rasm groups (Arabic-like shared
 * skeletons told apart by dots).
 */
import type { Rng } from "../core/rng";
import type { Stroke } from "./types";
import { classify, phonDistance, type PlaceGroup } from "./ipa";
import { circle, dot, line, poly, smooth, transformStrokes, strokesBBox, type P } from "./geom";
import { COMPONENT_SHAPES, cursiveSkeleton, addDots, CURSIVE_SKELETONS, fitStrokes, type CursiveSkel, type GenCtx, type Shape } from "./families";
import { GlyphFactory } from "./factory";
import { orient } from "./marks";

// ---------------------------------------------------------------------------
// Featural (Hangul-like)
// ---------------------------------------------------------------------------

const GROUPS: PlaceGroup[] = ["labial", "coronal", "sibilant", "dorsal", "laryngeal", "liquid", "glide"];

export interface FeaturalDesign {
  /** Component shape name per place group. */
  base: Record<string, string>;
  /** Stroke added for each feature step. */
  featureOrder: string[];
}

export function featuralDesign(rng: Rng): FeaturalDesign {
  const names = rng.shuffle(Object.keys(COMPONENT_SHAPES).filter((n) => n !== "ess" && n !== "bowlStem"));
  // Hangul-ish defaults get a boost so it reads as a system.
  const base: Record<string, string> = {};
  GROUPS.forEach((g, i) => (base[g] = names[i % names.length]));
  if (rng.chance(0.5)) base.laryngeal = "ring";
  if (base.labial === "ring" && base.laryngeal === "ring") base.labial = "box";
  const featureOrder = rng.shuffle(["topBar", "innerTick", "sideDot", "slash", "topTick"]);
  return { base, featureOrder };
}

/** Basic manner per group (letters with no extra strokes). */
function basicManner(g: PlaceGroup): string[] {
  switch (g) {
    case "labial":
    case "coronal":
      return ["nasal"];
    case "dorsal":
      return ["stop", "nasal"];
    case "sibilant":
      return ["fricative"];
    case "laryngeal":
      return ["stop", "fricative"];
    case "liquid":
      return ["lateral", "trill", "tap", "approximant"];
    case "glide":
      return ["approximant"];
  }
}

function featureStroke(kind: string, k: number): Stroke[] {
  // Component occupies x∈[0.12,0.88], y∈[0.3,0.95] inside a 1×1 box.
  switch (kind) {
    case "topBar":
      return [line(0.12, 0.12 + k * 0.1, 0.88, 0.12 + k * 0.1)];
    case "innerTick":
      return [line(0.5, 0.48 + k * 0.08, 0.5, 0.76 + k * 0.05)];
    case "sideDot":
      return [dot(0.98, 0.25 + k * 0.2, 0.055)];
    case "slash":
      // a short stroke springing from the lower right, like a tail
      return [line(0.8 - k * 0.12, 0.95, 1.0 - k * 0.12, 0.66)];
    case "topTick":
      return [line(0.5 - k * 0.1, 0.0, 0.5 - k * 0.1, 0.24)];
  }
  return [];
}

/** A featural consonant: place-group base + one stroke per departure from the group's basic manner. */
export function featuralConsonant(design: FeaturalDesign, ph: string): Shape {
  const info = classify(ph);
  const g = info.group;
  const baseName = design.base[g] ?? "box";
  let strokes = fitStrokes(COMPONENT_SHAPES[baseName](), 0.14, 0.32, 0.86, 0.95);
  const feats: string[] = [];
  const basic = basicManner(g);
  if (!basic.includes(info.manner)) {
    // manner step: stop/affricate get a bar, fricatives a slash, etc.
    if (info.manner === "stop" || info.manner === "implosive" || info.manner === "click") feats.push(design.featureOrder[0]);
    else if (info.manner === "affricate") feats.push(design.featureOrder[0], design.featureOrder[4]);
    else if (info.manner === "fricative" || info.manner === "lateralFricative") feats.push(design.featureOrder[3]);
    else if (info.manner === "nasal") feats.push(design.featureOrder[4]);
    else feats.push(design.featureOrder[1]);
  }
  if (info.voiced && !["nasal", "lateral", "trill", "tap", "approximant"].includes(info.manner)) feats.push(design.featureOrder[2]);
  // subdivisions inside groups (e.g. velar vs uvular, dental vs alveolar vs retroflex)
  if (info.place === "uvular" || info.place === "retroflex" || info.place === "pharyngeal" || info.place === "labiodental")
    feats.push(design.featureOrder[1]);
  if (info.place === "postalveolar" || info.place === "palatal") feats.push("topTick");
  for (const s of info.secondary) {
    if (s === "aspirated") feats.push(design.featureOrder[0]);
    else if (s === "ejective" || s === "long") {
      // doubled component (tense consonants)
      const half = fitStrokes(strokes, 0.06, 0.32, 0.46, 0.95);
      const half2 = fitStrokes(strokes, 0.54, 0.32, 0.94, 0.95);
      strokes = [...half, ...half2];
    } else feats.push("sideDot");
  }
  const count: Record<string, number> = {};
  for (const f of feats) {
    const k = count[f] ?? 0;
    count[f] = k + 1;
    strokes.push(...featureStroke(f, k));
  }
  return { strokes, w: 1 };
}

/**
 * Featural vowels.
 *  Style 0 (Hangul-like): a long stroke, vertical if unrounded and horizontal
 *    if rounded, with 1–n short ticks on the front/back side counting height.
 *  Style 2: the same system with dots instead of ticks (as Middle Korean
 *    wrote its vowels with dots).
 *  Style 1 (hooked stems): the stem's orientation shows rounding, a hook at
 *    its head (front) or foot (back) shows backness, crossbars count openness.
 */
export function featuralVowels(vowels: string[], style = 0): Map<string, Shape> {
  if (style === 1) return hookVowels(vowels);
  const dots = style === 2;
  const out = new Map<string, Shape>();
  // Group by (round, back) and rank by height to get tick counts.
  const classes = new Map<string, string[]>();
  for (const v of vowels) {
    const i = classify(v);
    const key = `${i.round ? 1 : 0}${i.back}`;
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key)!.push(v);
  }
  for (const [key, list] of classes) {
    // unique base qualities
    const bases = [...new Set(list.map((v) => classify(v).base))].sort((a, b) => classify(a).height - classify(b).height);
    for (const v of list) {
      const i = classify(v);
      const rank = bases.indexOf(i.base);
      const round = key[0] === "1";
      const back = +key[1];
      const st: Stroke[] = [];
      // front/back vowels: 1..n ticks on one side; central: 0 = bare line, then crossing ticks
      const side = back === 0 ? 1 : back === 2 ? -1 : 0;
      const n = side === 0 ? rank : rank + 1;
      if (!round) {
        st.push(line(0.5, 0.0, 0.5, 1.0));
        for (let t = 0; t < n; t++) {
          const y = 0.5 + (t - (n - 1) / 2) * 0.24;
          if (dots) st.push(dot(side === 0 ? 0.3 : 0.5 + side * 0.2, y, 0.06));
          else if (side === 0) st.push(line(0.3, y, 0.7, y));
          else st.push(line(0.5, y, 0.5 + side * 0.32, y));
        }
      } else {
        st.push(line(0.0, 0.62, 1.0, 0.62));
        for (let t = 0; t < n; t++) {
          const x = 0.5 + (t - (n - 1) / 2) * 0.26;
          if (dots) st.push(dot(x, side === 0 ? 0.8 : 0.62 - side * 0.2, 0.06));
          else if (side === 0) st.push(line(x, 0.44, x, 0.8));
          else st.push(line(x, 0.62, x, 0.62 - side * 0.3));
        }
      }
      if (i.secondary.includes("long")) st.push(round ? line(0.1, 0.92, 0.9, 0.92) : line(0.85, 0.15, 0.85, 0.85));
      if (i.secondary.includes("nasal")) st.push(smooth([[0.62, 0.95], [0.75, 0.85], [0.88, 0.95]]));
      out.set(v, { strokes: st, w: 1 });
    }
  }
  return out;
}

function hookVowels(vowels: string[]): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const v of vowels) {
    const i = classify(v);
    const st: Stroke[] = [];
    const bars = i.height <= 1 ? 0 : i.height <= 3 ? 1 : 2;
    if (!i.round) {
      // Vertical stem; front: hook at the head turning right; back: foot turning left.
      const pts: P[] = [];
      if (i.back === 0) pts.push([0.78, 0.12], [0.62, 0.0], [0.45, 0.12]);
      pts.push([0.45, i.back === 0 ? 0.3 : 0.0], [0.45, i.back === 2 ? 0.7 : 1.0]);
      if (i.back === 2) pts.push([0.45, 0.88], [0.3, 1.0], [0.14, 0.9]);
      st.push(smooth(pts));
      for (let b = 0; b < bars; b++) st.push(line(0.25, 0.42 + b * 0.2, 0.65, 0.42 + b * 0.2));
      if (i.back === 1) st.push(dot(0.72, 0.5, 0.06));
    } else {
      // Horizontal stem; front: hook rising at the right end; back: hook falling at the left.
      const pts: P[] = [];
      if (i.back === 2) pts.push([0.1, 0.85], [0.0, 0.7], [0.12, 0.6]);
      pts.push([i.back === 2 ? 0.2 : 0.0, 0.6], [i.back === 0 ? 0.8 : 1.0, 0.6]);
      if (i.back === 0) pts.push([0.9, 0.6], [1.0, 0.48], [0.9, 0.35]);
      st.push(smooth(pts));
      for (let b = 0; b < bars; b++) st.push(line(0.4 + b * 0.2, 0.42, 0.4 + b * 0.2, 0.78));
      if (i.back === 1) st.push(dot(0.5, 0.3, 0.06));
    }
    if (i.secondary.includes("long")) st.push(i.round ? line(0.15, 0.95, 0.85, 0.95) : line(0.9, 0.2, 0.9, 0.8));
    if (i.secondary.includes("nasal")) st.push(smooth([[0.12, 0.0], [0.25, -0.08], [0.38, 0.0]]));
    out.set(v, { strokes: st, w: 1 });
  }
  return out;
}

/** Is a vowel glyph "vertical" (consonants go to its left) or "horizontal" (consonants above)? */
export function vowelIsVertical(shape: Shape): boolean {
  const bb = strokesBBox(shape.strokes);
  return bb.y1 - bb.y0 > bb.x1 - bb.x0;
}

// ---------------------------------------------------------------------------
// Syllabics (Canadian-like)
// ---------------------------------------------------------------------------

const SYLLABIC_BASES: (() => Stroke[])[] = [
  () => [poly([[0, 0], [0.5, 1], [1, 0]])], // V
  () => [poly([[0, 0], [0, 1], [1, 1], [1, 0]])], // U
  () => [smooth([[1, 0], [1, 0.7], [0.5, 1], [0, 0.7]])], // J
  () => [poly([[1, 0], [0, 0], [0, 1]]), circle(0.62, 0.62, 0.2)], // corner + ring
  () => [poly([[0, 0], [0, 1], [1, 1]]), line(0.5, 1, 0.5, 0.45)],
  () => [smooth([[0, 1], [0, 0.35], [0.5, 0], [1, 0.35], [1, 1]])], // ∩
  () => [smooth([[0.2, 1], [0.2, 0.2], [0.55, 0], [0.9, 0.2], [0.9, 0.5]])],
  () => [smooth([[0.1, 0], [0.9, 0.25], [0.1, 0.5], [0.9, 0.75], [0.1, 1]])], // zig
  () => [line(0.2, 0, 0.2, 1), circle(0.6, 0.72, 0.28)], // stem + ring
  () => [poly([[0, 0], [1, 0.5], [0, 1]])], // >
  () => [smooth([[1, 0.05], [0.25, 0.1], [0.05, 0.5], [0.25, 0.9], [1, 0.95]])], // C
  () => [poly([[0, 0], [1, 0], [1, 1]]), line(0.35, 0, 0.35, 0.55)],
  () => [line(0.5, 0, 0.5, 1), smooth([[0.5, 0], [1, 0.25], [0.5, 0.5]])], // P
  () => [smooth([[0, 1], [0, 0.3], [0.45, 0.05], [0.9, 0.3]]), dot(0.75, 0.75, 0.07)], // hook + dot
  () => [smooth([[0, 0], [0, 0.65], [0.5, 1], [1, 0.65], [1, 0]]), line(0.5, 1, 0.5, 0.3)],
  () => [poly([[0, 0], [0.5, 1], [1, 0]]), circle(0.5, 0.12, 0.12)],
];

/** Orientation codes for up to 8 vowels (Canadian style: 4 rotations, then mirrors). */
export const ORIENT_ORDER = [3, 2, 0, 1, 4, 5, 6, 7];

/**
 * Generate consonant base shapes whose orientations are all mutually distinct.
 * Returns shapes in order (first = vowel-only series).
 */
export function syllabicBases(rng: Rng, factory: GlyphFactory, count: number, nOrient: number, W: number): Shape[] {
  const out: Shape[] = [];
  const pool = rng.shuffle(SYLLABIC_BASES.map((f, i) => i));
  let k = 0;
  // the vowel series: a triangle (like ᐁ ᐃ ᐅ ᐊ)
  const tri: Shape = { strokes: [poly([[0, 0], [W, 0], [W / 2, 1]], undefined, true)], w: W };
  const candidates: (() => Shape)[] = [() => tri];
  for (const i of pool) candidates.push(() => ({ strokes: fitStrokes(SYLLABIC_BASES[i](), 0, 0, W, 1), w: W }));
  // variants: add a dot / small ring / bar to base shapes when we run out
  const variants = (s: Shape, v: number): Shape => {
    const extra: Stroke[] = v % 3 === 0 ? [dot(W * 0.5, 0.5, 0.06)] : v % 3 === 1 ? [line(W * 0.2, 0.5, W * 0.8, 0.5)] : [circle(W * 0.85, 0.15, 0.08)];
    return { strokes: [...s.strokes, ...extra], w: W };
  };
  let v = 0;
  while (out.length < count && k < 400) {
    let shape: Shape;
    if (k < candidates.length) shape = candidates[k]();
    else {
      shape = variants(candidates[1 + ((k - candidates.length) % (candidates.length - 1))](), v++);
    }
    k++;
    const forms = ORIENT_ORDER.slice(0, nOrient).map((c) => orient(shape, c));
    // all orientations must be distinct from each other and from existing glyphs
    const local = new GlyphFactory(rng, "syllabic", factory.ctx, factory.style);
    local.thresh = 0.9;
    let ok = true;
    for (const f of forms) {
      if (factory.similarityTo(f) > 0.88 || !local.tryAccept(f)) {
        ok = false;
        break;
      }
    }
    if (!ok && out.length > 0 && k < 200) continue;
    for (const f of forms) factory.register(f);
    out.push(shape);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tally (Ogham-like)
// ---------------------------------------------------------------------------

/** Ogham-like letters: groups of 1–5 strokes in four positions relative to the stem line (y = 0.5). */
export function tallyShapes(n: number, p: Record<string, number>, rng: Rng): Shape[] {
  const out: Shape[] = [];
  const sp = p.spacing ?? 0.15;
  const groups = ["above", "below", "diag", "across"];
  for (let g = 0; g < 4 && out.length < n; g++) {
    for (let k = 1; k <= 5 && out.length < n; k++) {
      const st: Stroke[] = [];
      for (let i = 0; i < k; i++) {
        const x = 0.1 + i * sp;
        switch (groups[g]) {
          case "above":
            st.push(line(x, 0.5, x, 0.02));
            break;
          case "below":
            st.push(line(x, 0.5, x, 0.98));
            break;
          case "diag":
            st.push(line(x - 0.12, 0.92, x + 0.12, 0.08));
            break;
          case "across":
            st.push(line(x, 0.12, x, 0.88));
            break;
        }
      }
      out.push({ strokes: st, w: 0.2 + (k - 1) * sp });
    }
  }
  // Extra letters (forfeda): distinct figures on the stem.
  const extras: (() => Stroke[])[] = [
    () => [line(0.05, 0.12, 0.55, 0.88), line(0.55, 0.12, 0.05, 0.88)],
    () => [poly([[0.3, 0.1], [0.55, 0.5], [0.3, 0.9], [0.05, 0.5]], undefined, true)],
    () => [line(0.1, 0.15, 0.1, 0.85), line(0.4, 0.15, 0.4, 0.85), line(0.0, 0.3, 0.5, 0.3), line(0.0, 0.7, 0.5, 0.7)],
    () => [smooth([[0.3, 0.5], [0.45, 0.35], [0.3, 0.2], [0.1, 0.35], [0.1, 0.65], [0.35, 0.82], [0.58, 0.6]])],
    () => [poly([[0.05, 0.1], [0.55, 0.1], [0.05, 0.9], [0.55, 0.9]])],
    () => [circle(0.3, 0.5, 0.22)],
    () => [poly([[0.05, 0.1], [0.3, 0.5], [0.55, 0.1]]), poly([[0.05, 0.9], [0.3, 0.5], [0.55, 0.9]])],
    () => [line(0.3, 0.05, 0.3, 0.95), line(0.05, 0.25, 0.55, 0.75)],
  ];
  let e = 0;
  while (out.length < n) {
    const base = extras[e % extras.length]();
    const rep = Math.floor(e / extras.length);
    const st = rep ? [...base, ...Array.from({ length: rep }, (_, i) => dot(0.65 + i * 0.12, 0.5, 0.05))] : base;
    out.push({ strokes: st, w: 0.6 + rep * 0.12 });
    e++;
  }
  void rng;
  return out;
}

/** Vowel notches for tally scripts: 1–5 short strokes across the stem, or dots. */
export function tallyVowels(n: number, notch: boolean): Shape[] {
  const out: Shape[] = [];
  for (let k = 1; k <= n; k++) {
    const st: Stroke[] = [];
    const m = ((k - 1) % 5) + 1;
    const extra = Math.floor((k - 1) / 5);
    for (let i = 0; i < m; i++) {
      const x = 0.08 + i * 0.13;
      // Notches must clearly cross the stem line (drawn over them at the same weight).
      st.push(notch ? dot(x, 0.5, 0.065) : line(x, 0.27, x, 0.73));
    }
    for (let i = 0; i < extra; i++) st.push(circle(0.08 + m * 0.13 + 0.05 + i * 0.2, 0.5, 0.08));
    out.push({ strokes: st, w: 0.12 + m * 0.13 + extra * 0.2 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cursive rasm groups
// ---------------------------------------------------------------------------

/**
 * Assign cursive skeletons + dot patterns to phonemes. Phonetically similar
 * consonants share a skeleton and differ by dots (like Arabic ب ت ث).
 */
export function cursiveAssign(rng: Rng, phonemes: string[], ctx: GenCtx, factory: GlyphFactory): Map<string, Shape> {
  const out = new Map<string, Shape>();
  const remaining = phonemes.slice();
  const groups: string[][] = [];
  const maxGroup = rng.int(2, 3);
  while (remaining.length) {
    const head = remaining.shift()!;
    const g = [head];
    // greedily gather near neighbours
    remaining.sort((a, b) => phonDistance(head, a) - phonDistance(head, b));
    while (g.length < maxGroup && remaining.length && phonDistance(head, remaining[0]) < 1.6 && rng.chance(ctx.p.dotRate)) g.push(remaining.shift()!);
    groups.push(g);
  }
  const skels = rng.shuffle(CURSIVE_SKELETONS.slice()) as CursiveSkel[];
  // Vowel-ish letters prefer alif/waw/ya-like skeletons.
  const patterns = ["", "a1", "b1", "a2", "b2", "a3", "b3", "i1"];
  let si = 0;
  for (const g of groups) {
    let base: Shape | null = null;
    let tries = 0;
    let kind: CursiveSkel = skels[si % skels.length];
    while (tries < skels.length) {
      kind = skels[(si + tries) % skels.length];
      const cand = cursiveSkeleton(kind, rng, ctx);
      // skeleton variety once the pool is exhausted: jitter width
      if (si >= skels.length) cand.w *= rng.range(0.85, 1.25);
      if (factory.similarityTo(cand) < 0.97 || si >= skels.length) {
        base = cand;
        break;
      }
      tries++;
    }
    si++;
    if (!base) base = cursiveSkeleton(kind, rng, ctx);
    const pats = rng.shuffle(patterns.slice(1));
    const order = g.length === 1 ? [rng.chance(0.5) ? "" : pats[0]] : [rng.chance(0.6) ? "" : pats[pats.length - 1], ...pats];
    g.forEach((ph, i) => {
      const s = addDots(base!, order[i] ?? pats[i], ctx.p.tooth);
      factory.register(s);
      out.set(ph, s);
    });
  }
  return out;
}

/**
 * Rotate a horizontal (rtl) cursive shape 90° counter-clockwise for vertical
 * writing (as Old Uyghur became Mongolian): the baseline becomes a spine at
 * x = 1, entry at the top, exit at the bottom; the advance becomes `h`.
 */
export function rotateShapeCCW(s: Shape): Shape {
  const W = s.w;
  const m: [number, number, number, number, number, number] = [0, -1, 1, 0, 0, W];
  const out: Shape = { strokes: transformStrokes(s.strokes, m), w: 1, h: W };
  const tp = (p: [number, number]): [number, number] => [p[1], W - p[0]];
  if (s.entry) out.entry = tp(s.entry);
  if (s.exit) out.exit = tp(s.exit);
  return out;
}
