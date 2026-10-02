/** Periodic samples: settlement populations, polity statistics, world series. */
import type { Sim } from "./sim";

export function sampleStats(sim: Sim): void {
  const k = sim.year / sim.h.sampleStep;
  for (const s of sim.S) {
    if (!s.alive) continue;
    const rec = s.rec;
    const want = k - rec.popStart;
    if (want < 0) continue;
    while (rec.pop.length < want) rec.pop.push(rec.pop.length ? rec.pop[rec.pop.length - 1] : Math.round(s.urban));
    if (rec.pop.length === want) rec.pop.push(Math.round(s.urban));
  }
  let worldPop = 0;
  let pols = 0;
  for (const s of sim.S) if (s.alive) worldPop += s.pop;
  for (const P of sim.P) {
    if (!P.alive) continue;
    if (P.overlord < 0) pols++;
    const rec = P.rec;
    const want = k - rec.statStart;
    if (want < 0) continue;
    const st = rec.stats;
    while (st.pop.length < want) {
      st.pop.push(st.pop[st.pop.length - 1] ?? 0);
      st.areaKm2.push(st.areaKm2[st.areaKm2.length - 1] ?? 0);
      st.settlements.push(st.settlements[st.settlements.length - 1] ?? 0);
      st.strength.push(st.strength[st.strength.length - 1] ?? 0);
    }
    if (st.pop.length === want) {
      st.pop.push(Math.round(P.pop));
      st.areaKm2.push(Math.round(P.area));
      st.settlements.push(P.sets.length);
      st.strength.push(Math.round(P.strength));
    }
  }
  const ws = sim.h.worldStats;
  ws.pop.push(Math.round(worldPop));
  ws.settlements.push(sim.alive().length);
  ws.polities.push(pols);
  ws.wars.push(sim.W.filter((w) => w.active).length);
  ws.climate.push(Math.round(sim.climate * 100) / 100);
  let t = 0;
  for (const C of sim.C) if (C.alive) t = Math.max(t, C.tech);
  ws.tech.push(Math.round(t * 100) / 100);
}
