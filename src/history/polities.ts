/**
 * Realms: formation of chiefdoms and kingdoms from clusters of settlements,
 * membership and strength, provinces, government changes, loyalty and
 * revolts, vassalage, unions, and the collapse of overstretched realms into
 * successor states.
 */
import { makeEmblem, emblemTints, emblemArms } from "./emblems";
import { generateFlag } from "../heraldry/flag";
import type { Arms } from "../heraldry/types";
import { siteConcepts } from "./names";
import type { LName } from "./names";
import { accede, newAdult, newDynasty, endReign, succeed, killPerson, tracksFamilies, addRole } from "./people";
import type { PolS, SetS, Sim } from "./sim";
import type { EventData, Government, Polity, RGB, SuccessionLaw } from "./types";
import { clamp, hsl, remove } from "./util";
import { startWar, endWarsOf } from "./war";
import { conquestRename } from "./divergence";

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/** Administrative reach (travel cost from the capital a realm can hold firmly). */
export function reach(sim: Sim, P: PolS): number {
  const C = sim.C[P.culture];
  const t = C.tech;
  // A chief rules the villages within a few days' walk; kings rule through
  // officials and roads, so reach grows with the state as much as with tools.
  if (P.gov === "tribe" || P.gov === "chiefdom") return (300 + 160 * t) * (C.archetype === "steppe" ? 1.5 : 1);
  let r = 650 + 300 * t;
  if (P.gov === "empire") r *= 1.25;
  if (P.gov === "horde") r *= 1.4;
  if (P.gov === "cityState") r *= 0.6;
  return r;
}

/** Estimated travel cost from P's capital to a site next to settlement `via` (for new or drifting towns). */
export function estCapDist(sim: Sim, via: number, cell: number): number {
  const v = sim.S[via];
  return v.capDist + sim.distKm(v.cell, cell) * 1.25;
}

/** Fraction of district population under arms. */
function mobilisation(sim: Sim, P: PolS): number {
  const C = sim.C[P.culture];
  let m = (0.012 + 0.006 * C.tech) * (0.6 + 0.8 * C.values.martial);
  if (C.archetype === "steppe") m *= 1.8;
  if (P.gov === "horde") m *= 1.3;
  return m;
}

export function capitalCell(sim: Sim, P: PolS): number {
  return P.capital >= 0 ? sim.S[P.capital].cell : -1;
}

/** Independent realms only. */
export function independent(P: PolS): boolean {
  return P.alive && P.overlord < 0;
}

// ---------------------------------------------------------------------------
// Names and colours
// ---------------------------------------------------------------------------

export function realmName(sim: Sim, culture: number, capital: number, how: string, founder = -1): LName {
  const rng = sim.rng.polity;
  const C = sim.C[culture];
  const s = sim.S[capital];
  const site = siteConcepts(sim, s.cell);
  const feature = site.find((x) => ["river", "mountain", "forest", "sea", "lake", "hill", "marsh", "island", "valley", "coast"].includes(x));
  const firstOfPeople = !sim.P.some((p) => p.rec.culture === culture);
  const taken = new Set<string>();
  for (const P of sim.P) if (P.alive) taken.add(P.name.roman);
  const r = rng.next();
  if (r < 0.22 && how !== "faction" && !taken.has(s.name.roman)) return s.name; // named after its capital, like a city-state
  let n: LName = s.name;
  for (let i = 0; i < 4; i++) {
    n = sim.names.realm(C.lang, rng, {
      people: (firstOfPeople && i === 0) || rng.chance(0.12) ? (C.rec.name as unknown as LName) : undefined,
      capital: s.name,
      feature,
      founder: founder >= 0 && rng.chance(0.3) ? (sim.Pe[founder].rec.name as unknown as LName) : undefined,
    });
    if (!taken.has(n.roman)) break;
  }
  return n;
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** A colour distinct from nearby realms'. */
export function pickColor(sim: Sim, cell: number, culture: number): RGB {
  const rng = sim.rng.polity;
  const near: { h: number; l: number }[] = [];
  for (const P of sim.P) {
    if (!P.alive || P.capital < 0) continue;
    if (sim.distKm(sim.S[P.capital].cell, cell) > 2600) continue;
    near.push(hsv(P.color));
  }
  let best: RGB = hsl(rng.range(0, 360), 0.55, 0.55);
  let bs = -Infinity;
  const base = (culture * 47) % 360;
  for (let i = 0; i < 14; i++) {
    const h = (base + rng.range(-150, 150) + 360) % 360;
    const l = rng.range(0.42, 0.66);
    const s = rng.range(0.42, 0.68);
    let md = 999;
    for (const q of near) md = Math.min(md, hueDist(h, q.h) + 120 * Math.abs(l - q.l));
    if (md > bs) {
      bs = md;
      best = hsl(h, s, l);
    }
  }
  return best;
}

function hsv(c: RGB): { h: number; l: number } {
  const [r, g, b] = c.map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, l };
}

// ---------------------------------------------------------------------------
// Creation and end
// ---------------------------------------------------------------------------

export interface NewPolity {
  capital: number;
  culture: number;
  gov: Government;
  how: EventData["polityFounded"]["how"];
  parent: number;
  /** Settlements joining at once (the capital is always included). */
  members?: number[];
  /** Existing person to rule (else a founder is created). */
  ruler?: number;
  /** Ruler accedes by this route (default "founding"). */
  rulerHow?: "founding" | "claim" | "restoration";
  name?: LName;
  /** Make the new ruler's house a cadet branch of this dynasty. */
  cadetOf?: number;
  overlord?: number;
  rebel?: boolean;
  importance?: number;
  quiet?: boolean;
}

