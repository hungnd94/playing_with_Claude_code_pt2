/**
 * Dev-harness worker: generates a world (real `generatePhysical` if requested
 * and available, else the mock) and bakes the globe textures, exactly as the
 * app's generation worker would.
 */
import { Rng } from "../src/core/rng";
import { bakeGlobe, bakedTransferables } from "../src/render/bake/index";
import { DEFAULT_PARAMS, type PhysicalWorld } from "../src/world/types";
import { makeMockWorld } from "./mock-world";
// Resolved by the build script to src/geo/index.ts when it exists, else to a stub.
import * as geo from "virtual:geo";

interface Req {
  seed: string;
  cells: number;
  width: number;
  real: boolean;
}

function validWorld(w: PhysicalWorld | null | undefined): w is PhysicalWorld {
  if (!w || !w.mesh) return false;
  const n = w.mesh.n;
  const need = ["elevation", "isLand", "temperature", "precipitation", "downstream", "flow", "riverOrder", "lakeId", "biome"] as const;
  return need.every((k) => (w as unknown as Record<string, { length: number }>)[k]?.length === n) && Array.isArray(w.lakes);
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { seed, cells, width, real } = e.data;
  const post = (m: unknown, t?: Transferable[]): void => (self as unknown as Worker).postMessage(m, t ?? []);
  const t0 = performance.now();
  let world: PhysicalWorld | null = null;
  let source = "mock";
  const gen = (geo as { generatePhysical?: (p: unknown, r: Rng, cb?: (s: string, f: number) => void) => PhysicalWorld }).generatePhysical;
  if (real && gen) {
    try {
      world = gen({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed), (stage, f) => post({ type: "progress", stage, f }));
      if (validWorld(world)) source = "real";
      else {
        post({ type: "log", msg: "real world incomplete; falling back to mock" });
        world = null;
      }
    } catch (err) {
      post({ type: "log", msg: "generatePhysical failed: " + String(err) });
      world = null;
    }
  }
  if (!world) world = makeMockWorld(seed, cells);
  const t1 = performance.now();
  post({ type: "progress", stage: "baking textures", f: 0.9 });
  const baked = bakeGlobe(world, { width });
  const t2 = performance.now();
  post(
    { type: "done", world, baked, source, timings: { world: t1 - t0, bake: t2 - t1 } },
    bakedTransferables(baked),
  );
};
