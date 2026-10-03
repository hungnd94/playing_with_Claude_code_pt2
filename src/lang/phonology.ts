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
  /** Banned consonant + vowel-quality pairs ("t+i"). */
  bannedCV: Set<string>;
  /** Final-syllable vowel pickers per harmony class (wVowel × wFinalV). */
  finalVowelPick: Picker<string>[];
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
  const finalPick = makePicker(ph.finals, ph.finals.map((c) => ph.wFinal?.[c] ?? ph.wCoda[c] ?? 0.5));
  const vowelPick = makePicker(ph.vowels, ph.vowels.map((v) => ph.wVowel[v] ?? 0.5));
  const onsetClusterPick = makePicker(ph.onsetClusters, ph.onsetClusters.map((c) => clusterWeight(ph, c)));
  const initCl = ph.onsetClusters.filter((c) => !initialBanned.has(c[0]));
  const initialClusterPick = makePicker(initCl, initCl.map((c) => clusterWeight(ph, c)));
  const codaClusterPick = makePicker(ph.codaClusters, ph.codaClusters.map((c) => clusterWeight(ph, c)));
  const finalClusterPick = makePicker(ph.finalClusters, ph.finalClusters.map((c) => clusterWeight(ph, c)));

  const harmonyClass = new Map<string, number>();
  for (const v of ph.vowels) harmonyClass.set(v, harmonyClassOf(ph.harmony, v));
  const harmonyPick: Picker<string>[] = [vowelPick];
  const fv = (v: string) => (ph.wVowel[v] ?? 0.5) * (ph.wFinalV?.[vowelQuality(v)] ?? (ph.wFinalV ? 0.4 : 1));
  const finalVowelPick: Picker<string>[] = [makePicker(ph.vowels, ph.vowels.map(fv))];
  for (const cls of [1, 2]) {
    const items = ph.vowels.filter((v) => {
      const hc = harmonyClass.get(v)!;
      return hc === 0 || hc === cls;
    });
    harmonyPick.push(makePicker(items, items.map((v) => ph.wVowel[v] ?? 0.5)));
    finalVowelPick.push(makePicker(items, items.map(fv)));
  }
  const bannedCV = new Set((ph.banned ?? []).map(([c, v]) => c + "+" + v));

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
    bannedCV,
    finalVowelPick,
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

/**
 * Onsets any language could plausibly have when nothing better is known: s + consonant
 * (st, sn, sl), or a non-glottal obstruent + liquid or glide (pr, kl, tw). Anything else
 * (hm, kn, pt) must be a cluster the language itself is known to have.
 */
