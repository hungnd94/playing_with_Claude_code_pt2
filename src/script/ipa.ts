/**
 * A small IPA classifier — just enough phonetics for writing systems:
 * vowel/consonant, place/manner/voicing groups, secondary articulations, and a
 * feature distance used to pick the "nearest" letter for a borrowed sound.
 *
 * Phonemes are IPA strings as produced by the language engine: long vowels
 * like "aː", affricates like "tʃ", aspirates like "pʰ", nasal vowels like "ã"
 * are single phoneme strings.
 */

export const Places = [
  "bilabial",
  "labiodental",
  "dental",
  "alveolar",
  "postalveolar",
  "retroflex",
  "palatal",
  "velar",
  "labiovelar",
  "uvular",
  "pharyngeal",
  "glottal",
] as const;
export type Place = (typeof Places)[number];

export const Manners = [
  "stop",
  "affricate",
  "fricative",
  "nasal",
  "trill",
  "tap",
  "lateral",
  "lateralFricative",
  "approximant",
  "implosive",
  "click",
] as const;
export type Manner = (typeof Manners)[number];

/** Coarse articulatory groups used for featural glyph design (Hangul-style). */
export type PlaceGroup = "labial" | "coronal" | "sibilant" | "dorsal" | "laryngeal" | "liquid" | "glide";

export type Secondary =
  | "long"
  | "nasal"
  | "aspirated"
  | "labialized"
  | "palatalized"
  | "ejective"
  | "pharyngealized"
  | "prenasalized"
  | "breathy"
  | "voiceless"
  | "syllabic";

export interface PhonInfo {
  /** The phoneme as given. */
  ph: string;
  /** Base segment without secondary articulations ("pʰ" → "p", "ãː" → "a", "tʃʼ" → "tʃ"). */
  base: string;
  vowel: boolean;
  /** Recognised by the classifier (unknown symbols are guessed as consonants). */
  known: boolean;
  // consonant features
  place: Place;
  manner: Manner;
  voiced: boolean;
  group: PlaceGroup;
  // vowel features
  /** 0 close … 6 open. */
  height: number;
  /** 0 front, 1 central, 2 back. */
  back: number;
  round: boolean;
  secondary: Secondary[];
}

type C = [Place, Manner, boolean];
const CONS: Record<string, C> = {
  p: ["bilabial", "stop", false],
  b: ["bilabial", "stop", true],
  t: ["alveolar", "stop", false],
  d: ["alveolar", "stop", true],
  ʈ: ["retroflex", "stop", false],
  ɖ: ["retroflex", "stop", true],
  c: ["palatal", "stop", false],
  ɟ: ["palatal", "stop", true],
  k: ["velar", "stop", false],
  g: ["velar", "stop", true],
  ɡ: ["velar", "stop", true],
  q: ["uvular", "stop", false],
  ɢ: ["uvular", "stop", true],
  ʔ: ["glottal", "stop", false],
  ʡ: ["pharyngeal", "stop", false],
  m: ["bilabial", "nasal", true],
  ɱ: ["labiodental", "nasal", true],
  n: ["alveolar", "nasal", true],
  ɳ: ["retroflex", "nasal", true],
  ɲ: ["palatal", "nasal", true],
  ŋ: ["velar", "nasal", true],
  ɴ: ["uvular", "nasal", true],
  ʙ: ["bilabial", "trill", true],
  r: ["alveolar", "trill", true],
  ʀ: ["uvular", "trill", true],
  ⱱ: ["labiodental", "tap", true],
  ɾ: ["alveolar", "tap", true],
  ɽ: ["retroflex", "tap", true],
  ɸ: ["bilabial", "fricative", false],
  β: ["bilabial", "fricative", true],
  f: ["labiodental", "fricative", false],
  v: ["labiodental", "fricative", true],
  θ: ["dental", "fricative", false],
  ð: ["dental", "fricative", true],
  s: ["alveolar", "fricative", false],
  z: ["alveolar", "fricative", true],
  ʃ: ["postalveolar", "fricative", false],
  ʒ: ["postalveolar", "fricative", true],
  ʂ: ["retroflex", "fricative", false],
  ʐ: ["retroflex", "fricative", true],
  ɕ: ["palatal", "fricative", false],
  ʑ: ["palatal", "fricative", true],
  ç: ["palatal", "fricative", false],
  ʝ: ["palatal", "fricative", true],
  x: ["velar", "fricative", false],
  ɣ: ["velar", "fricative", true],
  χ: ["uvular", "fricative", false],
  ʁ: ["uvular", "fricative", true],
  ħ: ["pharyngeal", "fricative", false],
  ʕ: ["pharyngeal", "fricative", true],
  h: ["glottal", "fricative", false],
  ɦ: ["glottal", "fricative", true],
  ɬ: ["alveolar", "lateralFricative", false],
  ɮ: ["alveolar", "lateralFricative", true],
  ʋ: ["labiodental", "approximant", true],
  ɹ: ["alveolar", "approximant", true],
  ɻ: ["retroflex", "approximant", true],
  j: ["palatal", "approximant", true],
  ɰ: ["velar", "approximant", true],
  w: ["labiovelar", "approximant", true],
  ʍ: ["labiovelar", "approximant", false],
  ɥ: ["palatal", "approximant", true],
  l: ["alveolar", "lateral", true],
  ɭ: ["retroflex", "lateral", true],
  ʎ: ["palatal", "lateral", true],
  ʟ: ["velar", "lateral", true],
  ɫ: ["alveolar", "lateral", true],
  ɓ: ["bilabial", "implosive", true],
  ɗ: ["alveolar", "implosive", true],
  ʄ: ["palatal", "implosive", true],
  ɠ: ["velar", "implosive", true],
  ʛ: ["uvular", "implosive", true],
  ʘ: ["bilabial", "click", false],
  ǀ: ["dental", "click", false],
  ǃ: ["alveolar", "click", false],
  ǂ: ["palatal", "click", false],
  ǁ: ["alveolar", "click", false],
};

