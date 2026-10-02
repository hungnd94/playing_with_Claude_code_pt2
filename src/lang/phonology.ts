/**
 * Phonology: syllables, stress, phonotactic validation, and generation of
 * typologically plausible proto-language sound systems.
 */
import type { Rng } from "../core/rng";
import {
  cf,
  features,
  isAffricate,
  isConsonant,
  isFricative,
  isGlide,
  isLiquid,
  isNasal,
  isObstruent,
  isStop,
  isVowel,
  lengthen,
  modify,
  sonority,
  vf,
  vowelQuality,
} from "./phoneme";
import type { Flavour, Harmony, Phonology, StressRule, Word } from "./types";
import { key, makePicker, type Picker } from "./util";

// ---------------------------------------------------------------------------
// Derived per-phonology lookup tables (not serialised; rebuilt lazily)
// ---------------------------------------------------------------------------

export interface PhonoTables {
  cons: Set<string>;
  vows: Set<string>;
  onsetClusters: Set<string>;
  codaClusters: Set<string>;
  finalClusters: Set<string>;
  codas: Set<string>;
  finals: Set<string>;
  initialBanned: Set<string>;
  onsetPick: Picker<string>;
  initialPick: Picker<string>;
  codaPick: Picker<string>;
  finalPick: Picker<string>;
  vowelPick: Picker<string>;
  onsetClusterPick: Picker<string[]>;
  initialClusterPick: Picker<string[]>;
  codaClusterPick: Picker<string[]>;
  finalClusterPick: Picker<string[]>;
  /** Harmony class per vowel: 0 neutral, 1 front/unrounded set, 2 back/rounded set. */
  harmonyClass: Map<string, number>;
  /** Vowel pickers restricted to each harmony class (class + neutral). */
  harmonyPick: Picker<string>[];
  /** Phoneme sequences that would be confused with an affricate ("t"+"s" when "ts" exists). */
  banned: Set<string>;
}

const TABLES = new WeakMap<Phonology, PhonoTables>();

export function tables(ph: Phonology): PhonoTables {
  let t = TABLES.get(ph);
  if (!t) {
    t = buildTables(ph);
    TABLES.set(ph, t);
  }
  return t;
}

/** Drop cached tables (call after mutating a phonology in place). */
export function invalidateTables(ph: Phonology): void {
  TABLES.delete(ph);
}

function clusterWeight(ph: Phonology, c: string[]): number {
  // flatter than single-consonant weights, so no one cluster dominates the lexicon
  let w = 1;
  for (const p of c) w *= Math.pow((ph.wOnset[p] ?? 0.2) + 0.08, 0.3);
  return w;
}

function buildTables(ph: Phonology): PhonoTables {
  const cons = new Set(ph.consonants);
  const vows = new Set(ph.vowels);
  const initialBanned = new Set(ph.initialBanned);
  const onsetItems = ph.consonants.filter((c) => (ph.wOnset[c] ?? 0) > 0);
  const onsetPick = makePicker(onsetItems, onsetItems.map((c) => ph.wOnset[c]));
  const initItems = onsetItems.filter((c) => !initialBanned.has(c));
  const initialPick = makePicker(initItems, initItems.map((c) => ph.wOnset[c]));
  const codaPick = makePicker(ph.codas, ph.codas.map((c) => ph.wCoda[c] ?? 0.5));
  const finalPick = makePicker(ph.finals, ph.finals.map((c) => ph.wCoda[c] ?? 0.5));
  const vowelPick = makePicker(ph.vowels, ph.vowels.map((v) => ph.wVowel[v] ?? 0.5));
  const onsetClusterPick = makePicker(ph.onsetClusters, ph.onsetClusters.map((c) => clusterWeight(ph, c)));
  const initCl = ph.onsetClusters.filter((c) => !initialBanned.has(c[0]));
  const initialClusterPick = makePicker(initCl, initCl.map((c) => clusterWeight(ph, c)));
  const codaClusterPick = makePicker(ph.codaClusters, ph.codaClusters.map((c) => clusterWeight(ph, c)));
  const finalClusterPick = makePicker(ph.finalClusters, ph.finalClusters.map((c) => clusterWeight(ph, c)));

  const harmonyClass = new Map<string, number>();
  for (const v of ph.vowels) harmonyClass.set(v, harmonyClassOf(ph.harmony, v));
  const harmonyPick: Picker<string>[] = [vowelPick];
  for (const cls of [1, 2]) {
    const items = ph.vowels.filter((v) => {
      const hc = harmonyClass.get(v)!;
      return hc === 0 || hc === cls;
    });
    harmonyPick.push(makePicker(items, items.map((v) => ph.wVowel[v] ?? 0.5)));
  }

  const banned = new Set<string>();
  for (const c of ph.consonants) {
    if (isAffricate(c)) {
      // "ts" → forbid t+s sequences, which would be indistinguishable in spelling.
      const base = c.replace(/[ʰʱʼʷ]/g, "");
      if (base.length === 2) banned.add(key([base[0], base[1]]));
    }
  }

  return {
    cons,
    vows,
    onsetClusters: new Set(ph.onsetClusters.map(key)),
    codaClusters: new Set(ph.codaClusters.map(key)),
    finalClusters: new Set(ph.finalClusters.map(key)),
    codas: new Set(ph.codas),
    finals: new Set(ph.finals),
    initialBanned,
    onsetPick,
    initialPick,
    codaPick,
    finalPick,
    vowelPick,
    onsetClusterPick,
    initialClusterPick,
    codaClusterPick,
    finalClusterPick,
    harmonyClass,
    harmonyPick,
    banned,
  };
}

export function harmonyClassOf(h: Harmony, v: string): number {
  const f = vf(v);
  if (!f || h === "none") return 0;
  if (h === "palatal") {
    // i and e are neutral (as in Finnish) unless back counterparts are rounded
    if (f.back === 0 && !f.round && f.height <= 2) return 0;
    if (f.back === 0) return 1;
    if (f.back === 2 || f.height === 6 || f.back === 1) return 2;
    return 0;
  }
  // rounding harmony: rounded vs unrounded non-low vowels; a neutral
  if (f.height === 6) return 0;
  return f.round ? 2 : 1;
}

