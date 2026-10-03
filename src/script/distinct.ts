/**
 * Legibility safety net: no two things a reader must tell apart may look
 * alike.
 *
 * Glyph generation already rejects look-alikes one glyph at a time, but some
 * forms only come into being later: fused vowel forms (a tick that runs into
 * a stroke the consonant already has), quarter-turned syllabics, letters
 * reshaped by a new hand. This pass rasterises every unit a word can be
 * written with and repairs collisions the way scripts do:
 *
 *  - a fused vowel form that vanishes into its consonant gets an irregular
 *    modification for that consonant (`ortho.vowelOpsFor`), as Ethiopic has;
 *  - two letters (or syllables) that collide: the younger one gains one of the
 *    script's own differentiating marks (a dot, bar, tick…).
 */
import type { Glyph, Script, Stroke, VowelOp } from "./types";
import type { Builder } from "./create";
import type { Shape } from "./families";
import { rasterize, similarity, similarityBound, type Raster } from "./raster";
import { applyVowelOps, orient, differentiate, addDiacritic, VOWEL_OPS, type Differentiator } from "./marks";
import { invalidateForms, vowelOpsOf } from "./spell";
import { tidy } from "./factory";
import { sampleRaw } from "./geom";

/** Similarity at or above which two written units count as the same. */
export const DUP_LIMIT = 0.985;

interface Unit {
  /** Glyph whose shape the unit is built from. */
  g: number;
  /** Vowel key for fused / rotated forms ("" = killed form), undefined for plain glyphs. */
  v?: string;
  r: Raster;
  /** Comparison pool: finals are only compared with finals. */
  pool: "main" | "final";
}

const LETTER_ROLES = new Set(["consonant", "vowel", "syllable"]);

function shapeOfGlyph(g: Glyph): Shape {
  const sh: Shape = { strokes: g.strokes, w: g.w };
  if (g.h !== undefined) sh.h = g.h;
  if (g.entry) sh.entry = g.entry;
  if (g.exit) sh.exit = g.exit;
  return sh;
}

/** Strokes of the unit (glyph g, vowel v) as written. */
function unitShape(s: Script, g: Glyph, v: string | undefined): Shape {
  const o = s.ortho;
  let shape = shapeOfGlyph(g);
  if (v === undefined) return shape;
  const ops = vowelOpsOf(s, g.id, v);
  if (ops.length) shape = applyVowelOps(shape, ops);
  if (o.vowelMode === "rotate") shape = orient(shape, o.rotations[v] ?? 0);
  return shape;
}

function rasterOf(sh: Shape): Raster {
  return rasterize(sh.strokes, sh.w);
}

/** Vowel keys a consonant is written with (fused or rotated abugidas), else null. */
function vowelKeys(s: Script): string[] | null {
  const o = s.ortho;
  if (s.kind !== "abugida") return null;
  if (o.vowelMode === "fused") return Object.keys(o.vowelOps);
  if (o.vowelMode === "rotate") return Object.keys(o.rotations);
  return null;
}

/** Glyphs that act as consonant bases in fused / rotated abugidas. */
function baseGlyphs(s: Script): Glyph[] {
  const o = s.ortho;
  return s.glyphs.filter((g) => g.role === "consonant" || g.id === o.carrier);
}

/** Rasters of written units, reused while a glyph's strokes and modifications are unchanged. */
type RasterCache = Map<string, { st: Stroke[]; ops: string; r: Raster }>;

function unitRaster(s: Script, g: Glyph, v: string | undefined, cache: RasterCache): Raster {
  const key = `${g.id}|${v ?? "-"}`;
  const ops = v === undefined ? "" : vowelOpsOf(s, g.id, v).join("+");
  const hit = cache.get(key);
  if (hit && hit.st === g.strokes && hit.ops === ops) return hit.r;
  const r = rasterOf(unitShape(s, g, v));
  cache.set(key, { st: g.strokes, ops, r });
  return r;
}

