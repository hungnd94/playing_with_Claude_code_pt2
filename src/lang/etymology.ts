/**
 * Names through time: `evolveName` pushes a name through the regular sound
 * changes between an ancestor and a descendant (so Kaś-tabar becomes
 * Kešdavar), `borrowName` adapts a foreign name to a language's sounds and
 * phonotactics, and `renderEtymology` writes the chain as an encyclopedia
 * would: "from Old Keshi *Kaś-tabar 'stone ford'".
 */
import { features, isVowel, lengthen, phonemeDistance, shorten, vf, vowelQuality } from "./phoneme";
import { isValidWord, medialRunOK, nuclei, tables } from "./phonology";
import { ipaPhrase, romanizeName, romanizeWord } from "./orthography";
import { applyChanges, applyChangesPhrase } from "./soundchange";
import type { EtymStep, Language, LineageStep, Name, NamePart, Orthography, Word } from "./types";
import { key } from "./util";

/** Citation label for a language when it appears as an ancestor. */
export function ancestorLabel(lang: Pick<Language, "name" | "depth">): string {
  return lang.depth === 0 ? `Proto-${lang.name}` : `Old ${lang.name}`;
}

function segmentedFrom(parts: NamePart[], ortho: Orthography, words: Word[]): string {
  if (!parts.length) return words.map((w) => romanizeWord(ortho, w)).join(" ");
  const out: string[] = [];
  const nWords = Math.max(...parts.map((p) => p.word)) + 1;
  for (let wi = 0; wi < nWords; wi++) {
    const ps = parts.filter((p) => p.word === wi && p.phonemes.length);
    let s = "";
    ps.forEach((p, i) => {
      if (i > 0 && p.role !== "link" && ps[i - 1].role !== "link") s += "-";
      s += romanizeWord(ortho, p.phonemes);
    });
    if (s) out.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  return out.join(" ");
}

function literalGloss(name: Name): string {
  if (!name.gloss) return "";
  if (name.parts.some((p) => p.role === "name")) return name.gloss;
  return name.gloss.toLowerCase();
}

function stepOf(name: Name, lang: string, label: string, ortho: Orthography, star: boolean, how: EtymStep["how"], year?: number): EtymStep {
  return {
    lang,
    label,
    phonemes: name.phonemes.slice(),
    roman: romanizeName(ortho, name.phonemes),
    segmented: segmentedFrom(name.parts, ortho, name.words),
    gloss: literalGloss(name),
    how,
    star,
    year,
  };
}

/** Per-phoneme part index for a name (−1 where parts don't line up). */
function partTags(name: Name): number[] {
  const tags: number[] = [];
  const byWord: number[][] = name.words.map(() => []);
  const ok = name.parts.every((p) => p.word < name.words.length);
  if (ok) {
    name.parts.forEach((p, i) => {
      for (let k = 0; k < p.phonemes.length; k++) byWord[p.word].push(i);
    });
  }
  const aligned = ok && name.words.every((w, wi) => byWord[wi].length === w.length);
  name.words.forEach((w, wi) => {
    if (wi > 0) tags.push(-2);
    for (let k = 0; k < w.length; k++) tags.push(aligned ? byWord[wi][k] : -1);
  });
  return tags;
}

function splitWords(ph: Word): Word[] {
  const out: Word[] = [[]];
  for (const p of ph) {
    if (p === " ") out.push([]);
    else out[out.length - 1].push(p);
  }
  return out;
}

/** Find the lineage steps leading from `from` to `to`, or null if `from` is not an ancestor. */
export function pathBetween(from: Pick<Language, "id">, to: Language): LineageStep[] | null {
  if (from.id === to.id) return [];
  const i = to.lineage.findIndex((s) => s.from === from.id);
  return i < 0 ? null : to.lineage.slice(i);
}

/** The regular descendant of a word (no lexical replacement): parent form → daughter form. */
export function evolveWord(word: Word, from: Pick<Language, "id">, to: Language): Word | null {
  const steps = pathBetween(from, to);
  if (!steps) return null;
  let w = word;
  for (const s of steps) w = applyChanges(s.changes, w, s.stressBefore).word;
  return w;
}

/**
 * Push a name through the sound changes from `fromLang` down to its
 * descendant `toLang`, recording each stage. If `toLang` does not descend
 * from `fromLang`, the name is borrowed instead.
 */
export function evolveName(name: Name, fromLang: Language, toLang: Language): Name {
  if (fromLang.id === toLang.id) return name;
  const steps = pathBetween(fromLang, toLang);
  if (!steps) return borrowName(name, toLang, { from: fromLang });
  const history: EtymStep[] = [...name.history, stepOf(name, fromLang.id, ancestorLabel(fromLang), fromLang.orthography, !fromLang.attested, "inherited", fromLang.year)];
  let ph = name.phonemes;
  let tags = partTags(name);
  let prevKey = key(ph);
  steps.forEach((s, i) => {
    const r = applyChangesPhrase(s.changes, ph, s.stressBefore, tags);
    ph = r.word;
    tags = r.tags;
    if (i < steps.length - 1 && key(ph) !== prevKey) {
      const words = splitWords(ph);
      const parts = regroup(name.parts, ph, tags, s.orthography);
      const tmp: Name = { ...name, phonemes: ph, words, parts };
      history.push(stepOf(tmp, s.to, `Old ${s.toName}`, s.orthography, false, "inherited", s.year));
    }
    prevKey = key(ph);
  });
  const words = splitWords(ph);
  const out: Name = {
    lang: toLang.id,
    kind: name.kind,
    phonemes: ph,
    words,
    roman: romanizeName(toLang.orthography, ph),
    ipa: ipaPhrase(words, toLang.phonology.stress, toLang.phonology),
    gloss: name.gloss,
    parts: regroup(name.parts, ph, tags, toLang.orthography),
    history,
    etym: "",
    meta: name.meta ? { ...name.meta } : undefined,
  };
  if (!out.meta) delete out.meta;
  out.etym = renderEtymology(out);
  return out;
}

function regroup(parts: NamePart[], ph: Word, tags: number[], ortho: Orthography): NamePart[] {
  if (tags.some((t) => t === -1)) {
    // unaligned: one part per word
    return splitWords(ph).map((w, i) => ({ phonemes: w, roman: romanizeWord(ortho, w), gloss: "", role: "name" as const, word: i }));
  }
  const out: NamePart[] = [];
  parts.forEach((p, i) => {
    const seg = ph.filter((_, j) => tags[j] === i);
    if (seg.length === 0) return;
    out.push({ ...p, phonemes: seg, roman: romanizeWord(ortho, seg) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Borrowing
// ---------------------------------------------------------------------------

function nearest(p: string, pool: string[]): string {
  let best = pool[0];
  let bd = Infinity;
  for (const q of pool) {
    const d = phonemeDistance(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Map a word's segments onto a language's inventory (nearest phonemes). */
function mapSegments(word: Word, lang: Language): Word {
  const ph = lang.phonology;
  const t = tables(ph);
  const cons = ph.consonants;
  const vows = ph.vowels;
  const out: string[] = [];
  for (const p of word) {
    if (t.cons.has(p) || t.vows.has(p)) {
      out.push(p);
      continue;
    }
    const f = features(p);
    if (!f) continue;
    if (f.kind === "V") {
      // nasal vowel → oral vowel + n
      let v = p;
      const extra: string[] = [];
      if (f.nasal) {
        const oral = vowelQuality(p);
        v = f.long ? lengthen(oral) : oral;
        if (t.cons.has("n")) extra.push("n");
      }
      if (!t.vows.has(v)) {
        const alt = f.long ? shorten(v) : lengthen(v);
        if (t.vows.has(alt)) v = alt;
        else {
          const sameLen = vows.filter((x) => !!vf(x)!.long === !!vf(v)?.long && !vf(x)!.nasal);
          v = nearest(v, sameLen.length ? sameLen : vows);
        }
      }
      out.push(v, ...extra);
      continue;
    }
    if ((p === "j" || p === "w") && !t.cons.has(p)) {
      const v = p === "j" ? "i" : "u";
      if (t.vows.has(v)) {
        out.push(v);
        continue;
      }
    }
    out.push(nearest(p, cons));
  }
  return out;
}

function onsetAllowed(lang: Language, seq: string[], initial: boolean): boolean {
  const t = tables(lang.phonology);
  if (seq.length === 0) return !initial || lang.phonology.pInitialVowel > 0;
  if (seq.length === 1) return !(initial && t.initialBanned.has(seq[0]));
  if (initial && t.initialBanned.has(seq[0])) return false;
  return t.onsetClusters.has(key(seq));
}

function finalAllowed(lang: Language, seq: string[]): boolean {
  const t = tables(lang.phonology);
  if (seq.length === 0) return true;
  if (seq.length === 1) return t.finals.has(seq[0]);
  return t.finalClusters.has(key(seq));
}

/** Repair a segment string until it satisfies the language's phonotactics. */
export function repairWord(word: Word, lang: Language): Word {
  const ph = lang.phonology;
  const ep = ph.vowels.includes(lang.morphology.epenthetic) ? lang.morphology.epenthetic : ph.vowels.filter((v) => !vf(v)!.long)[0] ?? ph.vowels[0];
  const deletion = lang.morphology.clusterRepair === "deletion";
  const glide = ph.consonants.includes(lang.morphology.glide) ? lang.morphology.glide : ph.consonants[0];
  let w = word.slice();
  if (!w.some(isVowel)) w.push(ep);
  for (let iter = 0; iter < 24; iter++) {
    if (isValidWord(ph, w)) return w;
    const nuc = nuclei(w);
    // initial
    const init = w.slice(0, nuc[0]);
    if (!onsetAllowed(lang, init, true)) {
      if (init.length === 0) {
        // language needs an onset
        w.unshift(glide);
      } else if (init.length === 1) {
        // banned initial consonant: prothetic vowel
        w.unshift(ep);
      } else if (deletion && init.length >= 2) {
        w.splice(0, 1);
      } else {
        w.splice(1, 0, ep);
      }
      continue;
    }
    // medial
    let fixed = false;
    for (let i = 0; i + 1 < nuc.length; i++) {
      const a = nuc[i];
      const b = nuc[i + 1];
      const run = w.slice(a + 1, b);
      if (run.length === 0) {
        if (ph.hiatus && vowelQuality(w[a]) !== vowelQuality(w[b])) continue;
        if (vowelQuality(w[a]) === vowelQuality(w[b])) {
          const L = lengthen(w[a]);
          w.splice(a, 2, ph.vowels.includes(L) ? L : w[a]);
        } else w.splice(b, 0, glide);
        fixed = true;
        break;
      }
      if (!medialRunOK(ph, run)) {
        if (run.length >= 2 && run[0] === run[1]) w.splice(a + 1, 1);
        else if (deletion && run.length >= 3) w.splice(a + 2, 1);
        else if (run.length >= 2) w.splice(a + 2, 0, ep);
        else {
          // a single consonant that cannot stand between vowels: replace with nearest allowed onset
          const pool = ph.consonants.filter((c) => (ph.wOnset[c] ?? 0) > 0);
          w[a + 1] = nearest(run[0], pool.length ? pool : ph.consonants);
        }
        fixed = true;
        break;
      }
    }
    if (fixed) continue;
    // final
    const last = nuc[nuc.length - 1];
    const fin = w.slice(last + 1);
    if (!finalAllowed(lang, fin)) {
      if (fin.length >= 2 && deletion) w.pop();
      else if (fin.length >= 2) w.splice(last + 2, 0, ep);
      else if (ph.pFinalCoda === 0 || !deletion) w.push(ep);
      else w.pop();
      continue;
    }
    // something else (e.g. glide after a matching vowel, banned affricate-like sequence): drop the offender
    let dropped = false;
    for (let i = 0; i + 1 < w.length; i++) {
      const v = vf(w[i]);
      if (v && ((w[i + 1] === "j" && v.back === 0) || (w[i + 1] === "w" && v.back === 2))) {
        w.splice(i + 1, 1);
        dropped = true;
        break;
      }
    }
    if (!dropped) {
      // last resort: CV-ify
      const out: string[] = [];
      for (let i = 0; i < w.length; i++) {
        out.push(w[i]);
        if (!isVowel(w[i]) && !isVowel(w[i + 1] ?? "")) out.push(ep);
      }
      w = out;
    }
  }
  return w;
}

/** Adapt a word to a language: nearest-phoneme mapping plus phonotactic repair. */
export function adaptWord(word: Word, lang: Language): Word {
  return repairWord(mapSegments(word, lang), lang);
}

export interface BorrowOptions {
  /** The source language (for the etymology label). */
  from?: Language;
  /** Label to use if `from` is not available. */
  label?: string;
  year?: number;
}

/** Adapt a foreign name into `toLang`, recording the source. */
export function borrowName(name: Name, toLang: Language, opts: BorrowOptions = {}): Name {
  if (name.lang === toLang.id) return name;
  const words = name.words.map((w) => adaptWord(w, toLang));
  const phonemes: Word = [];
  words.forEach((w, i) => {
    if (i > 0) phonemes.push(" ");
    phonemes.push(...w);
  });
  const srcOrtho = opts.from?.orthography;
  const src: EtymStep = {
    lang: name.lang,
    label: opts.from?.name ?? opts.label ?? name.history[name.history.length - 1]?.label ?? name.lang,
    phonemes: name.phonemes.slice(),
    roman: name.roman,
    segmented: srcOrtho ? segmentedFrom(name.parts, srcOrtho, name.words) : name.roman,
    gloss: literalGloss(name),
    how: "borrowed",
    star: opts.from ? !opts.from.attested : false,
    year: opts.year,
  };
  const out: Name = {
    lang: toLang.id,
    kind: name.kind,
    phonemes,
    words,
    roman: romanizeName(toLang.orthography, phonemes),
    ipa: ipaPhrase(words, toLang.phonology.stress, toLang.phonology),
    gloss: name.gloss,
    parts: words.map((w, i) => ({ phonemes: w, roman: romanizeWord(toLang.orthography, w), gloss: i === 0 ? name.gloss : "", role: "name" as const, word: i })),
    history: [...name.history, src],
    etym: "",
  };
  if (name.meta) out.meta = { ...name.meta };
  out.etym = renderEtymology(out);
  return out;
}

export interface EtymologyRenderOptions {
  /** Override labels (e.g. to use current language names). */
  label?: (step: EtymStep) => string;
  /** Show at most this many stages (most recent first). */
  maxSteps?: number;
}

/** "from Middle Keshi Kešdabar, from Proto-Keshi *Kaś-tabar 'stone ford'". */
export function renderEtymology(name: Name, opts: EtymologyRenderOptions = {}): string {
  const h = name.history;
  if (!h.length) return "";
  const max = opts.maxSteps ?? 4;
  const pieces: string[] = [];
  const start = h.length - 1;
  const stop = Math.max(0, h.length - max);
  for (let i = start; i >= stop; i--) {
    const s = h[i];
    const label = opts.label ? opts.label(s) : s.label;
    let txt = `${s.how === "borrowed" ? "borrowed from" : "from"} ${label} ${s.star ? "*" : ""}${s.segmented}`;
    const oldestShown = i === stop;
    if (s.gloss && (oldestShown || s.how === "borrowed")) txt += ` '${s.gloss}'`;
    pieces.push(txt);
  }
  return pieces.join(", ");
}
