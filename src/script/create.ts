/**
 * Inventing a writing system for a language from scratch.
 */
import type { Rng } from "../core/rng";
import type {
  DiacriticKind,
  Direction,
  Family,
  Glyph,
  GlyphRole,
  Inventory,
  Orthography,
  Script,
  ScriptKind,
  Stroke,
  Tool,
  VowelOp,
} from "./types";
import { classify, commonness, phonDistance, phoneticOrderKey, type Secondary } from "./ipa";
import { familyParams, fitStrokes, type GenCtx, type Shape } from "./families";
import { FAMILY_TOOLS, KIND_FAMILIES, randomStyle } from "./style";
import { GlyphFactory, shapeComplexity, tidy } from "./factory";
import {
  addDiacritic,
  diacriticAbove,
  differentiate,
  familyDiacritics,
  familyDifferentiators,
  flipToBelow,
  genMark,
  brahmicSign,
  VOWEL_OPS,
  type Differentiator,
} from "./marks";
import { cursiveAssign, featuralConsonant, featuralDesign, featuralVowels, syllabicBases, tallyShapes, tallyVowels, ORIENT_ORDER } from "./special";
import { line, strokesBBox, transformStrokes } from "./geom";
import { rasterize, similarity } from "./raster";

export interface CreateOptions {
  id?: string;
  bornYear?: number;
  kind?: ScriptKind;
  family?: Family;
  tool?: Tool;
  direction?: Direction;
}

export const FEATURE_ORDER: Secondary[] = [
  "aspirated",
  "ejective",
  "nasal",
  "long",
  "labialized",
  "palatalized",
  "pharyngealized",
  "prenasalized",
  "breathy",
  "voiceless",
  "syllabic",
];

const FEATURE_CHARS: Record<Secondary, string[]> = {
  long: ["ː", ":"],
  nasal: ["̃"],
  aspirated: ["ʰ"],
  labialized: ["ʷ"],
  palatalized: ["ʲ"],
  ejective: ["ʼ", "'"],
  pharyngealized: ["ˤ", "̴"],
  prenasalized: ["ⁿ", "ᵐ", "ᵑ"],
  breathy: ["ʱ", "̤"],
  voiceless: ["̥", "̊"],
  syllabic: ["̩", "̍"],
};

const FEATURE_LABEL: Record<Secondary, string> = {
  long: "ː",
  nasal: "̃",
  aspirated: "ʰ",
  labialized: "ʷ",
  palatalized: "ʲ",
  ejective: "ʼ",
  pharyngealized: "ˤ",
  prenasalized: "ⁿ",
  breathy: "ʱ",
  voiceless: "̥",
  syllabic: "̩",
};

/** Remove one secondary articulation from a phoneme string. */
export function stripFeature(ph: string, f: Secondary): string {
  const s = ph.normalize("NFD");
  let out = s;
  for (const c of FEATURE_CHARS[f]) out = out.split(c).join("");
  const chars = [...out];
  if (out === s) {
    if (f === "long" && chars.length === 2 && chars[0] === chars[1]) return chars[0];
    if (f === "prenasalized" && chars.length >= 2 && "mnŋ".includes(chars[0])) return chars.slice(1).join("").normalize("NFC");
  }
  return out.normalize("NFC");
}

export type Treatment = "letter" | "derived" | "mark" | "digraph";

