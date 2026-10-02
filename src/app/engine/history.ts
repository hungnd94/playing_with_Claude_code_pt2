/**
 * The app's SINGLE import site for the history simulation.
 *
 * src/history (simulateHistory) is still being written; until it lands this
 * re-exports the procedural stand-in from ../dev/mockHistory. To switch:
 *
 *   import { simulateHistory } from "../../history";
 *   export const HISTORY_SOURCE = "simulation";
 *   export function runHistory(world, opts) { return simulateHistory(world, …, opts) }
 *
 * Everything else in the app talks to `runHistory` only.
 */
import type { PhysicalWorld } from "../../world/types";
import type { History, LiveSnapshot } from "../../history/types";
import { mockHistory } from "../dev/mockHistory";

export const HISTORY_SOURCE: "simulation" | "mock" = "mock";

export interface RunHistoryOptions {
  onProgress?: (stage: string, fraction: number) => void;
  /** Live preview snapshots (only when the engine supports them). */
  onLive?: (snap: LiveSnapshot) => void;
}

export function runHistory(world: PhysicalWorld, opts: RunHistoryOptions = {}): History {
  return mockHistory(world, { onProgress: opts.onProgress });
}
