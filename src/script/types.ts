/**
 * Data contracts for procedural writing systems.
 *
 * Everything here is plain JSON (no classes, no typed arrays, no Maps) so a
 * Script created in the generation worker can be posted to the UI thread and
 * rendered there.
 *
 * Coordinate conventions for glyph skeletons ("glyph space"):
 *   x grows to the right, y grows DOWN (SVG convention).
 *   The body ("x-height") of a glyph spans y ∈ [0, 1]; the baseline is y = 1.
 *   Ascenders reach up to y ≈ -0.45, descenders down to y ≈ 1.45.
 *   A horizontal glyph occupies x ∈ [0, w]. Vertical (ttb) glyphs may have a
 *   box height `h` ≠ 1 which is then their advance.
 */

/** An inventory as produced by the language engine. Phonemes are IPA strings. */
export interface Inventory {
  consonants: string[];
  vowels: string[];
}

export type ScriptKind = "alphabet" | "abjad" | "abugida" | "syllabary" | "featural";
export const SCRIPT_KINDS: readonly ScriptKind[] = ["alphabet", "abjad", "abugida", "syllabary", "featural"];

export type Direction = "ltr" | "rtl" | "ttb";

/** The implement the script is (traditionally) written with. It drives both rendering and glyph evolution. */
export type Tool =
  | "brush" // pointed brush: pressure swell, tapered exits
  | "pen" // broad-nib pen / quill: thick-thin by nib angle, slanted terminals
  | "reed" // reed pen: broad nib with soft, rounded edges, lower contrast
  | "stylus" // stylus pressed into clay: wedge impressions
  | "chisel" // chisel on stone: even strokes, flared terminals
  | "knife" // knife on wood/bark: straight tapered cuts, no curves, avoids horizontals
  | "needle"; // metal stylus on palm leaf: thin monoline, round loopy forms
export const TOOLS: readonly Tool[] = ["brush", "pen", "reed", "stylus", "chisel", "knife", "needle"];

/**
 * Glyph "design families": the structural grammar new glyphs are built from.
 * Each is a cluster of tendencies seen in real script families.
 */
export type Family =
  | "stave" // runic: vertical staves with diagonal branches
  | "geometric" // Tifinagh / South Arabian: circles, squares, crosses, dots
  | "hanging" // Brahmic: bodies hanging from a headline, right stems, bowls & loops
  | "round" // Javanese / Burmese / Georgian: arcs, loops and curls
  | "square" // Hebrew / Aramaic: bars, legs and corners, heavy horizontals
  | "cursive" // Arabic / Syriac / Mongolian: joined on a baseline, teeth, bowls, dots
  | "wedge" // cuneiform: clusters of wedge impressions
  | "linear" // Linear B / Cypriot / Vai: composite emblematic signs on an axis
  | "tally" // Ogham: groups of notches along a stem line
  | "featural" // Hangul: shapes encode place of articulation, strokes add features
  | "syllabic"; // Canadian syllabics: simple shapes rotated to mark the vowel
export const FAMILIES: readonly Family[] = [
  "stave",
  "geometric",
  "hanging",
  "round",
  "square",
  "cursive",
  "wedge",
  "linear",
  "tally",
  "featural",
  "syllabic",
];

/**
 * A pen stroke: a centreline through nodes. Segment i runs from pts[i] to
 * pts[i+1] (or back to pts[0] for the closing segment of a closed stroke) and
 * is straight when bend[i] is 0, otherwise a circular arc whose sagitta is
 * bend[i] × chord length (positive bulges to the left of the direction of
 * travel as seen on screen; ±0.5 is a semicircle).
 */
export interface Stroke {
  pts: [number, number][];
  bend?: number[];
  closed?: boolean;
  /** Smooth stroke: a Catmull–Rom spline through the nodes (bends ignored). */
  smooth?: 1;
  /** Node indices that stay sharp corners in a smooth stroke. */
  sharp?: number[];
  /** If set, this stroke is a dot of the given radius at pts[0]. */
  dot?: number;
  /** Width multiplier (connectors and marks may be lighter). */
  w?: number;
}

/** Where a combining mark sits relative to its base. */
export type MarkPos = "above" | "below" | "before" | "after" | "inside" | "right" | "left";

export type GlyphRole =
  | "consonant" // consonant letter (alphabet/abjad/abugida base)
  | "vowel" // vowel letter (alphabet) or independent vowel (abugida/syllabary)
  | "syllable" // syllabary sign
  | "mark" // combining sign (vowel sign, diacritic, virama, length mark…)
  | "final" // syllabics-style coda sign
  | "sign"; // anything else (word divider)

export type GlyphOrigin =
  | "invented" // created from nothing by the script's grammar
  | "inherited" // copied unchanged from the parent script
  | "mutated" // inherited and reshaped
  | "derived" // new letter made from an existing one (diacritic, extra stroke…)
  | "repurposed"; // inherited shape given a different sound (e.g. Greek vowels from Phoenician)

export interface Glyph {
  /** Unique within the script; inherited glyphs keep their parent's id. */
  id: number;
  role: GlyphRole;
  /** Primary sound value as IPA (syllables like "ka"; marks like "◌u"). */
  sound: string;
  strokes: Stroke[];
  /** Box width (em). */
  w: number;
  /** Box height when not 1 (vertical cursive scripts); the ttb advance. */
  h?: number;
  /** Cursive join points in glyph space. */
  entry?: [number, number];
  exit?: [number, number];
  /** Combining marks: placement relative to the base. */
  mark?: MarkPos;
  /** Id of the glyph in the parent script this one descends from. */
  anc?: number;
  /** Lineage key: `${scriptId}#${glyphId}` of the earliest ancestor. */
  root: string;
  origin: GlyphOrigin;
  /** Short human-readable note on how the glyph arose ("from k + dot"). */
  note?: string;
}

