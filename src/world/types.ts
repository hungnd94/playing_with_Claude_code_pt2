/**
 * Shared data contracts for the physical planet.
 *
 * Everything per-cell is a typed array of length `mesh.n` indexed by cell id,
 * so worlds can be transferred between a Web Worker and the main thread
 * without copying and rendered directly into textures.
 */
import type { SphereMesh } from "../core/sphere";

export interface WorldParams {
  /** Seed string; the entire world is a pure function of (seed, params). */
  seed: string;
  /** Number of Voronoi cells on the sphere. 40k is the default; 10k for tests. */
  cells: number;
  /** Planet radius in km (used to give distances and areas real units). */
  radiusKm: number;
  /** Target fraction of the surface covered by ocean (0..1). */
  oceanFraction: number;
  /** Number of tectonic plates. */
  plates: number;
  /** Axial tilt, degrees (affects seasonality). */
  axialTiltDeg: number;
  /** Mean surface temperature offset vs. an Earth-like baseline, °C. Negative = ice-age world. */
  temperatureOffset: number;
  /** Years of history to simulate. */
  years: number;
}

export const DEFAULT_PARAMS: Omit<WorldParams, "seed"> = {
  cells: 40000,
  radiusKm: 4200,
  oceanFraction: 0.64,
  plates: 14,
  axialTiltDeg: 23.5,
  temperatureOffset: 0,
  years: 3000,
};