export function markLabel(f: Secondary): string {
  return "◌" + FEATURE_LABEL[f];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface Builder {
  rng: Rng;
  script: Script;
  factory: GlyphFactory;
  ctx: GenCtx;
  treat: Partial<Record<Secondary, Treatment>>;
  featureMarks: Map<Secondary, number>;
  featureDiac: Map<Secondary, DiacriticKind>;
  diffs: Differentiator[];
  /** Probability that a consonant's letter is derived from a related consonant's letter. */
  systematic: number;
}

export function emptyOrtho(): Orthography {
  return {
    letters: {},
    marked: {},
    digraphs: {},
    vowelSigns: {},
    vowelOps: {},
    rotations: {},
    syllables: {},
    matres: {},
    finals: {},
    virama: -1,
    carrier: -1,
    vowelMode: "none",
    conjuncts: "virama",
    pointing: false,
    coda: "echo",
  };
}

export function addGlyph(b: Builder, shape: Shape, role: GlyphRole, sound: string, extra: Partial<Glyph> = {}): number {
  const s = b.script;
  const id = s.nextId++;
  const t = tidy(shape);
  const g: Glyph = { id, role, sound, strokes: t.strokes, w: t.w, root: `${s.id}#${id}`, origin: "invented", ...extra };
  if (t.h !== undefined) g.h = t.h;
  if (t.entry) g.entry = t.entry;
  if (t.exit) g.exit = t.exit;
  s.glyphs.push(g);
  return id;
}

export function glyphById(s: Script, id: number): Glyph | undefined {
  for (const g of s.glyphs) if (g.id === id) return g;
  return undefined;
}

export function shapeOf(g: Glyph): Shape {
  const s: Shape = { strokes: g.strokes, w: g.w };
  if (g.h !== undefined) s.h = g.h;
  if (g.entry) s.entry = g.entry;
  if (g.exit) s.exit = g.exit;
  return s;
}

/** A combining mark glyph for a secondary feature (created on demand). */
export function featureMark(b: Builder, f: Secondary): number {
  const have = b.featureMarks.get(f);
  if (have !== undefined) return have;
  const kinds = b.script.morph.diacritics;
  const used = new Set([...b.featureMarks.keys()].map((k) => b.featureDiac.get(k)));
  let k = kinds.find((d) => !used.has(d)) ?? kinds[b.featureMarks.size % kinds.length];
  if (k === "dotBelow" || k === "hookBelow") k = "dot";
  const below = f === "aspirated" || f === "breathy" || f === "voiceless" || f === "pharyngealized";
  const strokes = below ? flipToBelow(diacriticAbove(k)) : diacriticAbove(k);
  b.featureDiac.set(f, k);
  const id = addGlyph(b, { strokes, w: 0 }, "mark", markLabel(f), { mark: below ? "below" : "above" });
  b.featureMarks.set(f, id);
  return id;
}

function diacFor(b: Builder, f: Secondary): DiacriticKind {
  const have = b.featureDiac.get(f);
  if (have) return have;
  const kinds = b.script.morph.diacritics;
  const used = new Set(b.featureDiac.values());
  const k = kinds.find((d) => !used.has(d)) ?? kinds[b.featureDiac.size % kinds.length];
  b.featureDiac.set(f, k);
  return k;
}

function chooseTreatments(rng: Rng, kind: ScriptKind): Partial<Record<Secondary, Treatment>> {
  const w = <T extends string>(pairs: [T, number][]): T => rng.weighted(pairs);
  const t: Partial<Record<Secondary, Treatment>> = {};
  t.long = w<Treatment>(
    kind === "abugida"
      ? [["letter", 0.65], ["mark", 0.35]]
      : [["mark", 0.3], ["digraph", 0.3], ["letter", 0.2], ["derived", 0.2]],
  );
  t.nasal = w<Treatment>([["mark", 0.6], ["derived", 0.2], ["letter", 0.2]]);
  t.aspirated = w<Treatment>([["letter", 0.45], ["derived", 0.25], ["digraph", 0.2], ["mark", 0.1]]);
  t.ejective = w<Treatment>([["letter", 0.5], ["derived", 0.3], ["mark", 0.2]]);
  t.labialized = w<Treatment>([["digraph", 0.5], ["derived", 0.25], ["mark", 0.25]]);
  t.palatalized = w<Treatment>([["digraph", 0.45], ["derived", 0.3], ["mark", 0.25]]);
  t.pharyngealized = w<Treatment>([["letter", 0.4], ["derived", 0.4], ["mark", 0.2]]);
  t.prenasalized = w<Treatment>([["digraph", 0.5], ["derived", 0.3], ["letter", 0.2]]);
  t.breathy = w<Treatment>([["digraph", 0.4], ["derived", 0.3], ["mark", 0.3]]);
  t.voiceless = w<Treatment>([["derived", 0.5], ["mark", 0.5]]);
  t.syllabic = w<Treatment>([["mark", 0.6], ["derived", 0.4]]);
  return t;
}

// ---------------------------------------------------------------------------
// Letter planning
// ---------------------------------------------------------------------------

export type Need =
  | { ph: string; how: "indep" }
  | { ph: string; how: "derived"; from: string; diac?: DiacriticKind; diff?: Differentiator; feature?: Secondary };

/** Decide how each phoneme gets written; returns letters to create (bases before derived). */
export function planLetters(b: Builder, phonemes: string[], systematic: boolean): Need[] {
  const o = b.script.ortho;
  const inv = new Set(phonemes);
  const needs = new Map<string, Need>();
  const order: string[] = [];
  const ensure = (ph: string, depth = 0): void => {
    if (needs.has(ph) || o.marked[ph] || o.digraphs[ph] || o.letters[ph] !== undefined || depth > 4) return;
    const info = classify(ph);
    const sec = FEATURE_ORDER.find((f) => info.secondary.includes(f));
    if (!sec) {
      needs.set(ph, { ph, how: "indep" });
      order.push(ph);
      return;
    }
    const base = stripFeature(ph, sec);
    if (base === ph || !base) {
      needs.set(ph, { ph, how: "indep" });
      order.push(ph);
      return;
    }
    let t = b.treat[sec] ?? "mark";
    let helper = "";
    if (t === "digraph") {
      helper =
        sec === "long"
          ? base
          : sec === "aspirated" || sec === "breathy"
            ? "h"
            : sec === "labialized"
              ? "w"
              : sec === "palatalized"
                ? "j"
                : sec === "prenasalized"
                  ? "n"
                  : "";
      if (!helper || (helper !== base && !inv.has(helper))) t = "mark";
    }
    switch (t) {
      case "letter":
        needs.set(ph, { ph, how: "indep" });
        order.push(ph);
        break;
      case "derived":
        ensure(base, depth + 1);
        needs.set(ph, { ph, how: "derived", from: base, diac: diacFor(b, sec), feature: sec });
        order.push(ph);
        break;
      case "mark":
        ensure(base, depth + 1);
        o.marked[ph] = [base, featureMark(b, sec)];
        break;
      case "digraph":
        ensure(base, depth + 1);
        if (helper !== base) ensure(helper, depth + 1);
        o.digraphs[ph] = helper === base ? [base, base] : [base, helper];
        break;
    }
  };
  const sorted = phonemes.slice().sort((a, b2) => classify(a).secondary.length - classify(b2).secondary.length);
  for (const ph of sorted) ensure(ph);
  // Systematic relations among plain consonants (voicing / manner pairs share a shape).
  if (systematic && b.systematic > 0) {
    const indep = order.filter((ph) => needs.get(ph)!.how === "indep" && !classify(ph).vowel && classify(ph).secondary.length === 0);
    const byCommon = indep.slice().sort((x, y) => commonness(y) - commonness(x));
    const chosen: string[] = [];
    for (const ph of byCommon) {
      const a = classify(ph);
      let partner: string | null = null;
      let rel = 0;
      for (const q of chosen) {
        const c = classify(q);
        const nq = needs.get(q)!;
        if (nq.how !== "indep") continue;
        if (c.place === a.place && c.manner === a.manner && c.voiced !== a.voiced) {
          partner = q;
          rel = 0;
          break;
        }
        if (c.place === a.place && c.voiced === a.voiced && c.manner !== a.manner && c.group === a.group) {
          partner = q;
          rel = 1;
        }
      }
      if (partner && b.rng.chance(b.systematic)) {
        needs.set(ph, { ph, how: "derived", from: partner, diff: b.diffs[rel % b.diffs.length] });
        // Move after partner in order.
        order.splice(order.indexOf(ph), 1);
        order.splice(order.indexOf(partner) + 1, 0, ph);
      } else chosen.push(ph);
    }
  }
  return order.map((ph) => needs.get(ph)!);
}

/** Create shapes for planned letters and register them in the orthography. */
export function realizeLetters(b: Builder, needs: Need[], role: "consonant" | "vowel", custom?: Map<string, Shape>): void {
  const o = b.script.ortho;
  const indep = needs.filter((n) => n.how === "indep").map((n) => n.ph);
  let shapes: Shape[] = [];
  const fam = b.script.morph.family;
  const assigned = new Map<string, Shape>();
  if (custom) {
    for (const ph of indep) {
      const s = custom.get(ph);
      if (s) assigned.set(ph, s);
    }
  }
  const missing = indep.filter((ph) => !assigned.has(ph));
  if (fam === "cursive" && missing.length) {
    const m = cursiveAssign(b.rng, missing, b.ctx, b.factory);
    for (const [ph, s] of m) assigned.set(ph, s);
  } else if (missing.length) {
    shapes = missing.map(() => b.factory.fresh());
    // Simpler shapes for commoner sounds.
    const bySimple = shapes.map((s, i) => ({ s, c: shapeComplexity(s) + b.rng.range(0, 0.6), i })).sort((x, y) => x.c - y.c);
    const byCommon = missing
      .map((ph) => ({ ph, c: commonness(ph) + b.rng.range(0, 0.5) }))
      .sort((x, y) => y.c - x.c);
    byCommon.forEach((x, i) => assigned.set(x.ph, bySimple[i].s));
  }
  for (const n of needs) {
    if (n.how === "indep") {
      const s = assigned.get(n.ph)!;
      o.letters[n.ph] = addGlyph(b, s, role === "vowel" || classify(n.ph).vowel ? "vowel" : "consonant", n.ph);
    } else {
      const baseId = o.letters[n.from];
      const base = baseId !== undefined ? b.script.glyphs.find((g) => g.id === baseId) : undefined;
      if (!base) {
        const s = b.factory.fresh();
        o.letters[n.ph] = addGlyph(b, s, classify(n.ph).vowel ? "vowel" : "consonant", n.ph);
        continue;
      }
      const s = deriveShape(b, base, n);
      o.letters[n.ph] = addGlyph(b, s, classify(n.ph).vowel ? "vowel" : "consonant", n.ph, {
        origin: "derived",
        note: `from ${base.sound}${n.diac ? ` with ${n.diac}` : n.diff ? ` with ${n.diff}` : ""}`,
      });
    }
  }
}

export function deriveShape(b: Builder, base: Glyph, n: Need & { how: "derived" }): Shape {
  const bs: Shape = shapeOf(base);
  const tries: (() => Shape)[] = [];
  if (n.diac) {
    const d = n.diac;
    tries.push(() => addDiacritic(bs, d, "above"));
    tries.push(() => addDiacritic(bs, d, "through"));
    tries.push(() => addDiacritic(bs, d, "below"));
    tries.push(() => addDiacritic(bs, d, "right"));
  }
  if (n.diff) {
    const d = n.diff;
    tries.push(() => differentiate(bs, d, b.rng));
  }
  for (const d of b.diffs) tries.push(() => differentiate(bs, d, b.rng));
  for (const k of b.script.morph.diacritics) tries.push(() => addDiacritic(bs, k, "above"));
  // Derived letters are meant to look related (Ž from Z): accept anything visibly different.
  for (const t of tries) {
    const s = t();
    const ok = b.factory.tryAccept(s, 0.972);
    if (ok) return ok;
  }
  const s = tries[0]();
  b.factory.register(s);
  return s;
}

// ---------------------------------------------------------------------------
// Kind-specific construction
// ---------------------------------------------------------------------------

export function uniq(a: string[]): string[] {
  return [...new Set(a)];
}

export function chooseInherent(vowels: string[]): string {
  const plain = vowels.filter((v) => classify(v).secondary.length === 0);
  const pool = plain.length ? plain : vowels;
  const pref = ["a", "ə", "ɐ", "ɑ", "ʌ", "o", "e", "ɔ", "ɛ"];
  for (const p of pref) if (pool.includes(p)) return p;
  return pool.slice().sort((x, y) => classify(y).height - classify(x).height)[0];
}

export function carrierFor(b: Builder): number {
  const o = b.script.ortho;
  for (const c of ["ʔ", "h", "ʕ", "ɦ"]) if (o.letters[c] !== undefined) return o.letters[c];
  // invent a seat
  const s = b.factory.fresh();
  return addGlyph(b, s, "consonant", "∅", { note: "vowel seat" });
}

function buildAlphabet(b: Builder, inv: Inventory): void {
  const needs = planLetters(b, uniq([...inv.consonants, ...inv.vowels]), true);
  if (b.script.morph.family === "tally") {
    const cons = needs.filter((n) => n.how === "indep" && !classify(n.ph).vowel);
    const vows = needs.filter((n) => n.how === "indep" && classify(n.ph).vowel);
    const consSorted = cons.map((n) => n.ph).sort((a, c) => phoneticOrderKey(a) - phoneticOrderKey(c));
    const vowSorted = vows.map((n) => n.ph).sort((a, c) => phoneticOrderKey(a) - phoneticOrderKey(c));
    const cs = tallyShapes(consSorted.length, b.script.morph.p, b.rng);
    const vs = tallyVowels(vowSorted.length, !!b.script.morph.p.notch);
    const custom = new Map<string, Shape>();
    consSorted.forEach((ph, i) => custom.set(ph, cs[i]));
    vowSorted.forEach((ph, i) => custom.set(ph, vs[i]));
    for (const s of custom.values()) b.factory.register(s);
    realizeLetters(b, needs, "consonant", custom);
    return;
  }
  realizeLetters(b, needs, "consonant");
}

function buildAbjad(b: Builder, inv: Inventory): void {
  const o = b.script.ortho;
  const needs = planLetters(b, uniq(inv.consonants), true);
  realizeLetters(b, needs, "consonant");
  o.carrier = carrierFor(b);
  o.pointing = b.rng.chance(0.45);
  // Vowel pointing: one mark per vowel quality; long vowels by matres lectionis where possible.
  const quals = uniq(inv.vowels.map((v) => stripAll(v)));
  let above = 0;
  let below = 0;
  for (const q of quals) {
    const i = classify(q);
    const pos = i.back === 2 && i.round ? "above" : i.back === 0 && i.height <= 2 ? "below" : b.rng.chance(0.6) ? "above" : "below";
    const ms = genMark(b.rng, pos, b.script.morph.family, pos === "above" ? above++ : below++, false);
    o.vowelSigns[q] = addGlyph(b, { strokes: ms.strokes, w: 0 }, "mark", "◌" + q, { mark: pos });
  }
  for (const v of inv.vowels) {
    if (o.vowelSigns[v] !== undefined) continue;
    const i = classify(v);
    if (i.secondary.includes("long")) {
      const mater =
        i.back === 0 && i.height <= 3 ? o.letters["j"] : i.back === 2 && i.round ? o.letters["w"] : (o.letters["ʔ"] ?? o.letters["h"]);
      if (mater !== undefined) o.matres[v] = mater;
    }
    // Pointing for compound vowels: base quality + feature marks.
    let cur = v;
    for (const f of FEATURE_ORDER) {
      if (!classify(cur).secondary.includes(f)) continue;
      const base = stripFeature(cur, f);
      if (base === cur) continue;
      o.marked[cur] = [base, featureMark(b, f)];
      cur = base;
    }
  }
}

/** Strip all secondary features from a phoneme. */
export function stripAll(ph: string): string {
  let cur = ph;
  for (const f of FEATURE_ORDER) if (classify(cur).secondary.includes(f)) cur = stripFeature(cur, f);
  return cur || ph;
}

function buildAbugida(b: Builder, inv: Inventory): void {
  const o = b.script.ortho;
  const fam = b.script.morph.family;
  const vowels = uniq(inv.vowels);
  o.inherent = chooseInherent(vowels);
  o.vowelMode = fam === "syllabic" ? "rotate" : fam === "geometric" || fam === "linear" ? (b.rng.chance(0.75) ? "fused" : "sign") : b.rng.chance(0.15) ? "fused" : "sign";
  // Which vowels get their own sign: plain qualities + those whose secondary is treated as "letter".
  const own: string[] = [];
  for (const v of vowels) {
    const i = classify(v);
    const sec = FEATURE_ORDER.find((f) => i.secondary.includes(f));
    if (!sec || b.treat[sec] === "letter" || stripFeature(v, sec) === v) own.push(v);
  }
  for (const v of vowels) {
    if (own.includes(v)) continue;
    // marked vowel: base + feature mark
    let cur = v;
    for (const f of FEATURE_ORDER) {
      if (!classify(cur).secondary.includes(f)) continue;
      const base = stripFeature(cur, f);
      if (base === cur) continue;
      o.marked[cur] = [base, featureMark(b, f)];
      cur = base;
    }
    if (!own.includes(cur)) own.push(cur);
  }
  const ownSorted = own.sort((x, y) => phoneticOrderKey(x) - phoneticOrderKey(y));

  if (o.vowelMode === "rotate") {
    const cons = uniq(inv.consonants);
    const plan = planLetters(b, cons, false);
    const indep = plan.filter((n) => n.how === "indep").map((n) => n.ph).sort((x, y) => phoneticOrderKey(x) - phoneticOrderKey(y));
    const nOrient = Math.min(8, ownSorted.length);
    const bases = syllabicBases(b.rng, b.factory, indep.length + 1, nOrient, b.ctx.W);
    o.carrier = addGlyph(b, bases[0], "vowel", "∅", { note: "vowel series" });
    const custom = new Map<string, Shape>();
    indep.forEach((ph, i) => custom.set(ph, bases[i + 1] ?? b.factory.fresh()));
    realizeLetters(b, plan, "consonant", custom);
    ownSorted.slice(0, 8).forEach((v, i) => (o.rotations[v] = ORIENT_ORDER[i]));
    // Vowels beyond 8 orientations: a dot above the nearest.
    for (const v of ownSorted.slice(8)) {
      const near = ownSorted.slice(0, 8).sort((x, y) => phonDistance(v, x) - phonDistance(v, y))[0];
      o.marked[v] = [near, featureMark(b, "syllabic")];
    }
    // Finals: small raised consonant shapes.
    for (const ph of cons) {
      const id = o.letters[ph];
      if (id === undefined) continue;
      const g = b.script.glyphs.find((x) => x.id === id)!;
      const fs = fitStrokes(g.strokes, 0, 0, Math.min(0.45, g.w * 0.45), 0.45, true);
      o.finals[ph] = addGlyph(b, { strokes: fs, w: Math.min(0.5, g.w * 0.5) }, "final", ph, { note: `final ${ph}` });
    }
    return;
  }

  // Consonants
  const plan = planLetters(b, uniq(inv.consonants), true);
  realizeLetters(b, plan, "consonant");

  if (o.vowelMode === "fused") {
    const ops = b.rng.shuffle(VOWEL_OPS.slice());
    let k = 0;
    for (const v of ownSorted) {
      if (v === o.inherent) {
        o.vowelOps[v] = [];
        continue;
      }
      const op: VowelOp[] = k < ops.length ? [ops[k]] : [ops[k % ops.length], ops[(k * 7 + 3) % ops.length]];
      k++;
      o.vowelOps[v] = op;
    }
    o.vowelOps[""] = [ops[k % ops.length] === "none" ? "kink" : ops[k % ops.length]];
    o.carrier = carrierFor(b);
    return;
  }

  // Sign mode (Brahmic): signs by position, independent vowel letters, virama.
  const headline = b.script.style.headline;
  const posCount: Record<string, number> = {};
  const usedKeys = new Set<string>();
  for (const v of ownSorted) {
    if (v === o.inherent) {
      o.vowelSigns[v] = -1;
      continue;
    }
    const i = classify(v);
    const long = i.secondary.includes("long");
    if (headline) {
      let sign = null;
      for (let k = 0; k < 4; k++) {
        const c = brahmicSign({ height: i.height, back: i.back, round: i.round, long }, k);
        if (c && !usedKeys.has(c.key)) {
          sign = c;
          break;
        }
      }
      if (sign) {
        usedKeys.add(sign.key);
        o.vowelSigns[v] = addGlyph(b, { strokes: sign.strokes, w: sign.w }, "mark", "◌" + v, { mark: sign.pos });
        continue;
      }
    }
    let pos: "above" | "below" | "before" | "after";
    if (i.height >= 5 || (long && i.back !== 0 && !i.round)) pos = "after";
    else if (i.back === 0 && i.height <= 1) pos = b.rng.chance(0.6) ? "before" : "above";
    else if (i.back === 0) pos = "above";
    else if (i.round && i.height <= 1) pos = "below";
    else if (i.round) pos = b.rng.chance(0.5) ? "after" : "above";
    else pos = b.rng.chance(0.5) ? "above" : "below";
    const n = posCount[pos] ?? 0;
    posCount[pos] = n + 1;
    const ms = genMark(b.rng, pos, b.script.morph.family, n + (long ? 1 : 0), headline);
    o.vowelSigns[v] = addGlyph(b, { strokes: ms.strokes, w: ms.w }, "mark", "◌" + v, { mark: pos });
  }
  // Independent vowels
  const vneeds: Need[] = ownSorted.map((v) => ({ ph: v, how: "indep" as const }));
  realizeLetters(b, vneeds, "vowel");
  // Virama
  const vk: Stroke[] = headline ? [line(-0.06, 0.08, 0.1, 0.24)] : [line(-0.1, 0.06, 0.1, 0.2)];
  o.virama = addGlyph(b, { strokes: vk, w: 0 }, "mark", "◌̸", { mark: "below", note: "vowel killer" });
  o.conjuncts = b.rng.chance(0.3) ? "stack" : "virama";
  o.carrier = o.letters["ʔ"] ?? -1;
}

function buildSyllabary(b: Builder, inv: Inventory): void {
  const o = b.script.ortho;
  const rng = b.rng;
  const vowels = uniq(inv.vowels);
  const quals = uniq(vowels.map((v) => stripAll(v))).sort((x, y) => phoneticOrderKey(x) - phoneticOrderKey(y));
  for (const v of vowels) {
    if (quals.includes(v)) continue;
    let cur = v;
    for (const f of FEATURE_ORDER) {
      if (!classify(cur).secondary.includes(f)) continue;
      const base = stripFeature(cur, f);
      if (base === cur) continue;
      if (f === "long" && rng.chance(0.5)) o.digraphs[cur] = [base, base];
      else o.marked[cur] = [base, featureMark(b, f)];
      cur = base;
    }
  }
  // Consonant series with merging to keep the sign count plausible.
  const cons = uniq(inv.consonants);
  const rep = new Map<string, string>(); // consonant → representative series
  const voicing: "distinct" | "diacritic" | "merge" = rng.weighted([
    ["distinct", 0.5],
    ["diacritic", 0.3],
    ["merge", 0.2],
  ]);
  for (const c of cons) rep.set(c, c);
  // Secondary features → base series (+ mark) or merge.
  for (const c of cons) {
    const i = classify(c);
    const sec = FEATURE_ORDER.find((f) => i.secondary.includes(f));
    if (!sec) continue;
    const base = stripFeature(c, sec);
    if (base === c) continue;
    if (!cons.includes(base)) continue;
    if (rng.chance(0.6)) o.marked[c] = [base, featureMark(b, sec)];
    rep.set(c, base);
  }
  const countSeries = (): number => new Set([...rep.entries()].filter(([c, r]) => c === r).map(([c]) => c)).size;
  const maxSigns = 96;
  const mergeVoicing = (mode: "diacritic" | "merge"): void => {
    for (const c of cons) {
      if (rep.get(c) !== c) continue;
      const i = classify(c);
      if (!i.voiced || ["nasal", "lateral", "trill", "tap", "approximant"].includes(i.manner)) continue;
      const partner = cons.find((d) => {
        const j = classify(d);
        return d !== c && rep.get(d) === d && !j.voiced && j.place === i.place && j.manner === i.manner && j.secondary.length === i.secondary.length;
      });
      if (!partner) continue;
      rep.set(c, partner);
      if (mode === "diacritic") o.marked[c] = [partner, featureMark(b, "voiceless")];
    }
  };
  if (voicing !== "distinct") mergeVoicing(voicing);
  if ((countSeries() + 1) * quals.length > maxSigns) mergeVoicing("diacritic");
  // Still too many: merge liquids and nearest neighbours (Linear B wrote l and r alike).
  let guard = 0;
  while ((countSeries() + 1) * quals.length > maxSigns && guard++ < 40) {
    const series = cons.filter((c) => rep.get(c) === c);
    let best: [string, string] | null = null;
    let bd = Infinity;
    for (let x = 0; x < series.length; x++)
      for (let y = x + 1; y < series.length; y++) {
        const d = phonDistance(series[x], series[y]);
        if (d < bd) {
          bd = d;
          best = [series[x], series[y]];
        }
      }
    if (!best) break;
    const [keep, drop] = commonness(best[0]) >= commonness(best[1]) ? best : [best[1], best[0]];
    for (const c of cons) if (rep.get(c) === drop) rep.set(c, keep);
  }
  // Resolve chains.
  const root = (c: string): string => {
    let r = c;
    for (let k = 0; k < 6 && rep.get(r) !== r; k++) r = rep.get(r)!;
    return r;
  };
  const series = cons.filter((c) => root(c) === c).sort((x, y) => phoneticOrderKey(x) - phoneticOrderKey(y));
  // Generate signs.
  const keys: { c: string; v: string; w: number }[] = [];
  for (const v of quals) keys.push({ c: "", v, w: commonness(v) + 0.5 });
  for (const c of series) for (const v of quals) keys.push({ c, v, w: commonness(c) + commonness(v) });
  b.ctx.big = Math.min(1, keys.length / 90);
  const shapes = keys.map(() => b.factory.fresh(8));
  const bySimple = shapes.map((s) => ({ s, c: shapeComplexity(s) + rng.range(0, 0.8) })).sort((x, y) => x.c - y.c);
  const byCommon = keys.map((k, i) => ({ k, c: k.w + rng.range(0, 0.6), i })).sort((x, y) => y.c - x.c);
  const shapeFor = new Map<number, Shape>();
  byCommon.forEach((x, i) => shapeFor.set(x.i, bySimple[i].s));
  keys.forEach((k, i) => {
    const id = addGlyph(b, shapeFor.get(i)!, "syllable", k.c + k.v);
    o.syllables[`${k.c}|${k.v}`] = id;
  });
  // Merged consonants share their series' signs (unless written with a mark).
  for (const c of cons) {
    const r = root(c);
    if (r === c) continue;
    if (o.marked[c]) {
      // make sure the mark's base is the series root
      o.marked[c] = [r, o.marked[c][1]];
      continue;
    }
    for (const v of quals) o.syllables[`${c}|${v}`] = o.syllables[`${r}|${v}`];
  }
  o.coda = rng.chance(0.35) ? "final" : "echo";
  if (o.coda === "final") {
    // Coda signs for sonorants and sibilants (like kana ん).
    for (const c of series) {
      const i = classify(c);
      if (!["nasal", "lateral", "trill", "tap", "fricative"].includes(i.manner)) continue;
      const s = b.factory.fresh(8);
      const small = fitStrokes(s.strokes, 0, 0.35, s.w * 0.62, 1, true);
      o.finals[c] = addGlyph(b, { strokes: small, w: s.w * 0.66 }, "final", c, { note: "coda" });
    }
  }
}

function buildFeatural(b: Builder, inv: Inventory): void {
  const o = b.script.ortho;
  const design = featuralDesign(b.rng);
  const cons = uniq(inv.consonants).sort((x, y) => phoneticOrderKey(x) - phoneticOrderKey(y));
  const made: { ph: string; s: Shape }[] = [];
  const seen: ReturnType<typeof rasterize>[] = [];
  for (const c of cons) {
    let s = featuralConsonant(design, c);
    let r = rasterize(s.strokes, s.w);
    let k = 0;
    while (seen.some((q) => similarity(q, r) > 0.97) && k < 4) {
      // disambiguate look-alikes with an extra mark
      s = { ...s, strokes: [...s.strokes, ...[line(0.86, 0.02 + k * 0.08, 0.98, 0.02 + k * 0.08)]] };
      r = rasterize(s.strokes, s.w);
      k++;
    }
    seen.push(r);
    made.push({ ph: c, s });
  }
  for (const m of made) o.letters[m.ph] = addGlyph(b, m.s, "consonant", m.ph);
  const vs = featuralVowels(uniq(inv.vowels), b.script.morph.p.vstyle ?? 0);
  for (const v of uniq(inv.vowels).sort((x, y) => phoneticOrderKey(x) - phoneticOrderKey(y)))
    o.letters[v] = addGlyph(b, vs.get(v)!, "vowel", v);
  // Placeholder for vowel-initial syllables (ㅇ).
  o.carrier = o.letters["ʔ"] ?? addGlyph(b, { strokes: fitStrokes(featuralConsonant(design, "ʔ").strokes, 0.14, 0.32, 0.86, 0.95), w: 1 }, "consonant", "∅", { note: "silent onset" });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function pickDirection(rng: Rng, family: Family): Direction {
  const t: Record<Family, [Direction, number][]> = {
    stave: [["ltr", 0.6], ["rtl", 0.4]],
    geometric: [["ltr", 0.5], ["rtl", 0.4], ["ttb", 0.1]],
    hanging: [["ltr", 0.92], ["rtl", 0.08]],
    round: [["ltr", 0.8], ["rtl", 0.15], ["ttb", 0.05]],
    square: [["rtl", 0.8], ["ltr", 0.2]],
    cursive: [["rtl", 0.65], ["ltr", 0.15], ["ttb", 0.2]],
    wedge: [["ltr", 1]],
    linear: [["ltr", 0.6], ["rtl", 0.25], ["ttb", 0.15]],
    tally: [["ltr", 0.5], ["ttb", 0.5]],
    featural: [["ltr", 0.6], ["ttb", 0.4]],
    syllabic: [["ltr", 0.85], ["ttb", 0.15]],
  };
  return rng.weighted(t[family]);
}

function compatible(kind: ScriptKind, family: Family): boolean {
  if (family === "featural" || kind === "featural") return family === "featural" && kind === "featural";
  if (family === "syllabic") return kind === "abugida";
  if (family === "tally") return kind === "alphabet";
  return true;
}

export function newBuilder(script: Script, rng: Rng): Builder {
  const ctx: GenCtx = {
    W: script.style.width,
    p: script.morph.p,
    role: "consonant",
    big: 0,
    noHorizontal: script.style.tool === "knife",
  };
  const factory = new GlyphFactory(rng.fork("factory"), script.morph.family, ctx, script.style);
  const diffs = familyDifferentiators(rng.fork("diffs"), script.morph.family);
  factory.rescue = [...diffs, ...(["dotOut", "bar", "tick", "dotIn"] as Differentiator[]).filter((d) => !diffs.includes(d))];
  return {
    rng,
    script,
    factory,
    ctx,
    treat: chooseTreatments(rng.fork("treat"), script.kind),
    featureMarks: new Map(),
    featureDiac: new Map(),
    diffs,
    systematic: rng.chance(0.6) ? rng.range(0.15, 0.6) : 0,
  };
}

/** Invent a new writing system for a language with the given inventory. */
export function createScript(inventory: Inventory, rng: Rng, opts: CreateOptions = {}): Script {
  const r = rng.fork("script");
  let kind: ScriptKind =
    opts.kind ??
    r.weighted<ScriptKind>([
      ["alphabet", 0.3],
      ["abjad", 0.2],
      ["abugida", 0.25],
      ["syllabary", 0.17],
      ["featural", 0.08],
    ]);
  let family: Family = opts.family ?? r.weighted(KIND_FAMILIES[kind]);
  if (!compatible(kind, family)) {
    if (opts.family && !opts.kind) {
      kind = family === "featural" ? "featural" : family === "syllabic" ? "abugida" : family === "tally" ? "alphabet" : kind;
    } else family = r.weighted(KIND_FAMILIES[kind].filter(([f]) => compatible(kind, f)));
  }
  const tool: Tool = opts.tool ?? r.weighted(FAMILY_TOOLS[family]);
  const direction: Direction = opts.direction ?? pickDirection(r, family);
  const style = randomStyle(r.fork("style"), family, tool, direction);
  const id = opts.id ?? `scr-${(r.nextU32() >>> 8).toString(36)}`;
  const script: Script = {
    id,
    parent: null,
    bornYear: opts.bornYear ?? 0,
    generation: 0,
    kind,
    direction,
    style,
    morph: {
      family,
      p: familyParams(r.fork("params"), family),
      seed: `${id}:${r.nextU32()}`,
      diacritics: familyDiacritics(r.fork("diac"), family),
    },
    glyphs: [],
    order: [],
    ortho: emptyOrtho(),
    sounds: uniq([...inventory.consonants, ...inventory.vowels]),
    inventory: { consonants: inventory.consonants.slice(), vowels: inventory.vowels.slice() },
    nextId: 0,
    history: [],
  };
  if (family === "hanging") {
    // Each hanging script drops a few body types from its kit (its own "look").
    let mask = 0xfff;
    const drop = r.int(1, 3);
    for (let i = 0; i < drop; i++) mask &= ~(1 << r.int(0, 11));
    script.morph.p.seedMask = mask;
  }
  const b = newBuilder(script, r.fork("build"));
  switch (kind) {
    case "alphabet":
      buildAlphabet(b, inventory);
      break;
    case "abjad":
      buildAbjad(b, inventory);
      break;
    case "abugida":
      buildAbugida(b, inventory);
      break;
    case "syllabary":
      buildSyllabary(b, inventory);
      break;
    case "featural":
      buildFeatural(b, inventory);
      break;
  }
  if (family === "cursive" && direction === "ltr") mirrorCursive(script);
  finishScript(script, r.fork("order"));
  script.history.push(`invented as ${article(kind)} ${kind} written with ${toolPhrase(tool)}`);
  return script;
}

/** Cursive letters are designed right-to-left; a left-to-right script gets their mirror images. */
function mirrorCursive(s: Script): void {
  for (const g of s.glyphs) {
    if (g.role === "mark") {
      g.strokes = transformStrokes(g.strokes, [-1, 0, 0, 1, g.mark === "above" || g.mark === "below" ? 0 : g.w, 0]);
      continue;
    }
    g.strokes = transformStrokes(g.strokes, [-1, 0, 0, 1, g.w, 0]);
    // Entry and exit simply mirror: the pen now arrives from the left and leaves to the right.
    if (g.entry) g.entry = [g.w - g.entry[0], g.entry[1]];
    if (g.exit) g.exit = [g.w - g.exit[0], g.exit[1]];
  }
}

export function article(w: string): string {
  return /^[aeiou]/.test(w) ? "an" : "a";
}

export function toolPhrase(t: Tool): string {
  switch (t) {
    case "brush":
      return "a brush";
    case "pen":
      return "a broad-nibbed pen";
    case "reed":
      return "a reed pen";
    case "stylus":
      return "a stylus pressed into clay";
    case "chisel":
      return "a chisel on stone";
    case "knife":
      return "a knife on wood";
    case "needle":
      return "a stylus scratching palm leaves";
  }
}

/** Post-processing shared by creation and derivation: headlines and letter order. */
export function finishScript(script: Script, rng: Rng): void {
  if (script.style.headline) {
    for (const g of script.glyphs) {
      if (g.role !== "consonant" && g.role !== "vowel" && g.role !== "syllable") continue;
      const has = g.strokes.some((s) => s.pts.length === 2 && Math.abs(s.pts[0][1]) < 0.02 && Math.abs(s.pts[1][1]) < 0.02 && !s.dot);
      if (!has) g.strokes.unshift(line(0, 0, g.w, 0));
    }
  }
  computeOrder(script, rng);
}

export function computeOrder(script: Script, rng: Rng): void {
  const letters = script.glyphs.filter((g) => g.role !== "mark" && g.role !== "final");
  const phonetic = script.kind === "abugida" || script.kind === "featural" || script.kind === "syllabary";
  const keyed = letters.map((g) => {
    const k = g.role === "syllable" ? syllableKey(g.sound) : phoneticOrderKey(g.sound === "∅" ? "ʔ" : g.sound);
    return { g, k: phonetic ? k + (g.role === "vowel" ? -100 : 0) : rng.range(0, 1) * 30 + k * 0.3 };
  });
  keyed.sort((a, b) => a.k - b.k);
  // Keep an inherited order when present.
  const prev = script.order.filter((id) => letters.some((g) => g.id === id));
  const rest = keyed.map((x) => x.g.id).filter((id) => !prev.includes(id));
  script.order = [...prev, ...rest];
}

function syllableKey(s: string): number {
  // vowel-only syllables first; else by consonant then vowel
  const chars = [...s];
  const v = chars[chars.length - 1];
  const c = chars.slice(0, -1).join("");
  return (c ? phoneticOrderKey(c) * 100 : 0) + phoneticOrderKey(v);
}

export { strokesBBox };
