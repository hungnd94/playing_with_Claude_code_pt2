/**
 * Diplomacy and war. Realms in contact weigh opinion (kinship, faith, royal
 * marriages, grudges, claims) against relative strength; wars are fought year
 * by year as field battles at fords and passes and sieges of provincial seats
 * (walls, hills and rivers favour defenders, commanders' skill matters);
 * occupied provinces pass at the peace, total defeat means annexation or
 * vassalage, and exhausted belligerents settle for a white peace. Wars,
 * battles and treaties are named from their places and causes. Steppe hordes
 * and sea raiders plunder; hordes sometimes migrate into the farmlands.
 */
import { frontierCell } from "./territory";
import { abandonSettlement } from "./settlements";
import { featureNameFor } from "./features";
import type { LName } from "./names";
import { accede, addRole, closeRole, endReign, hooks, killPerson, newAdult, usurp } from "./people";
import { capitalCell, createPolity, endPolity, independent, provinceOf, reach, relocateCapital, transfer } from "./polities";
import type { PolS, Sim, WarS } from "./sim";
import type { Battle, CasusBelli, War, WarOutcome } from "./types";
import { clamp, remove } from "./util";
import { englishAdjective } from "./query";

// ---------------------------------------------------------------------------
// Opinion
// ---------------------------------------------------------------------------

export function opinion(sim: Sim, A: PolS, B: PolS): number {
  let o = A.culture === B.culture ? 0.3 : sim.familyOf(A.culture) === sim.familyOf(B.culture) ? 0.12 : -0.05;
  const ra = sim.R[A.religion], rb = sim.R[B.religion];
  if (A.religion === B.religion) o += 0.2;
  else if (ra?.organised && rb?.organised) o -= ra.rec.parent === rb.id || rb.rec.parent === ra.id ? 0.4 : 0.3;
  const tie = A.ties.get(B.id);
  if (tie !== undefined && sim.year - tie < 40) o += 0.35;
  if (A.allies.includes(B.id)) o += 0.6;
  o -= 0.3 * (A.grudges.get(B.id) ?? 0);
  let claims = 0;
  for (const [sid] of A.claims) if (sim.S[sid].alive && sim.S[sid].owner === B.id) claims++;
  o -= 0.12 * Math.min(4, claims);
  return o;
}

