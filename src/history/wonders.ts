/**
 * Wonders and works. Rich rulers raise temples, palaces, walls, libraries,
 * lighthouses, tombs… in their capitals and holy cities; war and earthquakes
 * bring them down. Scholars, poets and priests write chronicles, epics about
 * great kings and wars, scriptures, law codes and treatises. Also golden and
 * dark ages, and walls raised against raiders.
 */
import * as L from "../lang/index";
import type { LName } from "./names";
import { givenName } from "./names";
import { addRole, newPerson } from "./people";
import { capitalCell } from "./polities";
import type { CulS, PolS, Sim } from "./sim";
import type { Wonder, WonderKind, Work, WorkKind, WName } from "./types";

// ---------------------------------------------------------------------------
// Wonders
// ---------------------------------------------------------------------------

interface WonderS {
  rec: Wonder;
  due: number;
}

const building = new WeakMap<Sim, WonderS[]>();
function inProgress(sim: Sim): WonderS[] {
  let b = building.get(sim);
  if (!b) building.set(sim, (b = []));
  return b;
}

/** Native phrase for a wonder kind: head concept and a possessor/adjective. */
const NATIVE: Record<WonderKind, { head: string; poss?: string; adj?: string }> = {
  temple: { head: "temple" }, palace: { head: "palace" }, wall: { head: "wall", adj: "great" }, library: { head: "house", poss: "word" }, lighthouse: { head: "tower", poss: "light" },
  colossus: { head: "god", adj: "great" }, bridge: { head: "bridge" }, canal: { head: "river", adj: "new" }, tomb: { head: "tomb" }, observatory: { head: "tower", poss: "star" },
  arena: { head: "hall", adj: "great" }, aqueduct: { head: "road", poss: "water" }, cathedral: { head: "temple", adj: "great" }, harbor: { head: "harbor", adj: "great" },
  academy: { head: "hall", poss: "wisdom" }, garden: { head: "garden", adj: "hidden" }, fortress: { head: "castle" },
};

const YEARS: Record<WonderKind, [number, number]> = {
  temple: [8, 30], palace: [6, 20], wall: [10, 40], library: [5, 15], lighthouse: [8, 20], colossus: [10, 15], bridge: [5, 15], canal: [10, 30], tomb: [8, 25],
  observatory: [5, 12], arena: [6, 15], aqueduct: [8, 20], cathedral: [30, 90], harbor: [8, 20], academy: [5, 12], garden: [5, 15], fortress: [6, 18],
};

function chooseKind(sim: Sim, P: PolS): { kind: WonderKind; site: number } | null {
  const rng = sim.rng.works;
  const C = sim.C[P.culture];
  const t = C.tech;
  const cap = P.capital;
  const cs = sim.S[cap];
  const ruler = sim.Pe[P.ruler].rec;
  const has = (x: string) => ruler.traits.includes(x as never);
  const R = P.religion >= 0 ? sim.R[P.religion] : undefined;
  const opts: [WonderKind, number][] = [
    ["temple", 3 + 4 * C.values.piety + (has("pious") ? 3 : 0)],
    ["palace", 2 + (has("greedy") || has("ambitious") ? 2 : 0)],
    ["tomb", 1 + (has("ambitious") ? 1.5 : 0)],
    ["garden", t >= 1.5 ? 1 + 2 * C.values.art : 0],
    ["fortress", t >= 2 ? 1 + 2 * C.values.martial : 0],
    ["wall", t >= 1.5 && P.sets.length >= 8 ? 1 + (sim.polNbrs.get(P.id) ?? []).filter((q) => sim.P[q].gov === "horde").length * 3 : 0],
    ["library", t >= 2.2 && C.script >= 0 ? 1.5 + (has("scholarly") ? 4 : 0) : 0],
    ["observatory", t >= 2.6 && C.script >= 0 ? 1 + (has("scholarly") ? 2 : 0) : 0],
    ["lighthouse", t >= 2.8 && cs.port ? 2 + 2 * C.values.seafaring : 0],
    ["colossus", t >= 3.4 && cs.port ? 1 : 0],
    ["harbor", t >= 2.5 && cs.port ? 1.5 + C.values.mercantile * 2 : 0],
    ["bridge", t >= 3.4 && sim.w.riverOrder[cs.cell] >= 2 ? 1.5 : 0],
    ["canal", t >= 4 && sim.w.riverOrder[cs.cell] >= 1 ? 0.8 : 0],
    ["arena", t >= 3.5 ? 1 + C.values.martial : 0],
    ["aqueduct", t >= 3.5 ? 1.5 : 0],
    ["academy", t >= 4 && C.script >= 0 ? 1 + 2 * C.values.art + (has("scholarly") ? 3 : 0) : 0],
    ["cathedral", t >= 4.5 && R?.organised ? 3 + 3 * C.values.piety : 0],
  ];
  const kind = rng.weighted(opts);
  let site = cap;
  if ((kind === "temple" || kind === "cathedral") && R?.organised && R.rec.holyCity >= 0 && sim.S[R.rec.holyCity].alive && sim.S[R.rec.holyCity].owner === P.id && rng.chance(0.6)) site = R.rec.holyCity;
  if (kind === "lighthouse" || kind === "colossus" || kind === "harbor") {
    if (!sim.S[site].port) return null;
  }
  return { kind, site };
}

