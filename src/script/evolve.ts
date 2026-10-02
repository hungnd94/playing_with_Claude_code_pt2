/**
 * Script descent and borrowing.
 *
 *  deriveScript  — a daughter script: glyph mutation, style drift (a new
 *                  writing tool reshapes letters), direction and kind changes
 *                  (abjad → alphabet by repurposing letters for vowels, as
 *                  Greek did), and adaptation to the daughter language.
 *  adaptScript   — a script borrowed by another language: letters reassigned
 *                  to the nearest sounds, new letters made from old ones with
 *                  diacritics (Ž from Z), unneeded letters dropped.
 *
 * Every glyph keeps `anc` (its parent's glyph id) and `root` (the lineage).
 */
import type { Rng } from "../core/rng";
import type { Direction, Glyph, Inventory, Script, ScriptKind, Tool, VowelOp } from "./types";
import { classify, phonDistance, phoneticOrderKey } from "./ipa";
import {
  addGlyph,
  article,
  carrierFor,
  chooseInherent,
  computeOrder,
  deriveShape,
  featureMark,
  FEATURE_ORDER,
  newBuilder,
  planLetters,
  realizeLetters,
  shapeOf,
  stripAll,
  stripFeature,
  toolPhrase,
  uniq,
  type Builder,
  type Need,
} from "./create";
import { driftStyle, TOOL_SUCCESSORS } from "./style";
import { mutateShape, mutationWeights, isHeadline, type MutationOp } from "./mutate";
import { rasterize, maxSimilarity, type Raster } from "./raster";
import { genMark, VOWEL_OPS, addDiacritic } from "./marks";
import { fitStrokes, type Shape } from "./families";
import { tidy } from "./factory";
import { transformStrokes, translate, line } from "./geom";

export interface DeriveOptions {
  id?: string;
  bornYear?: number;
  /** The daughter language's inventory (default: the parent's). */
  inventory?: Inventory;
  /** 0..1 how much the script changes (default 0.5). */
  drift?: number;
  /** Force a writing tool / kind / direction. */
  tool?: Tool;
  kind?: ScriptKind;
  direction?: Direction;
}

export interface AdaptOptions {
  id?: string;
  bornYear?: number;
  /** Keep letters the new language does not need (as archaic letters). Default false. */
  keepUnused?: boolean;
}

const LETTERISH = (g: Glyph): boolean => g.role === "consonant" || g.role === "vowel" || g.role === "syllable" || g.role === "final";

function cloneScript(s: Script, id: string, bornYear: number): Script {
  const c: Script = JSON.parse(JSON.stringify(s));
  c.id = id;
  c.parent = s.id;
  c.bornYear = bornYear;
  c.generation = s.generation + 1;
  c.history = [];
  for (const g of c.glyphs) {
    g.anc = g.id;
    g.origin = "inherited";
    delete g.note;
  }
  return c;
}

function childId(s: Script, rng: Rng): string {
  return `${s.id}.${(rng.nextU32() >>> 12).toString(36)}`;
}

/** Builder for an existing script, with all current glyphs registered for distinctness. */
function builderFor(s: Script, rng: Rng): Builder {
  const b = newBuilder(s, rng);
  for (const g of s.glyphs) if (LETTERISH(g)) b.factory.register(g.strokes, g.w);
  // Feature marks already present.
  for (const g of s.glyphs) {
    if (g.role !== "mark" || !g.sound.startsWith("◌")) continue;
    const lab = g.sound.slice(1);
    for (const f of FEATURE_ORDER) if (lab === markChar(f)) b.featureMarks.set(f, g.id);
  }
  return b;
}

