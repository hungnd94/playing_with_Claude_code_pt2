/**
 * Emblems: the single facade the rest of Palimpsest uses.
 *
 * History stores every bearer's emblem as `{ kind, data, blazon }` (see
 * `Emblem` in src/history/types.ts). `kind` says which tradition the emblem
 * belongs to — a shield of arms, a mon, a seal or a banner — and `data` is
 * this module's plain JSON object for it (Arms, Mon, Seal or Banner).
 *
 *  - `generateEmblem`   makes one, canting on the bearer's name;
 *  - `differenceEmblem` makes a cadet branch's version (arms: cadency marks,
 *                       bordures…; mon: a new enclosure or element count…);
 *  - `marshalEmblems`   combines the emblems of united realms or marriages;
 *  - `renderEmblemSVG`  draws any of them, fitted into a square box;
 *  - `describeEmblem`   gives the English blazon or description.
 *
 * Every function is tolerant of the shapes history produced before mon and
 * seal generators existed: `Arms` data under kind "banner", "mon" or "seal"
 * still renders and differences sensibly.
 */
import type { Rng } from "../core/rng";
import type { Tincture } from "../world/concepts";
import type { Arms, ChargeId, ShieldShape, SimpleArms, Tint } from "./types";
import { generateArms, type GenerateOptions } from "./generate";
import { blazon } from "./blazon";
import { cantingCharges, differenceArms, marshalArms, type DifferenceKind } from "./cadency";
import { renderArmsSVG } from "./render";
import { resolveStyle } from "./styles";
import { SHAPES } from "./shapes";
import { BANNER_SHAPES, bannerAspect, describeBanner, generateBanner, renderBannerSVG, type Banner } from "./banner";
import { describeMon, differenceMon, generateMon, renderMonSVG, type Mon } from "./mon";
import { describeSeal, generateSeal, renderSealSVG, SEAL_MATERIALS, type Seal, type SealMaterial } from "./seal";
import { isFur, isMetal, FUR_PARTS, type Palette } from "./tinctures";
import { CHARGES } from "./charges/index";

export const EMBLEM_KINDS = ["arms", "mon", "seal", "banner"] as const;
export type EmblemKind = (typeof EMBLEM_KINDS)[number];

/** Structurally identical to history's `Emblem`. */
export interface HeraldicEmblem {
  kind: EmblemKind;
  /** Arms | Mon | Seal | Banner (or, from older callers, Arms under any kind). */
  data: unknown;
  /** English blazon or description. */
  blazon: string;
}

// ---------------------------------------------------------------------------
// Recognising data

export function isArms(x: unknown): x is Arms {
  const k = (x as { kind?: unknown } | null)?.kind;
  return !!x && typeof x === "object" && (k === "simple" || k === "marshalled");
}
export function isBanner(x: unknown): x is Banner {
  const b = x as Banner | null;
  return !!b && typeof b === "object" && (BANNER_SHAPES as readonly string[]).includes(b.shape) && isArms(b.arms);
}
export function isMon(x: unknown): x is Mon {
  const m = x as Mon | null;
  return !!m && typeof m === "object" && !!m.motif && typeof m.motif === "object" && typeof m.enclosure === "string";
}
export function isSeal(x: unknown): x is Seal {
  const s = x as Seal | null;
  return !!s && typeof s === "object" && !!s.device && (SEAL_MATERIALS as readonly string[]).includes(s.material);
}

// ---------------------------------------------------------------------------
// Generation

export interface EmblemOptions extends GenerateOptions {
  /** Which tradition. Default "arms". */
  kind?: EmblemKind;
  /** English gloss of the bearer's name, word by word ("Wolf", "spear"): canting charges are found in it. */
  gloss?: string[];
  /** Seal legend: usually the bearer's name in its own language. */
  legend?: string;
  /** Religious bearer: seals become pointed ovals (vesica). */
  ecclesiastical?: boolean;
  /** Seals and banners: use these arms as the device instead of inventing one. */
  arms?: Arms;
  /** Seals: the material (wax colour, metal, vermilion ink). */
  material?: SealMaterial;
}

