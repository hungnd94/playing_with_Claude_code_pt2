/**
 * Proto-language phonologies grown from a sound style (styles.ts): inventory,
 * onset clusters, codas and finals, final clusters, Zipfian frequencies,
 * word-shape preferences, stress, harmony and banned sequences. Every choice
 * is randomised within the style, and a small mutation step keeps two
 * languages of the same style from being clones.
 */
import type { Rng } from "../core/rng";
import { cf, features, isAffricate, isFricative, isLiquid, isNasal, isObstruent, isStop, lengthen, modify, vf, vowelQuality } from "./phoneme";
import { invalidateTables } from "./phonology";
import { parseWeighted, STYLE_BY_ID, SOUND_STYLES, styleWeight, type FinalFamily, type OnsetFamily, type SoundStyle } from "./styles";
import type { Flavour, Harmony, Phonology, StressRule } from "./types";
import { key } from "./util";

// Markedness-based base frequencies (before the style's boosts and Zipfian noise).
const ONSET_BASE: Record<string, number> = {
  t: 10, k: 9.5, n: 8, m: 8, s: 8, p: 7, l: 7, r: 7, ɾ: 7, d: 6, b: 6, g: 5, h: 5.5, j: 4.5, w: 4.5,
  ʃ: 4, f: 4, tʃ: 3.5, ts: 3, z: 3, v: 3.5, x: 3, q: 3.2, ʔ: 3.5, ŋ: 1.2, ɲ: 2.5, dʒ: 3, θ: 2.6, ð: 2.2,
  χ: 2.8, ħ: 2.6, ʕ: 2.2, ɣ: 2, ʒ: 2, ɬ: 2.6, tɬ: 2.6, kʷ: 2.5, c: 2.5, ɟ: 2, ʋ: 4, ʎ: 2.2, ɕ: 3, tɕ: 3,
  ʂ: 3, ʈʂ: 3, ʐ: 2, ʈ: 3, ɖ: 2.5, ɳ: 1.5, ɭ: 2, ɸ: 2, β: 2,
};
const CODA_BASE: Record<string, number> = {
  n: 10, r: 8, ɾ: 7, l: 7, s: 7, m: 6, t: 5, k: 5, ŋ: 6, j: 4, w: 3.5, ʃ: 3, x: 3, p: 3, d: 3, g: 2.5,
  b: 2, f: 2.5, ts: 1.5, tʃ: 1.5, q: 2.5, χ: 2.5, ħ: 2, z: 2, v: 2, h: 1, ʔ: 2.5, ɬ: 2, θ: 2, ð: 2,
};
const VOWEL_BASE: Record<string, number> = { a: 10, i: 8, u: 7, e: 7, o: 6, ə: 4.5, ɨ: 3.5, ɛ: 4, ɔ: 3.5, y: 3, ø: 2.5, æ: 3.5, ɯ: 3, ɑ: 3, ʊ: 3 };

function baseWeight(table: Record<string, number>, p: string, dflt: number): number {
  if (table[p] !== undefined) return table[p];
  const f = cf(p);
  if (f) {
    const plain = p.replace(/[ʰʱʼʷ]/g, "");
    const b = table[plain] ?? dflt;
    return b * (f.asp ? 0.55 : 1) * (f.ejective ? 0.6 : 1) * (f.lab ? 0.6 : 1);
  }
  const v = vf(p);
  if (v) {
    const q = vowelQuality(p);
    return (table[q] ?? dflt) * (v.long ? 0.32 : 1) * (v.nasal ? 0.3 : 1);
  }
  return dflt;
}

/** Zipf-like rank weights from noisy base scores; record keeps inventory order. */
function zipf(items: string[], base: (p: string) => number, rng: Rng, spread: number, boost: Map<string, number>): Record<string, number> {
  const scored = items.map((p) => ({ p, s: base(p) * Math.exp(rng.normal(0, spread)) * (boost.get(p) ?? 1) }));
  scored.sort((a, b) => b.s - a.s || (a.p < b.p ? -1 : 1));
  const out: Record<string, number> = {};
  scored.forEach((x, i) => (out[x.p] = +(1 / Math.pow(i + 1.5, 0.95)).toFixed(4)));
  const ordered: Record<string, number> = {};
  for (const p of items) ordered[p] = out[p];
  return ordered;
}

