/**
 * Plain English one-liners for events — a debugging chronicle and the live
 * ticker's headlines. (The narrative engine writes the real prose.)
 */
import type { Sim } from "./sim";
import type { EventData, HEvent, History } from "./types";
import { roman } from "./util";

/** Name lookups at the event's time. */
export interface Namer {
  s(id: number): string;
  p(id: number): string;
  per(id: number): string;
  c(id: number): string;
  rel(id: number): string;
  war(id: number): string;
  f(id: number): string;
  dyn(id: number): string;
  lang(id: number): string;
  script(id: number): string;
  wonder(id: number): string;
  work(id: number): string;
  disaster(id: number): string;
  route(id: number): string;
}

export function simNamer(sim: Sim): Namer {
  const h = sim.h;
  const pn = (id: number) => {
    const p = h.persons[id];
    if (!p) return "someone";
    const n = p.name.roman.split(" ")[0];
    return p.regnal > 1 ? `${n} ${roman(p.regnal)}` : n;
  };
  return {
    s: (id) => (id >= 0 && sim.S[id] ? sim.S[id].name.roman : "?"),
    p: (id) => (id >= 0 && sim.P[id] ? sim.P[id].name.roman : "?"),
    per: pn,
    c: (id) => (id >= 0 && h.cultures[id] ? h.cultures[id].adjective : "?"),
    rel: (id) => (id >= 0 && h.religions[id] ? h.religions[id].english : "?"),
    war: (id) => (id >= 0 && h.wars[id] ? h.wars[id].name || "a war" : "?"),
    f: (id) => {
      const e = sim.featureIdx.get(id);
      return e && e.names.length ? e.names[0].name.roman : id >= 0 ? `the ${sim.w.features[id]?.kind ?? "feature"}` : "?";
    },
    dyn: (id) => (id >= 0 && h.dynasties[id] ? h.dynasties[id].name.roman : "?"),
    lang: (id) => (id >= 0 && h.languages[id] ? h.languages[id].name : "?"),
    script: (id) => (id >= 0 && h.scripts[id] ? h.scripts[id].name : "?"),
    wonder: (id) => (id >= 0 && h.wonders[id] ? h.wonders[id].english : "?"),
    work: (id) => (id >= 0 && h.works[id] ? h.works[id].english : "?"),
    disaster: (id) => (id >= 0 && h.disasters[id] ? h.disasters[id].name || `a ${h.disasters[id].kind}` : "?"),
    route: (id) => (id >= 0 && h.tradeRoutes[id] ? h.tradeRoutes[id].name : "?"),
  };
}

/** Namer over a finished History (current names at the event year are approximated by the latest name ≤ year). */
export function historyNamer(h: History, year: number): Namer {
  const at = <T extends { year: number }>(list: T[]): T | undefined => {
    let r: T | undefined;
    for (const x of list) if (x.year <= year) r = x;
    return r ?? list[0];
  };
  return {
    s: (id) => (id >= 0 && h.settlements[id] ? at(h.settlements[id].names)?.name.roman ?? "?" : "?"),
    p: (id) => (id >= 0 && h.polities[id] ? at(h.polities[id].names)?.name.roman ?? "?" : "?"),
    per: (id) => {
      const p = h.persons[id];
      if (!p) return "someone";
      const n = p.name.roman.split(" ")[0];
      return `${p.regnal > 1 ? `${n} ${roman(p.regnal)}` : n}${p.epithet ? " " + p.epithet : ""}`;
    },
    c: (id) => (id >= 0 && h.cultures[id] ? h.cultures[id].adjective : "?"),
    rel: (id) => (id >= 0 && h.religions[id] ? h.religions[id].english : "?"),
    war: (id) => (id >= 0 && h.wars[id] ? h.wars[id].name : "?"),
    f: (id) => {
      const e = h.featureNames.find((x) => x.feature === id);
      return e && e.names.length ? e.names[0].name.roman : "?";
    },
    dyn: (id) => (id >= 0 && h.dynasties[id] ? h.dynasties[id].name.roman : "?"),
    lang: (id) => (id >= 0 && h.languages[id] ? h.languages[id].name : "?"),
    script: (id) => (id >= 0 && h.scripts[id] ? h.scripts[id].name : "?"),
    wonder: (id) => (id >= 0 && h.wonders[id] ? h.wonders[id].english : "?"),
    work: (id) => (id >= 0 && h.works[id] ? h.works[id].english : "?"),
    disaster: (id) => (id >= 0 && h.disasters[id] ? h.disasters[id].name || `a ${h.disasters[id].kind}` : "?"),
    route: (id) => (id >= 0 && h.tradeRoutes[id] ? h.tradeRoutes[id].name : "?"),
  };
}

