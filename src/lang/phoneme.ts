/**
 * Phonemes and their articulatory features.
 *
 * Phonemes are plain IPA strings ("p", "tʃ", "kʷ", "pʰ", "tsʼ", "aː", "ã").
 * Words are `string[]` of such phonemes. Every phoneme the engine ever
 * produces is generated from the feature table below, so the strings are
 * canonical: a phoneme can be turned into features and back losslessly.
 *
 * Conventions: plain ASCII "g" is used for the voiced velar stop; the
 * combining tilde (U+0303) marks nasal vowels and comes before the length
 * mark "ː"; aspiration is "ʰ" (voiceless) or "ʱ" (breathy, on voiced stops);
 * ejectives use "ʼ"; labialisation "ʷ".
 */

export const PLACES = [
  "bilabial",
  "labiodental",
  "dental",
  "alveolar",
  "postalveolar",
  "retroflex",
  "alveolopalatal",
  "palatal",
  "velar",
  "labiovelar",
  "uvular",
  "pharyngeal",
  "glottal",
] as const;
export type Place = (typeof PLACES)[number];

export const MANNERS = [
  "stop",
  "affricate",
  "fricative",
  "nasal",
  "trill",
  "tap",
  "lateral",
  "latfricative",
  "lataffricate",
  "approximant",
] as const;
export type Manner = (typeof MANNERS)[number];

export interface ConsonantFeatures {
  kind: "C";
  place: Place;
  manner: Manner;
  voice: boolean;
  /** Aspirated (voiceless "ʰ") or breathy-voiced ("ʱ"). */
  asp: boolean;
  ejective: boolean;
  /** Labialised ("ʷ"). */
  lab: boolean;
}

export interface VowelFeatures {
  kind: "V";
  /** 0 close … 6 open. */
  height: number;
  /** 0 front, 1 central, 2 back. */
  back: number;
  round: boolean;
  long: boolean;
  nasal: boolean;
}

export type Features = ConsonantFeatures | VowelFeatures;

const NASAL_MARK = "̃";
const LONG_MARK = "ː";

// [ipa, place, manner, voiced]
const BASE_CONSONANTS: [string, Place, Manner, boolean][] = [
  ["p", "bilabial", "stop", false],
  ["b", "bilabial", "stop", true],
  ["t", "alveolar", "stop", false],
  ["d", "alveolar", "stop", true],
  ["ʈ", "retroflex", "stop", false],
  ["ɖ", "retroflex", "stop", true],
  ["c", "palatal", "stop", false],
  ["ɟ", "palatal", "stop", true],
  ["k", "velar", "stop", false],
  ["g", "velar", "stop", true],
  ["q", "uvular", "stop", false],
  ["ɢ", "uvular", "stop", true],
  ["ʔ", "glottal", "stop", false],
  ["pf", "labiodental", "affricate", false],
  ["ts", "alveolar", "affricate", false],
  ["dz", "alveolar", "affricate", true],
  ["tʃ", "postalveolar", "affricate", false],
  ["dʒ", "postalveolar", "affricate", true],
  ["ʈʂ", "retroflex", "affricate", false],
  ["ɖʐ", "retroflex", "affricate", true],
  ["tɕ", "alveolopalatal", "affricate", false],
  ["dʑ", "alveolopalatal", "affricate", true],
  ["tɬ", "alveolar", "lataffricate", false],
  ["ɸ", "bilabial", "fricative", false],
  ["β", "bilabial", "fricative", true],
  ["f", "labiodental", "fricative", false],
  ["v", "labiodental", "fricative", true],
  ["θ", "dental", "fricative", false],
  ["ð", "dental", "fricative", true],
  ["s", "alveolar", "fricative", false],
  ["z", "alveolar", "fricative", true],
  ["ʃ", "postalveolar", "fricative", false],
  ["ʒ", "postalveolar", "fricative", true],
  ["ʂ", "retroflex", "fricative", false],
  ["ʐ", "retroflex", "fricative", true],
  ["ɕ", "alveolopalatal", "fricative", false],
  ["ʑ", "alveolopalatal", "fricative", true],
  ["ç", "palatal", "fricative", false],
  ["ʝ", "palatal", "fricative", true],
  ["x", "velar", "fricative", false],
  ["ɣ", "velar", "fricative", true],
  ["χ", "uvular", "fricative", false],
  ["ʁ", "uvular", "fricative", true],
  ["ħ", "pharyngeal", "fricative", false],
  ["ʕ", "pharyngeal", "fricative", true],
  ["h", "glottal", "fricative", false],
  ["ɦ", "glottal", "fricative", true],
  ["ɬ", "alveolar", "latfricative", false],
  ["ɮ", "alveolar", "latfricative", true],
  ["m", "bilabial", "nasal", true],
  ["n", "alveolar", "nasal", true],
  ["ɳ", "retroflex", "nasal", true],
  ["ɲ", "palatal", "nasal", true],
  ["ŋ", "velar", "nasal", true],
  ["ɴ", "uvular", "nasal", true],
  ["r", "alveolar", "trill", true],
  ["ʀ", "uvular", "trill", true],
  ["ɾ", "alveolar", "tap", true],
  ["ɽ", "retroflex", "tap", true],
  ["l", "alveolar", "lateral", true],
  ["ɭ", "retroflex", "lateral", true],
  ["ʎ", "palatal", "lateral", true],
  ["j", "palatal", "approximant", true],
  ["w", "labiovelar", "approximant", true],
  ["ʋ", "labiodental", "approximant", true],
  ["ɹ", "alveolar", "approximant", true],
  ["ɰ", "velar", "approximant", true],
];

