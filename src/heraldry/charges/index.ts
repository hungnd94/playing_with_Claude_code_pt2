/**
 * The charge registry: every EMBLEM_CONCEPT plus the classic geometric charges.
 */
import { EMBLEM_CONCEPTS } from "../../world/concepts";
import { CLASSIC_CHARGES, type Attitude, type ChargeId } from "../types";
import type { ArtOptions, ChargeArt, ChargeDef } from "./art";
import { pathBBox, samplePath, unionBBox, type BBox } from "../path";
import * as G from "./geometric";
import { BEASTS } from "./beasts";
import { BIRDS } from "./birds";
import { MONSTERS } from "./monsters";
import { NATURE } from "./nature";
import { OBJECTS } from "./objects";

export type { ChargeDef, ChargeArt, ArtOptions } from "./art";

const GEOMETRIC: Partial<Record<ChargeId, ChargeDef>> = {
  mullet: { name: "mullet", plural: "mullets", category: "geometric", symmetric: true, weight: 9, art: (o) => G.mullet(o.points ?? 5, o.pierced) },
  star: { name: "estoile", plural: "estoiles", category: "celestial", symmetric: true, weight: 4, art: (o) => G.estoile(o.points ?? 6) },
  crescent: { name: "crescent", plural: "crescents", category: "geometric", symmetric: true, weight: 6, art: G.crescent },
  roundel: { name: "roundel", plural: "roundels", category: "geometric", symmetric: true, weight: 7, art: G.roundel },
  annulet: { name: "annulet", plural: "annulets", category: "geometric", symmetric: true, weight: 4, art: G.annulet },
  lozenge: { name: "lozenge", plural: "lozenges", category: "geometric", symmetric: true, weight: 4, art: G.lozenge },
  fusil: { name: "fusil", plural: "fusils", category: "geometric", symmetric: true, weight: 2, art: G.fusil },
  mascle: { name: "mascle", plural: "mascles", category: "geometric", symmetric: true, weight: 3, art: G.mascle },
  billet: { name: "billet", plural: "billets", category: "geometric", symmetric: true, weight: 3, art: G.billet },
  goutte: { name: "goutte", plural: "gouttes", category: "geometric", symmetric: true, weight: 1, art: G.goutte },
  escutcheon: { name: "escutcheon", plural: "escutcheons", category: "geometric", symmetric: true, weight: 3, art: G.escutcheon },
  fleurDeLis: { name: "fleur-de-lis", plural: "fleurs-de-lis", category: "plant", symmetric: true, weight: 8, art: G.fleurDeLis },
  escallop: { name: "escallop", plural: "escallops", category: "nature", symmetric: true, weight: 6, art: G.escallop },
  cinquefoil: { name: "cinquefoil", plural: "cinquefoils", category: "plant", symmetric: true, weight: 4, art: G.cinquefoil },
  quatrefoil: { name: "quatrefoil", plural: "quatrefoils", category: "plant", symmetric: true, weight: 2, art: G.quatrefoil },
  trefoil: { name: "trefoil slipped", plural: "trefoils slipped", category: "plant", weight: 2, art: G.trefoil },
  pheon: { name: "pheon", plural: "pheons", category: "weapon", symmetric: true, weight: 2, art: G.pheon },
  crossCouped: { name: "cross couped", plural: "crosses couped", category: "cross", symmetric: true, weight: 3, art: G.crossCouped },
  crossPatty: { name: "cross patty", plural: "crosses patty", category: "cross", symmetric: true, weight: 6, art: G.crossPatty },
  crossCrosslet: { name: "cross crosslet", plural: "crosses crosslet", category: "cross", symmetric: true, weight: 6, art: G.crossCrosslet },
  crossPotent: { name: "cross potent", plural: "crosses potent", category: "cross", symmetric: true, weight: 2, art: G.crossPotent },
  crossMoline: { name: "cross moline", plural: "crosses moline", category: "cross", symmetric: true, weight: 4, art: G.crossMoline },
  crossFlory: { name: "cross flory", plural: "crosses flory", category: "cross", symmetric: true, weight: 3, art: G.crossFlory },
};

