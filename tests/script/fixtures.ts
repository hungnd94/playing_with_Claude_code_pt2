import type { Inventory } from "../../src/script";

export const INV: Record<string, Inventory> = {
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
  caucasian: {
    consonants: ["p", "pʼ", "b", "t", "tʼ", "d", "k", "kʼ", "g", "q", "qʼ", "ts", "tsʼ", "tʃ", "tʃʼ", "dʒ", "s", "z", "ʃ", "ʒ", "x", "ɣ", "χ", "h", "m", "n", "l", "r", "w", "j"],
    vowels: ["a", "e", "i", "o", "u"],
  },
  nasal: { consonants: ["p", "t", "k", "b", "d", "g", "m", "n", "ŋ", "s", "ʃ", "h", "l", "r", "j", "w"], vowels: ["a", "e", "i", "o", "u", "ə", "ã", "ẽ", "õ"] },
  tiny: { consonants: ["p", "t", "k", "m", "n", "s"], vowels: ["a", "i", "u"] },
  clicky: { consonants: ["ǀ", "ǃ", "ʘ", "k", "kʷ", "gʷ", "ɬ", "tɬ", "ⁿd", "ᵐb", "tʃ", "ɓ", "ɗ"], vowels: ["a", "ɛ", "ɔ", "ɪ", "ʊ", "ɨ", "ãː"] },
};

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no stray '<'. */
export function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    if (between.includes("<") || between.includes(">")) return false;
    last = m.index + m[0].length;
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  const tail = xml.slice(last);
  return stack.length === 0 && !tail.includes("<") && !tail.includes(">");
}
