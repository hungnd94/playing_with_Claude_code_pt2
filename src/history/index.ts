/**
 * Palimpsest history simulation — public entry point.
 *
 *   simulateHistory(world, rng, { years, onProgress, onSnapshot }) → History
 *
 * See docs/HISTORY.md for the design and ./types.ts for the output contract;
 * ./query.ts has the helpers consumers need (value at year, layer
 * reconstruction, names and titles at a year, …).
 *
 * Yearly tick order (systems are plain functions over a `Sim`):
 *   climate & disasters → demography → people (births, deaths, successions)
 *   → realms (membership, formation, loyalty, revolts, collapse)
 *   → diplomacy (war declarations, alliances) → war (battles, sieges, peace,
 *   raids, migrations) → technology & writing → religion → trade
 *   → wonders & works → expansion (new towns) → divergence (peoples,
 *   languages, names; every 25 years) → territory & timeline (every 5 years).
 */
import type { Rng } from "../core/rng";
import type { PhysicalWorld } from "../world/types";
import { Sim, SAMPLE_STEP, TIMELINE_STEP, type SimOptions } from "./sim";
import { initCultures } from "./cultures";
import { createFolkReligion } from "./folk";
import { seedHearth, tickDemography, tickExpansion } from "./settlements";
import { recomputeCatchments, refreshLayers, refreshAdjacency, capitalDistances } from "./territory";
import { TimelineRecorder } from "./timeline";
import { sampleStats } from "./stats";
import { liveSnapshot } from "./live";
import { finalize } from "./finalize";
import { tickPeople } from "./people";
import { computeProvinces, tickPolities } from "./polities";
import { tickDiplomacy, tickWar } from "./war";
import { cultureAggregates, tickTech } from "./tech";
import { initClimate, tickDisasters } from "./disasters";
import { tickReligion } from "./religion";
import { tickTrade } from "./trade";
import { tickWorks } from "./wonders";
import { tickDivergence } from "./divergence";
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
      // Catchments follow new and lost towns; once the land is full they change slowly.
      if (year % 10 === 0 && (year < 1000 || sim.setChanges >= 30 || year - sim.lastCatchments >= 40)) {
        sim.time("catchments", () => recomputeCatchments(sim));
        sim.setChanges = 0;
        sim.lastCatchments = year;
      }
      sim.time("layers", () => refreshLayers(sim));
      if (year % 10 === 0) {
        sim.time("adjacency", () => refreshAdjacency(sim));
        if (year % 20 === 0) sim.time("capdist", () => capitalDistances(sim));
        sim.time("provinces", () => computeProvinces(sim));
      }
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
  refreshAdjacency(sim);
  for (const C of sim.C) createFolkReligion(sim, C.id);
  for (const s of sim.S) {
    s.religion = sim.C[s.culture].folk;
    s.rec.religions = [{ year: 0, religion: s.religion }];
  }
  cultureAggregates(sim);
  initClimate(sim);
}

function tick(sim: Sim): void {
  runAgenda(sim);
  sim.time("disasters", () => tickDisasters(sim));
  sim.time("demography", () => tickDemography(sim));
  sim.time("people", () => tickPeople(sim));
  sim.time("polities", () => tickPolities(sim));
  sim.time("diplomacy", () => tickDiplomacy(sim));
  sim.time("war", () => tickWar(sim));
  sim.time("tech", () => tickTech(sim));
  sim.time("religion", () => tickReligion(sim));
  sim.time("trade", () => tickTrade(sim));
  sim.time("works", () => tickWorks(sim));
  sim.time("expansion", () => tickExpansion(sim));
  sim.time("divergence", () => tickDivergence(sim));
}

/** Deferred actions that have come due (in the order they were scheduled). */
function runAgenda(sim: Sim): void {
  if (!sim.agenda.length) return;
  const due = sim.agenda.filter((a) => a.year <= sim.year);
  if (!due.length) return;
  sim.agenda = sim.agenda.filter((a) => a.year > sim.year);
  for (const a of due) a.run();
}
