/**
 * The naming API: settlements, realms, peoples, natural features, deities,
 * religions, dynasties, persons, titles and language names. Every name is
 * built from the language's own words and affixes, with a literal gloss, a
 * morpheme breakdown and IPA. A registry keeps names unique per language and
 * holds the personal-name pools from which people are named.
 *
 * Readability: inside compound names, words of three or more syllables appear
 * in a clipped combining form (deterministic per language, so the element
 * recurs across a toponymy the way -bury and -gawa do), and each name is the
 * best of several candidates scored for length against an ideal for its kind.
 * Candidates are cheap drafts; only the winner gets its morpheme parts, IPA
 * and title-cased gloss.
 */
import type { Rng } from "../core/rng";
import { CONCEPT_BY_ID, englishAgent, englishPlural, titleCase } from "./concepts";
import { joinMorphs, type Joined } from "./morphology";
import { ipaPhrase, romanizeName, romanizeWord, ugliness } from "./orthography";
import { syllabify, tables } from "./phonology";
import { isVowel } from "./phoneme";
import type { AffixKind, Language, Name, NameKind, NamePart, NameRegistry, Word } from "./types";
import { generateWord } from "./wordgen";
import { asciiFold, obscene } from "./util";
import { borrowName } from "./etymology";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function createRegistry(): NameRegistry {
  return { used: {}, pools: {} };
}

const DEFAULT_REGISTRY = new WeakMap<Language, NameRegistry>();

export interface NameOptions {
  /** Uniqueness registry (per world). Defaults to a hidden per-language registry. */
  registry?: NameRegistry;
  /** Enforce uniqueness within the language (default true for places). */
  unique?: boolean;
}

function registryFor(lang: Language, opts: NameOptions): NameRegistry {
  if (opts.registry) return opts.registry;
  let r = DEFAULT_REGISTRY.get(lang);
  if (!r) {
    r = createRegistry();
    DEFAULT_REGISTRY.set(lang, r);
  }
  return r;
}

/** Mark a name as used (e.g. names restored from a save, or evolved names). */
export function registerName(reg: NameRegistry, name: Name): void {
  (reg.used[name.lang] ??= {})[name.roman.toLowerCase()] = 1;
}