export function lawForGov(sim: Sim, culture: number, gov: Government): SuccessionLaw {
  if (gov === "republic") return "election";
  if (gov === "theocracy") return "appointment";
  if (gov === "horde" || gov === "tribe") return sim.C[culture].archetype === "steppe" ? "tanistry" : sim.C[culture].law === "primogeniture" ? "tanistry" : sim.C[culture].law;
  return sim.C[culture].law;
}

export function createPolity(sim: Sim, o: NewPolity): PolS {
  const rng = sim.rng.polity;
  const id = sim.P.length;
  const C = sim.C[o.culture];
  const cap = sim.S[o.capital];
  const name = o.name ?? realmName(sim, o.culture, o.capital, o.how, o.ruler ?? -1);
  const law = lawForGov(sim, o.culture, o.gov);
  const religion = cap.religion;
  const color = pickColor(sim, cap.cell, o.culture);
  const gloss = name.gloss ? [name.gloss] : [];
  const relSym = religion >= 0 ? sim.h.religions[religion].symbol : undefined;
  const liege = o.overlord !== undefined && o.overlord >= 0 ? sim.P[o.overlord] : o.parent >= 0 && o.how === "colony" ? sim.P[o.parent] : undefined;
  const emblem = makeEmblem(rng.fork(`arms${id}`), { style: C.style, kind: C.rec.heraldicStyle, gloss, symbol: rng.chance(0.35) ? relSym : undefined, colours: liege ? emblemTints(liege.rec.emblem) : undefined, legend: name.roman });
  const rec: Polity = {
    id, names: [{ year: sim.year, name: name as never, reason: "founded" }], governments: [{ year: sim.year, gov: o.gov }], succession: [{ year: sim.year, law }],
    founded: sim.year, ended: -1, founder: -1, predecessors: o.parent >= 0 ? [o.parent] : [], successors: [], capitals: [{ year: sim.year, settlement: o.capital }],
    culture: o.culture, cultures: [{ year: sim.year, culture: o.culture }], religions: [{ year: sim.year, religion }], rulers: [], overlords: [{ year: sim.year, overlord: o.overlord ?? -1 }],
    emblem, color, wars: [], statStart: Math.ceil(sim.year / sim.h.sampleStep), stats: { pop: [], areaKm2: [], settlements: [], strength: [] }, peak: { areaKm2: 0, year: sim.year },
  };
  if (o.gov !== "tribe" && rng.chance(0.75)) rec.motto = sim.names.motto(C.lang, rng);
  if (o.gov !== "tribe" && o.gov !== "chiefdom") rec.flag = makeFlag(sim, emblemArms(emblem), C.style.name, id);
  if (o.parent >= 0) sim.h.polities[o.parent].successors.push(id);
  sim.h.polities.push(rec);
  const P: PolS = {
    id, rec, alive: true, culture: o.culture, capital: o.capital, gov: o.gov, law, ruler: -1, heir: -1, dynasty: -1, religion, overlord: o.overlord ?? -1, unionWith: -1,
    legitimacy: 0.7, prestige: 0, treasury: 0, warWeariness: 0, sets: [], provinces: new Map(), pop: 0, strength: 0, cells: 0, area: 0, allies: [], truces: new Map(),
    claims: new Map(), grudges: new Map(), ties: new Map(), wars: [], name, color, lastSuccession: sim.year, rebel: !!o.rebel, crisis: 0, goldenAge: 0, regent: -1, regentUntil: 0,
    cohesion: o.how === "chiefdom" ? 0.95 : 1.05, decay: rng.range(0.55, 1.45),
    founded: sim.year, revolts: 0, lastWonder: sim.year, lastWar: -999, govSince: sim.year, conquests: 0, peakStrength: 0, cultureMix: new Map(), absorbed: [],
  };
  sim.P.push(P);
  // Territory.
  const members = new Set([o.capital, ...(o.members ?? [])]);
  for (const sid of members) {
    const s = sim.S[sid];
    if (!s.alive) continue;
    const prev = s.owner;
    if (prev >= 0 && prev !== id) {
      const Q = sim.P[prev];
      if (Q.alive) Q.claims.set(sid, sim.year);
    }
    sim.setOwner(s, id);
    s.loyalty = Math.max(s.loyalty, 0.75);
    s.seat = o.capital;
  }
  P.provinces.set(o.capital, [...members].filter((x) => sim.S[x].alive).sort((a, b) => a - b));
  rebuildOne(sim, P);
  // Ruler.
  let ruler = o.ruler ?? -1;
  if (ruler < 0) {
    const female = rng.chance(0.04);
    ruler = newAdult(sim, o.culture, id, 24, 48, { sex: female ? "f" : "m", religion, dist: 0, bias: { ambitious: 1.8, brave: 1.4, charismatic: 1.4 } }).id;
  }
  rec.founder = ruler;
  addRole(sim, ruler, "founder", id);
  const rp = sim.Pe[ruler];
  if (o.gov !== "republic" && o.gov !== "theocracy" && (rp.rec.dynasty < 0 || o.cadetOf !== undefined)) newDynasty(sim, ruler, id, o.cadetOf ?? -1);
  if (o.how !== "faction" && o.how !== "rebellion" && !o.quiet) {
    const imp = o.importance ?? (o.gov === "chiefdom" || o.gov === "tribe" ? 2 : 3);
    sim.emit("polityFounded", imp, cap.cell, { polities: [id, o.parent], settlements: [o.capital], persons: [ruler], cultures: [o.culture] }, {
      polity: id, capital: o.capital, founder: ruler, gov: o.gov, culture: o.culture, how: o.how, parent: o.parent,
    });
  } else if (!o.quiet) {
    sim.emit("polityFounded", Math.min(2, o.importance ?? 2), cap.cell, { polities: [id, o.parent], settlements: [o.capital], persons: [ruler], cultures: [o.culture] }, {
      polity: id, capital: o.capital, founder: ruler, gov: o.gov, culture: o.culture, how: o.how, parent: o.parent,
    });
  }
  accede(sim, P, ruler, o.rulerHow ?? "founding", -1, true);
  return P;
}