/** The harmonic counterpart of a vowel in the other class (for suffix harmony). */
export function harmonize(h: Harmony, v: string, cls: number, inventory: Set<string>): string {
  if (h === "none" || cls === 0) return v;
  const c = harmonyClassOf(h, v);
  if (c === 0 || c === cls) return v;
  const f = vf(v)!;
  let cand: string | null = null;
  if (h === "palatal") {
    if (cls === 1) {
      // to front
      if (f.height === 6) cand = modify(v, { height: 5, back: 0, round: false });
      else cand = modify(v, { back: 0 });
    } else {
      if (f.height === 5) cand = modify(v, { height: 6, back: 1, round: false });
      else cand = modify(v, { back: 2 });
    }
  } else {
    cand = modify(v, { round: cls === 2, back: cls === 2 ? 2 : 0 });
  }
  if (cand && inventory.has(cand)) return cand;
  return v;
}

// ---------------------------------------------------------------------------
// Syllables and stress
// ---------------------------------------------------------------------------

function genericOnsetOK(seq: string[]): boolean {
  if (seq.length <= 1) return true;
  if (seq.length === 2) {
    const [a, b] = seq;
    if (a === b) return false;
    if ((a === "s" || a === "ʃ") && isStop(b)) return true;
    return sonority(b) > sonority(a) + 1.5 && sonority(b) >= 5;
  }
  if (seq.length === 3) {
    return (seq[0] === "s" || seq[0] === "ʃ") && isStop(seq[1]) && sonority(seq[2]) >= 5;
  }
  return false;
}

/**
 * Syllable boundaries: returns the start index of each syllable. With a
 * phonology, uses its onset clusters (maximal onset); otherwise a sonority
 * heuristic.
 */
export function syllabify(w: Word, ph?: Phonology): number[] {
  const nuclei: number[] = [];
  for (let i = 0; i < w.length; i++) if (isVowel(w[i])) nuclei.push(i);
  if (nuclei.length === 0) return [0];
  const starts = [0];
  const oc = ph ? tables(ph).onsetClusters : null;
  for (let n = 0; n + 1 < nuclei.length; n++) {
    const a = nuclei[n] + 1;
    const b = nuclei[n + 1] - 1;
    if (b < a) {
      starts.push(nuclei[n + 1]);
      continue;
    }
    let s = b; // default: one consonant onset
    for (let k = a; k < b; k++) {
      const seq = w.slice(k, b + 1);
      if (seq.length > 1 && seq[0] === seq[1]) continue;
      const ok = oc ? oc.has(key(seq)) : genericOnsetOK(seq);
      if (ok) {
        s = k;
        break;
      }
    }
    starts.push(s);
  }
  return starts;
}

/** Indices of vowel nuclei. */
export function nuclei(w: Word): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.length; i++) if (isVowel(w[i])) out.push(i);
  return out;
}

/** Index (into the syllable list) of the stressed syllable. */
export function stressedSyllable(w: Word, rule: StressRule, ph?: Phonology): number {
  const nuc = nuclei(w);
  const n = nuc.length;
  if (n <= 1) return 0;
  const heavy = (i: number): boolean => {
    const v = w[nuc[i]];
    if (vf(v)?.long) return true;
    const end = i + 1 < n ? nuc[i + 1] : w.length;
    // consonants after nucleus before next nucleus: if ≥2 (medial) or ≥1 (final) → closed
    const after = end - nuc[i] - 1;
    if (i + 1 < n) return after >= 2;
    return after >= 1;
  };
  switch (rule) {
    case "initial":
      return 0;
    case "second":
      return 1;
    case "penult":
      return n - 2;
    case "antepenult":
      return Math.max(0, n - 3);
    case "final":
      return n - 1;
    case "latin":
      if (n === 2) return 0;
      return heavy(n - 2) ? n - 2 : n - 3;
    case "weight":
      if (heavy(n - 1) && vf(w[nuc[n - 1]])?.long) return n - 1;
      if (heavy(n - 2)) return n - 2;
      return Math.max(0, n - 3);
  }
  void ph;
  return 0;
}