const n0 = (x: number) => Math.round(x).toLocaleString("en-US");

export function describeEvent(e: HEvent, N: Namer): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const D = <K extends keyof EventData>() => d as unknown as EventData[K];
  switch (e.type) {
    case "settlementFounded": {
      const x = D<"settlementFounded">();
      if (x.hearth) return `${N.c(x.culture)} villagers settle at ${N.s(x.settlement)}.`;
      if (x.ruinsOf >= 0) return `${N.s(x.settlement)} is built on the ruins of ${N.s(x.ruinsOf)}.`;
      return `${N.s(x.settlement)} is founded${x.mother >= 0 ? ` from ${N.s(x.mother)}` : ""}.`;
    }
    case "colonyFounded": {
      const x = D<"colonyFounded">();
      return `Settlers from ${N.s(x.mother)} cross the ${x.across} and found ${N.s(x.settlement)} (${n0(x.distanceKm)} km away).`;
    }
    case "settlementAbandoned": {
      const x = D<"settlementAbandoned">();
      return `${N.s(x.settlement)} is abandoned (${x.cause}).`;
    }
    case "settlementGrew": {
      const x = D<"settlementGrew">();
      return `${N.s(x.settlement)} grows into a ${x.rank} of ${n0(x.pop)}${x.largestInWorld ? ", the largest in the world" : ""}.`;
    }
    case "portFounded":
      return `${N.s(D<"portFounded">().settlement)} builds a harbour.`;
    case "wallsBuilt": {
      const x = D<"wallsBuilt">();
      return `Walls are raised around ${N.s(x.settlement)}.`;
    }
    case "settlementRenamed": {
      const x = D<"settlementRenamed">();
      return `${x.from} is renamed ${x.to} (${x.reason}).`;
    }
    case "polityRenamed": {
      const x = D<"polityRenamed">();
      return `The realm of ${x.from} takes the name ${x.to}.`;
    }
    case "capitalMoved": {
      const x = D<"capitalMoved">();
      return `${N.p(x.polity)} moves its capital from ${N.s(x.from)} to ${N.s(x.to)}.`;
    }
    case "polityFounded": {
      const x = D<"polityFounded">();
      const how = x.how === "chiefdom" ? "rises" : x.how === "rebellion" ? "rises in revolt" : x.how === "secession" ? "breaks away" : x.how === "successor" ? "emerges from the ruins" : x.how === "colony" ? "is founded overseas" : x.how === "faction" ? "is proclaimed by a pretender" : "is founded";
      return `The ${x.gov} of ${N.p(x.polity)} ${how}${x.parent >= 0 ? ` (from ${N.p(x.parent)})` : ""}, with its seat at ${N.s(x.capital)}${x.founder >= 0 ? ` under ${N.per(x.founder)}` : ""}.`;
    }
    case "polityUnified": {
      const x = D<"polityUnified">();
      return `${N.p(x.polity)} unites ${x.members.length} realms.`;
    }
    case "governmentChanged": {
      const x = D<"governmentChanged">();
      return `${N.p(x.polity)} becomes ${article(x.to)} ${x.to} (was ${x.from}; ${x.reason}).`;
    }
    case "polityCollapsed": {
      const x = D<"polityCollapsed">();
      return `${N.p(x.polity)} collapses after ${x.age} years into ${x.successors.length} successor states (${x.causes.join(", ")}).`;
    }
    case "polityAnnexed": {
      const x = D<"polityAnnexed">();
      return `${N.p(x.polity)} is annexed by ${N.p(x.by)}.`;
    }
    case "independence": {
      const x = D<"independence">();
      return `${N.p(x.polity)} wins its independence from ${N.p(x.from)}.`;
    }
    case "vassalized": {
      const x = D<"vassalized">();
      return `${N.p(x.vassal)} becomes a vassal of ${N.p(x.overlord)}.`;
    }
    case "vassalFreed": {
      const x = D<"vassalFreed">();
      return `${N.p(x.vassal)} throws off the overlordship of ${N.p(x.overlord)}.`;
    }
    case "union": {
      const x = D<"union">();
      return x.kind === "personal" ? `${N.per(x.ruler)} unites the crowns of ${N.p(x.senior)} and ${N.p(x.junior)}.` : `${N.p(x.junior)} is merged into ${N.p(x.senior)}.`;
    }
    case "partition": {
      const x = D<"partition">();
      return `${N.p(x.polity)} is partitioned among ${x.among.map(N.p).join(", ")}.`;
    }
    case "birth": {
      const x = D<"birth">();
      return `${N.per(x.person)} is born to ${N.per(x.father)}.`;
    }
    case "death": {
      const x = D<"death">();
      return `${N.per(x.person)}${x.ruler ? ` of ${N.p(x.polity)}` : ""} dies (${x.cause}) aged ${x.age}.`;
    }
    case "marriage": {
      const x = D<"marriage">();
      return `${N.per(x.a)} marries ${N.per(x.b)}${x.alliance ? `, allying ${x.polities.map(N.p).join(" and ")}` : ""}.`;
    }
    case "accession": {
      const x = D<"accession">();
      return `${x.regnalName} (${x.relation}) becomes ruler of ${N.p(x.polity)} at ${x.age} (${x.how}).`;
    }
    case "abdication": {
      const x = D<"abdication">();
      return `${N.per(x.person)} of ${N.p(x.polity)} abdicates (${x.reason}).`;
    }
    case "deposition": {
      const x = D<"deposition">();
      return `${N.per(x.person)} of ${N.p(x.polity)} is deposed.`;
    }
    case "regency": {
      const x = D<"regency">();
      return `${N.per(x.regent)} rules ${N.p(x.polity)} as regent for the child ${N.per(x.ward)}.`;
    }
    case "dynastyFounded": {
      const x = D<"dynastyFounded">();
      return `${N.per(x.founder)} founds the ${N.dyn(x.dynasty)} dynasty${x.parent >= 0 ? `, a branch of ${N.dyn(x.parent)}` : ""} in ${N.p(x.polity)}.`;
    }
    case "successionCrisis": {
      const x = D<"successionCrisis">();
      return `${N.per(x.deceased)} dies without a clear heir; ${x.claimants.length} claimants contest the throne of ${N.p(x.polity)}.`;
    }
    case "assassination": {
      const x = D<"assassination">();
      return `${N.per(x.victim)} of ${N.p(x.polity)} is assassinated (${x.motive}).`;
    }
    case "usurpation": {
      const x = D<"usurpation">();
      return `${N.per(x.usurper)} seizes the throne of ${N.p(x.polity)} from ${N.per(x.deposed)}.`;
    }
    case "coup": {
      const x = D<"coup">();
      return `A coup in ${N.p(x.polity)}: the ${x.from} becomes ${article(x.to)} ${x.to}.`;
    }
    case "warDeclared": {
      const x = D<"warDeclared">();
      return `${N.p(x.attacker)} goes to war with ${N.p(x.defender)} (${x.casusBelli}): ${N.war(x.war)}.`;
    }
    case "warJoined": {
      const x = D<"warJoined">();
      return `${N.p(x.polity)} joins ${N.war(x.war)} on the ${x.side}s' side (${x.reason}).`;
    }
    case "battle": {
      const x = D<"battle">();
      return `${e.battles ? "" : ""}${N.p(x.victor)} defeats ${N.p(x.loser)}${x.decisive ? " decisively" : ""} (${n0(x.attackerLosses + x.defenderLosses)} dead).`;
    }
    case "siege": {
      const x = D<"siege">();
      return x.outcome === "taken" ? `${N.p(x.besieger)} takes ${N.s(x.settlement)} after a siege.` : `${N.s(x.settlement)} holds against ${N.p(x.besieger)}.`;
    }
    case "conquest": {
      const x = D<"conquest">();
      return `${N.s(x.settlement)} passes from ${N.p(x.from)} to ${N.p(x.to)}.`;
    }
    case "sack": {
      const x = D<"sack">();
      return `${N.p(x.by)} sacks ${N.s(x.settlement)}${x.destroyed ? " and leaves it in ruins" : ""} (${n0(x.deaths)} dead).`;
    }
    case "peace": {
      const x = D<"peace">();
      return `${x.treaty || "Peace"} ends ${N.war(x.war)} after ${x.years} years (${x.outcome}; ${x.transfers} towns change hands).`;
    }
    case "rebellion": {
      const x = D<"rebellion">();
      return `${N.p(x.rebels)} rises against ${N.p(x.against)} (${x.cause}).`;
    }
    case "revoltCrushed": {
      const x = D<"revoltCrushed">();
      return `${N.p(x.polity)} crushes the revolt of ${N.p(x.rebels)}.`;
    }
    case "raid": {
      const x = D<"raid">();
      return `${N.p(x.raider)} raiders ${x.bySea ? "come from the sea and " : ""}plunder ${N.s(x.settlement)}.`;
    }
    case "massacre": {
      const x = D<"massacre">();
      return `${N.p(x.by)} massacres ${n0(x.deaths)} at ${N.s(x.settlement)}.`;
    }
    case "alliance": {
      const x = D<"alliance">();
      return `${N.p(x.a)} and ${N.p(x.b)} make an alliance (${x.reason}).`;
    }
    case "allianceBroken": {
      const x = D<"allianceBroken">();
      return `The alliance of ${N.p(x.a)} and ${N.p(x.b)} ends (${x.reason}).`;
    }
    case "religionFounded": {
      const x = D<"religionFounded">();
      return `${N.per(x.founder)} preaches ${N.rel(x.religion)} at ${N.s(x.holyCity)}.`;
    }
    case "prophetBorn":
      return `${N.per(D<"prophetBorn">().person)} is born.`;
    case "conversion": {
      const x = D<"conversion">();
      return `${N.per(x.ruler)} of ${N.p(x.polity)} converts from ${N.rel(x.from)} to ${N.rel(x.to)}.`;
    }
    case "stateReligion": {
      const x = D<"stateReligion">();
      return `${N.p(x.polity)} adopts ${N.rel(x.religion)}.`;
    }
    case "schism": {
      const x = D<"schism">();
      return `${N.rel(x.religion)} breaks away from ${N.rel(x.parent)} over ${x.issue}.`;
    }
    case "heresySuppressed": {
      const x = D<"heresySuppressed">();
      return `${N.p(x.polity)} suppresses the ${N.rel(x.heresy)} heresy.`;
    }
    case "templeBuilt": {
      const x = D<"templeBuilt">();
      return `${N.wonder(x.wonder)} is raised at ${N.s(x.settlement)}.`;
    }
    case "pilgrimage": {
      const x = D<"pilgrimage">();
      return `${N.per(x.person)} makes the pilgrimage to ${N.s(x.holyCity)}.`;
    }
    case "miracle": {
      const x = D<"miracle">();
      return `A miracle at ${N.s(x.settlement)}: ${x.kind}.`;
    }
    case "cultureSplit": {
      const x = D<"cultureSplit">();
      return `The ${N.c(x.culture)} people emerge from the ${N.c(x.parent)} (${x.cause}).`;
    }
    case "languageSplit": {
      const x = D<"languageSplit">();
      return `${N.lang(x.language)} diverges from ${N.lang(x.parent)}.`;
    }
    case "languageEvolved": {
      const x = D<"languageEvolved">();
      return `${N.lang(x.previous)} gives way to ${N.lang(x.language)} (${x.renamedPlaces} place names change).`;
    }
    case "languageShift": {
      const x = D<"languageShift">();
      return `${x.settlements.length} towns adopt the ${N.c(x.culture)} tongue over ${N.c(x.from)} (${x.cause}).`;
    }
    case "scriptInvented": {
      const x = D<"scriptInvented">();
      return `Writing is invented at ${N.s(x.settlement)}: ${N.script(x.script)}.`;
    }
    case "scriptAdopted": {
      const x = D<"scriptAdopted">();
      return `The ${N.c(x.culture)} adopt writing (${N.script(x.script)}, from ${N.script(x.source)}).`;
    }
    case "invention": {
      const x = D<"invention">();
      return `${x.first ? "First in the world: " : ""}the ${N.c(x.culture)} master ${x.tech}${x.settlement >= 0 ? ` at ${N.s(x.settlement)}` : ""}.`;
    }
    case "techSpread": {
      const x = D<"techSpread">();
      return `${x.tech} reaches the ${N.c(x.culture)}${x.from >= 0 ? ` from the ${N.c(x.from)}` : ""}.`;
    }
    case "workWritten": {
      const x = D<"workWritten">();
      return `${N.per(x.author)} writes ${N.work(x.work)}.`;
    }
    case "wonderBuilt": {
      const x = D<"wonderBuilt">();
      return `${N.wonder(x.wonder)} is completed at ${N.s(x.settlement)} after ${x.years} years.`;
    }
    case "wonderDestroyed": {
      const x = D<"wonderDestroyed">();
      return `${N.wonder(x.wonder)} is destroyed (${x.cause}).`;
    }
    case "goldenAge": {
      const x = D<"goldenAge">();
      return `A golden age begins in ${N.p(x.polity)} (${x.reasons.join(", ")}).`;
    }
    case "darkAge": {
      const x = D<"darkAge">();
      return `${N.p(x.polity)} falls into a dark age (${x.reasons.join(", ")}).`;
    }
    case "featureNamed": {
      const x = D<"featureNamed">();
      return `The ${N.c(x.culture)} name the ${e.features ? "" : ""}${x.name}${x.gloss ? ` ('${x.gloss}')` : ""}.`;
    }
    case "firstContact": {
      const x = D<"firstContact">();
      return `The ${N.c(x.a)} and the ${N.c(x.b)} meet for the first time.`;
    }
    case "exploration": {
      const x = D<"exploration">();
      return `${N.per(x.person)} of ${N.p(x.polity)} reaches ${N.f(x.landmass)}.`;
    }
    case "migration": {
      const x = D<"migration">();
      return `A great migration of the ${N.c(x.culture)} (${x.cause}).`;
    }
    case "tradeRouteOpened": {
      const x = D<"tradeRouteOpened">();
      return `${N.route(x.route)} opens between ${N.s(x.from)} and ${N.s(x.to)} (${x.goods.join(", ")}).`;
    }
    case "tradeRouteClosed": {
      const x = D<"tradeRouteClosed">();
      return `${N.route(x.route)} falls out of use (${x.reason}).`;
    }
    case "plague": {
      const x = D<"plague">();
      return x.phase === "outbreak" ? `${N.disaster(x.disaster)} breaks out at ${N.s(x.origin)}.` : x.phase === "end" ? `${N.disaster(x.disaster)} burns out after killing ${n0(x.deaths)}.` : `${N.disaster(x.disaster)} reaches ${N.s(x.origin)}.`;
    }
    case "famine": {
      const x = D<"famine">();
      return `Famine (${x.cause}) kills ${n0(x.deaths)}${e.polities ? ` in ${N.p(e.polities[0])}` : ""}.`;
    }
    case "earthquake": {
      const x = D<"earthquake">();
      return `An earthquake strikes ${N.s(x.settlement)} (${n0(x.deaths)} dead).`;
    }
    case "eruption": {
      const x = D<"eruption">();
      return `${N.f(x.feature)} erupts (VEI ${x.vei}; ${n0(x.deaths)} dead).`;
    }
    case "flood": {
      const x = D<"flood">();
      return `The ${N.f(x.feature)} floods ${N.s(x.settlement)} (${n0(x.deaths)} dead).`;
    }
    case "drought": {
      const x = D<"drought">();
      return `Drought (${x.cause}) kills ${n0(x.deaths)}.`;
    }
  }
  return e.type;
}

function article(w: string): string {
  return /^[aeiou]/i.test(w) ? "an" : "a";
}
