/**
 * Placement of relief glyphs: mountains laid along the crests (big peaks
 * first, overlapping like hand-drawn ranges, thinning out on the flanks),
 * volcanoes, and hills where the ground is broken (local relief and slope,
 * not mere altitude — high plateaus stay open), in small clusters.
 *
 * Symbols grow a little when the plate is zoomed in (`symbolScale`), as an
 * engraver draws a regional sheet with bolder, fewer peaks than a continent.
 */
import { hash01 } from "../core/rng";
import type { PhysicalWorld } from "../world/types";
import { boxBlur } from "./contour";
import { noiseFor, sampleAt, type FieldGrid } from "./field";
import { Occupancy, PointHash } from "./occupancy";
import type { Projection } from "./projection";

export type TerrainGlyph =
  | { t: "mtn"; x: number; y: number; w: number; h: number; v: number; snow: number; cell: number }
  | { t: "volc"; x: number; y: number; w: number; h: number; v: number; active: boolean; cell: number }
  | { t: "hill"; x: number; y: number; w: number; h: number; v: number }
  | { t: "tree"; kind: TreeKind; x: number; y: number; s: number; v: number; edge: boolean }
  | { t: "marsh"; x: number; y: number; s: number; v: number }
  | { t: "grass"; x: number; y: number; s: number; v: number }
  | { t: "dune"; x: number; y: number; s: number; v: number }
  | { t: "ice"; x: number; y: number; s: number; v: number };

export type TreeKind = "decid" | "conif" | "palm" | "jungle" | "acacia" | "shrub" | "snowconif";

export interface ReliefResult {
  glyphs: TerrainGlyph[];
  /** Mountain and hill bodies, for keeping other glyphs and labels clear. */
  hash: PointHash;
}

const OUT = { x: 0, y: 0 };

/** Symbol scale for a plate: 1 at ~4 km/px, larger when zoomed in, a little smaller on world views. */
export function symbolScale(proj: Projection): number {
  return Math.max(0.85, Math.min(1.5, Math.pow(4 / proj.kmPerPx, 0.28)));
}

