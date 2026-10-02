/**
 * Regular sound change.
 *
 * A change is plain data: an explicit mapping from target phonemes (or pairs
 * of phonemes) to replacements, valid over the inventory current when it
 * applies, plus left/right environments, an optional stress condition and
 * exceptions. Application is simultaneous (environments are read from the
 * input form), so the same rule list applied to an inherited word always
 * reproduces the daughter's form — this is what makes cognates regular.
 *
 * The catalogue below generates attested kinds of change (lenition, final
 * devoicing, palatalisation, apocope, syncope, umlaut, vowel shifts, chain
 * shifts, monophthongisation, breaking, compensatory lengthening, metathesis,
 * nasalisation, rhotacism, debuccalisation, …) adapted to the language's
 * current inventory and checked against its lexicon for effect and damage.
 */
import type { Rng } from "../core/rng";
import {
  cf,
  isFrontVowel,
  isGlide,
  isLiquid,
  isNasal,
  isObstruent,
  isStop,
  isVowel,
  lengthen,
  modify,
  phonemeFor,
  vf,
  vowelQuality,
} from "./phoneme";
import { nuclei, stressMask } from "./phonology";
import type { EnvItem, SoundChange, StressRule, Word } from "./types";
import { key } from "./util";

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function tokenMatch(tok: EnvItem, p: string | undefined, stressed: boolean): boolean {
  if (Array.isArray(tok)) return p !== undefined && tok.includes(p);
  switch (tok) {
    case "#":
      return p === undefined;
    case "V":
      return p !== undefined && isVowel(p);
    case "V'":
      return p !== undefined && isVowel(p) && stressed;
    case "V-":
      return p !== undefined && isVowel(p) && !stressed;
    case "C":
      return p !== undefined && !isVowel(p);
    case "N":
      return p !== undefined && isNasal(p);
    case "NV":
      return p === undefined || !isVowel(p);
    case "NC":
      return p === undefined || isVowel(p);
    case "OBS":
      return p !== undefined && isObstruent(p);
    case "SON":
      return p !== undefined && !isVowel(p) && !isObstruent(p);
    case "FRONT":
      return p !== undefined && isFrontVowel(p);
    case "LAB": {
      const pl = p !== undefined ? cf(p)?.place : undefined;
      return pl === "bilabial" || pl === "labiodental";
    }
    case "VEL":
      return p !== undefined && cf(p)?.place === "velar";
    case "C*":
      return true;
  }
}

function matchRight(items: EnvItem[], w: Word, j: number, mask: boolean[] | null): boolean {
  let k = j;
  for (const it of items) {
    if (it === "C*") {
      while (k < w.length && !isVowel(w[k])) k++;
      continue;
    }
    if (it === "#") {
      if (k !== w.length) return false;
      continue;
    }
    if (it === "NV" || it === "NC") {
      if (k >= w.length) continue;
      if (!tokenMatch(it, w[k], false)) return false;
      k++;
      continue;
    }
    if (k >= w.length) return false;
    if (!tokenMatch(it, w[k], mask ? mask[k] : false)) return false;
    k++;
  }
  return true;
}

function matchLeft(items: EnvItem[], w: Word, j: number, mask: boolean[] | null): boolean {
  let k = j; // index of the segment just before the target
  for (let n = items.length - 1; n >= 0; n--) {
    const it = items[n];
    if (it === "C*") {
      while (k >= 0 && !isVowel(w[k])) k--;
      continue;
    }
    if (it === "#") {
      if (k !== -1) return false;
      continue;
    }
    if (it === "NV" || it === "NC") {
      if (k < 0) continue;
      if (!tokenMatch(it, w[k], false)) return false;
      k--;
      continue;
    }
    if (k < 0) return false;
    if (!tokenMatch(it, w[k], mask ? mask[k] : false)) return false;
    k--;
  }
  return true;
}

function usesStress(ch: SoundChange): boolean {
  if (ch.stress) return true;
  const has = (xs: EnvItem[]) => xs.some((x) => x === "V'" || x === "V-");
  return has(ch.left) || has(ch.right);
}

export interface Applied {
  word: Word;
  tags: number[];
}

/** Apply one change to a word. `tags` are carried along (one per phoneme). */
const NO_TAGS: number[] = [];

interface ChangeIndex {
  firsts: Set<string>;
  stress: boolean;
}
const INDEX = new WeakMap<SoundChange, ChangeIndex>();
function indexOf(ch: SoundChange): ChangeIndex {
  let ix = INDEX.get(ch);
  if (!ix) {
    ix = { firsts: new Set(Object.keys(ch.map).map((k) => k.split("+")[0])), stress: usesStress(ch) };
    INDEX.set(ch, ix);
  }
  return ix;
}

/**
 * Apply one change to a word. `tags` (one per phoneme, e.g. morpheme or
 * origin indices) are carried along when given; otherwise `tags` in the
 * result is empty.
 */
export function applyChange(ch: SoundChange, w: Word, stress: StressRule, tags?: number[]): Applied {
  const track = tags !== undefined;
  const tg = tags ?? NO_TAGS;
  if (ch.newStress) return { word: w, tags: tg };
  const ix = indexOf(ch);
  // fast reject: does any target (or first segment of a target pair) occur at all?
  if (ch.span > 0) {
    let any = false;
    for (let i = 0; i < w.length; i++)
      if (ix.firsts.has(w[i])) {
        any = true;
        break;
      }
    if (!any) return { word: w, tags: tg };
  }
  const mask = ix.stress ? stressMask(w, stress) : null;
  const out: string[] = [];
  const ot: number[] = [];
  const n = w.length;
  let did = false;
  if (ch.span === 0) {
    const ins = ch.map[""];
    if (!ins) return { word: w, tags: tg };
    for (let i = 0; i <= n; i++) {
      if (matchLeft(ch.left, w, i - 1, mask) && matchRight(ch.right, w, i, mask)) {
        const t = track ? (tg[i] ?? tg[i - 1] ?? 0) : 0;
        did = true;
        for (const p of ins) {
          out.push(p);
          if (track) ot.push(t);
        }
      }
      if (i < n) {
        out.push(w[i]);
        if (track) ot.push(tg[i]);
      }
    }
  } else {
    let i = 0;
    while (i < n) {
      if (i + ch.span <= n && ix.firsts.has(w[i])) {
        const k = ch.span === 1 ? w[i] : w[i] + "+" + w[i + 1];
        const rep = ch.map[k];
        if (rep !== undefined) {
          let ok = true;
          if (ch.stress) {
            let vi = i;
            while (vi < i + ch.span && !isVowel(w[vi])) vi++;
            if (vi < i + ch.span) {
              const st = mask ? mask[vi] : false;
              ok = ch.stress === "stressed" ? st : !st;
            }
          }
          if (ok && ch.notAfter && i > 0 && ch.notAfter.includes(w[i - 1])) ok = false;
          if (ok && matchLeft(ch.left, w, i - 1, mask) && matchRight(ch.right, w, i + ch.span, mask)) {
            for (let r = 0; r < rep.length; r++) {
              out.push(rep[r]);
              if (track) ot.push(tg[i + Math.min(r, ch.span - 1)]);
            }
            did = true;
            i += ch.span;
            continue;
          }
        }
      }
      out.push(w[i]);
      if (track) ot.push(tg[i]);
      i++;
    }
  }
  if (!did) return { word: w, tags: tg };
  // Never erase a word's last vowel.
  if (!out.some((p) => isVowel(p)) && w.some((p) => isVowel(p))) return { word: w, tags: tg };
  return { word: out, tags: ot };
}

/** Apply a sequence of changes, tracking stress shifts. */
export function applyChanges(changes: SoundChange[], w: Word, stress: StressRule, tags?: number[]): Applied & { stress: StressRule } {
  let cur: Applied = { word: w, tags: tags ?? NO_TAGS };
  let st = stress;
  for (const ch of changes) {
    if (ch.newStress) {
      st = ch.newStress;
      continue;
    }
    cur = applyChange(ch, cur.word, st, tags ? cur.tags : undefined);
  }
  return { ...cur, stress: st };
}