function makeFlag(sim: Sim, arms: Arms | undefined, style: string, id: number): unknown {
  try {
    return generateFlag(sim.rng.emblems.fork(`flag${id}`), { arms, style: style as never });
  } catch {
    return undefined;
  }
}

/** End a polity: its towns must already have passed to others (or are released as free towns). */
export function endPolity(sim: Sim, P: PolS, reason: NonNullable<Polity["endReason"]>, by = -1): void {
  if (!P.alive) return;
  P.alive = false;
  P.rec.ended = sim.year;
  P.rec.endReason = reason;
  if (by >= 0 && !P.rec.successors.includes(by)) P.rec.successors.push(by);
  if (by >= 0 && !sim.h.polities[by].predecessors.includes(P.id)) sim.h.polities[by].predecessors.push(P.id);
  for (const sid of P.sets) {
    const s = sim.S[sid];
    if (s.alive && s.owner === P.id) sim.setOwner(s, by >= 0 && sim.P[by].alive ? by : -1);
  }
  P.sets = [];
  if (P.ruler >= 0) {
    const r = P.ruler;
    endReign(sim, P, r);
  }
  if (P.regent >= 0) P.regent = -1;
  if (P.heir >= 0) P.heir = -1;
  endWarsOf(sim, P.id);
  for (const a of P.allies) remove(sim.P[a].allies, P.id);
  P.allies = [];
  for (const Q of sim.P) {
    if (!Q.alive) continue;
    if (Q.overlord === P.id) {
      sim.setOverlord(Q, -1);
      sim.emit("vassalFreed", 2, capitalCell(sim, Q), { polities: [Q.id, P.id] }, { vassal: Q.id, overlord: P.id, reason: "overlordFell" });
    }
    if (Q.unionWith === P.id) Q.unionWith = -1;
  }
  if (P.unionWith >= 0) P.unionWith = -1;
  sim.setOverlord(P, -1);
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** Move a settlement to another realm. */
export function transfer(sim: Sim, sid: number, to: number, conquest: boolean): void {
  const s = sim.S[sid];
  const from = s.owner;
  if (from === to) {
    s.occupier = -1;
    return;
  }
  if (from >= 0) {
    const F = sim.P[from];
    F.claims.set(sid, sim.year);
    remove(F.sets, sid);
    const pv = F.provinces.get(s.seat);
    if (pv) remove(pv, sid);
    if (F.ruler >= 0 && conquest) {
      const r = sim.Pe[F.ruler];
      r.tally.lostSets = (r.tally.lostSets ?? 0) + 1;
    }
  }
  sim.setOwner(s, to);
  s.seat = sid;
  if (to >= 0) {
    const T = sim.P[to];
    T.claims.delete(sid);
    if (!T.sets.includes(sid)) T.sets.push(sid);
    if (conquest) conquestRename(sim, sid, to);
    if (conquest) {
      s.loyalty = Math.min(s.loyalty, 0.35);
      T.conquests++;
      if (T.ruler >= 0) {
        const r = sim.Pe[T.ruler];
        r.tally.conq = (r.tally.conq ?? 0) + 1;
      }
    }
  }
  if (from >= 0 && sim.P[from].capital === sid) sim.P[from].capital = -2;
}

/** Rebuild membership lists, population and strength of all realms (yearly). */
export function rebuildMembership(sim: Sim): void {
  const mix = sim.year % 10 === 5;
  for (const P of sim.P) if (P.alive) {
    P.sets = [];
    P.pop = 0;
    if (mix) P.cultureMix.clear();
  }
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    if (s.owner < 0) continue;
    const P = sim.P[s.owner];
    if (!P.alive) {
      sim.setOwner(s, -1);
      continue;
    }
    P.sets.push(sid);
    P.pop += s.pop;
    if (mix) P.cultureMix.set(s.culture, (P.cultureMix.get(s.culture) ?? 0) + s.pop);
  }
  for (const P of sim.P) {
    if (!P.alive) continue;
    if (!P.sets.length) {
      endPolity(sim, P, P.rebel ? "dissolved" : "extinct");
      continue;
    }
    if (P.capital < 0 || !sim.S[P.capital].alive || sim.S[P.capital].owner !== P.id) relocateCapital(sim, P, "lost");
    strengthOf(sim, P);
  }
  // Vassals add half their strength to their overlord's.
  for (const P of sim.P) if (P.alive && P.overlord >= 0 && sim.P[P.overlord].alive) sim.P[P.overlord].strength += 0.4 * P.strength;
}

function rebuildOne(sim: Sim, P: PolS): void {
  P.sets = [];
  P.pop = 0;
  for (const sid of sim.alive()) if (sim.S[sid].owner === P.id) {
    P.sets.push(sid);
    P.pop += sim.S[sid].pop;
  }
  strengthOf(sim, P);
}

