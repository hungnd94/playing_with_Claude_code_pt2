/**
 * Technology and writing. Each people's technology level rises through
 * invention in large, prosperous, connected towns and through diffusion from
 * more advanced neighbours and trade partners. Named inventions mark the way
 * (bronze, writing, iron, coinage, the compass, printing…).
 *
 * Writing is invented only a few times; other peoples borrow and adapt the
 * scripts of their contacts (src/script `adaptScript`), and daughter peoples'
 * scripts drift into local variants (`deriveScript`), so script family trees
 * mirror contact history.
 */
import { inventory } from "../lang/index";
import { adaptScript, createScript, deriveScript } from "../script/index";
import type { Script as SScript } from "../script/index";
import { newAdult, addRole } from "./people";
import type { CulS, Sim } from "./sim";
import type { Script } from "./types";
import { clamp } from "./util";

export interface TechDef {
  level: number;
  name: string;
  /** Only peoples with these archetypes/values bother (e.g. the sail). */
  sea?: boolean;
  /** Importance of the world-first invention. */
  imp: number;
}

export const TECHS: TechDef[] = [
  { level: 0.45, name: "the potter's wheel", imp: 2 },
  { level: 0.75, name: "the plough", imp: 3 },
  { level: 1.0, name: "bronze working", imp: 4 },
  { level: 1.4, name: "the sail", sea: true, imp: 3 },
  { level: 1.6, name: "the wheel and the chariot", imp: 3 },
  { level: 2.0, name: "writing", imp: 5 },
  { level: 2.5, name: "astronomy", imp: 3 },
  { level: 3.0, name: "iron working", imp: 4 },
  { level: 3.5, name: "the arch and the aqueduct", imp: 3 },
  { level: 4.0, name: "coinage", imp: 4 },
  { level: 4.3, name: "philosophy", imp: 3 },
  { level: 4.7, name: "the water mill", imp: 3 },
  { level: 5.0, name: "the heavy plough and the horse collar", imp: 4 },
  { level: 5.3, name: "the stirrup and the armoured horseman", imp: 3 },
  { level: 5.6, name: "the magnetic compass", sea: true, imp: 4 },
  { level: 5.85, name: "the printing press", imp: 5 },
  { level: 6.05, name: "gunpowder", imp: 4 },
  { level: 6.25, name: "ocean-going ships", sea: true, imp: 4 },
];

export const MAX_TECH = 6.4;

/** Refresh per-culture aggregates (towns, population, wealth, largest town). */
export function cultureAggregates(sim: Sim): void {
  for (const C of sim.C) {
    C.sets = 0;
    C.pop = 0;
    C.wealth = 0;
    C.bigCity = -1;
    C.bigUrban = 0;
  }
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    const C = sim.C[s.culture];
    C.sets++;
    C.pop += s.pop;
    C.wealth += s.wealth;
    if (s.urban > C.bigUrban) {
      C.bigUrban = s.urban;
      C.bigCity = sid;
    }
  }
  for (const C of sim.C) {
    if (C.sets) C.wealth /= C.sets;
    if (C.bigCity >= 0) C.core = sim.S[C.bigCity].cell;
  }
}

/** Cultures linked by trade routes (route endpoints of different cultures). */
function tradePartners(sim: Sim, c: number): number[] {
  const out = new Set<number>();
  for (const r of sim.h.tradeRoutes) {
    if (r.ended >= 0) continue;
    const a = sim.S[r.from], b = sim.S[r.to];
    if (a.culture === c && b.culture !== c) out.add(b.culture);
    if (b.culture === c && a.culture !== c) out.add(a.culture);
  }
  return [...out].sort((x, y) => x - y);
}

