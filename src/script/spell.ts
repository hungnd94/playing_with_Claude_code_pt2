/**
 * Spelling: turning a word (IPA phonemes) into orthographic clusters
 * according to the script's kind — letters with combining marks, abugida
 * syllables with vowel signs / fused forms / rotations, syllabary signs,
 * featural syllable blocks.
 */
import type { Glyph, Script, VowelOp, Form } from "./types";
import { classify, isSegment, phonDistance } from "./ipa";
import { applyVowelOps, orient } from "./marks";
import { vowelIsVertical } from "./special";
import type { Shape } from "./families";

export type FormRef = { g: number; ops?: VowelOp[]; rot?: number };

export interface Block {
  onset: number[];
  vowel: number;
  coda: number[];
}

export interface Cluster {
  base: FormRef | null;
  above: number[];
  below: number[];
  before: number[];
  after: number[];
  /** Subjoined conjunct consonants (stacked below the base). */
  sub: FormRef[];
  /** Raised small final (syllabics) or coda sign. */
  small?: boolean;
  block?: Block;
  /** The phonemes this cluster spells (for debugging/tooltips). */
  ph: string[];
}

const cl = (base: FormRef | null, ph: string[]): Cluster => ({ base, above: [], below: [], before: [], after: [], sub: [], ph });

// ---------------------------------------------------------------------------
// Glyph / form lookup
// ---------------------------------------------------------------------------

const glyphIndex = new WeakMap<Script, Map<number, Glyph>>();

export function glyphOf(s: Script, id: number): Glyph | undefined {
  let m = glyphIndex.get(s);
  if (!m) {
    m = new Map(s.glyphs.map((g) => [g.id, g]));
    glyphIndex.set(s, m);
  }
  return m.get(id);
}

const formCache = new WeakMap<Script, Map<string, Form>>();

/** Resolve a form reference (plain glyph, fused vowel form, rotated form) to strokes. */
export function formOf(s: Script, ref: FormRef): Form | null {
  const g = glyphOf(s, ref.g);
  if (!g) return null;
  if (!ref.ops?.length && ref.rot === undefined) return { strokes: g.strokes, w: g.w, h: g.h ?? 1, entry: g.entry, exit: g.exit };
  let m = formCache.get(s);
  if (!m) {
    m = new Map();
    formCache.set(s, m);
  }
  const key = `${ref.g}|${ref.ops?.join(",") ?? ""}|${ref.rot ?? ""}`;
  const hit = m.get(key);
  if (hit) return hit;
  let shape: Shape = { strokes: g.strokes, w: g.w };
  if (ref.ops?.length) shape = applyVowelOps(shape, ref.ops);
  if (ref.rot !== undefined) shape = orient(shape, ref.rot);
  const f: Form = { strokes: shape.strokes, w: shape.w, h: 1 };
  m.set(key, f);
  return f;
}

// ---------------------------------------------------------------------------
// Phoneme resolution
// ---------------------------------------------------------------------------

const nearCache = new WeakMap<Script, Map<string, string | null>>();

