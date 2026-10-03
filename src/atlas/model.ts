/**
 * Plate model: all geometry of an atlas plate, computed without any drawing
 * (pure; runs in Node). `drawPlate` (draw.ts) turns it into ink.
 *
 * Order matters: water and rivers first; then the political layer and the
 * settlements; then the furniture (cartouche, compass, scale, inset) is
 * placed where it hides least; then labels are placed around all of that; and
 * finally the terrain glyphs fill the remaining ground, leaving labels,
 * icons and rivers clear (as an engraver would).
 */
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import { romanizeWord } from "../lang/index";
import { layoutWord } from "../script/index";
import type { Script as ScriptData } from "../script/types";
import { sampleField, type FieldGrid } from "./field";
import { Projection, type AtlasView, type MapRect } from "./projection";
import { PALETTES, type AtlasStyle, type Palette } from "./style";
import { buildWater, type WaterGeometry } from "./water";
import { buildRivers, type RiverPath } from "./rivers";
import { Occupancy } from "./occupancy";
import { placeRelief, type TerrainGlyph } from "./relief";
import { placeGround } from "./vegetation";
import { buildPolitical, emphasise, type PoliticalGeom } from "./political";
import { iconHalfWidth, selectBattles, selectPlaces, selectRoutes, type BattleMark, type PlaceMark, type RouteLine } from "./places";
import { LabelPlacer, type PlacedLabel } from "./labels";
import { planLabels } from "./labelplan";
import { planDecor, type Decor, type ScriptLine } from "./decor";
import { dominantCulture, nativeUnit, plateTitle, type PlateTitle } from "./names";
import { atYear, ownerAt } from "./hist";
import type { PlateSubject } from "./planner";
import { buildShade, type ShadeRaster } from "./shade";
import { placeOrnaments, type Ornament } from "./ornaments";
import { hashString } from "../core/rng";

