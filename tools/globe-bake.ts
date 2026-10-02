/**
 * Bake the globe textures in Node and write debug PNGs + timings.
 *
 *   npx tsx tools/globe-bake.ts [--seed=mock] [--cells=40000] [--w=2048] [--real] [--crop=x,y,w,h]
 *
 * Writes out/globe/terrain.png, out/globe/cellids.png (false-colour), out/globe/warp.png.
 */
import { writePNG } from "./png";
import { makeMockWorld } from "./mock-world";
import { bakeTerrain, bakeCellIds, decodeCellId, bakeWarp } from "../src/render/bake/index";
import { hashInt } from "../src/core/rng";
import type { PhysicalWorld } from "../src/world/types";

const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.join("=") || "1"];
  }),
);
const seed = flags.seed ?? "mock";
const cells = +(flags.cells ?? 40000);
const W = +(flags.w ?? 2048);
const H = W / 2;

async function loadWorld(): Promise<PhysicalWorld> {
  if (flags.real) {
    const geo = await import("../src/geo/index");
    const { Rng } = await import("../src/core/rng");
    const { DEFAULT_PARAMS } = await import("../src/world/types");
    return (geo as any).generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed));
  }
  return makeMockWorld(seed, cells);
}

const t0 = performance.now();
const world = await loadWorld();
const t1 = performance.now();
console.log(`world: ${(t1 - t0).toFixed(0)} ms (${flags.real ? "real" : "mock"}, ${world.mesh.n} cells)`);
const terrain = bakeTerrain(world, W, H);
const t2 = performance.now();
console.log(`bakeTerrain ${W}x${H}: ${(t2 - t1).toFixed(0)} ms`);
// Opaque copy for viewing.
const view = Uint8Array.from(terrain);
for (let i = 3; i < view.length; i += 4) view[i] = 255;
writePNG(`out/globe/terrain-${W}.png`, W, H, view);
if (flags.crop) {
  const [cx, cy, cw, ch] = flags.crop.split(",").map(Number);
  const crop = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(view.subarray(((cy + y) * W + cx) * 4, ((cy + y) * W + cx + cw) * 4), y * cw * 4);
  writePNG(`out/globe/terrain-crop.png`, cw, ch, crop);
}
console.log("wrote out/globe/terrain-" + W + ".png");

const t3 = performance.now();
const ids = bakeCellIds(world, W, H);
const t4 = performance.now();
console.log(`bakeCellIds ${W}x${H}: ${(t4 - t3).toFixed(0)} ms`);
// Consistency + false-colour preview (terrain modulated by a per-cell hue).
let bad = 0;
const prev = new Uint8Array(W * H * 4);
for (let p = 0; p < W * H; p++) {
  const o = 4 * p;
  const id = decodeCellId(ids, o);
  const landPx = terrain[o + 3] >= 128;
  const landCell = world.isLand[id] === 1 && world.lakeId[id] < 0;
  if (landPx !== landCell || (ids[o + 3] === 255) !== landPx) bad++;
  const h = hashInt(id, 7);
  const k = landPx ? 0.55 : 0.85;
  prev[o] = view[o] * k + (h & 255) * (1 - k);
  prev[o + 1] = view[o + 1] * k + ((h >> 8) & 255) * (1 - k);
  prev[o + 2] = view[o + 2] * k + ((h >> 16) & 255) * (1 - k);
  prev[o + 3] = 255;
}
console.log(`coast consistency: ${bad} mismatching pixels`);
writePNG(`out/globe/cellids-${W}.png`, W, H, prev);
if (flags.crop) {
  const [cx, cy, cw, ch] = flags.crop.split(",").map(Number);
  const crop = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(prev.subarray(((cy + y) * W + cx) * 4, ((cy + y) * W + cx + cw) * 4), y * cw * 4);
  writePNG(`out/globe/cellids-crop.png`, cw, ch, crop);
}
const warp = bakeWarp(world);
writePNG(`out/globe/warp.png`, warp.width, warp.height, warp.rgba);
console.log(`warp lattice ${warp.width}x${warp.height}, amp ${warp.amp.toFixed(4)}`);
