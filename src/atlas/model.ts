/**
 * Plate model: all geometry of an atlas plate, computed without any drawing
 * (pure; runs in Node). `drawPlate` (draw.ts) turns it into ink.
 */
import { Rng } from "../core/rng";
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import { sampleField, type FieldGrid } from "./field";
import { Projection, type AtlasView, type MapRect } from "./projection";
import { PALETTES, type AtlasStyle, type Palette } from "./style";
import { buildWater, type WaterGeometry } from "./water";
import { buildRivers, type RiverPath } from "./rivers";
import { Occupancy } from "./occupancy";
import { placeRelief, type TerrainGlyph } from "./relief";
import { placeGround } from "./vegetation";

export interface AtlasInput {
  world: PhysicalWorld;
  history: History | null;
  year: number;
  view: AtlasView;
  width: number;
  height: number;
  seed: string;
  style?: AtlasStyle;
  title?: string;
}

/** Text measurement: width in px of `text` drawn with CSS font `font`. */
export type Measure = (font: string, text: string) => number;

export interface PlateModel {
  width: number;
  height: number;
  /** Symbol scale factor (1 at a 1100-px-high plate). */
  k: number;
  style: AtlasStyle;
  pal: Palette;
  /** Map area inside the frame. */
  rect: MapRect;
  /** Outer frame rule rectangle. */
  frame: MapRect;
  proj: Projection;
  field: FieldGrid;
  water: WaterGeometry;
  rivers: RiverPath[];
  /** Terrain glyphs sorted back to front (by base y). */
  glyphs: TerrainGlyph[];
  /** Desert stipple dots, x/y pairs. */
  stipple: number[];
  occ: Occupancy;
  /** Seed for decorative randomness (seed + view). */
  decoSeed: string;
  timings: Record<string, number>;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function plateLayout(width: number, height: number): { k: number; frame: MapRect; rect: MapRect } {
  const k = Math.max(0.42, Math.min(1.8, Math.min(width, height) / 1100));
  const m = Math.round(26 * k);
  const band = Math.round(12 * k);
  const frame = { x: m, y: m, w: width - 2 * m, h: height - 2 * m };
  const rect = { x: m + band, y: m + band, w: width - 2 * (m + band), h: height - 2 * (m + band) };
  return { k, frame, rect };
}

export function buildPlateModel(input: AtlasInput, _measure: Measure): PlateModel {
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (name: string) => {
    const t2 = now();
    timings[name] = Math.round((t2 - t) * 10) / 10;
    t = t2;
  };
  const style = input.style ?? (input.history ? "political" : "antique");
  const pal = PALETTES[style];
  const { k, frame, rect } = plateLayout(input.width, input.height);
  const proj = new Projection(input.view, rect, input.world.params.radiusKm);
  const decoSeed = `${input.seed}|${input.view.centerLat.toFixed(3)}|${input.view.centerLon.toFixed(3)}|${input.view.radiusKm.toFixed(1)}`;
  void new Rng(decoSeed);

  const step = Math.max(2, Math.min(4, 2.6 * Math.sqrt(k)));
  const field = sampleField(input.world, proj, { step, pad: 3 });
  lap("field");
  const water = buildWater(field, { rippleCount: 6, rippleGap: 6.5 * k, minLoopPx: 6 * k });
  lap("water");
  const world = input.world;
  const sp = world.mesh.meanSpacing;
  const pxPerSpacing = (sp * proj.R) / proj.kmPerPx;
  const minOrder = pxPerSpacing < 14 ? 2 : 1;
  const rivers = buildRivers(world, proj, field, { minOrder, minFlow: pxPerSpacing < 14 ? 250 : 60, k });
  lap("rivers");
  const occ = new Occupancy(input.width, input.height, Math.max(2, 3 * k));
  for (const r of rivers) {
    const wMax = r.width.reduce((a, b) => Math.max(a, b), 0);
    occ.markLine(r.pts, Math.max(1.5 * k, wMax / 2 + 1 * k), wMax > 1.8 * k ? 2 : 1);
  }
  for (const l of water.coastLoops) occ.markLine(l, 1.5 * k, 1, true);
  const relief = placeRelief(world, proj, field, occ, k);
  lap("relief");
  const ground = placeGround(world, proj, field, occ, relief.hash, k);
  const glyphs = relief.glyphs.concat(ground.glyphs).sort((a, b) => a.y - b.y || a.x - b.x);
  lap("ground");
  return { width: input.width, height: input.height, k, style, pal, rect, frame, proj, field, water, rivers, glyphs, stipple: ground.stipple, occ, decoSeed, timings };
}