// [ipa, height, back, round]
const BASE_VOWELS: [string, number, number, boolean][] = [
  ["i", 0, 0, false],
  ["y", 0, 0, true],
  ["ɨ", 0, 1, false],
  ["ʉ", 0, 1, true],
  ["ɯ", 0, 2, false],
  ["u", 0, 2, true],
  ["ɪ", 1, 0, false],
  ["ʏ", 1, 0, true],
  ["ʊ", 1, 2, true],
  ["e", 2, 0, false],
  ["ø", 2, 0, true],
  ["ɘ", 2, 1, false],
  ["ɵ", 2, 1, true],
  ["ɤ", 2, 2, false],
  ["o", 2, 2, true],
  ["ə", 3, 1, false],
  ["ɛ", 4, 0, false],
  ["œ", 4, 0, true],
  ["ɜ", 4, 1, false],
  ["ʌ", 4, 2, false],
  ["ɔ", 4, 2, true],
  ["æ", 5, 0, false],
  ["ɐ", 5, 1, false],
  ["a", 6, 1, false],
  ["ɑ", 6, 2, false],
  ["ɒ", 6, 2, true],
];

const FEATURES = new Map<string, Features>();
const BY_KEY = new Map<string, string>();

function cKey(f: Omit<ConsonantFeatures, "kind">): string {
  return `C|${f.place}|${f.manner}|${+f.voice}|${+f.asp}|${+f.ejective}|${+f.lab}`;
}
function vKey(f: Omit<VowelFeatures, "kind">): string {
  return `V|${f.height}|${f.back}|${+f.round}|${+f.long}|${+f.nasal}`;
}

function register(ipa: string, f: Features): void {
  FEATURES.set(ipa, f);
  const k = f.kind === "C" ? cKey(f) : vKey(f);
  if (!BY_KEY.has(k)) BY_KEY.set(k, ipa);
}

(function buildTables() {
  for (const [ipa, place, manner, voice] of BASE_CONSONANTS) {
    const obstruentStop = manner === "stop" || manner === "affricate" || manner === "lataffricate";
    const dorsal = place === "velar" || place === "uvular";
    for (const lab of [false, true]) {
      if (lab && !(dorsal && (manner === "stop" || manner === "fricative" || manner === "nasal"))) continue;
      for (const asp of [false, true]) {
        if (asp && !obstruentStop) continue;
        if (asp && place === "glottal") continue;
        for (const ejective of [false, true]) {
          if (ejective && (voice || asp)) continue;
          if (ejective && !(obstruentStop || (manner === "fricative" && (place === "alveolar" || place === "postalveolar")))) continue;
          if (ejective && place === "glottal") continue;
          const s = ipa + (lab ? "ʷ" : "") + (asp ? (voice ? "ʱ" : "ʰ") : "") + (ejective ? "ʼ" : "");
          register(s, { kind: "C", place, manner, voice, asp, ejective, lab });
        }
      }
    }
  }
  for (const [ipa, height, back, round] of BASE_VOWELS) {
    for (const nasal of [false, true]) {
      for (const long of [false, true]) {
        const s = ipa + (nasal ? NASAL_MARK : "") + (long ? LONG_MARK : "");
        register(s, { kind: "V", height, back, round, long, nasal });
      }
    }
  }
})();

const ALIASES = new Map<string, Features | undefined>();

/** Features of a phoneme, or undefined for unknown strings. */
export function features(p: string): Features | undefined {
  const f = FEATURES.get(p);
  if (f) return f;
  if (ALIASES.has(p)) return ALIASES.get(p);
  // Accept a few alternative spellings (IPA script g, NFC-composed nasal vowels).
  const alt = FEATURES.get(p.replace(/ɡ/g, "g").normalize("NFD"));
  ALIASES.set(p, alt);
  return alt;
}

