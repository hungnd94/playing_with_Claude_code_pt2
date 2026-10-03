/**
 * Romanisation. Each language picks a dominant orthographic tradition
 * ("school": anglo, germanic, nordic, slavic, polish, hungarian, romance,
 * celtic, turkic, mongolic, semitic, iranian, polynesian, nahuatl, basque,
 * hepburn, finnic, classical, kartvelian, pinyin, indic, andean, bantu, mayan,
 * inuit, malay), normally suggested by its sound style, and adapts it to its
 * inventory with collision-free spellings.
 *
 * What makes a spelling system look like *one* system rather than a pile of
 * letters is restraint: Czech uses carons and acutes, Hawaiian macrons and the
 * ʻokina, Welsh circumflexes, Finnish two dotted vowels. Each school therefore
 * declares the diacritic types it uses natively; spellings that would bring in
 * a foreign mark are penalised, and long and nasal vowels follow one
 * convention per language (ā or aa or á; French-like "an/am", Polish ą ę, or
 * Portuguese ã õ). Contextual rules (c/qu, diphthong glides, m before labials,
 * nk) and letter-level fix-ups finish the job.
 *
 * Daughter languages inherit their parent's spelling, spell new sounds the
 * school's way, and now and then undergo a coherent reform: adopting a
 * related tradition, dropping one kind of diacritic, or a single local
 * innovation (kh → ch).
 *
 * Also: IPA transcription with stress marks.
 */
import type { Rng } from "../core/rng";
import { cf, features, isVowel, phonemeFor, vf, vowelQuality } from "./phoneme";
import { stressedSyllable, syllabify } from "./phonology";
import type { Orthography, Phonology, SpellingRule, StressRule, Word } from "./types";
import { capitalize } from "./util";

type LongStyle = "double" | "macron" | "acute" | "circumflex";
type NasalStyle = "n" | "tilde-ao" | "ogonek" | "tilde";

interface School {
  id: string;
  /** Preferred spellings per phoneme (consonants and short vowel qualities), best first. */
  map: Record<string, string[]>;
  /** Phonemes whose first-choice spelling varies by language (one picked per language). */
  variants?: Record<string, string[]>;
  long: LongStyle[];
  nasal: NasalStyle;
  /** Sample letters showing the diacritics this tradition uses natively ("š á ą"). */
  marks: string;
  jAfterV: string;
  wAfterV: string;
  rules?: SpellingRule[];
  /** Phonemes this tradition is good at spelling (affinity, used when no style suggests a school). */
  likes: string[];
  /** Hard requirement on the inventory. */
  requires?: (inv: Set<string>) => boolean;
  geminateFirst?: boolean;
  /** Two-phoneme spellings ("k+s" → "x"). */
  pairs?: Record<string, string>;
  /** Letter-level clean-ups (regex source → replacement). */
  fixups?: [string, string][];
  /** Traditions a daughter might reform its spelling towards. */
  related: string[];
}

/** Generic consonant candidates, used after the school's own. */
const DEFAULT: Record<string, string[]> = {
  p: ["p"], b: ["b"], t: ["t"], d: ["d"], ʈ: ["ṭ", "tt"], ɖ: ["ḍ", "dd"], c: ["ty", "ky", "ć"], ɟ: ["gy", "dy", "ǵ"],
  k: ["k", "c"], g: ["g"], q: ["q"], ɢ: ["g", "gh", "ġ"], ʔ: ["'", "ʻ", "ʾ"],
  pf: ["pf"], ts: ["ts", "tz", "c"], dz: ["dz", "z"], tʃ: ["ch", "tch", "č"], dʒ: ["j", "dj", "dž"],
  ʈʂ: ["zh", "tr"], ɖʐ: ["dr"], tɕ: ["ch", "ty", "ć"], dʑ: ["dy", "dź"], tɬ: ["tl", "tlh"],
  ɸ: ["f", "ph", "fh"], β: ["v", "bh", "w"], f: ["f", "ph"], v: ["v", "w"], θ: ["th", "þ"], ð: ["dh", "ð"],
  s: ["s", "ss"], z: ["z", "ż"], ʃ: ["sh", "š"], ʒ: ["zh", "ž"], ʂ: ["sh", "ṣ"], ʐ: ["zh", "ẓ"],
  ɕ: ["sy", "ś"], ʑ: ["zy", "ź"], ç: ["hy", "ch", "ç"], ʝ: ["yh", "gh"], x: ["kh", "ch", "x"], ɣ: ["gh", "ğ"],
  χ: ["kh", "qh", "x"], ʁ: ["gh", "rh", "r"], ħ: ["hh", "ḥ"], ʕ: ["'", "ʿ"], h: ["h"], ɦ: ["h", "hh"],
  ɬ: ["ll", "lh", "hl"], ɮ: ["dl"], m: ["m"], n: ["n"], ɳ: ["rn", "ṇ"], ɲ: ["ny", "nh", "ñ"],
  ŋ: ["ng", "nn", "ñ"], ɴ: ["ng"], r: ["r", "rr"], ʀ: ["r", "rr"], ɾ: ["r"], ɽ: ["rd", "ṛ"], l: ["l"], ɭ: ["rl", "ḷ"],
  ʎ: ["ly", "lh", "ll", "lj"], j: ["y", "j"], w: ["w", "u"], ʋ: ["v", "w"], ɹ: ["r"], ɰ: ["gh", "w"],
};

/** Generic candidates for vowel qualities: plain letters and digraphs before marked letters. */
const VOWELS: Record<string, string[]> = {
  a: ["a"], e: ["e"], i: ["i"], o: ["o"], u: ["u"],
  y: ["ü", "y", "yu", "ue"], ø: ["ö", "eu", "ø", "oe"], æ: ["ae", "ä", "æ"], ɛ: ["è", "ae", "ä", "ea"], ɔ: ["ò", "aw", "å", "oa"],
  ə: ["ë", "ă", "e", "a"], ɨ: ["y", "ï", "ı", "ui"], ɯ: ["ı", "ŭ", "ü"], ʉ: ["ü", "u"], ɑ: ["â", "ah", "å", "aa"], ɒ: ["å", "ò"],
  ɪ: ["i", "ĭ"], ʏ: ["ü"], ʊ: ["u", "ŭ"], ɘ: ["ë"], ɵ: ["ö"], ɤ: ["õ", "ë", "ŏ"], œ: ["œ", "ö", "oe"], ɜ: ["ë", "ö"],
  ʌ: ["ŭ", "ă", "u"], ɐ: ["a", "ă"],
};

