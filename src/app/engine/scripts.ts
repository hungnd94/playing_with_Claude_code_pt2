/**
 * Native-script rendering helpers for the UI: which script a language was
 * written in at a year, and cached SVG for words, texts and charts.
 */
import type { History, Id } from "../../history/types";
import type { Script as SScript } from "../../script/types";
import { renderWordSVG, renderTextSVG, scriptChartSVG, evolutionTableSVG, familyTreeSVG } from "../../script/svg";
import { entryAt } from "./query";

/** Script id used by the culture speaking `lang` at `year` (-1 = unwritten). */
export function scriptForLanguage(h: History, lang: Id, year: number): Id {
  const L = h.languages[lang];
  if (!L) return -1;
  const C = h.cultures[L.culture];
  if (!C) return -1;
  const y = L.ended >= 0 ? Math.min(year, L.ended - 1) : year;
  const e = entryAt(C.scripts, Math.max(y, L.born));
  return e && e.year <= Math.max(y, L.born) ? e.script : -1;
}

export function scriptData(h: History, id: Id): SScript | null {
  const s = h.scripts[id];
  return s && s.data && typeof s.data === "object" ? (s.data as SScript) : null;
}

const cache = new Map<string, string>();
function cached(key: string, f: () => string): string {
  let v = cache.get(key);
  if (v === undefined) {
    try {
      v = f();
    } catch (e) {
      console.warn("script render failed", e);
      v = "";
    }
    if (cache.size > 2000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** Cache key prefix per History (ids are only unique within one world). */
let worldTag = 0;
const tags = new WeakMap<History, number>();
function tag(h: History): number {
  let t = tags.get(h);
  if (t === undefined) tags.set(h, (t = ++worldTag));
  return t;
}

export function wordSVG(h: History, script: Id, phonemes: string[], size = 30): string {
  const s = scriptData(h, script);
  if (!s || !phonemes.length) return "";
  return cached(`${tag(h)}w${script}:${size}:${phonemes.join(".")}`, () => renderWordSVG(s, phonemes, { size, title: "" }));
}

export function textSVG(h: History, script: Id, words: string[][], size = 26): string {
  const s = scriptData(h, script);
  if (!s || !words.length) return "";
  return cached(`${tag(h)}t${script}:${size}:${words.map((w) => w.join(".")).join("|")}`, () => renderTextSVG(s, words, { size }));
}

/** Concrete theme colours for SVG generated as strings (CSS variables are not usable there). */
export interface InkTheme {
  ink: string;
  label: string;
  rule: string;
}

export function inkTheme(): InkTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, d: string): string => cs.getPropertyValue(k).trim() || d;
  return { ink: v("--glyph", "#1f160c"), label: v("--ink-3", "#6b5a45"), rule: v("--rule-2", "#b9a989") };
}

export function chartSVG(h: History, script: Id, size = 34, t: InkTheme = inkTheme(), columns = 8): string {
  const s = scriptData(h, script);
  if (!s) return "";
  return cached(`${tag(h)}c${script}:${size}:${columns}:${t.ink}${t.label}${t.rule}`, () =>
    scriptChartSVG(s, { size, color: t.ink, labelColor: t.label, ruleColor: t.rule, columns }),
  );
}

/** Glyph evolution table across a lineage of scripts (ancestor first). */
export function evolutionSVG(h: History, ids: Id[], size = 30, t: InkTheme = inkTheme()): string {
  const list = ids.map((i) => scriptData(h, i)).filter((s): s is SScript => !!s);
  if (list.length < 2) return "";
  const headings = ids.filter((i) => scriptData(h, i)).map((i) => `${h.scripts[i].name} (${h.scripts[i].born})`);
  return cached(`${tag(h)}e${ids.join(",")}:${size}:${t.ink}${t.label}`, () =>
    evolutionTableSVG(list, { size, color: t.ink, labelColor: t.label, ruleColor: t.rule, headings, maxRows: 24, layout: "rows" }),
  );
}

/** Family tree of scripts, each node with a few glyphs in its own hand. */
export function scriptTreeSVG(h: History, ids: Id[], t: InkTheme = inkTheme()): string {
  const list = ids.map((i) => scriptData(h, i)).filter((s): s is SScript => !!s);
  if (!list.length) return "";
  const labels: Record<string, string> = {};
  for (const i of ids) {
    const d = scriptData(h, i);
    if (d) labels[d.id] = `${h.scripts[i].name} (${h.scripts[i].born})`;
  }
  return cached(`${tag(h)}f${ids.join(",")}:${t.ink}${t.label}`, () => familyTreeSVG(list, { color: t.ink, labelColor: t.label, lineColor: t.rule, labels, size: 24 }));
}