/** Canonical phoneme for a feature bundle, or null if the combination does not exist. */
export function phonemeFor(f: Features): string | null {
  const k = f.kind === "C" ? cKey(f) : vKey(f);
  return BY_KEY.get(k) ?? null;
}

/** Apply a partial feature change to a phoneme; null if the result is not a valid phoneme. */
export function modify(p: string, patch: Partial<ConsonantFeatures> | Partial<VowelFeatures>): string | null {
  const f = features(p);
  if (!f) return null;
  const nf = { ...f, ...patch } as Features;
  if (nf.kind !== f.kind) return null;
  return phonemeFor(nf);
}

export function isKnown(p: string): boolean {
  return features(p) !== undefined;
}

const VOWEL_SET = new Set<string>();
const NONVOWEL_SET = new Set<string>();
export function isVowel(p: string): boolean {
  if (VOWEL_SET.has(p)) return true;
  if (NONVOWEL_SET.has(p)) return false;
  const v = features(p)?.kind === "V";
  (v ? VOWEL_SET : NONVOWEL_SET).add(p);
  return v;
}
export function isConsonant(p: string): boolean {
  return !isVowel(p);
}

export function cf(p: string): ConsonantFeatures | null {
  const f = features(p);
  return f && f.kind === "C" ? f : null;
}
export function vf(p: string): VowelFeatures | null {
  const f = features(p);
  return f && f.kind === "V" ? f : null;
}

export function isStop(p: string): boolean {
  return cf(p)?.manner === "stop";
}
export function isAffricate(p: string): boolean {
  const m = cf(p)?.manner;
  return m === "affricate" || m === "lataffricate";
}
export function isFricative(p: string): boolean {
  const m = cf(p)?.manner;
  return m === "fricative" || m === "latfricative";
}
export function isNasal(p: string): boolean {
  return cf(p)?.manner === "nasal";
}
export function isLiquid(p: string): boolean {
  const m = cf(p)?.manner;
  return m === "trill" || m === "tap" || m === "lateral" || p === "ɹ";
}
export function isRhotic(p: string): boolean {
  const m = cf(p)?.manner;
  return m === "trill" || m === "tap" || p === "ɹ" || p === "ʁ";
}
export function isGlide(p: string): boolean {
  const f = cf(p);
  return !!f && f.manner === "approximant" && p !== "ɹ";
}
export function isObstruent(p: string): boolean {
  const m = cf(p)?.manner;
  return m === "stop" || m === "affricate" || m === "fricative" || m === "latfricative" || m === "lataffricate";
}
export function isSonorant(p: string): boolean {
  return isVowel(p) || (!!cf(p) && !isObstruent(p));
}
export function isSibilant(p: string): boolean {
  const f = cf(p);
  if (!f) return false;
  if (f.manner !== "fricative" && f.manner !== "affricate") return false;
  return f.place === "alveolar" || f.place === "postalveolar" || f.place === "retroflex" || f.place === "alveolopalatal";
}
export function isLabial(p: string): boolean {
  const pl = cf(p)?.place;
  return pl === "bilabial" || pl === "labiodental";
}
export function isVelar(p: string): boolean {
  return cf(p)?.place === "velar";
}
export function isCoronal(p: string): boolean {
  const pl = cf(p)?.place;
  return pl === "dental" || pl === "alveolar" || pl === "postalveolar" || pl === "retroflex" || pl === "alveolopalatal";
}
export function isFrontVowel(p: string): boolean {
  const f = vf(p);
  return !!f && f.back === 0;
}
export function isLongVowel(p: string): boolean {
  return !!vf(p)?.long;
}

/** Sonority scale: 1 voiceless stop … 8 vowel. */
export function sonority(p: string): number {
  const f = features(p);
  if (!f) return 0;
  if (f.kind === "V") return 9;
  switch (f.manner) {
    case "stop":
      return f.voice ? 2 : 1;
    case "affricate":
    case "lataffricate":
      return f.voice ? 2.5 : 1.5;
    case "fricative":
    case "latfricative":
      return f.voice ? 3.5 : 3;
    case "nasal":
      return 5;
    case "tap":
    case "trill":
      return 6;
    case "lateral":
      return 6.5;
    case "approximant":
      return 7;
  }
}

