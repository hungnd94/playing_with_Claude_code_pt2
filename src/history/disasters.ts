/**
 * Nature strikes back: a slow climate signal (warm and cold centuries),
 * volcanic winters, plagues that break out in great connected cities and
 * travel along roads, rivers and sea lanes, eruptions near volcanoes,
 * earthquakes on active plate boundaries, floods on great rivers, famines in
 * marginal lands during cold spells, droughts in hot ones.
 */
import { abandonSettlement } from "./settlements";
import { killPerson } from "./people";
import { nameFeature } from "./features";
import type { PlagueS, SetS, Sim } from "./sim";
import type { Disaster } from "./types";
import { clamp } from "./util";

// ---------------------------------------------------------------------------
// Climate
// ---------------------------------------------------------------------------

interface ClimateWave {
  period: number;
  amp: number;
  phase: number;
}

const waves = new WeakMap<Sim, ClimateWave[]>();

export function initClimate(sim: Sim): void {
  const rng = sim.rng.climate;
  const w: ClimateWave[] = [
    { period: rng.range(160, 200), amp: rng.range(0.08, 0.14), phase: rng.range(0, 6.283) },
    { period: rng.range(280, 360), amp: rng.range(0.14, 0.22), phase: rng.range(0, 6.283) },
    { period: rng.range(520, 640), amp: rng.range(0.18, 0.28), phase: rng.range(0, 6.283) },
    { period: rng.range(950, 1250), amp: rng.range(0.2, 0.3), phase: rng.range(0, 6.283) },
  ];
  waves.set(sim, w);
}

function climateAt(sim: Sim, year: number): number {
  let c = 0;
  for (const w of waves.get(sim) ?? []) c += w.amp * Math.sin((2 * Math.PI * year) / w.period + w.phase);
  return c;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

function newDisaster(sim: Sim, kind: Disaster["kind"], cell: number, name = ""): Disaster {
  const d: Disaster = { id: sim.h.disasters.length, kind, name, start: sim.year, end: sim.year, cell, deaths: 0, settlements: [] };
  sim.h.disasters.push(d);
  return d;
}

function kill(s: SetS, frac: number): number {
  const d = Math.round(s.pop * frac);
  s.pop = Math.max(120, s.pop - d);
  return d;
}

// ---------------------------------------------------------------------------
// Plague
// ---------------------------------------------------------------------------

const PLAGUE_NAMES = ["the Grey Death", "the Great Pestilence", "the Black Fever", "the Sweating Sickness", "the Red Plague", "the Wasting", "the Spotted Death", "the Blue Cough", "the Bloody Flux", "the Pale Sickness", "the Great Dying"];

function startPlague(sim: Sim): void {
  const rng = sim.rng.disaster;
  // A great, connected city.
  const cands: number[] = [];
  const w: number[] = [];
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    if (s.urban < 5000 || sim.year - s.lastPlague < 80) continue;
    cands.push(sid);
    w.push(s.urban * (1 + s.routes.length) * (s.port ? 1.5 : 1));
  }
  if (!cands.length) return;
  const origin = cands[rng.weightedIndex(w)];
  const s = sim.S[origin];
  const d = newDisaster(sim, "plague", s.cell);
  const great = rng.chance(0.25);
  const P: PlagueS = {
    id: sim.plagues.length, rec: d, infected: new Set([origin]), frontier: [origin], lethality: great ? rng.range(0.25, 0.45) : rng.range(0.08, 0.25),
    contagion: great ? rng.range(0.45, 0.65) : rng.range(0.25, 0.45), years: 0, great,
  };
  sim.plagues.push(P);
  infect(sim, P, origin);
  sim.emit("plague", great ? 4 : 3, s.cell, { disasters: [d.id], settlements: [origin], polities: [s.owner] }, { disaster: d.id, origin, deaths: 0, settlements: 1, phase: "outbreak" });
}

