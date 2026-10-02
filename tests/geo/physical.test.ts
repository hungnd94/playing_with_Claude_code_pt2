import { describe, it, expect } from "vitest";
import { Rng } from "../../src/core/rng";
import { generatePhysical } from "../../src/geo/index";
import { cellDistanceKm, landMoveCost, seaMoveCost } from "../../src/geo/travel";
import { DEFAULT_PARAMS, Biome, isWaterBiome, type PhysicalWorld, type WorldParams } from "../../src/world/types";

const CELLS = 8000;
const make = (seed: string, extra: Partial<WorldParams> = {}): PhysicalWorld =>
  generatePhysical({ ...DEFAULT_PARAMS, cells: CELLS, seed, ...extra }, new Rng(seed));

const worlds = new Map<string, PhysicalWorld>();
const get = (seed: string) => {
  if (!worlds.has(seed)) worlds.set(seed, make(seed));
  return worlds.get(seed)!;
};
const SEEDS = ["alpha", "brimstone", "cedar"];

describe("geo: determinism", () => {
  it("same params + seed → identical arrays and features", () => {
    const a = make("determinism");
    const b = make("determinism");
    const fields = [
      "plate", "boundary", "elevation", "volcanism", "seismicity", "isLand", "coastDist", "temperature", "tempRange",
      "precipitation", "wind", "downstream", "flow", "riverOrder", "lakeId", "biome", "fertility", "resources",
      "landmassOf", "waterBodyOf", "regionOf",
    ] as const;
    for (const f of fields) {
      const x = a[f] as ArrayLike<number>, y = b[f] as ArrayLike<number>;
      expect(x.length, f).toBe(y.length);
      let same = true;
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) { same = false; break; }
      expect(same, `${f} differs`).toBe(true);
    }
    const ser = (w: PhysicalWorld) => JSON.stringify(w.features.map((f) => ({ ...f, cells: Array.from(f.cells) })));
    expect(ser(a)).toBe(ser(b));
    expect(JSON.stringify(a.lakes.map((l) => ({ ...l, cells: Array.from(l.cells) })))).toBe(JSON.stringify(b.lakes.map((l) => ({ ...l, cells: Array.from(l.cells) }))));
    expect(JSON.stringify(a.plates)).toBe(JSON.stringify(b.plates));
  });

  it("different seeds give different worlds", () => {
    const a = get("alpha"), b = get("brimstone");
    let diff = 0;
    for (let i = 0; i < a.mesh.n; i++) if (a.isLand[i] !== b.isLand[i]) diff++;
    expect(diff).toBeGreaterThan(a.mesh.n * 0.1);
  });
});

