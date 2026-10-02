/**
 * Texture baking for the globe (DOM-free: usable in a Web Worker and in Node).
 *
 *   const baked = bakeGlobe(world, { width: 4096 });   // in a worker
 *   globe.setBaked(baked);                             // on the main thread
 *
 * or individually: `bakeTerrain`, `bakeCellIds`, `bakeWarp`.
 */
import type { PhysicalWorld } from "../../world/types";
import { bakeContext } from "./context";
import { bakeCellIds } from "./cellids";
import { bakeTerrain, type TerrainBakeOptions } from "./terrain";
import { buildRiverPaths, packRivers, type RiverGeometry } from "./rivers";

export { bakeTerrain, COAST_ALPHA_GAIN, encodeCoast, type TerrainBakeOptions } from "./terrain";
export { bakeCellIds, encodeCellId, decodeCellId, CELL_ID_LAND_ALPHA, CELL_ID_WATER_ALPHA, type CellIdBakeOptions } from "./cellids";
export { bakeContext, BakeContext, unwarp, sampleWarp, dirToUV, type WarpLattice } from "./context";
export { buildRiverPaths, packRivers, type RiverPath, type RiverOptions, type RiverGeometry } from "./rivers";

/** An RGBA8 equirectangular image. */
export interface RGBAImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * The warp lattice as an RGBA8 image (RGB = displacement xyz, 128 = 0;
 * `amp` = displacement for 0/255). The globe uses it to place cell
 * boundaries analytically (sub-texel crisp borders) exactly where the cell-id
 * texture put them. Its size depends only on the mesh resolution.
 */
export function bakeWarp(world: PhysicalWorld): RGBAImage & { amp: number } {
  const w = bakeContext(world).warp;
  return { width: w.width, height: w.height, rgba: w.rgba.slice(), amp: w.amp };
}

export interface BakedGlobe {
  terrain: RGBAImage;
  cellIds: RGBAImage;
  warp: RGBAImage & { amp: number };
  /** Vector rivers (the same paths as baked into the terrain), for crisp close-ups. */
  rivers: RiverGeometry;
}

export interface BakeGlobeOptions extends TerrainBakeOptions {
  /** Terrain width (height = width / 2). Default 4096. */
  width?: number;
  /** Cell-id texture width (default: same as terrain, max 4096). */
  idWidth?: number;
  /**
   * Also paint rivers into the terrain texture (default false: the globe draws
   * them as vector ribbons from `rivers`, which stay crisp at any zoom).
   */
  bakeRiversIntoTerrain?: boolean;
}

/** Bake everything the globe needs. Transfer the `rgba` buffers to the main thread. */
export function bakeGlobe(world: PhysicalWorld, opts: BakeGlobeOptions = {}): BakedGlobe {
  const width = opts.width ?? 4096;
  const idWidth = opts.idWidth ?? Math.min(width, 4096);
  const terrain = bakeTerrain(world, width, width / 2, { ...opts, rivers: opts.bakeRiversIntoTerrain ?? false });
  const ids = bakeCellIds(world, idWidth, idWidth / 2, idWidth === width ? { terrain } : {});
  return {
    terrain: { width, height: width / 2, rgba: terrain },
    cellIds: { width: idWidth, height: idWidth / 2, rgba: ids },
    warp: bakeWarp(world),
    rivers: bakeRivers(world, { ...opts, rivers: true }),
  };
}

/** River ribbons for `GlobeView.setRivers` (same paths and widths as the terrain bake). */
export function bakeRivers(world: PhysicalWorld, opts: TerrainBakeOptions = {}): RiverGeometry {
  const ctx = bakeContext(world);
  if (opts.rivers === false) return { pts: new Float32Array(0), hw: new Float32Array(0), start: new Uint32Array(1) };
  return packRivers(buildRiverPaths(ctx, opts.river), ctx.mesh.meanSpacing);
}

/** Buffers to list as transferables when posting a BakedGlobe from a worker. */
export function bakedTransferables(b: BakedGlobe): ArrayBuffer[] {
  return [b.terrain.rgba.buffer, b.cellIds.rgba.buffer, b.warp.rgba.buffer, b.rivers.pts.buffer, b.rivers.hw.buffer, b.rivers.start.buffer] as ArrayBuffer[];
}