export function tickTech(sim: Sim): void {
  const year = sim.year;
  if (year % 5 === 0) cultureAggregates(sim);
  for (const C of sim.C) {
    if (!C.alive || !C.sets) continue;
    // Invention needs people, towns and wealth; later levels come harder.
    const f = clamp(Math.log10(C.pop / 20000), 0, 2.5) + 0.3 * clamp(Math.log10(Math.max(1, C.bigUrban) / 5000), 0, 1.5);
    let g = 0.00085 * (0.3 + f) * (1 + 0.6 * Math.min(1.5, C.wealth)) * Math.max(0.3, 1.25 - 0.14 * C.tech);
    if (C.script >= 0) g *= 1.2;
    // Diffusion from the most advanced contact.
    let best = -1, gap = 0;
    for (const o of C.contacts) {
      const d = sim.C[o].tech - C.tech;
      if (d > gap) {
        gap = d;
        best = o;
      }
    }
    if (year % 10 === 0) for (const o of tradePartners(sim, C.id)) {
      const d = sim.C[o].tech - C.tech;
      if (d > gap) {
        gap = d;
        best = o;
      }
    }
    if (gap > 0) g += 0.01 * gap * (C.values.mercantile * 0.5 + 0.5);
    C.tech = Math.min(MAX_TECH, C.tech + g);
    // Named inventions.
    while (C.nextTech < TECHS.length && C.tech >= TECHS[C.nextTech].level) {
      announce(sim, C, TECHS[C.nextTech], gap > 0.15 ? best : -1);
      C.nextTech++;
    }
    if (year % 10 === 0) sim.pushChange(C.rec.tech, { year, level: Math.round(C.tech * 100) / 100 }, (a, b) => a.level === b.level);
    // Writing.
    if (C.script < 0 && year % 5 === 0) considerWriting(sim, C);
  }
}

