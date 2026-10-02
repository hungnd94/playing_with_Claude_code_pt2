/**
 * Naming culture: which settlement heads a people favours (the "-ton/-by/
 * -grad/-abad" that gives a toponymy its look), how persons are named
 * (dithematic Wulf-gar, monothematic, descriptive, opaque), patronymics,
 * epithets and dynasty styles.
 */
import type { Rng } from "../core/rng";
import { conceptsWithTag } from "./concepts";
import type { Morphology, NamingCulture } from "./types";

const SETTLEMENT_HEADS = [
  "town", "home", "stead", "fort", "hall", "field", "ford", "bridge", "hill", "well", "wall", "gate", "harbor", "mouth",
  "valley", "farm", "place", "camp", "grove", "mound", "spring", "rock", "seat", "garden", "market", "temple", "village", "city", "house", "tower",
];

const SECOND_ELEMENTS = [
  "guard.n", "king", "lord", "spear", "sword", "shield", "helm", "wolf", "bear", "friend", "gift", "peace", "battle", "war",
  "glory", "fame", "victory", "strength", "power", "heart", "hand", "will", "counsel", "home", "stone", "fire", "light", "people", "god", "son",
];

const FEMALE_ELEMENTS = conceptsWithTag("fem");

export function generateNamingCulture(rng: Rng, mo: Morphology): NamingCulture {
  const heads = rng.sample(SETTLEMENT_HEADS, rng.int(7, 11));
  const settlementHeads: [string, number][] = heads.map((h, i) => [h, +(1 / Math.pow(i + 1, 0.5)).toFixed(3)]);
  const nameEls = conceptsWithTag("name");
  const personStyle = rng.weighted<NamingCulture["personStyle"]>([
    ["dithematic", 0.38],
    ["monothematic", 0.27],
    ["descriptive", 0.15],
    ["opaque", 0.2],
  ]);
  const firstElements = rng.sample(nameEls, rng.int(14, 24));
  const secondElements = rng.sample(SECOND_ELEMENTS, rng.int(8, 14));
  const femaleElements = rng.sample(FEMALE_ELEMENTS, rng.int(6, 12));
  return {
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
    patronymic: rng.weighted<NamingCulture["patronymic"]>([
      ["suffix", 0.35],
      ["prefix", 0.12],
      ["particle", 0.2],
      ["none", 0.33],
    ]),
    epithetChance: rng.range(0.12, 0.35),
    dynastyStyle: rng.chance(0.6) ? "suffix" : "house",
    reuse: rng.range(0.45, 0.8),
    phrasal: rng.range(0.05, 0.4),
  };
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
  return out;
}