function units(s: Script, cache: RasterCache): Unit[] {
  const out: Unit[] = [];
  const keys = vowelKeys(s);
  if (keys) {
    for (const g of baseGlyphs(s)) for (const v of keys) out.push({ g: g.id, v, r: unitRaster(s, g, v, cache), pool: "main" });
    for (const g of s.glyphs) if (g.role === "vowel" && g.id !== s.ortho.carrier) out.push({ g: g.id, r: unitRaster(s, g, undefined, cache), pool: "main" });
  } else {
    for (const g of s.glyphs) if (LETTER_ROLES.has(g.role)) out.push({ g: g.id, r: unitRaster(s, g, undefined, cache), pool: "main" });
  }
  for (const g of s.glyphs) if (g.role === "final") out.push({ g: g.id, r: unitRaster(s, g, undefined, cache), pool: "final" });
  return out;
}

function sim(a: Raster, b: Raster, limit: number): number {
  if (similarityBound(a, b) < limit) return 0;
  return similarity(a, b);
}

// ---------------------------------------------------------------------------
// Fused forms: are the added marks visible?
// ---------------------------------------------------------------------------

/** Centre-line samples of strokes (dots as their centres, padded by their radius). */
function samplePts(strokes: Stroke[]): { xy: number[]; pad: number[] } {
  const xy: number[] = [];
  const pad: number[] = [];
  for (const st of strokes) {
    if (st.dot !== undefined) {
      xy.push(st.pts[0][0], st.pts[0][1]);
      pad.push(st.dot);
      continue;
    }
    if (st.pts.length < 2) continue;
    const p = sampleRaw(st, 0.03).xy;
    for (let i = 0; i < p.length; i += 2) {
      xy.push(p[i], p[i + 1]);
      pad.push(0);
    }
  }
  return { xy, pad };
}

/** Fraction of `a`'s samples lying further than `d` (em) from every sample of `b`. */
function apartFrac(a: { xy: number[]; pad: number[] }, b: { xy: number[]; pad: number[] }, d: number): number {
  const n = a.xy.length / 2;
  if (!n) return 0;
  if (!b.xy.length) return 1;
  let apart = 0;
  for (let i = 0; i < n; i++) {
    const x = a.xy[2 * i];
    const y = a.xy[2 * i + 1];
    let near = false;
    for (let j = 0; j < b.xy.length && !near; j += 2) {
      const r = d + a.pad[i] + b.pad[j >> 1];
      const dx = x - b.xy[j];
      const dy = y - b.xy[j + 1];
      if (dx * dx + dy * dy < r * r) near = true;
    }
    if (!near) apart++;
  }
  return apart / n;
}

type Pts = { xy: number[]; pad: number[] };

/**
 * Legibility of one consonant's fused forms. Every vowel form adds strokes to
 * the consonant; a form is legible when its added strokes stand clear of the
 * consonant's own ink and differ from every other form's additions.
 */
function fusedChecker(s: Script, g: Glyph): { keys: string[]; addOf(ops: VowelOp[]): Pts; legible(v: string, add: Pts): boolean; adds: Map<string, Pts> } {
  const o = s.ortho;
  const keys = Object.keys(o.vowelOps);
  const clearOf = Math.max(0.05, s.style.weight * 0.8);
  const base = shapeOfGlyph(g);
  const baseS = samplePts(g.strokes);
  const addOf = (ops: VowelOp[]): Pts => samplePts(ops.length ? applyVowelOps(base, ops).strokes.slice(g.strokes.length) : []);
  const adds = new Map<string, Pts>();
  for (const v of keys) adds.set(v, addOf(vowelOpsOf(s, g.id, v)));
  const legible = (v: string, add: Pts): boolean => {
    if (!add.xy.length) return true; // the bare form
    if (apartFrac(add, baseS, clearOf) < 0.45) return false;
    for (const w of keys) {
      if (w === v) continue;
      const other = adds.get(w)!;
      if (!other.xy.length) continue;
      if (Math.max(apartFrac(add, other, clearOf), apartFrac(other, add, clearOf)) < 0.35) return false;
    }
    return true;
  };
  return { keys, addOf, legible, adds };
}

