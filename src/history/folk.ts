/**
 * Folk religions: each founding people's pantheon is drawn from its world —
 * the specific great river and mountains it lives beside, the sun and moon,
 * the sea if it has one, storm, harvest, death, the forge — with a divine
 * family and structured myths (creation, flood, origin of the people, deeds).
 */
import { nameTitle } from "../lang/index";
import type { EmblemConcept } from "../world/concepts";
import { religionEmblem } from "./emblems";
import { featureNameFor } from "./features";
import type { Sim, RelS } from "./sim";
import type { Deity, DeityDomain, Myth, Religion, Sex, WName } from "./types";
import { hsl, rgbToHue } from "./util";

export const DOMAIN_CONCEPT: Record<DeityDomain, string> = {
  sky: "sky", sun: "sun", moon: "moon", stars: "star", storm: "storm", sea: "sea", river: "river", mountain: "mountain", earth: "earth",
  harvest: "harvest", war: "war", death: "death", fire: "fire", forge: "smith", love: "love.n", wisdom: "wisdom", trickery: "secret",
  hunt: "hunt.n", healing: "healing", home: "home", travel: "way", fate: "fate", night: "night", dawn: "dawn", wine: "wine", beasts: "wolf",
  underworld: "death", creation: "sky",
};

export const DOMAIN_SYMBOL: Record<DeityDomain, EmblemConcept[]> = {
  sky: ["eagle", "star"], sun: ["sun"], moon: ["moon"], stars: ["star"], storm: ["lightning"], sea: ["wave", "fish", "anchor"], river: ["fish", "wave"],
  mountain: ["mountain"], earth: ["tree", "wheat"], harvest: ["wheat"], war: ["sword", "spear", "axe"], death: ["raven", "serpent"], fire: ["flame"],
  forge: ["hammer"], love: ["rose", "heart"], wisdom: ["owl", "eye"], trickery: ["serpent", "raven"], hunt: ["stag", "horn"], healing: ["serpent", "cup"],
  home: ["key", "flame"], travel: ["wheel", "ship"], fate: ["wheel", "eye"], night: ["owl", "star"], dawn: ["sun", "swan"], wine: ["cup"],
  beasts: ["bear", "wolf", "boar"], underworld: ["key", "serpent"], creation: ["tree", "star"],
};

const EPITHETS: Record<DeityDomain, string[]> = {
  sky: ["the Father of All", "the High One", "the All-Seeing", "the Wide-Eyed"],
  sun: ["the Bright Wanderer", "the Golden Eye", "the Lord of Day", "the Unconquered"],
  moon: ["the Silver Lady", "the Measurer of Months", "the Pale Watcher"],
  stars: ["the Lamplighter", "the Weaver of Stars"],
  storm: ["the Shepherd of Storms", "the Thunderer", "the Breaker of Oaks", "the Cloud-Gatherer"],
  sea: ["the Earth-Shaker", "the Lord of Deeps", "the Salt Mother", "the Taker of Ships"],
  river: ["the Father of Waters", "the Giver of Silt", "the Long Serpent", "the Swift Mother"],
  mountain: ["the Old Man of the Peaks", "the Sleeper in Stone", "the White Throne"],
  earth: ["the Mother of All", "the Broad-Bosomed", "the Nurse of Seeds"],
  harvest: ["the Giver of Grain", "the Lady of Sheaves", "the Reaper"],
  war: ["the Spear-Shaker", "the Red One", "the Breaker of Shields", "the Lord of Hosts"],
  death: ["the Silent Host", "the Gatherer", "the Keeper of the Gate"],
  fire: ["the Ever-Burning", "the Hearth-Keeper", "the Bright Tongue"],
  forge: ["the Smith of the Gods", "the Lame Maker", "the Hammer-Hand"],
  love: ["the Fair One", "the Binder of Hearts", "the Golden"],
  wisdom: ["the Counsellor", "the Owl-Eyed", "the Knower of Names"],
  trickery: ["the Many-Shaped", "the Thief of Fire", "the Laughing One"],
  hunt: ["the Lady of Beasts", "the Far-Shooter", "the Antlered One"],
  healing: ["the Physician", "the Gentle Hand"],
  home: ["the Keeper of the Hearth", "the Guardian of Thresholds"],
  travel: ["the Guide of Roads", "the Swift Messenger"],
  fate: ["the Spinner", "the Weigher of Lives"],
  night: ["the Veiled One", "the Mother of Dreams"],
  dawn: ["the Rosy-Fingered", "the Opener of Gates"],
  wine: ["the Twice-Born", "the Giver of Revels"],
  beasts: ["the Lord of the Herds", "the Wild One"],
  underworld: ["the Lord Below", "the Rich One", "the Keeper of Keys"],
  creation: ["the First", "the Maker"],
};

