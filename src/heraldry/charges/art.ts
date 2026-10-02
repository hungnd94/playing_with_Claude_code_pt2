/**
 * Charge artwork contract.
 *
 * A charge is drawn as a list of layers in its own local coordinate frame
 * (roughly 0..100). Within each `body`/`accent` layer, all subpaths are first
 * stroked with the contour colour and then filled, so overlapping primitives
 * (a torso, a neck, a limb) fuse into one silhouette with a single clean
 * outline. Successive layers stack, so far-side limbs drawn in an earlier layer
 * are separated from the body by the body's outline — exactly how heraldic
 * painters draw beasts.
 */
import type { Attitude, Tint } from "../types";
import type { BBox } from "../path";

export type LayerRole =
  /** Filled with the charge's tincture, outlined. */
  | "body"
  /** Filled with the "armed" tincture (claws, tongue, beak, horns, antlers), outlined. */
  | "accent"
  /** Filled with the crown tincture (default Or), outlined. */
  | "crown"
  /** Filled with the contour colour (eyes, nostrils, windows). */
  | "ink"
  /** Stroked with the contour colour (internal detail lines). */
  | "line"
  /** Filled with a translucent light tone (highlights on metal-like parts). */
  | "shine"
  /** Filled with a translucent dark tone (shadowed recesses: open mouth, far wing). */
  | "shade";

export interface ArtLayer {
  role: LayerRole;
  d: string;
  /** Stroke width for "line" layers, in local units. Default 1.5. */
  w?: number;
  evenodd?: boolean;
  /** Skip the contour underlay for body/accent layers. */
  noOutline?: boolean;
}

export interface ChargeArt {
  layers: ArtLayer[];
  /** Override the computed bounding box (e.g. to keep visual centre). */
  box?: BBox;
}

export type ChargeCategory =
  | "beast" | "bird" | "monster" | "fish" | "celestial" | "nature" | "plant" | "object" | "building" | "weapon"
  | "geometric" | "cross" | "body";

export interface ArtOptions {
  attitude?: Attitude;
  points?: number;
  pierced?: boolean;
}

export interface ChargeDef {
  /** Blazon noun, singular ("lion", "fleur-de-lis", "cross crosslet"). */
  name: string;
  /** Blazon noun, plural ("lions", "fleurs-de-lis", "crosses crosslet"). */
  plural: string;
  category: ChargeCategory;
  /** Supported attitudes; the first is the default. Absent → not a creature. */
  attitudes?: Attitude[];
  /** Blazon phrase for the accent tincture ("armed and langued", "beaked and membered", "attired"). */
  armedTerm?: string;
  /**
   * Conventional tincture of accent parts when the blazon is silent: "gules" (beasts' claws
   * and tongues — Azure if that would clash), "or", "argent", or "same" as the body.
   */
  accentDefault?: Tint | "same";
  /** Symmetric about the vertical axis: reversing has no effect. */
  symmetric?: boolean;
  /** Can sensibly be drawn tilted (bendwise) or crossed in saltire. */
  long?: boolean;
  /** Commonness in real rolls of arms (relative weight for the generator). */
  weight: number;
  /** The artwork, possibly depending on attitude/points. Results are cached per option set. */
  art: (o: ArtOptions) => ChargeArt;
}
