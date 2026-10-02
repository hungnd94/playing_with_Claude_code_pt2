/**
 * Sound styles: coherent bundles of phonological, grammatical, orthographic
 * and onomastic tendencies from which proto-languages are grown.
 *
 * A real language's "look" is not a random draw of independent parameters:
 * Finnish has long vowels, geminates, vowel harmony, few clusters and words
 * ending in vowels, *and* writes them with doubled letters and ä/ö; Georgian
 * stacks consonants into harmonic clusters and writes ejectives with an
 * apostrophe. Each style below captures such a correlated bundle, loosely
 * inspired by an areal type (never a copy of a real language): the generator
 * then varies every choice randomly within the style, and sound change takes
 * the daughters wherever their history leads.
 *
 * Styles are internal: the encyclopedia never names them.
 */
import type { Flavour, Harmony, NamingCulture, StressRule, WordOrder } from "./types";

type W = Partial<Record<Flavour, number>>;

/** Onset-cluster families. */
export type OnsetFamily =
  /** obstruent + liquid (pr, bl, fr, θr…) */
  | "OL"
  /** s + voiceless stop */
  | "sC"
  /** s + stop + liquid (str, spl…) */
  | "sCL"
  /** s + sonorant (sn, sl, sm, sw) */
  | "sN"
  /** C + w */
  | "Cw"
  /** C + j */
  | "Cj"
  /** C + v (Slavic/Kartvelian tv, gv, sv) */
  | "Cv"
  /** h + sonorant (Old Norse hl, hr, hn) */
  | "hR"
  /** prenasalised stops (mb, nd, ŋg) */
  | "NC"
  /** obstruent + obstruent with voicing agreement (Kartvelian) */
  | "harmonic"
  /** m + obstruent (Kartvelian mts, mk) */
  | "mC"
  /** stop + stop/nasal/s (Hellenic pt, kt, kn, ps) */
  | "ptk";

/** Final-cluster families. */
export type FinalFamily = "NC" | "LC" | "sC" | "Cs";

export interface MorphHints {
  order?: [WordOrder, number][];
  /** Probability that a derivational affix is a suffix. */
  suffix?: number;
  caseMarking?: number;
  articles?: number;
  /** Probability adjectives precede nouns. */
  adjFirst?: number;
  /** Probability possessors precede the possessed. */
  genFirst?: number;
  gender?: number;
  /** Derivational affixes that are always prefixes in this style (noun-class languages). */
  prefixes?: string[];
  /** Definite article placement weights: free word before / after, suffix, prefix. */
  defPos?: [("before" | "after" | "suffix" | "prefix"), number][];
}

export interface NamingHints {
  person?: [NamingCulture["personStyle"], number][];
  patronymic?: [NamingCulture["patronymic"], number][];
  dynasty?: [NamingCulture["dynastyStyle"], number][];
}

export interface SoundStyle {
  id: string;
  /** One-line description (docs/debugging only). */
  note: string;
  weight: number;
  /** Affinity with homeland flavours (multiplies the weight). */
  flavours: W;
  /** Consonants always present (space-separated IPA). */
  core: string;
  /** Optional consonants with inclusion probability ("x:0.4 ŋ:0.3"). */
  opt?: string;
  /** Groups added or omitted together ("pʰ tʰ kʰ|0.5"). */
  series?: string[];
  /** Vowel systems (space-separated qualities) with weights. */
  vowels: [string, number][];
  /** Probability of contrastive vowel length. */
  long: number;
  /** Probability of nasal vowels. */
  nasal?: number;
  harmony?: [Harmony, number][];
  /** Onset cluster families with per-member inclusion probability. */
  onsets?: [OnsetFamily, number][];
  /** Explicit extra onset clusters ("θr:0.6 hl:0.5", phonemes joined by "+" when ambiguous: "t+s"). */
  onsetExtra?: string;
  pCluster?: [number, number];
  /** Medial codas (space-separated; "*" = every consonant except glides/laryngeals). */
  codas?: string;
  /** Word-final consonants with weights. */
  finals?: string;
  finalClusters?: [FinalFamily, number][];
  pCoda: [number, number];
  pFinalCoda: [number, number];
  pCodaCluster?: [number, number];
  pInitialVowel: [number, number];
  hiatus?: number;
  geminates?: number;
  /** Root length weights for 1–4 syllables. */
  wordLength: number[];
  stress: [StressRule, number][];
  /** Frequency boosts for signature sounds ("tɬ:3 ts:2"). */
  boost?: string;
  /** Consonants never found word-initially. */
  noInitial?: string;
  /** Banned CV sequences ("t+i t+u s+i"). */
  banned?: string;
  /** Final-vowel preferences ("a:3 o:2"). */
  finalV?: string;
  /** Orthographic traditions with weights. */
  schools: [string, number][];
  morph?: MorphHints;
  naming?: NamingHints;
  /**
   * Areal tendencies in sound change: multipliers on change-template weights
   * ("gradation:4 apocope:0.3"). Daughters of the style inherit them, so a
   * family keeps characteristic kinds of change (Celtic lenition, Polynesian
   * k > ʔ, Prakrit cluster assimilation) without being bound to them.
   */
  drift?: string;
}