/** [height 0..6, back 0..2, rounded] */
const VOW: Record<string, [number, number, boolean]> = {
  i: [0, 0, false],
  y: [0, 0, true],
  ɨ: [0, 1, false],
  ʉ: [0, 1, true],
  ɯ: [0, 2, false],
  u: [0, 2, true],
  ɪ: [1, 0, false],
  ʏ: [1, 0, true],
  ʊ: [1, 2, true],
  e: [2, 0, false],
  ø: [2, 0, true],
  ɘ: [2, 1, false],
  ɵ: [2, 1, true],
  ɤ: [2, 2, false],
  o: [2, 2, true],
  ə: [3, 1, false],
  ɛ: [4, 0, false],
  œ: [4, 0, true],
  ɜ: [4, 1, false],
  ɞ: [4, 1, true],
  ʌ: [4, 2, false],
  ɔ: [4, 2, true],
  æ: [5, 0, false],
  ɐ: [5, 1, false],
  a: [6, 1, false],
  ɶ: [6, 0, true],
  ɑ: [6, 2, false],
  ɒ: [6, 2, true],
};

const AFFRICATE_SECOND = new Set(["s", "z", "ʃ", "ʒ", "ɕ", "ʑ", "ʂ", "ʐ", "f", "v", "x", "θ", "ð", "ɬ", "ɮ", "ç", "χ"]);

const cache = new Map<string, PhonInfo>();

function groupOf(place: Place, manner: Manner, base: string): PlaceGroup {
  if (manner === "trill" || manner === "tap" || manner === "lateral" || (manner === "approximant" && (base === "ɹ" || base === "ɻ")))
    return "liquid";
  if (manner === "approximant") return "glide";
  if (place === "bilabial" || place === "labiodental" || place === "labiovelar") return "labial";
  if (place === "glottal" || place === "pharyngeal") return "laryngeal";
  if (place === "velar" || place === "uvular") return "dorsal";
  if ((manner === "fricative" || manner === "affricate" || manner === "lateralFricative") &&
    (place === "alveolar" || place === "postalveolar" || place === "retroflex" || place === "palatal"))
    return "sibilant";
  if (place === "palatal") return manner === "stop" || manner === "nasal" ? "coronal" : "dorsal";
  return "coronal";
}

/** Classify an IPA phoneme string. Results are cached. */
export function classify(ph: string): PhonInfo {
  const hit = cache.get(ph);
  if (hit) return hit;
  const info = classifyRaw(ph);
  cache.set(ph, info);
  return info;
}

