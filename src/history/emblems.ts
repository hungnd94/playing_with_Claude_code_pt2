/**
 * Adapter to the heraldry module: emblems for polities, dynasties (canting
 * on the dynasty name's gloss), religions; cadet differencing and
 * marshalling.
 *
 * Every culture has a heraldic tradition (a HeraldryStyle) and a preferred
 * emblem kind (`Culture.heraldicStyle`): "arms" (a shield), "banner" (arms
 * painted on a cloth of a traditional shape), "mon" (a radial badge) or
 * "seal" (a wax or metal impression with a legend). `Emblem.data` holds the
 * heraldry module's object for that kind (Arms | Banner | Mon | Seal).
 *
 * The heraldry module is developed in parallel: every call here is guarded,
 * and a plain parted shield stands in if a generator throws, so a history
 * can always be produced.
 */
import type { Rng } from "../core/rng";
import { generateArms } from "../heraldry/generate";
import { differenceArms, marshalArms, cantingCharge, cantingCharges } from "../heraldry/cadency";
import { blazon } from "../heraldry/blazon";
import { STYLES, randomStyle, type HeraldryStyle } from "../heraldry/styles";
import { generateMon, describeMon, type Mon } from "../heraldry/mon";
import { generateSeal, describeSeal, type Seal } from "../heraldry/seal";
import { generateBanner, describeBanner, type Banner } from "../heraldry/banner";
import type { Arms, ChargeId, Tint } from "../heraldry/types";
import type { EmblemConcept } from "../world/concepts";
import type { Archetype, Emblem } from "./types";

export function cultureStyle(arch: Archetype, lat: number, rng: Rng, name: string): { style: HeraldryStyle; kind: Emblem["kind"] } {
  const r = rng.next();
  let style: HeraldryStyle;
  if (arch === "steppe") style = STYLES.steppe as HeraldryStyle;
  else if ((arch === "coastal" || arch === "island") && Math.abs(lat) > 45) style = STYLES.nordic as HeraldryStyle;
  else if (r < 0.45) style = safe(() => randomStyle(rng.fork("style"), name), () => STYLES.anglo as HeraldryStyle);
  else style = rng.pick([STYLES.anglo, STYLES.french, STYLES.germanic, STYLES.iberian, STYLES.italian] as HeraldryStyle[]);
  // Emblem kind: most peoples bear arms; some prefer banners, a few radial mon or seals.
  const k = rng.next();
  const kind: Emblem["kind"] = arch === "steppe" ? (k < 0.6 ? "banner" : "arms") : k < 0.68 ? "arms" : k < 0.82 ? "banner" : k < 0.92 ? "mon" : "seal";
  return { style, kind };
}

function safe<T>(f: () => T, fallback: () => T): T {
  try {
    return f();
  } catch {
    return fallback();
  }
}

const METALS: Tint[] = ["or", "argent"];
const COLOURS: Tint[] = ["gules", "azure", "vert", "sable", "purpure"];
const NAME: Record<string, string> = { or: "Or", argent: "Argent", gules: "Gules", azure: "Azure", vert: "Vert", sable: "Sable", purpure: "Purpure" };

/** A plain parted shield, used when the heraldry module fails. */
function fallbackArms(rng: Rng): Arms {
  const m = rng.pick(METALS), c = rng.pick(COLOURS);
  const partition = rng.pick(["perPale", "perFess", "perBend", "quarterly"] as const);
  return { kind: "simple", field: { partition, tinctures: rng.chance(0.5) ? [m, c] : [c, m] } } as Arms;
}

function blazonOf(a: Arms): string {
  return safe(() => blazon(a), () => {
    const f = (a as { field?: { partition: string; tinctures: string[] } }).field;
    if (!f) return "Arms";
    const p = f.partition === "perPale" ? "Per pale" : f.partition === "perFess" ? "Per fess" : f.partition === "perBend" ? "Per bend" : f.partition === "quarterly" ? "Quarterly" : "";
    return `${p} ${f.tinctures.map((t) => NAME[t] ?? t).join(" and ")}`.trim();
  });
}

function armsOf(e: Emblem): Arms | undefined {
  const d = e.data as { kind?: string; arms?: Arms; device?: { kind: string; arms?: Arms } };
  if (!d) return undefined;
  if (d.kind === "simple" || d.kind === "marshalled") return d as unknown as Arms;
  if (e.kind === "banner" && d.arms) return d.arms;
  if (e.kind === "seal" && d.device?.kind === "arms") return d.device.arms;
  return undefined;
}

