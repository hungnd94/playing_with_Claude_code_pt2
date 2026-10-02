/**
 * Render a montage of several worlds side by side to judge variety.
 *
 *   npx tsx tools/geo-montage.ts [cells] [seed ...]
 *
 * Writes out/geo/montage.png (natural colours with relief and rivers) and
 * out/geo/montage-relief.png (hypsometric).
 */
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS, Biome } from "../src/world/types";
import { writePNG } from "./png";
import { Raster, Sampler, ramp, shade, hillshade, type RGB } from "./geo-raster";

const cells = Number(process.argv[2] ?? DEFAULT_PARAMS.cells);
const seeds = process.argv.length > 3 ? process.argv.slice(3) : ["aurora", "basalt", "cinder", "delta", "ember", "fjord"];
const W = 800, H = 400;
const cols = 2;
const rows = Math.ceil(seeds.length / cols);
const out = new Raster(W * cols, H * rows);
const outR = new Raster(W * cols, H * rows);

const NATURAL: RGB[] = [
  [24, 52, 104], [40, 84, 150], [84, 146, 190], [226, 236, 244], [70, 130, 200],
  [246, 248, 252], [150, 146, 118], [58, 82, 52], [176, 168, 110], [170, 156, 128], [150, 140, 84],
  [70, 108, 50], [44, 88, 48], [222, 196, 146], [168, 154, 80], [110, 124, 58], [34, 86, 34], [74, 104, 70], [140, 132, 124], [132, 150, 76],
];
const BATHY: [number, RGB][] = [
  [-8, [10, 26, 64]], [-5.5, [22, 48, 104]], [-4, [32, 70, 136]], [-2.5, [48, 96, 162]], [-1, [72, 130, 190]], [-0.25, [118, 172, 210]], [0, [152, 198, 222]],
];
const HYPSO: [number, RGB][] = [
  [0, [104, 146, 92]], [0.15, [128, 160, 100]], [0.4, [168, 178, 116]], [0.8, [196, 180, 128]],
  [1.4, [188, 152, 108]], [2.2, [160, 124, 96]], [3.0, [142, 116, 104]], [3.8, [168, 160, 158]], [4.8, [236, 236, 240]],
];

seeds.forEach((seed, k) => {
  const t0 = performance.now();
  const w = generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed));
  const ms = performance.now() - t0;
  const n = w.mesh.n;
  const S = new Sampler(w.mesh, W, H);
  const ce = new Float32Array(n);
  for (let i = 0; i < n; i++) ce[i] = w.isLand[i] ? Math.max(w.elevation[i], 0.002) : w.elevation[i];
  const E = S.field(ce);
  const lk = new Float32Array(n);
  for (let i = 0; i < n; i++) lk[i] = w.lakeId[i] >= 0 ? 1 : 0;
  const LK = S.field(lk);
  const HS = hillshade(E, W, H, w.params.radiusKm, 22);
  const cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = w.isLand[i] ? NATURAL[w.biome[i]] : ramp(BATHY, w.elevation[i]);
    cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2];
  }
  const R = S.field(cr), G = S.field(cg), B = S.field(cb);
  const ox = (k % cols) * W, oy = Math.floor(k / cols) * H;
  const tile = new Raster(W, H), tileR = new Raster(W, H);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    let c: RGB, cR: RGB;
    if (LK[i] > 0.5) { c = [70, 120, 180]; cR = c; }
    else if (E[i] < 0) { c = shade(ramp(BATHY, E[i]), 0.92 + 0.1 * HS[i]); cR = c; }
    else { c = shade([R[i], G[i], B[i]], 0.6 + 0.55 * HS[i]); cR = shade(ramp(HYPSO, E[i]), 0.55 + 0.6 * HS[i]); }
    tile.set(x, y, c);
    tileR.set(x, y, cR);
  }
  for (let i = 0; i < n; i++) {
    if (w.riverOrder[i] < 1 || w.lakeId[i] >= 0) continue;
    const j = w.downstream[i];
    if (j < 0) continue;
    let lon1 = w.mesh.lon[j], lat1 = w.mesh.lat[j];
    if (!w.isLand[j] || w.lakeId[j] >= 0) {
      let dl = lon1 - w.mesh.lon[i];
      if (dl > Math.PI) dl -= 2 * Math.PI;
      if (dl < -Math.PI) dl += 2 * Math.PI;
      lon1 = w.mesh.lon[i] + dl * 0.5;
      lat1 = (w.mesh.lat[i] + lat1) / 2;
    }
    const width = 0.25 + 0.3 * Math.log10(1 + w.flow[i] / 80);
    tile.geoLine(w.mesh.lon[i], w.mesh.lat[i], lon1, lat1, width, [50, 90, 150], 0.9);
    tileR.geoLine(w.mesh.lon[i], w.mesh.lat[i], lon1, lat1, width, [50, 100, 170], 0.9);
  }
  let ice = 0, des = 0, land = 0;
  for (let i = 0; i < n; i++) if (w.isLand[i]) { land++; if (w.biome[i] === Biome.IceSheet) ice++; if (w.biome[i] === Biome.HotDesert) des++; }
  const label = `${seed}`;
  tile.text(label, 6, 6, 2, [255, 255, 255], [0, 0, 0]);
  tileR.text(label, 6, 6, 2, [255, 255, 255], [0, 0, 0]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    out.set(ox + x, oy + y, tile.get(x, y));
    outR.set(ox + x, oy + y, tileR.get(x, y));
  }
  console.log(`${seed}: ${ms.toFixed(0)} ms, ${w.features.length} features, ice ${(100 * ice / land).toFixed(1)}%, desert ${(100 * des / land).toFixed(1)}%`);
});
writePNG("out/geo/montage.png", out.w, out.h, out.rgba);
writePNG("out/geo/montage-relief.png", outR.w, outR.h, outR.rgba);
