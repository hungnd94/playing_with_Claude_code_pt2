/**
 * Palimpsest history simulation — public entry point.
 *
 *   simulateHistory(world, rng, { years, onProgress, onSnapshot }) → History
 *
 * See docs/HISTORY.md for the design and ./types.ts for the output contract;
 * ./query.ts has the helpers consumers need (value at year, layer
 * reconstruction, names and titles at a year, …).
 */
import type { Rng } from "../core/rng";
import type { PhysicalWorld } from "../world/types";
import { Sim, SAMPLE_STEP, TIMELINE_STEP, type SimOptions } from "./sim";
import { initCultures } from "./cultures";
import { createFolkReligion } from "./folk";
import { seedHearth, tickDemography, tickExpansion } from "./settlements";
import { recomputeCatchments, refreshLayers, capitalDistances } from "./territory";
import { TimelineRecorder } from "./timeline";
import { sampleStats } from "./stats";
import { liveSnapshot } from "./live";
import { finalize } from "./finalize";
import type { History, LiveSnapshot } from "./types";

export type { History, LiveSnapshot };
export { TECH_LEVELS } from "./sim";

export interface SimulateOptions {
  years?: number;
  onProgress?: (year: number, fraction: number) => void;
  onSnapshot?: (snap: LiveSnapshot) => void;
}

/** Run the whole history. Deterministic in (world, rng). */
export function simulateHistory(world: PhysicalWorld, rng: Rng, opts: SimulateOptions = {}): History {
  return runSimulation(world, rng, opts).h;
}

/** Same as simulateHistory, but returns the Sim too (for tools: timings, debugging). */
export function runSimulation(world: PhysicalWorld, rng: Rng, opts: SimulateOptions = {}): Sim {
  const so: SimOptions = { years: opts.years ?? world.params.years ?? 3000, onProgress: opts.onProgress, onSnapshot: opts.onSnapshot };
  const sim = new Sim(world, rng.fork("history"), so);
  sim.time("init", () => init(sim));
  const tl = new TimelineRecorder(sim);
  for (let year = 0; year <= sim.endYear; year++) {
    sim.year = year;
    tick(sim);
    if (year % TIMELINE_STEP === 0) {
      sim.time("territory", () => {
        if (year % 10 === 0) recomputeCatchments(sim);
        refreshLayers(sim);
        capitalDistances(sim);
      });
      sim.time("timeline", () => tl.record());
    }
    if (year % SAMPLE_STEP === 0) sim.time("stats", () => sampleStats(sim));
    if (year % 10 === 0 && so.onSnapshot) so.onSnapshot(liveSnapshot(sim));
    if (so.onProgress && year % 25 === 0) so.onProgress(year, year / sim.endYear);
  }
  sim.time("finalize", () => finalize(sim));
  return sim;
}

function init(sim: Sim): void {
  const hearths = initCultures(sim);
  for (const h of hearths) seedHearth(sim, h.culture, h.cell);
  recomputeCatchments(sim);
  refreshLayers(sim);
  for (const C of sim.C) createFolkReligion(sim, C.id);
  for (const s of sim.S) {
    s.religion = sim.C[s.culture].folk;
    s.rec.religions = [{ year: 0, religion: s.religion }];
  }
}

function tick(sim: Sim): void {
  sim.time("demography", () => tickDemography(sim));
  sim.time("expansion", () => tickExpansion(sim));
}