function wonderNames(sim: Sim, kind: WonderKind, P: PolS, site: number, deity: number): { english: string; native: LName } {
  const rng = sim.rng.works;
  const C = sim.C[P.culture];
  const sn = sim.S[site].name.roman;
  const ruler = sim.Pe[P.ruler].rec;
  const rg = givenName(ruler.name as unknown as LName);
  const dn = deity >= 0 ? (sim.h.deities[deity].name as unknown as LName).roman : "";
  const pn = P.name.roman;
  let english: string;
  switch (kind) {
    case "temple": english = dn ? rng.pick([`the Great Temple of ${dn}`, `the Temple of ${dn} at ${sn}`, `the House of ${dn}`]) : `the Great Temple of ${sn}`; break;
    case "cathedral": english = rng.pick([`the Great Church of ${sn}`, `the Cathedral of ${sn}`, `the Holy Dome of ${sn}`]); break;
    case "palace": english = rng.pick([`the Palace of ${rg}`, `the Royal Palace of ${sn}`, `the Golden Hall of ${sn}`]); break;
    case "wall": english = rng.pick([`the Great Wall of ${pn}`, `the Wall of ${rg}`]); break;
    case "library": english = `the Great Library of ${sn}`; break;
    case "lighthouse": english = `the Lighthouse of ${sn}`; break;
    case "colossus": english = `the Colossus of ${sn}`; break;
    case "bridge": english = rng.pick([`the Great Bridge of ${sn}`, `the Bridge of ${rg}`]); break;
    case "canal": english = rng.pick([`the Canal of ${rg}`, `the Great Canal of ${pn}`]); break;
    case "tomb": english = rng.pick([`the Tomb of ${rg}`, `the Mausoleum of ${rg}`]); break;
    case "observatory": english = `the Observatory of ${sn}`; break;
    case "arena": english = `the Arena of ${sn}`; break;
    case "aqueduct": english = rng.pick([`the Aqueduct of ${rg}`, `the Aqueduct of ${sn}`]); break;
    case "harbor": english = `the Great Harbour of ${sn}`; break;
    case "academy": english = `the Academy of ${sn}`; break;
    case "garden": english = rng.pick([`the Hanging Gardens of ${sn}`, `the Gardens of ${rg}`]); break;
    case "fortress": english = rng.pick([`the Citadel of ${sn}`, `the Fortress of ${sn}`]); break;
  }
  const n = NATIVE[kind];
  const np: L.NP = { head: n.head, adj: n.adj ? [n.adj] : undefined, def: true };
  if (kind === "tomb" || kind === "palace") np.poss = { name: ruler.name as unknown as LName };
  else if (n.poss) np.poss = { head: n.poss };
  else if ((kind === "temple" || kind === "cathedral") && deity >= 0) np.poss = { name: sim.h.deities[deity].name as unknown as LName };
  let native: LName;
  try {
    native = sim.names.phraseName(C.lang, { nps: [np] });
  } catch {
    native = sim.names.phraseName(C.lang, { nps: [{ head: n.head, def: true }] });
  }
  return { english, native };
}

