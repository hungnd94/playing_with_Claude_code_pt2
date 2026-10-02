/**
 * Colours for the "painterly satellite" terrain look. All values are sRGB 0..255.
 *
 * Land colours are per biome, then nudged per cell by climate (wetter → greener,
 * drier → more ochre) and altitude (towards bare rock), so neighbouring cells of
 * different biomes blend through plausible intermediate tones.
 */
import { Biome } from "../../world/types";

export type RGB = [number, number, number];

export const BIOME_RGB: Record<number, RGB> = {
  [Biome.DeepOcean]: [9, 27, 54],
  [Biome.Ocean]: [17, 52, 92],
  [Biome.Shallows]: [38, 98, 140],
  [Biome.SeaIce]: [214, 226, 236],
  [Biome.Lake]: [40, 92, 122],
  [Biome.IceSheet]: [226, 233, 241],
  [Biome.Tundra]: [124, 120, 96],
  [Biome.Taiga]: [46, 72, 52],
  [Biome.Steppe]: [156, 148, 104],
  [Biome.ColdDesert]: [170, 160, 132],
  [Biome.Mediterranean]: [128, 128, 80],
  [Biome.TemperateForest]: [58, 94, 48],
  [Biome.TemperateRainforest]: [38, 78, 50],
  [Biome.HotDesert]: [212, 190, 138],
  [Biome.Savanna]: [158, 146, 88],
  [Biome.TropicalDryForest]: [100, 112, 54],
  [Biome.Rainforest]: [30, 72, 34],
  [Biome.Wetland]: [66, 90, 66],
  [Biome.Alpine]: [134, 126, 114],
  [Biome.Grassland]: [120, 136, 72],
};

/** Ocean colour stops by depth in km (sRGB). */
export const OCEAN_STOPS: { d: number; c: RGB }[] = [
  { d: 0.0, c: [40, 96, 128] },
  { d: 0.08, c: [33, 87, 126] },
  { d: 0.25, c: [26, 74, 118] },
  { d: 0.8, c: [21, 64, 110] },
  { d: 2.0, c: [15, 46, 86] },
  { d: 3.6, c: [10, 33, 66] },
  { d: 5.5, c: [7, 23, 48] },
];

/** Warm tropical shallows (turquoise), blended in by temperature for shallow water. */
export const TROPICAL_SHALLOW: RGB = [50, 122, 140];
export const TROPICAL_SHELF: RGB = [32, 98, 138];
export const LAKE_RGB: RGB = [36, 88, 116];
export const SALT_LAKE_RGB: RGB = [92, 140, 142];
export const SEA_ICE_RGB: RGB = [224, 233, 241];
/** Young, thin ice near the pack edge: grey-blue. */
export const THIN_ICE_RGB: RGB = [158, 184, 204];
/** Turbid, silty shallow water. */
export const SILT_RGB: RGB = [78, 116, 112];
export const LAKE_ICE_RGB: RGB = [200, 214, 226];
export const SNOW_RGB: RGB = [238, 242, 248];
export const ROCK_RGB: RGB = [118, 108, 98];
export const RIVER_RGB: RGB = [30, 74, 112];
export const BEACH_RGB: RGB = [196, 182, 140];

/** Whittaker-style land biome from climate; used only when a land cell has no land biome. */
export function climateBiome(t: number, p: number, e: number): number {
  if (t < -9) return Biome.IceSheet;
  if (e > 3.1 && t < 2) return Biome.Alpine;
  if (t < -2) return p < 180 ? Biome.ColdDesert : Biome.Tundra;
  if (t < 5) return p < 250 ? Biome.ColdDesert : p < 420 ? Biome.Steppe : Biome.Taiga;
  if (t < 18) {
    if (p < 260) return Biome.ColdDesert;
    if (p < 520) return Biome.Steppe;
    if (p < 800) return t > 12 ? Biome.Mediterranean : Biome.Grassland;
    if (p < 1900) return Biome.TemperateForest;
    return Biome.TemperateRainforest;
  }
  if (p < 330) return Biome.HotDesert;
  if (p < 950) return Biome.Savanna;
  if (p < 1750) return Biome.TropicalDryForest;
  return Biome.Rainforest;
}