function markChar(f: (typeof FEATURE_ORDER)[number]): string {
  const m: Record<string, string> = {
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
  return m[f];
}

function removeGlyph(s: Script, id: number): void {
  const i = s.glyphs.findIndex((g) => g.id === id);
  if (i >= 0) s.glyphs.splice(i, 1);
  s.order = s.order.filter((x) => x !== id);
}

/** Ids referenced by the orthography. */
function referenced(s: Script): Set<number> {
  const o = s.ortho;
  const ids = new Set<number>();
  for (const v of Object.values(o.letters)) ids.add(v);
  for (const v of Object.values(o.marked)) ids.add(v[1]);
  for (const v of Object.values(o.vowelSigns)) if (v >= 0) ids.add(v);
  for (const v of Object.values(o.syllables)) ids.add(v);
  for (const v of Object.values(o.matres)) ids.add(v);
  for (const v of Object.values(o.finals)) ids.add(v);
  if (o.virama >= 0) ids.add(o.virama);
  if (o.carrier >= 0) ids.add(o.carrier);
  return ids;
}

function glyph(s: Script, id: number): Glyph | undefined {
  return s.glyphs.find((g) => g.id === id);
}

// ---------------------------------------------------------------------------
// Letter adaptation
// ---------------------------------------------------------------------------

/**
 * Re-map letters for a set of needed phonemes: keep exact matches, repurpose
 * letters whose sounds are gone for the nearest missing sounds, then derive
 * new letters for the rest. Returns the letters that became free (unused).
 */
function adaptLetters(b: Builder, needed: string[], allowVowelFromConsonant: boolean, vowelSeat?: string): number[] {
  const s = b.script;
  const o = s.ortho;
  const old = { ...o.letters };
  const neededSet = new Set(needed);
  const letters: Record<string, number> = {};
  const used = new Set<number>();
  for (const p of needed)
    if (old[p] !== undefined) {
      letters[p] = old[p];
      used.add(old[p]);
    }
  // Keep marked/digraph spellings whose parts are still around.
  const marked = { ...o.marked };
  const digraphs = { ...o.digraphs };
  o.marked = {};
  o.digraphs = {};
  const baseNeeds = new Set<string>();
  for (const p of needed) {
    if (letters[p] !== undefined) continue;
    if (marked[p]) {
      o.marked[p] = marked[p];
      baseNeeds.add(marked[p][0]);
    } else if (digraphs[p]) {
      o.digraphs[p] = digraphs[p];
      for (const q of digraphs[p]) baseNeeds.add(q);
    }
  }
  for (const q of baseNeeds) {
    if (letters[q] === undefined && old[q] !== undefined) {
      letters[q] = old[q];
      used.add(old[q]);
    }
  }
  // Free letters: old sounds no longer needed.
  const free = Object.entries(old).filter(([q, id]) => !neededSet.has(q) && !baseNeeds.has(q) && !used.has(id));
  const missing = needed.filter((p) => letters[p] === undefined && !o.marked[p] && !o.digraphs[p]);
  // Greedy repurposing by phonetic proximity.
  const pairs: [number, string, string, number][] = [];
  for (const p of missing)
    for (const [q, id] of free) {
      const pv = classify(p).vowel;
      const qv = classify(q).vowel;
      const d = phonDistance(p, q);
      const lim = pv === qv ? 1.55 : allowVowelFromConsonant && pv && !qv ? 3.4 : 0;
      if (d < lim) pairs.push([d + b.rng.range(0, 0.15), p, q, id]);
    }
  pairs.sort((x, y) => x[0] - y[0]);
  const takenP = new Set<string>();
  const takenId = new Set<number>();
  for (const [, p, q, id] of pairs) {
    if (takenP.has(p) || takenId.has(id)) continue;
    takenP.add(p);
    takenId.add(id);
    letters[p] = id;
    const g = glyph(s, id);
    if (g) {
      g.sound = p;
      g.role = classify(p).vowel ? "vowel" : "consonant";
      if (g.origin === "inherited" || g.origin === "mutated") g.origin = "repurposed";
      g.note = `once /${q}/`;
    }
  }
  o.letters = letters;
  const freed = free.filter(([, id]) => !takenId.has(id)).map(([, id]) => id);
  // Remaining sounds: secondary-feature treatments, otherwise new letters derived from near ones.
  const rest = missing.filter((p) => !takenP.has(p));
  if (rest.length) {
    const needs = planLetters(b, rest, false);
    const conv: Need[] = needs.map((n) => {
      if (n.how !== "indep" || b.rng.chance(0.22)) return n;
      const v = classify(n.ph).vowel;
      const cands = Object.keys(o.letters).filter((q) => q !== "∅" && classify(q).vowel === v);
      let from = cands.sort((x, y) => phonDistance(n.ph, x) - phonDistance(n.ph, y))[0];
      if (!from && v && vowelSeat && o.letters[vowelSeat] !== undefined) from = vowelSeat;
      if (!from) return n;
      const diacs = s.morph.diacritics;
      return { ph: n.ph, how: "derived", from, diac: diacs[b.rng.int(0, Math.min(2, diacs.length - 1))] };
    });
    realizeLetters(b, conv, "consonant");
  }
  return freed;
}

// ---------------------------------------------------------------------------
// Vowel systems
// ---------------------------------------------------------------------------

function vowelQualities(s: Script, inv: Inventory, keepFeatures: boolean): string[] {
  const out: string[] = [];
  for (const v of uniq(inv.vowels)) {
    let cur = v;
    if (!keepFeatures) {
      for (const f of FEATURE_ORDER) {
        if (!classify(cur).secondary.includes(f)) continue;
        const base = stripFeature(cur, f);
        if (base === cur) continue;
        s.ortho.marked[cur] = s.ortho.marked[cur] ?? [base, -1];
        cur = base;
      }
    }
    out.push(cur);
  }
  return uniq(out);
}

/** Fill in feature marks for marked entries created with a placeholder (-1). */
function fixMarks(b: Builder): void {
  const o = b.script.ortho;
  for (const [ph, [base, id]] of Object.entries(o.marked)) {
    if (id >= 0) continue;
    const f = FEATURE_ORDER.find((x) => classify(ph).secondary.includes(x) && stripFeature(ph, x) === base);
    o.marked[ph] = [base, featureMark(b, f ?? "long")];
  }
}

/** Generic remap of a vowel → value table onto new vowel qualities (nearest old vowel, each used once). */
function remapTable<T>(table: Record<string, T>, quals: string[], skip: (q: string) => boolean = () => false): { map: Record<string, T>; missing: string[]; unused: string[] } {
  const map: Record<string, T> = {};
  const oldKeys = Object.keys(table).filter((k) => k !== "");
  const used = new Set<string>();
  for (const q of quals) if (table[q] !== undefined && !skip(q)) {
    map[q] = table[q];
    used.add(q);
  }
  const pairs: [number, string, string][] = [];
  for (const q of quals) if (map[q] === undefined && !skip(q)) for (const k of oldKeys) if (!used.has(k)) pairs.push([phonDistance(q, k), q, k]);
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [d, q, k] of pairs) {
    if (map[q] !== undefined || used.has(k) || d > 1.6) continue;
    map[q] = table[k];
    used.add(k);
  }
  return { map, missing: quals.filter((q) => map[q] === undefined && !skip(q)), unused: oldKeys.filter((k) => !used.has(k)) };
}