/**
 * Fused abugidas: where the regular modification fails on a consonant's
 * shape, that consonant gets an irregular one (`ortho.vowelOpsFor`).
 */
function fixFusedForms(b: Builder): number {
  const s = b.script;
  const o = s.ortho;
  if (s.kind !== "abugida" || o.vowelMode !== "fused") return 0;
  let fixes = 0;
  for (const g of baseGlyphs(s)) {
    const { keys, addOf, legible, adds } = fusedChecker(s, g);
    for (const v of keys) {
      if (!o.vowelOps[v]?.length) continue; // the inherent vowel keeps the bare form
      if (legible(v, adds.get(v)!)) continue;
      const used = new Set(keys.filter((w) => w !== v).map((w) => vowelOpsOf(s, g.id, w).join("+")));
      const cands: VowelOp[][] = [];
      for (const op of VOWEL_OPS) if (op !== "none") cands.push([op]);
      for (const op of VOWEL_OPS) for (const op2 of VOWEL_OPS) if (op !== "none" && op2 !== "none" && op < op2) cands.push([op, op2]);
      for (const ops of cands) {
        if (used.has(ops.join("+"))) continue;
        const add = addOf(ops);
        if (!legible(v, add)) continue;
        o.vowelOpsFor ??= {};
        o.vowelOpsFor[`${g.id}|${v}`] = ops;
        adds.set(v, add);
        fixes++;
        break;
      }
    }
  }
  return fixes;
}

/** A differentiated version of glyph g's shape, or null. */
function remark(b: Builder, g: Glyph, attempt: number): Shape | null {
  const diffs: Differentiator[] = [...b.diffs, ...(["dotOut", "bar", "tick", "dotIn", "dotsOut", "hookEnd"] as Differentiator[]).filter((d) => !b.diffs.includes(d))];
  const base = shapeOfGlyph(g);
  const tries: (() => Shape)[] = [];
  for (const d of diffs) tries.push(() => differentiate(base, d, b.rng));
  for (const k of b.script.morph.diacritics) tries.push(() => addDiacritic(base, k, "right"));
  for (const k of b.script.morph.diacritics) tries.push(() => addDiacritic(base, k, "below"));
  // Two marks at once when one is not enough (crowded syllabaries).
  for (let i = 0; i < diffs.length; i++) {
    const d1 = diffs[i];
    const d2 = diffs[(i + 1) % diffs.length];
    tries.push(() => differentiate(differentiate(base, d1, b.rng), d2, b.rng));
  }
  const t = tries[attempt];
  return t ? t() : null;
}

/**
 * Repair look-alikes among all written units. Returns the number of repairs.
 * Call after a script's glyphs and orthography are final.
 */