export function isNameUsed(reg: NameRegistry, langId: string, roman: string): boolean {
  return !!reg.used[langId]?.[roman.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Pieces → drafts → names
// ---------------------------------------------------------------------------

interface Piece {
  form: Word;
  gloss: string;
  concept?: string;
  affix?: AffixKind;
  role: NamePart["role"];
}

const AFFIX_GLOSS: Partial<Record<AffixKind, string>> = {
  place: "PLACE",
  land: "LAND",
  demonym: "DEM",
  adj: "ADJ",
  dim: "DIM",
  aug: "AUG",
  agent: "AGT",
  abstract: "ABST",
  fem: "F",
  patronym: "PATR",
  dynasty: "DYN",
  collective: "COLL",
  pl: "PL",
  def: "DEF",
  gen: "GEN",
};

const en = (c: string) => CONCEPT_BY_ID[c]?.en ?? c;
const isAdj = (c: string) => CONCEPT_BY_ID[c]?.pos === "adj";
const isMass = (c: string) => !!CONCEPT_BY_ID[c]?.mass;
const has = (c: string, tag: string) => !!CONCEPT_BY_ID[c]?.tags.includes(tag);
/** Things there is one of: "Place of the Sun", not "Place of Suns". */
const UNIQUE = new Set(["sun", "moon", "sky", "sea", "earth", "dawn", "night", "evening", "winter", "summer", "springtime", "autumn", "north", "south", "east", "west", "ocean", "storm", "thunder", "rain", "wind", "dragon", "god", "king"]);

function syl(w: Word): number {
  let n = 0;
  for (const p of w) if (isVowel(p)) n++;
  return n;
}

const COMBINING = new WeakMap<Language, Map<string, Word>>();

/**
 * The form a word takes inside a compound name: words of three or more
 * syllables are clipped to their first two (any coda that cannot end a word is
 * dropped), the way long elements erode in real toponymy.
 */
function combiningForm(lang: Language, c: string): Word {
  const w = lang.lexicon[c].form;
  if (syl(w) <= 2) return w;
  let m = COMBINING.get(lang);
  if (!m) COMBINING.set(lang, (m = new Map()));
  let f = m.get(c);
  if (f) return f;
  const starts = syllabify(w, lang.phonology);
  f = w.slice(0, starts[2] ?? w.length);
  const finals = tables(lang.phonology).finals;
  while (f.length > 2 && !isVowel(f[f.length - 1]) && !(finals.has(f[f.length - 1]) && isVowel(f[f.length - 2]))) f = f.slice(0, -1);
  if (!f.some(isVowel)) f = w;
  m.set(c, f);
  return f;
}

/** A word as a piece (full form). */
function root(lang: Language, c: string): Piece {
  return { form: lang.lexicon[c].form, gloss: en(c), concept: c, role: "root" };
}

/** A word as a compound element (combining form). */
function croot(lang: Language, c: string): Piece {
  return { form: combiningForm(lang, c), gloss: en(c), concept: c, role: "root" };
}

/** A settlement head in its combining form (clipped favourite heads like -stan), else the compound form. */
function headRoot(lang: Language, c: string): Piece {
  const f = lang.naming.headForms?.[c];
  return f && f.length ? { form: f, gloss: en(c), concept: c, role: "root" } : croot(lang, c);
}

function affixPiece(lang: Language, kind: AffixKind): Piece | null {
  const a = lang.morphology.affixes[kind];
  if (!a || a.form.length === 0) return null;
  return { form: a.form, gloss: AFFIX_GLOSS[kind] ?? kind.toUpperCase(), affix: kind, role: "affix" };
}

/** The word of a name that stands for it inside another name: a person's given name, else the longest word. */
function coreOf(n: Name): { form: Word; roman: string } {
  const romans = n.roman.split(" ");
  if (n.words.length <= 1) return { form: n.words[0] ?? n.phonemes, roman: n.roman };
  let idx = 0;
  if (n.meta?.givenIndex !== undefined) idx = +n.meta.givenIndex;
  else {
    let best = -1;
    n.words.forEach((w, i) => {
      if (w.length > best) {
        best = w.length;
        idx = i;
      }
    });
  }
  return { form: n.words[idx] ?? n.words[0], roman: romans[idx] ?? n.roman };
}

function namePiece(n: Name, gloss?: string): Piece {
  const c = coreOf(n);
  return { form: c.form, gloss: gloss ?? c.roman, role: "name" };
}

/** A name as a phrase of words (all words, except persons: the given name). */
function phrasePieces(n: Name): Piece[] {
  if (n.kind === "person" || n.words.length <= 1) return [namePiece(n)];
  return n.words.map((w, i) => ({ form: w, gloss: i === 0 ? n.roman : "", role: "name" as const }));
}

/** Attach a derivational affix (prefix/suffix). Particles are returned as separate words by `withParticle`. */
function withAffix(lang: Language, base: Piece[], kind: AffixKind): Piece[] {
  const a = lang.morphology.affixes[kind];
  const p = affixPiece(lang, kind);
  if (!a || !p) return base;
  if (a.pos === "prefix") return [p, ...base];
  if (a.pos === "suffix") return [...base, p];
  return base;
}

/** Words for a phrase where `kind` may be a free particle. */
function withParticle(lang: Language, base: Piece[], kind: AffixKind): Piece[][] {
  const a = lang.morphology.affixes[kind];
  const p = affixPiece(lang, kind);
  if (!a || !p) return [base];
  if (a.pos === "before") return [[p], base];
  if (a.pos === "after") return [base, [p]];
  return [withAffix(lang, base, kind)];
}

function cmp(lang: Language, mod: Piece[], head: Piece[]): Piece[] {
  const mo = lang.morphology;
  const link: Piece[] = mo.linkMode === "always" && mo.link.length ? [{ form: mo.link, gloss: "", role: "link" }] : [];
  return mo.compound === "mod-head" ? [...mod, ...link, ...head] : [...head, ...link, ...mod];
}

/** Adjective + noun as two words (phrase) in the language's order. */
function adjPhrase(lang: Language, adj: Piece[], noun: Piece[]): Piece[][] {
  return lang.morphology.adjOrder === "AN" ? [adj, noun] : [noun, adj];
}

/** Genitive construction: possessor marked with GEN (suffix or particle), ordered GN/NG. */
function genitive(lang: Language, head: Piece[], possessor: Piece[]): Piece[][] {
  const poss = withParticle(lang, possessor, "gen");
  return lang.morphology.genOrder === "GN" ? [...poss, head] : [head, ...poss];
}

/** A cheap candidate: phonemes and spelling only. */
interface Draft {
  kind: NameKind;
  pieces: Piece[][];
  joined: Joined[];
  words: Word[];
  phonemes: Word;
  roman: string;
  gloss: string;
  syl: number;
}

function draft(lang: Language, kind: NameKind, pieces: Piece[][], gloss: string): Draft {
  const joined = pieces.map((ps) => joinMorphs(lang, ps.map((p) => ({ form: p.form, affix: p.role === "affix" || p.role === "link" }))));
  const words = joined.map((j) => j.word);
  const phonemes: Word = [];
  let s = 0;
  words.forEach((w, i) => {
    if (i > 0) phonemes.push(" ");
    phonemes.push(...w);
    s += syl(w);
  });
  return { kind, pieces, joined, words, phonemes, roman: romanizeName(lang.orthography, phonemes), gloss, syl: s };
}

function finalize(lang: Language, d: Draft): Name {
  const parts: NamePart[] = [];
  d.joined.forEach((j, wi) => {
    const pieces = d.pieces[wi];
    let cur: { tag: number; ph: string[] } | null = null;
    const flush = () => {
      if (!cur || cur.ph.length === 0) return;
      const pc = cur.tag >= 0 ? pieces[cur.tag] : null;
      parts.push({
        phonemes: cur.ph,
        roman: romanizeWord(lang.orthography, cur.ph),
        gloss: pc ? pc.gloss : "",
        concept: pc?.concept,
        affix: pc?.affix,
        role: pc ? pc.role : "link",
        word: wi,
      });
    };
    j.word.forEach((p, i) => {
      const t = j.tags[i];
      if (!cur || cur.tag !== t) {
        flush();
        cur = { tag: t, ph: [] };
      }
      cur.ph.push(p);
    });
    flush();
  });
  for (const p of parts) if (p.concept === undefined) delete p.concept;
  for (const p of parts) if (p.affix === undefined) delete p.affix;
  return {
    lang: lang.id,
    kind: d.kind,
    phonemes: d.phonemes,
    words: d.words,
    roman: d.roman,
    ipa: ipaPhrase(d.words, lang.phonology.stress, lang.phonology),
    gloss: titleCase(d.gloss.trim()),
    parts,
    history: [],
    etym: "",
  };
}

export function makeName(lang: Language, kind: NameKind, words: Piece[][], gloss: string): Name {
  return finalize(lang, draft(lang, kind, words, gloss));
}

/** Ideal and maximum syllable counts per kind of name. */
type Len = [ideal: number, max: number];
const LEN_SETTLEMENT: Len = [3, 4];
const LEN_FEATURE: Len = [3, 4];
const LEN_SHORT: Len = [3, 4];
const LEN_LONG: Len = [4, 5];

function score(d: Draft, len: Len): number {
  const letters = [...d.roman.replace(/[\s'ʻʿʾ-]/g, "")].length;
  const words = d.words.length;
  const ideal = len[0] + (words > 1 ? 1 : 0);
  const max = len[1] + (words > 1 ? 1 : 0);
  return (
    ugliness(d.roman) +
    Math.max(0, d.syl - ideal) * 0.5 +
    Math.max(0, d.syl - max) * 3 +
    (letters < 3 ? 2 : 0) +
    Math.max(0, letters - 11) * 0.25 +
    (words > 2 ? 1 : 0)
  );
}

const DISTINGUISHERS = ["new", "old", "upper", "lower", "great", "small", "high", "far", "north", "south", "east", "west"];

/** English words that would read as jokes inside a name (obscenities are caught by `obscene`). */
const BLACKLIST = new Set(
  "bum damn dong dung gay hell jew kill nob wifi fish dog cat cow pig rat bad sad mad fat ugly dumb stupid idiot moron loser god jesus allah satan devil bra panty".split(" "),
);

export function offensive(roman: string): boolean {
  if (obscene(roman)) return true;
  const a = asciiFold(roman).toLowerCase();
  for (const w of a.split(/[\s-]+/)) if (BLACKLIST.has(w)) return true;
  return false;
}

function choose(lang: Language, rng: Rng, opts: NameOptions, gen: () => Draft | null, len: Len, tries = 12): Name {
  const reg = registryFor(lang, opts);
  const unique = opts.unique !== false;
  const used = (reg.used[lang.id] ??= {});
  let best: Draft | null = null;
  let last: Draft | null = null;
  const pool: [Draft, number][] = [];
  for (let t = 0; t < tries; t++) {
    const d = gen();
    if (!d) continue;
    last = d;
    const key = d.roman.toLowerCase();
    if (unique && used[key]) continue;
    const sc = score(d, len);
    // The first acceptable candidate wins, so the generator's mix of patterns (opaque names
    // included) is preserved; the (costly) offensiveness check runs only for it.
    if (sc < 0.6 && !offensive(d.roman)) {
      best = d;
      break;
    }
    // among the leftovers, transparent names are preferred (opaque ones are short by nature)
    pool.push([d, sc + (d.gloss ? 0 : 0.6)]);
  }
  if (!best && pool.length) {
    pool.sort((a, b) => a[1] - b[1]);
    best = pool.find(([d]) => !offensive(d.roman))?.[0] ?? null;
  }
  if (!best && last) {
    // Everything collided: distinguish with "Upper", "New", … as real toponymy does.
    for (const dn of rng.shuffle(DISTINGUISHERS.slice())) {
      const base = last;
      const words = base.words.map((w, wi) => [{ form: w, gloss: wi === 0 ? base.gloss : "", role: "name" as const }]);
      const adj = [root(lang, dn)];
      const cand = draft(lang, base.kind, lang.morphology.adjOrder === "AN" ? [adj, ...words] : [...words, adj], `${en(dn)} ${base.gloss}`);
      if (!used[cand.roman.toLowerCase()]) {
        best = cand;
        break;
      }
    }
    if (!best) best = last;
  }
  const out = finalize(lang, best!);
  if (unique) used[out.roman.toLowerCase()] = 1;
  return out;
}

function weightedConcept(rng: Rng, pairs: [string, number][]): string {
  return rng.weighted(pairs);
}

/** A gentle preference for short words: weight 1/syllables^0.7 (combining forms already cap length). */
function preferShort(lang: Language, rng: Rng, cands: string[]): string {
  return cands[rng.weightedIndex(cands.map((c) => 1 / Math.pow(Math.max(1, syl(lang.lexicon[c]?.form ?? [])), 0.7)))];
}

/** Of a few candidates, prefer the one with the shortest word (names favour short elements). */
function shortest(lang: Language, rng: Rng, cands: string[], k = 3): string {
  let best = rng.pick(cands);
  let bs = syl(lang.lexicon[best]?.form ?? []) + rng.next() * 0.9;
  for (let i = 1; i < k; i++) {
    const c = rng.pick(cands);
    const s = syl(lang.lexicon[c]?.form ?? []) + rng.next() * 0.9;
    if (s < bs) {
      best = c;
      bs = s;
    }
  }
  return best;
}

const MOD_CATS: [string, number][] = [
  ["color", 1.1],
  ["qual", 1.0],
  ["beast", 0.9],
  ["tree", 1.3],
  ["plant", 0.5],
  ["material", 0.6],
  ["geo", 1.0],
  ["dir", 0.6],
  ["sky", 0.12],
  ["elem", 0.2],
];

const MOD_POOLS = new Map<string, string[]>();

/** A random place-name modifier, preferring short words. */
function randomModifier(rng: Rng, exclude: Set<string>, nounOnly = false, lang?: Language): string {
  const cat = rng.weighted(MOD_CATS);
  const pk = `${cat}|${nounOnly}`;
  let pool = MOD_POOLS.get(pk);
  if (!pool) {
    pool = Object.values(CONCEPT_BY_ID)
      .filter((c) => c.tags.includes("mod") && c.tags.includes(cat) && (!nounOnly || c.pos === "n") && c.pos !== "num")
      .map((c) => c.id);
    MOD_POOLS.set(pk, pool);
  }
  const cands = pool.filter((c) => !exclude.has(c));
  if (!cands.length) return "stone";
  return lang ? shortest(lang, rng, cands) : rng.pick(cands);
}

function siteSplit(features: string[] | undefined): { heads: string[]; mods: string[] } {
  const fs = (features ?? []).filter((f) => CONCEPT_BY_ID[f]);
  return { heads: fs.filter((f) => has(f, "head")), mods: fs.filter((f) => has(f, "mod")) };
}

function placeGloss(c: string): string {
  if (isAdj(c)) return `${en(c)} Place`;
  if (UNIQUE.has(c)) return `Place of the ${en(c)}`;
  return `Place of ${isMass(c) ? en(c) : englishPlural(c)}`;
}

/** Adapt a name from another language for use inside this one. */
function localize(lang: Language, n: Name): Name {
  return n.lang === lang.id ? n : borrowName(n, lang);
}

/** A word of no known meaning (an old or substrate name), mostly two syllables. */
function opaqueForm(lang: Language, rng: Rng, weights: [number, number, number] = [0.25, 0.6, 0.15]): Word {
  const n = rng.weightedIndex(weights) + 1;
  return generateWord(lang.phonology, rng, n);
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export interface SettlementSite {
  /** Concept ids describing the site ("river", "ford", "oak", "hill", "coast", "iron", …). */
  features?: string[];
  /** Founder (a person's name) for "Founder's-stead" names. */
  founder?: Name;
  /** Mother city for "New X" names. */
  mother?: Name;
  /** The river (or lake, sea) the town stands on, for "X-mouth", "X-ford", "Bridge on the X" names. */
  river?: Name;
  pattern?: "compound" | "suffix" | "adjNoun" | "bare" | "founder" | "new" | "opaque" | "river";
}

const TOWN_ADJS = ["white", "red", "black", "green", "old", "new", "high", "fair", "holy", "great", "grey", "golden", "north", "south", "east", "west", "upper", "lower", "far", "cold", "bright", "dark", "long", "broad", "low", "small"];

export function nameSettlement(lang: Language, rng: Rng, site: SettlementSite = {}, opts: NameOptions = {}): Name {
  const nc = lang.naming;
  const { heads, mods } = siteSplit(site.features);
  const pickHead = () => (heads.length && rng.chance(0.6) ? rng.pick(heads) : weightedConcept(rng, nc.settlementHeads));
  const S = "settlement" as const;
  const gen = (): Draft | null => {
    const w: [string, number][] = Object.entries(nc.patterns).map(([k, v]) => [k, k === "opaque" ? v * 0.6 : v]);
    if (site.founder) w.push(["founder", 3]);
    if (site.mother) w.push(["new", 12]);
    if (site.river) w.push(["river", 4]);
    const pattern = site.pattern ?? rng.weighted(w);
    switch (pattern) {
      case "river": {
        // Oxford, Avonmouth, Exeter: the river's name with a head of the site
        if (!site.river) return null;
        const rv = localize(lang, site.river);
        const rn = coreOf(rv).roman;
        const rh = ["ford", "mouth", "bridge", "town", "fort", "harbor", "mound", "field", "hill", "home"].filter((h) => lang.lexicon[h]);
        const pref = heads.filter((h) => rh.includes(h));
        const h = pref.length && rng.chance(0.7) ? rng.pick(pref) : rng.pick(rh.slice(0, 6));
        if (rng.chance(0.75)) return draft(lang, S, [cmp(lang, [namePiece(rv, rn)], [headRoot(lang, h)])], `${rn} ${titleCase(en(h))}`);
        return draft(lang, S, genitive(lang, [root(lang, h)], [namePiece(rv, rn)]), `${titleCase(en(h))} on the ${rn}`);
      }
      case "founder": {
        if (!site.founder) return null;
        const f = localize(lang, site.founder);
        const given = coreOf(f).roman;
        if (rng.chance(0.55)) {
          const h = pickHead();
          return draft(lang, S, [cmp(lang, [namePiece(f, given)], [headRoot(lang, h)])], `${given}'s ${en(h)}`);
        }
        return draft(lang, S, [withAffix(lang, [namePiece(f, given)], "place")], `Place of ${given}`);
      }
      case "new": {
        if (!site.mother) return null;
        const m = localize(lang, site.mother);
        const mp = namePiece(m, m.roman);
        if (rng.chance(0.7)) return draft(lang, S, adjPhrase(lang, [root(lang, "new")], [mp]), `New ${m.roman}`);
        return draft(lang, S, [cmp(lang, [croot(lang, "new")], [mp])], `New ${m.roman}`);
      }
      case "suffix": {
        const base = mods.length && rng.chance(0.6) ? rng.pick(mods) : randomModifier(rng, new Set(), true, lang);
        return draft(lang, S, [withAffix(lang, [croot(lang, base)], "place")], placeGloss(base));
      }
      case "adjNoun": {
        const adjs = mods.filter(isAdj);
        const adj = adjs.length && rng.chance(0.6) ? rng.pick(adjs) : shortest(lang, rng, TOWN_ADJS);
        const h = pickHead();
        if (rng.chance(nc.phrasal)) return draft(lang, S, adjPhrase(lang, [root(lang, adj)], [root(lang, h)]), `${en(adj)} ${en(h)}`);
        return draft(lang, S, [cmp(lang, [croot(lang, adj)], [headRoot(lang, h)])], `${en(adj)} ${en(h)}`);
      }
      case "bare": {
        const h = heads.length ? rng.pick(heads) : pickHead();
        const o = lang.lexicon[h].origin;
        const alreadyDim = o.kind === "derived" && o.affix === "dim";
        if (rng.chance(0.5) && !alreadyDim) {
          const dimP = affixPiece(lang, "dim");
          if (dimP) return draft(lang, S, [withAffix(lang, [croot(lang, h)], "dim")], `Little ${en(h)}`);
        }
        if (syl(lang.lexicon[h].form) >= 2 && rng.chance(0.3)) return draft(lang, S, [[root(lang, h)]], en(h));
        const mod = randomModifier(rng, new Set([h]), false, lang);
        return draft(lang, S, [cmp(lang, [croot(lang, mod)], [headRoot(lang, h)])], `${en(mod)} ${en(h)}`);
      }
      case "opaque": {
        const pc: Piece = { form: opaqueForm(lang, rng), gloss: "", role: "root" };
        if (rng.chance(0.35)) return draft(lang, S, [withAffix(lang, [pc], "place")], "");
        return draft(lang, S, [[pc]], "");
      }
      default: {
        const h = pickHead();
        const excl = new Set([h]);
        const ms = mods.filter((m) => m !== h);
        const mod = ms.length && rng.chance(0.75) ? rng.pick(ms) : randomModifier(rng, excl, false, lang);
        return draft(lang, S, [cmp(lang, [croot(lang, mod)], [headRoot(lang, h)])], `${en(mod)} ${en(h)}`);
      }
    }
  };
  return choose(lang, rng, opts, gen, LEN_SETTLEMENT);
}

// ---------------------------------------------------------------------------
// Realms & peoples
// ---------------------------------------------------------------------------

export interface RealmOptions extends NameOptions {
  /** The people the realm is named after. */
  people?: Name;
  /** The capital. */
  capital?: Name;
  /** A dominant feature (concept id: "river", "mountain", "sea", "forest", …). */
  feature?: string;
  founder?: Name;
}

export function nameRealm(lang: Language, rng: Rng, o: RealmOptions = {}): Name {
  const R = "realm" as const;
  const gen = (): Draft | null => {
    const r = rng.next();
    if (o.people && r < 0.45) {
      const p = localize(lang, o.people);
      if (p.words.length > 1) {
        // a phrase-name ("Children of the Moon"): "Land of the Children of the Moon"
        const ws = p.words.map((w) => ({ form: w, gloss: "", role: "name" as const }));
        ws[0].gloss = p.roman;
        return draft(lang, R, genitive(lang, [root(lang, rng.chance(0.6) ? "land" : "realm")], ws), `Land of the ${p.roman}`);
      }
      const pp = namePiece(p, p.roman);
      if (rng.chance(0.6) && lang.morphology.affixes.land?.form.length) return draft(lang, R, [withAffix(lang, [pp], "land")], `Land of the ${p.roman}`);
      return draft(lang, R, [cmp(lang, [pp], [croot(lang, rng.chance(0.6) ? "land" : "realm")])], `Land of the ${p.roman}`);
    }
    if (o.capital && r < 0.7) {
      const c = localize(lang, o.capital);
      if (c.words.length > 1) return draft(lang, R, genitive(lang, [root(lang, "land")], phrasePieces(c)), `Land of ${c.roman}`);
      return draft(lang, R, [withAffix(lang, [namePiece(c, c.roman)], "land")], `Land of ${c.roman}`);
    }
    if (o.founder && r < 0.8) {
      const f = localize(lang, o.founder);
      const given = coreOf(f).roman;
      return draft(lang, R, [withAffix(lang, [namePiece(f, given)], "land")], `Land of ${given}`);
    }
    const feat = o.feature && CONCEPT_BY_ID[o.feature] ? o.feature : randomModifier(rng, new Set(), false, lang);
    if (rng.chance(0.5))
      return draft(lang, R, [withAffix(lang, [croot(lang, feat)], "land")], isAdj(feat) ? `${en(feat)} Land` : UNIQUE.has(feat) ? `Land of the ${en(feat)}` : `Land of ${isMass(feat) ? en(feat) : englishPlural(feat)}`);
    return draft(lang, R, [cmp(lang, [croot(lang, feat)], [croot(lang, "land")])], `${en(feat)} Land`);
  };
  return choose(lang, rng, o, gen, LEN_SHORT);
}

export interface PeopleOptions extends NameOptions {
  /** Name a people after a place (demonym). */
  place?: Name;
  /** A feature they are associated with ("river", "horse", "forest", …). */
  feature?: string;
}

export function namePeople(lang: Language, rng: Rng, o: PeopleOptions = {}): Name {
  const P = "people" as const;
  const gen = (): Draft | null => {
    if (o.place && rng.chance(0.8)) {
      const p = localize(lang, o.place);
      const pp = namePiece(p, p.roman);
      if (lang.morphology.affixes.demonym?.form.length && rng.chance(0.7)) return draft(lang, P, [withAffix(lang, [pp], "demonym")], `People of ${p.roman}`);
      return draft(lang, P, [cmp(lang, [pp], [croot(lang, "people")])], `${p.roman} Folk`);
    }
    const r = rng.next();
    if (o.feature && CONCEPT_BY_ID[o.feature] && r < 0.35) {
      return draft(lang, P, [cmp(lang, [croot(lang, o.feature)], [croot(lang, "people")])], `${en(o.feature)} Folk`);
    }
    if (r < 0.55) {
      const q = shortest(lang, rng, ["true", "free", "first", "old", "good", "high", "holy", "strong", "bold", "white", "red"]);
      return draft(lang, P, [cmp(lang, [croot(lang, q)], [croot(lang, "people")])], `the ${en(q)} People`);
    }
    if (r < 0.68) {
      const anc = shortest(lang, rng, ["sun", "moon", "star", "wolf", "bear", "eagle", "river", "sea", "stone", "mountain", "horse", "raven", "fire"]);
      const children = withAffix(lang, [root(lang, "child")], "pl");
      return draft(lang, P, genitive(lang, children, [root(lang, anc)]), `Children of the ${en(anc)}`);
    }
    // an opaque ethnonym, perhaps with the collective suffix
    const pc: Piece = { form: opaqueForm(lang, rng, [0.3, 0.6, 0.1]), gloss: "", role: "root" };
    return draft(lang, P, [rng.chance(0.4) ? withAffix(lang, [pc], "collective") : [pc]], "");
  };
  return choose(lang, rng, o, gen, LEN_SHORT);
}

/** Native demonym/adjective for a place ("of Kešdavar"). */
export function demonymFor(lang: Language, place: Name): Name {
  const p = localize(lang, place);
  return makeName(lang, "people", [withAffix(lang, [namePiece(p, p.roman)], "demonym")], `of ${p.roman}`);
}

// ---------------------------------------------------------------------------
// Natural features
// ---------------------------------------------------------------------------

export interface FeatureDescriptors {
  /** Colour concept: "white", "black", "red", "green", "blue", "yellow", "grey", "brown", "golden". */
  color?: string;
  size?: "great" | "small";
  temp?: "cold" | "hot";
  salt?: boolean;
  dir?: "north" | "south" | "east" | "west";
  /** Any further concept ids (beasts, trees, materials, deities…). */
  concepts?: string[];
}

interface FeatureSpec {
  heads: [string, number][];
  mods: string[];
  plural?: boolean;
  opaque?: number;
}

const FEATURE_SPECS: Partial<Record<NameKind, FeatureSpec>> = {
  river: { heads: [["river", 3], ["water", 2], ["stream", 0.5]], mods: ["white", "black", "red", "green", "blue", "grey", "brown", "swift", "slow", "cold", "broad", "deep.adj", "wild", "old", "holy", "bright", "dark", "swan", "otter", "fish", "horse", "wolf", "bear", "willow", "oak", "reed", "stone", "sand", "salt", "gold", "silver", "moon", "sun", "mist", "snow"], opaque: 0.3 },
  mountain: { heads: [["mountain", 3], ["peak", 1.5], ["rock", 0.8]], mods: ["white", "high", "snow", "ice", "storm", "fire", "cold", "black", "grey", "red", "old", "holy", "eagle", "wolf", "raven", "god", "thunder", "cloud", "sun", "moon", "star", "lonely", "silent", "great"], opaque: 0.2 },
  range: { heads: [["mountain", 3], ["peak", 1], ["tooth", 0.3]], mods: ["white", "high", "snow", "ice", "storm", "black", "grey", "red", "blue", "great", "cold", "dragon", "giant", "wolf", "thunder", "cloud", "iron", "bone", "dark"], plural: true, opaque: 0.15 },
  hills: { heads: [["hill", 3], ["mound", 0.6]], mods: ["green", "red", "seven", "three", "grey", "low", "old", "wind", "sheep", "barrow", "gold", "oak", "heath"], plural: true, opaque: 0.1 },
  sea: { heads: [["sea", 3], ["water", 1]], mods: ["north", "south", "east", "west", "dark", "great", "salt", "cold", "warm", "still", "wild", "blue", "green", "grey", "black", "white", "storm", "whale", "dragon", "sun", "dawn", "evening", "star"], opaque: 0.15 },
  ocean: { heads: [["ocean", 2], ["sea", 2], ["water", 1]], mods: ["great", "eternal", "endless", "west", "east", "north", "south", "dark", "deep.adj", "wide", "outer", "far", "silent", "storm", "evening", "dawn"], opaque: 0.1 },
  bay: { heads: [["bay", 3], ["harbor", 0.6]], mods: ["seal", "whale", "swan", "still", "blue", "green", "white", "red", "sand", "shell", "deep.adj", "fish", "ship", "wind", "warm"], opaque: 0.1 },
  strait: { heads: [["strait", 2], ["gate", 1.5], ["mouth", 1]], mods: ["narrow", "wind", "storm", "iron", "black", "dragon", "wave", "stone", "deep.adj", "cold"], opaque: 0.05 },
  lake: { heads: [["lake", 3], ["water", 1]], mods: ["still", "deep.adj", "blue", "cold", "salt", "silver", "moon", "mirror", "black", "green", "swan", "reed", "fish", "crane", "mist", "star", "clear", "white", "bright"], opaque: 0.2 },
  forest: { heads: [["forest", 3], ["wood", 1.5], ["grove", 0.5]], mods: ["dark", "old", "deep.adj", "green", "wild", "black", "oak", "pine", "birch", "yew", "wolf", "bear", "deer", "owl", "shadow", "silent", "hidden", "great", "holy", "mist"], opaque: 0.15 },
  jungle: { heads: [["forest", 3], ["wood", 1]], mods: ["green", "dark", "deep.adj", "wild", "hot", "tiger", "serpent", "palm", "rain", "mist", "great", "hidden", "bird", "flower"], opaque: 0.2 },
  desert: { heads: [["desert", 2], ["sand", 2], ["land", 1]], mods: ["red", "white", "yellow", "empty", "dry", "hot", "great", "dead", "silent", "burning", "salt", "stone", "sun", "dune", "golden", "south", "east"], opaque: 0.15 },
  steppe: { heads: [["plain", 2], ["field", 1], ["grass", 1.5], ["land", 1]], mods: ["broad", "green", "wind", "horse", "great", "golden", "yellow", "wild", "east", "endless", "high", "cold", "free"], opaque: 0.15 },
  plain: { heads: [["plain", 3], ["field", 1.5], ["land", 1]], mods: ["broad", "green", "golden", "wheat", "horse", "great", "low", "fair", "rich", "wind", "flower"], opaque: 0.1 },
  marsh: { heads: [["marsh", 3], ["water", 0.8], ["mist", 0.5]], mods: ["black", "grey", "dead", "reed", "mist", "heron", "green", "still", "bitter", "dark", "low", "salt"], opaque: 0.15 },
  tundra: { heads: [["land", 2], ["plain", 2], ["snow", 1]], mods: ["cold", "white", "frost", "empty", "north", "silent", "elk", "wind", "ice", "great"], opaque: 0.15 },
  glacier: { heads: [["glacier", 2], ["ice", 2], ["river", 0.5]], mods: ["white", "old", "blue", "great", "cold", "silent", "frost", "north"], opaque: 0.1 },
  volcano: { heads: [["mountain", 2], ["volcano", 1.5], ["peak", 1]], mods: ["fire", "smoke", "red", "black", "flame", "fierce", "ashes", "thunder", "god", "dragon", "burning"], opaque: 0.15 },
  island: { heads: [["island", 3], ["rock", 0.7]], mods: ["green", "white", "black", "red", "seal", "bird", "eagle", "lonely", "far", "high", "holy", "apple", "pine", "sand", "stone", "sun", "dawn", "small", "long", "west", "east"], opaque: 0.3 },
  archipelago: { heads: [["island", 3]], mods: ["thousand", "seven", "nine", "hundred", "three", "green", "scattered", "far", "bird", "seal", "west", "east", "south", "north", "golden"], plural: true, opaque: 0.15 },
  peninsula: { heads: [["cape", 2], ["land", 1.5], ["head", 1]], mods: ["long", "high", "north", "south", "east", "west", "wolf", "horn", "boar", "green", "stone", "storm", "narrow"], opaque: 0.2 },
  continent: { heads: [["land", 3], ["earth", 1.5]], mods: ["great", "east", "west", "north", "south", "old", "mother", "dawn", "evening", "sun", "far", "broad", "middle"], opaque: 0.3 },
};

/** Map a GeoFeatureKind (src/world/types.ts) to a NameKind. */
export function featureKindToNameKind(kind: string): NameKind {
  const m: Record<string, NameKind> = {
    mountains: "range",
    hills: "hills",
    volcano: "volcano",
    river: "river",
    lake: "lake",
    sea: "sea",
    ocean: "ocean",
    bay: "bay",
    strait: "strait",
    forest: "forest",
    jungle: "jungle",
    desert: "desert",
    steppe: "steppe",
    plain: "plain",
    marsh: "marsh",
    tundra: "tundra",
    glacier: "glacier",
    island: "island",
    archipelago: "archipelago",
    peninsula: "peninsula",
    continent: "continent",
  };
  return m[kind] ?? "other";
}

export function nameFeature(lang: Language, rng: Rng, kind: NameKind, d: FeatureDescriptors = {}, opts: NameOptions = {}): Name {
  const spec = FEATURE_SPECS[kind] ?? FEATURE_SPECS.mountain!;
  const given: string[] = [];
  if (d.color && CONCEPT_BY_ID[d.color]) given.push(d.color);
  if (d.size) given.push(d.size);
  if (d.temp) given.push(d.temp);
  if (d.salt) given.push("salt");
  if (d.dir) given.push(d.dir);
  for (const c of d.concepts ?? []) if (CONCEPT_BY_ID[c]) given.push(c);
  // Heads weighted towards the shorter words of this language.
  const heads = spec.heads.filter(([h]) => lang.lexicon[h]).map(([h, w]) => [h, w / Math.pow(Math.max(1, syl(lang.lexicon[h].form)), 1.3)] as [string, number]);
  const pool = spec.mods.filter((m) => lang.lexicon[m]);
  const gen = (): Draft | null => {
    const head = heads.length ? weightedConcept(rng, heads) : spec.heads[0][0];
    const plural = !!spec.plural && rng.chance(0.55);
    const headPieces = (): Piece[] => (plural ? withAffix(lang, [croot(lang, head)], "pl") : [croot(lang, head)]);
    // a range is "the Snow Mountains" in English whether or not the native name marks the plural
    const headEn = spec.plural ? titleCase(englishPlural(head)) : en(head);
    if (rng.chance(spec.opaque ?? 0.1) && given.length === 0) {
      // ancient, opaque names (hydronyms especially)
      const pc: Piece = { form: opaqueForm(lang, rng, kind === "river" ? [0.45, 0.45, 0.1] : [0.25, 0.6, 0.15]), gloss: "", role: "root" };
      if (rng.chance(0.35)) return draft(lang, kind, [cmp(lang, [pc], headPieces())], "");
      return draft(lang, kind, [[pc]], "");
    }
    if (kind === "river" && rng.chance(0.08) && given.length === 0) return draft(lang, kind, [[root(lang, head)]], en(head));
    const mod = given.length && rng.chance(0.8) ? rng.pick(given) : pool.length ? shortest(lang, rng, pool, 2) : "great";
    if (!lang.lexicon[mod]) return null;
    const gloss = `${en(mod)} ${headEn}`;
    if (isAdj(mod) && rng.chance(lang.naming.phrasal * 0.8)) return draft(lang, kind, adjPhrase(lang, [root(lang, mod)], plural ? withAffix(lang, [root(lang, head)], "pl") : [root(lang, head)]), gloss);
    return draft(lang, kind, [cmp(lang, [croot(lang, mod)], headPieces())], gloss);
  };
  return choose(lang, rng, opts, gen, LEN_FEATURE);
}

// ---------------------------------------------------------------------------
// Gods, faiths, dynasties
// ---------------------------------------------------------------------------

const DOMAIN_VERB: Record<string, [string, string]> = {
  sun: ["shine", "Shining"],
  fire: ["burn", "Burning"],
  war: ["fight", "Fighting"],
  harvest: ["reap", "Reaping"],
  "hunt.n": ["hunt", "Hunting"],
  river: ["flow", "Flowing"],
  dawn: ["rise", "Rising"],
  wisdom: ["know", "Knowing"],
  "love.n": ["love", "Loving"],
  moon: ["wander", "Wandering"],
  dream: ["sleep", "Sleeping"],
  "trade.n": ["trade", "Trading"],
  sky: ["see", "Seeing"],
  sea: ["carry", "Carrying"],
  death: ["take", "Taking"],
  storm: ["break", "Breaking"],
  fate: ["hold", "Holding"],
  healing: ["keep", "Keeping"],
  earth: ["grow", "Growing"],
  night: ["keep", "Watching"],
  law: ["rule", "Ruling"],
  smith: ["make", "Making"],
  wine: ["give", "Giving"],
};

const ARTICLE_DOMAINS = new Set(["sun", "moon", "sea", "sky", "storm", "earth", "harvest", "hunt.n", "dawn", "night", "river", "forest", "mountain", "hearth"]);

const DOMAIN_ADJ: Record<string, string[]> = {
  sun: ["bright", "golden", "high", "great", "white"],
  moon: ["silent", "white", "cold"],
  sky: ["high", "bright", "blue", "great", "eternal"],
  storm: ["fierce", "black", "wild", "great"],
  thunder: ["fierce", "great", "red"],
  sea: ["deep.adj", "dark", "wild", "eternal", "great", "grey"],
  war: ["red", "fierce", "bold", "black", "strong"],
  death: ["dark", "silent", "cold", "black"],
  fire: ["red", "bright", "fierce", "golden"],
  earth: ["old", "black", "rich", "deep.adj", "green"],
  night: ["dark", "black", "silent", "cold"],
  dawn: ["bright", "red", "golden", "young", "fair"],
  harvest: ["golden", "rich", "full", "good"],
  wisdom: ["old", "deep.adj", "silent", "bright"],
  "love.n": ["sweet", "fair", "gentle", "bright"],
  fate: ["dark", "silent", "old", "hidden"],
  healing: ["gentle", "good", "sweet", "bright"],
  river: ["swift", "deep.adj", "old", "broad"],
  "hunt.n": ["swift", "wild", "fierce", "silent"],
  wine: ["sweet", "red", "golden"],
  smith: ["strong", "black", "old"],
};

export interface DeityOptions extends NameOptions {
  /** Domain concept: "sun", "moon", "sky", "storm", "sea", "war", "death", "love.n", "harvest", "fire", "smith", "hunt.n", "wisdom", "night", "dawn", "earth", "fate", "healing", "wine", "trade.n", "dream", "law", "river"… */
  domain?: string;
  gender?: "m" | "f";
}

export function nameDeity(lang: Language, rng: Rng, o: DeityOptions = {}): Name {
  const domain = o.domain && lang.lexicon[o.domain] ? o.domain : rng.pick(["sun", "moon", "sky", "storm", "sea", "war", "death", "fire", "earth", "night", "dawn", "harvest"]);
  const fem = o.gender === "f";
  const D = "deity" as const;
  const femSuffix = fem && lang.naming.femaleMarking === "suffix";
  const gen = (): Draft | null => {
    const r = rng.next();
    const dEn = titleCase(en(domain));
    const ofDomain = ARTICLE_DOMAINS.has(domain) ? `the ${dEn}` : dEn;
    if (r < 0.3) {
      const title = fem ? rng.pick(["lady", "queen", "mother"]) : rng.pick(["lord", "king", "father"]);
      const t = lang.lexicon[title] ? title : fem ? "goddess" : "god";
      const g = `${titleCase(en(t))} of ${ofDomain}`;
      if (rng.chance(0.6)) return draft(lang, D, [cmp(lang, [croot(lang, domain)], [croot(lang, t)])], g);
      return draft(lang, D, genitive(lang, [root(lang, t)], [root(lang, domain)]), g);
    }
    if (r < 0.48 && DOMAIN_VERB[domain] && lang.lexicon[DOMAIN_VERB[domain][0]]) {
      const [v, ing] = DOMAIN_VERB[domain];
      let pcs = withAffix(lang, [croot(lang, v)], "agent");
      if (femSuffix) pcs = withAffix(lang, pcs, "fem");
      return draft(lang, D, [pcs], `the ${ing} One`);
    }
    if (r < 0.64) {
      const adj = shortest(lang, rng, DOMAIN_ADJ[domain] ?? ["holy", "great", "old", "high", "eternal"], 2);
      let pcs = cmp(lang, [croot(lang, adj)], [croot(lang, domain)]);
      if (femSuffix) pcs = withAffix(lang, pcs, "fem");
      return draft(lang, D, [pcs], `${en(adj)} ${en(domain)}`);
    }
    // opaque theonym (most of the great gods' names are)
    let pcs: Piece[] = [{ form: opaqueForm(lang, rng, [0.2, 0.6, 0.2]), gloss: "", role: "root" }];
    if (femSuffix) pcs = withAffix(lang, pcs, "fem");
    return draft(lang, D, [pcs], "");
  };
  const n = choose(lang, rng, o, gen, LEN_SHORT);
  n.meta = { ...(n.meta ?? {}), domain, gender: fem ? "f" : "m" };
  return n;
}

export interface ReligionOptions extends NameOptions {
  deity?: Name;
  founder?: Name;
  /** Core concept: "truth", "light", "way", "law", "fire", "sun", … */
  concept?: string;
}

export function nameReligion(lang: Language, rng: Rng, o: ReligionOptions = {}): Name {
  const F = "religion" as const;
  const gen = (): Draft | null => {
    const head = shortest(lang, rng, ["way", "law", "faith", "truth", "word", "path"], 2);
    const target = o.deity && rng.chance(0.6) ? localize(lang, o.deity) : o.founder && rng.chance(0.5) ? localize(lang, o.founder) : null;
    if (target) {
      const given = target.kind === "person" || target.words.length <= 1 ? coreOf(target).roman : target.roman;
      if (rng.chance(0.3) && target.words.length <= 1 && lang.morphology.affixes.abstract?.form.length)
        return draft(lang, F, [withAffix(lang, [namePiece(target, given)], "abstract")], `Teaching of ${given}`);
      return draft(lang, F, genitive(lang, [root(lang, head)], phrasePieces(target)), `the ${en(head)} of ${given}`);
    }
    const c = o.concept && lang.lexicon[o.concept] ? o.concept : shortest(lang, rng, ["light", "sun", "fire", "truth", "star", "moon", "sky", "peace", "blood", "water", "stone", "dawn", "wisdom"]);
    if (rng.chance(0.5)) return draft(lang, F, genitive(lang, [root(lang, head)], [root(lang, c)]), `the ${en(head)} of ${isMass(c) || c === "truth" ? "" : "the "}${en(c)}`);
    return draft(lang, F, [cmp(lang, [croot(lang, c)], [croot(lang, head)])], `${en(c)} ${en(head)}`);
  };
  return choose(lang, rng, o, gen, LEN_LONG);
}

export interface DynastyOptions extends NameOptions {
  founder?: Name;
  seat?: Name;
}

export function nameDynasty(lang: Language, rng: Rng, o: DynastyOptions = {}): Name {
  const Y = "dynasty" as const;
  const gen = (): Draft | null => {
    const useFounder = o.founder && (!o.seat || rng.chance(0.65));
    const src = useFounder ? localize(lang, o.founder!) : o.seat ? localize(lang, o.seat) : null;
    const label = src ? coreOf(src).roman : "";
    const sp: Piece = src ? namePiece(src, label) : { form: opaqueForm(lang, rng), gloss: "", role: "root" };
    if (lang.naming.dynastyStyle === "suffix" && lang.morphology.affixes.dynasty?.form.length && useFounder !== false)
      return draft(lang, Y, [withAffix(lang, [sp], "dynasty")], label ? `Kin of ${label}` : "");
    return draft(lang, Y, genitive(lang, [root(lang, "house")], [sp]), label ? `House of ${label}` : "");
  };
  return choose(lang, rng, o, gen, LEN_LONG);
}

// ---------------------------------------------------------------------------
// Persons
// ---------------------------------------------------------------------------

export interface PersonOptions extends NameOptions {
  gender?: "m" | "f";
  /** Father's (or mother's) name for a patronymic. */
  father?: Name;
  /** Clan or house name appended as a byname. */
  clan?: Name;
  /** true for a random epithet, or a concept id ("bold", "conquer", …). */
  epithet?: boolean | string;
  /** Always coin a new given name instead of drawing from the pool. */
  fresh?: boolean;
}

const DESCRIPTIVE_M = ["wolf", "bear", "eagle", "raven", "falcon", "stag", "deer", "boar", "horse", "bull", "lion", "tiger", "serpent", "hawk", "fox", "elk", "oak", "pine", "stone", "river", "storm", "thunder", "fire", "sun", "star", "wind", "mountain", "cloud", "arrow", "spear", "shield"];
const DESCRIPTIVE_F = ["dove", "swan", "rose", "lily", "flower", "star", "moon", "dawn", "light", "rain", "river", "willow", "deer", "pearl", "jewel", "bird", "crane", "wave", "snow", "spring", "cloud", "fire"];
/** Name elements that make poor one-element names. */
const NOT_A_NAME = new Set(["people", "home", "hand", "arm", "heart", "will", "counsel", "guest", "god", "king", "lord", "son", "gift", "guard.n"]);

const EPITHET_ADJ = ["bold", "old", "young", "great", "fair", "wise", "strong", "fierce", "holy", "black", "red", "white", "swift", "proud", "good", "silent", "gentle", "golden", "dark", "lonely", "evil", "free"];
const EPITHET_AGENT = ["conquer", "build", "hunt", "sail.v", "guard", "wander", "sing"];

/** Append the culture's male ending (-us, -o) unless it would put two vowels together. */
function withMaleEnding(lang: Language, pcs: Piece[]): Piece[] {
  const e = lang.naming.maleEnding;
  if (!e?.length) return pcs;
  const last = pcs[pcs.length - 1].form;
  if (isVowel(last[last.length - 1] ?? "") && isVowel(e[0])) return pcs;
  return [...pcs, { form: e, gloss: "", role: "link" }];
}

function givenName(lang: Language, rng: Rng, fem: boolean): Draft {
  const nc = lang.naming;
  const femSuffix = fem && nc.femaleMarking === "suffix";
  const els = nc.firstElements.filter((e) => lang.lexicon[e]);
  const seconds = (fem && nc.femaleMarking === "elements" ? nc.femaleElements : nc.secondElements).filter((e) => lang.lexicon[e]);
  const P = "person" as const;
  const style = nc.personStyle;
  const r = rng.next();
  if (style === "opaque" || r < 0.12) {
    const form = generateWord(lang.phonology, rng, rng.int(nc.maleEnding && !fem ? 1 : 2, 2), { openFinal: femSuffix });
    let pcs: Piece[] = [{ form, gloss: "", role: "root" }];
    if (femSuffix) pcs = withAffix(lang, pcs, "fem");
    else if (!fem && rng.chance(0.8)) pcs = withMaleEnding(lang, pcs);
    return draft(lang, P, [pcs], "");
  }
  if (style === "dithematic" && seconds.length && els.length) {
    let a = preferShort(lang, rng, els);
    const b = preferShort(lang, rng, seconds);
    if (a === b) a = rng.pick(els);
    let pcs = cmp(lang, [croot(lang, a)], [croot(lang, b)]);
    if (femSuffix) pcs = withAffix(lang, pcs, "fem");
    return draft(lang, P, [pcs], `${titleCase(en(a))}-${titleCase(en(b))}`);
  }
  if (style === "descriptive") {
    // "Swift Deer", "White Dove": a quality and a living or natural thing
    // the culture's own favourite qualities, so each people's descriptive names have their own flavour
    const base = fem ? ["bright", "white", "fair", "golden", "gentle", "sweet", "swift", "red", "silent"] : ["swift", "bright", "red", "white", "black", "strong", "wise", "bold", "high", "golden", "dark", "free", "fierce", "lonely"];
    const own = els.filter((e) => isAdj(e) && e !== "beloved" && (!fem || base.includes(e) || has(e, "fem")));
    const adjs = [...new Set([...own, ...base])].filter((x) => lang.lexicon[x]);
    const adj = adjs[rng.weightedIndex(adjs.map((x) => (own.includes(x) ? 2 : 1) / Math.pow(Math.max(1, syl(lang.lexicon[x].form)), 0.3)))];
    const pool = (fem ? DESCRIPTIVE_F : DESCRIPTIVE_M).filter((x) => lang.lexicon[x]);
    const noun = pool.length ? preferShort(lang, rng, pool) : "wolf";
    let pcs = cmp(lang, [croot(lang, adj)], [croot(lang, noun)]);
    if (femSuffix) pcs = withAffix(lang, pcs, "fem");
    return draft(lang, P, [pcs], `${en(adj)} ${en(noun)}`);
  }
  // monothematic: one element, perhaps a hypocoristic suffix
  const pool0 = (fem && nc.femaleMarking === "elements" ? nc.femaleElements : els).filter((x) => lang.lexicon[x] && !NOT_A_NAME.has(x));
  const pool = pool0.length ? pool0 : ["wolf"];
  const a = rng.pick(pool);
  let pcs: Piece[] = [root(lang, a)];
  let gloss = en(a);
  if (rng.chance(0.15)) {
    pcs = withAffix(lang, [croot(lang, a)], "dim");
    gloss = `Little ${gloss}`;
  }
  if (femSuffix) pcs = withAffix(lang, pcs, "fem");
  else if (!fem && rng.chance(0.8)) pcs = withMaleEnding(lang, pcs);
  return draft(lang, P, [pcs], gloss);
}

/** Cumulative Zipf weights 1/(i+1)^0.85, shared by all name pools. */
const ZIPF_CUM: number[] = [];
function zipfPick(rng: Rng, n: number): number {
  for (let i = ZIPF_CUM.length; i < n; i++) ZIPF_CUM.push((ZIPF_CUM[i - 1] ?? 0) + 1 / Math.pow(i + 1, 0.85));
  const r = rng.next() * ZIPF_CUM[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ZIPF_CUM[mid] > r) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Spellings already in a language's name pools (cached per pool; pools stay plain JSON). */
const POOL_TAKEN = new WeakMap<{ m: Name[]; f: Name[] }, { n: number; set: Set<string> }>();
function poolTaken(pool: { m: Name[]; f: Name[] }): Set<string> {
  let c = POOL_TAKEN.get(pool);
  const n = pool.m.length + pool.f.length;
  if (!c || c.n !== n) {
    c = { n, set: new Set([...pool.m, ...pool.f].map((x) => x.roman.toLowerCase())) };
    POOL_TAKEN.set(pool, c);
  }
  return c.set;
}

/** A personal name, drawn from (or added to) the language's name pool. */
export function namePerson(lang: Language, rng: Rng, o: PersonOptions = {}): Name {
  const reg = registryFor(lang, o);
  const fem = o.gender === "f";
  const pool = (reg.pools[lang.id] ??= { m: [], f: [] });
  const list = fem ? pool.f : pool.m;
  let given: Name | null = null;
  if (!o.fresh && list.length >= 6 && rng.chance(lang.naming.reuse)) {
    // Zipfian popularity: early names in the pool are the common ones.
    given = list[zipfPick(rng, list.length)];
  }
  if (!given) {
    const taken = poolTaken(pool);
    let best: Draft | null = null;
    let bestScore = Infinity;
    // two-element names (Wulf-gar, Swift-Deer) are naturally longer than one-element ones
    const len: Len = lang.naming.personStyle === "dithematic" || lang.naming.personStyle === "descriptive" ? [3, 4] : [2, 3];
    for (let t = 0; t < 8; t++) {
      const d = givenName(lang, rng, fem);
      if (taken.has(d.roman.toLowerCase()) || offensive(d.roman)) continue;
      const s = score(d, len);
      if (s < 0.6) {
        best = d;
        break;
      }
      const ranked = s + (d.gloss ? 0 : 0.6);
      if (ranked < bestScore) {
        best = d;
        bestScore = ranked;
      }
    }
    given = finalize(lang, best ?? givenName(lang, rng, fem));
    list.push(given);
    const cache = POOL_TAKEN.get(pool);
    if (cache) {
      cache.set.add(given.roman.toLowerCase());
      cache.n++;
    }
  }
  const g = given;
  const words: Piece[][] = [[{ form: g.words[0], gloss: g.gloss || g.roman, role: "name" }]];
  let givenIdx = 0;
  let gloss = g.gloss || "";
  const nc = lang.naming;
  // byname
  if (o.father && nc.patronymic !== "none") {
    const f = localize(lang, o.father);
    const fRoman = coreOf(f).roman;
    const fp: Piece = namePiece(f, fRoman);
    const pat = lang.morphology.affixes.patronym;
    const pp = affixPiece(lang, "patronym");
    if (pat && pp) {
      if (pat.pos === "before" || pat.pos === "after" || nc.patronymic === "particle") words.push(...(pat.pos === "after" ? [[fp], [pp]] : [[pp], [fp]]));
      else if (nc.patronymic === "prefix") words.push([pp, fp]);
      else words.push(withAffix(lang, [fp], "patronym"));
      gloss += `${gloss ? ", " : ""}${fem ? "daughter" : "son"} of ${fRoman}`;
    }
  }
  if (o.clan) {
    const c = localize(lang, o.clan);
    words.push([namePiece(c, c.roman)]);
    gloss += `${gloss ? ", " : ""}of ${c.roman}`;
  }
  if (o.epithet === true || typeof o.epithet === "string") {
    const e = typeof o.epithet === "string" && lang.lexicon[o.epithet] ? o.epithet : rng.chance(0.75) ? rng.pick(EPITHET_ADJ) : rng.pick(EPITHET_AGENT);
    const verb = CONCEPT_BY_ID[e]?.pos === "v";
    const pcs = verb ? withAffix(lang, [croot(lang, e)], "agent") : [root(lang, e)];
    const epWords = lang.morphology.articles ? withParticle(lang, pcs, "def") : [pcs];
    if (lang.morphology.adjOrder === "AN" && !verb && rng.chance(0.2)) {
      words.unshift(...epWords);
      givenIdx += epWords.length;
    } else words.push(...epWords);
    const eg = verb ? titleCase(englishAgent(e)) : titleCase(en(e));
    gloss += `${gloss ? ", " : ""}the ${eg}`;
  }
  const n = makeName(lang, "person", words, gloss);
  // the given name keeps its own morpheme breakdown
  const parts: NamePart[] = [];
  let inserted = false;
  for (const p of n.parts) {
    if (p.word === givenIdx) {
      if (!inserted) parts.push(...g.parts.map((q) => ({ ...q, word: givenIdx })));
      inserted = true;
    } else parts.push(p);
  }
  n.parts = parts;
  n.gloss = gloss ? gloss.charAt(0).toUpperCase() + gloss.slice(1) : "";
  n.meta = { gender: fem ? "f" : "m", given: given.roman, givenGloss: given.gloss, givenIndex: String(givenIdx) };
  return n;
}

/** Shortcut: an epithet for an existing person ("the Bold"), as a native word list + English. */
export function epithetFor(lang: Language, rng: Rng, concept?: string): Name {
  const e = concept && lang.lexicon[concept] ? concept : rng.pick(EPITHET_ADJ);
  const verb = CONCEPT_BY_ID[e]?.pos === "v";
  const pcs = verb ? withAffix(lang, [croot(lang, e)], "agent") : [root(lang, e)];
  const epWords = lang.morphology.articles ? withParticle(lang, pcs, "def") : [pcs];
  return makeName(lang, "other", epWords, `the ${verb ? englishAgent(e) : en(e)}`);
}

// ---------------------------------------------------------------------------
// Titles & languages
// ---------------------------------------------------------------------------

/** Native titles: "ruler", "emperor", "chief", "priest", "noble", "general", or any role concept ("king", "queen", "lord"…). */
export function nameTitle(lang: Language, role: string): Name {
  const map: Record<string, () => [Piece[][], string]> = {
    ruler: () => [[[root(lang, "king")]], "King"],
    emperor: () =>
      lang.morphology.affixes.aug?.form.length
        ? [[withAffix(lang, [croot(lang, "king")], "aug")], "Great King"]
        : [[cmp(lang, [croot(lang, "great")], [croot(lang, "king")])], "Great King"],
    chief: () => [[[root(lang, "chief")]], "Chief"],
    priest: () => [[[root(lang, "priest")]], "Priest"],
    noble: () => [[[root(lang, "lord")]], "Lord"],
    general: () => [[cmp(lang, [croot(lang, "war")], [croot(lang, "lord")])], "War-Lord"],
  };
  const f = map[role];
  if (f) {
    const [w, g] = f();
    return makeName(lang, "other", w, g);
  }
  const c = lang.lexicon[role] ? role : "lord";
  return makeName(lang, "other", [[root(lang, c)]], titleCase(en(c)));
}

/** The language's name for itself, as a Name. */
export function nameLanguage(lang: Language): Name {
  const n = makeName(lang, "language", [[{ form: lang.endonymPhonemes, gloss: lang.endonymGloss, role: "root" }]], lang.endonymGloss);
  return n;
}

/** The citation form with morpheme boundaries: "Kaś-tabar", "Nova Kesh". */
export function hyphenated(name: Name): string {
  const byWord = new Map<number, NamePart[]>();
  for (const p of name.parts) {
    const a = byWord.get(p.word) ?? [];
    a.push(p);
    byWord.set(p.word, a);
  }
  if (byWord.size === 0) return name.roman;
  const words: string[] = [];
  for (const [, ps] of [...byWord.entries()].sort((a, b) => a[0] - b[0])) {
    let s = "";
    // linking material goes with the preceding morpheme: Wulfa-gar, Szyju-kam
    ps.forEach((p, i) => {
      if (i > 0 && p.role !== "link") s += "-";
      s += p.roman;
    });
    words.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  return words.join(" ");
}

export { romanizeWord };
