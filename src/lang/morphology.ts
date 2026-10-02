/**
 * Morphology: grammatical typology, affixes (some grammaticalised from lexical
 * roots, so the place suffix may come from the word for "land" and the
 * diminutive from "child"), and joining morphemes with junction repair
 * (vowel harmony in affixes, hiatus repair, nasal assimilation, epenthesis,
 * cluster simplification).
 */
import type { Rng } from "../core/rng";
import { cf, isNasal, isObstruent, isVowel, lengthen, vowelQuality } from "./phoneme";
import { harmonize, harmonyClassOf, isValidWord, medialRunOK, nuclei, tables } from "./phonology";
import type { Affix, AffixKind, Morphology, Phonology, Word, WordOrder } from "./types";
import { key } from "./util";
import { generateAffix, type AffixShape } from "./wordgen";

export interface Morph {
  form: Word;
  /** Affix morphemes harmonise with the preceding stem. */
  affix?: boolean;
}

export interface Joined {
  word: Word;
  /** Morph index per phoneme; -1 for inserted (epenthetic/linking) material. */
  tags: number[];
}

interface LangLike {
  phonology: Phonology;
  morphology: Morphology;
}

function stemHarmonyClass(ph: Phonology, w: Word): number {
  if (ph.harmony === "none") return 0;
  for (let i = w.length - 1; i >= 0; i--) {
    if (!isVowel(w[i])) continue;
    const c = harmonyClassOf(ph.harmony, w[i]);
    if (c !== 0) return c;
  }
  return 0;
}

function harmonizeAffix(ph: Phonology, stem: Word, aff: Word): Word {
  if (ph.harmony === "none") return aff;
  const cls = stemHarmonyClass(ph, stem);
  if (cls === 0) return aff;
  const inv = tables(ph).vows;
  return aff.map((p) => (isVowel(p) ? harmonize(ph.harmony, p, cls, inv) : p));
}

function homorganicNasal(ph: Phonology, before: string): string | null {
  const f = cf(before);
  if (!f) return null;
  const inv = tables(ph).cons;
  const cand =
    f.place === "bilabial" || f.place === "labiodental"
      ? "m"
      : f.place === "velar"
        ? "ŋ"
        : f.place === "palatal"
          ? "ɲ"
          : f.place === "uvular"
            ? "ŋ"
            : "n";
  return inv.has(cand) ? cand : null;
}

/** Check a consonant junction: the run of consonants spanning the boundary. */
function junctionOK(ph: Phonology, a: Word, b: Word): boolean {
  let i = a.length;
  while (i > 0 && !isVowel(a[i - 1])) i--;
  let j = 0;
  while (j < b.length && !isVowel(b[j])) j++;
  const run = [...a.slice(i), ...b.slice(0, j)];
  const t = tables(ph);
  const aHasV = i > 0;
  const bHasV = j < b.length;
  if (!aHasV) {
    // a is all consonants: run is an onset
    if (run.length === 1) return true;
    return t.onsetClusters.has(key(run));
  }
  if (!bHasV) {
    // b is all consonants: run is a final coda
    if (run.length === 1) return t.finals.has(run[0]);
    return t.finalClusters.has(key(run));
  }
  return medialRunOK(ph, run);
}

/**
 * Join morphemes into one phonological word, repairing illegal junctions in the
 * way the language prefers. Inserted material is tagged -1.
 */
