/**
 * Facts and plain sentences about a script, for encyclopedia articles and
 * viewers. Sentences are in-world (no comparison with real scripts), sober,
 * and name the script only through the caller-supplied names.
 */
import type { Direction, Family, Script, ScriptKind, Tool } from "./types";
import { toolPhrase } from "./create";

export interface ScriptFacts {
  kind: ScriptKind;
  /** "an alphabet", "an abjad", "an abugida", "a syllabary", "a featural script". */
  kindNoun: string;
  direction: Direction;
  tool: Tool;
  /** "a reed pen", "a chisel on stone"… */
  toolPhrase: string;
  family: Family;
  /** Base characters a reader must learn (letters, consonant letters + independent vowels, or syllable signs). */
  letters: number;
  consonants: number;
  vowels: number;
  syllables: number;
  /** Combining signs (vowel signs, points, feature marks, vowel killer). */
  marks: number;
  finals: number;
  /** Distinct written forms, counting fused / turned consonant forms. */
  forms: number;
  inherentVowel?: string;
  /** Short trait phrases: "a headline", "joined letters", "a stem line", "dotted letters", "word dividers". */
  traits: string[];
  /** Plain English sentences describing the script (subject: the given name, or "The script"). */
  sentences: string[];
  /** What changed from the parent script (lower-case clauses), empty for an invented script. */
  changes: string[];
  parent: string | null;
  generation: number;
  bornYear: number;
}

export interface DescribeOptions {
  /** Name used as the subject of the first sentence (default "The script"). */
  name?: string;
  /** Name of the parent script, for the lineage sentence. */
  parentName?: string;
}

const KIND_NOUN: Record<ScriptKind, string> = {
  alphabet: "an alphabet",
  abjad: "an abjad",
  abugida: "an abugida",
  syllabary: "a syllabary",
  featural: "a featural script",
};

const POS_WORD: Record<string, string> = { above: "above", below: "below", before: "before", after: "after", left: "before", right: "after", inside: "inside" };

