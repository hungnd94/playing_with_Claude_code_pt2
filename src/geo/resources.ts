/**
 * Agricultural fertility and natural resources.
 *
 * Fertility (0..1) is a pre-modern farming potential: warmth for a growing
 * season, moisture neither too scarce nor leaching, gentle terrain, soils
 * (rich loess/chernozem under grasslands, volcanic soils, poor laterites under
 * rainforest, none on permafrost), and above all rivers: a big river through a
 * desert makes a ribbon of the richest land on the planet (the Nile effect),
 * and floodplains along great rivers are fertile everywhere.
 *
 * Resources follow geologic and ecological logic and are deliberately sparse
 * (each a percent or two of land at most) so that they matter for trade:
 *   copper — subduction arcs and orogens (porphyry deposits); tin — old granite
 *   belts and collision zones; iron — ancient shields and boreal bog iron;
 *   gold — placers in mountain streams; silver — volcanic orogens; gems — old
 *   metamorphic belts, alluvial in the tropics; salt — salt lakes and pans,
 *   arid coasts; marble — mountain metamorphic belts; timber — the best
 *   forests; horses — steppe and grassland; fish — shelves, upwelling coasts
 *   and great lakes; furs — taiga and tundra; spices — tropical forest coasts
 *   and islands; incense — arid tropical hills; dyes — murex coasts and
 *   tropical indigo; wine — Mediterranean and warm-summer hills; ivory —
 *   tropical savanna and forest; obsidian — active volcanoes; amber — cold
 *   forested coasts; pearls — warm shallows.
 */
import type { SphereMesh } from "../core/sphere";
import { Noise3 } from "../core/noise";
import { Rng } from "../core/rng";
import { Biome, Resource, type ResourceKey } from "../world/types";
import { clamp, smoothstep } from "./util";

export interface ResourceInputs {
  mesh: SphereMesh;
  elevation: Float32Array;
  isOcean: Uint8Array;
  lakeId: Int32Array;
  lakeSalty: (lake: number) => boolean;
  biome: Uint8Array;
  temperature: Float32Array;
  tempRange: Float32Array;
  precipitation: Float32Array;
  pet: Float32Array;
  flow: Float32Array;
  riverOrder: Uint8Array;
  relief: Float32Array;
  volcanism: Float32Array;
  orogeny: Float32Array;
  oldOrogen: Float32Array;
  crust: Float32Array;
  boundaryDist: Float32Array;
  coastDist: Int16Array;
  currentAnom: Float32Array;
  summerDry: Float32Array;
}

export function computeFertility(inp: ResourceInputs): Float32Array {
  const { mesh, elevation, isOcean, lakeId, biome, temperature, precipitation, pet, flow, relief, volcanism } = inp;
  const n = mesh.n;
  const fert = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (isOcean[i] || lakeId[i] >= 0) continue;
    const T = temperature[i];
    const ai = precipitation[i] / Math.max(30, pet[i]);
    const e = Math.max(0, elevation[i]);
    const fT = smoothstep(-1, 9, T) * (1 - 0.2 * smoothstep(23, 28, T));
    const fW = smoothstep(0.18, 0.65, ai) * (1 - 0.3 * smoothstep(1.8, 4, ai));
    const fS = 1 - 0.85 * smoothstep(0.25, 1.3, relief[i]);
    const fE = 1 - 0.7 * smoothstep(2.2, 4.2, e);
    let soil = 1;
    switch (biome[i]) {
      case Biome.Grassland: soil = 1.15; break; // chernozem / prairie soils
      case Biome.Steppe: soil = 1.05; break;
      case Biome.Rainforest: soil = 0.6; break; // leached laterites
      case Biome.Taiga: soil = 0.55; break; // podzols, short season
      case Biome.Wetland: soil = 0.75; break;
      case Biome.Tundra: soil = 0.15; break;
      case Biome.Alpine: soil = 0.35; break;
      case Biome.IceSheet: soil = 0; break;
    }
    soil += 0.25 * volcanism[i];
    let f = fT * fW * fS * fE * soil;
    // Rivers: floodplain silt and irrigation. A big river makes even a desert bloom.
    const q = flow[i];
    if (q > 150) {
      const riv = smoothstep(150, 6000, q) * smoothstep(2, 12, T) * fS * fE;
      f = Math.max(f, 0.92 * riv) + 0.12 * riv;
    }
    fert[i] = clamp(f, 0, 1);
  }
  // Slight neighbourhood blending: valley margins share some of the river's bounty.
  const out = fert.slice();
  for (let i = 0; i < n; i++) {
    if (isOcean[i] || lakeId[i] >= 0) continue;
    let best = 0;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) best = Math.max(best, fert[mesh.adj[k]]);
    out[i] = Math.max(fert[i], 0.25 * best);
  }
  return out;
}

