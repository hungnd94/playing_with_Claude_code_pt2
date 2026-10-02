/**
 * Concepts shared between subsystems.
 *
 * Emblem concepts are things that can appear both as words in a language's
 * lexicon (so names can mean "Wolf Ford" or "Red Tower") and as charges in
 * heraldry (so a house named "Wolf-spear" can bear a canting wolf). The
 * language engine must have a word for every one of these, and the heraldry
 * engine must be able to draw every one of these.
 */
export const EMBLEM_CONCEPTS = [
  // beasts
  "wolf", "bear", "lion", "eagle", "raven", "falcon", "owl", "swan", "stag", "boar",
  "horse", "bull", "serpent", "dragon", "fish",
  // heavens & elements
  "sun", "moon", "star", "flame", "lightning", "wave", "mountain",
  // plants
  "tree", "oak", "pine", "rose", "wheat",
  // works of hands
  "tower", "castle", "bridge", "key", "sword", "spear", "axe", "crown", "wheel",
  "ship", "horn", "hammer", "anchor", "bell", "cup",
  // the body
  "hand", "heart", "eye", "feather",
] as const;

export type EmblemConcept = (typeof EMBLEM_CONCEPTS)[number];

/** Heraldic colours. Metals: or, argent. Colours: the rest. (Furs are handled inside heraldry.) */
export const TINCTURES = ["or", "argent", "gules", "azure", "vert", "purpure", "sable", "tenne", "sanguine"] as const;
export type Tincture = (typeof TINCTURES)[number];
export const METALS: readonly Tincture[] = ["or", "argent"];