function adaptAbjadVowels(b: Builder, inv: Inventory): void {
  const s = b.script;
  const o = s.ortho;
  const quals = vowelQualities(s, inv, false);
  fixMarks(b);
  const { map, missing, unused } = remapTable(o.vowelSigns, quals);
  for (const k of unused) if (o.vowelSigns[k] >= 0) removeGlyph(s, o.vowelSigns[k]);
  o.vowelSigns = map;
  for (const [q, id] of Object.entries(map)) {
    const g = glyph(s, id);
    if (g && g.sound !== "◌" + q) {
      g.sound = "◌" + q;
      g.origin = "repurposed";
    }
  }
  let k = Object.keys(map).length;
  for (const q of missing) {
    const pos = classify(q).back === 0 ? "below" : "above";
    const ms = genMark(b.rng, pos, s.morph.family, k++, false);
    o.vowelSigns[q] = addGlyph(b, { strokes: ms.strokes, w: 0 }, "mark", "◌" + q, { mark: pos });
  }
  o.matres = {};
  for (const v of inv.vowels) {
    const i = classify(v);
    if (!i.secondary.includes("long")) continue;
    const mater = i.back === 0 && i.height <= 3 ? o.letters["j"] : i.back === 2 && i.round ? o.letters["w"] : (o.letters["ʔ"] ?? o.letters["h"]);
    if (mater !== undefined) o.matres[v] = mater;
  }
  if (o.carrier < 0 || !glyph(s, o.carrier)) o.carrier = carrierFor(b);
}