export function joinMorphs(lang: LangLike, morphs: Morph[]): Joined {
  const ph = lang.phonology;
  const mo = lang.morphology;
  const t = tables(ph);
  let w: string[] = [];
  let tags: number[] = [];
  morphs.forEach((m, mi) => {
    let f = m.affix ? harmonizeAffix(ph, w, m.form) : m.form.slice();
    if (f.length === 0) return;
    if (w.length === 0) {
      w = f.slice();
      tags = f.map(() => mi);
      return;
    }
    const aEnd = w[w.length - 1];
    const bStart = f[0];
    const insert: string[] = [];
    if (isVowel(aEnd) && isVowel(bStart)) {
      if (vowelQuality(aEnd) === vowelQuality(bStart)) {
        const L = lengthen(aEnd);
        if (t.vows.has(L)) w[w.length - 1] = L;
        f = f.slice(1);
      } else {
        let mode = mo.hiatusRepair;
        if (mode === "keep" && !ph.hiatus) mode = "glide";
        if (mode === "elide") {
          const aVowels = tags.filter((x, i) => x === tags[tags.length - 1] && isVowel(w[i])).length;
          const bVowels = f.filter((p) => isVowel(p)).length;
          if (aVowels >= 2 && !m.affix) {
            w.pop();
            tags.pop();
          } else if (bVowels >= 2) f = f.slice(1);
          else if (aVowels >= 2) {
            w.pop();
            tags.pop();
          } else mode = "glide";
        }
        if (mode === "glide") insert.push(t.cons.has(mo.glide) ? mo.glide : ph.consonants[0]);
      }
    } else if (!isVowel(aEnd) && !isVowel(bStart)) {
      if (!junctionOK(ph, w, f)) {
        let fixed = false;
        // nasal place assimilation
        if (isNasal(aEnd) && isObstruent(bStart)) {
          const n = homorganicNasal(ph, bStart);
          if (n && n !== aEnd) {
            const w2 = w.slice(0, -1).concat(n);
            if (junctionOK(ph, w2, f)) {
              w = w2;
              fixed = true;
            }
          }
        }
        // degemination
        if (!fixed && aEnd === bStart) {
          const f2 = f.slice(1);
          if (f2.length && junctionOK(ph, w, f2)) {
            f = f2;
            fixed = true;
          }
        }
        if (!fixed && mo.clusterRepair === "deletion") {
          // drop trailing consonants of the stem (keeping its vowel)
          let w2 = w.slice();
          let tg2 = tags.slice();
          for (let k = 0; k < 2 && !isVowel(w2[w2.length - 1]); k++) {
            w2 = w2.slice(0, -1);
            tg2 = tg2.slice(0, -1);
            if (w2.length && isVowel(w2[w2.length - 1])) {
              if (junctionOK(ph, w2, f) || isVowel(f[0])) {
                w = w2;
                tags = tg2;
                fixed = true;
              }
              break;
            }
            if (junctionOK(ph, w2, f)) {
              w = w2;
              tags = tg2;
              fixed = true;
              break;
            }
          }
        }
        if (!fixed) insert.push(mo.epenthetic);
      }
    } else if (isVowel(aEnd) && !isVowel(bStart)) {
      // a consonant-only suffix after a vowel must be a legal final
      if (!f.some((p) => isVowel(p)) && !junctionOK(ph, w, f)) insert.length = 0;
    }
    for (const p of insert) {
      w.push(p);
      tags.push(-1);
    }
    for (const p of f) {
      w.push(p);
      tags.push(mi);
    }
  });
  return { word: w, tags };
}