/** Short vowel quality of a vowel (drops length and nasality). */
export function vowelQuality(p: string): string {
  const f = vf(p);
  if (!f) return p;
  return phonemeFor({ ...f, long: false, nasal: false }) ?? p;
}
export function lengthen(p: string): string {
  return modify(p, { long: true }) ?? p;
}
export function shorten(p: string): string {
  return modify(p, { long: false }) ?? p;
}

const PLACE_POS: Record<Place, number> = {
  bilabial: 0,
  labiodental: 1,
  dental: 2,
  alveolar: 2.6,
  postalveolar: 3.3,
  retroflex: 3.6,
  alveolopalatal: 3.8,
  palatal: 4.5,
  velar: 6,
  labiovelar: 6.2,
  uvular: 7,
  pharyngeal: 8,
  glottal: 9,
};

const PLACE_GROUP: Record<Place, number> = {
  bilabial: 0,
  labiodental: 0,
  labiovelar: 0,
  dental: 1,
  alveolar: 1,
  postalveolar: 1,
  retroflex: 1,
  alveolopalatal: 1,
  palatal: 2,
  velar: 2,
  uvular: 2,
  pharyngeal: 3,
  glottal: 3,
};

const MANNER_GROUP: Record<Manner, number> = {
  stop: 0,
  affricate: 1,
  lataffricate: 1.4,
  fricative: 2,
  latfricative: 2.5,
  nasal: 4,
  tap: 5,
  trill: 5.3,
  lateral: 5.8,
  approximant: 6.6,
};

/**
 * Perceptual/articulatory distance between two phonemes, used for nearest-phoneme
 * mapping when borrowing. Consonant↔vowel distances are large.
 */
export function phonemeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const fa = features(a);
  const fb = features(b);
  if (!fa || !fb) return 100;
  if (fa.kind === "V" && fb.kind === "V") {
    return (
      Math.abs(fa.height - fb.height) * 0.55 +
      Math.abs(fa.back - fb.back) * 0.8 +
      (fa.round !== fb.round ? 0.7 : 0) +
      (fa.long !== fb.long ? 0.35 : 0) +
      (fa.nasal !== fb.nasal ? 0.5 : 0)
    );
  }
  if (fa.kind === "C" && fb.kind === "C") {
    return (
      Math.abs(PLACE_POS[fa.place] - PLACE_POS[fb.place]) * 0.25 +
      (PLACE_GROUP[fa.place] !== PLACE_GROUP[fb.place] ? 1.2 : 0) +
      Math.abs(MANNER_GROUP[fa.manner] - MANNER_GROUP[fb.manner]) * 0.55 +
      (fa.voice !== fb.voice ? 0.6 : 0) +
      (fa.asp !== fb.asp ? 0.4 : 0) +
      (fa.ejective !== fb.ejective ? 0.5 : 0) +
      (fa.lab !== fb.lab ? 0.45 : 0)
    );
  }
  // Glides are close to their vowels.
  const c = fa.kind === "C" ? a : b;
  const v = fa.kind === "V" ? fa : (fb as VowelFeatures);
  if (c === "j" && v.height <= 1 && v.back === 0) return 1.2;
  if (c === "w" && v.height <= 1 && v.back === 2) return 1.2;
  return 20;
}

/** Every canonical phoneme the engine knows. */
export function allPhonemes(): string[] {
  return [...FEATURES.keys()];
}

/** Human-readable description, e.g. "voiceless velar stop", "long close front unrounded vowel". */
export function describePhoneme(p: string): string {
  const f = features(p);
  if (!f) return "unknown sound";
  if (f.kind === "V") {
    const h = ["close", "near-close", "close-mid", "mid", "open-mid", "near-open", "open"][f.height];
    const b = ["front", "central", "back"][f.back];
    return `${f.long ? "long " : ""}${f.nasal ? "nasal " : ""}${h} ${b} ${f.round ? "rounded" : "unrounded"} vowel`;
  }
  const manner =
    f.manner === "latfricative"
      ? "lateral fricative"
      : f.manner === "lataffricate"
        ? "lateral affricate"
        : f.manner === "lateral"
          ? "lateral approximant"
          : f.manner;
  const mods = [f.ejective ? "ejective" : "", f.asp ? (f.voice ? "breathy-voiced" : "aspirated") : "", f.lab ? "labialised" : ""]
    .filter(Boolean)
    .join(" ");
  const voice = f.manner === "nasal" || f.manner === "approximant" || f.manner === "lateral" || f.manner === "trill" || f.manner === "tap" ? "" : f.voice ? "voiced " : "voiceless ";
  return `${mods ? mods + " " : ""}${f.ejective ? "" : voice}${f.place} ${manner}`.replace(/\s+/g, " ").trim();
}