export interface EmblemOptions {
  style: HeraldryStyle;
  kind: Emblem["kind"];
  /** English gloss words to cant on. */
  gloss?: string[];
  /** A symbol to use if no canting charge is found. */
  symbol?: EmblemConcept;
  colours?: Tint[];
  /** Legend for seals (the bearer's name). */
  legend?: string;
}

export function makeEmblem(rng: Rng, o: EmblemOptions): Emblem {
  const cant = o.gloss ? safe(() => cantingCharge(o.gloss!), () => undefined) : undefined;
  const motifs: ChargeId[] = [];
  if (cant) motifs.push(cant);
  if (o.symbol && !motifs.includes(o.symbol)) motifs.push(o.symbol);
  const genArms = () => safe(() => generateArms(rng, { style: o.style, motifs: motifs.length ? motifs : undefined, motifChance: cant ? 0.85 : 0.6, colours: o.colours }), () => fallbackArms(rng));
  if (o.kind === "mon") {
    const mon = safe<Mon | null>(() => generateMon(rng.fork("mon"), { motifs: motifs.length ? motifs : undefined }), () => null);
    if (mon) return { kind: "mon", data: mon, blazon: safe(() => describeMon(mon), () => "A mon") };
  } else if (o.kind === "seal") {
    const seal = safe<Seal | null>(() => generateSeal(rng.fork("seal"), { motifs: motifs.length ? motifs : undefined, legend: o.legend }), () => null);
    if (seal) return { kind: "seal", data: seal, blazon: safe(() => describeSeal(seal), () => "A seal") };
  } else if (o.kind === "banner") {
    const banner = safe<Banner | null>(() => generateBanner(rng.fork("banner"), { style: o.style, motifs: motifs.length ? motifs : undefined, colours: o.colours as never }), () => null);
    if (banner) return { kind: "banner", data: banner, blazon: safe(() => describeBanner(banner), () => blazonOf(banner.arms)) };
  }
  const arms = genArms();
  return { kind: "arms", data: arms, blazon: blazonOf(arms) };
}

export function religionEmblem(rng: Rng, symbol: EmblemConcept): Emblem {
  const arms = safe(() => generateArms(rng, { style: STYLES.ecclesiastical as HeraldryStyle, motifs: [symbol], motifChance: 0.95 }), () => fallbackArms(rng));
  return { kind: "arms", data: arms, blazon: blazonOf(arms) };
}

/** A cadet branch's differenced emblem. */
export function cadetEmblem(parent: Emblem, rng: Rng, son = 2): Emblem {
  const base = armsOf(parent);
  if (!base) {
    // Mon and seal traditions mark a branch with a variant badge.
    if (parent.kind === "mon") {
      const pm = parent.data as Mon;
      const mon: Mon = safe(() => ({ ...generateMon(rng.fork("cadet"), {}), motif: pm.motif }), () => pm);
      return { kind: "mon", data: mon, blazon: safe(() => describeMon(mon), () => parent.blazon) };
    }
    return parent;
  }
  const arms = safe(() => differenceArms(base, rng, "auto", son), () => base);
  if (parent.kind === "banner") {
    const b = { ...(parent.data as Banner), arms };
    return { kind: "banner", data: b, blazon: safe(() => describeBanner(b), () => blazonOf(arms)) };
  }
  return { kind: "arms", data: arms, blazon: blazonOf(arms) };
}

/** Arms of united realms (quarterly). */
export function unionEmblem(a: Emblem, b: Emblem): Emblem {
  const aa = armsOf(a), bb = armsOf(b);
  if (!aa || !bb) return a;
  const arms = safe(() => marshalArms([aa, bb], { method: "quarterly" }), () => aa);
  return { kind: "arms", data: arms, blazon: blazonOf(arms) };
}

/** Principal tinctures of an emblem (to let vassals and colonies echo their liege's colours). */
export function emblemTints(e: Emblem): Tint[] {
  const a = armsOf(e);
  if (!a || a.kind !== "simple") return [];
  const out: Tint[] = [...a.field.tinctures];
  if (a.charges) out.push(a.charges.tincture);
  if (a.ordinary) out.push(a.ordinary.tincture);
  return out.filter(Boolean);
}

/** Arms usable for a flag (the emblem's shield if it has one). */
export function emblemArms(e: Emblem): Arms | undefined {
  return armsOf(e);
}

export { cantingCharges };
