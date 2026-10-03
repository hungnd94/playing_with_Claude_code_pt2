/** Access to the (single) globe controller from anywhere in the UI. */
import type { Ref } from "../../../narrative/types";
import type { StageController } from "./controller";

let ctl: StageController | null = null;

export function setStageController(c: StageController | null): void {
  ctl = c;
}

export function stageController(): StageController | null {
  return ctl;
}

/** Hovering a link: ping the entity on the globe (null to stop). */
export function pingRef(ref: Ref | null): void {
  ctl?.ping(ref);
}