function classifyRaw(ph: string): PhonInfo {
  const s = ph.normalize("NFD").replace(/͡|͜/g, "");
  const secondary: Secondary[] = [];
  let core = "";
  for (const ch of s) {
    switch (ch) {
      case "ː":
      case ":":
        if (!secondary.includes("long")) secondary.push("long");
        break;
      case "ˑ":
        break;
      case "̃":
        secondary.push("nasal");
        break;
      case "ʰ":
        secondary.push("aspirated");
        break;
      case "ʷ":
        secondary.push("labialized");
        break;
      case "ʲ":
        secondary.push("palatalized");
        break;
      case "ʼ":
      case "'":
        secondary.push("ejective");
        break;
      case "ˤ":
      case "̴":
        secondary.push("pharyngealized");
        break;
      case "ⁿ":
      case "ᵐ":
      case "ᵑ":
        secondary.push("prenasalized");
        break;
      case "ʱ":
      case "̤":
        secondary.push("breathy");
        break;
      case "̥":
      case "̊":
        secondary.push("voiceless");
        break;
      case "̩":
      case "̍":
        secondary.push("syllabic");
        break;
      case "̧": // cedilla: ç decomposes to c + U+0327 under NFD
        if (core.endsWith("c")) core = core.slice(0, -1) + "ç";
        break;
      case "ˈ": // stress and syllable marks are not part of a segment
      case "ˌ":
      case ".":
        break;
      case "̪": // dental
      case "̚": // unreleased
      case "̆":
      case "̞":
      case "̝":
      case "̠":
      case "̟":
        break;
      default:
        core += ch;
    }
  }
  // Doubled consonant letters = geminate.
  const chars = [...core];
  if (chars.length === 2 && chars[0] === chars[1]) {
    core = chars[0];
    secondary.push("long");
  }
  const cs = [...core];
  const first = cs[0] ?? "";
  // Vowels (possibly diphthong-like sequences: take the first).
  if (VOW[first] && !(cs.length > 1 && CONS[cs[1]] && !VOW[cs[1]])) {
    const [height, back, round] = VOW[first];
    return {
      ph,
      base: first,
      vowel: true,
      known: true,
      place: "palatal",
      manner: "approximant",
      voiced: true,
      group: "glide",
      height,
      back,
      round,
      secondary,
    };
  }
  // Prenasalised written with a leading nasal: "mb", "nd", "ŋg".
  if (cs.length === 2 && (cs[0] === "m" || cs[0] === "n" || cs[0] === "ŋ") && CONS[cs[1]] && CONS[cs[1]][1] === "stop") {
    secondary.push("prenasalized");
    cs.shift();
  }
  let base = cs.join("");
  let place: Place = "alveolar";
  let manner: Manner = "stop";
  let voiced = false;
  let known = false;
  if (cs.length >= 2 && CONS[cs[0]] && CONS[cs[0]][1] === "stop" && AFFRICATE_SECOND.has(cs[1])) {
    const second = CONS[cs[1]];
    place = second[0] === "labiodental" ? "labiodental" : second[0];
    manner = "affricate";
    voiced = CONS[cs[0]][2];
    base = cs[0] + cs[1];
    known = true;
  } else if (CONS[first]) {
    [place, manner, voiced] = CONS[first];
    base = first;
    known = true;
  } else {
    base = core || ph;
  }
  return {
    ph,
    base,
    vowel: false,
    known,
    place,
    manner,
    voiced,
    group: groupOf(place, manner, base),
    height: 0,
    back: 0,
    round: false,
    secondary,
  };
}

export const isVowel = (ph: string): boolean => classify(ph).vowel;

/** Marks that may appear in IPA transcriptions but are not phonemes (stress, syllable breaks, spaces). */
export function isSegment(ph: string): boolean {
  return !/^[\sˈˌ.\-‿|‖]*$/.test(ph);
}

/** The phoneme with secondary articulations removed. */
export const baseOf = (ph: string): string => classify(ph).base;

const PLACE_POS: Record<Place, number> = {
  bilabial: 0,
  labiodental: 1,
  dental: 2,
  alveolar: 3,
  postalveolar: 4,
  retroflex: 4.5,
  palatal: 5,
  velar: 6,
  labiovelar: 5.5,
  uvular: 7,
  pharyngeal: 8,
  glottal: 9,
};

const MANNER_CLASS: Record<Manner, number> = {
  stop: 0,
  implosive: 0.6,
  click: 1.4,
  affricate: 0.7,
  fricative: 1.4,
  lateralFricative: 1.8,
  nasal: 2.2,
  trill: 3,
  tap: 3,
  lateral: 3.2,
  approximant: 3.6,
};

