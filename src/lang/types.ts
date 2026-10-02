/**
 * Data model of the language engine. Everything here is plain JSON: languages
 * are built in a Web Worker and posted to the UI thread, so no class instances
 * or functions live in these structures.
 */

/** A word: an array of IPA phonemes. */
export type Word = string[];

/** Where a stress falls, as a function of the word's syllables. */
export type StressRule =
  | "initial"
  | "second"
  | "penult"
  | "antepenult"
  | "final"
  /** Latin: penult if heavy, else antepenult. */
  | "latin"
  /** Rightmost heavy syllable among the last three, else antepenult (roughly Classical Arabic). */
  | "weight";

export type Harmony = "none" | "palatal" | "rounding";

/** A homeland hint that biases (never determines) a proto-language's sound. */
export type Flavour =
  | "steppe"
  | "coast"
  | "islands"
  | "jungle"
  | "mountains"
  | "desert"
  | "forest"
  | "tundra"
  | "river"
  | "plains";

export const FLAVOURS: readonly Flavour[] = ["steppe", "coast", "islands", "jungle", "mountains", "desert", "forest", "tundra", "river", "plains"];

export interface Phonology {
  consonants: string[];
  /** Vowel phonemes, long and nasal vowels included as separate phonemes. */
  vowels: string[];
  /** Relative frequencies (Zipf-like) for single onsets, codas and nuclei. */
  wOnset: Record<string, number>;
  wCoda: Record<string, number>;
  wVowel: Record<string, number>;
  /** Permitted onset clusters (2+ consonants). */
  onsetClusters: string[][];
  /** Permitted medial coda clusters (2+ consonants). */
  codaClusters: string[][];
  /** Permitted word-final clusters (2+ consonants). */
  finalClusters: string[][];
  /** Single consonants permitted in a medial coda. */
  codas: string[];
  /** Single consonants permitted word-finally. */
  finals: string[];
  /** Consonants never found word-initially. */
  initialBanned: string[];
  /** Probability a word begins with a vowel. */
  pInitialVowel: number;
  /** Whether vowels may stand in hiatus (V.V) inside a word. */
  hiatus: boolean;
  /** Whether geminates (CC of the same consonant) may occur medially. */
  geminates: boolean;
  /** Probability of a coda in a medial syllable / at the end of a word. */
  pCoda: number;
  pFinalCoda: number;
  /** Probability of an onset cluster (when clusters exist). */
  pCluster: number;
  /** Probability that a coda is a cluster (when clusters exist). */
  pCodaCluster: number;
  /** Root length weights [1, 2, 3, 4 syllables] for tier-2 concepts; tier 1 skews shorter, tier 3 longer. */
  wordLength: number[];
  harmony: Harmony;
  stress: StressRule;
  /** Short descriptor of the syllable canon, e.g. "(C)(C)V(C)". */
  canon: string;
  /** Sound style the proto-language was grown from (see styles.ts); inherited by daughters. */
  style?: string;
  /** Relative weights of word-final consonants (defaults to `wCoda`). */
  wFinal?: Record<string, number>;
  /** Multipliers for word-final vowel qualities (e.g. Latin-like -a, Japanese-like -o/-i). */
  wFinalV?: Record<string, number>;
  /** Banned consonant + vowel-quality sequences (e.g. Japanese-like *ti, *tu, *si). */
  banned?: [string, string][];
  /** Probability that a medial syllable boundary is a geminate (kk, tt, ll). */
  pGeminate?: number;
}

export type AffixKind =
  // derivation (naming)
  | "place"
  | "land"
  | "demonym"
  | "adj"
  | "dim"
  | "aug"
  | "agent"
  | "abstract"
  | "fem"
  | "patronym"
  | "dynasty"
  | "collective"
  // inflection (grammar)
  | "pl"
  | "def"
  | "nom"
  | "acc"
  | "gen"
  | "dat"
  | "loc"
  | "all"
  | "abl"
  | "ins"
  | "prs"
  | "pst"
  | "fut"
  | "imp"
  | "neg"
  | "1sg"
  | "2sg"
  | "3sg"
  | "1pl"
  | "2pl"
  | "3pl";

export interface Affix {
  form: Word;
  /** prefix/suffix attach to the word; "before"/"after" are free particles. */
  pos: "prefix" | "suffix" | "before" | "after";
  /** Concept the affix was grammaticalised from (e.g. the place suffix from "land"). */
  source?: string;
}

export type WordOrder = "SOV" | "SVO" | "VSO" | "VOS" | "OVS";

