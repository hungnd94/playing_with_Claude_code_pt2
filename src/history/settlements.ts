/**
 * Settlements and population: founding (with names from the site), logistic
 * growth against the carrying capacity of the catchment, urbanisation,
 * daughter towns under population pressure, overseas colonies, decline and
 * abandonment, ruins resettled.
 */
import { Biome } from "../world/types";
import { siteConcepts, givenName } from "./names";
import { nameFeaturesAround } from "./features";
import type { SetS, Sim } from "./sim";
import type { Settlement } from "./types";
import { clamp, levelTable } from "./util";

/** Carrying-capacity multiplier by technology level 0..6. */
export const TECH_CAPACITY = [1, 1.4, 1.55, 1.7, 1.9, 2.2, 2.8];
/** Urban milestones. */
const RANKS = [0, 5000, 20000, 60000, 150000];
const RANK_NAMES = ["", "town", "city", "great city", "metropolis"] as const;

export interface FoundOptions {
  pop: number;
  owner: number;
  mother?: number;
  founder?: number;
  hearth?: boolean;
  colony?: { across: "sea" | "lake"; landmass: number; distanceKm: number };
  ruinsOf?: number;
  /** Force a "New X" name after the mother city. */
  newName?: boolean;
  quiet?: boolean;
}

/** Last settlement ever at each cell (for ruins). */
const lastAtKey = new WeakMap<Sim, Int32Array>();
export function lastAt(sim: Sim): Int32Array {
  let a = lastAtKey.get(sim);
  if (!a) {
    a = new Int32Array(sim.n).fill(-1);
    lastAtKey.set(sim, a);
  }
  return a;
}

export function foundSettlement(sim: Sim, cell: number, culture: number, o: FoundOptions): number {
  const rng = sim.rng.settle;
  const C = sim.C[culture];
  const lang = C.lang;
  const id = sim.S.length;
  const ruins = o.ruinsOf ?? -1;
  let name;
  const mother = o.mother ?? -1;
  if (ruins >= 0 && rng.chance(0.75)) {
    name = sim.names.adapt(sim.S[ruins].name, lang, sim.year);
  } else {
    const site = siteConcepts(sim, cell);
    const motherName = mother >= 0 && (o.newName || (o.colony && rng.chance(0.35)) || rng.chance(0.03)) ? sim.S[mother].name : undefined;
    const founderName = o.founder !== undefined && o.founder >= 0 && rng.chance(0.25) ? sim.Pe[o.founder].rec.name : undefined;
    name = sim.names.settlement(lang, rng, { features: site, mother: motherName as never, founder: founderName as never });
  }
  const p = sim.w.mesh.xyz;
  // Render position: jittered within the cell.
  const sp = sim.w.mesh.meanSpacing * 0.28;
  let x = p[3 * cell] + rng.range(-sp, sp), y = p[3 * cell + 1] + rng.range(-sp, sp), z = p[3 * cell + 2] + rng.range(-sp, sp);
  const l = Math.hypot(x, y, z);
  x /= l; y /= l; z /= l;
  const rec: Settlement = {
    id, cell, ruinsOf: ruins, pos: [x, y, z], names: [{ year: sim.year, name: name as never, reason: "founded" }], founded: sim.year, ended: -1,
    founderCulture: culture, mother, founder: o.founder ?? -1, popStart: Math.ceil(sim.year / sim.h.sampleStep), pop: [],
    cultures: [{ year: sim.year, culture }], religions: [], owners: [{ year: sim.year, polity: o.owner }], port: false, walled: -1, wonders: [], tags: [], occupations: [],
  };
  sim.h.settlements.push(rec);
  const religion = o.owner >= 0 && sim.P[o.owner].religion >= 0 && rng.chance(0.7) ? sim.P[o.owner].religion : mother >= 0 ? sim.S[mother].religion : C.folk;
  rec.religions.push({ year: sim.year, religion });
  const s: SetS = {
    id, rec, cell, alive: true, pop: o.pop, cap: o.pop * 1.5, food: sim.g.food[cell], urban: 0, culture, religion, owner: o.owner, occupier: -1, occWar: -1,
    loyalty: 0.8, loyaltyTarget: 0.8, ownerSince: sim.year, cultureSince: sim.year, walls: false, port: false, wealth: 0, devast: 0, lastPlague: -999,
    name, nbrs: [], catchStart: 0, catchLen: 0, rank: 0, nextFoundTry: sim.year + rng.int(10, 30), capDist: 0, holy: false, seat: id, lastSack: -999, routes: [],
  };
  s.urban = urbanOf(sim, s);
  sim.S.push(s);
  sim.setAt[cell] = id;
  lastAt(sim)[cell] = id;
  sim.setsDirty = true;
  sim.cellSet[cell] = id;
  if (!o.quiet) {
    const data = {
      settlement: id, culture, polity: o.owner, mother, founder: o.founder ?? -1, ruinsOf: ruins, site: siteConcepts(sim, cell).slice(0, 6), hearth: !!o.hearth,
    };
    const refs = { settlements: [id, mother, ruins], cultures: [culture], polities: [o.owner], persons: [o.founder ?? -1] };
    if (o.colony) sim.emit("colonyFounded", o.colony.distanceKm > 1500 ? 3 : 2, cell, refs, { ...data, across: o.colony.across, landmass: o.colony.landmass, distanceKm: Math.round(o.colony.distanceKm) });
    else sim.emit("settlementFounded", o.hearth ? 3 : ruins >= 0 ? 2 : 1, cell, refs, data);
  }
  nameFeaturesAround(sim, cell, culture);
  return id;
}

