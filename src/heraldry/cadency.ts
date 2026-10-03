/**
 * Differencing (cadet branches), marshalling (unions and marriages) and
 * canting (arms that pun on the bearer's name).
 */
import type { Rng } from "../core/rng";
import { EMBLEM_CONCEPTS, type EmblemConcept } from "../world/concepts";
import type { Arms, CadencyMark, Difference, Line, MarshalledArms, MarshallingMethod, SimpleArms, Tint } from "./types";
import { isFur, isMetal, readable, tinctureOk } from "./tinctures";
import { markSpot } from "./render";

export const DIFFERENCE_KINDS = ["auto", "label", "brisure", "bordure", "tincture", "line", "canton", "bendlet"] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];

/** The English cadency marks of the 2nd to 9th sons. */
export const CADENCY_ORDER: CadencyMark[] = ["crescent", "mullet", "martlet", "annulet", "fleurDeLis", "rose", "crossMoline", "quatrefoil"];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function topField(a: Arms): Tint[] {
  return a.kind === "simple" ? a.field.tinctures : topField(a.coats[0]);
}

function contrastAll(rng: Rng, unders: Tint[], avoid: Tint[] = []): Tint {
  const pool: Tint[] = ["or", "argent", "gules", "azure", "sable", "vert", "purpure"];
  const good = pool.filter((t) => !avoid.includes(t) && unders.every((u) => readable(t, u) && tinctureOk(t, u)));
  if (good.length) return rng.pick(good);
  const ok = pool.filter((t) => !avoid.includes(t) && readable(t, unders[0]));
  return ok.length ? rng.pick(ok) : "argent";
}

/**
 * Difference a coat for a cadet branch. `kind` picks the method; "auto"
 * chooses one in the proportions found in practice (labels for heirs,
 * bordures and brisures for younger sons, changes of tincture or line in
 * the older Scottish manner). `son` (2–9) selects the English cadency mark
 * for "brisure". Never mutates the input.
 */