function adaptAbugidaVowels(b: Builder, inv: Inventory): void {
  const s = b.script;
  const o = s.ortho;
  const vowels = uniq(inv.vowels);
  const oldInherent = o.inherent;
  if (!oldInherent || !vowels.includes(oldInherent)) {
    o.inherent = oldInherent ? vowels.slice().sort((x, y) => phonDistance(oldInherent, x) - phonDistance(oldInherent, y))[0] : chooseInherent(vowels);
  }
  const quals = o.vowelMode === "sign" ? vowels.filter((v) => !o.marked[v]) : vowelQualities(s, inv, false);
  fixMarks(b);
  if (o.vowelMode === "sign") {
    const signs = { ...o.vowelSigns };
    if (oldInherent) delete signs[oldInherent];
    const { map, missing, unused } = remapTable(signs, quals, (q) => q === o.inherent);
    for (const k of unused) if (signs[k] >= 0 && !Object.values(map).includes(signs[k])) removeGlyph(s, signs[k]);
    o.vowelSigns = { ...map, [o.inherent!]: -1 };
    for (const [q, id] of Object.entries(map)) {
      const g = glyph(s, id);
      if (g && g.sound !== "◌" + q) {
        g.sound = "◌" + q;
        g.origin = "repurposed";
      }
    }
    const count: Record<string, number> = {};
    for (const q of missing) {
      const i = classify(q);
      const pos = i.height >= 5 ? "after" : i.back === 0 ? "above" : i.round ? "below" : "above";
      count[pos] = (count[pos] ?? 0) + 1;
      const ms = genMark(b.rng, pos, s.morph.family, count[pos] + 2, s.style.headline);
      o.vowelSigns[q] = addGlyph(b, { strokes: ms.strokes, w: ms.w }, "mark", "◌" + q, { mark: pos });
    }
    if (o.virama < 0) {
      o.virama = addGlyph(b, { strokes: [line(-0.1, 0.06, 0.1, 0.2)], w: 0 }, "mark", "◌̸", { mark: "below", note: "vowel killer" });
    }
  } else if (o.vowelMode === "fused") {
    const killer = o.vowelOps[""];
    const table = { ...o.vowelOps };
    delete table[""];
    const { map, missing } = remapTable(table, quals);
    const usedOps = new Set(Object.values(map).map((x) => x.join(",")));
    if (killer) usedOps.add(killer.join(","));
    const free = VOWEL_OPS.filter((op) => !usedOps.has(op));
    for (const q of missing) {
      const op: VowelOp[] = free.length ? [free.shift()!] : [b.rng.pick(VOWEL_OPS), b.rng.pick(VOWEL_OPS)];
      map[q] = op;
    }
    if (map[o.inherent!] === undefined || map[o.inherent!].length) {
      // make sure the inherent vowel has the bare form
      for (const k of Object.keys(map)) if (!map[k].length && k !== o.inherent) map[k] = [free.shift() ?? "dotRight"];
      map[o.inherent!] = [];
    }
    o.vowelOps = { ...map, "": killer ?? ["kink"] };
    if (o.carrier < 0 || !glyph(s, o.carrier)) o.carrier = carrierFor(b);
  } else if (o.vowelMode === "rotate") {
    const { map, missing } = remapTable(o.rotations, quals);
    const usedCodes = new Set(Object.values(map));
    for (const q of missing) {
      const code = [3, 2, 0, 1, 4, 5, 6, 7].find((c) => !usedCodes.has(c));
      if (code !== undefined) {
        map[q] = code;
        usedCodes.add(code);
      } else {
        const near = Object.keys(map).sort((x, y) => phonDistance(q, x) - phonDistance(q, y))[0];
        o.marked[q] = [near, featureMark(b, "syllabic")];
      }
    }
    o.rotations = map;
    // finals for consonants
    const finals: Record<string, number> = {};
    for (const ph of uniq(inv.consonants)) {
      if (o.finals[ph] !== undefined) {
        finals[ph] = o.finals[ph];
        continue;
      }
      const id = o.letters[ph];
      const g = id !== undefined ? glyph(s, id) : undefined;
      if (!g) continue;
      const fs = fitStrokes(g.strokes, 0, 0, Math.min(0.45, g.w * 0.45), 0.45, true);
      finals[ph] = addGlyph(b, { strokes: fs, w: Math.min(0.5, g.w * 0.5) }, "final", ph, { note: `final ${ph}`, origin: "derived" });
    }
    for (const [ph, id] of Object.entries(o.finals)) if (finals[ph] === undefined) removeGlyph(s, id);
    o.finals = finals;
  }
}