/** Apply changes to a multi-word phoneme sequence (words separated by " "). */
export function applyChangesPhrase(changes: SoundChange[], phonemes: Word, stress: StressRule, tags?: number[]): Applied {
  const words: Word[] = [[]];
  const wt: number[][] = [[]];
  const tg = tags ?? phonemes.map((_, i) => i);
  phonemes.forEach((p, i) => {
    if (p === " ") {
      words.push([]);
      wt.push([]);
    } else {
      words[words.length - 1].push(p);
      wt[wt.length - 1].push(tg[i]);
    }
  });
  const out: string[] = [];
  const ot: number[] = [];
  words.forEach((w, i) => {
    if (i > 0) {
      out.push(" ");
      ot.push(-2);
    }
    const r = applyChanges(changes, w, stress, wt[i]);
    out.push(...r.word);
    ot.push(...r.tags);
  });
  return { word: out, tags: ot };
}

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

const TOKEN_NOTE: Record<string, string> = {
  "#": "#",
  V: "V",
  "V'": "V́",
  "V-": "V̆",
  C: "C",
  "C*": "C₀",
  N: "N",
  NV: "{C,#}",
  NC: "{V,#}",
  OBS: "[−son]",
  SON: "[+son]",
  FRONT: "[+front]",
  LAB: "[+lab]",
  VEL: "[+vel]",
};

function envNote(items: EnvItem[]): string {
  return items.map((it) => (Array.isArray(it) ? (it.length === 1 ? it[0] : `{${it.join(",")}}`) : TOKEN_NOTE[it])).join("");
}

function notation(from: string, to: string, left: EnvItem[], right: EnvItem[]): string {
  const env = left.length || right.length ? ` / ${envNote(left)}_${envNote(right)}` : "";
  return `*${from} > ${to}${env}`;
}

function listMap(pairs: [string, Word][]): { from: string; to: string } {
  const outs = pairs.map(([, o]) => (o.length ? o.join("") : "∅"));
  const same = outs.every((o) => o === outs[0]);
  return { from: pairs.map(([i]) => i.replace(/\+/g, "")).join(" "), to: same && pairs.length > 1 ? outs[0] : outs.join(" ") };
}

