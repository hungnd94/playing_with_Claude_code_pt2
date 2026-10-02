/**
 * Ground cover: forests as clumped masses of tree glyphs (kind by biome and
 * climate), marsh tufts, grass, dunes and desert stipple, ice strokes.
 */
import { hash01 } from "../core/rng";
import { Biome, type PhysicalWorld } from "../world/types";
import { noiseFor, sampleAt, type FieldGrid } from "./field";
import type { Occupancy, PointHash } from "./occupancy";
import type { Projection } from "./projection";
import type { TerrainGlyph, TreeKind } from "./relief";

export interface GroundResult {
  glyphs: TerrainGlyph[];
  /** Desert stipple dots (x, y pairs). */
  stipple: number[];
}

interface Cover {
  forest: number;
  kind: TreeKind | null;
  alt?: TreeKind;
  marsh?: number;
  grass?: number;
  dune?: number;
  stipple?: number;
  ice?: number;
}

function coverFor(b: number, temp: number): Cover {
  switch (b) {
    case Biome.TemperateForest: return { forest: 0.95, kind: "decid", alt: "conif" };
    case Biome.TemperateRainforest: return { forest: 1, kind: "conif", alt: "decid" };
    case Biome.Taiga: return { forest: 0.85, kind: temp < -3 ? "snowconif" : "conif" };
    case Biome.Rainforest: return { forest: 1, kind: "jungle", alt: "palm" };
    case Biome.TropicalDryForest: return { forest: 0.6, kind: "decid", alt: "jungle" };
    case Biome.Savanna: return { forest: 0.035, kind: "acacia", grass: 0.03 };
    case Biome.Mediterranean: return { forest: 0.18, kind: "shrub", alt: "decid" };
    case Biome.Wetland: return { forest: 0.2, kind: temp > 18 ? "jungle" : "decid", marsh: 0.5 };
    case Biome.Steppe: return { forest: 0, kind: null, grass: 0.045 };
    case Biome.Grassland: return { forest: 0.015, kind: "decid", grass: 0.04 };
    case Biome.HotDesert: return { forest: 0, kind: null, dune: 0.06, stipple: 1 };
    case Biome.ColdDesert: return { forest: 0, kind: null, stipple: 0.5, grass: 0.02 };
    case Biome.Tundra: return { forest: 0, kind: null, grass: 0.05, marsh: 0.03 };
    case Biome.IceSheet: return { forest: 0, kind: null, ice: 0.12 };
    default: return { forest: 0, kind: null };
  }
}

export function placeGround(world: PhysicalWorld, proj: Projection, f: FieldGrid, occ: Occupancy, mtn: PointHash, k: number, density = 1): GroundResult {
  const glyphs: TerrainGlyph[] = [];
  const stipple: number[] = [];
  const nz = noiseFor(world.params.seed, "forest");
  const rect = proj.rect;
  const treeS = 7.5 * k;
  const gap = treeS * 0.78;
  const nx = Math.ceil(rect.w / gap), ny = Math.ceil(rect.h / gap);
  const landAt = (x: number, y: number) => sampleAt(f, f.coast, x, y);
  const nodeOf = (x: number, y: number) => {
    const i = Math.round((x - f.x0) / f.step), j = Math.round((y - f.y0) / f.step);
    return Math.max(0, Math.min(f.gy - 1, j)) * f.gx + Math.max(0, Math.min(f.gx - 1, i));
  };
  // Clump scale: a few forest masses across the plate, independent of zoom but tied to the ground.
  const clumpScale = 1 / (110 * k);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const id = j * 7919 + i;
      const x = rect.x + (i + 0.5 + (hash01(id, 1) - 0.5) * 0.8) * gap + (j % 2 ? gap * 0.5 : 0);
      const y = rect.y + (j + 0.5 + (hash01(id, 2) - 0.5) * 0.8) * gap;
      if (x < rect.x + 3 * k || x > rect.x + rect.w - 3 * k || y < rect.y + 12 * k || y > rect.y + rect.h - 2 * k) continue;
      const node = nodeOf(x, y);
      const c = f.landCell[node];
      if (c < 0) continue;
      const shore = landAt(x, y);
      if (shore <= 0.12) continue;
      const temp = world.temperature[c];
      const cov = coverFor(world.biome[c], temp);
      const clump = nz.fbm(x * clumpScale, y * clumpScale, 2.2, 3);
      const u = hash01(id, 3);
      // Forest masses.
      if (cov.kind && cov.forest > 0) {
        const inMass = cov.forest >= 0.5
          ? clump > 0.12 - 0.55 * (cov.forest - 0.5) && u > 0.06
          : u < cov.forest * density * Math.max(0, 0.3 + 2.2 * clump);
        if (inMass) {
          let kind: TreeKind = cov.kind;
          if (cov.alt && hash01(id, 4) < 0.18) kind = cov.alt;
          if (kind === "palm" && shore > 0.5) kind = "jungle";
          if (cov.kind === "jungle" && shore < 0.45 && hash01(id, 5) < 0.5) kind = "palm";
          const s = treeS * (kind === "shrub" ? 0.65 : kind === "jungle" ? 1.1 : 1) * (0.88 + 0.24 * hash01(id, 6));
          if (mtn.conflicts(x, y, s * 0.4, 0.85, 1.4, 30 * k)) continue;
          if (occ.maxIn(x - s * 0.35, y - s * 1.1, x + s * 0.35, y + 1) >= 1) continue;
          if (landAt(x, y - s) <= 0.05) continue;
          glyphs.push({ t: "tree", kind, x, y, s, v: hash01(id, 7) });
          continue;
        }
      }
      if (cov.marsh && u < cov.marsh * density * (0.5 + clump)) {
        if (!mtn.conflicts(x, y, 4 * k, 1, 1, 30 * k) && occ.maxIn(x - 5 * k, y - 5 * k, x + 5 * k, y + 2 * k) < 1) {
          glyphs.push({ t: "marsh", x, y, s: 6.5 * k, v: hash01(id, 8) });
          continue;
        }
      }
      if (cov.grass && u < cov.grass * density) {
        if (!mtn.conflicts(x, y, 3 * k, 1, 1, 30 * k) && occ.maxIn(x - 3 * k, y - 4 * k, x + 3 * k, y) < 1) {
          glyphs.push({ t: "grass", x, y, s: 5 * k, v: hash01(id, 9) });
          continue;
        }
      }
      if (cov.dune && u < cov.dune * density * (0.6 + clump)) {
        if (!mtn.conflicts(x, y, 6 * k, 1, 1, 30 * k) && occ.maxIn(x - 7 * k, y - 4 * k, x + 7 * k, y) < 1) {
          glyphs.push({ t: "dune", x, y, s: 9 * k, v: hash01(id, 10) });
          continue;
        }
      }
      if (cov.ice && u < cov.ice * density) {
        glyphs.push({ t: "ice", x, y, s: 7 * k, v: hash01(id, 11) });
        continue;
      }
      if (cov.stipple) {
        // Stipple: several dots per site, denser where the noise says so.
        const nd = Math.floor(cov.stipple * density * 3 * (0.4 + 0.6 * (clump + 0.5)) * (0.5 + hash01(id, 12)));
        for (let q = 0; q < nd; q++) {
          const px = x + (hash01(id, 20 + q) - 0.5) * gap;
          const py = y + (hash01(id, 40 + q) - 0.5) * gap;
          if (landAt(px, py) <= 0.1) continue;
          stipple.push(px, py);
        }
      }
    }
  }
  return { glyphs, stipple };
}
