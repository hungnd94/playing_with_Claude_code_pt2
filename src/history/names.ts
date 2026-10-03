/**
 * Adapter between the simulation and the language engine (src/lang): the
 * per-world name registry, the table of languages (lang-engine id ↔ History
 * language id), site and feature descriptors read off the physical world,
 * thin wrappers around the naming API, and the final conversion of the
 * engine's rich `Name` objects into the `WName`s stored in a History.
 */
import type { Rng } from "../core/rng";
import * as L from "../lang/index";
import type { Language as LLang, Name as LName, NameKind, EtymStep } from "../lang/index";
import { Biome, Resource, type GeoFeature } from "../world/types";
import type { Language, WName, Id, Utterance } from "./types";
import type { Sim } from "./sim";

export type { LLang, LName };

export class Names {
  readonly reg = L.createRegistry();
  /** Lang-engine language objects by History language id. */
  readonly langs: LLang[] = [];
  /** Lang-engine id → History language id. */
  readonly idOf = new Map<string, number>();
  /** English base names in use (to keep daughter languages distinct). */
  readonly usedLangNames = new Set<string>();

  constructor(private sim: Sim) {}

  /** Register a language object as a History language entry. */
  addLanguage(lang: LLang, culture: Id, parent: Id, origin: Language["origin"], year: number): number {
    const id = this.sim.h.languages.length;
    const fam = parent >= 0 ? this.sim.h.languages[parent].family : id;
    this.langs.push(lang);
    this.idOf.set(lang.id, id);
    this.usedLangNames.add(lang.name.toLowerCase());
    this.sim.h.languages.push({
      id, name: lang.name, endonym: L.nameLanguage(lang) as unknown as WName, parent, children: [], born: year, ended: -1, culture, family: fam, origin, data: lang,
    });
    if (parent >= 0) this.sim.h.languages[parent].children.push(id);
    return id;
  }

  langOfName(n: LName): LLang | undefined {
    const id = this.idOf.get(n.lang);
    return id === undefined ? undefined : this.langs[id];
  }

  /** Bring a name into language `to`: evolve if `to` descends from its language, else borrow. */
  adapt(n: LName, to: LLang, year: number): LName {
    if (n.lang === to.id) return n;
    const from = this.langOfName(n);
    if (from && L.pathBetween(from, to)) return L.evolveName(n, from, to);
    return L.borrowName(n, to, { from, year });
  }

  settlement(lang: LLang, rng: Rng, site: L.SettlementSite): LName {
    return L.nameSettlement(lang, rng, site, { registry: this.reg });
  }
  person(lang: LLang, rng: Rng, opts: L.PersonOptions): LName {
    return L.namePerson(lang, rng, { ...opts, registry: this.reg });
  }
  realm(lang: LLang, rng: Rng, opts: L.RealmOptions): LName {
    return L.nameRealm(lang, rng, { ...opts, registry: this.reg });
  }
  people(lang: LLang, rng: Rng, opts: L.PeopleOptions): LName {
    return L.namePeople(lang, rng, { ...opts, registry: this.reg });
  }
  dynasty(lang: LLang, rng: Rng, opts: L.DynastyOptions): LName {
    return L.nameDynasty(lang, rng, { ...opts, registry: this.reg });
  }
  deity(lang: LLang, rng: Rng, opts: L.DeityOptions): LName {
    return L.nameDeity(lang, rng, { ...opts, registry: this.reg });
  }
  religion(lang: LLang, rng: Rng, opts: L.ReligionOptions): LName {
    return L.nameReligion(lang, rng, { ...opts, registry: this.reg });
  }
  feature(lang: LLang, rng: Rng, kind: NameKind, d: L.FeatureDescriptors): LName {
    return L.nameFeature(lang, rng, kind, d, { registry: this.reg });
  }

  /** Convert a mini-grammar sentence into a History utterance. */
  utter(s: L.Sentence): Utterance {
    return L.toUtterance(s, (engineId) => this.idOf.get(engineId) ?? -1);
  }
  motto(lang: LLang, rng: Rng): Utterance {
    return this.utter(L.motto(lang, rng));
  }