const SCHOOLS: School[] = [
  {
    id: "anglo", long: ["double", "macron"], nasal: "n", marks: "ā ë", jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      ʃ: ["sh"], tʃ: ["ch"], dʒ: ["j"], j: ["y"], x: ["kh"], θ: ["th"], ð: ["dh"], ɣ: ["gh"], ʒ: ["zh"], ŋ: ["ng"], ɲ: ["ny"],
      χ: ["kh", "q"], ʁ: ["gh"], ħ: ["hh"], ʕ: ["'"], ts: ["ts"], q: ["q"], ç: ["hy"], ʝ: ["y"],
      ə: ["ë", "u"], ɨ: ["y", "ui"], ɛ: ["ae", "ea"], ɔ: ["aw", "oa"], æ: ["ae", "a"], ø: ["eu", "oe"], y: ["ue", "yu"], ɯ: ["ui", "uh"], ɑ: ["ah", "aa"],
    },
    variants: { x: ["kh", "x"] },
    likes: ["ʃ", "tʃ", "θ", "x"],
    related: ["germanic", "celtic", "nordic"],
  },
  {
    id: "germanic", long: ["double"], nasal: "n", marks: "ä å", jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      ʃ: ["sch"], tʃ: ["tsch"], x: ["ch"], j: ["j"], ts: ["z", "tz"], ç: ["ch"], y: ["ü"], ø: ["ö"], æ: ["ä"], ɛ: ["ä", "è"],
      ɔ: ["å", "oa"], dʒ: ["dsch"], ʒ: ["sh", "zh"], z: ["z", "s"], v: ["w", "v"], w: ["w", "u"], f: ["f"], ŋ: ["ng"], ə: ["e", "ë"],
      θ: ["th"], ð: ["dh"], ɣ: ["gh"], ɲ: ["nj"], ɨ: ["y"], ɯ: ["ü"],
    },
    likes: ["ʃ", "x", "ts", "y", "ø", "pf", "ç", "v"],
    related: ["nordic", "anglo"],
  },
  {
    id: "nordic", long: ["acute"], nasal: "ogonek", marks: "á ø æ þ ð ǫ å ö", jAfterV: "i", wAfterV: "u",
    map: {
      θ: ["þ"], ð: ["ð"], j: ["j"], ʃ: ["sj", "sk"], tʃ: ["tj", "kj"], x: ["h", "ch"], ɣ: ["g", "gh"], æ: ["æ"], ø: ["ø", "ö"],
      ɔ: ["ǫ", "å"], y: ["y"], w: ["v", "w"], v: ["v", "f"], ɑ: ["å"], œ: ["œ"], ŋ: ["ng"], ə: ["e", "ö"], ç: ["hj"], ʒ: ["zj"],
      ts: ["z", "ts"], dʒ: ["dj"], β: ["v"], ɸ: ["f"], ʎ: ["lj"], ɲ: ["nj"], ɨ: ["y", "ö"],
    },
    likes: ["θ", "ð", "æ", "ø", "ɔ", "y"],
    related: ["germanic", "anglo"],
  },
  {
    id: "slavic", long: ["acute"], nasal: "ogonek", marks: "š á ą ŭ ô ě", jAfterV: "j", wAfterV: "u",
    map: {
      ʃ: ["š"], tʃ: ["č"], ʒ: ["ž"], dʒ: ["dž"], ts: ["c"], x: ["ch", "h"], j: ["j"], ɲ: ["ň", "nj"], ʎ: ["ľ", "lj"], ɨ: ["y"],
      tɕ: ["ć"], ɕ: ["ś"], ʑ: ["ź"], dʑ: ["dź"], ə: ["ă", "ŭ"], c: ["ť"], ɟ: ["ď"], w: ["v", "ŭ"], ɣ: ["h", "gh"], θ: ["th"],
      ð: ["dh"], dz: ["dz"], ŋ: ["ng"], ɛ: ["ě", "e"], æ: ["ä"], ɔ: ["ô"], y: ["ü"], ø: ["ö"], ɯ: ["y"],
    },
    variants: { x: ["ch", "h"] },
    likes: ["ʃ", "tʃ", "ʒ", "ts", "x", "ɨ", "tɕ", "ɲ"],
    related: ["polish", "hungarian"],
  },
  {
    id: "polish", long: ["acute"], nasal: "ogonek", marks: "ó ż ą ł ë", jAfterV: "j", wAfterV: "ł",
    map: {
      ʃ: ["sz"], tʃ: ["cz"], ʒ: ["ż", "rz"], dʒ: ["dż"], ts: ["c"], x: ["ch"], j: ["j"], v: ["w"], w: ["ł"], ɲ: ["ń"], tɕ: ["ć"],
      ɕ: ["ś"], ʑ: ["ź"], dʑ: ["dź"], ɨ: ["y"], ʎ: ["l"], dz: ["dz"], ə: ["ë"], ɣ: ["h", "gh"], ŋ: ["ng"], y: ["ü"], ø: ["ö"],
      ɛ: ["ę", "è"], ɔ: ["ò"], æ: ["ä"],
    },
    likes: ["ʃ", "tʃ", "ʒ", "ts", "ɕ", "tɕ", "ɨ", "v"],
    requires: (inv) => inv.has("v") || inv.has("ʃ"),
    related: ["slavic"],
  },
  {
    id: "hungarian", long: ["acute"], nasal: "n", marks: "á ö ő", jAfterV: "j", wAfterV: "u",
    map: {
      s: ["sz"], ʃ: ["s"], tʃ: ["cs"], ʒ: ["zs"], ts: ["c"], dʒ: ["dzs"], ɟ: ["gy"], c: ["ty"], ɲ: ["ny"], ʎ: ["ly"], j: ["j"],
      y: ["ü"], ø: ["ö"], x: ["ch", "h"], dz: ["dz"], ŋ: ["ng"], ə: ["ë"], ɛ: ["ä", "e"], æ: ["ä"], ɨ: ["ü", "y"], ɔ: ["å"],
    },
    likes: ["y", "ø", "ɟ", "c", "ɲ", "tʃ"],
    requires: (inv) => inv.has("ʃ") && inv.has("s"),
    related: ["slavic", "germanic"],
  },
  {
    id: "romance", long: ["acute"], nasal: "tilde-ao", marks: "á à ã ç ñ ë", jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      k: ["c"], tʃ: ["ch"], ʃ: ["x", "sc"], ɲ: ["ñ", "gn"], ʎ: ["ll", "gl"], θ: ["z"], x: ["j", "kh"], dʒ: ["g", "dj"], j: ["y", "i"],
      w: ["u", "hu"], ts: ["z", "ç"], ʒ: ["j"], r: ["rr", "r"], ɛ: ["è"], ɔ: ["ò"], kʷ: ["qu"], gʷ: ["gu"], ə: ["ë"], ð: ["d"],
      β: ["b"], ɣ: ["g"], dz: ["z"], y: ["ü"], ø: ["eu"], æ: ["ae"], ɨ: ["ï"],
    },
    rules: [
      { p: "k", s: "qu", before: "front" },
      { p: "g", s: "gu", before: "front" },
      { p: "w", s: "hu", after: "start", before: "vowel" },
    ],
    likes: ["ɲ", "ʎ", "θ", "tʃ", "ɛ", "ɔ", "kʷ"],
    related: ["classical", "basque"],
  },
  {
    id: "celtic", long: ["circumflex"], nasal: "n", marks: "â ï è", jAfterV: "i", wAfterV: "w",
    map: {
      v: ["f"], f: ["ff"], ð: ["dd"], ɬ: ["ll"], x: ["ch"], θ: ["th"], ə: ["y", "a"], ɨ: ["y", "u"], k: ["c"], j: ["j", "y"], ŋ: ["ng"],
      β: ["bh"], ɣ: ["gh"], ʃ: ["sh", "si"], w: ["w"], y: ["ü"], ʒ: ["zh"], tʃ: ["ch", "tsi"], dʒ: ["j"], ts: ["ts"],
      ɛ: ["è"], ɔ: ["ò"], æ: ["ae"], ø: ["eu"], ɲ: ["ny"], ʎ: ["ly"],
    },
    // j is written i next to vowels (iaith), so the letter y stays free for a vowel
    rules: [{ p: "j", s: "i", before: "vowel" }],
    likes: ["ð", "ɬ", "x", "v", "θ", "ə"],
    related: ["anglo"],
  },
  {
    id: "turkic", long: ["circumflex"], nasal: "n", marks: "ş ğ ö ı â", jAfterV: "y", wAfterV: "v",
    map: {
      ʃ: ["ş"], tʃ: ["ç"], dʒ: ["c"], ʒ: ["j"], j: ["y"], ɣ: ["ğ"], ɯ: ["ı"], ø: ["ö"], y: ["ü"], x: ["kh", "h"], q: ["q"],
      ŋ: ["ñ", "ng"], χ: ["x"], ə: ["ä", "ë"], æ: ["ä"], ts: ["ts"], θ: ["th"], ð: ["dh"], ɛ: ["ä"], ɔ: ["å", "o"], ɲ: ["ny"], ɨ: ["ı"],
    },
    likes: ["ɯ", "ø", "y", "ʃ", "tʃ", "q", "ɣ"],
    related: ["mongolic", "iranian"],
  },
  {
    id: "mongolic", long: ["double"], nasal: "n", marks: "ö â", jAfterV: "i", wAfterV: "u",
    map: {
      x: ["kh"], ts: ["ts"], tʃ: ["ch"], dʒ: ["j"], ʃ: ["sh"], ʒ: ["zh"], j: ["y"], ø: ["ö"], y: ["ü"], ɵ: ["ö"], ʉ: ["ü"],
      ŋ: ["ng"], ɣ: ["gh"], ə: ["ë"], ɔ: ["ô"], ʊ: ["û"], q: ["q"], χ: ["kh"], ɨ: ["y"],
    },
    likes: ["x", "ts", "ø", "y"],
    related: ["turkic"],
  },
  {
    id: "semitic", long: ["macron"], nasal: "n", marks: "ā ḥ š ʿ ʾ ĕ", jAfterV: "y", wAfterV: "w",
    map: {
      ħ: ["ḥ"], ʕ: ["ʿ"], ʔ: ["ʾ", "'"], ʃ: ["sh", "š"], x: ["kh"], χ: ["kh"], ɣ: ["gh"], θ: ["th"], ð: ["dh"],
      q: ["q"], dʒ: ["j"], j: ["y"], tʼ: ["ṭ"], kʼ: ["ḳ"], sʼ: ["ṣ"], tsʼ: ["ṣ"], pʼ: ["ṗ"], tʃ: ["ch"], ʒ: ["zh"], ts: ["ts"],
      ə: ["e", "ĕ"], ɛ: ["e", "ĕ"], ɔ: ["o", "ŏ"], ŋ: ["ng"], ɲ: ["ny"], v: ["v"], æ: ["ä"], y: ["ü"], ø: ["ö"],
    },
    variants: { ʃ: ["sh", "š"] },
    likes: ["ħ", "ʕ", "q", "χ", "x", "ʔ", "ð", "θ"],
    related: ["iranian", "anglo"],
  },
  {
    id: "iranian", long: ["macron"], nasal: "n", marks: "ā â", jAfterV: "y", wAfterV: "w",
    map: {
      x: ["kh"], ʃ: ["sh"], ʒ: ["zh"], ɣ: ["gh"], q: ["q"], tʃ: ["ch"], dʒ: ["j"], j: ["y"], θ: ["th"], ð: ["dh"], w: ["w", "v"],
      ɑ: ["â", "å"], ə: ["ë", "a"], ŋ: ["ng"], ts: ["ts"], χ: ["kh"], ʔ: ["'"], ħ: ["h"], y: ["ü"], ø: ["ö"],
    },
    likes: ["x", "ʃ", "ʒ", "ɣ", "q"],
    related: ["semitic", "turkic"],
  },
  {
    id: "polynesian", long: ["macron"], nasal: "n", marks: "ā ʻ", jAfterV: "i", wAfterV: "u",
    map: { ʔ: ["ʻ"], ŋ: ["ng", "g"], ɸ: ["wh"], f: ["f", "wh"], β: ["v"], j: ["y"], ʃ: ["sh"], tʃ: ["ch"], ts: ["ts"], ə: ["e", "a"] },
    likes: ["ʔ", "ŋ", "ɸ"],
    requires: (inv) => [...inv].filter((p) => !isVowel(p)).length <= 15,
    related: ["malay"],
  },
  {
    id: "nahuatl", long: ["macron"], nasal: "n", marks: "ā", jAfterV: "i", wAfterV: "uh",
    map: {
      tɬ: ["tl"], ts: ["tz"], tʃ: ["ch"], ʃ: ["x"], w: ["hu"], k: ["c"], kʷ: ["cu"], ʔ: ["h"], j: ["y"], s: ["z", "s"],
      ɬ: ["lh"], x: ["j"], ŋ: ["ng"], ə: ["ë", "e"], u: ["u"], θ: ["th"], ð: ["dh"], ʒ: ["zh"], dʒ: ["dj"],
    },
    rules: [
      { p: "k", s: "qu", before: "front" },
      { p: "kʷ", s: "uc", before: "nonvowel" },
      { p: "s", s: "c", before: "front" },
      { p: "w", s: "u", after: "backvowel", before: "nonvowel" },
    ],
    likes: ["tɬ", "ts", "kʷ", "ʃ", "ʔ"],
    requires: (inv) => (inv.has("tɬ") || inv.has("kʷ")) && (!inv.has("h") || !inv.has("ʔ")) && !inv.has("z"),
    related: ["romance", "mayan"],
  },
  {
    id: "basque", long: ["double"], nasal: "n", marks: "ñ", jAfterV: "i", wAfterV: "u",
    map: { tʃ: ["tx"], ts: ["tz"], ʃ: ["x"], j: ["y", "i"], ɲ: ["ñ"], x: ["j"], ʎ: ["ll"], r: ["rr"], ɾ: ["r"], θ: ["z"], dʒ: ["dj"], ʒ: ["j"], ɣ: ["g"], ð: ["d"], β: ["b"], ə: ["e"] },
    likes: ["ts", "tʃ", "ʃ", "ɲ"],
    requires: (inv) => inv.has("ts") && (inv.has("tʃ") || inv.has("ʃ")),
    related: ["romance"],
  },
  {
    id: "hepburn", long: ["macron"], nasal: "n", marks: "ā", jAfterV: "i", wAfterV: "u",
    map: { ʃ: ["sh"], tʃ: ["ch"], ts: ["ts"], dʒ: ["j"], ɸ: ["f"], j: ["y"], ɾ: ["r"], ɕ: ["sh"], tɕ: ["ch"], dʑ: ["j"], ŋ: ["ng"], ʒ: ["zh"], x: ["kh"], ə: ["e", "a"], ɨ: ["u"], dz: ["dz"], β: ["v"], ç: ["hy"], ɣ: ["gh"] },
    likes: ["ɸ", "ɾ", "ts", "ɕ", "tɕ"],
    related: ["anglo"],
  },
  {
    id: "finnic", long: ["double"], nasal: "n", marks: "ä š õ", jAfterV: "i", wAfterV: "u",
    map: { j: ["j"], y: ["y"], ø: ["ö"], æ: ["ä"], ʃ: ["š"], ŋ: ["ng"], ʒ: ["ž"], tʃ: ["tš", "č"], ts: ["ts"], x: ["hh", "kh"], ɣ: ["gh"], ə: ["õ", "e"], ɤ: ["õ"], ɛ: ["ä", "e"], θ: ["th"], ð: ["dh"], β: ["v"], w: ["v", "w"], dʒ: ["dž"], ɨ: ["õ"], ɔ: ["o"] },
    likes: ["y", "ø", "æ", "aː", "eː"],
    related: ["hungarian", "nordic"],
  },
  {
    id: "classical", long: ["macron"], nasal: "n", marks: "ā ë", jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      pʰ: ["ph"], tʰ: ["th"], kʰ: ["ch", "kh"], k: ["c", "k"], y: ["y"], x: ["ch", "kh"], j: ["i", "j"], w: ["u", "v"], ø: ["oe"],
      æ: ["ae"], ts: ["z"], θ: ["th"], kʷ: ["qu"], gʷ: ["gu"], ɛ: ["ae", "e"], ɔ: ["au", "o"], ʃ: ["sh", "x"], dz: ["z"], ə: ["ë"],
      tʃ: ["ch", "c"], dʒ: ["g"], β: ["b"], ð: ["d"], ɣ: ["g"], ɨ: ["y", "ui"],
    },
    variants: { kʰ: ["ch", "kh"] },
    pairs: { "k+s": "x" },
    likes: ["pʰ", "tʰ", "kʰ", "y", "θ", "kʷ"],
    related: ["romance"],
  },
  {
    id: "kartvelian", long: ["macron"], nasal: "n", marks: "' ā", jAfterV: "i", wAfterV: "v",
    map: {
      pʼ: ["p'"], tʼ: ["t'"], kʼ: ["k'"], qʼ: ["q'"], tsʼ: ["ts'"], tʃʼ: ["ch'"], x: ["kh"], ɣ: ["gh"], ʃ: ["sh"], ʒ: ["zh"],
      tʃ: ["ch"], dʒ: ["j"], ts: ["ts"], dz: ["dz"], j: ["y"], q: ["q"], χ: ["kh"], ə: ["e", "a"], ŋ: ["ng"], y: ["iu", "ü"], ø: ["eo"], æ: ["ae"],
    },
    likes: ["pʼ", "tʼ", "kʼ", "qʼ", "tsʼ", "tʃʼ", "ɣ", "x"],
    requires: (inv) => [...inv].some((p) => p.endsWith("ʼ")),
    related: ["anglo", "slavic"],
  },
  {
    id: "pinyin", long: ["double"], nasal: "n", marks: "ü ê", jAfterV: "i", wAfterV: "o",
    map: {
      p: ["b"], t: ["d"], k: ["g"], pʰ: ["p"], tʰ: ["t"], kʰ: ["k"], ts: ["z"], tsʰ: ["c"], ɕ: ["x"], tɕ: ["j"], tɕʰ: ["q"],
      ʂ: ["sh"], ʈʂ: ["zh"], ʈʂʰ: ["ch"], ʐ: ["r"], x: ["h"], tʃ: ["zh"], tʃʰ: ["ch"], ə: ["e"], e: ["ê"], y: ["ü"], ŋ: ["ng"],
      ʃ: ["sh"], j: ["y"], w: ["w"],
    },
    likes: ["pʰ", "tʰ", "kʰ", "tsʰ", "ɕ", "tɕ", "ʂ"],
    requires: (inv) => (inv.has("pʰ") || inv.has("tʰ") || inv.has("kʰ") ? !inv.has("b") && !inv.has("d") && !inv.has("g") : false),
    related: ["anglo"],
  },
  {
    id: "indic", long: ["macron"], nasal: "n", marks: "ā ṭ ś ñ ṅ ă", jAfterV: "y", wAfterV: "v",
    map: {
      ʈ: ["ṭ"], ɖ: ["ḍ"], ɳ: ["ṇ"], ʂ: ["ṣ"], ɕ: ["ś"], ʃ: ["sh", "ś"], tʃ: ["ch", "c"], tʃʰ: ["chh"], dʒ: ["j"], dʒʱ: ["jh"],
      ɲ: ["ñ", "ny"], ŋ: ["ṅ", "ng"], j: ["y"], w: ["v"], ɭ: ["ḷ"], ʋ: ["v"], ɽ: ["ṛ"], r: ["r"], ɾ: ["r"], ə: ["ă"], x: ["kh"],
      ɣ: ["gh"], z: ["z"], ʈʰ: ["ṭh"], ɖʱ: ["ḍh"], ɛ: ["ai"], ɔ: ["au"],
    },
    likes: ["ʈ", "ɖ", "ɳ", "ʂ", "bʱ", "dʱ", "gʱ", "kʰ", "ɭ"],
    related: ["anglo"],
  },
  {
    id: "andean", long: ["double"], nasal: "n", marks: "ñ '", jAfterV: "y", wAfterV: "w",
    map: {
      q: ["q"], ʎ: ["ll"], ɲ: ["ñ"], ʃ: ["sh"], tʃ: ["ch"], kʼ: ["k'"], qʼ: ["q'"], tʃʼ: ["ch'"], pʼ: ["p'"], tʼ: ["t'"],
      kʰ: ["kh"], qʰ: ["qh"], tʃʰ: ["chh"], pʰ: ["ph"], tʰ: ["th"], x: ["j", "h"], χ: ["j", "h"], j: ["y"], w: ["w"], ŋ: ["ng"],
      ts: ["ts"], ə: ["e", "ë"], ɢ: ["g", "gh"], ʁ: ["gh"],
    },
    likes: ["q", "qʼ", "ʎ", "ɲ", "kʼ", "χ"],
    related: ["romance", "basque"],
  },
  {
    id: "bantu", long: ["double"], nasal: "n", marks: "' è", jAfterV: "y", wAfterV: "w",
    map: {
      ŋ: ["ng'"], ɲ: ["ny"], tʃ: ["ch"], dʒ: ["j"], ʃ: ["sh"], j: ["y"], w: ["w"], ɣ: ["gh"], θ: ["th"], ð: ["dh"], x: ["kh"],
      ɛ: ["è"], ɔ: ["ò"], ʒ: ["zh"], ts: ["ts"], ə: ["e", "ë"], β: ["bh"], y: ["iu"],
    },
    rules: [{ p: "ŋ", s: "ng", before: "nonvowel" }],
    pairs: { "ŋ+g": "ng", "ŋ+k": "nk" },
    likes: ["ŋ", "ɲ", "mb"],
    related: ["anglo", "malay"],
  },
  {
    id: "mayan", long: ["double"], nasal: "n", marks: "' ä", jAfterV: "y", wAfterV: "w",
    map: {
      ʃ: ["x"], x: ["j"], ts: ["tz"], tsʼ: ["tz'"], tʃ: ["ch"], tʃʼ: ["ch'"], kʼ: ["k'"], tʼ: ["t'"], pʼ: ["p'"], qʼ: ["q'"],
      ʔ: ["'"], j: ["y"], w: ["w"], q: ["q"], ŋ: ["ng"], ə: ["ä"], ɨ: ["ä"], h: ["h"], dʒ: ["dz"], ʒ: ["zh"],
    },
    likes: ["kʼ", "tsʼ", "tʃʼ", "ʃ", "x"],
    related: ["nahuatl", "romance"],
  },
  {
    id: "inuit", long: ["double"], nasal: "n", marks: "", jAfterV: "i", wAfterV: "u",
    map: { q: ["q"], ŋ: ["ng"], ɬ: ["lh", "ll"], ʁ: ["r"], ɣ: ["g"], j: ["j"], v: ["v"], χ: ["r"], x: ["kh"], ʃ: ["sh"], ts: ["ts"], ə: ["e"], y: ["ui"] },
    likes: ["q", "ŋ", "ɬ", "ʁ"],
    related: ["nordic", "anglo"],
  },
  {
    id: "malay", long: ["double"], nasal: "n", marks: "é", jAfterV: "i", wAfterV: "u",
    map: {
      ŋ: ["ng"], ɲ: ["ny"], tʃ: ["c", "ch"], dʒ: ["j"], ʃ: ["sy", "sh"], x: ["kh"], ɣ: ["gh"], j: ["y"], w: ["w"], ʔ: ["'"],
      ə: ["e"], e: ["é"], θ: ["th"], ð: ["dh"], z: ["z"], f: ["f"], v: ["v"], ts: ["ts"],
    },
    variants: { tʃ: ["c", "ch"] },
    likes: ["ŋ", "ɲ", "ə"],
    related: ["anglo", "polynesian"],
  },
];