function strengthOf(sim: Sim, P: PolS): void {
  const m = mobilisation(sim, P);
  const R = reach(sim, P);
  let st = 0;
  for (const sid of P.sets) {
    const s = sim.S[sid];
    const far = 1 / (1 + Math.max(0, s.capDist / R - 0.5));
    st += s.pop * m * (0.45 + 0.55 * s.loyalty) * far * (s.occupier >= 0 ? 0.2 : 1);
  }
  if (P.ruler >= 0) st *= 0.85 + 0.3 * sim.Pe[P.ruler].martial;
  st *= 0.55 + 0.5 * P.cohesion;
  st *= 1 - 0.35 * Math.min(1, P.warWeariness);
  P.strength = st;
  if (st > P.peakStrength) P.peakStrength = st;
}

export function relocateCapital(sim: Sim, P: PolS, reason: EventData["capitalMoved"]["reason"]): void {
  const old = P.capital;
  let best = -1, bs = -Infinity;
  for (const sid of P.sets) {
    const s = sim.S[sid];
    if (s.occupier >= 0) continue;
    const sc = s.urban * (s.culture === P.culture ? 1.5 : 1);
    if (sc > bs) {
      bs = sc;
      best = sid;
    }
  }
  if (best < 0) best = P.sets[0];
  if (best === undefined || best < 0) return;
  sim.setCapital(P, best);
  if (old >= 0 && old !== best) {
    sim.emit("capitalMoved", P.sets.length >= 8 ? 3 : 2, sim.S[best].cell, { polities: [P.id], settlements: [old, best] }, { polity: P.id, from: old, to: best, reason });
  }
}

// ---------------------------------------------------------------------------
// Provinces
// ---------------------------------------------------------------------------

/** Group each realm's towns into provinces around their largest towns (every 10 years). */
export function computeProvinces(sim: Sim): void {
  const S = sim.S;
  for (const P of sim.P) {
    if (!P.alive) continue;
    P.provinces.clear();
    const order = P.sets.slice().sort((a, b) => (b === P.capital ? 1 : 0) - (a === P.capital ? 1 : 0) || S[b].urban - S[a].urban || a - b);
    const assigned = new Set<number>();
    for (const seat of order) {
      if (assigned.has(seat)) continue;
      const members = [seat];
      assigned.add(seat);
      // Breadth-first over same-owner neighbours, two rings, at most 9 towns.
      let frontier = [seat];
      for (let ring = 0; ring < 2 && members.length < 9; ring++) {
        const next: number[] = [];
        for (const a of frontier) for (const b of S[a].nbrs) {
          if (members.length >= 9) break;
          if (assigned.has(b) || !S[b].alive || S[b].owner !== P.id) continue;
          if (S[b].urban > S[seat].urban * 0.8 && b !== seat && ring > 0) continue;
          assigned.add(b);
          members.push(b);
          next.push(b);
        }
        frontier = next;
      }
      members.sort((x, y) => x - y);
      for (const m of members) S[m].seat = seat;
      P.provinces.set(seat, members);
    }
  }
  for (const sid of sim.alive()) if (S[sid].owner < 0) S[sid].seat = sid;
}

/** Members of the province containing `sid` (same owner). */
export function provinceOf(sim: Sim, sid: number): number[] {
  const s = sim.S[sid];
  if (s.owner < 0) return [sid];
  const pv = sim.P[s.owner].provinces.get(s.seat);
  if (!pv) return [sid];
  const out = pv.filter((x) => sim.S[x].alive && sim.S[x].owner === s.owner);
  if (!out.includes(sid)) out.push(sid);
  return out;
}

// ---------------------------------------------------------------------------
// Formation and peaceful growth
// ---------------------------------------------------------------------------

function formPolities(sim: Sim): void {
  const rng = sim.rng.polity;
  for (const sid of sim.alive().slice()) {
    const s = sim.S[sid];
    if (!s.alive || s.owner >= 0) continue;
    const C = sim.C[s.culture];
    const steppe = C.archetype === "steppe";
    const need = Math.max(1600, 3600 - 1200 * Math.min(1.5, C.tech));
    if (s.pop < need) continue;
    const p = 0.02 + 0.07 * Math.min(1, C.tech + 0.15) + (sim.year > 400 ? 0.05 : 0);
    if (!rng.chance(p)) continue;
    const R = 240 + 90 * C.tech + (steppe ? 180 : 0);
    const members: number[] = [];
    sim.search.run([s.cell], R, (c) => {
      const t = sim.setAt[c];
      if (t >= 0 && t !== sid && sim.S[t].owner < 0 && sim.S[t].culture === s.culture) members.push(t);
    });
    if (!members.length && sim.year < 600) continue;
    const gov: Government = steppe ? (C.tech >= 1 && members.length >= 3 ? "horde" : "tribe") : C.tech >= 1.1 && members.length >= 4 ? "kingdom" : "chiefdom";
    createPolity(sim, { capital: sid, culture: s.culture, gov, how: "chiefdom", parent: -1, members, importance: gov === "kingdom" || gov === "horde" ? 3 : 2 });
  }
}

/** Free towns next to a realm drift into it (tribute, protection, kinship). */
function integrate(sim: Sim): void {
  const rng = sim.rng.polity;
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    if (s.owner >= 0) continue;
    let best = -1, bs = 0;
    for (const n of s.nbrs) {
      const o = sim.S[n].owner;
      if (o < 0 || !sim.P[o].alive) continue;
      const P = sim.P[o];
      // Only towns the realm could govern drift into it.
      if (estCapDist(sim, n, s.cell) > reach(sim, P)) continue;
      const k = sim.S[n].culture === s.culture ? 1 : sim.familyOf(sim.S[n].culture) === sim.familyOf(s.culture) ? 0.5 : 0.25;
      const sc = k * Math.log(2 + P.strength);
      if (sc > bs) {
        bs = sc;
        best = o;
      }
    }
    if (best >= 0 && rng.chance(Math.min(0.5, 0.025 * bs))) {
      transfer(sim, sid, best, false);
      s.capDist = estCapDist(sim, s.nbrs.find((n) => sim.S[n].owner === best) ?? sid, s.cell);
    }
  }
}