function pickDomains(sim: Sim, culture: number, hasRiver: boolean, hasRange: boolean): DeityDomain[] {
  const C = sim.C[culture];
  const rng = sim.rng.religion;
  const out: DeityDomain[] = ["sky", "earth"];
  const add = (d: DeityDomain) => {
    if (!out.includes(d)) out.push(d);
  };
  if (rng.chance(0.85)) add("sun");
  if (rng.chance(0.7)) add("moon");
  if (hasRiver) add("river");
  if (hasRange && rng.chance(0.8)) add("mountain");
  if (C.archetype === "coastal" || C.archetype === "island") add("sea");
  const pool: [DeityDomain, number][] = [
    ["storm", 3], ["harvest", C.archetype === "steppe" ? 0.5 : 3], ["war", 1 + 2 * C.values.martial], ["death", 2.5], ["fire", 1.2], ["forge", 1],
    ["love", 1.5], ["wisdom", 1.2], ["trickery", 1.3], ["hunt", C.archetype === "forest" || C.archetype === "steppe" ? 2.5 : 1], ["healing", 0.8],
    ["home", 0.8], ["fate", 0.8], ["night", 0.8], ["dawn", 0.8], ["wine", 0.6], ["beasts", C.archetype === "steppe" ? 2 : 0.5], ["underworld", 1],
    ["sea", 0.5], ["stars", 0.7], ["travel", 0.6],
  ];
  const target = rng.int(6, 10);
  for (let i = 0; i < 30 && out.length < target; i++) add(rng.weighted(pool));
  return out;
}

function nearestFeature(sim: Sim, cell: number, kind: string, radiusKm: number): number {
  let best = -1, bd = Infinity;
  for (const f of sim.w.features) {
    if (f.kind !== kind) continue;
    // distance from cell to the nearest member cell (sampled)
    const cs = f.cells;
    const step = Math.max(1, Math.floor(cs.length / 24));
    for (let i = 0; i < cs.length; i += step) {
      const d = sim.distKm(cell, cs[i]);
      if (d < bd) {
        bd = d;
        best = f.id;
      }
    }
  }
  return bd <= radiusKm ? best : -1;
}

export function newReligionRecord(sim: Sim, r: Omit<Religion, "id" | "children" | "deities" | "scripture" | "ended">, organised: boolean, zeal: number): RelS {
  const id = sim.h.religions.length;
  const rec: Religion = { ...r, id, children: [], deities: [], scripture: -1, ended: -1 };
  sim.h.religions.push(rec);
  if (r.parent >= 0) sim.h.religions[r.parent].children.push(id);
  const st: RelS = { id, rec, alive: true, organised, zeal, adherents: 0 };
  sim.R.push(st);
  return st;
}

export function newDeity(sim: Sim, d: Omit<Deity, "id" | "children">): number {
  const id = sim.h.deities.length;
  sim.h.deities.push({ ...d, id, children: [] });
  return id;
}

export function addMyth(sim: Sim, m: Omit<Myth, "id">): number {
  const id = sim.h.myths.length;
  sim.h.myths.push({ ...m, id });
  return id;
}

