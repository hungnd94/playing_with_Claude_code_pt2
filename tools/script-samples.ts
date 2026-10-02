// Sample inventories, romanisation and random words for script demos and benchmarks.
import type { Rng } from "../src/core/rng";
import type { Inventory } from "../src/script";

export const INVENTORIES: Record<string, Inventory> = {
  semitic: {
    consonants: ["ʔ", "b", "t", "θ", "dʒ", "ħ", "x", "d", "ð", "r", "z", "s", "ʃ", "sˤ", "dˤ", "tˤ", "ʕ", "ɣ", "f", "q", "k", "l", "m", "n", "h", "w", "j"],
    vowels: ["a", "i", "u", "aː", "iː", "uː"],
  },
  indic: {
    consonants: ["k", "kʰ", "g", "gʱ", "ŋ", "tʃ", "tʃʰ", "dʒ", "ɲ", "ʈ", "ʈʰ", "ɖ", "ɳ", "t", "tʰ", "d", "n", "p", "pʰ", "b", "m", "j", "r", "l", "v", "ʃ", "s", "h"],
    vowels: ["a", "aː", "i", "iː", "u", "uː", "e", "o"],
  },
  polynesian: { consonants: ["p", "t", "k", "ʔ", "m", "n", "ŋ", "f", "v", "h", "r", "l"], vowels: ["a", "e", "i", "o", "u", "aː", "eː", "iː", "oː", "uː"] },
  germanic: {
    consonants: ["p", "b", "t", "d", "k", "g", "f", "v", "θ", "ð", "s", "z", "ʃ", "x", "h", "m", "n", "ŋ", "l", "r", "w", "j"],
    vowels: ["i", "e", "a", "o", "u", "y", "ø", "ɛ", "ɔ", "iː", "eː", "aː", "oː", "uː"],
  },
  bantu: {
    consonants: ["p", "b", "t", "d", "k", "g", "mb", "nd", "ŋg", "m", "n", "ɲ", "ŋ", "f", "v", "s", "z", "ʃ", "h", "l", "j", "w", "tʃ", "dʒ"],
    vowels: ["a", "e", "i", "o", "u"],
  },
  caucasian: {
    consonants: ["p", "pʼ", "b", "t", "tʼ", "d", "k", "kʼ", "g", "q", "qʼ", "ts", "tsʼ", "tʃ", "tʃʼ", "dʒ", "s", "z", "ʃ", "ʒ", "x", "ɣ", "χ", "h", "m", "n", "l", "r", "w", "j"],
    vowels: ["a", "e", "i", "o", "u"],
  },
  japonic: { consonants: ["k", "g", "s", "z", "t", "d", "n", "h", "b", "p", "m", "j", "r", "w"], vowels: ["a", "i", "u", "e", "o"] },
  small: { consonants: ["p", "t", "k", "m", "n", "s", "l", "j", "w"], vowels: ["a", "i", "u"] },
  nasal: {
    consonants: ["p", "t", "k", "b", "d", "g", "m", "n", "ŋ", "s", "ʃ", "h", "l", "r", "j", "w"],
    vowels: ["a", "e", "i", "o", "u", "ə", "ã", "ẽ", "õ"],
  },
};

const ROMAN: Record<string, string> = {
  ʔ: "ʼ", θ: "th", ð: "dh", ʃ: "sh", ʒ: "zh", dʒ: "j", tʃ: "ch", ħ: "ḥ", ʕ: "ʻ", ɣ: "gh", x: "kh", χ: "qh", ŋ: "ng", ɲ: "ny",
  ʈ: "ṭ", ɖ: "ḍ", ɳ: "ṇ", sˤ: "ṣ", dˤ: "ḍ", tˤ: "ṭ", j: "y", "aː": "ā", "iː": "ī", "uː": "ū", "eː": "ē", "oː": "ō", ə: "ë",
  ɛ: "è", ɔ: "ò", ø: "ö", y: "ü", ã: "ã", ẽ: "ẽ", õ: "õ", ts: "ts", "tsʼ": "tsʼ", ŋg: "ngg",
};
export const romanize = (w: string[]): string => {
  const s = w.map((p) => ROMAN[p] ?? p.replace("ʰ", "h").replace("ʱ", "h")).join("");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Random words with (C)V(C) syllables drawn from an inventory. */
export function randomWords(inv: Inventory, rng: Rng, n: number): string[][] {
  const out: string[][] = [];
  const plainV = inv.vowels.filter((v) => !v.includes("ː") && v.normalize("NFD").length === 1);
  for (let i = 0; i < n; i++) {
    const w: string[] = [];
    const syl = rng.int(1, 3);
    for (let k = 0; k < syl; k++) {
      if (k > 0 || rng.chance(0.85)) w.push(rng.pick(inv.consonants));
      w.push(rng.chance(0.8) ? rng.pick(plainV.length ? plainV : inv.vowels) : rng.pick(inv.vowels));
      if (rng.chance(0.3)) w.push(rng.pick(inv.consonants));
    }
    out.push(w);
  }
  return out;
}