export interface AtlasInput {
  world: PhysicalWorld;
  history: History | null;
  year: number;
  view: AtlasView;
  width: number;
  height: number;
  seed: string;
  style?: AtlasStyle;
  /** Overrides the generated main title. */
  title?: string;
  /** What the plate is about (from a planner); drives the cartouche title. */
  subject?: PlateSubject;
  /** Feature toggles (all default true). */
  show?: Partial<{ labels: boolean; inset: boolean; compass: boolean; scale: boolean; cartouche: boolean; routes: boolean; battles: boolean; graticule: boolean; ornaments: boolean }>;
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
  year: number;
  /** Map area inside the frame. */
  rect: MapRect;
  /** Outer frame rule rectangle. */
  frame: MapRect;
  proj: Projection;
  field: FieldGrid;
  water: WaterGeometry;
  rivers: RiverPath[];
  political: PoliticalGeom | null;
  /** Biome wash + hill-shading raster (relief style), or null. */
  shade: ShadeRaster | null;
  /** Settlements drawn (with an icon). */
  places: PlaceMark[];
  routes: RouteLine[];
  battles: BattleMark[];
  labels: PlacedLabel[];
  decor: Decor;
  title: PlateTitle;
  /** Terrain glyphs sorted back to front (by base y). */
  glyphs: TerrainGlyph[];
  /** Desert stipple dots, x/y pairs. */
  stipple: number[];
  /** Forest floor discs (x, y, r), unioned into a soft tint under the trees. */
  forestFloor: number[];
  /** Ships and sea serpents in open water. */
  ornaments: Ornament[];
  occ: Occupancy;
  /** World seed (the parchment sheet depends only on it and the plate size). */
  seed: string;
  /** Seed for decorative randomness (seed + view). */
  decoSeed: string;
  timings: Record<string, number>;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function plateLayout(width: number, height: number): { k: number; frame: MapRect; rect: MapRect } {
  const k = Math.max(0.42, Math.min(1.8, Math.min(width, height) / 1100));
  const m = Math.round(22 * k);
  const band = Math.round(22 * k);
  const frame = { x: m, y: m, w: width - 2 * m, h: height - 2 * m };
  const rect = { x: m + band, y: m + band, w: width - 2 * (m + band), h: height - 2 * (m + band) };
  return { k, frame, rect };
}

/** Native-script lettering of a name, if the people write at the year. */
function scriptLine(h: History, culture: number, year: number, phonemes: string[] | undefined, salt: number): ScriptLine | null {
  if (!phonemes || !phonemes.length || culture < 0) return null;
  const c = h.cultures[culture];
  const e = atYear(c?.scripts, year);
  if (!e || e.script < 0) return null;
  const s = h.scripts[e.script];
  const data = s?.data as ScriptData | undefined;
  if (!data || !data.style || data.direction === "ttb") return null;
  try {
    const lay = layoutWord(data, phonemes, { salt });
    if (!lay.items.length || !(lay.x1 > lay.x0)) return null;
    return { items: lay.items.map((it) => ({ d: it.d, m: Array.from(it.m) })), x0: lay.x0, y0: lay.y0, x1: lay.x1, y1: lay.y1, name: s.name };
  } catch {
    return null;
  }
}

export function buildPlateModel(input: AtlasInput, measure: Measure): PlateModel {
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (name: string) => {
    const t2 = now();
    timings[name] = Math.round((t2 - t) * 10) / 10;
    t = t2;
  };
  const show = { labels: true, inset: true, compass: true, scale: true, cartouche: true, routes: true, battles: true, graticule: true, ornaments: true, ...input.show };
  const h = input.history;
  const year = Math.round(input.year);
  const style = input.style ?? (h ? "political" : "antique");
  const pal = PALETTES[style];
  const { k, frame, rect } = plateLayout(input.width, input.height);
  const world = input.world;
  const proj = new Projection(input.view, rect, world.params.radiusKm);
  const decoSeed = `${input.seed}|${input.view.centerLat.toFixed(3)}|${input.view.centerLon.toFixed(3)}|${input.view.radiusKm.toFixed(1)}`;

  const step = Math.max(2, Math.min(4, 2.6 * Math.sqrt(k)));
  const field = sampleField(world, proj, { step, pad: 3 });
  lap("field");
  const water = buildWater(field, { rippleCount: 6, rippleGap: 6.5 * k, minLoopPx: 6 * k });
  lap("water");
  const sp = world.mesh.meanSpacing;
  const pxPerSpacing = (sp * proj.R) / proj.kmPerPx;
  const minOrder = pxPerSpacing < 14 ? 2 : 1;
  const rivers = buildRivers(world, proj, field, { minOrder, minFlow: pxPerSpacing < 14 ? 250 : 60, k });
  lap("rivers");
  const shade = pal.hillshade > 0 || pal.biomeWash > 0 ? buildShade(world, proj, field, k, { hill: pal.hillshade, biome: pal.biomeWash }) : null;
  lap("shade");

  // --- History layers -----------------------------------------------------------
  const political = h ? buildPolitical(world, h, year, field, k) : null;
  const ownerCell = h ? ownerAt(h, year) : null;
  if (political && h && input.subject) {
    const focus = new Set<number>();
    if (input.subject.kind === "realm") focus.add(input.subject.polity);
    if (input.subject.kind === "war") {
      const w = h.wars[input.subject.war];
      if (w) for (const id of [...w.attackers, ...w.defenders, ...w.joined.map((j) => j.polity)]) focus.add(id);
    }
    emphasise(political, focus);
  }
  const allPlaces = h ? selectPlaces(world, h, year, proj, field, k) : [];
  // Pennants fly the realm's wash colour; capitals of realms that are small on this plate get a modest seat symbol.
  if (political) {
    const byId = new Map(political.realms.map((r) => [r.id, r]));
    const minorPx = 9000 * k * k;
    for (const p of allPlaces) {
      if (p.capitalOf < 0) continue;
      const r = byId.get(p.capitalOf);
      if (r) p.color = r.color;
      const areaPx = r ? r.nodes * field.step * field.step : 0;
      if (areaPx < minorPx && !p.great) {
        p.minor = true;
        p.r = iconHalfWidth("capital", false, k, true);
        p.rank -= 1.2;
      }
    }
    allPlaces.sort((a, b) => b.rank - a.rank || a.id - b.id);
  }
  const routes = h && show.routes ? selectRoutes(world, h, year, proj) : [];
  const warSubject = input.subject?.kind === "war" ? input.subject.war : undefined;
  const battleMarks = h && show.battles ? selectBattles(world, h, year, proj, k, { war: warSubject }) : [];
  lap("history");

  // --- Title, furniture --------------------------------------------------------
  const prominent = prominentFeature(world, field);
  const realmsInView = political ? political.realms.filter((r) => r.nodes > 400).length : 0;
  const title = plateTitle(world, h, year, ownerCell, input.subject, prominent, realmsInView);
  if (input.title) title.main = input.title;
  const culture = h ? (title.native?.culture ?? -1) >= 0 ? title.native!.culture : dominantCulture(h, political?.ownerNode ?? null, year) : -1;
  const unitCulture = h ? dominantCulture(h, political?.ownerNode ?? null, year) : -1;
  const unit = nativeUnit(h, unitCulture >= 0 ? unitCulture : culture, year, romanizeWord as (o: unknown, w: string[]) => string);
  const script = h && title.native ? scriptLine(h, title.native.culture, year, title.native.name.phonemes, 7) : null;
  const decor = planDecor({
    world, proj, f: field, k, width: input.width, height: input.height, measure, title, script, unit, places: allPlaces, pal,
    inset: show.inset && input.view.radiusKm < world.params.radiusKm * 1.2,
  });
  if (!show.cartouche) decor.cartouche = null;
  if (!show.compass) decor.compass = null;
  if (!show.scale) decor.scale = null;
  if (!show.graticule) decor.graticule = { lines: [], ticks: [], band: [] };
  lap("decor");

  // --- Labels -----------------------------------------------------------------------
  const occ = new Occupancy(input.width, input.height, Math.max(2, 3 * k));
  for (const r of rivers) {
    const wMax = r.width.reduce((a, b) => Math.max(a, b), 0);
    occ.markLine(r.pts, Math.max(1.5 * k, wMax / 2 + 1 * k), wMax > 1.8 * k ? 2 : 1);
  }
  for (const l of water.coastLoops) occ.markLine(l, 1.5 * k, 1, true);
  const placer = new LabelPlacer({ x0: rect.x + 3 * k, y0: rect.y + 3 * k, x1: rect.x + rect.w - 3 * k, y1: rect.y + rect.h - 3 * k }, measure);
  for (const b of decor.reserved) placer.reserve(b);
  let labels: PlacedLabel[] = [];
  let places: PlaceMark[] = [];
  let battles: BattleMark[] = [];
  if (h && show.labels) {
    const res = planLabels({ world, h, year, proj, f: field, water, rivers, pol: political, places: allPlaces, battles: battleMarks, k, pal, style, measure, placer, occ, ownerCell, focusWar: warSubject !== undefined });
    labels = res.labels;
    places = res.shown;
    battles = res.battles;
  } else if (h) {
    places = allPlaces.filter((p) => p.tier !== "village" && p.tier !== "ruin");
  }
  const ornaments = show.ornaments && style !== "relief" ? placeOrnaments(field, water, rect, routes, placer, decor.reserved, k, hashString(decoSeed) & 0xffff, decor.compass) : [];
  lap("labels");

  // Keep glyphs off labels, icons and furniture.
  for (const l of labels) {
    const grow = l.kind === "realm" ? 0.5 * k : 1.5 * k;
    for (const b of l.boxes) occ.markBox(b.x0 - grow, b.y0 - grow, b.x1 + grow, b.y1 + grow, 3);
  }
  for (const p of places) occ.markBox(p.x - p.r - 2 * k, p.y - p.r * 1.8 - 2 * k, p.x + p.r + 2 * k, p.y + p.r + 2 * k, 3);
  for (const b of battles) occ.markBox(b.x - 6 * k, b.y - 6 * k, b.x + 6 * k, b.y + 6 * k, 3);
  for (const b of decor.reserved) occ.markBox(b.x0, b.y0, b.x1, b.y1, 3);
  if (decor.compass) {
    const c = decor.compass;
    occ.markBox(c.x - c.r * 1.15, c.y - c.r * 1.35, c.x + c.r * 1.15, c.y + c.r * 1.15, 3);
  }

  const relief = placeRelief(world, proj, field, occ, k);
  lap("relief");
  const ground = placeGround(world, proj, field, occ, relief.hash, k);
  const glyphs = relief.glyphs.concat(ground.glyphs).sort((a, b) => a.y - b.y || a.x - b.x);
  lap("ground");
  return {
    width: input.width, height: input.height, k, style, pal, year, rect, frame, proj, field, water, rivers, political, shade, places, routes, battles,
    labels, decor, title, glyphs, stipple: ground.stipple, forestFloor: ground.floor, ornaments, occ, seed: input.seed, decoSeed, timings,
  };
}

/**
 * The most prominent geographic feature in view: the landmass or water body
 * covering most of the plate (for titles of free views).
 */
function prominentFeature(world: PhysicalWorld, f: FieldGrid): PhysicalWorld["features"][number] | null {
  const land = new Map<number, number>(), wet = new Map<number, number>();
  let nLand = 0, nWet = 0;
  for (let q = 0; q < f.cell.length; q += 7) {
    const c = f.cell[q];
    if (c < 0) continue;
    if (f.coast[q] > 0) {
      const lm = world.landmassOf[c];
      if (lm >= 0) land.set(lm, (land.get(lm) ?? 0) + 1);
      nLand++;
    } else {
      const wb = world.waterBodyOf[c];
      if (wb >= 0) wet.set(wb, (wet.get(wb) ?? 0) + 1);
      nWet++;
    }
  }
  const best = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const bl = best(land), bw = best(wet);
  // A sea or gulf that is mostly in view, surrounded by land, names the plate.
  if (bw && nLand > 0) {
    const ft = world.features[bw[0]];
    if (ft && (ft.kind === "sea" || ft.kind === "bay" || ft.kind === "lake") && bw[1] > nWet * 0.5 && nLand > nWet * 0.6) return ft;
  }
  if (bl) return world.features[bl[0]] ?? null;
  if (bw) return world.features[bw[0]] ?? null;
  return null;
}