export function differenceArms(arms: Arms, rng: Rng, kind: DifferenceKind = "auto", son?: number): Arms {
  let k = kind;
  if (k === "auto") {
    k = rng.weighted([
      ["label", 22], ["brisure", 22], ["bordure", 26], ["tincture", 10], ["line", arms.kind === "simple" && arms.ordinary ? 10 : 0],
      ["canton", 6], ["bendlet", 4],
    ] as [DifferenceKind, number][]);
  }
  const out = clone(arms);
  const under = topField(out);
  const addDiff = (d: Difference) => {
    out.difference = [...(out.difference ?? []), d];
  };
  if (out.kind === "marshalled" && (k === "tincture" || k === "line" || k === "canton" || k === "bordure")) k = "label";
  if (k === "label") {
    // A label lies across the top of the shield, on the chief if there is one.
    const top = out.kind === "simple" ? (out.chief ? [out.chief.tincture] : [out.field.tinctures[0]]) : under;
    addDiff({ mark: "label", tincture: contrastAll(rng, top, labelAvoid(out)), points: rng.chance(0.75) ? 3 : 5 });
    return out;
  }
  if (k === "brisure") {
    const n = son && son >= 2 && son <= 9 ? son : rng.int(2, 6);
    if (out.kind === "simple") {
      const spot = markSpot(out);
      addDiff({ mark: CADENCY_ORDER[n - 2], tincture: contrastAll(rng, spot.under, labelAvoid(out)), at: spot.at });
    } else addDiff({ mark: CADENCY_ORDER[n - 2], tincture: contrastAll(rng, under, labelAvoid(out)), at: "fess" });
    return out;
  }
  const a = out as SimpleArms;
  switch (k) {
    case "bordure": {
      if (a.bordure) {
        // Difference an existing bordure: engrail it, or make it compony.
        if (!a.bordure.line || a.bordure.line === "straight") a.bordure.line = rng.pick(["engrailed", "indented", "wavy"] as Line[]);
        else a.bordure.compony = contrastAll(rng, [a.bordure.tincture], [...under]);
      } else {
        a.bordure = { tincture: contrastAll(rng, under, chargeTints(a)) };
        const r = rng.next();
        if (r < 0.35) a.bordure.line = rng.pick(["engrailed", "engrailed", "indented", "wavy", "invected"] as Line[]);
        else if (r < 0.5) a.bordure.compony = contrastAll(rng, [a.bordure.tincture], [...under]);
      }
      return a;
    }
    case "tincture": {
      // Change the field, keeping every charge legible.
      if (a.field.partition === "plain" && !isFur(a.field.tinctures[0])) {
        const t0 = a.field.tinctures[0];
        const alts = (["gules", "azure", "sable", "vert", "or", "argent", "purpure"] as Tint[]).filter(
          (t) => t !== t0 && isMetal(t) === isMetal(t0) && chargeTints(a).every((c) => readable(c, t) && tinctureOk(c, t)),
        );
        if (alts.length) {
          a.field.tinctures = [rng.pick(alts)];
          return a;
        }
      }
      return differenceArms(arms, rng, "bordure");
    }
    case "line": {
      if (a.ordinary) {
        const cur = a.ordinary.line ?? "straight";
        const opts: Line[] = (["engrailed", "invected", "wavy", "indented", "embattled", "nebuly"] as Line[]).filter((l) => l !== cur);
        a.ordinary.line = rng.pick(opts);
        delete a.ordinary.count;
        return a;
      }
      return differenceArms(arms, rng, "bordure");
    }
    case "canton": {
      if (a.canton || a.chief) return differenceArms(arms, rng, "bordure");
      a.canton = { tincture: contrastAll(rng, under, chargeTints(a)) };
      if (rng.chance(0.5)) {
        const c = contrastAll(rng, [a.canton.tincture]);
        a.canton.charge = { charge: rng.pick(["mullet", "crossPatty", "fleurDeLis", "escallop", "crescent", "roundel"] as const), count: 1, tincture: c };
      }
      return a;
    }
    case "bendlet": {
      // A bendlet (baston) over all: an old mark of cadency.
      addDiff({ mark: "bendlet", tincture: contrastAll(rng, under, chargeTints(a)) });
      return a;
    }
    default:
      return a;
  }
}

function chargeTints(a: SimpleArms): Tint[] {
  const ts: Tint[] = [];
  if (a.ordinary) ts.push(a.ordinary.tincture);
  if (a.charges) ts.push(a.charges.tincture);
  if (a.secondary) ts.push(a.secondary.tincture);
  if (a.chief) ts.push(a.chief.tincture);
  return ts;
}

function labelAvoid(a: Arms): Tint[] {
  return a.kind === "simple" ? [...chargeTints(a), ...(a.chief ? [a.chief.tincture] : [])] : [];
}

export interface MarshalOptions {
  /** How to combine two coats. Default: "quarterly" for unions of realms. Use "impaled" for marriages. */
  method?: MarshallingMethod;
  /** An escutcheon of pretence set over all (e.g. an heiress's arms, or the arms of an elected ruler). */
  escutcheon?: Arms;
}

/**
 * Combine coats on one shield.
 *  - 1 coat: returned as is (with any escutcheon).
 *  - 2 coats: quarterly (1 and 4 the first, 2 and 3 the second), impaled, or per fess.
 *  - 3 coats: quarterly 1, 2, 3, with the first repeated in 4.
 *  - 4 coats: quarterly.
 *  - more: the first three quarters, and the rest quartered again in the fourth (grand quarters).
 */
