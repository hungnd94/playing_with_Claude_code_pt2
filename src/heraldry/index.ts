/**
 * Palimpsest heraldry — public API.
 *
 * Arms, blazon, cadency and marshalling, canting; flags and banners; mon;
 * seals; and `renderEmblemSVG` for whatever a bearer carries. Everything is
 * plain JSON data + DOM-free string rendering (safe in the generation worker).
 * See README.md in this directory.
 */

// Data model
export * from "./types";

// Emblem facade (what history and the app should use)
export {
  EMBLEM_KINDS, generateEmblem, describeEmblem, differenceEmblem, marshalEmblems, emblemArms, emblemColours,
  renderEmblemSVG, styleShape, isArms, isBanner, isMon, isSeal,
  type EmblemKind, type HeraldicEmblem, type EmblemOptions, type EmblemRenderOptions, type DifferenceOptions,
} from "./emblem";

// Arms
export { generateArms, checkTincture, type GenerateOptions, type TinctureViolation } from "./generate";
export { blazon, type BlazonOptions } from "./blazon";
export {
  differenceArms, marshalArms, cantingCharge, cantingCharges, CADENCY_ORDER, DIFFERENCE_KINDS,
  type DifferenceKind, type MarshalOptions,
} from "./cadency";
export { renderArmsSVG, type RenderOptions } from "./render";
export { STYLES, randomStyle, resolveStyle, type HeraldryStyle, type StyleName } from "./styles";

// Charges
export { CHARGES, ALL_CHARGE_IDS, chargeDef } from "./charges/index";
export type { ChargeDef, ChargeCategory } from "./charges/art";
export { renderChargeSVG, type ChargeIconOptions } from "./place";

// Tinctures and palettes
export {
  TINT_NAMES, ILLUMINATED, FLAT, PALETTES, ALL_TINTS, isMetal, isFur, isColour, tinctureOk, readable, tintColor,
  type Palette, type Paint,
} from "./tinctures";

// Banners, flags, mon, seals
export {
  BANNER_SHAPES, FINIALS, generateBanner, renderBannerSVG, describeBanner, bannerAspect,
  type Banner, type BannerShape, type Finial, type BannerOptions, type BannerRenderOptions,
} from "./banner";
export {
  FLAG_PATTERNS, FLAG_SHAPES, generateFlag, renderFlagSVG, describeFlag, liveryOf, colourWord,
  type Flag, type FlagPattern, type FlagShape, type FlagDevice, type FlagOptions, type FlagRenderOptions,
} from "./flag";
export {
  MON_ENCLOSURES, MON_GEOMETRIC, generateMon, renderMonSVG, describeMon, differenceMon,
  type Mon, type MonMotif, type MonEnclosure, type MonOptions, type MonRenderOptions,
} from "./mon";
export {
  SEAL_SHAPES, SEAL_MATERIALS, generateSeal, renderSealSVG, describeSeal,
  type Seal, type SealShape, type SealMaterial, type SealDevice, type SealOptions, type SealRenderOptions,
} from "./seal";