/** Create the folk religion of a founding people. */
export function createFolkReligion(sim: Sim, culture: number): number {
  const C = sim.C[culture];
  const rng = sim.rng.religion;
  const lang = C.lang;
  const home = C.rec.homeCell;
  const river = nearestFeature(sim, home, "river", 500);
  const range = nearestFeature(sim, home, "mountains", 900);
  const domains = pickDomains(sim, culture, river >= 0, range >= 0);
  const kind = C.archetype === "steppe" || C.archetype === "tundra" ? (rng.chance(0.5) ? "ancestor" : "folk") : domains.length >= 7 ? "pantheon" : "folk";
  const color = hsl(rgbToHue(C.rec.color) + 180, 0.35, 0.62);
  const deityIds: number[] = [];
  const byDomain = new Map<DeityDomain, number>();
  for (const dom of domains) {
    const sex: Sex = dom === "sky" || dom === "storm" || dom === "war" || dom === "forge" || dom === "sun" ? (rng.chance(0.85) ? "m" : "f") : dom === "earth" || dom === "moon" || dom === "love" || dom === "harvest" || dom === "night" ? (rng.chance(0.85) ? "f" : "m") : rng.chance(0.5) ? "m" : "f";
    let feature = -1;
    let name;
    if (dom === "river" && river >= 0) {
      feature = river;
      name = featureNameFor(sim, river, culture);
    } else if (dom === "mountain" && range >= 0) {
      feature = range;
      name = featureNameFor(sim, range, culture);
    }
    if (!name) name = sim.names.deity(lang, rng, { domain: DOMAIN_CONCEPT[dom], gender: sex === "f" ? "f" : "m" });
    const id = newDeity(sim, {
      name: name as unknown as WName, religion: -1, domains: [dom], sex, epithets: rng.sample(EPITHETS[dom], rng.int(1, 2)), symbol: rng.pick(DOMAIN_SYMBOL[dom]),
      feature, parents: [], consort: -1,
    });
    deityIds.push(id);
    byDomain.set(dom, id);
  }
  // Divine family: sky and earth are the first pair; most others are their children.
  const D = sim.h.deities;
  const sky = byDomain.get("sky")!, earth = byDomain.get("earth")!;
  D[sky].consort = earth;
  D[earth].consort = sky;
  for (const id of deityIds) {
    if (id === sky || id === earth) continue;
    if (rng.chance(0.7)) {
      D[id].parents = [sky, earth];
      D[sky].children.push(id);
      D[earth].children.push(id);
    }
  }
  // A second divine couple among the children.
  const kids = deityIds.filter((i) => D[i].parents.length && D[i].consort < 0);
  const m = kids.filter((i) => D[i].sex === "m"), f = kids.filter((i) => D[i].sex === "f");
  if (m.length && f.length && rng.chance(0.7)) {
    const a = rng.pick(m), b = rng.pick(f);
    D[a].consort = b;
    D[b].consort = a;
  }
  const chief = rng.chance(0.5) ? sky : byDomain.get("sun") ?? byDomain.get("storm") ?? sky;
  const relName = sim.names.religion(lang, rng, { deity: D[chief].name as never });
  const english = rng.pick([`the ${C.rec.adjective} pantheon`, `the old faith of the ${C.rec.adjective}`, `the ${C.rec.adjective} gods`]);
  const symbol = D[chief].symbol;
  const R = newReligionRecord(sim, {
    name: relName as unknown as WName, english: kind === "pantheon" ? `the ${C.rec.adjective} pantheon` : english, kind, parent: -1, founded: 0, founder: -1, holyCity: -1,
    culture, tenets: folkTenets(rng, C.archetype), symbol, clergy: nameTitle(lang, "priest") as unknown as WName, color,
    emblem: religionEmblem(rng, symbol),
  }, false, 0.25);
  for (const id of deityIds) D[id].religion = R.id;
  R.rec.deities = deityIds;
  // Myths.
  const motif = rng.pick(["the sundering of sky and earth", "the cosmic egg", "the world tree", "the primordial sea", "the body of the first giant", "the potter's clay"]);
  addMyth(sim, { religion: R.id, kind: "creation", actors: [sky, earth], features: [], data: { motif } });
  if (river >= 0 || C.archetype === "coastal") {
    const flooder = byDomain.get("river") ?? byDomain.get("sea") ?? byDomain.get("storm") ?? sky;
    addMyth(sim, { religion: R.id, kind: "flood", actors: [flooder, sky], features: river >= 0 ? [river] : [], data: { cause: rng.pick(["wrath at human pride", "grief for a lost child", "a broken oath", "the gods' quarrel"]), survivors: rng.pick(["a single family in a boat", "those who climbed the holy mountain", "twin children carried by a swan", "the people of the reed-house"]) } });
  }
  const ancestor = rng.pick(deityIds);
  addMyth(sim, { religion: R.id, kind: "originOfPeople", actors: [ancestor], features: [river, range].filter((x) => x >= 0), data: { from: rng.pick(["river mud", "a fallen tree", "the sea foam", "stones thrown over a shoulder", "the tears of a goddess", "a wolf's litter", "the first ear of grain"]), culture } });
  if (range >= 0 && rng.chance(0.7)) {
    const hero = byDomain.get("storm") ?? byDomain.get("war") ?? byDomain.get("sun") ?? sky;
    addMyth(sim, { religion: R.id, kind: "deed", actors: [hero], features: [range], data: { deed: rng.pick(["slew the serpent that coiled about the mountains", "chained the giant beneath the peaks", "split the mountain with a thunderbolt", "built a throne upon the highest peak"]) } });
  }
  addMyth(sim, { religion: R.id, kind: "endOfWorld", actors: [byDomain.get("death") ?? byDomain.get("underworld") ?? sky], features: [], data: { end: rng.pick(["fire", "flood", "endless winter", "the devouring of the sun", "the long sleep of the gods"]) } });
  C.folk = R.id;
  C.rec.folkReligion = R.id;
  return R.id;
}

function folkTenets(rng: { sample<T>(a: readonly T[], k: number): T[] }, arch: string): string[] {
  const pool = ["ancestorVeneration", "sacrifice", "sacredGroves", "seasonalFeasts", "divination", "shamanism", "sacredKingship", "oralTradition", "spiritsOfPlace", "hospitalityLaw"];
  const t = rng.sample(pool, 3);
  if (arch === "steppe" && !t.includes("shamanism")) t.push("shamanism");
  return t;
}
