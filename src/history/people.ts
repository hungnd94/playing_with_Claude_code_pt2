/**
 * Persons, dynasties, marriage, birth, death and succession.
 *
 * Only people history would remember are simulated: rulers and their close
 * families, consorts, regents, generals, prophets, scholars, builders. Births
 * are simulated for couples where one partner is a ruler or an heir (`dist`
 * 0), so family trees run unbroken along the lines of succession while the
 * person count stays bounded.
 *
 * Succession follows the realm's law (see `SuccessionLaw` in types.ts); a
 * missing heir brings a succession crisis, a child heir a regency, an heir who
 * already rules elsewhere a personal union, and rival claimants civil war.
 * Epithets are earned from deeds and given posthumously.
 */
import type { Rng } from "../core/rng";
import { cadetEmblem, makeEmblem } from "./emblems";
import { givenName } from "./names";
import type { LName } from "./names";
import type { PerS, PolS, Sim } from "./sim";
import type { DeathCause, Dynasty, EventData, Person, RoleKind, Sex, SuccessionLaw, Trait, WName } from "./types";
import { clamp, remove } from "./util";

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

const PAIRS: [Trait, Trait][] = [
  ["brave", "craven"], ["cruel", "kind"], ["pious", "cynical"], ["wise", "foolish"], ["ambitious", "content"], ["greedy", "generous"],
  ["charismatic", "shy"], ["warlike", "peaceful"], ["honest", "cunning"], ["sickly", "strong"],
];
const SINGLES: Trait[] = ["just", "scholarly", "builder", "mad"];
const OPP = new Map<Trait, Trait>();
for (const [a, b] of PAIRS) {
  OPP.set(a, b);
  OPP.set(b, a);
}
const TRAIT_W: Partial<Record<Trait, number>> = { mad: 0.12, sickly: 0.5, craven: 0.6, foolish: 0.7, cruel: 0.8, scholarly: 0.7, builder: 0.6 };

export function rollTraits(rng: Rng, inherit: Trait[] = [], n = rng.int(2, 3), bias: Partial<Record<Trait, number>> = {}): Trait[] {
  const out: Trait[] = [];
  const ok = (t: Trait) => !out.includes(t) && !out.includes(OPP.get(t) as Trait);
  for (const t of inherit) if (out.length < n && ok(t) && rng.chance(t === "mad" ? 0.25 : 0.35)) out.push(t);
  const all: [Trait, number][] = [];
  for (const [a, b] of PAIRS) {
    all.push([a, (TRAIT_W[a] ?? 1) * (bias[a] ?? 1)]);
    all.push([b, (TRAIT_W[b] ?? 1) * (bias[b] ?? 1)]);
  }
  for (const t of SINGLES) all.push([t, (TRAIT_W[t] ?? 1) * (bias[t] ?? 1)]);
  for (let i = 0; i < 12 && out.length < n; i++) {
    const t = rng.weighted(all);
    if (ok(t)) out.push(t);
  }
  return out;
}

