/** Small numeric and colour helpers for the history simulation. */
import type { RGB } from "./types";

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function hsl(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHue([r, g, b]: RGB): number {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Interpolate a value from a table indexed by integer levels (fractional level allowed). */
export function levelTable(table: readonly number[], level: number): number {
  if (level <= 0) return table[0];
  if (level >= table.length - 1) return table[table.length - 1];
  const i = Math.floor(level);
  return lerp(table[i], table[i + 1], level - i);
}

/** Roman numerals for regnal numbers. */
export function roman(n: number): string {
  const vals: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of vals) while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}

/** Insert into a sorted-by-key small array (used for deterministic top-k lists). */
export function topK<T>(items: T[], k: number, score: (t: T) => number): T[] {
  return items
    .map((t, i) => ({ t, s: score(t), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, k)
    .map((x) => x.t);
}

export function remove<T>(arr: T[], x: T): void {
  const i = arr.indexOf(x);
  if (i >= 0) arr.splice(i, 1);
}

export function pairKey(a: number, b: number): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}