export const CHARGES: Record<ChargeId, ChargeDef> = {
  ...GEOMETRIC,
  ...BEASTS,
  ...BIRDS,
  ...MONSTERS,
  ...NATURE,
  ...OBJECTS,
} as Record<ChargeId, ChargeDef>;

export const ALL_CHARGE_IDS: readonly ChargeId[] = [...EMBLEM_CONCEPTS, ...CLASSIC_CHARGES];

export function chargeDef(id: ChargeId): ChargeDef {
  const d = CHARGES[id];
  if (!d) throw new Error(`Unknown charge: ${id}`);
  return d;
}

export function defaultAttitude(id: ChargeId): Attitude | undefined {
  return CHARGES[id]?.attitudes?.[0];
}

/** Horizontal extent of a charge's silhouette in a horizontal band, normalised to its bbox (0..1). */
export interface ProfileBand {
  v0: number;
  v1: number;
  u0: number;
  u1: number;
}

export interface ResolvedArt {
  art: ChargeArt;
  box: BBox;
  /** Silhouette profile, top to bottom (bands with nothing in them are omitted). */
  profile: ProfileBand[];
}

const BANDS = 12;

function computeProfile(art: ChargeArt, box: BBox): ProfileBand[] {
  const bw = box.x1 - box.x0 || 1, bh = box.y1 - box.y0 || 1;
  const lo = new Array<number>(BANDS).fill(Infinity), hi = new Array<number>(BANDS).fill(-Infinity);
  for (const l of art.layers) {
    if (l.role === "line" || l.role === "shine" || l.role === "shade" || l.role === "ink" || l.role === "crown") continue;
    for (const poly of samplePath(l.d, 8)) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        // sample along the segment so long straight edges register in every band they cross
        const steps = Math.max(1, Math.ceil((Math.abs(b[1] - a[1]) / bh) * BANDS * 2));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const u = (a[0] + (b[0] - a[0]) * t - box.x0) / bw;
          const v = (a[1] + (b[1] - a[1]) * t - box.y0) / bh;
          const j = Math.max(0, Math.min(BANDS - 1, Math.floor(v * BANDS)));
          if (u < lo[j]) lo[j] = u;
          if (u > hi[j]) hi[j] = u;
        }
      }
    }
  }
  const out: ProfileBand[] = [];
  for (let j = 0; j < BANDS; j++) if (lo[j] <= hi[j]) out.push({ v0: j / BANDS, v1: (j + 1) / BANDS, u0: lo[j], u1: hi[j] });
  return out;
}

const cache = new Map<string, ResolvedArt>();

/** Artwork + bounding box for a charge with options (cached). */
export function chargeArt(id: ChargeId, o: ArtOptions = {}): ResolvedArt {
  const def = chargeDef(id);
  const att = o.attitude && def.attitudes?.includes(o.attitude) ? o.attitude : def.attitudes?.[0];
  const key = `${id}|${att ?? ""}|${o.points ?? ""}|${o.pierced ? 1 : 0}`;
  let r = cache.get(key);
  if (!r) {
    const art = def.art({ ...o, attitude: att });
    let box: BBox | null = art.box ?? null;
    if (!box) {
      for (const l of art.layers) {
        if (l.role === "line" || l.role === "shine" || l.role === "shade" || l.role === "ink") continue;
        const b = pathBBox(l.d);
        box = box ? unionBBox(box, b) : b;
      }
    }
    const bb = box ?? { x0: 0, y0: 0, x1: 100, y1: 100 };
    r = { art, box: bb, profile: computeProfile(art, bb) };
    cache.set(key, r);
  }
  return r;
}