function infect(sim: Sim, P: PlagueS, sid: number): void {
  const rng = sim.rng.disaster;
  const s = sim.S[sid];
  const f = P.lethality * rng.range(0.5, 1.2) * (s.urban > 20000 ? 1.25 : 1);
  const deaths = kill(s, f);
  s.lastPlague = sim.year;
  P.rec.deaths += deaths;
  P.rec.settlements.push(sid);
  if (s.owner >= 0) sim.P[s.owner].crisis += 0.15;
  if (s.rank >= 3 && P.rec.settlements.length > 1) {
    sim.emit("plague", 2, s.cell, { disasters: [P.rec.id], settlements: [sid], polities: [s.owner] }, { disaster: P.rec.id, origin: sid, deaths, settlements: P.rec.settlements.length, phase: "arrival" });
  }
}

function tickPlague(sim: Sim, P: PlagueS): void {
  const rng = sim.rng.disaster;
  const next: number[] = [];
  for (const sid of P.frontier) {
    const s = sim.S[sid];
    const targets = [...s.nbrs];
    for (const rid of s.routes) {
      const r = sim.h.tradeRoutes[rid];
      if (r.ended < 0) targets.push(r.from === sid ? r.to : r.from);
    }
    for (const t of targets) {
      if (P.infected.has(t)) continue;
      const ts = sim.S[t];
      if (!ts.alive || sim.year - ts.lastPlague < 50) continue;
      if (!rng.chance(P.contagion * (ts.urban > 3000 ? 1.2 : 0.8))) continue;
      P.infected.add(t);
      next.push(t);
      infect(sim, P, t);
    }
  }
  // Notable people in stricken realms.
  if (next.length) {
    const realms = new Set<number>();
    for (const t of next) if (sim.S[t].owner >= 0) realms.add(sim.S[t].owner);
    for (const id of sim.living.slice()) {
      const pe = sim.Pe[id];
      if (!pe.alive || pe.polity < 0 || !realms.has(pe.polity)) continue;
      if (rng.chance(P.lethality * 0.12)) {
        killPerson(sim, id, "plague", -1);
      }
    }
  }
  P.frontier = next;
  P.years++;
  if (!next.length || P.years > 12) endPlague(sim, P);
}

function endPlague(sim: Sim, P: PlagueS): void {
  const rng = sim.rng.disaster;
  P.years = -1;
  const d = P.rec;
  d.end = sim.year;
  const big = d.deaths > 400000 || d.settlements.length > 60;
  if (big) {
    const used = new Set(sim.h.disasters.map((x) => x.name));
    const free = PLAGUE_NAMES.filter((n) => !used.has(n));
    d.name = free.length ? rng.pick(free) : `the Plague of ${sim.S[d.settlements[0]].name.roman}`;
  } else if (d.settlements.length >= 12) d.name = `the Plague of ${sim.S[d.settlements[0]].name.roman}`;
  const imp = d.deaths > 2500000 ? 5 : big ? 4 : d.settlements.length >= 12 ? 3 : 2;
  const realms = new Set<number>();
  for (const sid of d.settlements) if (sim.S[sid].owner >= 0) realms.add(sim.S[sid].owner);
  for (const r of realms) if (sim.P[r].alive) sim.P[r].crisis += big ? 1.5 : 0.5;
  sim.emit("plague", imp, d.cell, { disasters: [d.id], settlements: d.settlements.slice(0, 20), polities: [...realms].slice(0, 20) }, {
    disaster: d.id, origin: d.settlements[0], deaths: d.deaths, settlements: d.settlements.length, phase: "end",
  });
}

// ---------------------------------------------------------------------------
// Earth and water
// ---------------------------------------------------------------------------