  /** A short noun phrase as a name ("Temple of the Sun", "Song of Oshar"), via the mini-grammar. */
  phraseName(lang: LLang, p: L.Phrase): LName {
    const s = L.phrase(lang, p);
    const words = s.words;
    const phonemes: string[] = [];
    words.forEach((w, i) => {
      if (i > 0) phonemes.push(" ");
      phonemes.push(...w);
    });
    const text = s.text.replace(/[.!?]+$/, "");
    return {
      lang: lang.id, kind: "other", phonemes, words, roman: text, ipa: s.ipa, gloss: s.translation.replace(/[.!?]+$/, ""),
      parts: words.map((w, i) => ({ phonemes: w, roman: text.split(" ")[i] ?? "", gloss: s.gloss.split(/\s+/)[i] ?? "", role: "name" as const, word: i })),
      history: [], etym: "",
    };
  }

  // -------------------------------------------------------------------------
  // Finalisation
  // -------------------------------------------------------------------------

  private cache = new Map<LName, WName>();
  private labels = new Map<string, string>();

  /** Set the final English labels used when citing each language in etymologies. */
  setLabels(): void {
    this.labels.clear();
    for (const l of this.sim.h.languages) {
      const lang = this.langs[l.id];
      this.labels.set(lang.id, l.name);
    }
  }

  toW(n: LName | WName | undefined | null): WName {
    if (!n) return { roman: "", gloss: "", lang: -1 };
    if (typeof (n as WName).lang === "number") return n as WName;
    const ln = n as LName;
    const hit = this.cache.get(ln);
    if (hit) return hit;
    const label = (s: EtymStep) => this.labels.get(s.lang) ?? s.label;
    const w: WName = {
      roman: ln.roman,
      gloss: ln.gloss,
      lang: this.idOf.get(ln.lang) ?? -1,
      ipa: ln.ipa,
      phonemes: ln.phonemes,
      parts: ln.parts.map((p) => ({ roman: p.roman, gloss: p.gloss })),
      etym: ln.history.length ? L.renderEtymology(ln, { label }) : ln.etym || "",
    };
    this.cache.set(ln, w);
    return w;
  }
}

// ---------------------------------------------------------------------------
// Site descriptors
// ---------------------------------------------------------------------------

const BIOME_CONCEPTS: Record<number, string[]> = {
  [Biome.TemperateForest]: ["oak", "ash", "wood", "deer", "boar", "wolf", "forest"],
  [Biome.Taiga]: ["pine", "birch", "bear", "elk", "wolf", "forest"],
  [Biome.TemperateRainforest]: ["yew", "moss", "forest", "wood", "deer"],
  [Biome.Rainforest]: ["palm", "serpent", "tiger", "forest", "rain"],
  [Biome.TropicalDryForest]: ["palm", "cedar", "tiger", "elephant", "wood"],
  [Biome.Savanna]: ["lion", "elephant", "grass", "field"],
  [Biome.Steppe]: ["horse", "grass", "wind", "field"],
  [Biome.Grassland]: ["field", "meadow", "wheat", "horse", "barley"],
  [Biome.Mediterranean]: ["olive", "vine", "stone", "white", "goat"],
  [Biome.HotDesert]: ["sand", "well", "oasis", "red", "dry", "camel"],
  [Biome.ColdDesert]: ["stone", "camel", "wind", "dry"],
  [Biome.Wetland]: ["marsh", "reed", "heron", "willow", "water"],
  [Biome.Tundra]: ["elk", "snow", "white", "cold"],
  [Biome.Alpine]: ["snow", "eagle", "rock", "high"],
  [Biome.IceSheet]: ["ice", "white"],
};

const RESOURCE_CONCEPTS: [number, string[]][] = [
  [Resource.Salt, ["salt"]],
  [Resource.Copper, ["copper"]],
  [Resource.Tin, ["tin"]],
  [Resource.Iron, ["iron"]],
  [Resource.Gold, ["gold"]],
  [Resource.Silver, ["silver"]],
  [Resource.Gems, ["jewel"]],
  [Resource.Marble, ["white", "stone"]],
  [Resource.Timber, ["wood"]],
  [Resource.Horses, ["horse"]],
  [Resource.Fish, ["fish"]],
  [Resource.Furs, ["fox", "bear"]],
  [Resource.Wine, ["vine", "wine"]],
  [Resource.Amber, ["amber"]],
  [Resource.Pearls, ["pearl"]],
  [Resource.Obsidian, ["black", "stone"]],
  [Resource.Ivory, ["elephant"]],
  [Resource.Dyes, ["red"]],
];