/** The charges a herald would cant on for these options: gloss puns first, then explicit motifs. */
function motifsOf(o: EmblemOptions): ChargeId[] {
  const out: ChargeId[] = [];
  for (const c of o.gloss ? cantingCharges(o.gloss) : []) if (!out.includes(c)) out.push(c);
  for (const c of o.motifs ?? []) if (CHARGES[c] && !out.includes(c)) out.push(c);
  return out;
}

/** Two contrasting plain tinctures from a list of favoured colours (for mon ink and ground). */
function inkAndGround(colours: Tint[] | undefined): { ink?: Tincture; ground?: Tincture } {
  if (!colours?.length) return {};
  const plain = colours.map((t) => (isFur(t) ? FUR_PARTS[t][0] : t)) as Tincture[];
  const metal = plain.find((t) => isMetal(t));
  const colour = plain.find((t) => !isMetal(t));
  if (!metal || !colour) return {};
  // Mon are usually dark on light.
  return { ink: colour, ground: metal };
}

/**
 * Generate an emblem of the given kind. Deterministic in `rng`.
 * Canting: pass the bearer's name gloss in `gloss` (or charges in `motifs`).
 */
export function generateEmblem(rng: Rng, o: EmblemOptions = {}): HeraldicEmblem {
  const kind = o.kind ?? "arms";
  const motifs = motifsOf(o);
  const gen: GenerateOptions = { ...o, motifs: motifs.length ? motifs : undefined };
  switch (kind) {
    case "banner": {
      const b = generateBanner(rng.fork("banner"), { style: o.style, motifs: gen.motifs, colours: o.colours?.filter((t) => !isFur(t)) as Tincture[] | undefined, arms: o.arms });
      return { kind, data: b, blazon: describeBanner(b) };
    }
    case "mon": {
      const m = generateMon(rng.fork("mon"), { motifs, ...inkAndGround(o.colours) });
      return { kind, data: m, blazon: describeMon(m) };
    }
    case "seal": {
      const s = generateSeal(rng.fork("seal"), { legend: o.legend, motifs, arms: o.arms, ecclesiastical: o.ecclesiastical, material: o.material });
      return { kind, data: s, blazon: describeSeal(s) };
    }
    default: {
      const a = o.arms ?? generateArms(rng.fork("arms"), gen);
      return { kind: "arms", data: a, blazon: blazon(a) };
    }
  }
}

// ---------------------------------------------------------------------------
// Description

/** The English blazon (arms, banners) or description (mon, seals) of an emblem's data. */
export function describeEmblem(e: { kind: EmblemKind; data: unknown }): string {
  const d = e.data;
  if (isBanner(d)) return describeBanner(d);
  if (isMon(d)) return describeMon(d);
  if (isSeal(d)) return describeSeal(d);
  if (isArms(d)) return blazon(d);
  return "";
}

function wrap(kind: EmblemKind, data: Arms | Mon | Seal | Banner): HeraldicEmblem {
  return { kind, data, blazon: describeEmblem({ kind, data }) };
}

// ---------------------------------------------------------------------------
// Cadency and marshalling

export interface DifferenceOptions {
  /** Arms: the differencing method (default "auto"). */
  method?: DifferenceKind;
  /** Arms: which son (2–9) for English cadency brisures. */
  son?: number;
}

/**
 * A cadet branch's emblem: arms get a mark of cadency (label, brisure,
 * bordure, change of tincture or line…); mon get a new enclosure, a changed
 * number of elements or reversed colours; seals and banners difference their
 * device. Never mutates the input.
 */