export function urbanOf(sim: Sim, s: SetS): number {
  const tech = sim.C[s.culture].tech;
  let f = 0.025 + 0.022 * tech + 0.1 * Math.min(1.5, s.wealth) + (s.port ? 0.02 : 0);
  let extra = 0;
  if (s.owner >= 0) {
    const P = sim.P[s.owner];
    if (P.capital === s.id) {
      f += 0.06;
      extra = (P.gov === "empire" ? 0.02 : 0.012) * Math.max(0, P.pop - s.pop);
    }
  }
  if (s.holy) f += 0.03;
  f = clamp(f, 0.02, 0.55);
  return s.pop * f + extra;
}

export function abandonSettlement(sim: Sim, sid: number, cause: "decline" | "sacked" | "disaster" | "plague" | "famine" | "war", quiet = false): void {
  const s = sim.S[sid];
  if (!s.alive) return;
  s.alive = false;
  s.rec.ended = sim.year;
  s.rec.endReason = cause === "sacked" || cause === "war" ? "sacked" : cause === "disaster" ? "disaster" : cause === "plague" ? "plague" : "abandoned";
  sim.setAt[s.cell] = -1;
  sim.setsDirty = true;
  const owner = s.owner;
  if (!quiet) sim.emit("settlementAbandoned", s.rank >= 2 ? 3 : s.rank >= 1 ? 2 : 1, s.cell, { settlements: [sid], polities: [owner] }, { settlement: sid, cause, pop: Math.round(s.urban), polity: owner });
  // Owner bookkeeping happens in the yearly membership rebuild; a capital must move.
  if (owner >= 0 && sim.P[owner].capital === sid) sim.P[owner].capital = -2; // flagged for relocation
  for (const w of sim.W) if (w.active) w.occ.delete(sid);
  s.occupier = -1;
}

// ---------------------------------------------------------------------------
// Yearly demography
// ---------------------------------------------------------------------------

