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
import { invalidateTables, nuclei, phonologyFromCorpus, vowelQualities } from "./phonology";
import { phonologyFromStyle, pickStyle, styleById } from "./genphon";
import { parseWeighted } from "./styles";
import { applyChanges, generateChanges } from "./soundchange";
import { buildOrthography, driftOrthography, romanizeName, romanizeWord } from "./orthography";
import type { Affix, AffixKind, Flavour, Language, Lexeme, LineageStep, Morphology, Phonology, Word, WordOrder } from "./types";
import { asciiFold, capitalize, clone, key, obscene } from "./util";
import { generateAffix, generateRoot, generateWord } from "./wordgen";

export interface ProtoOptions {
  /** Homeland hint biasing the sound system. */
  flavour?: Flavour | null;
  /** Force a sound style (see styles.ts; e.g. "finnic", "semitic"). Normally chosen from the flavour. */
  style?: string;
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
  const avoid = opts.avoid ?? [];
  const style = styleById(opts.style) ?? pickStyle(rng.fork("style"), flavour, avoid.map((l) => l.phonology.style ?? ""));
  const ph = phonologyFromStyle(style, rng.fork("phonology"));
  const lrng = rng.fork("lexicon");
  const plan = planDerivations(lrng);
  const roots = generateRoots(ph, lrng, plan);
  const mo = generateMorphology(ph, rng.fork("morphology"), roots, style.morph);
  const lexicon = assembleLexicon({ phonology: ph, morphology: mo }, roots, plan, lrng);
  const avoidSchools = avoid.map((l) => l.orthography.school);
  const orthography = buildOrthography(ph, rng.fork("orthography"), { avoidSchools, schools: style.schools });
  const naming = generateNamingCulture(rng.fork("naming"), mo, style.naming, { phonology: ph, lexicon });
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
  for (const c of CONCEPTS) lexicon[c.id].since = id;
  // No word may spell an English obscenity or slur in the language's own spelling.
  const srng = rng.fork("sanitize");
  const taken = new Set(Object.values(lexicon).map((l) => key(l.form)));
  for (const c of CONCEPTS) {
    for (let k = 0; k < 12 && obscene(romanizeWord(orthography, lexicon[c.id].form)); k++) {
      const w = generateRoot(ph, srng, c.tier, taken);
      taken.add(key(w));
      lexicon[c.id] = { form: w, origin: { kind: "root" }, since: id };
    }
  }
  setEndonym(lang, rng.fork("endonym"), opts.name, avoid.map((l) => l.name));
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
  // An English language name is built on the first syllable or two of the native word
  // (Deutsch → Dutch, Suomi → Finnish): long forms are cut at a syllable boundary and a
  // stem never ends in a consonant cluster English readers would stumble over.
  if (s.length > 6) {
    const groups = s.match(/[^aeiouy]*[aeiouy]+/g) ?? [s];
    let stem = groups[0];
    let gi = 1;
    while (stem.length < 4 && gi < groups.length) stem += groups[gi++];
    const rest = s.slice(stem.length);
    const cl = /^[^aeiouy]+/.exec(rest)?.[0] ?? "";
    if (cl && (stem.length <= 5 || rng.chance(0.5))) stem += /^(sh|ch|th|kh|ng|zh|ts)/.test(cl) ? cl.slice(0, 2) : cl[0];
    s = stem;
  }
  // no doubled letters at either end, no doubled a/i/u anywhere (Aahaa → Aha)
  s = s.replace(/(.)\1+$/, "$1").replace(/^(.)\1+/, "$1").replace(/([aiu])\1+/g, "$1");
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
  let form: Word = people;
  let gloss = "the people";
  for (let k = 0; k < 4; k++) {
    const variant = rng.weighted<string>([
      ["adj", 3],
      ["speech", 1],
      ["true", 1],
      ["bare", 1.5],
    ]);
    form = people;
    gloss = "the people";
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
    // a self-name is a short, much-used word
    if (nuclei(form).length <= 3) break;
  }
  if (nuclei(form).length > 3) {
    form = people;
    gloss = "the people";
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
  for (let i = 0; i < 12 && (taken.has(cand.toLowerCase()) || obscene(cand)); i++) cand = englishFrom(i < 6 ? src : full, rng);
  if (taken.has(cand.toLowerCase())) cand = englishFrom(full + "ar", rng);
  lang.name = cand;
}

/** Edit distance (small strings). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Two English language names a reader would confuse (Mitar/Mitian, Kesh/Keshi). */
function tooSimilar(a: string, b: string): boolean {
  const x = asciiFold(a).toLowerCase();
  const y = asciiFold(b).toLowerCase();
  if (x === y) return true;
  if (x.slice(0, 3) === y.slice(0, 3) && Math.min(x.length, y.length) >= 4) return true;
  return editDistance(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 3));
}