export function marshalArms(coats: Arms[], opts: MarshalOptions = {}): Arms {
  if (!coats.length) throw new Error("marshalArms: no coats");
  const method = opts.method ?? "quarterly";
  if (coats.length === 1) {
    if (!opts.escutcheon) return clone(coats[0]);
    return { kind: "marshalled", method: "single", coats: [clone(coats[0])], escutcheon: clone(opts.escutcheon) };
  }
  let m: MarshalledArms;
  if (method === "single") {
    // Only one coat can fill the shield: the others go over all as an escutcheon.
    m = { kind: "marshalled", method: "single", coats: [clone(coats[0])], escutcheon: clone(opts.escutcheon ?? (coats.length === 2 ? coats[1] : marshalArms(coats.slice(1)))) };
    return m;
  }
  if (method === "impaled" || method === "perFess") {
    const second = coats.length === 2 ? coats[1] : marshalArms(coats.slice(1), { method: "quarterly" });
    m = { kind: "marshalled", method, coats: [clone(coats[0]), clone(second)] };
  } else if (coats.length === 2) {
    m = { kind: "marshalled", method: "quarterly", coats: [coats[0], coats[1], coats[1], coats[0]].map(clone) };
  } else if (coats.length === 3) {
    m = { kind: "marshalled", method: "quarterly", coats: [coats[0], coats[1], coats[2], coats[0]].map(clone) };
  } else if (coats.length === 4) {
    m = { kind: "marshalled", method: "quarterly", coats: coats.map(clone) };
  } else {
    m = { kind: "marshalled", method: "quarterly", coats: [clone(coats[0]), clone(coats[1]), clone(coats[2]), marshalArms(coats.slice(3), { method: "quarterly" })] };
  }
  if (opts.escutcheon) m.escutcheon = clone(opts.escutcheon);
  return m;
}

// ---------------------------------------------------------------------------
// Canting