function adaptSyllabary(b: Builder, inv: Inventory): void {
  const s = b.script;
  const o = s.ortho;
  const rng = b.rng;
  const old = { ...o.syllables };
  const oldCons = uniq(Object.keys(old).map((k) => k.split("|")[0]));
  const oldVows = uniq(Object.keys(old).map((k) => k.split("|")[1]));
  const quals = vowelQualities(s, inv, false);
  fixMarks(b);
  // vowel columns
  const vmap: Record<string, string> = {};
  const vUsed = new Set<string>();
  const newCols: string[] = [];
  for (const q of quals) if (oldVows.includes(q)) {
    vmap[q] = q;
    vUsed.add(q);
  }
  for (const q of quals) {
    if (vmap[q]) continue;
    const near = oldVows.filter((v) => !vUsed.has(v)).sort((x, y) => phonDistance(q, x) - phonDistance(q, y))[0];
    if (near && phonDistance(q, near) < 1.6) {
      vmap[q] = near;
      vUsed.add(near);
    } else newCols.push(q);
  }
  // consonant rows (after the script's own secondary-feature handling)
  const cons = uniq(inv.consonants);
  const cmap: Record<string, string> = {};
  const cUsed = new Set<string>();
  const newRows: string[] = [];
  const marked = { ...o.marked };
  for (const c of cons) if (oldCons.includes(c)) {
    cmap[c] = c;
    cUsed.add(c);
  }
  for (const c of cons) {
    if (cmap[c] !== undefined || (marked[c] && cons.includes(marked[c][0]))) continue;
    const near = oldCons.filter((x) => x !== "" && !cUsed.has(x)).sort((x, y) => phonDistance(c, x) - phonDistance(c, y))[0];
    if (near && phonDistance(c, near) < 1.6) {
      cmap[c] = near;
      cUsed.add(near);
    } else newRows.push(c);
  }
  cmap[""] = "";
  const syl: Record<string, number> = {};
  const keepIds = new Set<number>();
  for (const [c, oc] of Object.entries(cmap))
    for (const [v, ov] of Object.entries(vmap)) {
      const id = old[`${oc}|${ov}`];
      if (id === undefined) continue;
      syl[`${c}|${v}`] = id;
      keepIds.add(id);
      const g = glyph(s, id);
      if (g && g.sound !== c + v) {
        g.sound = c + v;
        if (g.origin === "inherited") g.origin = "repurposed";
      }
    }
  // New rows: derived from the nearest kept row by a diacritic (kana-style).
  const diac = s.morph.diacritics[rng.int(0, Math.min(2, s.morph.diacritics.length - 1))];
  for (const c of newRows) {
    const near = Object.keys(cmap).filter((x) => x !== "").sort((x, y) => phonDistance(c, x) - phonDistance(c, y))[0];
    for (const v of Object.keys(vmap)) {
      const baseId = near !== undefined ? syl[`${near}|${v}`] : undefined;
      const g = baseId !== undefined ? glyph(s, baseId) : undefined;
      const shape: Shape = g ? addDiacritic(shapeOf(g), diac, "right") : b.factory.fresh(8);
      syl[`${c}|${v}`] = addGlyph(b, shape, "syllable", c + v, { origin: g ? "derived" : "invented", note: g ? `from ${g.sound}` : undefined });
    }
    cmap[c] = c;
  }
  // New columns: derived from the nearest column.
  for (const v of newCols) {
    const near = Object.keys(vmap).sort((x, y) => phonDistance(v, x) - phonDistance(v, y))[0];
    for (const c of Object.keys(cmap)) {
      const baseId = near !== undefined ? syl[`${c}|${near}`] : undefined;
      const g = baseId !== undefined ? glyph(s, baseId) : undefined;
      const shape: Shape = g ? addDiacritic(shapeOf(g), s.morph.diacritics[1] ?? "dots2", "above") : b.factory.fresh(8);
      syl[`${c}|${v}`] = addGlyph(b, shape, "syllable", c + v, { origin: g ? "derived" : "invented", note: g ? `from ${g.sound}` : undefined });
    }
    vmap[v] = v;
  }
  // Consonants written as series + mark keep that habit when their base exists.
  o.marked = {};
  for (const [ph, m] of Object.entries(marked)) if (cons.includes(ph) || inv.vowels.includes(ph)) o.marked[ph] = m;
  for (const id of Object.values(old)) if (!keepIds.has(id) && !Object.values(syl).includes(id)) removeGlyph(s, id);
  o.syllables = syl;
  for (const [c, id] of Object.entries(o.finals)) if (!cons.includes(c)) {
    removeGlyph(s, id);
    delete o.finals[c];
  }
}

/** Adapt a script's orthography to an inventory, in place. */
function adaptInPlace(b: Builder, inv: Inventory, keepUnused: boolean): void {
  const s = b.script;
  const o = s.ortho;
  const cons = uniq(inv.consonants);
  const vows = uniq(inv.vowels);
  let freed: number[] = [];
  switch (s.kind) {
    case "alphabet":
      freed = adaptLetters(b, [...cons, ...vows], true);
      break;
    case "abjad":
      freed = adaptLetters(b, cons, false);
      adaptAbjadVowels(b, inv);
      break;
    case "abugida":
      if (o.vowelMode === "sign") freed = adaptLetters(b, [...cons, ...vows.filter((v) => classify(v).secondary.length === 0 || o.letters[v] !== undefined)], false, "ʔ");
      else freed = adaptLetters(b, cons, false);
      adaptAbugidaVowels(b, inv);
      break;
    case "syllabary":
      adaptSyllabary(b, inv);
      break;
    case "featural":
      freed = adaptLetters(b, [...cons, ...vows], false);
      if (o.carrier < 0 || !glyph(s, o.carrier)) o.carrier = carrierFor(b);
      break;
  }
  s.inventory = { consonants: cons.slice(), vowels: vows.slice() };
  s.sounds = uniq([...cons, ...vows]);
  // Drop letters nobody uses any more.
  const refs = referenced(s);
  for (const g of s.glyphs.slice()) {
    if (refs.has(g.id)) continue;
    if (keepUnused && LETTERISH(g)) {
      g.note = (g.note ? g.note + "; " : "") + "archaic";
      continue;
    }
    if (LETTERISH(g) || g.role === "mark") removeGlyph(s, g.id);
  }
  void freed;
}

