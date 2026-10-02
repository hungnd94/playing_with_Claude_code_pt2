/**
 * Mini-grammar: realise small semantic clauses as native sentences with a
 * Leipzig-style interlinear gloss and an English translation. Used for
 * mottoes ("Iron Endures"), proverbs and inscriptions.
 */
import type { Rng } from "../core/rng";
import { CONCEPT_BY_ID, english3sg, englishPast, englishPlural } from "./concepts";
import { joinMorphs } from "./morphology";
import { ipaPhrase, romanizeWord } from "./orthography";
import type { AffixKind, Language, Name, Word } from "./types";
import { capitalize } from "./util";

export interface NP {
  /** Concept id of the head noun or pronoun ("wolf", "we", …). Ignored if `name` is given. */
  head?: string;
  /** A proper name as head ("Kešdavar built this wall"). */
  name?: Name;
  adj?: string[];
  plural?: boolean;
  def?: boolean;
  /** Indefinite singular in the English translation ("a small fire"). */
  indef?: boolean;
  /** Numeral or quantifier concept ("three", "hundred", "all"). */
  num?: string;
  /** Demonstrative ("this" / "that"). */
  dem?: "this" | "that";
  /** Possessor: "blood of kings". */
  poss?: NP;
}

export type Relation = "to" | "in" | "from" | "with" | "for";

export interface Clause {
  subject?: NP;
  verb?: string;
  object?: NP;
  oblique?: { rel: Relation; np: NP };
  tense?: "present" | "past" | "future";
  imperative?: boolean;
  negative?: boolean;
  /** A second clause joined by "and". */
  and?: Clause;
}

/** A verbless phrase: coordinated noun phrases ("Iron and Faith") or adjectives ("Strong and True"). */
export interface Phrase {
  nps?: NP[];
  adjectives?: string[];
}

export interface Sentence {
  lang: string;
  /** Words as phoneme arrays (for native-script rendering). */
  words: Word[];
  /** Romanised native text, capitalised and punctuated. */
  text: string;
  /** Native line with morpheme boundaries (interlinear line 1). */
  segmented: string;
  /** Leipzig gloss line (interlinear line 2). */
  gloss: string;
  /** Free English translation (interlinear line 3). */
  translation: string;
  ipa: string;
  /** The three interlinear lines, column-aligned (monospace). */
  interlinear: [string, string, string];
}

interface Morph {
  form: Word;
  gloss: string;
  affix: boolean;
}
type Token = Morph[];

const PRON: Record<string, { p: number; pl: boolean; en: [string, string] }> = {
  I: { p: 1, pl: false, en: ["I", "me"] },
  you: { p: 2, pl: false, en: ["you", "you"] },
  he: { p: 3, pl: false, en: ["he", "him"] },
  we: { p: 1, pl: true, en: ["we", "us"] },
  "you.pl": { p: 2, pl: true, en: ["you", "you"] },
  they: { p: 3, pl: true, en: ["they", "them"] },
};

const GLOSS: Partial<Record<AffixKind, string>> = {
  pl: "PL", def: "DEF", nom: "NOM", acc: "ACC", gen: "GEN", dat: "DAT", loc: "LOC", all: "ALL", abl: "ABL", ins: "INS",
  prs: "PRS", pst: "PST", fut: "FUT", imp: "IMP", neg: "NEG", "1sg": "1SG", "2sg": "2SG", "3sg": "3SG", "1pl": "1PL", "2pl": "2PL", "3pl": "3PL",
  agent: "AGT", fem: "F", dim: "DIM", aug: "AUG",
};

const REL_CASE: Record<Relation, AffixKind> = { to: "all", in: "loc", from: "abl", with: "ins", for: "dat" };

function rootGloss(c: string): string {
  if (PRON[c]) return `${PRON[c].p}${PRON[c].pl ? "PL" : "SG"}`;
  return (CONCEPT_BY_ID[c]?.en ?? c).replace(/\s+/g, ".");
}