export function placeRelief(world: PhysicalWorld, proj: Projection, f: FieldGrid, occ: Occupancy, k: number, density = 1): ReliefResult {
  const glyphs: TerrainGlyph[] = [];
  const zs = symbolScale(proj);
  const ks = k * zs;
  const hash = new PointHash(24 * ks);
  const { gx, gy, step } = f;
  const nz = noiseFor(world.params.seed, "relief");
  const sp = world.mesh.meanSpacing;
  const pxPerSpacing = (sp * proj.R) / proj.kmPerPx;
  const blurNodes = Math.max(1, Math.round((0.9 * pxPerSpacing) / step));
  const eBlur = boxBlur(f.elev, gx, gy, Math.min(40, blurNodes), 2);
  // Gradient magnitude in km of rise per cell spacing (independent of zoom).
  const grad = (node: number): number => {
    const i = node % gx, j = (node - i) / gx;
    const ex = f.elev[j * gx + Math.min(gx - 1, i + 1)] - f.elev[j * gx + Math.max(0, i - 1)];
    const ey = f.elev[Math.min(gy - 1, j + 1) * gx + i] - f.elev[Math.max(0, j - 1) * gx + i];
    return (Math.hypot(ex, ey) / (2 * step)) * pxPerSpacing;
  };
  const rect = proj.rect;
  const inside = (x: number, y: number, m: number) => x > rect.x + m && x < rect.x + rect.w - m && y > rect.y + m && y < rect.y + rect.h - m;
  const landAt = (x: number, y: number) => sampleAt(f, f.coast, x, y);
  const cellAt = (x: number, y: number) => {
    const i = Math.round((x - f.x0) / step), j = Math.round((y - f.y0) / step);
    return f.cell[Math.max(0, Math.min(gy - 1, j)) * gx + Math.max(0, Math.min(gx - 1, i))];
  };

  // --- Volcanoes -------------------------------------------------------------
  for (const feat of world.features) {
    if (feat.kind !== "volcano") continue;
    const c = feat.anchor;
    const x3 = world.mesh.xyz[3 * c], y3 = world.mesh.xyz[3 * c + 1], z3 = world.mesh.xyz[3 * c + 2];
    if (!proj.inCap(x3, y3, z3) || !proj.forward(x3, y3, z3, OUT)) continue;
    let x = OUT.x, y = OUT.y;
    const el = Number(feat.attrs.elevation ?? world.elevation[c]);
    const w = ks * (20 + 5 * Math.min(4, Math.max(0, el - 1)));
    const h = w * 0.8;
    y += h * 0.35;
    if (!inside(x, y - h, 6 * k) || landAt(x, y) <= 0.05 || landAt(x, y - h * 0.5) <= 0) {
      if (landAt(OUT.x, OUT.y) <= 0) continue;
      x = OUT.x;
      y = OUT.y;
    }
    if (occ.maxIn(x - w * 0.4, y - h, x + w * 0.4, y) >= 3) continue;
    glyphs.push({ t: "volc", x, y, w, h, v: hash01(c, 31), active: feat.attrs.activity === "active", cell: c });
    hash.add(x, y - h * 0.3, w * 0.5);
  }

  // --- Mountains ---------------------------------------------------------------
  type Cand = { x: number; y: number; pr: number; mt: number; e: number; node: number; crest: number };
  const cands: Cand[] = [];
  const sub = Math.max(1, Math.round((3 * ks) / step));
  for (let j = 0; j < gy; j += sub) {
    for (let i = 0; i < gx; i += sub) {
      const node = j * gx + i;
      if (f.coast[node] <= 0.08) continue;
      const e = f.elev[node];
      if (e < 0.95) continue;
      const jx = (hash01(node, 5) - 0.5) * sub * step, jy = (hash01(node, 6) - 0.5) * sub * step;
      const x = f.x0 + i * step + jx, y = f.y0 + j * step + jy;
      if (!inside(x, y, 4 * k)) continue;
      const crest = e - eBlur[node];
      const g = grad(node);
      const mt = Math.max(0, Math.min(1, (e - 1.0) / 2.4));
      const n1 = nz.noise((x * 0.02) / ks, (y * 0.02) / ks, 1.3);
      // Ranges read as chains: crests and steep ground keep their peaks, high flat ground thins out.
      const keep = mt * 0.75 + Math.max(0, crest) * 1.8 + Math.min(0.6, g * 0.8) + 0.35 * n1;
      if (keep < 0.45 / density) continue;
      cands.push({ x, y, pr: e + 1.8 * Math.max(-0.2, crest) + 0.25 * n1, mt, e, node, crest });
    }
  }
  cands.sort((a, b) => b.pr - a.pr || a.node - b.node);
  for (const c of cands) {
    const v = hash01(c.node, 9);
    // Big peaks on the crest line, smaller ones on the flanks.
    const w = ks * (12 + 24 * Math.pow(c.mt, 0.8) + 14 * Math.min(1, Math.max(0, c.crest) * 2.5)) * (0.82 + 0.36 * v);
    const h = w * (0.5 + 0.22 * c.mt + 0.16 * hash01(c.node, 10));
    if (hash.conflicts(c.x, c.y, w / 2, 0.76, 2.3, 30 * ks)) continue;
    // Feet on land, clear of big rivers, labels and icons.
    if (landAt(c.x - w * 0.45, c.y) <= 0 || landAt(c.x + w * 0.45, c.y) <= 0 || landAt(c.x, c.y - h * 0.5) <= 0 || landAt(c.x, c.y + 2 * k) <= 0) continue;
    if (occ.maxIn(c.x - w * 0.3, c.y - h * 0.45, c.x + w * 0.3, c.y) >= 2) continue;
    if (occ.maxIn(c.x - w * 0.45, c.y - h, c.x + w * 0.45, c.y) >= 3) continue;
    const temp = world.temperature[cellAt(c.x, c.y)] ?? 10;
    const snow = c.e > 2.6 || temp < -4 ? Math.min(1, (c.e - 2.2) / 1.5 + (temp < -4 ? 0.4 : 0)) : 0;
    glyphs.push({ t: "mtn", x: c.x, y: c.y, w, h, v, snow: Math.max(0, snow), cell: cellAt(c.x, c.y) });
    hash.add(c.x, c.y, w / 2);
  }

  // --- Hills: broken ground, in small clusters ------------------------------------
  const hcands: Cand[] = [];
  const hsub = Math.max(1, Math.round((6 * ks) / step));
  const hillsRegion = new Set<number>();
  for (const feat of world.features) if (feat.kind === "hills") for (const c of feat.cells) hillsRegion.add(c);
  for (let j = 0; j < gy; j += hsub) {
    for (let i = 0; i < gx; i += hsub) {
      const node = j * gx + i;
      if (f.coast[node] <= 0.15) continue;
      const e = f.elev[node];
      if (e < 0.18 || e > 2.2) continue;
      const rel = Math.abs(e - eBlur[node]);
      const g = grad(node);
      const inHills = hillsRegion.has(f.cell[node]);
      const x = f.x0 + i * step + (hash01(node, 15) - 0.5) * hsub * step * 1.3;
      const y = f.y0 + j * step + (hash01(node, 16) - 0.5) * hsub * step * 1.3;
      // Rough ground: slope and local relief, a little altitude; clumped by noise.
      let p = Math.min(0.7, g * 1.1) + Math.min(0.5, rel * 2.2) + (inHills ? 0.4 : 0) + Math.max(0, Math.min(0.25, (e - 0.5) * 0.4));
      if (e > 1.4) p *= 0.5;
      p += 0.45 * nz.noise((x * 0.012) / ks, (y * 0.012) / ks, 7.7);
      if (p < 0.62 / density) continue;
      if (!inside(x, y, 4 * k)) continue;
      hcands.push({ x, y, pr: p, mt: 0, e, node, crest: 0 });
    }
  }
  hcands.sort((a, b) => b.pr - a.pr || a.node - b.node);
  for (const c of hcands) {
    const v = hash01(c.node, 19);
    const w = ks * (10 + 7 * v + 5 * Math.min(1, c.e)) * (c.pr > 1 ? 1.15 : 1);
    const h = w * (0.34 + 0.14 * hash01(c.node, 20));
    if (hash.conflicts(c.x, c.y, w / 2, 0.9, 1.7, 30 * ks)) continue;
    if (landAt(c.x - w * 0.5, c.y) <= 0.05 || landAt(c.x + w * 0.5, c.y) <= 0.05) continue;
    if (occ.maxIn(c.x - w * 0.4, c.y - h, c.x + w * 0.4, c.y) >= 1) continue;
    glyphs.push({ t: "hill", x: c.x, y: c.y, w, h, v });
    hash.add(c.x, c.y, w / 2);
    // A smaller companion hump behind and to one side, sometimes.
    if (hash01(c.node, 21) < 0.45) {
      const side = hash01(c.node, 22) < 0.5 ? -1 : 1;
      const w2 = w * (0.55 + 0.2 * hash01(c.node, 23));
      const x2 = c.x + side * w * 0.48, y2 = c.y - h * 0.35;
      if (!hash.conflicts(x2, y2, w2 / 2, 0.6, 1.7, 30 * ks) && landAt(x2, y2) > 0.1 && occ.maxIn(x2 - w2 * 0.4, y2 - w2 * 0.4, x2 + w2 * 0.4, y2) < 1) {
        glyphs.push({ t: "hill", x: x2, y: y2, w: w2, h: w2 * 0.4, v: hash01(c.node, 24) });
        hash.add(x2, y2, w2 / 2);
      }
    }
  }
  return { glyphs, hash };
}