function skills(rng: Rng, traits: Trait[]): { martial: number; diplomacy: number; stewardship: number; learning: number } {
  const has = (t: Trait) => traits.includes(t);
  return {
    martial: clamp(rng.range(0.1, 0.8) + (has("brave") ? 0.2 : 0) + (has("warlike") ? 0.15 : 0) + (has("strong") ? 0.1 : 0) - (has("craven") ? 0.25 : 0) - (has("sickly") ? 0.1 : 0), 0, 1),
    diplomacy: clamp(rng.range(0.1, 0.8) + (has("charismatic") ? 0.25 : 0) + (has("honest") ? 0.05 : 0) + (has("cunning") ? 0.1 : 0) - (has("shy") ? 0.2 : 0) - (has("cruel") ? 0.1 : 0), 0, 1),
    stewardship: clamp(rng.range(0.1, 0.8) + (has("just") ? 0.15 : 0) + (has("wise") ? 0.15 : 0) + (has("builder") ? 0.1 : 0) - (has("greedy") ? 0.1 : 0) - (has("foolish") ? 0.2 : 0) - (has("mad") ? 0.3 : 0), 0, 1),
    learning: clamp(rng.range(0.05, 0.7) + (has("scholarly") ? 0.3 : 0) + (has("wise") ? 0.15 : 0) - (has("foolish") ? 0.2 : 0), 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface NewPersonOpts {
  sex: Sex;
  born: number;
  culture: number;
  religion?: number;
  father?: number;
  mother?: number;
  dynasty?: number;
  polity?: number;
  dist?: number;
  name?: LName;
  traits?: Trait[];
  bias?: Partial<Record<Trait, number>>;
}

export function newPerson(sim: Sim, o: NewPersonOpts): PerS {
  const rng = sim.rng.people;
  const id = sim.h.persons.length;
  const C = sim.C[o.culture];
  const father = o.father ?? -1, mother = o.mother ?? -1;
  let name = o.name;
  if (!name) {
    const fName = father >= 0 && rng.chance(0.85) ? (sim.Pe[father].rec.name as unknown as LName) : undefined;
    name = sim.names.person(C.lang, rng, { gender: o.sex, father: fName });
  }
  const inherit: Trait[] = [];
  if (father >= 0) inherit.push(...sim.h.persons[father].traits);
  if (mother >= 0) inherit.push(...sim.h.persons[mother].traits);
  const traits = o.traits ?? rollTraits(rng, inherit, undefined, o.bias);
  const rec: Person = {
    id, name: name as unknown as WName, sex: o.sex, born: o.born, died: -1, deathCause: "unknown", deathPlace: -1, father, mother, spouses: [], children: [],
    dynasty: o.dynasty ?? -1, culture: o.culture, religion: o.religion ?? (o.polity !== undefined && o.polity >= 0 ? sim.P[o.polity].religion : C.folk), traits,
    epithet: "", regnal: 0, roles: [], deeds: [],
  };
  sim.h.persons.push(rec);
  if (father >= 0) sim.h.persons[father].children.push(id);
  if (mother >= 0) sim.h.persons[mother].children.push(id);
  const sk = skills(rng, traits);
  const pe: PerS = { id, rec, alive: true, spouse: -1, rules: [], dist: o.dist ?? 9, ...sk, tally: {}, accAge: -1, polity: o.polity ?? -1, births: 0 };
  sim.Pe.push(pe);
  sim.living.push(id);
  if (rec.dynasty >= 0) indexMember(sim, rec.dynasty, id);
  return pe;
}

function indexMember(sim: Sim, dyn: number, pid: number): void {
  let l = sim.dynMembers.get(dyn);
  if (!l) sim.dynMembers.set(dyn, (l = []));
  l.push(pid);
}

/** An adult of a given age band, e.g. a founder, general or prophet (born `age` years ago). */
export function newAdult(sim: Sim, culture: number, polity: number, minAge: number, maxAge: number, o: Partial<NewPersonOpts> = {}): PerS {
  const rng = sim.rng.people;
  const sex: Sex = o.sex ?? "m";
  return newPerson(sim, { sex, born: sim.year - rng.int(minAge, maxAge), culture, polity, ...o });
}

export function addRole(sim: Sim, pid: number, kind: RoleKind, polity = -1, religion = -1, from = sim.year): void {
  sim.h.persons[pid].roles.push({ kind, polity, religion, from, to: -1 });
}

export function closeRole(sim: Sim, pid: number, kind: RoleKind, polity: number, to = sim.year): void {
  const roles = sim.h.persons[pid].roles;
  for (let i = roles.length - 1; i >= 0; i--) {
    const r = roles[i];
    if (r.kind === kind && r.polity === polity && r.to < 0) {
      r.to = to;
      return;
    }
  }
}

export function newDynasty(sim: Sim, founder: number, polity: number, parent = -1): number {
  const rng = sim.rng.people;
  // A new house brings new vigour.
  if (polity >= 0 && sim.P[polity].rec.founded < sim.year) sim.P[polity].cohesion = Math.min(1.1, sim.P[polity].cohesion + 0.15);
  const pe = sim.Pe[founder];
  const C = sim.C[pe.rec.culture];
  const P = polity >= 0 ? sim.P[polity] : undefined;
  const seat = P ? P.capital : -1;
  const name = sim.names.dynasty(C.lang, rng, {
    founder: pe.rec.name as unknown as LName,
    seat: seat >= 0 && rng.chance(0.4) ? sim.S[seat].name : undefined,
  });
  const id = sim.h.dynasties.length;
  const glossWords = [name.gloss, (pe.rec.name as unknown as LName).meta?.givenGloss ?? ""].filter(Boolean);
  const emblem = parent >= 0
    ? cadetEmblem(sim.h.dynasties[parent].emblem, rng.fork(`cadet${id}`), rng.int(2, 5))
    : makeEmblem(rng.fork(`dyn${id}`), { style: C.style, kind: C.rec.heraldicStyle, gloss: glossWords, legend: name.roman });
  const rec: Dynasty = {
    id, name: name as unknown as WName, founder, seat, parent, culture: C.id, emblem, founded: sim.year, extinct: -1, polities: polity >= 0 ? [polity] : [],
  };
  if (rng.chance(0.55)) rec.motto = sim.names.motto(C.lang, rng);
  sim.h.dynasties.push(rec);
  pe.rec.dynasty = id;
  indexMember(sim, id, founder);
  sim.emit("dynastyFounded", parent >= 0 ? 2 : P && P.sets.length >= 8 ? 3 : 2, seat >= 0 ? sim.S[seat].cell : -1, { dynasties: [id, parent], persons: [founder], polities: [polity] }, { dynasty: id, founder, polity, parent });
  return id;
}

function addDynastyPolity(sim: Sim, dyn: number, polity: number): void {
  if (dyn < 0) return;
  const d = sim.h.dynasties[dyn];
  if (!d.polities.includes(polity)) d.polities.push(polity);
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

function isAncestor(sim: Sim, anc: number, pid: number, depth = 4): boolean {
  if (pid < 0 || depth < 0) return false;
  const p = sim.h.persons[pid];
  if (p.father === anc || p.mother === anc) return true;
  return isAncestor(sim, anc, p.father, depth - 1) || isAncestor(sim, anc, p.mother, depth - 1);
}

/** Plain English relation of `pid` to `of` ("son", "brother", "nephew", …). */
export function relationTo(sim: Sim, pid: number, of: number): string {
  if (of < 0 || pid < 0) return "none";
  const a = sim.h.persons[pid], b = sim.h.persons[of];
  const m = a.sex === "m";
  if (a.father === of || a.mother === of) return m ? "son" : "daughter";
  if (b.spouses.includes(pid)) return m ? "husband" : "widow";
  const sibling = (a.father >= 0 && a.father === b.father) || (a.mother >= 0 && a.mother === b.mother);
  if (sibling) return m ? "brother" : "sister";
  const ap = [a.father, a.mother].filter((x) => x >= 0);
  for (const p of ap) {
    const pp = sim.h.persons[p];
    if (pp.father === of || pp.mother === of) return m ? "grandson" : "granddaughter";
    if ((pp.father >= 0 && pp.father === b.father) || (pp.mother >= 0 && pp.mother === b.mother)) return m ? "nephew" : "niece";
    if (b.spouses.includes(p)) return m ? "stepson" : "stepdaughter";
  }
  const bp = [b.father, b.mother].filter((x) => x >= 0);
  for (const p of bp) {
    const pp = sim.h.persons[p];
    if ((pp.father >= 0 && (pp.father === a.father || pp.father === a.father)) || (a.father >= 0 && a.father === p)) return m ? "uncle" : "aunt";
    for (const q of ap) {
      const qq = sim.h.persons[q];
      if ((pp.father >= 0 && pp.father === qq.father) || (pp.mother >= 0 && pp.mother === qq.mother)) return "cousin";
    }
  }
  for (const s of b.children) if (sim.h.persons[s].spouses.includes(pid)) return m ? "son-in-law" : "daughter-in-law";
  if (isAncestor(sim, of, pid)) return m ? "descendant" : "descendant";
  if (a.dynasty >= 0 && a.dynasty === b.dynasty) return "kinsman";
  return "none";
}

// ---------------------------------------------------------------------------
// Reigns
// ---------------------------------------------------------------------------

function givenOf(sim: Sim, pid: number): string {
  return givenName(sim.h.persons[pid].name as unknown as LName);
}

/** Regnal number: earlier rulers of the same given name in this realm and its predecessors (two levels). */
export function regnalNumber(sim: Sim, polity: number, pid: number): number {
  const g = givenOf(sim, pid);
  const seen = new Set<number>();
  let count = 0;
  const visit = (pol: number, depth: number) => {
    if (pol < 0 || seen.has(pol) || depth > 2) return;
    seen.add(pol);
    for (const r of sim.h.polities[pol].rulers) if (r.person !== pid && givenOf(sim, r.person) === g) count++;
    for (const q of sim.h.polities[pol].predecessors) visit(q, depth + 1);
  };
  visit(polity, 0);
  return count + 1;
}

export function regnalString(sim: Sim, pid: number): string {
  const p = sim.h.persons[pid];
  const g = givenOf(sim, pid);
  const r = p.regnal;
  if (r <= 1) return g;
  const vals: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let n = r, s = "";
  for (const [v, t] of vals) while (n >= v) {
    s += t;
    n -= v;
  }
  return `${g} ${s}`;
}

export type AccessionHow = EventData["accession"]["how"];

/** Put `pid` on the throne of P. */
export function accede(sim: Sim, P: PolS, pid: number, how: AccessionHow, predecessor: number, quiet = false): void {
  const pe = sim.Pe[pid];
  const rec = pe.rec;
  P.ruler = pid;
  P.lastSuccession = sim.year;
  if (!pe.rules.includes(P.id)) pe.rules.push(P.id);
  pe.dist = 0;
  pe.polity = pe.rules[0];
  if (pe.accAge < 0) pe.accAge = sim.year - rec.born;
  if (!pe.tally.areaStart) pe.tally.areaStart = Math.max(1, P.area);
  P.rec.rulers.push({ person: pid, from: sim.year, to: -1 });
  addRole(sim, pid, "ruler", P.id);
  if (rec.regnal === 0) rec.regnal = regnalNumber(sim, P.id, pid);
  if (rec.dynasty >= 0) {
    addDynastyPolity(sim, rec.dynasty, P.id);
    P.dynasty = rec.dynasty;
  } else P.dynasty = -1;
  if (P.heir === pid) P.heir = -1;
  closeRole(sim, pid, "heir", P.id);
  // A new reign: legitimacy depends on how the throne was won.
  const leg: Partial<Record<AccessionHow, number>> = { primogeniture: 0.8, seniority: 0.75, elective: 0.75, tanistry: 0.7, election: 0.8, appointment: 0.8, founding: 0.7, usurpation: 0.35, conquest: 0.45, claim: 0.55, restoration: 0.7, union: 0.6 };
  P.legitimacy = clamp((leg[how] ?? 0.6) + (rec.traits.includes("charismatic") ? 0.1 : 0), 0.1, 1);
  if (!quiet) {
    const big = P.sets.length >= 15 || P.gov === "empire";
    const imp = how === "usurpation" || how === "conquest" ? (big ? 4 : 3) : big ? 3 : P.sets.length >= 4 ? 2 : 1;
    const cap = P.capital >= 0 ? sim.S[P.capital].cell : -1;
    sim.emit("accession", imp, cap, { persons: [pid, predecessor], polities: [P.id], dynasties: [rec.dynasty] }, {
      person: pid, polity: P.id, predecessor, age: sim.year - rec.born, how, regnalName: regnalString(sim, pid), relation: relationTo(sim, pid, predecessor),
    }, [pid]);
  }
  if (sim.year - rec.born < 16) startRegency(sim, P, pid);
}

/** End the current reign of P (death, deposition, abdication, conquest). */
export function endReign(sim: Sim, P: PolS, pid: number): void {
  if (pid < 0) return;
  const rs = P.rec.rulers;
  for (let i = rs.length - 1; i >= 0; i--) if (rs[i].person === pid && rs[i].to < 0) {
    rs[i].to = sim.year;
    break;
  }
  closeRole(sim, pid, "ruler", P.id);
  const pe = sim.Pe[pid];
  remove(pe.rules, P.id);
  if (P.ruler === pid) P.ruler = -1;
  if (P.regent >= 0) endRegency(sim, P);
}

function startRegency(sim: Sim, P: PolS, ward: number): void {
  const rng = sim.rng.people;
  const w = sim.Pe[ward].rec;
  let regent = -1;
  if (w.mother >= 0 && sim.Pe[w.mother].alive && sim.year - sim.h.persons[w.mother].born >= 18 && rng.chance(0.6)) regent = w.mother;
  if (regent < 0 && w.father >= 0) {
    // A paternal uncle.
    const f = sim.h.persons[w.father];
    if (f.father >= 0) for (const u of sim.h.persons[f.father].children) if (u !== w.father && sim.Pe[u].alive && sim.h.persons[u].sex === "m" && sim.year - sim.h.persons[u].born >= 20) {
      regent = u;
      break;
    }
  }
  if (regent < 0) regent = newAdult(sim, P.culture, P.id, 35, 60, { religion: P.religion }).id;
  P.regent = regent;
  P.regentUntil = w.born + 16;
  addRole(sim, regent, "regent", P.id);
  const cap = P.capital >= 0 ? sim.S[P.capital].cell : -1;
  sim.emit("regency", P.sets.length >= 10 ? 3 : 2, cap, { persons: [regent, ward], polities: [P.id] }, { regent, ward, polity: P.id });
}

function endRegency(sim: Sim, P: PolS): void {
  if (P.regent >= 0) closeRole(sim, P.regent, "regent", P.id);
  P.regent = -1;
  P.regentUntil = 0;
}

// ---------------------------------------------------------------------------
// Heirs
// ---------------------------------------------------------------------------

const adultAge = (sim: Sim, pid: number) => sim.year - sim.h.persons[pid].born;

function byBirth(sim: Sim, ids: number[]): number[] {
  return ids.slice().sort((a, b) => sim.h.persons[a].born - sim.h.persons[b].born || a - b);
}

/** Male-preference primogeniture within the line of `pid` (excluding pid itself). */
function primoLine(sim: Sim, pid: number, depth: number, allowF: boolean, skip: Set<number>): number {
  const kids = byBirth(sim, sim.h.persons[pid].children);
  for (const pass of allowF ? ["m", "f"] : ["m"]) {
    for (const k of kids) {
      if (sim.h.persons[k].sex !== pass) continue;
      if (sim.Pe[k].alive && !skip.has(k)) return k;
      if (depth < 3) {
        const r = primoLine(sim, k, depth + 1, allowF, skip);
        if (r >= 0) return r;
      }
    }
  }
  return -1;
}

function primogeniture(sim: Sim, deceased: number, cognatic: boolean, skip: Set<number>): number {
  let anc = deceased;
  for (let up = 0; up < 3 && anc >= 0; up++) {
    let r = primoLine(sim, anc, 0, cognatic, skip);
    if (r < 0 && !cognatic) r = primoLine(sim, anc, 0, true, skip);
    if (r >= 0) return r;
    anc = sim.h.persons[anc].father;
  }
  return -1;
}

/** Living members of a dynasty (scan of the living). */
function dynastyLiving(sim: Sim, dyn: number): number[] {
  if (dyn < 0) return [];
  const l = sim.dynMembers.get(dyn);
  if (!l) return [];
  const out = l.filter((id) => sim.Pe[id].alive && sim.Pe[id].rec.dynasty === dyn);
  if (out.length < l.length * 0.6) sim.dynMembers.set(dyn, out.slice());
  return out;
}

/** May this person take P's throne? (Not while ruling a rival realm, except by true inheritance.) */
function eligible(sim: Sim, P: PolS, pid: number, inheritance: boolean): boolean {
  const pe = sim.Pe[pid];
  if (!pe.alive) return false;
  for (const r of pe.rules) {
    if (r === P.id) continue;
    if (!inheritance) return false;
    const Q = sim.P[r];
    if (Q.rebel || Q.wars.some((w) => sim.W[w].active && (sim.W[w].attSide.includes(P.id) || sim.W[w].defSide.includes(P.id)))) return false;
  }
  return true;
}

/** Score for elective/tanistry choices. */
function ability(sim: Sim, pid: number, martialW: number): number {
  const pe = sim.Pe[pid];
  const age = adultAge(sim, pid);
  return pe.martial * martialW + pe.diplomacy * 0.35 + pe.stewardship * 0.25 + (age >= 25 && age <= 55 ? 0.2 : 0) + (pe.rec.traits.includes("charismatic") ? 0.15 : 0);
}

/**
 * The heir of P under its law if `deceased` (the current ruler) died now.
 * Returns -1 when no member of the line is available. Elected/appointed heads
 * are created at succession time, not here.
 */
export function lawfulHeir(sim: Sim, P: PolS, deceased: number, skip = new Set<number>()): number {
  if (deceased < 0) return -1;
  const C = sim.C[P.culture];
  const law: SuccessionLaw = P.law;
  if (law === "election" || law === "appointment") return -1;
  const dyn = sim.h.persons[deceased].dynasty;
  const members = dynastyLiving(sim, dyn).filter((x) => x !== deceased && !skip.has(x));
  // Those who rule elsewhere may inherit only by blood right (primogeniture), never a rival's crown.
  for (const m of members) if (!eligible(sim, P, m, law === "primogeniture")) skip.add(m);
  if (law === "primogeniture") {
    const h = primogeniture(sim, deceased, C.cognatic, skip);
    return h >= 0 && eligible(sim, P, h, true) ? h : -1;
  }
  const adults = members.filter((x) => !skip.has(x) && sim.h.persons[x].sex === "m" && adultAge(sim, x) >= 16);
  if (law === "seniority") {
    if (adults.length) return adults.slice().sort((a, b) => sim.h.persons[a].born - sim.h.persons[b].born || a - b)[0];
  } else if (adults.length) {
    // elective / tanistry: the ablest adult kinsman.
    const w = law === "tanistry" ? 0.8 : 0.45;
    return adults.slice().sort((a, b) => ability(sim, b, w) - ability(sim, a, w) || a - b)[0];
  }
  // No grown kinsman: a minor of the line under elective customs only if nothing else; the caller may raise a kinsman instead.
  const h = primogeniture(sim, deceased, C.cognatic, skip);
  return h >= 0 && eligible(sim, P, h, false) && adultAge(sim, h) >= 12 ? h : -1;
}

/** Recompute heirs (yearly, kingdoms and larger) and mark them for tracked births. */
export function refreshHeir(sim: Sim, P: PolS): void {
  if (P.ruler < 0) return;
  const h = lawfulHeir(sim, P, P.ruler);
  if (h === P.heir) return;
  if (P.heir >= 0) {
    closeRole(sim, P.heir, "heir", P.id);
    const old = sim.Pe[P.heir];
    if (old.alive && !old.rules.length && old.dist === 0) old.dist = 1;
  }
  P.heir = h;
  if (h >= 0) {
    const pe = sim.Pe[h];
    if (!pe.rules.length) {
      pe.dist = 0;
      addRole(sim, h, "heir", P.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Succession
// ---------------------------------------------------------------------------

/** A brand-new ruler from outside the line (elected head, appointed priest, noble, general). */
function outsider(sim: Sim, P: PolS, minAge: number, maxAge: number, bias?: Partial<Record<Trait, number>>): PerS {
  return newAdult(sim, P.culture, P.id, minAge, maxAge, { religion: P.religion, dist: 0, bias });
}

/**
 * Called when P's ruler has died, been deposed or abdicated (after endReign).
 * Picks the successor, handles crises, regencies, unions and civil wars.
 */
export function succeed(sim: Sim, P: PolS, deceased: number): void {
  if (!P.alive) return;
  const rng = sim.rng.people;
  const cap = P.capital >= 0 ? sim.S[P.capital].cell : -1;
  if (P.law === "election") {
    const r = outsider(sim, P, 40, 66, { wise: 1.5, charismatic: 1.5 });
    accede(sim, P, r.id, "election", deceased);
    return;
  }
  if (P.law === "appointment") {
    const r = outsider(sim, P, 45, 70, { pious: 3 });
    accede(sim, P, r.id, "appointment", deceased);
    return;
  }
  // Tribal realms keep no detailed families: a kinsman follows (also when a clan law finds no grown man of the line).
  const lh = tracksFamilies(sim, P) ? lawfulHeir(sim, P, deceased) : -2;
  if (lh === -2 || (lh < 0 && P.law !== "primogeniture" && deceased >= 0 && sim.h.persons[deceased].dynasty >= 0 && sim.rng.people.chance(0.75))) {
    let heir = lh === -2 ? lawfulHeir(sim, P, deceased) : -1;
    if (heir < 0 && deceased >= 0) {
      const d = sim.h.persons[deceased];
      // A grown son if the dead chief was old enough to have one, else a brother or cousin.
      const asSon = d.born + 18 <= sim.year - 16 && rng.chance(0.65);
      const born = asSon ? Math.max(d.born + 18, sim.year - rng.int(16, 40)) : Math.min(sim.year - 16, d.born + rng.int(-12, 12));
      const pe = newPerson(sim, {
        sex: "m", born, culture: P.culture, religion: P.religion,
        father: asSon ? deceased : d.father, mother: asSon && d.spouses.length ? d.spouses[0] : asSon ? -1 : d.mother, dynasty: d.dynasty, polity: P.id, dist: 0,
      });
      heir = pe.id;
    }
    if (heir < 0) {
      const r = outsider(sim, P, 25, 50);
      newDynasty(sim, r.id, P.id);
      accede(sim, P, r.id, "elective", deceased);
      return;
    }
    accede(sim, P, heir, P.law, deceased);
    return;
  }
  const heir = lh;
  if (heir >= 0) {
    // A rival claimant may contest elective/tanistry/seniority successions, or a child heir.
    const hp = sim.Pe[heir];
    const rival = findRival(sim, P, deceased, heir);
    if (rival >= 0 && P.sets.length >= 4 && hooks.civilWar) {
      const pressure = (adultAge(sim, heir) < 16 ? 0.35 : 0.12) + (P.law === "primogeniture" ? 0 : 0.15) + (1 - P.legitimacy) * 0.2;
      if (rng.chance(pressure)) {
        accede(sim, P, heir, hp.rules.length ? "union" : P.law, deceased);
        hooks.civilWar(sim, P, rival, "succession");
        return;
      }
    }
    if (hp.rules.length && hp.rules[0] !== P.id && P.unionWith !== hp.rules[0] && rng.chance(0.55)) {
      // The magnates would rather have a resident prince: the next of the line.
      const alt = lawfulHeir(sim, P, deceased, new Set([heir]));
      if (alt >= 0 && !sim.Pe[alt].rules.length) {
        accede(sim, P, alt, P.law, deceased);
        return;
      }
    }
    if (hp.rules.length && hp.rules[0] !== P.id) {
      // Personal union: the heir already rules elsewhere.
      const senior = sim.P[hp.rules[0]];
      const already = P.unionWith === senior.id;
      accede(sim, P, heir, "union", deceased, already);
      P.unionWith = senior.id;
      if (!already) sim.emit("union", P.sets.length + senior.sets.length >= 30 ? 4 : 3, cap, { polities: [senior.id, P.id], persons: [heir] }, { senior: senior.id, junior: P.id, ruler: heir, kind: "personal" });
      return;
    }
    accede(sim, P, heir, P.law, deceased);
    return;
  }
  // No heir in the tracked line: often a distant kinsman of a cadet line is found.
  if (deceased >= 0 && sim.h.persons[deceased].dynasty >= 0 && rng.chance(0.45)) {
    const d = sim.h.persons[deceased];
    const k = newPerson(sim, { sex: "m", born: sim.year - rng.int(20, 45), culture: P.culture, religion: P.religion, dynasty: d.dynasty, polity: P.id, dist: 0 });
    accede(sim, P, k.id, P.law, deceased);
    P.legitimacy = Math.min(P.legitimacy, 0.6);
    return;
  }
  // A succession crisis.
  const claimants: number[] = [];
  const noble = outsider(sim, P, 25, 55, { ambitious: 2 });
  claimants.push(noble.id);
  let foreign = -1;
  // A foreign ruler married into the house may press a claim.
  const dd = deceased >= 0 ? sim.h.persons[deceased] : undefined;
  if (dd) {
    const kin = [...dd.children, ...(dd.father >= 0 ? sim.h.persons[dd.father].children : [])];
    for (const k of kin) for (const s of sim.h.persons[k].spouses) {
      const sp = sim.Pe[s];
      if (sp.alive && sp.rules.length && sp.rules[0] !== P.id && foreign < 0) foreign = s;
    }
  }
  if (foreign >= 0) claimants.push(foreign);
  sim.emit("successionCrisis", P.sets.length >= 45 || (foreign >= 0 && P.sets.length >= 15) ? 4 : 3, cap, { polities: [P.id], persons: [deceased, ...claimants] }, { polity: P.id, deceased, claimants });
  P.crisis += 2;
  newDynasty(sim, noble.id, P.id);
  accede(sim, P, noble.id, "elective", deceased);
  P.legitimacy = 0.45;
  if (foreign >= 0 && hooks.claimWar && rng.chance(0.6)) hooks.claimWar(sim, sim.P[sim.Pe[foreign].rules[0]], P, foreign);
}

/** An ambitious adult kinsman passed over by the succession. */
function findRival(sim: Sim, P: PolS, deceased: number, heir: number): number {
  const dyn = deceased >= 0 ? sim.h.persons[deceased].dynasty : -1;
  if (dyn < 0) return -1;
  let best = -1, bs = -Infinity;
  for (const x of dynastyLiving(sim, dyn)) {
    if (x === heir || x === deceased) continue;
    const pe = sim.Pe[x];
    if (pe.rec.sex !== "m" || adultAge(sim, x) < 18 || pe.rules.length) continue;
    if (!pe.rec.traits.includes("ambitious")) continue;
    const s = ability(sim, x, 0.6);
    if (s > bs) {
      bs = s;
      best = x;
    }
  }
  return best;
}

/** Hooks filled in by other systems (avoids import cycles with war.ts). */
export const hooks: {
  civilWar?: (sim: Sim, P: PolS, pretender: number, cause: "succession" | "usurpation") => void;
  claimWar?: (sim: Sim, claimantRealm: PolS, target: PolS, claimant: number) => void;
} = {};

/** Whether a realm keeps track of its royal family (births, marriages). */
export function tracksFamilies(sim: Sim, P: PolS): boolean {
  if (P.gov === "tribe" || P.gov === "chiefdom" || P.gov === "republic" || P.gov === "theocracy") return false;
  return P.sets.length >= 3 || P.gov === "empire";
}

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

/** Kill a person; handles reigns, succession, epithets and the death event. */
export function killPerson(sim: Sim, pid: number, cause: DeathCause, place = -1, killer = -1, quietEvent = false): void {
  const pe = sim.Pe[pid];
  if (!pe.alive) return;
  pe.alive = false;
  const rec = pe.rec;
  rec.died = sim.year;
  rec.deathCause = cause;
  rec.deathPlace = place;
  const ruled = pe.rules.slice();
  const heirOf: number[] = [];
  for (const r of rec.roles) if (r.to < 0) {
    if (r.kind === "heir") heirOf.push(r.polity);
    r.to = sim.year;
  }
  if (pe.spouse >= 0 && sim.Pe[pe.spouse].alive && sim.Pe[pe.spouse].spouse === pid) sim.Pe[pe.spouse].spouse = -1;
  if (ruled.length) rec.epithet = earnEpithet(sim, pe, cause);
  const age = sim.year - rec.born;
  const notable = ruled.length > 0 || rec.roles.length > 0 || cause === "battle" || cause === "assassinated" || cause === "executed";
  if (notable && !quietEvent) {
    const P = ruled.length ? sim.P[ruled[0]] : pe.polity >= 0 ? sim.P[pe.polity] : undefined;
    const big = P ? P.sets.length >= 12 || P.gov === "empire" : false;
    let imp = ruled.length ? (big ? 3 : 2) : 1;
    // Violent deaths are told by their own events (battle, assassination, execution).
    if (cause === "battle" || cause === "assassinated" || cause === "executed") imp = Math.min(imp, 2);
    if (rec.roles.some((r) => r.kind === "prophet")) imp = Math.max(imp, 3);
    const cell = place >= 0 ? sim.S[place].cell : P && P.capital >= 0 ? sim.S[P.capital].cell : -1;
    sim.emit("death", imp, cell, { persons: [pid, killer], polities: ruled.length ? ruled : [pe.polity], settlements: [place] }, {
      person: pid, age, cause, polity: ruled.length ? ruled[0] : pe.polity, ruler: ruled.length > 0, place, killer,
    }, [pid]);
  }
  for (const pol of ruled) {
    const P = sim.P[pol];
    endReign(sim, P, pid);
    if (P.alive) succeed(sim, P, pid);
  }
  for (const q of heirOf) if (q >= 0 && sim.P[q].heir === pid) sim.P[q].heir = -1;
  if (pe.polity >= 0 && sim.P[pe.polity].heir === pid) sim.P[pe.polity].heir = -1;
}

// ---------------------------------------------------------------------------
// Epithets
// ---------------------------------------------------------------------------

const LOOKS = ["the Tall", "the Fair", "the Black", "the Red", "the Lame", "the One-Eyed", "the Fat", "the Stammerer", "the Bald", "the Short", "the Handsome", "the Grey"];

function earnEpithet(sim: Sim, pe: PerS, cause: DeathCause): string {
  const rng = sim.rng.people;
  const rec = pe.rec;
  const t = pe.tally;
  const has = (x: Trait) => rec.traits.includes(x);
  const reignStart = rec.roles.find((r) => r.kind === "ruler")?.from ?? sim.year;
  const reign = sim.year - reignStart;
  const age = sim.year - rec.born;
  const c: [string, number][] = [];
  const conq = t.conq ?? 0, won = t.won ?? 0, lost = t.lost ?? 0;
  const areaStart = t.areaStart ?? 1, areaPeak = t.areaPeak ?? 0;
  if (reign < 2 && pe.accAge >= 16) c.push(["the Brief", 3]);
  if (conq >= 10 && areaPeak > areaStart * 1.8 && reign >= 15) c.push(["the Great", 6 + conq / 10]);
  if (conq >= 6 || won >= 6) c.push(["the Conqueror", 4 + conq / 8]);
  if ((t.unify ?? 0) > 0) c.push(["the Unifier", 6]);
  if (won >= 3 && lost === 0) c.push(["the Victorious", 3]);
  if ((t.wonders ?? 0) >= 1) c.push(["the Builder", 3 + (t.wonders ?? 0) + (has("builder") ? 1 : 0)]);
  if ((t.law ?? 0) > 0) c.push(["the Lawgiver", 5]);
  if (has("pious") && ((t.conv ?? 0) + (t.temples ?? 0) > 0)) c.push(["the Pious", 3.5]);
  if (has("pious") && has("kind") && (t.temples ?? 0) > 0) c.push(["the Saint", 3]);
  if (has("cruel") && ((t.sack ?? 0) > 0 || (t.exec ?? 0) > 0)) c.push([conq >= 4 ? "the Terrible" : "the Cruel", 4]);
  else if (has("cruel")) c.push(["the Cruel", 1.5]);
  if ((t.kin ?? 0) > 0) c.push(["the Kinslayer", 6]);
  if (has("mad")) c.push(["the Mad", 5]);
  if (lost >= 3 && won === 0) c.push(["the Unlucky", 3]);
  if ((t.lostSets ?? 0) >= 10 && conq === 0) c.push(["Lackland", 3.5]);
  if (pe.accAge >= 0 && pe.accAge < 10 && reign < 15) c.push(["the Child", 2.5]);
  if (age >= 78) c.push(["the Old", 3]);
  if (cause === "battle" && has("brave")) c.push(["the Bold", 3]);
  else if (has("brave") && won >= 2) c.push(["the Brave", 2]);
  if (has("just")) c.push(["the Just", 2]);
  if (has("kind") && has("generous")) c.push(["the Good", 2.2]);
  if (has("wise")) c.push(["the Wise", 1.8]);
  if (has("scholarly") && (t.works ?? 0) > 0) c.push(["the Learned", 3]);
  if ((t.golden ?? 0) > 0) c.push(["the Magnificent", 3.5]);
  if (has("peaceful") && reign >= 30) c.push(["the Peaceful", 2.2]);
  if (has("greedy")) c.push(["the Avaricious", 0.8]);
  if (cause === "assassinated" && has("pious")) c.push(["the Martyr", 3]);
  if (cause === "executed") c.push(["the Unfortunate", 2]);
  if (reign >= 45) c.push(["the Long-Reigning", 1.6]);
  if (!c.length || rng.chance(0.15)) c.push([rng.pick(LOOKS), 1]);
  c.sort((a, b) => b[1] - a[1]);
  const [best, w] = c[0];
  // Minor epithets stick only sometimes.
  const p = w >= 4 ? 0.9 : w >= 3 ? 0.7 : w >= 2 ? 0.5 : 0.35;
  return rng.chance(p) ? best : "";
}

// ---------------------------------------------------------------------------
// Yearly tick
// ---------------------------------------------------------------------------

function hazard(age: number): number {
  if (age < 1) return 0.14;
  if (age < 5) return 0.03;
  if (age < 15) return 0.006;
  // Gompertz–Makeham, pre-modern elites: about a third of twenty-year-olds see seventy.
  return 0.008 + 0.0001 * Math.exp(0.09 * age);
}

const FERT = (age: number) => (age < 16 ? 0 : age < 20 ? 0.6 : age < 30 ? 1 : age < 35 ? 0.8 : age < 40 ? 0.5 : age < 45 ? 0.2 : 0);

export function tickPeople(sim: Sim): void {
  const rng = sim.rng.people;
  const year = sim.year;
  // Compact the living list.
  if (year % 5 === 0) sim.living = sim.living.filter((id) => sim.Pe[id].alive);
  const list = sim.living.slice();
  const cold = sim.volcanicWinter > 0 ? 0.002 : 0;
  // The marriage market: unmarried royals of marriageable age.
  const market: number[] = [];
  for (const id of list) {
    const q = sim.Pe[id];
    if (!q.alive || q.spouse !== -1 || q.dist > 1 || q.polity < 0) continue;
    const a = year - q.rec.born;
    if (a >= 16 && a <= 40) market.push(id);
  }
  for (const id of list) {
    const pe = sim.Pe[id];
    if (!pe.alive) continue;
    const rec = pe.rec;
    const age = year - rec.born;
    if (age < 0) continue;
    // Death.
    let h = hazard(age) + cold;
    if (rec.traits.includes("sickly")) h *= 2.2;
    if (rec.traits.includes("strong")) h *= 0.75;
    if (rng.chance(h)) {
      const cause: DeathCause = age < 5 ? "infancy" : age >= 58 ? (rng.chance(0.8) ? "natural" : "illness") : rng.chance(0.75) ? "illness" : "accident";
      killPerson(sim, id, cause, pe.rules.length && sim.P[pe.rules[0]].capital >= 0 ? sim.P[pe.rules[0]].capital : -1);
      continue;
    }
    // Rulers: assassination, abdication.
    if (pe.rules.length) {
      const P = sim.P[pe.rules[0]];
      let pa = 0.0006 + (rec.traits.includes("cruel") ? 0.003 : 0) + (rec.traits.includes("mad") ? 0.006 : 0) + 0.004 * (1 - P.legitimacy);
      if (P.gov === "tribe" || P.gov === "chiefdom") pa *= 0.6;
      if (rng.chance(pa)) {
        assassinate(sim, P, id);
        continue;
      }
      if (age >= 68 && P.heir >= 0 && sim.Pe[P.heir].alive && adultAge(sim, P.heir) >= 25 && rng.chance(0.004)) {
        abdicate(sim, P, id, rec.traits.includes("pious") ? "to end his days in prayer" : "old age");
        continue;
      }
    }
    // Regency ends.
    // Marriage.
    if (pe.spouse < 0 && pe.dist <= 1 && pe.polity >= 0) {
      const minAge = rec.sex === "f" ? 16 : 18;
      if (age >= minAge && age <= 50 && rng.chance(age < 35 ? 0.22 : 0.06)) arrangeMarriage(sim, pe, market);
    }
    // Births.
    if (rec.sex === "f" && pe.spouse >= 0 && pe.births < 10) {
      const sp = sim.Pe[pe.spouse];
      if (sp.alive && (pe.dist === 0 || sp.dist === 0)) {
        const f = FERT(age);
        if (f > 0 && rng.chance(0.24 * f)) birth(sim, pe, sp);
      }
    }
  }
  // Regencies ending, heirs.
  for (const P of sim.P) {
    if (!P.alive) continue;
    if (P.regent >= 0 && year >= P.regentUntil) endRegency(sim, P);
    if (P.regent >= 0 && !sim.Pe[P.regent].alive) {
      P.regent = -1;
      if (P.ruler >= 0 && adultAge(sim, P.ruler) < 16) startRegency(sim, P, P.ruler);
    }
    if (P.ruler >= 0 && tracksFamilies(sim, P) && (year + P.id) % 3 === 0) refreshHeir(sim, P);
    if (P.ruler >= 0) {
      const pe = sim.Pe[P.ruler];
      if ((pe.tally.areaPeak ?? 0) < P.area) pe.tally.areaPeak = P.area;
    }
  }
}

function birth(sim: Sim, mother: PerS, father: PerS): void {
  const rng = sim.rng.people;
  const sex: Sex = rng.chance(0.51) ? "m" : "f";
  const dyn = father.rec.dynasty >= 0 ? father.rec.dynasty : mother.rec.dynasty;
  const polity = father.rules.length ? father.rules[0] : mother.rules.length ? mother.rules[0] : father.polity >= 0 ? father.polity : mother.polity;
  const culture = father.rec.dynasty >= 0 || mother.rec.dynasty < 0 ? father.rec.culture : mother.rec.culture;
  const child = newPerson(sim, {
    sex, born: sim.year, culture, religion: father.rec.religion, father: father.id, mother: mother.id, dynasty: dyn, polity, dist: Math.min(father.dist, mother.dist) + 1,
  });
  mother.births++;
  father.births++;
  // Announce births of children of reigning rulers of sizeable realms.
  const ruler = father.rules.length ? father : mother.rules.length ? mother : null;
  if (ruler && polity >= 0 && sim.P[polity].sets.length >= 6) {
    const P = sim.P[polity];
    sim.emit("birth", 1, P.capital >= 0 ? sim.S[P.capital].cell : -1, { persons: [child.id, father.id, mother.id], polities: [polity], dynasties: [dyn] }, { person: child.id, father: father.id, mother: mother.id, polity }, [child.id]);
  }
  if (rng.chance(0.012)) killPerson(sim, mother.id, "childbirth", -1);
}

/** Find a spouse: a royal of a neighbouring realm (alliance) or a noble of the realm. */
function arrangeMarriage(sim: Sim, pe: PerS, market: number[]): void {
  const rng = sim.rng.people;
  const P = sim.P[pe.polity];
  if (!P || !P.alive) return;
  const want: Sex = pe.rec.sex === "m" ? "f" : "m";
  let partner = -1;
  if (P.gov !== "tribe" && rng.chance(0.45)) {
    const nb = (sim.polNbrs.get(P.id) ?? []).concat(P.allies);
    let best = -1, bs = -Infinity;
    for (const id of market) {
      const q = sim.Pe[id];
      if (!q.alive || q.spouse !== -1 || q.rec.sex !== want || q.polity < 0 || q.polity === P.id || q.dist > 1) continue;
      const qa = sim.year - q.rec.born;
      if (qa < 16 || qa > 40) continue;
      if (!nb.includes(q.polity) && sim.P[q.polity].culture !== P.culture) continue;
      if (q.rec.dynasty >= 0 && q.rec.dynasty === pe.rec.dynasty) continue;
      if (sim.P[q.polity].wars.some((w) => sim.W[w].active && (sim.W[w].attSide.includes(P.id) || sim.W[w].defSide.includes(P.id)))) continue;
      const s = (q.rules.length ? 2 : 0) + (q.dist === 0 ? 1 : 0) + sim.P[q.polity].sets.length / 20 + rng.next();
      if (s > bs) {
        bs = s;
        best = id;
      }
    }
    partner = best;
  }
  let consort: PerS;
  if (partner >= 0) consort = sim.Pe[partner];
  else {
    if (pe.dist > 0 && !pe.rules.length) {
      // Younger children marry into untracked noble houses; no record is kept.
      pe.spouse = -2;
      return;
    }
    const age = sim.year - pe.rec.born;
    consort = newPerson(sim, {
      sex: want, born: sim.year - clamp(age + rng.int(want === "f" ? -12 : -3, want === "f" ? 2 : 10), 16, 60), culture: P.culture, religion: P.religion, polity: P.id, dist: 9,
    });
  }
  pe.spouse = consort.id;
  consort.spouse = pe.id;
  pe.rec.spouses.push(consort.id);
  consort.rec.spouses.push(pe.id);
  // The wife joins the husband's house.
  const wife = pe.rec.sex === "f" ? pe : consort;
  const husband = wife === pe ? consort : pe;
  if (!wife.rules.length) wife.polity = husband.polity;
  const Q = partner >= 0 ? sim.P[consort.polity] : undefined;
  const crowned = pe.rules.length > 0 || consort.rules.length > 0 || pe.dist === 0 || consort.dist === 0;
  if (Q && Q.id !== P.id) {
    const pq = [P.id, Q.id];
    P.ties.set(Q.id, sim.year);
    Q.ties.set(P.id, sim.year);
    let alliance = false;
    if (P.overlord < 0 && Q.overlord < 0 && !P.allies.includes(Q.id) && rng.chance(0.4) && P.allies.length < 3 && Q.allies.length < 3) {
      alliance = true;
      P.allies.push(Q.id);
      Q.allies.push(P.id);
    }
    sim.emit("marriage", crowned ? 2 : 1, P.capital >= 0 ? sim.S[P.capital].cell : -1, { persons: [pe.id, consort.id], polities: pq, dynasties: [pe.rec.dynasty, consort.rec.dynasty] }, { a: pe.id, b: consort.id, polities: pq, alliance });
    if (alliance) sim.emit("alliance", 2, -1, { polities: pq, persons: [pe.id, consort.id] }, { a: P.id, b: Q.id, reason: "marriage" });
  } else if (crowned) {
    sim.emit("marriage", 1, P.capital >= 0 ? sim.S[P.capital].cell : -1, { persons: [pe.id, consort.id], polities: [P.id], dynasties: [pe.rec.dynasty] }, { a: pe.id, b: consort.id, polities: [P.id], alliance: false });
  }
}

function assassinate(sim: Sim, P: PolS, victim: number): void {
  const rng = sim.rng.people;
  const v = sim.Pe[victim];
  // Culprit: an ambitious kinsman, else an unnamed conspiracy.
  let culprit = -1;
  const heir = P.heir;
  if (heir >= 0 && sim.Pe[heir].alive && sim.Pe[heir].rec.traits.includes("ambitious") && adultAge(sim, heir) >= 18 && rng.chance(0.5)) culprit = heir;
  const motive = culprit >= 0 ? "the throne" : rng.pick(v.rec.traits.includes("cruel") ? ["revenge for his cruelties", "a slighted noble house", "the throne"] : ["a slighted noble house", "a palace intrigue", "faith", "the throne", "revenge"]);
  if (culprit >= 0) sim.Pe[culprit].tally.kin = (sim.Pe[culprit].tally.kin ?? 0) + 1;
  const cell = P.capital >= 0 ? sim.S[P.capital].cell : -1;
  sim.emit("assassination", P.sets.length >= 45 || P.gov === "empire" ? 4 : 3, cell, { persons: [victim, culprit], polities: [P.id] }, { victim, polity: P.id, culprit, motive }, [victim, culprit].filter((x) => x >= 0));
  P.crisis += 1;
  killPerson(sim, victim, "assassinated", P.capital, culprit);
}

function abdicate(sim: Sim, P: PolS, pid: number, reason: string): void {
  const successor = P.heir;
  const cell = P.capital >= 0 ? sim.S[P.capital].cell : -1;
  sim.emit("abdication", 2, cell, { persons: [pid, successor], polities: [P.id] }, { person: pid, polity: P.id, successor, reason });
  for (const pol of sim.Pe[pid].rules.slice()) {
    const Q = sim.P[pol];
    endReign(sim, Q, pid);
    succeed(sim, Q, pid);
  }
}

/** Depose the ruler of P in favour of `usurper` (who founds a new dynasty unless already of one). */
export function usurp(sim: Sim, P: PolS, usurper: number, kill: boolean): void {
  const rng = sim.rng.people;
  const old = P.ruler;
  const cell = P.capital >= 0 ? sim.S[P.capital].cell : -1;
  const up = sim.Pe[usurper];
  if (up.rec.dynasty < 0 || up.rec.dynasty === P.dynasty) newDynasty(sim, usurper, P.id);
  sim.emit("usurpation", P.sets.length >= 10 ? 4 : 3, cell, { persons: [usurper, old], polities: [P.id], dynasties: [up.rec.dynasty] }, { usurper, deposed: old, polity: P.id, dynasty: up.rec.dynasty }, [usurper]);
  if (old >= 0) {
    endReign(sim, P, old);
    sim.emit("deposition", 2, cell, { persons: [old, usurper], polities: [P.id] }, { person: old, polity: P.id, by: usurper });
    if (kill || rng.chance(0.4)) {
      up.tally.exec = (up.tally.exec ?? 0) + 1;
      killPerson(sim, old, "executed", P.capital, usurper);
    } else {
      // Deposed rulers live on in exile.
      sim.Pe[old].dist = 9;
    }
  }
  if (P.ruler >= 0 && P.ruler !== usurper) endReign(sim, P, P.ruler);
  accede(sim, P, usurper, "usurpation", old, true);
}

// ---------------------------------------------------------------------------
// Finalisation
// ---------------------------------------------------------------------------

export function finishPersons(sim: Sim): void {
  // Dynasty extinction: the year the last member died (if all are dead).
  const lastDeath = new Map<number, number>();
  const anyAlive = new Set<number>();
  for (const p of sim.Pe) {
    const d = p.rec.dynasty;
    if (d < 0) continue;
    if (p.alive) anyAlive.add(d);
    else lastDeath.set(d, Math.max(lastDeath.get(d) ?? -1, p.rec.died));
  }
  for (const d of sim.h.dynasties) d.extinct = anyAlive.has(d.id) ? -1 : lastDeath.get(d.id) ?? d.founded;
  // Untracked-marriage markers.
  for (const p of sim.Pe) if (p.spouse === -2) p.spouse = -1;
}
