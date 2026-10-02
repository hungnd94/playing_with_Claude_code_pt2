/**
 * Languages and language families: proto-language creation, derivation of
 * daughter languages by regular sound change + lexical replacement +
 * grammatical/orthographic drift, inventories, endonyms and stage labels.
 */
import type { Rng } from "../core/rng";
import { CONCEPTS, CONCEPT_BY_ID } from "./concepts";
import { driftNamingCulture, generateNamingCulture } from "./culture";
import { assembleLexicon, generateRoots, planDerivations, realizeRecipe } from "./lexicon";
import { affixWord, compound, generateMorphology, joinMorphs } from "./morphology";
import { features, isNasal, isVowel, vf, vowelQuality } from "./phoneme";
import { generatePhonology, invalidateTables, nuclei, phonologyFromCorpus, vowelQualities } from "./phonology";
import { applyChanges, generateChanges } from "./soundchange";
import { buildOrthography, driftOrthography, romanizeName, romanizeWord } from "./orthography";
import type { Affix, AffixKind, Flavour, Language, Lexeme, LineageStep, Morphology, Phonology, Word, WordOrder } from "./types";
import { asciiFold, capitalize, clone, key } from "./util";
import { generateAffix, generateRoot } from "./wordgen";

export interface ProtoOptions {
  /** Homeland hint biasing the sound system. */
  flavour?: Flavour | null;
  id?: string;
  /** English name; generated from the language's own words if omitted. */
  name?: string;
  /** Existing languages to be distinct from (orthographic tradition, look). */
  avoid?: Language[];
  year?: number;
}

/** Create a proto-language from scratch. Deterministic in `rng`. */
export function createProtoLanguage(rng: Rng, opts: ProtoOptions = {}): Language {
  const flavour = opts.flavour ?? null;
  const id = opts.id ?? "L" + rng.fork("id").nextU32().toString(36);
  const ph = generatePhonology(rng.fork("phonology"), flavour);
  const lrng = rng.fork("lexicon");
  const plan = planDerivations(lrng);
  const roots = generateRoots(ph, lrng, plan);
  const mo = generateMorphology(ph, rng.fork("morphology"), roots);
  const lexicon = assembleLexicon({ phonology: ph, morphology: mo }, roots, plan, lrng);
  const avoidSchools = (opts.avoid ?? []).map((l) => l.orthography.school);
  const orthography = buildOrthography(ph, rng.fork("orthography"), { avoidSchools });
  const naming = generateNamingCulture(rng.fork("naming"), mo);
  const lang: Language = {
    id,
    name: "",
    endonym: "",
    endonymPhonemes: [],
    endonymGloss: "",
    parent: null,
    depth: 0,
    year: opts.year ?? 0,
    flavour,
    attested: false,
    phonology: ph,
    morphology: mo,
    orthography,
    lexicon,
    naming,
    lineage: [],
    seed: rng.key,
  };
  setEndonym(lang, rng.fork("endonym"), opts.name, (opts.avoid ?? []).map((l) => l.name));
  return lang;
}

/** Create several proto-languages that look distinct from each other. */
export function createProtoLanguages(rng: Rng, n: number, flavours: (Flavour | null)[] = []): Language[] {
  const out: Language[] = [];
  for (let i = 0; i < n; i++) out.push(createProtoLanguage(rng.fork(`proto${i}`), { flavour: flavours[i] ?? null, avoid: out }));
  return out;
}

// ---------------------------------------------------------------------------
// Names of languages
// ---------------------------------------------------------------------------

function englishFrom(roman: string, rng: Rng): string {
  let s = asciiFold(roman).toLowerCase().replace(/[^a-z]/g, "");
  if (s.length === 0) s = "an";
  // shorten long forms at a syllable-ish boundary
  if (s.length > 8) {
    let cut = 7;
    while (cut > 3 && /[aeiouy]/.test(s[cut - 1]) === /[aeiouy]/.test(s[cut])) cut--;
    s = s.slice(0, Math.max(4, cut));
  }
  s = s.replace(/(.)\1+$/, "$1");
  const vowelFinal = /[aeiouy]$/.test(s);
  let suffix: string;
  if (s.length < 4) {
    suffix = vowelFinal ? rng.pick(["ran", "ni", "nese", "rin", "shi"]) : rng.pick(["ian", "ic", "ar", "ish", "ani"]);
    if (s.endsWith("i") && suffix.startsWith("i")) suffix = suffix.slice(1) || "an";
    return capitalize(s + suffix);
  }
  if (vowelFinal) suffix = rng.weighted([["", 3], ["n", 2], ["ni", 0.7], ["ric", 0.4]]);
  else if (/(sh|ch|j|s|z|x)$/.test(s)) suffix = rng.weighted([["i", 3], ["ian", 1], ["ite", 0.6], ["", 1]]);
  else suffix = rng.weighted([["i", 2.5], ["ic", 1.3], ["ish", 0.9], ["ian", 1], ["ese", 0.6], ["", 1.2], ["an", 1]]);
  if (s.endsWith("i") && suffix.startsWith("i")) suffix = suffix.slice(1);
  return capitalize(s + suffix);
}