export function placePos(p: Place): number {
  return PLACE_POS[p];
}

/**
 * Articulatory distance between two phonemes (0 = identical). Roughly:
 * one step of manner/place ≈ 0.5–1, voicing 0.7, a vowel/consonant mismatch ≥ 4.
 */
export function phonDistance(a: string, b: string): number {
  if (a === b) return 0;
  const A = classify(a);
  const B = classify(b);
  let d = 0;
  if (A.vowel !== B.vowel) {
    // Glides are close to their vowels; glottals are "empty" consonants.
    const v = A.vowel ? A : B;
    const c = A.vowel ? B : A;
    d = 5;
    if (c.base === "j" && v.height <= 1 && v.back === 0) d = 1.6;
    else if (c.base === "w" && v.height <= 1 && v.back === 2) d = 1.6;
    else if (c.group === "laryngeal") d = 3.2;
    else if (c.group === "glide") d = 2.6;
    return d + secondaryDistance(A, B);
  }
  if (A.vowel) {
    d += Math.abs(A.height - B.height) * 0.45;
    d += Math.abs(A.back - B.back) * 0.7;
    if (A.round !== B.round) d += 0.6;
  } else {
    d += Math.min(3, Math.abs(PLACE_POS[A.place] - PLACE_POS[B.place]) * 0.45);
    d += Math.abs(MANNER_CLASS[A.manner] - MANNER_CLASS[B.manner]) * 0.55;
    if (A.voiced !== B.voiced) d += 0.6;
    if (A.group !== B.group) d += 0.35;
  }
  return d + secondaryDistance(A, B);
}

function secondaryDistance(A: PhonInfo, B: PhonInfo): number {
  let d = 0;
  for (const s of A.secondary) if (!B.secondary.includes(s)) d += 0.45;
  for (const s of B.secondary) if (!A.secondary.includes(s)) d += 0.45;
  return d;
}

/** Sort key for "phonetic" (Brahmic-grammarian) ordering: vowels, then stops by place, then sonorants, sibilants, laryngeals. */
export function phoneticOrderKey(ph: string): number {
  const p = classify(ph);
  const sec = p.secondary.length * 0.01 + (p.secondary.includes("long") ? 0.05 : 0);
  if (p.vowel) return p.height * 0.1 + p.back * 0.01 + (p.round ? 0.005 : 0) + sec;
  const mannerRank: Record<Manner, number> = {
    stop: 0,
    implosive: 0,
    click: 0,
    affricate: 0,
    nasal: 0,
    fricative: 2,
    lateralFricative: 2,
    trill: 1,
    tap: 1,
    lateral: 1,
    approximant: 1,
  };
  const g = p.group;
  let tier = mannerRank[p.manner];
  if (g === "laryngeal") tier = 3;
  // Varga order: velar, palatal, retroflex, dental, labial
  const vargaPlace: Record<Place, number> = {
    velar: 0,
    uvular: 0.5,
    labiovelar: 4.5,
    palatal: 1,
    postalveolar: 1.2,
    retroflex: 2,
    dental: 3,
    alveolar: 3.1,
    bilabial: 4,
    labiodental: 4.2,
    pharyngeal: 5,
    glottal: 5.5,
  };
  const within = p.manner === "nasal" ? 0.8 : p.manner === "affricate" ? 0.2 : p.voiced ? 0.4 : 0;
  return 1 + tier * 10 + vargaPlace[p.place] + within * 0.1 + (p.secondary.includes("aspirated") ? 0.02 : 0) + sec;
}

/** Rough frequency weight of a sound cross-linguistically (used to give common sounds simpler glyphs). */
export function commonness(ph: string): number {
  const p = classify(ph);
  let c = 1 - p.secondary.length * 0.25;
  if (p.vowel) {
    if (p.base === "a" || p.base === "i" || p.base === "u") c += 0.6;
    else if (p.base === "e" || p.base === "o") c += 0.4;
  } else {
    if ("tnkmslrpj".includes(p.base)) c += 0.5;
    if (p.place === "uvular" || p.place === "pharyngeal" || p.manner === "click") c -= 0.4;
  }
  return c;
}

/** Glyph-friendly label for a phoneme (as given). */
export function label(ph: string): string {
  return ph;
}