function makeChange(
  id: string,
  name: string,
  description: string,
  pairs: [string, Word][],
  left: EnvItem[],
  right: EnvItem[],
  extra: Partial<SoundChange> = {},
  span: 0 | 1 | 2 = 1,
): SoundChange | null {
  if (pairs.length === 0) return null;
  const map: Record<string, Word> = {};
  for (const [k, v] of pairs) map[k] = v;
  const lm = listMap(pairs);
  let from = lm.from;
  if (extra.stress === "unstressed") from = `${from}[−stress]`;
  if (extra.stress === "stressed") from = `${from}[+stress]`;
  let note = notation(span === 0 ? "∅" : from, span === 0 ? pairs[0][1].join("") : lm.to, left, right);
  if (extra.notAfter?.length) note += ` (not after ${extra.notAfter.join(" ")})`;
  return { id, name, description, notation: note, span, map, left, right, ...extra };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface ChangeCtx {
  rng: Rng;
  /** Current inventory. */
  inv: Set<string>;
  stress: StressRule;
  /** Current forms of a sample of the lexicon. */
  corpus: Word[];
  /** Template ids already used in this split. */
  used: Set<string>;
  /** Template ids used by ancestors (dampens repeats down the tree). */
  ancestral: Set<string>;
}

interface Template {
  id: string;
  weight: number | ((c: ChangeCtx) => number);
  build: (c: ChangeCtx) => SoundChange | null;
}

/** "a", "a and b", "a, b and c". */
function listText(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function mappingText(pairs: [string, Word][]): string {
  return pairs.map(([a, b]) => `${a.replace(/\+/g, "")} > ${b.join("") || "∅"}`).join(", ");
}

const has = (c: ChangeCtx, p: string) => c.inv.has(p);
const cons = (c: ChangeCtx) => [...c.inv].filter((p) => !isVowel(p));
const vows = (c: ChangeCtx) => [...c.inv].filter((p) => isVowel(p));
const shortVows = (c: ChangeCtx) => vows(c).filter((v) => !vf(v)!.long);

function feat(ps: string[], patch: Parameters<typeof modify>[1]): [string, Word][] {
  const out: [string, Word][] = [];
  for (const p of ps) {
    const q = modify(p, patch);
    if (q && q !== p) out.push([p, [q]]);
  }
  return out;
}

/** Count corpus words containing a sequence matching pred at some position. */
function count(c: ChangeCtx, pred: (w: Word, i: number) => boolean): number {
  let n = 0;
  for (const w of c.corpus) {
    for (let i = 0; i < w.length; i++)
      if (pred(w, i)) {
        n++;
        break;
      }
  }
  return n;
}

const plainStops = (c: ChangeCtx, voice: boolean) =>
  cons(c).filter((p) => {
    const f = cf(p)!;
    return f.manner === "stop" && f.voice === voice && !f.asp && !f.ejective && p !== "ʔ" && !f.lab;
  });

function lenitedFricative(p: string, rng: Rng): string | null {
  const f = cf(p)!;
  if (f.place === "bilabial") return f.voice ? (rng.chance(0.65) ? "v" : "β") : rng.chance(0.6) ? "f" : "ɸ";
  if (f.place === "alveolar") return f.voice ? "ð" : "θ";
  if (f.place === "velar") return f.voice ? "ɣ" : "x";
  if (f.place === "uvular") return f.voice ? "ʁ" : "χ";
  if (f.place === "palatal") return f.voice ? "ʝ" : "ç";
  if (f.place === "retroflex") return f.voice ? "ʐ" : "ʂ";
  return null;
}

const TEMPLATES: Template[] = [
  {
    id: "intervocalic-voicing",
    weight: 1.6,
    build: (c) => {
      let ts = plainStops(c, false);
      const withFric = c.rng.chance(0.35);
      if (withFric) ts = ts.concat(cons(c).filter((p) => ["f", "s", "θ", "x", "ʃ"].includes(p)));
      const pairs = feat(ts, { voice: true });
      return makeChange(
        "intervocalic-voicing",
        "Intervocalic voicing",
        `Voiceless stops${withFric ? " and fricatives" : ""} became voiced between vowels.`,
        pairs,
        ["V"],
        ["V"],
      );
    },
  },
  {
    id: "intervocalic-spirantization",
    weight: 1.3,
    build: (c) => {
      const vs = plainStops(c, true);
      const pairs: [string, Word][] = [];
      for (const p of vs) {
        const q = lenitedFricative(p, c.rng);
        if (q) pairs.push([p, [q]]);
      }
      const post = c.rng.chance(0.3);
      return makeChange(
        "intervocalic-spirantization",
        "Lenition of voiced stops",
        post ? "Voiced stops became fricatives after vowels." : "Voiced stops became fricatives between vowels.",
        pairs,
        ["V"],
        post ? [] : ["V"],
      );
    },
  },
  {
    id: "voiceless-spirantization",
    weight: 0.7,
    build: (c) => {
      let vs = plainStops(c, false);
      if (c.rng.chance(0.4)) vs = vs.filter((p) => p !== "p");
      const pairs: [string, Word][] = [];
      for (const p of vs) {
        const q = lenitedFricative(p, c.rng);
        if (q && q !== "ç") pairs.push([p, [q]]);
      }
      return makeChange("voiceless-spirantization", "Spirantisation", "Voiceless stops became fricatives between vowels.", pairs, ["V"], ["V"]);
    },
  },
  {
    id: "chain-shift",
    weight: (c) => (plainStops(c, true).length >= 2 && plainStops(c, false).length >= 2 ? 0.5 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      for (const p of plainStops(c, false)) {
        const q = lenitedFricative(p, c.rng);
        if (q && q !== "ç") pairs.push([p, [q]]);
      }
      for (const p of plainStops(c, true)) {
        const q = modify(p, { voice: false });
        if (q) pairs.push([p, [q]]);
      }
      let breathy = false;
      for (const p of cons(c)) {
        const f = cf(p)!;
        if (f.manner === "stop" && f.voice && f.asp) {
          pairs.push([p, [modify(p, { asp: false })!]]);
          breathy = true;
        }
      }
      return makeChange(
        "chain-shift",
        "Consonant shift",
        `In a chain shift, voiceless stops became fricatives${breathy ? ", voiced stops became voiceless and breathy stops became plain voiced" : " and voiced stops became voiceless"}, except after s.`,
        pairs,
        [],
        [],
        { notAfter: ["s"] },
      );
    },
  },
  {
    id: "final-devoicing",
    weight: (c) => (count(c, (w, i) => i === w.length - 1 && isObstruent(w[i]) && !!cf(w[i])?.voice) >= 3 ? 1.4 : 0),
    build: (c) => {
      const vs = cons(c).filter((p) => isObstruent(p) && cf(p)!.voice);
      return makeChange("final-devoicing", "Final devoicing", "Voiced obstruents became voiceless at the end of a word.", feat(vs, { voice: false, asp: false }), [], ["#"]);
    },
  },
  {
    id: "velar-palatalization",
    weight: (c) => (count(c, (w, i) => isStop(w[i]) && cf(w[i])!.place === "velar" && isFrontVowel(w[i + 1] ?? "")) >= 4 ? 1.5 : 0),
    build: (c) => {
      const style = c.rng.weighted<string>([
        ["tʃ", 0.65],
        ["ts", 0.25],
        ["c", 0.1],
      ]);
      const pairs: [string, Word][] = [];
      for (const p of cons(c)) {
        const f = cf(p)!;
        if (f.place !== "velar" || f.lab) continue;
        if (f.manner === "stop") {
          const base = style === "tʃ" ? (f.voice ? "dʒ" : "tʃ") : style === "ts" ? (f.voice ? "dz" : "ts") : f.voice ? "ɟ" : "c";
          const q = modify(base, { asp: f.asp, ejective: f.ejective });
          if (q) pairs.push([p, [q]]);
        } else if (f.manner === "fricative" && c.rng.chance(0.6)) pairs.push([p, [f.voice ? "ʝ" : "ç"]]);
      }
      return makeChange("velar-palatalization", "Velar palatalisation", "Velars were palatalised to affricates before front vowels.", pairs, [], ["FRONT"]);
    },
  },
  {
    id: "assibilation",
    weight: (c) => (count(c, (w, i) => (w[i] === "t" || w[i] === "s" || w[i] === "d") && (w[i + 1] === "i" || w[i + 1] === "iː" || w[i + 1] === "j")) >= 4 ? 1.0 : 0),
    build: (c) => {
      const v = c.rng.weighted<string>([
        ["tʃ", 0.45],
        ["ts", 0.35],
        ["sʃ", 0.2],
      ]);
      const pairs: [string, Word][] = [];
      if (v === "sʃ") {
        if (has(c, "s")) pairs.push(["s", ["ʃ"]]);
        if (has(c, "z")) pairs.push(["z", ["ʒ"]]);
      } else {
        if (has(c, "t")) pairs.push(["t", [v === "tʃ" ? "tʃ" : "ts"]]);
        if (has(c, "d")) pairs.push(["d", [v === "tʃ" ? "dʒ" : "dz"]]);
        if (v === "tʃ" && has(c, "s") && c.rng.chance(0.6)) pairs.push(["s", ["ʃ"]]);
      }
      const high = ["i", "iː", "j", "y", "yː"].filter((p) => has(c, p));
      return makeChange("assibilation", "Palatalisation before i", "Dental consonants were palatalised before high front vowels and y.", pairs, [], [high]);
    },
  },
  {
    id: "apocope",
    weight: (c) => (count(c, (w, i) => i === w.length - 1 && isVowel(w[i]) && i >= 2) > c.corpus.length * 0.25 ? 1.3 : 0.2),
    build: (c) => {
      let vs = shortVows(c);
      let which = "unstressed final vowels";
      if (c.rng.chance(0.45)) {
        const weak = vs.filter((v) => ["ə", "e", "i", "ɪ", "ɨ", "u", "ɛ"].includes(v));
        if (weak.length) {
          vs = weak;
          which = `unstressed final ${vs.join(", ")}`;
        }
      }
      return makeChange(
        "apocope",
        "Apocope",
        `Loss of ${which} after a single consonant.`,
        vs.map((v) => [v, []] as [string, Word]),
        ["V", "C"],
        ["#"],
        { stress: "unstressed" },
      );
    },
  },
  {
    id: "final-reduction",
    weight: (c) => (count(c, (w, i) => i === w.length - 1 && isVowel(w[i])) > c.corpus.length * 0.25 && !has(c, "ə") ? 1.0 : 0.2),
    build: (c) => {
      const target = c.rng.chance(0.65) ? "ə" : c.rng.pick(["e", "a"]);
      const vs = shortVows(c).filter((v) => v !== target);
      return makeChange(
        "final-reduction",
        "Final vowel reduction",
        `Unstressed final vowels merged as ${target}.`,
        vs.map((v) => [v, [target]] as [string, Word]),
        [],
        ["#"],
        { stress: "unstressed" },
      );
    },
  },
  {
    id: "unstressed-reduction",
    weight: (c) => (c.stress === "final" ? 0.3 : 0.8),
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["schwa", 0.4],
        ["raise", 0.35],
        ["akanye", 0.25],
      ]);
      if (variant === "schwa") {
        const vs = shortVows(c).filter((v) => !["ə", "i", "u"].includes(v) && vf(v)!.height >= 2);
        return makeChange("unstressed-reduction", "Vowel reduction", "Unstressed mid and low vowels were reduced to ə.", vs.map((v) => [v, ["ə"]] as [string, Word]), [], [], { stress: "unstressed" });
      }
      if (variant === "raise") {
        const pairs: [string, Word][] = [];
        if (has(c, "e") && has(c, "i")) pairs.push(["e", ["i"]]);
        if (has(c, "o") && has(c, "u")) pairs.push(["o", ["u"]]);
        if (has(c, "ɛ") && has(c, "e")) pairs.push(["ɛ", ["e"]]);
        if (has(c, "ɔ") && has(c, "o")) pairs.push(["ɔ", ["o"]]);
        return makeChange("unstressed-reduction", "Unstressed raising", "Unstressed mid vowels were raised.", pairs, [], [], { stress: "unstressed" });
      }
      const pairs: [string, Word][] = [];
      if (has(c, "o") && has(c, "a")) pairs.push(["o", ["a"]]);
      if (has(c, "ɔ") && has(c, "a")) pairs.push(["ɔ", ["a"]]);
      if (has(c, "e") && has(c, "i") && c.rng.chance(0.6)) pairs.push(["e", ["i"]]);
      return makeChange("unstressed-reduction", "Akanye", "Unstressed o merged with a.", pairs, [], [], { stress: "unstressed" });
    },
  },
  {
    id: "syncope",
    weight: (c) => (c.corpus.reduce((s, w) => s + (nuclei(w).length >= 3 ? 1 : 0), 0) > c.corpus.length * 0.15 ? 1.0 : 0.15),
    build: (c) => {
      const vs = shortVows(c).filter((v) => vf(v)!.height <= 4 || c.rng.chance(0.3));
      const nextToLiquid = c.rng.chance(0.7);
      return makeChange(
        "syncope",
        "Syncope",
        nextToLiquid ? "Unstressed vowels after the stress were lost next to sonorants." : "Unstressed vowels after the stressed syllable were lost.",
        vs.map((v) => [v, []] as [string, Word]),
        ["V'", nextToLiquid ? "SON" : "C"],
        ["C", "V"],
        { stress: "unstressed" },
      );
    },
  },
  {
    id: "vowel-raising",
    weight: 0.9,
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["long", vows(c).some((v) => vf(v)!.long) ? 1.5 : 0],
        ["merge", 0.8],
        ["nasal", 0.6],
        ["a-o", has(c, "aː") ? 1 : 0.2],
      ]);
      const pairs: [string, Word][] = [];
      if (variant === "long") {
        for (const [a, b] of [
          ["eː", "iː"],
          ["oː", "uː"],
          ["ɛː", "eː"],
          ["ɔː", "oː"],
        ])
          if (has(c, a)) pairs.push([a, [b]]);
        if (has(c, "aː") && c.rng.chance(0.5)) pairs.push(["aː", [c.rng.chance(0.6) ? "ɔː" : "ɛː"]]);
        return makeChange("vowel-raising", "Long vowel shift", "Long vowels were raised one step.", pairs, [], []);
      }
      if (variant === "a-o") {
        if (has(c, "aː")) pairs.push(["aː", [c.rng.chance(0.6) ? "oː" : "ɔː"]]);
        else if (has(c, "a") && !has(c, "ɑ")) pairs.push(["a", ["ɑ"]]);
        return makeChange("vowel-raising", "Rounding of long a", "Long a was rounded and backed.", pairs, [], []);
      }
      if (variant === "nasal") {
        for (const [a, b] of [
          ["e", "i"],
          ["o", "u"],
          ["a", c.rng.chance(0.5) ? "e" : "ɔ"],
        ])
          if (has(c, a)) pairs.push([a, [b]]);
        return makeChange("vowel-raising", "Raising before nasals", "Vowels were raised before nasal consonants.", pairs, [], ["N"]);
      }
      const mid = c.rng.chance(0.5) ? [["e", "i"]] : [["o", "u"]];
      if (c.rng.chance(0.5)) mid.push(mid[0][0] === "e" ? ["o", "u"] : ["e", "i"]);
      for (const [a, b] of mid) if (has(c, a) && has(c, b)) pairs.push([a, [b]]);
      for (const [a, b] of mid.map(([x, y]) => [x + "ː", y + "ː"])) if (has(c, a) && has(c, b)) pairs.push([a, [b]]);
      return makeChange("vowel-raising", "Raising", `Mid vowels were raised and merged with high vowels.`, pairs, [], []);
    },
  },
  {
    id: "vowel-merger",
    weight: (c) => (["ɛ", "ɔ", "ɪ", "ʊ", "ɨ", "æ", "ə", "ɯ", "ɤ", "ʌ", "ɑ"].some((v) => has(c, v)) ? 1.0 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      const cand: [string, string[]][] = [
        ["ɛ", ["e", "a"]],
        ["ɔ", ["o", "a"]],
        ["ɪ", ["i", "e"]],
        ["ʊ", ["u", "o"]],
        ["ɨ", ["i", "u", "ə"]],
        ["æ", ["a", "e"]],
        ["ə", ["a", "e", "i"]],
        ["ɯ", ["u", "ɨ", "i"]],
        ["ɤ", ["o", "ə"]],
        ["ʌ", ["a", "o"]],
        ["ɑ", ["a", "o"]],
      ];
      const avail = cand.filter(([v]) => has(c, v));
      for (const [v, targets] of c.rng.sample(avail, c.rng.int(1, 2))) {
        const t = targets.find((x) => has(c, x)) ?? targets[0];
        pairs.push([v, [t]]);
        const vl = lengthen(v);
        if (has(c, vl)) pairs.push([vl, [lengthen(t)]]);
      }
      const byTarget = new Map<string, string[]>();
      for (const [a, b] of pairs) if (!vf(a)!.long) byTarget.set(b[0], [...(byTarget.get(b[0]) ?? []), a]);
      const txt = [...byTarget].map(([t, srcs]) => `${listText(srcs)} merged with ${t}`).join("; ");
      return makeChange("vowel-merger", "Vowel merger", `The vowels ${txt}.`, pairs, [], []);
    },
  },
  {
    id: "fronting",
    weight: (c) => (has(c, "u") && !has(c, "y") ? 0.5 : 0.1),
    build: (c) => {
      const pairs: [string, Word][] = [];
      if (c.rng.chance(0.6)) {
        if (has(c, "u")) pairs.push(["u", ["y"]]);
        if (has(c, "uː")) pairs.push(["uː", ["yː"]]);
        return makeChange("fronting", "Fronting of u", "u was fronted to y.", pairs, [], []);
      }
      if (has(c, "aː")) pairs.push(["aː", ["ɛː"]]);
      else if (has(c, "a")) pairs.push(["a", ["æ"]]);
      return makeChange("fronting", "Fronting of a", "Stressed a was fronted.", pairs, [], [], { stress: "stressed" });
    },
  },
  {
    id: "unrounding",
    weight: (c) => (has(c, "y") || has(c, "ø") ? 0.9 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      for (const [a, b] of [
        ["y", "i"],
        ["yː", "iː"],
        ["ø", "e"],
        ["øː", "eː"],
        ["œ", "ɛ"],
      ])
        if (has(c, a)) pairs.push([a, [b]]);
      return makeChange("unrounding", "Unrounding", "Front rounded vowels lost their rounding.", pairs, [], []);
    },
  },
  {
    id: "umlaut",
    weight: (c) => (count(c, (w, i) => isVowel(w[i]) && (vf(w[i])!.back > 0) && w.slice(i + 1).some((p) => p === "i" || p === "j" || p === "iː")) > 8 ? 1.0 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      const aT = c.rng.chance(0.6) ? "e" : "æ";
      for (const [a, b] of [
        ["a", aT],
        ["aː", aT + "ː"],
        ["o", "ø"],
        ["oː", "øː"],
        ["u", "y"],
        ["uː", "yː"],
      ])
        if (has(c, a)) pairs.push([a, [b]]);
      const tr = ["i", "iː", "j"].filter((p) => has(c, p));
      return makeChange("umlaut", "I-umlaut", "Back vowels were fronted when i or j followed in the next syllable.", pairs, [], ["C*", tr]);
    },
  },
  {
    id: "nasal-assimilation",
    weight: (c) => (count(c, (w, i) => isNasal(w[i]) && !!w[i + 1] && isObstruent(w[i + 1]) && cf(w[i])!.place !== cf(w[i + 1])!.place) >= 3 ? 1.2 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      const nasals = cons(c).filter((p) => isNasal(p));
      for (const n of nasals)
        for (const o of cons(c).filter((p) => isObstruent(p))) {
          const pl = cf(o)!.place;
          const target = pl === "bilabial" || pl === "labiodental" ? "m" : pl === "velar" || pl === "uvular" ? "ŋ" : pl === "palatal" ? "ɲ" : "n";
          if (target !== n) pairs.push([n + "+" + o, [target, o]]);
        }
      const ch = makeChange("nasal-assimilation", "Nasal assimilation", "Nasals took the place of articulation of a following consonant.", pairs, [], [], {}, 2);
      if (ch) ch.notation = "*N > [αplace] / _C[αplace]";
      return ch;
    },
  },
  {
    id: "cluster-assimilation",
    weight: (c) => (count(c, (w, i) => isStop(w[i]) && !!w[i + 1] && isObstruent(w[i + 1]) && w[i] !== w[i + 1] && !isVowel(w[i + 1])) >= 4 ? 1.0 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      const stops = cons(c).filter((p) => isStop(p) && p !== "ʔ");
      for (const a of stops)
        for (const b of cons(c).filter((p) => isObstruent(p) && p !== a && p !== "h")) pairs.push([a + "+" + b, [b, b]]);
      const ch = makeChange("cluster-assimilation", "Cluster assimilation", "In clusters, a stop assimilated completely to the following obstruent (kt > tt).", pairs, [], [], {}, 2);
      if (ch) ch.notation = "*C₁C₂ > C₂C₂ (C₁ a stop)";
      return ch;
    },
  },
  {
    id: "degemination",
    weight: (c) => (count(c, (w, i) => !isVowel(w[i]) && w[i] === w[i + 1]) >= 3 ? 1.1 : 0),
    build: (c) => {
      const pairs: [string, Word][] = cons(c).map((p) => [p + "+" + p, [p]] as [string, Word]);
      const ch = makeChange("degemination", "Degemination", "Double consonants were simplified.", pairs, [], [], {}, 2);
      if (ch) ch.notation = "*CC > C";
      return ch;
    },
  },
  {
    id: "initial-cluster-simplification",
    weight: (c) => (count(c, (w) => w.length > 2 && !isVowel(w[0]) && !isVowel(w[1])) >= 4 ? 1.0 : 0),
    build: (c) => {
      const seen = new Map<string, [string, string]>();
      for (const w of c.corpus) if (w.length > 2 && !isVowel(w[0]) && !isVowel(w[1])) seen.set(w[0] + "+" + w[1], [w[0], w[1]]);
      const variant = c.rng.weighted<string>([
        ["stop-nasal", 1],
        ["h-son", 1],
        ["obs-obs", 1],
        ["glide", 0.6],
      ]);
      const pairs: [string, Word][] = [];
      for (const [k, [a, b]] of seen) {
        if (variant === "stop-nasal" && isStop(a) && isNasal(b)) pairs.push([k, [b]]);
        if (variant === "h-son" && (a === "h" || a === "x" || a === "ʔ") && !isObstruent(b)) pairs.push([k, [b]]);
        if (variant === "obs-obs" && isObstruent(a) && isObstruent(b) && a !== "s" && a !== "ʃ") pairs.push([k, [b]]);
        if (variant === "glide" && isGlide(b) && isObstruent(a)) pairs.push([k, [a]]);
      }
      const desc: Record<string, string> = {
        "stop-nasal": "Initial stops were lost before nasals (kn > n).",
        "h-son": "Initial h was lost before sonorants (hr > r).",
        "obs-obs": "Initial obstruent clusters were simplified.",
        glide: "Glides were lost after initial consonants.",
      };
      const ch = makeChange("initial-cluster-simplification", "Initial cluster simplification", desc[variant], pairs, ["#"], [], {}, 2);
      return ch;
    },
  },
  {
    id: "h-loss",
    weight: (c) => (has(c, "h") || has(c, "ʔ") || has(c, "ħ") || has(c, "ʕ") ? 1.0 : 0),
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["all", has(c, "h") ? 1 : 0],
        ["medial", has(c, "h") ? 0.7 : 0],
        ["glottal", has(c, "ʔ") ? 0.8 : 0],
        ["pharyngeal", has(c, "ħ") || has(c, "ʕ") ? 1.2 : 0],
      ]);
      if (variant === "pharyngeal") {
        const pairs: [string, Word][] = [];
        if (has(c, "ħ")) pairs.push(["ħ", ["h"]]);
        if (has(c, "ʕ")) pairs.push(["ʕ", c.rng.chance(0.5) ? ["ʔ"] : []]);
        return makeChange("h-loss", "Loss of pharyngeals", "Pharyngeal consonants weakened.", pairs, [], []);
      }
      if (variant === "glottal") return makeChange("h-loss", "Loss of the glottal stop", "The glottal stop disappeared.", [["ʔ", []]], [], []);
      if (variant === "medial") return makeChange("h-loss", "Intervocalic h-loss", "h was lost between vowels.", [["h", []]], ["V"], ["V"]);
      return makeChange("h-loss", "H-loss", "h was lost everywhere.", [["h", []]], [], []);
    },
  },
  {
    id: "monophthongization",
    weight: (c) => (count(c, (w, i) => isVowel(w[i]) && isGlide(w[i + 1] ?? "") && !isVowel(w[i + 2] ?? "")) >= 3 ? 1.3 : 0),
    build: (c) => {
      const long = c.rng.chance(0.65);
      const L = (v: string) => (long ? v + "ː" : v);
      const pairs: [string, Word][] = [];
      for (const v of shortVows(c)) {
        const f = vf(v)!;
        if (f.height < 2 || f.nasal) continue; // only mid and low vowels + glide
        if (has(c, "j")) pairs.push([v + "+j", [L(f.round ? "ø" : f.height >= 3 ? "e" : "i")]]);
        if (has(c, "w")) pairs.push([v + "+w", [L(f.back === 0 && !f.round ? "ø" : f.height >= 3 ? "o" : "u")]]);
      }
      return makeChange("monophthongization", "Monophthongisation", `Diphthongs became ${long ? "long " : ""}monophthongs (ai > ${L("e")}, au > ${L("o")}).`, pairs, [], ["NV"], {}, 2);
    },
  },
  {
    id: "breaking",
    weight: 0.6,
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["breaking", 1],
        ["gvs", vows(c).some((v) => v === "iː" || v === "uː") ? 1 : 0],
      ]);
      if (variant === "gvs") {
        const pairs: [string, Word][] = [];
        if (has(c, "iː")) pairs.push(["iː", ["a", "j"]]);
        if (has(c, "uː")) pairs.push(["uː", ["a", "w"]]);
        return makeChange("breaking", "Diphthongisation of long high vowels", "Long high vowels became diphthongs (iː > ai, uː > au).", pairs, [], []);
      }
      const pairs: [string, Word][] = [];
      const e = has(c, "ɛ") ? "ɛ" : "e";
      const o = has(c, "ɔ") ? "ɔ" : "o";
      if (has(c, e) && has(c, "j")) pairs.push([e, ["j", "e"]]);
      if (has(c, o) && has(c, "w")) pairs.push([o, ["w", c.rng.chance(0.5) ? "e" : "o"]]);
      return makeChange("breaking", "Breaking", "Stressed mid vowels broke into rising diphthongs in open syllables.", pairs, ["C"], ["C", "V"], { stress: "stressed" });
    },
  },
  {
    id: "compensatory-lengthening",
    weight: (c) => (count(c, (w, i) => isVowel(w[i]) && ["s", "h", "x", "r", "ɣ", "l"].includes(w[i + 1] ?? "") && !!w[i + 2] && !isVowel(w[i + 2])) >= 4 ? 1.0 : 0),
    build: (c) => {
      const set = c.rng.weighted<string[]>([
        [["s", "z"], 1],
        [["h", "x", "ɣ", "χ"], 1],
        [["r", "ɾ"], 0.8],
      ]).filter((p) => has(c, p));
      const pairs: [string, Word][] = [];
      for (const v of shortVows(c)) for (const s of set) pairs.push([v + "+" + s, [lengthen(v)]]);
      const ch = makeChange(
        "compensatory-lengthening",
        "Compensatory lengthening",
        `${listText(set)} ${set.length > 1 ? "were" : "was"} lost before consonants, lengthening the preceding vowel.`,
        pairs,
        [],
        ["C"],
        {},
        2,
      );
      if (ch) ch.notation = `*V${set.length > 1 ? `{${set.join(",")}}` : set[0]} > Vː / _C`;
      return ch;
    },
  },
  {
    id: "metathesis",
    weight: 0.25,
    build: (c) => {
      const liq = cons(c).filter((p) => isLiquid(p));
      const pairs: [string, Word][] = [];
      for (const v of shortVows(c).filter((x) => x !== "ə")) for (const l of liq) pairs.push([v + "+" + l, [l, lengthen(v)]]);
      const ch = makeChange("metathesis", "Liquid metathesis", "Vowel–liquid sequences between consonants were reversed, with lengthening (CVrC > CrVːC).", pairs, ["C"], ["C"], {}, 2);
      if (ch) ch.notation = "*CVRC > CRVːC";
      return ch;
    },
  },
  {
    id: "final-consonant-loss",
    weight: (c) => (count(c, (w, i) => i === w.length - 1 && !isVowel(w[i])) > c.corpus.length * 0.2 ? 0.9 : 0),
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["stops", 1],
        ["s", has(c, "s") ? 0.6 : 0],
        ["n", 0.4],
      ]);
      if (variant === "stops") {
        const st = cons(c).filter((p) => isStop(p) || cf(p)?.manner === "affricate");
        return makeChange("final-consonant-loss", "Loss of final stops", "Word-final stops were lost.", st.map((p) => [p, []] as [string, Word]), ["V"], ["#"]);
      }
      if (variant === "s") return makeChange("final-consonant-loss", "Loss of final s", "Word-final s was lost.", [["s", []]], ["V"], ["#"]);
      return makeChange("final-consonant-loss", "Loss of final n", "Word-final n was lost after unstressed vowels.", [["n", []]], ["V-"], ["#"]);
    },
  },
  {
    id: "nasalization",
    weight: (c) => (count(c, (w, i) => isVowel(w[i]) && isNasal(w[i + 1] ?? "") && !isVowel(w[i + 2] ?? "")) >= 5 ? 0.6 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      for (const v of vows(c)) {
        if (vf(v)!.nasal) continue;
        const nv = modify(v, { nasal: true });
        if (!nv) continue;
        for (const n of cons(c).filter((p) => isNasal(p))) pairs.push([v + "+" + n, [nv]]);
      }
      const ch = makeChange("nasalization", "Vowel nasalisation", "Vowels absorbed a following nasal before a consonant or at the end of a word.", pairs, [], ["NV"], {}, 2);
      if (ch) ch.notation = "*VN > Ṽ / _{C,#}";
      return ch;
    },
  },
  {
    id: "rhotacism",
    weight: (c) => ((has(c, "z") || has(c, "s")) && (has(c, "r") || has(c, "ɾ")) ? 0.5 : 0),
    build: (c) => {
      const r = has(c, "r") ? "r" : "ɾ";
      const src = has(c, "z") ? "z" : "s";
      return makeChange("rhotacism", "Rhotacism", `${src} became ${r} between vowels.`, [[src, [r]]], ["V"], ["V"]);
    },
  },
  {
    id: "aspirate-change",
    weight: (c) => (cons(c).some((p) => cf(p)!.asp) ? 1.2 : 0),
    build: (c) => {
      const asps = cons(c).filter((p) => cf(p)!.asp);
      const variant = c.rng.weighted<string>([
        ["fricate", 1],
        ["merge", 1],
      ]);
      const pairs: [string, Word][] = [];
      for (const p of asps) {
        const f = cf(p)!;
        if (variant === "fricate" && !f.voice && f.manner === "stop") {
          const q = lenitedFricative(modify(p, { asp: false })!, c.rng);
          if (q) pairs.push([p, [q]]);
        } else pairs.push([p, [modify(p, { asp: false })!]]);
      }
      return makeChange(
        "aspirate-change",
        variant === "fricate" ? "Spirantisation of aspirates" : "Deaspiration",
        variant === "fricate" ? "Aspirated stops became fricatives (pʰ > f); breathy stops became plain voiced." : "Aspirated stops merged with plain stops.",
        pairs,
        [],
        [],
      );
    },
  },
  {
    id: "ejective-loss",
    weight: (c) => (cons(c).some((p) => cf(p)!.ejective) ? 0.8 : 0),
    build: (c) => {
      const ejs = cons(c).filter((p) => cf(p)!.ejective);
      const toVoiced = c.rng.chance(0.3);
      const pairs = ejs.map((p) => [p, [(toVoiced ? modify(p, { ejective: false, voice: true }) : null) ?? modify(p, { ejective: false })!]] as [string, Word]);
      return makeChange("ejective-loss", "Loss of ejectives", toVoiced ? "Ejectives became voiced stops." : "Ejectives merged with plain voiceless stops.", pairs, [], []);
    },
  },
  {
    id: "glide-fortition",
    weight: (c) => (has(c, "j") || has(c, "w") ? 0.8 : 0),
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["j-initial", has(c, "j") ? 1 : 0],
        ["w-v", has(c, "w") ? 1 : 0],
        ["w-gw", has(c, "w") ? 0.5 : 0],
      ]);
      if (variant === "j-initial") {
        const t = c.rng.chance(0.6) ? "dʒ" : "ʒ";
        return makeChange("glide-fortition", "Fortition of j", `Initial j hardened to ${t}.`, [["j", [t]]], ["#"], ["V"]);
      }
      if (variant === "w-v") return makeChange("glide-fortition", "w > v", "w became v before vowels.", [["w", ["v"]]], [], ["V"]);
      return makeChange("glide-fortition", "Fortition of w", "Initial w hardened to gw.", [["w", ["g", "w"]]], ["#"], ["V"]);
    },
  },
  {
    id: "dental-fricative-loss",
    weight: (c) => (has(c, "θ") || has(c, "ð") ? 1.0 : 0),
    build: (c) => {
      const v = c.rng.weighted<string>([
        ["stop", 1],
        ["sibilant", 0.6],
        ["labial", 0.4],
      ]);
      const pairs: [string, Word][] = [];
      if (has(c, "θ")) pairs.push(["θ", [v === "stop" ? "t" : v === "sibilant" ? "s" : "f"]]);
      if (has(c, "ð")) pairs.push(["ð", [v === "stop" ? "d" : v === "sibilant" ? "z" : "v"]]);
      return makeChange("dental-fricative-loss", "Loss of dental fricatives", `Dental fricatives became ${v === "stop" ? "stops" : v === "sibilant" ? "sibilants" : "labials"}.`, pairs, [], []);
    },
  },
  {
    id: "debuccalization",
    weight: (c) => (has(c, "x") || has(c, "χ") || has(c, "s") || has(c, "f") ? 0.9 : 0),
    build: (c) => {
      const variant = c.rng.weighted<string>([
        ["x-h", has(c, "x") || has(c, "χ") ? 1 : 0],
        ["s-initial", has(c, "s") ? 0.6 : 0],
        ["s-coda", has(c, "s") ? 0.6 : 0],
        ["f-h", has(c, "f") ? 0.5 : 0],
      ]);
      if (variant === "x-h") {
        const pairs: [string, Word][] = [];
        if (has(c, "x")) pairs.push(["x", ["h"]]);
        if (has(c, "χ")) pairs.push(["χ", [has(c, "x") ? "x" : "h"]]);
        return makeChange("debuccalization", "Weakening of x", "The velar fricative weakened to h.", pairs, [], []);
      }
      if (variant === "s-initial") return makeChange("debuccalization", "Initial s > h", "Initial s before a vowel became h.", [["s", ["h"]]], ["#"], ["V"]);
      if (variant === "s-coda") return makeChange("debuccalization", "Coda s > h", "s weakened to h before consonants.", [["s", ["h"]]], ["V"], ["C"]);
      return makeChange("debuccalization", "Initial f > h", "Initial f became h.", [["f", ["h"]]], ["#"], []);
    },
  },
  {
    id: "labial-change",
    weight: (c) => (has(c, "p") && !has(c, "f") ? 0.6 : has(c, "p") ? 0.25 : 0),
    build: (c) => {
      const v = c.rng.weighted<string>([
        ["p-f", 1],
        ["p-loss", 0.25],
        ["p-h", 0.4],
      ]);
      if (v === "p-f") return makeChange("labial-change", "p > f", "p became f.", [["p", ["f"]]], [], [], { notAfter: ["s", "m"] });
      if (v === "p-h") return makeChange("labial-change", "p > h", "Initial p weakened to h.", [["p", ["h"]]], ["#"], []);
      return makeChange("labial-change", "Loss of p", "p was lost at the start of words and between vowels.", [["p", []]], ["NC"], ["V"]);
    },
  },
  {
    id: "l-vocalization",
    weight: (c) => (count(c, (w, i) => w[i] === "l" && i > 0 && isVowel(w[i - 1]) && !isVowel(w[i + 1] ?? "")) >= 4 ? 0.6 : 0),
    build: () => makeChange("l-vocalization", "L-vocalisation", "l became w after a vowel before a consonant or word end.", [["l", ["w"]]], ["V"], ["NV"]),
  },
  {
    id: "length-loss",
    weight: (c) => (vows(c).some((v) => vf(v)!.long) ? 0.7 : 0),
    build: (c) => {
      const pairs: [string, Word][] = vows(c)
        .filter((v) => vf(v)!.long)
        .map((v) => [v, [modify(v, { long: false })!]] as [string, Word]);
      const unstressed = c.rng.chance(0.4);
      return makeChange("length-loss", "Shortening", unstressed ? "Long vowels were shortened in unstressed syllables." : "Vowel length was lost.", pairs, [], [], unstressed ? { stress: "unstressed" } : {});
    },
  },
  {
    id: "open-syllable-lengthening",
    weight: (c) => (vows(c).every((v) => !vf(v)!.long) ? 0.6 : 0.2),
    build: (c) => {
      const pairs: [string, Word][] = shortVows(c)
        .filter((v) => v !== "ə" && !vf(v)!.nasal && (vf(v)!.height >= 2 || c.rng.chance(0.3)))
        .map((v) => [v, [lengthen(v)]] as [string, Word]);
      return makeChange("open-syllable-lengthening", "Open-syllable lengthening", "Stressed vowels were lengthened in open syllables.", pairs, [], ["C", "V"], { stress: "stressed" });
    },
  },
  {
    id: "stress-shift",
    weight: 0.6,
    build: (c) => {
      const opts: StressRule[] = (["initial", "penult", "final"] as StressRule[]).filter((s) => s !== c.stress);
      const ns = c.rng.weighted<StressRule>(opts.map((s) => [s, s === "initial" ? 1.4 : s === "penult" ? 1.2 : 0.5]));
      const label: Record<string, string> = { initial: "the first syllable", penult: "the penultimate syllable", final: "the last syllable" };
      return {
        id: "stress-shift",
        name: "Stress shift",
        description: `Stress moved to ${label[ns]}.`,
        notation: `stress > ${ns === "initial" ? "#σ́" : ns === "penult" ? "σ́σ#" : "σ́#"}`,
        span: 1,
        map: {},
        left: [],
        right: [],
        newStress: ns,
      };
    },
  },
  {
    id: "prothesis",
    weight: (c) => (count(c, (w) => (w[0] === "s" || w[0] === "ʃ") && !!w[1] && !isVowel(w[1])) >= 3 ? 0.8 : 0),
    build: (c) => {
      const v = ["e", "i", "ə", "a"].find((x) => has(c, x) && c.rng.chance(0.7)) ?? shortVows(c)[0];
      return makeChange("prothesis", "Prothesis", `A prothetic ${v} was added before initial s-clusters.`, [["", [v]]], ["#"], [["s", "ʃ"].filter((x) => has(c, x)), "C"], {}, 0);
    },
  },
  {
    id: "intervocalic-loss",
    weight: (c) => (cons(c).some((p) => ["β", "ð", "ɣ", "ʝ", "v"].includes(p)) ? 0.9 : has(c, "g") || has(c, "d") ? 0.25 : 0),
    build: (c) => {
      let ts = cons(c).filter((p) => ["β", "ð", "ɣ", "ʝ"].includes(p));
      if (!ts.length) ts = cons(c).filter((p) => p === "g" || p === "d" || p === "v");
      if (ts.length > 1 && c.rng.chance(0.5)) ts = [c.rng.pick(ts)];
      return makeChange("intervocalic-loss", "Intervocalic loss", `${listText(ts)} disappeared between vowels.`, ts.map((p) => [p, []] as [string, Word]), ["V"], ["V"]);
    },
  },
  {
    id: "contraction",
    weight: (c) => (count(c, (w, i) => isVowel(w[i]) && isVowel(w[i + 1] ?? "")) >= 3 ? 2.0 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      const vs = vows(c);
      for (const a of vs)
        for (const b of vs) {
          const qa = vowelQuality(a);
          const qb = vowelQuality(b);
          if (qa === qb) pairs.push([a + "+" + b, [lengthen(qa)]]);
          else if (qa === "a" && qb === "i") pairs.push([a + "+" + b, ["eː"]]);
          else if (qa === "a" && qb === "u") pairs.push([a + "+" + b, ["oː"]]);
          else if (qa === "e" && qb === "i") pairs.push([a + "+" + b, ["iː"]]);
          else if (qa === "o" && qb === "u") pairs.push([a + "+" + b, ["uː"]]);
          else if (qa === "a" && qb === "e") pairs.push([a + "+" + b, ["ɛː"]]);
          else if (qa === "a" && qb === "o") pairs.push([a + "+" + b, ["ɔː"]]);
        }
      const ch = makeChange("contraction", "Contraction", "Vowels in hiatus contracted into long vowels.", pairs, [], [], {}, 2);
      if (ch) ch.notation = "*V₁V₂ > Vː";
      return ch;
    },
  },
  {
    id: "deaffrication",
    weight: (c) => (cons(c).some((p) => cf(p)!.manner === "affricate") ? 0.8 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      for (const [a, b] of [
        ["ts", "s"],
        ["dz", "z"],
        ["tʃ", "ʃ"],
        ["dʒ", "ʒ"],
      ])
        if (has(c, a) && c.rng.chance(0.7)) pairs.push([a, [b]]);
      return makeChange("deaffrication", "Deaffrication", "Affricates became fricatives.", pairs, [], []);
    },
  },
  {
    id: "uvular-merger",
    weight: (c) => (has(c, "q") || has(c, "χ") || has(c, "ʁ") ? 0.9 : 0),
    build: (c) => {
      const glottal = c.rng.chance(0.3);
      const pairs: [string, Word][] = [];
      if (has(c, "q")) pairs.push(["q", [glottal ? "ʔ" : "k"]]);
      if (has(c, "qʼ")) pairs.push(["qʼ", ["kʼ"]]);
      if (has(c, "χ")) pairs.push(["χ", ["x"]]);
      if (has(c, "ʁ")) pairs.push(["ʁ", [has(c, "r") ? "r" : "ɣ"]]);
      return makeChange("uvular-merger", glottal ? "q > ʔ" : "Uvular merger", glottal ? "q became a glottal stop." : "Uvular consonants merged with velars.", pairs, [], []);
    },
  },
  {
    id: "rhotic-change",
    weight: (c) => (has(c, "r") || has(c, "ɾ") ? 0.6 : 0),
    build: (c) => {
      const r = has(c, "r") ? "r" : "ɾ";
      const v = c.rng.weighted<string>([
        ["uvular", 0.7],
        ["nonrhotic", 0.8],
        ["lambda", has(c, "l") ? 0.2 : 0],
      ]);
      if (v === "uvular") return makeChange("rhotic-change", "Uvular r", "r became uvular.", [[r, ["ʁ"]]], [], []);
      if (v === "lambda") return makeChange("rhotic-change", "r > l", "r merged with l.", [[r, ["l"]]], [], []);
      const pairs: [string, Word][] = shortVows(c).map((x) => [x + "+" + r, [lengthen(x)]] as [string, Word]);
      const ch = makeChange("rhotic-change", "Loss of coda r", "r was lost after vowels before a consonant or word end, lengthening the vowel.", pairs, [], ["NV"], {}, 2);
      if (ch) ch.notation = `*V${r} > Vː / _{C,#}`;
      return ch;
    },
  },
  {
    id: "labiovelar-change",
    weight: (c) => (cons(c).some((p) => cf(p)!.lab) ? 1.0 : 0),
    build: (c) => {
      const toP = c.rng.chance(0.45);
      const pairs: [string, Word][] = [];
      for (const p of cons(c).filter((x) => cf(x)!.lab)) {
        if (toP && cf(p)!.manner === "stop") pairs.push([p, [cf(p)!.voice ? "b" : "p"]]);
        else pairs.push([p, [modify(p, { lab: false })!]]);
      }
      return makeChange("labiovelar-change", toP ? "Labiovelars > labials" : "Delabialisation", toP ? "Labiovelar stops became labials (kʷ > p)." : "Labialised consonants lost their rounding.", pairs, [], []);
    },
  },
  {
    id: "retroflex-loss",
    weight: (c) => (cons(c).some((p) => cf(p)!.place === "retroflex") ? 0.8 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      for (const p of cons(c).filter((x) => cf(x)!.place === "retroflex")) {
        const f = cf(p)!;
        const q = phonemeFor({ ...f, place: f.manner === "fricative" ? "postalveolar" : "alveolar" });
        if (q) pairs.push([p, [q]]);
      }
      return makeChange("retroflex-loss", "Loss of retroflexion", "Retroflex consonants merged with dentals.", pairs, [], []);
    },
  },
  {
    id: "postnasal-voicing",
    weight: (c) => (count(c, (w, i) => isNasal(w[i]) && isStop(w[i + 1] ?? "") && !cf(w[i + 1])!.voice) >= 4 ? 0.9 : 0),
    build: (c) => makeChange("postnasal-voicing", "Post-nasal voicing", "Voiceless stops became voiced after nasals.", feat(plainStops(c, false), { voice: true }), ["N"], []),
  },
  {
    id: "glide-formation",
    weight: (c) => (count(c, (w, i) => isVowel(w[i]) && isVowel(w[i + 1] ?? "")) >= 3 ? 0.7 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      if (has(c, "i") && has(c, "j")) pairs.push(["i", ["j"]]);
      if (has(c, "u") && has(c, "w")) pairs.push(["u", ["w"]]);
      return makeChange("glide-formation", "Glide formation", "High vowels became glides before another vowel.", pairs, [], ["V"], { stress: "unstressed" });
    },
  },
  {
    id: "final-epenthesis",
    weight: (c) => (count(c, (w) => w.length > 2 && isObstruent(w[w.length - 2]) && (isLiquid(w[w.length - 1]) || isNasal(w[w.length - 1]))) >= 3 ? 0.8 : 0),
    build: (c) => {
      const v = has(c, "ə") ? "ə" : has(c, "e") ? "e" : shortVows(c)[0];
      const son = cons(c).filter((p) => isLiquid(p) || isNasal(p));
      return makeChange("final-epenthesis", "Epenthesis", `${v} was inserted to break up final obstruent–sonorant clusters (-tr > -${v === "ə" ? "ər" : v + "r"}).`, [["", [v]]], ["OBS"], [son, "#"], {}, 0);
    },
  },
  {
    id: "palatal-change",
    weight: (c) => (["ɲ", "ʎ", "c", "ɟ", "ç"].some((p) => has(c, p)) ? 0.7 : 0),
    build: (c) => {
      const pairs: [string, Word][] = [];
      if (has(c, "ʎ")) pairs.push(["ʎ", ["j"]]);
      if (has(c, "c")) pairs.push(["c", ["tʃ"]]);
      if (has(c, "ɟ")) pairs.push(["ɟ", ["dʒ"]]);
      if (has(c, "ç")) pairs.push(["ç", [has(c, "ʃ") ? "ʃ" : "h"]]);
      if (has(c, "ɲ") && c.rng.chance(0.4)) pairs.push(["ɲ", ["n"]]);
      return makeChange("palatal-change", "Depalatalisation", `Palatal consonants shifted (${mappingText(pairs)}).`, pairs, [], []);
    },
  },
  {
    id: "final-m",
    weight: (c) => (count(c, (w) => w[w.length - 1] === "m") >= 3 ? 0.5 : 0),
    build: () => makeChange("final-m", "Final m > n", "Word-final m became n.", [["m", ["n"]]], [], ["#"]),
  },
];