// ---------------------------------------------------------------------------
// Kind changes
// ---------------------------------------------------------------------------

function abjadToAlphabet(b: Builder): void {
  const s = b.script;
  const o = s.ortho;
  for (const id of Object.values(o.vowelSigns)) if (id >= 0) removeGlyph(s, id);
  o.vowelSigns = {};
  o.matres = {};
  o.pointing = false;
  s.kind = "alphabet";
  s.history.push("letters for unneeded consonants were taken over as vowel letters, making it an alphabet");
}

function toAbugida(b: Builder): void {
  const s = b.script;
  const o = s.ortho;
  const wasAlphabet = s.kind === "alphabet";
  s.kind = "abugida";
  o.vowelMode = "sign";
  o.conjuncts = b.rng.chance(0.3) ? "stack" : "virama";
  const vowels = uniq(s.inventory.vowels);
  o.inherent = chooseInherent(vowels);
  if (wasAlphabet) {
    // Vowel letters shrink into vowel signs written around the consonant.
    let k = 0;
    for (const v of vowels) {
      const id = o.letters[v];
      if (id === undefined || v === o.inherent) continue;
      const g = glyph(s, id)!;
      const i = classify(v);
      const pos = i.height >= 5 ? "after" : k++ % 2 ? "below" : "above";
      let strokes;
      if (pos === "after") strokes = fitStrokes(g.strokes, 0.04, 0.2, 0.3, 1.0, true);
      else if (pos === "above") strokes = fitStrokes(g.strokes, -0.16, -0.38, 0.16, -0.04, true);
      else strokes = fitStrokes(g.strokes, -0.16, 0.04, 0.16, 0.36, true);
      const mid = addGlyph(b, { strokes, w: pos === "after" ? 0.36 : 0 }, "mark", "◌" + v, {
        mark: pos,
        origin: "mutated",
        anc: g.anc,
        root: g.root,
        note: `from the vowel letter ${v}`,
      });
      o.vowelSigns[v] = mid;
    }
    o.vowelSigns[o.inherent] = -1;
    s.history.push("vowel letters shrank into signs around the consonant, making it an abugida");
  } else {
    // Pointing marks become obligatory vowel signs.
    o.vowelSigns = { ...o.vowelSigns };
    if (o.vowelSigns[o.inherent] !== undefined && o.vowelSigns[o.inherent] >= 0) removeGlyph(s, o.vowelSigns[o.inherent]);
    o.vowelSigns[o.inherent] = -1;
    o.matres = {};
    s.history.push(`vowel points became obligatory signs with an inherent ${o.inherent}, making it an abugida`);
  }
  o.virama = addGlyph(b, { strokes: [line(-0.1, 0.06, 0.1, 0.2)], w: 0 }, "mark", "◌̸", { mark: "below", note: "vowel killer" });
}

// ---------------------------------------------------------------------------
// Glyph mutation pass
// ---------------------------------------------------------------------------

