/**
 * Render debug maps of the physical world.
 *
 *   npx tsx tools/geo-maps.ts <seed> [cells] [width]
 *
 * Writes equirectangular PNGs into out/geo/<seed>/:
 *   relief.png     shaded relief with hypsometric tints, rivers and lakes
 *   natural.png    biome-coloured "satellite" view with relief shading and rivers
 *   plates.png     plates, boundary types and plate motion
 *   temperature.png, precipitation.png, biomes.png, features.png, resources.png, fertility.png
 *   features.txt   list of features with their attributes
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng, hashInt } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS, BIOME_NAMES, RESOURCE_KEYS, Resource, type PhysicalWorld } from "../src/world/types";
import { writePNG } from "./png";
import { Raster, Sampler, ramp, mix, shade, hillshade, type RGB } from "./geo-raster";

const seed = process.argv[2] ?? "palimpsest";
const cells = Number(process.argv[3] ?? DEFAULT_PARAMS.cells);
const W = Number(process.argv[4] ?? 2048);
const H = W / 2;
const dir = `out/geo/${seed}`;
mkdirSync(dir, { recursive: true });

const t0 = performance.now();
let last = t0;
const timings: string[] = [];
const world = generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed), (stage) => {
  const now = performance.now();
  timings.push(`${stage}@${(now - t0).toFixed(0)}`);
  last = now;
});
const genMs = performance.now() - t0;
void last;
console.log(`generated ${cells} cells in ${genMs.toFixed(0)} ms  [${timings.join(" ")}]`);

const mesh = world.mesh;
const n = mesh.n;
const R = world.params.radiusKm;
const t1 = performance.now();
const S = new Sampler(mesh, W, H);
console.log(`sampler ${(performance.now() - t1).toFixed(0)} ms`);

// ------------------------------------------------------------------ shared rasters
const coastElev = new Float32Array(n);
for (let i = 0; i < n; i++) coastElev[i] = world.isLand[i] ? Math.max(world.elevation[i], 0.002) : world.elevation[i];
const E = S.field(coastElev);
const lakeInd = new Float32Array(n);
for (let i = 0; i < n; i++) lakeInd[i] = world.lakeId[i] >= 0 ? 1 : 0;
const LK = S.field(lakeInd);
const HS = hillshade(E, W, H, R, 22);

const HYPSO: [number, RGB][] = [
  [0, [104, 146, 92]], [0.15, [128, 160, 100]], [0.4, [168, 178, 116]], [0.8, [196, 180, 128]],
  [1.4, [188, 152, 108]], [2.2, [160, 124, 96]], [3.0, [142, 116, 104]], [3.8, [168, 160, 158]], [4.8, [236, 236, 240]],
];
const BATHY: [number, RGB][] = [
  [-8, [10, 26, 64]], [-5.5, [22, 48, 104]], [-4, [32, 70, 136]], [-2.5, [48, 96, 162]], [-1, [72, 130, 190]],
  [-0.25, [118, 172, 210]], [0, [152, 198, 222]],
];
const LAKE: RGB = [86, 140, 196];
const SALT_LAKE: RGB = [120, 170, 170];

function oceanColor(e: number): RGB {
  return ramp(BATHY, e);
}

function drawRivers(r: Raster, color: RGB, minOrder = 1, scale = 1): void {
  const { downstream, riverOrder, flow, isLand } = world;
  const deg = 180 / Math.PI;
  void deg;
  for (let i = 0; i < n; i++) {
    if (riverOrder[i] < minOrder || !isLand[i] || world.lakeId[i] >= 0) continue;
    const j = downstream[i];
    if (j < 0) continue;
    const width = scale * (0.35 + 0.42 * Math.log10(1 + flow[i] / 60));
    // End the segment at the coast / lake shore (midpoint) to avoid painting into the sea.
    let lon1 = mesh.lon[j], lat1 = mesh.lat[j];
    if (!isLand[j] || world.lakeId[j] >= 0) {
      let dl = lon1 - mesh.lon[i];
      if (dl > Math.PI) dl -= 2 * Math.PI;
      if (dl < -Math.PI) dl += 2 * Math.PI;
      lon1 = mesh.lon[i] + dl * 0.5;
      lat1 = (mesh.lat[i] + lat1) / 2;
    }
    r.geoLine(mesh.lon[i], mesh.lat[i], lon1, lat1, width, color, 0.95);
  }
}

function drawCoast(r: Raster, color: RGB, alpha = 0.8): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const land = E[i] >= 0;
      const right = E[y * W + ((x + 1) % W)] >= 0;
      const down = y + 1 < H ? E[(y + 1) * W + x] >= 0 : land;
      if (land !== right || land !== down) r.set(x, y, color, alpha);
    }
  }
}

function save(name: string, r: Raster): void {
  writePNG(`${dir}/${name}.png`, r.w, r.h, r.rgba);
}

// ------------------------------------------------------------------ relief
let reliefRaster: Raster | null = null;
{
  const r = new Raster(W, H);
  for (let i = 0; i < W * H; i++) {
    const e = E[i];
    let c: RGB;
    if (LK[i] > 0.5) {
      const cell = S.nearest[i];
      const lk = world.lakes[world.lakeId[cell]];
      c = lk && lk.salty ? SALT_LAKE : LAKE;
    } else if (e < 0) {
      c = oceanColor(e);
      // subtle bathymetric shading
      c = shade(c, 0.9 + 0.12 * HS[i]);
    } else {
      c = ramp(HYPSO, e);
      const s = HS[i];
      c = shade(c, 0.55 + 0.6 * s);
    }
    r.set(i % W, (i / W) | 0, c);
  }
  drawRivers(r, [60, 110, 180]);
  drawCoast(r, [40, 60, 80], 0.5);
  save("relief", r);
  reliefRaster = r;
}

// ------------------------------------------------------------------ globe views (orthographic)
{
  const G = 512;
  const views: [number, number][] = [[20, -120], [20, -30], [20, 60], [20, 150], [90, 0], [-90, 0]];
  const r = new Raster(G * 3, G * 2);
  const relief = new Raster(W, H);
  relief.rgba.set(readRelief());
  views.forEach(([lat0d, lon0d], vi) => {
    const ox = (vi % 3) * G, oy = Math.floor(vi / 3) * G;
    const lat0 = (lat0d * Math.PI) / 180, lon0 = (lon0d * Math.PI) / 180;
    // Camera basis: forward f (towards viewer), east e, north u
    const fx = Math.cos(lat0) * Math.cos(lon0), fy = Math.cos(lat0) * Math.sin(lon0), fz = Math.sin(lat0);
    let ex = -Math.sin(lon0), ey = Math.cos(lon0), ez = 0;
    if (Math.abs(lat0d) === 90) { ex = 0; ey = 1; ez = 0; }
    const ux = fy * ez - fz * ey, uy = fz * ex - fx * ez, uz = fx * ey - fy * ex;
    for (let py = 0; py < G; py++) {
      for (let px = 0; px < G; px++) {
        const sx = (px + 0.5) / G * 2 - 1, sy = 1 - (py + 0.5) / G * 2;
        const rr = sx * sx + sy * sy;
        if (rr > 1) { r.set(ox + px, oy + py, [8, 8, 14]); continue; }
        const sz = Math.sqrt(1 - rr);
        const x = fx * sz + ex * sx + ux * sy, y = fy * sz + ey * sx + uy * sy, z = fz * sz + ez * sx + uz * sy;
        const lat = Math.asin(Math.max(-1, Math.min(1, z))), lon = Math.atan2(y, x);
        const [qx, qy] = relief.project(lon, lat);
        const c = relief.get(Math.min(W - 1, Math.floor(qx)), Math.min(H - 1, Math.floor(qy)));
        r.set(ox + px, oy + py, shade(c, 0.55 + 0.45 * sz));
      }
    }
  });
  save("globe", r);
}

function readRelief(): Uint8ClampedArray {
  return reliefRaster!.rgba;
}

// ------------------------------------------------------------------ plates
{
  const r = new Raster(W, H);
  const plateCol: RGB[] = world.plates.map((p) => {
    const h = hashInt(p.id, 77);
    const base: RGB = p.oceanic ? [70, 110, 160] : [170, 150, 100];
    return [base[0] + ((h & 63) - 32), base[1] + (((h >> 6) & 63) - 32), base[2] + (((h >> 12) & 63) - 32)];
  });
  const kindCol: RGB[] = [[0, 0, 0], [230, 40, 40], [40, 200, 255], [60, 220, 60]];
  for (let i = 0; i < W * H; i++) {
    const cell = S.nearest[i];
    let c = plateCol[world.plate[cell]];
    const b = world.boundary[cell];
    if (b) c = mix(c, kindCol[b], 0.85);
    else c = shade(c, E[i] >= 0 ? 1.15 : 0.85);
    r.set(i % W, (i / W) | 0, c);
  }
  drawCoast(r, [20, 20, 20], 0.9);
  // Motion arrows
  for (let lat = -75; lat <= 75; lat += 10) {
    for (let lon = -175; lon < 180; lon += 10) {
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      const x = Math.cos(la) * Math.cos(lo), y = Math.cos(la) * Math.sin(lo), z = Math.sin(la);
      const [px, py] = r.project(lo, la);
      const cell = S.nearest[Math.min(H - 1, Math.floor(py)) * W + Math.min(W - 1, Math.floor(px))];
      const pl = world.plates[world.plate[cell]];
      const [ax, ay, az] = pl.axis;
      const vx = pl.speed * (ay * z - az * y), vy = pl.speed * (az * x - ax * z), vz = pl.speed * (ax * y - ay * x);
      // east/north components
      const ex = -Math.sin(lo), ey = Math.cos(lo);
      const nx = -Math.sin(la) * Math.cos(lo), ny = -Math.sin(la) * Math.sin(lo), nz = Math.cos(la);
      const ve = vx * ex + vy * ey, vn = vx * nx + vy * ny + vz * nz;
      const k = 18;
      r.line(px, py, px + ve * k, py - vn * k, 0.7, [255, 255, 255], 0.9);
      r.disc(px, py, 1.4, [255, 255, 255], 0.9);
    }
  }
  for (const p of world.plates) {
    const [px, py] = r.project(mesh.lon[p.seedCell], mesh.lat[p.seedCell]);
    r.text(`${p.id}${p.oceanic ? "O" : "C"}`, px - 6, py - 4, 2, [255, 255, 255], [0, 0, 0]);
  }
  save("plates", r);
}

// ------------------------------------------------------------------ temperature
{
  const T = S.field(world.temperature);
  const r = new Raster(W, H);
  const TR: [number, RGB][] = [
    [-45, [250, 250, 255]], [-30, [200, 170, 230]], [-18, [120, 110, 200]], [-8, [70, 120, 210]], [0, [110, 190, 230]],
    [6, [130, 210, 170]], [12, [170, 220, 110]], [18, [240, 220, 90]], [24, [245, 160, 60]], [28, [220, 80, 40]], [34, [150, 20, 30]],
  ];
  for (let i = 0; i < W * H; i++) {
    let c = ramp(TR, T[i]);
    if (E[i] >= 0) c = shade(c, 0.8 + 0.3 * HS[i]);
    else c = shade(c, 0.85);
    r.set(i % W, (i / W) | 0, c);
  }
  drawCoast(r, [0, 0, 0], 0.8);
  // Wind arrows
  drawWind(r);
  save("temperature", r);
}

function drawWind(r: Raster): void {
  for (let lat = -80; lat <= 80; lat += 6) {
    for (let lon = -177; lon < 180; lon += 6) {
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      const [px, py] = r.project(lo, la);
      const cell = S.nearest[Math.min(H - 1, Math.floor(py)) * W + Math.min(W - 1, Math.floor(px))];
      const wx = world.wind[3 * cell], wy = world.wind[3 * cell + 1], wz = world.wind[3 * cell + 2];
      const ex = -Math.sin(lo), ey = Math.cos(lo);
      const nx = -Math.sin(la) * Math.cos(lo), ny = -Math.sin(la) * Math.sin(lo), nz = Math.cos(la);
      const ve = wx * ex + wy * ey, vn = wx * nx + wy * ny + wz * nz;
      const k = 2.6;
      r.line(px, py, px + ve * k, py - vn * k, 0.5, [20, 20, 20], 0.6);
      r.disc(px + ve * k, py - vn * k, 1.0, [20, 20, 20], 0.6);
    }
  }
}

// ------------------------------------------------------------------ precipitation
{
  const Pr = S.field(world.precipitation);
  const r = new Raster(W, H);
  const PR: [number, RGB][] = [
    [0, [150, 90, 40]], [125, [200, 150, 80]], [250, [230, 200, 120]], [500, [240, 240, 170]], [750, [180, 220, 140]],
    [1000, [110, 190, 120]], [1500, [50, 160, 140]], [2000, [40, 120, 170]], [3000, [40, 70, 160]], [4500, [80, 30, 130]],
  ];
  for (let i = 0; i < W * H; i++) {
    let c = ramp(PR, Pr[i]);
    if (E[i] >= 0) c = shade(c, 0.8 + 0.3 * HS[i]);
    else c = mix(shade(c, 0.75), [30, 40, 60], 0.35);
    r.set(i % W, (i / W) | 0, c);
  }
  drawCoast(r, [0, 0, 0], 0.8);
  drawRivers(r, [20, 40, 140], 1, 0.8);
  save("precipitation", r);
}

// ------------------------------------------------------------------ biomes
export const BIOME_COLORS: RGB[] = [
  [24, 52, 104], // deep ocean
  [40, 84, 150], // ocean
  [84, 146, 190], // shallows
  [214, 230, 240], // sea ice
  [70, 130, 200], // lake
  [245, 248, 252], // ice sheet
  [160, 168, 140], // tundra
  [62, 104, 78], // taiga
  [196, 190, 120], // steppe
  [178, 170, 150], // cold desert
  [176, 160, 92], // mediterranean scrub
  [74, 136, 64], // temperate forest
  [38, 110, 80], // temperate rainforest
  [232, 206, 140], // hot desert
  [194, 180, 84], // savanna
  [138, 150, 60], // tropical dry forest
  [24, 112, 40], // rainforest
  [80, 140, 120], // wetland
  [150, 140, 136], // alpine
  [150, 180, 90], // grassland
];
{
  const r = new Raster(W, H);
  const cols = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const c = BIOME_COLORS[world.biome[i]] ?? [255, 0, 255];
    cols[3 * i] = c[0]; cols[3 * i + 1] = c[1]; cols[3 * i + 2] = c[2];
  }
  for (let i = 0; i < W * H; i++) {
    const cell = S.nearest[i];
    let c: RGB = BIOME_COLORS[world.biome[cell]] ?? [255, 0, 255];
    if (E[i] >= 0) c = shade(c, 0.75 + 0.35 * HS[i]);
    r.set(i % W, (i / W) | 0, c);
  }
  drawRivers(r, [40, 80, 170], 2, 0.8);
  drawCoast(r, [0, 0, 0], 0.5);
  // Legend
  let ly = 10;
  for (let b = 0; b < BIOME_COLORS.length; b++) {
    for (let yy = 0; yy < 10; yy++) for (let xx = 0; xx < 14; xx++) r.set(8 + xx, ly + yy, BIOME_COLORS[b]);
    r.text(BIOME_NAMES[b], 26, ly + 1, 2, [255, 255, 255], [0, 0, 0]);
    ly += 14;
  }
  save("biomes", r);
}

// ------------------------------------------------------------------ natural colour
// Natural ("satellite") palette used for the natural.png view.
const NATURAL: RGB[] = [
  [24, 52, 104], [40, 84, 150], [84, 146, 190], [226, 236, 244], [70, 130, 200],
  [246, 248, 252], // ice sheet
  [150, 146, 118], // tundra
  [58, 82, 52], // taiga
  [176, 168, 110], // steppe
  [170, 156, 128], // cold desert
  [150, 140, 84], // mediterranean
  [70, 108, 50], // temperate forest
  [44, 88, 48], // temperate rainforest
  [222, 196, 146], // hot desert
  [168, 154, 80], // savanna
  [110, 124, 58], // tropical dry forest
  [34, 86, 34], // rainforest
  [74, 104, 70], // wetland
  [140, 132, 124], // alpine
  [132, 150, 76], // grassland
];
{
  const r = new Raster(W, H);
  const cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = world.biome[i];
    let c: RGB = NATURAL[b] ?? [255, 0, 255];
    if (!world.isLand[i]) c = oceanColor(world.elevation[i]);
    cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2];
  }
  const R_ = S.field(cr), G_ = S.field(cg), B_ = S.field(cb);
  for (let i = 0; i < W * H; i++) {
    let c: RGB = [R_[i], G_[i], B_[i]];
    if (LK[i] > 0.5) c = LAKE;
    else if (E[i] < 0) c = shade(oceanColor(E[i]), 0.92 + 0.1 * HS[i]);
    else c = shade(c, 0.6 + 0.55 * HS[i]);
    r.set(i % W, (i / W) | 0, c);
  }
  drawRivers(r, [50, 90, 150], 1, 0.9);
  save("natural", r);
}

// ------------------------------------------------------------------ fertility
{
  const F = S.field(world.fertility);
  const r = new Raster(W, H);
  const FR: [number, RGB][] = [[0, [90, 70, 60]], [0.2, [170, 140, 90]], [0.45, [210, 210, 110]], [0.7, [110, 190, 80]], [1, [20, 110, 30]]];
  for (let i = 0; i < W * H; i++) {
    let c = E[i] >= 0 && LK[i] <= 0.5 ? ramp(FR, F[i]) : ([40, 60, 90] as RGB);
    if (E[i] >= 0) c = shade(c, 0.8 + 0.25 * HS[i]);
    r.set(i % W, (i / W) | 0, c);
  }
  drawRivers(r, [40, 80, 170], 2, 0.7);
  drawCoast(r, [0, 0, 0], 0.6);
  save("fertility", r);
}

// ------------------------------------------------------------------ resources
{
  const r = new Raster(W, H);
  for (let i = 0; i < W * H; i++) {
    let c: RGB = E[i] >= 0 ? [200, 200, 190] : [70, 90, 120];
    if (E[i] >= 0) c = shade(c, 0.7 + 0.3 * HS[i]);
    r.set(i % W, (i / W) | 0, c);
  }
  drawCoast(r, [0, 0, 0], 0.6);
  const resCol: RGB[] = RESOURCE_KEYS.map((_, k) => {
    const h = hashInt(k * 31 + 7, 5);
    return [(h & 255) * 0.8 + 30, ((h >> 8) & 255) * 0.8 + 30, ((h >> 16) & 255) * 0.8 + 30];
  });
  for (let i = 0; i < n; i++) {
    const m = world.resources[i];
    if (!m) continue;
    const [px, py] = r.project(mesh.lon[i], mesh.lat[i]);
    let k = 0;
    for (let b = 0; b < RESOURCE_KEYS.length; b++) {
      if (m & Resource[RESOURCE_KEYS[b]]) {
        r.disc(px + k * 3, py, 2.2, resCol[b], 1);
        k++;
      }
    }
  }
  let ly = 10;
  for (let b = 0; b < RESOURCE_KEYS.length; b++) {
    r.disc(14, ly + 5, 4, resCol[b]);
    let count = 0;
    for (let i = 0; i < n; i++) if (world.resources[i] & Resource[RESOURCE_KEYS[b]]) count++;
    r.text(`${RESOURCE_KEYS[b]} ${count}`, 24, ly + 1, 2, [255, 255, 255], [0, 0, 0]);
    ly += 14;
  }
  save("resources", r);
}

// ------------------------------------------------------------------ features
{
  const r = new Raster(W, H);
  const KIND_COL: Record<string, RGB> = {
    ocean: [40, 70, 130], sea: [50, 100, 170], bay: [70, 130, 200], lake: [90, 160, 220], strait: [255, 255, 255],
    continent: [200, 200, 190], island: [215, 205, 180], mountains: [150, 105, 80], hills: [180, 150, 110],
    desert: [235, 205, 130], marsh: [90, 150, 130], jungle: [40, 120, 50], forest: [80, 145, 70], steppe: [200, 190, 120],
    tundra: [170, 175, 160], plain: [170, 200, 110], glacier: [245, 248, 255], volcano: [230, 40, 30],
  };
  const varied = (c: RGB, id: number): RGB => {
    const h = hashInt(id, 99);
    const k = 0.82 + 0.3 * ((h & 255) / 255);
    return [c[0] * k + ((h >> 8) & 15) - 8, c[1] * k + ((h >> 12) & 15) - 8, c[2] * k + ((h >> 16) & 15) - 8];
  };
  const fid = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const cell = S.nearest[i];
    let id = -1;
    const water = !world.isLand[cell] || world.lakeId[cell] >= 0;
    if (water) id = world.waterBodyOf[cell];
    else id = world.regionOf[cell] >= 0 ? world.regionOf[cell] : world.landmassOf[cell];
    fid[i] = id;
    const f = id >= 0 ? world.features[id] : undefined;
    let c: RGB = f ? varied(KIND_COL[f.kind] ?? [255, 0, 255], id) : [255, 0, 255];
    if (!water) c = shade(c, 0.75 + 0.3 * HS[i]);
    r.set(i % W, (i / W) | 0, c);
  }
  // Feature borders.
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (fid[i] !== fid[y * W + ((x + 1) % W)] || fid[i] !== fid[i + W]) r.set(x, y, [30, 30, 30], 0.35);
  }
  drawCoast(r, [0, 0, 0], 0.8);
  // Peninsulas and archipelagos as outlines (overlay features).
  for (const f of world.features) {
    if (f.kind !== "peninsula" && f.kind !== "archipelago" && f.kind !== "strait") continue;
    const col: RGB = f.kind === "peninsula" ? [255, 120, 0] : f.kind === "strait" ? [255, 255, 255] : [255, 230, 0];
    for (const c of f.cells) {
      const [px, py] = r.project(mesh.lon[c], mesh.lat[c]);
      r.disc(px, py, f.kind === "strait" ? 2.5 : 1.6, col, 0.9);
    }
  }
  for (const f of world.features) {
    if (f.kind !== "river") continue;
    for (let k = 0; k + 1 < f.cells.length; k++) {
      const a = f.cells[k], b = f.cells[k + 1];
      r.geoLine(mesh.lon[a], mesh.lat[a], mesh.lon[b], mesh.lat[b], 1.1, [20, 60, 200], 1);
    }
  }
  const CODE: Record<string, string> = {
    continent: "C", island: "I", ocean: "O", sea: "S", bay: "B", strait: "ST", lake: "L", river: "R", mountains: "M", hills: "H",
    volcano: "V", desert: "D", forest: "F", jungle: "J", steppe: "P", tundra: "T", marsh: "W", plain: "PL", peninsula: "N", archipelago: "A", glacier: "G",
  };
  const lines: string[] = [];
  for (const f of world.features) {
    const a = f.anchor;
    const [px, py] = r.project(mesh.lon[a], mesh.lat[a]);
    const tag = `${CODE[f.kind] ?? "?"}${f.id}`;
    if (f.kind === "volcano") r.disc(px, py, 3, [230, 30, 20]);
    if (f.kind !== "river" || f.cells.length > 6) r.text(tag, px - tag.length * 2, py - 3, 1, [255, 255, 255], [0, 0, 0]);
    const attrs = Object.entries(f.attrs).map(([k, v]) => `${k}=${typeof v === "number" ? +v.toFixed(3) : v}`).join(" ");
    const lat = ((mesh.lat[a] * 180) / Math.PI).toFixed(1), lon = ((mesh.lon[a] * 180) / Math.PI).toFixed(1);
    lines.push(`${f.id}\t${f.kind}\tcells=${f.cells.length}\tsize=${f.size.toFixed(0)}\tparent=${f.parent}\t@${lat},${lon}\t${attrs}`);
  }
  save("features", r);
  const counts: Record<string, number> = {};
  for (const f of world.features) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  writeFileSync(`${dir}/features.txt`, `${world.features.length} features: ${JSON.stringify(counts)}\n\n${lines.join("\n")}\n`);
}

// ------------------------------------------------------------------ stats
{
  let land = 0, tot = 0, lakeA = 0;
  const bArea = new Float64Array(32);
  for (let i = 0; i < n; i++) {
    tot += mesh.area[i];
    if (world.isLand[i]) land += mesh.area[i];
    if (world.lakeId[i] >= 0) lakeA += mesh.area[i];
    if (world.isLand[i]) bArea[world.biome[i]] += mesh.area[i];
  }
  let maxE = -99, minE = 99, maxQ = 0;
  for (let i = 0; i < n; i++) {
    maxE = Math.max(maxE, world.elevation[i]);
    minE = Math.min(minE, world.elevation[i]);
    maxQ = Math.max(maxQ, world.flow[i]);
  }
  const biomeStr = Array.from(bArea).map((a, b) => (a > 0 ? `${BIOME_NAMES[b]} ${((100 * a) / land).toFixed(1)}%` : "")).filter(Boolean).join(", ");
  const stats = [
    `seed ${seed}, ${n} cells, gen ${genMs.toFixed(0)} ms`,
    `ocean fraction ${(1 - land / tot).toFixed(4)} (lakes ${((100 * lakeA) / tot).toFixed(2)}% of surface)`,
    `elevation range ${minE.toFixed(2)} .. ${maxE.toFixed(2)} km, max discharge ${maxQ.toFixed(0)} m3/s, ${world.lakes.length} lakes`,
    `land biomes: ${biomeStr}`,
  ];
  console.log(stats.join("\n"));
  writeFileSync(`${dir}/stats.txt`, stats.join("\n") + "\n");
}

