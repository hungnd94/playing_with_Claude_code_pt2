/**
 * Physical world generation: plates → elevation → erosion → sea level →
 * climate → hydrology → biomes → fertility & resources → features.
 */
import { buildSphereMesh } from "../core/sphere";
import { Rng } from "../core/rng";
import { DEFAULT_PARAMS, type PhysicalWorld, type WorldParams } from "../world/types";
import { buildPlates } from "./plates";
import { buildElevation, liftInteriors } from "./elevation";
import { chooseSeaLevel, fillShallowPockets, matchOceanFraction, resolveDepressions } from "./sealevel";
import { cellAreasKm2, edgeLengthsKm, hopDistance, smoothstep } from "./util";
import { carveFjords, erode } from "./erosion";
import { buildClimate } from "./climate";
import { buildHydrology } from "./hydrology";
import { classifyBiomes, localRelief } from "./biomes";
import { computeFertility, placeResources, type ResourceInputs } from "./resources";
import { extractFeatures } from "./features";
import { drawStyle } from "./style";

export function generatePhysical(
  params: WorldParams,
  rng: Rng,
  onProgress?: (stage: string, fraction: number) => void,
): PhysicalWorld {
  const p: WorldParams = { ...DEFAULT_PARAMS, ...params };
  const progress = onProgress ?? (() => {});
  progress("mesh", 0);
  const mesh = buildSphereMesh(p.cells, rng.fork("mesh"));
  const n = mesh.n;
  const edgeLen = edgeLengthsKm(mesh, p.radiusKm);

  const style = drawStyle(rng.fork("style"));

  progress("plates", 0.08);
  const tect = buildPlates(mesh, p.plates, 1 - p.oceanFraction, p.radiusKm, edgeLen, rng.fork("plates"), style);

  progress("elevation", 0.16);
  const elev = buildElevation(mesh, tect, p.radiusKm, edgeLen, p.oceanFraction, rng.fork("elevation"), style);
  const elevation = elev.elevation;

  progress("erosion", 0.28);
  const areaKm2 = cellAreasKm2(mesh, p.radiusKm);
  {
    const pre = chooseSeaLevel(mesh, elevation, p.oceanFraction).seaLevel;
    liftInteriors(mesh, elevation, pre, edgeLen, p.radiusKm, rng.fork("lift"), style);
    const erodibility = new Float32Array(n);
    for (let i = 0; i < n; i++) erodibility[i] = 0.6 + 0.8 * Math.min(1, elev.orogeny[i] / 2 + elev.oldOrogen[i]);
    erode(mesh, elevation, pre, areaKm2, { iterations: 5, K: 0.016, m: 0.5, talus: 0.055, erodibility });
    // Glacial troughs at high latitudes (colder worlds glaciate further towards the equator).
    const coldLat = 60 + 1.6 * p.temperatureOffset;
    carveFjords(mesh, elevation, pre, (i) => {
      const a = Math.abs(mesh.lat[i]) * 57.29578;
      return smoothstep(coldLat - 12, coldLat + 2, a);
    });
  }

  progress("sea level", 0.36);
  let { seaLevel, flood } = chooseSeaLevel(mesh, elevation, p.oceanFraction);
  for (let pass = 0; pass < 3; pass++) {
    if (!resolveDepressions(mesh, elevation, flood, seaLevel)) break;
    ({ seaLevel, flood } = chooseSeaLevel(mesh, elevation, p.oceanFraction));
  }
  // Exact ocean fraction, then whatever is still isolated below sea level becomes an
  // interior basin (no more carving).
  fillShallowPockets(mesh, elevation, flood, seaLevel);
  flood = matchOceanFraction(mesh, elevation, seaLevel, p.oceanFraction);
  resolveDepressions(mesh, elevation, flood, seaLevel, 0);
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    elevation[i] -= seaLevel;
    isLand[i] = flood[i] - seaLevel >= 0 ? 1 : 0;
  }
  const coastDist = computeCoastDist(mesh, isLand);

  progress("climate", 0.45);
  const isOcean = new Uint8Array(n);
  for (let i = 0; i < n; i++) isOcean[i] = isLand[i] ? 0 : 1;
  const clim = buildClimate(mesh, elevation, isOcean, p.radiusKm, p.axialTiltDeg, p.temperatureOffset, rng.fork("climate"));

  progress("hydrology", 0.6);
  const glacial = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Formerly glaciated terrain: cold, low-relief shields are full of scoured lake basins.
    const t = clim.temperature[i] - p.temperatureOffset * 0.5;
    glacial[i] = Math.max(0, Math.min(1, (4 - t) / 8)) * (elevation[i] < 1 ? 1 : 0.4);
  }
  const hydro = buildHydrology(mesh, elevation, isOcean, clim.precipitation, clim.pet, areaKm2, { glacial, rift: elev.rift, maxLakes: 26 });
  // Dry land below sea level (closed basins without a lake) is lifted to just above it.
  for (let i = 0; i < n; i++) if (isLand[i] && hydro.lakeId[i] < 0 && elevation[i] < 0.001) elevation[i] = 0.001;

  progress("biomes", 0.7);
  const relief = localRelief(mesh, elevation);
  const biome = classifyBiomes({
    mesh, elevation, isOcean, lakeId: hydro.lakeId, temperature: clim.temperature, tempRange: clim.tempRange,
    precipitation: clim.precipitation, pet: clim.pet, summerDry: clim.summerDry, drySeason: clim.drySeason,
    flow: hydro.flow, relief,
  }, rng.fork("biomes"));

  progress("resources", 0.78);
  const resInputs: ResourceInputs = {
    mesh, elevation, isOcean, lakeId: hydro.lakeId, lakeSalty: (l) => hydro.lakes[l].salty, biome,
    temperature: clim.temperature, tempRange: clim.tempRange, precipitation: clim.precipitation, pet: clim.pet,
    flow: hydro.flow, riverOrder: hydro.riverOrder, relief, volcanism: elev.volcanism, orogeny: elev.orogeny,
    oldOrogen: elev.oldOrogen, crust: elev.crust, boundaryDist: elev.boundaryDist, coastDist,
    currentAnom: clim.currentAnom, summerDry: clim.summerDry,
  };
  const fertility = computeFertility(resInputs);
  const resources = placeResources(resInputs, rng.fork("resources"));

  progress("features", 0.86);
  const feat = extractFeatures({
    mesh, radiusKm: p.radiusKm, edgeLen, areaKm2, elevation, isLand, lakeId: hydro.lakeId, lakes: hydro.lakes,
    coastDist, temperature: clim.temperature, precipitation: clim.precipitation, biome,
    downstream: hydro.downstream, flow: hydro.flow, volcanism: elev.volcanism, orogeny: elev.orogeny,
    oldOrogen: elev.oldOrogen, rift: elev.rift, relief, boundary: elev.boundary, currentAnom: clim.currentAnom,
    hotspotCells: elev.hotspots.map((h) => h.cell),
  });
  progress("done", 1);

  return {
    params: p,
    mesh,
    plates: tect.plates,
    plate: elev.plate,
    boundary: elev.boundary,
    elevation,
    volcanism: elev.volcanism,
    seismicity: elev.seismicity,
    isLand,
    coastDist,
    temperature: clim.temperature,
    tempRange: clim.tempRange,
    precipitation: clim.precipitation,
    wind: clim.wind,
    downstream: hydro.downstream,
    flow: hydro.flow,
    riverOrder: hydro.riverOrder,
    lakeId: hydro.lakeId,
    lakes: hydro.lakes,
    biome,
    fertility,
    resources,
    features: feat.features,
    landmassOf: feat.landmassOf,
    waterBodyOf: feat.waterBodyOf,
    regionOf: feat.regionOf,
  };
}

/** Signed hop distance to the coast: 1 = coastal land, 2.. inland; -1 = coastal water, -2.. offshore. */
export function computeCoastDist(mesh: import("../core/sphere").SphereMesh, isLand: Uint8Array): Int16Array {
  const n = mesh.n;
  const coastal = (i: number) => {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (isLand[mesh.adj[k]] !== isLand[i]) return true;
    return false;
  };
  const dLand = hopDistance(mesh, (i) => isLand[i] === 1 && coastal(i), 32000, (i) => isLand[i] === 1);
  const dSea = hopDistance(mesh, (i) => isLand[i] === 0 && coastal(i), 32000, (i) => isLand[i] === 0);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (isLand[i]) out[i] = dLand[i] >= 0 ? dLand[i] + 1 : 32000;
    else out[i] = dSea[i] >= 0 ? -(dSea[i] + 1) : -32000;
  }
  return out;
}