function listWords(ws: string[]): string {
  if (ws.length <= 1) return ws[0] ?? "";
  return `${ws.slice(0, -1).join(", ")} and ${ws[ws.length - 1]}`;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const num = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** Facts and sentences about a script. */
export function describeScript(s: Script, opts: DescribeOptions = {}): ScriptFacts {
  const o = s.ortho;
  const name = opts.name ?? "The script";
  const g = s.glyphs;
  const consonants = g.filter((x) => x.role === "consonant" && x.sound !== "∅").length;
  const vowels = g.filter((x) => x.role === "vowel" && x.sound !== "∅").length;
  const syllables = g.filter((x) => x.role === "syllable").length;
  const marks = g.filter((x) => x.role === "mark").length;
  const finals = g.filter((x) => x.role === "final").length;
  let forms = consonants + vowels + syllables;
  if (s.kind === "abugida" && o.vowelMode === "fused") forms = consonants * Object.keys(o.vowelOps).length + vowels;
  if (s.kind === "abugida" && o.vowelMode === "rotate") forms = (consonants + 1) * Object.keys(o.rotations).length;
  const letters = s.kind === "syllabary" ? syllables : consonants + vowels;

  const traits: string[] = [];
  if (s.style.headline) traits.push("a headline");
  if (s.style.joins) traits.push("joined letters");
  if (s.style.stemline) traits.push("a stem line");
  const dotted = g.filter((x) => x.role !== "mark" && x.strokes.some((st) => st.dot !== undefined)).length;
  if (dotted > letters * 0.3) traits.push("dotted letters");
  if (s.style.separator !== "space") traits.push("word dividers");

  const sentences: string[] = [];
  // 1. What kind of system.
  switch (s.kind) {
    case "alphabet":
      sentences.push(`${name} is an alphabet of ${letters} letters, ${consonants} for consonants and ${vowels} for vowels.`);
      break;
    case "abjad": {
      const pointed = o.pointing ? "vowels may be marked with points above and below the letters, though in everyday writing they are mostly left out" : "vowels are left unwritten";
      const matres = Object.keys(o.matres).length ? "; long vowels are spelled with the letters of related consonants" : "";
      sentences.push(`${name} is an abjad: its ${consonants} letters write consonants, and ${pointed}${matres}.`);
      break;
    }
    case "abugida": {
      const inh = o.inherent ?? "a";
      if (o.vowelMode === "fused") {
        const n = Object.keys(o.vowelOps).filter((k) => k !== "").length;
        sentences.push(
          `${name} is an abugida. Each of its ${consonants} consonant signs is read with the vowel ${inh} unless its shape is altered: ${num(n)} forms of every consonant, made by adding a tick, a foot, a ring or a bar, stand for the other vowels and for the bare consonant.`,
        );
      } else if (o.vowelMode === "rotate") {
        const n = new Set(Object.values(o.rotations)).size;
        sentences.push(
          `${name} is an abugida in which the vowel is shown by turning the consonant's sign: each of its ${consonants} consonant shapes is written in ${num(n)} orientations${Object.keys(o.vowelOps).length ? ", some with a dot or ring beside them," : ""} and final consonants are written as small raised signs.`,
        );
      } else {
        const pos = [...new Set(Object.values(o.vowelSigns).filter((id) => id >= 0).map((id) => POS_WORD[g.find((x) => x.id === id)?.mark ?? "above"]))];
        const order = ["before", "above", "below", "after", "inside"];
        pos.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        sentences.push(
          `${name} is an abugida. Each of its ${consonants} consonant letters carries an inherent ${inh}; other vowels are written with signs ${listWords(pos)} the consonant, and ${vowels ? `${vowels} further letters write vowels at the start of a word` : "a vowel seat carries vowels at the start of a word"}.`,
        );
        if (o.virama >= 0) sentences.push(o.conjuncts === "stack" ? "Consonants meeting without a vowel are stacked one beneath the other." : "A stroke beneath a consonant silences its vowel.");
      }
      break;
    }
    case "syllabary": {
      const keys = Object.keys(o.syllables);
      const vs = new Set(keys.map((k) => k.split("|")[1])).size;
      const cs = new Set(keys.map((k) => k.split("|")[0]).filter((c) => c)).size;
      sentences.push(`${name} is a syllabary of ${syllables} signs, each standing for a whole syllable, arranged in ${cs} consonant series of ${num(vs)} vowels each.`);
      if (o.coda === "final" && finals) sentences.push("A consonant closing a syllable is written with a small sign of its own.");
      else sentences.push("A consonant closing a syllable is written with a sign whose vowel goes unspoken.");
      break;
    }
    case "featural":
      sentences.push(
        `${name} is a featural script: the basic shape of each of its ${consonants} consonant letters shows where in the mouth it is spoken, and added strokes show how; its ${vowels} vowel letters are built from a long stroke and short marks, and the letters of each syllable are gathered into a block.`,
      );
      break;
  }
  // 2. Direction and tool.
  const dir =
    s.direction === "ltr"
      ? "from left to right"
      : s.direction === "rtl"
        ? "from right to left"
        : s.style.stemline
          ? "upwards along the edge of a stone or stave"
          : "in columns from top to bottom";
  // (A change of direction or tool is told with the script's lineage below.)
  const dirChanged = s.history.some((h) => /^it (came to be written from|turned to vertical)/.test(h));
  const toolChanged = s.history.some((h) => h.startsWith("it came to be written with"));
  if (!dirChanged && !toolChanged) sentences.push(`It is written ${dir}, traditionally with ${toolPhrase(s.style.tool)}.`);
  else if (!dirChanged) sentences.push(`It is written ${dir}.`);
  else if (!toolChanged) sentences.push(`It is traditionally written with ${toolPhrase(s.style.tool)}.`);
  // 3. Visual traits.
  const tr: string[] = [];
  if (s.style.headline) tr.push("letters hang from a line drawn along the top of each word");
  if (s.style.joins) tr.push(dotted > letters * 0.3 ? "letters are joined along the line, and dots tell apart letters that share a shape" : "letters are joined along the line");
  if (s.style.stemline) tr.push("letters are notches and strokes cut across a single stem line");
  if (s.style.separator !== "space")
    tr.push(`words are divided by ${s.style.separator === "dot" ? "a dot" : s.style.separator === "colon" ? "two dots" : "an upright stroke"}`);
  if (tr.length) sentences.push(tr[0][0].toUpperCase() + tr[0].slice(1) + (tr.length > 1 ? `; ${tr.slice(1).join("; ")}` : "") + ".");

  // Lineage.
  const changes = s.history.filter((h) => !/^(derived from|borrowed from|invented as)/.test(h) && !/letter forms changed$/.test(h));
  const derived = s.history.find((h) => h.startsWith("derived from"));
  const borrowed = s.history.find((h) => h.startsWith("borrowed from"));
  const cap = (x: string): string => x[0].toUpperCase() + x.slice(1);
  if (s.parent) {
    const pn = opts.parentName ?? "an older script";
    if (borrowed) {
      const rest = borrowed.split(";").slice(1).map((x) => x.trim()).filter(Boolean);
      sentences.push(`It was borrowed from ${pn}${rest.length ? `: ${listWords(rest)}` : ""}.`);
    }
    const itClauses = changes.filter((c) => c.startsWith("it "));
    const kindClauses = changes.filter((c) => /making it an? \w+$/.test(c));
    if (!borrowed && derived) {
      const became = /became (an? \w+)/.exec(derived)?.[1];
      sentences.push(`It descends from ${pn}${became && !kindClauses.length ? ` and became ${became}` : ""}.`);
    }
    const hand = changes.filter((c) => !itClauses.includes(c) && !kindClauses.includes(c));
    const pre = "it came to be written ";
    const merged = itClauses.length === 2 && itClauses.every((c) => c.startsWith(pre)) ? [`${itClauses[0]}, and ${itClauses[1].slice(pre.length)}`] : itClauses;
    for (const c of merged) sentences.push(`${cap(c)}.`);
    for (const c of kindClauses) sentences.push(`${cap(c)}.`);
    if (hand.length) sentences.push(`In the new hand, ${listWords(hand.slice(0, 3))}.`);
  }

  return {
    kind: s.kind,
    kindNoun: KIND_NOUN[s.kind],
    direction: s.direction,
    tool: s.style.tool,
    toolPhrase: toolPhrase(s.style.tool),
    family: s.morph.family,
    letters,
    consonants,
    vowels,
    syllables,
    marks,
    finals,
    forms,
    inherentVowel: s.kind === "abugida" ? o.inherent : undefined,
    traits,
    sentences,
    changes,
    parent: s.parent,
    generation: s.generation,
    bornYear: s.bornYear,
  };
}