const SCHOOL_BY_ID: Record<string, School> = Object.fromEntries(SCHOOLS.map((s) => [s.id, s]));

export function schoolIds(): string[] {
  return SCHOOLS.map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Diacritic bookkeeping
// ---------------------------------------------------------------------------

const SPECIAL_LETTERS: Record<string, string> = {
  ø: "stroke", ł: "stroke", đ: "stroke", æ: "æ", œ: "œ", þ: "þ", ð: "ð", ı: "dotless", ŋ: "eng", ß: "ß",
  "'": "apos", ʻ: "okina", ʿ: "ayin", ʾ: "alif", ə: "schwa",
};
const MARK_CACHE = new Map<string, string[]>();

/** Diacritic and special-letter types in a spelling ("š" → caron, "ǣ" → æ + macron). */
export function markTypes(s: string): string[] {
  let r = MARK_CACHE.get(s);
  if (r) return r;
  r = [];
  for (const ch of s.normalize("NFD")) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x300 && c <= 0x36f) r.push("m" + c.toString(16));
    else if (SPECIAL_LETTERS[ch]) r.push(SPECIAL_LETTERS[ch]);
    else if (c > 0x7f) r.push("ipa"); // a raw IPA letter (ʃ, ʔ, ʼ) is never a spelling
  }
  MARK_CACHE.set(s, r);
  return r;
}

