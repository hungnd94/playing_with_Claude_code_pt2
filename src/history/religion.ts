/**
 * Belief after the folk faiths: prophets are born in literate, urban,
 * troubled lands and found organised religions (monotheism, dualism,
 * philosophy, mystery cults) with a holy city, clergy, tenets and scripture.
 * Faiths spread town to town by proximity, trade and the favour of rulers;
 * rulers convert (and their realms follow), faiths split in schisms, zealous
 * kings suppress heresies, the pious go on pilgrimage.
 */
import { nameTitle } from "../lang/index";
import type { EmblemConcept } from "../world/concepts";
import { religionEmblem } from "./emblems";
import { newDeity, newReligionRecord, addMyth } from "./folk";
import { givenName, type LName } from "./names";
import { addRole, newPerson } from "./people";
import { capitalCell } from "./polities";
import type { CulS, PolS, RelS, SetS, Sim } from "./sim";
import type { DeityDomain, ReligionKind, WName } from "./types";
import { englishAdj } from "./war";
import { clamp, hsl } from "./util";

const TENETS: Record<string, string[]> = {
  monotheism: ["oneGod", "propheticRevelation", "scripture", "charity", "pilgrimage", "dietaryLaws", "holyWar", "monasticism", "proselytism", "dayOfRest", "fasting"],
  dualism: ["cosmicStruggle", "purityOfFire", "lastJudgement", "truthTelling", "sacredFire", "ritualPurity", "goodThoughtsWords"],
  philosophy: ["harmony", "ancestorRites", "virtueEthics", "detachment", "learning", "meditation", "filialPiety", "moderation", "nonviolence"],
  mystery: ["initiation", "rebirth", "secretRites", "sacredMeal", "afterlife", "ecstaticDance", "sacredDrama"],
};

const ISSUES = [
  "the nature of the prophet", "the succession of the high priests", "the reckoning of the holy calendar", "the veneration of images", "the language of the liturgy",
  "the place of the old gods", "the authority of the scriptures", "the marriage of priests", "the fate of unbelievers", "the true burial rites", "the holy city's primacy",
];

const MIRACLES = [
  "a spring of healing water rose in the temple court", "a statue of the god was seen to weep", "an eclipse foretold by the priests came to pass", "a blind king was healed",
  "a comet hung over the temple for forty nights", "the sacred flame relit itself after a storm", "a child spoke the words of the prophet", "a plague halted at the city gates",
];

const SYMBOLS: EmblemConcept[] = ["sun", "star", "moon", "flame", "eye", "tree", "key", "wheel", "cup", "hand", "heart", "crown", "lightning", "wave", "feather", "rose", "serpent", "eagle"];

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

function pending(sim: Sim): Sim["prophecies"] {
  return sim.prophecies;
}

function organisedCount(sim: Sim): number {
  let n = 0;
  for (const r of sim.R) if (r.organised && r.rec.parent < 0) n++;
  return n;
}

/** Recent troubles in a people's lands (plague, collapse, war) make prophets. */
function troubles(sim: Sim, C: CulS): number {
  let t = 0;
  for (const p of sim.plagues) if (p.rec.start > sim.year - 40) t += 1;
  for (const P of sim.P) {
    if (P.culture !== C.id) continue;
    if (P.crisis > 3) t += 0.5;
    if (!P.alive && P.rec.ended > sim.year - 40 && P.rec.endReason === "collapsed") t += 1;
  }
  return Math.min(3, t);
}

function considerProphets(sim: Sim): void {
  const rng = sim.rng.religion;
  const n = organisedCount(sim) + pending(sim).length;
  for (const C of sim.C) {
    if (!C.alive || C.tech < 2.2 || C.bigUrban < 6000 || C.bigCity < 0) continue;
    const sat = Math.max(0, 1 - n / 7);
    const p = 0.0035 * (0.4 + C.values.piety) * (1 + troubles(sim, C)) * sat * sat * (C.script >= 0 ? 1.3 : 0.7);
    if (!rng.chance(p)) continue;
    // The prophet is born now in a great town; he will preach in some thirty years.
    const city = C.bigCity;
    const s = sim.S[city];
    const pe = newPerson(sim, { sex: rng.chance(0.85) ? "m" : "f", born: sim.year, culture: C.id, religion: s.religion, polity: s.owner, bias: { pious: 6, charismatic: 3, wise: 2 } });
    sim.emit("prophetBorn", 3, s.cell, { persons: [pe.id], settlements: [city], cultures: [C.id] }, { person: pe.id, religion: -1 });
    pending(sim).push({ person: pe.id, city, culture: C.id, due: sim.year + rng.int(28, 42) });
    return;
  }
}