function rootMorph(lang: Language, c: string): Morph {
  return { form: lang.lexicon[c].form, gloss: rootGloss(c), affix: false };
}

function affixMorph(lang: Language, kind: AffixKind): Morph | null {
  const a = lang.morphology.affixes[kind];
  if (!a || a.form.length === 0) return null;
  return { form: a.form, gloss: GLOSS[kind] ?? kind.toUpperCase(), affix: true };
}

/** Attach an inflection to a token or produce a particle token. */
function inflect(lang: Language, tok: Token, kind: AffixKind, out: { before: Token[]; after: Token[] }): Token {
  const a = lang.morphology.affixes[kind];
  const m = affixMorph(lang, kind);
  if (!a || !m) return tok;
  if (a.pos === "suffix") return [...tok, m];
  if (a.pos === "prefix") return [m, ...tok];
  if (a.pos === "before") out.before.push([{ ...m, affix: false }]);
  else out.after.push([{ ...m, affix: false }]);
  return tok;
}

type NPRole = "subj" | "obj" | "gen" | Relation;

function realizeNP(lang: Language, np: NP, role: NPRole): Token[] {
  const mo = lang.morphology;
  const pron = np.head && PRON[np.head] ? np.head : null;
  const particles = { before: [] as Token[], after: [] as Token[] };
  let head: Token;
  if (np.name) head = np.name.words.length ? [{ form: np.name.words[0], gloss: np.name.roman.split(" ")[0], affix: false }] : [];
  else head = [rootMorph(lang, np.head ?? "people")];
  if (!pron && !np.name && np.plural) head = inflect(lang, head, "pl", particles);
  if (!pron && !np.name && np.def && mo.articles) head = inflect(lang, head, "def", particles);
  // case / adposition
  const caseKind: AffixKind | null = role === "subj" ? "nom" : role === "obj" ? "acc" : role === "gen" ? "gen" : REL_CASE[role];
  const adp = { before: [] as Token[], after: [] as Token[] };
  if (caseKind) {
    const a = mo.affixes[caseKind];
    if (a && a.form.length) {
      if (a.pos === "suffix" || a.pos === "prefix") head = inflect(lang, head, caseKind, particles);
      else inflect(lang, head, caseKind, adp);
    }
  }
  // modifiers
  const mods: Token[] = [];
  if (np.dem) mods.push([rootMorph(lang, np.dem)]);
  if (np.num) mods.push([rootMorph(lang, np.num)]);
  for (const a of np.adj ?? []) mods.push([rootMorph(lang, a)]);
  let core: Token[] = mo.adjOrder === "AN" ? [...mods, ...particles.before, head, ...particles.after] : [...particles.before, head, ...particles.after, ...mods];
  if (np.poss) {
    const poss = realizeNP(lang, np.poss, "gen");
    core = mo.genOrder === "GN" ? [...poss, ...core] : [...core, ...poss];
  }
  return [...adp.before, ...core, ...adp.after];
}

function personKey(np: NP | undefined): AffixKind {
  if (!np) return "3sg";
  if (np.head && PRON[np.head]) {
    const p = PRON[np.head];
    return `${p.p}${p.pl ? "pl" : "sg"}` as AffixKind;
  }
  return np.plural ? "3pl" : "3sg";
}

function realizeVerb(lang: Language, c: Clause): Token[] {
  const mo = lang.morphology;
  const particles = { before: [] as Token[], after: [] as Token[] };
  let v: Token = [rootMorph(lang, c.verb ?? "be")];
  if (c.imperative) v = inflect(lang, v, "imp", particles);
  else {
    const t: AffixKind = c.tense === "past" ? "pst" : c.tense === "future" ? "fut" : "prs";
    v = inflect(lang, v, t, particles);
    if (mo.agreement) v = inflect(lang, v, personKey(c.subject), particles);
  }
  if (c.negative) v = inflect(lang, v, "neg", particles);
  return [...particles.before, v, ...particles.after];
}