export function differenceEmblem(e: { kind: EmblemKind; data: unknown }, rng: Rng, o: DifferenceOptions = {}): HeraldicEmblem {
  const d = e.data;
  const da = (a: Arms) => differenceArms(a, rng, o.method ?? "auto", o.son);
  if (isBanner(d)) return wrap(e.kind, { ...d, arms: da(d.arms) });
  if (isMon(d)) return wrap(e.kind, differenceMon(d, rng));
  if (isSeal(d)) {
    const s = JSON.parse(JSON.stringify(d)) as Seal;
    if (s.device.kind === "arms") s.device.arms = da(s.device.arms);
    else if (s.device.kind === "mon") s.device.mon = differenceMon(s.device.mon, rng);
    else {
      // A charge seal: a younger son changes the field behind the device, or the border.
      const fields = (["plain", "diaper", "stars", "sprigs"] as const).filter((x) => x !== s.field);
      if (rng.chance(0.65)) s.field = rng.pick(fields);
      else s.border = s.border === "beaded" ? "cabled" : "beaded";
    }
    return wrap(e.kind, s);
  }
  if (isArms(d)) return wrap(e.kind, da(d));
  return { kind: e.kind, data: d, blazon: describeEmblem(e) };
}

/** The shield of arms an emblem carries, if any (arms, a banner's cloth, a seal's shield). */
export function emblemArms(e: { kind: EmblemKind; data: unknown }): Arms | undefined {
  const d = e.data;
  if (isArms(d)) return d;
  if (isBanner(d)) return d.arms;
  if (isSeal(d) && d.device.kind === "arms") return d.device.arms;
  return undefined;
}

/**
 * Combine the emblems of united realms (method "quarterly", the default) or of
 * a marriage ("impaled"). Arms are marshalled on one shield; a banner keeps its
 * cloth and carries the marshalled arms; a seal takes the marshalled shield as
 * its device. Emblems without arms (mon, charge seals) cannot be marshalled in
 * their own tradition: the first emblem is kept, with the second set over it as
 * an escutcheon when the second has arms.
 */
export function marshalEmblems(list: { kind: EmblemKind; data: unknown }[], method: "quarterly" | "impaled" | "perFess" = "quarterly"): HeraldicEmblem {
  if (!list.length) throw new Error("marshalEmblems: no emblems");
  const first = list[0];
  const arms = list.map(emblemArms);
  if (arms.every((a): a is Arms => !!a)) {
    const m = marshalArms(arms, { method });
    const d = first.data;
    if (isBanner(d)) return wrap(first.kind, { ...JSON.parse(JSON.stringify(d)), arms: m });
    if (isSeal(d)) {
      const s = JSON.parse(JSON.stringify(d)) as Seal;
      s.device = { kind: "arms", arms: m, shape: s.device.kind === "arms" ? s.device.shape : "heater" };
      return wrap(first.kind, s);
    }
    return wrap(first.kind === "mon" ? "arms" : first.kind, m);
  }
  const base = arms[0];
  const other = arms.slice(1).find((a) => !!a);
  if (base && other) return wrap(first.kind, marshalArms([base], { escutcheon: other }));
  return wrap(first.kind, JSON.parse(JSON.stringify(first.data)));
}

/**
 * Principal tinctures of an emblem, most prominent first: field, then the main
 * charge or ordinary (lets vassals and colonies echo their liege's colours).
 */
export function emblemColours(e: { kind: EmblemKind; data: unknown }): Tint[] {
  const d = e.data;
  if (isMon(d)) return [d.ground ?? "argent", d.ink ?? "sable"];
  if (isSeal(d) && d.device.kind === "mon") return [d.device.mon.ground ?? "argent", d.device.mon.ink ?? "sable"];
  const a = emblemArms(e);
  if (!a) return [];
  const first = (x: Arms): SimpleArms => (x.kind === "simple" ? x : first(x.coats[0]));
  const s = first(a);
  const out: Tint[] = [];
  const push = (t?: Tint) => {
    if (t && !out.includes(t)) out.push(t);
  };
  s.field.tinctures.forEach(push);
  push(s.charges?.tincture);
  push(s.ordinary?.tincture);
  push(s.chief?.tincture);
  push(s.ordinary?.charges?.tincture);
  push(s.bordure?.tincture);
  push(s.semy?.tincture);
  return out;
}