function fulfilProphecies(sim: Sim): void {
  const list = pending(sim);
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    if (pr.due > sim.year) continue;
    list.splice(i, 1);
    const pe = sim.Pe[pr.person];
    if (!pe.alive) continue; // the prophet died young; nothing came of it
    let city = pr.city;
    if (!sim.S[city].alive) city = sim.C[pr.culture].bigCity;
    if (city < 0 || !sim.S[city].alive) continue;
    foundReligion(sim, pr.person, city);
  }
}

function chooseKind(sim: Sim, C: CulS): ReligionKind {
  const rng = sim.rng.religion;
  const v = C.values;
  return rng.weighted<ReligionKind>([
    ["monotheism", 2.5 + 2 * v.piety],
    ["dualism", 1.5],
    ["philosophy", 0.8 + 2 * v.art + (v.mercantile > 0.6 ? 0.5 : 0)],
    ["mystery", 1.2 + v.art],
  ]);
}

export function foundReligion(sim: Sim, prophet: number, city: number, parent = -1, issue = ""): RelS {
  const rng = sim.rng.religion;
  const s = sim.S[city];
  const C = sim.C[s.culture];
  const lang = C.lang;
  const pe = sim.Pe[prophet];
  const pname = pe.rec.name as unknown as LName;
  const given = givenName(pname);
  const parentR = parent >= 0 ? sim.R[parent] : undefined;
  const kind: ReligionKind = parentR ? (rng.chance(0.85) ? parentR.rec.kind : chooseKind(sim, C)) : chooseKind(sim, C);
  const concept = rng.pick(["light", "truth", "fire", "sun", "star", "way", "peace", "dawn", "wisdom", "water", "word", "law"]);
  const name = sim.names.religion(lang, rng, { founder: rng.chance(0.4) ? pname : undefined, concept });
  let english: string;
  if (parentR) {
    const owner = s.owner >= 0 ? sim.P[s.owner] : undefined;
    const adj = owner ? englishAdj(owner.name.roman) : C.rec.adjective;
    const base = parentR.rec.english.replace(/^the /, "");
    english = rng.pick([`${adj} ${base}`, `Reformed ${base}`, `the ${adj} Church`, `the Old Believers of ${base}`.replace("of the ", "of ")]);
    if (english.startsWith("the Old Believers")) english = `the Old Rite of ${base}`;
  } else {
    const r = rng.next();
    english = r < 0.45 ? `${given.replace(/[aeiouy]+$/i, "")}ism` : name.gloss ? (name.gloss.startsWith("the ") ? name.gloss : `the ${name.gloss}`) : `the Faith of ${given}`;
    if (english.length < 6) english = `the Faith of ${given}`;
  }
  const symbol: EmblemConcept = parentR && rng.chance(0.6) ? parentR.rec.symbol : rng.pick(SYMBOLS);
  const tenetPool = TENETS[kind] ?? TENETS.monotheism;
  const tenets = parentR ? [...parentR.rec.tenets.slice(0, Math.max(1, parentR.rec.tenets.length - 1)), rng.pick(tenetPool)] : rng.sample(tenetPool, rng.int(3, 4));
  const color = parentR ? hsl(rgbHue(parentR.rec.color) + rng.range(-35, 35), 0.6, 0.45) : hsl(rng.range(0, 360), 0.7, 0.42);
  const R = newReligionRecord(sim, {
    name: name as unknown as WName, english, kind, parent, founded: sim.year, founder: prophet, holyCity: city, culture: C.id, tenets: [...new Set(tenets)], symbol,
    clergy: nameTitle(lang, "priest") as unknown as WName, color, emblem: religionEmblem(rng.fork(`relarms${sim.R.length}`), symbol),
  }, true, parentR ? 0.85 : rng.range(0.65, 0.95));
  // Gods of the new faith.
  if (!parentR) {
    if (kind === "monotheism" || kind === "dualism") {
      const doms: DeityDomain[] = kind === "monotheism" ? [rng.pick(["sky", "sun", "creation"] as DeityDomain[])] : ["sun", "night"];
      doms.forEach((dom, i) => {
        const dn = sim.names.deity(lang, rng, { domain: dom === "creation" ? "sky" : dom === "night" ? "night" : dom, gender: "m" });
        const id = newDeity(sim, {
          name: dn as unknown as WName, religion: R.id, domains: kind === "monotheism" ? ["creation", dom] : [dom], sex: kind === "monotheism" ? "none" : i === 0 ? "m" : "m",
          epithets: kind === "monotheism" ? rng.sample(["the One", "the Most High", "the Merciful", "the Creator of All", "the Light of Lights"], 2) : i === 0 ? ["the Wise Lord", "the Bringer of Light"] : ["the Lie", "the Destroyer"],
          symbol, feature: -1, parents: [], consort: -1,
        });
        R.rec.deities.push(id);
      });
      if (R.rec.deities.length === 2) {
        addMyth(sim, { religion: R.id, kind: "creation", actors: R.rec.deities.slice(), features: [], data: { motif: "the war of light and darkness at the beginning of time" } });
        addMyth(sim, { religion: R.id, kind: "endOfWorld", actors: R.rec.deities.slice(), features: [], data: { end: "the final victory of light" } });
      } else addMyth(sim, { religion: R.id, kind: "creation", actors: R.rec.deities.slice(), features: [], data: { motif: "the word spoken over the waters" } });
    } else if (kind === "mystery") {
      // A dying-and-rising god taken from the old pantheon.
      const folk = sim.h.religions[C.folk];
      const old = folk?.deities.find((d) => sim.h.deities[d].domains.some((x) => x === "harvest" || x === "wine" || x === "death" || x === "underworld"));
      const dn = old !== undefined ? (sim.h.deities[old].name as unknown as LName) : sim.names.deity(lang, rng, { domain: "harvest", gender: "m" });
      const id = newDeity(sim, { name: dn as unknown as WName, religion: R.id, domains: ["death", "harvest"], sex: "m", epithets: ["the Twice-Born", "the Risen"], symbol, feature: -1, parents: [], consort: -1 });
      R.rec.deities.push(id);
      addMyth(sim, { religion: R.id, kind: "deed", actors: [id], features: [], data: { deed: "descended into the land of the dead and returned with the first seed" } });
    }
    addMyth(sim, { religion: R.id, kind: "founding", actors: [prophet], features: [], data: { revelation: rng.pick(["a vision in the desert", "a voice from the sacred fire", "forty days of fasting on a mountain", "a dream beneath an old tree", "the visit of an angel", "long study of the old books"]), city } });
  }
  addRole(sim, prophet, "prophet", -1, R.id);
  pe.rec.religion = R.id;
  s.holy = true;
  if (!s.rec.tags.includes("holy city")) s.rec.tags.push("holy city");
  sim.setReligion(s, R.id);
  if (parentR) {
    sim.emit("schism", 4, s.cell, { religions: [R.id, parent], persons: [prophet], settlements: [city], polities: [s.owner] }, { religion: R.id, parent, founder: prophet, issue, center: city });
  } else {
    const first = organisedCount(sim) === 1;
    sim.emit("religionFounded", first ? 5 : 4, s.cell, { religions: [R.id], persons: [prophet], settlements: [city], cultures: [C.id], polities: [s.owner] }, {
      religion: R.id, founder: prophet, holyCity: city, kind, parent,
    }, [prophet]);
  }
  // Scripture follows within a few generations.
  sim.agenda.push({ year: sim.year + rng.int(8, 70), run: () => sim.hooks.scripture?.(sim, R.id) });
  return R;
}