export function tickDemography(sim: Sim): void {
  const rng = sim.rng.settle;
  const cold = Math.max(0, -sim.climate - 0.3) + (sim.volcanicWinter > 0 ? 0.6 : 0);
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    const C = sim.C[s.culture];
    const marg = sim.g.marginal[s.cell];
    const climateF = 1 - clamp(cold * marg * 0.5, 0, 0.5) + clamp(sim.climate, -0.5, 0.5) * 0.05;
    s.cap = Math.max(200, s.food * levelTable(TECH_CAPACITY, C.tech) * (1 + 0.3 * Math.min(1.5, s.wealth)) * (1 - 0.6 * s.devast) * climateF);
    const r = 0.025 * (1 + rng.range(-0.4, 0.4));
    if (s.pop < s.cap) s.pop += r * s.pop * (1 - s.pop / s.cap);
    else s.pop -= Math.min(0.08, 0.04 + 0.2 * (s.pop / s.cap - 1)) * (s.pop - s.cap);
    s.devast *= 0.9;
    s.wealth *= 0.995;
    s.urban = urbanOf(sim, s);
    // Milestones.
    let rk = s.rank;
    while (rk < 4 && s.urban >= RANKS[rk + 1]) rk++;
    if (rk > s.rank) {
      s.rank = rk;
      if (rk >= 2) {
        let largest = true;
        for (const o of sim.alive()) if (o !== sid && sim.S[o].urban > s.urban) {
          largest = false;
          break;
        }
        sim.emit("settlementGrew", rk >= 4 ? 4 : rk === 3 ? 3 : 2, s.cell, { settlements: [sid], polities: [s.owner] }, {
          settlement: sid, pop: Math.round(s.urban), rank: RANK_NAMES[rk] as "city", polity: s.owner, largestInWorld: largest && rk >= 3,
        });
      }
    }
    // Ports and walls.
    if (!s.port && (sim.g.coastal[s.cell] || sim.g.lakeside[s.cell]) && C.tech >= 1 && s.urban > 1500 && rng.chance(0.02 + 0.05 * C.values.seafaring)) {
      s.port = true;
      s.rec.port = true;
      if (s.urban > 4000) sim.emit("portFounded", 1, s.cell, { settlements: [sid], polities: [s.owner] }, { settlement: sid, polity: s.owner });
    }
    if (s.pop < 250) abandonSettlement(sim, sid, "decline", s.rank === 0 && s.rec.founded > sim.year - 60);
  }
}

// ---------------------------------------------------------------------------
// Expansion: daughter settlements and colonies
// ---------------------------------------------------------------------------

function isFreeSite(sim: Sim, c: number, owner: number): boolean {
  if (!sim.g.land[c] || sim.setAt[c] >= 0) return false;
  const o = sim.cellOwner[c];
  if (o >= 0 && o !== owner) return false;
  const { adjStart, adj } = sim.w.mesh;
  for (let k = adjStart[c]; k < adjStart[c + 1]; k++) if (sim.setAt[adj[k]] >= 0) return false;
  return true;
}

export function tickExpansion(sim: Sim): void {
  const rng = sim.rng.settle;
  const list = sim.alive().slice();
  for (const sid of list) {
    const s = sim.S[sid];
    if (!s.alive || s.nextFoundTry > sim.year) continue;
    const C = sim.C[s.culture];
    const pressure = s.pop / s.cap;
    if (pressure < 0.6 || s.pop < 1200) {
      s.nextFoundTry = sim.year + rng.int(3, 8);
      continue;
    }
    const p = 0.25 * (0.4 + C.values.expansion) * clamp((pressure - 0.6) * 4, 0.2, 1.2);
    if (!rng.chance(p)) {
      s.nextFoundTry = sim.year + rng.int(1, 4);
      continue;
    }
    if (!foundDaughter(sim, s)) {
      if (!tryColony(sim, s)) s.nextFoundTry = sim.year + rng.int(25, 60);
      else s.nextFoundTry = sim.year + rng.int(10, 30);
    } else s.nextFoundTry = sim.year + rng.int(5, 15);
  }
}

