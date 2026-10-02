/**
 * Cell-id texture: every pixel names the cell it belongs to (24-bit id in RGB),
 * for per-cell overlays (political, cultural, …) and picking.
 *
 * Pixels are assigned by nearest site to the *warped* position q (so the
 * boundaries are organic curves rather than hexagons), restricted to cells of
 * the pixel's own land/water class as decided by the shared coast field — so a
 * land pixel always maps to a land cell, a water pixel to a water cell, and
 * political colours stop exactly at the coastline of the terrain texture.
 *
 * A: 255 for land pixels, 128 for water (lakes count as water).
 */
import type { PhysicalWorld } from "../../world/types";
import { bakeContext, equirectGrid, warpRow } from "./context";

export const CELL_ID_LAND_ALPHA = 255;
export const CELL_ID_WATER_ALPHA = 128;

/** Write cell id into rgba at byte offset `o` (alpha untouched). */
export function encodeCellId(id: number, rgba: Uint8Array, o: number): void {
  rgba[o] = id & 255;
  rgba[o + 1] = (id >>> 8) & 255;
  rgba[o + 2] = (id >>> 16) & 255;
}

/** Read the cell id stored at byte offset `o`. */
export function decodeCellId(rgba: Uint8Array, o: number): number {
  return rgba[o] | (rgba[o + 1] << 8) | (rgba[o + 2] << 16);
}

export interface CellIdBakeOptions {
  /**
   * The terrain texture baked at the same size. If given, its alpha (coast
   * field) supplies the land/water decision instead of recomputing it —
   * faster, and identical by construction.
   */
  terrain?: Uint8Array;
}

/** Bake the cell-id texture (RGBA8, row 0 = north, column 0 = lon −180°). */
export function bakeCellIds(world: PhysicalWorld, width: number, height: number, opts: CellIdBakeOptions = {}): Uint8Array {
  const terrain = opts.terrain && opts.terrain.length === width * height * 4 ? opts.terrain : null;
  if (world.mesh.n >= 1 << 24) throw new Error("bakeCellIds: more than 2^24 cells");
  const ctx = bakeContext(world);
  const grid = equirectGrid(width, height);
  const out = new Uint8Array(width * height * 4);
  const bary = new Float64Array(3);
  const wr = new Float64Array(3 * width);
  const oct = ctx.coastOctavesFor(height);
  let t = ctx.locator.locateTriangle(grid.cosLat[0] * grid.cosLon[0], grid.cosLat[0] * grid.sinLon[0], grid.sinLat[0], bary);
  for (let y = 0; y < height; y++) {
    const cl = grid.cosLat[y], sl = grid.sinLat[y];
    warpRow(ctx.warp, y, height, width, wr);
    const rowStart = t;
    let lastCell = -1;
    let lastLand = false;
    for (let x = 0; x < width; x++) {
      const qx = cl * grid.cosLon[x] + wr[3 * x];
      const qy = cl * grid.sinLon[x] + wr[3 * x + 1];
      const qz = sl + wr[3 * x + 2];
      t = ctx.locate(qx, qy, qz, x === 0 ? rowStart : t, bary);
      const land = terrain ? terrain[4 * (y * width + x) + 3] >= 128 : ctx.coastField(qx, qy, qz, t, bary, oct) >= 0;
      // The previous pixel's owner is a good extra starting candidate.
      const cellId = ctx.ownerCell(qx, qy, qz, t, land, lastLand === land ? lastCell : -1);
      lastCell = cellId;
      lastLand = land;
      const o = 4 * (y * width + x);
      encodeCellId(cellId, out, o);
      out[o + 3] = land ? CELL_ID_LAND_ALPHA : CELL_ID_WATER_ALPHA;
    }
  }
  return out;
}