const TEMPLATE_BY_ID: Record<string, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// Quality assessment of a candidate change
// ---------------------------------------------------------------------------

interface CorpusStats {
  distinct: number;
  meanLen: number;
  bigClusters: number;
  tiny: number;
  monosyll: number;
}

function maxConsRun(w: Word): number {
  let m = 0;
  let r = 0;
  for (const p of w) {
    if (isVowel(p)) r = 0;
    else m = Math.max(m, ++r);
  }
  return m;
}

interface WordInfo {
  k: string;
  big: boolean;
  mono: boolean;
}
const INFO = new WeakMap<Word, WordInfo>();
function info(w: Word): WordInfo {
  let i = INFO.get(w);
  if (!i) {
    let v = 0;
    for (const p of w) if (isVowel(p)) v++;
    i = { k: key(w), big: maxConsRun(w) >= 4, mono: v <= 1 };
    INFO.set(w, i);
  }
  return i;
}

function stats(words: Word[]): CorpusStats {
  const keys = new Set<string>();
  let len = 0;
  let big = 0;
  let tiny = 0;
  let mono = 0;
  for (const w of words) {
    const i = info(w);
    keys.add(i.k);
    len += w.length;
    if (i.big) big++;
    if (w.length <= 1) tiny++;
    if (i.mono) mono++;
  }
  return { distinct: keys.size, meanLen: len / Math.max(1, words.length), bigClusters: big, tiny, monosyll: mono };
}

