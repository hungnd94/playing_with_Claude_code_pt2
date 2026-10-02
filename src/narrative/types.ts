/**
 * Contract between the narrative engine (which writes about the world) and the
 * UI (which renders what it writes). Articles are structured rich text — never
 * HTML strings — so the UI can make every name a link, every year a timeline
 * jump, and every native word a hoverable gloss.
 */
import type { Emblem, Utterance, WName } from "../history/types";

export type EntityKind =
  | "world"
  | "settlement"
  | "polity"
  | "person"
  | "dynasty"
  | "culture"
  | "language"
  | "script"
  | "religion"
  | "deity"
  | "myth"
  | "war"
  | "battle"
  | "wonder"
  | "work"
  | "tradeRoute"
  | "disaster"
  | "feature"
  | "age"
  | "event"
  | "year";

/** Reference to an entity. For "year", id is the year; for "world", id is 0. */
export interface Ref {
  kind: EntityKind;
  id: number;
}

export type Inline =
  | string
  | { t: "link"; ref: Ref; text: string }
  /** Italic — glosses, titles of works, foreign words. */
  | { t: "em"; text: string }
  | { t: "strong"; text: string }
  /** A native-language name: shown romanised in italics; hover shows IPA, gloss, etymology; may show native script. */
  | { t: "native"; name: WName }
  /** A year — clicking moves the timeline there. `text` overrides the default rendering (e.g. "c. 312"). */
  | { t: "year"; year: number; text?: string };

export type Rich = Inline[];

export type Figure =
  | { kind: "emblem"; emblem: Emblem; size?: "small" | "large" }
  /** A small map focused on an entity at a year (territory, battle site, route, range of a culture…). */
  | { kind: "map"; focus: Ref; year: number }
  /** Time series, e.g. population of a city or area of a realm. */
  | { kind: "chart"; yLabel: string; series: { label: string; years: number[]; values: number[] }[] }
  /** Tree diagram: family tree of a person/dynasty, language family, script family, religion lineage. */
  | { kind: "tree"; root: Ref; relation: "family" | "dynasty" | "language" | "script" | "religion" | "culture" }
  /** A word written in a native script (phonemes) or the script's full chart if `word` is omitted. */
  | { kind: "script"; script: number; word?: string[]; caption?: string }
  /** IPA consonant & vowel charts of a language. */
  | { kind: "phonemes"; language: number }
  /** Comparative word list across languages. */
  | { kind: "cognates"; languages: number[]; concepts: string[] };

export type Block =
  | { t: "p"; content: Rich; dropCap?: boolean }
  | { t: "h"; level: 2 | 3; text: string }
  /** A sentence in a native language with interlinear gloss and translation. */
  | { t: "utterance"; utterance: Utterance; attribution?: Rich }
  /** A literary/myth passage set apart (e.g. an excerpt of an epic, a creation myth). */
  | { t: "quote"; content: Rich[]; attribution?: Rich }
  | { t: "list"; items: Rich[]; ordered?: boolean }
  | { t: "table"; head: string[]; rows: Rich[][]; caption?: string }
  | { t: "figure"; figure: Figure; caption?: Rich };

export interface InfoRow {
  label: string;
  value: Rich;
}

export interface Article {
  ref: Ref;
  /** Display title, e.g. "Kešdavar" or "The War of the Salt Marshes". */
  title: string;
  /** Native name shown beneath the title (with IPA and gloss). */
  native?: WName;
  /** Short description, e.g. "City on the Velm, capital of the Kingdom of Ashkar". */
  subtitle?: string;
  emblem?: Emblem;
  infobox: InfoRow[];
  blocks: Block[];
  seeAlso?: Ref[];
}

export interface ChronicleEntry {
  event: number;
  year: number;
  importance: number;
  text: Rich;
  /** True when the people involved were not yet literate: told as legend. */
  legendary: boolean;
  cell: number;
}

export interface SearchEntry {
  ref: Ref;
  /** Primary label (current romanised or English name). */
  label: string;
  /** Other names: older names, names in other languages, English titles. */
  alt: string[];
  /** Short type description, e.g. "city", "kingdom", "river", "king". */
  type: string;
  /** Rough importance for ranking. */
  weight: number;
}