export interface Morphology {
  /** Compound order: modifier–head ("Stone-ford") or head–modifier ("Ford-stone"). */
  compound: "mod-head" | "head-mod";
  /** Linking element between compound members ([] = none). */
  link: Word;
  linkMode: "always" | "repair" | "never";
  /** Vowel inserted to repair illegal clusters at morpheme junctions. */
  epenthetic: string;
  /** How vowel hiatus at junctions is repaired. */
  hiatusRepair: "elide" | "glide" | "keep";
  /** Consonant used for "glide" hiatus repair. */
  glide: string;
  /** Preferred consonant-cluster repair at junctions. */
  clusterRepair: "epenthesis" | "deletion";
  adjOrder: "AN" | "NA";
  /** Possessor before (GN) or after (NG) the possessed noun. */
  genOrder: "GN" | "NG";
  wordOrder: WordOrder;
  adpositions: "pre" | "post";
  caseMarking: boolean;
  articles: boolean;
  /** Grammatical gender (masculine/feminine) on persons. */
  gender: boolean;
  /** Subject agreement on verbs. */
  agreement: boolean;
  proDrop: boolean;
  affixes: Partial<Record<AffixKind, Affix>>;
}

/** A context-dependent spelling: phoneme `p` spelled `s` when the environment matches. */
export interface SpellingRule {
  p: string;
  s: string;
  /** Next segment: front vowel, any vowel, non-vowel (consonant or end), end of word. */
  before?: "front" | "back" | "vowel" | "nonvowel" | "end";
  /** Previous segment: vowel, consonant, start of word. */
  after?: "vowel" | "consonant" | "start";
}

export interface Orthography {
  /** Name of the dominant orthographic tradition ("anglo", "slavic", "semitic", …). */
  school: string;
  map: Record<string, string>;
  rules: SpellingRule[];
  /** Spell geminates by doubling the first letter of a digraph ("sh"+"sh" → "ssh"). */
  geminateFirstLetter: boolean;
}

/** One element of a sound-change environment. */
export type EnvToken =
  | "#" // word boundary
  | "V" // any vowel
  | "V'" // stressed vowel
  | "V-" // unstressed vowel
  | "C" // any consonant
  | "C*" // zero or more consonants
  | "N" // nasal
  | "NV" // not a vowel (consonant or boundary)
  | "NC" // not a consonant (vowel or boundary)
  | "OBS" // obstruent
  | "SON" // sonorant consonant
  | "FRONT" // front vowel
  | "LAB" // labial consonant
  | "VEL"; // velar consonant
export type EnvItem = EnvToken | string[];

/**
 * A regular sound change. Changes are stored as explicit phoneme mappings over
 * the inventory current at the time they apply (`map`), plus environments, so
 * they serialise to JSON and apply identically to the lexicon and to names.
 */
export interface SoundChange {
  /** Template id ("intervocalic-voicing", …). */
  id: string;
  /** Short title, e.g. "Intervocalic voicing". */
  name: string;
  /** One-sentence English description. */
  description: string;
  /** Linguist's notation, e.g. "*p t k > b d g / V_V". */
  notation: string;
  /** Number of segments matched (0 = insertion, 1 or 2). */
  span: 0 | 1 | 2;
  /** key = matched phonemes joined by "+", value = replacement (empty = deletion). For insertions key "". */
  map: Record<string, Word>;
  left: EnvItem[];
  right: EnvItem[];
  /** Exceptions: the change does not apply when immediately preceded by one of these. */
  notAfter?: string[];
  /** Stress condition on the (first) target vowel. */
  stress?: "stressed" | "unstressed";
  /** A stress shift (no segmental change). */
  newStress?: StressRule;
}

export interface LineageStep {
  /** Language this step starts from. */
  from: string;
  /** Language this step produces. */
  to: string;
  /** English name of `to` when it was derived. */
  toName: string;
  year: number;
  stressBefore: StressRule;
  changes: SoundChange[];
  /** Orthography of `to` (so intermediate forms can be romanised). */
  orthography: Orthography;
}

export type LexOrigin =
  | { kind: "root" }
  | { kind: "inherited"; from: string }
  | { kind: "compound"; parts: string[] }
  | { kind: "derived"; base: string; affix: AffixKind }
  | { kind: "coined" }
  | { kind: "shift"; from: string }
  | { kind: "borrowed"; lang: string; langName: string };

export interface Lexeme {
  form: Word;
  origin: LexOrigin;
  /**
   * Id of the language in which this word's line of descent began (the proto-language
   * for inherited roots; a daughter for words it coined, borrowed or re-derived).
   * Two languages' words for a concept are cognate when they share `since`.
   */
  since?: string;
}