function beginWonders(sim: Sim): void {
  const rng = sim.rng.works;
  for (const P of sim.P) {
    if (!P.alive || P.ruler < 0 || P.capital < 0 || P.rebel) continue;
    const cap = sim.S[P.capital];
    if (cap.urban < 9000 || sim.year - P.lastWonder < 90) continue;
    const C = sim.C[P.culture];
    if (C.tech < 1.3) continue;
    const ruler = sim.Pe[P.ruler];
    const t = ruler.rec.traits;
    let p = 0.0012 * (t.includes("builder") ? 3 : 1) * (t.includes("ambitious") ? 1.4 : 1) * (P.goldenAge > sim.year ? 2.5 : 1) * Math.min(2, cap.urban / 20000 + 0.5) * (1 + cap.wealth);
    if (P.wars.some((w) => sim.W[w].active)) p *= 0.3;
    if (!rng.chance(p)) continue;
    const pick = chooseKind(sim, P);
    if (!pick) continue;
    const { kind, site } = pick;
    let deity = -1;
    if ((kind === "temple" || kind === "cathedral") && P.religion >= 0) {
      const ds = sim.h.religions[P.religion].deities;
      if (ds.length) deity = ds[rng.int(0, ds.length - 1)];
    }
    const { english, native } = wonderNames(sim, kind, P, site, deity);
    const id = sim.h.wonders.length;
    const rec: Wonder = {
      id, kind, name: native as unknown as WName, english, settlement: site, builder: P.ruler, polity: P.id, begun: sim.year, completed: -1, destroyed: -1,
      religion: kind === "temple" || kind === "cathedral" ? P.religion : -1,
    };
    sim.h.wonders.push(rec);
    sim.S[site].rec.wonders.push(id);
    const [a, b] = YEARS[kind];
    inProgress(sim).push({ rec, due: sim.year + rng.int(a, b) });
    P.lastWonder = sim.year;
    addRole(sim, P.ruler, "builder", P.id);
    P.treasury *= 0.5;
  }
}

function completeWonders(sim: Sim): void {
  const list = inProgress(sim);
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    if (w.due > sim.year) continue;
    list.splice(i, 1);
    const rec = w.rec;
    const s = sim.S[rec.settlement];
    if (!s.alive || s.owner !== rec.polity || !sim.P[rec.polity].alive) {
      // Abandoned unfinished; the ruins of the works remain a curiosity.
      rec.destroyed = sim.year;
      rec.destroyCause = "decay";
      continue;
    }
    rec.completed = sim.year;
    const P = sim.P[rec.polity];
    const builder = sim.Pe[rec.builder];
    builder.tally.wonders = (builder.tally.wonders ?? 0) + 1;
    const grand = rec.kind === "colossus" || rec.kind === "wall" || rec.kind === "cathedral" || rec.kind === "library" || rec.kind === "lighthouse" || (rec.kind === "temple" && rec.religion >= 0 && sim.R[rec.religion].organised);
    sim.emit("wonderBuilt", grand ? 4 : 3, s.cell, { wonders: [rec.id], settlements: [s.id], polities: [P.id], persons: [rec.builder], religions: [rec.religion] }, {
      wonder: rec.id, kind: rec.kind, polity: P.id, builder: rec.builder, settlement: s.id, years: sim.year - rec.begun,
    }, [rec.builder]);
    if (rec.kind === "temple" || rec.kind === "cathedral") {
      builder.tally.temples = (builder.tally.temples ?? 0) + 1;
      const deity = rec.religion >= 0 && sim.h.religions[rec.religion].deities.length ? sim.h.religions[rec.religion].deities[0] : -1;
      sim.emit("templeBuilt", 2, s.cell, { wonders: [rec.id], settlements: [s.id], religions: [rec.religion], polities: [P.id] }, { wonder: rec.id, religion: rec.religion, deity, settlement: s.id });
    }
    if (rec.kind === "library" || rec.kind === "academy" || rec.kind === "observatory") if (!s.rec.tags.includes("seat of learning")) s.rec.tags.push("seat of learning");
    if (rec.kind === "wall" || rec.kind === "fortress") {
      s.walls = true;
      if (s.rec.walled < 0) s.rec.walled = sim.year;
    }
  }
}

