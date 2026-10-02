/**
 * Heraldry data model.
 *
 * Everything here is plain, JSON-serialisable data: arms are generated inside
 * the Web Worker and rendered on the UI thread, so no functions, classes or
 * cyclic references are allowed in these types.
 */
import type { EmblemConcept, Tincture } from "../world/concepts";

export type { Tincture, EmblemConcept };

/** Furs: patterned "tinctures" that are neither metal nor colour. */
export const FURS = ["ermine", "ermines", "erminois", "pean", "vair", "countervair", "potent"] as const;
export type Fur = (typeof FURS)[number];

/** Anything a surface can be painted with. */
export type Tint = Tincture | Fur;

/** Lines of partition, used for divisions of the field and the edges of ordinaries. */
export const LINES = [
  "straight", "wavy", "indented", "dancetty", "embattled", "engrailed", "invected", "nebuly", "raguly", "dovetailed",
] as const;
export type Line = (typeof LINES)[number];

/** How the field is divided or varied. */
export const PARTITIONS = [
  "plain",
  // divisions (two tinctures unless noted)
  "perPale", "perFess", "perBend", "perBendSinister", "perChevron", "perSaltire", "quarterly",
  "gyronny", "perPall", /* 3 tinctures */ "tiercedInPale", /* 3 */ "tiercedInFess" /* 3 */,
  // variations (repeating patterns of two tinctures)
  "paly", "barry", "bendy", "bendySinister", "chequy", "lozengy", "chevronny",
] as const;
export type Partition = (typeof PARTITIONS)[number];

export interface Field {
  partition: Partition;
  /** 1 tincture for plain, 3 for perPall/tierced*, otherwise 2. First-named first. */
  tinctures: Tint[];
  line?: Line;
  /** Number of pieces for paly/barry/bendy/chevronny/gyronny; squares across for chequy/lozengy. */
  count?: number;
}

/** The honourable ordinaries and their diminutives that can stand as the principal charge. */
export const ORDINARIES = [
  "fess", "pale", "bend", "bendSinister", "chevron", "cross", "saltire", "pall", "pile", "orle", "fret",
  "chevronReversed", "pallReversed", "base",
] as const;
export type OrdinaryKind = (typeof ORDINARIES)[number];

export interface Ordinary {
  kind: OrdinaryKind;
  tincture: Tint;
  line?: Line;
  /**
   * More than one: diminutives — bars (fess), pallets (pale), bendlets (bend),
   * chevronels (chevron), piles (pile). Default 1.
   */
  count?: number;
  /** Fess, pale or bend between two narrow cotises of the same tincture. */
  cotised?: boolean;
  /** On a divided field: takes the opposite tincture on each part (tincture is then ignored). */
  counterchanged?: boolean;
  /** Charges lying on the ordinary ("on a fess Sable three mullets Or"). */
  charges?: ChargeGroup;
}

/** Charges that are not drawn from the emblem concepts but are classic heraldic charges. */
export const CLASSIC_CHARGES = [
  "mullet", "crescent", "roundel", "annulet", "lozenge", "fusil", "mascle", "billet", "fleurDeLis",
  "crossPatty", "crossMoline", "crossCrosslet", "crossPotent", "crossFlory", "crossCouped", "escallop", "martlet",
  "cinquefoil", "quatrefoil", "trefoil", "pheon", "escutcheon", "goutte",
] as const;
export type ClassicCharge = (typeof CLASSIC_CHARGES)[number];
export type ChargeId = EmblemConcept | ClassicCharge;

/** Placement of several charges of one kind. "auto" picks the conventional default for the count. */
export const ARRANGEMENTS = [
  "auto", "pale", "fess", "bend", "bendSinister", "twoOne", "oneTwo", "twoTwo", "saltire", "cross", "orle",
  "threeTwoOne", "chief", "crossed",
] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

/**
 * Postures of beasts and birds. Each charge supports a few (see `chargeInfo(id).attitudes`);
 * the first one listed is its default and is used when `attitude` is absent.
 */