const range = (rng: Rng, r: [number, number] | undefined, dflt = 0) => (r ? rng.range(r[0], r[1]) : dflt);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const ESSENTIAL = new Set(["p", "t", "k", "m", "n", "s", "l", "r", "j", "w"]);
/** Plausible extra consonants, added by mutation (kept only if the style can spell them). */
const MUTATION_EXTRAS = ["ʃ", "x", "ŋ", "ts", "z", "v", "f", "h", "tʃ", "ɲ", "ð", "ɣ", "dʒ", "θ"];

function buildInventory(style: SoundStyle, rng: Rng): string[] {
  const set: string[] = [];
  const add = (p: string) => {
    if (features(p)?.kind === "C" && !set.includes(p)) set.push(p);
  };
  for (const p of style.core.split(/\s+/)) add(p);
  for (const [p, prob] of parseWeighted(style.opt)) if (rng.chance(prob)) add(p);
  // Series groups: "a b c|0.5" → all or nothing; mutually exclusive groups pick one when probabilities sum to 1.
  if (style.series?.length) {
    const groups = style.series.map((g) => {
      const [ps, pr] = g.split("|");
      return { ps: ps.split(/\s+/), pr: +(pr ?? 1) };
    });
    const total = groups.reduce((s, g) => s + g.pr, 0);
    if (Math.abs(total - 1) < 1e-6 && groups.length > 1) {
      const g = groups[rng.weightedIndex(groups.map((x) => x.pr))];
      for (const p of g.ps) add(p);
    } else for (const g of groups) if (rng.chance(g.pr)) for (const p of g.ps) add(p);
  }
  // Mutation: languages of the same style should not be clones.
  if (rng.chance(0.35)) {
    const cand = MUTATION_EXTRAS.filter((p) => !set.includes(p) && plausibleExtra(p, set));
    if (cand.length) add(rng.pick(cand));
  }
  if (rng.chance(0.3) && set.length > 12) {
    const removable = set.filter((p) => !ESSENTIAL.has(p) && !(style.boost ?? "").includes(p));
    if (removable.length) set.splice(set.indexOf(rng.pick(removable)), 1);
  }
  // Clamp to 10–30.
  const fill = ["h", "s", "l", "j", "w", "ŋ", "f", "r", "b", "d", "g"];
  for (const p of fill) if (set.length < 10) add(p);
  while (set.length > 30) {
    const removable = set.filter((p) => !ESSENTIAL.has(p));
    set.splice(set.indexOf(removable[removable.length - 1]), 1);
  }
  return set;
}

/** Only add voiced fricatives to languages with voicing, and so on. */
function plausibleExtra(p: string, set: string[]): boolean {
  const f = cf(p)!;
  const hasVoice = set.some((x) => cf(x)?.manner === "stop" && cf(x)?.voice);
  if (f.voice && (f.manner === "fricative" || f.manner === "affricate") && !hasVoice) return false;
  if (p === "dʒ" && !set.includes("tʃ")) return false;
  if (p === "ð" && !set.includes("θ")) return false;
  if (p === "ɣ" && !set.includes("x") && !set.includes("g")) return false;
  return true;
}

