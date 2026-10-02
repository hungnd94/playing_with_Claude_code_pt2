/**
 * The naming API: settlements, realms, peoples, natural features, deities,
 * religions, dynasties, persons, titles and language names. Every name is
 * built from the language's own words and affixes, with a literal gloss, a
 * morpheme breakdown and IPA. A registry keeps names unique per language and
 * holds the personal-name pools from which people are named.
 */
import type { Rng } from "../core/rng";
import { CONCEPT_BY_ID, englishAgent, englishPlural, titleCase } from "./concepts";
import { joinMorphs } from "./morphology";
import { ipaPhrase, romanizeName, romanizeWord, ugliness } from "./orthography";
import type { AffixKind, Language, Name, NameKind, NamePart, NameRegistry, Word } from "./types";
import { generateWord } from "./wordgen";
import { asciiFold } from "./util";
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
// Pieces → names
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

function root(lang: Language, c: string): Piece {
  return { form: lang.lexicon[c].form, gloss: en(c), concept: c, role: "root" };
}

/** A settlement head in its combining form (clipped favourite heads like -stan), else the full root. */
function headRoot(lang: Language, c: string): Piece {
  const f = lang.naming.headForms?.[c];
  return f && f.length ? { form: f, gloss: en(c), concept: c, role: "root" } : root(lang, c);
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

function wordFromPieces(lang: Language, pieces: Piece[], wi: number): { word: Word; parts: NamePart[] } {
  const j = joinMorphs(
    lang,
    pieces.map((p) => ({ form: p.form, affix: p.role === "affix" || p.role === "link" })),
  );
  const parts: NamePart[] = [];
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
  // drop empty concept parts (fully elided) silently
  return { word: j.word, parts };
}

export function makeName(lang: Language, kind: NameKind, words: Piece[][], gloss: string): Name {
  const parts: NamePart[] = [];
  const ws: Word[] = [];
  words.forEach((pieces, wi) => {
    const r = wordFromPieces(lang, pieces, wi);
    ws.push(r.word);
    parts.push(...r.parts);
  });
  const phonemes: Word = [];
  ws.forEach((w, i) => {
    if (i > 0) phonemes.push(" ");
    phonemes.push(...w);
  });
  return {
    lang: lang.id,
    kind,
    phonemes,
    words: ws,
    roman: romanizeName(lang.orthography, phonemes),
    ipa: ipaPhrase(ws, lang.phonology.stress, lang.phonology),
    gloss: titleCase(gloss.trim()),
    parts,
    history: [],
    etym: "",
  };
}

function lengthPenalty(n: Name, maxLetters: number): number {
  const letters = [...n.roman.replace(/[\s'ʻʿʾ-]/g, "")].length;
  return Math.max(0, letters - maxLetters) * 0.6 + (letters < 3 ? 2 : 0);
}

const DISTINGUISHERS = ["new", "old", "upper", "lower", "great", "small", "high", "far", "north", "south", "east", "west"];

/** English words that would read as jokes or slurs inside a name. */
const BLACKLIST = new Set(
  "ass anal anus arse bitch boob bum butt cock crap cum cunt damn dick dong dung fag fart fuck gay gook hell homo jap jew kike kill nazi negro nig nob piss poo poop porn pube puke rape semen sex shit slut spic tit tits turd twat wank whore wifi fish dog cat cow pig rat bad sad mad fat ugly dumb stupid idiot moron loser god jesus allah satan devil penis vagina bra panty".split(" "),
);

function offensive(roman: string): boolean {
  const a = asciiFold(roman).toLowerCase();
  for (const w of a.split(/[\s-]+/)) if (BLACKLIST.has(w)) return true;
  return /fuck|shit|cunt|nigg|fagg|rape|nazi|porn/.test(a.replace(/[^a-z]/g, ""));
}

function choose(lang: Language, rng: Rng, opts: NameOptions, gen: () => Name | null, maxLetters = 12, tries = 10): Name {
  const reg = registryFor(lang, opts);
  const unique = opts.unique !== false;
  const used = (reg.used[lang.id] ??= {});
  let best: Name | null = null;
  let bestScore = Infinity;
  let last: Name | null = null;
  for (let t = 0; t < tries; t++) {
    const n = gen();
    if (!n) continue;
    last = n;
    if (unique && used[n.roman.toLowerCase()]) continue;
    if (offensive(n.roman)) continue;
    const score = ugliness(n.roman) + lengthPenalty(n, maxLetters);
    if (score < 0.8) {
      best = n;
      break;
    }
    if (score < bestScore) {
      best = n;
      bestScore = score;
    }
  }
  if (!best && last) {
    // Everything collided: distinguish with "Upper", "New", … as real toponymy does.
    for (const d of rng.shuffle(DISTINGUISHERS.slice())) {
      const base = last;
      const words = base.words.map((w, wi) => [{ form: w, gloss: wi === 0 ? base.gloss : "", role: "name" as const }]);
      const cand = makeName(lang, base.kind, adjPhrase(lang, [root(lang, d)], words.flat()), `${en(d)} ${base.gloss}`);
      if (!used[cand.roman.toLowerCase()]) {
        best = cand;
        break;
      }
    }
    if (!best) best = last;
  }
  const out = best!;
  if (unique) used[out.roman.toLowerCase()] = 1;
  return out;
}

function weightedConcept(rng: Rng, pairs: [string, number][]): string {
  return rng.weighted(pairs);
}

const MOD_CATS: [string, number][] = [
  ["color", 1.1],
  ["qual", 1.0],
  ["beast", 0.8],
  ["tree", 1.2],
  ["plant", 0.5],
  ["material", 0.7],
  ["geo", 0.9],
  ["sky", 0.5],
  ["elem", 0.4],
  ["dir", 0.5],
];

const MOD_POOLS = new Map<string, string[]>();

/** A random place-name modifier; of two candidates, the one with the shorter word usually wins. */
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
  const a = rng.pick(cands);
  if (!lang) return a;
  const b = rng.pick(cands);
  const la = lang.lexicon[a]?.form.length ?? 9;
  const lb = lang.lexicon[b]?.form.length ?? 9;
  return lb < la && rng.chance(0.75) ? b : a;
}

function siteSplit(features: string[] | undefined): { heads: string[]; mods: string[] } {
  const fs = (features ?? []).filter((f) => CONCEPT_BY_ID[f]);
  return { heads: fs.filter((f) => has(f, "head")), mods: fs.filter((f) => has(f, "mod")) };
}

function placeGloss(c: string): string {
  return isAdj(c) ? `${en(c)} Place` : `Place of ${isMass(c) ? en(c) : englishPlural(c)}`;
}

/** Adapt a name from another language for use inside this one. */
function localize(lang: Language, n: Name): Name {
  return n.lang === lang.id ? n : borrowName(n, lang);
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
  pattern?: "compound" | "suffix" | "adjNoun" | "bare" | "founder" | "new" | "opaque";
}

export function nameSettlement(lang: Language, rng: Rng, site: SettlementSite = {}, opts: NameOptions = {}): Name {
  const nc = lang.naming;
  const { heads, mods } = siteSplit(site.features);
  const pickHead = () => (heads.length && rng.chance(0.6) ? rng.pick(heads) : weightedConcept(rng, nc.settlementHeads));
  const gen = (): Name | null => {
    const w: [string, number][] = Object.entries(nc.patterns).map(([k, v]) => [k, v]);
    if (site.founder) w.push(["founder", 3]);
    if (site.mother) w.push(["new", 12]);
    const pattern = site.pattern ?? rng.weighted(w);
    switch (pattern) {
      case "founder": {
        if (!site.founder) return null;
        const f = localize(lang, site.founder);
        const given = coreOf(f).roman;
        if (rng.chance(0.55)) {
          const h = pickHead();
          return makeName(lang, "settlement", [cmp(lang, [namePiece(f, given)], [headRoot(lang, h)])], `${given}'s ${en(h)}`);
        }
        return makeName(lang, "settlement", [withAffix(lang, [namePiece(f, given)], "place")], `Place of ${given}`);
      }
      case "new": {
        if (!site.mother) return null;
        const m = localize(lang, site.mother);
        const mp = namePiece(m, m.roman);
        if (rng.chance(0.7)) return makeName(lang, "settlement", adjPhrase(lang, [root(lang, "new")], [mp]), `New ${m.roman}`);
        return makeName(lang, "settlement", [cmp(lang, [root(lang, "new")], [mp])], `New ${m.roman}`);
      }
      case "suffix": {
        const base = mods.length && rng.chance(0.6) ? rng.pick(mods) : randomModifier(rng, new Set(), true, lang);
        return makeName(lang, "settlement", [withAffix(lang, [root(lang, base)], "place")], placeGloss(base));
      }
      case "adjNoun": {
        const adjs = mods.filter(isAdj);
        const adj = adjs.length && rng.chance(0.6) ? rng.pick(adjs) : rng.pick(["white", "red", "black", "green", "old", "new", "high", "fair", "holy", "great", "grey", "golden", "north", "south", "east", "west", "upper", "lower", "far", "cold", "bright", "dark"]);
        const h = pickHead();
        if (rng.chance(nc.phrasal)) return makeName(lang, "settlement", adjPhrase(lang, [root(lang, adj)], [root(lang, h)]), `${en(adj)} ${en(h)}`);
        return makeName(lang, "settlement", [cmp(lang, [root(lang, adj)], [headRoot(lang, h)])], `${en(adj)} ${en(h)}`);
      }
      case "bare": {
        const h = heads.length ? rng.pick(heads) : pickHead();
        const o = lang.lexicon[h].origin;
        const alreadyDim = o.kind === "derived" && o.affix === "dim";
        if (rng.chance(0.5) && !alreadyDim) {
          const dimP = affixPiece(lang, "dim");
          if (dimP) return makeName(lang, "settlement", [withAffix(lang, [root(lang, h)], "dim")], `Little ${en(h)}`);
        }
        const mod = randomModifier(rng, new Set([h]), false, lang);
        return makeName(lang, "settlement", [cmp(lang, [root(lang, mod)], [headRoot(lang, h)])], `${en(mod)} ${en(h)}`);
      }
      case "opaque": {
        const form = generateWord(lang.phonology, rng, rng.int(2, 3));
        const pc: Piece = { form, gloss: "", role: "root" };
        if (rng.chance(0.35)) return makeName(lang, "settlement", [withAffix(lang, [pc], "place")], "");
        return makeName(lang, "settlement", [[pc]], "");
      }
      default: {
        const h = pickHead();
        const excl = new Set([h]);
        const ms = mods.filter((m) => m !== h);
        const mod = ms.length && rng.chance(0.75) ? rng.pick(ms) : randomModifier(rng, excl, false, lang);
        return makeName(lang, "settlement", [cmp(lang, [root(lang, mod)], [headRoot(lang, h)])], `${en(mod)} ${en(h)}`);
      }
    }
  };
  return choose(lang, rng, opts, gen, 11);
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
  const gen = (): Name | null => {
    const r = rng.next();
    if (o.people && r < 0.45) {
      const p = localize(lang, o.people);
      if (p.words.length > 1) {
        // a phrase-name ("Children of the Moon"): "Land of the Children of the Moon"
        const ws = p.words.map((w) => ({ form: w, gloss: "", role: "name" as const }));
        ws[0].gloss = p.roman;
        return makeName(lang, "realm", genitive(lang, [root(lang, rng.chance(0.6) ? "land" : "realm")], ws), `Land of the ${p.roman}`);
      }
      const pp = namePiece(p, p.roman);
      if (rng.chance(0.5) && lang.morphology.affixes.land?.form.length) return makeName(lang, "realm", [withAffix(lang, [pp], "land")], `Land of the ${p.roman}`);
      return makeName(lang, "realm", [cmp(lang, [pp], [root(lang, rng.chance(0.6) ? "land" : "realm")])], `Land of the ${p.roman}`);
    }
    if (o.capital && r < 0.7) {
      const c = localize(lang, o.capital);
      if (c.words.length > 1) return makeName(lang, "realm", genitive(lang, [root(lang, "land")], phrasePieces(c)), `Land of ${c.roman}`);
      return makeName(lang, "realm", [withAffix(lang, [namePiece(c, c.roman)], "land")], `Land of ${c.roman}`);
    }
    if (o.founder && r < 0.8) {
      const f = localize(lang, o.founder);
      const given = coreOf(f).roman;
      return makeName(lang, "realm", [withAffix(lang, [namePiece(f, given)], "land")], `Land of ${given}`);
    }
    const feat = o.feature && CONCEPT_BY_ID[o.feature] ? o.feature : randomModifier(rng, new Set(), false, lang);
    if (rng.chance(0.5)) return makeName(lang, "realm", [withAffix(lang, [root(lang, feat)], "land")], isAdj(feat) ? `${en(feat)} Land` : `Land of ${isMass(feat) ? en(feat) : englishPlural(feat)}`);
    return makeName(lang, "realm", [cmp(lang, [root(lang, feat)], [root(lang, "land")])], `${en(feat)} Land`);
  };
  return choose(lang, rng, o, gen, 12);
}

export interface PeopleOptions extends NameOptions {
  /** Name a people after a place (demonym). */
  place?: Name;
  /** A feature they are associated with ("river", "horse", "forest", …). */
  feature?: string;
}

export function namePeople(lang: Language, rng: Rng, o: PeopleOptions = {}): Name {
  const gen = (): Name | null => {
    if (o.place && rng.chance(0.8)) {
      const p = localize(lang, o.place);
      const pp = namePiece(p, p.roman);
      if (lang.morphology.affixes.demonym?.form.length && rng.chance(0.7)) return makeName(lang, "people", [withAffix(lang, [pp], "demonym")], `People of ${p.roman}`);
      return makeName(lang, "people", [cmp(lang, [pp], [root(lang, "people")])], `${p.roman} Folk`);
    }
    const r = rng.next();
    if (o.feature && CONCEPT_BY_ID[o.feature] && r < 0.5) {
      return makeName(lang, "people", [cmp(lang, [root(lang, o.feature)], [root(lang, "people")])], `${en(o.feature)} Folk`);
    }
    if (r < 0.3) {
      const q = rng.pick(["true", "free", "first", "old", "good", "high", "holy"]);
      return makeName(lang, "people", [cmp(lang, [root(lang, q)], [root(lang, "people")])], `the ${en(q)} People`);
    }
    if (r < 0.5) {
      const anc = rng.pick(["sun", "moon", "star", "wolf", "bear", "eagle", "river", "sea", "stone", "mountain", "horse", "raven", "fire"]);
      const children = withAffix(lang, [root(lang, "child")], "pl");
      return makeName(lang, "people", genitive(lang, children, [root(lang, anc)]), `Children of the ${en(anc)}`);
    }
    // an opaque ethnonym, perhaps with the collective suffix
    const form = generateWord(lang.phonology, rng, 2);
    const pc: Piece = { form, gloss: "", role: "root" };
    return makeName(lang, "people", [rng.chance(0.4) ? withAffix(lang, [pc], "collective") : [pc]], "");
  };
  return choose(lang, rng, o, gen, 11);
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
  const gen = (): Name | null => {
    let head = weightedConcept(rng, spec.heads);
    if (!lang.lexicon[head]) head = spec.heads[0][0];
    const headPieces = (): Piece[] => (spec.plural && rng.chance(0.75) ? withAffix(lang, [root(lang, head)], "pl") : [root(lang, head)]);
    const headEn = (plural: boolean) => (plural ? titleCase(englishPlural(head)) : en(head));
    if (rng.chance(spec.opaque ?? 0.1) && given.length === 0) {
      // ancient, opaque names (hydronyms especially)
      const form = generateWord(lang.phonology, rng, kind === "river" ? rng.int(1, 2) : rng.int(2, 3));
      const pc: Piece = { form, gloss: "", role: "root" };
      if (rng.chance(0.35)) return makeName(lang, kind, [cmp(lang, [pc], headPieces())], "");
      return makeName(lang, kind, [[pc]], "");
    }
    if (kind === "river" && rng.chance(0.08) && given.length === 0) return makeName(lang, kind, [[root(lang, head)]], en(head));
    const pool = spec.mods.filter((m) => lang.lexicon[m]);
    const mod = given.length && rng.chance(0.8) ? rng.pick(given) : rng.pick(pool.length ? pool : ["great"]);
    if (!lang.lexicon[mod]) return null;
    const hp = headPieces();
    const plural = !!spec.plural;
    const gloss = `${en(mod)} ${headEn(plural)}`;
    if (isAdj(mod) && rng.chance(lang.naming.phrasal * 0.8)) return makeName(lang, kind, adjPhrase(lang, [root(lang, mod)], hp), gloss);
    return makeName(lang, kind, [cmp(lang, [root(lang, mod)], hp)], gloss);
  };
  return choose(lang, rng, opts, gen, 13);
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
  moon: ["silent", "white", "pale" as string, "cold", "silver" as string].filter((x) => CONCEPT_BY_ID[x]),
  sky: ["high", "bright", "blue", "great", "eternal"],
  storm: ["fierce", "black", "wild", "great"],
  thunder: ["fierce", "great", "red"],
  sea: ["deep.adj", "dark", "wild", "eternal", "great", "grey"],
  war: ["red", "fierce", "bold", "black", "strong"],
  death: ["dark", "silent", "cold", "black", "pale" as string].filter((x) => CONCEPT_BY_ID[x]),
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
  const gen = (): Name | null => {
    const r = rng.next();
    const dEn = titleCase(en(domain));
    const ofDomain = ARTICLE_DOMAINS.has(domain) ? `the ${dEn}` : dEn;
    if (r < 0.35) {
      const title = fem ? rng.pick(["lady", "queen", "mother"]) : rng.pick(["lord", "king", "father"]);
      const t = lang.lexicon[title] ? title : fem ? "goddess" : "god";
      const g = `${titleCase(en(t))} of ${ofDomain}`;
      if (rng.chance(0.5)) return makeName(lang, "deity", [cmp(lang, [root(lang, domain)], [root(lang, t)])], g);
      return makeName(lang, "deity", genitive(lang, [root(lang, t)], [root(lang, domain)]), g);
    }
    if (r < 0.55 && DOMAIN_VERB[domain] && lang.lexicon[DOMAIN_VERB[domain][0]]) {
      const [v, ing] = DOMAIN_VERB[domain];
      let pcs = withAffix(lang, [root(lang, v)], "agent");
      if (fem && lang.naming.femaleMarking === "suffix") pcs = withAffix(lang, pcs, "fem");
      return makeName(lang, "deity", [pcs], `the ${ing} One`);
    }
    if (r < 0.7) {
      const adj = rng.pick(DOMAIN_ADJ[domain] ?? ["holy", "great", "old", "high", "eternal"]);
      let pcs = cmp(lang, [root(lang, adj)], [root(lang, domain)]);
      if (fem && lang.naming.femaleMarking === "suffix") pcs = withAffix(lang, pcs, "fem");
      return makeName(lang, "deity", [pcs], `${en(adj)} ${en(domain)}`);
    }
    // opaque theonym
    const form = generateWord(lang.phonology, rng, rng.int(2, 3));
    let pcs: Piece[] = [{ form, gloss: "", role: "root" }];
    if (fem && lang.naming.femaleMarking === "suffix") pcs = withAffix(lang, pcs, "fem");
    return makeName(lang, "deity", [pcs], "");
  };
  const n = choose(lang, rng, o, gen, 11);
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
  const gen = (): Name | null => {
    const head = rng.pick(["way", "law", "faith", "truth", "word", "path"]);
    const target = o.deity && rng.chance(0.6) ? localize(lang, o.deity) : o.founder && rng.chance(0.5) ? localize(lang, o.founder) : null;
    if (target) {
      const given = target.kind === "person" || target.words.length <= 1 ? coreOf(target).roman : target.roman;
      if (rng.chance(0.3) && target.words.length <= 1 && lang.morphology.affixes.abstract?.form.length)
        return makeName(lang, "religion", [withAffix(lang, [namePiece(target, given)], "abstract")], `Teaching of ${given}`);
      return makeName(lang, "religion", genitive(lang, [root(lang, head)], phrasePieces(target)), `the ${en(head)} of ${given}`);
    }
    const c = o.concept && lang.lexicon[o.concept] ? o.concept : rng.pick(["light", "sun", "fire", "truth", "star", "moon", "sky", "peace", "blood", "water", "stone", "dawn", "wisdom"]);
    if (rng.chance(0.5)) return makeName(lang, "religion", genitive(lang, [root(lang, head)], [root(lang, c)]), `the ${en(head)} of ${isMass(c) || c === "truth" ? "" : "the "}${en(c)}`);
    return makeName(lang, "religion", [cmp(lang, [root(lang, c)], [root(lang, head)])], `${en(c)} ${en(head)}`);
  };
  return choose(lang, rng, o, gen, 14);
}

export interface DynastyOptions extends NameOptions {
  founder?: Name;
  seat?: Name;
}

export function nameDynasty(lang: Language, rng: Rng, o: DynastyOptions = {}): Name {
  const gen = (): Name | null => {
    const useFounder = o.founder && (!o.seat || rng.chance(0.65));
    const src = useFounder ? localize(lang, o.founder!) : o.seat ? localize(lang, o.seat) : null;
    const label = src ? coreOf(src).roman : "";
    const sp: Piece = src ? namePiece(src, label) : { form: generateWord(lang.phonology, rng, 2), gloss: "", role: "root" };
    if (lang.naming.dynastyStyle === "suffix" && lang.morphology.affixes.dynasty?.form.length && useFounder !== false)
      return makeName(lang, "dynasty", [withAffix(lang, [sp], "dynasty")], label ? `Kin of ${label}` : "");
    return makeName(lang, "dynasty", genitive(lang, [root(lang, "house")], [sp]), label ? `House of ${label}` : "");
  };
  return choose(lang, rng, o, gen, 14);
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

function givenName(lang: Language, rng: Rng, fem: boolean): Name {
  const nc = lang.naming;
  const femSuffix = fem && nc.femaleMarking === "suffix";
  const els = nc.firstElements.filter((e) => lang.lexicon[e]);
  const seconds = (fem && nc.femaleMarking === "elements" ? nc.femaleElements : nc.secondElements).filter((e) => lang.lexicon[e]);
  const gen = (): Name => {
    const style = nc.personStyle;
    const r = rng.next();
    if (style === "opaque" || r < 0.12) {
      const form = generateWord(lang.phonology, rng, rng.int(nc.maleEnding && !fem ? 1 : 2, 2), { openFinal: femSuffix });
      let pcs: Piece[] = [{ form, gloss: "", role: "root" }];
      if (femSuffix) pcs = withAffix(lang, pcs, "fem");
      else if (!fem && nc.maleEnding?.length && rng.chance(0.8)) pcs = [...pcs, { form: nc.maleEnding, gloss: "", role: "link" }];
      return makeName(lang, "person", [pcs], "");
    }
    if (style === "dithematic" && seconds.length && els.length) {
      let a = rng.pick(els);
      let b = rng.pick(seconds);
      if (a === b) a = rng.pick(els);
      let pcs = cmp(lang, [root(lang, a)], [root(lang, b)]);
      if (femSuffix) pcs = withAffix(lang, pcs, "fem");
      return makeName(lang, "person", [pcs], `${titleCase(en(a))}-${titleCase(en(b))}`);
    }
    if (style === "descriptive") {
      // "Swift Deer", "White Dove": a quality and a living or natural thing
      const adj = rng.pick(fem ? ["bright", "white", "fair", "golden", "gentle", "sweet", "swift", "red", "silent"] : ["swift", "bright", "red", "white", "black", "strong", "wise", "bold", "high", "golden", "dark", "free", "fierce", "lonely"]);
      const pool = (fem ? DESCRIPTIVE_F : DESCRIPTIVE_M).filter((x) => lang.lexicon[x]);
      const noun = rng.pick(pool.length ? pool : ["wolf"]);
      let pcs = cmp(lang, [root(lang, adj)], [root(lang, noun)]);
      if (femSuffix) pcs = withAffix(lang, pcs, "fem");
      return makeName(lang, "person", [pcs], `${en(adj)} ${en(noun)}`);
    }
    // monothematic: one element, perhaps a hypocoristic suffix
    const pool0 = (fem && nc.femaleMarking === "elements" ? nc.femaleElements : els).filter((x) => lang.lexicon[x] && !NOT_A_NAME.has(x));
    const pool = pool0.length ? pool0 : ["wolf"];
    const a = rng.pick(pool);
    let pcs: Piece[] = [root(lang, a)];
    let gloss = en(a);
    if (rng.chance(0.15)) {
      pcs = withAffix(lang, pcs, "dim");
      gloss = `Little ${gloss}`;
    }
    if (femSuffix) pcs = withAffix(lang, pcs, "fem");
    else if (!fem && nc.maleEnding?.length && rng.chance(0.8)) pcs = [...pcs, { form: nc.maleEnding, gloss: "", role: "link" }];
    return makeName(lang, "person", [pcs], gloss);
  };
  return gen();
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
    const weights = list.map((_, i) => 1 / Math.pow(i + 1, 0.85));
    given = list[rng.weightedIndex(weights)];
  }
  if (!given) {
    const taken = new Set([...pool.m, ...pool.f].map((n) => n.roman.toLowerCase()));
    let best: Name | null = null;
    let bestScore = Infinity;
    for (let t = 0; t < 8; t++) {
      const n = givenName(lang, rng, fem);
      if (taken.has(n.roman.toLowerCase())) continue;
      const s = ugliness(n.roman) + lengthPenalty(n, 9);
      if (s < bestScore) {
        best = n;
        bestScore = s;
      }
      if (s < 0.5) break;
    }
    given = best ?? givenName(lang, rng, fem);
    list.push(given);
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
    const pcs = verb ? withAffix(lang, [root(lang, e)], "agent") : [root(lang, e)];
    const epWords = lang.morphology.articles ? withParticle(lang, pcs, "def") : [pcs];
    if (lang.morphology.adjOrder === "AN" && !verb && rng.chance(0.5)) {
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
  const pcs = verb ? withAffix(lang, [root(lang, e)], "agent") : [root(lang, e)];
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
        ? [[withAffix(lang, [root(lang, "king")], "aug")], "Great King"]
        : [[cmp(lang, [root(lang, "great")], [root(lang, "king")])], "Great King"],
    chief: () => [[[root(lang, "chief")]], "Chief"],
    priest: () => [[[root(lang, "priest")]], "Priest"],
    noble: () => [[[root(lang, "lord")]], "Lord"],
    general: () => [[cmp(lang, [root(lang, "war")], [root(lang, "lord")])], "War-Lord"],
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
    ps.forEach((p, i) => {
      if (i > 0 && p.role !== "link" && ps[i - 1].role !== "link") s += "-";
      s += p.roman;
    });
    words.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  return words.join(" ");
}

export { romanizeWord };