// ---------------------------------------------------------------------------
// Rendering

export interface EmblemRenderOptions {
  /**
   * The emblem is fitted into a square box of this many pixels (default 160);
   * the SVG's own width and height follow the emblem's proportions.
   */
  size?: number;
  /** Prefix for every id in the SVG (default: an automatic unique prefix). */
  idPrefix?: string;
  palette?: Palette | "illuminated" | "flat";
  /** Arms and banners: "rich" (default), "flat", or for arms "hatched" (engraved line art). */
  finish?: "rich" | "flat" | "hatched";
  /** Arms: the shield shape (default "heater"; pass the bearer's style shape for variety). */
  shape?: ShieldShape;
  /** Mon: background behind the mon (default "disc"). */
  background?: "disc" | "square" | "none";
  /**
   * Banners: draw staff, crossbar and finial. Default: true at 72 px and above,
   * false (just the cloth) below, where a staff would only be noise.
   */
  staff?: boolean;
  /** Arms: a faint parchment texture. */
  texture?: boolean;
  /** Extra attributes for the root <svg>. */
  attrs?: string;
}

/**
 * Render any emblem as a self-contained SVG string, dispatching on `kind` but
 * trusting the data: Arms under kind "banner" are painted on a banner, Arms
 * under "seal" are impressed in wax, Arms under "mon" are shown as a shield.
 */
export function renderEmblemSVG(e: { kind: EmblemKind; data: unknown }, opts: EmblemRenderOptions = {}): string {
  const size = opts.size ?? 160;
  const d = e.data;
  const common = { idPrefix: opts.idPrefix, attrs: opts.attrs };
  // Banners
  if (isBanner(d) || (e.kind === "banner" && isArms(d))) {
    const b: Banner = isBanner(d) ? d : { shape: "banner", arms: d as Arms, finial: "spear" };
    const staff = opts.staff ?? size >= 72;
    const aspect = bannerAspect(b, staff);
    const finish = opts.finish === "hatched" ? "flat" : opts.finish;
    return renderBannerSVG(b, { ...common, size: aspect > 1 ? size / aspect : size, palette: opts.palette, finish, staff });
  }
  if (isMon(d)) return renderMonSVG(d, { ...common, size, palette: opts.palette, background: opts.background ?? "disc" });
  if (isSeal(d)) return renderSealSVG(d, { ...common, size });
  if (isArms(d)) {
    if (e.kind === "seal") {
      const seal: Seal = { shape: "round", material: "redWax", device: { kind: "arms", arms: d, shape: "heater" }, border: "beaded", field: "plain" };
      return renderSealSVG(seal, { ...common, size });
    }
    const shape = opts.shape ?? "heater";
    const def = SHAPES[shape];
    const pad = 3;
    const width = size * Math.min(1, (def.w + 2 * pad) / (def.h + 2 * pad));
    return renderArmsSVG(d, { ...common, size: width, shape, palette: opts.palette, finish: opts.finish, texture: opts.texture });
  }
  // Unknown data: an empty, plain shield outline rather than a crash.
  const def = SHAPES.heater;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 206 242" width="${(size * 206) / 242}" height="${size}"><path d="${def.d}" fill="#d9d4c7" stroke="#1c1714" stroke-width="3"/></svg>`;
}

/** The shield shape a style prefers (handy for `renderEmblemSVG({ shape })`). */
export function styleShape(style: Parameters<typeof resolveStyle>[0]): ShieldShape {
  return resolveStyle(style).shape;
}