describe.each(SEEDS)("geo invariants (%s)", (seed) => {
  it("ocean fraction ≈ params.oceanFraction (±1%, by area)", () => {
    const w = get(seed);
    let ocean = 0, tot = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      tot += w.mesh.area[i];
      if (!w.isLand[i]) ocean += w.mesh.area[i];
    }
    expect(Math.abs(ocean / tot - w.params.oceanFraction)).toBeLessThan(0.01);
  });

  it("land/sea consistency: elevation sign, coastDist sign", () => {
    const w = get(seed);
    for (let i = 0; i < w.mesh.n; i++) {
      if (!w.isLand[i]) {
        expect(w.elevation[i]).toBeLessThan(0);
        expect(w.coastDist[i]).toBeLessThan(0);
      } else {
        expect(w.coastDist[i]).toBeGreaterThan(0);
        if (w.lakeId[i] < 0) expect(w.elevation[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("downstream graph is acyclic and ends in the ocean or an endorheic lake", () => {
    const w = get(seed);
    const n = w.mesh.n;
    const state = new Uint8Array(n); // 0 unknown, 2 verified
    for (let s = 0; s < n; s++) {
      if (!w.isLand[s] || state[s]) continue;
      const path: number[] = [];
      let c = s;
      let steps = 0;
      while (c >= 0 && w.isLand[c] && !state[c]) {
        path.push(c);
        const d = w.downstream[c];
        if (d < 0) {
          // Terminal land cell: must be the sink of an endorheic (salty) lake.
          expect(w.lakeId[c]).toBeGreaterThanOrEqual(0);
          expect(w.lakes[w.lakeId[c]].salty).toBe(true);
        } else {
          // Adjacent cells only.
          const nb = Array.from(w.mesh.adj.subarray(w.mesh.adjStart[c], w.mesh.adjStart[c + 1]));
          expect(nb).toContain(d);
        }
        c = d;
        if (++steps > n) throw new Error("cycle in downstream graph");
      }
      for (const p of path) state[p] = 2;
    }
    for (let i = 0; i < n; i++) if (!w.isLand[i]) expect(w.downstream[i]).toBe(-1);
  });

  it("flows are non-negative and non-decreasing downstream outside lakes", () => {
    const w = get(seed);
    for (let i = 0; i < w.mesh.n; i++) {
      expect(w.flow[i]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(w.flow[i])).toBe(true);
      const j = w.downstream[i];
      if (j < 0 || !w.isLand[j]) continue;
      if (w.lakeId[i] >= 0 || w.lakeId[j] >= 0) continue; // lake evaporation sinks
      expect(w.flow[j] + 1e-3).toBeGreaterThanOrEqual(w.flow[i]);
    }
    let max = 0;
    for (let i = 0; i < w.mesh.n; i++) max = Math.max(max, w.flow[i]);
    expect(max).toBeGreaterThan(1000); // real rivers exist
  });

  it("every land cell has a landmass; every water cell a water body", () => {
    const w = get(seed);
    for (let i = 0; i < w.mesh.n; i++) {
      if (w.isLand[i]) {
        expect(w.landmassOf[i]).toBeGreaterThanOrEqual(0);
        expect(["continent", "island", "archipelago"]).toContain(w.features[w.landmassOf[i]].kind);
      } else {
        expect(w.landmassOf[i]).toBe(-1);
      }
      if (!w.isLand[i] || w.lakeId[i] >= 0) {
        expect(w.waterBodyOf[i]).toBeGreaterThanOrEqual(0);
        expect(["ocean", "sea", "bay", "lake"]).toContain(w.features[w.waterBodyOf[i]].kind);
      } else {
        expect(w.waterBodyOf[i]).toBe(-1);
      }
    }
  });

  it("biomes agree with land and water", () => {
    const w = get(seed);
    for (let i = 0; i < w.mesh.n; i++) {
      const water = !w.isLand[i] || w.lakeId[i] >= 0;
      expect(isWaterBiome(w.biome[i]), `cell ${i}`).toBe(water);
      expect(w.biome[i] === Biome.Lake).toBe(w.lakeId[i] >= 0);
      if (!water) {
        expect(w.fertility[i]).toBeGreaterThanOrEqual(0);
        expect(w.fertility[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lakes are consistent", () => {
    const w = get(seed);
    for (const lake of w.lakes) {
      expect(lake.cells.length).toBeGreaterThan(0);
      for (const c of lake.cells) expect(w.lakeId[c]).toBe(lake.id);
      if (lake.salty) expect(lake.outlet).toBe(-1);
      else {
        expect(w.lakeId[lake.outlet]).toBe(lake.id);
        const d = w.downstream[lake.outlet];
        expect(d === -1 ? -1 : w.lakeId[d]).not.toBe(lake.id);
      }
    }
  });

  it("features reference valid cells and features", () => {
    const w = get(seed);
    const n = w.mesh.n;
    expect(w.features.length).toBeGreaterThan(30);
    expect(w.features.length).toBeLessThan(400);
    w.features.forEach((f, k) => {
      expect(f.id).toBe(k);
      expect(f.cells.length).toBeGreaterThan(0);
      for (const c of f.cells) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(n); }
      expect(f.anchor).toBeGreaterThanOrEqual(0);
      expect(f.anchor).toBeLessThan(n);
      expect(f.parent).toBeGreaterThanOrEqual(-1);
      expect(f.parent).toBeLessThan(w.features.length);
      expect(f.size).toBeGreaterThan(0);
      for (const key of ["endsIn", "tributaryOf", "sourceLake", "outflowRiver", "archipelago"]) {
        const v = f.attrs[key];
        if (typeof v === "number") { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThan(w.features.length); }
      }
      if (f.kind === "river") {
        // Ordered source → mouth along the drainage network.
        for (let t = 0; t + 1 < f.cells.length; t++) expect(w.downstream[f.cells[t]]).toBe(f.cells[t + 1]);
      }
    });
    for (let i = 0; i < n; i++) {
      const r = w.regionOf[i];
      if (r >= 0) expect(Array.from(w.features[r].cells)).toContain(i);
    }
    const kinds = new Set(w.features.map((f) => f.kind));
    for (const k of ["continent", "ocean", "river", "mountains", "lake"]) expect(kinds.has(k as never), k).toBe(true);
  });

  it("climate fields are physically sensible", () => {
    const w = get(seed);
    for (let i = 0; i < w.mesh.n; i++) {
      expect(w.temperature[i]).toBeGreaterThan(-70);
      expect(w.temperature[i]).toBeLessThan(45);
      expect(w.tempRange[i]).toBeGreaterThanOrEqual(0);
      expect(w.precipitation[i]).toBeGreaterThanOrEqual(0);
      expect(w.precipitation[i]).toBeLessThan(12000);
      // Wind is tangent to the sphere.
      const p = w.mesh.xyz;
      const dot = w.wind[3 * i] * p[3 * i] + w.wind[3 * i + 1] * p[3 * i + 1] + w.wind[3 * i + 2] * p[3 * i + 2];
      expect(Math.abs(dot)).toBeLessThan(1e-3);
    }
    // Equator warmer than poles.
    let eq = 0, eqn = 0, po = 0, pon = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      const a = Math.abs(w.mesh.lat[i]) * 57.3;
      if (a < 10) { eq += w.temperature[i]; eqn++; }
      if (a > 70) { po += w.temperature[i]; pon++; }
    }
    expect(eq / eqn).toBeGreaterThan(po / pon + 25);
  });

  it("travel costs behave", () => {
    const w = get(seed);
    let landPairs = 0, seaPairs = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      for (let k = w.mesh.adjStart[i]; k < w.mesh.adjStart[i + 1]; k++) {
        const j = w.mesh.adj[k];
        const d = cellDistanceKm(w, i, j);
        expect(d).toBeGreaterThan(0);
        const landI = w.isLand[i] && w.lakeId[i] < 0, landJ = w.isLand[j] && w.lakeId[j] < 0;
        const lc = landMoveCost(w, i, j), sc = seaMoveCost(w, i, j);
        if (landI && landJ) {
          expect(Number.isFinite(lc)).toBe(true);
          expect(lc).toBeGreaterThan(0);
          expect(sc).toBe(Infinity);
          landPairs++;
        } else {
          expect(lc).toBe(Infinity);
          expect(Number.isFinite(sc)).toBe(true);
          expect(sc).toBeGreaterThan(0);
          seaPairs++;
        }
      }
    }
    expect(landPairs).toBeGreaterThan(0);
    expect(seaPairs).toBeGreaterThan(0);
  });
});

describe("geo: parameters", () => {
  it("respects a different ocean fraction and an ice-age offset", () => {
    const w = make("params", { oceanFraction: 0.5, temperatureOffset: -8 });
    let ocean = 0, tot = 0, ice = 0, land = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      tot += w.mesh.area[i];
      if (!w.isLand[i]) ocean += w.mesh.area[i];
      else { land++; if (w.biome[i] === Biome.IceSheet) ice++; }
    }
    expect(Math.abs(ocean / tot - 0.5)).toBeLessThan(0.01);
    const warm = get("alpha");
    let iceWarm = 0, landWarm = 0;
    for (let i = 0; i < warm.mesh.n; i++) if (warm.isLand[i]) { landWarm++; if (warm.biome[i] === Biome.IceSheet) iceWarm++; }
    expect(ice / land).toBeGreaterThan(iceWarm / landWarm);
  });
});
