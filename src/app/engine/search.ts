/**
 * Fuzzy search over the narrative's search index: diacritic-insensitive,
 * prefix and word-prefix matches first, then in-order subsequences; ties
 * broken by the entity's importance.
 */
import type { SearchEntry } from "../../narrative/types";

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ʼʾʿ'’`]/g, "")
    .replace(/[þ]/g, "th")
    .replace(/[ð]/g, "dh")
    .replace(/[ŋ]/g, "ng")
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[ł]/g, "l")
    .replace(/[ß]/g, "ss")
    .replace(/[ı]/g, "i")
    .toLowerCase();
}

export interface Indexed {
  e: SearchEntry;
  keys: string[];
}

export function buildIndex(entries: SearchEntry[]): Indexed[] {
  return entries.map((e) => ({ e, keys: [e.label, ...e.alt].filter(Boolean).map(fold) }));
}

function scoreKey(key: string, q: string): number {
  if (key === q) return 1000;
  if (key.startsWith(q)) return 800 - key.length;
  const wi = key.indexOf(" " + q);
  if (wi >= 0) return 600 - wi;
  const ii = key.indexOf(q);
  if (ii >= 0) return 400 - ii;
  // Subsequence with gap penalty.
  let k = 0, gaps = 0, last = -1;
  for (let i = 0; i < key.length && k < q.length; i++) {
    if (key[i] === q[k]) {
      if (last >= 0 && i - last > 1) gaps += i - last - 1;
      last = i;
      k++;
    }
  }
  if (k < q.length) return -1;
  return 200 - gaps * 6 - key.length * 0.5;
}

export function search(index: Indexed[], query: string, limit = 40): { e: SearchEntry; via: string | null }[] {
  const q = fold(query.trim());
  if (!q) return index.slice().sort((a, b) => b.e.weight - a.e.weight).slice(0, limit).map((x) => ({ e: x.e, via: null }));
  const out: { e: SearchEntry; s: number; via: string | null }[] = [];
  for (const x of index) {
    let best = -1, bi = 0;
    for (let i = 0; i < x.keys.length; i++) {
      const s = scoreKey(x.keys[i], q) - (i > 0 ? 30 : 0);
      if (s > best) {
        best = s;
        bi = i;
      }
    }
    if (best < 0) continue;
    out.push({ e: x.e, s: best + Math.log10(1 + Math.max(0, x.e.weight)) * 25, via: bi > 0 ? (x.e.alt[bi - 1] ?? null) : null });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit).map(({ e, via }) => ({ e, via }));
}
