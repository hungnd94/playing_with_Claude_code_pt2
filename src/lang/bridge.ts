/**
 * Conversions from the language engine's rich objects to the history data
 * contracts (src/history/types.ts: WName, Utterance), plus English labels for
 * language stages ("Old Keshi", "Middle Keshi").
 *
 * Language ids: the engine's ids are strings. The simplest bridge is to create
 * languages with `id: String(historyLanguageId)` (createProtoLanguage /
 * deriveLanguage accept `opts.id`); `toWName` and `toUtterance` then recover
 * the numeric id automatically. Otherwise pass the numeric id (or a resolver).
 */
import type { Utterance, WName } from "../history/types";
import { renderEtymology, type EtymologyRenderOptions } from "./etymology";
import type { Sentence } from "./grammar";
import type { AffixKind, EtymStep, Name, NamePart } from "./types";

type LangRef = number | ((engineId: string) => number) | undefined;

function resolveLang(engineId: string, ref: LangRef): number {
  if (typeof ref === "number") return ref;
  if (typeof ref === "function") return ref(engineId);
  const n = Number(engineId);
  return Number.isFinite(n) && engineId.trim() !== "" ? n : -1;
}

/** Plain-English glosses of derivational affixes for morpheme breakdowns. */
const AFFIX_EN: Partial<Record<AffixKind, string>> = {
  place: "place",
  land: "land",
  demonym: "people of",
  adj: "of",
  dim: "little",
  aug: "great",
  agent: "one who",
  abstract: "-hood",
  fem: "she",
  patronym: "child of",
  dynasty: "kin of",
  collective: "folk",
  pl: "many",
  def: "the",
  gen: "of",
};

/** Morpheme breakdown for display: linking material is folded into the preceding morpheme. */
export function displayParts(name: Name): { roman: string; gloss: string }[] {
  const out: { roman: string; gloss: string; word: number }[] = [];
  const glossOf = (p: NamePart) => (p.role === "affix" && p.affix ? AFFIX_EN[p.affix] ?? p.gloss.toLowerCase() : p.gloss);
  for (const p of name.parts) {
    if (!p.roman) continue;
    const last = out[out.length - 1];
    if (p.role === "link" && last && last.word === p.word) {
      last.roman += p.roman;
      continue;
    }
    out.push({ roman: p.roman, gloss: p.role === "link" ? "" : glossOf(p), word: p.word });
  }
  return out.map(({ roman, gloss }) => ({ roman, gloss }));
}

export interface WNameOptions {
  /** Relabel etymology stages (e.g. by the history's current English language names). */
  label?: (step: EtymStep) => string;
  /** Maximum number of etymological stages rendered (default 4). */
  maxSteps?: number;
}

/**
 * Convert an engine `Name` into the history's `WName`.
 * `lang`: the history language id, or a resolver from engine ids; defaults to
 * `Number(name.lang)` (when languages were created with numeric-string ids).
 */
export function toWName(name: Name, lang?: LangRef, opts: WNameOptions = {}): WName {
  const out: WName = {
    roman: name.roman,
    gloss: name.gloss,
    lang: resolveLang(name.lang, lang),
    ipa: name.ipa,
    phonemes: name.phonemes.slice(),
    parts: displayParts(name),
  };
  const etym = opts.label || opts.maxSteps ? renderEtymology(name, opts as EtymologyRenderOptions) : name.etym;
  if (etym) out.etym = etym;
  return out;
}

/** Convert a mini-grammar `Sentence` (motto, proverb, inscription) into the history's `Utterance`. */
export function toUtterance(s: Sentence, lang?: LangRef): Utterance {
  return {
    lang: resolveLang(s.lang, lang),
    text: s.text,
    gloss: s.gloss,
    translation: s.translation,
    words: s.words.map((w) => w.slice()),
  };
}

/**
 * English labels for successive in-place stages of one language, oldest first:
 * 1 → ["X"], 2 → ["Old X", "X"], 3 → ["Old X", "Middle X", "X"],
 * 4 → ["Archaic X", "Old X", "Middle X", "X"], more → "Early Old X" etc.
 */
export function stageLabels(name: string, count: number): string[] {
  if (count <= 1) return [name];
  if (count === 2) return [`Old ${name}`, name];
  if (count === 3) return [`Old ${name}`, `Middle ${name}`, name];
  if (count === 4) return [`Archaic ${name}`, `Old ${name}`, `Middle ${name}`, name];
  const out = [`Archaic ${name}`, `Early Old ${name}`, `Late Old ${name}`, `Early Middle ${name}`, `Late Middle ${name}`, `Early Modern ${name}`];
  return [...out.slice(0, count - 1), name];
}
