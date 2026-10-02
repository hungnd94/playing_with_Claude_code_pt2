/** Live preview snapshots for the "history unfolding" view. */
import { describeEvent, simNamer } from "./describe";
import type { Sim } from "./sim";
import type { LiveSnapshot } from "./types";

export function liveSnapshot(sim: Sim): LiveSnapshot {
  const polities: LiveSnapshot["polities"] = {};
  const seen = new Set<number>();
  for (const c of sim.g.landCells) {
    const o = sim.cellOwner[c];
    if (o >= 0 && !seen.has(o)) {
      seen.add(o);
      polities[o] = { color: sim.P[o].color, name: sim.P[o].name.roman };
    }
  }
  const ids = sim.recentEvents.slice();
  sim.recentEvents.length = 0;
  ids.sort((a, b) => sim.h.events[b].importance - sim.h.events[a].importance || a - b);
  const namer = simNamer(sim);
  const events = ids.slice(0, 6).sort((a, b) => a - b).map((id) => ({ event: sim.h.events[id], headline: describeEvent(sim.h.events[id], namer) }));
  let pop = 0;
  for (const sid of sim.alive()) pop += sim.S[sid].pop;
  let pols = 0;
  for (const P of sim.P) if (P.alive && P.overlord < 0) pols++;
  return {
    year: sim.year, endYear: sim.endYear, owner: sim.cellOwner.slice(), polities, events,
    stats: { settlements: sim.alive().length, polities: pols, pop: Math.round(pop), wars: sim.W.filter((w) => w.active).length },
  };
}