function setEndonym(lang: Language, rng: Rng, name?: string, avoid: string[] = []): void {
  const people = lang.lexicon.people.form;
  const variant = rng.weighted<string>([
    ["adj", 3],
    ["speech", 1],
    ["true", 1],
    ["bare", 1.5],
  ]);
  let form: Word = people;
  let gloss = "the people";
  if (variant === "adj" && lang.morphology.affixes.adj) {
    form = affixWord(lang, people, lang.morphology.affixes.adj).word;
    gloss = "of the people";
  } else if (variant === "speech") {
    form = compound(lang, people, lang.lexicon.word.form).word;
    gloss = "people's speech";
  } else if (variant === "true") {
    form = compound(lang, lang.lexicon.true.form, people).word;
    gloss = "the true people";
  }
  lang.endonymPhonemes = form;
  lang.endonym = romanizeName(lang.orthography, form);
  lang.endonymGloss = gloss;
  const base = romanizeWord(lang.orthography, people);
  const full = romanizeWord(lang.orthography, form);
  const src = asciiFold(base).replace(/[^A-Za-z]/g, "").length >= 3 ? base : full;
  if (name) {
    lang.name = name;
    return;
  }
  const taken = new Set(avoid.map((x) => x.toLowerCase()));
  let cand = englishFrom(src, rng);
  for (let i = 0; i < 12 && taken.has(cand.toLowerCase()); i++) cand = englishFrom(i < 6 ? src : full, rng);
  if (taken.has(cand.toLowerCase())) cand = englishFrom(full + "ar", rng);
  lang.name = cand;
}

/** "Proto-Keshi". */
export function protoLabel(name: string): string {
  return `Proto-${name}`;
}
/** "Old Keshi". */
export function oldLabel(name: string): string {
  return `Old ${name}`;
}
/** "Middle Keshi". */
export function middleLabel(name: string): string {
  return `Middle ${name}`;
}
export function stageLabel(name: string, stage: "proto" | "old" | "middle" | "modern"): string {
  return stage === "proto" ? protoLabel(name) : stage === "old" ? oldLabel(name) : stage === "middle" ? middleLabel(name) : name;
}

/** Default citation label: proto-languages (depth 0) as "Proto-X" once they have daughters. */
export function citationLabel(lang: Language, hasDaughters = true): string {
  return lang.depth === 0 && hasDaughters ? protoLabel(lang.name) : lang.name;
}

// ---------------------------------------------------------------------------
// Inventory & description
// ---------------------------------------------------------------------------

/** The phoneme inventory in the shape the script module consumes. */
export function inventory(lang: Language): { consonants: string[]; vowels: string[] } {
  return { consonants: lang.phonology.consonants.slice(), vowels: lang.phonology.vowels.slice() };
}

const STRESS_TEXT: Record<string, string> = {
  initial: "on the first syllable",
  second: "on the second syllable",
  penult: "on the penultimate syllable",
  antepenult: "on the antepenultimate syllable",
  final: "on the last syllable",
  latin: "on a heavy penult, else the antepenult",
  weight: "on the rightmost heavy syllable",
};

