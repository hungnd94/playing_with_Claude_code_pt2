/** Named ages of world history, derived after the run. */
import type { Sim } from "./sim";
import type { History } from "./types";

export function deriveAges(sim: Sim): History["ages"] {
  return [{ name: "the Age of Founding", start: 0, end: sim.endYear, summary: "" }];
}