function rgbHue(c: [number, number, number]): number {
  const [r, g, b] = c.map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return (h + 360) % 360;
}

// ---------------------------------------------------------------------------
// Spread
// ---------------------------------------------------------------------------

function spread(sim: Sim): void {
  const rng = sim.rng.religion;
  const S = sim.S;
  // Small parallel arrays instead of a Map: a town rarely feels more than a few faiths.
  const rs: number[] = [];
  const ws: number[] = [];
  const W = new Float64Array(sim.R.length);
  for (const R of sim.R) W[R.id] = R.organised ? 0.4 + R.zeal : 0.12;
  for (const sid of sim.alive()) {
    const s = S[sid];
    const cur = s.religion;
    rs.length = 0;
    ws.length = 0;
    for (const n of s.nbrs) {
      const t = S[n];
      const r = t.religion;
      if (r === cur || r < 0) continue;
      const w = W[r] * (t.urban > s.urban ? 1.4 : 1) * (t.culture === s.culture ? 1.2 : 0.8);
      const i = rs.indexOf(r);
      if (i < 0) {
        rs.push(r);
        ws.push(w);
      } else ws[i] += w;
    }
    if (s.owner >= 0) {
      const P = sim.P[s.owner];
      const r = P.religion;
      if (r >= 0 && r !== cur) {
        const w = sim.R[r].organised ? sim.R[r].zeal + (P.ruler >= 0 && sim.Pe[P.ruler].rec.traits.includes("pious") ? 0.4 : 0) : s.culture === P.culture ? 0.2 : 0;
        const i = rs.indexOf(r);
        if (i < 0) {
          rs.push(r);
          ws.push(w);
        } else ws[i] += w;
      }
    }
    for (const rid of s.routes) {
      const rt = sim.h.tradeRoutes[rid];
      if (rt.ended >= 0) continue;
      const r = S[rt.from === sid ? rt.to : rt.from].religion;
      if (r === cur || r < 0) continue;
      const w = 0.6 * W[r];
      const i = rs.indexOf(r);
      if (i < 0) {
        rs.push(r);
        ws.push(w);
      } else ws[i] += w;
    }
    if (!rs.length) continue;
    let best = -1, bp = 0;
    for (let i = 0; i < rs.length; i++) if (ws[i] > bp || (ws[i] === bp && rs[i] < best)) {
      bp = ws[i];
      best = rs[i];
    }
    const Rc = sim.R[cur];
    let hold = Rc.organised ? 1.6 + 1.2 * Rc.zeal : 0.9 + sim.C[s.culture].values.piety;
    if (s.holy && Rc.rec.holyCity === sid) hold += 5;
    const p = 0.05 * bp / (bp + hold);
    if (rng.chance(p)) sim.setReligion(s, best);
  }
}