/** A few lines describing the language's typology. */
export function describeLanguage(lang: Language): string[] {
  const ph = lang.phonology;
  const mo = lang.morphology;
  const q = vowelQualities(ph);
  const long = ph.vowels.some((v) => vf(v)?.long);
  const nasal = ph.vowels.some((v) => vf(v)?.nasal);
  const lines = [
    `${ph.consonants.length} consonants and ${q.length} vowel qualities${long ? ", with contrastive length" : ""}${nasal ? ", with nasal vowels" : ""}.`,
    `Syllables ${ph.canon}; stress ${STRESS_TEXT[ph.stress]}${ph.harmony !== "none" ? `; ${ph.harmony === "palatal" ? "front–back" : "rounding"} vowel harmony` : ""}.`,
    `${mo.wordOrder} word order, ${mo.adpositions === "pre" ? "prepositions" : "postpositions"}, adjectives ${mo.adjOrder === "AN" ? "before" : "after"} nouns, possessors ${mo.genOrder === "GN" ? "before" : "after"} the possessed; ${mo.caseMarking ? "nouns inflect for case" : "no case inflection"}${mo.articles ? ", with a definite article" : ""}${mo.gender ? ", masculine and feminine gender" : ""}.`,
    `Compounds are ${mo.compound === "mod-head" ? "modifier–head" : "head–modifier"}${mo.linkMode === "always" && mo.link.length ? ` with a linking -${romanizeWord(lang.orthography, mo.link)}-` : ""}; spelling follows the ${lang.orthography.school} tradition.`,
  ];
  return lines;
}

// ---------------------------------------------------------------------------
// Derivation of daughter languages
// ---------------------------------------------------------------------------

export interface DeriveOptions {
  id?: string;
  name?: string;
  /** Override the number of sound changes (3–8 by default). */
  minChanges?: number;
  maxChanges?: number;
  /** Fraction of the lexicon replaced (default 3–8%). */
  replacement?: number;
  /** English names already in use (the parent's is always avoided). */
  avoidNames?: string[];
}

function evolveAffix(parent: Language, aff: Affix, changes: LineageStep["changes"], stress: Language["phonology"]["stress"]): Affix {
  if (aff.form.length === 0) return clone(aff);
  if (aff.pos === "before" || aff.pos === "after") {
    const r = applyChanges(changes, aff.form, stress).word;
    return { ...aff, form: r.length ? r : aff.form.slice() };
  }
  const stem = parent.lexicon.stone.form;
  const morphs = aff.pos === "suffix" ? [{ form: stem }, { form: aff.form, affix: true }] : [{ form: aff.form, affix: true }, { form: stem }];
  const j = joinMorphs(parent, morphs);
  const affIdx = aff.pos === "suffix" ? 1 : 0;
  const r = applyChanges(changes, j.word, stress, j.tags);
  let form = r.word.filter((_, i) => r.tags[i] === affIdx);
  if (form.length === 0) {
    const alone = applyChanges(changes, aff.form, stress).word;
    form = alone.length ? alone : aff.form.slice();
  }
  return { ...aff, form };
}

function relatedConcept(id: string, rng: Rng): string | null {
  const c = CONCEPT_BY_ID[id];
  const cats = ["geo", "beast", "bird", "plant", "tree", "sky", "elem", "body", "abstract", "role", "kin", "material", "object", "color", "qual", "time", "build"];
  const cat = c.tags.find((t) => cats.includes(t));
  if (!cat) return null;
  const pool = CONCEPTS.filter((x) => x.id !== id && x.pos === c.pos && x.tags.includes(cat));
  if (!pool.length) return null;
  return rng.pick(pool).id;
}

/**
 * Derive a daughter language: 3–8 regular sound changes, some lexical
 * replacement (coinages, semantic shifts, new derivations), drift in grammar,
 * orthography and naming customs. The parent is not modified.
 */
