/**
 * Generation worker (bundled separately and started from a Blob URL).
 * See protocol.ts for the message flow. DOM-free.
 */
import { Rng } from "../core/rng";
import { generatePhysical } from "../geo/index";
import { DEFAULT_PARAMS, type WorldParams } from "../world/types";
import { bakeGlobe, bakedTransferables } from "../render/bake/index";
import { runHistory } from "./engine/history";
import { collectBuffers, type FromWorker, type ToWorker } from "./protocol";

const ctx = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const post = (m: FromWorker, transfer: Transferable[] = []): void => ctx.postMessage(m, transfer);

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "generate") generate(m.job, m.seed, m.params ?? {}, m.engine);
  else if (m.type === "bake") bake(m.job, m.world, m.widths);
};

function generate(job: number, seed: string, over: Partial<WorldParams>, engine?: "sim" | "mock"): void {
  const params: WorldParams = { ...DEFAULT_PARAMS, ...over, seed };
  let where = "physical";
  try {
    const t0 = performance.now();
    const world = generatePhysical(params, new Rng(seed), (stage, fraction) => {
      post({ type: "stage", job, phase: "physical", stage, fraction, ms: performance.now() - t0 });
    });
    // Copy (not transfer): the worker keeps using the world for history.
    post({ type: "physical", job, world, ms: performance.now() - t0 });
    where = "history";
    const t1 = performance.now();
    let lastStage = "";
    let lastT = 0;
    const { history, source } = runHistory(world, {
      engine,
      onProgress: (stage, fraction) => {
        const now = performance.now();
        if (stage !== lastStage || now - lastT > 80) {
          post({ type: "stage", job, phase: "history", stage, fraction, ms: now - t0 });
          lastStage = stage;
          lastT = now;
        }
      },
      onLive: (snap) => post({ type: "live", job, snap }, [snap.owner.buffer as ArrayBuffer]),
    });
    const ms = performance.now() - t1;
    const transfer = [...collectBuffers(history.timeline)];
    post({ type: "history", job, history, ms, source }, transfer);
  } catch (err) {
    post({ type: "error", job, where, message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) });
  }
}

function bake(job: number, world: import("../world/types").PhysicalWorld, widths: number[]): void {
  try {
    for (const width of widths) {
      const t0 = performance.now();
      const baked = bakeGlobe(world, { width });
      post({ type: "baked", job, baked, width, ms: performance.now() - t0 }, bakedTransferables(baked));
    }
  } catch (err) {
    post({ type: "error", job, where: "bake", message: err instanceof Error ? err.message : String(err) });
  }
}
