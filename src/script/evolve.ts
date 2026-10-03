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
  assignRotations,
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
import { differentiate } from "./marks";
import { rasterize, maxSimilarity, type Raster } from "./raster";
import { genMark, VOWEL_OPS, addDiacritic } from "./marks";
import { fitStrokes, type Shape } from "./families";
import { tidy } from "./factory";
import { transformStrokes, translate, line } from "./geom";
import { ensureDistinct } from "./distinct";

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
  /**
   * Force a change of kind (abjad → alphabet / abugida, alphabet → abugida,
   * syllabary → abugida). By default the borrowing language's sounds decide.
   */
  kind?: ScriptKind;
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
/**
 * `vowelFromConsonant`: how far (phonetic distance) a freed consonant letter
 * may be from a vowel to be taken over for it — 0 never, ~3.4 for glides and
 * laryngeals only, ∞ when an abjad becomes an alphabet (as Greek took over
 * every Phoenician letter it had no use for).
 */
function adaptLetters(b: Builder, needed: string[], vowelFromConsonant: number, vowelSeat?: string): number[] {
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
      const lim = pv === qv ? 1.55 : pv && !qv ? vowelFromConsonant : 0;
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
    // New letters are made from near ones — but not all from the same base.
    const uses = new Map<string, number>();
    const conv: Need[] = needs.map((n) => {
      if (n.how !== "indep" || b.rng.chance(0.22)) return n;
      const v = classify(n.ph).vowel;
      const cands = Object.keys(o.letters).filter((q) => q !== "∅" && (classify(q).vowel === v || v));
      const cost = (q: string): number => phonDistance(n.ph, q) + 1.2 * (uses.get(q) ?? 0);
      let from = cands.sort((x, y) => cost(x) - cost(y))[0];
      // When every near letter has already lent its shape, invent one (Greek Φ, Χ, Ψ, Ω).
      if (from && cost(from) > 3 && b.rng.chance(0.7)) return n;
      if (from) uses.set(from, (uses.get(from) ?? 0) + 1);
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
    // Primary orientations carry over to the nearest new vowels; the rest are reassigned.
    const primaries: Record<string, number> = {};
    for (const [v, code] of Object.entries(o.rotations)) if (!o.vowelOps[v]?.length) primaries[v] = code;
    const { map } = remapTable(primaries, quals);
    o.vowelOps = {};
    for (const [ph, m] of Object.entries(o.marked)) if (classify(ph).vowel && quals.includes(ph) && m[0] !== ph) delete o.marked[ph];
    assignRotations(b, quals, map);
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
  // New rows: derived from the nearest kept row by a diacritic (kana-style);
  // a second row made from the same base takes the next diacritic.
  const diacs = s.morph.diacritics;
  const d0 = rng.int(0, Math.min(2, diacs.length - 1));
  const timesUsed = new Map<string, number>();
  for (const c of newRows) {
    const near = Object.keys(cmap).filter((x) => x !== "").sort((x, y) => phonDistance(c, x) - phonDistance(c, y))[0];
    const n = timesUsed.get(near ?? "") ?? 0;
    timesUsed.set(near ?? "", n + 1);
    const diac = diacs[(d0 + n) % diacs.length];
    const where = n < diacs.length ? "right" : "above";
    for (const v of Object.keys(vmap)) {
      const baseId = near !== undefined ? syl[`${near}|${v}`] : undefined;
      const g = baseId !== undefined ? glyph(s, baseId) : undefined;
      const shape: Shape = g ? addDiacritic(shapeOf(g), diac, where) : b.factory.fresh(8);
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
function adaptInPlace(b: Builder, inv: Inventory, keepUnused: boolean, vowelFromConsonant = 3.4): void {
  const s = b.script;
  const o = s.ortho;
  const cons = uniq(inv.consonants);
  const vows = uniq(inv.vowels);
  let freed: number[] = [];
  switch (s.kind) {
    case "alphabet":
      freed = adaptLetters(b, [...cons, ...vows], vowelFromConsonant);
      break;
    case "abjad":
      freed = adaptLetters(b, cons, 0);
      adaptAbjadVowels(b, inv);
      break;
    case "abugida":
      if (o.vowelMode === "sign") freed = adaptLetters(b, [...cons, ...vows.filter((v) => classify(v).secondary.length === 0 || o.letters[v] !== undefined)], 0, "ʔ");
      else freed = adaptLetters(b, cons, 0);
      adaptAbugidaVowels(b, inv);
      break;
    case "syllabary":
      adaptSyllabary(b, inv);
      break;
    case "featural":
      freed = adaptLetters(b, [...cons, ...vows], 0);
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

/**
 * A syllabary becomes an abugida: the signs of the commonest vowel's column
 * are read as bare consonants carrying that vowel, the vowel-only signs
 * become vowel letters, and new signs are made for the other vowels (the
 * other columns fall out of use). Done when a language with clusters and
 * many syllable types takes over a syllabary that cannot write them.
 */
function syllabaryToAbugida(b: Builder): void {
  const s = b.script;
  const o = s.ortho;
  const keys = Object.keys(o.syllables);
  const cols = uniq(keys.map((k) => k.split("|")[1]));
  const inh = chooseInherent(cols);
  const letters: Record<string, number> = {};
  const keep = new Set<number>();
  for (const k of keys) {
    const [c, v] = k.split("|");
    const id = o.syllables[k];
    if (keep.has(id)) {
      if ((c && v === inh) || !c) letters[c || v] = id;
      continue;
    }
    if (c && v === inh) {
      letters[c] = id;
      keep.add(id);
      const g = glyph(s, id);
      if (g) {
        g.role = "consonant";
        g.note = `once /${g.sound}/`;
        g.sound = c;
        if (g.origin === "inherited" || g.origin === "mutated") g.origin = "repurposed";
      }
    } else if (!c) {
      letters[v] = id;
      keep.add(id);
      const g = glyph(s, id);
      if (g) g.role = "vowel";
    }
  }
  for (const id of new Set(Object.values(o.syllables))) if (!keep.has(id)) removeGlyph(s, id);
  for (const id of Object.values(o.finals)) removeGlyph(s, id);
  o.syllables = {};
  o.finals = {};
  o.letters = letters;
  o.inherent = inh;
  o.vowelMode = "sign";
  o.vowelSigns = { [inh]: -1 };
  o.conjuncts = b.rng.chance(0.3) ? "stack" : "virama";
  o.virama = -1;
  s.kind = "abugida";
  s.history.push(`the signs for syllables in ${inh} came to stand for bare consonants, and other vowels were written with new signs, making it an abugida`);
}

/** How strongly a language's sounds push a script towards another kind (0..1 chances). */
function kindPressure(kind: ScriptKind, inv: Inventory): { to: ScriptKind; p: number } | null {
  const quals = uniq(inv.vowels.map((v) => stripAll(v))).length;
  const cons = uniq(inv.consonants).length;
  if (kind === "abjad" && quals >= 5) return { to: "alphabet", p: Math.min(0.85, 0.25 + 0.1 * (quals - 5)) };
  if (kind === "syllabary" && (cons + 1) * quals > 110) return { to: "abugida", p: Math.min(0.8, ((cons + 1) * quals - 110) / 80 + 0.3) };
  return null;
}

// ---------------------------------------------------------------------------
// Glyph mutation pass
// ---------------------------------------------------------------------------

interface Habit {
  op: MutationOp;
  /** Strength passed to the op. */
  k: number;
  /** Fraction of eligible letters that take it up. */
  frac: number;
}

/** Script-wide habits a hand tends to acquire with each tool (weights). */
const TOOL_HABITS: Record<Tool, [MutationOp, number][]> = {
  needle: [["roundify", 3], ["startLoops", 1.2], ["close", 0.4], ["wide", 0.6], ["hooks", 0.6]],
  brush: [["roundify", 1.4], ["cursivize", 1.4], ["hooks", 1], ["tails", 0.6], ["flags", 0.5], ["narrow", 0.4]],
  pen: [["cursivize", 1], ["feet", 1], ["flags", 1], ["openTop", 0.7], ["narrow", 0.6], ["tails", 0.6], ["roundify", 0.5]],
  reed: [["openTop", 1], ["feet", 1], ["squarify", 1], ["tails", 0.8], ["cursivize", 0.5], ["flags", 0.6]],
  chisel: [["angularize", 1], ["squarify", 0.8], ["wide", 0.6], ["close", 0.5]],
  knife: [["deHorizontal", 1], ["angularize", 1], ["narrow", 0.5]],
  stylus: [["angularize", 1], ["simplify", 0.6]],
};

const HABIT_NOTES: Partial<Record<MutationOp, string>> = {
  roundify: "letters grew round, straight strokes bowing into curves",
  squarify: "letters squared off into a blocky book hand",
  angularize: "curves were broken into straight cuts",
  deHorizontal: "horizontal strokes, which split along the grain, came to slant",
  openTop: "the closed heads of letters opened",
  feet: "stems grew feet along the line",
  flags: "stems were crowned with small flags",
  tails: "several letters grew tails below the line",
  startLoops: "strokes came to begin with small loops",
  hooks: "stems ended in hooked turns",
  cursivize: "letters came to be made with fewer lifts of the hand",
  narrow: "letters grew narrower",
  wide: "letters grew broader",
  close: "open bowls closed into loops",
  simplify: "signs were simplified, losing strokes",
  rotateAll: "signs were turned on their sides",
  headline: "letters came to hang from a headline",
};

function chooseHabits(rng: Rng, s: Script, fromTool: Tool, drift: number): Habit[] {
  const toTool = s.style.tool;
  const fam = s.morph.family;
  const joins = s.style.joins;
  const changed = fromTool !== toTool;
  const soft = (t: Tool): boolean => t === "pen" || t === "brush" || t === "reed" || t === "needle";
  const out: Habit[] = [];
  const add = (op: MutationOp, k: number, frac: number): void => {
    if (!out.some((h) => h.op === op)) out.push({ op, k, frac });
  };
  if (fam === "tally" || fam === "featural") return rng.chance(drift * 0.5) ? [{ op: rng.pick(["narrow", "wide"] as MutationOp[]), k: 1, frac: 1 }] : [];
  if (fam === "wedge" && toTool === "stylus") {
    if (rng.chance(0.3 + drift * 0.5)) add("simplify", 1, 0.45);
    if (rng.chance(0.12 + drift * 0.2)) add("rotateAll", 1, 1);
    return out;
  }
  let pool = TOOL_HABITS[toTool].slice();
  if (joins) pool = pool.filter(([op]) => op === "roundify" || op === "angularize" || op === "tails" || op === "narrow" || op === "wide");
  if (!s.style.headline && s.kind === "abugida" && s.direction === "ltr" && soft(toTool) && !joins) pool.push(["headline", 1.4]);
  if (s.style.headline) pool = pool.filter(([op]) => op !== "flags" && op !== "openTop");
  // A new tool imposes its habit first.
  if (changed) {
    if (toTool === "knife") add("deHorizontal", 1, 1);
    else if (toTool === "stylus" || (toTool === "chisel" && soft(fromTool))) add("angularize", 1, 1);
    else if (toTool === "needle") {
      add("roundify", 0.75 + drift * 0.25, 0.95);
      if (rng.chance(0.55)) add("startLoops", 1, 0.6);
    }
    else if (!soft(fromTool) && !joins) add(rng.chance(0.5) ? "cursivize" : "roundify", 0.5 + drift * 0.3, 0.9);
  }
  // Every new tool leaves its mark; an unchanged hand drifts more slowly.
  const n = (changed ? (out.length ? 0 : 1) : rng.chance(0.35 + drift * 0.55) ? 1 : 0) + (rng.chance(0.25 + drift * 0.5) ? 1 : 0) + (rng.chance(drift * 0.25) ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const cand = pool.filter(([op]) => !out.some((h) => h.op === op));
    if (!cand.length) break;
    const op = rng.weighted(cand);
    const frac = op === "tails" ? 0.45 : op === "flags" ? 0.75 : op === "simplify" ? 0.35 : op === "startLoops" ? 0.7 : 0.9;
    const k = op === "roundify" ? (toTool === "needle" ? 0.7 : 0.35) + drift * 0.3 : 1;
    add(op, k, frac);
  }
  // Mutually exclusive pairs: keep the first.
  const clash: [MutationOp, MutationOp][] = [["roundify", "squarify"], ["roundify", "angularize"], ["narrow", "wide"], ["squarify", "cursivize"], ["openTop", "close"]];
  return out.filter((h, i) => !clash.some(([a, b]) => (h.op === b && out.slice(0, i).some((x) => x.op === a)) || (h.op === a && out.slice(0, i).some((x) => x.op === b))));
}

/** Per-letter mutation weights (rarer, idiosyncratic changes). */
function letterWeights(s: Script): [MutationOp, number][] {
  // Script-wide habits carry the tool's influence; these are the changes a
  // single letter undergoes on its own (every letter gets a little jitter anyway).
  const boost: Partial<Record<MutationOp, number>> = { rotate: 2.4, reflect: 1.6, simplify: 1.3, addStroke: 1.2 };
  const w = mutationWeights(s.style.tool, s.style.tool)
    .filter(([op]) => op !== "cursivize" && op !== "loopify" && op !== "deHorizontal" && op !== "angularize" && op !== "jitter")
    .map(([op, x]) => [op, x * (boost[op] ?? 1)] as [MutationOp, number]);
  let out = w;
  if (s.style.joins) out = out.filter(([op]) => ["simplify", "lean", "stretch", "addStroke"].includes(op));
  if (s.style.headline) out = out.filter(([op]) => op !== "rotate" && op !== "elongate");
  if (s.morph.family === "tally" || s.morph.family === "featural") out = out.filter(([op]) => op === "stretch");
  return out;
}

function mutateGlyphs(b: Builder, fromTool: Tool, drift: number): number {
  const s = b.script;
  const rng = b.rng;
  const glyphs = s.glyphs.filter((g) => LETTERISH(g));
  const habits = chooseHabits(rng, s, fromTool, drift);
  if (habits.some((h) => h.op === "headline")) {
    s.style.headline = true;
    s.style.spacing = 0.02;
  }
  const ctx = {
    tool: s.style.tool,
    headline: s.style.headline,
    diffs: b.diffs,
    footDir: rng.chance(0.5) ? 1 : -1,
    flagDir: rng.chance(0.6) ? -1 : 1,
    joins: s.style.joins,
  };
  for (const h of habits) {
    const note = HABIT_NOTES[h.op];
    if (note) s.history.push(note + (h.op === "roundify" && s.style.tool === "needle" ? ", as straight cuts would split the palm leaf" : ""));
  }
  const weights = letterWeights(s);
  const pMut = 0.18 + 0.42 * drift;
  const thresh = b.factory.thresh;
  // 1. Restyle every letter: the script's habits, then the odd idiosyncratic change.
  const plans = new Map<number, { styled: Shape; final: Shape; ops: MutationOp[] }>();
  for (const g of glyphs) {
    let shape: Shape = shapeOf(g);
    const applied: MutationOp[] = [];
    for (const h of habits) {
      if (h.op !== "headline" && !rng.chance(h.frac)) continue;
      const next = mutateShape(shape, h.op, rng, ctx, h.k);
      if (next !== shape) applied.push(h.op);
      shape = next;
    }
    const styled = shape;
    const ops: MutationOp[] = [];
    if (weights.length && rng.chance(pMut)) ops.push(rng.weighted(weights));
    if (weights.length && rng.chance(pMut * 0.35)) ops.push(rng.weighted(weights));
    for (const op of ops) shape = mutateShape(shape, op, rng, ctx, 0.5 + drift);
    shape = mutateShape(shape, "jitter", rng, ctx, 0.15 + drift * 0.3);
    plans.set(g.id, { styled, final: shape, ops: [...applied, ...ops] });
  }
  // 2. Resolve letters that converged: fall back to the plainly restyled form,
  //    then mark the newcomer with one of the script's differentiators.
  const accepted: Raster[] = [];
  let changed = 0;
  for (const g of rng.shuffle(glyphs.slice())) {
    const plan = plans.get(g.id)!;
    const candidates: Shape[] = [plan.final, plan.styled];
    for (const d of b.diffs) candidates.push(differentiate(plan.styled, d, rng));
    let chosen: Shape | null = null;
    let chosenR: Raster | null = null;
    for (const c of candidates) {
      const r = rasterize(c.strokes, c.w);
      if (maxSimilarity(r, accepted, thresh) < thresh) {
        chosen = c;
        chosenR = r;
        break;
      }
    }
    if (!chosen) {
      chosen = plan.final;
      chosenR = rasterize(chosen.strokes, chosen.w);
    }
    accepted.push(chosenR!);
    const t = tidy(chosen);
    if (g.entry) t.entry = [t.w, g.entry[1]];
    if (g.exit) t.exit = [g.exit[0] * (t.w / g.w), g.exit[1]];
    g.strokes = t.strokes;
    g.w = t.w;
    if (t.entry) g.entry = t.entry;
    if (t.exit) g.exit = t.exit;
    if (g.origin === "inherited") g.origin = "mutated";
    const idio = plan.ops.filter((op) => ["rotate", "reflect", "simplify", "addStroke", "elongate", "open", "close"].includes(op) && !habits.some((h) => h.op === op));
    if (idio.length) g.note = OP_NOTES[idio[0]] ?? g.note;
    changed++;
  }
  return changed;
}

const OP_NOTES: Partial<Record<MutationOp, string>> = {
  rotate: "turned on its side",
  reflect: "reversed",
  simplify: "lost a stroke",
  addStroke: "gained a mark",
  elongate: "lengthened its stem",
  open: "opened",
  close: "closed into a loop",
};

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
  if (tool !== fromTool) notes.push(`it came to be written with ${toolPhrase(tool)} rather than ${toolPhrase(fromTool)}`);

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
    notes.push(dir === "ttb" ? "it turned to vertical columns" : `it came to be written from ${dir === "ltr" ? "left to right" : "right to left"}${horizontalFlip ? ", its letters turning to face the new direction" : ""}`);
  }

  // Shapes.
  const changed = mutateGlyphs(b, fromTool, drift);
  if (changed) notes.push(`${changed} letter forms changed`);

  // Kind.
  // The daughter language's sounds press for a change (vowels an abjad cannot
  // show, more syllables than a syllabary can hold); habit alone rarely does.
  const inv = opts.inventory ?? parent.inventory;
  let kind: ScriptKind | undefined = opts.kind;
  const press = kindPressure(parent.kind, inv);
  if (!kind && press && r.chance(press.p * (0.6 + 0.6 * drift))) kind = press.to;
  if (!kind && parent.kind === "abjad" && r.chance(0.1 + 0.15 * drift)) kind = r.chance(0.5) ? "alphabet" : "abugida";
  if (!kind && parent.kind === "alphabet" && parent.morph.family !== "tally" && r.chance(0.04 * drift)) kind = "abugida";
  if (kind && kind !== parent.kind) {
    if (parent.kind === "abjad" && kind === "alphabet") abjadToAlphabet(b);
    else if ((parent.kind === "abjad" || parent.kind === "alphabet") && kind === "abugida") toAbugida(b);
    else if (parent.kind === "syllabary" && kind === "abugida") syllabaryToAbugida(b);
    else kind = parent.kind;
  }

  // Language.
  adaptInPlace(b, inv, false, parent.kind === "abjad" && child.kind === "alphabet" ? Infinity : 3.4);
  ensureDistinct(b);
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
  // Borrowers whose language the script cannot fit reshape the system (an
  // abjad taken up by a people with many vowels turns spare letters into
  // vowel letters).
  let kind = opts.kind;
  const press = kindPressure(script.kind, inventory);
  if (!kind && press && r.chance(press.p)) kind = press.to;
  let vowelFromConsonant = 3.4;
  if (kind && kind !== script.kind) {
    if (script.kind === "abjad" && kind === "alphabet") {
      abjadToAlphabet(b);
      vowelFromConsonant = Infinity;
    } else if ((script.kind === "abjad" || script.kind === "alphabet") && kind === "abugida") toAbugida(b);
    else if (script.kind === "syllabary" && kind === "abugida") syllabaryToAbugida(b);
  }
  adaptInPlace(b, inventory, !!opts.keepUnused, vowelFromConsonant);
  ensureDistinct(b);
  computeOrder(child, r.fork("order"));
  const added = child.glyphs.filter((g) => g.origin === "derived" || g.origin === "invented").length;
  const repurposed = child.glyphs.filter((g) => g.origin === "repurposed").length;
  const dropped = [...before].filter((p) => child.ortho.letters[p] === undefined && !child.sounds.includes(p)).length;
  const noun = child.kind === "syllabary" ? "signs" : "letters";
  child.history.push(
    `borrowed from ${script.id}` +
      (repurposed ? `; ${repurposed} ${noun} took new values` : "") +
      (added ? `; ${added} new ${noun} were made` : "") +
      (dropped ? `; ${dropped} ${noun} fell out of use` : ""),
  );
  return child;
}

export { stripAll, phoneticOrderKey };
