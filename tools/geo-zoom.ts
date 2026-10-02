/**
 * Close-up relief views of a generated world (orthographic projection), to
 * judge coastlines, mountain ranges and river networks at small scales.
 *
 *   npx tsx tools/geo-zoom.ts <seed> [cells] [lat,lon,radiusDeg ...]
 *
 * Without view arguments, a few views are picked automatically (the highest
 * peak, the most intricate high-latitude coast, the biggest river mouth and a
 * continental interior). Writes out/geo/<seed>/zoom-<k>.png (1024²).
 */
import { mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { CellLocator } from "../src/core/sphere";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS, type PhysicalWorld } from "../src/world/types";
import { writePNG } from "./png";
import { Raster, ramp, shade, type RGB } from "./geo-raster";

const seed = process.argv[2] ?? "palimpsest";
const cells = Number(process.argv[3] ?? DEFAULT_PARAMS.cells);
const SIZE = 1024;
const dir = `out/geo/${seed}`;
mkdirSync(dir, { recursive: true });

const world = generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed));
const DEG = Math.PI / 180;

const HYPSO: [number, RGB][] = [
  [0, [96, 140, 86]], [0.15, [124, 158, 96]], [0.4, [166, 176, 114]], [0.8, [196, 180, 128]],
  [1.4, [184, 148, 104]], [2.2, [156, 120, 92]], [3.0, [140, 114, 102]], [3.8, [170, 162, 160]], [4.8, [238, 238, 242]],
];
const BATHY: [number, RGB][] = [
  [-8, [10, 26, 64]], [-5.5, [22, 48, 104]], [-4, [32, 70, 136]], [-2.5, [48, 96, 162]], [-1, [72, 130, 190]],
  [-0.25, [118, 172, 210]], [0, [152, 198, 222]],
];

function autoViews(w: PhysicalWorld): [number, number, number][] {
  const { mesh } = w;
  const views: [number, number, number][] = [];
  let peak = 0, mouth = -1;
  for (let i = 0; i < mesh.n; i++) if (w.elevation[i] > w.elevation[peak]) peak = i;
  for (const f of w.features) if (f.kind === "river" && (mouth < 0 || w.flow[f.anchor] > w.flow[mouth])) mouth = f.anchor;
  views.push([mesh.lat[peak] / DEG, mesh.lon[peak] / DEG, 14]);
  // High-latitude coast with the most coastal cells in a 10° window.
  let bestC = -1, bestCount = -1;
  for (let i = 0; i < mesh.n; i += 7) {
    const a = Math.abs(mesh.lat[i]) / DEG;
    if (a < 50 || a > 72 || w.coastDist[i] !== 1) continue;
    let count = 0;
    const x = mesh.xyz[3 * i], y = mesh.xyz[3 * i + 1], z = mesh.xyz[3 * i + 2];
    for (let j = 0; j < mesh.n; j += 3) {
      if (w.coastDist[j] !== 1) continue;
      if (x * mesh.xyz[3 * j] + y * mesh.xyz[3 * j + 1] + z * mesh.xyz[3 * j + 2] > Math.cos(8 * DEG)) count++;
    }
    if (count > bestCount) { bestCount = count; bestC = i; }
  }
  if (bestC >= 0) views.push([mesh.lat[bestC] / DEG, mesh.lon[bestC] / DEG, 12]);
  if (mouth >= 0) views.push([mesh.lat[mouth] / DEG, mesh.lon[mouth] / DEG, 18]);
  // Continental interior: the land cell farthest from the coast.
  let far = 0;
  for (let i = 0; i < mesh.n; i++) if (w.coastDist[i] > w.coastDist[far]) far = i;
  views.push([mesh.lat[far] / DEG, mesh.lon[far] / DEG, 20]);
  return views;
}

const views: [number, number, number][] = process.argv.length > 4
  ? process.argv.slice(4).map((s) => s.split(",").map(Number) as [number, number, number])
  : autoViews(world);

const { mesh } = world;
const n = mesh.n;
const locator = new CellLocator(mesh);
const bary = new Float64Array(3);
const R = world.params.radiusKm;