/** Walls go up around rich or threatened towns. */
function walls(sim: Sim): void {
  const rng = sim.rng.works;
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    if (s.walls || s.owner < 0 || s.urban < 4000) continue;
    const C = sim.C[s.culture];
    if (C.tech < 1.2) continue;
    const P = sim.P[s.owner];
    const threatened = P.wars.some((w) => sim.W[w].active) || sim.year - s.lastSack < 50;
    const p = 0.0012 * (threatened ? 3 : 1) * (s.urban / 10000 + 0.5) * (sid === P.capital ? 2 : 1);
    if (!rng.chance(p)) continue;
    s.walls = true;
    s.rec.walled = sim.year;
    sim.emit("wallsBuilt", s.rank >= 3 ? 2 : 1, s.cell, { settlements: [sid], polities: [s.owner], persons: [P.ruler] }, { settlement: sid, polity: s.owner, ruler: P.ruler, reason: sim.year - s.lastSack < 50 ? "raids" : threatened ? "war" : "wealth" });
  }
}

// ---------------------------------------------------------------------------
// Works
// ---------------------------------------------------------------------------

function author(sim: Sim, C: CulS, polity: number, role: "scholar" | "poet" | "prophet", born?: number): number {
  const rng = sim.rng.works;
  const pe = newPerson(sim, { sex: rng.chance(0.85) ? "m" : "f", born: born ?? sim.year - rng.int(30, 60), culture: C.id, polity, bias: role === "poet" ? { charismatic: 2 } : { scholarly: 5, wise: 2 } });
  addRole(sim, pe.id, role, polity);
  return pe.id;
}

function title(sim: Sim, C: CulS, np: L.NP): LName {
  try {
    return sim.names.phraseName(C.lang, { nps: [np] });
  } catch {
    return sim.names.phraseName(C.lang, { nps: [{ head: "word", def: true }] });
  }
}

export function addWork(sim: Sim, w: Omit<Work, "id" | "year" | "lost">, lostChance: number): Work {
  const rng = sim.rng.works;
  const rec: Work = { ...w, id: sim.h.works.length, year: sim.year, lost: rng.chance(lostChance) };
  sim.h.works.push(rec);
  const auth = sim.Pe[w.author];
  auth.tally.works = (auth.tally.works ?? 0) + 1;
  const imp = w.kind === "scripture" ? 4 : w.kind === "epic" || w.kind === "lawCode" ? 3 : 2;
  sim.emit("workWritten", imp, -1, { works: [rec.id], persons: [w.author], polities: [w.subjectKind === "polity" ? w.subject : -1], wars: [w.subjectKind === "war" ? w.subject : -1], religions: [w.subjectKind === "religion" ? w.subject : -1] }, {
    work: rec.id, author: w.author, kind: w.kind,
  }, [w.author]);
  return rec;
}

function incipit(sim: Sim, C: CulS, kind: WorkKind, hero?: LName) {
  const rng = sim.rng.works;
  try {
    if (hero && (kind === "epic" || kind === "poem")) return sim.names.utter(L.sentence(C.lang, { subject: { name: hero }, verb: rng.pick(["conquer", "fight", "rule", "build"]), object: { head: rng.pick(["land", "city", "enemy", "realm"]), def: true }, tense: "past" }));
    if (kind === "hymn" || kind === "scripture") return sim.names.utter(L.proverb(C.lang, rng));
    return sim.names.utter(L.motto(C.lang, rng));
  } catch {
    return undefined;
  }
}

/** Scripture of a new faith (scheduled from religion.ts). */
function scripture(sim: Sim, religion: number): void {
  const R = sim.R[religion];
  if (!R) return;
  const rec = R.rec;
  const C = sim.C[rec.culture];
  const founder = rec.founder >= 0 ? sim.Pe[rec.founder] : undefined;
  const writer = founder && founder.alive ? founder.id : author(sim, C, sim.S[rec.holyCity]?.owner ?? -1, "prophet");
  const fname = founder ? givenName(founder.rec.name as unknown as LName) : "";
  const rng = sim.rng.works;
  const english = rng.pick([`the Book of ${fname}`, `the Sayings of ${fname}`, `the Holy Writ`, `the Book of the ${rec.english.replace(/^the /, "")}`, `the Testament of ${fname}`]);
  const t = title(sim, C, { head: "word", def: true, poss: founder ? { name: founder.rec.name as unknown as LName } : { head: "god" } });
  const w = addWork(sim, { kind: "scripture", title: t as unknown as WName, english, author: writer, lang: C.langId, subjectKind: "religion", subject: religion, incipit: incipit(sim, C, "scripture") }, 0);
  rec.scripture = w.id;
}