export const ATTITUDES = [
  "rampant", "passant", "salient", "statant", "trippant", "displayed", "close", "rising", "naiant", "hauriant",
  "nowed", "volant",
] as const;
export type Attitude = (typeof ATTITUDES)[number];

export interface ChargeGroup {
  charge: ChargeId;
  count: number;
  arrangement?: Arrangement;
  tincture: Tint;
  attitude?: Attitude;
  /**
   * Beasts' claws/tongue, birds' beak/legs, deer's antlers, bull's horns, boar's tusks.
   * Blazoned as "armed and langued", "beaked and membered", "attired", "armed".
   * When absent the renderer uses the convention (Gules, or Azure on Gules).
   */
  armed?: Tint;
  /** A crown on the head (lions, eagles). */
  crowned?: Tint;
  /** Facing sinister (contourné). With two charges in fess, "respectant". */
  reversed?: boolean;
  /** Turned upside-down ("reversed" for a crescent, "inverted" for a sword point downward). */
  inverted?: boolean;
  /** Mullets and estoiles: number of points (default 5 for mullets, 6 for estoiles). */
  points?: number;
  /** Mullet pierced (a round hole in the middle). */
  pierced?: boolean;
  /** Takes the opposite tincture on each part of a divided field (tincture is then the first part's). */
  counterchanged?: boolean;
}

export interface Chief {
  tincture: Tint;
  line?: Line;
  charges?: ChargeGroup;
}

export interface Bordure {
  tincture: Tint;
  line?: Line;
  /** Bordure compony: alternating segments of `tincture` and this tincture. */
  compony?: Tint;
  charges?: ChargeGroup;
}

export interface Canton {
  tincture: Tint;
  charge?: ChargeGroup;
  /** A canton sinister (in the sinister chief). Default dexter. */
  sinister?: boolean;
}

/** Marks of cadency and other brisures used to difference the arms of cadet branches. */
export const CADENCY_MARKS = [
  "label", "crescent", "mullet", "martlet", "annulet", "fleurDeLis", "rose", "crossMoline", "quatrefoil", "bendlet",
] as const;
export type CadencyMark = (typeof CADENCY_MARKS)[number];

export interface Difference {
  mark: CadencyMark;
  tincture: Tint;
  /** Points of a label (3 or 5). */
  points?: number;
}

/** A single (unmarshalled) coat. */
export interface SimpleArms {
  kind: "simple";
  field: Field;
  /** The field strewn ("semy") with small charges. */
  semy?: { charge: ChargeId; tincture: Tint };
  ordinary?: Ordinary;
  /** Principal charges on the field: alone, or set around the ordinary ("between"). */
  charges?: ChargeGroup;
  /** Charges accompanying a central charge when there is no ordinary ("a lion between three crosslets"). */
  secondary?: ChargeGroup;
  chief?: Chief;
  bordure?: Bordure;
  canton?: Canton;
  difference?: Difference[];
  /** Set when the coat deliberately breaks the rule of tincture ("arms of enquiry"). */
  exception?: string;
}

export const MARSHALLING = ["quarterly", "impaled", "perFess"] as const;
export type MarshallingMethod = (typeof MARSHALLING)[number];

/** Several coats combined on one shield. */
export interface MarshalledArms {
  kind: "marshalled";
  method: MarshallingMethod;
  /** quarterly: exactly 4 (1, 2, 3, 4 — repeats allowed); impaled/perFess: 2. */
  coats: Arms[];
  /** An escutcheon of pretence set over all. */
  escutcheon?: Arms;
  difference?: Difference[];
}

export type Arms = SimpleArms | MarshalledArms;

/** Shield outlines. */
export const SHIELD_SHAPES = ["heater", "french", "iberian", "oval", "lozenge", "round", "german", "swiss", "square", "banner"] as const;
export type ShieldShape = (typeof SHIELD_SHAPES)[number];
