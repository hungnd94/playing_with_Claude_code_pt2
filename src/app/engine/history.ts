/**
 * The app's SINGLE import site for the history simulation.
 *
 * Uses src/history's `simulateHistory` when it is ready (SIM_READY, or forced
 * with `?history=sim`), validating its output and falling back to the
 * procedural stand-in in ../dev/mockHistory if it throws or produces an
 * unusable history. Everything else in the app talks to `runHistory` only.
 */
import { Rng } from "../../core/rng";
import type { PhysicalWorld } from "../../world/types";
import type { History, LiveSnapshot } from "../../history/types";
import { simulateHistory } from "../../history/index";
import { mockHistory } from "../dev/mockHistory";

/**
 * Flip to true when src/history/PROGRESS.md says "v1 works". Until then the
 * real engine only runs when forced (`?history=sim` on the page URL, or
 * `--engine=sim` in tools/app-mock.ts).
 */
export const SIM_READY = true;

export interface RunHistoryOptions {
  /** Force an engine; default: the simulation if SIM_READY, else the mock. */
  engine?: "sim" | "mock";
  onProgress?: (stage: string, fraction: number) => void;
  /** Live preview snapshots (only when the engine supports them). */
  onLive?: (snap: LiveSnapshot) => void;
}

export interface HistoryRun {
  history: History;
  source: "simulation" | "mock";
  /** Why the simulation was not used, if it was tried and rejected. */
  fallbackReason?: string;
}

/** Problems that make a history unusable for the UI (empty list = fine). */
export function validateHistory(h: History): string[] {
  const bad: string[] = [];
  if (!h || typeof h !== "object") return ["no history object"];
  if (!(h.endYear > 0)) bad.push("endYear");
  if (!h.timeline || !(h.timeline.snapshots > 0) || !h.timeline.owner?.keyframes?.length) bad.push("timeline");
  if (!h.cultures?.length) bad.push("cultures");
  if (!h.languages?.length) bad.push("languages");
  if (!h.settlements?.length) bad.push("settlements");
  if (!h.polities?.length) bad.push("polities");
  if (!h.events || h.events.length < 50) bad.push("events");
  if (!Array.isArray(h.ages)) bad.push("ages");
  if (!h.worldStats?.pop) bad.push("worldStats");
  for (const k of ["persons", "dynasties", "religions", "deities", "myths", "wars", "battles", "wonders", "works", "tradeRoutes", "disasters", "featureNames", "scripts"] as const) {
    if (!Array.isArray(h[k])) bad.push(k);
  }
  return bad;
}

export function runHistory(world: PhysicalWorld, opts: RunHistoryOptions = {}): HistoryRun {
  const useSim = opts.engine === "sim" || (opts.engine !== "mock" && SIM_READY);
  let reason: string | undefined;
  if (useSim) {
    try {
      const h = simulateHistory(world, new Rng(world.params.seed), {
        years: world.params.years,
        onProgress: (_year, fraction) => opts.onProgress?.("history", fraction),
        onSnapshot: opts.onLive,
      });
      fillDefaults(h);
      const bad = validateHistory(h);
      if (!bad.length) return { history: h, source: "simulation" };
      reason = `simulation output incomplete: ${bad.join(", ")}`;
    } catch (e) {
      reason = `simulation threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    console.warn(`[history] ${reason} — using the stand-in`);
  }
  const history = mockHistory(world, { onProgress: opts.onProgress });
  return { history, source: "mock", fallbackReason: reason };
}

/** Tolerate optional arrays a work-in-progress simulation may leave undefined. */
function fillDefaults(h: History): void {
  const r = h as unknown as Record<string, unknown>;
  for (const k of ["persons", "dynasties", "religions", "deities", "myths", "wars", "battles", "wonders", "works", "tradeRoutes", "disasters", "featureNames", "scripts", "ages"]) {
    if (!Array.isArray(r[k])) r[k] = [];
  }
}