// ---------------------------------------------------------------------------
// Rulers and realms
// ---------------------------------------------------------------------------

function majorityReligion(sim: Sim, P: PolS): { r: number; share: number } {
  const m = new Map<number, number>();
  let tot = 0;
  for (const sid of P.sets) {
    const s = sim.S[sid];
    m.set(s.religion, (m.get(s.religion) ?? 0) + s.pop);
    tot += s.pop;
  }
  let best = -1, bp = -1;
  for (const [r, p] of m) if (p > bp || (p === bp && r < best)) {
    bp = p;
    best = r;
  }
  return { r: best, share: tot ? bp / tot : 0 };
}

function realmConversions(sim: Sim): void {
  const rng = sim.rng.religion;
  for (const P of sim.P) {
    if (!P.alive || P.ruler < 0 || !P.sets.length) continue;
    const ruler = sim.Pe[P.ruler];
    const pious = ruler.rec.traits.includes("pious");
    const cur = P.religion;
    const curOrg = cur >= 0 && sim.R[cur].organised;
    const { r, share } = majorityReligion(sim, P);
    if (r >= 0 && r !== cur && share > 0.55 && rng.chance(curOrg ? 0.15 : 0.4)) {
      convertRealm(sim, P, r, pious && rng.chance(0.5));
      continue;
    }
    // A ruler drawn to a neighbour's or a trade partner's organised faith.
    if (!curOrg && rng.chance(0.03 + (pious ? 0.03 : 0))) {
      let best = -1, bw = 0;
      for (const q of sim.polNbrs.get(P.id) ?? []) {
        const Q = sim.P[q];
        const rr = Q.religion;
        if (rr < 0 || !sim.R[rr].organised) continue;
        const w = sim.R[rr].zeal * Math.log(2 + Q.strength) + (P.allies.includes(q) ? 1 : 0);
        if (w > bw) {
          bw = w;
          best = rr;
        }
      }
      if (best >= 0) convertRealm(sim, P, best, true);
    }
  }
}

