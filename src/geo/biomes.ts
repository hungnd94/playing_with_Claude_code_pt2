/**
 * Biome classification.
 *
 * Water: lakes; pack ice where the sea is frozen most of the year; shelf
 * shallows (< 200 m); open and deep ocean.
 *
 * Land is classified Whittaker/Holdridge-style from mean temperature, the
 * warmest-month temperature (tree line ≈ 10 °C warmest month), frost, and the
 * aridity index P/PET (so cold regions need far less rain than hot ones to be
 * forested), refined by seasonality: a summer-dry regime turns warm temperate
 * woodland into Mediterranean scrub, a tropical dry season turns forest into
 * savanna or dry forest. Elevation adds alpine heights and ice caps; flat,
 * waterlogged lowlands along big rivers and in boreal plains become wetlands.
 * A smooth noise jitters the thresholds slightly so biome borders interleave
 * naturally instead of following isolines exactly.
 */
import type { SphereMesh } from "../core/sphere";
import { Noise3 } from "../core/noise";
import { Rng } from "../core/rng";
import { Biome } from "../world/types";
import { smoothstep } from "./util";

export interface BiomeInputs {
  mesh: SphereMesh;
  elevation: Float32Array;
  isOcean: Uint8Array;
  lakeId: Int32Array;
  temperature: Float32Array;
  tempRange: Float32Array;
  precipitation: Float32Array;
  pet: Float32Array;
  summerDry: Float32Array;
  drySeason: Float32Array;
  flow: Float32Array;
  /** Local relief (km): max elevation difference to neighbours. */
  relief: Float32Array;
}

export function classifyBiomes(inp: BiomeInputs, rng: Rng): Uint8Array {
  const { mesh, elevation, isOcean, lakeId, temperature, tempRange, precipitation, pet, summerDry, drySeason, flow, relief } = inp;
  const n = mesh.n;
  const noise = new Noise3(rng.fork("biome-noise"));
  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const T = temperature[i];
    if (isOcean[i]) {
      const e = elevation[i];
      if (T < -9) biome[i] = Biome.SeaIce;
      else if (e > -0.2) biome[i] = Biome.Shallows;
      else if (e > -2.6) biome[i] = Biome.Ocean;
      else biome[i] = Biome.DeepOcean;
      continue;
    }
    if (lakeId[i] >= 0) { biome[i] = Biome.Lake; continue; }
    const x = mesh.xyz[3 * i], y = mesh.xyz[3 * i + 1], z = mesh.xyz[3 * i + 2];
    const jit = noise.fbm(x * 7, y * 7, z * 7, 3);
    const P = precipitation[i];
    const ai = (P / Math.max(30, pet[i])) * (1 + 0.18 * jit);
    const Tj = T + 1.2 * jit;
    const warm = Tj + tempRange[i]; // warmest month
    const cold = Tj - tempRange[i]; // coldest month
    const e = elevation[i];

    // Ice: permanent ice caps and sheets.
    if (warm < 0 || (Tj < -15 && P > 260) || (Tj < -21 && P > 110)) { biome[i] = Biome.IceSheet; continue; }
    // Beyond the tree line.
    if (warm < 10) {
      biome[i] = e > 1.2 || relief[i] > 1.0 ? Biome.Alpine : Biome.Tundra;
      continue;
    }
    // High mountains with thin, cold air above ~3 km even in warmer climates.
    if (e > 3.0 && warm < 17) { biome[i] = Biome.Alpine; continue; }

    // Wetlands: flat, waterlogged lowlands (big floodplains, boreal bogs, deltas).
    const flat = relief[i] < 0.18 && e < 0.4;
    if (flat && ai > 0.9) {
      const flood = smoothstep(2500, 12000, flow[i]);
      const bog = Tj < 4 && ai > 1.3 ? 0.55 : 0;
      const tropicalSwamp = Tj > 20 && ai > 1.4 ? 0.3 : 0;
      if (Math.max(flood, bog, tropicalSwamp) + 0.25 * jit > 0.5) { biome[i] = Biome.Wetland; continue; }
    }

    let b: number;
    if (Tj >= 19.5 && cold > 8) {
      // Tropics (frost-free).
      if (ai < 0.2) b = Biome.HotDesert;
      else if (ai < 0.42) b = Biome.Savanna;
      else if (ai < 0.8) b = drySeason[i] > 0.45 ? Biome.Savanna : Biome.TropicalDryForest;
      else if (ai < 1.25) b = drySeason[i] > 0.55 ? Biome.TropicalDryForest : Biome.Rainforest;
      else b = Biome.Rainforest;
    } else if (Tj >= 10) {
      // Warm temperate / subtropical.
      const med = summerDry[i];
      if (ai < 0.2) b = Tj >= 14 ? Biome.HotDesert : Biome.ColdDesert;
      else if (ai < 0.42) b = med > 0.45 ? Biome.Mediterranean : Biome.Steppe;
      else if (ai < 0.8) b = med > 0.35 ? Biome.Mediterranean : Biome.Grassland;
      else if (ai < 1.1 && med > 0.6) b = Biome.Mediterranean;
      else if (ai > 2.0 && P > 1500) b = Tj > 16 && cold > 6 ? Biome.Rainforest : Biome.TemperateRainforest;
      else b = Biome.TemperateForest;
    } else if (Tj >= 2) {
      // Cool temperate.
      if (ai < 0.2) b = Biome.ColdDesert;
      else if (ai < 0.5) b = Biome.Steppe;
      else if (ai < 0.8) b = Biome.Grassland;
      else if (ai > 2.2 && P > 1300) b = Biome.TemperateRainforest;
      else b = Tj < 4.5 && ai > 1.0 ? Biome.Taiga : Biome.TemperateForest;
    } else {
      // Boreal.
      if (ai < 0.22) b = Biome.ColdDesert;
      else if (ai < 0.5) b = Biome.Steppe;
      else b = Biome.Taiga;
    }
    // Montane belts: forests give way to alpine meadows high up.
    if (e > 2.2 && warm < 14 && b !== Biome.HotDesert && b !== Biome.ColdDesert) b = Biome.Alpine;
    biome[i] = b;
  }
  return biome;
}

/** Local relief: max |Δelevation| to any neighbour (land only, km). */
export function localRelief(mesh: SphereMesh, elevation: Float32Array): Float32Array {
  const out = new Float32Array(mesh.n);
  for (let i = 0; i < mesh.n; i++) {
    let m = 0;
    const ei = Math.max(0, elevation[i]);
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const d = Math.abs(Math.max(0, elevation[mesh.adj[k]]) - ei);
      if (d > m) m = d;
    }
    out[i] = m;
  }
  return out;
}
