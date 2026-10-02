/**
 * Romanisation. Each language picks a dominant orthographic tradition
 * ("school": anglo, germanic, nordic, slavic, polish, hungarian, romance,
 * celtic, turkic, mongolic, semitic, iranian, polynesian, nahuatl, basque,
 * hepburn, finnic, classical, kartvelian, pinyin, indic, andean, bantu, mayan,
 * inuit, malay), normally suggested by its sound style, adapted to its
 * inventory with collision-free spellings, contextual rules (c/qu, diphthong
 * glides, geminate digraphs) and a long-vowel style. Daughters inherit and drift.
 *
 * Also: IPA transcription with stress marks.
 */
import type { Rng } from "../core/rng";
import { cf, features, isVowel, phonemeFor, vf, vowelQuality } from "./phoneme";
import { stressedSyllable, syllabify } from "./phonology";
import type { Orthography, Phonology, SpellingRule, StressRule, Word } from "./types";
import { capitalize } from "./util";

type LongStyle = "double" | "macron" | "acute" | "circumflex";

interface School {
  id: string;
  /** Preferred spellings per phoneme, best first. */
  map: Record<string, string[]>;
  /** Phonemes whose first-choice spelling varies by language (shuffled per language). */
  variants?: Record<string, string[]>;
  long: LongStyle[];
  nasal: ("tilde" | "ogonek")[];
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
}

/** Generic candidates, used after the school's own. */
const DEFAULT: Record<string, string[]> = {
  p: ["p"], b: ["b"], t: ["t"], d: ["d"], ʈ: ["ṭ", "tt"], ɖ: ["ḍ", "dd"], c: ["ty", "ky", "ć"], ɟ: ["gy", "dy", "ǵ"],
  k: ["k", "c"], g: ["g"], q: ["q"], ɢ: ["ġ"], ʔ: ["'", "ʻ", "ʾ"],
  pf: ["pf"], ts: ["ts", "tz", "c"], dz: ["dz", "z"], tʃ: ["ch", "č", "tch"], dʒ: ["j", "dj", "dž"],
  ʈʂ: ["zh", "tr"], ɖʐ: ["dr"], tɕ: ["ć", "ty", "ch"], dʑ: ["dź", "dy"], tɬ: ["tl", "tlh"],
  ɸ: ["f", "ph"], β: ["v", "bh"], f: ["f", "ph"], v: ["v", "w"], θ: ["th", "þ"], ð: ["dh", "ð"],
  s: ["s", "ss"], z: ["z", "ż"], ʃ: ["sh", "š"], ʒ: ["zh", "ž"], ʂ: ["ṣ", "sh"], ʐ: ["ẓ", "zh"],
  ɕ: ["ś", "sy"], ʑ: ["ź", "zy"], ç: ["hy", "ç"], ʝ: ["yh", "gh"], x: ["kh", "ch", "x"], ɣ: ["gh", "ğ"],
  χ: ["kh", "x", "qh"], ʁ: ["gh", "rh"], ħ: ["ḥ", "hh"], ʕ: ["ʿ", "'"], h: ["h"], ɦ: ["h", "hh"],
  ɬ: ["ll", "lh", "hl"], ɮ: ["dl"], m: ["m"], n: ["n"], ɳ: ["ṇ", "rn"], ɲ: ["ny", "ñ", "nh"],
  ŋ: ["ng", "ñ", "ṅ"], ɴ: ["ng"], r: ["r", "rr"], ʀ: ["r", "rr"], ɾ: ["r"], ɽ: ["ṛ", "rd"], l: ["l"], ɭ: ["ḷ", "rl"],
  ʎ: ["ly", "lh", "ll", "lj"], j: ["y", "j"], w: ["w", "u"], ʋ: ["v", "w"], ɹ: ["r"], ɰ: ["gh", "w"],
  // vowel qualities
  i: ["i"], y: ["ü", "y"], ɨ: ["y", "ï", "ı"], ʉ: ["ü", "u"], ɯ: ["ı", "ŭ"], u: ["u"],
  ɪ: ["i", "ĭ"], ʏ: ["ü"], ʊ: ["u", "ŭ"], e: ["e"], ø: ["ö", "ø", "eu"], ɘ: ["ë"], ɵ: ["ö"],
  ɤ: ["ë", "ŏ"], o: ["o"], ə: ["ë", "ă", "e"], ɛ: ["è", "ä", "ę"], œ: ["œ", "ö"],
  ɜ: ["ë", "ö"], ʌ: ["ŭ", "ă"], ɔ: ["ò", "å", "ǫ"], æ: ["æ", "ä", "ae"], ɐ: ["a", "ă"],
  a: ["a"], ɑ: ["â", "å", "a"], ɒ: ["å", "ò"],
};