const MARK_OF_LONG: Record<LongStyle, string> = { double: "", macron: "m304", acute: "m301", circumflex: "m302" };
const COMBINING: Record<LongStyle, string> = { double: "", macron: "̄", acute: "́", circumflex: "̂" };

function nativeMarks(school: School, long: LongStyle, nasal: NasalStyle): Set<string> {
  const s = new Set<string>();
  for (const tok of school.marks.split(/\s+/)) for (const m of markTypes(tok)) s.add(m);
  if (MARK_OF_LONG[long]) s.add(MARK_OF_LONG[long]);
  if (nasal === "ogonek") s.add("m328");
  if (nasal === "tilde" || nasal === "tilde-ao") s.add("m303");
  return s;
}

const VOWEL_LETTERS = "aeiouyäöüáéíóúàèìòùâêîôûāēīōūăĕĭŏŭæøåœəëïıǫęąãẽĩõũȳýǣőűơưůÿěô";

function isVowelLetter(ch: string): boolean {
  return VOWEL_LETTERS.includes(ch.normalize("NFC")) || VOWEL_LETTERS.includes(ch.normalize("NFD")[0] ?? "");
}

function single(s: string): boolean {
  return [...s.normalize("NFC")].length === 1;
}

function compose(base: string, mark: string): string | null {
  if (!single(base)) return null;
  const c = (base + mark).normalize("NFC");
  return single(c) ? c : null;
}

