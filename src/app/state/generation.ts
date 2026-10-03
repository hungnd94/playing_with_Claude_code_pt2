/**
 * Drives the two generation workers (see ../protocol.ts) and feeds the store.
 */
import type { FromWorker, ToWorker } from "../protocol";
import { app } from "./app";
import { createNarrative } from "../engine/narrative";
import { startReplay, finishGenesis } from "./playback";

declare const __WORKER_SOURCE__: string;

let workerUrl: string | null = null;
let gen: Worker | null = null;
let baker: Worker | null = null;
let job = 0;
let t0 = 0;
let tickerKey = 0;

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
  const q = queryParam("bake");
  if (q === "2048") return [2048];
  if (q === "4096") return [2048, 4096];
  return big >= 1400 && mem >= 4 && cores >= 4 ? [2048, 4096] : [2048];
}

function queryParam(k: string): string | null {
  try {
    return new URLSearchParams(location.search).get(k);
  } catch {
    return null;
  }
}

export function generate(seed: string): void {
  gen?.terminate();
  baker?.terminate();
  gen = baker = null;
  job++;
  const my = job;
  t0 = performance.now();
  app.set({
    seed, phase: "physical", stage: "mesh", stageFraction: 0, error: null, world: null, history: null, narrative: null,
    baked: null, bakedWidth: 0, live: null, genesis: true, replay: false, liveSeen: false, stages: [], ticker: [],
    year: 0, playing: false, focus: null, hover: null, pickedCell: -1,
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
    if (my !== job) return;
    app.set({ phase: "error", error: e.message || "The generation worker failed." });
  };
  gen.onmessage = onMsg;
  baker.onmessage = onMsg;
  gen.onerror = onErr;
  baker.onerror = onErr;
  const engine = queryParam("history");
  const msg: ToWorker = { type: "generate", job: my, seed, engine: engine === "sim" || engine === "mock" ? engine : undefined };
  gen.postMessage(msg);
}

function timing(k: string, ms: number): void {
  app.set((s) => ({ timings: { ...s.timings, [k]: Math.round(ms) } }));
}

function handle(m: FromWorker): void {
  switch (m.type) {
    case "stage": {
      const s = app.get();
      const last = s.stages[s.stages.length - 1];
      const stages = last && last.stage === m.stage && last.phase === m.phase ? s.stages : [...s.stages, { phase: m.phase, stage: m.stage, t: performance.now() - t0 }];
      app.set({ stage: m.stage, stageFraction: m.fraction, stages, phase: s.phase === "ready" ? "ready" : m.phase });
      break;
    }
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
    case "live": {
      const s = app.get();
      const add = m.snap.events
        .filter((e) => e.event.importance >= 3)
        .map((e) => ({ key: ++tickerKey, year: e.event.year, text: e.headline }));
      const ticker = add.length ? [...s.ticker, ...add].slice(-8) : s.ticker;
      app.set({ live: m.snap, year: m.snap.year, liveSeen: true, ticker });
      break;
    }
    case "history": {
      timing("history", m.ms);
      timing("total", performance.now() - t0);
      const s = app.get();
      let narrative = null;
      try {
        narrative = s.world ? createNarrative(s.world, m.history) : null;
      } catch (e) {
        console.error("narrative failed", e);
      }
      app.set({ history: m.history, historySource: m.source, narrative, phase: "ready", live: null });
      gen?.terminate();
      gen = null;
      if (s.genesis && !s.liveSeen) startReplay();
      else finishGenesis();
      break;
    }
    case "error":
      console.error(`[worker:${m.where}]`, m.message);
      app.set({ phase: "error", error: `${m.where}: ${m.message.split("\n")[0]}` });
      break;
  }
}

/** Ticker entries for the replay, fed by the playback loop. */
export function pushTicker(items: { year: number; text: string }[]): void {
  if (!items.length) return;
  app.set((s) => ({ ticker: [...s.ticker, ...items.map((i) => ({ key: ++tickerKey, ...i }))].slice(-8) }));
}