function eruptions(sim: Sim): void {
  const rng = sim.rng.disaster;
  for (const f of sim.g.volcanoes) {
    if (!rng.chance(1 / 650)) continue;
    const feat = sim.w.features[f];
    const vei = rng.weighted<number>([[2, 40], [3, 30], [4, 18], [5, 8], [6, 3], [7, 0.8]]);
    const cell = feat.anchor;
    const radius = 60 * vei;
    let deaths = 0;
    const hit: number[] = [];
    for (const sid of sim.alive()) {
      const s = sim.S[sid];
      const dk = sim.distKm(cell, s.cell);
      if (dk > radius) continue;
      const fall = 1 - dk / radius;
      deaths += kill(s, Math.min(0.9, 0.04 * (vei - 1) * fall));
      s.devast = Math.min(1, s.devast + 0.5 * fall);
      hit.push(sid);
    }
    if (vei >= 6) sim.volcanicWinter = Math.max(sim.volcanicWinter, vei - 4);
    if (!hit.length && vei < 6) continue;
    // The nearest people names the mountain if nobody had.
    if (!sim.featureIdx.get(f)?.names.length && hit.length) nameFeature(sim, f, sim.S[hit[0]].culture);
    const known = sim.featureIdx.get(f);
    const vname = known && known.names.length ? (known.names[0].name as unknown as { roman: string }).roman : "";
    const d = newDisaster(sim, "eruption", cell, vei >= 6 ? (vname ? `the Great Eruption of ${vname}` : "the Great Eruption") : "");
    d.deaths = deaths;
    d.settlements = hit;
    const destroyed = hit.filter((sid) => sim.distKm(cell, sim.S[sid].cell) < 90 && vei >= 5 && rng.chance(0.5));
    sim.emit("eruption", vei >= 6 ? (hit.length ? 5 : 4) : vei >= 5 && deaths > 5000 ? 4 : hit.length ? 3 : 2, cell, { disasters: [d.id], features: [f], settlements: hit.slice(0, 12), polities: [...new Set(hit.map((x) => sim.S[x].owner))].slice(0, 8) }, {
      disaster: d.id, deaths, feature: f, vei,
    });
    for (const sid of destroyed) abandonSettlement(sim, sid, "disaster");
  }
}

function earthquakes(sim: Sim): void {
  const rng = sim.rng.disaster;
  if (!rng.chance(0.03)) return;
  const cands: number[] = [];
  const w: number[] = [];
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    const q = sim.w.seismicity[s.cell];
    if (q < 0.35) continue;
    cands.push(sid);
    w.push(q * q * (500 + s.urban));
  }
  if (!cands.length) return;
  const sid = cands[rng.weightedIndex(w)];
  const s = sim.S[sid];
  const mag = Math.round((5.6 + 2.6 * sim.w.seismicity[s.cell] * rng.next()) * 10) / 10;
  const deaths = kill(s, clamp((mag - 5.5) * 0.06 * rng.range(0.4, 1.2), 0.005, 0.4));
  s.devast = Math.min(1, s.devast + (mag - 5.5) * 0.2);
  const d = newDisaster(sim, "earthquake", s.cell, mag >= 7.8 && s.rank >= 2 ? `the Great Earthquake of ${s.name.roman}` : "");
  d.deaths = deaths;
  d.settlements = [sid];
  sim.emit("earthquake", mag >= 7.6 && s.rank >= 2 ? 4 : mag >= 6.8 || s.rank >= 2 ? 3 : 2, s.cell, { disasters: [d.id], settlements: [sid], polities: [s.owner] }, { disaster: d.id, deaths, settlement: sid, magnitude: mag });
  for (const wid of s.rec.wonders) {
    const W = sim.h.wonders[wid];
    if (W.destroyed < 0 && W.completed >= 0 && rng.chance((mag - 6) * 0.25)) {
      W.destroyed = sim.year;
      W.destroyCause = "earthquake";
      sim.emit("wonderDestroyed", 4, s.cell, { wonders: [wid], settlements: [sid], disasters: [d.id] }, { wonder: wid, cause: "earthquake", by: -1 });
    }
  }
  if (s.owner >= 0) sim.P[s.owner].crisis += 0.3;
}