views.forEach(([lat0d, lon0d, radDeg], vi) => {
  const lat0 = lat0d * DEG, lon0 = lon0d * DEG, rad = radDeg * DEG;
  const fx = Math.cos(lat0) * Math.cos(lon0), fy = Math.cos(lat0) * Math.sin(lon0), fz = Math.sin(lat0);
  const ex = -Math.sin(lon0), ey = Math.cos(lon0), ez = 0;
  const ux = fy * ez - fz * ey, uy = fz * ex - fx * ez, uz = fx * ey - fy * ex;
  const scale = Math.sin(rad); // half-width in tangent-plane units
  const E = new Float32Array(SIZE * SIZE);
  const lake = new Uint8Array(SIZE * SIZE);
  let hint = -1;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const sx = ((px + 0.5) / SIZE * 2 - 1) * scale, sy = (1 - (py + 0.5) / SIZE * 2) * scale;
      const sz = Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy));
      const x = fx * sz + ex * sx + ux * sy, y = fy * sz + ey * sx + uy * sy, z = fz * sz + ez * sx + uz * sy;
      const t = locator.locateTriangle(x, y, z, bary, hint);
      const a = mesh.triangles[3 * t], b = mesh.triangles[3 * t + 1], c = mesh.triangles[3 * t + 2];
      const ev = (k: number) => (world.isLand[k] ? Math.max(world.elevation[k], 0.002) : world.elevation[k]);
      E[py * SIZE + px] = bary[0] * ev(a) + bary[1] * ev(b) + bary[2] * ev(c);
      const nst = bary[0] >= bary[1] && bary[0] >= bary[2] ? a : bary[1] >= bary[2] ? b : c;
      lake[py * SIZE + px] = world.lakeId[nst] >= 0 ? 1 : 0;
      hint = nst;
    }
  }
  const kmPerPx = (2 * scale * R) / SIZE;
  const r = new Raster(SIZE, SIZE);
  const exag = 30;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const i = py * SIZE + px;
      const e = E[i];
      const xm = Math.max(0, px - 1), xp = Math.min(SIZE - 1, px + 1), ym = Math.max(0, py - 1), yp = Math.min(SIZE - 1, py + 1);
      const dzdx = (Math.max(0, E[py * SIZE + xp]) - Math.max(0, E[py * SIZE + xm])) / ((xp - xm) * kmPerPx) * exag;
      const dzdy = (Math.max(0, E[yp * SIZE + px]) - Math.max(0, E[ym * SIZE + px])) / ((yp - ym) * kmPerPx) * exag;
      const nl = Math.hypot(dzdx, dzdy, 1);
      const hs = (dzdx * 0.6 + dzdy * 0.6 + 0.53) / (nl * Math.hypot(0.6, 0.6, 0.53));
      let c: RGB;
      if (lake[i]) c = [86, 140, 196];
      else if (e < 0) c = shade(ramp(BATHY, e), 0.92 + 0.1 * hs);
      else c = shade(ramp(HYPSO, e), 0.5 + 0.65 * hs);
      r.set(px, py, c);
    }
  }
  // Coastline.
  for (let py = 0; py < SIZE - 1; py++) for (let px = 0; px < SIZE - 1; px++) {
    const i = py * SIZE + px;
    const l = E[i] >= 0;
    if (l !== (E[i + 1] >= 0) || l !== (E[i + SIZE] >= 0)) r.set(px, py, [30, 45, 60], 0.6);
  }
  // Rivers.
  const proj = (k: number): [number, number, boolean] => {
    const x = mesh.xyz[3 * k], y = mesh.xyz[3 * k + 1], z = mesh.xyz[3 * k + 2];
    const d = x * fx + y * fy + z * fz;
    const sx = x * ex + y * ey + z * ez, sy = x * ux + y * uy + z * uz;
    return [((sx / scale) + 1) / 2 * SIZE, (1 - sy / scale) / 2 * SIZE, d > 0];
  };
  for (let i = 0; i < n; i++) {
    if (world.riverOrder[i] < 1 || world.lakeId[i] >= 0 || !world.isLand[i]) continue;
    const j = world.downstream[i];
    if (j < 0) continue;
    const [x0, y0, v0] = proj(i);
    let [x1, y1, v1] = proj(j);
    if (!v0 || !v1) continue;
    // Raster.disc wraps horizontally (for world maps), so clip strictly here.
    if (x0 < 2 || x0 > SIZE - 3 || y0 < 2 || y0 > SIZE - 3 || x1 < 2 || x1 > SIZE - 3 || y1 < 2 || y1 > SIZE - 3) continue;
    if (!world.isLand[j] || world.lakeId[j] >= 0) { x1 = (x0 + x1) / 2; y1 = (y0 + y1) / 2; }
    const width = 0.5 + 0.7 * Math.log10(1 + world.flow[i] / 60);
    r.line(x0, y0, x1, y1, width, [50, 100, 175], 0.9);
  }
  r.text(`${lat0d.toFixed(0)},${lon0d.toFixed(0)} R${radDeg}`, 8, 8, 2, [255, 255, 255], [0, 0, 0]);
  const file = `${dir}/zoom-${vi}.png`;
  writePNG(file, SIZE, SIZE, r.rgba);
  console.log(`${file}: ${lat0d.toFixed(1)},${lon0d.toFixed(1)} r=${radDeg}° (${kmPerPx.toFixed(1)} km/px)`);
});