export const SOUND_STYLES: SoundStyle[] = [
  {
    id: "finnic",
    note: "long vowels and geminates, front–back harmony, few clusters, vowel-final words",
    weight: 1,
    flavours: { forest: 3, tundra: 3, coast: 1.2, plains: 0.6, river: 0.8 },
    core: "p t k m n s h l r j v",
    opt: "d:0.4 ŋ:0.3 g:0.1 f:0.1 ʃ:0.12",
    vowels: [["a e i o u y ø æ", 3], ["a e i o u y æ", 1], ["a e i o u ø æ", 0.6]],
    long: 0.9,
    harmony: [["palatal", 0.85], ["none", 0.15]],
    codas: "n t s l r h k",
    finals: "n:3 t:1.4 s:1.4 l:0.3 r:0.3",
    pCoda: [0.32, 0.45],
    pFinalCoda: [0.14, 0.3],
    pInitialVowel: [0.15, 0.3],
    hiatus: 0.15,
    geminates: 0.9,
    wordLength: [0.1, 0.55, 0.3, 0.05],
    stress: [["initial", 1]],
    boost: "k:1.6 t:1.4 l:1.3 s:1.2 v:1.2",
    noInitial: "ŋ r:0.3",
    finalV: "a:3 i:2 e:2 o:1 u:1 æ:1.2 y:0.4",
    schools: [["finnic", 5], ["hungarian", 0.6]],
    morph: { order: [["SVO", 1], ["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0.05, adjFirst: 0.9, genFirst: 0.9, gender: 0 },
    naming: { person: [["monothematic", 2], ["opaque", 1.5], ["descriptive", 0.6]], patronymic: [["suffix", 1], ["none", 1.2]] },
    drift: "gradation:4 assibilation:2.5 h-loss:1.5 apocope:0.3 umlaut:0.2 breaking:0.4 final-consonant-loss:1.5 degemination:0.5 diphthongization:2 length-loss:0.3 chain-shift:0.2",
  },
  {
    id: "norse",
    note: "initial stress, heavy codas, -r endings, þ and ð, h-clusters",
    weight: 1,
    flavours: { forest: 2, coast: 2.2, tundra: 1.6, mountains: 1.2, islands: 1 },
    core: "p b t d k g f s h m n l r j v θ",
    opt: "ð:0.75 x:0.2 ŋ:0.25 w:0.3",
    vowels: [["a e i o u y ø", 2], ["a e i o u y ø æ", 2], ["a e i o u æ ɔ", 1]],
    long: 0.8,
    onsets: [["OL", 0.6], ["sC", 0.6], ["sN", 0.45], ["hR", 0.6], ["sCL", 0.35]],
    onsetExtra: "k+w:0.3 t+w:0.3 θ+w:0.25 θ+r:0.6 d+w:0.2 s+w:0.4 s+v:0.2 k+n:0.25 g+n:0.2",
    pCluster: [0.16, 0.26],
    codas: "*",
    finals: "r:4 n:2 l:1.5 s:1.5 t:1 k:1 d:0.8 g:0.8 ð:1 f:0.6 m:0.5 θ:0.3 p:0.3 v:0.3 ŋ:0.3",
    finalClusters: [["NC", 0.6], ["LC", 0.5], ["sC", 0.4], ["Cs", 0.25]],
    pCoda: [0.28, 0.42],
    pFinalCoda: [0.62, 0.85],
    pCodaCluster: [0.1, 0.2],
    pInitialVowel: [0.12, 0.24],
    geminates: 0.5,
    wordLength: [0.42, 0.5, 0.08, 0],
    stress: [["initial", 1]],
    boost: "r:1.6 ð:1.4 θ:1.2 v:1.2",
    noInitial: "ŋ ð",
    finalV: "a:3 i:2 u:1.5 e:1",
    schools: [["nordic", 5], ["germanic", 1], ["anglo", 0.6]],
    morph: { order: [["SVO", 2], ["SOV", 1], ["VSO", 0.3]], suffix: 0.95, caseMarking: 0.6, articles: 0.5, defPos: [["suffix", 2], ["before", 1]], adjFirst: 0.85, genFirst: 0.6, gender: 0.6 },
    naming: { person: [["dithematic", 4], ["monothematic", 1]], patronymic: [["suffix", 3], ["none", 0.5]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "umlaut:3 breaking:2 final-devoicing:1.5 apocope:2 syncope:2 compensatory-lengthening:1.5 cluster-assimilation:1.5 initial-cluster-simplification:2 rhotacism:2.5 chain-shift:0.3",
  },
  {
    id: "celtic",
    note: "lenited fricatives (dd, ff, ll, ch), w and y as vowels, verb-first",
    weight: 1,
    flavours: { coast: 2.2, forest: 1.6, islands: 1.6, mountains: 1.2 },
    core: "p b t d k g f v s h m n l r w j",
    opt: "θ:0.6 ð:0.75 x:0.7 ɬ:0.65 ŋ:0.4 ʃ:0.3",
    vowels: [["a e i o u ɨ", 2], ["a e i o u ə", 1], ["a e i o u", 1]],
    long: 0.35,
    onsets: [["OL", 0.6], ["sC", 0.2], ["sN", 0.2]],
    onsetExtra: "g+w:0.85 k+w:0.3 d+w:0.3 t+w:0.25 k+n:0.2 x+w:0.3",
    pCluster: [0.12, 0.22],
    codas: "n r l m s θ ð x f v d g k t ɬ ŋ",
    finals: "n:2.5 r:2 l:1.5 ð:1.6 θ:0.8 x:1 d:1 g:0.8 s:0.8 f:0.8 v:0.8 ɬ:0.6 m:0.6 ŋ:0.4",
    finalClusters: [["LC", 0.4], ["NC", 0.3]],
    pCoda: [0.3, 0.42],
    pFinalCoda: [0.5, 0.75],
    pCodaCluster: [0.06, 0.14],
    pInitialVowel: [0.1, 0.2],
    wordLength: [0.35, 0.5, 0.15, 0],
    stress: [["penult", 3], ["initial", 1]],
    boost: "ð:1.6 ɬ:1.5 w:1.5 x:1.3 v:1.2",
    noInitial: "ŋ ð:0.6",
    finalV: "i:2 a:1.5 o:1.5 ə:1 ɨ:1.5",
    schools: [["celtic", 6], ["anglo", 0.4]],
    morph: { order: [["VSO", 4], ["SVO", 1]], suffix: 0.8, caseMarking: 0.15, articles: 0.85, defPos: [["before", 4], ["prefix", 1]], adjFirst: 0.15, genFirst: 0.1, gender: 0.7 },
    naming: { person: [["dithematic", 2], ["monothematic", 2], ["descriptive", 0.5]], patronymic: [["particle", 3], ["prefix", 1]], dynasty: [["house", 2], ["suffix", 1]] },
    drift: "lenition:4 labial-change:3 apocope:2.5 final-consonant-loss:1.5 s-debuccalization:2 umlaut:1.5 intervocalic-spirantization:2 nasalization:0.5",
  },
  {
    id: "semitic",
    note: "three vowels with length, pharyngeals, gemination, consonant-initial words",
    weight: 1,
    flavours: { desert: 5, river: 1.3, steppe: 0.8, coast: 0.7, mountains: 0.6 },
    core: "b t d k q ʔ f s z ʃ x ħ ʕ h m n l r j w",
    opt: "θ:0.35 ð:0.35 ɣ:0.5 tʼ:0.45 sʼ:0.45 g:0.35 dʒ:0.45",
    vowels: [["a i u", 4], ["a i u e o", 1]],
    long: 0.95,
    pInitialVowel: [0, 0],
    codas: "*",
    finals: "n:1.5 r:1.5 m:1.2 l:1 b:0.8 d:0.8 t:1 q:0.8 ʃ:0.6 s:0.7 k:0.7 ħ:0.6 ʕ:0.4 f:0.5 z:0.4 j:0.5 w:0.3 ð:0.3 θ:0.3",
    pCoda: [0.42, 0.58],
    pFinalCoda: [0.5, 0.75],
    geminates: 0.85,
    wordLength: [0.25, 0.55, 0.2, 0],
    stress: [["weight", 4], ["penult", 1]],
    boost: "q:1.8 ħ:1.6 ʕ:1.4 ʃ:1.3 r:1.2",
    finalV: "a:3 i:1.5 u:1.5",
    schools: [["semitic", 6]],
    morph: { order: [["VSO", 2], ["SVO", 2]], suffix: 0.6, caseMarking: 0.4, articles: 0.75, defPos: [["prefix", 3], ["before", 1]], adjFirst: 0.05, genFirst: 0.05, gender: 0.95 },
    naming: { person: [["monothematic", 2], ["dithematic", 1.2], ["descriptive", 0.6]], patronymic: [["particle", 4], ["none", 0.5]], dynasty: [["house", 2], ["suffix", 1]] },
    drift: "intervocalic-spirantization:3 h-loss:3 vowel-merger:1.5 monophthongization:2 final-consonant-loss:0.3 apocope:1.5 dental-fricative-loss:2 umlaut:0.2 breaking:0.3",
  },
  {
    id: "japonic",
    note: "open syllables with moraic n, five vowels, sh/ch/ts, long ō",
    weight: 1,
    flavours: { islands: 3, coast: 1.4, mountains: 1.2, river: 0.6 },
    core: "k g s z t d n h b p m j r w",
    opt: "ts:0.85 ʃ:0.85 tʃ:0.85 dʒ:0.6 ɸ:0.3",
    vowels: [["a e i o u", 1]],
    long: 0.6,
    onsetExtra: "k+j:0.5 g+j:0.3 r+j:0.4 n+j:0.3 h+j:0.3 m+j:0.2 b+j:0.2 p+j:0.15",
    pCluster: [0.04, 0.08],
    codas: "n",
    finals: "n:1",
    pCoda: [0.08, 0.16],
    pFinalCoda: [0.08, 0.18],
    pInitialVowel: [0.12, 0.25],
    hiatus: 0.5,
    geminates: 0.6,
    wordLength: [0.04, 0.42, 0.42, 0.12],
    stress: [["penult", 1]],
    boost: "k:1.4 t:1.2 s:1.2 r:1.3 m:1.2 ts:1.3",
    banned: "t+i t+u d+i d+u s+i z+i h+u w+i w+u w+e j+i j+e",
    finalV: "a:2 o:2 i:2 u:1.2 e:0.8",
    schools: [["hepburn", 6]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.9, articles: 0, adjFirst: 1, genFirst: 1, gender: 0 },
    naming: { person: [["monothematic", 2], ["opaque", 1], ["dithematic", 1]], patronymic: [["none", 3], ["particle", 0.5]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "labial-change:4 assibilation-u:3 assibilation:3 intervocalic-voicing:1.5 contraction:2 h-loss:3 apocope:0.05 final-consonant-loss:0.05 syncope:0.1 final-reduction:0.1 umlaut:0.1 breaking:0.2 final-devoicing:0.1 metathesis:0.05 prothesis:0",
  },
  {
    id: "nahuan",
    note: "tl, tz, ch, x and kw; words in -tl and -li",
    weight: 1,
    flavours: { jungle: 2.2, mountains: 1.8, river: 1.4, plains: 1 },
    core: "p t k kʷ ts tʃ tɬ s ʃ m n l j w ʔ",
    vowels: [["a e i o", 3], ["a e i o u", 1]],
    long: 0.35,
    codas: "n l s ʃ k ʔ tɬ tʃ ts kʷ",
    finals: "tɬ:3 n:1 ʔ:0.6 l:0.5 k:0.5 ʃ:0.3 s:0.3 ts:0.3 tʃ:0.2",
    pCoda: [0.26, 0.38],
    pFinalCoda: [0.32, 0.5],
    pInitialVowel: [0.15, 0.28],
    geminates: 0.4,
    wordLength: [0.12, 0.45, 0.33, 0.1],
    stress: [["penult", 1]],
    boost: "tɬ:2.6 ts:1.6 tʃ:1.6 kʷ:1.4 ʃ:1.3 w:1.2",
    finalV: "i:2 a:2 o:1.5 e:0.8",
    schools: [["nahuatl", 6]],
    morph: { order: [["SVO", 2], ["VSO", 1.2], ["SOV", 0.5]], suffix: 0.8, caseMarking: 0.1, articles: 0.1, adjFirst: 0.7, genFirst: 0.3, gender: 0 },
    naming: { person: [["descriptive", 3], ["monothematic", 1.5], ["dithematic", 0.6]], patronymic: [["none", 3], ["particle", 0.5]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "h-loss:1.5 final-consonant-loss:1 vowel-merger:1 labial-change:1 umlaut:0.2 apocope:0.6 breaking:0.3",
  },
  {
    id: "polynesian",
    note: "very few consonants, strictly open syllables, glottal stop and long vowels",
    weight: 1,
    flavours: { islands: 6, coast: 1, jungle: 0.6 },
    core: "p t k m n h w ʔ",
    opt: "ŋ:0.5 f:0.4 v:0.35 s:0.15",
    series: ["l|0.55", "r|0.45"],
    vowels: [["a e i o u", 1]],
    long: 0.65,
    pCoda: [0, 0],
    pFinalCoda: [0, 0],
    pInitialVowel: [0.25, 0.4],
    hiatus: 0.95,
    wordLength: [0.03, 0.42, 0.4, 0.15],
    stress: [["penult", 1]],
    boost: "k:1.3 ʔ:1.6 h:1.4 l:1.3 n:1.2",
    finalV: "a:2 i:1.5 u:1.5 e:1 o:1.2",
    schools: [["polynesian", 6]],
    morph: { order: [["VSO", 3], ["SVO", 1]], suffix: 0.6, caseMarking: 0.05, articles: 0.9, defPos: [["before", 1]], adjFirst: 0.05, genFirst: 0.1, gender: 0 },
    naming: { person: [["descriptive", 2], ["dithematic", 1.5], ["monothematic", 1]], patronymic: [["none", 2], ["particle", 1]], dynasty: [["house", 2]] },
    drift: "polynesian-shift:8 s-debuccalization:3 debuccalization:3 rhotic-change:2 apocope:0.02 final-reduction:0.1 final-consonant-loss:0 syncope:0.05 umlaut:0.1 breaking:0.1 nasal-velarization:0 metathesis:0 intervocalic-voicing:0.3 velar-palatalization:0.3 contraction:2 glide-fortition:1 h-loss:2 prothesis:0",
  },
  {
    id: "kartvelian",
    note: "ejectives, stacked harmonic onset clusters (mts, gv, tsk), vowel-final words",
    weight: 1,
    flavours: { mountains: 5, steppe: 0.6, forest: 0.6 },
    core: "p b pʼ t d tʼ k g kʼ ts dz tsʼ tʃ dʒ tʃʼ s z ʃ ʒ x ɣ h m n l r v",
    opt: "qʼ:0.6 χ:0.15",
    vowels: [["a e i o u", 1]],
    long: 0,
    onsets: [["harmonic", 0.55], ["OL", 0.45], ["sC", 0.4], ["mC", 0.45], ["Cv", 0.55]],
    pCluster: [0.28, 0.4],
    codas: "n r l s m v ts tʃ",
    finals: "n:1 r:1 l:0.8 s:0.8 m:0.5",
    pCoda: [0.2, 0.3],
    pFinalCoda: [0.08, 0.25],
    pInitialVowel: [0.12, 0.22],
    wordLength: [0.15, 0.5, 0.3, 0.05],
    stress: [["initial", 1]],
    boost: "v:1.6 ts:1.3 tsʼ:1.5 kʼ:1.4 x:1.3 ɣ:1.2 m:1.2",
    finalV: "i:3 a:2 o:1 e:1 u:0.6",
    schools: [["kartvelian", 6]],
    morph: { order: [["SOV", 3], ["SVO", 1]], suffix: 0.9, caseMarking: 0.95, articles: 0, adjFirst: 0.9, genFirst: 0.85, gender: 0 },
    naming: { person: [["monothematic", 2], ["dithematic", 1], ["opaque", 1]], patronymic: [["suffix", 2], ["none", 1]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "ejective-loss:0.5 syncope:2 metathesis:1 vowel-merger:1 final-devoicing:0.5 cluster-assimilation:1 umlaut:0.2 breaking:0.3",
  },
  {
    id: "turkic",
    note: "eight vowels in palatal harmony, final stress, no initial clusters, -n/-r/-k/-q endings",
    weight: 1,
    flavours: { steppe: 5, desert: 1.4, tundra: 1, mountains: 0.8 },
    core: "p b t d k g s z ʃ tʃ dʒ m n ŋ l r j",
    opt: "q:0.4 ɣ:0.5 x:0.35 v:0.35 h:0.3",
    vowels: [["a e i o u y ø ɯ", 4], ["a e i o u y ø", 1]],
    long: 0.12,
    harmony: [["palatal", 0.95], ["none", 0.05]],
    codas: "*",
    finals: "n:2 r:2 l:1.5 k:1 q:1 t:1 s:1 z:0.8 ʃ:0.6 tʃ:0.6 m:0.8 ŋ:0.6 j:0.6 ɣ:0.5",
    finalClusters: [["LC", 0.4], ["NC", 0.3], ["sC", 0.15]],
    pCoda: [0.38, 0.52],
    pFinalCoda: [0.6, 0.8],
    pCodaCluster: [0.04, 0.1],
    pInitialVowel: [0.2, 0.35],
    wordLength: [0.28, 0.52, 0.18, 0.02],
    stress: [["final", 1]],
    boost: "k:1.3 q:1.4 r:1.2 ʃ:1.2 tʃ:1.2",
    noInitial: "ŋ r:0.8 l:0.4 ɣ",
    finalV: "a:2 e:1.5 i:1 ɯ:1",
    schools: [["turkic", 6]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0, adjFirst: 1, genFirst: 1, gender: 0 },
    naming: { person: [["descriptive", 3], ["monothematic", 1.5]], patronymic: [["suffix", 2], ["particle", 1], ["none", 1]], dynasty: [["suffix", 1], ["house", 1]] },
    drift: "glide-fortition:3 final-devoicing:2 intervocalic-voicing:1.5 uvular-merger:1.5 debuccalization:1 vowel-lowering:1 apocope:0.2 breaking:0.2 umlaut:0.2 syncope:0.8",
  },
  {
    id: "mongolic",
    note: "long vowels in harmony, kh/ts/j, sonorant codas, initial stress",
    weight: 0.8,
    flavours: { steppe: 4, tundra: 1.6, desert: 1, mountains: 0.8 },
    core: "b t d g x s ʃ ts tʃ dʒ m n ŋ l r j",
    opt: "p:0.15 ɣ:0.4 w:0.2 k:0.3",
    vowels: [["a e i o u y ø", 3], ["a e i o u ɔ ʊ", 1]],
    long: 0.85,
    harmony: [["palatal", 0.8], ["none", 0.2]],
    codas: "n ŋ l r s g d t x m j b",
    finals: "n:2 r:1.5 l:1.5 ŋ:1 g:0.8 d:0.6 x:0.6 s:0.6 t:0.6 j:0.6 m:0.4",
    pCoda: [0.35, 0.48],
    pFinalCoda: [0.55, 0.75],
    pInitialVowel: [0.2, 0.32],
    wordLength: [0.22, 0.52, 0.22, 0.04],
    stress: [["initial", 1]],
    boost: "x:1.6 ts:1.3 dʒ:1.3 g:1.2 b:1.3",
    noInitial: "ŋ r l:0.5",
    finalV: "a:2 e:1 i:1 u:1",
    schools: [["mongolic", 5], ["turkic", 1]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0, adjFirst: 1, genFirst: 1, gender: 0 },
    naming: { person: [["descriptive", 3], ["monothematic", 1.5], ["dithematic", 1]], patronymic: [["none", 2], ["suffix", 1]], dynasty: [["suffix", 1], ["house", 1]] },
    drift: "intervocalic-loss:3 contraction:3 debuccalization:1 velar-palatalization:1 final-consonant-loss:1 apocope:0.5 breaking:0.2",
  },
  {
    id: "slavic",
    note: "č/š/ž, palatal ň, s-clusters and v-clusters, -k/-v/-ts endings",
    weight: 1,
    flavours: { plains: 2.4, forest: 2.4, river: 1.6, steppe: 1, mountains: 1 },
    core: "p b t d k g f v s z ʃ ʒ ts tʃ x m n ɲ l r j",
    opt: "dʒ:0.2 ʎ:0.3",
    vowels: [["a e i o u ɨ", 3], ["a e i o u", 2], ["a e i o u ə", 0.5]],
    long: 0.12,
    onsets: [["OL", 0.7], ["sC", 0.6], ["sN", 0.5], ["sCL", 0.35], ["Cv", 0.4]],
    onsetExtra: "z+v:0.35 z+l:0.3 z+d:0.2 ʃ+t:0.3 ʃ+k:0.3 ʃ+p:0.2 x+r:0.35 x+l:0.3 x+v:0.3 m+j:0.15 b+j:0.15 v+j:0.15 k+n:0.25 g+n:0.25 m+n:0.15 s+v:0.5 t+v:0.3 d+v:0.3",
    pCluster: [0.16, 0.26],
    codas: "r l n m s ʃ k t v x ts tʃ d ɲ",
    finals: "k:1.5 v:1.2 n:1 r:1 l:1 ts:1 tʃ:0.8 ʃ:0.6 s:0.8 t:0.8 m:0.6 x:0.4 d:0.4 ɲ:0.4",
    finalClusters: [["sC", 0.35], ["LC", 0.3]],
    pCoda: [0.24, 0.36],
    pFinalCoda: [0.42, 0.62],
    pCodaCluster: [0.04, 0.1],
    pInitialVowel: [0.06, 0.14],
    wordLength: [0.3, 0.5, 0.18, 0.02],
    stress: [["penult", 2], ["initial", 1]],
    boost: "v:1.5 ʃ:1.3 tʃ:1.3 ts:1.2 ʒ:1.2 ɲ:1.2",
    noInitial: "ɲ",
    finalV: "a:3 o:2 e:1.5 i:1 ɨ:1",
    schools: [["slavic", 4], ["polish", 2]],
    morph: { order: [["SVO", 3], ["SOV", 1]], suffix: 0.92, caseMarking: 0.9, articles: 0.05, adjFirst: 0.9, genFirst: 0.2, gender: 0.85 },
    naming: { person: [["dithematic", 4], ["monothematic", 1]], patronymic: [["suffix", 3], ["none", 0.5]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "velar-palatalization:3 assibilation:2 final-consonant-loss:2 apocope:1.5 monophthongization:2 nasalization:1.5 metathesis:2.5 prothesis:1 final-devoicing:2 l-palatalization:1.5 umlaut:0.3 unstressed-reduction:1.5",
  },
  {
    id: "germanic",
    note: "initial stress, clusters both ends, ch and sch, ts, umlauted vowels",
    weight: 0.8,
    flavours: { forest: 2.4, plains: 2, river: 1.4, coast: 1 },
    core: "p b t d k g f v s z ʃ x h m n ŋ l r j",
    opt: "ts:0.6 pf:0.2 w:0.3",
    vowels: [["a e i o u y ø", 2], ["a e i o u ɛ ɔ", 1], ["a e i o u", 1]],
    long: 0.7,
    onsets: [["OL", 0.7], ["sN", 0.4], ["sC", 0.5]],
    onsetExtra: "ʃ+p:0.5 ʃ+t:0.5 ʃ+l:0.4 ʃ+m:0.3 ʃ+n:0.3 ʃ+v:0.35 ʃ+r:0.3 k+n:0.3 ts+v:0.3 k+v:0.3 g+n:0.15",
    pCluster: [0.14, 0.24],
    codas: "*",
    finals: "n:2 r:1.5 l:1 t:1.2 k:1 x:1 s:1 f:0.6 m:0.6 ŋ:0.5 ts:0.5 ʃ:0.4 p:0.3",
    finalClusters: [["LC", 0.5], ["NC", 0.5], ["sC", 0.4]],
    pCoda: [0.3, 0.42],
    pFinalCoda: [0.6, 0.82],
    pCodaCluster: [0.1, 0.2],
    pInitialVowel: [0.1, 0.2],
    wordLength: [0.45, 0.47, 0.08, 0],
    stress: [["initial", 1]],
    boost: "x:1.4 ʃ:1.3 ts:1.2 v:1.1",
    noInitial: "ŋ",
    finalV: "e:3 a:1.5 o:1 i:1",
    schools: [["germanic", 5], ["anglo", 1.5]],
    morph: { order: [["SOV", 1.2], ["SVO", 2]], suffix: 0.9, caseMarking: 0.55, articles: 0.8, defPos: [["before", 3], ["suffix", 1]], adjFirst: 0.95, genFirst: 0.5, gender: 0.8 },
    naming: { person: [["dithematic", 5], ["monothematic", 1]], patronymic: [["suffix", 1.5], ["none", 1]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "umlaut:3 chain-shift:2 final-devoicing:2 apocope:1.5 unstressed-reduction:2 final-reduction:2 diphthongization:1.5 breaking:1",
  },
  {
    id: "bantu",
    note: "prenasalised stops (mb, nd, ng), open syllables, noun-class prefixes",
    weight: 1,
    flavours: { jungle: 3, plains: 2.2, river: 1.6, coast: 1 },
    core: "p b t d k g m n ɲ ŋ s z f v ʃ tʃ dʒ l w j h",
    vowels: [["a e i o u", 3], ["a e ɛ i o ɔ u", 1]],
    long: 0.2,
    onsets: [["NC", 0.9], ["Cw", 0.4], ["Cj", 0.25]],
    pCluster: [0.16, 0.26],
    pCoda: [0, 0],
    pFinalCoda: [0, 0],
    pInitialVowel: [0.1, 0.22],
    hiatus: 0.25,
    wordLength: [0.03, 0.42, 0.42, 0.13],
    stress: [["penult", 1]],
    boost: "ŋ:1.2 ɲ:1.3 w:1.3 l:1.2",
    noInitial: "ŋ:0.5",
    finalV: "a:3 i:2 o:1.5 u:1.5 e:1",
    schools: [["bantu", 5], ["anglo", 1]],
    morph: { order: [["SVO", 1]], suffix: 0.35, caseMarking: 0.05, articles: 0.05, adjFirst: 0.05, genFirst: 0.05, gender: 0, prefixes: ["demonym", "land", "collective", "place", "pl"] },
    naming: { person: [["descriptive", 2], ["opaque", 1.5], ["monothematic", 1.5]], patronymic: [["particle", 1], ["none", 1.5]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "spirantization-high:4 intervocalic-loss:1.5 glide-formation:2 contraction:2 apocope:0.05 final-consonant-loss:0 umlaut:0.1 breaking:0.3 syncope:0.1 final-devoicing:0 metathesis:0.1 lenition:1 d-flapping:2.5 postnasal-voicing:2 final-reduction:0.2 chain-shift:0.2",
  },
  {
    id: "mayan",
    note: "CVC roots, ejectives written with an apostrophe, x and tz, final stress",
    weight: 0.9,
    flavours: { jungle: 3.4, mountains: 1.4, river: 0.8 },
    core: "p b t tʼ k kʼ ʔ ts tsʼ tʃ tʃʼ s ʃ x h m n l w j",
    opt: "q:0.3 qʼ:0.25 r:0.3 pʼ:0.3",
    vowels: [["a e i o u", 1]],
    long: 0.5,
    codas: "*",
    finals: "l:1.5 n:1.5 m:1 k:1 kʼ:1 tʃ:0.8 tʃʼ:0.6 ts:0.6 tsʼ:0.4 x:0.6 ʔ:0.4 b:0.6 t:0.6 j:0.5 w:0.4 ʃ:0.5",
    pCoda: [0.32, 0.44],
    pFinalCoda: [0.7, 0.88],
    pInitialVowel: [0.06, 0.14],
    wordLength: [0.55, 0.38, 0.07, 0],
    stress: [["final", 1]],
    boost: "kʼ:1.6 tsʼ:1.4 tʃʼ:1.4 x:1.4 ʃ:1.3 b:1.3",
    finalV: "a:2 i:1 e:1 o:1",
    schools: [["mayan", 6]],
    morph: { order: [["VOS", 3], ["VSO", 1], ["SVO", 1]], suffix: 0.5, caseMarking: 0.05, articles: 0.3, defPos: [["before", 1]], adjFirst: 0.9, genFirst: 0.1, gender: 0 },
    naming: { person: [["descriptive", 3], ["dithematic", 1]], patronymic: [["none", 2], ["particle", 1]], dynasty: [["house", 1]] },
    drift: "velar-palatalization:2 vowel-merger:1 length-loss:1 final-consonant-loss:0.3 ejective-loss:0.5 apocope:1 umlaut:0.2",
  },
  {
    id: "sinitic",
    note: "monosyllabic roots, aspirated affricates, nasal codas only, glide medials",
    weight: 0.9,
    flavours: { river: 3.4, plains: 1.6, mountains: 0.8, coast: 0.8 },
    core: "p pʰ t tʰ k kʰ ts tsʰ tɕ tɕʰ ʂ ʈʂ ʈʂʰ ɕ s x f m n l ʐ",
    opt: "w:0.4 j:0.4",
    vowels: [["a e i o u y ə", 2], ["a e i o u y", 1]],
    long: 0,
    onsets: [["Cw", 0.4], ["Cj", 0.35]],
    pCluster: [0.12, 0.22],
    codas: "n ŋ",
    finals: "n:1 ŋ:1",
    pCoda: [0.38, 0.5],
    pFinalCoda: [0.38, 0.52],
    pInitialVowel: [0.04, 0.1],
    hiatus: 0,
    wordLength: [0.72, 0.28, 0, 0],
    stress: [["initial", 1]],
    boost: "ʈʂ:1.3 tɕ:1.3 ɕ:1.3 x:1.2 l:1.2",
    finalV: "a:2 i:1.5 u:1.2 o:1 ə:1",
    schools: [["pinyin", 6]],
    morph: { order: [["SVO", 1]], suffix: 0.9, caseMarking: 0, articles: 0, adjFirst: 1, genFirst: 1, gender: 0 },
    naming: { person: [["monothematic", 3], ["dithematic", 2]], patronymic: [["none", 3]], dynasty: [["house", 2]] },
    drift: "final-consonant-loss:2 velar-palatalization:3 nasal-velarization:1.5 aspirate-change:0.5 monophthongization:2 apocope:0.05 syncope:0 umlaut:0 metathesis:0 prothesis:0 lenition:0.2 intervocalic-voicing:0.2 final-devoicing:0.2",
  },
  {
    id: "indic",
    note: "retroflexes, breathy and aspirated stops, ā ī ū, vowel-final names",
    weight: 1,
    flavours: { river: 3, plains: 2.4, jungle: 1.6 },
    core: "p pʰ b bʱ t tʰ d dʱ ʈ ɖ k kʰ g gʱ tʃ tʃʰ dʒ m n ɳ ɲ ŋ s ʃ ʂ h ʋ j r l",
    opt: "ʈʰ:0.4 ɖʱ:0.4 dʒʱ:0.4 ɭ:0.15",
    vowels: [["a e i o u", 1]],
    long: 0.95,
    onsets: [["OL", 0.22], ["Cj", 0.15]],
    onsetExtra: "s+ʋ:0.4 d+ʋ:0.4 t+ʋ:0.3 ʃ+ʋ:0.3 ʃ+r:0.4 k+ʂ:0.3 p+r:0.5 t+r:0.5 b+r:0.4 d+r:0.4",
    pCluster: [0.08, 0.16],
    codas: "m n ɳ r s ʃ t k p ŋ l",
    finals: "n:1 m:1 t:0.5 s:0.5 r:0.5",
    pCoda: [0.24, 0.34],
    pFinalCoda: [0.08, 0.22],
    pInitialVowel: [0.12, 0.25],
    geminates: 0.35,
    wordLength: [0.08, 0.45, 0.35, 0.12],
    stress: [["latin", 2], ["penult", 1]],
    boost: "ʈ:1.3 ɖ:1.2 dʱ:1.3 bʱ:1.2 ʋ:1.2 ʂ:1.2",
    noInitial: "ŋ ɳ ɲ:0.5",
    finalV: "a:6 i:1.5 u:1 e:0.6",
    schools: [["indic", 6]],
    morph: { order: [["SOV", 1]], suffix: 0.95, caseMarking: 0.9, articles: 0, adjFirst: 0.95, genFirst: 0.95, gender: 0.8 },
    naming: { person: [["dithematic", 3], ["descriptive", 1], ["monothematic", 1]], patronymic: [["suffix", 1], ["none", 1.5]], dynasty: [["suffix", 1], ["house", 1]] },
    drift: "cluster-assimilation:3 final-consonant-loss:2 intervocalic-loss:2 retroflex-loss:0.3 h-loss:0.5 monophthongization:2 apocope:1.5 syncope:1.5 umlaut:0.2 aspirate-change:0.4",
  },
  {
    id: "dravidian",
    note: "retroflex laterals, geminates everywhere, long vowels, -am/-ai/-u endings",
    weight: 0.7,
    flavours: { jungle: 2.2, river: 1.8, coast: 1.2, plains: 1 },
    core: "p t ʈ k tʃ m n ɳ ɲ ŋ s l ɭ r ɾ j ʋ",
    opt: "b:0.3 d:0.3 g:0.3 ɖ:0.3 ʃ:0.3 h:0.2 ɽ:0.3",
    vowels: [["a e i o u", 1]],
    long: 0.95,
    codas: "n ɳ m l ɭ r j",
    finals: "m:2 n:2 l:1 ɭ:0.6 r:0.5 j:0.5",
    pCoda: [0.22, 0.32],
    pFinalCoda: [0.28, 0.45],
    pInitialVowel: [0.18, 0.3],
    geminates: 0.95,
    wordLength: [0.05, 0.38, 0.42, 0.15],
    stress: [["initial", 1]],
    boost: "ɭ:1.5 ʈ:1.3 ɳ:1.3 ʋ:1.3 ɾ:1.2",
    noInitial: "ŋ ɳ ɭ ɽ ɾ",
    finalV: "u:3 a:2 i:2 e:0.6",
    schools: [["indic", 5]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0, adjFirst: 1, genFirst: 1, gender: 0.4 },
    naming: { person: [["dithematic", 2], ["monothematic", 2]], patronymic: [["prefix", 1], ["none", 1]], dynasty: [["suffix", 1], ["house", 1]] },
    drift: "intervocalic-voicing:2 final-epenthesis:2 lenition:1 apocope:0.3 vowel-merger:1 umlaut:0.2 breaking:0.2",
  },
  {
    id: "latinate",
    note: "obstruent+liquid onsets, endings in -s/-m/-a, qu, penultimate law stress",
    weight: 1,
    flavours: { coast: 2, river: 1.8, plains: 1.6, mountains: 0.8 },
    core: "p b t d k g f s m n l r j w",
    opt: "kʷ:0.6 h:0.5 v:0.15 z:0.1",
    vowels: [["a e i o u", 3], ["a e ɛ i o ɔ u", 1]],
    long: 0.55,
    onsets: [["OL", 0.7], ["sC", 0.3]],
    pCluster: [0.1, 0.18],
    codas: "n m r l s k t p",
    finals: "s:3 m:1.5 n:1 r:1.2 t:0.8 l:0.5 k:0.3",
    finalClusters: [["NC", 0.3], ["Cs", 0.2]],
    pCoda: [0.24, 0.34],
    pFinalCoda: [0.42, 0.62],
    pCodaCluster: [0.03, 0.08],
    pInitialVowel: [0.14, 0.26],
    geminates: 0.3,
    wordLength: [0.12, 0.45, 0.35, 0.08],
    stress: [["latin", 1]],
    boost: "s:1.3 r:1.2 kʷ:1.3",
    finalV: "a:3 o:1.5 e:1.5 i:1 u:1",
    schools: [["classical", 3], ["romance", 3]],
    morph: { order: [["SOV", 1.5], ["SVO", 2]], suffix: 0.95, caseMarking: 0.75, articles: 0.3, defPos: [["before", 1]], adjFirst: 0.35, genFirst: 0.3, gender: 0.9 },
    naming: { person: [["monothematic", 3], ["descriptive", 1], ["dithematic", 1]], patronymic: [["none", 1], ["suffix", 1]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "velar-palatalization:3 intervocalic-voicing:2.5 intervocalic-spirantization:2 diphthongization:2 breaking:2.5 apocope:1.5 final-consonant-loss:2 h-loss:3 labiovelar-change:2 nasalization:1 l-palatalization:2 prothesis:2.5 metathesis:0.3 unstressed-reduction:1.5 syncope:2 umlaut:0.3",
  },
  {
    id: "hellenic",
    note: "aspirated stops written ph/th/kh, pt- and kn- onsets, endings in -os/-on/-a",
    weight: 0.9,
    flavours: { coast: 2.4, islands: 1.8, mountains: 1.2 },
    core: "p pʰ b t tʰ d k kʰ g s z m n l r h",
    opt: "j:0.3 w:0.15",
    vowels: [["a e i o u y", 2], ["a e ɛ i o ɔ u y", 1]],
    long: 0.8,
    onsets: [["OL", 0.7], ["sC", 0.5], ["ptk", 0.4], ["sN", 0.2]],
    pCluster: [0.12, 0.2],
    codas: "n s r l k p",
    finals: "s:3 n:2 r:1",
    finalClusters: [["Cs", 0.45]],
    pCoda: [0.22, 0.32],
    pFinalCoda: [0.5, 0.7],
    pCodaCluster: [0.03, 0.08],
    pInitialVowel: [0.18, 0.3],
    wordLength: [0.08, 0.4, 0.38, 0.14],
    stress: [["latin", 2], ["antepenult", 1]],
    boost: "kʰ:1.3 tʰ:1.3 pʰ:1.2 s:1.2",
    noInitial: "",
    finalV: "a:2 e:1.5 o:1.5 i:1",
    schools: [["classical", 6]],
    morph: { order: [["SVO", 2], ["SOV", 1]], suffix: 0.95, caseMarking: 0.95, articles: 0.9, defPos: [["before", 1]], adjFirst: 0.7, genFirst: 0.4, gender: 0.95 },
    naming: { person: [["dithematic", 4], ["monothematic", 1]], patronymic: [["suffix", 1.5], ["none", 1]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "aspirate-change:4 unrounding:3 vowel-raising:2 monophthongization:2 final-consonant-loss:1.5 h-loss:3 intervocalic-spirantization:2 umlaut:0.2",
  },
  {
    id: "iranian",
    note: "kh/sh/zh, long ā, final stress, final clusters (-rd, -st, -nd)",
    weight: 0.9,
    flavours: { desert: 2.4, steppe: 2.2, mountains: 2, plains: 0.8 },
    core: "p b t d k g f v s z ʃ ʒ x h m n r l j tʃ dʒ",
    opt: "ɣ:0.45 q:0.35 θ:0.2 w:0.3",
    vowels: [["a e i o u", 2], ["a i u e o ɑ", 1]],
    long: 0.7,
    onsets: [["sC", 0.25], ["OL", 0.15]],
    onsetExtra: "x+ʃ:0.15 f+r:0.3 x+r:0.25",
    pCluster: [0.05, 0.1],
    codas: "r n m s ʃ z x f d t k b g l",
    finals: "n:2 r:2 d:1.2 m:0.8 z:0.8 ʃ:0.6 s:0.6 x:0.5 b:0.5 t:0.4 l:0.4 v:0.3",
    finalClusters: [["LC", 0.5], ["NC", 0.4], ["sC", 0.4]],
    pCoda: [0.32, 0.45],
    pFinalCoda: [0.6, 0.82],
    pCodaCluster: [0.08, 0.16],
    pInitialVowel: [0.18, 0.3],
    wordLength: [0.25, 0.5, 0.22, 0.03],
    stress: [["final", 1]],
    boost: "x:1.4 ʃ:1.3 z:1.2 r:1.2",
    finalV: "a:2 i:1.5 e:1 u:0.6",
    schools: [["iranian", 5], ["semitic", 1], ["anglo", 1]],
    morph: { order: [["SOV", 1]], suffix: 0.9, caseMarking: 0.3, articles: 0.1, adjFirst: 0.2, genFirst: 0.15, gender: 0.2 },
    naming: { person: [["dithematic", 2], ["descriptive", 1.5], ["monothematic", 1]], patronymic: [["suffix", 2], ["particle", 1]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "intervocalic-spirantization:2 lenition:1.5 apocope:2.5 final-consonant-loss:1.5 debuccalization:1 vowel-merger:1 glide-fortition:1.5 umlaut:0.3",
  },
  {
    id: "quechuan",
    note: "three vowels, uvular q, ll and ñ, plain/aspirated/ejective series",
    weight: 0.8,
    flavours: { mountains: 3.6, plains: 0.8, jungle: 0.8 },
    core: "p t k q tʃ s h m n ɲ l ʎ r j w",
    opt: "ʃ:0.3",
    series: ["pʰ tʰ kʰ qʰ tʃʰ pʼ tʼ kʼ qʼ tʃʼ|0.45"],
    vowels: [["a i u", 1]],
    long: 0.15,
    codas: "n m r s j w k q ʃ",
    finals: "n:2 j:1 q:1 k:0.6 s:0.6 r:0.6 w:0.4",
    pCoda: [0.28, 0.42],
    pFinalCoda: [0.3, 0.5],
    pInitialVowel: [0.15, 0.28],
    wordLength: [0.05, 0.45, 0.38, 0.12],
    stress: [["penult", 1]],
    boost: "q:1.6 ʎ:1.5 tʃ:1.3 ɲ:1.2 w:1.2",
    noInitial: "",
    finalV: "a:3 i:1.5 u:1.5",
    schools: [["andean", 6]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0, adjFirst: 1, genFirst: 1, gender: 0 },
    naming: { person: [["descriptive", 3], ["monothematic", 1.5]], patronymic: [["none", 2]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "aspirate-change:1 ejective-loss:1 uvular-merger:1 vowel-lowering:1.5 lenition:0.5 final-consonant-loss:0.5 apocope:0.3 umlaut:0 breaking:0.2",
  },
  {
    id: "austronesian",
    note: "CVCVC roots, ng/ny, final -an/-ang/-ak, penultimate stress",
    weight: 1,
    flavours: { islands: 3, coast: 2.4, jungle: 2, river: 1 },
    core: "p b t d k g m n ɲ ŋ s h l r j w tʃ dʒ",
    opt: "ʔ:0.4",
    vowels: [["a i u e o ə", 2], ["a i u", 1], ["a i u e o", 1.5]],
    long: 0.02,
    codas: "n ŋ m r l s k t p h ʔ",
    finals: "n:2 ŋ:2 k:1 t:0.8 h:1 s:0.8 r:0.8 l:0.6 m:0.5 p:0.3 ʔ:0.4",
    pCoda: [0.22, 0.32],
    pFinalCoda: [0.48, 0.68],
    pInitialVowel: [0.12, 0.24],
    wordLength: [0.06, 0.62, 0.28, 0.04],
    stress: [["penult", 1]],
    boost: "ŋ:1.5 ɲ:1.2 s:1.2 r:1.2 k:1.2",
    finalV: "a:3 i:1.5 u:1.5 o:1 e:0.6",
    schools: [["malay", 5], ["anglo", 0.8]],
    morph: { order: [["SVO", 2], ["VSO", 1]], suffix: 0.55, caseMarking: 0.05, articles: 0.45, defPos: [["before", 1]], adjFirst: 0.1, genFirst: 0.1, gender: 0 },
    naming: { person: [["monothematic", 2], ["descriptive", 2], ["opaque", 1]], patronymic: [["particle", 1.5], ["none", 1]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "vowel-merger:3 final-consonant-loss:1.5 h-loss:2 debuccalization:1 rhotic-change:1 intervocalic-loss:1 d-flapping:1.5 contraction:2 metathesis:0.5 apocope:0.3 umlaut:0.2",
  },
  {
    id: "inuit",
    note: "three vowels, uvular q, long polysynthetic words, geminates, stop-final words",
    weight: 0.8,
    flavours: { tundra: 6, coast: 0.6, islands: 0.6 },
    core: "p t k q m n ŋ s v ɣ l j",
    opt: "ɬ:0.6 ʁ:0.55 h:0.15",
    vowels: [["a i u", 1]],
    long: 0.8,
    codas: "k q t p m n ŋ ɣ",
    finals: "k:2 q:2 t:2 n:0.5 p:0.3",
    pCoda: [0.32, 0.45],
    pFinalCoda: [0.55, 0.75],
    pInitialVowel: [0.3, 0.42],
    geminates: 0.6,
    wordLength: [0.02, 0.32, 0.45, 0.21],
    stress: [["final", 1], ["penult", 1]],
    boost: "q:1.8 k:1.3 v:1.2 ŋ:1.2 ɬ:1.3",
    noInitial: "ŋ ɣ ʁ l:0.5 ɬ",
    finalV: "a:2 i:2 u:2",
    schools: [["inuit", 6]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0, adjFirst: 0.2, genFirst: 1, gender: 0 },
    naming: { person: [["opaque", 2], ["monothematic", 2], ["descriptive", 1]], patronymic: [["none", 3]], dynasty: [["house", 1]] },
    drift: "cluster-assimilation:4 uvular-merger:0.3 vowel-merger:1 degemination:0.5 intervocalic-loss:1.5 contraction:2 apocope:0.3 umlaut:0.1",
  },
  {
    id: "vasconic",
    note: "tz/tx, ñ and ll, no onset clusters, no initial r, definite -a",
    weight: 0.7,
    flavours: { mountains: 2.4, coast: 1.4, forest: 0.8 },
    core: "p b t d k g ts tʃ s ʃ m n ɲ l ʎ r ɾ j",
    opt: "x:0.5 h:0.3 f:0.2",
    vowels: [["a e i o u", 1]],
    long: 0,
    codas: "n r l s ts tʃ k",
    finals: "n:2 r:2 s:1 ts:1 tʃ:0.5 k:0.6 l:0.6 t:0.3",
    pCoda: [0.3, 0.4],
    pFinalCoda: [0.4, 0.6],
    pInitialVowel: [0.25, 0.4],
    wordLength: [0.12, 0.45, 0.35, 0.08],
    stress: [["second", 1], ["penult", 1]],
    boost: "ts:1.5 tʃ:1.3 ɾ:1.2 ɲ:1.2 ʃ:1.2",
    noInitial: "r ɾ ɲ ʎ",
    finalV: "a:3 e:1.5 i:1 o:1",
    schools: [["basque", 6]],
    morph: { order: [["SOV", 1]], suffix: 1, caseMarking: 0.95, articles: 0.9, defPos: [["suffix", 1]], adjFirst: 0.1, genFirst: 1, gender: 0 },
    naming: { person: [["monothematic", 2], ["descriptive", 1.5], ["opaque", 1]], patronymic: [["none", 2]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "lenition:1.5 h-loss:2 labial-change:2 prothesis:1 apocope:0.5 umlaut:0.2",
  },
  {
    id: "riverine",
    note: "ancient river-valley type: short CVC words, few vowels, -ur/-ag/-ash endings",
    weight: 0.8,
    flavours: { river: 3, desert: 1.6, plains: 1.4 },
    core: "b d g p t k z s ʃ x m n ŋ l r",
    opt: "h:0.3 j:0.3 w:0.3 ts:0.2",
    vowels: [["a e i u", 3], ["a e i o u", 1]],
    long: 0.2,
    codas: "*",
    finals: "r:1.6 k:1 ʃ:1 g:0.8 d:0.7 n:1 m:0.6 l:0.6 b:0.4 x:0.4 s:0.5",
    pCoda: [0.3, 0.42],
    pFinalCoda: [0.55, 0.75],
    pInitialVowel: [0.2, 0.32],
    wordLength: [0.38, 0.5, 0.12, 0],
    stress: [["final", 1], ["initial", 1]],
    boost: "ʃ:1.3 g:1.2 r:1.3 x:1.2",
    noInitial: "ŋ",
    finalV: "a:2 u:2 i:1 e:1",
    schools: [["anglo", 2], ["semitic", 2]],
    morph: { order: [["SOV", 1]], suffix: 0.9, caseMarking: 0.85, articles: 0, adjFirst: 0.2, genFirst: 0.2, gender: 0 },
    naming: { person: [["dithematic", 2], ["monothematic", 2]], patronymic: [["particle", 1], ["none", 1]], dynasty: [["house", 1], ["suffix", 1]] },
    drift: "final-consonant-loss:1.5 vowel-merger:1.5 intervocalic-voicing:1.2",
  },
  {
    id: "magyar",
    note: "front–back harmony, long vowels with acute, cs/sz/zs/gy/ny spellings, initial stress",
    weight: 0.6,
    flavours: { plains: 2.6, steppe: 1.6, river: 1.2, forest: 1 },
    core: "p b t d k g f v s z ʃ ʒ ts tʃ c ɟ m n ɲ l r j h",
    vowels: [["a e i o u y ø", 1]],
    long: 0.85,
    harmony: [["palatal", 0.9], ["none", 0.1]],
    codas: "*",
    finals: "n:2 r:1.5 l:1.2 s:1.2 t:1 k:1 ɲ:0.6 ʃ:0.6 ts:0.5 tʃ:0.5 ɟ:0.5 m:0.6 z:0.5 j:0.3",
    finalClusters: [["LC", 0.3], ["NC", 0.3]],
    pCoda: [0.32, 0.44],
    pFinalCoda: [0.55, 0.75],
    pCodaCluster: [0.04, 0.1],
    pInitialVowel: [0.2, 0.32],
    geminates: 0.5,
    wordLength: [0.3, 0.52, 0.16, 0.02],
    stress: [["initial", 1]],
    boost: "ɟ:1.4 ɲ:1.3 tʃ:1.2 s:1.2",
    noInitial: "ɲ:0.5",
    finalV: "a:2 e:2 i:1 o:1",
    schools: [["hungarian", 6]],
    morph: { order: [["SOV", 1], ["SVO", 1]], suffix: 1, caseMarking: 0.95, articles: 0.8, defPos: [["before", 1]], adjFirst: 1, genFirst: 1, gender: 0 },
    naming: { person: [["monothematic", 2], ["descriptive", 1], ["dithematic", 1]], patronymic: [["none", 2], ["suffix", 1]], dynasty: [["suffix", 2], ["house", 1]] },
    drift: "final-consonant-loss:0.5 vowel-lowering:1.5 lenition:1 apocope:2 umlaut:0.5 diphthongization:0.5",
  },
];

export const STYLE_BY_ID: Record<string, SoundStyle> = Object.fromEntries(SOUND_STYLES.map((s) => [s.id, s]));

/** Parse "a:1 b:0.5" (weight 1 when omitted). "+" joins multi-phoneme items: "t+s" → ["t","s"]. */
export function parseWeighted(s: string | undefined): [string, number][] {
  if (!s) return [];
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const i = tok.lastIndexOf(":");
      return i > 0 ? [tok.slice(0, i), +tok.slice(i + 1)] : [tok, 1];
    });
}

export function styleWeight(s: SoundStyle, flavour: Flavour | null): number {
  return s.weight * (flavour ? (s.flavours[flavour] ?? 0.25) : 1);
}