function writeWorks(sim: Sim): void {
  const rng = sim.rng.works;
  for (const P of sim.P) {
    if (!P.alive || P.capital < 0 || P.ruler < 0) continue;
    const C = sim.C[P.culture];
    if (C.script < 0) continue;
    const cap = sim.S[P.capital];
    const ruler = sim.Pe[P.ruler];
    // Law codes by just and able rulers.
    if (ruler.rec.traits.includes("just") && ruler.stewardship > 0.55 && !ruler.tally.law && rng.chance(0.004)) {
      const rg = givenName(ruler.rec.name as unknown as LName);
      ruler.tally.law = 1;
      addWork(sim, { kind: "lawCode", title: title(sim, C, { head: "law", plural: true, def: true, poss: { name: ruler.rec.name as unknown as LName } }) as unknown as WName, english: rng.pick([`the Code of ${rg}`, `the Laws of ${rg}`, `the Great Code of ${P.name.roman}`]), author: P.ruler, lang: C.langId, subjectKind: "polity", subject: P.id, incipit: incipit(sim, C, "lawCode") }, 0.15);
    }
    // Chronicles of old realms.
    if (sim.year - P.founded >= 120 && cap.urban > 8000 && rng.chance(0.0009)) {
      const a = author(sim, C, P.id, "scholar");
      addWork(sim, { kind: "chronicle", title: title(sim, C, { head: "year", plural: true, def: true, poss: { name: P.name } }) as unknown as WName, english: rng.pick([`the Annals of ${P.name.roman}`, `the Chronicle of ${P.name.roman}`, `the Book of the Kings of ${P.name.roman}`]), author: a, lang: C.langId, subjectKind: "polity", subject: P.id, incipit: incipit(sim, C, "chronicle") }, 0.35);
    }
    // Treatises in seats of learning.
    if (cap.urban > 15000 && C.tech >= 2.6 && rng.chance(0.0007 * (1 + C.values.art) * (cap.rec.tags.includes("seat of learning") ? 3 : 1))) {
      const a = author(sim, C, P.id, "scholar");
      const topic = rng.pick([["the Stars", "star"], ["the Healing Art", "healing"], ["the Soul", "spirit"], ["Numbers", "one"], ["the Art of War", "war"], ["Husbandry", "farm"], ["the Nature of Things", "earth"], ["Rhetoric", "word"], ["Plants", "flower"], ["the Movements of the Heavens", "sky"], ["Kingship", "king"], ["the Laws of Nations", "law"]] as [string, string][]);
      addWork(sim, { kind: "treatise", title: title(sim, C, { head: "word", plural: true, def: true, poss: { head: topic[1] } }) as unknown as WName, english: `On ${topic[0]}`, author: a, lang: C.langId, subjectKind: "none", subject: -1, incipit: incipit(sim, C, "treatise") }, 0.4);
    }
    // Poems, hymns and plays.
    if (cap.urban > 12000 && rng.chance(0.0006 * (0.5 + C.values.art))) {
      const kind: WorkKind = C.tech >= 3.8 && rng.chance(0.3) ? "play" : P.religion >= 0 && rng.chance(0.3) ? "hymn" : "poem";
      const a = author(sim, C, P.id, "poet");
      const head = kind === "hymn" ? "song" : kind === "play" ? "word" : rng.pick(["song", "dream", "sorrow", "memory", "love.n", "winter"]);
      const english = kind === "hymn" ? `the Hymn to ${sim.h.religions[P.religion].deities.length ? (sim.h.deities[sim.h.religions[P.religion].deities[0]].name as unknown as LName).roman : "the Gods"}` : kind === "play" ? rng.pick([`the Tragedy of ${givenName(ruler.rec.name as unknown as LName)}`, `the Merchants of ${cap.name.roman}`, `the Exiles`, `the Birds`]) : rng.pick([`the Song of ${cap.name.roman}`, `Lament for ${cap.name.roman}`, `the ${["Winter", "Spring", "River", "Harvest", "Night"][rng.int(0, 4)]} Odes`, `the Book of Songs`]);
      addWork(sim, { kind, title: title(sim, C, { head, def: true }) as unknown as WName, english, author: a, lang: C.langId, subjectKind: kind === "hymn" ? "religion" : "none", subject: kind === "hymn" ? P.religion : -1, incipit: incipit(sim, C, kind) }, 0.45);
    }
  }
}