// ---------------------------------------------------------------------------
// Government
// ---------------------------------------------------------------------------

function changeGov(sim: Sim, P: PolS, to: Government, reason: string, imp = 3): void {
  const from = P.gov;
  if (from === to) return;
  sim.setGov(P, to);
  P.govSince = sim.year;
  const law = lawForGov(sim, P.culture, to);
  if (law !== P.law) sim.setLaw(P, law);
  sim.emit("governmentChanged", imp, capitalCell(sim, P), { polities: [P.id], persons: [P.ruler] }, { polity: P.id, from, to, reason });
  // Kingship brings arms and a flag if the realm had none worth the name.
  if (!P.rec.flag && to !== "tribe" && to !== "chiefdom") P.rec.flag = makeFlag(sim, emblemArms(P.rec.emblem), sim.C[P.culture].style.name, P.id);
}

function considerGovernment(sim: Sim, P: PolS): void {
  const rng = sim.rng.polity;
  const C = sim.C[P.culture];
  const n = P.sets.length;
  const t = C.tech;
  if (sim.year - P.govSince < 20) return;
  // Diversity of peoples.
  let foreign = 0;
  for (const [c, pop] of P.cultureMix) if (c !== P.culture) foreign += pop;
  const diverse = P.pop > 0 ? foreign / P.pop : 0;
  const capUrban = P.capital >= 0 ? sim.S[P.capital].urban : 0;
  switch (P.gov) {
    case "tribe":
      if (C.archetype === "steppe") {
        if (t >= 0.8 && n >= 4) changeGov(sim, P, "horde", "the clans swore to one khan", 2);
      } else if (t >= 0.5 && n >= 3) changeGov(sim, P, "chiefdom", "a paramount chief rose over the villages", 2);
      break;
    case "chiefdom":
      if (t >= 1 && (n >= 5 || P.pop > 40000)) changeGov(sim, P, "kingdom", "its chief took the title of king", n >= 12 ? 3 : 2);
      break;
    case "horde":
      if (n >= 30 && diverse > 0.35 && t >= 2) changeGov(sim, P, "empire", "conquest of settled peoples", 4);
      else if (n >= 10 && diverse > 0.5 && rng.chance(0.3)) changeGov(sim, P, "kingdom", "the khans settled among their subjects", 3);
      break;
    case "kingdom":
    case "principality":
      if (P.overlord >= 0) {
        if (P.gov === "kingdom" && rng.chance(0.5)) changeGov(sim, P, "principality", "vassalage", 2);
        break;
      }
      if (P.gov === "principality") {
        changeGov(sim, P, "kingdom", "independence", 2);
        break;
      }
      if (t >= 2 && (n >= 45 || (n >= 25 && diverse > 0.3)) && P.conquests >= 8) {
        changeGov(sim, P, "empire", diverse > 0.3 ? "rule over many peoples" : "its conquests", 4);
        break;
      }
      if (C.values.mercantile > 0.55 && t >= 2.5 && n <= 6 && capUrban > 12000 && rng.chance(0.25)) {
        changeGov(sim, P, rng.chance(0.5) ? "republic" : "cityState", "the merchant families took power", 3);
        break;
      }
      if (P.religion >= 0 && sim.R[P.religion]?.organised && sim.R[P.religion].rec.holyCity >= 0 && sim.S[sim.R[P.religion].rec.holyCity].owner === P.id && C.values.piety > 0.6 && n <= 20 && rng.chance(0.15)) {
        changeGov(sim, P, "theocracy", "the priests of the holy city took power", 3);
      }
      break;
    case "empire":
      if (n < 18) changeGov(sim, P, "kingdom", "the loss of its provinces", 3);
      break;
    case "cityState":
      if (n >= 8) changeGov(sim, P, "kingdom", "its conquests", 2);
      else if (t >= 3 && C.values.mercantile > 0.5 && rng.chance(0.2)) changeGov(sim, P, "republic", "the guilds and merchants seized the council", 3);
      break;
    case "republic":
      if (n >= 30 && rng.chance(0.25)) changeGov(sim, P, "empire", "a victorious general crowned himself", 4);
      else if (P.crisis > 3 && rng.chance(0.2)) {
        changeGov(sim, P, "kingdom", "a strongman ended the republic", 3);
        const r = P.ruler;
        if (r >= 0) {
          const pe = sim.Pe[r];
          if (pe.rec.dynasty < 0) newDynasty(sim, r, P.id);
        }
      }
      break;
    case "theocracy":
      if (P.crisis > 3 && rng.chance(0.25)) changeGov(sim, P, "kingdom", "the nobles overthrew the priests", 3);
      break;
    case "confederation":
      if (n >= 12 && t >= 1.5 && rng.chance(0.2)) changeGov(sim, P, "kingdom", "the confederate chiefs elected a king for life", 3);
      break;
  }
}

// ---------------------------------------------------------------------------
// Loyalty, revolts, collapse
// ---------------------------------------------------------------------------

