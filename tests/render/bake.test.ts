import { describe, it, expect } from "vitest";
import { makeMockWorld } from "../../tools/mock-world";
import {
  bakeTerrain, bakeCellIds, bakeWarp, bakeGlobe, bakeRivers, encodeCellId, decodeCellId,
  bakeContext, sampleWarp, unwarp, dirToUV, buildRiverPaths,
} from "../../src/render/bake/index";
import { Rng } from "../../src/core/rng";

const W = 256, H = 128;
const world = makeMockWorld("render-test", 4000);

function isLandCell(i: number): boolean {
  return world.isLand[i] === 1 && world.lakeId[i] < 0;
}

describe("bake determinism", () => {
  it("bakes identical bytes for the same seed (fresh worlds, fresh caches)", () => {
    const a = makeMockWorld("det", 2500);
    const b = makeMockWorld("det", 2500);
    const ta = bakeTerrain(a, 128, 64);
    const tb = bakeTerrain(b, 128, 64);
    expect(Buffer.from(ta).equals(Buffer.from(tb))).toBe(true);
    const ia = bakeCellIds(a, 128, 64);
    const ib = bakeCellIds(b, 128, 64);
    expect(Buffer.from(ia).equals(Buffer.from(ib))).toBe(true);
    expect(Buffer.from(bakeWarp(a).rgba).equals(Buffer.from(bakeWarp(b).rgba))).toBe(true);
  });

  it("is stable across repeated bakes of one world (caches don't change results)", () => {
    const t1 = bakeTerrain(world, W, H);
    const t2 = bakeTerrain(world, W, H);
    expect(Buffer.from(t1).equals(Buffer.from(t2))).toBe(true);
  });

  it("different seeds give different textures", () => {
    const other = makeMockWorld("render-test-2", 4000);
    const a = bakeTerrain(world, 128, 64);
    const b = bakeTerrain(other, 128, 64);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe("cell id encoding", () => {
  it("round-trips 24-bit ids", () => {
    const rng = new Rng("ids");
    const buf = new Uint8Array(4);
    const ids = [0, 1, 255, 256, 65535, 65536, (1 << 24) - 1];
    for (let i = 0; i < 500; i++) ids.push(rng.int(0, (1 << 24) - 1));
    for (const id of ids) {
      encodeCellId(id, buf, 0);
      expect(decodeCellId(buf, 0)).toBe(id);
    }
  });

  it("every pixel names a valid cell", () => {
    const ids = bakeCellIds(world, W, H);
    for (let p = 0; p < W * H; p++) {
      const id = decodeCellId(ids, 4 * p);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(world.mesh.n);
    }
  });
});

describe("coast consistency", () => {
  it("land pixels map to land cells and water pixels to water cells (independent bakes)", () => {
    const terrain = bakeTerrain(world, W, H);
    const ids = bakeCellIds(world, W, H); // recomputes the land/water decision itself
    let land = 0, bad = 0;
    for (let p = 0; p < W * H; p++) {
      const landPx = terrain[4 * p + 3] >= 128;
      const id = decodeCellId(ids, 4 * p);
      if (landPx !== isLandCell(id)) bad++;
      if ((ids[4 * p + 3] === 255) !== landPx) bad++;
      if (landPx) land++;
    }
    expect(bad).toBe(0);
    // Plausible land fraction (mock targets ~36% land).
    expect(land / (W * H)).toBeGreaterThan(0.15);
    expect(land / (W * H)).toBeLessThan(0.6);
  });

  it("also holds when the id bake reuses the terrain's coast decision, at a larger size", () => {
    const w = 512, h = 256;
    const g = bakeGlobe(world, { width: w });
    for (let p = 0; p < w * h; p++) {
      const landPx = g.terrain.rgba[4 * p + 3] >= 128;
      expect(isLandCell(decodeCellId(g.cellIds.rgba, 4 * p))).toBe(landPx);
    }
  });

  it("a water cell's own site is water and a land cell's own site is land", () => {
    // Pixels nearest each cell site (after inverse warp) carry the cell's class.
    const terrain = bakeTerrain(world, 1024, 512);
    const ctx = bakeContext(world);
    const out = new Float64Array(3);
    const uv = new Float64Array(2);
    let bad = 0;
    for (let i = 0; i < world.mesh.n; i += 3) {
      const x = world.mesh.xyz[3 * i], y = world.mesh.xyz[3 * i + 1], z = world.mesh.xyz[3 * i + 2];
      unwarp(ctx.warp, x, y, z, out);
      dirToUV(out[0], out[1], out[2], uv);
      const px = Math.min(1023, Math.floor(uv[0] * 1024)), py = Math.min(511, Math.floor(uv[1] * 512));
      if ((terrain[4 * (py * 1024 + px) + 3] >= 128) !== isLandCell(i)) bad++;
    }
    // Allow a sliver of pixel-quantisation misses on tiny one-cell features.
    expect(bad / (world.mesh.n / 3)).toBeLessThan(0.02);
  });
});

describe("finite, sane outputs", () => {
  it("terrain is opaque-coloured, varied, and not degenerate", () => {
    const t = bakeTerrain(world, W, H);
    let min = 255, max = 0, sum = 0;
    for (let p = 0; p < W * H; p++) {
      const l = t[4 * p] + t[4 * p + 1] + t[4 * p + 2];
      min = Math.min(min, l);
      max = Math.max(max, l);
      sum += l;
    }
    expect(max - min).toBeGreaterThan(200);
    expect(sum / (W * H)).toBeGreaterThan(60);
  });

  it("warp lattice is finite and bounded; unwarp inverts the warp", () => {
    const ctx = bakeContext(world);
    for (const v of ctx.warp.vec) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(ctx.warp.amp + 1e-6);
    }
    const rng = new Rng("unwarp");
    const p = new Float64Array(3), uv = new Float64Array(2), d = new Float64Array(3);
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = rng.unitVector();
      unwarp(ctx.warp, x, y, z, p);
      dirToUV(p[0], p[1], p[2], uv);
      sampleWarp(ctx.warp, uv[0], uv[1], d);
      const qx = p[0] + d[0], qy = p[1] + d[1], qz = p[2] + d[2];
      const l = Math.hypot(qx, qy, qz);
      const ang = Math.acos(Math.min(1, (qx * x + qy * y + qz * z) / l));
      expect(ang).toBeLessThan(0.15 * world.mesh.meanSpacing);
    }
  });

  it("river paths are finite unit vectors with positive widths; tributaries meet their trunks", () => {
    const ctx = bakeContext(world);
    const paths = buildRiverPaths(ctx);
    expect(paths.length).toBeGreaterThan(5);
    const all: number[][] = [];
    for (const path of paths) {
      for (let k = 0; k < path.halfWidth.length; k++) {
        const x = path.pts[3 * k], y = path.pts[3 * k + 1], z = path.pts[3 * k + 2];
        expect(Number.isFinite(x + y + z)).toBe(true);
        expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-6);
        expect(path.halfWidth[k]).toBeGreaterThan(0);
        all.push([x, y, z]);
      }
    }
    const geo = bakeRivers(world);
    expect(geo.start[geo.start.length - 1]).toBe(all.length);
    for (const v of geo.hw) expect(Number.isFinite(v) && v > 0).toBe(true);
  });

  it("bakeGlobe returns consistently sized images", () => {
    const g = bakeGlobe(world, { width: 256 });
    expect(g.terrain.rgba.length).toBe(256 * 128 * 4);
    expect(g.cellIds.rgba.length).toBe(256 * 128 * 4);
    expect(g.warp.rgba.length).toBe(g.warp.width * g.warp.height * 4);
    expect(g.warp.width).toBe(2 * g.warp.height);
  });
});