export interface NamingCulture {
  /** Favourite settlement heads, weighted (concept ids). */
  settlementHeads: [string, number][];
  /** Weights of settlement naming patterns. */
  patterns: Record<string, number>;
  /** Personal-name style. */
  personStyle: "dithematic" | "monothematic" | "descriptive" | "opaque";
  /** How female names are marked. */
  femaleMarking: "suffix" | "elements" | "none";
  /** Personal-name elements: first and second positions (concept ids). */
  firstElements: string[];
  secondElements: string[];
  femaleElements: string[];
  /** How byname/patronymic is formed. */
  patronymic: "suffix" | "prefix" | "particle" | "none";
  /** Probability a person gets an epithet. */
  epithetChance: number;
  /** "suffix": Founder+dynasty suffix ("Merovingians"); "house": House of X. */
  dynastyStyle: "suffix" | "house";
  /** Probability a new person name reuses an existing one from the pool. */
  reuse: number;
  /** Two-word place names ("Nova Kesh") vs compounds. */
  phrasal: number;
  /** Clipped combining forms of favourite settlement heads (like -stan from stāna), by concept id. */
  headForms?: Record<string, Word>;
  /** A characteristic ending of men's names (like -us, -os, -as), applied to simple names. */
  maleEnding?: Word;
}

export interface Language {
  id: string;
  /** English name ("Keshi"). Mutable by the caller. */
  name: string;
  /** Native self-name, romanised. */
  endonym: string;
  endonymPhonemes: Word;
  /** Gloss of the endonym ("speech of the people"). */
  endonymGloss: string;
  parent: string | null;
  /** Number of splits from the root proto-language. */
  depth: number;
  /** Year the language emerged. */
  year: number;
  flavour: Flavour | null;
  /** Whether forms in this language are attested (false → cited with *). */
  attested: boolean;
  phonology: Phonology;
  morphology: Morphology;
  orthography: Orthography;
  lexicon: Record<string, Lexeme>;
  naming: NamingCulture;
  /** Every sound-change step from the root proto-language down to this language. */
  lineage: LineageStep[];
  /** Root key for deterministic lazy generation. */
  seed: string;
}

export interface NamePart {
  phonemes: Word;
  roman: string;
  gloss: string;
  /** Concept id for roots. */
  concept?: string;
  /** Affix kind for affixes. */
  affix?: AffixKind;
  /** "link" for linking/epenthetic material, "name" for a whole embedded name. */
  role: "root" | "affix" | "link" | "name";
  /** Index of the word (in multi-word names) this part belongs to. */
  word: number;
}

export interface EtymStep {
  lang: string;
  /** Label of the language when recorded ("Proto-Keshi", "Old Keshi"). */
  label: string;
  phonemes: Word;
  roman: string;
  /** Morpheme-segmented citation form ("Kaś-tabar"). */
  segmented: string;
  gloss: string;
  how: "coined" | "inherited" | "borrowed";
  /** Cite with an asterisk (unattested). */
  star: boolean;
  year?: number;
}

export type NameKind =
  | "settlement"
  | "realm"
  | "people"
  | "river"
  | "mountain"
  | "range"
  | "hills"
  | "sea"
  | "ocean"
  | "bay"
  | "strait"
  | "lake"
  | "forest"
  | "jungle"
  | "desert"
  | "steppe"
  | "plain"
  | "marsh"
  | "tundra"
  | "glacier"
  | "volcano"
  | "island"
  | "archipelago"
  | "peninsula"
  | "continent"
  | "deity"
  | "religion"
  | "dynasty"
  | "person"
  | "language"
  | "other";

export interface Name {
  lang: string;
  kind: NameKind;
  /** All phonemes; multi-word names separate words with a single " " element. */
  phonemes: Word;
  /** Phonemes per word. */
  words: Word[];
  /** Romanised, capitalised display form ("Kešdavar"). */
  roman: string;
  /** IPA with stress marks, no slashes ("ˈkeʃdavar"). */
  ipa: string;
  /** Literal English meaning, title case ("Stone Ford"); "" when opaque. */
  gloss: string;
  parts: NamePart[];
  /** Etymological chain, oldest first (the current form is the name itself). */
  history: EtymStep[];
  /** Pre-rendered etymology ("from Old Keshi *Kaś-tabar 'stone ford'"), "" for fresh coinages. */
  etym: string;
  /** Free-form extras (e.g. gender for persons). */
  meta?: Record<string, string>;
}

/** Per-world (or per-language) uniqueness registry and personal-name pools. Plain JSON. */
export interface NameRegistry {
  used: Record<string, Record<string, 1>>;
  pools: Record<string, { m: Name[]; f: Name[] }>;
}
