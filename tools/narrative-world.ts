/**
 * Load (or generate and cache) a complete World for the narrative tools.
 *
 * Generating a default world takes ~35 s (physical ~5 s, history ~30 s), so
 * the result is cached with v8 serialisation in out/narrative/cache/. The
 * cache key is the seed, the size parameters and a fingerprint of the
 * generator sources (mtime + size of every file under src/{core,world,geo,
 * lang,script,heraldry,history}); a stale cache is regenerated unless
 * `staleOk` is set.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { simulateHistory } from "../src/history/index";
import { DEFAULT_PARAMS } from "../src/world/types";
import type { World } from "../src/world/world";

function fingerprint(): string {
  const dirs = ["core", "world", "geo", "lang", "script", "heraldry", "history"].map((d) => join("src", d));
  let h = 2166136261;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  };
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (f.endsWith(".ts")) mix(`${p}:${st.size}:${Math.floor(st.mtimeMs)}`);
    }
  };
  for (const d of dirs) walk(d);
  return h.toString(36);
}

export interface LoadOptions {
  cells?: number;
  years?: number;
  fresh?: boolean;
  staleOk?: boolean;
  log?: (s: string) => void;
}

export function loadWorld(seed: string, o: LoadOptions = {}): World {
  const cells = o.cells ?? DEFAULT_PARAMS.cells;
  const years = o.years ?? DEFAULT_PARAMS.years;
  const log = o.log ?? ((s: string) => console.error(s));
  const dir = "out/narrative/cache";
  mkdirSync(dir, { recursive: true });
  const base = `${dir}/${seed.replace(/[^a-z0-9_-]/gi, "_")}-${cells}-${years}`;
  const fp = fingerprint();
  if (!o.fresh && existsSync(base + ".bin") && existsSync(base + ".key")) {
    const key = readFileSync(base + ".key", "utf8");
    if (key === fp || o.staleOk) {
      const t = performance.now();
      const w = deserialize(readFileSync(base + ".bin")) as World;
      log(`loaded cached world "${seed}" (${key === fp ? "fresh" : "STALE"}) in ${((performance.now() - t) / 1000).toFixed(1)} s`);
      return w;
    }
    log(`cache for "${seed}" is stale; regenerating`);
  }
  const t0 = performance.now();
  const params = { ...DEFAULT_PARAMS, seed, cells, years };
  const physical = generatePhysical(params, new Rng(seed));
  const t1 = performance.now();
  const history = simulateHistory(physical, new Rng(seed), { years });
  const t2 = performance.now();
  log(`generated "${seed}": physical ${((t1 - t0) / 1000).toFixed(1)} s, history ${((t2 - t1) / 1000).toFixed(1)} s`);
  const world: World = { seed, params, physical, history };
  writeFileSync(base + ".bin", serialize(world));
  writeFileSync(base + ".key", fp);
  return world;
}