function claimsOn(sim: Sim, A: PolS, B: PolS): number[] {
  const out: number[] = [];
  for (const [sid, y] of A.claims) if (sim.year - y < 150 && sim.S[sid].alive && sim.S[sid].owner === B.id) out.push(sid);
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Starting and joining wars
// ---------------------------------------------------------------------------

export interface WarOpts {
  rebels?: number;
  claimant?: number;
  migration?: boolean;
  targets?: number[];
  quiet?: boolean;
}

function inWar(w: WarS, p: number): "A" | "D" | null {
  return w.attSide.includes(p) ? "A" : w.defSide.includes(p) ? "D" : null;
}

function atWarWith(sim: Sim, a: number, b: number): boolean {
  for (const wid of sim.P[a].wars) {
    const w = sim.W[wid];
    if (!w.active) continue;
    const sa = inWar(w, a), sb = inWar(w, b);
    if (sa && sb && sa !== sb) return true;
  }
  return false;
}

function pickCommander(sim: Sim, P: PolS): number {
  const rng = sim.rng.war;
  if (P.ruler >= 0) {
    const r = sim.Pe[P.ruler];
    const age = sim.year - r.rec.born;
    if (age >= 18 && age <= 62 && (r.martial > 0.55 || r.rec.traits.includes("brave") || r.rec.traits.includes("warlike")) && !r.rec.traits.includes("craven") && P.regent < 0) return P.ruler;
  }
  // A general rises.
  const g = newAdult(sim, P.culture, P.id, 28, 52, { religion: P.religion, bias: { brave: 2, warlike: 1.6, ambitious: 1.3 } });
  g.martial = clamp(g.martial + rng.range(0.15, 0.35), 0, 1);
  addRole(sim, g.id, "general", P.id);
  return g.id;
}

export function startWar(sim: Sim, A: PolS, B: PolS, cb: CasusBelli, o: WarOpts = {}): number {
  const rng = sim.rng.war;
  const id = sim.W.length;
  const rec: War = {
    id, name: "", casusBelli: cb, attackers: [A.id], defenders: [B.id], joined: [], start: sim.year, end: -1, outcome: "ongoing", battles: [], transfers: [],
    treaty: "", treatySite: -1, casualties: 0, claimant: o.claimant ?? -1,
  };
  sim.h.wars.push(rec);
  const w: WarS = {
    id, rec, active: true, att: A.id, def: B.id, attSide: [A.id], defSide: [B.id], cb, claimant: o.claimant ?? -1, targets: o.targets ?? [], occ: new Map(), score: 0,
    exhaustA: 0, exhaustD: 0, battlesA: 0, battlesD: 0, siege: new Map(), commanderA: -1, commanderD: -1, lastSite: -1, rebels: o.rebels ?? -1, migration: !!o.migration,
    featureHits: new Map(), slainNotables: 0,
  };
  sim.W.push(w);
  A.wars.push(id);
  B.wars.push(id);
  A.rec.wars.push(id);
  B.rec.wars.push(id);
  A.lastWar = B.lastWar = sim.year;
  w.commanderA = pickCommander(sim, A);
  w.commanderD = pickCommander(sim, B);
  // Breaking alliances by attacking an ally.
  if (A.allies.includes(B.id)) {
    remove(A.allies, B.id);
    remove(B.allies, A.id);
    sim.emit("allianceBroken", 2, -1, { polities: [A.id, B.id] }, { a: A.id, b: B.id, reason: "war" });
  }
  if (!o.quiet) {
    const big = A.sets.length + B.sets.length;
    const imp = big >= 90 ? 4 : big >= 15 ? 3 : 2;
    sim.emit("warDeclared", imp, capitalCell(sim, B), { polities: [A.id, B.id], wars: [id], persons: [A.ruler, B.ruler, o.claimant ?? -1], settlements: (o.targets ?? []).slice(0, 6) }, {
      war: id, casusBelli: cb, attacker: A.id, defender: B.id, claimant: o.claimant ?? -1, targets: o.targets ?? [],
    }, [A.ruler].filter((x) => x >= 0));
  }
  // Allies, overlords and vassals.
  if (o.rebels === undefined || o.rebels < 0) {
    const join = (P: PolS, side: "attacker" | "defender", reason: "alliance" | "overlord" | "kin" | "faith") => {
      if (!P.alive || inWar(w, P.id)) return;
      if (atWarWith(sim, P.id, side === "attacker" ? B.id : A.id) && false) return;
      (side === "attacker" ? w.attSide : w.defSide).push(P.id);
      rec.joined.push({ polity: P.id, side, year: sim.year });
      (side === "attacker" ? rec.attackers : rec.defenders).push(P.id);
      P.wars.push(id);
      P.rec.wars.push(id);
      sim.emit("warJoined", P.sets.length >= 15 ? 3 : 2, capitalCell(sim, P), { polities: [P.id, side === "attacker" ? A.id : B.id], wars: [id] }, { war: id, polity: P.id, side, reason });
    };
    for (const q of B.allies) if (rng.chance(0.55 + 0.3 * opinion(sim, sim.P[q], B)) && !inWar(w, q) && !sim.P[q].allies.includes(A.id)) join(sim.P[q], "defender", "alliance");
    for (const q of A.allies) if (rng.chance(0.3 + 0.3 * opinion(sim, sim.P[q], A)) && !inWar(w, q) && !sim.P[q].allies.includes(B.id)) join(sim.P[q], "attacker", "alliance");
    if (B.overlord >= 0 && B.overlord !== A.id) join(sim.P[B.overlord], "defender", "overlord");
    for (const Q of sim.P) {
      if (!Q.alive || Q.overlord < 0) continue;
      if (Q.overlord === A.id && Q.id !== B.id) join(Q, "attacker", "overlord");
      else if (Q.overlord === B.id && Q.id !== A.id) join(Q, "defender", "overlord");
    }
  }
  return id;
}

/** End (as lost) every war of a polity that has ceased to exist. */
export function endWarsOf(sim: Sim, pid: number): void {
  for (const wid of sim.P[pid].wars) {
    const w = sim.W[wid];
    if (!w.active) continue;
    remove(w.attSide, pid);
    remove(w.defSide, pid);
    if (w.att === pid || w.def === pid || !w.attSide.length || !w.defSide.length) {
      const attackerGone = w.att === pid || !w.attSide.length;
      finishWar(sim, w, attackerGone ? "defenderVictory" : "attackerVictory", "status");
    }
  }
}

// ---------------------------------------------------------------------------
// Fighting
// ---------------------------------------------------------------------------

function sideStrength(sim: Sim, w: WarS, side: "A" | "D", targetCell: number): number {
  const list = side === "A" ? w.attSide : w.defSide;
  const leader = side === "A" ? w.att : w.def;
  let s = 0;
  for (const p of list) {
    const P = sim.P[p];
    if (!P.alive) continue;
    let commit = p === leader ? (side === "A" ? 0.75 : 1) : 0.45;
    // Rebels fight at home with the people behind them.
    if (p === w.rebels) commit *= 1.8;
    const cc = capitalCell(sim, P);
    if (cc >= 0 && targetCell >= 0) commit /= 1 + sim.distKm(cc, targetCell) / (1500 + 400 * sim.C[P.culture].tech);
    s += P.strength * commit;
  }
  return s;
}

/** Settlement controller: occupier during war, else owner. */
const ctl = (sim: Sim, sid: number) => sim.controller(sim.S[sid]);

/** A target for side X: an enemy-held town next to X-held land (prefers war goals, provincial seats and big towns). */
function chooseTarget(sim: Sim, w: WarS, X: "A" | "D"): { target: number; from: number } | null {
  const rng = sim.rng.war;
  const mine = X === "A" ? w.attSide : w.defSide;
  const theirs = X === "A" ? w.defSide : w.attSide;
  const myCap = capitalCell(sim, sim.P[X === "A" ? w.att : w.def]);
  let best = -1, from = -1, bs = -Infinity;
  for (const p of theirs) {
    const P = sim.P[p];
    if (!P.alive) continue;
    for (const sid of P.sets) {
      const s = sim.S[sid];
      if (!s.alive) continue;
      const c = ctl(sim, sid);
      if (!theirs.includes(c)) continue;
      let adj = -1;
      for (const n of s.nbrs) {
        const cn = ctl(sim, n);
        if (cn >= 0 && mine.includes(cn)) {
          adj = n;
          break;
        }
      }
      // Towns occupied from us (for the defender to retake) count as targets too.
      if (adj < 0) continue;
      let sc = Math.log(1 + s.urban) * 0.3 + (s.seat === sid ? 0.6 : 0) + (sid === P.capital ? 0.5 : 0) + rng.range(0, 1.2);
      if (w.targets.includes(sid)) sc += 1.5;
      if (myCap >= 0) sc -= sim.distKm(myCap, s.cell) / 2500;
      if (sc > bs) {
        bs = sc;
        best = sid;
        from = adj;
      }
    }
  }
  // The defender also tries to retake its own occupied towns.
  if (X === "D") {
    for (const [sid] of w.occ) {
      const s = sim.S[sid];
      if (!s.alive || !w.attSide.includes(ctl(sim, sid)) || !w.defSide.includes(s.owner)) continue;
      const sc = 1.2 + Math.log(1 + s.urban) * 0.3 + rng.range(0, 1.2);
      if (sc > bs) {
        bs = sc;
        best = sid;
        from = s.nbrs.find((n) => w.defSide.includes(ctl(sim, n))) ?? sid;
      }
    }
  }
  if (best < 0) {
    // Sea-borne descent on an enemy port.
    if (X === "A" || rng.chance(0.3)) return seaTarget(sim, w, X);
    return null;
  }
  return { target: best, from };
}

function seaTarget(sim: Sim, w: WarS, X: "A" | "D"): { target: number; from: number } | null {
  const mine = X === "A" ? w.attSide : w.defSide;
  const theirs = X === "A" ? w.defSide : w.attSide;
  const L = sim.P[X === "A" ? w.att : w.def];
  const C = sim.C[L.culture];
  if (C.tech < 1.5 && C.values.seafaring < 0.5) return null;
  let port = -1;
  for (const sid of L.sets) if (sim.S[sid].port && sim.S[sid].occupier < 0 && (port < 0 || sim.S[sid].urban > sim.S[port].urban)) port = sid;
  if (port < 0) return null;
  // Fleets reach enemy ports within a sailing range (great-circle km).
  const rangeKm = (500 + 900 * C.values.seafaring) * (1 + 0.35 * C.tech);
  const pc = sim.S[port].cell;
  let best = -1, bd = Infinity;
  for (const p of theirs) for (const sid of sim.P[p].sets) {
    const s = sim.S[sid];
    if (!s.alive || !sim.g.coastal[s.cell]) continue;
    const cc = ctl(sim, sid);
    if (!theirs.includes(cc) || mine.includes(cc)) continue;
    const d = sim.distKm(pc, s.cell) - (s.port ? 150 : 0);
    if (d < bd && d < rangeKm) {
      bd = d;
      best = sid;
    }
  }
  return best >= 0 ? { target: best, from: port } : null;
}

const BATTLE_FEATURE_KINDS = new Set(["river", "mountains", "hills", "marsh", "forest", "plain", "steppe", "desert", "lake", "jungle"]);

function battleName(sim: Sim, w: WarS, cell: number, site: number, kind: Battle["kind"], culture: number): { name: string; feature: number } {
  const rng = sim.rng.war;
  const sn = site >= 0 ? sim.S[site].name.roman : "";
  if (kind === "siege") return { name: `the Siege of ${sn}`, feature: -1 };
  if (kind === "sack") return { name: `the Sack of ${sn}`, feature: -1 };
  // Fords, passes and named landscapes give their names to battles.
  const river = sim.g.riverOf[cell];
  const region = sim.w.regionOf[cell];
  const pickF = (f: number) => {
    const n = featureNameFor(sim, f, culture);
    return n ? n.roman : "";
  };
  if (river >= 0 && rng.chance(0.45)) {
    const rn = pickF(river);
    if (rn) return { name: sn && rng.chance(0.5) ? `the Battle of ${sn} Ford` : `the Battle of the ${rn}`, feature: river };
  }
  if (region >= 0 && BATTLE_FEATURE_KINDS.has(sim.w.features[region].kind) && rng.chance(0.3)) {
    const k = sim.w.features[region].kind;
    const rn = pickF(region);
    if (rn) {
      const tail = k === "mountains" || k === "hills" ? (rng.chance(0.5) ? " Pass" : "") : k === "plain" || k === "steppe" ? " Fields" : "";
      return { name: `the Battle of the ${rn}${tail}`, feature: region };
    }
  }
  return { name: sn ? `the Battle of ${sn}` : "a nameless battle", feature: -1 };
}

function recordBattle(sim: Sim, w: WarS, b: Omit<Battle, "id" | "war" | "year" | "name" | "feature">, culture: number): Battle {
  const id = sim.h.battles.length;
  const { name, feature } = battleName(sim, w, b.cell, b.site, b.kind, culture);
  const rec: Battle = { id, war: w.id, year: sim.year, name, feature, ...b };
  sim.h.battles.push(rec);
  w.rec.battles.push(id);
  w.rec.casualties += b.attacker.losses + b.defender.losses;
  if (feature >= 0) w.featureHits.set(feature, (w.featureHits.get(feature) ?? 0) + 1);
  if (b.site >= 0) w.lastSite = b.site;
  return rec;
}

/** Remove soldiers from a realm's population. */
function bleed(sim: Sim, P: PolS, n: number): void {
  if (P.pop <= 0 || n <= 0) return;
  const f = Math.min(0.2, n / P.pop);
  for (const sid of P.sets) sim.S[sid].pop *= 1 - f;
  P.pop *= 1 - f;
  P.strength = Math.max(0, P.strength - n * 0.8);
  P.warWeariness += Math.min(0.5, n / Math.max(1, P.strength + n)) * 0.6;
}

function commanderOf(sim: Sim, w: WarS, X: "A" | "D"): number {
  let c = X === "A" ? w.commanderA : w.commanderD;
  if (c < 0 || !sim.Pe[c].alive) {
    const P = sim.P[X === "A" ? w.att : w.def];
    c = pickCommander(sim, P);
    if (X === "A") w.commanderA = c;
    else w.commanderD = c;
  }
  return c;
}

function fieldBattle(sim: Sim, w: WarS, X: "A" | "D", target: number, from: number): boolean {
  const rng = sim.rng.war;
  const Y = X === "A" ? "D" : "A";
  const cell = from !== target && sim.S[from].alive ? frontierCell(sim, from, target) : sim.S[target].cell;
  const sx = sideStrength(sim, w, X, cell), sy = sideStrength(sim, w, Y, cell);
  if (sx <= 0 || sy <= 0) return sx > 0;
  const ex = sx * rng.range(0.3, 0.75), ey = sy * rng.range(0.3, 0.75);
  const cx = commanderOf(sim, w, X), cy = commanderOf(sim, w, Y);
  const mx = sim.Pe[cx].martial, my = sim.Pe[cy].martial;
  const LX = sim.P[X === "A" ? w.att : w.def], LY = sim.P[Y === "A" ? w.att : w.def];
  const tx = sim.C[LX.culture].tech, ty = sim.C[LY.culture].tech;
  const river = sim.w.riverOrder[cell] > 0 ? 0.25 : 0;
  const defBonus = 1 + 0.5 * sim.g.defense[cell] + river;
  const px = Math.pow(ex * (0.7 + 0.6 * mx) * Math.pow(1.12, tx - ty), 1.25);
  const py = Math.pow(ey * (0.7 + 0.6 * my) * defBonus, 1.25);
  const xWins = rng.next() < px / (px + py);
  const lw = rng.range(0.05, 0.14), ll = rng.range(0.15, 0.42);
  const lossX = Math.round(ex * (xWins ? lw : ll)), lossY = Math.round(ey * (xWins ? ll : lw));
  bleed(sim, LX, lossX);
  bleed(sim, LY, lossY);
  const slain: number[] = [];
  const loserC = xWins ? cy : cx, winnerC = xWins ? cx : cy;
  if (rng.chance(0.14)) slain.push(loserC);
  else if (rng.chance(0.03)) slain.push(winnerC);
  const isAtt = X === "A";
  const att = isAtt ? { polity: LX.id, commander: cx, strength: Math.round(ex), losses: lossX } : { polity: LY.id, commander: cy, strength: Math.round(ey), losses: lossY };
  const def = isAtt ? { polity: LY.id, commander: cy, strength: Math.round(ey), losses: lossY } : { polity: LX.id, commander: cx, strength: Math.round(ex), losses: lossX };
  const attWon = isAtt ? xWins : !xWins;
  const b = recordBattle(sim, w, { kind: "field", cell, site: sim.cellSet[cell] >= 0 ? sim.cellSet[cell] : target, attacker: att, defender: def, victor: attWon ? "attacker" : "defender", slain }, LX.culture);
  if (attWon) w.battlesA++;
  else w.battlesD++;
  const decisive = ll > 0.32 && (xWins ? ex > ey * 0.8 : ey > ex * 0.8);
  const victor = attWon ? att.polity : def.polity, loser = attWon ? def.polity : att.polity;
  const tot = lossX + lossY;
  const imp = tot > 45000 || (decisive && tot > 25000) ? 4 : tot > 8000 ? 3 : 2;
  sim.emit("battle", imp, cell, { polities: [att.polity, def.polity], persons: [cx, cy, ...slain], wars: [w.id], battles: [b.id], settlements: [b.site] }, {
    war: w.id, battle: b.id, victor, loser, kind: "field", attackerLosses: att.losses, defenderLosses: def.losses, decisive,
  }, [cx, cy]);
  for (const [c, won] of [[winnerC, true], [loserC, false]] as [number, boolean][]) {
    const pe = sim.Pe[c];
    pe.tally[won ? "won" : "lost"] = (pe.tally[won ? "won" : "lost"] ?? 0) + 1;
  }
  for (const s of slain) if (sim.Pe[s].alive) {
    w.slainNotables++;
    killPerson(sim, s, "battle", b.site, -1);
  }
  return xWins;
}

/** Take `target` and occupy its province. */
function occupy(sim: Sim, w: WarS, X: "A" | "D", target: number): void {
  const by = X === "A" ? w.att : w.def;
  const owner = sim.S[target].owner;
  const members = owner >= 0 && sim.S[target].seat === target ? provinceOf(sim, target) : [target];
  const enemy = X === "A" ? w.defSide : w.attSide;
  for (const m of members) {
    const s = sim.S[m];
    if (!s.alive) continue;
    const c = ctl(sim, m);
    if (!enemy.includes(c)) continue;
    if ((X === "A" ? w.attSide : w.defSide).includes(s.owner)) {
      // Liberation of our own town.
      endOccupation(sim, w, m);
      continue;
    }
    s.occupier = by;
    s.occWar = w.id;
    w.occ.set(m, sim.year);
  }
}

function endOccupation(sim: Sim, w: WarS, sid: number): void {
  const s = sim.S[sid];
  const from = w.occ.get(sid);
  if (from !== undefined && s.occupier >= 0) s.rec.occupations.push({ from, to: sim.year, by: s.occupier, war: w.id });
  s.occupier = -1;
  s.occWar = -1;
  w.occ.delete(sid);
}

function siege(sim: Sim, w: WarS, X: "A" | "D", target: number, boost: number): void {
  const rng = sim.rng.war;
  const s = sim.S[target];
  const Y = X === "A" ? "D" : "A";
  const sx = sideStrength(sim, w, X, s.cell), sy = sideStrength(sim, w, Y, s.cell);
  const walls = s.walls ? 2.3 : 1;
  const terrain = 1 + 0.8 * sim.g.defense[s.cell];
  const garrison = Math.max(50, (s.pop * 0.015 + sy * 0.12) * walls * terrain);
  const besiegers = sx * rng.range(0.3, 0.8);
  let prog = (w.siege.get(target) ?? 0) + boost;
  prog += 0.55 * Math.pow(besiegers / garrison, 0.6) * rng.range(0.5, 1.3);
  const LX = sim.P[X === "A" ? w.att : w.def];
  const defenderP = s.occupier >= 0 ? sim.P[s.occupier] : sim.P[s.owner];
  const cx = commanderOf(sim, w, X);
  if (prog >= 1) {
    w.siege.delete(target);
    const lossX = Math.round(besiegers * rng.range(0.03, 0.12)), lossY = Math.round(garrison / walls * rng.range(0.3, 0.7));
    bleed(sim, LX, lossX);
    if (defenderP) bleed(sim, defenderP, lossY);
    const attIsX = X === "A";
    const b = recordBattle(sim, w, {
      kind: "siege", cell: s.cell, site: target,
      attacker: attIsX ? { polity: LX.id, commander: cx, strength: Math.round(besiegers), losses: lossX } : { polity: defenderP.id, commander: -1, strength: Math.round(garrison), losses: lossY },
      defender: attIsX ? { polity: defenderP.id, commander: -1, strength: Math.round(garrison), losses: lossY } : { polity: LX.id, commander: cx, strength: Math.round(besiegers), losses: lossX },
      victor: attIsX ? "attacker" : "defender", slain: [],
    }, LX.culture);
    if (attIsX) w.battlesA++;
    else w.battlesD++;
    const imp = s.rank >= 3 || (target === defenderP.capital && defenderP.sets.length >= 20) ? 4 : s.rank >= 2 || target === defenderP.capital ? 3 : 2;
    sim.emit("siege", imp, s.cell, { polities: [LX.id, defenderP.id], settlements: [target], wars: [w.id], battles: [b.id], persons: [cx] }, {
      war: w.id, battle: b.id, settlement: target, besieger: LX.id, defender: defenderP.id, outcome: "taken", walls: s.walls,
    }, [cx]);
    occupy(sim, w, X, target);
    maybeSack(sim, w, LX, target);
  } else {
    w.siege.set(target, prog);
    // Long fruitless sieges are lifted.
    if (prog < 0.45 && rng.chance(0.35)) {
      w.siege.delete(target);
      const b = recordBattle(sim, w, {
        kind: "siege", cell: s.cell, site: target,
        attacker: X === "A" ? { polity: LX.id, commander: cx, strength: Math.round(besiegers), losses: Math.round(besiegers * 0.1) } : { polity: defenderP.id, commander: -1, strength: Math.round(garrison), losses: 0 },
        defender: X === "A" ? { polity: defenderP.id, commander: -1, strength: Math.round(garrison), losses: Math.round(garrison * 0.1) } : { polity: LX.id, commander: cx, strength: Math.round(besiegers), losses: 0 },
        victor: X === "A" ? "defender" : "attacker", slain: [],
      }, LX.culture);
      bleed(sim, LX, besiegers * 0.1);
      if (X === "A") w.battlesD++;
      else w.battlesA++;
      sim.emit("siege", s.rank >= 2 ? 3 : 2, s.cell, { polities: [LX.id, defenderP.id], settlements: [target], wars: [w.id], battles: [b.id], persons: [cx] }, {
        war: w.id, battle: b.id, settlement: target, besieger: LX.id, defender: defenderP.id, outcome: "repulsed", walls: s.walls,
      }, [cx]);
    }
  }
}

function maybeSack(sim: Sim, w: WarS, by: PolS, target: number): void {
  const rng = sim.rng.war;
  const s = sim.S[target];
  const C = sim.C[by.culture];
  const ruler = by.ruler >= 0 ? sim.Pe[by.ruler].rec : undefined;
  let p = 0.06 + (C.archetype === "steppe" || by.gov === "horde" ? 0.3 : 0) + (C.raiders ? 0.2 : 0) + (w.cb === "holyWar" ? 0.15 : 0) + (w.cb === "revenge" ? 0.1 : 0);
  if (ruler?.traits.includes("cruel")) p += 0.15;
  if (ruler?.traits.includes("kind")) p -= 0.05;
  if (sim.year - s.lastSack < 30) p *= 0.3;
  if (!rng.chance(p)) return;
  const deaths = Math.round(s.urban * rng.range(0.1, 0.35) + s.pop * 0.03);
  s.pop = Math.max(150, s.pop - deaths);
  s.devast = Math.min(1, s.devast + 0.7);
  s.wealth *= 0.4;
  s.lastSack = sim.year;
  by.treasury += s.urban * 0.05;
  const destroyed = s.rank <= 1 && rng.chance(0.12);
  const b = recordBattle(sim, w, {
    kind: "sack", cell: s.cell, site: target,
    attacker: { polity: by.id, commander: by.ruler, strength: 0, losses: 0 }, defender: { polity: s.owner, commander: -1, strength: 0, losses: deaths }, victor: "attacker", slain: [],
  }, by.culture);
  sim.emit("sack", s.rank >= 3 ? 4 : s.rank >= 2 ? 3 : 2, s.cell, { polities: [by.id, s.owner], settlements: [target], wars: [w.id], battles: [b.id], persons: [by.ruler] }, {
    settlement: target, by: by.id, war: w.id, deaths, destroyed,
  }, [by.ruler].filter((x) => x >= 0));
  if (by.ruler >= 0) sim.Pe[by.ruler].tally.sack = (sim.Pe[by.ruler].tally.sack ?? 0) + 1;
  for (const wid of s.rec.wonders) {
    const W = sim.h.wonders[wid];
    if (W.destroyed < 0 && W.completed >= 0 && rng.chance(0.35)) {
      W.destroyed = sim.year;
      W.destroyCause = "war";
      sim.emit("wonderDestroyed", 4, s.cell, { wonders: [wid], settlements: [target], polities: [by.id], wars: [w.id] }, { wonder: wid, cause: "war", by: by.id });
    }
  }
  if (ruler?.traits.includes("cruel") && rng.chance(0.3)) {
    sim.emit("massacre", 3, s.cell, { polities: [by.id], settlements: [target], persons: [by.ruler], wars: [w.id] }, { settlement: target, by: by.id, deaths: Math.round(deaths * 0.5), reason: w.cb === "holyWar" ? "unbelief" : "resistance" });
  }
  if (destroyed) {
    for (const wl of sim.W) if (wl.active) wl.occ.delete(target);
    abandonSettlement(sim, target, "sacked");
  }
}

// ---------------------------------------------------------------------------
// The course of a war
// ---------------------------------------------------------------------------

function valueOf(sim: Sim, side: number[]): number {
  let v = 0;
  for (const p of side) for (const sid of sim.P[p].sets) v += sim.S[sid].pop;
  return v;
}

function occupiedValue(sim: Sim, side: number[], by: number[]): number {
  let v = 0;
  for (const p of side) for (const sid of sim.P[p].sets) {
    const s = sim.S[sid];
    if (s.occupier >= 0 && by.includes(s.occupier)) v += s.pop;
  }
  return v;
}

function warYear(sim: Sim, w: WarS): void {
  const rng = sim.rng.war;
  // Participants that fell or made separate peace.
  w.attSide = w.attSide.filter((p) => sim.P[p].alive);
  w.defSide = w.defSide.filter((p) => sim.P[p].alive);
  if (!w.attSide.length || !w.defSide.length || !sim.P[w.att].alive || !sim.P[w.def].alive) {
    finishWar(sim, w, !sim.P[w.att].alive || !w.attSide.length ? "defenderVictory" : "attackerVictory", "status");
    return;
  }
  const A = sim.P[w.att], D = sim.P[w.def];
  const sa = sideStrength(sim, w, "A", capitalCell(sim, D)), sd = sideStrength(sim, w, "D", capitalCell(sim, A));
  const nAct = 1 + (sa + sd > 50000 ? 1 : 0) + (sa + sd > 180000 ? 1 : 0);
  for (let i = 0; i < nAct; i++) {
    const pa = Math.pow(sa, 0.8) / (Math.pow(sa, 0.8) + Math.pow(sd, 0.8) + 1e-9);
    const X: "A" | "D" = rng.next() < 0.25 + 0.6 * pa ? "A" : "D";
    const t = chooseTarget(sim, w, X);
    if (!t) continue;
    const s = sim.S[t.target];
    const fieldFirst = rng.chance(s.walls ? 0.45 : 0.6);
    if (fieldFirst) {
      const won = fieldBattle(sim, w, X, t.target, t.from);
      if (won) siege(sim, w, X, t.target, 0.25);
    } else siege(sim, w, X, t.target, 0);
  }
  // Exhaustion and peace.
  const years = sim.year - w.rec.start;
  const vA = valueOf(sim, w.attSide), vD = valueOf(sim, w.defSide);
  const scoreA = clamp(occupiedValue(sim, w.defSide, w.attSide) / (vD || 1) + 0.03 * (w.battlesA - w.battlesD), -1, 1);
  const scoreD = clamp(occupiedValue(sim, w.attSide, w.defSide) / (vA || 1) + 0.03 * (w.battlesD - w.battlesA), -1, 1);
  w.score = scoreA - scoreD;
  w.exhaustA += 0.05 + 0.4 * Math.max(0, scoreD) + 0.25 * A.warWeariness * 0.2;
  w.exhaustD += 0.05 + 0.4 * Math.max(0, scoreA) + 0.25 * D.warWeariness * 0.2;
  const capTaken = D.capital >= 0 && sim.S[D.capital].occupier >= 0 && w.attSide.includes(sim.S[D.capital].occupier);
  const resolveA = 1.1 + 0.6 * sim.C[A.culture].values.martial;
  const resolveD = 1.3 + 0.6 * sim.C[D.culture].values.martial;
  if (w.rebels >= 0) {
    // Independence wars: rebels (attackers) win by outlasting, lose when crushed.
    const R = sim.P[w.rebels];
    const held = R.sets.filter((sid) => sim.S[sid].occupier < 0).length;
    if (held === 0 || (scoreD > 0.85 && rng.chance(0.5))) return finishWar(sim, w, "defenderVictory", "annex");
    if (w.exhaustD > resolveD * (D.sets.length > 3 * R.sets.length ? 1.3 : 0.9) || (years >= 4 && scoreD < 0.2 && rng.chance(0.25))) return finishWar(sim, w, "attackerVictory", "status");
    return;
  }
  if (capTaken && scoreA > 0.45) return finishWar(sim, w, "attackerVictory", scoreA > 0.7 || D.provinces.size <= 2 ? "annex" : "transfer");
  if (scoreA >= 0.8) return finishWar(sim, w, "attackerVictory", "annex");
  if (scoreA >= 0.3 && w.exhaustD > resolveD) return finishWar(sim, w, "attackerVictory", "transfer");
  if (w.exhaustA > resolveA && scoreA < 0.25) return finishWar(sim, w, scoreD > 0.15 ? "defenderVictory" : "whitePeace", scoreD > 0.15 ? "transfer" : "status");
  if (years > 5 && rng.chance(0.03 * (years - 5))) {
    if (scoreA > 0.2) return finishWar(sim, w, "attackerVictory", "transfer");
    if (scoreD > 0.2) return finishWar(sim, w, "defenderVictory", "transfer");
    return finishWar(sim, w, "whitePeace", "status");
  }
}

/** Settle a war. `mode`: annex the loser, transfer occupied towns, or restore the status quo. */
function finishWar(sim: Sim, w: WarS, outcome: WarOutcome, mode: "annex" | "transfer" | "status"): void {
  if (!w.active) return;
  const rng = sim.rng.war;
  w.active = false;
  const rec = w.rec;
  rec.end = sim.year;
  rec.outcome = outcome;
  const A = sim.P[w.att], D = sim.P[w.def];
  const attWon = outcome === "attackerVictory", defWon = outcome === "defenderVictory";
  const winners = attWon ? w.attSide : defWon ? w.defSide : [];
  const W = attWon ? A : defWon ? D : undefined;
  const L = attWon ? D : defWon ? A : undefined;
  // Transfers of occupied towns.
  const occ = [...w.occ.keys()].sort((a, b) => a - b);
  for (const sid of occ) {
    const s = sim.S[sid];
    const by = s.occupier;
    endOccupation(sim, w, sid);
    if (!s.alive || by < 0 || !sim.P[by].alive) continue;
    if (mode !== "status" && winners.includes(by) && w.rebels < 0) {
      const from = s.owner;
      transfer(sim, sid, by, true);
      rec.transfers.push({ settlement: sid, from, to: by });
      sim.emit("conquest", s.rank >= 2 ? 2 : 1, s.cell, { settlements: [sid], polities: [from, by], wars: [w.id] }, { settlement: sid, from, to: by, war: w.id });
    }
  }
  // Realms left without a town are swallowed.
  let annexed = false;
  if (W) for (const p of (W === A ? w.defSide : w.attSide)) {
    const Lq = sim.P[p];
    if (!Lq.alive || Lq.rebel || Lq.sets.some((sid) => sim.S[sid].alive && sim.S[sid].owner === p)) continue;
    sim.emit("polityAnnexed", Lq.rec.peak.areaKm2 > 1e6 ? 4 : 3, capitalCell(sim, W), { polities: [p, W.id], wars: [w.id], persons: [Lq.ruler, W.ruler] }, { polity: p, by: W.id, war: w.id, last: Lq.ruler });
    endPolity(sim, Lq, "conquered", W.id);
    if (Lq === L) annexed = true;
  }
  // Rebels, factions, claimants.
  if (w.rebels >= 0) {
    const R = sim.P[w.rebels];
    const other = R.id === A.id ? D : A;
    if (attWon && R.alive) {
      R.rebel = false;
      sim.emit("independence", R.sets.length >= 8 ? 4 : 3, capitalCell(sim, R), { polities: [R.id, other.id], wars: [w.id], persons: [R.ruler] }, { polity: R.id, from: other.id, war: w.id });
      if (R.overlord === other.id) sim.setOverlord(R, -1);
      R.legitimacy = 0.7;
    } else if (R.alive) {
      const leader = R.ruler;
      for (const sid of R.sets.slice()) {
        transfer(sim, sid, other.id, false);
        // Cowed for a generation.
        sim.S[sid].loyalty = Math.max(sim.S[sid].loyalty, 0.55);
        sim.S[sid].lastRevolt = sim.year;
      }
      sim.emit("revoltCrushed", R.sets.length >= 8 ? 3 : 2, capitalCell(sim, other), { polities: [R.id, other.id], wars: [w.id], persons: [leader, other.ruler] }, { rebels: R.id, polity: other.id, leader });
      if (other.ruler >= 0) sim.Pe[other.ruler].tally.rebel = (sim.Pe[other.ruler].tally.rebel ?? 0) + 1;
      endPolity(sim, R, "conquered", other.id);
      if (leader >= 0 && sim.Pe[leader].alive) {
        if (rng.chance(0.6)) {
          if (other.ruler >= 0) sim.Pe[other.ruler].tally.exec = (sim.Pe[other.ruler].tally.exec ?? 0) + 1;
          killPerson(sim, leader, "executed", other.capital, other.ruler);
        } else closeRole(sim, leader, "pretender", other.id);
      }
    }
  } else if (mode === "annex" && W && L && L.alive) {
    // Total defeat: annexation, or vassalage for distant or foreign realms.
    const vassal = w.cb === "subjugation" || (L.culture !== W.culture && L.sets.length >= 6 && rng.chance(0.45)) || (rng.chance(0.25) && L.sets.length >= 4);
    if (vassal && L.overlord < 0) {
      sim.setOverlord(L, W.id);
      sim.emit("vassalized", L.sets.length >= 10 ? 4 : 3, capitalCell(sim, L), { polities: [L.id, W.id], wars: [w.id], persons: [W.ruler, L.ruler] }, { vassal: L.id, overlord: W.id, war: w.id });
    } else {
      const last = L.ruler;
      const big = L.sets.length >= 10 || L.gov === "empire";
      sim.emit("polityAnnexed", big ? 4 : 3, capitalCell(sim, L), { polities: [L.id, W.id], wars: [w.id], persons: [last, W.ruler] }, { polity: L.id, by: W.id, war: w.id, last });
      for (const sid of L.sets.slice()) {
        if (!sim.S[sid].alive) continue;
        const from = L.id;
        transfer(sim, sid, W.id, true);
        rec.transfers.push({ settlement: sid, from, to: W.id });
      }
      endPolity(sim, L, "conquered", W.id);
      annexed = true;
      if (last >= 0 && sim.Pe[last].alive && rng.chance(0.35)) killPerson(sim, last, "executed", W.capital, W.ruler);
      if (w.migration) {
        // The horde settles in its conquest.
        relocateCapital(sim, W, "conquest");
      }
    }
  }
  if (W && L && w.claimant >= 0 && sim.Pe[w.claimant].alive && L.alive && !annexed) {
    // A claimant's victory puts him on the throne.
    if (w.cb === "succession" || w.cb === "civilWar") {
      const claimant = w.claimant;
      if (attWon) {
        const faction = A;
        const main = D;
        if (faction.rebel && main.alive) {
          for (const sid of faction.sets.slice()) transfer(sim, sid, main.id, false);
          endReign(sim, faction, claimant);
          endPolity(sim, faction, "merged", main.id);
          usurp(sim, main, claimant, rng.chance(0.4));
        } else if (main.alive) {
          // Foreign claimant: personal union.
          if (main.ruler >= 0) endReign(sim, main, main.ruler);
          accede(sim, main, claimant, "claim", -1);
          if (sim.Pe[claimant].rules.length > 1) main.unionWith = sim.Pe[claimant].rules[0] === main.id ? -1 : sim.Pe[claimant].rules[0];
        }
      } else if (A.rebel && A.alive) {
        for (const sid of A.sets.slice()) transfer(sim, sid, D.id, false);
        sim.emit("revoltCrushed", 3, capitalCell(sim, D), { polities: [A.id, D.id], wars: [w.id], persons: [claimant, D.ruler] }, { rebels: A.id, polity: D.id, leader: claimant });
        endPolity(sim, A, "conquered", D.id);
        if (rng.chance(0.55)) killPerson(sim, claimant, "executed", D.capital, D.ruler);
      }
    }
  }
  // Holy wars convert the conquered.
  if (attWon && w.cb === "holyWar") for (const t of rec.transfers) if (sim.S[t.settlement].alive && rng.chance(0.5)) sim.setReligion(sim.S[t.settlement], A.religion);
  // Aftermath.
  const years = sim.year - rec.start;
  for (const p of [...w.attSide, ...w.defSide]) {
    const P = sim.P[p];
    remove(P.wars, w.id);
    P.warWeariness += 0.1 + 0.02 * years;
  }
  for (const a of w.attSide) for (const d of w.defSide) {
    const PA = sim.P[a], PD = sim.P[d];
    PA.truces.set(d, sim.year + rng.int(15, 35));
    PD.truces.set(a, sim.year + rng.int(15, 35));
  }
  if (W && L) {
    L.grudges.set(W.id, (L.grudges.get(W.id) ?? 0) + 1);
    L.crisis += 1.5;
    L.cohesion = Math.max(0.05, L.cohesion - 0.06);
    W.cohesion = Math.min(1.1, W.cohesion + (W === D ? 0.06 : 0.03));
    if (L.ruler >= 0) sim.Pe[L.ruler].tally.wlost = (sim.Pe[L.ruler].tally.wlost ?? 0) + 1;
    W.prestige += 1;
  }
  rec.name = nameWar(sim, w);
  const site = w.lastSite >= 0 && sim.S[w.lastSite].alive ? w.lastSite : D.capital >= 0 ? D.capital : A.capital;
  rec.treatySite = annexed ? -1 : site;
  rec.treaty = rec.treatySite >= 0 ? treatyName(sim, outcome, rec.treatySite) : "";
  const big = rec.casualties > 60000 || rec.transfers.length >= 15 || annexed && (L?.sets.length ?? 0) >= 10;
  sim.emit("peace", big ? 4 : rec.casualties > 15000 || rec.transfers.length >= 4 ? 3 : 2, site >= 0 ? sim.S[site].cell : -1, {
    polities: [...new Set([...w.attSide, ...w.defSide, A.id, D.id])], wars: [w.id], settlements: [rec.treatySite],
  }, { war: w.id, treaty: rec.treaty, site: rec.treatySite, outcome, transfers: rec.transfers.length, years });
  for (const c of [w.commanderA, w.commanderD]) if (c >= 0) closeRole(sim, c, "general", sim.Pe[c].polity);
  // Victorious generals may turn on weak masters.
  if (W && W.alive && !W.rebel) {
    const g = W === A ? w.commanderA : w.commanderD;
    if (g >= 0 && g !== W.ruler && sim.Pe[g].alive && sim.Pe[g].rec.traits.includes("ambitious") && (sim.Pe[g].tally.won ?? 0) >= 2 && W.legitimacy < 0.6 && rng.chance(0.35)) {
      sim.emit("coup", 4, capitalCell(sim, W), { polities: [W.id], persons: [g, W.ruler] }, { polity: W.id, leader: g, from: W.gov, to: W.gov });
      usurp(sim, W, g, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
export function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 200) return "Hundred" + (n % 100 ? " and " + numberWords(n % 100) : "");
  return String(n);
}

const ORD = ["", "", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

function uniqueName(sim: Sim, base: string): string {
  const key = `war:${base}`;
  const n = (sim.counters[key] ?? 0) + 1;
  sim.counters[key] = n;
  if (n === 1) return base;
  return base.replace(/^the /, `the ${ORD[Math.min(10, n)] || n + "th"} `);
}

function adjOf(sim: Sim, p: number): string {
  const name = sim.P[p].name.roman.split(" ")[0];
  return englishAdj(name);
}

/** English adjective from a romanised name (see query.englishAdjective). */
export const englishAdj = englishAdjective;

function nameWar(sim: Sim, w: WarS): string {
  const rng = sim.rng.war;
  const A = sim.P[w.att], D = sim.P[w.def];
  const years = Math.max(1, sim.year - w.rec.start);
  const aAdj = adjOf(sim, A.id), dAdj = adjOf(sim, D.id);
  // Long wars are remembered by their length.
  if (years >= 90 && rng.chance(0.8)) return uniqueName(sim, "the Hundred Years' War");
  if (years >= 20 && rng.chance(0.35)) return uniqueName(sim, `the ${numberWords(years)} Years' War`);
  if (years >= 25 && rng.chance(0.3)) return uniqueName(sim, "the Long War");
  let topF = -1, topN = 0;
  for (const [f, n] of w.featureHits) if (n > topN || (n === topN && f < topF)) {
    topF = f;
    topN = n;
  }
  const fname = topF >= 0 ? featureNameFor(sim, topF, D.culture)?.roman : undefined;
  switch (w.cb) {
    case "independence":
      if (w.rebels >= 0) {
        const R = sim.P[w.rebels];
        return uniqueName(sim, w.rec.outcome === "attackerVictory" ? `the ${adjOf(sim, R.id)} War of Independence` : rng.chance(0.5) ? `the ${adjOf(sim, R.id)} Revolt` : `the Rising of ${R.name.roman}`);
      }
      return uniqueName(sim, `the ${aAdj} War of Independence`);
    case "succession":
    case "civilWar": {
      const c = w.claimant >= 0 ? (sim.Pe[w.claimant].rec.name as unknown as LName).meta?.given ?? sim.Pe[w.claimant].rec.name.roman.split(" ")[0] : "";
      const r = rng.next();
      if (A.rebel && r < 0.35 && c) return uniqueName(sim, `the War of ${c}`);
      if (r < 0.55) return uniqueName(sim, `the War of the ${dAdj} Succession`);
      if (r < 0.75) return uniqueName(sim, "the War of the Two Crowns");
      return uniqueName(sim, `the ${dAdj} Civil War`);
    }
    case "holyWar":
      return uniqueName(sim, rng.chance(0.5) ? `the Holy War of ${A.name.roman}` : `the War of the Faiths`);
    case "raid":
      return uniqueName(sim, `the ${aAdj} Invasion`);
    case "reconquest": {
      const t = w.targets.length ? sim.S[w.targets[0]].name.roman : "";
      if (t && rng.chance(0.6)) return uniqueName(sim, `the War of ${t}`);
      break;
    }
    case "trade": {
      const goods = ["Salt", "Amber", "Tin", "Silver", "Spice", "Wine", "Fur", "Pearl", "Incense", "Copper"];
      return uniqueName(sim, `the ${rng.pick(goods)} War`);
    }
    case "revenge":
      if (rng.chance(0.3)) return uniqueName(sim, `the War of Vengeance`);
      break;
    default:
      break;
  }
  if (w.migration) return uniqueName(sim, `the ${aAdj} Invasion`);
  if (fname && rng.chance(0.55)) return uniqueName(sim, rng.chance(0.5) ? `the ${fname} War` : `the War of the ${fname}`);
  const nPart = w.rec.attackers.length + w.rec.defenders.length;
  if (nPart >= 5 && w.rec.casualties > 150000 && !sim.flags.has("greatWar") && rng.chance(0.6)) {
    sim.flags.add("greatWar");
    return uniqueName(sim, "the Great War");
  }
  if (nPart >= 3 && rng.chance(0.3)) return uniqueName(sim, `the War of the ${numberWords(nPart)} ${rng.chance(0.5) ? "Kings" : "Crowns"}`);
  const site = w.lastSite >= 0 ? sim.S[w.lastSite].name.roman : "";
  if (site && rng.chance(0.35)) return uniqueName(sim, `the ${site} War`);
  return uniqueName(sim, `the ${aAdj}–${dAdj} War`);
}

function treatyName(sim: Sim, outcome: WarOutcome, site: number): string {
  const rng = sim.rng.war;
  const n = sim.S[site].name.roman;
  if (outcome === "whitePeace") return rng.chance(0.5) ? `the Truce of ${n}` : `the Peace of ${n}`;
  return rng.pick([`the Peace of ${n}`, `the Treaty of ${n}`, `the Peace of ${n}`, `the Concord of ${n}`]);
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

function ambition(sim: Sim, P: PolS): number {
  const C = sim.C[P.culture];
  let a = 0.4 + 0.8 * C.values.martial;
  if (P.ruler >= 0) {
    const t = sim.Pe[P.ruler].rec.traits;
    if (t.includes("ambitious")) a += 0.5;
    if (t.includes("warlike")) a += 0.4;
    if (t.includes("peaceful")) a -= 0.35;
    if (t.includes("content")) a -= 0.2;
    if (t.includes("craven")) a -= 0.2;
  }
  if (P.gov === "horde") a += 0.4;
  if (P.gov === "republic" || P.gov === "theocracy") a -= 0.15;
  return Math.max(0.05, a);
}

function declareWars(sim: Sim): void {
  const rng = sim.rng.diplo;
  for (const A of sim.P) {
    if (!independent(A) || A.rebel || A.ruler < 0) continue;
    if (A.wars.some((w) => sim.W[w].active)) continue;
    // Easy prey on the border tempts any king.
    let prey = 0;
    for (const q of sim.polNbrs.get(A.id) ?? []) {
      const B = sim.P[q];
      if (B.alive && B.overlord < 0 && B.strength > 0) prey = Math.max(prey, Math.min(3, A.strength / B.strength / 3));
    }
    const p = 0.0048 * ambition(sim, A) * (1 - Math.min(0.9, A.warWeariness)) * (sim.C[A.culture].tech >= 1 ? 1 : 0.5) * (1 + 0.6 * prey) * (0.6 + 0.6 * A.cohesion);
    if (!rng.chance(p)) continue;
    const land = sim.polNbrs.get(A.id) ?? [];
    const nb = [...land, ...(sim.seaNbrs.get(A.id) ?? [])];
    let best: PolS | undefined, bs = -Infinity, bestCb: CasusBelli = "conquest", bestTargets: number[] = [];
    for (const q of nb) {
      let B = sim.P[q];
      if (!B.alive) continue;
      if (B.overlord >= 0) {
        if (B.overlord === A.id) continue;
        B = sim.P[B.overlord];
        if (!B.alive || B.id === A.id) continue;
      }
      if ((A.truces.get(B.id) ?? -1) > sim.year || A.allies.includes(B.id) || A.unionWith === B.id || B.unionWith === A.id) continue;
      let enemy = B.strength;
      for (const al of B.allies) if (sim.P[al].alive) enemy += 0.5 * sim.P[al].strength;
      const rel = A.strength / Math.max(1, enemy);
      const claims = claimsOn(sim, A, B);
      const grudge = A.grudges.get(B.id) ?? 0;
      const ra = sim.R[A.religion], rb = sim.R[B.religion];
      const holy = !!ra?.organised && !!rb?.organised && A.religion !== B.religion && ra.zeal > 0.5;
      if (rel < 0.8 && !claims.length && !holy) continue;
      const border = sim.borders.get(A.id < B.id ? A.id * 65536 + B.id : B.id * 65536 + A.id) ?? 0;
      const overSea = !land.includes(q);
      const sc = Math.log(rel) + 0.35 * Math.min(3, claims.length) + 0.3 * grudge + (holy ? 0.6 : 0) + Math.min(0.5, border / 40) - opinion(sim, A, B) + rng.range(0, 0.6) - (overSea ? 0.5 : 0);
      if (sc > bs) {
        bs = sc;
        best = B;
        bestTargets = claims;
        bestCb = claims.length ? "reconquest" : holy ? "holyWar" : grudge > 1 ? "revenge" : rel > 3 && B.sets.length <= 6 && A.sets.length > 20 && rng.chance(0.4) ? "subjugation" : A.gov === "horde" && rng.chance(0.4) ? "raid" : "conquest";
      }
    }
    if (!best || bs < 0.1) continue;
    if (bestCb === "conquest" && sim.C[A.culture].values.mercantile > 0.6 && rng.chance(0.25)) bestCb = "trade";
    startWar(sim, A, best, bestCb, { targets: bestTargets });
  }
}

function tickAlliances(sim: Sim): void {
  const rng = sim.rng.diplo;
  for (const A of sim.P) {
    if (!independent(A) || A.rebel) continue;
    // Break stale or soured alliances.
    for (const b of A.allies.slice()) {
      const B = sim.P[b];
      if (!B.alive || B.overlord >= 0) {
        remove(A.allies, b);
        continue;
      }
      if (b < A.id) continue;
      if (opinion(sim, A, B) < 0.2 && rng.chance(0.15)) {
        remove(A.allies, b);
        remove(B.allies, A.id);
        sim.emit("allianceBroken", 2, -1, { polities: [A.id, b] }, { a: A.id, b, reason: rng.pick(["mutual distrust", "a quarrel over a border fortress", "the death of the king who made it", "broken promises"]) });
      }
    }
    if (A.allies.length >= 2 || !rng.chance(0.08)) continue;
    // Seek friends: kin, faith, or against a common threat.
    const nb = sim.polNbrs.get(A.id) ?? [];
    let threat = -1;
    for (const q of nb) if (sim.P[q].alive && sim.P[q].strength > 2.5 * A.strength) threat = q;
    let best = -1, bs = 0.35;
    const candidates = new Set<number>();
    for (const q of nb) candidates.add(q);
    if (threat >= 0) for (const q of sim.polNbrs.get(threat) ?? []) candidates.add(q);
    for (const q of [...candidates].sort((x, y) => x - y)) {
      const B = sim.P[q];
      if (q === A.id || q === threat || !independent(B) || B.rebel || A.allies.includes(q) || B.allies.length >= 2) continue;
      if (atWarWith(sim, A.id, q)) continue;
      const sc = opinion(sim, A, B) + (threat >= 0 && (sim.polNbrs.get(threat) ?? []).includes(q) ? 0.4 : 0) + rng.range(0, 0.2);
      if (sc > bs) {
        bs = sc;
        best = q;
      }
    }
    if (best < 0) continue;
    const B = sim.P[best];
    A.allies.push(best);
    B.allies.push(A.id);
    const reason = threat >= 0 ? "threat" : A.religion === B.religion && sim.R[A.religion]?.organised ? "faith" : "kin";
    sim.emit("alliance", 2, -1, { polities: [A.id, best] }, { a: A.id, b: best, reason });
  }
}

/** Steppe hordes and sea raiders plunder their neighbours. */
function raids(sim: Sim): void {
  const rng = sim.rng.war;
  for (const A of sim.P) {
    if (!A.alive || A.rebel || A.overlord >= 0) continue;
    const C = sim.C[A.culture];
    const steppe = C.archetype === "steppe" || A.gov === "horde";
    if (!steppe && !C.raiders) continue;
    if (!rng.chance(steppe ? 0.012 : 0.02)) continue;
    let target = -1, bs = -Infinity, bySea = false;
    if (C.raiders && C.tech >= 0.8) {
      let port = -1;
      for (const sid of A.sets) if (sim.g.coastal[sim.S[sid].cell] && (port < 0 || sim.S[sid].urban > sim.S[port].urban)) port = sid;
      if (port >= 0) {
        const pc = sim.S[port].cell;
        const rangeKm = 900 + 350 * C.tech;
        for (const t of sim.alive()) {
          const s = sim.S[t];
          if (s.owner === A.id || s.owner < 0 || !sim.g.coastal[s.cell] || A.allies.includes(s.owner)) continue;
          const d = sim.distKm(pc, s.cell);
          if (d > rangeKm) continue;
          const sc = Math.log(1 + s.urban) + s.wealth - d / 900 + rng.range(0, 1);
          if (sc > bs) {
            bs = sc;
            target = t;
            bySea = true;
          }
        }
      }
    }
    if (target < 0) {
      for (const sid of A.sets) for (const n of sim.S[sid].nbrs) {
        const s = sim.S[n];
        if (s.owner < 0 || s.owner === A.id || A.allies.includes(s.owner)) continue;
        const sc = Math.log(1 + s.urban) + s.wealth + rng.range(0, 1);
        if (sc > bs) {
          bs = sc;
          target = n;
          bySea = false;
        }
      }
    }
    if (target < 0) continue;
    const s = sim.S[target];
    const victim = s.owner;
    const plunder = Math.round(s.urban * rng.range(0.05, 0.15) + 50);
    s.wealth *= 0.7;
    s.devast = Math.min(1, s.devast + 0.35);
    s.pop *= 0.97;
    A.treasury += plunder;
    const V = sim.P[victim];
    V.grudges.set(A.id, (V.grudges.get(A.id) ?? 0) + 0.3);
    sim.emit("raid", s.rank >= 2 ? 3 : 2, s.cell, { polities: [A.id, victim], settlements: [target], persons: [A.ruler] }, { raider: A.id, target: victim, settlement: target, plunder, bySea });
    // Repeated raids provoke war.
    if (V.strength > A.strength * 1.2 && independent(V) && !V.wars.some((w) => sim.W[w].active) && (V.grudges.get(A.id) ?? 0) > 1 && rng.chance(0.3) && (V.truces.get(A.id) ?? -1) < sim.year) startWar(sim, V, A, "revenge", {});
  }
}

/** A strong horde in a cold century may sweep into the farmlands. */
function migrations(sim: Sim): void {
  const rng = sim.rng.war;
  for (const A of sim.P) {
    if (!independent(A) || A.gov !== "horde" || A.rebel || A.wars.some((w) => sim.W[w].active)) continue;
    const p = 0.0025 * (1 + Math.max(0, -sim.climate) * 3) * (A.strength > 8000 ? 1.5 : 0.6);
    if (!rng.chance(p)) continue;
    // Richest settled neighbour.
    let best: PolS | undefined, bs = -Infinity;
    for (const q of sim.polNbrs.get(A.id) ?? []) {
      const B = sim.P[q];
      if (!independent(B) || B.gov === "horde" || (A.truces.get(q) ?? -1) > sim.year) continue;
      const sc = Math.log(1 + B.pop) - B.strength / Math.max(1, A.strength) + rng.range(0, 0.5);
      if (sc > bs) {
        bs = sc;
        best = B;
      }
    }
    if (!best) continue;
    const cell = capitalCell(sim, A);
    const settlements = A.sets.slice(0, 10);
    const ev = sim.emit("migration", 4, cell, { polities: [A.id, best.id], cultures: [A.culture], settlements }, {
      culture: A.culture, polity: A.id, from: cell, to: capitalCell(sim, best), settlements, cause: sim.climate < -0.2 ? "a run of cold winters on the steppe" : "the ambition of its khan",
    });
    void ev;
    startWar(sim, A, best, "conquest", { migration: true });
  }
}

// ---------------------------------------------------------------------------
// Hooks for succession conflicts
// ---------------------------------------------------------------------------

/** A pretender raises a faction holding a distant province and fights for the crown. */
export function civilWar(sim: Sim, P: PolS, pretender: number, cause: "succession" | "usurpation"): void {
  const S = sim.S;
  // The faction's base: the largest provincial seat away from the capital.
  let base = -1, bs = -Infinity;
  for (const [seat] of P.provinces) {
    if (seat === P.capital || !S[seat].alive || S[seat].owner !== P.id) continue;
    const sc = S[seat].urban + S[seat].capDist * 5;
    if (sc > bs) {
      bs = sc;
      base = seat;
    }
  }
  if (base < 0) return;
  const members = provinceOf(sim, base);
  // Neighbouring provinces may side with the pretender.
  for (const [seat, m] of P.provinces) if (seat !== P.capital && seat !== base && sim.rng.war.chance(0.25)) for (const x of m) if (S[x].alive && S[x].owner === P.id && x !== P.capital) members.push(x);
  const pe = sim.Pe[pretender];
  addRole(sim, pretender, "pretender", P.id);
  const F = createPolity(sim, { capital: base, culture: P.culture, gov: P.gov === "empire" ? "kingdom" : P.gov, how: "faction", parent: P.id, members: [...new Set(members)], ruler: pretender, rebel: true, name: S[base].name, importance: 3 });
  pe.polity = F.id;
  F.dynasty = pe.rec.dynasty;
  startWar(sim, F, P, cause === "succession" ? "succession" : "civilWar", { claimant: pretender });
}

export function claimWar(sim: Sim, A: PolS, B: PolS, claimant: number): void {
  if (!independent(A) || A.wars.some((w) => sim.W[w].active)) return;
  startWar(sim, A, B, "succession", { claimant });
}

hooks.civilWar = civilWar;
hooks.claimWar = claimWar;

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tickWar(sim: Sim): void {
  for (const w of sim.W) if (w.active) warYear(sim, w);
  raids(sim);
  if (sim.year % 2 === 0) migrations(sim);
}

export function tickDiplomacy(sim: Sim): void {
  declareWars(sim);
  if (sim.year % 5 === 0) tickAlliances(sim);
  // Grudges fade.
  if (sim.year % 10 === 0) for (const P of sim.P) if (P.alive) for (const [k, v] of P.grudges) {
    if (v < 0.05) P.grudges.delete(k);
    else P.grudges.set(k, v * 0.85);
  }
}

/** Close all wars at the end of the run (ongoing) and name them. */
export function finishWars(sim: Sim): void {
  for (const w of sim.W) {
    if (!w.active) continue;
    w.rec.outcome = "ongoing";
    w.rec.end = -1;
    w.rec.name = nameWar(sim, w);
  }
}

export { reach };