/** Biomes. Water biomes first; `isWaterBiome(b)` ⇔ b <= Biome.Lake. */
export const Biome = {
  DeepOcean: 0,
  Ocean: 1,
  Shallows: 2,
  SeaIce: 3,
  Lake: 4,
  IceSheet: 5,
  Tundra: 6,
  Taiga: 7,
  Steppe: 8,
  ColdDesert: 9,
  Mediterranean: 10,
  TemperateForest: 11,
  TemperateRainforest: 12,
  HotDesert: 13,
  Savanna: 14,
  TropicalDryForest: 15,
  Rainforest: 16,
  Wetland: 17,
  Alpine: 18,
  Grassland: 19,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
export const BIOME_COUNT = 20;
export const isWaterBiome = (b: number): boolean => b <= Biome.Lake;

export const BIOME_NAMES: Record<number, string> = {
  0: "deep ocean",
  1: "ocean",
  2: "shallow sea",
  3: "pack ice",
  4: "lake",
  5: "ice sheet",
  6: "tundra",
  7: "taiga",
  8: "steppe",
  9: "cold desert",
  10: "scrubland",
  11: "temperate forest",
  12: "temperate rainforest",
  13: "desert",
  14: "savanna",
  15: "dry tropical forest",
  16: "rainforest",
  17: "wetland",
  18: "alpine heights",
  19: "grassland",
};

/** Natural resources, as a bitmask per cell. */
export const Resource = {
  Copper: 1 << 0,
  Tin: 1 << 1,
  Iron: 1 << 2,
  Gold: 1 << 3,
  Silver: 1 << 4,
  Gems: 1 << 5,
  Salt: 1 << 6,
  Marble: 1 << 7,
  Timber: 1 << 8,
  Horses: 1 << 9,
  Fish: 1 << 10,
  Furs: 1 << 11,
  Spices: 1 << 12,
  Incense: 1 << 13,
  Dyes: 1 << 14,
  Wine: 1 << 15,
  Ivory: 1 << 16,
  Obsidian: 1 << 17,
  Amber: 1 << 18,
  Pearls: 1 << 19,
} as const;
export type ResourceKey = keyof typeof Resource;
export const RESOURCE_KEYS = Object.keys(Resource) as ResourceKey[];

export interface Plate {
  id: number;
  /** Continental plates carry thick, buoyant crust; oceanic plates sit low. */
  oceanic: boolean;
  /** Euler pole (unit vector) of the plate's rotation. */
  axis: [number, number, number];
  /** Angular speed, radians per (arbitrary) time unit. Typical 0.2..1. */
  speed: number;
  /** Seed cell the plate grew from. */
  seedCell: number;
}

export const BoundaryKind = { None: 0, Convergent: 1, Divergent: 2, Transform: 3 } as const;

export type GeoFeatureKind =
  | "continent"
  | "island"
  | "ocean"
  | "sea"
  | "bay"
  | "strait"
  | "lake"
  | "river"
  | "mountains"
  | "hills"
  | "volcano"
  | "desert"
  | "forest"
  | "jungle"
  | "steppe"
  | "tundra"
  | "marsh"
  | "plain"
  | "peninsula"
  | "archipelago"
  | "glacier";

/**
 * A named-able geographic feature. Names are *not* assigned by the physical
 * generator — peoples name features during history, and a feature can carry
 * different names in different languages.
 */
export interface GeoFeature {
  id: number;
  kind: GeoFeatureKind;
  /** Member cells. For rivers: ordered from source to mouth. */
  cells: Int32Array;
  /** Representative cell (centroid-ish, or highest peak for mountains, mouth for rivers). */
  anchor: number;
  /** Area in km² (for rivers: length in km). */
  size: number;
  /** Containing feature (island → ocean/sea it sits in, river → continent, range → continent), or -1. */
  parent: number;
  /** Free-form descriptive attributes, e.g. { peakElevation: 5.2, salty: 1, volcanic: 1, latitudeBand: "tropical" }. */
  attrs: Record<string, number | string>;
}

export interface Lake {
  id: number;
  cells: Int32Array;
  /** Water surface elevation, km. */
  surface: number;
  /** Endorheic (no outflow, therefore saline). */
  salty: boolean;
  /** Cell through which the lake drains, or -1. */
  outlet: number;
}

export interface PhysicalWorld {
  params: WorldParams;
  mesh: SphereMesh;

  // --- Geology ---
  plates: Plate[];
  /** Plate index per cell. */
  plate: Uint8Array;
  /** BoundaryKind per cell (non-zero only near plate boundaries). */
  boundary: Uint8Array;
  /** Elevation in km relative to sea level; negative = below sea level (ocean depth). Range ≈ [-8, 9]. */
  elevation: Float32Array;
  /** Volcanic activity 0..1 (hot spots, subduction arcs, rifts). */
  volcanism: Float32Array;
  /** Seismic activity 0..1 (proximity to active boundaries). */
  seismicity: Float32Array;

  // --- Water & land ---
  /** 1 if the cell is land (elevation ≥ 0 or a lake), 0 if ocean. Lakes are land cells with `lakeId >= 0`. */
  isLand: Uint8Array;
  /** Signed distance to the coastline in cells: 1 = coastal land, 2.. inland, -1 = coastal water, -2.. offshore. */
  coastDist: Int16Array;

  // --- Climate ---
  /** Mean annual temperature, °C (at the cell's elevation). */
  temperature: Float32Array;
  /** Seasonal half-amplitude, °C (summer ≈ temperature + range, winter ≈ temperature − range). */
  tempRange: Float32Array;
  /** Mean annual precipitation, mm. */
  precipitation: Float32Array;
  /** Prevailing surface wind, tangent vectors (flat xyz, 3 per cell), magnitude ≈ m/s. */
  wind: Float32Array;

  // --- Hydrology ---
  /** Next cell downhill along the drainage network, or -1 (ocean cell / sink). */
  downstream: Int32Array;
  /** Mean river discharge passing through the cell, m³/s. */
  flow: Float32Array;
  /** Strahler-like river order; 0 = no river worth drawing. */
  riverOrder: Uint8Array;
  /** Lake id per cell, or -1. */
  lakeId: Int32Array;
  lakes: Lake[];

  // --- Life & economy ---
  biome: Uint8Array;
  /** Pre-industrial agricultural potential 0..1 (food a cell can support). */
  fertility: Float32Array;
  /** Resource bitmask per cell (see `Resource`). */
  resources: Uint32Array;

  // --- Named-able features ---
  features: GeoFeature[];
  /** Landmass feature id (continent/island) per land cell, -1 for water. */
  landmassOf: Int32Array;
  /** Water body feature id (ocean/sea/bay/lake) per water cell, -1 for land. */
  waterBodyOf: Int32Array;
  /** Terrain region feature id (mountains/desert/forest/…) per cell, -1 if none. */
  regionOf: Int32Array;
}