export function convertRealm(sim: Sim, P: PolS, r: number, personal: boolean): void {
  const from = P.religion;
  sim.setStateReligion(P, r);
  const cell = capitalCell(sim, P);
  const big = P.sets.length >= 20;
  if (personal && P.ruler >= 0) {
    const ruler = sim.Pe[P.ruler];
    ruler.rec.religion = r;
    ruler.tally.conv = (ruler.tally.conv ?? 0) + 1;
    sim.emit("conversion", big ? 4 : 3, cell, { polities: [P.id], persons: [P.ruler], religions: [from, r] }, { polity: P.id, ruler: P.ruler, from, to: r }, [P.ruler]);
  } else {
    sim.emit("stateReligion", big ? 3 : 2, cell, { polities: [P.id], religions: [r, from] }, { polity: P.id, religion: r, from });
  }
  // The capital follows its king.
  if (P.capital >= 0 && sim.R[r].organised) sim.setReligion(sim.S[P.capital], r);
}

function related(sim: Sim, a: number, b: number): boolean {
  if (a < 0 || b < 0 || a === b) return false;
  const root = (x: number) => {
    let r = x;
    for (let i = 0; i < 6 && sim.R[r].rec.parent >= 0; i++) r = sim.R[r].rec.parent;
    return r;
  };
  return root(a) === root(b);
}

function schisms(sim: Sim): void {
  const rng = sim.rng.religion;
  for (const R of sim.R.slice()) {
    if (!R.alive || !R.organised || sim.year - R.rec.founded < 200) continue;
    if (sim.R.filter((x) => x.organised && x.alive).length >= 10) break;
    // Adherents and the realms they live in.
    const realms = new Map<number, number>();
    let n = 0;
    for (const sid of sim.alive()) {
      const s = sim.S[sid];
      if (s.religion !== R.id) continue;
      n++;
      if (s.owner >= 0) realms.set(s.owner, (realms.get(s.owner) ?? 0) + 1);
    }
    R.adherents = n;
    if (n < 45 || realms.size < 3) continue;
    if (!rng.chance(0.006 * Math.min(3, realms.size / 3))) continue;
    // A centre far from the holy city, in another realm.
    const holy = R.rec.holyCity;
    const holyOwner = holy >= 0 && sim.S[holy].alive ? sim.S[holy].owner : -1;
    let centre = -1, bs = -Infinity;
    for (const sid of sim.alive()) {
      const s = sim.S[sid];
      if (s.religion !== R.id || s.owner < 0 || s.owner === holyOwner) continue;
      const d = holy >= 0 ? sim.distKm(s.cell, sim.S[holy].cell) : 1000;
      if (d < 700) continue;
      const sc = Math.log(1 + s.urban) + d / 1500 + rng.range(0, 1);
      if (sc > bs) {
        bs = sc;
        centre = sid;
      }
    }
    if (centre < 0) continue;
    const cs = sim.S[centre];
    const reformer = newPerson(sim, { sex: "m", born: sim.year - rng.int(30, 55), culture: cs.culture, religion: R.id, polity: cs.owner, bias: { pious: 5, charismatic: 3 } });
    const issue = rng.pick(ISSUES);
    const N = foundReligion(sim, reformer.id, centre, R.id, issue);
    // The centre's realm and the region around it follow.
    const owner = cs.owner;
    for (const sid of sim.alive()) {
      const s = sim.S[sid];
      if (s.religion !== R.id) continue;
      if (s.owner === owner || sim.distKm(s.cell, cs.cell) < 500) if (rng.chance(0.8)) sim.setReligion(s, N.id);
    }
    if (owner >= 0 && sim.P[owner].religion === R.id) sim.setStateReligion(sim.P[owner], N.id);
    R.zeal = clamp(R.zeal + 0.1, 0, 1);
  }
}