function foundDaughter(sim: Sim, s: SetS): boolean {
  const rng = sim.rng.settle;
  const C = sim.C[s.culture];
  const owner = s.owner;
  const R = 300 + 50 * C.tech + (C.archetype === "steppe" ? 100 : 0);
  let best = -1;
  let bestScore = -Infinity;
  sim.search.run([s.cell], R, (c, d) => {
    if (c === s.cell || !isFreeSite(sim, c, owner)) return;
    const site = sim.g.site[c];
    if (site < 0.35) return;
    // Pastoral peoples keep to open country; farmers prefer fertile land.
    let sc = site - 0.0012 * d + rng.range(0, 0.35);
    if (C.archetype === "steppe") sc += sim.g.steppe[c] ? 0.4 : -0.3;
    if (sim.cellCulture[c] >= 0 && sim.cellCulture[c] !== s.culture) sc -= 0.25;
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  });
  if (best < 0) return false;
  const moved = Math.max(600, s.pop * rng.range(0.15, 0.25));
  s.pop -= moved * 0.7;
  const ruins = lastAt(sim)[best];
  foundSettlement(sim, best, s.culture, { pop: moved, owner: owner >= 0 && sim.P[owner].alive ? owner : -1, mother: s.id, ruinsOf: ruins >= 0 && !sim.S[ruins].alive ? ruins : -1 });
  return true;
}

function tryColony(sim: Sim, s: SetS): boolean {
  const C = sim.C[s.culture];
  if (!(sim.g.coastal[s.cell] || sim.g.lakeside[s.cell])) return false;
  if (C.tech < 0.8 && C.values.seafaring < 0.65) return false;
  const rng = sim.rng.settle;
  if (!rng.chance(0.08 + 0.5 * C.values.seafaring)) return false;
  const range = (120 + 500 * C.values.seafaring) * (1 + 0.55 * C.tech) * (C.tech >= 5.5 ? 3 : 1);
  const myLm = sim.w.landmassOf[s.cell];
  let best = -1, bestScore = -Infinity, bestD = 0;
  const owner = s.owner;
  sim.search.run([s.cell], range, (c, d) => {
    if (!sim.g.land[c] || c === s.cell) return;
    if (!isFreeSite(sim, c, owner)) return;
    const site = sim.g.site[c];
    if (site < 0.5) return;
    let sc = site - 0.0006 * d + rng.range(0, 0.4);
    if (sim.w.landmassOf[c] !== myLm) sc += 0.3;
    if (sim.cellCulture[c] >= 0) sc -= 0.4;
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
      bestD = d;
    }
  }, "sea");
  if (best < 0) return false;
  const moved = Math.max(400, s.pop * rng.range(0.08, 0.14));
  s.pop -= moved * 0.6;
  const lm = sim.w.landmassOf[best];
  const across = sim.w.lakeId[sim.g.shore[best]] >= 0 ? "lake" : "sea";
  const distanceKm = sim.distKm(s.cell, best);
  // Colonies stay under the mother realm if it can reach them, otherwise they are free.
  const keep = owner >= 0 && sim.P[owner].alive && C.tech >= 1.5 && distanceKm < 600 + 500 * C.tech;
  const ruins = lastAt(sim)[best];
  foundSettlement(sim, best, s.culture, {
    pop: moved, owner: keep ? owner : -1, mother: s.id, colony: lm !== myLm ? { across, landmass: lm, distanceKm } : undefined, ruinsOf: ruins >= 0 && !sim.S[ruins].alive ? ruins : -1,
  });
  void bestD;
  return true;
}

/** Initial hearth settlements of a founding people. */
export function seedHearth(sim: Sim, culture: number, cell: number): void {
  const rng = sim.rng.settle;
  const first = foundSettlement(sim, cell, culture, { pop: rng.range(3500, 5500), owner: -1, hearth: true });
  const n = rng.int(1, 3);
  const cands: { c: number; s: number }[] = [];
  sim.search.run([cell], 260, (c, d) => {
    if (c === cell || !isFreeSite(sim, c, -1) || sim.g.site[c] < 0.5) return;
    if (sim.C[culture].archetype !== "steppe" && sim.w.biome[c] === Biome.IceSheet) return;
    cands.push({ c, s: sim.g.site[c] - d * 0.002 + rng.range(0, 0.3) });
  });
  cands.sort((a, b) => b.s - a.s || a.c - b.c);
  let made = 0;
  for (const { c } of cands) {
    if (made >= n) break;
    if (!isFreeSite(sim, c, -1)) continue;
    foundSettlement(sim, c, culture, { pop: rng.range(1800, 3000), owner: -1, mother: first, hearth: true, quiet: false });
    made++;
  }
  void givenName;
}
