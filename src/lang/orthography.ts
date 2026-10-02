/**
 * Romanisation. Each language picks a dominant orthographic tradition
 * ("school": anglo, germanic, nordic, slavic, polish, hungarian, romance,
 * celtic, turkic, semitic, polynesian, nahuatl, basque, hepburn, finnic,
 * classical, kartvelian, pinyin, indic, andean), adapted to its inventory with
 * collision-free spellings, contextual rules (c/qu, diphthong glides,
 * geminate digraphs) and a long-vowel style. Daughters inherit and drift.
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
  weight: number;
  map: Record<string, string[]>;
  long: LongStyle[];
  nasal: ("tilde" | "ogonek")[];
  jAfterV: string;
  wAfterV: string;
  rules?: SpellingRule[];
  /** Phonemes this tradition is good at spelling (affinity). */
  likes: string[];
  /** Hard requirement on the inventory. */
  requires?: (inv: Set<string>) => boolean;
  geminateFirst?: boolean;
  /** Two-phoneme spellings ("k+s" → "x"). */
  pairs?: Record<string, string>;
}

const DEFAULT: Record<string, string[]> = {
  p: ["p"], b: ["b"], t: ["t"], d: ["d"], ʈ: ["ṭ", "tt", "rt"], ɖ: ["ḍ", "dd", "rd"], c: ["ky", "ty", "ć", "c"], ɟ: ["gy", "dy", "ǵ"],
  k: ["k", "c"], g: ["g"], q: ["q", "qh", "kq"], ɢ: ["gq", "ġ"], ʔ: ["'", "ʻ", "ʾ", "h"],
  pf: ["pf"], ts: ["ts", "tz", "c", "ç"], dz: ["dz", "z", "dż"], tʃ: ["ch", "tch", "č", "c"], dʒ: ["j", "dj", "dzh", "dž"],
  ʈʂ: ["tr", "zh", "č"], ɖʐ: ["dr", "ǰ"], tɕ: ["ty", "ć", "ch"], dʑ: ["dy", "dź", "j"], tɬ: ["tl", "tlh"],
  ɸ: ["f", "ph", "fh"], β: ["v", "bh", "b"], f: ["f", "ph", "ff"], v: ["v", "w", "bh"], θ: ["th", "þ", "z", "ŧ"], ð: ["dh", "ð", "dd", "th"],
  s: ["s", "ss", "ś"], z: ["z", "s", "ż", "zz"], ʃ: ["sh", "š", "x", "sch", "sj"], ʒ: ["zh", "ž", "j", "zs"], ʂ: ["ṣ", "sh", "ş"], ʐ: ["ẓ", "zh", "r"],
  ɕ: ["sy", "ś", "x"], ʑ: ["zy", "ź"], ç: ["hy", "ch", "ç"], ʝ: ["yh", "j", "gh"], x: ["kh", "x", "ch", "h", "ḫ"], ɣ: ["gh", "ğ", "ġ", "g"],
  χ: ["kh", "x", "qh", "ẖ"], ʁ: ["gh", "rh", "ğ", "r"], ħ: ["ḥ", "hh", "h"], ʕ: ["ʿ", "'", "ʽ"], h: ["h"], ɦ: ["h", "hh"],
  ɬ: ["lh", "ll", "hl", "ł"], ɮ: ["dl", "zl"], m: ["m"], n: ["n"], ɳ: ["ṇ", "nn", "rn"], ɲ: ["ny", "ñ", "nh", "nj", "gn"],
  ŋ: ["ng", "ŋ", "ñ", "ṅ"], ɴ: ["nq", "ng"], r: ["r", "rr"], ʀ: ["r", "rr"], ɾ: ["r", "ŕ", "rh"], ɽ: ["ṛ", "rd"], l: ["l"], ɭ: ["ḷ", "rl"],
  ʎ: ["ly", "ll", "lh", "lj", "ľ"], j: ["y", "j", "i"], w: ["w", "u", "v"], ʋ: ["v", "w"], ɹ: ["r"], ɰ: ["gh", "w"],
  // vowels (qualities)
  i: ["i"], y: ["ü", "y", "ue", "ui"], ɨ: ["y", "ë", "ï", "î", "ı"], ʉ: ["ü", "ʉ", "ue"], ɯ: ["ı", "ư", "ŭ", "u"], u: ["u", "ou", "oo"],
  ɪ: ["i", "ĭ", "ı"], ʏ: ["ü", "ÿ"], ʊ: ["u", "ŭ", "ů"], e: ["e"], ø: ["ö", "ø", "oe", "eu"], ɘ: ["ë", "ə"], ɵ: ["ö", "ɵ"],
  ɤ: ["ë", "ơ", "eo", "ŏ"], o: ["o"], ə: ["e", "ë", "ă", "â", "ə", "y"], ɛ: ["e", "è", "ę", "ä", "ae"], œ: ["œ", "ö", "eu", "oe"],
  ɜ: ["ë", "ö", "ea"], ʌ: ["ŭ", "u", "ă", "eo"], ɔ: ["o", "ò", "å", "ǫ", "aw"], æ: ["æ", "ä", "ae", "a", "e"], ɐ: ["a", "ă"],
  a: ["a"], ɑ: ["a", "â", "å", "aa"], ɒ: ["o", "å", "ò"],
};