/** Candidate spellings for a phoneme: language variant, school's, generic, then fallbacks. */
function candidates(p: string, school: School, variant?: string): string[] {
  const out: string[] = [];
  const push = (xs?: string[]) => {
    if (xs) for (const x of xs) if (!out.includes(x)) out.push(x);
  };
  if (variant) push([variant]);
  push(school.map[p]);
  const f = features(p);
  if (!f) return [p];
  if (f.kind === "C") {
    // modified consonants: base spelling + h / ' / w
    const base = phonemeFor({ ...f, asp: false, ejective: false, lab: false });
    if (base && base !== p) {
      const bs = [...(school.map[base] ?? []), ...(DEFAULT[base] ?? [base])];
      for (const b of bs.slice(0, 2)) {
        if (f.lab) push([b + "w", b + "u"]);
        if (f.asp) push([b + "h"]);
        if (f.ejective) push([b + "'"]);
      }
    }
    push(DEFAULT[p]);
    push([p]);
  } else {
    push(VOWELS[p]);
    push([p]);
  }
  return out;
}

/** Long counterparts of digraph vowel spellings (ae → ai as in "fair", aw → au as in "haul"). */
const LONG_DIGRAPH: Record<string, string[]> = {
  ae: ["ai", "ay"], ea: ["ei", "eah"], aw: ["au", "awe"], oa: ["oe", "oah"], au: ["aw", "auh"], eu: ["eo", "euh"], oe: ["oi", "oeh"],
  ue: ["ui", "ueh"], yu: ["yuu"], ui: ["uy", "uih"], ah: ["aah"], iu: ["iuu"], eo: ["eoh"], ai: ["aai"],
};

/** Long-vowel spellings for a short spelling, in order of preference, never mixing mark types. */
function longCandidates(short: string, style: LongStyle, schoolId: string, q: string): string[] {
  const out: string[] = [];
  if (schoolId === "germanic" && q === "i" && style === "double") out.push("ie");
  if (schoolId === "hungarian") {
    if (short === "ö") out.push("ő");
    if (short === "ü") out.push("ű");
  }
  const plain = /^[a-z]$/.test(short);
  if (!single(short)) {
    // digraph vowel (ae, aw): a conventional long counterpart
    out.push(...(LONG_DIGRAPH[short] ?? [short + "h"]));
  } else if (style === "double") {
    // é (an e that gave its letter to a schwa) is doubled bare: ee, not éé
    if (!plain && q === "e" && short === "é") out.push("ee");
    out.push(short + short);
  }
  else {
    const c = compose(short, COMBINING[style]);
    if (c) out.push(c);
    else if (!plain) {
      // è, ò: put the long mark on the plain letter (ê, ô) if that is free
      const bare = short.normalize("NFD")[0];
      const c2 = compose(bare, COMBINING[style]);
      if (c2) out.push(c2);
    }
  }
  // otherwise a letter is doubled (ää, öö) rather than given a second, different mark
  out.push(short + short, short + "h");
  return out;
}

/** Nasal-vowel spelling for a (possibly long) oral spelling. */
function nasalSpelling(oral: string, q: string, style: NasalStyle): string {
  const plain = /^[a-z]$/.test(oral);
  if ((style === "tilde" || (style === "tilde-ao" && (q === "a" || q === "o"))) && plain) {
    const c = compose(oral, "\u0303");
    if (c) return c;
  }
  if (style === "ogonek" && plain) {
    const c = compose(oral, "\u0328");
    if (c) return c;
  }
  return oral + "n";
}

function schoolScore(s: School, inv: Set<string>): number {
  if (s.requires && !s.requires(inv)) return 0;
  let aff = 0;
  for (const p of s.likes) if (inv.has(p)) aff++;
  return Math.pow(0.12 + aff, 1.5);
}

function inferLong(o: Orthography | undefined, school: School, rng: Rng): LongStyle {
  if (o?.long && (o.long === "double" || o.long === "macron" || o.long === "acute" || o.long === "circumflex")) return o.long;
  return rng.pick(school.long);
}

export interface OrthographyOptions {
  school?: string;
  schools?: [string, number][];
  avoidSchools?: string[];
  /** Spellings to keep where possible (daughter languages). */
  base?: Orthography;
  long?: LongStyle;
  nasal?: NasalStyle;
  /** Mark types to avoid entirely (spelling reforms). */
  banMarks?: string[];
}