/** Concept ids describing a settlement site, read off the physical world. */
export function siteConcepts(sim: Sim, cell: number): string[] {
  const w = sim.w, g = sim.g;
  const out: string[] = [];
  const add = (...cs: string[]) => {
    for (const c of cs) if (L.hasConcept(c) && !out.includes(c)) out.push(c);
  };
  const ro = w.riverOrder[cell];
  if (ro > 0) {
    add("river");
    if (ro <= 3) add("ford");
    if (g.coastal[cell]) add("mouth");
  }
  if (g.coastal[cell]) {
    add("coast", "shore");
    const wb = w.waterBodyOf[g.shore[cell]];
    const kind = wb >= 0 ? w.features[wb].kind : "";
    if (kind === "bay") add("bay", "harbor");
    else if (kind === "sea" || kind === "strait") add("harbor");
    const reg = w.regionOf[cell];
    if (reg >= 0 && w.features[reg].kind === "peninsula") add("cape");
    const lm = w.landmassOf[cell];
    if (lm >= 0 && w.features[lm].kind === "island") add("island");
    if (w.resources[cell] & Resource.Fish) add("fish");
  }
  if (g.lakeside[cell]) add("lake", "water");
  const el = w.elevation[cell];
  if (el > 1.6) add("mountain", "rock");
  else if (g.defense[cell] > 0.45) add("hill", "rock");
  else if (g.defense[cell] > 0.3) add("hill");
  const reg = w.regionOf[cell];
  if (reg >= 0) {
    const k = w.features[reg].kind;
    if (k === "hills") add("hill", "mound");
    if (k === "mountains") {
      let lower = 0;
      for (let q = w.mesh.adjStart[cell]; q < w.mesh.adjStart[cell + 1]; q++) if (w.elevation[w.mesh.adj[q]] > el) lower++;
      if (lower >= 3) add("valley", "pass");
    }
  }
  if (w.volcanism[cell] > 0.5) add("fire", "black", "smoke");
  const bc = BIOME_CONCEPTS[w.biome[cell]];
  if (bc) add(...bc);
  for (const [bit, cs] of RESOURCE_CONCEPTS) if (w.resources[cell] & bit) add(...cs);
  if (w.temperature[cell] < 2) add("cold", "snow");
  if (w.precipitation[cell] > 1800) add("rain");
  if (w.precipitation[cell] > 900 && el > 0.6) add("spring");
  return out;
}

const COLOR_BY_BIOME: Record<number, string> = {
  [Biome.HotDesert]: "red", [Biome.ColdDesert]: "grey", [Biome.Steppe]: "yellow", [Biome.Savanna]: "golden", [Biome.Grassland]: "green",
  [Biome.TemperateForest]: "green", [Biome.Taiga]: "black", [Biome.Rainforest]: "green", [Biome.Tundra]: "white", [Biome.IceSheet]: "white",
  [Biome.Wetland]: "brown", [Biome.Alpine]: "white", [Biome.Mediterranean]: "white", [Biome.TemperateRainforest]: "dark", [Biome.TropicalDryForest]: "red",
};

const BEASTS_BY_BIOME: Record<number, string[]> = {
  [Biome.TemperateForest]: ["wolf", "boar", "deer", "oak", "owl"],
  [Biome.Taiga]: ["bear", "elk", "wolf", "pine", "raven"],
  [Biome.Steppe]: ["horse", "eagle", "wind"],
  [Biome.Grassland]: ["horse", "bull", "wheat"],
  [Biome.Savanna]: ["lion", "elephant", "sun"],
  [Biome.Rainforest]: ["serpent", "tiger", "bird"],
  [Biome.TropicalDryForest]: ["tiger", "elephant", "serpent"],
  [Biome.HotDesert]: ["sun", "camel", "serpent"],
  [Biome.Tundra]: ["elk", "wolf", "snow"],
  [Biome.Wetland]: ["heron", "crane", "reed"],
  [Biome.Mediterranean]: ["olive", "bull", "goat"],
};