function genericOnsetOK(seq: string[]): boolean {
  if (seq.length <= 1) return true;
  if (seq.length === 2) {
    const [a, b] = seq;
    if (a === b) return false;
    if ((a === "s" || a === "ʃ") && (isStop(b) || isNasal(b) || isLiquid(b) || isGlide(b))) return true;
    const pl = cf(a)?.place;
    if (!isObstruent(a) || pl === "glottal" || pl === "pharyngeal") return false;
    return sonority(b) >= 6 && sonority(b) > sonority(a) + 1.5;
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

let SCRATCH = new Int32Array(64);

/**
 * Index (into the word) of the stressed vowel, or -1 for a word without vowels.
 * Same rules as `stressedSyllable`, in one allocation-free pass (hot: every
 * stress-conditioned sound change calls it for every word).
 */
export function stressedVowel(w: Word, rule: StressRule): number {
  if (SCRATCH.length < w.length) SCRATCH = new Int32Array(w.length * 2);
  const nuc = SCRATCH;
  let n = 0;
  for (let i = 0; i < w.length; i++) if (isVowel(w[i])) nuc[n++] = i;
  if (n === 0) return -1;
  if (n === 1) return nuc[0];
  const heavy = (i: number): boolean => {
    if (vf(w[nuc[i]])?.long) return true;
    const end = i + 1 < n ? nuc[i + 1] : w.length;
    const after = end - nuc[i] - 1;
    return i + 1 < n ? after >= 2 : after >= 1;
  };
  let s: number;
  switch (rule) {
    case "initial":
      s = 0;
      break;
    case "second":
      s = 1;
      break;
    case "penult":
      s = n - 2;
      break;
    case "antepenult":
      s = Math.max(0, n - 3);
      break;
    case "final":
      s = n - 1;
      break;
    case "latin":
      s = n === 2 ? 0 : heavy(n - 2) ? n - 2 : n - 3;
      break;
    case "weight":
      s = heavy(n - 1) && vf(w[nuc[n - 1]])?.long ? n - 1 : heavy(n - 2) ? n - 2 : Math.max(0, n - 3);
      break;
    default:
      s = 0;
  }
  return nuc[Math.min(Math.max(0, s), n - 1)];
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
    if (nf && t.bannedCV.size && t.bannedCV.has(w[i] + "+" + vowelQuality(nx))) return false;
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
// Empirical phonology (for daughter languages, after sound change)
// ---------------------------------------------------------------------------

/**
 * Re-derive phonotactics from a corpus of words (the evolved lexicon). Used
 * for daughter languages, whose phonotactics emerge from history rather than
 * from a template. `prev` supplies parameters that cannot be observed.
 */
export function phonologyFromCorpus(words: Word[], roots: Word[], prev: Phonology, stress: StressRule, opts: { quick?: boolean } = {}): Phonology {
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
  let gemN = 0;
  let boundaries = 0;
  const finalCount = new Map<string, number>();
  const finalVCount = new Map<string, number>();
  let openFinals = 0;
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

  let nucBuf = new Int32Array(64);
  for (const w of words) {
    // nuclei (allocation-free); single-consonant runs, the common case, take a fast path
    if (nucBuf.length < w.length) nucBuf = new Int32Array(w.length * 2);
    let nN = 0;
    for (let i = 0; i < w.length; i++) if (isVowel(w[i])) nucBuf[nN++] = i;
    if (nN === 0) continue;
    for (const p of w) {
      if (isVowel(p)) inc(vCount, p);
      else inc(cCount, p);
    }
    finalWords++;
    syllables += nN;
    const n0 = nucBuf[0];
    if (n0 === 0) initialVowel++;
    else {
      onsets++;
      initialSeen.add(w[0]);
      if (n0 === 1) inc(onsetCount, w[0]);
      else {
        const init = w.slice(0, n0);
        clusterOnsets++;
        onsetCl.set(key(init), init);
        for (const p of init) inc(onsetCount, p, 0.3);
      }
    }
    for (let i = 0; i + 1 < nN; i++) {
      const a = nucBuf[i] + 1;
      const b = nucBuf[i + 1];
      boundaries++;
      if (b === a) {
        hiatus = true;
        continue;
      }
      if (b - a === 1) {
        onsets++;
        inc(onsetCount, w[a]);
        continue;
      }
      if (b - a === 2 && w[a] === w[a + 1]) {
        geminates = true;
        gemN++;
        inc(onsetCount, w[a]);
        onsets++;
        continue;
      }
      const run = w.slice(a, b);
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
    const lastNuc = nucBuf[nN - 1];
    const finLen = w.length - lastNuc - 1;
    if (finLen === 0 && nN > 1) {
      openFinals++;
      inc(finalVCount, vowelQuality(w[lastNuc]));
    }
    if (finLen === 1) {
      finalCoda++;
      codaN++;
      finals.add(w[lastNuc + 1]);
      inc(codaCount, w[lastNuc + 1]);
      inc(finalCount, w[lastNuc + 1]);
    } else if (finLen > 1) {
      const fin = w.slice(lastNuc + 1);
      finalCoda++;
      codaN++;
      codaClusterN++;
      finalCl.set(key(fin), fin);
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
    style: prev.style,
    wFinal: norm(finalCount, finalsArr, 0.1),
    pGeminate: boundaries ? +Math.min(0.25, gemN / boundaries).toFixed(3) : 0,
  };
  if (!ph.style) delete ph.style;
  // Final-vowel preferences: how much more often a quality ends a word than its overall share.
  if (openFinals > 20) {
    const total = [...vCount.values()].reduce((a, b) => a + b, 0) || 1;
    const byQ = new Map<string, number>();
    for (const [v, n] of vCount) byQ.set(vowelQuality(v), (byQ.get(vowelQuality(v)) ?? 0) + n);
    const wf: Record<string, number> = {};
    for (const [q, n] of byQ) wf[q] = +Math.max(0.15, Math.min(5, ((finalVCount.get(q) ?? 0) / openFinals) / (n / total))).toFixed(3);
    ph.wFinalV = wf;
  }
  // Banned sequences survive only if sound change has not reintroduced them.
  if (prev.banned?.length) {
    const present = new Set<string>();
    for (const w of words) for (let i = 0; i + 1 < w.length; i++) if (!isVowel(w[i]) && isVowel(w[i + 1])) present.add(w[i] + "+" + vowelQuality(w[i + 1]));
    const keep = prev.banned.filter(([c, v]) => cCount.has(c) && !present.has(c + "+" + v));
    if (keep.length) ph.banned = keep;
  }
  // Harmony survives only if most roots still obey it (skipped for quick interim estimates).
  if (ph.harmony !== "none" && !opts.quick) {
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
