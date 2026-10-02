/**
 * Root and affix generation from a phonology: syllable by syllable, drawing
 * phonemes from Zipfian positional distributions, then validated against the
 * phonotactics (rejection sampling).
 */
import type { Rng } from "../core/rng";
import { isVowel, vowelQuality } from "./phoneme";
import { harmonyClassOf, isValidWord, nuclei, tables } from "./phonology";
import type { Phonology, Word } from "./types";
import { key, pickFrom } from "./util";

const TIER_SKEW: Record<number, number[]> = {
  1: [2.2, 1, 0.35, 0.12],
  2: [1, 1, 1, 1],
  3: [0.45, 1, 1.7, 2],
};

export function syllableCount(ph: Phonology, rng: Rng, tier: number): number {
  const skew = TIER_SKEW[tier] ?? TIER_SKEW[2];
  const w = ph.wordLength.map((x, i) => (x + 0.005) * skew[i]);
  return rng.weightedIndex(w) + 1;
}

function degenerate(w: Word, rng: Rng): boolean {
  const nuc = nuclei(w);
  // identical adjacent syllables ("kaka") are allowed but rare
  if (nuc.length >= 2) {
    for (let i = 0; i + 1 < nuc.length; i++) {
      const a = w.slice(i === 0 ? 0 : nuc[i - 1] + 1, nuc[i] + 1).join("");
      const b = w.slice(nuc[i] + 1, nuc[i + 1] + 1).join("");
      if (a === b && rng.chance(0.85)) return true;
    }
  }
  // same vowel quality everywhere in a long word is monotonous
  if (nuc.length >= 3) {
    const q = new Set(nuc.map((i) => vowelQuality(w[i])));
    if (q.size === 1 && rng.chance(0.6)) return true;
  }
  // three of the same consonant
  const counts = new Map<string, number>();
  for (const p of w) if (!isVowel(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const n of counts.values()) if (n >= 3) return true;
  return false;
}

export interface GenOpts {
  /** Force a harmony class (1 or 2) for the whole word. */
  harmonyClass?: number;
  /** Words to avoid (keys from util.key). */
  avoid?: Set<string>;
  /** No coda at the end. */
  openFinal?: boolean;
  /** Must begin with a consonant. */
  consonantInitial?: boolean;
}

/** Monosyllabic content words are typically CVC: boost the final coda, forbid bare V. */
function monoOK(w: Word): boolean {
  return w.length >= 2;
}

/** One attempt at a word of n syllables (may be invalid). */
function attempt(ph: Phonology, rng: Rng, n: number, opts: GenOpts): Word {
  const t = tables(ph);
  const w: string[] = [];
  let cls = opts.harmonyClass ?? 0;
  for (let s = 0; s < n; s++) {
    const first = s === 0;
    const last = s === n - 1;
    // onset
    if (first) {
      if (!opts.consonantInitial && rng.chance(ph.pInitialVowel)) {
        // vowel-initial
      } else if (ph.pCluster > 0 && t.initialClusterPick.items.length && rng.chance(ph.pCluster)) {
        w.push(...pickFrom(t.initialClusterPick, rng)!);
      } else {
        const c = pickFrom(t.initialPick, rng);
        if (c) w.push(c);
      }
    } else {
      const prevCoda = !isVowel(w[w.length - 1]);
      if (ph.hiatus && !prevCoda && rng.chance(0.06)) {
        // hiatus
      } else if (ph.pCluster > 0 && t.onsetClusterPick.items.length && rng.chance(ph.pCluster * (prevCoda ? 0.2 : 0.6))) {
        w.push(...pickFrom(t.onsetClusterPick, rng)!);
      } else {
        const c = pickFrom(t.onsetPick, rng);
        if (c) w.push(c);
      }
    }
    // nucleus
    const v = pickFrom(t.harmonyPick[cls] ?? t.vowelPick, rng)!;
    w.push(v);
    if (cls === 0 && ph.harmony !== "none") cls = harmonyClassOf(ph.harmony, v);
    // coda
    if (last) {
      const pf = n === 1 && ph.pFinalCoda > 0 ? Math.max(ph.pFinalCoda, 0.6) : ph.pFinalCoda;
      if (!opts.openFinal && pf > 0 && rng.chance(pf)) {
        if (ph.pCodaCluster > 0 && t.finalClusterPick.items.length && rng.chance(ph.pCodaCluster)) w.push(...pickFrom(t.finalClusterPick, rng)!);
        else {
          const c = pickFrom(t.finalPick, rng);
          if (c) w.push(c);
        }
      }
    } else if (ph.pCoda > 0 && rng.chance(ph.pCoda)) {
      if (ph.pCodaCluster > 0 && t.codaClusterPick.items.length && rng.chance(ph.pCodaCluster * 0.5)) w.push(...pickFrom(t.codaClusterPick, rng)!);
      else {
        const c = pickFrom(t.codaPick, rng);
        if (c) w.push(c);
      }
    }
  }
  return w;
}

/** A valid word of n syllables. Falls back to fewer constraints after many failures. */
export function generateWord(ph: Phonology, rng: Rng, n: number, opts: GenOpts = {}): Word {
  let last: Word = [];
  for (let i = 0; i < 60; i++) {
    const w = attempt(ph, rng, n, opts);
    last = w;
    if (!isValidWord(ph, w, { harmony: true })) continue;
    if (n === 1 && !monoOK(w)) continue;
    if (opts.avoid && opts.avoid.has(key(w))) continue;
    if (i < 40 && degenerate(w, rng)) continue;
    return w;
  }
  // Fallback: a plain CV(CV) shape with the most frequent sounds.
  for (let i = 0; i < 200; i++) {
    const w = attempt(ph, rng, n, { ...opts, openFinal: true, consonantInitial: true });
    if (isValidWord(ph, w) && !(opts.avoid && opts.avoid.has(key(w)))) return w;
    last = w;
  }
  return last;
}

/** A root for a concept of the given tier. */
export function generateRoot(ph: Phonology, rng: Rng, tier: number, avoid?: Set<string>): Word {
  const n = syllableCount(ph, rng, tier);
  return generateWord(ph, rng, n, { avoid });
}

export type AffixShape = "V" | "CV" | "VC" | "C" | "CVC" | "VCV" | "CVCV";

/** A short grammatical morpheme. Suffix shapes are validated in a typical attached context. */
export function generateAffix(ph: Phonology, rng: Rng, shapes: [AffixShape, number][], avoid: Set<string>): Word {
  const t = tables(ph);
  for (let i = 0; i < 80; i++) {
    const shape = rng.weighted(shapes);
    const w: string[] = [];
    for (const ch of shape) {
      if (ch === "V") w.push(pickFrom(t.vowelPick, rng)!);
      else {
        // consonants in affixes favour unmarked, frequent sounds
        const pool = w.length === shape.length - 1 && shape !== "C" && shape.endsWith("C") ? t.finalPick : t.onsetPick;
        const c = pickFrom(pool.items.length ? pool : t.onsetPick, rng);
        if (!c) break;
        w.push(c);
      }
    }
    if (w.length !== shape.length) continue;
    if (avoid.has(key(w))) continue;
    // check in context: after a typical CV stem and a typical CVC stem
    const v = ph.vowels[0];
    const c = ph.consonants.find((x) => (ph.wOnset[x] ?? 0) > 0) ?? ph.consonants[0];
    const ctx1 = [c, v, ...w];
    if (shape === "C" || shape === "VC") {
      if (!isValidWord(ph, ctx1)) continue;
    } else if (!isValidWord(ph, ctx1) && !isValidWord(ph, [...w, v])) continue;
    if (shape === "C" && rng.chance(0.4)) continue;
    return w;
  }
  return [ph.vowels[0]];
}
