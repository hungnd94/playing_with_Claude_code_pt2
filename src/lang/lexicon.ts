/**
 * Lexicon construction: roots for every concept, and derived vocabulary built
 * from recipes (compounds and affixations) so that a language's words have
 * internal etymologies ("sea" = great+water, "queen" = king-FEM).
 */
import type { Rng } from "../core/rng";
import { CONCEPTS, CONCEPT_BY_ID, type Concept } from "./concepts";
import { affixWord, compound } from "./morphology";
import { nuclei } from "./phonology";
import type { AffixKind, Language, LexOrigin, Lexeme, Morphology, Phonology, Word } from "./types";
import { key } from "./util";
import { generateRoot, generateWord } from "./wordgen";

const RECIPE_AFFIX: Record<string, AffixKind> = {
  dim: "dim",
  aug: "aug",
  fem: "fem",
  agt: "agent",
  abs: "abstract",
  plc: "place",
  adj: "adj",
};

export interface ParsedRecipe {
  kind: "compound" | "affix";
  parts: string[];
  affix?: AffixKind;
}

export function parseRecipe(r: string): ParsedRecipe {
  const [k, rest] = r.split(":");
  if (k === "cmp") return { kind: "compound", parts: rest.split("+") };
  return { kind: "affix", parts: [rest], affix: RECIPE_AFFIX[k] ?? "dim" };
}

// Validate recipes at load time.
for (const c of CONCEPTS) {
  for (const r of c.recipes ?? []) {
    const p = parseRecipe(r);
    for (const x of p.parts) if (!CONCEPT_BY_ID[x]) throw new Error(`recipe ${r} for ${c.id} references unknown concept ${x}`);
  }
}

/** Decide which concepts get recipe-built words; returns concept → recipe. */
export function planDerivations(rng: Rng): Record<string, string> {
  const plan: Record<string, string> = {};
  const usedRecipes = new Set<string>();
  for (const c of CONCEPTS) {
    if (!c.recipes?.length) continue;
    const p = c.tier === 1 ? 0.18 : c.tier === 2 ? 0.32 : 0.48;
    if (!rng.chance(p)) continue;
    const r = rng.pick(c.recipes);
    if (usedRecipes.has(r)) continue;
    // no recipe may depend on a concept that is itself derived from this one
    const deps = parseRecipe(r).parts;
    if (deps.some((d) => plan[d] && parseRecipe(plan[d]).parts.includes(c.id))) continue;
    plan[c.id] = r;
    usedRecipes.add(r);
  }
  // break chains deeper than two levels and cycles
  for (const id of Object.keys(plan)) {
    const seen = new Set<string>([id]);
    let frontier = parseRecipe(plan[id]).parts;
    let depth = 0;
    while (frontier.length && depth < 4) {
      const next: string[] = [];
      for (const f of frontier) {
        if (seen.has(f)) {
          delete plan[id];
          next.length = 0;
          break;
        }
        seen.add(f);
        if (plan[f]) next.push(...parseRecipe(plan[f]).parts);
      }
      if (!plan[id]) break;
      frontier = next;
      depth++;
    }
    if (plan[id] && depth >= 3) delete plan[id];
  }
  return plan;
}

/** Generate a root for every concept that is not derived. */
export function generateRoots(ph: Phonology, rng: Rng, plan: Record<string, string>): Record<string, Word> {
  const roots: Record<string, Word> = {};
  const avoid = new Set<string>();
  // Generate tier 1 first so the commonest words get the shortest, most typical shapes.
  const order: Concept[] = [...CONCEPTS].sort((a, b) => a.tier - b.tier);
  for (const c of order) {
    if (plan[c.id]) continue;
    // pronouns and function words: one syllable
    const w = c.pos === "pron" || c.pos === "func" ? generateWord(ph, rng, 1, { avoid }) : generateRoot(ph, rng, c.tier, avoid);
    avoid.add(key(w));
    roots[c.id] = w;
  }
  return roots;
}

interface LangCore {
  phonology: Phonology;
  morphology: Morphology;
}

/** Build a word from a recipe given the forms of its parts. */
export function realizeRecipe(lang: LangCore, recipe: string, formOf: (id: string) => Word | undefined): Lexeme | null {
  const r = parseRecipe(recipe);
  if (r.kind === "compound") {
    const a = formOf(r.parts[0]);
    const b = formOf(r.parts[1]);
    if (!a || !b) return null;
    const j = compound(lang, a, b);
    return { form: j.word, origin: { kind: "compound", parts: r.parts } };
  }
  const base = formOf(r.parts[0]);
  const aff = lang.morphology.affixes[r.affix!];
  if (!base || !aff) return null;
  const j = affixWord(lang, base, aff);
  return { form: j.word, origin: { kind: "derived", base: r.parts[0], affix: r.affix! } };
}

/** Assemble the full lexicon from roots and the derivation plan. */
export function assembleLexicon(lang: LangCore, roots: Record<string, Word>, plan: Record<string, string>, rng: Rng): Record<string, Lexeme> {
  const lex: Record<string, Lexeme> = {};
  const formOf = (id: string): Word | undefined => lex[id]?.form ?? roots[id];
  const pending = CONCEPTS.map((c) => c.id).filter((id) => plan[id]);
  // resolve in dependency order
  let guard = 0;
  const done = new Set<string>(Object.keys(roots));
  while (pending.length && guard++ < 10) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const id = pending[i];
      const deps = parseRecipe(plan[id]).parts;
      if (!deps.every((d) => done.has(d))) continue;
      const lx = realizeRecipe(lang, plan[id], formOf);
      if (lx && nuclei(lx.form).length <= 5) lex[id] = lx;
      done.add(id);
      pending.splice(i, 1);
    }
  }
  const out: Record<string, Lexeme> = {};
  const avoid = new Set<string>(Object.values(roots).map(key));
  for (const c of CONCEPTS) {
    if (lex[c.id]) out[c.id] = lex[c.id];
    else if (roots[c.id]) out[c.id] = { form: roots[c.id], origin: { kind: "root" } };
    else {
      // recipe failed: fall back to a fresh root
      const w = generateRoot(lang.phonology, rng, c.tier, avoid);
      avoid.add(key(w));
      out[c.id] = { form: w, origin: { kind: "root" } };
    }
  }
  return out;
}

/** The form of a concept in a language. Throws for unknown concepts. */
export function wordFor(lang: Language, conceptId: string): Word {
  const lx = lang.lexicon[conceptId];
  if (!lx) throw new Error(`language ${lang.id} has no word for "${conceptId}"`);
  return lx.form;
}

export function originText(o: LexOrigin): string {
  switch (o.kind) {
    case "root":
      return "root";
    case "inherited":
      return "inherited";
    case "compound":
      return `compound of ${o.parts.map((p) => `'${CONCEPT_BY_ID[p]?.en ?? p}'`).join(" + ")}`;
    case "derived":
      return `'${CONCEPT_BY_ID[o.base]?.en ?? o.base}' + ${o.affix} suffix`;
    case "coined":
      return "new coinage of unknown origin";
    case "shift":
      return `semantic shift from '${CONCEPT_BY_ID[o.from]?.en ?? o.from}'`;
    case "borrowed":
      return `borrowed from ${o.langName}`;
  }
}
