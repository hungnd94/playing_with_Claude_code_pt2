/** The complete generated world, as held by the UI after generation. */
import type { PhysicalWorld, WorldParams } from "./types";
import type { History } from "../history/types";

export interface World {
  seed: string;
  params: WorldParams;
  physical: PhysicalWorld;
  /** Null while history is still being simulated. */
  history: History | null;
}