/** Epics are sung about great kings and great wars, a generation or more after. */
function epics(sim: Sim): void {
  const rng = sim.rng.works;
  if (!rng.chance(0.05)) return;
  // A famous dead ruler of a literate people.
  const cands: number[] = [];
  for (const P of sim.P) {
    for (const r of P.rec.rulers) {
      if (r.to < 0 || sim.year - r.to < 30 || sim.year - r.to > 400) continue;
      const pe = sim.Pe[r.person];
      if (!pe.rec.epithet || !/(Great|Conqueror|Unifier|Bold|Magnificent|Terrible)/.test(pe.rec.epithet) || pe.tally.epic) continue;
      cands.push(r.person);
    }
  }
  if (!cands.length) return;
  const hero = cands[rng.int(0, cands.length - 1)];
  const he = sim.Pe[hero];
  const C = sim.C[he.rec.culture];
  if (C.script < 0 && rng.chance(0.5)) return;
  he.tally.epic = 1;
  const owner = C.bigCity >= 0 ? sim.S[C.bigCity].owner : -1;
  const a = author(sim, C, owner, "poet");
  const g = givenName(he.rec.name as unknown as LName);
  const english = rng.pick([`the Song of ${g}`, `the Deeds of ${g}`, `the ${g}-saga`, `the Lay of ${g} ${he.rec.epithet}`.trim()]);
  addWork(sim, { kind: "epic", title: title(sim, C, { head: "song", def: true, poss: { name: he.rec.name as unknown as LName } }) as unknown as WName, english, author: a, lang: C.langId, subjectKind: "person", subject: hero, incipit: incipit(sim, C, "epic", he.rec.name as unknown as LName) }, 0.3);
}

// ---------------------------------------------------------------------------
// Golden and dark ages
// ---------------------------------------------------------------------------

function ages(sim: Sim): void {
  const rng = sim.rng.works;
  for (const P of sim.P) {
    if (!P.alive || P.ruler < 0 || P.sets.length < 6 || P.rebel || P.capital < 0) continue;
    if (P.goldenAge > sim.year) continue;
    const cap = sim.S[P.capital];
    const peace = !P.wars.some((w) => sim.W[w].active) && sim.year - P.lastWar > 30;
    const ruler = sim.Pe[P.ruler];
    const reasons: string[] = [];
    if (peace) reasons.push("long peace");
    if (cap.wealth > 0.6) reasons.push("trade");
    if (ruler.stewardship > 0.6) reasons.push("wise government");
    if (cap.urban > 30000) reasons.push("a great capital");
    if (P.prestige > 3) reasons.push("victories");
    if (reasons.length >= 3 && rng.chance(0.015)) {
      P.goldenAge = sim.year + rng.int(40, 90);
      ruler.tally.golden = 1;
      sim.emit("goldenAge", P.sets.length >= 20 ? 4 : 3, cap.cell, { polities: [P.id], persons: [P.ruler] }, { polity: P.id, ruler: P.ruler, reasons });
      continue;
    }
    if (P.crisis > 5 && P.sets.length >= 12 && sim.year - (P.rec.peak.year ?? 0) > 50 && !sim.flags.has(`dark:${P.id}:${Math.floor(sim.year / 150)}`) && rng.chance(0.15)) {
      sim.flags.add(`dark:${P.id}:${Math.floor(sim.year / 150)}`);
      const r2: string[] = [];
      if (P.revolts > 1) r2.push("rebellions");
      if (P.warWeariness > 0.5) r2.push("ruinous wars");
      if (sim.plagues.some((q) => q.rec.start > sim.year - 25)) r2.push("plague");
      if (P.legitimacy < 0.5) r2.push("weak kings");
      if (!r2.length) r2.push("decline");
      sim.emit("darkAge", 3, capitalCell(sim, P), { polities: [P.id] }, { polity: P.id, reasons: r2 });
    }
  }
}

export function tickWorks(sim: Sim): void {
  sim.hooks.scripture ??= scripture;
  completeWonders(sim);
  beginWonders(sim);
  if (sim.year % 2 === 0) walls(sim);
  writeWorks(sim);
  epics(sim);
  if (sim.year % 10 === 6) ages(sim);
}