export interface ScriptStyle {
  tool: Tool;
  /** Nib / brush / chisel width in em (body height = 1). */
  weight: number;
  /** 0 = monoline … 1 = hairline thin strokes. */
  contrast: number;
  /** Broad-nib angle, radians, measured counter-clockwise from the x axis as seen on screen. */
  nibAngle: number;
  /** 0 = sharp angular corners … 1 = everything rounded. */
  cornering: number;
  /** Horizontal shear: positive leans right. */
  slant: number;
  /** Typical glyph box width (em). */
  width: number;
  /** Terminal flare / serif amount 0..1. */
  serif: number;
  /** Brush/knife exit taper 0..1. */
  taper: number;
  /** Hand irregularity 0..1 (per-glyph wobble in words). */
  jitter: number;
  /** Letter spacing (em). */
  spacing: number;
  /** A continuous headline across each word (Devanagari shirorekha). */
  headline: boolean;
  /** Letters join along the baseline (Arabic, Syriac, Mongolian). */
  joins: boolean;
  /** Letters hang on a continuous stem line (Ogham). */
  stemline: boolean;
  /** Word divider shown between words. */
  separator: "space" | "dot" | "colon" | "bar";
}

/** Generation DNA: which grammar new glyphs come from, with its parameters. */
export interface Morphology {
  family: Family;
  /** Numeric family parameters (tendencies, proportions). */
  p: Record<string, number>;
  /** Seed for the family's motif pool (reusable parts shared by many glyphs). */
  seed: string;
  /** Preferred diacritic shapes when deriving new letters, most preferred first. */
  diacritics: DiacriticKind[];
}

export type DiacriticKind =
  | "dot"
  | "dots2"
  | "dots3"
  | "bar"
  | "stroke"
  | "hook"
  | "ring"
  | "caron"
  | "tick"
  | "tilde"
  | "dotBelow"
  | "hookBelow";

/** Abugida vowel modification applied directly to a consonant's shape (Ethiopic style). */
export type VowelOp =
  | "none"
  | "tickRight"
  | "tickLeft"
  | "footRight"
  | "footLeft"
  | "ring"
  | "ringTop"
  | "stem"
  | "barTop"
  | "dotRight"
  | "hookBottom"
  | "loopLeft"
  | "kink";

export interface Orthography {
  /** Phoneme → letter glyph id. */
  letters: Record<string, number>;
  /** Phoneme → [base phoneme, mark glyph id]: written as the base plus a combining mark. */
  marked: Record<string, [string, number]>;
  /** Phoneme → sequence of phonemes whose spellings are concatenated (digraphs). */
  digraphs: Record<string, string[]>;
  /** Abugida vowel signs / abjad pointing: vowel → mark glyph id (-1 = inherent, unwritten). */
  vowelSigns: Record<string, number>;
  /**
   * Abugida fused vowel modifications (vowelMode "fused"): vowel → op(s); the
   * key "" is the vowelless (killed) form. Syllabics (vowelMode "rotate") use
   * it for vowels written as an orientation plus a mark.
   */
  vowelOps: Record<string, VowelOp[]>;
  /**
   * Irregular forms: `${glyphId}|${vowel}` → op(s) replacing `vowelOps[vowel]`
   * for that consonant, where the regular modification would be illegible on
   * its shape (as Ethiopic has irregular ሙ, ሉ…). Absent in older scripts.
   */
  vowelOpsFor?: Record<string, VowelOp[]>;
  /** Abugida rotations (vowelMode "rotate"): vowel → orientation code 0..7. */
  rotations: Record<string, number>;
  /** Syllabary: `${C}|${V}` (C may be "") → glyph id. */
  syllables: Record<string, number>;
  /** Abjad: long-vowel → consonant letter used as mater lectionis. */
  matres: Record<string, number>;
  /** Abugida/syllabics: consonant → coda (final) glyph id. */
  finals: Record<string, number>;
  /** Abugida inherent vowel (unwritten after a consonant). */
  inherent?: string;
  /** Vowel-killer mark (abugida/featural codas) or -1. */
  virama: number;
  /** Seat for word-initial vowels in pointed abjads / abugidas (glottal letter), or -1. */
  carrier: number;
  /** Abugida vowel representation. */
  vowelMode: "sign" | "fused" | "rotate" | "none";
  /** Consonant clusters in abugidas: explicit virama or stacked conjuncts. */
  conjuncts: "virama" | "stack";
  /** Abjad short-vowel pointing. */
  pointing: boolean;
  /** Syllabaries: what to do with a consonant not followed by a vowel. */
  coda: "echo" | "drop" | "final";
}

export interface Script {
  id: string;
  /** Parent script id (null for an invented script). */
  parent: string | null;
  bornYear: number;
  /** Depth in its family tree (0 = invented). */
  generation: number;
  kind: ScriptKind;
  direction: Direction;
  style: ScriptStyle;
  morph: Morphology;
  glyphs: Glyph[];
  /** Traditional letter order (glyph ids) used for charts. */
  order: number[];
  ortho: Orthography;
  /** The phonemes the script was designed or adapted for. */
  sounds: string[];
  /** The inventory the script was designed or adapted for. */
  inventory: Inventory;
  /** Next free glyph id (descendants continue numbering). */
  nextId: number;
  /** Human-readable notes on what happened at this step (for encyclopedia text). */
  history: string[];
}

/** A glyph-shaped thing to draw: strokes in glyph space plus box. */
export interface Form {
  strokes: Stroke[];
  w: number;
  h: number;
  entry?: [number, number];
  exit?: [number, number];
}