function mutateGlyphs(b: Builder, fromTool: Tool, drift: number): number {
  const s = b.script;
  const rng = b.rng;
  const toTool = s.style.tool;
  const toolChanged = fromTool !== toTool;
  const joins = s.style.joins;
  let weights = mutationWeights(fromTool, toTool);
  if (joins) weights = weights.filter(([op]) => ["jitter", "simplify", "lean", "stretch", "addStroke", "cursivize", "loopify", "angularize"].includes(op));
  if (s.style.headline) weights = weights.filter(([op]) => op !== "rotate" && op !== "elongate");
  if (s.morph.family === "tally" || s.morph.family === "featural") weights = weights.filter(([op]) => op === "jitter" || op === "lean" || op === "stretch");
  const glyphs = s.glyphs.filter((g) => LETTERISH(g));
  const rasters = new Map<number, Raster>();
  for (const g of glyphs) rasters.set(g.id, rasterize(g.strokes, g.w));
  const thresh = b.factory.thresh;
  const pMut = 0.35 + 0.55 * drift;
  const forced: MutationOp[] = [];
  if (toolChanged) {
    if (toTool === "knife") forced.push("deHorizontal");
    else if (toTool === "stylus") forced.push("angularize");
    else if ((fromTool === "knife" || fromTool === "stylus" || fromTool === "chisel") && !joins && rng.chance(0.7)) forced.push("cursivize");
  }
  // Script-wide habits: coherent changes that sweep through the whole letter set.
  const simple = !joins && s.morph.family !== "tally" && s.morph.family !== "featural" && s.morph.family !== "wedge";
  const habits: [MutationOp, number][] = simple
    ? [
        ["narrow", 0.5],
        ["wide", 0.4],
        ["feet", toTool === "pen" || toTool === "brush" || toTool === "reed" ? 0.7 : 0.2],
        ["hooks", toTool === "brush" || toTool === "needle" || toTool === "pen" ? 0.6 : 0.1],
        ["loopify", toTool === "needle" || toTool === "brush" ? 0.6 : 0.1],
        ["cursivize", toTool !== "knife" && toTool !== "stylus" && toTool !== "chisel" ? 0.6 : 0],
        ["headline", !s.style.headline && s.kind === "abugida" && s.direction === "ltr" && toTool !== "knife" && toTool !== "stylus" ? 1.2 : 0],
      ]
    : [];
  const nHabits = simple ? (rng.chance(0.3 + drift * 0.6) ? 1 : 0) + (rng.chance(drift * 0.4) ? 1 : 0) : 0;
  const habitOps: MutationOp[] = [];
  for (let i = 0; i < nHabits; i++) {
    const h = rng.weighted(habits.filter(([op]) => !habitOps.includes(op)));
    if (h) habitOps.push(h);
  }
  if (habitOps.includes("headline")) {
    s.style.headline = true;
    s.style.spacing = 0.02;
    s.history.push("letters came to hang from a headline");
  }
  forced.push(...habitOps);
  let changed = 0;
  const ctx = { tool: toTool, headline: s.style.headline, diffs: b.diffs, footDir: rng.chance(0.5) ? 1 : -1 };
  for (const g of rng.shuffle(glyphs.slice())) {
    const others = (): Raster[] => [...rasters.entries()].filter(([id]) => id !== g.id).map(([, r]) => r);
    let shape: Shape = shapeOf(g);
    const ops: MutationOp[] = forced.length ? forced.filter((op) => op === "headline" || rng.chance(0.85)) : [];
    if (rng.chance(pMut)) ops.push(rng.weighted(weights));
    if (rng.chance(pMut * 0.5)) ops.push(rng.weighted(weights));
    if (!ops.length) continue;
    // Always a little hand drift.
    let accepted = false;
    for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
      let cand = shape;
      for (const op of ops) cand = mutateShape(cand, op, rng, ctx, 0.5 + drift);
      cand = mutateShape(cand, "jitter", rng, ctx, 0.25 + drift * 0.4);
      if (g.entry && cand.w !== g.w) {
        cand.entry = [cand.w, g.entry[1]];
        if (g.exit) cand.exit = [g.exit[0] * (cand.w / g.w), g.exit[1]];
      }
      const r = rasterize(cand.strokes, cand.w);
      if (maxSimilarity(r, others(), thresh) < thresh) {
        const t = tidy(cand);
        g.strokes = t.strokes;
        g.w = t.w;
        if (t.entry) g.entry = t.entry;
        if (t.exit) g.exit = t.exit;
        g.origin = "mutated";
        rasters.set(g.id, r);
        accepted = true;
        changed++;
      } else if (ops.length && ops[ops.length - 1] !== "headline") ops.splice(ops.length - 1, 1, rng.weighted(weights));
    }
    if (!accepted && ops.includes("headline")) {
      // the headline is a script-wide habit: apply it even if it makes letters more alike
      const cand = mutateShape(shape, "headline", rng, ctx);
      g.strokes = tidy(cand).strokes;
      g.origin = "mutated";
    }
  }
  return changed;
}