export interface GeneratedChanges {
  changes: SoundChange[];
  stress: StressRule;
}

/**
 * Generate an ordered list of 3–8 plausible sound changes for a split,
 * evaluated against the current forms of the lexicon (`corpus`).
 */
export function generateChanges(
  rng: Rng,
  corpus: Word[],
  inventory: string[],
  stress: StressRule,
  ancestral: string[] = [],
  opts: { min?: number; max?: number } = {},
): GeneratedChanges {
  const target = rng.weighted<number>([
    [3, 0.8],
    [4, 1.2],
    [5, 1.3],
    [6, 1.1],
    [7, 0.6],
    [8, 0.35],
  ]);
  const n = Math.max(opts.min ?? 3, Math.min(opts.max ?? 8, target));
  // Evaluate candidates on a deterministic sample of the lexicon (speed).
  const step = Math.max(1, Math.floor(corpus.length / 130));
  const sample = corpus.filter((_, i) => i % step === 0).map((w) => w.slice());
  const ctx: ChangeCtx = { rng, inv: new Set(inventory), stress, corpus: sample, used: new Set(), ancestral: new Set(ancestral) };
  for (const w of corpus) for (const p of w) ctx.inv.add(p);
  const changes: SoundChange[] = [];
  let base = stats(ctx.corpus);
  let tries = 0;
  let weights: number[] | null = null;
  while (changes.length < n && tries++ < 80) {
    weights ??= TEMPLATES.map((t) => {
      let w = typeof t.weight === "number" ? t.weight : t.weight(ctx);
      if (ctx.used.has(t.id)) w *= 0.03;
      if (ctx.ancestral.has(t.id)) w *= 0.5;
      return w;
    });
    const ti = rng.weightedIndex(weights);
    const t = TEMPLATES[ti];
    if (weights[ti] <= 0) continue;
    const ch = t.build(ctx);
    if (!ch) {
      weights[ti] *= 0.3;
      continue;
    }
    if (ch.newStress) {
      changes.push(ch);
      ctx.used.add(ch.id);
      ctx.stress = ch.newStress;
      weights = null;
      continue;
    }
    const reject = () => {
      weights![ti] *= 0.4;
    };
    if (Object.keys(ch.map).length === 0) {
      reject();
      continue;
    }
    const next = ctx.corpus.map((w) => applyChange(ch, w, ctx.stress).word);
    let changed = 0;
    for (let i = 0; i < next.length; i++) if (next[i] !== ctx.corpus[i]) changed++;
    if (changed < Math.max(2, ctx.corpus.length * 0.012)) {
      reject();
      continue;
    }
    const s = stats(next);
    const lostDistinct = base.distinct - s.distinct;
    if (
      lostDistinct > Math.max(2, ctx.corpus.length * 0.035) ||
      (s.meanLen < 3.2 && s.meanLen < base.meanLen) ||
      s.bigClusters > base.bigClusters + Math.max(1, ctx.corpus.length * 0.01) ||
      s.tiny > base.tiny + 1 ||
      (s.monosyll > ctx.corpus.length * 0.72 && s.monosyll > base.monosyll)
    ) {
      reject();
      continue;
    }
    // accept
    changes.push(ch);
    ctx.used.add(ch.id);
    ctx.corpus = next;
    base = s;
    weights = null;
    for (const out of Object.values(ch.map)) for (const p of out) ctx.inv.add(p);
    if (ch.span === 1 && ch.left.length === 0 && ch.right.length === 0 && !ch.stress && !ch.notAfter) for (const k of Object.keys(ch.map)) ctx.inv.delete(k);
  }
  // Repairs that real languages make: contract identical vowels in hiatus.
  if (TEMPLATE_BY_ID.contraction && count(ctx, (w, i) => isVowel(w[i]) && isVowel(w[i + 1] ?? "") && vowelQuality(w[i]) === vowelQuality(w[i + 1])) >= 2) {
    const ch = TEMPLATE_BY_ID.contraction.build(ctx);
    if (ch && !ctx.used.has("contraction")) {
      changes.push(ch);
      ctx.corpus = ctx.corpus.map((w) => applyChange(ch, w, ctx.stress).word);
    }
  }
  return { changes, stress: ctx.stress };
}

export function changeTemplateIds(): string[] {
  return TEMPLATES.map((t) => t.id);
}