function floods(sim: Sim): void {
  const rng = sim.rng.disaster;
  if (!sim.g.bigRivers.length || !rng.chance(0.022)) return;
  const cands: number[] = [];
  const w: number[] = [];
  const big = new Set(sim.g.bigRivers);
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    const r = sim.g.riverOf[s.cell];
    if (r < 0 || !big.has(r)) continue;
    cands.push(sid);
    w.push(300 + s.urban);
  }
  if (!cands.length) return;
  const sid = cands[rng.weightedIndex(w)];
  const s = sim.S[sid];
  const river = sim.g.riverOf[s.cell];
  let deaths = 0;
  const hit = [sid];
  for (const n of s.nbrs) if (sim.g.riverOf[sim.S[n].cell] === river && rng.chance(0.6)) hit.push(n);
  for (const h of hit) {
    deaths += kill(sim.S[h], rng.range(0.01, 0.06));
    sim.S[h].devast = Math.min(1, sim.S[h].devast + 0.2);
  }
  const d = newDisaster(sim, "flood", s.cell);
  d.deaths = deaths;
  d.settlements = hit;
  sim.emit("flood", deaths > 20000 ? 3 : 2, s.cell, { disasters: [d.id], settlements: hit, features: [river], polities: [s.owner] }, { disaster: d.id, deaths, feature: river, settlement: sid });
}

/** Famine in cold spells (marginal farmland) and drought in hot ones (dry land), per realm. */
function famines(sim: Sim): void {
  const rng = sim.rng.disaster;
  const cold = -sim.climate + (sim.volcanicWinter > 0 ? 0.8 : 0);
  const hot = sim.climate;
  if (cold < 0.25 && hot < 0.35) return;
  for (const P of sim.P) {
    if (!P.alive || P.sets.length < 3) continue;
    let risk = 0;
    for (const sid of P.sets) risk += sim.g.marginal[sim.S[sid].cell];
    risk /= P.sets.length;
    if (risk < 0.25) continue;
    const isCold = cold >= 0.25;
    if (!rng.chance((isCold ? cold : hot - 0.2) * risk * 0.35)) continue;
    let deaths = 0;
    const hit: number[] = [];
    for (const sid of P.sets) {
      const m = sim.g.marginal[sim.S[sid].cell];
      if (m < 0.2) continue;
      deaths += kill(sim.S[sid], m * rng.range(0.04, 0.14));
      hit.push(sid);
    }
    if (!hit.length) continue;
    const kind = isCold ? "famine" : "drought";
    const d = newDisaster(sim, kind, sim.S[hit[0]].cell, deaths > 300000 ? `the Great ${isCold ? "Famine" : "Drought"}` : "");
    d.deaths = deaths;
    d.settlements = hit;
    P.crisis += deaths > 100000 ? 1.5 : 0.7;
    const cause = isCold ? (sim.volcanicWinter > 0 ? "a year without summer after the eruption" : "a run of cold summers and failed harvests") : "years without rain";
    const imp = deaths > 500000 ? 4 : deaths > 80000 ? 3 : 2;
    if (kind === "famine") sim.emit("famine", imp, d.cell, { disasters: [d.id], polities: [P.id], settlements: hit.slice(0, 12) }, { disaster: d.id, deaths, cause });
    else sim.emit("drought", imp, d.cell, { disasters: [d.id], polities: [P.id], settlements: hit.slice(0, 12) }, { disaster: d.id, deaths, cause });
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tickDisasters(sim: Sim): void {
  const rng = sim.rng.disaster;
  sim.climate = climateAt(sim, sim.year) - (sim.volcanicWinter > 0 ? 0.7 : 0);
  if (sim.volcanicWinter > 0) sim.volcanicWinter--;
  // Plague.
  const active = sim.plagues.filter((p) => p.years >= 0);
  for (const p of active) tickPlague(sim, p);
  const last = sim.plagues.length ? sim.plagues[sim.plagues.length - 1].rec.end : -999;
  if (!active.length && sim.year > 250 && sim.year - last > 90) {
    let conn = 0;
    for (const r of sim.h.tradeRoutes) if (r.ended < 0) conn++;
    let big = 0;
    for (const sid of sim.alive()) if (sim.S[sid].urban > 10000) big++;
    if (rng.chance(0.0025 * (0.5 + Math.min(3, conn / 15) + Math.min(2, big / 20)))) startPlague(sim);
  }
  eruptions(sim);
  earthquakes(sim);
  floods(sim);
  if (sim.year % 5 === 2) famines(sim);
}
