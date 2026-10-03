/**
 * Heraldic styles: the tastes of a heraldic tradition — favoured tinctures,
 * divisions, ordinaries, charges and lines, how complex arms get, and the
 * shape of shield painters prefer. A few hand-made presets evoke real
 * traditions; `randomStyle` invents a coherent new one for a generated culture.
 */
import type { Rng } from "../core/rng";
import type { ChargeId, Line, OrdinaryKind, Partition, ShieldShape, Tint } from "./types";
import type { ChargeCategory } from "./charges/art";
import { CHARGES, ALL_CHARGE_IDS } from "./charges/index";

export interface HeraldryStyle {
  name: string;
  /** Relative weights for tinctures (multiplied with the historical base frequencies). */
  tinctures?: Partial<Record<Tint, number>>;
  /** 0 = sparse early heraldry, 1 = late baroque accretion. */
  complexity: number;
  /** Multipliers for partitions of the field. */
  partitions?: Partial<Record<Partition, number>>;
  /** Multipliers for ordinaries. */
  ordinaries?: Partial<Record<OrdinaryKind, number>>;
  /** Multipliers for individual charges. */
  charges?: Partial<Record<ChargeId, number>>;
  /** Multipliers for charge categories (beast, bird, geometric, cross, …). */
  categories?: Partial<Record<ChargeCategory, number>>;
  /** Multipliers for lines of partition (straight included). */
  lines?: Partial<Record<Line, number>>;
  /** Overall weights for the kind of design: ordinary-based, charge-based, divided field, variation, semé. */
  plans?: Partial<Record<"ordinary" | "charges" | "divided" | "variation" | "semy", number>>;
  /** Probability multipliers for chief, bordure, canton. */
  chief?: number;
  bordure?: number;
  canton?: number;
  /** Probability multiplier for furs. */
  furs?: number;
  /** Multiplier for the chance that an ordinary is charged ("on a fess three…"). */
  chargedOrdinary?: number;
  /** Probability of a deliberate breach of the rule of tincture (default 0.012). */
  exceptions?: number;
  /** The shield shape this tradition paints. */
  shape: ShieldShape;
}

