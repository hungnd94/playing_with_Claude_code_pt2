/**
 * A plausible fake `PhysicalWorld` for developing the renderer before (or
 * without) the real physical generator in `src/geo`.
 *
 * It is deliberately simple but has everything the globe needs to look
 * convincing: noise continents with ridged mountain belts, a latitude-driven
 * climate, Whittaker biomes, priority-flood hydrology (so every land cell
 * drains to the sea), lakes in the deeper depressions, and discharge-based
 * rivers. Arrays the renderer does not need are zero-filled.
 *
 * Deterministic: everything derives from `new Rng(seed)` forks.
 */
import { Rng } from "../src/core/rng";
import { Noise3 } from "../src/core/noise";
import { MinHeap } from "../src/core/heap";
import { buildSphereMesh } from "../src/core/sphere";
import { Biome, DEFAULT_PARAMS, type Lake, type PhysicalWorld, type WorldParams } from "../src/world/types";

export function makeMockWorld(seed = "mock", cells = 40000, overrides: Partial<WorldParams> = {}): PhysicalWorld {
  const params: WorldParams = { ...DEFAULT_PARAMS, seed, cells, ...overrides };
  const rng = new Rng(seed).fork("mock-world");
  const mesh = buildSphereMesh(cells, rng.fork("mesh"));
  const n = mesh.n;
  const { xyz, adj, adjStart } = mesh;
  const noise = new Noise3(rng.fork("noise"));
  const noise2 = new Noise3(rng.fork("noise2"));

  // --- Raw height field -----------------------------------------------------
  const raw = new Float64Array(n);
  const ridge = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const cont = noise.warped(x * 1.3 + 3.1, y * 1.3, z * 1.3, 0.7, 6);
    // Mountain belts along the zero-set of a second low-frequency field.
    const belt = 1 - Math.abs(noise2.fbm(x * 1.1, y * 1.1 + 7.7, z * 1.1, 3));
    const beltMask = Math.pow(Math.max(0, belt), 7);
    const r = noise2.ridged(x * 3.2 + 1.9, y * 3.2, z * 3.2 - 4.4, 5);
    ridge[i] = beltMask * r;
    raw[i] = cont + 0.55 * beltMask * r * (cont > -0.12 ? 1 : 0.35) + 0.08 * noise.fbm(x * 6, y * 6, z * 6, 3);
  }
  const sorted = Float64Array.from(raw).sort();
  const sea = sorted[Math.floor(params.oceanFraction * (n - 1))];
  const lo = sorted[0], hi = sorted[n - 1];

  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (raw[i] >= sea) {
      const h = (raw[i] - sea) / (hi - sea);
      elevation[i] = 0.02 + 5.2 * Math.pow(h, 1.5) + 2.5 * ridge[i] * Math.min(1, h * 6);
    } else {
      const d = (sea - raw[i]) / (sea - lo);
      elevation[i] = -(0.04 + 0.2 * smoothstep(0, 0.06, d) + 5.3 * smoothstep(0.04, 0.55, d));
    }
  }

  // --- Coast distance (BFS in cells) ------------------------------------------
  const isLandRaw = new Uint8Array(n);
  for (let i = 0; i < n; i++) isLandRaw[i] = elevation[i] >= 0 ? 1 : 0;
  const coastDist = coastDistance(mesh, isLandRaw);

  // --- Climate ----------------------------------------------------------------
  const temperature = new Float32Array(n);
  const tempRange = new Float32Array(n);
  const precipitation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const lat = Math.asin(z);
    const alat = Math.abs(lat) * (180 / Math.PI);
    const tSea = 30 - 52 * Math.pow(Math.abs(z), 3) + 3 * noise.fbm(x * 2, y * 2 + 11, z * 2, 3) + params.temperatureOffset;
    temperature[i] = tSea - 6.5 * Math.max(0, elevation[i]);
    const inland = Math.max(0, coastDist[i]);
    tempRange[i] = 2 + alat * 0.25 + inland * 0.6;
    const band =
      2300 * Math.exp(-((alat / 11) ** 2)) +
      1150 * Math.exp(-(((alat - 50) / 13) ** 2)) +
      260;
    const wet = Math.exp(0.75 * noise2.fbm(x * 2.4 + 5, y * 2.4, z * 2.4, 4));
    const continental = Math.exp(-inland / 14);
    precipitation[i] = Math.max(40, band * wet * (0.35 + 0.65 * continental) * (1 + 0.15 * Math.max(0, elevation[i])));
  }

  // --- Hydrology: priority flood --------------------------------------------
  const filled = new Float64Array(n);
  const state = new Uint8Array(n); // 0 unvisited, 1 queued, 2 done
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    filled[i] = elevation[i];
    if (isLandRaw[i] && coastDist[i] === 1) {
      state[i] = 1;
      heap.push(elevation[i], i);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    if (state[c] === 2) continue;
    state[c] = 2;
    for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
      const u = adj[k];
      if (!isLandRaw[u] || state[u] !== 0) continue;
      filled[u] = Math.max(elevation[u], filled[c] + 1e-5);
      state[u] = 1;
      heap.push(filled[u], u);
    }
  }
  // Lakes in depressions deeper than a threshold.
  const lakeId = new Int32Array(n).fill(-1);
  const lakes: Lake[] = [];
  const inDepression = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isLandRaw[i] && filled[i] - elevation[i] > 0.035) inDepression[i] = 1;
  for (let i = 0; i < n; i++) {
    if (!inDepression[i] || lakeId[i] >= 0) continue;
    const id = lakes.length;
    const members: number[] = [];
    const stack = [i];
    lakeId[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const u = adj[k];
        if (inDepression[u] && lakeId[u] < 0) {
          lakeId[u] = id;
          stack.push(u);
        }
      }
    }
    members.sort((a, b) => a - b);
    let surface = 0;
    for (const m of members) surface = Math.max(surface, filled[m]);
    lakes.push({ id, cells: Int32Array.from(members), surface, salty: false, outlet: -1 });
  }

  // Downstream: lowest filled neighbour (strictly lower), else the ocean.
  const downstream = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isLandRaw[i]) continue;
    let best = -1;
    let bestH = filled[i];
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const u = adj[k];
      const h = isLandRaw[u] ? filled[u] : elevation[u] - 1;
      if (h < bestH) {
        bestH = h;
        best = u;
      }
    }
    downstream[i] = best;
  }
  for (const lake of lakes) {
    for (const c of lake.cells) {
      const d = downstream[c];
      if (d >= 0 && lakeId[d] !== lake.id) lake.outlet = c;
    }
  }

  // Discharge: precipitation × area × runoff, accumulated from high to low.
  const flow = new Float32Array(n);
  const R = params.radiusKm * 1000;
  const land: number[] = [];
  for (let i = 0; i < n; i++) if (isLandRaw[i]) land.push(i);
  land.sort((a, b) => filled[b] - filled[a] || a - b);
  for (const i of land) {
    const runoff = 0.45;
    flow[i] += ((precipitation[i] / 1000) * mesh.area[i] * R * R * runoff) / 3.156e7;
    const d = downstream[i];
    if (d >= 0) flow[d] += flow[i];
  }
  const riverOrder = new Uint8Array(n);
  const thresholds = [300, 800, 2000, 5000, 11000, 24000];
  for (const i of land) {
    let o = 0;
    for (let t = 0; t < thresholds.length; t++) if (flow[i] >= thresholds[t]) o = t + 1;
    riverOrder[i] = lakeId[i] >= 0 ? 0 : o;
  }

  // --- Biomes ---------------------------------------------------------------
  const biome = new Uint8Array(n);
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = elevation[i];
    const t = temperature[i];
    const p = precipitation[i];
    isLand[i] = isLandRaw[i];
    if (!isLandRaw[i]) {
      if (t < -9) biome[i] = Biome.SeaIce;
      else if (e > -0.3) biome[i] = Biome.Shallows;
      else if (e > -2.8) biome[i] = Biome.Ocean;
      else biome[i] = Biome.DeepOcean;
      continue;
    }
    if (lakeId[i] >= 0) {
      biome[i] = Biome.Lake;
      continue;
    }
    biome[i] = whittaker(t, p, e);
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    if (e < 0.25 && p > 1100 && t > 0 && noise.noise(x * 9, y * 9, z * 9) > 0.35) biome[i] = Biome.Wetland;
  }

  const fertility = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!isLand[i] || lakeId[i] >= 0) continue;
    const t = temperature[i], p = precipitation[i];
    fertility[i] = clamp01(1 - Math.abs(t - 16) / 22) * clamp01(p / 1200) * clamp01(1 - Math.max(0, elevation[i] - 1) / 3);
  }

  const landmassOf = new Int32Array(n).fill(-1);
  const waterBodyOf = new Int32Array(n).fill(-1);
  const regionOf = new Int32Array(n).fill(-1);

  return {
    params,
    mesh,
    plates: [],
    plate: new Uint8Array(n),
    boundary: new Uint8Array(n),
    elevation,
    volcanism: new Float32Array(n),
    seismicity: new Float32Array(n),
    isLand,
    coastDist,
    temperature,
    tempRange,
    precipitation,
    wind: new Float32Array(3 * n),
    downstream,
    flow,
    riverOrder,
    lakeId,
    lakes,
    biome,
    fertility,
    resources: new Uint32Array(n),
    features: [],
    landmassOf,
    waterBodyOf,
    regionOf,
  };
}