/** Build a collision-free orthography for a phoneme inventory. */
export function buildOrthography(ph: Phonology, rng: Rng, opts: OrthographyOptions = {}): Orthography {
  const inv = new Set([...ph.consonants, ...ph.vowels]);
  let school: School;
  if (opts.school && SCHOOL_BY_ID[opts.school]) school = SCHOOL_BY_ID[opts.school];
  else {
    const avoid = new Set(opts.avoidSchools ?? []);
    const pref = opts.schools?.filter(([id]) => SCHOOL_BY_ID[id] && (!SCHOOL_BY_ID[id].requires || SCHOOL_BY_ID[id].requires!(inv)));
    if (pref?.length) {
      school = SCHOOL_BY_ID[rng.weighted(pref.map(([id, w]) => [id, w * (avoid.has(id) ? 0.4 : 1)] as [string, number]))];
    } else {
      const weights = SCHOOLS.map((s) => schoolScore(s, inv) * (avoid.has(s.id) ? 0.15 : 1) * Math.exp(rng.normal(0, 0.35)));
      school = SCHOOLS[rng.weightedIndex(weights)];
    }
  }
  if (school.id === "polish" && !inv.has("v")) school = { ...school, map: { ...school.map, w: ["w", "u"] } };
  const longStyle = opts.long ?? inferLong(undefined, school, rng);
  const nasalStyle = opts.nasal ?? school.nasal;
  const variant: Record<string, string> = {};
  for (const [p, vs] of Object.entries(school.variants ?? {})) variant[p] = rng.pick(vs);
  const native = nativeMarks(school, longStyle, nasalStyle);
  const banned = new Set(opts.banMarks ?? []);
  for (const b of banned) native.delete(b);
  const usedMarks = new Set<string>();
  const map: Record<string, string> = {};
  const used = new Set<string>();
  const take = (p: string, s: string) => {
    map[p] = s;
    used.add(s);
    for (const m of markTypes(s)) usedMarks.add(m);
  };
  /** Cost of a spelling: list position plus a penalty for each mark the tradition does not use. */
  let own: string[] = [];
  const cost = (s: string, i: number) => {
    let c = i;
    // a tradition's own explicit spellings are native to it by definition (semitic ü, celtic ŷ)
    if (own.includes(s)) return c;
    for (const m of markTypes(s)) {
      if (m === "ipa") c += 50;
      else if (banned.has(m)) c += 100;
      // acute (é) and diaeresis (ü ö ä) are read everywhere: lighter penalties than other foreign marks
      else if (!native.has(m)) c += usedMarks.has(m) ? 2.5 : m === "m301" ? 3 : m === "m308" ? 2 : 6;
    }
    return c;
  };
  const best = (cs: string[], allowIpa = false): string | undefined => {
    let bs: string | undefined;
    let bc = Infinity;
    cs.forEach((s, i) => {
      if (used.has(s) || s === "") return;
      if (!allowIpa && markTypes(s).includes("ipa")) return;
      const c = cost(s, i);
      if (c < bc) {
        bc = c;
        bs = s;
      }
    });
    return bs;
  };
  // The commoner of e and ə gets the plain letter (French e/é): a schwa-heavy daughter
  // writes its schwa "e" and respells its old e, rather than strewing "ë" over every word.
  const wq = (q: string) => ph.vowels.reduce((t, v) => t + (vowelQuality(v) === q ? ph.wVowel[v] ?? 0 : 0), 0);
  let schwaFirst = false;
  if (inv.has("ə") && inv.has("e") && wq("ə") > wq("e") * 1.15 && !banned.has("m301")) {
    schwaFirst = true;
    take("ə", "e");
  }
  // Keep the base orthography's spellings where possible (daughters). A sound that
  // newly arises and has an obvious letter (h from x) reclaims it from a phoneme
  // that had borrowed it (a glottal stop written h), which is then respelled.
  const reclaimed = new Set<string>();
  if (opts.base) {
    const holder = new Map(Object.entries(opts.base.map).map(([q, sp]) => [sp, q]));
    for (const p of inv) {
      if (!/^[a-z]$/.test(p) || opts.base.map[p] !== undefined || school.map[p]) continue;
      const q = holder.get(p);
      if (q && q !== p) reclaimed.add(q);
    }
  }
  if (opts.base) {
    for (const p of [...ph.consonants, ...new Set(ph.vowels.map(vowelQuality))]) {
      if (map[p] !== undefined || reclaimed.has(p)) continue;
      if (schwaFirst && p === "e") continue;
      const s = opts.base.map[p];
      if (s !== undefined && s !== "" && !used.has(s) && !markTypes(s).some((m) => banned.has(m))) take(p, s);
    }
  }
  // Short vowels and consonants: assign by priority.
  const shorts = [...ph.consonants, ...new Set(ph.vowels.map(vowelQuality))].filter((p) => map[p] === undefined);
  const freq = (p: string) => (ph.wOnset[p] ?? 0) + (ph.wCoda[p] ?? 0) + (ph.wVowel[p] ?? 0) * 2;
  const cands = new Map(shorts.map((p) => [p, candidates(p, school, variant[p])]));
  // (the respelled e avoids the mark long vowels use: é with ā-style length, but ê or é, not ê/êê)
  if (schwaFirst && cands.has("e")) cands.set("e", ["é", "ê", "è", "ei", "ee"].filter((x) => !MARK_OF_LONG[longStyle] || !markTypes(x).includes(MARK_OF_LONG[longStyle])));
  // Spanish-style r/rr when both a trill and a tap exist.
  if (inv.has("r") && inv.has("ɾ") && map.r === undefined && map["ɾ"] === undefined && !used.has("rr") && !used.has("r")) {
    take("r", "rr");
    take("ɾ", "r");
  }
  // Phonemes whose preferred spelling is their own ASCII letter go first, so
  // that p/t/k/a/i/u/w/h keep their obvious spellings and nothing else steals them;
  // then the school's explicit spellings (š, þ, tl…), then modified stops (pʰ, kʼ, kʷ).
  const natural = (p: string) => /^[a-z]$/.test(p) && cands.get(p)![0] === p;
  const explicit = (p: string) => !natural(p) && (!!school.map[p] || !!variant[p]);
  const modified = (p: string) => {
    const f = cf(p);
    return !!f && (f.asp || f.ejective || f.lab) && !natural(p) && !explicit(p);
  };
  const byFreq = (a: string, b: string) => freq(b) - freq(a) || (a < b ? -1 : 1);
  const isV = (p: string) => isVowel(p);
  const ordered = [
    ...shorts.filter(natural),
    ...shorts.filter((p) => explicit(p) && !isV(p)).sort(byFreq),
    ...shorts.filter((p) => explicit(p) && isV(p)).sort(byFreq),
    ...shorts.filter(modified).sort(byFreq),
    ...shorts.filter((p) => !natural(p) && !explicit(p) && !modified(p)).sort(byFreq),
  ].filter((p) => map[p] === undefined);
  for (const p of ordered) {
    if (map[p] !== undefined) continue;
    own = school.map[p] ?? [];
    if (schwaFirst && p === "e") own = cands.get("e")!.slice(0, 1);
    let chosen = best(cands.get(p)!);
    if (chosen === undefined) {
      // borrow a spelling from any tradition, then build one from a plain letter (vh, dd, z')
      const extra = SCHOOLS.flatMap((sc) => sc.map[p] ?? []);
      const plain = [...(DEFAULT[p] ?? []), ...(VOWELS[p] ?? [])].filter((x) => /^[a-z]+$/.test(x));
      const made = plain.flatMap((x) => [x + "h", x + x, x + "'"]);
      chosen = best([...extra, ...made]) ?? best([p, p + "h", p + "'", p + p], true) ?? p + p + p;
    }
    take(p, chosen);
  }
  // Long and nasal vowels: one convention per language.
  for (const v of ph.vowels) {
    const f = vf(v)!;
    if (!f.long && !f.nasal) continue;
    if (map[v] !== undefined) continue;
    const kept = opts.base?.map[v];
    if (kept && !used.has(kept) && !markTypes(kept).some((m) => banned.has(m))) {
      take(v, kept);
      continue;
    }
    const q = vowelQuality(v);
    const short = map[q];
    let cs = f.long ? longCandidates(short, longStyle, school.id, q) : [short];
    if (f.nasal) cs = cs.map((c) => nasalSpelling(c, q, nasalStyle)).concat(cs.map((c) => c + "n"));
    const s = cs.find((c) => !used.has(c)) ?? cs[0] + "'";
    take(v, s);
  }
  return finishOrthography(ph, school, map, longStyle, nasalStyle, native, opts.base?.rules);
}

