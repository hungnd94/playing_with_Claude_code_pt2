/**
 * Language contact: lexical borrowing. When peoples trade, conquer or are
 * conquered, words cross — overwhelmingly cultural vocabulary (titles,
 * buildings, metals, crops, weapons, law and faith), rarely the core words.
 * Loans are adapted to the borrower's sounds and phonotactics, so its
 * phonology stays valid; their etymology reads "borrowed from Ashkari", and
 * they start a new line of descent (`since`), so they are never mistaken for
 * cognates of the donor's word in comparative tables.
 */
import type { Rng } from "../core/rng";
import { CONCEPT_BY_ID, CONCEPTS } from "./concepts";
import { adaptWord } from "./etymology";
import type { Language, Lexeme } from "./types";

/** Concept tags that are typically borrowed. */
const LOAN_TAGS = new Set(["role", "build", "material", "object", "weapon", "tool", "crop", "abstract"]);
/** Never borrowed: function words, pronouns, numerals below ten, kin terms, body parts. */
const NEVER = new Set(["I", "you", "he", "we", "you.pl", "they", "and", "not", "all", "this", "that", "one", "two", "three", "four", "five", "people", "word", "name"]);

export interface LoanOptions {
  /** How many words to borrow (default 1.5–4 % of the lexicon). */
  count?: number;
  /** Borrow exactly these concepts (when the donor has them). */
  concepts?: string[];
  /** Weight for cultural vocabulary vs. the rest (default 6). */
  cultural?: number;
}

/** The lexicon entries `lang` would take over from `donor` (not applied). */
export function loanwords(lang: Language, donor: Language, rng: Rng, opts: LoanOptions = {}): { concept: string; lexeme: Lexeme }[] {
  if (lang.id === donor.id) return [];
  const cultural = opts.cultural ?? 6;
  const ids = (opts.concepts ?? CONCEPTS.map((c) => c.id)).filter((c) => lang.lexicon[c] && donor.lexicon[c] && !NEVER.has(c));
  const already = (c: string) => {
    const o = lang.lexicon[c].origin;
    return o.kind === "borrowed" && o.lang === donor.id;
  };
  const pool = ids.filter((c) => !already(c));
  const weights = pool.map((c) => {
    const k = CONCEPT_BY_ID[c];
    if (!k || k.tags.includes("kin") || k.tags.includes("body")) return opts.concepts ? 1 : 0.05;
    const w = k.tags.some((t) => LOAN_TAGS.has(t)) ? cultural : 1;
    const pos = k.pos === "n" ? 1 : k.pos === "adj" ? 0.4 : k.pos === "v" ? 0.2 : 0.05;
    return w * pos * (k.tier === 1 ? 0.15 : k.tier === 2 ? 1 : 1.4);
  });
  const n = Math.min(pool.length, opts.concepts ? pool.length : opts.count ?? Math.round(CONCEPTS.length * rng.range(0.015, 0.04)));
  const out: { concept: string; lexeme: Lexeme }[] = [];
  while (out.length < n && pool.length) {
    const i = rng.weightedIndex(weights);
    const c = pool[i];
    pool.splice(i, 1);
    weights.splice(i, 1);
    const form = adaptWord(donor.lexicon[c].form, lang);
    if (!form.length) continue;
    out.push({ concept: c, lexeme: { form, origin: { kind: "borrowed", lang: donor.id, langName: donor.name }, since: `${lang.id}<${donor.id}` } });
  }
  return out;
}

/**
 * A copy of `lang` with loanwords from `donor` in its lexicon (everything else
 * shared). To borrow in place instead: `for (const { concept, lexeme } of
 * loanwords(lang, donor, rng)) lang.lexicon[concept] = lexeme;`.
 */
export function withLoanwords(lang: Language, donor: Language, rng: Rng, opts: LoanOptions = {}): Language {
  const loans = loanwords(lang, donor, rng, opts);
  const lexicon = { ...lang.lexicon };
  for (const { concept, lexeme } of loans) lexicon[concept] = lexeme;
  return { ...lang, lexicon };
}