function whittaker(t: number, p: number, e: number): number {
  if (t < -9) return Biome.IceSheet;
  if (e > 3.1 && t < 2) return Biome.Alpine;
  if (t < -2) return p < 180 ? Biome.ColdDesert : Biome.Tundra;
  if (t < 5) return p < 250 ? Biome.ColdDesert : p < 420 ? Biome.Steppe : Biome.Taiga;
  if (t < 18) {
    if (p < 260) return Biome.ColdDesert;
    if (p < 520) return Biome.Steppe;
    if (p < 800) return t > 12 ? Biome.Mediterranean : Biome.Grassland;
    if (p < 1900) return Biome.TemperateForest;
    return Biome.TemperateRainforest;
  }
  if (p < 330) return Biome.HotDesert;
  if (p < 950) return Biome.Savanna;
  if (p < 1750) return Biome.TropicalDryForest;
  return Biome.Rainforest;
}

function coastDistance(mesh: { n: number; adj: Int32Array; adjStart: Int32Array }, land: Uint8Array): Int16Array {
  const { n, adj, adjStart } = mesh;
  const dist = new Int16Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      if (land[adj[k]] !== land[i]) {
        dist[i] = land[i] ? 1 : -1;
        frontier.push(i);
        break;
      }
    }
  }
  let d = 1;
  while (frontier.length) {
    d++;
    const next: number[] = [];
    for (const c of frontier) {
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const u = adj[k];
        if (dist[u] !== 0) continue;
        dist[u] = land[u] ? d : -d;
        next.push(u);
      }
    }
    frontier = next;
  }
  return dist;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