/** Contextual rules, pair spellings and fix-ups for a finished map. */
function finishOrthography(
  ph: Phonology,
  school: School,
  map: Record<string, string>,
  longStyle: LongStyle,
  nasalStyle: NasalStyle,
  native: Set<string>,
  inherited?: SpellingRule[],
): Orthography {
  const inv = new Set([...ph.consonants, ...ph.vowels]);
  const rules: SpellingRule[] = [];
  const add = (r: SpellingRule) => {
    if (!rules.some((x) => x.p === r.p && x.before === r.before && x.after === r.after)) rules.push(r);
  };
  // School rules first (they are the most specific).
  for (const r of school.rules ?? []) {
    if (!r.p.split("+").every((x) => inv.has(x))) continue;
    // only applies if the default spelling is the one the rule is written against
    if (r.p === "k" && map.k !== "c") continue;
    if (r.p === "g" && map.k !== "c") continue;
    if (r.p === "s" && map.s !== "z") continue;
    if (r.p === "w" && r.s === "hu" && map.w === "hu") continue;
    if (r.p === "w" && r.after === "backvowel" && map.w !== "hu") continue;
    if (r.p === "w" && r.s === "hu" && map.w !== "u") continue;
    if (r.p === "kʷ" && map["kʷ"] !== "cu") continue;
    if (r.p === "ŋ" && !(map["ŋ"] ?? "").startsWith("ng")) continue;
    add(r);
  }
  // Inherited rules that still apply (daughters keep their quirks).
  for (const r of inherited ?? []) {
    if (!r.p.split("+").every((x) => inv.has(x))) continue;
    if ((r.p === "k" || r.p === "g") && map.k !== "c") continue;
    add(r);
  }
  // Nasal vowels written Vn: Vm before labials, a tilde in the rare case a vowel follows.
  for (const v of ph.vowels) {
    const f = vf(v)!;
    const s = map[v];
    if (!f.nasal || !s || !s.endsWith("n")) continue;
    const oral = s.slice(0, -1);
    add({ p: v, s: oral + "m", before: "labial" });
    const t = compose(oral, "̃");
    add({ p: v, s: t ?? oral, before: "vowel" });
  }
  // Diphthong glides.
  if (inv.has("j") && (map.j === "y" || map.j === "j")) add({ p: "j", s: school.jAfterV === "j" ? map.j : school.jAfterV, after: "vowel", before: "nonvowel" });
  if (inv.has("w") && map.w && map.w !== school.wAfterV && !(map.w === "ł" && school.wAfterV === "ł") && !(map.w === "v" && school.wAfterV === "v"))
    add({ p: "w", s: school.wAfterV, after: "vowel", before: "nonvowel" });
  if (inv.has("ʔ") && ["'", "ʻ", "ʾ"].includes(map["ʔ"])) add({ p: "ʔ", s: "", after: "start" });
  if (map.w === "hu") add({ p: "w", s: "u", after: "consonant" });
  if (map.r === "rr") {
    // Spanish-style: the trill is written double only between vowels
    add({ p: "r", s: "r", after: "start" });
    add({ p: "r", s: "r", after: "consonant" });
    add({ p: "r", s: "r", before: "nonvowel" });
  }
  // ŋ + k is "nk" wherever ŋ is a digraph (bank, Bangkok).
  if (inv.has("ŋ") && inv.has("k") && (map["ŋ"] ?? "").startsWith("ng") && map.k === "k" && !(school.pairs ?? {})["ŋ+k"]) add({ p: "ŋ+k", s: "nk" });
  // A palatal nasal before a palatal affricate is plain n (nj, nch), as in Swahili and English.
  for (const a of ["dʒ", "tʃ"]) if (inv.has("ɲ") && inv.has(a) && (map["ɲ"] ?? "").startsWith("ny") && map[a]) add({ p: "ɲ+" + a, s: "n" + map[a] });
  // n + g would read as ŋ: write n'g (as pinyin does in Xi'an).
  const gLike = Object.keys(map).find((p) => map[p] === "g");
  if (inv.has("ŋ") && map["ŋ"] === "ng" && inv.has("n") && gLike && school.id !== "bantu") add({ p: "n+" + gLike, s: "n'g" });
  for (const [k, s] of Object.entries(school.pairs ?? {})) {
    const [a, b] = k.split("+");
    const free = !Object.values(map).includes(s) || (a === "ŋ" && s.startsWith("n"));
    if (inv.has(a) && inv.has(b) && free && (s !== "x" || map[a] === "c")) add({ p: k, s });
  }
  const o: Orthography = { school: school.id, map, rules, geminateFirstLetter: !!school.geminateFirst, long: longStyle, nasal: nasalStyle, marks: [...native].sort() };
  if (school.fixups?.length) o.fixups = school.fixups.map(([a, b]) => [a, b]);
  return o;
}

/** Daughter orthography: inherit, spell new phonemes the school's way, and now and then reform coherently. */
export function driftOrthography(parent: Orthography, ph: Phonology, rng: Rng, opts: { stage?: boolean } = {}): Orthography {
  const inv = new Set([...ph.consonants, ...ph.vowels]);
  const school = SCHOOL_BY_ID[parent.school] ?? SCHOOLS[0];
  const longStyle = inferLong(parent, school, rng);
  const nasalStyle = (parent.nasal as NasalStyle | undefined) ?? school.nasal;
  const base: Orthography = { ...parent, map: { ...parent.map }, rules: parent.rules.slice() };
  // splits reform their spelling now and then; a people's own later stages keep their scribal tradition more often
  const r = rng.next() / (opts.stage ? 0.45 : 1);
  if (r < 0.12) {
    // 1. Reform towards a related tradition (Old Norse → Danish-style, Latin → Romance).
    const opts = school.related.filter((id) => SCHOOL_BY_ID[id] && (!SCHOOL_BY_ID[id].requires || SCHOOL_BY_ID[id].requires!(inv)));
    if (opts.length) {
      const ns = SCHOOL_BY_ID[rng.pick(opts)];
      const nl = rng.pick(ns.long);
      // keep only spellings the new tradition has no opinion on and that carry none of the old marks it lacks
      const nn = nativeMarks(ns, nl, ns.nasal);
      const keep: Record<string, string> = {};
      for (const [p, s] of Object.entries(parent.map)) {
        if (ns.map[p] || vf(p)?.long || vf(p)?.nasal) continue;
        if (markTypes(s).every((m) => nn.has(m))) keep[p] = s;
      }
      return buildOrthography(ph, rng, { school: ns.id, base: { ...base, map: keep, rules: [] }, long: nl, nasal: ns.nasal });
    }
  } else if (r < 0.24) {
    // 2. Simplification: one kind of diacritic or special letter goes (þ → th, š → sh, ā → aa).
    const counts = new Map<string, number>();
    for (const s of Object.values(parent.map)) for (const m of markTypes(s)) counts.set(m, (counts.get(m) ?? 0) + 1);
    const kinds = [...counts.keys()].filter((m) => m !== "apos" && m !== "okina");
    if (kinds.length) {
      const m = rng.pick(kinds.sort());
      const map: Record<string, string> = {};
      for (const [p, s] of Object.entries(parent.map)) if (!markTypes(s).includes(m)) map[p] = s;
      const nl: LongStyle = MARK_OF_LONG[longStyle] === m ? "double" : longStyle;
      return buildOrthography(ph, rng, { school: school.id, base: { ...base, map }, long: nl, nasal: nasalStyle, banMarks: [m] });
    }
  } else if (r < 0.38) {
    // 3. A local innovation: one consonant takes another spelling of the same tradition or a related one.
    const pool: [string, string][] = [];
    for (const p of ph.consonants) {
      const cur = parent.map[p];
      if (!cur) continue;
      const alts = [...(school.map[p] ?? []), ...school.related.flatMap((id) => SCHOOL_BY_ID[id]?.map[p] ?? [])].filter(
        (s) => s !== cur && !Object.values(parent.map).includes(s) && markTypes(s).every((m) => nativeMarks(school, longStyle, nasalStyle).has(m)),
      );
      for (const a of alts) pool.push([p, a]);
    }
    if (pool.length) {
      const [p, s] = rng.pick(pool);
      base.map[p] = s;
    }
  }
  return buildOrthography(ph, rng, { school: school.id, base, long: longStyle, nasal: nasalStyle });
}

