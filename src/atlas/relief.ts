/**
 * Placement of relief glyphs: mountains laid along the crests (big peaks
 * first, overlapping like hand-drawn ranges), volcanoes, and hills.
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
  | { t: "tree"; kind: TreeKind; x: number; y: number; s: number; v: number }
  | { t: "marsh"; x: number; y: number; s: number; v: number }
  | { t: "grass"; x: number; y: number; s: number; v: number }
  | { t: "dune"; x: number; y: number; s: number; v: number }
  | { t: "ice"; x: number; y: number; s: number; v: number };

export type TreeKind = "decid" | "conif" | "palm" | "jungle" | "acacia" | "shrub" | "snowconif";

export interface ReliefResult {
  glyphs: TerrainGlyph[];
  /** Mountain bodies, for keeping other glyphs and labels clear. */
  hash: PointHash;
}

const OUT = { x: 0, y: 0 };

export function placeRelief(world: PhysicalWorld, proj: Projection, f: FieldGrid, occ: Occupancy, k: number, density = 1): ReliefResult {
  const glyphs: TerrainGlyph[] = [];
  const hash = new PointHash(24 * k);
  const { gx, gy, step } = f;
  const nz = noiseFor(world.params.seed, "relief");
  const sp = world.mesh.meanSpacing;
  const pxPerSpacing = (sp * proj.R) / proj.kmPerPx;
  const blurNodes = Math.max(1, Math.round((0.9 * pxPerSpacing) / step));
  const eBlur = boxBlur(f.elev, gx, gy, Math.min(40, blurNodes), 2);
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
    const w = k * (20 + 5 * Math.min(4, Math.max(0, el - 1)));
    const h = w * 0.8;
    y += h * 0.35;
    if (!inside(x, y - h, 6 * k) || landAt(x, y) <= 0.05 || landAt(x, y - h * 0.5) <= 0) {
      // nudge towards the cell centre / skip if in the sea
      if (landAt(OUT.x, OUT.y) <= 0) continue;
      x = OUT.x;
      y = OUT.y;
    }
    glyphs.push({ t: "volc", x, y, w, h, v: hash01(c, 31), active: feat.attrs.activity === "active", cell: c });
    hash.add(x, y - h * 0.3, w * 0.5);
  }

  // --- Mountains ---------------------------------------------------------------
  type Cand = { x: number; y: number; pr: number; mt: number; e: number; node: number };
  const cands: Cand[] = [];
  const sub = Math.max(1, Math.round((3 * k) / step));
  for (let j = 0; j < gy; j += sub) {
    for (let i = 0; i < gx; i += sub) {
      const node = j * gx + i;
      if (f.coast[node] <= 0.08) continue;
      const e = f.elev[node];
      if (e < 1.0) continue;
      const jx = (hash01(node, 5) - 0.5) * sub * step, jy = (hash01(node, 6) - 0.5) * sub * step;
      const x = f.x0 + i * step + jx, y = f.y0 + j * step + jy;
      if (!inside(x, y, 4 * k)) continue;
      const crest = e - eBlur[node];
      const mt = Math.max(0, Math.min(1, (e - 1.0) / 2.6));
      const n1 = nz.noise(x * 0.02 / k, y * 0.02 / k, 1.3);
      // Thin out the lower slopes irregularly so ranges read as chains, not blankets.
      const keep = mt * 1.5 + Math.max(0, crest) * 1.6 + 0.3 * n1;
      if (keep < 0.3 / density) continue;
      cands.push({ x, y, pr: e + 1.8 * Math.max(-0.2, crest) + 0.25 * n1, mt, e, node });
    }
  }
  cands.sort((a, b) => b.pr - a.pr || a.node - b.node);
  for (const c of cands) {
    const v = hash01(c.node, 9);
    const w = k * (15 + 26 * Math.pow(c.mt, 0.8)) * (0.85 + 0.3 * v);
    const h = w * (0.5 + 0.22 * c.mt + 0.16 * hash01(c.node, 10));
    if (hash.conflicts(c.x, c.y, w / 2, 0.7, 2.3, 30 * k)) continue;
    // Feet on land, clear of big rivers.
    if (landAt(c.x - w * 0.45, c.y) <= 0 || landAt(c.x + w * 0.45, c.y) <= 0 || landAt(c.x, c.y - h * 0.5) <= 0 || landAt(c.x, c.y + 2 * k) <= 0) continue;
    if (occ.maxIn(c.x - w * 0.3, c.y - h * 0.45, c.x + w * 0.3, c.y) >= 2) continue;
    const temp = world.temperature[cellAt(c.x, c.y)] ?? 10;
    const snow = c.e > 2.6 || temp < -4 ? Math.min(1, (c.e - 2.2) / 1.5 + (temp < -4 ? 0.4 : 0)) : 0;
    glyphs.push({ t: "mtn", x: c.x, y: c.y, w, h, v, snow: Math.max(0, snow), cell: cellAt(c.x, c.y) });
    hash.add(c.x, c.y, w / 2);
  }

  // --- Hills -------------------------------------------------------------------
  const hcands: Cand[] = [];
  const hsub = Math.max(1, Math.round((5 * k) / step));
  const hillsRegion = new Set<number>();
  for (const feat of world.features) if (feat.kind === "hills") for (const c of feat.cells) hillsRegion.add(c);
  for (let j = 0; j < gy; j += hsub) {
    for (let i = 0; i < gx; i += hsub) {
      const node = j * gx + i;
      if (f.coast[node] <= 0.15) continue;
      const e = f.elev[node];
      const rel = Math.abs(e - eBlur[node]);
      const inHills = hillsRegion.has(f.cell[node]);
      let p = Math.max(0, Math.min(1, (e - 0.38) / 0.45)) * 0.8 + (inHills ? 0.45 : 0) + Math.min(0.4, rel * 1.5);
      if (e > 1.6) p *= 0.3;
      const x = f.x0 + i * step + (hash01(node, 15) - 0.5) * hsub * step;
      const y = f.y0 + j * step + (hash01(node, 16) - 0.5) * hsub * step;
      p += 0.35 * nz.noise(x * 0.015 / k, y * 0.015 / k, 7.7);
      if (p < 0.55 / density) continue;
      if (!inside(x, y, 4 * k)) continue;
      hcands.push({ x, y, pr: p, mt: 0, e, node });
    }
  }
  hcands.sort((a, b) => b.pr - a.pr || a.node - b.node);
  for (const c of hcands) {
    const v = hash01(c.node, 19);
    const w = k * (9 + 5 * v + 4 * Math.min(1, c.e));
    const h = w * (0.32 + 0.12 * hash01(c.node, 20));
    if (hash.conflicts(c.x, c.y, w / 2, 0.95, 1.6, 30 * k)) continue;
    if (landAt(c.x - w * 0.5, c.y) <= 0.05 || landAt(c.x + w * 0.5, c.y) <= 0.05) continue;
    if (occ.maxIn(c.x - w * 0.4, c.y - h, c.x + w * 0.4, c.y) >= 1) continue;
    glyphs.push({ t: "hill", x: c.x, y: c.y, w, h, v });
    hash.add(c.x, c.y, w / 2);
  }
  return { glyphs, hash };
}