/** What a daughter people is called after: a landscape or a direction. */
const DAUGHTER_SOURCES = ["north", "south", "east", "west", "river", "sea", "mountain", "forest", "coast", "island", "plain", "valley", "lake", "hill", "high", "far", "marsh", "field", "stone", "horse", "wolf", "sun"];

/**
 * A daughter's self-name and English name. Real families name their branches
 * after the inherited self-designation (Deutsch, Dutch), a landscape or
 * direction (Norway, the Ostrogoths), or a new tribal name of no clear meaning
 * (the Franks); a branch is never called something a reader would confuse
 * with its parent or a sibling.
 */
function setDaughterEndonym(lang: Language, parent: Language, changes: LineageStep["changes"], stressBefore: Language["phonology"]["stress"], rng: Rng, name: string | undefined, avoid: string[]): void {
  const taken = avoid.filter(Boolean);
  const people = lang.lexicon.people.form;
  for (let attempt = 0; attempt < 14; attempt++) {
    const r = rng.next();
    let form: Word;
    let gloss: string;
    let src: Word;
    if (r < 0.35 && attempt < 7) {
      // the old self-name, worn down by this branch's sound changes
      form = applyChanges(changes, parent.endonymPhonemes, stressBefore).word;
      gloss = parent.endonymGloss;
      src = form;
    } else if (r < 0.7) {
      const x = rng.pick(DAUGHTER_SOURCES.filter((c) => lang.lexicon[c]));
      const xf = lang.lexicon[x].form;
      const adj = CONCEPT_BY_ID[x].pos === "adj" && !["north", "south", "east", "west"].includes(x);
      if (!adj && rng.chance(0.5) && lang.morphology.affixes.demonym?.form.length) {
        form = affixWord(lang, xf, lang.morphology.affixes.demonym).word;
        gloss = `those of the ${CONCEPT_BY_ID[x].en}`;
      } else {
        form = compound(lang, xf, people).word;
        gloss = adj ? `the ${CONCEPT_BY_ID[x].en} people` : `${CONCEPT_BY_ID[x].en} people`;
      }
      src = xf;
    } else {
      form = generateWord(lang.phonology, rng, rng.int(1, 2) + (rng.chance(0.3) ? 1 : 0));
      gloss = "";
      src = form;
    }
    if (!form.some((p) => isVowel(p)) || nuclei(form).length > 4) continue;
    const roman = romanizeWord(lang.orthography, src);
    const english = name ?? englishFrom(asciiFold(roman).replace(/[^A-Za-z]/g, "").length >= 3 ? roman : romanizeWord(lang.orthography, form), rng);
    if (!name && (english.length > 11 || obscene(english) || obscene(roman) || taken.some((t) => tooSimilar(t, english)))) continue;
    lang.endonymPhonemes = form;
    lang.endonym = romanizeName(lang.orthography, form);
    lang.endonymGloss = gloss;
    lang.name = english;
    return;
  }
  // fall back to the people-word naming of proto-languages
  setEndonym(lang, rng, name, taken);
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
  /** Minimum share of inherited words the split's sound changes must alter (default 0.3). */
  minImpact?: number;
  /** English names already in use (the parent's is always avoided). */
  avoidNames?: string[];
  /**
   * In-place evolution of the same people's language (Old X → Middle X → X)
   * rather than a split: the English name is kept, the endonym evolves
   * regularly, and change is gentler (2–5 sound laws, less replacement and
   * grammatical drift).
   */
  stage?: boolean;
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

/**
 * Attested-type semantic shifts, new meaning ← older meanings (Latin testa 'pot' →
 * French tête 'head'; Slavic leto 'summer' → 'year'; Old English tūn 'enclosure' → town;
 * hound → dog). A word that changes meaning takes over a neighbouring sense; nothing
 * shifts from 'light' to 'water'.
 */
const SHIFTS: Record<string, string[]> = {
  stone: ["rock"], rock: ["stone"], hill: ["mountain", "mound"], mountain: ["hill", "rock"], mound: ["hill"], forest: ["wood", "tree"],
  wood: ["tree", "forest"], tree: ["wood", "oak"], field: ["plain", "land"], plain: ["field"], land: ["earth", "field"], earth: ["land", "clay"],
  sea: ["lake", "water"], lake: ["sea", "water"], river: ["water", "stream"], stream: ["river", "water"], bay: ["harbor", "mouth"],
  harbor: ["bay", "shore"], coast: ["shore", "side"], shore: ["coast", "side"], road: ["path", "way"], path: ["road", "way"], way: ["road", "path"],
  town: ["fort", "farm", "wall", "home"], city: ["fort", "town"], village: ["house", "farm"], home: ["house"], house: ["home", "hall"],
  hall: ["house"], palace: ["hall", "house"], fort: ["wall", "tower"], temple: ["house", "hall"], tower: ["fort"], farm: ["field", "house"],
  king: ["lord", "chief"], lord: ["king", "father"], chief: ["head", "elder"], queen: ["lady", "wife"], lady: ["queen", "wife"],
  god: ["sky", "spirit"], spirit: ["breath", "soul"], soul: ["breath", "spirit", "heart"], breath: ["soul", "wind"], wind: ["breath", "storm"],
  sun: ["day"], day: ["sun", "light"], light: ["day", "fire"], fire: ["flame", "light"], flame: ["fire"], dawn: ["light", "east"],
  night: ["dark", "evening"], evening: ["night", "west"], year: ["summer", "winter"], winter: ["snow", "frost"], summer: ["sun"],
  dog: ["wolf", "fox"], wolf: ["dog"], cow: ["ox"], ox: ["bull", "cow"], bull: ["ox"], deer: ["elk", "stag"], elk: ["deer"], stag: ["deer"],
  bird: ["eagle", "raven"], raven: ["bird"], horse: ["stag"], fish: ["whale"], whale: ["fish"], serpent: ["dragon"], dragon: ["serpent"],
  child: ["son", "daughter"], son: ["child"], daughter: ["child"], man: ["person", "husband"], person: ["man"], woman: ["wife", "lady"],
  wife: ["woman"], husband: ["man", "lord"], people: ["host", "kin"], host: ["people"], kin: ["clan", "people"], clan: ["kin", "house"],
  hand: ["arm"], arm: ["hand"], head: ["cup", "chief"], face: ["eye", "head"], mouth: ["face", "gate"], heart: ["soul"], tongue: ["word"],
  great: ["strong", "high"], high: ["great"], strong: ["great"], old: ["great"], black: ["dark"], dark: ["black", "night"], white: ["bright"],
  bright: ["white"], golden: ["yellow"], yellow: ["golden"], brown: ["red", "dark"], grey: ["white"], green: ["young"], wise: ["old"],
  war: ["battle"], battle: ["war"], word: ["name"], name: ["word"], song: ["word"], ship: ["boat"], boat: ["ship"],
  bronze: ["copper"], copper: ["bronze"], gold: ["yellow"], silver: ["white"], beer: ["wine"], wine: ["beer"], meat: ["bread"],
  sword: ["spear"], spear: ["arrow"], axe: ["hammer"], hammer: ["axe", "stone"], helm: ["head"], crown: ["ring"], ring: ["crown"],
  know: ["see"], see: ["know"], hear: ["know"], hold: ["take", "keep"], keep: ["hold", "guard"], guard: ["keep"], take: ["hold"],
  burn: ["shine"], shine: ["burn"], flow: ["run"], run: ["flow"], die: ["fall"], fall: ["die"], speak: ["sing"], come: ["go"], go: ["come"],
};

function relatedConcept(id: string, rng: Rng): string | null {
  const pool = (SHIFTS[id] ?? []).filter((x) => CONCEPT_BY_ID[x] && CONCEPT_BY_ID[x].pos === CONCEPT_BY_ID[id].pos);
  return pool.length ? rng.pick(pool) : null;
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
  const style = styleById(parent.phonology.style);
  const stage = !!opts.stage;
  const gen = generateChanges(rng.fork("changes"), parentForms, [...parent.phonology.consonants, ...parent.phonology.vowels], stressBefore, ancestral, {
    min: opts.minChanges ?? (stage ? 2 : 3),
    max: opts.maxChanges ?? (stage ? 5 : 8),
    drift: style?.drift ? Object.fromEntries(parseWeighted(style.drift)) : undefined,
    minImpact: opts.minImpact ?? (stage ? 0.2 : 0.3),
  });
  const changes = gen.changes;
  const stress = gen.stress;

  // 1. Inherit the lexicon through the sound changes.
  const lexicon: Record<string, Lexeme> = {};
  for (const c of CONCEPTS) {
    const form = applyChanges(changes, parent.lexicon[c.id].form, stressBefore).word;
    lexicon[c.id] = { form, origin: { kind: "inherited", from: parent.id }, since: parent.lexicon[c.id].since ?? parent.id };
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
  // The daughter's phonotactics are inferred from its finished lexicon (step 5). Until then,
  // new words are put together with the parent's junction rules and new grammatical words
  // are coined in the parent's shape and run through this split's sound laws — so no
  // interim phonology is needed, only the current inventory.
  const invC = new Set<string>();
  const invV = new Set<string>();
  for (const c of CONCEPTS) for (const p of lexicon[c.id].form) (isVowel(p) ? invV : invC).add(p);
  for (const f of affixForms) for (const p of f) (isVowel(p) ? invV : invC).add(p);
  const fixPhonology = (ph: Pick<Phonology, "vowels" | "consonants">) => {
    // epenthetic vowel and glide must exist
    const ep = applyChanges(changes, [parent.morphology.epenthetic], stressBefore).word;
    mo.epenthetic = ep.length === 1 && isVowel(ep[0]) && ph.vowels.includes(ep[0]) ? ep[0] : ph.vowels.includes(parent.morphology.epenthetic) ? parent.morphology.epenthetic : ph.vowels.filter((v) => !vf(v)!.long)[0] ?? ph.vowels[0];
    if (!ph.consonants.includes(mo.glide)) mo.glide = ["j", "w", "h", "ʔ", "n", "r", "v"].find((c) => ph.consonants.includes(c)) ?? ph.consonants[0];
  };
  fixPhonology({ vowels: [...invV], consonants: [...invC] });

  // 3. Grammatical drift.
  const mrng = rng.fork("morphology");
  const used = new Set<string>(affixForms.map(key));
  const g = stage ? 0.5 : 1;
  if (mrng.chance(0.12 * g)) mo.adjOrder = mo.adjOrder === "AN" ? "NA" : "AN";
  if (mrng.chance(0.08 * g)) mo.compound = mo.compound === "mod-head" ? "head-mod" : "mod-head";
  if (mrng.chance(0.12 * g)) {
    const shifts: Record<WordOrder, WordOrder[]> = { SOV: ["SVO"], SVO: ["SOV", "VSO"], VSO: ["SVO", "VOS"], VOS: ["VSO"], OVS: ["SOV"] };
    mo.wordOrder = mrng.pick(shifts[mo.wordOrder]);
  }
  if (mo.caseMarking && mrng.chance(0.15 * g)) {
    // case endings eroded; adpositions take over
    mo.caseMarking = false;
    mo.adpositions = mo.wordOrder === "SOV" || mo.wordOrder === "OVS" ? "post" : "pre";
    for (const ck of ["gen", "dat", "loc", "all", "abl", "ins"] as AffixKind[]) {
      const coined = generateAffix(parent.phonology, mrng, [["CV", 2], ["VC", 1], ["CVC", 1]], used);
      const evolved = applyChanges(changes, coined, stressBefore).word;
      const form = evolved.some((p) => isVowel(p)) ? evolved : coined;
      used.add(key(form));
      mo.affixes[ck] = { form, pos: mo.adpositions === "pre" ? "before" : "after" };
    }
    mo.affixes.nom = { form: [], pos: "suffix" };
    mo.affixes.acc = { form: [], pos: "suffix" };
  }
  if (!mo.articles && mrng.chance(0.18 * g)) {
    // a demonstrative grammaticalises into an article
    mo.articles = true;
    const that = lexicon.that.form;
    const nuc = nuclei(that);
    const form = nuc.length > 1 ? that.slice(0, nuc[0] + 1) : that.slice();
    mo.affixes.def = { form, pos: mrng.chance(0.6) ? (mo.adjOrder === "AN" ? "before" : "after") : "suffix", source: "that" };
  } else if (mo.articles && mrng.chance(0.06 * g)) {
    mo.articles = false;
    delete mo.affixes.def;
  }

  // 4. Lexical replacement.
  const lrng = rng.fork("lexicon");
  const frac = opts.replacement ?? (stage ? lrng.range(0.02, 0.05) : lrng.range(0.03, 0.08));
  const stable = new Set(["people", "I", "you", "he", "we", "you.pl", "they", "and", "not", "all", "this", "that", "one", "two", "three", "four", "five", "word"]);
  const candidates = CONCEPTS.filter((c) => !stable.has(c.id));
  const nRep = Math.round(candidates.length * frac);
  const interimLang = { phonology: parent.phonology, morphology: mo };
  const avoid = new Set(Object.values(lexicon).map((l) => key(l.form)));
  // Core vocabulary resists replacement (the Swadesh-list effect): tier 1 words are
  // replaced a quarter as often as ordinary ones, rare words more often.
  const TIER_W = [0, 0.25, 1, 1.6];
  const pool = candidates.slice();
  const weights = pool.map((c) => TIER_W[c.tier]);
  const chosen: typeof candidates = [];
  while (chosen.length < nRep && pool.length) {
    const k = lrng.weightedIndex(weights);
    chosen.push(pool[k]);
    pool.splice(k, 1);
    weights.splice(k, 1);
  }
  for (const c of chosen) {
    const r = lrng.next();
    if (r < 0.4) {
      const root = generateRoot(parent.phonology, lrng, c.tier, avoid);
      const form = applyChanges(changes, root, stressBefore).word;
      lexicon[c.id] = { form, origin: { kind: "coined" }, since: id };
      avoid.add(key(form));
    } else if (r < 0.7 && relatedConcept(c.id, lrng.fork("peek" + c.id))) {
      const rel = relatedConcept(c.id, lrng)!;
      lexicon[c.id] = { form: lexicon[rel].form.slice(), origin: { kind: "shift", from: rel }, since: id };
    } else if (c.recipes?.length) {
      const lx = realizeRecipe(interimLang, lrng.pick(c.recipes), (x) => lexicon[x]?.form);
      if (lx && nuclei(lx.form).length <= 5) lexicon[c.id] = { ...lx, since: id };
    } else {
      const root = generateRoot(parent.phonology, lrng, c.tier, avoid);
      const form = applyChanges(changes, root, stressBefore).word;
      lexicon[c.id] = { form, origin: { kind: "coined" }, since: id };
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

  const orthography = driftOrthography(parent.orthography, ph, rng.fork("orthography"), { stage });
  // Taboo replacement: a word that has come to spell an English obscenity is replaced by a coinage.
  const srng = rng.fork("sanitize");
  for (const c of CONCEPTS) {
    for (let k = 0; k < 12 && obscene(romanizeWord(orthography, lexicon[c.id].form)); k++) {
      const form = applyChanges(changes, generateRoot(parent.phonology, srng, c.tier, avoid), stressBefore).word;
      if (form.some((p) => isVowel(p))) lexicon[c.id] = { form, origin: { kind: "coined" }, since: id };
    }
  }
  const naming = driftNamingCulture(parent.naming, rng.fork("naming"));
  // Clipped toponymic heads and name endings evolve with the language.
  if (naming.headForms) {
    for (const [h, f] of Object.entries(naming.headForms)) {
      const r = applyChanges(changes, f, stressBefore).word;
      if (r.some((p) => isVowel(p))) naming.headForms[h] = r;
      else delete naming.headForms[h];
    }
  }
  if (naming.maleEnding) {
    const e = evolveAffix(parent, { form: naming.maleEnding, pos: "suffix" }, changes, stressBefore).form;
    if (e.length) naming.maleEnding = e;
    else delete naming.maleEnding;
  }
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
  if (stage) {
    // Same people, same tongue a few centuries on: the self-name evolves regularly.
    const e = applyChanges(changes, parent.endonymPhonemes, stressBefore).word;
    lang.endonymPhonemes = e;
    lang.endonym = romanizeName(orthography, e);
    lang.endonymGloss = parent.endonymGloss;
    lang.name = opts.name ?? parent.name;
  } else setDaughterEndonym(lang, parent, changes, stressBefore, rng.fork("endonym"), opts.name, [parent.name, ...(opts.avoidNames ?? [])]);
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

/**
 * Whether two related languages' words for a concept are cognate (descend from
 * the same ancestral word). Unrelated languages never share cognates.
 */
export function isCognate(a: Language, b: Language, concept: string): boolean {
  const la = a.lexicon[concept];
  const lb = b.lexicon[concept];
  if (!la || !lb) return false;
  return (la.since ?? a.id) === (lb.since ?? b.id);
}

/** Does this language still use the ancestor's word for a concept (regularly descended)? */
export function retainsWord(lang: Language, ancestor: Language, concept: string): boolean {
  return isCognate(lang, ancestor, concept);
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