/** For each phoneme index: is it the stressed vowel? */
export function stressMask(w: Word, rule: StressRule): boolean[] {
  const nuc = nuclei(w);
  const mask = new Array<boolean>(w.length).fill(false);
  if (nuc.length === 0) return mask;
  const s = stressedSyllable(w, rule);
  mask[nuc[Math.min(s, nuc.length - 1)]] = true;
  return mask;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function onsetOK(t: PhonoTables, seq: string[], initial: boolean): boolean {
  if (seq.length === 0) return true;
  if (seq.length === 1) return t.cons.has(seq[0]) && !(initial && t.initialBanned.has(seq[0]));
  if (initial && t.initialBanned.has(seq[0])) return false;
  return t.onsetClusters.has(key(seq));
}

function codaOK(t: PhonoTables, seq: string[], final: boolean): boolean {
  if (seq.length === 0) return true;
  if (seq.length === 1) return final ? t.finals.has(seq[0]) : t.codas.has(seq[0]);
  return final ? t.finalClusters.has(key(seq)) : t.codaClusters.has(key(seq));
}

/** Whether a medial consonant run (between two vowels) can be split into coda + onset. */
export function medialRunOK(ph: Phonology, run: string[]): boolean {
  const t = tables(ph);
  if (run.length === 0) return ph.hiatus;
  for (let i = 0; i + 1 < run.length; i++) {
    if (run[i] === run[i + 1]) {
      if (!ph.geminates || run.length !== 2) return false;
      // a geminate stands alone between vowels
      return t.cons.has(run[0]) && !isGlide(run[0]) && run[0] !== "h" && run[0] !== "ʔ";
    }
    if (t.banned.has(key([run[i], run[i + 1]]))) return false;
  }
  for (let k = 0; k < run.length; k++) {
    const coda = run.slice(0, k);
    const onset = run.slice(k);
    if (codaOK(t, coda, false) && onsetOK(t, onset, false)) return true;
  }
  return false;
}

/**
 * Whether a word satisfies the phonology's phonotactics. `harmony` checks
 * vowel harmony too (roots only — compounds are exempt, as in real languages).
 */
export function isValidWord(ph: Phonology, w: Word, opts: { harmony?: boolean } = {}): boolean {
  const t = tables(ph);
  if (w.length === 0) return false;
  for (const p of w) if (!t.cons.has(p) && !t.vows.has(p)) return false;
  const nuc = nuclei(w);
  if (nuc.length === 0) return false;
  // initial
  if (!onsetOK(t, w.slice(0, nuc[0]), true)) return false;
  if (nuc[0] === 0 && ph.pInitialVowel <= 0) return false;
  // medial
  for (let i = 0; i + 1 < nuc.length; i++) {
    const run = w.slice(nuc[i] + 1, nuc[i + 1]);
    if (run.length === 0) {
      if (!ph.hiatus) return false;
      if (vowelQuality(w[nuc[i]]) === vowelQuality(w[nuc[i + 1]])) return false;
      continue;
    }
    if (!medialRunOK(ph, run)) return false;
  }
  // final
  const last = nuc[nuc.length - 1];
  if (!codaOK(t, w.slice(last + 1), true)) return false;
  for (let i = 0; i + 1 < w.length; i++) {
    const nx = w[i + 1];
    const v = vf(w[i]);
    if (v) {
      // glide after a homorganic vowel ("ij", "uw") is not a diphthong
      if (nx === "j" && v.back === 0 && v.height <= 1 && !isVowel(w[i + 2] ?? "")) return false;
      if (nx === "w" && v.back === 2 && v.round && v.height <= 2 && !isVowel(w[i + 2] ?? "")) return false;
      continue;
    }
    // *ji, *wu: glides before their own vowel are avoided by most languages
    const nf = vf(nx);
    if (nf && w[i] === "j" && nf.back === 0 && nf.height <= 1 && !nf.round) return false;
    if (nf && w[i] === "w" && nf.back === 2 && nf.round && nf.height <= 1) return false;
    // palatal or postalveolar consonant + j
    if (nx === "j") {
      const pl = cf(w[i])?.place;
      if (pl === "palatal" || pl === "postalveolar" || pl === "alveolopalatal") return false;
    }
  }
  if (opts.harmony && ph.harmony !== "none") {
    let cls = 0;
    for (const i of nuc) {
      const c = t.harmonyClass.get(w[i]) ?? 0;
      if (c === 0) continue;
      if (cls === 0) cls = c;
      else if (c !== cls) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Generation of proto-language phonologies
// ---------------------------------------------------------------------------

type SyllType = "CV" | "CVN" | "CVC" | "CCVC" | "CCVCC" | "heavy";
type Laryngeal = "plain" | "voice" | "asp" | "voice+asp" | "ejective" | "voice+ejective";

interface Profile {
  syll: SyllType;
  consTarget: number;
  laryngeal: Laryngeal;
  uvular: boolean;
  pharyngeal: boolean;
  retroflex: boolean;
  palatal: boolean;
  labiovelar: boolean;
  glottal: boolean;
  latFric: boolean;
  latAffricate: boolean;
  fricRich: number;
  vowelSystem: string;
  long: number; // 0 none, 1 partial, 2 full
  nasalV: boolean;
  harmony: Harmony;
  stress: StressRule;
  geminates: boolean;
  prenasal: boolean;
}

type FW = Partial<Record<Flavour, number>>;
function fw(flavour: Flavour | null, m: FW): number {
  return flavour ? (m[flavour] ?? 1) : 1;
}

function pickProfile(rng: Rng, flavour: Flavour | null): Profile {
  const syll = rng.weighted<SyllType>([
    ["CV", 0.8 * fw(flavour, { islands: 5, jungle: 2, plains: 1.3, mountains: 0.3, desert: 0.3, forest: 0.6 })],
    ["CVN", 0.9 * fw(flavour, { islands: 1.6, jungle: 3, plains: 2.2, river: 1.4, mountains: 0.4 })],
    ["CVC", 1.6 * fw(flavour, { desert: 2.5, steppe: 2.5, tundra: 2, islands: 0.3, river: 1.4 })],
    ["CCVC", 1.5 * fw(flavour, { forest: 2, coast: 1.6, mountains: 1.3, islands: 0.2, jungle: 0.4 })],
    ["CCVCC", 1.0 * fw(flavour, { forest: 1.8, coast: 1.2, mountains: 1.8, islands: 0.1, jungle: 0.3, plains: 0.6 })],
    ["heavy", 0.45 * fw(flavour, { mountains: 4.5, forest: 1.2, islands: 0.05, jungle: 0.2 })],
  ]);
  const baseTarget: Record<SyllType, [number, number]> = {
    CV: [9, 15],
    CVN: [11, 19],
    CVC: [14, 23],
    CCVC: [16, 24],
    CCVCC: [17, 26],
    heavy: [20, 30],
  };
  let [lo, hi] = baseTarget[syll];
  if (flavour === "islands") hi -= 3;
  if (flavour === "mountains") lo += 2;
  const consTarget = Math.max(10, Math.min(30, rng.int(lo, hi)));

  const small = consTarget < 14;
  const big = consTarget >= 19;
  const laryngeal = rng.weighted<Laryngeal>([
    ["plain", (small ? 3 : 0.6) * fw(flavour, { islands: 4, jungle: 1.5, tundra: 1.5 })],
    ["voice", 3 * fw(flavour, { desert: 1.4, steppe: 1.4, forest: 1.3, coast: 1.3, islands: 0.3 })],
    ["asp", (small ? 0.15 : 0.8) * fw(flavour, { river: 1.6, plains: 1.4, steppe: 1.2, islands: 0.3 })],
    ["voice+asp", (big ? 0.6 : 0) * fw(flavour, { river: 2, plains: 1.8, jungle: 1.2, islands: 0.1 })],
    ["ejective", (small ? 0.1 : 0.35) * fw(flavour, { mountains: 5, desert: 1.3, islands: 0.2 })],
    ["voice+ejective", (big ? 0.45 : 0) * fw(flavour, { mountains: 6, islands: 0.1 })],
  ]);
  const p = (base: number, m: FW) => rng.chance(Math.min(0.95, base * fw(flavour, m)));
  const vowelSystem = rng.weighted<string>([
    ["3", 0.12 * fw(flavour, { desert: 5, islands: 1.4, tundra: 1.2 })],
    ["4", 0.08],
    ["5", 1.0],
    ["6a", 0.35 * fw(flavour, { forest: 1.4, coast: 1.2 })],
    ["6b", 0.2 * fw(flavour, { mountains: 1.6, steppe: 1.3 })],
    ["7", 0.35 * fw(flavour, { coast: 1.5, river: 1.3 })],
    ["7b", 0.15 * fw(flavour, { mountains: 1.4 })],
    ["harmony8", 0.22 * fw(flavour, { steppe: 6, tundra: 5, forest: 1.5, islands: 0.1, desert: 0.3 })],
    ["9", 0.12 * fw(flavour, { forest: 1.8, coast: 1.4 })],
  ]);
  const harmony: Harmony =
    vowelSystem === "harmony8" ? (rng.chance(0.85) ? "palatal" : "rounding") : rng.chance(0.03) ? "rounding" : "none";
  const longR = rng.next() / fw(flavour, { desert: 2.2, tundra: 2.2, islands: 1.6, steppe: 1.3, jungle: 0.6 });
  const long = longR < 0.18 ? 2 : longR < 0.3 ? 1 : 0;
  const stress = rng.weighted<StressRule>([
    ["initial", 1.0 * fw(flavour, { tundra: 3, forest: 1.6, steppe: 0.6, coast: 1.2 })],
    ["penult", 1.5 * fw(flavour, { islands: 1.8, jungle: 1.3 })],
    ["final", 0.55 * fw(flavour, { steppe: 3.5, mountains: 1.2 })],
    ["antepenult", 0.15],
    ["latin", 0.4 * fw(flavour, { coast: 1.5, river: 1.3 })],
    ["weight", 0.35 * fw(flavour, { desert: 4 })],
    ["second", 0.08],
  ]);
  return {
    syll,
    consTarget,
    laryngeal,
    uvular: p(0.13, { desert: 3, mountains: 3, steppe: 2.2, tundra: 2, islands: 0.2 }),
    pharyngeal: p(0.04, { desert: 6, mountains: 1.5 }),
    retroflex: p(0.08, { jungle: 1.8, plains: 1.8, river: 1.6 }),
    palatal: p(0.08, { tundra: 1.5, plains: 1.3 }),
    labiovelar: p(0.08, { mountains: 2.2, jungle: 1.8 }),
    glottal: p(0.22, { islands: 3, jungle: 1.6, desert: 1.8, forest: 0.6 }),
    latFric: p(0.07, { mountains: 2.5, coast: 1.6, jungle: 1.2 }),
    latAffricate: p(0.04, { jungle: 4, mountains: 2.5 }),
    fricRich: rng.range(0.1, 1) * (flavour === "islands" ? 0.5 : 1),
    vowelSystem,
    long,
    nasalV: p(0.09, { jungle: 4, plains: 1.6, river: 1.4 }),
    harmony,
    stress,
    geminates: (syll !== "CV" && syll !== "CVN" ? 1 : 0.3) * fw(flavour, { tundra: 3, desert: 2.4, steppe: 1.4 }) * 0.18 > rng.next(),
    prenasal: (syll === "CV" || syll === "CVN") && p(0.22, { jungle: 2.5, plains: 2.5, river: 1.3 }),
  };
}

const VOWEL_SYSTEMS: Record<string, string[][]> = {
  "3": [["a", "i", "u"]],
  "4": [["a", "e", "i", "o"], ["a", "i", "u", "ə"], ["a", "e", "i", "u"]],
  "5": [["a", "e", "i", "o", "u"]],
  "6a": [["a", "e", "i", "o", "u", "ə"]],
  "6b": [["a", "e", "i", "o", "u", "ɨ"], ["a", "e", "i", "o", "u", "æ"]],
  "7": [["a", "e", "ɛ", "i", "o", "ɔ", "u"], ["a", "e", "i", "o", "u", "ɨ", "ə"]],
  "7b": [["a", "e", "i", "o", "u", "ə", "ɨ"], ["a", "e", "i", "o", "u", "y", "ø"]],
  harmony8: [
    ["a", "e", "i", "o", "u", "y", "ø", "ɯ"],
    ["a", "æ", "e", "i", "o", "u", "y", "ø"],
    ["a", "e", "i", "o", "u", "y", "ø"],
  ],
  "9": [["a", "e", "ɛ", "i", "o", "ɔ", "u", "y", "ø"], ["a", "e", "i", "o", "u", "y", "ø", "æ", "ə"], ["a", "e", "ɛ", "i", "o", "ɔ", "u", "ə", "ɨ"]],
};

// Markedness-based base weights
const ONSET_BASE: Record<string, number> = {
  t: 10, k: 9.5, n: 8, m: 8, s: 8, p: 7, l: 7, r: 7, ɾ: 7, d: 6, b: 6, g: 5, h: 5.5, j: 4.5, w: 4.5,
  ʃ: 4, f: 4, tʃ: 3.5, ts: 3, z: 3, v: 3.5, x: 3, q: 3.2, ʔ: 3.5, ŋ: 1.2, ɲ: 2.5, dʒ: 3, θ: 2.6, ð: 2.2,
  χ: 2.8, ħ: 2.6, ʕ: 2.2, ɣ: 2, ʒ: 2, ɬ: 2.6, tɬ: 2.6, kʷ: 2.5, c: 2.5, ɟ: 2,
};
const CODA_BASE: Record<string, number> = {
  n: 10, r: 8, ɾ: 7, l: 7, s: 7, m: 6, t: 5, k: 5, ŋ: 6, j: 4, w: 3.5, ʃ: 3, x: 3, p: 3, d: 3, g: 2.5,
  b: 2, f: 2.5, ts: 1.5, tʃ: 1.5, q: 2.5, χ: 2.5, ħ: 2, z: 2, v: 2, h: 1, ʔ: 2.5, ɬ: 2, θ: 2, ð: 2,
};
const VOWEL_BASE: Record<string, number> = { a: 10, i: 8, u: 7, e: 7, o: 6, ə: 4.5, ɨ: 3.5, ɛ: 4, ɔ: 3.5, y: 3, ø: 2.5, æ: 3.5, ɯ: 3 };

function zipf(items: string[], base: (p: string) => number, rng: Rng, spread: number, boost: Set<string>): Record<string, number> {
  const scored = items.map((p) => ({ p, s: base(p) * Math.exp(rng.normal(0, spread)) * (boost.has(p) ? 3.2 : 1) }));
  scored.sort((a, b) => b.s - a.s || (a.p < b.p ? -1 : 1));
  const out: Record<string, number> = {};
  scored.forEach((x, i) => (out[x.p] = +(1 / Math.pow(i + 1.5, 0.95)).toFixed(4)));
  // keep original item order in the record (deterministic, inventory order)
  const ordered: Record<string, number> = {};
  for (const p of items) ordered[p] = out[p];
  return ordered;
}

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

function buildConsonants(rng: Rng, pr: Profile, flavour: Flavour | null): string[] {
  const set: string[] = [];
  const add = (p: string | null) => {
    if (p && features(p) && !set.includes(p)) set.push(p);
  };
  const voice = pr.laryngeal.includes("voice");
  const asp = pr.laryngeal.includes("asp");
  const ej = pr.laryngeal.includes("ejective");
  const places = ["p", "t", "k"];
  if (pr.retroflex) places.push("ʈ");
  if (pr.palatal) places.push("c");
  if (pr.uvular) places.push("q");
  const dropP = voice && rng.chance(0.08);
  for (const s of places) {
    if (!(s === "p" && dropP)) add(s);
    if (voice && s !== "q") add(modify(s, { voice: true }));
    if (asp) add(modify(s, { asp: true }));
    if (pr.laryngeal === "voice+asp" && s !== "q" && rng.chance(0.6)) add(modify(s, { voice: true, asp: true }));
    if (ej && s !== "p") add(modify(s, { ejective: true }));
    if (ej && s === "p" && rng.chance(0.4)) add("pʼ");
  }
  if (pr.glottal) add("ʔ");
  if (pr.labiovelar) {
    add("kʷ");
    if (voice && rng.chance(0.6)) add("gʷ");
    if (pr.uvular && rng.chance(0.4)) add("qʷ");
  }
  // nasals
  add("m");
  add("n");
  if (rng.chance(pr.syll === "CVN" ? 0.8 : 0.45)) add("ŋ");
  if (pr.palatal || rng.chance(0.18)) add("ɲ");
  if (pr.retroflex && rng.chance(0.7)) add("ɳ");
  // fricatives
  const fr = 0.45 + pr.fricRich;
  const fp = (x: number) => rng.chance(Math.min(0.97, x * fr));
  if (rng.chance(0.95)) add("s");
  if (fp(flavour === "islands" ? 0.9 : 0.6)) add("h");
  if (fp(0.45)) add("f");
  if (fp(0.42)) add("ʃ");
  if (pr.uvular ? fp(0.7) : fp(0.32)) add(pr.uvular && rng.chance(0.6) ? "χ" : "x");
  if (voice && fp(0.42)) add("z");
  if (fp(voice ? 0.35 : 0.08)) add("v");
  if (fp(0.11 * fw(flavour, { coast: 1.8, forest: 1.5, desert: 1.5 }))) {
    add("θ");
    if (voice && rng.chance(0.6)) add("ð");
  }
  if (voice && fp(0.13)) add("ɣ");
  if (voice && set.includes("ʃ") && fp(0.3)) add("ʒ");
  if (pr.pharyngeal) {
    add("ħ");
    if (rng.chance(0.7)) add("ʕ");
  }
  if (pr.latFric) add("ɬ");
  if (fp(0.03)) add(rng.chance(0.5) ? "ɸ" : "β");
  if (pr.retroflex && fp(0.4)) add("ʂ");
  if (fp(0.03)) add("ɕ");
  // affricates
  if (rng.chance(0.3)) {
    add("ts");
    if (voice && rng.chance(0.3)) add("dz");
    if (ej && rng.chance(0.6)) add("tsʼ");
    if (asp && rng.chance(0.5)) add("tsʰ");
  }
  if (rng.chance(0.45)) {
    add("tʃ");
    if (voice && rng.chance(0.65)) add("dʒ");
    if (ej && rng.chance(0.6)) add("tʃʼ");
    if (asp && rng.chance(0.5)) add("tʃʰ");
  }
  if (pr.latAffricate) add("tɬ");
  // liquids
  const rType = rng.weighted<string>([
    ["r", 0.45],
    ["ɾ", 0.32],
    ["none", flavour === "islands" ? 0.35 : 0.08],
    ["both", 0.04],
  ]);
  if (rType === "r" || rType === "both") add("r");
  if (rType === "ɾ" || rType === "both") add("ɾ");
  const dropL = rType !== "none" && pr.syll === "CV" && rng.chance(0.25);
  if (!dropL && (rType === "none" || rng.chance(0.88))) add("l");
  if (rng.chance(0.04)) add("ʎ");
  if (pr.retroflex && rng.chance(0.4)) add("ɭ");
  // glides
  if (rng.chance(0.9)) add("j");
  if (rng.chance(0.85)) add("w");
  if (pr.uvular && rng.chance(0.3)) add("ʁ");

  // adjust towards the target size
  const essential = new Set(["p", "t", "k", "m", "n", "s", "l", "r", "ɾ", "j", "w", "h"]);
  const removable = (): string[] => {
    const order = ["ʒ", "ɣ", "ð", "dz", "ʎ", "ɕ", "β", "ɸ", "gʷ", "qʷ", "ɭ", "ʂ", "ɳ", "v", "z", "tsʰ", "tʃʰ", "dʒ", "θ", "f", "ɲ", "x", "ʃ", "ŋ", "ts"];
    return order.filter((x) => set.includes(x) && !essential.has(x));
  };
  while (set.length > pr.consTarget) {
    const r = removable();
    if (r.length === 0) {
      // drop marked series members at marked places first (qʰ, ʈʰ, bʱ, …)
      const marked = set.filter((x) => {
        const f = cf(x)!;
        return (f.asp || f.ejective || (f.voice && f.manner === "stop")) && !["b", "d", "g"].includes(x);
      });
      if (marked.length === 0 || set.length <= pr.consTarget + 2) break;
      marked.sort((a, b) => (cf(b)!.asp && cf(b)!.voice ? 1 : 0) - (cf(a)!.asp && cf(a)!.voice ? 1 : 0) || (["q", "ʈ", "c"].some((x) => b.startsWith(x)) ? 1 : 0) - (["q", "ʈ", "c"].some((x) => a.startsWith(x)) ? 1 : 0));
      set.splice(set.indexOf(marked[0]), 1);
      continue;
    }
    const victim = r[0];
    set.splice(set.indexOf(victim), 1);
  }
  const extras = ["ŋ", "ʃ", "h", "f", "x", "ts", "tʃ", "z", "v", "ɲ", "j", "w", "l", "r", "dʒ", "ʒ", "θ", "ɣ"];
  let guard = 0;
  while (set.length < pr.consTarget && guard++ < 50) {
    const cand = extras.filter((x) => !set.includes(x) && (voice || !["z", "v", "dʒ", "ʒ", "ɣ"].includes(x)));
    if (cand.length === 0) break;
    add(cand[Math.min(cand.length - 1, Math.floor(rng.next() * Math.min(4, cand.length)))]);
  }
  return set;
}

function buildVowels(rng: Rng, pr: Profile): string[] {
  const opts = VOWEL_SYSTEMS[pr.vowelSystem];
  const base = opts[Math.floor(rng.next() * opts.length)].slice();
  const out = base.slice();
  if (pr.long === 2) for (const v of base) out.push(lengthen(v));
  else if (pr.long === 1) for (const v of base) if (["a", "e", "i", "o", "u"].includes(v) && rng.chance(0.75)) out.push(lengthen(v));
  if (pr.nasalV) for (const v of base) if (["a", "e", "i", "o", "u"].includes(v) && rng.chance(0.7)) out.push(modify(v, { nasal: true })!);
  return out;
}

function chooseClusters(rng: Rng, pr: Profile, cons: string[]) {
  const has = (p: string) => cons.includes(p);
  const liquids = cons.filter((c) => isLiquid(c));
  const stops = cons.filter((c) => isStop(c) && c !== "ʔ");
  const fricOK = cons.filter((c) => ["f", "v", "θ", "x", "ʃ", "χ"].includes(c));
  const onset: string[][] = [];
  const addO = (c: string[], p: number) => {
    if (c.every(has) && rng.chance(p) && !onset.some((o) => key(o) === key(c))) onset.push(c);
  };
  const complex = pr.syll === "CCVC" || pr.syll === "CCVCC" || pr.syll === "heavy";
  if (complex) {
    for (const s of [...stops, ...fricOK]) {
      for (const l of liquids) {
        const f = cf(s)!;
        if ((f.place === "alveolar" || f.place === "dental") && cf(l)!.manner === "lateral") {
          addO([s, l], 0.12);
          continue;
        }
        if (f.ejective || f.lab) {
          addO([s, l], 0.15);
          continue;
        }
        addO([s, l], f.asp ? 0.25 : 0.62);
      }
    }
    for (const st of ["p", "t", "k"]) addO(["s", st], 0.55);
    if (has("ʃ")) for (const st of ["p", "t", "k"]) addO(["ʃ", st], 0.2);
    addO(["s", "m"], 0.25);
    addO(["s", "n"], 0.2);
    addO(["s", "w"], 0.2);
    addO(["s", "l"], 0.3);
    for (const c of ["k", "g", "t", "d", "p", "b", "h", "x", "s", "ts"]) addO([c, "w"], 0.22);
    for (const c of ["k", "g", "p", "b", "m", "n", "t", "d", "s"]) addO([c, "j"], 0.14);
    if (pr.syll !== "CCVC") {
      for (const st of ["p", "t", "k"]) for (const l of liquids) addO(["s", st, l], st === "t" && cf(l)!.manner === "lateral" ? 0 : 0.35);
    }
    if (pr.syll === "heavy") {
      const obs = cons.filter((c) => isObstruent(c) && c !== "ʔ" && c !== "h");
      let n = rng.int(8, 22);
      let guard = 0;
      while (n > 0 && guard++ < 200) {
        const a = obs[Math.floor(rng.next() * obs.length)];
        const b = [...obs, ...cons.filter((c) => isNasal(c) || c === "v" || c === "w")][Math.floor(rng.next() * (obs.length + 2))];
        if (!a || !b || a === b) continue;
        const fa = cf(a)!;
        const fb = cf(b)!;
        if (fa.place === fb.place && fa.manner === fb.manner) continue;
        // voicing harmony in obstruent clusters (Georgian-like "harmonic clusters")
        if (isObstruent(b) && fa.voice !== fb.voice) continue;
        if (isAffricate(a) && isAffricate(b)) continue;
        addO([a, b], 1);
        n--;
      }
      for (const n2 of ["m", "n"]) for (const c of ["t", "d", "k", "g", "z", "s"]) addO([n2, c], 0.08);
    }
  } else if (pr.syll === "CVC" || pr.syll === "CV") {
    for (const c of ["k", "g", "t", "d", "p", "b", "x", "s", "q"]) addO([c, "w"], pr.syll === "CVC" ? 0.15 : 0.05);
    for (const c of ["k", "p", "b", "m", "n", "t"]) addO([c, "j"], pr.syll === "CVC" ? 0.1 : 0.04);
  }
  if (pr.prenasal) {
    addO(["m", "b"], 0.95);
    addO(["n", "d"], 0.95);
    addO(["ŋ", "g"], 0.8);
    addO(["m", "p"], 0.4);
    addO(["n", "t"], 0.4);
    addO(["ŋ", "k"], 0.35);
    addO(["n", "dʒ"], 0.4);
    addO(["n", "z"], 0.3);
  }

  // codas
  let codas: string[] = [];
  let finals: string[] = [];
  const codaClusters: string[][] = [];
  const finalClusters: string[][] = [];
  const sonor = cons.filter((c) => isNasal(c) || isLiquid(c));
  const goodCoda = (c: string) => {
    const f = cf(c)!;
    if (f.asp || f.ejective || f.lab) return false;
    if (c === "h" || c === "ʔ" || c === "j" || c === "w") return false;
    return true;
  };
  switch (pr.syll) {
    case "CV":
      break;
    case "CVN": {
      const ns = cons.filter((c) => isNasal(c) && c !== "ɲ" && c !== "ɳ");
      codas = rng.chance(0.5) ? ns : ns.filter((c) => c === "n" || c === "ŋ");
      if (codas.length === 0) codas = ["n"];
      finals = rng.chance(0.6) ? codas.slice() : codas.filter((c) => c === "n" || c === "ŋ");
      if (finals.length === 0) finals = codas.slice(0, 1);
      break;
    }
    case "CVC": {
      codas = [...sonor.filter((c) => c !== "ɲ"), ...cons.filter((c) => c === "s")];
      const obs = cons.filter((c) => isObstruent(c) && goodCoda(c) && c !== "s");
      for (const o of obs) if (rng.chance(0.35)) codas.push(o);
      finals = rng.chance(0.6) ? codas.slice() : codas.filter((c) => isNasal(c) || isLiquid(c) || c === "s" || rng.chance(0.3));
      break;
    }
    default: {
      codas = cons.filter((c) => goodCoda(c) && (rng.chance(0.85) || isNasal(c) || isLiquid(c) || c === "s"));
      finals = codas.filter((c) => rng.chance(0.9) || isNasal(c) || isLiquid(c));
      if (pr.syll === "CCVCC" || pr.syll === "heavy") {
        const fric = cons.filter((c) => isFricative(c) && goodCoda(c));
        const stopsC = stops.filter(goodCoda);
        const addC = (c: string[], p: number) => {
          if (c.every(has) && rng.chance(p) && !codaClusters.some((o) => key(o) === key(c))) codaClusters.push(c);
        };
        for (const s of sonor)
          for (const o of [...stopsC, ...fric]) {
            const fs = cf(s)!;
            const fo = cf(o)!;
            // nasal + stop must be homorganic
            if (fs.manner === "nasal" && !(fo.place === fs.place || (fs.place === "alveolar" && (fo.place === "dental" || fo.place === "alveolar")))) continue;
            addC([s, o], fs.manner === "nasal" ? 0.7 : 0.4);
          }
        for (const f of fric)
          for (const s of stopsC) {
            const ff = cf(f)!;
            const fs = cf(s)!;
            if (ff.voice !== fs.voice) continue;
            // no homorganic non-sibilant fricative+stop codas (*fp, *xk, *θt)
            if (f !== "s" && f !== "ʃ" && (ff.place === fs.place || (ff.place === "labiodental" && fs.place === "bilabial") || (ff.place === "dental" && fs.place === "alveolar"))) continue;
            addC([f, s], f === "s" || f === "x" || f === "f" ? 0.5 : 0.15);
          }
        for (const s of stopsC) if (!cf(s)!.voice) addC([s, "s"], has("ts") && s === "t" ? 0 : 0.3);
        if (pr.syll === "heavy") for (const s of stopsC) for (const t of stopsC) if (s !== t && cf(s)!.voice === cf(t)!.voice) addC([s, t], 0.2);
        for (const c of codaClusters) if (rng.chance(0.85)) finalClusters.push(c);
      }
    }
  }
  return { onset, codas, finals, codaClusters, finalClusters };
}

function canonOf(pr: Profile, onsetClusters: string[][], codas: string[], codaClusters: string[][], pInitialVowel: number): string {
  const maxOn = onsetClusters.reduce((m, c) => Math.max(m, c.length), 1);
  const maxCo = codaClusters.length ? 2 : codas.length ? 1 : 0;
  const on = pInitialVowel > 0 ? "(C)".repeat(maxOn) : "C" + "(C)".repeat(maxOn - 1);
  const co = maxCo === 0 ? "" : codas.every((c) => isNasal(c)) ? "(N)" : "(C)".repeat(maxCo);
  void pr;
  return `${on}V${co}`;
}

export function generatePhonology(rng: Rng, flavour: Flavour | null): Phonology {
  const pr = pickProfile(rng, flavour);
  const consonants = buildConsonants(rng, pr, flavour);
  const vowels = buildVowels(rng, pr);
  const cl = chooseClusters(rng, pr, consonants);

  // signature: a couple of marked consonants this language loves
  const marked = consonants.filter((c) => !["t", "k", "n", "m", "s", "p", "l", "r", "d", "b", "j", "w"].includes(c));
  const boost = new Set<string>();
  for (let i = 0; i < 2 && marked.length; i++) if (rng.chance(0.75)) boost.add(marked[Math.floor(rng.next() * marked.length)]);
  const spread = rng.range(0.45, 0.9);
  const wOnset = zipf(consonants, (p) => baseWeight(ONSET_BASE, p, 2), rng, spread, boost);
  const wCoda = zipf(cl.codas.length ? cl.codas : [], (p) => baseWeight(CODA_BASE, p, 2), rng, spread, boost);
  const vBoost = new Set<string>();
  if (rng.chance(0.5)) vBoost.add(vowels[Math.floor(rng.next() * Math.min(vowels.length, 9))]);
  const wVowel = zipf(vowels, (p) => baseWeight(VOWEL_BASE, p, 3), rng, 0.4, vBoost);

  const initialBanned: string[] = [];
  for (const c of consonants) {
    if (c === "ŋ" && rng.chance(0.75)) initialBanned.push(c);
    else if ((c === "ɳ" || c === "ɭ" || c === "ʈ" || c === "ɖ") && rng.chance(0.4)) initialBanned.push(c);
    else if (c === "ɾ" && rng.chance(0.3)) initialBanned.push(c);
  }

  const pInitialVowel =
    flavour === "desert" && pr.glottal ? 0.02 : pr.syll === "CV" ? rng.range(0.08, 0.3) : rng.range(0.06, 0.28);
  const hiatus = (pr.syll === "CV" && rng.chance(0.6)) || rng.chance(0.06);
  const complexOnset = cl.onset.length > 0;

  const syllLen: Record<SyllType, number[]> = {
    CV: [0.05, 0.45, 0.4, 0.1],
    CVN: [0.08, 0.55, 0.32, 0.05],
    CVC: [0.18, 0.6, 0.2, 0.02],
    CCVC: [0.32, 0.55, 0.12, 0.01],
    CCVCC: [0.45, 0.47, 0.08, 0],
    heavy: [0.42, 0.48, 0.1, 0],
  };
  const wordLength = syllLen[pr.syll].map((x) => x * Math.exp(rng.normal(0, 0.3)));

  const pCoda =
    pr.syll === "CV" ? 0 : pr.syll === "CVN" ? rng.range(0.12, 0.3) : pr.syll === "CVC" ? rng.range(0.22, 0.4) : rng.range(0.25, 0.45);
  const pFinalCoda = pr.syll === "CV" ? 0 : pr.syll === "CVN" ? rng.range(0.15, 0.45) : rng.range(0.3, 0.75);

  const ph: Phonology = {
    consonants,
    vowels,
    wOnset,
    wCoda,
    wVowel,
    onsetClusters: cl.onset,
    codaClusters: cl.codaClusters,
    finalClusters: cl.finalClusters,
    codas: cl.codas,
    finals: cl.finals,
    initialBanned,
    pInitialVowel,
    hiatus,
    geminates: pr.geminates && cl.codas.length > 0,
    pCoda,
    pFinalCoda: cl.finals.length ? pFinalCoda : 0,
    pCluster: complexOnset ? (pr.syll === "heavy" ? rng.range(0.25, 0.4) : pr.prenasal ? rng.range(0.12, 0.25) : rng.range(0.08, 0.22)) : 0,
    pCodaCluster: cl.codaClusters.length ? rng.range(0.08, 0.2) : 0,
    wordLength,
    harmony: pr.harmony,
    stress: pr.stress,
    canon: "",
  };
  // With only a handful of clusters, each would otherwise recur too often.
  if (cl.onset.length && cl.onset.length < 8) ph.pCluster *= Math.max(0.25, cl.onset.length / 8);
  ph.canon = canonOf(pr, cl.onset, cl.codas, cl.codaClusters, pInitialVowel);
  return ph;
}

// ---------------------------------------------------------------------------
// Empirical phonology (for daughter languages, after sound change)
// ---------------------------------------------------------------------------

/**
 * Re-derive phonotactics from a corpus of words (the evolved lexicon). Used
 * for daughter languages, whose phonotactics emerge from history rather than
 * from a template. `prev` supplies parameters that cannot be observed.
 */
export function phonologyFromCorpus(words: Word[], roots: Word[], prev: Phonology, stress: StressRule): Phonology {
  const cCount = new Map<string, number>();
  const onsetCount = new Map<string, number>();
  const codaCount = new Map<string, number>();
  const vCount = new Map<string, number>();
  const onsetCl = new Map<string, string[]>();
  const codaCl = new Map<string, string[]>();
  const finalCl = new Map<string, string[]>();
  const codas = new Set<string>();
  const finals = new Set<string>();
  const initialSeen = new Set<string>();
  let syllables = 0;
  let codaSyl = 0;
  let finalWords = 0;
  let finalCoda = 0;
  let clusterOnsets = 0;
  let onsets = 0;
  let codaClusterN = 0;
  let codaN = 0;
  let initialVowel = 0;
  let hiatus = false;
  let geminates = false;
  const prevOnsets = new Set(prev.onsetClusters.map(key));
  const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

  const onsetSplit = (run: string[]): number => {
    // index where the onset starts within the run (maximal onset under prev clusters or sonority)
    for (let k = 0; k < run.length; k++) {
      const seq = run.slice(k);
      if (seq.length === 1) return k;
      if (seq[0] === seq[1]) continue;
      if (prevOnsets.has(key(seq)) || (seq.length <= 3 && genericOnsetOK(seq))) return k;
    }
    return run.length - 1;
  };

  for (const w of words) {
    const nuc = nuclei(w);
    if (nuc.length === 0) continue;
    for (const p of w) {
      if (isVowel(p)) inc(vCount, p);
      else inc(cCount, p);
    }
    finalWords++;
    syllables += nuc.length;
    const init = w.slice(0, nuc[0]);
    if (init.length === 0) initialVowel++;
    else {
      onsets++;
      initialSeen.add(init[0]);
      if (init.length === 1) inc(onsetCount, init[0]);
      else {
        clusterOnsets++;
        onsetCl.set(key(init), init);
        for (const p of init) inc(onsetCount, p, 0.3);
      }
    }
    for (let i = 0; i + 1 < nuc.length; i++) {
      const run = w.slice(nuc[i] + 1, nuc[i + 1]);
      if (run.length === 0) {
        hiatus = true;
        continue;
      }
      if (run.length === 2 && run[0] === run[1]) {
        geminates = true;
        codas.add(run[0]);
        inc(onsetCount, run[0]);
        inc(codaCount, run[0]);
        codaSyl++;
        codaN++;
        onsets++;
        continue;
      }
      const k = onsetSplit(run);
      const coda = run.slice(0, k);
      const onset = run.slice(k);
      onsets++;
      if (onset.length === 1) inc(onsetCount, onset[0]);
      else if (onset.length > 1) {
        clusterOnsets++;
        onsetCl.set(key(onset), onset);
        for (const p of onset) inc(onsetCount, p, 0.3);
      }
      if (coda.length) {
        codaSyl++;
        codaN++;
        if (coda.length === 1) {
          codas.add(coda[0]);
          inc(codaCount, coda[0]);
        } else {
          codaClusterN++;
          codaCl.set(key(coda), coda);
        }
      }
    }
    const fin = w.slice(nuc[nuc.length - 1] + 1);
    if (fin.length) {
      finalCoda++;
      codaN++;
      if (fin.length === 1) {
        finals.add(fin[0]);
        inc(codaCount, fin[0]);
      } else {
        codaClusterN++;
        finalCl.set(key(fin), fin);
      }
    }
  }
  const consonants = [...cCount.keys()];
  const vowels = [...vCount.keys()];
  // order inventories by place/manner for readability: keep previous order where possible
  const order = (xs: string[], prevOrder: string[]) => {
    const idx = new Map(prevOrder.map((p, i) => [p, i]));
    return xs.slice().sort((a, b) => (idx.get(a) ?? 999) - (idx.get(b) ?? 999) || (a < b ? -1 : 1));
  };
  const cons = order(consonants, prev.consonants);
  const vows = order(vowels, prev.vowels);
  const norm = (m: Map<string, number>, items: string[], floor: number) => {
    const total = items.reduce((s, p) => s + (m.get(p) ?? 0), 0) || 1;
    const out: Record<string, number> = {};
    for (const p of items) out[p] = +(((m.get(p) ?? 0) + floor) / total).toFixed(4);
    return out;
  };
  const initialBanned = cons.filter((c) => !initialSeen.has(c));
  const lens = [0, 0, 0, 0];
  for (const r of roots) {
    const n = Math.max(1, Math.min(4, nuclei(r).length));
    lens[n - 1]++;
  }
  const codasArr = order([...codas], prev.codas.concat(cons));
  const finalsArr = order([...finals], prev.finals.concat(cons));
  const ph: Phonology = {
    consonants: cons,
    vowels: vows,
    wOnset: norm(onsetCount, cons, 0.3),
    wCoda: norm(codaCount, [...new Set([...codasArr, ...finalsArr])], 0.2),
    wVowel: norm(vCount, vows, 0.3),
    onsetClusters: [...onsetCl.values()],
    codaClusters: [...codaCl.values()],
    finalClusters: [...finalCl.values()],
    codas: codasArr,
    finals: finalsArr,
    initialBanned,
    pInitialVowel: finalWords ? +(initialVowel / finalWords).toFixed(3) : prev.pInitialVowel,
    hiatus,
    geminates,
    pCoda: syllables ? +Math.min(0.6, codaSyl / Math.max(1, syllables - finalWords)).toFixed(3) : prev.pCoda,
    pFinalCoda: finalWords ? +(finalCoda / finalWords).toFixed(3) : prev.pFinalCoda,
    pCluster: onsets ? +Math.min(0.45, clusterOnsets / onsets).toFixed(3) : 0,
    pCodaCluster: codaN ? +Math.min(0.4, codaClusterN / codaN).toFixed(3) : 0,
    wordLength: lens.map((x) => x / Math.max(1, roots.length)),
    harmony: prev.harmony,
    stress,
    canon: "",
  };
  // Harmony survives only if most roots still obey it.
  if (ph.harmony !== "none") {
    let ok = 0;
    let n = 0;
    for (const r of roots) {
      if (nuclei(r).length < 2) continue;
      n++;
      if (isValidWord(ph, r, { harmony: true })) ok++;
    }
    if (n === 0 || ok / n < 0.8) ph.harmony = "none";
    invalidateTables(ph);
  }
  const maxOn = ph.onsetClusters.reduce((m, c) => Math.max(m, c.length), 1);
  const maxCo = Math.max(ph.codaClusters.length || ph.finalClusters.length ? 2 : 0, ph.codas.length || ph.finals.length ? 1 : 0);
  ph.canon = `${ph.pInitialVowel > 0 ? "(C)".repeat(maxOn) : "C" + "(C)".repeat(maxOn - 1)}V${"(C)".repeat(maxCo)}`;
  return ph;
}

/** Number of distinct vowel qualities (ignoring length and nasality). */
export function vowelQualities(ph: Phonology): string[] {
  return [...new Set(ph.vowels.map(vowelQuality))];
}

export function isConsonantPhoneme(p: string): boolean {
  return isConsonant(p);
}
