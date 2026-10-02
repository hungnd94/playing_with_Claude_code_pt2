/**
 * The app's single import site for src/heraldry (which has no index.ts yet).
 * Generation-side helpers only (used by the worker's mock history); SVG
 * rendering for the UI lives in ../ui/emblem.ts.
 */
export { generateArms } from "../../heraldry/generate";
export { blazon } from "../../heraldry/blazon";
export { cantingCharges, differenceArms } from "../../heraldry/cadency";
export type { Arms } from "../../heraldry/types";
export type { StyleName } from "../../heraldry/styles";