/** Attach an affix (prefix or suffix) to a stem. Free particles are not attached. */
export function affixWord(lang: LangLike, stem: Word, aff: Affix): Joined {
  if (aff.pos === "prefix") {
    const j = joinMorphs(lang, [{ form: aff.form }, { form: stem }]);
    return { word: j.word, tags: j.tags.map((x) => (x === 0 ? 1 : x === 1 ? 0 : x)) };
  }
  return joinMorphs(lang, [{ form: stem }, { form: aff.form, affix: true }]);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const DERIV: AffixKind[] = ["place", "land", "demonym", "adj", "dim", "aug", "agent", "abstract", "fem", "patronym", "dynasty", "collective"];

/** Grammaticalisation sources for derivational affixes. */
const GRAM_SOURCES: Partial<Record<AffixKind, string[]>> = {
  place: ["place", "home", "stead", "town"],
  land: ["land", "earth", "realm"],
  dim: ["child", "small", "son"],
  aug: ["great", "mother"],
  agent: ["man", "person"],
  fem: ["woman", "mother", "daughter"],
  patronym: ["son", "child"],
  dynasty: ["kin", "clan", "son", "child"],
  collective: ["all", "people", "kin"],
  demonym: ["man", "people"],
  pl: ["all", "people"],
  def: ["that", "this", "one"],
  fut: ["go", "come", "will"],
  pst: ["have", "be"],
  neg: ["not"],
};

function truncate(ph: Phonology, w: Word, suffix: boolean): Word {
  const nuc = nuclei(w);
  if (nuc.length <= 1) return w.slice();
  if (suffix) {
    // keep first syllable: onset + vowel (+ coda if legal word-finally)
    const v = nuc[0];
    const out = w.slice(0, v + 1);
    const next = w[v + 1];
    if (next && !isVowel(next) && tables(ph).finals.has(next) && w[v + 2] && !isVowel(w[v + 2])) out.push(next);
    return out;
  }
  return w.slice(0, nuc[0] + 1);
}

function pickVowel(ph: Phonology, prefs: string[]): string {
  for (const v of prefs) if (ph.vowels.includes(v)) return v;
  return ph.vowels[0];
}

export function generateMorphology(ph: Phonology, rng: Rng, roots: Record<string, Word>): Morphology {
  const wordOrder = rng.weighted<WordOrder>([
    ["SOV", 0.45],
    ["SVO", 0.36],
    ["VSO", 0.13],
    ["VOS", 0.04],
    ["OVS", 0.02],
  ]);
  const OV = wordOrder === "SOV" || wordOrder === "OVS";
  const verbInitial = wordOrder === "VSO" || wordOrder === "VOS";
  const suffixPref = OV ? 0.92 : verbInitial ? 0.55 : 0.7;
  const caseMarking = rng.chance(OV ? 0.72 : verbInitial ? 0.35 : 0.25);
  const adpositions: "pre" | "post" = rng.chance(OV ? 0.88 : 0.12) ? "post" : "pre";
  const adjOrder: "AN" | "NA" = rng.chance(OV ? 0.65 : verbInitial ? 0.25 : 0.5) ? "AN" : "NA";
  const genOrder: "GN" | "NG" = rng.chance(OV ? 0.82 : verbInitial ? 0.12 : 0.4) ? "GN" : "NG";
  const compound: Morphology["compound"] = rng.chance(adjOrder === "AN" ? 0.85 : 0.3) ? "mod-head" : "head-mod";
  const articles = rng.chance(0.42);
  const gender = rng.chance(0.4);
  const agreement = rng.chance(0.5);
  const proDrop = agreement ? rng.chance(0.8) : rng.chance(0.1);
  const hasCodas = ph.codas.length > 0 || ph.finals.length > 0;
  const complex = ph.onsetClusters.length > 4 || ph.codaClusters.length > 0;
  const epenthetic = ph.vowels.includes("ə") && rng.chance(0.7) ? "ə" : pickVowel(ph, rng.shuffle(["i", "e", "u", "a", "ɨ"].slice()));
  const glideOptions = ["j", "w", "h", "ʔ", "n", "r", "v", "t"].filter((c) => ph.consonants.includes(c));
  const glide = glideOptions.length ? glideOptions[Math.min(glideOptions.length - 1, Math.floor(rng.next() * Math.min(3, glideOptions.length)))] : ph.consonants[0];
  const linkMode: Morphology["linkMode"] = rng.weighted([
    ["always", 0.18],
    ["repair", 0.65],
    ["never", 0.17],
  ]);
  const link: Word = linkMode === "always" ? [pickVowel(ph, rng.shuffle(["o", "a", "i", "e", "u"].slice()))] : [];

  const mo: Morphology = {
    compound,
    link,
    linkMode,
    epenthetic,
    hiatusRepair: ph.hiatus && rng.chance(0.5) ? "keep" : rng.chance(0.6) ? "elide" : "glide",
    glide,
    clusterRepair: complex ? (rng.chance(0.35) ? "deletion" : "epenthesis") : rng.chance(0.6) ? "epenthesis" : "deletion",
    adjOrder,
    genOrder,
    wordOrder,
    adpositions,
    caseMarking,
    articles,
    gender,
    agreement,
    proDrop,
    affixes: {},
  };

  const used = new Set<string>();
  const inflShapes: [AffixShape, number][] = hasCodas
    ? [
        ["V", 2],
        ["CV", 3],
        ["VC", 2],
        ["C", 1.2],
        ["CVC", 0.5],
      ]
    : [
        ["V", 2],
        ["CV", 4],
        ["VCV", 0.6],
      ];
  const derivShapes: [AffixShape, number][] = hasCodas
    ? [
        ["CV", 2],
        ["VC", 2],
        ["CVC", 1.6],
        ["VCV", 1],
        ["V", 0.5],
      ]
    : [
        ["CV", 3],
        ["VCV", 1.5],
        ["CVCV", 0.6],
        ["V", 0.6],
      ];
  const mk = (kind: AffixKind, shapes: [AffixShape, number][], pos: Affix["pos"]): Affix => {
    // grammaticalise from a root sometimes
    const sources = GRAM_SOURCES[kind];
    if (sources && rng.chance(kind === "place" || kind === "land" ? 0.5 : 0.3)) {
      const src = sources.find((s) => roots[s]) && rng.pick(sources.filter((s) => roots[s]));
      if (src) {
        const form = truncate(ph, roots[src], pos !== "prefix");
        if (form.length && !used.has(key(form))) {
          used.add(key(form));
          return { form, pos, source: src };
        }
      }
    }
    const form = generateAffix(ph, rng, shapes, used);
    used.add(key(form));
    return { form, pos };
  };
  const sidePos = (): Affix["pos"] => (rng.chance(suffixPref) ? "suffix" : "prefix");

  for (const kind of DERIV) {
    const pos = kind === "patronym" && rng.chance(0.3) ? "before" : sidePos();
    mo.affixes[kind] = mk(kind, derivShapes, pos);
  }
  // inflection
  mo.affixes.pl = mk("pl", inflShapes, sidePos());
  if (articles) {
    const r = rng.next();
    mo.affixes.def = mk("def", inflShapes, r < 0.45 ? (adjOrder === "AN" || rng.chance(0.5) ? "before" : "after") : r < 0.8 ? "suffix" : "prefix");
  }
  const caseKinds: AffixKind[] = ["nom", "acc", "gen", "dat", "loc", "all", "abl", "ins"];
  for (const ck of caseKinds) {
    if (caseMarking) {
      if (ck === "nom" && rng.chance(0.75)) {
        mo.affixes.nom = { form: [], pos: "suffix" };
        continue;
      }
      mo.affixes[ck] = mk(ck, inflShapes, rng.chance(0.9) ? "suffix" : "prefix");
    } else {
      if (ck === "nom" || ck === "acc") {
        mo.affixes[ck] = { form: [], pos: "suffix" };
        continue;
      }
      if (ck === "gen" && rng.chance(0.3)) {
        mo.affixes.gen = mk("gen", inflShapes, "suffix");
        continue;
      }
      mo.affixes[ck] = mk(ck, derivShapes, adpositions === "pre" ? "before" : "after");
    }
  }
  // verbs
  const verbAffixPos = (): Affix["pos"] => (rng.chance(0.25) ? (OV ? "after" : "before") : sidePos());
  mo.affixes.prs = rng.chance(0.55) ? { form: [], pos: "suffix" } : mk("prs", inflShapes, sidePos());
  mo.affixes.pst = mk("pst", inflShapes, verbAffixPos());
  mo.affixes.fut = mk("fut", inflShapes, verbAffixPos());
  mo.affixes.imp = rng.chance(0.5) ? { form: [], pos: "suffix" } : mk("imp", inflShapes, sidePos());
  mo.affixes.neg = mk("neg", inflShapes, rng.chance(0.6) ? (OV ? "after" : "before") : sidePos());
  if (agreement) {
    for (const p of ["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"] as AffixKind[]) {
      if (p === "3sg" && rng.chance(0.5)) {
        mo.affixes[p] = { form: [], pos: "suffix" };
        continue;
      }
      mo.affixes[p] = mk(p, inflShapes, OV ? "suffix" : sidePos());
    }
  }
  return mo;
}

export function affixOf(m: Morphology, kind: AffixKind): Affix | undefined {
  return m.affixes[kind];
}

export { isValidWord };

/**
 * Compound two stems, respecting the language's compound order and linking
 * element. Tags: 0 = modifier, 1 = head, -1 = linking/epenthetic material.
 */
export function compound(lang: LangLike, mod: Word, head: Word): Joined {
  const mo = lang.morphology;
  const useLink = mo.linkMode === "always" && mo.link.length > 0;
  const first = mo.compound === "mod-head" ? mod : head;
  const second = mo.compound === "mod-head" ? head : mod;
  const morphs: Morph[] = useLink ? [{ form: first }, { form: mo.link, affix: true }, { form: second }] : [{ form: first }, { form: second }];
  const j = joinMorphs(lang, morphs);
  const firstTag = mo.compound === "mod-head" ? 0 : 1;
  const secondTag = 1 - firstTag;
  const tags = j.tags.map((t) => (t === 0 ? firstTag : useLink ? (t === 1 ? -1 : t === 2 ? secondTag : -1) : t === 1 ? secondTag : -1));
  return { word: j.word, tags };
}