/** Naming descriptors for a geographic feature, seen by a people living at `homeCell`. */
export function featureDescriptors(sim: Sim, f: GeoFeature, homeCell: number, rng: Rng): L.FeatureDescriptors {
  const w = sim.w;
  const d: L.FeatureDescriptors = {};
  const a = f.attrs;
  const anchor = f.anchor;
  const biome = anchor >= 0 ? w.biome[anchor] : 0;
  switch (f.kind) {
    case "mountains":
    case "volcano":
      if (a.glaciated || Number(a.peakElevation ?? a.elevation ?? 0) > 4.5) d.color = "white";
      else if (a.origin === "volcanic arc" || f.kind === "volcano") d.color = rng.chance(0.5) ? "black" : "red";
      else if (rng.chance(0.4)) d.color = rng.pick(["grey", "blue", "red", "black"]);
      if (f.size > 300000) d.size = "great";
      break;
    case "hills":
      if (rng.chance(0.5)) d.color = rng.pick(["green", "red", "grey"]);
      break;
    case "river":
      if (Number(a.discharge ?? 0) > 20000) d.size = "great";
      if (rng.chance(0.35)) d.color = COLOR_BY_BIOME[biome] ?? "brown";
      break;
    case "lake":
      if (a.salinity === "saline") d.salt = true;
      if (a.frozenInWinter) d.temp = "cold";
      if (f.size > 100000) d.size = "great";
      break;
    case "desert":
      d.color = biome === Biome.ColdDesert ? "grey" : rng.pick(["red", "yellow", "white", "golden"]);
      if (f.size > 1000000) d.size = "great";
      break;
    case "sea":
    case "ocean":
    case "bay":
    case "strait": {
      const band = String(a.latitudeBand ?? "");
      if (band.includes("polar") || band.includes("subpolar")) d.temp = "cold";
      else if (band.includes("tropical") || band === "equatorial") d.color = rng.pick(["blue", "green", "golden"]);
      if (f.kind === "ocean") d.size = "great";
      break;
    }
    case "forest":
    case "jungle":
      if (rng.chance(0.4)) d.color = rng.pick(["dark", "black", "green"]);
      if (f.size > 800000) d.size = "great";
      break;
    case "tundra":
    case "glacier":
      d.color = "white";
      d.temp = "cold";
      break;
    case "steppe":
    case "plain":
      if (f.size > 400000) d.size = "great";
      break;
    default:
      break;
  }
  // Direction relative to the namers' home, for big far-away features.
  if (homeCell >= 0 && anchor >= 0 && rng.chance(0.25)) {
    const dist = sim.distKm(homeCell, anchor);
    if (dist > 1200) {
      const dLat = w.mesh.lat[anchor] - w.mesh.lat[homeCell];
      let dLon = w.mesh.lon[anchor] - w.mesh.lon[homeCell];
      if (dLon > Math.PI) dLon -= 2 * Math.PI;
      if (dLon < -Math.PI) dLon += 2 * Math.PI;
      const ew = dLon * Math.cos(w.mesh.lat[homeCell]);
      d.dir = Math.abs(dLat) > Math.abs(ew) ? (dLat > 0 ? "north" : "south") : ew > 0 ? "east" : "west";
    }
  }
  const beasts = BEASTS_BY_BIOME[biome];
  if (beasts && rng.chance(0.3)) d.concepts = [rng.pick(beasts)];
  // Drop descriptors that conflict (one colour only).
  if (d.color && !L.hasConcept(d.color)) delete d.color;
  return d;
}

/** Archetype concept used when naming a people ("Horse Folk", "River Folk"). */
export function archetypeConcept(arch: string): string {
  const m: Record<string, string> = {
    riverine: "river", coastal: "sea", steppe: "horse", forest: "forest", mountain: "mountain", desert: "sand", jungle: "serpent", tundra: "snow", island: "island",
  };
  return m[arch] ?? "river";
}

/** Plural-safe given name of a person (first word of the display form, or meta.given). */
export function givenName(n: LName | WName): string {
  const meta = (n as LName).meta;
  if (meta?.given) return meta.given;
  return n.roman.split(" ")[0];
}
