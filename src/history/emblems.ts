/**
 * Adapter to the heraldry module: emblems for polities, dynasties (canting on
 * the dynasty name's gloss), religions; cadet differencing and marshalling.
 *
 * Every culture has a heraldic tradition (a HeraldryStyle) and a preferred
 * emblem kind (`Culture.heraldicStyle`): "arms" (shields), "banner" (the same
 * arms data painted on a banner), "mon" or "seal". The heraldry module does
 * not (yet) export dedicated mon/seal generators, so mon/seal cultures carry
 * arms data with `Emblem.kind = "arms"` and a sparse style; when such
 * generators appear, `makeEmblem` is the single place to switch.
 */
import type { Rng } from "../core/rng";
import { generateArms } from "../heraldry/generate";
import { differenceArms, marshalArms, cantingCharge } from "../heraldry/cadency";
import { blazon } from "../heraldry/blazon";
import { STYLES, randomStyle, type HeraldryStyle } from "../heraldry/styles";
import type { Arms, ChargeId, Tint } from "../heraldry/types";
import type { EmblemConcept } from "../world/concepts";
import type { Archetype, Emblem } from "./types";

export function cultureStyle(arch: Archetype, lat: number, rng: Rng, name: string): { style: HeraldryStyle; kind: Emblem["kind"] } {
  const r = rng.next();
  let style: HeraldryStyle;
  if (arch === "steppe") style = STYLES.steppe as HeraldryStyle;
  else if ((arch === "coastal" || arch === "island") && Math.abs(lat) > 45) style = STYLES.nordic as HeraldryStyle;
  else if (r < 0.45) style = randomStyle(rng.fork("style"), name);
  else style = rng.pick([STYLES.anglo, STYLES.french, STYLES.germanic, STYLES.iberian, STYLES.italian] as HeraldryStyle[]);
  // Emblem kind: most peoples bear arms; some prefer banners, a few radial mon or seals.
  const k = rng.next();
  const kind: Emblem["kind"] = arch === "steppe" ? (k < 0.6 ? "banner" : "arms") : k < 0.72 ? "arms" : k < 0.86 ? "banner" : k < 0.94 ? "mon" : "seal";
  return { style, kind };
}

function wrap(arms: Arms, kind: Emblem["kind"]): Emblem {
  return { kind: kind === "mon" || kind === "seal" ? "arms" : kind, data: arms, blazon: blazon(arms) };
}

export interface EmblemOptions {
  style: HeraldryStyle;
  kind: Emblem["kind"];
  /** English gloss words to cant on. */
  gloss?: string[];
  /** A symbol to use if no canting charge is found. */
  symbol?: EmblemConcept;
  colours?: Tint[];
}

export function makeEmblem(rng: Rng, o: EmblemOptions): Emblem {
  const cant = o.gloss ? cantingCharge(o.gloss) : undefined;
  const motifs: ChargeId[] = [];
  if (cant) motifs.push(cant);
  if (o.symbol && !motifs.includes(o.symbol)) motifs.push(o.symbol);
  const arms = generateArms(rng, { style: o.style, motifs: motifs.length ? motifs : undefined, motifChance: cant ? 0.85 : 0.6, colours: o.colours });
  return wrap(arms, o.kind);
}

export function religionEmblem(rng: Rng, symbol: EmblemConcept): Emblem {
  const arms = generateArms(rng, { style: STYLES.ecclesiastical as HeraldryStyle, motifs: [symbol], motifChance: 0.95 });
  return wrap(arms, "arms");
}

/** A cadet branch's differenced arms. */
export function cadetEmblem(parent: Emblem, rng: Rng, son = 2): Emblem {
  const arms = differenceArms(parent.data as Arms, rng, "auto", son);
  return { kind: parent.kind, data: arms, blazon: blazon(arms) };
}

/** Arms of united realms (quarterly). */
export function unionEmblem(a: Emblem, b: Emblem): Emblem {
  const arms = marshalArms([a.data as Arms, b.data as Arms], { method: "quarterly" });
  return { kind: a.kind, data: arms, blazon: blazon(arms) };
}

/** Principal tinctures of an emblem (to let vassals and colonies echo their liege's colours). */
export function emblemTints(e: Emblem): Tint[] {
  const a = e.data as Arms;
  if (!a || a.kind !== "simple") return [];
  const out: Tint[] = [...a.field.tinctures];
  if (a.charges) out.push(a.charges.tincture);
  if (a.ordinary) out.push(a.ordinary.tincture);
  return out.filter(Boolean);
}