function nearestIn(s: Script, ph: string, keys: string[]): string | null {
  let m = nearCache.get(s);
  if (!m) {
    m = new Map();
    nearCache.set(s, m);
  }
  const k = ph + "→" + keys.length + keys[0];
  if (m.has(k)) return m.get(k)!;
  let best: string | null = null;
  let bd = Infinity;
  for (const q of keys) {
    if (q === ph) continue;
    const d = phonDistance(ph, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  m.set(k, best);
  return best;
}

function writableKeys(s: Script): string[] {
  const o = s.ortho;
  return [...Object.keys(o.letters), ...Object.keys(o.marked), ...Object.keys(o.digraphs)].filter((k) => k !== "∅");
}

function attach(s: Script, c: Cluster, markId: number): void {
  const g = glyphOf(s, markId);
  const pos = g?.mark ?? "above";
  switch (pos) {
    case "above":
      c.above.push(markId);
      break;
    case "below":
      c.below.push(markId);
      break;
    case "before":
    case "left":
      c.before.push(markId);
      break;
    default:
      c.after.push(markId);
  }
}

/** Alphabetic spelling of a phoneme: letter, letter + mark, digraph, or nearest writable sound. */
function spellPh(s: Script, ph: string, depth = 0): Cluster[] {
  const o = s.ortho;
  if (o.letters[ph] !== undefined) return [cl({ g: o.letters[ph] }, [ph])];
  const m = o.marked[ph];
  if (m && depth < 6) {
    const cs = spellPh(s, m[0], depth + 1);
    if (cs.length) attach(s, cs[cs.length - 1], m[1]);
    for (const c of cs) c.ph = [ph];
    return cs;
  }
  const d = o.digraphs[ph];
  if (d && depth < 6) return d.flatMap((x) => spellPh(s, x, depth + 1));
  if (depth > 5) return [];
  const near = nearestIn(s, ph, writableKeys(s));
  return near ? spellPh(s, near, depth + 1) : [];
}

/** Resolve a vowel for sign-based systems: returns [key present in table, extra feature marks]. */
function resolveVowel(s: Script, v: string, table: Record<string, unknown>): [string, number[]] {
  const o = s.ortho;
  const marks: number[] = [];
  let cur = v;
  for (let k = 0; k < 5; k++) {
    if (table[cur] !== undefined) return [cur, marks];
    const m = o.marked[cur];
    if (m) {
      marks.unshift(m[1]);
      cur = m[0];
      continue;
    }
    const d = o.digraphs[cur];
    if (d && d.length && table[d[0]] !== undefined) return [d[0], marks];
    break;
  }
  const near = nearestIn(s, cur, Object.keys(table).filter((x) => x !== "" && classify(x).vowel));
  return [near ?? Object.keys(table)[0] ?? v, marks];
}

const isV = (ph: string): boolean => classify(ph).vowel;

// ---------------------------------------------------------------------------
// Per-kind spelling
// ---------------------------------------------------------------------------

export interface SpellOptions {
  /** Abjads: write vowel points (default: the script's own habit). */
  pointed?: boolean;
}

export function spellWord(s: Script, word0: string[], opts: SpellOptions = {}): Cluster[] {
  // Stress marks, syllable dots and stray spaces are not written.
  const word = word0.filter(isSegment);
  switch (s.kind) {
    case "alphabet":
      return word.flatMap((ph) => spellPh(s, ph));
    case "abjad":
      return spellAbjad(s, word, opts.pointed ?? s.ortho.pointing);
    case "abugida":
      return s.ortho.vowelMode === "rotate" ? spellRotate(s, word) : s.ortho.vowelMode === "fused" ? spellFused(s, word) : spellSigns(s, word);
    case "syllabary":
      return spellSyllabary(s, word);
    case "featural":
      return spellBlocks(s, word);
  }
}

function spellAbjad(s: Script, word: string[], pointed: boolean): Cluster[] {
  const o = s.ortho;
  const out: Cluster[] = [];
  let lastHasVowel = false;
  for (let i = 0; i < word.length; i++) {
    const ph = word[i];
    if (!isV(ph)) {
      out.push(...spellPh(s, ph));
      lastHasVowel = false;
      continue;
    }
    const [q, fm] = resolveVowel(s, ph, o.vowelSigns);
    const sign = o.vowelSigns[q];
    let host = out[out.length - 1];
    if (!host || lastHasVowel) {
      host = cl({ g: o.carrier }, [ph]);
      out.push(host);
    }
    if (pointed && sign !== undefined && sign >= 0) {
      attach(s, host, sign);
      for (const m of fm) attach(s, host, m);
    }
    host.ph.push(ph);
    lastHasVowel = true;
    const mater = o.matres[ph];
    if (mater !== undefined) out.push(cl({ g: mater }, [ph]));
  }
  return out;
}

function vowelSignClusters(s: Script, host: Cluster, v: string): Cluster[] {
  const o = s.ortho;
  if (v === o.inherent) return [];
  const [q, fm] = resolveVowel(s, v, o.vowelSigns);
  const sign = o.vowelSigns[q];
  if (sign !== undefined && sign >= 0) attach(s, host, sign);
  for (const m of fm) attach(s, host, m);
  host.ph.push(v);
  return [];
}

function independentVowel(s: Script, v: string): Cluster[] {
  const o = s.ortho;
  if (o.letters[v] !== undefined) return [cl({ g: o.letters[v] }, [v])];
  const m = o.marked[v];
  if (m) {
    const cs = independentVowel(s, m[0]);
    if (cs.length) attach(s, cs[cs.length - 1], m[1]);
    return cs;
  }
  if (o.carrier >= 0) {
    const c = cl({ g: o.carrier }, []);
    vowelSignClusters(s, c, v);
    return [c];
  }
  const near = nearestIn(s, v, Object.keys(o.letters).filter(isV));
  return near ? [cl({ g: o.letters[near] }, [v])] : [];
}

function consonantRuns(word: string[]): { cons: string[]; v: string | null; lead: string | null }[] {
  // Splits into [consonant run + following vowel] groups; a vowel with no consonants before it has cons = [].
  const out: { cons: string[]; v: string | null; lead: string | null }[] = [];
  let i = 0;
  while (i < word.length) {
    const cons: string[] = [];
    while (i < word.length && !isV(word[i])) cons.push(word[i++]);
    const v = i < word.length ? word[i++] : null;
    out.push({ cons, v, lead: null });
  }
  return out;
}

function spellSigns(s: Script, word: string[]): Cluster[] {
  const o = s.ortho;
  const out: Cluster[] = [];
  for (const run of consonantRuns(word)) {
    if (!run.cons.length) {
      if (run.v) out.push(...independentVowel(s, run.v));
      continue;
    }
    let host: Cluster | null = null;
    for (const c of run.cons) {
      const cs = spellPh(s, c);
      if (!cs.length) continue;
      const h: Cluster | null = host;
      const canStack = o.conjuncts === "stack" && h !== null && cs.length === 1 && !cs[0].above.length && !cs[0].below.length && h.sub.length < 2;
      if (canStack && h) {
        h.sub.push(cs[0].base!);
        h.ph.push(c);
      } else {
        if (h && o.virama >= 0) h.below.push(o.virama);
        out.push(...cs);
        host = cs[cs.length - 1];
      }
    }
    if (host && !run.v && o.virama >= 0) host.below.push(o.virama);
    if (host && run.v) vowelSignClusters(s, host, run.v);
  }
  return out;
}

function spellFused(s: Script, word: string[]): Cluster[] {
  const o = s.ortho;
  const out: Cluster[] = [];
  const opsFor = (v: string | null, host: Cluster): void => {
    if (!host.base) return;
    if (v === null) {
      host.base = { ...host.base, ops: o.vowelOps[""] ?? [] };
      return;
    }
    const [q, fm] = resolveVowel(s, v, o.vowelOps);
    host.base = { ...host.base, ops: o.vowelOps[q] ?? [] };
    for (const m of fm) attach(s, host, m);
    host.ph.push(v);
  };
  for (const run of consonantRuns(word)) {
    if (!run.cons.length) {
      if (run.v) {
        const c = cl({ g: o.carrier }, []);
        opsFor(run.v, c);
        out.push(c);
      }
      continue;
    }
    run.cons.forEach((c, k) => {
      const cs = spellPh(s, c);
      if (!cs.length) return;
      for (let j = 0; j < cs.length - 1; j++) opsFor(null, cs[j]);
      const host = cs[cs.length - 1];
      opsFor(k === run.cons.length - 1 ? run.v : null, host);
      out.push(...cs);
    });
  }
  return out;
}

function spellRotate(s: Script, word: string[]): Cluster[] {
  const o = s.ortho;
  const out: Cluster[] = [];
  const rotFor = (v: string, host: Cluster): void => {
    const [q, fm] = resolveVowel(s, v, o.rotations);
    if (host.base) host.base = { ...host.base, rot: o.rotations[q] ?? 0 };
    for (const m of fm) attach(s, host, m);
    host.ph.push(v);
  };
  for (const run of consonantRuns(word)) {
    if (!run.cons.length) {
      if (run.v) {
        const c = cl({ g: o.carrier }, []);
        rotFor(run.v, c);
        out.push(c);
      }
      continue;
    }
    run.cons.forEach((c, k) => {
      const last = k === run.cons.length - 1;
      if (last && run.v) {
        const cs = spellPh(s, c);
        if (!cs.length) return;
        rotFor(run.v, cs[cs.length - 1]);
        out.push(...cs);
      } else {
        const id = o.finals[c] ?? o.finals[nearestIn(s, c, Object.keys(o.finals)) ?? ""];
        if (id !== undefined) {
          const f = cl({ g: id }, [c]);
          f.small = true;
          out.push(f);
        }
      }
    });
  }
  return out;
}

function sylId(s: Script, c: string, v: string): { id: number; marks: number[]; extra: string[] } | null {
  const o = s.ortho;
  const marks: number[] = [];
  const extra: string[] = [];
  // vowel resolution: quality + marks / doubled vowel
  let vq = v;
  for (let k = 0; k < 4; k++) {
    if (o.syllables[`|${vq}`] !== undefined) break;
    const m = o.marked[vq];
    if (m) {
      marks.push(m[1]);
      vq = m[0];
      continue;
    }
    const d = o.digraphs[vq];
    if (d) {
      vq = d[0];
      extra.push(...d.slice(1));
      continue;
    }
    vq = nearestIn(s, vq, Object.keys(o.syllables).filter((k2) => k2.startsWith("|")).map((k2) => k2.slice(1))) ?? vq;
    break;
  }
  let cc = c;
  for (let k = 0; k < 4; k++) {
    const id = o.syllables[`${cc}|${vq}`];
    if (id !== undefined) return { id, marks, extra };
    const m = o.marked[cc];
    if (m && !isV(cc)) {
      marks.push(m[1]);
      cc = m[0];
      continue;
    }
    const cons = [...new Set(Object.keys(o.syllables).map((k2) => k2.split("|")[0]).filter((x) => x))];
    const near = nearestIn(s, cc, cons);
    if (!near) return null;
    cc = near;
  }
  return null;
}

function spellSyllabary(s: Script, word: string[]): Cluster[] {
  const o = s.ortho;
  const out: Cluster[] = [];
  const firstV = word.find(isV) ?? o.inherent ?? Object.keys(o.syllables)[0]?.split("|")[1] ?? "a";
  let prevV = firstV;
  const push = (c: string, v: string, ph: string[]): void => {
    const r = sylId(s, c, v);
    if (!r) return;
    const k = cl({ g: r.id }, ph);
    for (const m of r.marks) attach(s, k, m);
    out.push(k);
    for (const e of r.extra) {
      const r2 = sylId(s, "", e);
      if (r2) out.push(cl({ g: r2.id }, [e]));
    }
  };
  for (let i = 0; i < word.length; i++) {
    const ph = word[i];
    if (isV(ph)) {
      push("", ph, [ph]);
      prevV = ph;
      continue;
    }
    const next = word[i + 1];
    if (next !== undefined && isV(next)) {
      push(ph, next, [ph, next]);
      prevV = next;
      i++;
      continue;
    }
    // coda
    const fin = o.finals[ph];
    if (o.coda === "final" && fin !== undefined) {
      const k = cl({ g: fin }, [ph]);
      out.push(k);
      continue;
    }
    // echo vowel: the next vowel in the word before any vowel has been seen, else the previous one
    const echo = out.length ? prevV : (word.slice(i).find(isV) ?? prevV);
    push(ph, echo, [ph]);
  }
  return out;
}

function spellBlocks(s: Script, word: string[]): Cluster[] {
  const o = s.ortho;
  const letter = (ph: string): number | undefined => {
    if (o.letters[ph] !== undefined) return o.letters[ph];
    const near = nearestIn(s, ph, Object.keys(o.letters).filter((k) => k !== "∅" && isV(k) === isV(ph)));
    return near ? o.letters[near] : undefined;
  };
  const vIdx: number[] = [];
  word.forEach((ph, i) => isV(ph) && vIdx.push(i));
  if (!vIdx.length) return word.flatMap((ph) => (letter(ph) !== undefined ? [cl({ g: letter(ph)! }, [ph])] : []));
  const blocks: { onset: string[]; v: string; coda: string[] }[] = vIdx.map((i) => ({ onset: [], v: word[i], coda: [] }));
  // leading consonants
  blocks[0].onset = word.slice(0, vIdx[0]);
  for (let k = 0; k < vIdx.length - 1; k++) {
    const run = word.slice(vIdx[k] + 1, vIdx[k + 1]);
    if (run.length) {
      blocks[k + 1].onset = run.slice(-1);
      blocks[k].coda = run.slice(0, -1);
    }
  }
  blocks[blocks.length - 1].coda = word.slice(vIdx[vIdx.length - 1] + 1);
  const out: Cluster[] = [];
  for (const b of blocks) {
    const onset = b.onset.slice(0, 2).map(letter).filter((x): x is number => x !== undefined);
    const extraOnset = b.onset.slice(0, -2);
    for (const e of extraOnset) {
      const id = letter(e);
      if (id !== undefined) out.push(cl({ g: id }, [e]));
    }
    const vowel = letter(b.v);
    if (vowel === undefined) continue;
    const coda = b.coda.slice(0, 2).map(letter).filter((x): x is number => x !== undefined);
    const c = cl(null, [...b.onset, b.v, ...b.coda]);
    c.block = { onset: onset.length ? onset : [o.carrier], vowel, coda };
    out.push(c);
    for (const e of b.coda.slice(2)) {
      const id = letter(e);
      if (id !== undefined) out.push(cl({ g: id }, [e]));
    }
  }
  return out;
}

/** Whether a featural vowel glyph stands upright (consonants to its left). */
export function blockVertical(s: Script, vowelId: number): boolean {
  const g = glyphOf(s, vowelId);
  if (!g) return true;
  return vowelIsVertical({ strokes: g.strokes, w: g.w });
}

/** Can every phoneme be spelled with at least one glyph? Returns unwritable phonemes. */
export function unwritable(s: Script, phonemes: string[]): string[] {
  const bad: string[] = [];
  for (const ph of phonemes) {
    const cs = spellWord(s, [ph], { pointed: true });
    const ok = cs.some((c) => c.base || c.block || c.above.length || c.below.length);
    if (!ok) bad.push(ph);
  }
  return bad;
}
