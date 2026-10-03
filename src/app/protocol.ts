/**
 * Messages between the UI thread and the generation workers.
 *
 * Two instances of the same worker bundle run side by side:
 *  - the "gen" worker builds the physical world, posts it, then simulates history;
 *  - the "bake" worker receives the physical world and bakes globe textures
 *    (fast 2048 first, then a 4096 refinement on capable devices),
 * so the globe appears while history is still being simulated.
 */
import type { PhysicalWorld, WorldParams } from "../world/types";
import type { History, LiveSnapshot } from "../history/types";
import type { BakedGlobe } from "../render/bake/index";

export type ToWorker =
  | { type: "generate"; job: number; seed: string; params?: Partial<WorldParams>; engine?: "sim" | "mock" }
  | { type: "bake"; job: number; world: PhysicalWorld; widths: number[] };

export type FromWorker =
  | { type: "stage"; job: number; phase: "physical" | "history"; stage: string; fraction: number; ms: number }
  | { type: "physical"; job: number; world: PhysicalWorld; ms: number }
  | { type: "live"; job: number; snap: LiveSnapshot }
  | { type: "history"; job: number; history: History; ms: number; source: string }
  | { type: "baked"; job: number; baked: BakedGlobe; width: number; ms: number }
  | { type: "error"; job: number; where: string; message: string };

/** Typed arrays reachable from `obj` (for transfer lists). Skips shared buffers twice. */
export function collectBuffers(obj: unknown, out: Set<ArrayBuffer> = new Set(), depth = 0): Set<ArrayBuffer> {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  if (ArrayBuffer.isView(obj)) {
    if (obj.buffer instanceof ArrayBuffer) out.add(obj.buffer);
    return out;
  }
  if (Array.isArray(obj)) {
    // Arrays of plain objects can be huge (persons, events): only descend into arrays of typed arrays.
    if (obj.length && ArrayBuffer.isView(obj[0])) for (const v of obj) collectBuffers(v, out, depth + 1);
    return out;
  }
  for (const k of Object.keys(obj)) collectBuffers((obj as Record<string, unknown>)[k], out, depth + 1);
  return out;
}

/** Physical stage keys → genesis captions (small caps in the UI). */
export const STAGE_CAPTIONS: Record<string, string> = {
  mesh: "The sphere is divided",
  plates: "Plates drift",
  elevation: "Mountains rise",
  erosion: "Rain wears the heights",
  "sea level": "The oceans fill",
  climate: "Winds and rain sweep the world",
  hydrology: "Rivers find the sea",
  biomes: "Forests and grasslands bloom",
  resources: "Ores and salt are laid down",
  features: "The land takes its shapes",
  done: "The world is made",
  // history (mock and real)
  "terrain costs": "Paths are worn",
  peoples: "The first peoples gather",
  tongues: "Tongues divide",
  letters: "Letters are invented",
  settlements: "Villages become towns",
  faiths: "Gods are named",
  realms: "Realms are founded",
  timeline: "Borders ebb and flow",
  dynasties: "Kings beget kings",
  wars: "Wars are fought",
  works: "Chronicles are written",
  names: "The land is named",
  ages: "The ages are reckoned",
};