function buildVowels(style: SoundStyle, rng: Rng): string[] {
  const sys = rng.weighted(style.vowels).split(/\s+/);
  const out = sys.slice();
  if (style.long > 0 && rng.chance(style.long)) {
    const partial = style.long < 0.6 && rng.chance(0.5);
    for (const v of sys) {
      if (v === "ə" || v === "ɨ" && partial) continue;
      if (!partial || ["a", "e", "i", "o", "u"].includes(v) && rng.chance(0.75)) out.push(lengthen(v));
    }
  }
  if (style.nasal && rng.chance(style.nasal)) for (const v of sys) if (["a", "e", "i", "o", "u"].includes(v) && rng.chance(0.7)) out.push(modify(v, { nasal: true })!);
  return out;
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

function onsetFamily(fam: OnsetFamily, cons: string[]): string[][] {
  const has = (p: string) => cons.includes(p);
  const liquids = cons.filter((c) => isLiquid(c) && c !== "ɭ" && c !== "ɽ");
  const plainStops = cons.filter((c) => isStop(c) && c !== "ʔ" && !cf(c)!.lab && !cf(c)!.ejective);
  const out: string[][] = [];
  switch (fam) {
    case "OL":
      for (const s of [...plainStops, ...cons.filter((c) => ["f", "v", "θ", "x", "ʃ", "χ", "ɸ"].includes(c))]) {
        const f = cf(s)!;
        if (f.place === "glottal" || f.place === "pharyngeal" || f.place === "retroflex") continue;
        for (const l of liquids) {
          const lat = cf(l)!.manner === "lateral";
          if (lat && (f.place === "alveolar" || f.place === "dental")) continue; // *tl, *dl, *θl
          if (lat && f.asp) continue;
          out.push([s, l]);
        }
      }
      break;
    case "sC":
      for (const st of ["p", "t", "k"]) if (has(st) && has("s")) out.push(["s", st]);
      break;
    case "sCL":
      if (has("s")) for (const st of ["p", "t", "k"]) for (const l of liquids) if (has(st) && !(st === "t" && cf(l)!.manner === "lateral")) out.push(["s", st, l]);
      break;
    case "sN":
      for (const n of ["m", "n", "l", "w"]) if (has(n) && has("s")) out.push(["s", n]);
      break;
    case "Cw":
      if (has("w")) for (const c of ["k", "g", "t", "d", "s", "x", "h", "ts", "tʃ", "ʃ", "ʂ", "ʈʂ", "kʰ", "tʰ", "m", "n", "l", "z"]) if (has(c)) out.push([c, "w"]);
      break;
    case "Cj":
      if (has("j")) for (const c of ["p", "b", "m", "n", "t", "d", "k", "g", "l", "h", "pʰ", "tʰ", "v", "ʋ", "s"]) if (has(c)) out.push([c, "j"]);
      break;
    case "Cv": {
      const v = has("v") ? "v" : has("ʋ") ? "ʋ" : null;
      if (v) for (const c of ["t", "d", "k", "g", "s", "z", "ʃ", "x", "ɣ", "ts", "tʃ", "kʼ", "tʼ", "tsʼ", "dz"]) if (has(c)) out.push([c, v]);
      break;
    }
    case "hR":
      if (has("h")) for (const c of ["l", "r", "n", "w", "j", "v"]) if (has(c)) out.push(["h", c]);
      break;
    case "NC":
      for (const [n, c] of [["m", "b"], ["n", "d"], ["ŋ", "g"], ["m", "p"], ["n", "t"], ["ŋ", "k"], ["n", "z"], ["n", "dʒ"], ["ɲ", "dʒ"], ["m", "v"], ["n", "tʃ"], ["n", "s"]] as [string, string][])
        if (has(n) && has(c)) out.push([n, c]);
      break;
    case "harmonic": {
      // Kartvelian-like: obstruent pairs agreeing in voicing (ejectives with ejectives or voiceless), stop/affricate + fricative or stop.
      const obs = cons.filter((c) => isObstruent(c) && c !== "h" && c !== "ʔ");
      for (const a of obs)
        for (const b of obs) {
          if (a === b) continue;
          const fa = cf(a)!;
          const fb = cf(b)!;
          if (fa.place === fb.place) continue;
          if (fa.voice !== fb.voice) continue;
          if (isAffricate(a) && isAffricate(b)) continue;
          if (isFricative(a) && isFricative(b)) continue;
          // order: anterior place first is typical (bg, dg, tk, pk, tsk)
          const rank = (p: string) => ["bilabial", "labiodental", "dental", "alveolar", "postalveolar", "palatal", "velar", "uvular"].indexOf(cf(p)!.place);
          if (rank(a) > rank(b) && !isFricative(a)) continue;
          if (fa.ejective !== fb.ejective && !(fb.ejective && !fa.voice)) continue;
          out.push([a, b]);
        }
      break;
    }
    case "mC":
      if (has("m")) for (const c of ["ts", "tʃ", "k", "g", "t", "d", "z", "s", "x", "ɣ", "tsʼ", "kʼ", "tʼ", "ʒ"]) if (has(c)) out.push(["m", c]);
      break;
    case "ptk":
      for (const [a, b] of [["p", "t"], ["k", "t"], ["k", "n"], ["g", "n"], ["m", "n"], ["p", "s"], ["k", "s"], ["t", "m"], ["kʰ", "t"], ["pʰ", "t"]] as [string, string][])
        if (has(a) && has(b)) out.push([a, b]);
      break;
  }
  return out;
}

function finalFamily(fam: FinalFamily, cons: string[], finals: Set<string>): string[][] {
  const has = (p: string) => cons.includes(p);
  const out: string[][] = [];
  switch (fam) {
    case "NC":
      for (const [n, c] of [["m", "p"], ["m", "b"], ["n", "t"], ["n", "d"], ["ŋ", "k"], ["ŋ", "g"], ["n", "s"], ["n", "ts"], ["n", "tʃ"], ["n", "θ"]] as [string, string][])
        if (has(n) && has(c)) out.push([n, c]);
      break;
    case "LC":
      for (const l of ["r", "l", "ɾ"])
        if (has(l))
          for (const c of cons) {
            if (c === l || isLiquid(c) || c === "j" || c === "w" || c === "h" || c === "ʔ") continue;
            const f = cf(c)!;
            if (f.asp || f.ejective || f.lab) continue;
            if (l === "l" && (c === "r" || c === "ɾ")) continue;
            out.push([l, c]);
          }
      break;
    case "sC":
      for (const s of ["s", "ʃ"]) if (has(s)) for (const st of ["t", "k", "p"]) if (has(st) && !(s === "ʃ" && st === "p")) out.push([s, st]);
      if (has("x") && has("t")) out.push(["x", "t"]);
      if (has("f") && has("t")) out.push(["f", "t"]);
      break;
    case "Cs":
      for (const st of ["k", "p", "t"]) if (has(st) && has("s") && !(st === "t" && has("ts"))) out.push([st, "s"]);
      break;
  }
  void finals;
  return out;
}

// ---------------------------------------------------------------------------
// Style choice and the generator
// ---------------------------------------------------------------------------

/** Pick a style for a homeland, avoiding styles already used (they become unlikely, not impossible). */
export function pickStyle(rng: Rng, flavour: Flavour | null, avoid: string[] = []): SoundStyle {
  const counts = new Map<string, number>();
  for (const a of avoid) counts.set(a, (counts.get(a) ?? 0) + 1);
  const weights = SOUND_STYLES.map((s) => styleWeight(s, flavour) * Math.pow(0.12, counts.get(s.id) ?? 0));
  return SOUND_STYLES[rng.weightedIndex(weights)];
}

export function styleById(id: string | undefined): SoundStyle | undefined {
  return id ? STYLE_BY_ID[id] : undefined;
}

function canonOf(onsetClusters: string[][], codas: string[], finals: string[], codaClusters: string[][], finalClusters: string[][], pInitialVowel: number): string {
  const maxOn = onsetClusters.reduce((m, c) => Math.max(m, c.length), 1);
  const maxCo = codaClusters.length || finalClusters.length ? 2 : codas.length || finals.length ? 1 : 0;
  const on = pInitialVowel > 0 ? "(C)".repeat(maxOn) : "C" + "(C)".repeat(maxOn - 1);
  const allNasal = [...codas, ...finals].every((c) => isNasal(c));
  const co = maxCo === 0 ? "" : allNasal ? "(N)" : "(C)".repeat(maxCo);
  return `${on}V${co}`;
}

export function phonologyFromStyle(style: SoundStyle, rng: Rng): Phonology {
  const consonants = buildInventory(style, rng);
  const vowels = buildVowels(style, rng);
  const has = (p: string) => consonants.includes(p);

  // Onset clusters.
  const onset: string[][] = [];
  const seen = new Set<string>();
  const addOnset = (c: string[]) => {
    const k = key(c);
    if (!seen.has(k) && c.every(has)) {
      seen.add(k);
      onset.push(c);
    }
  };
  for (const [fam, p] of style.onsets ?? []) for (const c of onsetFamily(fam, consonants)) if (rng.chance(p)) addOnset(c);
  for (const [k, p] of parseWeighted(style.onsetExtra)) if (rng.chance(p)) addOnset(k.includes("+") ? k.split("+") : [...k]);

  // Codas and finals.
  const codas = style.codas === "*" ? consonants.filter((c) => c !== "h" || style.id === "semitic") : (style.codas ?? "").split(/\s+/).filter(has);
  const finalW = parseWeighted(style.finals).filter(([c]) => has(c));
  // Mutation: occasionally a final drops out or an extra sonorant final appears.
  if (finalW.length > 2 && rng.chance(0.25)) finalW.splice(rng.int(1, finalW.length - 1), 1);
  const finals = finalW.map(([c]) => c);
  const wFinal: Record<string, number> = {};
  for (const [c, w] of finalW) wFinal[c] = +(w * Math.exp(rng.normal(0, 0.25))).toFixed(3);

  const finalClusters: string[][] = [];
  const fs = new Set(finals);
  const fseen = new Set<string>();
  for (const [fam, p] of style.finalClusters ?? [])
    for (const c of finalFamily(fam, consonants, fs))
      if (rng.chance(p) && !fseen.has(key(c))) {
        fseen.add(key(c));
        finalClusters.push(c);
      }
  const codaClusters = finalClusters.filter(() => rng.chance(0.5));

  // Frequencies.
  const boost = new Map<string, number>(parseWeighted(style.boost));
  // A signature sound or two of this particular language.
  const marked = consonants.filter((c) => !ESSENTIAL.has(c) && !boost.has(c));
  if (marked.length && rng.chance(0.6)) boost.set(rng.pick(marked), 1.8);
  const spread = rng.range(0.35, 0.7);
  const wOnset = zipf(consonants, (p) => baseWeight(ONSET_BASE, p, 2), rng, spread, boost);
  const wCoda = zipf(codas, (p) => baseWeight(CODA_BASE, p, 2), rng, spread, boost);
  const wVowel = zipf(vowels, (p) => baseWeight(VOWEL_BASE, p, 3), rng, 0.35, new Map());

  const initialBanned: string[] = [];
  for (const [c, p] of parseWeighted(style.noInitial)) if (has(c) && rng.chance(p)) initialBanned.push(c);

  const harmony: Harmony = style.harmony ? rng.weighted(style.harmony) : "none";
  const stress: StressRule = rng.weighted(style.stress);
  const pInitialVowel = range(rng, style.pInitialVowel);
  const wordLength = style.wordLength.map((x) => x * Math.exp(rng.normal(0, 0.2)));
  const geminates = rng.chance(style.geminates ?? 0);
  const banned: [string, string][] = parseWeighted(style.banned)
    .map(([k]) => k.split("+") as [string, string])
    .filter(([c, v]) => has(c) && vowels.some((x) => vowelQuality(x) === v));
  const wFinalV: Record<string, number> | undefined = style.finalV ? Object.fromEntries(parseWeighted(style.finalV).map(([v, w]) => [v, w])) : undefined;

  const ph: Phonology = {
    consonants,
    vowels,
    wOnset,
    wCoda,
    wVowel,
    onsetClusters: onset,
    codaClusters,
    finalClusters,
    codas,
    finals,
    initialBanned,
    pInitialVowel,
    hiatus: rng.chance(style.hiatus ?? 0.04),
    geminates,
    pCoda: codas.length ? range(rng, style.pCoda) : 0,
    pFinalCoda: finals.length ? range(rng, style.pFinalCoda) : 0,
    pCluster: onset.length ? range(rng, style.pCluster, 0.12) : 0,
    pCodaCluster: finalClusters.length ? range(rng, style.pCodaCluster, 0.08) : 0,
    wordLength,
    harmony,
    stress,
    canon: "",
    style: style.id,
    wFinal,
    wFinalV,
    banned: banned.length ? banned : undefined,
    pGeminate: geminates ? rng.range(0.08, 0.2) : 0,
  };
  if (!ph.wFinalV) delete ph.wFinalV;
  if (!ph.banned) delete ph.banned;
  // With only a handful of clusters, each would otherwise recur too often.
  if (onset.length && onset.length < 8) ph.pCluster *= Math.max(0.3, onset.length / 8);
  ph.canon = canonOf(onset, codas, finals, codaClusters, finalClusters, pInitialVowel);
  invalidateTables(ph);
  return ph;
}

/** Generate a proto-language phonology for a homeland (style chosen by `pickStyle` unless given). */
export function generatePhonology(rng: Rng, flavour: Flavour | null, styleId?: string, avoidStyles: string[] = []): Phonology {
  const style = styleById(styleId) ?? pickStyle(rng.fork("style"), flavour, avoidStyles);
  return phonologyFromStyle(style, rng);
}