const SCHOOLS: School[] = [
  {
    id: "anglo", weight: 3, long: ["double", "macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: { ʃ: ["sh"], tʃ: ["ch"], dʒ: ["j"], j: ["y"], x: ["kh"], θ: ["th"], ð: ["dh"], ɣ: ["gh"], ʒ: ["zh"], ŋ: ["ng"], ɲ: ["ny"] },
    likes: ["ʃ", "tʃ", "θ", "x"],
  },
  {
    id: "germanic", weight: 1.3, long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: { ʃ: ["sch"], tʃ: ["tsch"], x: ["ch"], j: ["j"], ts: ["z"], ç: ["ch"], y: ["ü"], ø: ["ö"], æ: ["ä"], ɛ: ["ä", "e"], dʒ: ["dsch"], ʒ: ["sch", "zh"], z: ["s", "z"], v: ["w", "v"], w: ["w", "u"] },
    likes: ["ʃ", "x", "ts", "y", "ø", "pf", "ç", "v"],
  },
  {
    id: "nordic", weight: 1.3, long: ["acute"], nasal: ["ogonek"], jAfterV: "i", wAfterV: "u",
    map: { θ: ["þ"], ð: ["ð"], j: ["j"], ʃ: ["sj", "sk"], tʃ: ["tj", "kj"], x: ["h", "gh"], ɣ: ["gh", "g"], æ: ["æ"], ø: ["ø"], ɔ: ["ǫ", "å"], y: ["y"], w: ["v", "w"], ɑ: ["å"] },
    likes: ["θ", "ð", "æ", "ø", "ɔ", "y"],
  },
  {
    id: "slavic", weight: 1.3, long: ["acute"], nasal: ["ogonek"], jAfterV: "j", wAfterV: "u",
    map: { ʃ: ["š"], tʃ: ["č"], ʒ: ["ž"], dʒ: ["dž"], ts: ["c"], x: ["h", "ch"], j: ["j"], ɲ: ["ň", "nj"], ʎ: ["lj", "ľ"], ɨ: ["y"], tɕ: ["ć"], ɕ: ["ś"], ʑ: ["ź"], dʑ: ["đ"], ə: ["ă", "ǝ"], c: ["ť"], ɟ: ["ď"], w: ["w", "v"] },
    likes: ["ʃ", "tʃ", "ʒ", "ts", "x", "ɨ", "tɕ", "ɲ"],
  },
  {
    id: "polish", weight: 0.7, long: ["double"], nasal: ["ogonek"], jAfterV: "j", wAfterV: "ł",
    map: { ʃ: ["sz"], tʃ: ["cz"], ʒ: ["ż"], dʒ: ["dż"], ts: ["c"], x: ["ch"], j: ["j"], v: ["w"], w: ["ł", "u"], ɲ: ["ń"], tɕ: ["ć"], ɕ: ["ś"], ʑ: ["ź"], dʑ: ["dź"], ɨ: ["y"] },
    likes: ["ʃ", "tʃ", "ʒ", "ts", "ɕ", "tɕ", "ɨ", "v"],
    requires: (inv) => inv.has("v") || inv.has("ʃ"),
  },
  {
    id: "hungarian", weight: 0.7, long: ["acute"], nasal: ["tilde"], jAfterV: "j", wAfterV: "u",
    map: { tʃ: ["cs"], ʒ: ["zs"], ts: ["c"], dʒ: ["dzs"], ɟ: ["gy"], c: ["ty"], ɲ: ["ny"], ʎ: ["ly"], j: ["j"], y: ["ü"], ø: ["ö"], x: ["ch", "h"] },
    likes: ["y", "ø", "ɟ", "c", "ɲ", "tʃ"],
    requires: (inv) => inv.has("ʃ") && inv.has("s"),
  },
  {
    id: "romance", weight: 1.4, long: ["acute", "circumflex"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: { k: ["c"], tʃ: ["ch"], ʃ: ["x", "sc"], ɲ: ["ñ", "gn", "nh"], ʎ: ["ll", "gl", "lh"], θ: ["z"], x: ["j", "kh"], dʒ: ["g", "dj"], j: ["y", "i"], w: ["u", "hu"], ts: ["z", "ç"], ʒ: ["j", "g"], r: ["rr", "r"], ɛ: ["è", "e"], ɔ: ["ò", "o"] },
    rules: [
      { p: "k", s: "qu", before: "front" },
      { p: "g", s: "gu", before: "front" },
      { p: "w", s: "hu", after: "start", before: "vowel" },
    ],
    likes: ["ɲ", "ʎ", "θ", "tʃ", "ɛ", "ɔ"],
  },
  {
    id: "celtic", weight: 1.0, long: ["circumflex", "acute"], nasal: ["tilde"], jAfterV: "i", wAfterV: "w",
    map: { v: ["f"], f: ["ff"], ð: ["dd"], ɬ: ["ll"], x: ["ch"], θ: ["th"], ə: ["y"], k: ["c"], j: ["i", "y"], ŋ: ["ng"], β: ["bh"], ɣ: ["gh", "dh"], ʃ: ["sh", "si"] },
    likes: ["ð", "ɬ", "x", "v", "θ", "ə"],
    requires: (inv) => inv.has("v") || inv.has("ð") || inv.has("ɬ") || inv.has("x"),
  },
  {
    id: "turkic", weight: 1.0, long: ["circumflex"], nasal: ["tilde"], jAfterV: "y", wAfterV: "v",
    map: { ʃ: ["ş"], tʃ: ["ç"], dʒ: ["c"], ʒ: ["j"], j: ["y"], ɣ: ["ğ"], ɯ: ["ı"], ø: ["ö"], y: ["ü"], x: ["kh", "h"], q: ["q"], ŋ: ["ñ", "ng"], χ: ["x"] },
    likes: ["ɯ", "ø", "y", "ʃ", "tʃ", "q", "ɣ"],
  },
  {
    id: "semitic", weight: 1.0, long: ["macron"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: { ħ: ["ḥ"], ʕ: ["ʿ"], ʔ: ["ʾ", "'"], ʃ: ["sh", "š"], x: ["kh", "ḫ"], χ: ["kh", "ḫ"], ɣ: ["gh", "ġ"], θ: ["th", "ṯ"], ð: ["dh", "ḏ"], q: ["q"], dʒ: ["j"], j: ["y"], tʼ: ["ṭ"], kʼ: ["ḳ"], sʼ: ["ṣ"], tsʼ: ["ṣ"], pʼ: ["p̣"] },
    likes: ["ħ", "ʕ", "q", "χ", "x", "ʔ", "ð", "θ"],
  },
  {
    id: "polynesian", weight: 1.0, long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { ʔ: ["ʻ"], ŋ: ["ng", "g"], ɸ: ["wh"], f: ["f", "wh"], β: ["v"] },
    likes: ["ʔ", "ŋ", "ɸ"],
    requires: (inv) => [...inv].filter((p) => !isVowel(p)).length <= 15,
  },
  {
    id: "nahuatl", weight: 0.8, long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "uh",
    map: { tɬ: ["tl"], ts: ["tz"], tʃ: ["ch"], ʃ: ["x"], w: ["hu"], k: ["c"], kʷ: ["cu"], ʔ: ["h"], j: ["y"] },
    rules: [
      { p: "k", s: "qu", before: "front" },
      { p: "kʷ", s: "uc", before: "nonvowel" },
    ],
    likes: ["tɬ", "ts", "kʷ", "ʃ", "ʔ"],
    requires: (inv) => (inv.has("tɬ") || inv.has("kʷ")) && (!inv.has("h") || !inv.has("ʔ")) && ![...inv].some((p) => ["y", "ø", "æ", "ɯ"].includes(p)),
  },
  {
    id: "basque", weight: 0.6, long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { tʃ: ["tx"], ts: ["tz"], ʃ: ["x"], j: ["y", "i"], ɲ: ["ñ"], x: ["j"], ʎ: ["ll"], r: ["rr"] },
    likes: ["ts", "tʃ", "ʃ", "ɲ"],
    requires: (inv) => inv.has("ts") && (inv.has("tʃ") || inv.has("ʃ")),
  },
  {
    id: "hepburn", weight: 0.8, long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { ʃ: ["sh"], tʃ: ["ch"], ts: ["ts"], dʒ: ["j"], ɸ: ["f"], j: ["y"], ɾ: ["r"], ɕ: ["sh"], tɕ: ["ch"], dʑ: ["j"] },
    likes: ["ɸ", "ɾ", "ts", "ɕ", "tɕ"],
  },
  {
    id: "finnic", weight: 1.0, long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u",
    map: { j: ["j"], y: ["y"], ø: ["ö"], æ: ["ä"], ʃ: ["š"], ŋ: ["ng"], ʒ: ["ž"] },
    likes: ["y", "ø", "æ", "aː", "eː"],
  },
  {
    id: "classical", weight: 0.9, long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "u", geminateFirst: true,
    map: { pʰ: ["ph"], tʰ: ["th"], kʰ: ["ch"], k: ["c"], y: ["y"], x: ["kh", "ch"], j: ["i", "j"], w: ["u", "v"], ø: ["oe"], æ: ["ae"], ts: ["z"], θ: ["th"] },
    pairs: { "k+s": "x" },
    likes: ["pʰ", "tʰ", "kʰ", "y", "θ"],
  },
  {
    id: "kartvelian", weight: 1.0, long: ["macron"], nasal: ["tilde"], jAfterV: "i", wAfterV: "v",
    map: { pʼ: ["p'"], tʼ: ["t'"], kʼ: ["k'"], qʼ: ["q'"], tsʼ: ["ts'"], tʃʼ: ["ch'"], x: ["kh", "x"], ɣ: ["gh"], ʃ: ["sh"], ʒ: ["zh"], tʃ: ["ch"], dʒ: ["j"], ts: ["ts"], dz: ["dz"], j: ["y"], q: ["q"] },
    likes: ["pʼ", "tʼ", "kʼ", "qʼ", "tsʼ", "tʃʼ", "ɣ", "x"],
    requires: (inv) => [...inv].some((p) => p.endsWith("ʼ")),
  },
  {
    id: "pinyin", weight: 1.0, long: ["double"], nasal: ["tilde"], jAfterV: "i", wAfterV: "o",
    map: { p: ["b"], t: ["d"], k: ["g"], pʰ: ["p"], tʰ: ["t"], kʰ: ["k"], ts: ["z"], tsʰ: ["c"], ɕ: ["x"], tɕ: ["j"], tɕʰ: ["q"], ʂ: ["sh"], ʈʂ: ["zh"], ʐ: ["r"], x: ["h"], tʃ: ["zh"], tʃʰ: ["ch"] },
    likes: ["pʰ", "tʰ", "kʰ", "tsʰ", "ɕ", "tɕ", "ʂ"],
    requires: (inv) => inv.has("pʰ") || inv.has("tʰ") || inv.has("kʰ") ? !inv.has("b") && !inv.has("d") && !inv.has("g") : false,
  },
  {
    id: "indic", weight: 1.0, long: ["macron"], nasal: ["tilde"], jAfterV: "y", wAfterV: "v",
    map: { ʈ: ["ṭ"], ɖ: ["ḍ"], ɳ: ["ṇ"], ʂ: ["ṣ"], ɕ: ["ś"], ʃ: ["ś", "sh"], tʃ: ["c", "ch"], dʒ: ["j"], ɲ: ["ñ"], ŋ: ["ṅ", "ng"], j: ["y"], w: ["v"], ɭ: ["ḷ"], ʋ: ["v"] },
    likes: ["ʈ", "ɖ", "ɳ", "ʂ", "bʱ", "dʱ", "gʱ", "kʰ", "ɭ"],
  },
  {
    id: "andean", weight: 0.7, long: ["double"], nasal: ["tilde"], jAfterV: "y", wAfterV: "w",
    map: { q: ["q"], ʎ: ["ll"], ɲ: ["ñ"], ʃ: ["sh"], tʃ: ["ch"], kʼ: ["k'"], qʼ: ["q'"], tʃʼ: ["ch'"], pʼ: ["p'"], tʼ: ["t'"], kʰ: ["kh"], qʰ: ["qh"], tʃʰ: ["chh"], x: ["j", "h"], χ: ["j", "h"], j: ["y"], w: ["w"] },
    likes: ["q", "qʼ", "ʎ", "ɲ", "kʼ", "χ"],
    requires: (inv) => inv.has("q") || inv.has("kʼ") || inv.has("ʎ"),
  },
];

const SCHOOL_BY_ID: Record<string, School> = Object.fromEntries(SCHOOLS.map((s) => [s.id, s]));

export function schoolIds(): string[] {
  return SCHOOLS.map((s) => s.id);
}

const VOWEL_LETTERS = "aeiouyäöüáéíóúàèìòùâêîôûāēīōūăĕĭŏŭæøåœəëïıǫęąãẽĩõũȳýǣőűơưůÿ";

function isVowelLetter(ch: string): boolean {
  return VOWEL_LETTERS.includes(ch.normalize("NFC")) || VOWEL_LETTERS.includes(ch.normalize("NFD")[0] ?? "");
}

/** Candidate spellings for a phoneme: school's, default's, then generic fallbacks. */
function candidates(p: string, school: School): string[] {
  const out: string[] = [];
  const push = (xs?: string[]) => {
    if (xs) for (const x of xs) if (!out.includes(x)) out.push(x);
  };
  push(school.map[p]);
  const f = features(p);
  if (!f) return [p];
  if (f.kind === "C") {
    push(DEFAULT[p]);
    // modified consonants
    const base = phonemeFor({ ...f, asp: false, ejective: false, lab: false });
    if (base && base !== p) {
      const bs = [...(school.map[base] ?? []), ...(DEFAULT[base] ?? [base])];
      for (const b of bs) {
        if (f.lab) push([b + "w", b + "u", b + "v"]);
        if (f.asp && !f.voice) push([b + "h", b + "hh"]);
        if (f.asp && f.voice) push([b + "h", b + "hh"]);
        if (f.ejective) push([b + "'", (b + "\u0323").normalize("NFC"), b + "q"]);
      }
    }
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
  if (schoolId === "germanic" && q === "i") return "ie";
  if (schoolId === "hungarian") {
    if (short === "ö") return "ő";
    if (short === "ü") return "ű";
  }
  const single = [...short.normalize("NFC")].length === 1;
  if (style === "double" || !single) return single ? short + short : short + short.slice(-1);
  const markCh = style === "macron" ? "̄" : style === "acute" ? "́" : "̂";
  const composed = (short + markCh).normalize("NFC");
  // use the mark only where a precomposed letter exists (ā, ǽ, ǖ); otherwise double
  if ([...composed].length !== 1) return short + short;
  const mark = style === "macron" ? "̄" : style === "acute" ? "́" : "̂";
  return (short + mark).normalize("NFC");
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
  return s.weight * Math.pow(0.12 + aff, 1.5);
}

/** Build a collision-free orthography for a phoneme inventory. */
export function buildOrthography(
  ph: Phonology,
  rng: Rng,
  opts: { school?: string; avoidSchools?: string[]; base?: Orthography } = {},
): Orthography {
  const inv = new Set([...ph.consonants, ...ph.vowels]);
  let school: School;
  if (opts.school && SCHOOL_BY_ID[opts.school]) school = SCHOOL_BY_ID[opts.school];
  else {
    const avoid = new Set(opts.avoidSchools ?? []);
    const weights = SCHOOLS.map((s) => schoolScore(s, inv) * (avoid.has(s.id) ? 0.15 : 1) * Math.exp(rng.normal(0, 0.35)));
    school = SCHOOLS[rng.weightedIndex(weights)];
  }
  if (school.id === "polish" && !inv.has("v")) school = { ...school, map: { ...school.map, w: ["w", "u"] } };
  const longStyle = rng.pick(school.long);
  const nasalStyle = rng.pick(school.nasal);
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
  // Short vowels and consonants: assign by priority (fewest options first, then frequency).
  const shorts = [...ph.consonants, ...new Set(ph.vowels.map(vowelQuality))].filter((p) => map[p] === undefined);
  const freq = (p: string) => (ph.wOnset[p] ?? 0) + (ph.wCoda[p] ?? 0) + (ph.wVowel[p] ?? 0) * 2;
  const cands = new Map(shorts.map((p) => [p, candidates(p, school)]));
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
  // Then modified stops (pʰ, kʼ, kʷ), whose natural spelling is base+h/'/w,
  // before fricatives that would otherwise steal "kh" or "ph".
  const modified = (p: string) => {
    const f = cf(p);
    return !!f && (f.asp || f.ejective || f.lab) && !natural(p);
  };
  const ordered = [...shorts.filter(natural), ...shorts.filter(modified), ...shorts.filter((p) => !natural(p) && !modified(p))].filter((p) => map[p] === undefined);
  for (const p of ordered) {
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
    const cands: string[] = [];
    if (f.long) {
      const first = longSpelling(base, longStyle, v, school.id);
      // a vowel letter that already carries a mark (è, ë): prefer marks on the plain letter over "èè"
      const plain = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (plain !== base && [...plain].length === 1 && !first.startsWith(plain)) {
        for (const st of [longStyle, "circumflex", "macron", "acute"] as LongStyle[]) if (st !== "double") cands.push(longSpelling(plain, st, v, school.id));
        cands.push(plain + plain);
      }
      cands.push(first, base + base, base + "h");
    } else cands.push(base, base + "n", base + "ñ");
    const s = cands.find((c) => !used.has(c)) ?? cands[0];
    map[v] = s;
    used.add(s);
  }
  // Contextual rules.
  const rules: SpellingRule[] = [];
  if (inv.has("j") && (map.j === "y" || map.j === "j")) rules.push({ p: "j", s: school.jAfterV === "j" ? map.j : school.jAfterV, after: "vowel", before: "nonvowel" });
  if (inv.has("w") && map.w && map.w !== school.wAfterV && !(map.w === "ł" && school.wAfterV === "ł"))
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
    if (r.p === "w" && map.w !== "u" && map.w !== "hu") continue;
    if (r.p === "w" && r.s === "hu" && map.w === "hu") continue;
    if (r.p === "kʷ" && map["kʷ"] !== "cu") continue;
    rules.push(r);
  }
  // Ejective / modified spellings that collide are fine; aspirates written with h are ok.
  const pairs = school.pairs ?? {};
  for (const [k, s] of Object.entries(pairs)) {
    const [a, b] = k.split("+");
    if (inv.has(a) && inv.has(b) && map[a] === "c" && !used.has(s)) rules.push({ p: k, s });
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
      if (chars.length >= 2 && o.geminateFirstLetter && !s.includes("'")) {
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
  const marks = [...s.normalize("NFD")].filter((c) => /[̀-ͯ]/.test(c)).length;
  const apos = (s.match(/['ʻʿʾʼ]/g) ?? []).length;
  const len = [...s].length;
  return Math.max(0, worst - 3) * 2 + Math.max(0, marks - 2) * 0.7 + Math.max(0, apos - 1) * 0.8 + Math.max(0, len - 12) * 0.35;
}

export { cf };