// ---------------------------------------------------------------------------
// Romanisation
// ---------------------------------------------------------------------------

interface RuleIndex {
  single: Map<string, SpellingRule[]>;
  pair: Map<string, SpellingRule[]>;
  fixups: [RegExp, string][];
}
const RULE_INDEX = new WeakMap<Orthography, RuleIndex>();

function ruleIndex(o: Orthography): RuleIndex {
  let ix = RULE_INDEX.get(o);
  if (!ix) {
    ix = { single: new Map(), pair: new Map(), fixups: (o.fixups ?? []).map(([a, b]) => [new RegExp(a, "gu"), b]) };
    for (const r of o.rules) {
      const plus = r.p.indexOf("+");
      const m = plus > 0 ? ix.pair : ix.single;
      const k = plus > 0 ? r.p.slice(0, plus) : r.p;
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    RULE_INDEX.set(o, ix);
  }
  return ix;
}

function envMatch(r: SpellingRule, w: Word, i: number, span: number): boolean {
  if (r.after) {
    const prev = w[i - 1];
    if (r.after === "start" && i !== 0) return false;
    if (r.after === "vowel" && !(prev && isVowel(prev))) return false;
    if (r.after === "consonant" && !(prev && prev !== " " && !isVowel(prev))) return false;
    if (r.after === "backvowel") {
      const f = prev ? vf(prev) : null;
      if (!f || f.back !== 2 || !f.round) return false;
    }
  }
  if (r.before) {
    const nx = w[i + span];
    const atEnd = nx === undefined || nx === " ";
    if (r.before === "end" && !atEnd) return false;
    if (r.before === "vowel" && !(!atEnd && isVowel(nx))) return false;
    if (r.before === "nonvowel" && !atEnd && isVowel(nx)) return false;
    if (r.before === "front") {
      const f = !atEnd ? vf(nx) : null;
      // c/qu, g/gu alternations: before e and i (not æ, y, ø)
      if (!f || f.back !== 0 || f.round || f.height > 4) return false;
    }
    if (r.before === "back" && !(!atEnd && (vf(nx)?.back ?? 0) > 0)) return false;
    if (r.before === "labial") {
      const pl = !atEnd ? cf(nx)?.place : undefined;
      if (pl !== "bilabial" && pl !== "labiodental") return false;
    }
    if (r.before === "velar" && (atEnd || cf(nx)?.place !== "velar")) return false;
  }
  return true;
}

function fallbackSpelling(p: string): string {
  const f = features(p);
  if (!f) return p;
  if (f.kind === "V") return VOWELS[vowelQuality(p)]?.[0] ?? p;
  const base = phonemeFor({ ...f, asp: false, ejective: false, lab: false }) ?? p;
  return (DEFAULT[base]?.[0] ?? base) + (f.asp ? "h" : "") + (f.ejective ? "'" : "") + (f.lab ? "w" : "");
}

/** Romanise one word (lowercase). */
export function romanizeWord(o: Orthography, w: Word): string {
  const ix = ruleIndex(o);
  let out = "";
  let lastSpell = "";
  for (let i = 0; i < w.length; i++) {
    const p = w[i];
    if (p === " ") {
      out += " ";
      lastSpell = "";
      continue;
    }
    let s: string | undefined;
    let span = 1;
    const pairRules = i + 1 < w.length ? ix.pair.get(p) : undefined;
    if (pairRules) {
      const k2 = p + "+" + w[i + 1];
      for (const r of pairRules) {
        if (r.p === k2 && envMatch(r, w, i, 2)) {
          s = r.s;
          span = 2;
          break;
        }
      }
    }
    if (s === undefined) {
      const rs = ix.single.get(p);
      if (rs)
        for (const r of rs) {
          if (envMatch(r, w, i, 1)) {
            s = r.s;
            break;
          }
        }
    }
    if (s === undefined) s = o.map[p] ?? fallbackSpelling(p);
    // geminates
    if (i > 0 && w[i - 1] === p && !isVowel(p) && s === lastSpell && s.length > 0) {
      const chars = [...s.normalize("NFC")];
      if (chars.length >= 2 && o.geminateFirstLetter && !s.includes("'") && !/^n/.test(s)) {
        out = out.slice(0, out.length - s.length) + chars[0] + s;
        lastSpell = s;
        i += span - 1;
        continue;
      }
      if (chars.length >= 2) {
        // don't write "shsh": write it once (length is not marked)
        lastSpell = s;
        i += span - 1;
        continue;
      }
    }
    out += s;
    lastSpell = s;
    i += span - 1;
  }
  // tidy: no triple letters
  out = out.replace(/(.)\1\1+/gu, "$1$1");
  for (const [re, rep] of ix.fixups) out = out.replace(re, rep);
  return out.normalize("NFC");
}

/** Romanise a (possibly multi-word) phoneme sequence and capitalise each word. */
export function romanizeName(o: Orthography, w: Word): string {
  return romanizeWord(o, w)
    .split(" ")
    .map((x) => capitalize(x))
    .join(" ");
}

/** IPA transcription with a primary stress mark (no slashes). */
export function ipaWord(w: Word, stress: StressRule, ph?: Phonology): string {
  if (w.length === 0) return "";
  const starts = syllabify(w, ph);
  if (starts.length <= 1) return w.join("");
  const s = stressedSyllable(w, stress);
  const at = starts[Math.min(s, starts.length - 1)];
  return w.slice(0, at).join("") + "ˈ" + w.slice(at).join("");
}

export function ipaPhrase(words: Word[], stress: StressRule, ph?: Phonology): string {
  return words.map((w) => ipaWord(w, stress, ph)).join(" ");
}

/** Rough readability score of a romanised form: 0 good, higher worse. */
export function ugliness(roman: string): number {
  const s = roman.toLowerCase();
  let worst = 0;
  let run = 0;
  let vrun = 0;
  let worstV = 0;
  let marks = 0;
  let apos = 0;
  let len = 0;
  for (const ch of s) {
    if (ch === " " || ch === "-") {
      run = 0;
      vrun = 0;
      continue;
    }
    len++;
    if (ch === "'" || ch === "ʻ" || ch === "ʿ" || ch === "ʾ" || ch === "ʼ") {
      apos++;
      continue;
    }
    if (isVowelLetter(ch)) {
      run = 0;
      vrun++;
      if (vrun > worstV) worstV = vrun;
    } else {
      vrun = 0;
      run++;
      if (run > worst) worst = run;
    }
    if (ch.charCodeAt(0) > 0x7f) marks++;
  }
  return Math.max(0, worst - 3) * 2 + Math.max(0, worstV - 3) * 1.5 + Math.max(0, marks - 2) * 0.7 + Math.max(0, apos - 1) * 0.8 + Math.max(0, len - 12) * 0.35;
}

export { cf };