export const STYLES = {
  /** English rolls of arms, c. 1250–1400: ordinaries, lions, crosses, chevrons, escallops, martlets. */
  anglo: {
    name: "anglo",
    complexity: 0.4,
    shape: "heater",
    charges: { lion: 1.6, escallop: 1.6, martlet: 1.8, crossCrosslet: 1.4, crossPatty: 1.3, mullet: 1.2, rose: 1.4, wheat: 1.2 },
    ordinaries: { chevron: 1.5, fess: 1.3, bend: 1.2 },
    chief: 1.2,
    canton: 1.4,
  },
  /** French armory: azure and or, fleurs-de-lis, semé, bordures, the square "French" shield. */
  french: {
    name: "french",
    complexity: 0.45,
    shape: "french",
    tinctures: { azure: 1.8, or: 1.5, gules: 1, argent: 0.9 },
    charges: { fleurDeLis: 3, mullet: 1.3, crescent: 1.2, tower: 1.4, lion: 1.1, eagle: 0.7 },
    plans: { semy: 3, divided: 1.1 },
    bordure: 2,
    chief: 1.4,
  },
  /** German and Swiss heraldry: bold divisions, eagles, few tinctures, the tournament shield. */
  germanic: {
    name: "germanic",
    complexity: 0.3,
    shape: "german",
    tinctures: { or: 1.4, sable: 2, gules: 1.3, argent: 1.1, azure: 0.8, vert: 0.6 },
    partitions: { perFess: 2, perPale: 1.5, bendy: 1.6, barry: 1.4, chequy: 1.4, perBend: 1.3 },
    charges: { eagle: 3.5, lion: 1.3, horn: 2.5, wheel: 1.8, key: 1.6, fish: 1.6, bear: 2, stag: 1.6, tree: 1.3 },
    plans: { divided: 2, variation: 1.6, ordinary: 0.7 },
    chief: 0.6,
    bordure: 0.25,
    lines: { embattled: 1.8, indented: 1.4 },
  },
  /** Iberian armory: castles, lions, charged bordures, quarterings, the round-based shield. */
  iberian: {
    name: "iberian",
    complexity: 0.65,
    shape: "iberian",
    tinctures: { gules: 1.5, or: 1.4, argent: 1, azure: 1, vert: 1.2 },
    charges: { castle: 3, tower: 2.4, lion: 1.6, wolf: 2, tree: 1.6, crossFlory: 2, roundel: 1.5, star: 1.4, key: 1.2 },
    bordure: 3.2,
    plans: { charges: 1.4, divided: 1.2 },
  },
  /** Italian civic and family arms: chiefs, roundels, stars, mounts and the oval cartouche. */
  italian: {
    name: "italian",
    complexity: 0.5,
    shape: "oval",
    tinctures: { azure: 1.4, or: 1.3, gules: 1.2, argent: 1 },
    charges: { roundel: 2.2, star: 2, mullet: 1.6, mountain: 2.5, tower: 1.5, eagle: 1.5, lion: 1.2, fleurDeLis: 1.4, crown: 1.4 },
    chief: 2.4,
    partitions: { perPale: 1.6, perFess: 1.5, bendy: 1.3 },
  },
  /** Northern seafaring arms: waves, ships, fish, beasts and birds of the north, simple forms. */
  nordic: {
    name: "nordic",
    complexity: 0.25,
    shape: "round",
    tinctures: { azure: 1.6, argent: 1.3, gules: 1.1, or: 1, sable: 1 },
    charges: { ship: 3.5, wave: 3, fish: 2.5, raven: 3, bear: 2.4, wolf: 2, axe: 2.4, hammer: 2, pine: 2, anchor: 1.6, falcon: 1.4, horn: 1.4 },
    lines: { wavy: 3, nebuly: 1.5 },
    partitions: { perFess: 1.4 },
    plans: { charges: 1.6, ordinary: 0.8 },
    chief: 0.4,
    canton: 0.2,
  },
  /** Church and religious orders: crosses, keys, crowns, chalices, roses; vesica-friendly forms. */
  ecclesiastical: {
    name: "ecclesiastical",
    complexity: 0.45,
    shape: "lozenge",
    tinctures: { azure: 1.4, argent: 1.4, or: 1.3, purpure: 4, gules: 1, sable: 0.8 },
    categories: { cross: 3, beast: 0.4, weapon: 0.3 },
    charges: { key: 4, crown: 2.4, cup: 3, rose: 2.4, star: 2, heart: 2, eye: 2, bell: 2.6, sun: 2, moon: 1.6, flame: 1.8, fleurDeLis: 1.4, lion: 0.5 },
    ordinaries: { cross: 3, saltire: 1.6, pall: 4 },
  },
  /** Steppe and desert peoples: crescents, suns, stars, horses and falcons on bright fields. */
  steppe: {
    name: "steppe",
    complexity: 0.3,
    shape: "round",
    tinctures: { vert: 3, or: 1.6, argent: 1.2, sanguine: 2.5, azure: 1.2, gules: 1, tenne: 2 },
    charges: { crescent: 3.5, sun: 3, star: 2.5, horse: 4, falcon: 3.5, spear: 2.2, sword: 1.6, mullet: 1.6, wheel: 1.4, flame: 1.4 },
    plans: { charges: 2, ordinary: 0.5, divided: 0.9 },
    chief: 0.3,
    bordure: 1.2,
    lines: { indented: 2, dancetty: 2 },
  },
  /**
   * Blazons of a sultanate's officers, in the manner of the Mamluks: round shields,
   * fields tierced in fess, the middle band charged with the badge of an office —
   * a cup, a sword, a horn — and crescents, fleurs-de-lis, eagles and lions passant.
   */
  saracenic: {
    name: "saracenic",
    complexity: 0.2,
    shape: "round",
    tinctures: { or: 1.6, gules: 1.4, sable: 1.3, argent: 1.1, azure: 1.2, vert: 0.8 },
    partitions: { tiercedInFess: 14, perFess: 2 },
    ordinaries: { fess: 7, pale: 0.4, chevron: 0.2, saltire: 0.3, cross: 0.3, bend: 0.6 },
    charges: { cup: 8, crescent: 4, sword: 3, horn: 3, fleurDeLis: 3, eagle: 2.5, lion: 1.4, rose: 2.5, star: 1.6, key: 1.2 },
    categories: { cross: 0.05, beast: 0.5, monster: 0.3 },
    plans: { ordinary: 1.6, divided: 1.2, variation: 0.2, semy: 0.1, charges: 1 },
    chargedOrdinary: 4,
    chief: 0.1,
    bordure: 0.2,
    canton: 0.05,
    furs: 0.05,
    lines: { straight: 3 },
  },
  /** Late, ornate heraldry: many charged ordinaries, chiefs, cantons and quarterings. */
  baroque: {
    name: "baroque",
    complexity: 0.9,
    shape: "french",
    chief: 1.8,
    bordure: 1.4,
    canton: 1.6,
    plans: { ordinary: 1.2, divided: 1.3 },
  },
} satisfies Record<string, HeraldryStyle>;

