/**
 * Per-world "character" knobs, drawn once from the seed.
 *
 * Earth is one sample from a wide space of plausible planets. These knobs make
 * seeds differ in kind, not just in detail: a Pangaea-like supercontinent
 * ringed by one world ocean, a scatter of mid-sized continents, a drowned world
 * of shelf seas and archipelagos, smooth Africa-like coasts or ragged
 * Norway-like ones. All knobs are continuous; a few archetypes are favoured so
 * that the extremes actually occur.
 */
import { Rng } from "../core/rng";
import { clamp } from "./util";

export interface WorldStyle {
  /** Name of the archetype the knobs were drawn around (for debugging / descriptions). */
  archetype: "dispersed" | "supercontinent" | "archipelago" | "earthlike";
  /** 0 = continental plates repel each other (dispersed), 1 = they cluster into a supercontinent. */
  assembly: number;
  /** Fraction of the planet that is continental shelf (drowned crust); high → shelf seas, islands. */
  shelf: number;
  /** Multiplier on the amplitude of coastline displacement noise. */
  coastRough: number;
  /** Large-scale domain warp amplitude (curvier, swirlier continents when higher). */
  warp: number;
  /** Frequency of oceanic microcontinents and plateaus (0..1). */
  micro: number;
  /** Number of hotspots. */
  hotspots: number;
  /** Strength multiplier for interior basin-and-swell relief and plateaus. */
  plateau: number;
  /** 0..1: how much continents are broken up by drowned interior basins (high → archipelagos). */
  fragment: number;
}

export function drawStyle(rng: Rng): WorldStyle {
  const u = rng.next();
  const archetype: WorldStyle["archetype"] = u < 0.22 ? "supercontinent" : u < 0.42 ? "archipelago" : u < 0.62 ? "dispersed" : "earthlike";
  const j = (lo: number, hi: number) => rng.range(lo, hi);
  let s: WorldStyle;
  switch (archetype) {
    case "supercontinent":
      s = { archetype, assembly: j(0.8, 1), shelf: j(0.015, 0.035), coastRough: j(0.8, 1.15), warp: j(0.15, 0.2), micro: j(0, 0.4), hotspots: rng.int(3, 6), plateau: j(0.9, 1.3), fragment: j(0, 0.25) };
      break;
    case "archipelago":
      s = { archetype, assembly: j(0.2, 0.6), shelf: j(0.055, 0.09), coastRough: j(1.15, 1.5), warp: j(0.14, 0.2), micro: j(0.5, 1), hotspots: rng.int(5, 9), plateau: j(0.6, 0.9), fragment: j(0.6, 1) };
      break;
    case "dispersed":
      s = { archetype, assembly: j(0, 0.25), shelf: j(0.025, 0.05), coastRough: j(0.9, 1.3), warp: j(0.15, 0.22), micro: j(0.3, 0.8), hotspots: rng.int(4, 8), plateau: j(0.8, 1.1), fragment: j(0.15, 0.5) };
      break;
    default:
      s = { archetype, assembly: j(0.35, 0.7), shelf: j(0.02, 0.045), coastRough: j(0.9, 1.25), warp: j(0.14, 0.2), micro: j(0.2, 0.7), hotspots: rng.int(3, 7), plateau: j(0.8, 1.2), fragment: j(0.05, 0.4) };
  }
  s.assembly = clamp(s.assembly, 0, 1);
  return s;
}
