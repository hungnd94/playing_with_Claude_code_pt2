/**
 * Tinctures: classification (metal / colour / fur), the rule of tincture,
 * blazon names, and painted colour values.
 */
import { METALS, TINCTURES, type Tincture } from "../world/concepts";
import { FURS, type Fur, type Tint } from "./types";

export { TINCTURES, METALS, FURS };

export const ALL_TINTS: readonly Tint[] = [...TINCTURES, ...FURS];

export function isFur(t: Tint): t is Fur {
  return (FURS as readonly string[]).includes(t);
}
export function isMetal(t: Tint): boolean {
  return METALS.includes(t as Tincture);
}
export function isColour(t: Tint): boolean {
  return !isFur(t) && !isMetal(t);
}

/** The two tinctures a fur is made of: [ground, spots/second]. */
export const FUR_PARTS: Record<Fur, [Tincture, Tincture]> = {
  ermine: ["argent", "sable"],
  ermines: ["sable", "argent"],
  erminois: ["or", "sable"],
  pean: ["sable", "or"],
  vair: ["argent", "azure"],
  countervair: ["argent", "azure"],
  potent: ["argent", "azure"],
};

/** The tincture a fur reads as from a distance (for aesthetic contrast checks, not for the rule). */
export function dominant(t: Tint): Tincture {
  return isFur(t) ? FUR_PARTS[t][0] : t;
}

/**
 * The rule of tincture: metal may not be laid on metal, nor colour on colour.
 * Furs go with anything.
 */
export function tinctureOk(over: Tint, under: Tint): boolean {
  if (isFur(over) || isFur(under)) return true;
  return isMetal(over) !== isMetal(under);
}

/**
 * Visual contrast heuristic: like the rule of tincture but also treats furs by
 * their dominant ground, so the generator avoids ermine on argent etc.
 */
export function readable(over: Tint, under: Tint): boolean {
  if (over === under) return false;
  const a = dominant(over);
  const b = dominant(under);
  if (a === b) return false;
  if (isFur(over) && isFur(under)) return false;
  if (isMetal(a) === isMetal(b)) {
    // Allowed by the rule when a fur is involved, but only if the fur's ground contrasts.
    return false;
  }
  return true;
}

/** Blazon spellings (modern English, capitalised as is usual in rolls of arms). */
export const TINT_NAMES: Record<Tint, string> = {
  or: "Or",
  argent: "Argent",
  gules: "Gules",
  azure: "Azure",
  vert: "Vert",
  purpure: "Purpure",
  sable: "Sable",
  tenne: "Tenné",
  sanguine: "Sanguine",
  ermine: "Ermine",
  ermines: "Ermines",
  erminois: "Erminois",
  pean: "Pean",
  vair: "Vair",
  countervair: "Counter-vair",
  potent: "Potent",
};

/** A painted tincture: base colour plus a lighter and a darker tone for shading. */
export interface Paint {
  base: string;
  light: string;
  dark: string;
}

export interface Palette {
  name: string;
  tinctures: Record<Tincture, Paint>;
  /** Outline / contour colour of charges and ordinaries. */
  contour: string;
  /** Interior detail lines on sable charges (black-on-black would vanish). */
  contourOnDark: string;
  /** Natural ("proper") colours for parts like wood, flesh and foliage. */
  proper: { wood: string; flesh: string; leaf: string; flame: string };
  /** Strength of the metallic gradient, 0..1. */
  metalSheen: number;
}

/**
 * Illuminated-manuscript palette: pigments a herald-painter of the 14th–16th c.
 * would have used — vermilion, ultramarine, verdigris green, shell gold,
 * lead-white silver — slightly warm and never fully saturated.
 */
export const ILLUMINATED: Palette = {
  name: "illuminated",
  tinctures: {
    or: { base: "#d8a92e", light: "#f6dd83", dark: "#9c6f12" },
    argent: { base: "#efeee8", light: "#ffffff", dark: "#b9bcbf" },
    gules: { base: "#b5261e", light: "#d4473a", dark: "#7c1612" },
    azure: { base: "#2558a5", light: "#3f78c4", dark: "#173b74" },
    vert: { base: "#2c7a45", light: "#3f9a5c", dark: "#1a522c" },
    purpure: { base: "#76396f", light: "#925288", dark: "#4f2449" },
    sable: { base: "#25211f", light: "#45403c", dark: "#100e0d" },
    tenne: { base: "#c06a24", light: "#d98a43", dark: "#874614" },
    sanguine: { base: "#7d2129", light: "#9b3640", dark: "#55141a" },
  },
  contour: "#1c1714",
  contourOnDark: "#8d857c",
  proper: { wood: "#7a5230", flesh: "#e9c3a0", leaf: "#3d7a35", flame: "#e0662a" },
  metalSheen: 1,
};

/** Modern flat palette: clean, saturated, graphic — for small icons and flags. */
export const FLAT: Palette = {
  name: "flat",
  tinctures: {
    or: { base: "#f2b824", light: "#f7cd55", dark: "#c99410" },
    argent: { base: "#f7f7f4", light: "#ffffff", dark: "#d8dadc" },
    gules: { base: "#c8202f", light: "#da3a47", dark: "#991623" },
    azure: { base: "#1f5fae", light: "#3576c4", dark: "#154683" },
    vert: { base: "#1d8048", light: "#2b9a5a", dark: "#135f34" },
    purpure: { base: "#6f3d8f", light: "#8652a8", dark: "#512b6a" },
    sable: { base: "#1d1d1f", light: "#38383b", dark: "#0b0b0c" },
    tenne: { base: "#d06d1c", light: "#e2873a", dark: "#a05213" },
    sanguine: { base: "#8c1d2c", light: "#a8303f", dark: "#66131f" },
  },
  contour: "#141414",
  contourOnDark: "#8a8a8a",
  proper: { wood: "#7a5230", flesh: "#efc9a6", leaf: "#2f8a3c", flame: "#ef6a22" },
  metalSheen: 0.35,
};

export const PALETTES: Record<string, Palette> = { illuminated: ILLUMINATED, flat: FLAT };

/** A flat representative colour for any tint (furs → their ground). */
export function tintColor(t: Tint, palette: Palette = ILLUMINATED): string {
  return palette.tinctures[dominant(t)].base;
}
