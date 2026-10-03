/**
 * Land tint raster for the "relief" style: a soft biome watercolour with
 * hill-shading (light from the north-west) computed on the field grid, with
 * fine ridged detail in the mountains so that the shading reads as relief
 * rather than blobs. Pure: returns an RGBA raster (multiplied over the paper
 * by the renderer).
 */
import { Biome, type PhysicalWorld } from "../world/types";
import { boxBlur } from "./contour";
import { noiseFor, type FieldGrid } from "./field";
import type { Projection } from "./projection";

export interface ShadeRaster {
  /** Raster size (= field grid). */
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  /** Screen position of raster pixel (0, 0) centre, and pixel size. */
  x0: number;
  y0: number;
  step: number;
}

const BIOME_TINT: Record<number, [number, number, number]> = {
  [Biome.IceSheet]: [244, 244, 242],
  [Biome.Tundra]: [214, 210, 188],
  [Biome.Taiga]: [168, 178, 140],
  [Biome.Steppe]: [214, 204, 152],
  [Biome.ColdDesert]: [218, 206, 176],
  [Biome.Mediterranean]: [204, 196, 140],
  [Biome.TemperateForest]: [168, 186, 128],
  [Biome.TemperateRainforest]: [148, 178, 128],
  [Biome.HotDesert]: [236, 210, 158],
  [Biome.Savanna]: [222, 200, 130],
  [Biome.TropicalDryForest]: [186, 188, 118],
  [Biome.Rainforest]: [136, 170, 110],
  [Biome.Wetland]: [168, 184, 150],
  [Biome.Alpine]: [216, 210, 198],
  [Biome.Grassland]: [204, 204, 146],
};

export function buildShade(world: PhysicalWorld, proj: Projection, f: FieldGrid, k: number, strength: { hill: number; biome: number }): ShadeRaster {
  const { gx, gy, step } = f;
  const N = gx * gy;
  // Elevation with fine relief detail (ridged noise scaled by elevation, in sphere coordinates).
  const elev = new Float32Array(N);
  const nz = noiseFor(world.params.seed, "shade");
  const sp = world.mesh.meanSpacing;
  const sub = 2;
  const det = new Float32Array(N);
  for (let j = 0; j < gy; j += sub)
    for (let i = 0; i < gx; i += sub) {
      const q = j * gx + i;
      if (f.coast[q] <= 0 || f.elev[q] < 0.45) continue;
      const s = 2.2 / sp;
      det[q] = nz.ridged(f.ux[q] * s, f.uy[q] * s, f.uz[q] * s, 4);
    }
  // Fill skipped nodes from their sampled neighbour.
  for (let j = 0; j < gy; j++)
    for (let i = 0; i < gx; i++) {
      const q = j * gx + i;
      const qi = Math.min(gx - 1, i - (i % sub)), qj = Math.min(gy - 1, j - (j % sub));
      const d = det[qj * gx + qi];
      const e = Math.max(0, f.elev[q]);
      // Ridges only in high ground; lowlands stay smooth.
      elev[q] = e + d * Math.min(1.1, Math.max(0, e - 0.45) * 0.5);
    }
  const sm = boxBlur(elev, gx, gy, 1, 1);
  // Vertical exaggeration in screen units: km of height per px of distance.
  const kmPerPx = proj.kmPerPx * step;
  const exag = 28 / Math.max(0.5, kmPerPx);
  const lx = -0.6, ly = -0.8; // light from the upper left (screen)
  const bcol = new Float32Array(N * 3);
  for (let q = 0; q < N; q++) {
    const c = f.landCell[q];
    const t = c >= 0 ? BIOME_TINT[world.biome[c]] ?? [220, 210, 180] : [255, 255, 255];
    bcol[3 * q] = t[0];
    bcol[3 * q + 1] = t[1];
    bcol[3 * q + 2] = t[2];
  }
  // Soften biome edges.
  const ch = [0, 1, 2].map((o) => {
    const a = new Float32Array(N);
    for (let q = 0; q < N; q++) a[q] = bcol[3 * q + o];
    return boxBlur(a, gx, gy, Math.max(1, Math.round((3 * k) / step)), 2);
  });
  const rgba = new Uint8ClampedArray(N * 4);
  for (let j = 0; j < gy; j++)
    for (let i = 0; i < gx; i++) {
      const q = j * gx + i;
      if (f.coast[q] <= -0.2) continue;
      const ex = (sm[j * gx + Math.min(gx - 1, i + 1)] - sm[j * gx + Math.max(0, i - 1)]) * exag * 0.5;
      const ey = (sm[Math.min(gy - 1, j + 1) * gx + i] - sm[Math.max(0, j - 1) * gx + i]) * exag * 0.5;
      // Lambert shading of the surface normal (-ex, -ey, 1), relative to flat ground.
      const L = Math.hypot(ex, ey, 1);
      const lz = 1.1, ln = Math.hypot(lx, ly, lz);
      const lit = (-ex * lx - ey * ly + lz) / (L * ln);
      const lit0 = lz / ln;
      const dark = Math.max(0, Math.min(1, (lit0 - lit) * 2.2)); // slopes facing away
      const light = Math.max(0, Math.min(1, (lit - lit0) * 2.2)); // slopes facing the light
      const bt = strength.biome;
      let r = 255 + (ch[0][q] - 255) * bt, g = 255 + (ch[1][q] - 255) * bt, b = 255 + (ch[2][q] - 255) * bt;
      // Base slightly toned so that lit slopes can lighten.
      const hs = strength.hill * (0.06 - 0.06 * light + 0.7 * dark);
      r *= 1 - hs * 0.62;
      g *= 1 - hs * 0.66;
      b *= 1 - hs * 0.6;
      const o = 4 * q;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  return { w: gx, h: gy, rgba, x0: f.x0, y0: f.y0, step };
}