function reflectAll(s: Script, rng: Rng): void {
  for (const g of s.glyphs) {
    if (g.role === "mark" && (g.mark === "above" || g.mark === "below")) {
      g.strokes = transformStrokes(g.strokes, [-1, 0, 0, 1, 0, 0]);
      continue;
    }
    if (g.role === "mark") {
      g.strokes = transformStrokes(g.strokes, [-1, 0, 0, 1, g.w, 0]);
      continue;
    }
    // Most letters turn to face the new direction; symmetrical ones hardly notice.
    if (!s.style.joins && rng.chance(0.15)) continue;
    const head = g.strokes.filter((st) => isHeadline(st, g.w));
    const body = g.strokes.filter((st) => !isHeadline(st, g.w));
    g.strokes = [...head, ...transformStrokes(body, [-1, 0, 0, 1, g.w, 0])];
    if (g.entry) g.entry = [g.w - g.entry[0], g.entry[1]];
    if (g.exit) g.exit = [g.w - g.exit[0], g.exit[1]];
    if (g.origin === "inherited") g.origin = "mutated";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A daughter script descended from `parent`. */
export function deriveScript(parent: Script, rng: Rng, opts: DeriveOptions = {}): Script {
  const r = rng.fork("derive");
  const drift = Math.max(0, Math.min(1, opts.drift ?? 0.5));
  const id = opts.id ?? childId(parent, r);
  const child = cloneScript(parent, id, opts.bornYear ?? parent.bornYear + 300);
  const fromTool = parent.style.tool;
  let tool: Tool = opts.tool ?? fromTool;
  if (!opts.tool && r.chance(0.12 + 0.4 * drift)) tool = r.weighted(TOOL_SUCCESSORS[fromTool]);
  if (child.morph.family === "wedge" && tool !== "stylus" && !opts.tool && r.chance(0.6)) tool = "stylus";
  child.style = driftStyle(r.fork("style"), parent.style, tool, drift);
  const b = builderFor(child, r.fork("build"));
  const notes: string[] = [];
  if (tool !== fromTool) notes.push(`written with ${toolPhrase(tool)} instead of ${toolPhrase(fromTool)}`);

  // Direction.
  let dir: Direction = opts.direction ?? parent.direction;
  if (!opts.direction && r.chance(0.12 * drift + 0.03)) {
    if (parent.direction === "ttb") dir = parent.style.joins ? "rtl" : "ltr";
    else if (parent.style.joins && parent.direction === "rtl" && r.chance(0.35)) dir = "ttb";
    else dir = parent.direction === "ltr" ? "rtl" : "ltr";
  }
  if (dir !== parent.direction) {
    const horizontalFlip = (parent.direction === "ltr" && dir === "rtl") || (parent.direction === "rtl" && dir === "ltr");
    if (horizontalFlip) reflectAll(child, r.fork("reflect"));
    child.direction = dir;
    notes.push(dir === "ttb" ? "turned to vertical columns" : `came to be written ${dir === "ltr" ? "left to right" : "right to left"}${horizontalFlip ? ", its letters turning to face the new direction" : ""}`);
  }

  // Shapes.
  const changed = mutateGlyphs(b, fromTool, drift);
  if (changed) notes.push(`${changed} letter forms changed`);

  // Kind.
  let kind: ScriptKind | undefined = opts.kind;
  if (!kind && parent.kind === "abjad" && r.chance(0.18 + 0.2 * drift)) kind = r.chance(0.65) ? "alphabet" : "abugida";
  if (!kind && parent.kind === "alphabet" && parent.morph.family !== "tally" && r.chance(0.04 * drift)) kind = "abugida";
  if (kind && kind !== parent.kind) {
    if (parent.kind === "abjad" && kind === "alphabet") abjadToAlphabet(b);
    else if ((parent.kind === "abjad" || parent.kind === "alphabet") && kind === "abugida") toAbugida(b);
    else kind = parent.kind;
  }

  // Language.
  const inv = opts.inventory ?? parent.inventory;
  adaptInPlace(b, inv, false);
  computeOrder(child, r.fork("order"));
  child.history.unshift(
    `derived from ${parent.id}${child.kind !== parent.kind ? ` and became ${article(child.kind)} ${child.kind}` : ""}`,
    ...notes,
  );
  return child;
}

/** A script borrowed by a language with a different sound inventory. */
export function adaptScript(script: Script, inventory: Inventory, rng: Rng, opts: AdaptOptions = {}): Script {
  const r = rng.fork("adapt");
  const child = cloneScript(script, opts.id ?? childId(script, r), opts.bornYear ?? script.bornYear);
  const b = builderFor(child, r.fork("build"));
  const before = new Set(Object.keys(script.ortho.letters));
  adaptInPlace(b, inventory, !!opts.keepUnused);
  computeOrder(child, r.fork("order"));
  const added = child.glyphs.filter((g) => g.origin === "derived" || g.origin === "invented").length;
  const repurposed = child.glyphs.filter((g) => g.origin === "repurposed").length;
  const dropped = [...before].filter((p) => child.ortho.letters[p] === undefined && !child.sounds.includes(p)).length;
  child.history.push(
    `borrowed from ${script.id}` +
      (repurposed ? `; ${repurposed} letters took new values` : "") +
      (added ? `; ${added} new letters were made` : "") +
      (dropped ? `; ${dropped} letters fell out of use` : ""),
  );
  return child;
}

export { stripAll, phoneticOrderKey };