function suppressHeresies(sim: Sim): void {
  const rng = sim.rng.religion;
  for (const P of sim.P) {
    if (!P.alive || P.religion < 0 || P.ruler < 0) continue;
    const R = sim.R[P.religion];
    if (!R.organised || R.zeal < 0.55) continue;
    const heretics = P.sets.filter((sid) => related(sim, sim.S[sid].religion, P.religion));
    if (heretics.length < 2) continue;
    const ruler = sim.Pe[P.ruler];
    if (!rng.chance(0.03 + (ruler.rec.traits.includes("pious") ? 0.06 : 0) + (ruler.rec.traits.includes("cruel") ? 0.04 : 0))) continue;
    const heresy = sim.S[heretics[0]].religion;
    for (const sid of heretics) if (sim.S[sid].religion === heresy && rng.chance(0.7)) {
      sim.setReligion(sim.S[sid], P.religion);
      sim.S[sid].loyalty *= 0.85;
    }
    if (ruler.rec.traits.includes("cruel")) ruler.tally.exec = (ruler.tally.exec ?? 0) + 1;
    sim.emit("heresySuppressed", P.sets.length >= 15 ? 3 : 2, capitalCell(sim, P), { polities: [P.id], religions: [P.religion, heresy], persons: [P.ruler] }, { religion: P.religion, heresy, polity: P.id, ruler: P.ruler }, [P.ruler]);
  }
}

function piety(sim: Sim): void {
  const rng = sim.rng.religion;
  for (const P of sim.P) {
    if (!P.alive || P.ruler < 0 || P.religion < 0) continue;
    const R = sim.R[P.religion];
    if (!R.organised || R.rec.holyCity < 0) continue;
    const ruler = sim.Pe[P.ruler];
    if (!ruler.rec.traits.includes("pious") || !rng.chance(0.006)) continue;
    const holy = R.rec.holyCity;
    if (!sim.S[holy].alive || sim.S[holy].owner === P.id) continue;
    sim.emit("pilgrimage", 2, sim.S[holy].cell, { persons: [P.ruler], religions: [R.id], settlements: [holy], polities: [P.id] }, { person: P.ruler, religion: R.id, holyCity: holy }, [P.ruler]);
  }
  for (const R of sim.R) {
    if (!R.alive || !R.organised || R.rec.holyCity < 0) continue;
    const hs = sim.S[R.rec.holyCity];
    if (!hs.alive || hs.religion !== R.id || !rng.chance(0.0025)) continue;
    sim.emit("miracle", 2, hs.cell, { religions: [R.id], settlements: [hs.id], polities: [hs.owner] }, { religion: R.id, settlement: hs.id, kind: rng.pick(MIRACLES) });
    R.zeal = clamp(R.zeal + 0.05, 0, 1);
  }
}

/** Mark faiths without followers as ended; slow decay of zeal. */
function bookkeeping(sim: Sim): void {
  const count = new Int32Array(sim.R.length);
  for (const sid of sim.alive()) count[sim.S[sid].religion]++;
  for (const R of sim.R) {
    R.adherents = count[R.id];
    if (R.alive && count[R.id] === 0 && sim.year - R.rec.founded > 20) {
      // Folk faiths of living peoples linger in the hills even without a town.
      R.alive = false;
      R.rec.ended = sim.year;
    } else if (!R.alive && count[R.id] > 0) {
      R.alive = true;
      R.rec.ended = -1;
    }
    if (R.organised) R.zeal = Math.max(0.3, R.zeal - 0.002);
  }
}

export function tickReligion(sim: Sim): void {
  const y = sim.year;
  fulfilProphecies(sim);
  if (y % 5 === 0) {
    considerProphets(sim);
    spread(sim);
  }
  if (y % 10 === 3) {
    realmConversions(sim);
    schisms(sim);
    suppressHeresies(sim);
    bookkeeping(sim);
  }
  piety(sim);
}

export type { SetS };