function realizeClause(lang: Language, c: Clause): Token[] {
  const mo = lang.morphology;
  const V = realizeVerb(lang, c);
  const O = c.object ? realizeNP(lang, c.object, "obj") : [];
  const X = c.oblique ? realizeNP(lang, c.oblique.np, c.oblique.rel) : [];
  if (c.imperative) {
    const OV = mo.wordOrder === "SOV" || mo.wordOrder === "OVS";
    const vp = OV ? [...O, ...X, ...V] : [...V, ...O, ...X];
    return vp;
  }
  const subjPron = c.subject?.head && PRON[c.subject.head];
  const drop = subjPron && mo.proDrop && mo.agreement;
  const S = c.subject && !drop ? realizeNP(lang, c.subject, "subj") : [];
  let out: Token[];
  switch (mo.wordOrder) {
    case "SOV":
      out = [...S, ...X, ...O, ...V];
      break;
    case "SVO":
      out = [...S, ...V, ...O, ...X];
      break;
    case "VSO":
      out = [...V, ...S, ...O, ...X];
      break;
    case "VOS":
      out = [...V, ...O, ...X, ...S];
      break;
    case "OVS":
      out = [...O, ...V, ...S, ...X];
      break;
  }
  if (c.and) out = [...out, [rootMorph(lang, "and")], ...realizeClause(lang, c.and)];
  return out;
}

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

function enNP(np: NP, role: "subj" | "obj"): string {
  if (np.name) return np.name.roman;
  const head = np.head ?? "people";
  if (PRON[head]) return PRON[head].en[role === "subj" ? 0 : 1];
  const c = CONCEPT_BY_ID[head];
  const noun = np.plural ? englishPlural(head) : c?.en ?? head;
  const words: string[] = [];
  if (np.dem) words.push(np.plural ? (np.dem === "this" ? "these" : "those") : np.dem);
  else if (np.def) words.push("the");
  else if (np.indef && !np.plural && !c?.mass && !np.num) words.push(/^[aeiou]/.test((np.adj?.[0] ? CONCEPT_BY_ID[np.adj[0]]?.en : noun) ?? noun) ? "an" : "a");
  if (np.num) {
    if ((np.num === "hundred" || np.num === "thousand") && !np.def && !np.dem) words.push("a");
    words.push(CONCEPT_BY_ID[np.num]?.en ?? np.num);
  }
  for (const a of np.adj ?? []) words.push(CONCEPT_BY_ID[a]?.en ?? a);
  words.push(noun);
  if (np.poss) words.push("of", enNP(np.poss, "obj"));
  return words.join(" ");
}

function enVerb(c: Clause): string {
  const v = c.verb ?? "be";
  const en = CONCEPT_BY_ID[v]?.en ?? v;
  if (c.imperative) return c.negative ? `do not ${en}` : en;
  const subj = c.subject;
  const third = !subj || subj.name || !(subj.head && PRON[subj.head]) ? !subj?.plural : PRON[subj.head!].p === 3 && !PRON[subj.head!].pl;
  const firstSg = subj?.head === "I";
  if (v === "be") {
    const pres = firstSg ? "am" : third ? "is" : "are";
    const past = firstSg || third ? "was" : "were";
    if (c.tense === "past") return c.negative ? `${past} not` : past;
    if (c.tense === "future") return c.negative ? "will not be" : "will be";
    return c.negative ? `${pres} not` : pres;
  }
  if (c.tense === "past") return c.negative ? `did not ${en}` : englishPast(v);
  if (c.tense === "future") return c.negative ? `will not ${en}` : `will ${en}`;
  if (c.negative) return `${third ? "does" : "do"} not ${en}`;
  return third ? english3sg(v) : en;
}