function updateLoyalty(sim: Sim, P: PolS): void {
  const R = reach(sim, P);
  const ruler = P.ruler >= 0 ? sim.Pe[P.ruler].rec : undefined;
  const has = (t: string) => !!ruler && ruler.traits.includes(t as never);
  let rulerMod = (has("just") ? 0.04 : 0) + (has("kind") ? 0.03 : 0) + (has("charismatic") ? 0.04 : 0) - (has("cruel") ? 0.05 : 0) - (has("mad") ? 0.08 : 0) - (has("greedy") ? 0.03 : 0);
  rulerMod += (P.legitimacy - 0.6) * 0.2;
  rulerMod += (P.cohesion - 0.6) * 0.3;
  if (P.regent >= 0) rulerMod -= 0.04;
  if (P.goldenAge > sim.year) rulerMod += 0.06;
  const stateRel = P.religion;
  const organised = stateRel >= 0 && !!sim.R[stateRel]?.organised;
  for (const sid of P.sets) {
    const s = sim.S[sid];
    let t = 0.84;
    const d = s.capDist / R;
    t -= 0.32 * Math.max(0, d - 0.45);
    if (s.culture !== P.culture) t -= sim.familyOf(s.culture) === sim.familyOf(P.culture) ? 0.08 : 0.2;
    if (s.religion !== stateRel) {
      const sr = sim.R[s.religion];
      t -= organised && sr?.organised ? 0.16 : organised || sr?.organised ? 0.08 : 0.03;
    }
    t -= 0.25 * Math.max(0, 1 - (sim.year - s.ownerSince) / 60) * (s.culture === P.culture ? 0.5 : 1);
    t -= 0.15 * Math.min(1.5, P.warWeariness);
    t -= 0.2 * s.devast;
    t += rulerMod;
    if (P.gov === "empire") t -= 0.03;
    if (P.gov === "tribe" || P.gov === "chiefdom") t += 0.05;
    if (sid === P.capital) t = Math.max(t, 0.9);
    s.loyaltyTarget = clamp(t, 0, 1);
    s.loyalty += (s.loyaltyTarget - s.loyalty) * 0.35;
  }
}

function checkRevolts(sim: Sim, P: PolS): void {
  const rng = sim.rng.polity;
  if (P.provinces.size < 2 || P.rebel) return;
  if (P.wars.some((w) => sim.W[w].active && sim.W[w].rebels >= 0 && sim.W[w].def === P.id)) return;
  for (const [seat, members] of P.provinces) {
    if (seat === P.capital) continue;
    const live = members.filter((m) => sim.S[m].alive && sim.S[m].owner === P.id && sim.S[m].occupier < 0);
    if (!live.length || live.includes(P.capital)) continue;
    let L = 0, w = 0;
    for (const m of live) {
      L += sim.S[m].loyalty * sim.S[m].pop;
      w += sim.S[m].pop;
    }
    L /= w || 1;
    if (L >= 0.33) continue;
    if (sim.year - sim.S[seat].lastRevolt < 40) continue;
    // Revolts break out when the centre is distracted or weak.
    const distracted = P.wars.some((wid) => sim.W[wid].active) || P.crisis > 3 || P.regent >= 0 || P.lastSuccession > sim.year - 3;
    if (!rng.chance((0.33 - L) * (distracted ? 1.2 : 0.4))) continue;
    // Neighbouring disaffected provinces join.
    const rebelsSet = new Set(live);
    const seatS = sim.S[seat];
    for (const [s2, m2] of P.provinces) {
      if (s2 === seat || s2 === P.capital || rebelsSet.size > 40) continue;
      const s2s = sim.S[s2];
      if (!s2s.alive || s2s.culture !== seatS.culture) continue;
      let l2 = 0, w2 = 0;
      for (const m of m2) if (sim.S[m].alive && sim.S[m].owner === P.id) {
        l2 += sim.S[m].loyalty * sim.S[m].pop;
        w2 += sim.S[m].pop;
      }
      if (w2 > 0 && l2 / w2 < 0.42 && sim.distKm(seatS.cell, s2s.cell) < 900) for (const m of m2) if (sim.S[m].alive && sim.S[m].owner === P.id && m !== P.capital) rebelsSet.add(m);
    }
    raiseRebellion(sim, P, [...rebelsSet].sort((a, b) => a - b), seat, seatS.culture !== P.culture ? "foreign rule" : seatS.capDist > reach(sim, P) ? "distance from the capital" : seatS.religion !== P.religion ? "faith" : "heavy taxes");
    return; // one revolt per realm per check
  }
}

/** Raise a rebellion: a new rebel polity fighting a war of independence. */
export function raiseRebellion(sim: Sim, P: PolS, members: number[], seat: number, cause: string): PolS | undefined {
  const rng = sim.rng.polity;
  const s = sim.S[seat];
  const culture = s.culture;
  const C = sim.C[culture];
  const gov: Government = C.archetype === "steppe" ? "horde" : C.tech >= 1 ? (members.length <= 2 && s.urban > 8000 && C.values.mercantile > 0.5 ? "cityState" : "kingdom") : "chiefdom";
  const leader = newAdult(sim, culture, -1, 25, 50, { religion: s.religion, dist: 0, bias: { ambitious: 2, brave: 1.5, charismatic: 1.5 } });
  addRole(sim, leader.id, "rebel", P.id);
  // Rebels often take the name of their region or city; a people under foreign rule revives its own name.
  const R = createPolity(sim, { capital: seat, culture, gov, how: "rebellion", parent: P.id, members, ruler: leader.id, rebel: true, importance: 3 });
  leader.polity = R.id;
  P.revolts++;
  P.crisis += 1;
  for (const m of members) sim.S[m].lastRevolt = sim.year;
  const war = startWar(sim, R, P, "independence", { rebels: R.id, claimant: leader.id, quiet: true });
  sim.emit("rebellion", members.length >= 12 ? 4 : 3, s.cell, { polities: [R.id, P.id], settlements: members.slice(0, 12), persons: [leader.id], wars: [war] }, {
    rebels: R.id, against: P.id, settlements: members, leader: leader.id, cause,
  });
  void rng;
  return R;
}