export function placeResources(inp: ResourceInputs, rng: Rng): Uint32Array {
  const { mesh, elevation, isOcean, lakeId, biome, temperature, tempRange, precipitation, pet, flow, relief, volcanism, orogeny, oldOrogen, crust, boundaryDist, coastDist, currentAnom, summerDry } = inp;
  const n = mesh.n;
  const res = new Uint32Array(n);
  let landCount = 0;
  for (let i = 0; i < n; i++) if (!isOcean[i] && lakeId[i] < 0) landCount++;
  const lat = mesh.lat;
  const absLat = (i: number) => Math.abs(lat[i]) * 57.29578;
  const isLandCell = (i: number) => !isOcean[i] && lakeId[i] < 0;
  const nearSaltLake = (i: number) => {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      if (lakeId[j] >= 0 && inp.lakeSalty(lakeId[j])) return true;
    }
    return false;
  };
  const neighbourShelf = (i: number, pred: (j: number) => boolean) => {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (pred(mesh.adj[k])) return true;
    return false;
  };
  const isB = (i: number, ...bs: number[]) => bs.includes(biome[i]);
  const mountain = (i: number) => smoothstep(0.6, 2.2, Math.max(0, elevation[i])) * 0.6 + smoothstep(0.3, 1.2, relief[i]) * 0.4;
  const craton = (i: number) => smoothstep(0.7, 1.0, crust[i]) * smoothstep(400, 1200, boundaryDist[i]) * (1 - smoothstep(0.3, 1.0, relief[i]));
  const aridity = (i: number) => precipitation[i] / Math.max(30, pet[i]);

  type Rule = { key: ResourceKey; frac: number; score: (i: number) => number; water?: boolean };
  const rules: Rule[] = [
    { key: "Copper", frac: 0.012, score: (i) => (0.6 * smoothstep(0.3, 2, orogeny[i]) + 0.5 * volcanism[i] + 0.35 * oldOrogen[i]) * (0.4 + mountain(i)) },
    { key: "Tin", frac: 0.005, score: (i) => (oldOrogen[i] + 0.5 * smoothstep(1, 3, orogeny[i]) * (crust[i] > 0.6 ? 1 : 0)) * (0.5 + 0.5 * mountain(i)) },
    { key: "Iron", frac: 0.02, score: (i) => 0.8 * craton(i) + 0.4 * oldOrogen[i] + (isB(i, Biome.Wetland, Biome.Taiga) ? 0.35 : 0) + 0.2 * mountain(i) },
    { key: "Gold", frac: 0.008, score: (i) => mountain(i) * (0.4 * smoothstep(0.3, 2, orogeny[i]) + 0.3 * oldOrogen[i] + 0.3 * volcanism[i]) * (0.4 + smoothstep(30, 600, flow[i])) },
    { key: "Silver", frac: 0.006, score: (i) => smoothstep(0.3, 2.5, orogeny[i]) * (0.3 + volcanism[i]) * mountain(i) },
    { key: "Gems", frac: 0.004, score: (i) => (0.6 * oldOrogen[i] + 0.4 * craton(i)) * (temperature[i] > 18 ? 1.5 : 0.8) * (0.6 + 0.4 * smoothstep(100, 2000, flow[i])) },
    { key: "Salt", frac: 0.01, score: (i) => (nearSaltLake(i) ? 1.2 : 0) + (coastDist[i] === 1 ? 0.7 : 0.15) * smoothstep(0.35, 0.08, aridity(i)) + 0.3 * smoothstep(0.3, 0.1, aridity(i)) * (1 - smoothstep(0.1, 0.6, relief[i])) },
    { key: "Marble", frac: 0.006, score: (i) => mountain(i) * (0.5 * smoothstep(0.3, 2, orogeny[i]) + 0.5 * oldOrogen[i]) * (summerDry[i] > 0.3 ? 1.4 : 1) },
    { key: "Timber", frac: 0.05, score: (i) => (isB(i, Biome.TemperateRainforest) ? 1 : isB(i, Biome.TemperateForest) ? 0.8 : isB(i, Biome.Taiga) ? 0.65 : isB(i, Biome.Rainforest) ? 0.55 : isB(i, Biome.TropicalDryForest) ? 0.3 : 0) * (0.7 + 0.3 * smoothstep(100, 2000, flow[i]) + (coastDist[i] <= 2 ? 0.2 : 0)) },
    { key: "Horses", frac: 0.025, score: (i) => (isB(i, Biome.Steppe) ? 1 : isB(i, Biome.Grassland) ? 0.8 : isB(i, Biome.Savanna) && temperature[i] < 22 ? 0.3 : 0) * (1 - smoothstep(0.4, 1.2, relief[i])) * smoothstep(-2, 6, temperature[i]) },
    { key: "Fish", frac: 0.03, score: (i) => fishScore(i) },
    { key: "Furs", frac: 0.02, score: (i) => (isB(i, Biome.Taiga) ? 1 : isB(i, Biome.Tundra) ? 0.6 : isB(i, Biome.TemperateForest) && temperature[i] < 7 ? 0.4 : 0) * (0.6 + 0.4 * smoothstep(50, 1500, flow[i])) },
    { key: "Spices", frac: 0.007, score: (i) => (isB(i, Biome.Rainforest) ? 1 : isB(i, Biome.TropicalDryForest) ? 0.7 : 0) * (coastDist[i] <= 2 ? 1.6 : 0.6) * smoothstep(21, 25, temperature[i]) },
    { key: "Incense", frac: 0.004, score: (i) => (isB(i, Biome.HotDesert, Biome.Savanna) ? 1 : 0) * smoothstep(0.08, 0.2, aridity(i)) * smoothstep(0.45, 0.25, aridity(i)) * (0.5 + smoothstep(0.1, 0.6, relief[i])) * (coastDist[i] <= 3 ? 1.3 : 0.7) * smoothstep(20, 25, temperature[i] + 2) },
    { key: "Dyes", frac: 0.006, score: (i) => (coastDist[i] === 1 && summerDry[i] > 0.35 ? 1 : 0) + (isB(i, Biome.TropicalDryForest, Biome.Savanna) && aridity(i) > 0.4 ? 0.6 : 0) + (isB(i, Biome.TemperateForest, Biome.Grassland) ? 0.15 : 0) },
    { key: "Wine", frac: 0.015, score: (i) => wineScore(i) },
    { key: "Ivory", frac: 0.006, score: (i) => (isB(i, Biome.Savanna) ? 1 : isB(i, Biome.TropicalDryForest) ? 0.8 : isB(i, Biome.Rainforest) ? 0.5 : 0) * smoothstep(18, 23, temperature[i]) },
    { key: "Obsidian", frac: 0.004, score: (i) => smoothstep(0.35, 0.9, volcanism[i]) },
    { key: "Amber", frac: 0.003, score: (i) => (coastDist[i] === 1 ? 1 : 0) * (isB(i, Biome.Taiga, Biome.TemperateForest) ? 1 : 0.2) * smoothstep(40, 52, absLat(i)) * smoothstep(68, 60, absLat(i)) * (neighbourShelf(i, (j) => isOcean[j] === 1 && elevation[j] > -0.2) ? 1.3 : 0.5) },
    { key: "Pearls", frac: 0.004, score: (i) => (coastDist[i] === 1 ? 1 : 0) * smoothstep(21, 26, temperature[i]) * (neighbourShelf(i, (j) => isOcean[j] === 1 && elevation[j] > -0.12) ? 1.2 : 0.2) * (aridity(i) < 0.6 ? 1.3 : 1) },
  ];

  function fishScore(i: number): number {
    // Coastal land next to productive waters: shelves, upwelling (cold currents), cool seas; or big lake shores.
    if (coastDist[i] !== 1) {
      let lake = 0;
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
        const j = mesh.adj[k];
        if (lakeId[j] >= 0 && !inp.lakeSalty(lakeId[j])) lake = 0.7;
      }
      return lake;
    }
    let shelf = 0, up = 0;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      if (!isOcean[j]) continue;
      if (elevation[j] > -0.2) shelf = 1;
      up = Math.min(up, currentAnom[j]);
    }
    const cool = smoothstep(26, 12, temperature[i]) * 0.5 + 0.5;
    return (0.3 + 0.7 * shelf) * cool * (1 + 0.15 * Math.min(4, -up)) * (absLat(i) > 72 ? 0.3 : 1);
  }
  function wineScore(i: number): number {
    const T = temperature[i], warm = T + tempRange[i];
    const ai = aridity(i);
    const climate = smoothstep(9, 13, T) * smoothstep(21, 17, T) * smoothstep(17, 20, warm) * smoothstep(0.3, 0.5, ai) * smoothstep(1.6, 1.0, ai);
    const med = 1 + 1.2 * summerDry[i];
    const hills = 0.7 + 0.6 * smoothstep(0.1, 0.5, relief[i]) * (1 - smoothstep(1.0, 1.8, elevation[i]));
    return climate * med * hills;
  }

  const salt = rng.int(1, 1 << 30);
  const noise = new Noise3(rng.fork("resource-noise"));
  // Three shared clustering fields; each resource mixes them with its own weights
  // (cheaper than a noise field per resource, still distinct deposit patterns).
  const N1 = new Float32Array(n), N2 = new Float32Array(n), N3 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!isLandCell(i)) continue;
    const x = mesh.xyz[3 * i], y = mesh.xyz[3 * i + 1], z = mesh.xyz[3 * i + 2];
    N1[i] = noise.fbm(x * 4, y * 4, z * 4, 3);
    N2[i] = noise.fbm(x * 4 + 17.3, y * 4 - 5.1, z * 4 + 2.2, 3);
    N3[i] = noise.fbm(x * 6 - 8.8, y * 6 + 3.9, z * 6 + 11.4, 2);
  }
  const mixW = rules.map(() => { const a = rng.range(-1, 1), b = rng.range(-1, 1), c = rng.range(-1, 1); const l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; });
  for (let r = 0; r < rules.length; r++) {
    const rule = rules[r];
    const bit = Resource[rule.key];
    const cand: number[] = [];
    const sc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (!isLandCell(i)) continue;
      let s = rule.score(i);
      if (!(s > 0)) continue;
      // Clustered deposits: modulate by a per-resource noise field, plus a little per-cell hash.
      const [wa, wb, wc] = mixW[r];
      const cl = Math.min(1, Math.max(0, 0.5 + 0.6 * (wa * N1[i] + wb * N2[i] + wc * N3[i])));
      s *= 0.25 + 1.5 * cl * cl;
      s *= 0.85 + 0.3 * ((Math.imul(i + 1, 2654435761) ^ (salt + r * 977)) >>> 0) / 4294967296;
      sc[i] = s;
      cand.push(i);
    }
    cand.sort((a, b) => sc[b] - sc[a] || a - b);
    const k = Math.min(cand.length, Math.max(1, Math.round(rule.frac * landCount)));
    for (let q = 0; q < k; q++) res[cand[q]] |= bit;
  }
  // Fishing grounds and pearl beds also mark the adjacent shallow water cells.
  for (let i = 0; i < n; i++) {
    if (!(res[i] & (Resource.Fish | Resource.Pearls))) continue;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      if (isOcean[j] && elevation[j] > -0.25) res[j] |= res[i] & (Resource.Fish | Resource.Pearls);
    }
  }
  return res;
}