const SCHOOLS: School[] = [
  {
    id: "anglo", long: ["double", "macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      ʃ: ["sh"], tʃ: ["ch"], dʒ: ["j"], j: ["y"], x: ["kh"], θ: ["th"], ð: ["dh"], ɣ: ["gh"], ʒ: ["zh"], ŋ: ["ng"], ɲ: ["ny"],
      χ: ["kh", "q"], ʁ: ["gh"], ħ: ["ḥ", "hh"], ʕ: ["'"], ts: ["ts"], q: ["q"], ç: ["hy"], ʝ: ["y"],
      ə: ["ë", "u"], ɨ: ["y", "ï"], ɛ: ["è", "ae"], ɔ: ["ò", "aw"], æ: ["ae", "æ"], ø: ["eu", "ö"], y: ["ü", "yu"], ɯ: ["ı"], ɑ: ["â"],
    },
    variants: { x: ["kh", "x"] },
    likes: ["ʃ", "tʃ", "θ", "x"],
  },
  {
    id: "germanic", long: ["double", "acute"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      ʃ: ["sch"], tʃ: ["tsch"], x: ["ch"], j: ["j"], ts: ["z", "tz"], ç: ["ch"], y: ["ü"], ø: ["ö"], æ: ["ä"], ɛ: ["ä", "è"],
      ɔ: ["å", "ò"], dʒ: ["dsch"], ʒ: ["zh"], z: ["z", "s"], v: ["w", "v"], w: ["w", "u"], f: ["f"], ŋ: ["ng"], ə: ["e", "ë"],
      θ: ["th"], ð: ["dh"], ɣ: ["gh"], ɲ: ["nj"],
    },
    likes: ["ʃ", "x", "ts", "y", "ø", "pf", "ç", "v"],
  },
  {
    id: "nordic", long: ["acute"], nasal: ["ogonek"], jAfterV: "i", wAfterV: "u",
    map: {
      θ: ["þ"], ð: ["ð"], j: ["j"], ʃ: ["sj", "sk"], tʃ: ["tj", "kj"], x: ["h", "ch"], ɣ: ["g", "gh"], æ: ["æ"], ø: ["ø"],
      ɔ: ["ǫ", "å"], y: ["y"], w: ["v", "w"], v: ["v", "f"], ɑ: ["å"], œ: ["œ"], ŋ: ["ng"], ə: ["e"], ç: ["hj"], ʒ: ["zj"],
      ts: ["z", "ts"], dʒ: ["dj"], β: ["v"], ɸ: ["f"], ʎ: ["lj"], ɲ: ["nj"],
    },
    likes: ["θ", "ð", "æ", "ø", "ɔ", "y"],
  },
  {
    id: "slavic", long: ["acute"], nasal: ["ogonek"], jAfterV: "j", wAfterV: "u",
    map: {
      ʃ: ["š"], tʃ: ["č"], ʒ: ["ž"], dʒ: ["dž"], ts: ["c"], x: ["ch", "h"], j: ["j"], ɲ: ["ň", "nj"], ʎ: ["ľ", "lj"], ɨ: ["y"],
      tɕ: ["ć"], ɕ: ["ś"], ʑ: ["ź"], dʑ: ["đ"], ə: ["ă", "ǝ"], c: ["ť"], ɟ: ["ď"], w: ["ŭ", "w"], ɣ: ["gh", "ğ"], θ: ["th"],
      ð: ["dh"], dz: ["dz"], ŋ: ["ng"], ɛ: ["ě"], æ: ["ä"], ɔ: ["ô"], y: ["ü"], ø: ["ö"],
    },
    variants: { x: ["ch", "h"] },
    likes: ["ʃ", "tʃ", "ʒ", "ts", "x", "ɨ", "tɕ", "ɲ"],
  },
  {
    id: "polish", long: ["acute"], nasal: ["ogonek"], jAfterV: "j", wAfterV: "ł",
    map: {
      ʃ: ["sz"], tʃ: ["cz"], ʒ: ["ż"], dʒ: ["dż"], ts: ["c"], x: ["ch"], j: ["j"], v: ["w"], w: ["ł"], ɲ: ["ń"], tɕ: ["ć"],
      ɕ: ["ś"], ʑ: ["ź"], dʑ: ["dź"], ɨ: ["y"], ʎ: ["l"], dz: ["dz"], ə: ["ë"], ɣ: ["gh"], ŋ: ["ng"],
    },
    likes: ["ʃ", "tʃ", "ʒ", "ts", "ɕ", "tɕ", "ɨ", "v"],
    requires: (inv) => inv.has("v") || inv.has("ʃ"),
  },
  {
    id: "hungarian", long: ["acute"], nasal: ["tilde"], jAfterV: "j", wAfterV: "u",
    map: {
      s: ["sz"], ʃ: ["s"], tʃ: ["cs"], ʒ: ["zs"], ts: ["c"], dʒ: ["dzs"], ɟ: ["gy"], c: ["ty"], ɲ: ["ny"], ʎ: ["ly"], j: ["j"],
      y: ["ü"], ø: ["ö"], x: ["ch", "h"], dz: ["dz"], ŋ: ["ng"], ə: ["ë"], ɛ: ["e"], æ: ["ä"],
    },
    likes: ["y", "ø", "ɟ", "c", "ɲ", "tʃ"],
    requires: (inv) => inv.has("ʃ") && inv.has("s"),
  },
  {
    id: "romance", long: ["acute", "circumflex"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      k: ["c"], tʃ: ["ch"], ʃ: ["x", "sc"], ɲ: ["ñ", "gn"], ʎ: ["ll", "gl"], θ: ["z"], x: ["j", "kh"], dʒ: ["g", "dj"], j: ["y", "i"],
      w: ["u", "hu"], ts: ["z", "ç"], ʒ: ["j"], r: ["rr", "r"], ɛ: ["è"], ɔ: ["ò"], kʷ: ["qu"], gʷ: ["gu"], ə: ["ë"], ð: ["d"],
      β: ["b"], ɣ: ["g"], dz: ["z"],
    },
    rules: [
      { p: "k", s: "qu", before: "front" },
      { p: "g", s: "gu", before: "front" },
      { p: "w", s: "hu", after: "start", before: "vowel" },
    ],
    likes: ["ɲ", "ʎ", "θ", "tʃ", "ɛ", "ɔ", "kʷ"],
  },
  {
    id: "celtic", long: ["circumflex", "acute"], nasal: ["tilde"], jAfterV: "i", wAfterV: "w",
    map: {
      v: ["f"], f: ["ff"], ð: ["dd"], ɬ: ["ll"], x: ["ch"], θ: ["th"], ə: ["y"], ɨ: ["y", "u"], k: ["c"], j: ["i", "y"], ŋ: ["ng"],
      β: ["bh"], ɣ: ["gh"], ʃ: ["sh", "si"], w: ["w"], u: ["w", "u"], y: ["ü"], ʒ: ["zh"], tʃ: ["ch", "tsi"], dʒ: ["j"], ts: ["ts"],
      ɛ: ["è"], ɔ: ["ò"], æ: ["ae"], ø: ["eu"], ɲ: ["ny"], ʎ: ["ly"],
    },
    likes: ["ð", "ɬ", "x", "v", "θ", "ə"],
  },
  {
    id: "turkic", long: ["circumflex"], nasal: ["tilde"], jAfterV: "y", wAfterV: "v",
    map: {
      ʃ: ["ş"], tʃ: ["ç"], dʒ: ["c"], ʒ: ["j"], j: ["y"], ɣ: ["ğ"], ɯ: ["ı"], ø: ["ö"], y: ["ü"], x: ["kh", "h"], q: ["q"],
      ŋ: ["ñ", "ng"], χ: ["x"], ə: ["ä", "ë"], æ: ["ä"], ts: ["ts"], θ: ["th"], ð: ["dh"], ɛ: ["ä"], ɔ: ["å"], ɲ: ["ny"],
    },
    likes: ["ɯ", "ø", "y", "ʃ", "tʃ", "q", "ɣ"],
  },
  {
    id: "mongolic", long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: {
      x: ["kh"], ts: ["ts"], tʃ: ["ch"], dʒ: ["j"], ʃ: ["sh"], ʒ: ["zh"], j: ["y"], ø: ["ö"], y: ["ü"], ɵ: ["ö"], ʉ: ["ü"],
      ŋ: ["ng"], ɣ: ["gh"], ə: ["ë"], ɔ: ["o"], ʊ: ["u"], q: ["q"], χ: ["kh"],
    },
    likes: ["x", "ts", "ø", "y"],
  },
  {
    id: "semitic", long: ["macron"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: {
      ħ: ["ḥ"], ʕ: ["ʿ"], ʔ: ["ʾ", "'"], ʃ: ["sh", "š"], x: ["kh", "ḫ"], χ: ["kh"], ɣ: ["gh", "ġ"], θ: ["th", "ṯ"], ð: ["dh", "ḏ"],
      q: ["q"], dʒ: ["j"], j: ["y"], tʼ: ["ṭ"], kʼ: ["ḳ"], sʼ: ["ṣ"], tsʼ: ["ṣ"], pʼ: ["p̣"], tʃ: ["ch"], ʒ: ["zh"], ts: ["ts"],
      ə: ["e"], ɛ: ["e"], ɔ: ["o"], ŋ: ["ng"], ɲ: ["ny"], v: ["v"],
    },
    variants: { ʃ: ["sh", "š"] },
    likes: ["ħ", "ʕ", "q", "χ", "x", "ʔ", "ð", "θ"],
  },
  {
    id: "iranian", long: ["macron"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: {
      x: ["kh"], ʃ: ["sh"], ʒ: ["zh"], ɣ: ["gh"], q: ["q"], tʃ: ["ch"], dʒ: ["j"], j: ["y"], θ: ["th"], ð: ["dh"], w: ["w", "v"],
      ɑ: ["â", "å"], ə: ["ë"], ŋ: ["ng"], ts: ["ts"], χ: ["kh"], ʔ: ["'"], ħ: ["h"],
    },
    likes: ["x", "ʃ", "ʒ", "ɣ", "q"],
  },
  {
    id: "polynesian", long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { ʔ: ["ʻ"], ŋ: ["ng", "g"], ɸ: ["wh"], f: ["f", "wh"], β: ["v"], j: ["y"], ʃ: ["sh"], tʃ: ["ch"], ts: ["ts"] },
    likes: ["ʔ", "ŋ", "ɸ"],
    requires: (inv) => [...inv].filter((p) => !isVowel(p)).length <= 15,
  },
  {
    id: "nahuatl", long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "uh",
    map: {
      tɬ: ["tl"], ts: ["tz"], tʃ: ["ch"], ʃ: ["x"], w: ["hu"], k: ["c"], kʷ: ["cu"], ʔ: ["h"], j: ["y"], s: ["z", "s"],
      ɬ: ["lh"], x: ["j"], ŋ: ["ng"], ə: ["ë"], u: ["u"], θ: ["th"], ð: ["dh"], ʒ: ["zh"], dʒ: ["dj"],
    },
    rules: [
      { p: "k", s: "qu", before: "front" },
      { p: "kʷ", s: "uc", before: "nonvowel" },
      { p: "s", s: "c", before: "front" },
    ],
    likes: ["tɬ", "ts", "kʷ", "ʃ", "ʔ"],
    requires: (inv) => (inv.has("tɬ") || inv.has("kʷ")) && (!inv.has("h") || !inv.has("ʔ")) && !inv.has("z"),
  },
  {
    id: "basque", long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { tʃ: ["tx"], ts: ["tz"], ʃ: ["x"], j: ["y", "i"], ɲ: ["ñ"], x: ["j"], ʎ: ["ll"], r: ["rr"], ɾ: ["r"], θ: ["z"], dʒ: ["dj"], ʒ: ["j"], ɣ: ["g"], ð: ["d"], β: ["b"], ə: ["e"] },
    likes: ["ts", "tʃ", "ʃ", "ɲ"],
    requires: (inv) => inv.has("ts") && (inv.has("tʃ") || inv.has("ʃ")),
  },
  {
    id: "hepburn", long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { ʃ: ["sh"], tʃ: ["ch"], ts: ["ts"], dʒ: ["j"], ɸ: ["f"], j: ["y"], ɾ: ["r"], ɕ: ["sh"], tɕ: ["ch"], dʑ: ["j"], ŋ: ["ng"], ʒ: ["zh"], x: ["kh"], ə: ["ë"], ɨ: ["ü"], dz: ["dz"], β: ["v"], ç: ["hy"], ɣ: ["gh"] },
    likes: ["ɸ", "ɾ", "ts", "ɕ", "tɕ"],
  },
  {
    id: "finnic", long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { j: ["j"], y: ["y"], ø: ["ö"], æ: ["ä"], ʃ: ["š"], ŋ: ["ng"], ʒ: ["ž"], tʃ: ["tš", "č"], ts: ["ts"], x: ["hh", "kh"], ɣ: ["gh"], ə: ["ë"], ɛ: ["e"], θ: ["th"], ð: ["dh"], β: ["v"], w: ["v", "w"], dʒ: ["dž"] },
    likes: ["y", "ø", "æ", "aː", "eː"],
  },
  {
    id: "classical", long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: {
      pʰ: ["ph"], tʰ: ["th"], kʰ: ["ch", "kh"], k: ["c", "k"], y: ["y"], x: ["ch", "kh"], j: ["i", "j"], w: ["u", "v"], ø: ["oe"],
      æ: ["ae"], ts: ["z"], θ: ["th"], kʷ: ["qu"], gʷ: ["gu"], ɛ: ["ē", "è"], ɔ: ["ō", "ò"], ʃ: ["sh", "x"], dz: ["z"], ə: ["ë"],
      tʃ: ["ch", "c"], dʒ: ["g"], β: ["b"], ð: ["d"], ɣ: ["g"],
    },
    variants: { kʰ: ["ch", "kh"] },
    pairs: { "k+s": "x" },
    likes: ["pʰ", "tʰ", "kʰ", "y", "θ", "kʷ"],
  },
  {
    id: "kartvelian", long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "v",
    map: {
      pʼ: ["p'"], tʼ: ["t'"], kʼ: ["k'"], qʼ: ["q'"], tsʼ: ["ts'"], tʃʼ: ["ch'"], x: ["kh"], ɣ: ["gh"], ʃ: ["sh"], ʒ: ["zh"],
      tʃ: ["ch"], dʒ: ["j"], ts: ["ts"], dz: ["dz"], j: ["y"], q: ["q"], χ: ["kh"], ə: ["ë"], ŋ: ["ng"],
    },
    likes: ["pʼ", "tʼ", "kʼ", "qʼ", "tsʼ", "tʃʼ", "ɣ", "x"],
    requires: (inv) => [...inv].some((p) => p.endsWith("ʼ")),
  },
  {
    id: "pinyin", long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "o",
    map: {
      p: ["b"], t: ["d"], k: ["g"], pʰ: ["p"], tʰ: ["t"], kʰ: ["k"], ts: ["z"], tsʰ: ["c"], ɕ: ["x"], tɕ: ["j"], tɕʰ: ["q"],
      ʂ: ["sh"], ʈʂ: ["zh"], ʈʂʰ: ["ch"], ʐ: ["r"], x: ["h"], tʃ: ["zh"], tʃʰ: ["ch"], ə: ["e"], e: ["ê"], y: ["ü"], ŋ: ["ng"],
      ʃ: ["sh"], j: ["y"], w: ["w"],
    },
    likes: ["pʰ", "tʰ", "kʰ", "tsʰ", "ɕ", "tɕ", "ʂ"],
    requires: (inv) => (inv.has("pʰ") || inv.has("tʰ") || inv.has("kʰ") ? !inv.has("b") && !inv.has("d") && !inv.has("g") : false),
  },
  {
    id: "indic", long: ["macron"], nasal: ["tilde"], jAfterV: "y", wAfterV: "v",
    map: {
      ʈ: ["ṭ"], ɖ: ["ḍ"], ɳ: ["ṇ"], ʂ: ["ṣ"], ɕ: ["ś"], ʃ: ["sh", "ś"], tʃ: ["ch", "c"], tʃʰ: ["chh"], dʒ: ["j"], dʒʱ: ["jh"],
      ɲ: ["ñ", "ny"], ŋ: ["ng", "ṅ"], j: ["y"], w: ["v"], ɭ: ["ḷ"], ʋ: ["v"], ɽ: ["ṛ"], r: ["r"], ɾ: ["r"], ə: ["ă"], x: ["kh"],
      ɣ: ["gh"], z: ["z"], ʈʰ: ["ṭh"], ɖʱ: ["ḍh"],
    },
    likes: ["ʈ", "ɖ", "ɳ", "ʂ", "bʱ", "dʱ", "gʱ", "kʰ", "ɭ"],
  },
  {
    id: "andean", long: ["double"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: {
      q: ["q"], ʎ: ["ll"], ɲ: ["ñ"], ʃ: ["sh"], tʃ: ["ch"], kʼ: ["k'"], qʼ: ["q'"], tʃʼ: ["ch'"], pʼ: ["p'"], tʼ: ["t'"],
      kʰ: ["kh"], qʰ: ["qh"], tʃʰ: ["chh"], pʰ: ["ph"], tʰ: ["th"], x: ["j", "h"], χ: ["j", "h"], j: ["y"], w: ["w"], ŋ: ["ng"],
      ts: ["ts"], ə: ["ë"],
    },
    likes: ["q", "qʼ", "ʎ", "ɲ", "kʼ", "χ"],
  },
  {
    id: "bantu", long: ["double"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: {
      ŋ: ["ng'"], ɲ: ["ny"], tʃ: ["ch"], dʒ: ["j"], ʃ: ["sh"], j: ["y"], w: ["w"], ɣ: ["gh"], θ: ["th"], ð: ["dh"], x: ["kh"],
      ɛ: ["è"], ɔ: ["ò"], ʒ: ["zh"], ts: ["ts"], ə: ["ë"], β: ["bh"],
    },
    rules: [{ p: "ŋ", s: "n", before: "vowel", after: "vowel" }],
    likes: ["ŋ", "ɲ", "mb"],
  },
  {
    id: "mayan", long: ["double"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: {
      ʃ: ["x"], x: ["j"], ts: ["tz"], tsʼ: ["tz'"], tʃ: ["ch"], tʃʼ: ["ch'"], kʼ: ["k'"], tʼ: ["t'"], pʼ: ["p'"], qʼ: ["q'"],
      ʔ: ["'"], j: ["y"], w: ["w"], q: ["q"], ŋ: ["ng"], ə: ["ä"], ɨ: ["ä"], h: ["h"], dʒ: ["dz"], ʒ: ["zh"],
    },
    likes: ["kʼ", "tsʼ", "tʃʼ", "ʃ", "x"],
  },
  {
    id: "inuit", long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { q: ["q"], ŋ: ["ng"], ɬ: ["lh", "ll"], ʁ: ["r"], ɣ: ["g"], j: ["j"], v: ["v"], χ: ["r"], x: ["kh"], ʃ: ["sh"], ts: ["ts"], ə: ["e"] },
    likes: ["q", "ŋ", "ɬ", "ʁ"],
  },
  {
    id: "malay", long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: {
      ŋ: ["ng"], ɲ: ["ny"], tʃ: ["c", "ch"], dʒ: ["j"], ʃ: ["sy", "sh"], x: ["kh"], ɣ: ["gh"], j: ["y"], w: ["w"], ʔ: ["'"],
      ə: ["e"], e: ["é"], θ: ["th"], ð: ["dh"], z: ["z"], f: ["f"], v: ["v"], ts: ["ts"],
    },
    variants: { tʃ: ["c", "ch"] },
    likes: ["ŋ", "ɲ", "ə"],
  },
];

const SCHOOL_BY_ID: Record<string, School> = Object.fromEntries(SCHOOLS.map((s) => [s.id, s]));

export function schoolIds(): string[] {
  return SCHOOLS.map((s) => s.id);
}

const VOWEL_LETTERS = "aeiouyäöüáéíóúàèìòùâêîôûāēīōūăĕĭŏŭæøåœəëïıǫęąãẽĩõũȳýǣőűơưůÿěô";

function isVowelLetter(ch: string): boolean {
  return VOWEL_LETTERS.includes(ch.normalize("NFC")) || VOWEL_LETTERS.includes(ch.normalize("NFD")[0] ?? "");
}

/** Candidate spellings for a phoneme: language variant, school's, default's, then generic fallbacks. */
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
    push(DEFAULT[p]);
    push([p]);
  }
  return out;
}

function hasDiacritic(s: string): boolean {
  return s.normalize("NFD") !== s || /[^a-z']/.test(s);
}

function longSpelling(short: string, style: LongStyle, p: string, schoolId: string): string {
  const q = vowelQuality(p);
  if (schoolId === "germanic" && q === "i" && style === "double") return "ie";
  if (schoolId === "hungarian") {
    if (short === "ö") return "ő";
    if (short === "ü") return "ű";
  }
  const single = [...short.normalize("NFC")].length === 1;
  const plain = /^[a-z]$/.test(short);
  // Doubling a letter that already carries a mark (ää, öö) is fine in Finnic; elsewhere prefer a mark.
  if (style === "double" && single && (plain || schoolId === "finnic" || schoolId === "mongolic")) return short + short;
  if (!single) return short + short.slice(-1);
  const order: LongStyle[] = style === "double" ? ["macron", "circumflex", "acute"] : [style, "macron", "circumflex", "acute"];
  for (const st of order) {
    if (st === "double") continue;
    const mark = st === "macron" ? "̄" : st === "acute" ? "́" : "̂";
    const composed = (short + mark).normalize("NFC");
    if ([...composed].length === 1) return composed;
  }
  return short + short;
}

function nasalSpelling(short: string, style: "tilde" | "ogonek"): string {
  const single = [...short.normalize("NFC")].length === 1 && !hasDiacritic(short);
  if (!single) return short + "n";
  const mark = style === "tilde" ? "̃" : "̨";
  return (short + mark).normalize("NFC");
}

function schoolScore(s: School, inv: Set<string>): number {
  if (s.requires && !s.requires(inv)) return 0;
  let aff = 0;
  for (const p of s.likes) if (inv.has(p)) aff++;
  return Math.pow(0.12 + aff, 1.5);
}

/** Build a collision-free orthography for a phoneme inventory. */
export function buildOrthography(
  ph: Phonology,
  rng: Rng,
  opts: { school?: string; schools?: [string, number][]; avoidSchools?: string[]; base?: Orthography } = {},
): Orthography {
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
  const longStyle = rng.pick(school.long);
  const nasalStyle = rng.pick(school.nasal);
  const variant: Record<string, string> = {};
  for (const [p, vs] of Object.entries(school.variants ?? {})) variant[p] = rng.pick(vs);
  const map: Record<string, string> = {};
  const used = new Set<string>();
  // Keep the base orthography's spellings where possible (daughters).
  if (opts.base) {
    for (const p of [...ph.consonants, ...ph.vowels]) {
      const s = opts.base.map[p];
      if (s !== undefined && !used.has(s)) {
        map[p] = s;
        if (s) used.add(s);
      }
    }
  }
  // Short vowels and consonants: assign by priority.
  const shorts = [...ph.consonants, ...new Set(ph.vowels.map(vowelQuality))].filter((p) => map[p] === undefined);
  const freq = (p: string) => (ph.wOnset[p] ?? 0) + (ph.wCoda[p] ?? 0) + (ph.wVowel[p] ?? 0) * 2;
  const cands = new Map(shorts.map((p) => [p, candidates(p, school, variant[p])]));
  shorts.sort((a, b) => cands.get(a)!.length - cands.get(b)!.length || freq(b) - freq(a) || (a < b ? -1 : 1));
  // Spanish-style r/rr when both a trill and a tap exist.
  if (inv.has("r") && inv.has("ɾ") && map.r === undefined && map["ɾ"] === undefined && !used.has("rr")) {
    map.r = "rr";
    map["ɾ"] = "r";
    used.add("rr");
    used.add("r");
  }
  // Phonemes whose preferred spelling is their own ASCII letter go first, so
  // that p/t/k/a/i/u/w/h keep their obvious spellings and nothing else steals them.
  const natural = (p: string) => /^[a-z]$/.test(p) && cands.get(p)![0] === p;
  // Then the school's explicit spellings (š, þ, tl…), then modified stops (pʰ, kʼ, kʷ).
  const explicit = (p: string) => !natural(p) && (!!school.map[p] || !!variant[p]);
  const modified = (p: string) => {
    const f = cf(p);
    return !!f && (f.asp || f.ejective || f.lab) && !natural(p) && !explicit(p);
  };
  const ordered = [
    ...shorts.filter(natural),
    ...shorts.filter(explicit),
    ...shorts.filter(modified),
    ...shorts.filter((p) => !natural(p) && !explicit(p) && !modified(p)),
  ].filter((p) => map[p] === undefined);
  for (const p of ordered) {
    if (map[p] !== undefined) continue;
    const cs = cands.get(p)!;
    let chosen = cs.find((c) => !used.has(c));
    if (chosen === undefined) {
      // borrow a spelling from any tradition, then fall back to IPA-ish forms
      const extra = SCHOOLS.flatMap((sc) => sc.map[p] ?? []);
      chosen = [...extra, p, p + "h", p + "'", p + p].find((c) => !used.has(c)) ?? p;
    }
    map[p] = chosen;
    used.add(chosen);
  }
  // Ensure every vowel quality has a spelling (for long/nasal derivation).
  for (const v of ph.vowels) {
    const q = vowelQuality(v);
    if (map[q] === undefined) {
      const c = candidates(q, school).find((x) => !used.has(x)) ?? q;
      map[q] = c;
      used.add(c);
    }
  }
  // Long and nasal vowels.
  for (const v of ph.vowels) {
    if (map[v] !== undefined && opts.base?.map[v] === map[v]) continue;
    const f = vf(v)!;
    if (!f.long && !f.nasal) continue;
    const q = vowelQuality(v);
    let base = map[q];
    if (f.nasal) base = nasalSpelling(base, nasalStyle);
    const cs: string[] = [];
    if (f.long) {
      const plain = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const marked = plain !== base && [...plain].length === 1 && /^[a-z]$/.test(plain);
      // A long vowel whose short form already carries a mark (è, ò) is better written ê/ô than èè.
      if (marked && school.id !== "finnic" && school.id !== "mongolic")
        for (const st of [longStyle, "circumflex", "macron", "acute"] as LongStyle[]) if (st !== "double") cs.push(longSpelling(plain, st, v, school.id));
      cs.push(longSpelling(base, longStyle, v, school.id));
      for (const st of ["macron", "circumflex", "acute"] as LongStyle[]) if (st !== longStyle) cs.push(longSpelling(base, st, v, school.id));
      cs.push(base + base, base + "h");
    } else cs.push(base, base + "n", base + "ñ");
    const s = cs.find((c) => !used.has(c)) ?? cs[0];
    map[v] = s;
    used.add(s);
  }
  // Contextual rules.
  const rules: SpellingRule[] = [];
  if (inv.has("j") && (map.j === "y" || map.j === "j")) rules.push({ p: "j", s: school.jAfterV === "j" ? map.j : school.jAfterV, after: "vowel", before: "nonvowel" });
  if (inv.has("w") && map.w && map.w !== school.wAfterV && !(map.w === "ł" && school.wAfterV === "ł") && !(map.w === "v" && school.wAfterV === "v"))
    rules.push({ p: "w", s: school.wAfterV, after: "vowel", before: "nonvowel" });
  if (inv.has("ʔ") && ["'", "ʻ", "ʾ"].includes(map["ʔ"])) rules.push({ p: "ʔ", s: "", after: "start" });
  if (map.w === "hu") rules.push({ p: "w", s: "u", after: "consonant" });
  if (map.r === "rr") {
    // Spanish-style: the trill is written double only between vowels
    rules.push({ p: "r", s: "r", after: "start" }, { p: "r", s: "r", after: "consonant" }, { p: "r", s: "r", before: "nonvowel" });
  }
  for (const r of school.rules ?? []) {
    if (!inv.has(r.p)) continue;
    // only applies if the default spelling is the one the rule is written against
    if (r.p === "k" && map.k !== "c") continue;
    if (r.p === "g" && map.k !== "c") continue;
    if (r.p === "s" && map.s !== "z") continue;
    if (r.p === "w" && map.w !== "u" && map.w !== "hu") continue;
    if (r.p === "w" && r.s === "hu" && map.w === "hu") continue;
    if (r.p === "kʷ" && map["kʷ"] !== "cu") continue;
    if (r.p === "ŋ" && map["ŋ"] !== "ng'") continue;
    rules.push(r);
  }
  const pairs = school.pairs ?? {};
  for (const [k, s] of Object.entries(pairs)) {
    const [a, b] = k.split("+");
    if (inv.has(a) && inv.has(b) && !used.has(s) && (s !== "x" || map[a] === "c")) rules.push({ p: k, s });
  }
  return { school: school.id, map, rules, geminateFirstLetter: !!school.geminateFirst };
}

/** Daughter orthography: inherit, spell new phonemes, and drift a little. */
export function driftOrthography(parent: Orthography, ph: Phonology, rng: Rng): Orthography {
  const base: Orthography = JSON.parse(JSON.stringify(parent)) as Orthography;
  // Occasionally reform: a few phonemes take another tradition's spelling.
  if (rng.chance(0.45)) {
    const donor = SCHOOLS[rng.weightedIndex(SCHOOLS.map((s) => schoolScore(s, new Set([...ph.consonants, ...ph.vowels]))))];
    const cons = ph.consonants.filter((p) => donor.map[p] && donor.map[p][0] !== base.map[p]);
    const n = rng.int(1, 2);
    for (const p of rng.sample(cons, n)) {
      const s = donor.map[p][0];
      if (!Object.values(base.map).includes(s)) base.map[p] = s;
    }
  }
  const o = buildOrthography(ph, rng, { school: base.school, base });
  // carry over rules that still apply, plus new ones
  const keep = base.rules.filter((r) => r.p.split("+").every((x) => ph.consonants.includes(x) || ph.vowels.includes(x)));
  const all = [...keep];
  for (const r of o.rules) if (!all.some((x) => x.p === r.p && x.before === r.before && x.after === r.after)) all.push(r);
  o.rules = all.filter((r) => !(r.p === "k" && o.map.k !== "c") && !(r.p === "g" && o.map.k !== "c"));
  o.geminateFirstLetter = base.geminateFirstLetter;
  return o;
}

// ---------------------------------------------------------------------------
// Romanisation
// ---------------------------------------------------------------------------

function envMatch(r: SpellingRule, w: Word, i: number, span: number): boolean {
  if (r.after) {
    const prev = w[i - 1];
    if (r.after === "start" && i !== 0) return false;
    if (r.after === "vowel" && !(prev && isVowel(prev))) return false;
    if (r.after === "consonant" && !(prev && !isVowel(prev))) return false;
  }
  if (r.before) {
    const nx = w[i + span];
    if (r.before === "end" && nx !== undefined) return false;
    if (r.before === "vowel" && !(nx && isVowel(nx))) return false;
    if (r.before === "nonvowel" && nx && isVowel(nx)) return false;
    if (r.before === "front") {
      const f = nx ? vf(nx) : null;
      // c/qu, g/gu alternations: before e and i (not æ, y, ø)
      if (!f || f.back !== 0 || f.round || f.height > 4) return false;
    }
    if (r.before === "back" && !(nx && (vf(nx)?.back ?? 0) > 0)) return false;
  }
  return true;
}

function fallbackSpelling(p: string): string {
  const f = features(p);
  if (!f) return p;
  if (f.kind === "V") return DEFAULT[vowelQuality(p)]?.[0] ?? p;
  const base = phonemeFor({ ...f, asp: false, ejective: false, lab: false }) ?? p;
  return (DEFAULT[base]?.[0] ?? base) + (f.asp ? "h" : "") + (f.ejective ? "'" : "") + (f.lab ? "w" : "");
}

/** Romanise one word (lowercase). */
export function romanizeWord(o: Orthography, w: Word): string {
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
    if (i + 1 < w.length && o.rules.length) {
      const k2 = p + "+" + w[i + 1];
      for (const r of o.rules) {
        if (r.p === k2 && envMatch(r, w, i, 2)) {
          s = r.s;
          span = 2;
          break;
        }
      }
    }
    if (s === undefined) {
      for (const r of o.rules) {
        if (r.p === p && envMatch(r, w, i, 1)) {
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

/** Rough readability score: 0 good, higher worse. */
export function ugliness(roman: string): number {
  const s = roman.toLowerCase();
  let worst = 0;
  let run = 0;
  for (const ch of s) {
    if (ch === " " || ch === "-") {
      run = 0;
      continue;
    }
    if (isVowelLetter(ch) || ch === "y") run = 0;
    else {
      run++;
      worst = Math.max(worst, run);
    }
  }
  const marks = [...s.normalize("NFD")].filter((c) => /[\u0300-\u036f]/.test(c)).length;
  const apos = (s.match(/['ʻʿʾʼ]/g) ?? []).length;
  const len = [...s].length;
  return Math.max(0, worst - 3) * 2 + Math.max(0, marks - 2) * 0.7 + Math.max(0, apos - 1) * 0.8 + Math.max(0, len - 12) * 0.35;
}

export { cf };