export function ensureDistinct(b: Builder): number {
  const s = b.script;
  const cache: RasterCache = new Map();
  let repairs = fixFusedForms(b);
  for (let pass = 0; pass < 3; pass++) {
    const us = units(s, cache);
    // Find colliding glyph pairs (forms built on different glyphs).
    const bad = new Map<number, number>();
    for (let i = 0; i < us.length; i++)
      for (let j = 0; j < i; j++) {
        const a = us[i];
        const c = us[j];
        if (a.pool !== c.pool || a.g === c.g) continue;
        if (sim(a.r, c.r, DUP_LIMIT) < DUP_LIMIT) continue;
        const ga = s.glyphs.find((x) => x.id === a.g)!;
        const gc = s.glyphs.find((x) => x.id === c.g)!;
        // Change the younger letter: new before inherited, later before earlier.
        const age = (x: Glyph): number => (x.origin === "inherited" ? 0 : x.origin === "mutated" ? 1 : 2) * 1e6 + x.id;
        const victim = age(ga) >= age(gc) ? ga : gc;
        bad.set(victim.id, (bad.get(victim.id) ?? 0) + 1);
      }
    if (!bad.size) break;
    let current = us;
    for (const id of [...bad.keys()].sort((x, y) => x - y)) {
      const g = s.glyphs.find((x) => x.id === id)!;
      const others = current.filter((u) => u.g !== id);
      const own = (sh: Shape): Unit[] => {
        const keys = vowelKeys(s);
        const pool = g.role === "final" ? "final" : "main";
        if (keys && g.role === "consonant") {
          const save = g.strokes;
          const saveW = g.w;
          g.strokes = sh.strokes;
          g.w = sh.w;
          const out = keys.map((v) => ({ g: id, v, r: rasterOf(unitShape(s, g, v)), pool }) as Unit);
          g.strokes = save;
          g.w = saveW;
          return out;
        }
        return [{ g: id, r: rasterOf(sh), pool }];
      };
      // The first candidate clear of everything wins; failing that, the least confusable one.
      let best: { cand: Shape; mine: Unit[]; worst: number } | null = null;
      for (let k = 0; ; k++) {
        const cand = remark(b, g, k);
        if (!cand) break;
        const mine = own(cand);
        let worst = 0;
        for (const u of mine)
          for (const o of others) {
            if (o.pool !== u.pool) continue;
            const v = sim(u.r, o.r, Math.max(worst, 0.9));
            if (v > worst) worst = v;
          }
        if (!best || worst < best.worst) best = { cand, mine, worst };
        if (worst < DUP_LIMIT) break;
      }
      if (best) {
        current = [...others, ...best.mine];
        const t = tidy(best.cand);
        g.strokes = t.strokes as Stroke[];
        g.w = t.w;
        if (t.entry) g.entry = t.entry;
        if (t.exit) g.exit = t.exit;
        if (g.origin === "inherited") g.origin = "mutated";
        g.note = g.note ? `${g.note}; marked to tell it apart` : "marked to tell it apart";
        repairs++;
      }
    }
    invalidateForms(s);
  }
  invalidateForms(s);
  return repairs;
}

/**
 * Diagnostics: pairs of distinct written units at least `limit` alike
 * (letters, fused or rotated forms, syllables; finals among themselves).
 * A finished script should have none at DUP_LIMIT.
 */
export function confusables(s: Script, limit = DUP_LIMIT): { a: string; b: string; sim: number }[] {
  const us = units(s, new Map());
  const label = (u: Unit): string => {
    const g = s.glyphs.find((x) => x.id === u.g)!;
    const c = g.sound === "∅" ? "" : g.sound;
    return u.v === undefined ? g.sound : u.v === "" ? `${c}̸` : c + u.v;
  };
  const out: { a: string; b: string; sim: number }[] = [];
  for (let i = 0; i < us.length; i++)
    for (let j = 0; j < i; j++) {
      const a = us[i];
      const c = us[j];
      // Forms of one consonant are judged by their added marks (below).
      if (a.pool !== c.pool || a.g === c.g) continue;
      const v = sim(a.r, c.r, limit);
      if (v >= limit) out.push({ a: label(a), b: label(c), sim: v });
    }
  if (s.kind === "abugida" && s.ortho.vowelMode === "fused")
    for (const g of baseGlyphs(s)) {
      const { keys, legible, adds } = fusedChecker(s, g);
      for (const v of keys)
        if (!legible(v, adds.get(v)!)) {
          const u = us.find((x) => x.g === g.id && x.v === v)!;
          out.push({ a: label(u), b: `${label(u)} (marks unclear)`, sim: 1 });
        }
    }
  return out.sort((x, y) => y.sim - x.sim);
}