function enClause(c: Clause): string {
  const parts: string[] = [];
  if (!c.imperative && c.subject) parts.push(enNP(c.subject, "subj"));
  parts.push(enVerb(c));
  if (c.object) parts.push(enNP(c.object, "obj"));
  if (c.oblique) parts.push(c.oblique.rel, enNP(c.oblique.np, "obj"));
  let s = parts.join(" ");
  if (c.and) s += " and " + enClause(c.and);
  return s;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function assemble(lang: Language, tokens: Token[], translation: string, punct: string): Sentence {
  const words: Word[] = [];
  const segs: string[] = [];
  const glosses: string[] = [];
  for (const tok of tokens) {
    if (!tok.length) continue;
    const j = joinMorphs(
      lang,
      tok.map((m) => ({ form: m.form, affix: m.affix })),
    );
    words.push(j.word);
    // morph romanisations (inserted material goes with the following morph)
    const segForms: string[][] = tok.map(() => []);
    let pending: string[] = [];
    j.word.forEach((p, i) => {
      const t = j.tags[i];
      if (t < 0) pending.push(p);
      else {
        if (pending.length) {
          segForms[t].push(...pending);
          pending = [];
        }
        segForms[t].push(p);
      }
    });
    if (pending.length) segForms[segForms.length - 1].push(...pending);
    const seg: string[] = [];
    const gl: string[] = [];
    tok.forEach((m, i) => {
      if (segForms[i].length === 0) return;
      seg.push(romanizeWord(lang.orthography, segForms[i]));
      gl.push(m.gloss);
    });
    segs.push(seg.join("-"));
    glosses.push(gl.join("-"));
  }
  const textWords = words.map((w) => romanizeWord(lang.orthography, w));
  const text = capitalize(textWords.join(" ")) + punct;
  const native = segs.join(" ");
  const gloss = glosses.join(" ");
  // align columns
  let l1 = "";
  let l2 = "";
  segs.forEach((s, i) => {
    const w = Math.max([...s].length, [...glosses[i]].length) + 2;
    l1 += s.padEnd(w + (s.length - [...s].length));
    l2 += glosses[i].padEnd(w);
  });
  const tr = `'${translation}'`;
  return {
    lang: lang.id,
    words,
    text,
    segmented: native,
    gloss,
    translation,
    ipa: ipaPhrase(words, lang.phonology.stress, lang.phonology),
    interlinear: [l1.trimEnd(), l2.trimEnd(), tr],
  };
}

function sentenceCase(s: string, title: boolean, punct: string): string {
  if (title) {
    const small = new Set(["the", "of", "and", "a", "an", "to", "in", "from", "with", "for", "not"]);
    return s
      .split(" ")
      .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ")
      .replace(/\bnot\b/, "Not");
  }
  return s.charAt(0).toUpperCase() + s.slice(1) + punct;
}

/** Realise a clause. `title` gives a title-case translation without final punctuation (mottoes). */
export function sentence(lang: Language, clause: Clause, opts: { title?: boolean } = {}): Sentence {
  const tokens = realizeClause(lang, clause);
  const punct = clause.imperative ? "!" : ".";
  return assemble(lang, tokens, sentenceCase(enClause(clause), !!opts.title, punct), opts.title ? "" : punct);
}

/** Realise a verbless phrase ("Iron and Faith", "Strong and True", "Blood of Kings"). */
export function phrase(lang: Language, p: Phrase, opts: { title?: boolean } = { title: true }): Sentence {
  const tokens: Token[] = [];
  const en: string[] = [];
  const andTok: Token = [rootMorph(lang, "and")];
  if (p.nps?.length) {
    p.nps.forEach((np, i) => {
      if (i > 0) tokens.push(andTok);
      tokens.push(...realizeNP(lang, np, "subj"));
      en.push(enNP(np, "subj"));
    });
  } else if (p.adjectives?.length) {
    p.adjectives.forEach((a, i) => {
      if (i > 0) tokens.push(andTok);
      tokens.push([rootMorph(lang, a)]);
      en.push(CONCEPT_BY_ID[a]?.en ?? a);
    });
  }
  const t = en.join(" and ");
  return assemble(lang, tokens, sentenceCase(t, opts.title !== false, "."), opts.title === false ? "." : "");
}

// ---------------------------------------------------------------------------
// Mottoes & proverbs
// ---------------------------------------------------------------------------

const MOTTO_SUBJECTS = ["iron", "stone", "faith", "blood", "honour", "oak", "wolf", "fire", "sea", "light", "truth", "gold", "mountain", "flame", "oath", "crown", "river", "storm", "heart", "sword"];
const MOTTO_INTRANS = ["endure", "remember", "rise", "burn", "shine", "stand", "return", "wake", "conquer", "live", "grow", "guard", "hold", "flow", "keep"];
const WE_VERBS = ["remember", "endure", "guard", "stand", "rise", "return", "conquer", "serve", "wait", "wake", "hold", "sail.v", "shine", "sing", "keep"];
const IMPERATIVES: [string, string[]][] = [
  ["guard", ["gate", "wall", "flame", "fire", "crown", "bridge", "tower", "home"]],
  ["remember", ["oath", "name", "ancestor", "sea", "dead"]],
  ["keep", ["faith", "oath", "peace", "flame"]],
  ["seek", ["truth", "light", "star", "wisdom"]],
  ["follow", ["star", "river", "sun", "wind", "banner"]],
  ["cross", ["river", "sea", "mountain"]],
  ["carry", ["flame", "banner", "light"]],
  ["serve", ["king", "god", "people"]],
  ["hold", ["gate", "bridge", "line", "wall"]],
];
const PAIRS = ["iron", "faith", "blood", "gold", "sword", "song", "sea", "stone", "fire", "salt", "bread", "honour", "law", "light", "oak", "wave", "storm", "star", "horn", "shield", "spear", "crown", "truth", "hope"];
const GEN_HEADS = ["strength", "glory", "light", "blood", "heart", "honour", "fire", "will", "wisdom", "crown", "shield", "sword", "voice", "spear"];
const GEN_POSS: [string, boolean][] = [
  ["king", true],
  ["mountain", false],
  ["sea", false],
  ["wolf", false],
  ["sun", false],
  ["ancestor", true],
  ["people", false],
  ["stone", false],
  ["oak", false],
  ["star", true],
  ["god", true],
  ["north", false],
];
const NEG_VERBS = ["fall", "yield", "bend", "forget", "sleep", "fear", "break", "die", "kneel", "fail"];
const TRANSITIVE: [string, string, string, boolean][] = [
  ["faith", "conquer", "fear.n", false],
  ["truth", "break", "chain", true],
  ["water", "break", "stone", false],
  ["light", "conquer", "night", false],
  ["love.n", "conquer", "death", false],
  ["iron", "guard", "gate", false],
  ["courage", "win", "glory", false],
  ["wisdom", "build", "wall", true],
  ["blood", "remember", "oath", false],
];
const ADJ_PAIRS: [string, string][] = [
  ["strong", "true"],
  ["bold", "free"],
  ["swift", "sure"],
  ["holy", "strong"],
  ["fair", "fierce"],
  ["wise", "bold"],
  ["silent", "strong"],
  ["free", "proud"],
  ["true", "bright"],
];

function ok(lang: Language, ...cs: string[]): boolean {
  return cs.every((c) => !!lang.lexicon[c]);
}

/** A plausible motto (house, realm, order), with interlinear gloss. */
export function motto(lang: Language, rng: Rng): Sentence {
  for (let tries = 0; tries < 20; tries++) {
    const t = rng.weighted<number>([
      [1, 3],
      [2, 2.5],
      [3, 2],
      [4, 1.5],
      [5, 1.5],
      [6, 1.5],
      [7, 1],
      [8, 1],
    ]);
    switch (t) {
      case 1: {
        const s = rng.pick(MOTTO_SUBJECTS);
        const v = rng.pick(MOTTO_INTRANS);
        if (!ok(lang, s, v)) continue;
        const mass = CONCEPT_BY_ID[s]?.mass;
        return sentence(lang, { subject: { head: s, def: !mass }, verb: v, tense: "present" }, { title: true });
      }
      case 2: {
        const v = rng.pick(WE_VERBS);
        if (!ok(lang, v)) continue;
        return sentence(lang, { subject: { head: rng.chance(0.8) ? "we" : "I" }, verb: v, tense: rng.chance(0.85) ? "present" : "future" }, { title: true });
      }
      case 3: {
        const [v, objs] = rng.pick(IMPERATIVES);
        const o = rng.pick(objs.filter((x) => lang.lexicon[x]));
        if (!o || !ok(lang, v)) continue;
        const mass = CONCEPT_BY_ID[o]?.mass;
        return sentence(lang, { verb: v, object: { head: o, def: !mass }, imperative: true }, { title: true });
      }
      case 4: {
        const [a, b] = rng.sample(PAIRS, 2);
        if (!ok(lang, a, b)) continue;
        return phrase(lang, { nps: [{ head: a }, { head: b }] });
      }
      case 5: {
        const h = rng.pick(GEN_HEADS.filter((x) => lang.lexicon[x]));
        const [p, pl] = rng.pick(GEN_POSS);
        if (!h || !ok(lang, p) || CONCEPT_BY_ID[p].pos !== "n") continue;
        return phrase(lang, { nps: [{ head: h, poss: { head: p, plural: pl, def: !pl } }] });
      }
      case 6: {
        const v = rng.pick(NEG_VERBS.filter((x) => lang.lexicon[x]));
        if (!v) continue;
        const subj: NP = rng.chance(0.55) ? { head: "we" } : { head: rng.pick(["oak", "mountain", "wolf", "stone", "tower", "wall"]), def: true };
        if (subj.head && !lang.lexicon[subj.head]) continue;
        return sentence(lang, { subject: subj, verb: v, negative: true, tense: rng.chance(0.8) ? "present" : "future" }, { title: true });
      }
      case 7: {
        const [s, v, o, pl] = rng.pick(TRANSITIVE);
        if (!ok(lang, s, v, o)) continue;
        return sentence(lang, { subject: { head: s }, verb: v, object: { head: o, plural: pl } }, { title: true });
      }
      case 8: {
        const [a, b] = rng.pick(ADJ_PAIRS);
        if (!ok(lang, a, b)) continue;
        return phrase(lang, { adjectives: [a, b] });
      }
    }
  }
  return sentence(lang, { subject: { head: "we" }, verb: "endure" }, { title: true });
}

interface ProverbFrame {
  build: (rng: Rng) => Clause;
}

const PROVERBS: ProverbFrame[] = [
  { build: (r) => ({ subject: { head: r.pick(["wolf", "bear", "eagle", "raven", "fox", "boar", "owl"]), adj: [r.pick(["old", "wise", "lonely"])], def: true }, verb: "fear", negative: true, object: { head: r.pick(["night", "storm", "winter", "wind", "shadow"]), def: true } }) },
  { build: (r) => ({ subject: { head: "water", adj: [r.pick(["slow", "still", "soft" as string].filter((x) => x !== "soft"))] }, verb: "break", object: { head: "stone", def: true } }) },
  { build: (r) => ({ subject: { head: "fire", adj: ["small"], indef: true }, verb: "burn", object: { head: r.pick(["forest", "city", "field"]), adj: ["great"], indef: true } }) },
  { build: (r) => ({ subject: { head: "river", def: true }, verb: "return", negative: true, oblique: { rel: "to", np: { head: r.pick(["mountain", "spring"]), def: true } } }) },
  { build: () => ({ subject: { head: "river", plural: true, num: "all" }, verb: "flow", oblique: { rel: "to", np: { head: "sea", def: true } } }) },
  { build: (r) => ({ subject: { head: r.pick(["gold", "silver"]) }, verb: "win", negative: true, object: { head: r.pick(["honour", "love.n", "wisdom", "truth"]) } }) },
  { build: () => ({ subject: { head: "raven", def: true }, verb: "forget", negative: true, object: { head: "face", indef: true } }) },
  { build: (r) => ({ subject: { head: "hand", plural: true, num: r.pick(["hundred", "thousand"]) }, verb: "build", object: { head: r.pick(["wall", "city", "ship", "tower"]), def: true } }) },
  { build: (r) => ({ subject: { head: "river", adj: ["deep.adj"], def: true }, verb: "flow", oblique: { rel: "in", np: { head: "silence" } }, tense: r.chance(0.2) ? "past" : "present" }) },
  { build: (r) => ({ subject: { head: "mountain", def: true }, verb: "bend", negative: true, oblique: { rel: "to", np: { head: r.pick(["wind", "storm", "rain"]), def: true } } }) },
  { build: (r) => ({ subject: { head: "sea", def: true }, verb: "give", and: { subject: { head: "sea", def: true }, verb: "take" }, tense: r.chance(0.5) ? "present" : "present" }) },
  { build: (r) => ({ subject: { head: "fisher", adj: ["silent"], def: true }, verb: "take", object: { head: "fish", adj: ["great"], def: true }, tense: r.chance(0.3) ? "future" : "present" }) },
  { build: (r) => ({ subject: { head: r.pick(["stone", "blood", "earth"]) }, verb: "remember" }) },
  { build: (r) => ({ subject: { head: "guest", indef: true }, verb: "bring", object: { head: r.pick(["rain", "wind", "news" as string].filter((x) => x !== "news")) } }) },
  { build: (r) => ({ subject: { head: r.pick(["sword", "spear", "axe"]), def: true }, verb: "sleep", and: { subject: { head: "oath", def: true }, verb: "wake" } }) },
  { build: (r) => ({ subject: { head: "child", plural: true, adj: [r.pick(["young", "small"])] }, verb: "fear", negative: true, object: { head: "wolf", def: true } }) },
  { build: (r) => ({ subject: { head: "snow", adj: ["white"] }, verb: "hold", negative: true, object: { head: r.pick(["fire", "flame"]), def: true }, oblique: undefined }) },
  { build: (r) => ({ subject: { head: r.pick(["star", "mountain"]), plural: true, def: true }, verb: "remember", negative: true, object: { head: "king", plural: true } }) },
  { build: (r) => ({ subject: { head: "salt", adj: [] }, verb: "keep", object: { head: r.pick(["meat", "fish"]) }, and: { subject: { head: "honour" }, verb: "keep", object: { head: "people", def: true } } }) },
  { build: () => ({ subject: { head: "child", def: true }, verb: "carry", object: { head: "father", poss: undefined, def: true }, tense: "future" }) },
];

function clauseConcepts(c: Clause): string[] {
  const out: string[] = [];
  const np = (n?: NP) => {
    if (!n) return;
    if (n.head) out.push(n.head);
    if (n.num) out.push(n.num);
    for (const a of n.adj ?? []) out.push(a);
    np(n.poss);
  };
  np(c.subject);
  np(c.object);
  np(c.oblique?.np);
  if (c.verb) out.push(c.verb);
  if (c.and) out.push(...clauseConcepts(c.and), "and");
  return out;
}

/** A proverb with interlinear gloss. */
export function proverb(lang: Language, rng: Rng): Sentence {
  for (let i = 0; i < 20; i++) {
    const c = rng.pick(PROVERBS).build(rng);
    if (clauseConcepts(c).every((x) => lang.lexicon[x])) return sentence(lang, c);
  }
  return sentence(lang, { subject: { head: "water" }, verb: "break", object: { head: "stone", def: true } });
}

/** A short building inscription: "<Name> built this <thing>." */
export function inscription(lang: Language, ruler: Name, thing = "wall", verb = "build"): Sentence {
  return sentence(lang, { subject: { name: ruler }, verb, object: { head: thing, dem: "this" }, tense: "past" });
}
