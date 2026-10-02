/**
 * Naming culture: which settlement heads a people favours (the "-ton/-by/
 * -grad/-abad" that gives a toponymy its look), how persons are named
 * (dithematic Wulf-gar, monothematic, descriptive, opaque), patronymics,
 * epithets and dynasty styles.
 */
import type { Rng } from "../core/rng";
import { conceptsWithTag } from "./concepts";
import { clipWord } from "./morphology";
import { nuclei } from "./phonology";
import type { NamingHints } from "./styles";
import type { Lexeme, Morphology, NamingCulture, Phonology } from "./types";
import { key } from "./util";
import { generateAffix } from "./wordgen";

/** k items without replacement, weighted. */
function weightedSample<T>(rng: Rng, items: readonly T[], weight: (x: T) => number, k: number): T[] {
  const pool = items.slice();
  const ws = pool.map(weight);
  const out: T[] = [];
  while (out.length < k && pool.length) {
    const i = rng.weightedIndex(ws);
    out.push(pool[i]);
    pool.splice(i, 1);
    ws.splice(i, 1);
  }
  return out;
}

export interface CultureContext {
  phonology: Phonology;
  lexicon: Record<string, Lexeme>;
}

const SETTLEMENT_HEADS = [
  "town", "home", "stead", "fort", "hall", "field", "ford", "bridge", "hill", "well", "wall", "gate", "harbor", "mouth",
  "valley", "farm", "place", "camp", "grove", "mound", "spring", "rock", "seat", "garden", "market", "temple", "village", "city", "house", "tower",
];

const SECOND_ELEMENTS = [
  "guard.n", "king", "lord", "spear", "sword", "shield", "helm", "wolf", "bear", "friend", "gift", "peace", "battle", "war",
  "glory", "fame", "victory", "strength", "power", "heart", "hand", "will", "counsel", "home", "stone", "fire", "light", "people", "god", "son",
];

const FEMALE_ELEMENTS = conceptsWithTag("fem");

export function generateNamingCulture(rng: Rng, mo: Morphology, hints: NamingHints = {}, ctx?: CultureContext): NamingCulture {
  // Short words make good name elements: toponymic heads and name themes are overwhelmingly monosyllables in real languages.
  const syl = (c: string) => (ctx?.lexicon[c] ? Math.max(1, nuclei(ctx.lexicon[c].form).length) : 2);
  const shortW = (c: string) => 1 / Math.pow(syl(c), 1.7);
  const heads = weightedSample(rng, SETTLEMENT_HEADS, shortW, rng.int(7, 11));
  const settlementHeads: [string, number][] = heads.map((h, i) => [h, +(1 / Math.pow(i + 1, 0.5)).toFixed(3)]);
  const nameEls = conceptsWithTag("name");
  const personStyle = rng.weighted<NamingCulture["personStyle"]>(
    hints.person ?? [
      ["dithematic", 0.38],
      ["monothematic", 0.27],
      ["descriptive", 0.15],
      ["opaque", 0.2],
    ],
  );
  const firstElements = weightedSample(rng, nameEls, shortW, rng.int(14, 24));
  const secondElements = weightedSample(rng, SECOND_ELEMENTS, shortW, rng.int(8, 14));
  const femaleElements = weightedSample(rng, FEMALE_ELEMENTS, shortW, rng.int(6, 12));
  const nc: NamingCulture = {
    settlementHeads,
    patterns: {
      compound: rng.range(2.5, 4.5),
      suffix: rng.range(0.3, 1.3),
      adjNoun: rng.range(0.6, 2),
      bare: rng.range(0.2, 0.6),
      founder: rng.range(0.2, 0.8),
      opaque: rng.range(0.3, 1.2),
    },
    personStyle,
    femaleMarking: mo.gender ? (rng.chance(0.75) ? "suffix" : "elements") : rng.chance(0.6) ? "elements" : "none",
    firstElements,
    secondElements,
    femaleElements,
    patronymic: rng.weighted<NamingCulture["patronymic"]>(
      hints.patronymic ?? [
        ["suffix", 0.35],
        ["prefix", 0.12],
        ["particle", 0.2],
        ["none", 0.33],
      ],
    ),
    epithetChance: rng.range(0.12, 0.35),
    dynastyStyle: hints.dynasty ? rng.weighted(hints.dynasty) : rng.chance(0.6) ? "suffix" : "house",
    reuse: rng.range(0.45, 0.8),
    phrasal: rng.range(0.05, 0.4),
  };
  if (ctx) {
    // Long favourite heads erode into clipped combining forms in toponyms.
    const forms: Record<string, ReturnType<typeof clipWord>> = {};
    for (const [h] of settlementHeads.slice(0, 3)) {
      const n = syl(h);
      if (n >= 3 || (n === 2 && rng.chance(0.35))) {
        const f = clipWord(ctx.phonology, ctx.lexicon[h].form);
        if (f.length >= 2) forms[h] = f;
      }
    }
    if (Object.keys(forms).length) nc.headForms = forms;
    // A characteristic ending of men's names (-us, -os, -an) in some cultures.
    if (rng.chance(0.4) && ctx.phonology.vowels.length) {
      const hasCodas = ctx.phonology.finals.length > 0;
      const e = generateAffix(ctx.phonology, rng, hasCodas ? [["VC", 3], ["V", 1]] : [["V", 2], ["CV", 1]], new Set(Object.values(mo.affixes).map((a) => key(a!.form))));
      if (e.length) nc.maleEnding = e;
    }
  }
  return nc;
}

/** A daughter's naming culture drifts: favourite heads change, weights jitter. */
export function driftNamingCulture(nc: NamingCulture, rng: Rng): NamingCulture {
  const out: NamingCulture = JSON.parse(JSON.stringify(nc)) as NamingCulture;
  if (rng.chance(0.7)) {
    const cand = SETTLEMENT_HEADS.filter((h) => !out.settlementHeads.some(([x]) => x === h));
    const n = rng.int(1, 2);
    for (let i = 0; i < n && cand.length; i++) {
      const idx = rng.int(0, out.settlementHeads.length - 1);
      const nh = cand.splice(rng.int(0, cand.length - 1), 1)[0];
      out.settlementHeads[idx] = [nh, out.settlementHeads[idx][1]];
    }
    // the new favourite might become the top one
    if (rng.chance(0.4)) {
      const i = rng.int(0, out.settlementHeads.length - 1);
      const [h] = out.settlementHeads.splice(i, 1);
      out.settlementHeads.unshift([h[0], 1]);
      out.settlementHeads = out.settlementHeads.map(([x], j) => [x, +(1 / Math.pow(j + 1, 0.9)).toFixed(3)]);
    }
  }
  for (const k of Object.keys(out.patterns)) out.patterns[k] *= Math.exp(rng.normal(0, 0.25));
  if (rng.chance(0.15)) out.personStyle = rng.pick(["dithematic", "monothematic", "descriptive", "opaque"] as const);
  if (rng.chance(0.2)) out.patronymic = rng.pick(["suffix", "prefix", "particle", "none"] as const);
  if (rng.chance(0.3)) out.secondElements = [...out.secondElements.slice(1), rng.pick(SECOND_ELEMENTS)];
  if (out.headForms) {
    for (const h of Object.keys(out.headForms)) if (!out.settlementHeads.some(([x]) => x === h)) delete out.headForms[h];
    if (!Object.keys(out.headForms).length) delete out.headForms;
  }
  return out;
}