function announce(sim: Sim, C: CulS, t: TechDef, from: number): void {
  const key = `tech:${t.name}`;
  const first = !sim.flags.has(key);
  sim.flags.add(key);
  if (t.name === "writing") return; // announced by the script events
  if (t.sea && C.values.seafaring < 0.35 && !first) return;
  const city = C.bigCity;
  const cell = city >= 0 ? sim.S[city].cell : C.core;
  if (first || from < 0) {
    let person = -1;
    if (first && city >= 0 && t.imp >= 4) {
      const owner = sim.S[city].owner;
      const p = newAdult(sim, C.id, owner, 30, 55, { bias: { scholarly: 4, wise: 2 } });
      addRole(sim, p.id, "scholar", owner);
      person = p.id;
    }
    sim.emit("invention", first ? t.imp : 2, cell, { cultures: [C.id], settlements: [city], persons: [person], polities: [city >= 0 ? sim.S[city].owner : -1] }, {
      tech: t.name, level: t.level, culture: C.id, settlement: city, person, first,
    });
  } else {
    sim.emit("techSpread", t.imp >= 4 ? 2 : 1, cell, { cultures: [C.id, from] }, { tech: t.name, level: t.level, culture: C.id, from });
  }
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

function scriptName(sim: Sim, C: CulS, kind: string, how: Script["how"]): string {
  const adj = C.rec.adjective;
  const k = kind === "alphabet" ? "alphabet" : kind === "abjad" ? "abjad" : kind === "abugida" ? "script" : kind === "syllabary" ? "syllabary" : "script";
  const base = how === "derived" ? `${adj} ${k}` : how === "adapted" ? `${adj} ${k}` : `${adj} ${k}`;
  // Avoid exact duplicates.
  let name = base;
  let i = 2;
  while (sim.h.scripts.some((s) => s.name === name)) name = `${base} (${["", "", "second", "third", "fourth", "fifth"][i++] ?? i} form)`;
  return name;
}

export function addScript(sim: Sim, data: SScript, C: CulS, parent: number, how: Script["how"], origin: number): number {
  const id = sim.h.scripts.length;
  const rec: Script = { id, name: scriptName(sim, C, data.kind, how), kind: data.kind, parent, children: [], born: sim.year, culture: C.id, how, origin, data };
  sim.h.scripts.push(rec);
  if (parent >= 0) sim.h.scripts[parent].children.push(id);
  return id;
}

export function setScript(sim: Sim, C: CulS, script: number): void {
  C.script = script;
  sim.pushChange(C.rec.scripts, { year: sim.year, script }, (a, b) => a.script === b.script);
}

function considerWriting(sim: Sim, C: CulS): void {
  const rng = sim.rng.script;
  if (C.tech < 1.5) return;
  // Borrow from a literate contact.
  let src = -1, bt = -Infinity;
  const contacts = [...C.contacts, ...tradePartners(sim, C.id)];
  for (const o of contacts) {
    const O = sim.C[o];
    if (O.script < 0) continue;
    const sc = O.tech + (sim.familyOf(o) === sim.familyOf(C.id) ? 1 : 0) + rng.range(0, 0.5);
    if (sc > bt) {
      bt = sc;
      src = o;
    }
  }
  if (src >= 0 && rng.chance(C.tech >= 2 ? 0.35 : 0.08)) {
    const O = sim.C[src];
    const parent = O.script;
    let sid = parent;
    const sameFamily = sim.familyOf(src) === sim.familyOf(C.id);
    if (!sameFamily && sim.h.scripts.length < 12) {
      const pdata = sim.h.scripts[parent].data as SScript;
      const data = adaptScript(pdata, inventory(C.lang), rng.fork(`adapt${sim.h.scripts.length}`), { id: `S${sim.h.scripts.length}`, bornYear: sim.year });
      sid = addScript(sim, data, C, parent, "adapted", C.bigCity);
    }
    setScript(sim, C, sid);
    const via = sim.S[C.bigCity]?.owner >= 0 && sim.P[sim.S[C.bigCity].owner].culture === src ? "conquest" : tradePartners(sim, C.id).includes(src) ? "trade" : "neighbours";
    sim.emit("scriptAdopted", 3, C.core, { cultures: [C.id, src], scripts: [sid, parent], settlements: [C.bigCity] }, { script: sid, source: parent, culture: C.id, via });
    return;
  }
  // Invent: only in a big town, and only a few times in the world.
  const n = sim.counters.inventions ?? 0;
  if (C.tech < 2 || C.bigUrban < 4000 || n >= 3) return;
  if (!rng.chance(n === 0 ? 0.25 : 0.06)) return;
  sim.counters.inventions = n + 1;
  const data = createScript(inventory(C.lang), rng.fork(`invent${sim.h.scripts.length}`), { id: `S${sim.h.scripts.length}`, bornYear: sim.year });
  const sid = addScript(sim, data, C, -1, "invented", C.bigCity);
  setScript(sim, C, sid);
  const owner = sim.S[C.bigCity].owner;
  const scribe = newAdult(sim, C.id, owner, 25, 50, { bias: { scholarly: 4 } });
  addRole(sim, scribe.id, "scholar", owner);
  sim.emit("scriptInvented", 5, sim.S[C.bigCity].cell, { cultures: [C.id], scripts: [sid], settlements: [C.bigCity], persons: [scribe.id], polities: [owner] }, {
    script: sid, culture: C.id, settlement: C.bigCity, person: scribe.id,
  });
}

/** A literate people's script drifts into a local variant (after a split or a language stage). */
export function deriveLocalScript(sim: Sim, C: CulS, drift: number): void {
  if (C.script < 0 || sim.h.scripts.length >= 10) return;
  const rng = sim.rng.script;
  const parent = C.script;
  const pdata = sim.h.scripts[parent].data as SScript;
  const data = deriveScript(pdata, rng.fork(`derive${sim.h.scripts.length}`), { id: `S${sim.h.scripts.length}`, bornYear: sim.year, inventory: inventory(C.lang), drift });
  const sid = addScript(sim, data, C, parent, "derived", C.bigCity);
  setScript(sim, C, sid);
  sim.emit("scriptAdopted", 2, C.core, { cultures: [C.id], scripts: [sid, parent] }, { script: sid, source: parent, culture: C.id, via: "neighbours" });
}
