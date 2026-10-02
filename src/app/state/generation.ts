/**
 * Drives the two generation workers (see ../protocol.ts) and feeds the store.
 */
import type { FromWorker, ToWorker } from "../protocol";
import { app } from "./app";
import { createNarrative } from "../engine/narrative";

declare const __WORKER_SOURCE__: string;

let workerUrl: string | null = null;
let gen: Worker | null = null;
let baker: Worker | null = null;
let job = 0;
let t0 = 0;

function spawn(): Worker {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: "text/javascript" }));
  return new Worker(workerUrl);
}

/** Texture widths to bake: a fast 2048 first, then 4096 on capable devices. */
function bakeWidths(): number[] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const big = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1);
  const mem = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 4;
  return big >= 1400 && mem >= 4 && cores >= 4 ? [2048, 4096] : [2048];
}

export function generate(seed: string): void {
  gen?.terminate();
  baker?.terminate();
  job++;
  const my = job;
  t0 = performance.now();
  app.set({
    seed, phase: "physical", stage: "mesh", stageFraction: 0, error: null, world: null, history: null, narrative: null,
    baked: null, bakedWidth: 0, live: null, genesis: true, year: 0, playing: false, focus: null, hover: null, pickedCell: -1,
    nav: { stack: [{ tab: "world" }], index: 0 }, timings: {},
  });
  try {
    gen = spawn();
    baker = spawn();
  } catch (e) {
    app.set({ phase: "error", error: `Could not start the generation worker: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  const onMsg = (e: MessageEvent<FromWorker>): void => {
    const m = e.data;
    if (m.job !== my) return;
    handle(m);
  };
  const onErr = (e: ErrorEvent): void => {
    app.set({ phase: "error", error: e.message || "The generation worker failed." });
  };
  gen.onmessage = onMsg;
  baker.onmessage = onMsg;
  gen.onerror = onErr;
  baker.onerror = onErr;
  const msg: ToWorker = { type: "generate", job: my, seed };
  gen.postMessage(msg);
}

function timing(k: string, ms: number): void {
  app.set((s) => ({ timings: { ...s.timings, [k]: Math.round(ms) } }));
}

function handle(m: FromWorker): void {
  switch (m.type) {
    case "stage":
      app.set({ stage: m.stage, stageFraction: m.fraction, phase: app.get().phase === "ready" ? "ready" : m.phase });
      break;
    case "physical": {
      timing("physical", m.ms);
      app.set({ world: m.world, phase: "history", stage: "peoples", stageFraction: 0 });
      const msg: ToWorker = { type: "bake", job: m.job, world: m.world, widths: bakeWidths() };
      baker?.postMessage(msg);
      break;
    }
    case "baked":
      timing(`bake${m.width}`, m.ms);
      app.set({ baked: m.baked, bakedWidth: m.width });
      if (m.width >= 4096 || bakeWidths().length === 1) {
        baker?.terminate();
        baker = null;
      }
      break;
    case "live":
      app.set({ live: m.snap, year: m.snap.year });
      break;
    case "history": {
      timing("history", m.ms);
      timing("total", performance.now() - t0);
      const s = app.get();
      const narrative = s.world ? createNarrative(s.world, m.history) : null;
      app.set({ history: m.history, historySource: m.source, narrative, phase: "ready", live: null });
      gen?.terminate();
      gen = null;
      break;
    }
    case "error":
      console.error(`[worker:${m.where}]`, m.message);
      app.set({ phase: "error", error: `${m.where}: ${m.message.split("\n")[0]}` });
      break;
  }
}