export function deriveLanguage(parent: Language, rng: Rng, year: number, opts: DeriveOptions = {}): Language {
  const id = opts.id ?? "L" + rng.fork("id").nextU32().toString(36);
  const stressBefore = parent.phonology.stress;
  const parentForms = CONCEPTS.map((c) => parent.lexicon[c.id].form);
  const ancestral = parent.lineage.flatMap((s) => s.changes.map((c) => c.id));
  const gen = generateChanges(rng.fork("changes"), parentForms, [...parent.phonology.consonants, ...parent.phonology.vowels], stressBefore, ancestral, {
    min: opts.minChanges,
    max: opts.maxChanges,
  });
  const changes = gen.changes;
  const stress = gen.stress;

  // 1. Inherit the lexicon through the sound changes.
  const lexicon: Record<string, Lexeme> = {};
  for (const c of CONCEPTS) {
    const form = applyChanges(changes, parent.lexicon[c.id].form, stressBefore).word;
    lexicon[c.id] = { form, origin: { kind: "inherited", from: parent.id } };
  }

  // 2. Evolve the grammar's morphemes.
  const mo: Morphology = clone(parent.morphology);
  for (const k of Object.keys(mo.affixes) as AffixKind[]) mo.affixes[k] = evolveAffix(parent, parent.morphology.affixes[k]!, changes, stressBefore);
  if (mo.link.length) {
    const l = applyChanges(changes, mo.link, stressBefore).word;
    if (l.length) mo.link = l;
  }

  const affixForms = Object.values(mo.affixes)
    .map((a) => a!.form)
    .filter((f) => f.length > 0);
  const roots = CONCEPTS.filter((c) => parent.lexicon[c.id].origin.kind === "root" || parent.lexicon[c.id].origin.kind === "inherited").map((c) => lexicon[c.id].form);
  const interim = phonologyFromCorpus([...CONCEPTS.map((c) => lexicon[c.id].form), ...affixForms], roots, parent.phonology, stress);
  const fixPhonology = (ph: Phonology) => {
    // epenthetic vowel and glide must exist
    const ep = applyChanges(changes, [parent.morphology.epenthetic], stressBefore).word;
    mo.epenthetic = ep.length === 1 && isVowel(ep[0]) && ph.vowels.includes(ep[0]) ? ep[0] : ph.vowels.includes(parent.morphology.epenthetic) ? parent.morphology.epenthetic : ph.vowels.filter((v) => !vf(v)!.long)[0] ?? ph.vowels[0];
    if (!ph.consonants.includes(mo.glide)) mo.glide = ["j", "w", "h", "ʔ", "n", "r", "v"].find((c) => ph.consonants.includes(c)) ?? ph.consonants[0];
  };
  fixPhonology(interim);

  // 3. Grammatical drift.
  const mrng = rng.fork("morphology");
  const used = new Set<string>(affixForms.map(key));
  if (mrng.chance(0.12)) mo.adjOrder = mo.adjOrder === "AN" ? "NA" : "AN";
  if (mrng.chance(0.08)) mo.compound = mo.compound === "mod-head" ? "head-mod" : "mod-head";
  if (mrng.chance(0.12)) {
    const shifts: Record<WordOrder, WordOrder[]> = { SOV: ["SVO"], SVO: ["SOV", "VSO"], VSO: ["SVO", "VOS"], VOS: ["VSO"], OVS: ["SOV"] };
    mo.wordOrder = mrng.pick(shifts[mo.wordOrder]);
  }
  if (mo.caseMarking && mrng.chance(0.15)) {
    // case endings eroded; adpositions take over
    mo.caseMarking = false;
    mo.adpositions = mo.wordOrder === "SOV" || mo.wordOrder === "OVS" ? "post" : "pre";
    for (const ck of ["gen", "dat", "loc", "all", "abl", "ins"] as AffixKind[]) {
      const form = generateAffix(interim, mrng, [["CV", 2], ["VC", 1], ["CVC", 1]], used);
      used.add(key(form));
      mo.affixes[ck] = { form, pos: mo.adpositions === "pre" ? "before" : "after" };
    }
    mo.affixes.nom = { form: [], pos: "suffix" };
    mo.affixes.acc = { form: [], pos: "suffix" };
  }
  if (!mo.articles && mrng.chance(0.18)) {
    // a demonstrative grammaticalises into an article
    mo.articles = true;
    const that = lexicon.that.form;
    const nuc = nuclei(that);
    const form = nuc.length > 1 ? that.slice(0, nuc[0] + 1) : that.slice();
    mo.affixes.def = { form, pos: mrng.chance(0.6) ? (mo.adjOrder === "AN" ? "before" : "after") : "suffix", source: "that" };
  } else if (mo.articles && mrng.chance(0.06)) {
    mo.articles = false;
    delete mo.affixes.def;
  }

  // 4. Lexical replacement.
  const lrng = rng.fork("lexicon");
  const frac = opts.replacement ?? lrng.range(0.03, 0.08);
  const stable = new Set(["people", "I", "you", "he", "we", "you.pl", "they", "and", "not", "all", "this", "that", "one", "two", "three", "four", "five", "word"]);
  const candidates = CONCEPTS.filter((c) => !stable.has(c.id));
  const nRep = Math.round(candidates.length * frac);
  const interimLang = { phonology: interim, morphology: mo };
  const avoid = new Set(Object.values(lexicon).map((l) => key(l.form)));
  for (const c of lrng.sample(candidates, nRep)) {
    const r = lrng.next();
    if (r < 0.4) {
      const root = generateRoot(parent.phonology, lrng, c.tier, avoid);
      const form = applyChanges(changes, root, stressBefore).word;
      lexicon[c.id] = { form, origin: { kind: "coined" } };
      avoid.add(key(form));
    } else if (r < 0.7) {
      const rel = relatedConcept(c.id, lrng);
      if (rel) lexicon[c.id] = { form: lexicon[rel].form.slice(), origin: { kind: "shift", from: rel } };
    } else if (c.recipes?.length) {
      const lx = realizeRecipe(interimLang, lrng.pick(c.recipes), (x) => lexicon[x]?.form);
      if (lx && nuclei(lx.form).length <= 5) lexicon[c.id] = lx;
    } else {
      const root = generateRoot(parent.phonology, lrng, c.tier, avoid);
      const form = applyChanges(changes, root, stressBefore).word;
      lexicon[c.id] = { form, origin: { kind: "coined" } };
    }
  }

  // 5. Phonology emerges from the evolved lexicon.
  const finalAffixes = Object.values(mo.affixes)
    .map((a) => a!.form)
    .filter((f) => f.length > 0);
  const ph = phonologyFromCorpus([...CONCEPTS.map((c) => lexicon[c.id].form), ...finalAffixes, mo.link], roots, parent.phonology, stress);
  invalidateTables(ph);
  fixPhonology(ph);
  if (!ph.vowels.includes(mo.epenthetic)) ph.vowels.push(mo.epenthetic);

  const orthography = driftOrthography(parent.orthography, ph, rng.fork("orthography"));
  const naming = driftNamingCulture(parent.naming, rng.fork("naming"));
  const lang: Language = {
    id,
    name: "",
    endonym: "",
    endonymPhonemes: [],
    endonymGloss: "",
    parent: parent.id,
    depth: parent.depth + 1,
    year,
    flavour: parent.flavour,
    attested: true,
    phonology: ph,
    morphology: mo,
    orthography,
    lexicon,
    naming,
    lineage: [],
    seed: rng.key,
  };
  setEndonym(lang, rng.fork("endonym"), opts.name, [parent.name, ...(opts.avoidNames ?? [])]);
  lang.lineage = [
    ...parent.lineage,
    { from: parent.id, to: id, toName: lang.name, year, stressBefore, changes, orthography: clone(orthography) },
  ];
  return lang;
}