/** Synonyms and near-synonyms that a herald would happily pun on. */
const CANT_SYNONYMS: Record<string, EmblemConcept> = {
  wolves: "wolf", hound: "wolf", hounds: "wolf", dog: "wolf", dogs: "wolf", fox: "wolf", foxes: "wolf", lupine: "wolf",
  bears: "bear", ursine: "bear", bruin: "bear",
  lions: "lion", lioness: "lion", leo: "lion", leopard: "lion", cat: "lion",
  eagles: "eagle", erne: "eagle", aquiline: "eagle",
  ravens: "raven", crow: "raven", crows: "raven", rook: "raven", rooks: "raven", corvid: "raven",
  falcons: "falcon", hawk: "falcon", hawks: "falcon", kestrel: "falcon", merlin: "falcon",
  owls: "owl", swans: "swan", cygnet: "swan",
  stags: "stag", deer: "stag", hart: "stag", harts: "stag", buck: "stag", hind: "stag", elk: "stag", antler: "stag",
  boars: "boar", swine: "boar", pig: "boar", sow: "boar", hog: "boar",
  horses: "horse", steed: "horse", mare: "horse", stallion: "horse", colt: "horse", foal: "horse", rider: "horse", equine: "horse",
  bulls: "bull", ox: "bull", oxen: "bull", cattle: "bull", cow: "bull", bison: "bull", aurochs: "bull", steer: "bull",
  serpents: "serpent", snake: "serpent", snakes: "serpent", adder: "serpent", viper: "serpent", asp: "serpent", worm: "dragon",
  dragons: "dragon", wyrm: "dragon", wyvern: "dragon", drake: "dragon",
  fishes: "fish", salmon: "fish", pike: "fish", trout: "fish", herring: "fish", carp: "fish", eel: "fish",
  suns: "sun", sunny: "sun", dawn: "sun", day: "sun", noon: "sun", solar: "sun", bright: "sun", east: "sun",
  moons: "moon", lunar: "moon", night: "moon", crescent: "moon",
  stars: "star", starry: "star", stellar: "star", astral: "star",
  flames: "flame", fire: "flame", fires: "flame", fiery: "flame", burning: "flame", blaze: "flame", ember: "flame", hearth: "flame", torch: "flame",
  lightnings: "lightning", thunder: "lightning", storm: "lightning", storms: "lightning", bolt: "lightning",
  waves: "wave", sea: "wave", seas: "wave", water: "wave", waters: "wave", river: "wave", lake: "wave", tide: "wave", ford: "wave", stream: "wave", mere: "wave", ocean: "wave",
  mountains: "mountain", mount: "mountain", hill: "mountain", hills: "mountain", peak: "mountain", crag: "mountain", ridge: "mountain", rock: "mountain", stone: "mountain",
  trees: "tree", wood: "tree", woods: "tree", forest: "tree", grove: "tree", ash: "tree", elm: "tree", birch: "tree", willow: "tree", yew: "tree", alder: "tree",
  oaks: "oak", oaken: "oak", acorn: "oak",
  pines: "pine", fir: "pine", spruce: "pine", cedar: "pine",
  roses: "rose", flower: "rose", flowers: "rose", bloom: "rose", blossom: "rose", lily: "rose",
  grain: "wheat", corn: "wheat", barley: "wheat", harvest: "wheat", sheaf: "wheat", field: "wheat", bread: "wheat",
  towers: "tower", keep: "tower", spire: "tower", watch: "tower",
  castles: "castle", fort: "castle", fortress: "castle", citadel: "castle", stronghold: "castle", hold: "castle", wall: "castle", walls: "castle", burg: "castle", gate: "castle",
  bridges: "bridge", crossing: "bridge",
  keys: "key", lock: "key",
  swords: "sword", blade: "sword", blades: "sword", sabre: "sword", brand: "sword",
  spears: "spear", lance: "spear", lances: "spear", pike_: "spear", javelin: "spear", arrow: "spear",
  axes: "axe", hatchet: "axe",
  crowns: "crown", crowned: "crown", king: "crown", kings: "crown", queen: "crown", royal: "crown", lord: "crown", prince: "crown", throne: "crown",
  wheels: "wheel", cart: "wheel", wagon: "wheel", mill: "wheel",
  ships: "ship", boat: "ship", boats: "ship", sail: "ship", sails: "ship", keel: "ship", galley: "ship", harbour: "ship", port: "ship",
  horns: "horn", trumpet: "horn", bugle: "horn",
  hammers: "hammer", smith: "hammer", forge: "hammer", anvil: "hammer",
  anchors: "anchor", bells: "bell", chime: "bell",
  cups: "cup", chalice: "cup", goblet: "cup", grail: "cup", bowl: "cup",
  hands: "hand", fist: "hand", palm: "hand",
  hearts: "heart", love: "heart", brave: "heart",
  eyes: "eye", sight: "eye", seer: "eye", watcher: "eye",
  feathers: "feather", plume: "feather", wing: "feather", wings: "feather", quill: "feather",
};

function normaliseWord(w: string): string {
  return w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z_]/g, "");
}

/** All emblem concepts punned on by the gloss words, in order of appearance. */
export function cantingCharges(glossWords: string[]): EmblemConcept[] {
  const out: EmblemConcept[] = [];
  const concepts = EMBLEM_CONCEPTS as readonly string[];
  for (const raw of glossWords) {
    for (const part of raw.split(/[\s\-–—/,]+/)) {
      const w = normaliseWord(part);
      if (!w) continue;
      let hit: EmblemConcept | undefined;
      if (concepts.includes(w)) hit = w as EmblemConcept;
      else if (CANT_SYNONYMS[w]) hit = CANT_SYNONYMS[w];
      else if (w.endsWith("s") && concepts.includes(w.slice(0, -1))) hit = w.slice(0, -1) as EmblemConcept;
      else if (w.endsWith("es") && concepts.includes(w.slice(0, -2))) hit = w.slice(0, -2) as EmblemConcept;
      if (hit && !out.includes(hit)) out.push(hit);
    }
  }
  return out;
}

/**
 * The emblem concept a herald would choose for canting arms, given the English
 * gloss of a name (e.g. ["wolf", "spear"] for "Wolf-spear"), or undefined.
 */
export function cantingCharge(glossWords: string[]): EmblemConcept | undefined {
  return cantingCharges(glossWords)[0];
}