function checkCollapse(sim: Sim, P: PolS): void {
  const rng = sim.rng.polity;
  if (P.provinces.size < 6 || P.sets.length < 25) return;
  // Overextension and disloyalty feed the crisis.
  let L = 0, w = 0;
  for (const sid of P.sets) {
    L += sim.S[sid].loyalty * sim.S[sid].pop;
    w += sim.S[sid].pop;
  }
  L /= w || 1;
  if (L < 0.55) P.crisis += (0.55 - L) * 4;
  // Decadence of an old, sprawling realm.
  if (P.cohesion < 0.5) P.crisis += (0.5 - P.cohesion) * Math.min(8, P.provinces.size / 4);
  if (P.ruler >= 0) {
    const tr = sim.Pe[P.ruler].rec.traits;
    if (tr.includes("mad") || tr.includes("foolish")) P.crisis += 0.4;
  }
  if (P.crisis < 8) return;
  if (!rng.chance(Math.min(0.5, (P.crisis - 8) * 0.06))) return;
  collapse(sim, P);
}

/** A great realm breaks into successor states. */
export function collapse(sim: Sim, P: PolS): void {
  const rng = sim.rng.polity;
  const S = sim.S;
  const seats = [...P.provinces.keys()].filter((x) => S[x].alive && S[x].owner === P.id);
  if (seats.length < 3) return;
  const k = clamp(Math.round(seats.length / rng.range(4, 6.5)), 2, 5);
  // Successor seeds: big provincial seats far from the capital and from each other.
  const capCell = capitalCell(sim, P);
  const seeds: number[] = [];
  const cand = seats.filter((x) => x !== P.capital).sort((a, b) => S[b].urban - S[a].urban || a - b);
  for (const c of cand) {
    if (seeds.length >= k) break;
    const dc = capCell >= 0 ? sim.distKm(S[c].cell, capCell) : 9999;
    if (dc < 500) continue;
    if (seeds.some((x) => sim.distKm(S[x].cell, S[c].cell) < 600)) continue;
    seeds.push(c);
  }
  if (!seeds.length) return;
  // Assign provinces to the nearest seed (or to the capital, which keeps a rump).
  const keepRump = rng.chance(0.65) && P.capital >= 0 && S[P.capital].owner === P.id;
  const centres = keepRump ? [P.capital, ...seeds] : seeds;
  const groups = new Map<number, number[]>();
  for (const c of centres) groups.set(c, []);
  for (const seat of seats) {
    let best = centres[0], bd = Infinity;
    for (const c of centres) {
      const d = sim.distKm(S[seat].cell, S[c].cell) * (c === P.capital ? 1.25 : 1);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    groups.get(best)!.push(...(P.provinces.get(seat) ?? [seat]).filter((x) => S[x].alive && S[x].owner === P.id));
  }
  const causes: string[] = [];
  if (P.revolts >= 2) causes.push("revolts");
  if (P.lastSuccession > sim.year - 15 && P.legitimacy < 0.6) causes.push("a disputed succession");
  if (P.warWeariness > 0.6) causes.push("ruinous wars");
  if (sim.plagues.some((q) => q.years > 0 && q.rec.start > sim.year - 20)) causes.push("plague");
  if (sim.climate < -0.35) causes.push("famine");
  if (!causes.length) causes.push("overextension");
  const successors: number[] = [];
  const oldRuler = P.ruler;
  const dyn = P.dynasty;
  const age = sim.year - P.founded;
  const peak = P.rec.peak.areaKm2;
  for (const [centre, members] of groups) {
    if (keepRump && centre === P.capital) continue;
    if (!members.length) continue;
    for (const m of members) if (S[m].owner === P.id) transfer(sim, m, -1, false);
    // A cadet of the old house, or a governor/general founding his own.
    let ruler = -1;
    let cadetOf: number | undefined;
    if (dyn >= 0 && rng.chance(0.3)) {
      const kin = sim.living.filter((id) => sim.Pe[id].alive && sim.Pe[id].rec.dynasty === dyn && !sim.Pe[id].rules.length && sim.Pe[id].rec.sex === "m" && sim.year - sim.Pe[id].rec.born >= 18);
      if (kin.length) {
        ruler = kin[0];
        cadetOf = dyn;
      }
    }
    const C = sim.C[S[centre].culture];
    const gov: Government = C.archetype === "steppe" ? "horde" : C.tech >= 1 ? "kingdom" : "chiefdom";
    const Q = createPolity(sim, { capital: centre, culture: S[centre].culture, gov, how: "successor", parent: P.id, members, ruler: ruler >= 0 ? ruler : undefined, cadetOf, importance: 3 });
    successors.push(Q.id);
    for (const m of members) S[m].loyalty = Math.max(S[m].loyalty, 0.7);
  }
  sim.emit("polityCollapsed", peak > 2.5e6 ? 5 : 4, capCell, { polities: [P.id, ...successors], persons: [oldRuler] }, { polity: P.id, successors, causes, peakAreaKm2: Math.round(peak), age });
  P.crisis = 0;
  P.revolts = 0;
  // The shock purges the old elite; a smaller realm regains some vigour.
  P.cohesion = Math.min(1, P.cohesion + 0.35);
  // Every successor remembers the old realm's lands as its own by right.
  const allMembers: number[] = [];
  for (const m of groups.values()) allMembers.push(...m);
  for (const q of successors) {
    const Q = sim.P[q];
    for (const m of allMembers) if (sim.S[m].owner !== q) Q.claims.set(m, sim.year);
  }
  if (keepRump) for (const m of allMembers) if (sim.S[m].owner !== P.id) P.claims.set(m, sim.year);
  if (!keepRump) {
    endPolity(sim, P, "collapsed");
    for (const q of successors) if (!P.rec.successors.includes(q)) P.rec.successors.push(q);
  } else {
    rebuildOne(sim, P);
    if (P.gov === "empire") changeGov(sim, P, "kingdom", "the loss of its provinces", 3);
  }
}

// ---------------------------------------------------------------------------
// Vassals and unions
// ---------------------------------------------------------------------------

function checkVassals(sim: Sim): void {
  const rng = sim.rng.polity;
  for (const P of sim.P) {
    if (!P.alive || P.overlord < 0) continue;
    const O = sim.P[P.overlord];
    if (!O.alive) {
      sim.setOverlord(P, -1);
      continue;
    }
    const since = P.rec.overlords[P.rec.overlords.length - 1].year;
    // Absorption of long-loyal kin vassals.
    if (sim.year - since > 80 && sim.familyOf(P.culture) === sim.familyOf(O.culture) && rng.chance(0.08)) {
      sim.emit("polityAnnexed", 3, capitalCell(sim, P), { polities: [P.id, O.id], persons: [P.ruler] }, { polity: P.id, by: O.id, war: -1, last: P.ruler });
      for (const sid of P.sets.slice()) transfer(sim, sid, O.id, false);
      endPolity(sim, P, "absorbed", O.id);
      continue;
    }
    // Breaking free when the overlord weakens.
    if (P.strength > 0.55 * (O.strength - 0.4 * P.strength) && rng.chance(0.15)) {
      if (rng.chance(0.5)) {
        sim.setOverlord(P, -1);
        sim.emit("vassalFreed", 3, capitalCell(sim, P), { polities: [P.id, O.id], persons: [P.ruler] }, { vassal: P.id, overlord: O.id, reason: "decline" });
      } else startWar(sim, P, O, "independence", {});
    }
  }
  // Personal unions ripen into mergers.
  for (const P of sim.P) {
    if (!P.alive || P.unionWith < 0) continue;
    const O = sim.P[P.unionWith];
    if (!O.alive || O.ruler !== P.ruler) {
      P.unionWith = -1;
      continue;
    }
    const since = P.lastSuccession;
    if (sim.year - since > 25 && sim.familyOf(P.culture) === sim.familyOf(O.culture) && sim.polNbrs.get(P.id)?.includes(O.id) && rng.chance(0.12)) {
      sim.emit("union", 4, capitalCell(sim, O), { polities: [O.id, P.id], persons: [O.ruler] }, { senior: O.id, junior: P.id, ruler: O.ruler, kind: "merger" });
      for (const sid of P.sets.slice()) transfer(sim, sid, O.id, false);
      endPolity(sim, P, "merged", O.id);
    }
  }
}

/** Small same-people realms band together into a confederation. */
function confederate(sim: Sim): void {
  const rng = sim.rng.polity;
  for (const P of sim.P) {
    if (!P.alive || P.overlord >= 0 || P.sets.length > 8 || (P.gov !== "chiefdom" && P.gov !== "tribe" && P.gov !== "cityState")) continue;
    if (!rng.chance(0.03)) continue;
    const nb = (sim.polNbrs.get(P.id) ?? []).filter((q) => {
      const Q = sim.P[q];
      return Q.alive && Q.overlord < 0 && Q.culture === P.culture && Q.sets.length <= 8 && Q.gov === P.gov && !Q.wars.some((w) => sim.W[w].active);
    });
    if (nb.length < 2 || P.wars.some((w) => sim.W[w].active)) continue;
    const members = [P.id, ...nb.slice(0, 4)];
    changeGov(sim, P, "confederation", "a league of kindred chiefs", 3);
    for (const q of members) if (q !== P.id) {
      const Q = sim.P[q];
      for (const sid of Q.sets.slice()) transfer(sim, sid, P.id, false);
      endPolity(sim, Q, "merged", P.id);
    }
    sim.emit("polityUnified", 3, capitalCell(sim, P), { polities: members }, { polity: P.id, members, how: "confederation" });
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tickPolities(sim: Sim): void {
  const y = sim.year;
  rebuildMembership(sim);
  for (const P of sim.P) {
    if (!P.alive) continue;
    const atWar = P.wars.some((w) => sim.W[w].active);
    if (!atWar) P.warWeariness *= 0.95;
    if (P.ruler < 0) succeed(sim, P, -1);
  }
  if (y % 5 === 0) {
    formPolities(sim);
    integrate(sim);
    for (const P of sim.P) {
      if (!P.alive) continue;
      updateLoyalty(sim, P);
      P.cohesion = Math.max(0.05, P.cohesion - 0.0032 * P.decay * (0.6 + P.provinces.size / 15) * (P.goldenAge > y ? 1.3 : 1));
      P.crisis *= 0.88;
      P.revolts *= 0.97;
      P.conquests *= 0.96;
    }
    for (const P of sim.P) if (P.alive) checkRevolts(sim, P);
    for (const P of sim.P) if (P.alive) checkCollapse(sim, P);
  }
  if (y % 10 === 5) {
    for (const P of sim.P) if (P.alive) considerGovernment(sim, P);
    checkVassals(sim);
    confederate(sim);
  }
  void killPerson;
  void tracksFamilies;
}

export type { SetS };