export type StyleName = keyof typeof STYLES;

export function resolveStyle(s: HeraldryStyle | StyleName | undefined): HeraldryStyle {
  if (!s) return STYLES.anglo as HeraldryStyle;
  if (typeof s === "string") return (STYLES[s] as HeraldryStyle) ?? (STYLES.anglo as HeraldryStyle);
  return s;
}

const SHAPES_FOR_RANDOM: ShieldShape[] = ["heater", "heater", "heater", "french", "iberian", "oval", "round", "german", "swiss", "lozenge"];

/**
 * Invent a coherent heraldic tradition: a few favourite tinctures, charges and
 * lines, a preferred complexity and shield shape. Deterministic in `rng`.
 */
export function randomStyle(rng: Rng, name = "invented"): HeraldryStyle {
  const tinctures: Partial<Record<Tint, number>> = {};
  const tintPool: Tint[] = ["or", "argent", "gules", "azure", "vert", "sable", "purpure", "tenne", "sanguine"];
  for (const t of rng.sample(tintPool, rng.int(2, 4))) tinctures[t] = rng.range(1.6, 3.5);
  if (rng.chance(0.3)) tinctures[rng.pick(["purpure", "tenne", "sanguine"] as Tint[])] = rng.range(1.5, 3);
  const charges: Partial<Record<ChargeId, number>> = {};
  const ids = ALL_CHARGE_IDS.filter((id) => CHARGES[id]);
  for (const id of rng.sample(ids, rng.int(4, 9))) charges[id] = rng.range(2.5, 6);
  const categories: Partial<Record<ChargeCategory, number>> = {};
  const cats: ChargeCategory[] = ["beast", "bird", "monster", "fish", "celestial", "nature", "plant", "object", "building", "weapon", "geometric", "cross", "body"];
  for (const c of rng.sample(cats, rng.int(1, 3))) categories[c] = rng.range(1.6, 3);
  for (const c of rng.sample(cats, rng.int(0, 2))) categories[c] = (categories[c] ?? 1) * rng.range(0.2, 0.6);
  const lines: Partial<Record<Line, number>> = {};
  const linePool: Line[] = ["wavy", "indented", "dancetty", "embattled", "engrailed", "invected", "nebuly", "raguly", "dovetailed"];
  for (const l of rng.sample(linePool, rng.int(1, 3))) lines[l] = rng.range(2, 5);
  lines.straight = rng.range(0.6, 1.4);
  const partitions: Partial<Record<Partition, number>> = {};
  const partPool: Partition[] = ["perPale", "perFess", "perBend", "perChevron", "perSaltire", "quarterly", "gyronny", "paly", "barry", "bendy", "chequy", "lozengy", "chevronny"];
  for (const p of rng.sample(partPool, rng.int(1, 3))) partitions[p] = rng.range(2, 5);
  const ordinaries: Partial<Record<OrdinaryKind, number>> = {};
  const ordPool: OrdinaryKind[] = ["fess", "pale", "bend", "chevron", "cross", "saltire", "pall", "pile", "orle", "fret", "bendSinister"];
  for (const o of rng.sample(ordPool, rng.int(1, 3))) ordinaries[o] = rng.range(2, 4.5);
  return {
    name,
    complexity: Math.max(0.05, Math.min(0.95, rng.normal(0.42, 0.2))),
    shape: rng.pick(SHAPES_FOR_RANDOM),
    tinctures,
    charges,
    categories,
    lines,
    partitions,
    ordinaries,
    plans: {
      ordinary: rng.range(0.4, 1.6),
      charges: rng.range(0.6, 1.8),
      divided: rng.range(0.3, 1.8),
      variation: rng.range(0.2, 1.6),
      semy: rng.range(0, 1.5),
    },
    chief: rng.range(0.2, 2),
    bordure: rng.range(0.2, 2.5),
    canton: rng.range(0.1, 1.5),
    furs: rng.range(0.2, 2),
  };
}
