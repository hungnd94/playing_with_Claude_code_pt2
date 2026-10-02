/** Small helpers shared across the language engine. */
import type { Rng } from "../core/rng";

export interface Picker<T> {
  items: T[];
  cum: number[];
  total: number;
}

export function makePicker<T>(items: T[], weights: number[]): Picker<T> {
  const cum: number[] = [];
  let t = 0;
  for (let i = 0; i < items.length; i++) {
    t += Math.max(0, weights[i] ?? 0);
    cum.push(t);
  }
  return { items, cum, total: t };
}

export function pickFrom<T>(p: Picker<T>, rng: Rng): T | undefined {
  if (p.items.length === 0) return undefined;
  if (p.total <= 0) return p.items[Math.floor(rng.next() * p.items.length)];
  const r = rng.next() * p.total;
  let lo = 0;
  let hi = p.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] > r) hi = mid;
    else lo = mid + 1;
  }
  return p.items[lo];
}

/** Weighted pick from a record of weights. Iterates keys in insertion order (deterministic). */
export function pickWeighted(rng: Rng, weights: Record<string, number>): string {
  const keys = Object.keys(weights);
  return keys[rng.weightedIndex(keys.map((k) => weights[k]))];
}

export function key(seq: readonly string[]): string {
  return seq.join("+");
}

export function uniq<T>(a: T[]): T[] {
  return [...new Set(a)];
}

export function sameWord(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Deep clone of plain JSON data. */
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Strip diacritics and special letters to plain ASCII-ish English spelling. */
export function asciiFold(s: string): string {
  const special: Record<string, string> = {
    þ: "th", Þ: "Th", ð: "dh", Ð: "Dh", æ: "ae", Æ: "Ae", ø: "o", Ø: "O", œ: "oe", Œ: "Oe", ł: "l", Ł: "L",
    ı: "i", ŋ: "ng", Ŋ: "Ng", ə: "e", Ə: "E", ß: "ss", ħ: "h", ŧ: "th", đ: "dj", Đ: "Dj", ɣ: "gh", ʒ: "zh",
    ʃ: "sh", χ: "kh", ɛ: "e", ɔ: "o", ɨ: "y", ɯ: "u", ʌ: "u", ơ: "o", ư: "u", ŭ: "u",
  };
  let out = "";
  for (const ch of s) out += special[ch] ?? ch;
  return out
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['ʻʼʿʾ’`]/g, "");
}

export function capitalize(s: string): string {
  // Skip leading apostrophe-like marks when capitalising.
  const m = /^(['ʻʿʾ’]*)(.)(.*)$/su.exec(s);
  if (!m) return s;
  return m[1] + m[2].toUpperCase() + m[3];
}