/** Plain-JSON serialisation (languages are already plain data). */
export function languageToJSON(lang: Language): string {
  return JSON.stringify(lang);
}
export function languageFromJSON(json: string): Language {
  const l = JSON.parse(json) as Language;
  if (!l || !l.phonology || !l.lexicon) throw new Error("not a language");
  return l;
}

/** Ancestor ids from the root down to (excluding) this language. */
export function ancestry(lang: Language): string[] {
  return lang.lineage.map((s) => s.from);
}

/** Phoneme correspondences between an ancestor and a descendant, from aligned inherited words. */
export function correspondences(ancestor: Language, descendant: Language): Record<string, Record<string, number>> {
  const idx = descendant.lineage.findIndex((s) => s.from === ancestor.id);
  const out: Record<string, Record<string, number>> = {};
  if (idx < 0) return out;
  const steps = descendant.lineage.slice(idx);
  for (const c of CONCEPTS) {
    const lx = descendant.lexicon[c.id];
    if (lx.origin.kind !== "inherited") continue;
    const src = ancestor.lexicon[c.id].form;
    let w = src;
    let tags = src.map((_, i) => i);
    let st = steps[0].stressBefore;
    for (const s of steps) {
      const r = applyChanges(s.changes, w, st, tags);
      w = r.word;
      tags = r.tags;
      st = r.stress;
    }
    if (key(w) !== key(lx.form)) continue; // replaced further down
    src.forEach((p, i) => {
      const outP = w.filter((_, j) => tags[j] === i).join("") || "∅";
      out[p] ??= {};
      out[p][outP] = (out[p][outP] ?? 0) + 1;
    });
  }
  return out;
}

export { isNasal, features, vowelQuality };
