/**
 * A procedural STAND-IN for src/history's `simulateHistory`, so every part of
 * the UI can be built and tested before the real simulation exists.
 *
 * It is not a simulation: territories are a time-dependent weighted Voronoi
 * over travel cost (each culture / realm / faith is a "source" whose reach
 * grows from its founding and shrinks before its end), settlements are seeded
 * on good land inside the culture areas, and wars/rulers/events are sampled
 * plausibly around those. But every entity is real data: names, languages and
 * sound changes from src/lang, scripts from src/script, arms from
 * src/heraldry — so the viewers show what they will show for real.
 *
 * Deterministic in the world seed. Typically 1.5–3 s for a 40k-cell world.
 */
import { Rng } from "../../core/rng";
import { MinHeap } from "../../core/heap";
import { landMoveCost, seaMoveCost } from "../../geo/travel";
import { Biome, Resource, RESOURCE_KEYS, type GeoFeature, type PhysicalWorld } from "../../world/types";
import { EMBLEM_CONCEPTS, type EmblemConcept } from "../../world/concepts";
import * as L from "../../lang";
import { createScript, adaptScript, deriveScript, type Script as SScript } from "../../script";
import { generateArms, blazon, cantingCharges, type StyleName } from "../engine/heraldry";
import type * as H from "../../history/types";

export interface MockOptions {
  onProgress?: (stage: string, fraction: number) => void;
}

type LLang = L.Language;
type LName = L.Name;

const STEP = 5;
const KEY_EVERY = 20;
const SAMPLE = 10;

// ---------------------------------------------------------------------------
// Territory sources

interface Source {
  id: number;
  start: number;
  /** -1 = lasts forever. */
  end: number;
  speed: number;
  reach: number;
  weight: number;
  decline: number;
  initial: number;
}

/** Time-dependent weighted Voronoi over per-source travel-cost maps. */
class Field {
  sources: Source[] = [];
  private lists: number[][];
  private costs: number[][];
  private csrStart: Int32Array | null = null;
  private csrSrc: Int32Array | null = null;
  private csrCost: Float32Array | null = null;
  private radius = new Float64Array(0);
  private invW = new Float64Array(0);

  private habList: Int32Array;
  constructor(private n: number, habitable: Uint8Array) {
    this.lists = Array.from({ length: n }, () => []);
    this.costs = Array.from({ length: n }, () => []);
    const hl: number[] = [];
    for (let i = 0; i < n; i++) if (habitable[i]) hl.push(i);
    this.habList = Int32Array.from(hl);
  }

  add(src: Source, cells: Int32Array, cost: Float32Array): void {
    this.sources.push(src);
    for (let i = 0; i < cells.length; i++) {
      this.lists[cells[i]].push(this.sources.length - 1);
      this.costs[cells[i]].push(cost[i]);
    }
    this.csrStart = null;
  }

  costOf(si: number, cell: number): number {
    const l = this.lists[cell];
    for (let k = 0; k < l.length; k++) if (l[k] === si) return this.costs[cell][k];
    return Infinity;
  }

  static radiusAt(s: Source, y: number): number {
    if (y < s.start || (s.end >= 0 && y >= s.end)) return -1;
    let r = Math.min(s.reach, s.initial + (y - s.start) * s.speed);
    if (s.end >= 0 && s.decline > 0 && y > s.end - s.decline) r *= Math.max(0.12, (s.end - y) / s.decline);
    return r;
  }

  private prep(y: number): void {
    const S = this.sources.length;
    if (this.radius.length !== S) {
      this.radius = new Float64Array(S);
      this.invW = new Float64Array(S);
    }
    for (let i = 0; i < S; i++) {
      this.radius[i] = Field.radiusAt(this.sources[i], y);
      this.invW[i] = 1 / this.sources[i].weight;
    }
    if (!this.csrStart) {
      const n = this.n;
      const start = new Int32Array(n + 1);
      for (let c = 0; c < n; c++) start[c + 1] = start[c] + this.lists[c].length;
      const src = new Int32Array(start[n]);
      const cost = new Float32Array(start[n]);
      for (let c = 0; c < n; c++) {
        const l = this.lists[c], k = this.costs[c];
        for (let i = 0; i < l.length; i++) {
          src[start[c] + i] = l[i];
          cost[start[c] + i] = k[i];
        }
      }
      this.csrStart = start;
      this.csrSrc = src;
      this.csrCost = cost;
    }
  }

  /** Source *index* owning `cell` at year y, or -1. */
  cellAt(cell: number, y: number): number {
    const l = this.lists[cell], k = this.costs[cell];
    let best = -1, bs = Infinity;
    for (let i = 0; i < l.length; i++) {
      const s = this.sources[l[i]];
      const r = Field.radiusAt(s, y);
      if (r < k[i]) continue;
      const sc = k[i] / s.weight;
      if (sc < bs) { bs = sc; best = l[i]; }
    }
    return best;
  }

  /** Source *ids* per habitable cell at year y (-1 = none) into `out` (other cells untouched). */
  evalAll(y: number, out: Int32Array): Int32Array {
    this.prep(y);
    const st = this.csrStart!, src = this.csrSrc!, cost = this.csrCost!, R = this.radius, iw = this.invW, hl = this.habList;
    const ids = Int32Array.from(this.sources, (s) => s.id);
    for (let h = 0; h < hl.length; h++) {
      const c = hl[h];
      let best = -1, bs = Infinity;
      for (let k = st[c], e = st[c + 1]; k < e; k++) {
        const s = src[k];
        const cc = cost[k];
        if (R[s] < cc) continue;
        const sc = cc * iw[s];
        if (sc < bs) { bs = sc; best = s; }
      }
      out[c] = best < 0 ? -1 : ids[best];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------

const ARCH_FLAVOUR: Record<H.Archetype, L.Flavour> = {
  riverine: "river", coastal: "coast", steppe: "steppe", forest: "forest", mountain: "mountains",
  desert: "desert", jungle: "jungle", tundra: "tundra", island: "islands",
};
const ARCH_HERALDRY: Record<H.Archetype, StyleName> = {
  riverine: "anglo", coastal: "italian", steppe: "steppe", forest: "germanic", mountain: "nordic",
  desert: "iberian", jungle: "baroque", tundra: "nordic", island: "french",
};
const DOMAINS: H.DeityDomain[] = ["sky", "sun", "moon", "storm", "sea", "river", "mountain", "earth", "harvest", "war", "death", "fire", "forge", "love", "wisdom", "trickery", "hunt", "healing", "night", "dawn", "fate", "underworld"];
const DOMAIN_CONCEPT: Partial<Record<H.DeityDomain, string>> = { forge: "smith", love: "love.n", hunt: "hunt.n", underworld: "death", trickery: "night" };
const DOMAIN_SYMBOL: Partial<Record<H.DeityDomain, EmblemConcept>> = {
  sky: "eagle", sun: "sun", moon: "moon", storm: "lightning", sea: "wave", river: "fish", mountain: "mountain", earth: "tree",
  harvest: "wheat", war: "sword", death: "raven", fire: "flame", forge: "hammer", love: "rose", wisdom: "owl", trickery: "serpent",
  hunt: "stag", healing: "cup", night: "star", dawn: "feather", fate: "wheel", underworld: "key",
};
const DOMAIN_EPITHET: Partial<Record<H.DeityDomain, string[]>> = {
  sky: ["the Father of Heaven", "the Wide-Seeing"], sun: ["the Golden Eye", "the Bringer of Days"], moon: ["the Silver Wanderer", "the Keeper of Months"],
  storm: ["the Shepherd of Storms", "the Thunderer"], sea: ["the Salt Mother", "the Shaker of Shores"], river: ["the Giver of Fields", "the Long Water"],
  mountain: ["the Old One of the Peaks", "the Unmoving"], earth: ["the Mother of Grain", "the Deep Root"], harvest: ["the Lady of Sheaves", "the Fattener of Herds"],
  war: ["the Spear-Breaker", "the Red Rider"], death: ["the Gatherer", "the Quiet Host"], fire: ["the Hearth-Keeper", "the Bright Tongue"],
  forge: ["the Smith of the Gods", "the Hammer-Hand"], love: ["the Rose-Crowned", "the Binder of Hearts"], wisdom: ["the Counsellor", "the Owl-Eyed"],
  trickery: ["the Many-Faced", "the Laughing Thief"], hunt: ["the Antlered", "the Swift Bow"], healing: ["the Gentle Hand", "the Cup-Bearer"],
  night: ["the Veiled", "the Star-Mantled"], dawn: ["the Rose-Fingered", "the Opener of Gates"], fate: ["the Spinner", "the Wheel-Turner"],
  underworld: ["the Lord Below", "the Keeper of Keys"],
};
const TENETS_ORG = ["one god above all", "the soul is judged after death", "charity to strangers", "pilgrimage to the holy city", "fasting in the dark month", "the world is a struggle of light and dark", "rebirth of the soul", "the sacred fire must never die", "the law was written by the god's own hand", "renunciation of wealth", "the ruler is the god's steward", "veneration of the ancestors", "the end of days will come by water", "the duty of truthfulness"];
const TENETS_FOLK = ["sacrifice at the turning of the year", "spirits dwell in springs and stones", "veneration of the ancestors", "the river is a god", "the dead travel west", "oaths are sworn on iron"];
const TRAITS: H.Trait[] = ["ambitious", "content", "brave", "craven", "cruel", "kind", "just", "pious", "cynical", "wise", "foolish", "scholarly", "charismatic", "shy", "greedy", "generous", "sickly", "strong", "mad", "cunning", "honest", "builder", "warlike", "peaceful"];
const EPITHET_OF: Partial<Record<H.Trait, string[]>> = {
  ambitious: ["the Conqueror", "the Great"], brave: ["the Bold", "the Lion"], craven: ["the Timid"], cruel: ["the Cruel", "the Terrible"], kind: ["the Good", "the Beloved"],
  just: ["the Just", "the Lawgiver"], pious: ["the Pious", "the Saint"], wise: ["the Wise", "the Learned"], foolish: ["the Fool", "the Unready"], scholarly: ["the Scholar"],
  charismatic: ["the Fair"], greedy: ["the Grasping"], generous: ["the Generous", "the Open-Handed"], sickly: ["the Sickly"], strong: ["the Strong", "Ironside"],
  mad: ["the Mad"], cunning: ["the Fox"], builder: ["the Builder"], warlike: ["the Red", "Spear-Shaker"], peaceful: ["the Peaceable"],
};
const PLAGUE_NAMES = ["the Grey Death", "the Black Cough", "the Sweating Sickness", "the Red Fever", "the Great Mortality", "the Wasting", "the Pale Plague"];
const WONDER_KINDS: H.WonderKind[] = ["temple", "palace", "wall", "library", "lighthouse", "colossus", "bridge", "tomb", "observatory", "arena", "aqueduct", "academy", "garden", "fortress", "harbor"];

export function mockHistory(world: PhysicalWorld, opts: MockOptions = {}): H.History {
  const progress = opts.onProgress ?? (() => {});
  const seed = world.params.seed;
  const rng = new Rng(seed).fork("mock-history");
  const END = Math.max(500, world.params.years || 3000);
  const snapshots = Math.floor(END / STEP) + 1;
  const mesh = world.mesh;
  const n = mesh.n;
  const { adj, adjStart, xyz } = mesh;
  const R = world.params.radiusKm;
  const reg = L.createRegistry();

  progress("terrain costs", 0);
  const wet = (i: number): boolean => !world.isLand[i] || world.lakeId[i] >= 0;
  const habitable = new Uint8Array(n);
  let habCount = 0;
  for (let i = 0; i < n; i++) if (!wet(i) && world.biome[i] !== Biome.IceSheet) { habitable[i] = 1; habCount++; }
  const edgeLand = new Float32Array(adj.length);
  const edgeSea = new Float32Array(adj.length);
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      edgeLand[k] = landMoveCost(world, i, j);
      edgeSea[k] = wet(i) || wet(j) ? seaMoveCost(world, i, j) : Infinity;
    }
  }
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(4096);
  const spread = (src: number, maxCost: number, seaMul: number): [Int32Array, Float32Array] => {
    const touched: number[] = [src];
    dist[src] = 0;
    heap.clear();
    heap.push(0, src);
    while (heap.size) {
      const c = heap.pop();
      const dc = heap.lastKey;
      if (dc > dist[c]) continue;
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const j = adj[k];
        let e = edgeLand[k];
        if (!(e < Infinity)) {
          if (seaMul <= 0) continue;
          e = edgeSea[k] * seaMul;
          if (!(e < Infinity)) continue;
        }
        const nd = dc + e;
        if (nd < dist[j] && nd <= maxCost) {
          if (dist[j] === Infinity) touched.push(j);
          dist[j] = nd;
          heap.push(nd, j);
        }
      }
    }
    const cells: number[] = [], cost: number[] = [];
    for (const c of touched) {
      if (habitable[c]) { cells.push(c); cost.push(dist[c]); }
      dist[c] = Infinity;
    }
    return [Int32Array.from(cells), Float32Array.from(cost)];
  };
  const ang = (a: number, b: number): number => {
    const d = xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2];
    return Math.acos(Math.max(-1, Math.min(1, d)));
  };
  const cellKm2 = (c: number): number => mesh.area[c] * R * R;
  const latDeg = (c: number): number => (mesh.lat[c] * 180) / Math.PI;

  const events: Omit<H.HEvent, "id">[] = [];
  const ev = (e: Omit<H.HEvent, "id">): void => {
    if (e.year >= 0 && e.year <= END) events.push(e);
  };

  // ---------------------------------------------------------------- cultures
  progress("peoples", 0.05);
  const siteScore = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!habitable[i]) continue;
    const lat = Math.abs(latDeg(i));
    siteScore[i] = (world.fertility[i] + 0.02) * (1 + 0.22 * Math.min(4, world.riverOrder[i])) * (world.coastDist[i] === 1 ? 1.15 : 1) * (lat > 58 ? 0.35 : 1);
  }
  const byScore = Array.from({ length: n }, (_, i) => i).filter((i) => habitable[i]).sort((a, b) => siteScore[b] - siteScore[a] || a - b);
  const K = Math.max(6, Math.min(13, Math.round(habCount / 1300)));
  const hearths: number[] = [];
  const minSep = Math.max(0.22, Math.sqrt((habCount / n) * 4 * Math.PI / K) * 0.55);
  for (const c of byScore) {
    if (hearths.length >= K) break;
    if (hearths.every((h) => ang(h, c) > minSep)) hearths.push(c);
  }
  // Pastoral peoples of the steppe.
  const steppeCells = byScore.filter((c) => world.biome[c] === Biome.Steppe);
  for (let t = 0, added = 0; t < steppeCells.length && added < 2; t += 7) {
    const c = steppeCells[t];
    if (hearths.every((h) => ang(h, c) > minSep * 0.8)) { hearths.push(c); added++; }
  }

  const archetypeOf = (c: number): H.Archetype => {
    const b = world.biome[c];
    const lm = world.landmassOf[c];
    const isIsland = lm >= 0 && world.features[lm]?.kind === "island";
    if (b === Biome.Steppe) return "steppe";
    if (b === Biome.HotDesert || b === Biome.ColdDesert) return "desert";
    if (b === Biome.Rainforest || b === Biome.TropicalDryForest) return "jungle";
    if (b === Biome.Tundra) return "tundra";
    if (world.elevation[c] > 1.3 || b === Biome.Alpine) return "mountain";
    if (isIsland) return "island";
    if (world.riverOrder[c] >= 2) return "riverine";
    if (world.coastDist[c] <= 1) return "coastal";
    if (b === Biome.Taiga || b === Biome.TemperateForest || b === Biome.TemperateRainforest) return "forest";
    return "riverine";
  };

  interface CultureX {
    c: H.Culture;
    langs: { year: number; lang: LLang; hid: number }[];
    peopleName: LName;
    source: number; // field source index
    folk: number; // religion id
  }
  const cultures: CultureX[] = [];
  const languages: H.Language[] = [];
  const langObj: LLang[] = [];
  const langHid = new Map<string, number>();
  const cultureField = new Field(n, habitable);

  const addLanguage = (lang: LLang, name: string, year: number, culture: number, parent: number, origin: H.Language["origin"]): number => {
    const id = languages.length;
    const endo = L.nameLanguage(lang);
    const family = parent >= 0 ? languages[parent].family : id;
    languages.push({ id, name, endonym: wn(endo, id), parent, children: [], born: year, ended: -1, culture, family, origin, data: lang });
    if (origin === "stage" && parent >= 0) languages[parent].ended = year;
    if (parent >= 0) languages[parent].children.push(id);
    langObj.push(lang);
    langHid.set(lang.id, id);
    return id;
  };
  function wn(name: LName, langId?: number): H.WName {
    const lid = langId ?? langHid.get(name.lang) ?? -1;
    return {
      roman: name.roman,
      gloss: name.gloss,
      lang: lid,
      ipa: name.ipa,
      phonemes: name.phonemes,
      parts: name.parts.filter((p) => p.role !== "link").map((p) => ({ roman: p.roman, gloss: p.gloss })),
      etym: name.etym || undefined,
    };
  }
  const adjectiveFor = (roman: string): string => {
    const base = roman.split(" ")[0];
    if (/[aeiouy]$/i.test(base)) return base + "n";
    if (/[iy]an$|ish$|ese$|ic$|i$/i.test(base)) return base;
    return base + (base.length > 6 ? "i" : "ese");
  };
  const usedLangNames: string[] = [];
  const protos: LLang[] = [];
  const newCulture = (home: number, born: number, parent: number, lang: LLang, langId: number, crng: Rng): CultureX => {
    const id = cultures.length;
    const arch = archetypeOf(home);
    const pv = parent >= 0 ? cultures[parent].c.values : null;
    const v = (bias: number, k: keyof H.CultureValues): number =>
      Math.max(0, Math.min(1, pv ? pv[k] + crng.range(-0.15, 0.15) : crng.range(0.15, 0.85) + bias));
    const values: H.CultureValues = {
      martial: v(arch === "steppe" || arch === "mountain" ? 0.15 : 0, "martial"),
      mercantile: v(arch === "coastal" || arch === "riverine" ? 0.15 : 0, "mercantile"),
      piety: v(arch === "desert" ? 0.15 : 0, "piety"),
      art: v(0, "art"),
      expansion: v(arch === "steppe" ? 0.2 : 0, "expansion"),
      seafaring: v(arch === "coastal" || arch === "island" ? 0.3 : -0.2, "seafaring"),
    };
    const people = L.namePeople(lang, crng.fork("people"), { feature: crng.pick(["river", "horse", "forest", "sea", "mountain", "sun"]), registry: reg });
    const hue = (id * 137.508 + crng.range(-12, 12)) % 360;
    const c: H.Culture = {
      id,
      name: wn(people, langId),
      adjective: adjectiveFor(lang.name || people.roman),
      parent,
      children: [],
      born,
      ended: -1,
      homeCell: home,
      archetype: arch,
      values,
      languages: [{ year: born, lang: langId }],
      scripts: [{ year: born, script: -1 }],
      tech: [{ year: born, level: 0 }],
      heraldicStyle: arch === "steppe" ? "seal" : arch === "island" || arch === "jungle" ? "mon" : "arms",
      color: hsl(hue, 0.42, 0.6),
      titles: {},
      folkReligion: -1,
      family: parent >= 0 ? cultures[parent].c.family : id,
      namedAfter: -1,
    };
    for (const role of ["ruler", "priest", "general"] as const) {
      try { c.titles[role] = wn(L.nameTitle(lang, role === "ruler" ? "king" : role), langId); } catch { /* concept missing */ }
    }
    if (parent >= 0) cultures[parent].c.children.push(id);
    const cx: CultureX = { c, langs: [{ year: born, lang, hid: langId }], peopleName: people, source: -1, folk: -1 };
    cultures.push(cx);
    return cx;
  };

  hearths.forEach((home, i) => {
    const crng = rng.fork(`culture${i}`);
    const arch = archetypeOf(home);
    const proto = L.createProtoLanguage(crng.fork("proto"), { flavour: ARCH_FLAVOUR[arch], avoid: protos, year: 0 });
    protos.push(proto);
    usedLangNames.push(proto.name);
    const lid = addLanguage(proto, L.stageLabel(proto.name, "old"), 0, i, -1, "proto");
    const cx = newCulture(home, 0, -1, proto, lid, crng);
    const seafaring = cx.c.values.seafaring;
    const [cells, cost] = spread(home, 4600, 1.2 + 3.5 * (1 - seafaring));
    cx.source = cultureField.sources.length;
    cultureField.add({ id: i, start: 0, end: -1, speed: crng.range(1.4, 2.6), reach: crng.range(2600, 4400), weight: crng.range(0.95, 1.2), decline: 0, initial: 150 }, cells, cost);
  });

  // Language stages: Old X → Middle X → X.
  progress("tongues", 0.12);
  const stageYears = (crng: Rng): [number, number] => [crng.int(Math.round(END * 0.33), Math.round(END * 0.48)), crng.int(Math.round(END * 0.66), Math.round(END * 0.82))];
  const pendingStages: { culture: number; year: number; label: "middle" | "modern" }[] = [];
  cultures.forEach((cx) => {
    const [a, b] = stageYears(rng.fork(`stages${cx.c.id}`));
    pendingStages.push({ culture: cx.c.id, year: a, label: "middle" }, { culture: cx.c.id, year: b, label: "modern" });
  });

  // Culture splits.
  const tmpCells = new Int32Array(n).fill(-1);
  const habList: number[] = [];
  for (let i = 0; i < n; i++) if (habitable[i]) habList.push(i);
  const nSplits = Math.max(3, Math.min(8, Math.round(K * 0.55)));
  const splitYears = Array.from({ length: nSplits }, (_, i) => Math.round(END * (0.15 + (0.7 * (i + rng.next())) / nSplits))).sort((a, b) => a - b);
  for (const [si, Y] of splitYears.entries()) {
    const srng = rng.fork(`split${si}`);
    cultureField.evalAll(Y, tmpCells);
    const area = new Float64Array(cultures.length);
    for (let c = 0; c < n; c++) if (tmpCells[c] >= 0) area[tmpCells[c]]++;
    const pi = srng.weightedIndex(Array.from(area, (a) => (a > 220 ? a : 0)));
    if (area[pi] <= 220) continue;
    const parent = cultures[pi];
    let far = -1, farCost = -1;
    for (let c = 0; c < n; c++) {
      if (tmpCells[c] !== pi) continue;
      const k = cultureField.costOf(parent.source, c);
      if (k > farCost && srng.next() < 0.7) { farCost = k; far = c; }
    }
    if (far < 0) continue;
    const parentLang = langAt(parent, Y);
    const dl = L.deriveLanguage(parentLang.lang, srng.fork("lang"), Y, { avoidNames: usedLangNames });
    usedLangNames.push(dl.name);
    const lid = addLanguage(dl, dl.name, Y, cultures.length, parentLang.hid, "split");
    const cx = newCulture(far, Y, pi, dl, lid, srng);
    const [cells, cost] = spread(far, 2400, 1.5 + 3 * (1 - cx.c.values.seafaring));
    cx.source = cultureField.sources.length;
    cultureField.add({ id: cx.c.id, start: Y, end: -1, speed: 2.2, reach: srng.range(1100, 1700), weight: 1.7, decline: 0, initial: 320 }, cells, cost);
    ev({ year: Y, type: "cultureSplit", importance: 4, cell: far, cultures: [pi, cx.c.id], languages: [parentLang.hid, lid] });
    ev({ year: Y, type: "languageSplit", importance: 3, cell: far, cultures: [cx.c.id], languages: [parentLang.hid, lid] });
    if (Y < END * 0.6) pendingStages.push({ culture: cx.c.id, year: Math.min(END - 50, Y + srng.int(700, 1000)), label: "modern" });
  }
  pendingStages.sort((a, b) => a.year - b.year || a.culture - b.culture);
  for (const st of pendingStages) {
    const cx = cultures[st.culture];
    if (st.year >= END) continue;
    const cur = cx.langs[cx.langs.length - 1];
    const base = protos[st.culture]?.name ?? cur.lang.name;
    const isFounding = st.culture < hearths.length;
    const name = isFounding ? (st.label === "middle" ? L.stageLabel(base, "middle") : base) : st.label === "modern" ? `Later ${cur.lang.name}` : cur.lang.name;
    const dl = L.deriveLanguage(cur.lang, rng.fork(`stage${st.culture}-${st.year}`), st.year, { name, minChanges: 2, maxChanges: 4, replacement: 0.03 });
    const lid = addLanguage(dl, name, st.year, st.culture, cur.hid, "stage");
    cx.langs.push({ year: st.year, lang: dl, hid: lid });
    cx.c.languages.push({ year: st.year, lang: lid });
  }
  function langAt(cx: CultureX, y: number): { year: number; lang: LLang; hid: number } {
    let r = cx.langs[0];
    for (const l of cx.langs) if (l.year <= y) r = l;
    return r;
  }

  // ---------------------------------------------------------------- tech & scripts
  progress("letters", 0.2);
  cultures.forEach((cx) => {
    const trng = rng.fork(`tech${cx.c.id}`);
    let lvl = cx.c.parent >= 0 ? Math.floor(techLevelGuess(cx.c.born)) : 0;
    let y = cx.c.born;
    cx.c.tech = [{ year: y, level: lvl }];
    while (lvl < 6) {
      y += trng.int(Math.round(END * 0.1), Math.round(END * 0.2));
      if (y >= END) break;
      lvl++;
      cx.c.tech.push({ year: y, level: lvl });
    }
  });
  function techLevelGuess(y: number): number {
    return Math.min(6, (y / END) * 6.5);
  }
  const scripts: H.Script[] = [];
  const scriptObj: SScript[] = [];
  const firstSettlementOf = new Map<number, number>();
  const addScript = (s: SScript, name: string, kind: H.ScriptKind, parent: number, year: number, culture: number, how: H.Script["how"]): number => {
    const id = scripts.length;
    scripts.push({ id, name, kind, parent, children: [], born: year, culture, how, origin: -1, data: s });
    scriptObj.push(s);
    if (parent >= 0) scripts[parent].children.push(id);
    return id;
  };
  {
    const order = cultures.slice(0, hearths.length).map((c) => c.c.id);
    const inventors = rng.fork("inventors").sample(order, Math.min(2, order.length));
    const literateAt = new Map<number, { year: number; script: number }>();
    for (const [k, ci] of inventors.entries()) {
      const cx = cultures[ci];
      const Y = rng.fork(`inv${k}`).int(Math.round(END * 0.26), Math.round(END * 0.42));
      const la = langAt(cx, Y);
      const s = createScript(L.inventory(la.lang), rng.fork(`script${k}`), { id: `S${k}`, bornYear: Y });
      const sid = addScript(s, `${cx.c.adjective} script`, s.kind as H.ScriptKind, -1, Y, ci, "invented");
      literateAt.set(ci, { year: Y, script: sid });
      cx.c.scripts.push({ year: Y, script: sid });
      ev({ year: Y, type: "scriptInvented", importance: 4, cell: cx.c.homeCell, cultures: [ci], scripts: [sid], languages: [la.hid] });
      // A later reformed hand.
      const Y2 = Y + rng.fork(`ref${k}`).int(Math.round(END * 0.2), Math.round(END * 0.3));
      if (Y2 < END - 100) {
        const la2 = langAt(cx, Y2);
        const s2 = deriveScript(s, rng.fork(`script${k}b`), { id: `S${k}b`, bornYear: Y2, inventory: L.inventory(la2.lang) });
        const sid2 = addScript(s2, `Later ${cx.c.adjective} script`, s2.kind as H.ScriptKind, sid, Y2, ci, "derived");
        cx.c.scripts.push({ year: Y2, script: sid2 });
      }
    }
    // Borrowing: every other culture adopts from the nearest literate one.
    const others = cultures.filter((c) => !literateAt.has(c.c.id));
    for (const cx of others) {
      const brng = rng.fork(`borrow${cx.c.id}`);
      let best = -1, bd = Infinity;
      for (const [ci] of literateAt) {
        const d = ang(cultures[ci].c.homeCell, cx.c.homeCell);
        if (d < bd) { bd = d; best = ci; }
      }
      if (best < 0) continue;
      const from = literateAt.get(best)!;
      const Y = Math.max(cx.c.born + 50, from.year + Math.round(150 + bd * 900 * brng.range(0.6, 1.4)));
      if (Y >= END - 30 || brng.chance(0.15)) continue;
      // Adopt the script the donor uses at that time.
      const donor = cultures[best].c.scripts.filter((s) => s.year <= Y && s.script >= 0).pop() ?? from;
      const la = langAt(cx, Y);
      const s = adaptScript(scriptObj[donor.script], L.inventory(la.lang), brng.fork("adapt"), { id: `S${scripts.length}`, bornYear: Y });
      const sid = addScript(s, `${cx.c.adjective} script`, s.kind as H.ScriptKind, donor.script, Y, cx.c.id, "adapted");
      cx.c.scripts.push({ year: Y, script: sid });
      ev({ year: Y, type: "scriptAdopted", importance: 3, cell: cx.c.homeCell, cultures: [cx.c.id, best], scripts: [sid, donor.script] });
    }
    for (const cx of cultures) cx.c.scripts.sort((a, b) => a.year - b.year);
  }

  // ---------------------------------------------------------------- settlements
  progress("settlements", 0.3);
  interface SetX { s: H.Settlement; lname: LName; culture: number; cap: number; r: number; p0: number }
  const sets: SetX[] = [];
  const occupied = new Int32Array(n).fill(-1);
  const blocked = (c: number, y: number): boolean => {
    const chk = (x: number): boolean => {
      const s = occupied[x];
      return s >= 0 && (sets[s].s.ended < 0 || sets[s].s.ended > y);
    };
    if (chk(c)) return true;
    for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
      const j = adj[k];
      if (chk(j)) return true;
      for (let k2 = adjStart[j]; k2 < adjStart[j + 1]; k2++) if (chk(adj[k2])) return true;
    }
    return false;
  };
  const plagues: { year: number; cell: number; severity: number; name: string; radius: number }[] = [];
  {
    const prng = rng.fork("plagues");
    const np = prng.int(3, 5);
    for (let i = 0; i < np; i++) {
      plagues.push({ year: prng.int(Math.round(END * 0.25), END - 40), cell: prng.pick(byScore.slice(0, 400)), severity: prng.range(0.15, 0.45), name: i < 2 ? PLAGUE_NAMES[prng.int(0, PLAGUE_NAMES.length - 1)] : "", radius: prng.range(0.5, 1.4) });
    }
    plagues.sort((a, b) => a.year - b.year);
    // unique names
    const seen = new Set<string>();
    for (const p of plagues) { if (seen.has(p.name)) p.name = ""; if (p.name) seen.add(p.name); }
  }
  const siteFeatures = (c: number, srng: Rng): string[] => {
    const f: string[] = [];
    if (world.riverOrder[c] >= 1) f.push(srng.chance(0.5) ? "ford" : "river");
    if (world.coastDist[c] === 1) f.push(srng.pick(["sea", "bay", "harbour", "shore"]));
    if (world.elevation[c] > 1.0) f.push(srng.pick(["hill", "mountain", "rock"]));
    const b = world.biome[c];
    if (b === Biome.TemperateForest || b === Biome.Taiga) f.push(srng.pick(["oak", "pine", "forest", "birch"]));
    if (b === Biome.Wetland) f.push("marsh");
    if (b === Biome.Steppe || b === Biome.Grassland) f.push(srng.pick(["field", "horse", "grass"]));
    if (world.resources[c] & Resource.Iron) f.push("iron");
    if (world.resources[c] & Resource.Salt) f.push("salt");
    if (world.resources[c] & Resource.Gold) f.push("gold");
    if (srng.chance(0.3)) f.push(srng.pick(["white", "red", "black", "green", "old", "high", "stone", "wolf", "oak", "spring"]));
    return f;
  };
  const techMul = (y: number): number => 1 + 2.2 * Math.pow(y / END, 1.3);
  const popSeries = (sx: SetX, srng: Rng): void => {
    const s = sx.s;
    const start = Math.floor(s.founded / SAMPLE);
    const last = Math.floor(((s.ended >= 0 ? s.ended : END)) / SAMPLE);
    s.popStart = start;
    let p = sx.p0;
    const out: number[] = [];
    for (let i = start; i <= last; i++) {
      const y = i * SAMPLE;
      const K2 = sx.cap * techMul(y);
      p += sx.r * SAMPLE * p * (1 - p / K2) + srng.normal(0, 0.02) * p;
      for (const pl of plagues) {
        if (y - SAMPLE < pl.year && y >= pl.year && ang(s.cell, pl.cell) < pl.radius) {
          p *= 1 - pl.severity * srng.range(0.6, 1.2);
          if (!s.tags.includes("plague")) s.tags.push("plague");
        }
      }
      p = Math.max(30, p);
      out.push(Math.round(p));
    }
    s.pop = out;
  };
  {
    const target = (area: number, y: number): number => area * (0.012 + 0.075 * Math.pow(y / END, 0.75));
    for (let y = 0; y < END; y += 25) {
      cultureField.evalAll(y, tmpCells);
      const owned: number[][] = cultures.map(() => []);
      for (let c = 0; c < n; c++) if (tmpCells[c] >= 0 && cultures[tmpCells[c]]) owned[tmpCells[c]].push(c);
      const aliveCount = new Int32Array(cultures.length);
      for (const sx of sets) if (sx.s.ended < 0 || sx.s.ended > y) {
        const cc = tmpCells[sx.s.cell];
        if (cc >= 0) aliveCount[cc]++;
      }
      for (let ci = 0; ci < cultures.length; ci++) {
        const cx = cultures[ci];
        if (cx.c.born > y || !owned[ci].length) continue;
        const crng = rng.fork(`found${ci}-${y}`);
        let want = Math.min(14, Math.round(target(owned[ci].length, y)) - aliveCount[ci]);
        if (y === 0 || y === cx.c.born) want = Math.max(want, 1);
        for (let t = 0; t < want; t++) {
          let best = -1, bs = -1;
          for (let q = 0; q < 50; q++) {
            const c = owned[ci][crng.int(0, owned[ci].length - 1)];
            const sc = siteScore[c] * crng.range(0.7, 1.3);
            if (sc > bs && !blocked(c, y)) { bs = sc; best = c; }
          }
          // The first city of a people stands at its hearth.
          if (!firstSettlementOf.has(ci) && !blocked(cx.c.homeCell, y)) best = cx.c.homeCell;
          if (best < 0) break;
          const id = sets.length;
          const srng = rng.fork(`set${id}`);
          const founded = firstSettlementOf.has(ci) ? Math.min(END - 1, y + srng.int(0, 24)) : y;
          const la = langAt(cx, founded);
          let mother = -1;
          let md = Infinity;
          for (let k = sets.length - 1, seen = 0; k >= 0 && seen < 60; k--) {
            if (sets[k].culture !== ci) continue;
            seen++;
            const d = ang(sets[k].s.cell, best);
            if (d < md) { md = d; mother = k; }
          }
          const colony = mother >= 0 && md > 0.12 && srng.chance(0.25);
          const lname = L.nameSettlement(la.lang, srng.fork("name"), { features: siteFeatures(best, srng), mother: colony ? sets[mother].lname : undefined, pattern: colony ? "new" : undefined }, { registry: reg });
          const r3 = xyz.subarray(3 * best, 3 * best + 3);
          const jit = mesh.meanSpacing * 0.18;
          const pos: [number, number, number] = norm3(r3[0] + srng.range(-jit, jit), r3[1] + srng.range(-jit, jit), r3[2] + srng.range(-jit, jit));
          const fert = world.fertility[best];
          const cap = (1200 + 9000 * fert * srng.range(0.5, 1.6)) * (world.riverOrder[best] >= 2 ? 1.6 : 1) * (world.coastDist[best] === 1 ? 1.3 : 1) * (id < 30 ? 1.4 : 1);
          const s: H.Settlement = {
            id, cell: best, ruinsOf: -1, occupations: [], pos, names: [{ year: founded, name: wn(lname, la.hid), reason: "founded" }],
            founded, ended: -1, founderCulture: ci, mother, founder: -1, popStart: 0, pop: [],
            cultures: [{ year: founded, culture: ci }], religions: [], owners: [],
            port: world.coastDist[best] === 1 && srng.chance(0.3 + 0.6 * cx.c.values.seafaring),
            walled: -1, wonders: [], tags: [],
          };
          if (srng.chance(0.14) && founded < END - 200) {
            s.ended = srng.int(founded + 120, END - 20);
            s.endReason = srng.pick(["sacked", "abandoned", "disaster", "plague"] as const);
          }
          const sx: SetX = { s, lname, culture: ci, cap, r: srng.range(0.006, 0.016), p0: srng.range(150, 700) };
          popSeries(sx, srng);
          sets.push(sx);
          occupied[best] = id;
          if (!firstSettlementOf.has(ci)) firstSettlementOf.set(ci, id);
          ev({ year: founded, type: colony ? "colonyFounded" : "settlementFounded", importance: id < 20 ? 3 : colony ? 2 : 1, cell: best, settlements: mother >= 0 ? [id, mother] : [id], cultures: [ci] });
          if (s.ended >= 0) ev({ year: s.ended, type: "settlementAbandoned", importance: 2, cell: best, settlements: [id], data: { reason: s.endReason } });
        }
      }
    }
  }
  const popOf = (sx: SetX, y: number): number => {
    const s = sx.s;
    if (y < s.founded || (s.ended >= 0 && y >= s.ended)) return 0;
    const i = Math.floor(y / SAMPLE) - s.popStart;
    return s.pop[Math.max(0, Math.min(s.pop.length - 1, i))] ?? 0;
  };
  for (const sx of sets) {
    const s = sx.s;
    let y = s.founded;
    for (; y < (s.ended >= 0 ? s.ended : END); y += SAMPLE) if (popOf(sx, y) > 6000) break;
    if (y < (s.ended >= 0 ? s.ended : END) && y < END) {
      s.walled = Math.min(END, y + 20);
      ev({ year: s.walled, type: "wallsBuilt", importance: 1, cell: s.cell, settlements: [s.id] });
    }
  }
  // Language stages rename the cities of the people (sound change).
  for (const cx of cultures) {
    for (let li = 1; li < cx.langs.length; li++) {
      const from = cx.langs[li - 1], to = cx.langs[li];
      for (const sx of sets) {
        const s = sx.s;
        if (sx.culture !== cx.c.id || s.founded >= to.year || (s.ended >= 0 && s.ended <= to.year)) continue;
        if (sx.lname.lang !== from.lang.id) continue;
        try {
          const ev2 = L.evolveName(sx.lname, from.lang, to.lang);
          if (ev2.roman !== sx.lname.roman) {
            s.names.push({ year: to.year, name: wn(ev2, to.hid), reason: "evolved" });
            sx.lname = ev2;
          }
        } catch { /* keep */ }
      }
    }
  }

  // ---------------------------------------------------------------- religions
  progress("faiths", 0.4);
  const religions: H.Religion[] = [];
  const deities: H.Deity[] = [];
  const myths: H.Myth[] = [];
  const religionField = new Field(n, habitable);
  const religionNames: LName[] = [];
  const features = world.features;
  const nearestFeature = (cell: number, kind: string): number => {
    let best = -1, bd = Infinity;
    for (const f of features) {
      if (f.kind !== kind) continue;
      const d = ang(f.anchor, cell);
      if (d < bd) { bd = d; best = f.id; }
    }
    return bd < 0.5 ? best : -1;
  };
  cultures.slice(0, hearths.length).forEach((cx) => {
    const r0 = rng.fork(`folk${cx.c.id}`);
    const la = cx.langs[0];
    const id = religions.length;
    const nd = r0.int(4, 7);
    const domains = r0.sample(DOMAINS.filter((d) => d !== "sea" || world.coastDist[cx.c.homeCell] <= 2), nd);
    const dIds: number[] = [];
    for (const [k, dom] of domains.entries()) {
      const sex: H.Sex = k === 1 ? "f" : r0.chance(0.45) ? "f" : "m";
      const dn = L.nameDeity(la.lang, r0.fork(`deity${k}`), { domain: DOMAIN_CONCEPT[dom] ?? dom, gender: sex, registry: reg });
      const did = deities.length;
      deities.push({
        id: did, name: wn(dn, la.hid), religion: id, domains: [dom], sex,
        epithets: r0.sample(DOMAIN_EPITHET[dom] ?? ["the Old One"], 1),
        symbol: DOMAIN_SYMBOL[dom] ?? r0.pick(EMBLEM_CONCEPTS as unknown as EmblemConcept[]),
        feature: dom === "river" ? nearestFeature(cx.c.homeCell, "river") : dom === "mountain" ? nearestFeature(cx.c.homeCell, "mountains") : -1,
        parents: [], consort: -1, children: [],
      });
      dIds.push(did);
    }
    if (dIds.length >= 2) {
      deities[dIds[0]].consort = dIds[1];
      deities[dIds[1]].consort = dIds[0];
      for (const c of dIds.slice(2)) {
        deities[c].parents = [dIds[0], dIds[1]];
        deities[dIds[0]].children.push(c);
        deities[dIds[1]].children.push(c);
      }
    }
    const rn = L.nameReligion(la.lang, r0.fork("name"), { deity: undefined, registry: reg });
    religionNames.push(rn);
    religions.push({
      id, name: wn(rn, la.hid), english: `the ${cx.c.adjective} gods`, kind: r0.pick(["pantheon", "folk", "pantheon", "ancestor"] as const),
      parent: -1, children: [], founded: 0, ended: -1, founder: -1, holyCity: firstSettlementOf.get(cx.c.id) ?? -1, culture: cx.c.id,
      deities: dIds, tenets: r0.sample(TENETS_FOLK, 2), symbol: deities[dIds[0]]?.symbol ?? "sun", color: hsl((id * 97.3 + 40) % 360, 0.38, 0.58),
      scripture: -1,
    });
    cx.folk = id;
    myths.push({ id: myths.length, religion: id, kind: "creation", actors: dIds.slice(0, 2), features: [], data: {} });
    if (r0.chance(0.5)) myths.push({ id: myths.length, religion: id, kind: "flood", actors: dIds.slice(0, 1), features: [nearestFeature(cx.c.homeCell, "river")].filter((x) => x >= 0), data: {} });
    myths.push({ id: myths.length, religion: id, kind: "originOfPeople", actors: dIds.slice(0, 1), features: [], data: { culture: cx.c.id } });
    const [cells, cost] = spread(cx.c.homeCell, 4600, 1.2 + 3.5 * (1 - cx.c.values.seafaring));
    const src = cultureField.sources[cx.source];
    religionField.add({ id, start: 0, end: -1, speed: src.speed, reach: src.reach, weight: src.weight, decline: 0, initial: src.initial }, cells, cost);
  });
  for (const cx of cultures) if (cx.folk < 0) cx.folk = cultures[cx.c.parent]?.folk ?? 0;
  for (const cx of cultures) cx.c.folkReligion = cx.folk;

  // ---------------------------------------------------------------- persons helpers
  const persons: H.Person[] = [];
  const personLName: LName[] = [];
  const newPerson = (cx: CultureX, y: number, sex: H.Sex, prng: Rng, o: { father?: number; born?: number; died?: number; epithet?: boolean } = {}): number => {
    const la = langAt(cx, y);
    const fatherName = o.father !== undefined && o.father >= 0 ? personLName[o.father] : undefined;
    const ln = L.namePerson(la.lang, prng.fork("n"), { gender: sex, father: fatherName });
    const traits = prng.sample(TRAITS, 2);
    const id = persons.length;
    persons.push({
      id, name: wn(ln, la.hid), sex, born: o.born ?? y - prng.int(18, 40), died: o.died ?? -1, deathCause: "natural", deathPlace: -1,
      father: o.father ?? -1, mother: -1, spouses: [], children: [], dynasty: -1, culture: cx.c.id, religion: cx.folk,
      traits, epithet: "", regnal: 0, roles: [], deeds: [],
    });
    personLName.push(ln);
    if (o.father !== undefined && o.father >= 0) persons[o.father].children.push(id);
    return id;
  };

  // Organised religions (after cities and letters).
  {
    const orng = rng.fork("orgfaiths");
    const nOrg = orng.int(2, 3);
    for (let k = 0; k < nOrg; k++) {
      const Y = orng.int(Math.round(END * 0.32), Math.round(END * 0.72));
      const candidates = sets.filter((sx) => popOf(sx, Y) > 0).sort((a, b) => popOf(b, Y) - popOf(a, Y)).slice(0, 25);
      if (!candidates.length) continue;
      const holy = orng.pick(candidates);
      const cx = cultures[holy.culture];
      const la = langAt(cx, Y);
      const prophet = newPerson(cx, Y - 30, "m", orng.fork(`prophet${k}`), { born: Y - orng.int(30, 50), died: Y + orng.int(5, 30) });
      persons[prophet].roles.push({ kind: "prophet", polity: -1, religion: religions.length, from: Y - 5, to: persons[prophet].died });
      persons[prophet].deathCause = orng.pick(["natural", "executed", "natural", "assassinated"] as const);
      const rn = L.nameReligion(la.lang, orng.fork(`rn${k}`), { founder: personLName[prophet], registry: reg });
      const id = religions.length;
      const kind = orng.pick(["monotheism", "dualism", "philosophy", "mystery", "monotheism"] as const);
      const dIds: number[] = [];
      if (kind === "monotheism" || kind === "dualism") {
        for (let d = 0; d < (kind === "dualism" ? 2 : 1); d++) {
          const dom: H.DeityDomain = d === 0 ? orng.pick(["sky", "sun", "fire", "creation"] as const) : "night";
          const dn = L.nameDeity(la.lang, orng.fork(`god${k}-${d}`), { domain: dom === "creation" ? "sky" : dom, registry: reg });
          dIds.push(deities.length);
          deities.push({ id: deities.length, name: wn(dn, la.hid), religion: id, domains: [dom], sex: "none", epithets: [d === 0 ? "the One" : "the Adversary"], symbol: DOMAIN_SYMBOL[dom] ?? "sun", feature: -1, parents: [], consort: -1, children: [] });
        }
      }
      const english = rn.gloss ? titleCaseFirst(rn.gloss) : `${rn.roman}ism`;
      religions.push({
        id, name: wn(rn, la.hid), english, kind, parent: -1, children: [], founded: Y, ended: -1, founder: prophet, holyCity: holy.s.id,
        culture: cx.c.id, deities: dIds, tenets: orng.sample(TENETS_ORG, 3), symbol: orng.pick(["sun", "star", "flame", "eye", "key", "hand", "wheel"] as const),
        clergy: undefined, scripture: -1, color: hsl((id * 97.3 + 40) % 360, 0.45, 0.55),
      });
      holy.s.tags.push("holy city");
      const [cells, cost] = spread(holy.s.cell, 6000, 2.5);
      religionField.add({ id, start: Y, end: -1, speed: orng.range(4, 8), reach: orng.range(2600, 5200), weight: 1.45, decline: 0, initial: 100 }, cells, cost);
      ev({ year: Y, type: "religionFounded", importance: 5, cell: holy.s.cell, religions: [id], persons: [prophet], settlements: [holy.s.id], cultures: [cx.c.id] });
      ev({ year: persons[prophet].born, type: "prophetBorn", importance: 2, cell: holy.s.cell, persons: [prophet], religions: [id] });
      // A schism a few centuries later.
      const Ys = Y + orng.int(Math.round(END * 0.1), Math.round(END * 0.2));
      if (Ys < END - 60 && orng.chance(0.7)) {
        const far = sets.filter((sx) => popOf(sx, Ys) > 0 && religionField.cellAt(sx.s.cell, Ys) === religionField.sources.length - 1).sort((a, b) => ang(b.s.cell, holy.s.cell) - ang(a.s.cell, holy.s.cell))[0];
        if (far) {
          const cy = cultures[far.culture];
          const lb = langAt(cy, Ys);
          const sn = L.nameReligion(lb.lang, orng.fork(`schism${k}`), { registry: reg });
          const sid = religions.length;
          religions.push({
            id: sid, name: wn(sn, lb.hid), english: sn.gloss ? titleCaseFirst(sn.gloss) : `${sn.roman}ism`, kind, parent: id, children: [], founded: Ys, ended: -1,
            founder: -1, holyCity: far.s.id, culture: cy.c.id, deities: dIds.slice(), tenets: orng.sample(TENETS_ORG, 3), symbol: orng.pick(["sun", "star", "flame", "eye", "key", "hand", "wheel"] as const),
            scripture: -1, color: hsl((sid * 97.3 + 40) % 360, 0.45, 0.55),
          });
          religions[id].children.push(sid);
          const [c2, k2] = spread(far.s.cell, 3000, 3);
          religionField.add({ id: sid, start: Ys, end: -1, speed: 6, reach: orng.range(1500, 2600), weight: 1.75, decline: 0, initial: 200 }, c2, k2);
          ev({ year: Ys, type: "schism", importance: 4, cell: far.s.cell, religions: [id, sid], settlements: [far.s.id] });
        }
      }
    }
  }

  // ---------------------------------------------------------------- polities
  progress("realms", 0.5);
  interface PolX { p: H.Polity; cx: CultureX; src: Source; lname: LName; succDone: boolean }
  const pols: PolX[] = [];
  const polityField = new Field(n, habitable);
  const govFor = (cx: CultureX, y: number, reach: number, prng: Rng): H.Government => {
    const t = y / END;
    if (cx.c.archetype === "steppe" && prng.chance(0.7)) return "horde";
    if (t < 0.12) return prng.chance(0.6) ? "tribe" : "chiefdom";
    if (t < 0.22) return prng.chance(0.6) ? "chiefdom" : "kingdom";
    if (reach > 1500) return "empire";
    if (cx.c.values.mercantile > 0.6 && prng.chance(0.4)) return prng.chance(0.5) ? "cityState" : "republic";
    if (cx.c.values.piety > 0.75 && prng.chance(0.25)) return "theocracy";
    return prng.weighted<H.Government>([["kingdom", 6], ["principality", 1.5], ["confederation", 0.8], ["republic", t > 0.6 ? 1 : 0.2]]);
  };
  const foundPolity = (sx: SetX, y: number, predecessor: number): PolX => {
    const id = pols.length;
    const prng = rng.fork(`polity${id}`);
    const cx = cultures[tmpCultureAt(sx.s.cell, y)] ?? cultures[sx.culture];
    const la = langAt(cx, y);
    const t = y / END;
    let reach = (260 + 1500 * Math.pow(t, 0.8)) * prng.range(0.55, 1.4);
    const great = prng.chance(0.09 + 0.05 * cx.c.values.expansion);
    if (great) reach *= 2.3;
    const life = Math.round(prng.range(140, 520) * (great ? 1.4 : 1) * (t < 0.15 ? 0.6 : 1));
    const end = y + life >= END ? -1 : y + life;
    const src: Source = { id, start: y, end, speed: prng.range(9, 22), reach, weight: prng.range(0.8, 1.5) * (great ? 1.25 : 1), decline: Math.round(life * 0.18), initial: 60 };
    const founder = newPerson(cx, y, "m", prng.fork("founder"), {});
    const ln = L.nameRealm(la.lang, prng.fork("name"), { people: prng.chance(0.5) ? cx.peopleName : undefined, capital: sx.lname, founder: personLName[founder], registry: reg });
    const gov = govFor(cx, y, reach, prng);
    const arms = generateArms(prng.fork("arms"), { style: ARCH_HERALDRY[cx.c.archetype], motifs: cantingCharges((ln.gloss || "").toLowerCase().split(/[\s-]+/)) });
    const sent = L.motto(la.lang, prng.fork("motto"));
    const p: H.Polity = {
      id, names: [{ year: y, name: wn(ln, la.hid), reason: "founded" }], governments: [{ year: y, gov }],
      succession: [{ year: y, law: gov === "republic" || gov === "cityState" ? "election" : gov === "theocracy" ? "appointment" : gov === "horde" ? "tanistry" : prng.pick(["primogeniture", "seniority", "elective"] as const) }],
      peak: { areaKm2: 0, year: y }, founded: y, ended: end,
      endReason: end >= 0 ? prng.pick(["conquered", "collapsed", "dissolved", "absorbed"] as const) : undefined,
      founder, predecessors: predecessor >= 0 ? [predecessor] : [], successors: [], capitals: [{ year: y, settlement: sx.s.id }],
      culture: cx.c.id, cultures: [{ year: y, culture: cx.c.id }], religions: [], rulers: [], overlords: [{ year: y, overlord: -1 }],
      emblem: { kind: "arms", data: arms, blazon: blazon(arms) },
      motto: { lang: la.hid, text: sent.text, gloss: sent.gloss, translation: sent.translation, words: sent.words },
      color: hsl(prng.range(0, 360), prng.range(0.32, 0.5), prng.range(0.52, 0.66)),
      wars: [], statStart: Math.floor(y / SAMPLE), stats: { pop: [], areaKm2: [], settlements: [], strength: [] },
    };
    if (gov === "tribe" || gov === "chiefdom") {
      const later = y + prng.int(80, 220);
      if (later < (end < 0 ? END : end) && later > END * 0.12) p.governments.push({ year: later, gov: reach > 1500 ? "empire" : "kingdom" });
    } else if (gov === "kingdom" && great) {
      const later = y + prng.int(60, 180);
      if (later < (end < 0 ? END : end)) p.governments.push({ year: later, gov: "empire" });
    }
    const [cells, cost] = spread(sx.s.cell, reach, 5);
    polityField.add(src, cells, cost);
    const px: PolX = { p, cx, src, lname: ln, succDone: false };
    pols.push(px);
    persons[founder].roles.push({ kind: "founder", polity: id, religion: -1, from: y, to: y });
    ev({ year: y, type: "polityFounded", importance: great ? 4 : 3, cell: sx.s.cell, polities: [id], settlements: [sx.s.id], persons: [founder], cultures: [cx.c.id] });
    for (const g of p.governments.slice(1)) ev({ year: g.year, type: "governmentChanged", importance: g.gov === "empire" ? 4 : 2, cell: sx.s.cell, polities: [id], data: { gov: g.gov } });
    if (end >= 0) ev({ year: end, type: p.endReason === "conquered" ? "polityAnnexed" : "polityCollapsed", importance: great ? 4 : 3, cell: sx.s.cell, polities: [id] });
    if (predecessor >= 0) pols[predecessor].p.successors.push(id);
    return px;
  };
  const cultureCache = new Map<number, Int32Array>();
  function tmpCultureAt(cell: number, y: number): number {
    const yy = Math.floor(y / 25) * 25;
    let arr = cultureCache.get(yy);
    if (!arr) {
      arr = cultureField.evalAll(yy, new Int32Array(n).fill(-1));
      cultureCache.set(yy, arr);
    }
    return arr[cell];
  }
  for (let y = Math.round(END * 0.04); y < END - 25; y += 25) {
    // Successor states of realms that fell.
    for (const px of pols) {
      if (px.succDone || px.p.ended < 0 || px.p.ended > y) continue;
      px.succDone = true;
      const E = px.p.ended;
      const srng = rng.fork(`succ${px.p.id}`);
      if (!srng.chance(0.7)) continue;
      const own = sets.filter((sx) => popOf(sx, E - 1) > 0 && polityField.cellAt(sx.s.cell, E - 1) === px.p.id && polityField.cellAt(sx.s.cell, E) < 0)
        .sort((a, b) => popOf(b, E) - popOf(a, E));
      const nS = Math.min(own.length, srng.int(1, 2));
      for (let k = 0; k < nS; k++) {
        if (k > 0 && ang(own[k].s.cell, own[0].s.cell) < 0.08) continue;
        foundPolity(own[k], E, px.p.id);
      }
    }
    const t = y / END;
    const prob = 0.08 + 0.35 * Math.min(1, t * 2);
    for (const cx of cultures) {
      if (cx.c.born > y) continue;
      const crng = rng.fork(`rise${cx.c.id}-${y}`);
      const top = sets.filter((sx) => sx.culture === cx.c.id && popOf(sx, y) > 900).sort((a, b) => popOf(b, y) - popOf(a, y)).slice(0, 4);
      for (const sx of top) {
        if (polityField.cellAt(sx.s.cell, y) >= 0) continue;
        if (!crng.chance(prob)) continue;
        foundPolity(sx, y + crng.int(0, 20), -1);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- timeline
  progress("timeline", 0.62);
  const mkLayer = (): H.LayerTimeline => ({ keyframes: [], diffCells: [], diffValues: [] });
  const tl: H.Timeline = { step: STEP, keyEvery: KEY_EVERY, snapshots, owner: mkLayer(), culture: mkLayer(), religion: mkLayer() };
  const cur = { owner: new Int32Array(n).fill(-1), culture: new Int32Array(n).fill(-1), religion: new Int32Array(n).fill(-1) };
  const habArr = Int32Array.from(habList);
  const prev = { owner: new Int32Array(n).fill(-1), culture: new Int32Array(n).fill(-1), religion: new Int32Array(n).fill(-1) };
  const pairs = new Map<number, { years: number[]; cells: number[][] }>();
  const nP = pols.length;
  const areaAcc = new Float64Array(nP);
  const setAcc = new Int32Array(nP);
  const popAcc = new Float64Array(nP);
  const relCount = new Map<number, Map<number, number>>();
  const worldStats: H.History["worldStats"] = { pop: [], settlements: [], polities: [], wars: [], climate: [], tech: [] };
  for (let s = 0; s < snapshots; s++) {
    const y = s * STEP;
    polityField.evalAll(y, cur.owner);
    // Peoples and faiths move slowly: re-evaluate every 25 years.
    if (s % 5 === 0) {
      cultureField.evalAll(y, cur.culture);
      religionField.evalAll(y, cur.religion);
    }
    for (const key of ["owner", "culture", "religion"] as const) {
      const layer = tl[key];
      const a = cur[key], b = prev[key];
      if (s % KEY_EVERY === 0) layer.keyframes.push(a.slice());
      const dc: number[] = [], dv: number[] = [];
      if (key === "owner" || s % 5 === 0) {
        for (let h = 0; h < habArr.length; h++) {
          const c = habArr[h];
          if (a[c] !== b[c]) { dc.push(c); dv.push(a[c]); b[c] = a[c]; }
        }
      }
      layer.diffCells.push(Int32Array.from(dc));
      layer.diffValues.push(Int32Array.from(dv));
    }
    // Settlement owners / cultures / religions.
    for (const sx of sets) {
      const st = sx.s;
      if (y < st.founded || (st.ended >= 0 && y >= st.ended)) continue;
      const o = cur.owner[st.cell];
      if (!st.owners.length || st.owners[st.owners.length - 1].polity !== o) st.owners.push({ year: Math.max(y, st.founded), polity: o });
      const rl = cur.religion[st.cell];
      if (!st.religions.length || st.religions[st.religions.length - 1].religion !== rl) st.religions.push({ year: Math.max(y, st.founded), religion: rl });
      if (s % 5 === 0) {
        const cc = cur.culture[st.cell];
        if (cc >= 0 && st.cultures[st.cultures.length - 1].culture !== cc && y > st.founded) st.cultures.push({ year: y, culture: cc });
      }
    }
    // Stats every SAMPLE years.
    if (y % SAMPLE === 0) {
      areaAcc.fill(0);
      setAcc.fill(0);
      popAcc.fill(0);
      for (let h = 0; h < habArr.length; h++) { const c = habArr[h]; if (cur.owner[c] >= 0) areaAcc[cur.owner[c]] += cellKm2(c); }
      for (const sx of sets) {
        const o = cur.owner[sx.s.cell];
        if (o < 0) continue;
        const pp = popOf(sx, y);
        if (pp <= 0) continue;
        setAcc[o]++;
        popAcc[o] += pp;
      }
      let wPop = 0, wSet = 0, wPol = 0;
      for (const sx of sets) { const pp = popOf(sx, y); if (pp > 0) { wPop += pp; wSet++; } }
      for (const px of pols) {
        const p = px.p;
        if (y < p.founded || (p.ended >= 0 && y > p.ended)) continue;
        wPol++;
        const rural = areaAcc[p.id] * 2.5 * techMul(y);
        wPop += rural;
        if (areaAcc[p.id] > p.peak.areaKm2) p.peak = { areaKm2: Math.round(areaAcc[p.id]), year: y };
        p.stats.pop.push(Math.round(popAcc[p.id] + rural));
        p.stats.areaKm2.push(Math.round(areaAcc[p.id]));
        p.stats.settlements.push(setAcc[p.id]);
        p.stats.strength.push(Math.round((popAcc[p.id] + rural) * (0.5 + techLevelGuess(y) / 6) / 100));
      }
      worldStats.pop.push(Math.round(wPop));
      worldStats.settlements.push(wSet);
      worldStats.polities.push(wPol);
      worldStats.climate.push(+(0.6 * Math.sin(y / 170 + 1.3) + 0.3 * Math.sin(y / 61)).toFixed(2));
      worldStats.tech.push(+Math.min(6, techLevelGuess(y)).toFixed(2));
    }
    // Borders between realms (for wars) every 25 years.
    if (y % 25 === 0) {
      const seen = new Map<number, number>();
      for (let c = 0; c < n; c++) {
        const a = cur.owner[c];
        if (a < 0) continue;
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const b = cur.owner[adj[k]];
          if (b < 0 || b <= a) continue;
          const key = a * 100000 + b;
          let rec = pairs.get(key);
          if (!rec) { rec = { years: [], cells: [] }; pairs.set(key, rec); }
          if (rec.years[rec.years.length - 1] !== y) { rec.years.push(y); rec.cells.push([]); }
          const cs = rec.cells[rec.cells.length - 1];
          const cnt = (seen.get(key) ?? 0) + 1;
          seen.set(key, cnt);
          if (cs.length < 8) cs.push(c);
          else if ((c * 2654435761) % cnt < 8) cs[(c >>> 3) % 8] = c;
        }
      }
      // Polity religion = majority religion of its land.
      relCount.clear();
      for (let c = 0; c < n; c++) {
        const o = cur.owner[c], r = cur.religion[c];
        if (o < 0 || r < 0) continue;
        let m = relCount.get(o);
        if (!m) { m = new Map(); relCount.set(o, m); }
        m.set(r, (m.get(r) ?? 0) + 1);
      }
      for (const [o, m] of relCount) {
        let best = -1, bc = -1;
        for (const [r, c] of m) if (c > bc) { bc = c; best = r; }
        const p = pols[o].p;
        if (!p.religions.length || p.religions[p.religions.length - 1].religion !== best) {
          p.religions.push({ year: Math.max(y, p.founded), religion: best });
          if (p.religions.length > 1 && religions[best]?.kind !== "folk" && religions[best]?.kind !== "pantheon") {
            ev({ year: y, type: "stateReligion", importance: 3, cell: setsCell(p.capitals[0].settlement), polities: [o], religions: [best] });
          }
        }
      }
    }
    if (s % 40 === 0) progress("timeline", 0.62 + 0.18 * (s / snapshots));
  }
  function setsCell(id: number): number {
    return sets[id]?.s.cell ?? -1;
  }
  for (const sx of sets) {
    const s = sx.s;
    if (!s.owners.length) s.owners.push({ year: s.founded, polity: -1 });
    if (!s.religions.length) s.religions.push({ year: s.founded, religion: -1 });
    // Owner changes become conquests or renamings.
    for (let i = 1; i < s.owners.length; i++) {
      const a = s.owners[i - 1].polity, b = s.owners[i].polity;
      if (a >= 0 && b >= 0 && popOf(sx, s.owners[i].year) > 3000) ev({ year: s.owners[i].year, type: "conquest", importance: 2, cell: s.cell, settlements: [s.id], polities: [b, a] });
    }
    for (let i = 1; i < s.cultures.length; i++) {
      const cto = cultures[s.cultures[i].culture];
      const y = s.cultures[i].year;
      if (!cto) continue;
      const la = langAt(cto, y);
      if (sx.lname.lang === la.lang.id) continue;
      try {
        const bn = L.borrowName(sx.lname, la.lang);
        s.names.push({ year: y, name: wn(bn, la.hid), reason: "borrowed" });
        sx.lname = bn;
        ev({ year: y, type: "settlementRenamed", importance: 1, cell: s.cell, settlements: [s.id], cultures: [cto.c.id] });
      } catch { /* keep */ }
    }
    s.names.sort((a, b) => a.year - b.year);
  }

  // ---------------------------------------------------------------- rulers & dynasties
  progress("dynasties", 0.82);
  const dynasties: H.Dynasty[] = [];
  const newDynasty = (founder: number, polity: number, seat: number, y: number, parent: number, drng: Rng): number => {
    const id = dynasties.length;
    const px = pols[polity];
    const la = langAt(px.cx, y);
    const dn = L.nameDynasty(la.lang, drng.fork("name"), { founder: personLName[founder], seat: sets[seat]?.lname, registry: reg });
    const arms = generateArms(drng.fork("arms"), { style: ARCH_HERALDRY[px.cx.c.archetype], motifs: cantingCharges((dn.gloss || "").toLowerCase().split(/[\s-]+/)) });
    const m = L.motto(la.lang, drng.fork("motto"));
    dynasties.push({
      id, name: wn(dn, la.hid), founder, seat, parent, culture: px.cx.c.id,
      emblem: { kind: "arms", data: arms, blazon: blazon(arms) },
      motto: { lang: la.hid, text: m.text, gloss: m.gloss, translation: m.translation, words: m.words },
      founded: y, extinct: -1, polities: [polity],
    });
    ev({ year: y, type: "dynastyFounded", importance: 3, cell: setsCell(seat), dynasties: [id], persons: [founder], polities: [polity] });
    return id;
  };
  for (const px of pols) {
    const p = px.p;
    const prng = rng.fork(`rulers${p.id}`);
    const endY = p.ended >= 0 ? p.ended : END;
    let y = p.founded;
    let prevRuler = -1;
    let dyn = -1;
    const nameCount = new Map<string, number>();
    for (const pre of p.predecessors) for (const r of pols[pre].p.rulers) {
      const g = persons[r.person].name.roman.split(" ")[0];
      nameCount.set(g, Math.max(nameCount.get(g) ?? 0, persons[r.person].regnal));
    }
    let first = true;
    while (y < endY) {
      const reign = Math.max(1, Math.round(Math.min(48, -Math.log(1 - prng.next() * 0.98) * 17)));
      const to = Math.min(endY, y + reign);
      const sameDyn = !first && prng.chance(0.9) && prevRuler >= 0;
      const sex: H.Sex = prng.chance(0.12) ? "f" : "m";
      let ruler: number;
      if (first) {
        ruler = p.founder;
        persons[ruler].born = y - prng.int(25, 45);
      } else ruler = newPerson(px.cx, y, sex, prng.fork(`r${y}`), { father: sameDyn ? prevRuler : undefined, born: y - prng.int(16, 45) });
      const P = persons[ruler];
      const capital = p.capitals[0].settlement;
      if (!sameDyn) {
        dyn = newDynasty(ruler, p.id, capital, y, -1, prng.fork(`dyn${y}`));
        if (!first) ev({ year: y, type: "usurpation", importance: 3, cell: setsCell(capital), persons: [ruler, prevRuler].filter((x) => x >= 0), polities: [p.id], dynasties: [dyn] });
      } else if (!dynasties[dyn].polities.includes(p.id)) dynasties[dyn].polities.push(p.id);
      P.dynasty = dyn;
      const given = P.name.roman.split(" ")[0];
      const num = (nameCount.get(given) ?? 0) + 1;
      nameCount.set(given, num);
      P.regnal = num;
      P.roles.push({ kind: "ruler", polity: p.id, religion: -1, from: y, to });
      p.rulers.push({ person: ruler, from: y, to });
      const diesInOffice = to < endY || p.ended >= 0;
      if (to < END && diesInOffice) {
        P.died = to;
        P.deathCause = prng.weighted<H.DeathCause>([["natural", 5], ["illness", 2], ["battle", 1], ["assassinated", 0.8], ["plague", 0.5], ["accident", 0.4], ["executed", 0.2]]);
        P.deathPlace = capital;
        ev({ year: to, type: P.deathCause === "assassinated" ? "assassination" : "death", importance: P.deathCause === "assassinated" ? 3 : 2, cell: setsCell(capital), persons: [ruler], polities: [p.id] });
      } else if (to >= END) P.died = -1;
      else P.died = to + prng.int(1, 20);
      const ep = P.traits.map((t) => EPITHET_OF[t]).find((x) => x && prng.chance(0.35));
      if (ep) P.epithet = prng.pick(ep);
      else if (reign >= 40 && prng.chance(0.5)) P.epithet = "the Old";
      else if (reign <= 1 && prng.chance(0.5)) P.epithet = "the Brief";
      if (sex === "m" && prng.chance(0.55)) {
        const consort = newPerson(px.cx, y, "f", prng.fork(`c${y}`), { born: P.born + prng.int(-5, 10) });
        persons[consort].died = P.died >= 0 ? P.died + prng.int(-10, 15) : -1;
        persons[consort].spouses.push(ruler);
        P.spouses.push(consort);
        persons[consort].roles.push({ kind: "consort", polity: p.id, religion: -1, from: y, to });
        persons[consort].dynasty = -1;
        ev({ year: y + prng.int(0, 3), type: "marriage", importance: 1, cell: setsCell(capital), persons: [ruler, consort], polities: [p.id] });
      }
      ev({ year: y, type: "accession", importance: first ? 2 : 2, cell: setsCell(capital), persons: [ruler], polities: [p.id], dynasties: [dyn] });
      P.deeds.push(events.length - 1);
      prevRuler = ruler;
      first = false;
      y = to;
    }
    if (dyn >= 0 && p.ended >= 0 && prng.chance(0.6)) dynasties[dyn].extinct = p.ended;
  }

  // ---------------------------------------------------------------- wars
  progress("wars", 0.88);
  const wars: H.War[] = [];
  const battles: H.Battle[] = [];
  const pairKeys = [...pairs.keys()].sort((a, b) => a - b);
  for (const key of pairKeys) {
    const rec = pairs.get(key)!;
    const a = Math.floor(key / 100000), b = key % 100000;
    const wrng = rng.fork(`war${key}`);
    const expect = rec.years.length * 25 / 220;
    let nw = 0;
    for (let i = 0; i < 4; i++) if (wrng.next() < expect / (i + 1)) nw++;
    let lastEnd = -1;
    for (let w = 0; w < nw; w++) {
      const yi = wrng.int(0, rec.years.length - 1);
      const start = rec.years[yi] + wrng.int(0, 24);
      if (start <= lastEnd + 5) continue;
      const pa = pols[a].p, pb = pols[b].p;
      const lim = Math.min(pa.ended < 0 ? END : pa.ended, pb.ended < 0 ? END : pb.ended, END);
      if (start >= lim) continue;
      const dur = Math.max(1, Math.min(lim - start, Math.round(-Math.log(1 - wrng.next() * 0.97) * 6)));
      const end = start + dur;
      lastEnd = end;
      const [att, def] = wrng.chance(0.5) ? [a, b] : [b, a];
      const id = wars.length;
      const cells = rec.cells[yi];
      const outcome = end >= END ? "ongoing" : wrng.weighted<H.WarOutcome>([["attackerVictory", 4], ["defenderVictory", 3], ["whitePeace", 2], ["stalemate", 1]]);
      const war: H.War = {
        id, name: "", casusBelli: wrng.pick(["conquest", "succession", "holyWar", "revenge", "trade", "raid", "reconquest", "subjugation"] as const),
        attackers: [att], defenders: [def], joined: [], start, end: outcome === "ongoing" ? -1 : end, outcome, battles: [], transfers: [],
        treaty: "", treatySite: -1, casualties: 0, claimant: -1,
      };
      const nb = Math.max(1, Math.min(7, Math.round(dur / 3 + wrng.next() * 2)));
      let general: [number, number] = [-1, -1];
      for (let k = 0; k < nb; k++) {
        const bc = cells[wrng.int(0, cells.length - 1)];
        const by = start + Math.round((dur * (k + wrng.next())) / nb);
        if (by > (war.end < 0 ? END : war.end)) continue;
        const site = settlementNear(bc, by, 3);
        const kind = site >= 0 && wrng.chance(0.4) ? "siege" : wrng.pick(["field", "field", "ambush"] as const);
        const feat = world.regionOf[bc] >= 0 && features[world.regionOf[bc]] ? world.regionOf[bc] : world.riverOrder[bc] > 0 ? -1 : -1;
        const sA = Math.round(wrng.range(2, 40) * (1 + 5 * (by / END)) * 100), sD = Math.round(sA * wrng.range(0.5, 1.6));
        const victor = wrng.weighted<H.Battle["victor"]>([["attacker", outcome === "attackerVictory" ? 3 : 1.5], ["defender", outcome === "defenderVictory" ? 3 : 1.5], ["draw", 0.4]]);
        for (const side of [0, 1]) {
          if (general[side] < 0 && wrng.chance(0.4)) {
            const pp = pols[side === 0 ? att : def];
            general[side] = newPerson(pp.cx, by, "m", wrng.fork(`gen${k}-${side}`), { born: by - wrng.int(25, 50) });
            persons[general[side]].roles.push({ kind: "general", polity: pp.p.id, religion: -1, from: by, to: by + dur });
            persons[general[side]].died = by + wrng.int(1, 30);
          }
        }
        const bid = battles.length;
        const lossA = Math.round(sA * wrng.range(0.05, victor === "attacker" ? 0.25 : 0.5));
        const lossD = Math.round(sD * wrng.range(0.05, victor === "defender" ? 0.25 : 0.5));
        const slain: number[] = [];
        if (general[1] >= 0 && victor === "attacker" && wrng.chance(0.2)) {
          slain.push(general[1]);
          persons[general[1]].died = by;
          persons[general[1]].deathCause = "battle";
        }
        const siteName = site >= 0 ? sets[site].s.names[sets[site].s.names.length - 1] : null;
        const nm = site >= 0 ? nameAtList(sets[site].s.names, by) : "the Frontier";
        battles.push({
          id: bid, war: id, year: by, kind, name: kind === "siege" ? `Siege of ${nm}` : `Battle of ${nm}`, cell: bc, site, feature: feat,
          attacker: { polity: att, commander: general[0], strength: sA, losses: lossA },
          defender: { polity: def, commander: general[1], strength: sD, losses: lossD }, victor, slain,
        });
        void siteName;
        war.battles.push(bid);
        war.casualties += lossA + lossD;
        ev({ year: by, type: kind === "siege" ? "siege" : "battle", importance: lossA + lossD > 4000 ? 3 : 2, cell: bc, battles: [bid], wars: [id], polities: [att, def], settlements: site >= 0 ? [site] : undefined, persons: [...general.filter((g) => g >= 0), ...slain] });
        for (const g of general) if (g >= 0) persons[g].deeds.push(events.length - 1);
      }
      // Name the war.
      const nA = nameAtList(pols[att].p.names, start), nB = nameAtList(pols[def].p.names, start);
      const firstB = war.battles[0] !== undefined ? battles[war.battles[0]] : null;
      const firstSite = firstB && firstB.site >= 0 ? nameAtList(sets[firstB.site].s.names, firstB.year) : null;
      war.name = dur >= 40 ? `the ${numberWord(Math.round(dur / 10) * 10)} Years' War` :
        war.casusBelli === "succession" ? `the War of the ${nB} Succession` :
        war.casusBelli === "holyWar" ? `the Holy War of ${nA}` :
        firstSite && wrng.chance(0.5) ? `the War of ${firstSite}` : `the ${nA}–${nB} War`;
      if (war.end >= 0) {
        const cap = pols[def].p.capitals[0].settlement;
        war.treatySite = cap;
        war.treaty = `the Peace of ${nameAtList(sets[cap].s.names, war.end)}`;
      }
      wars.push(war);
      pols[att].p.wars.push(id);
      pols[def].p.wars.push(id);
      ev({ year: start, type: "warDeclared", importance: dur > 10 ? 4 : 3, cell: cells[0] ?? -1, wars: [id], polities: [att, def] });
      if (war.end >= 0) ev({ year: war.end, type: "peace", importance: 3, cell: setsCell(war.treatySite), wars: [id], polities: [att, def], settlements: [war.treatySite] });
    }
  }
  function settlementNear(cell: number, y: number, hops: number): number {
    let frontier = [cell];
    const seen = new Set<number>(frontier);
    for (let h = 0; h <= hops; h++) {
      for (const c of frontier) {
        const sid = occupied[c];
        if (sid >= 0 && popOf(sets[sid], y) > 0) return sid;
      }
      const next: number[] = [];
      for (const c of frontier) for (let k = adjStart[c]; k < adjStart[c + 1]; k++) if (!seen.has(adj[k])) { seen.add(adj[k]); next.push(adj[k]); }
      frontier = next;
    }
    return -1;
  }
  function nameAtList(list: H.NameRecord[], y: number): string {
    let r = list[0];
    for (const x of list) if (x.year <= y) r = x;
    return r?.name.roman ?? "?";
  }

  // ---------------------------------------------------------------- wonders, works, disasters, trade
  progress("works", 0.93);
  const wonders: H.Wonder[] = [];
  const works: H.Work[] = [];
  const disasters: H.Disaster[] = [];
  const tradeRoutes: H.TradeRoute[] = [];
  {
    const wr = rng.fork("wonders");
    const big = pols.filter((px) => (px.p.ended < 0 ? END : px.p.ended) - px.p.founded > 150).sort((a, b) => b.src.reach - a.src.reach).slice(0, 28);
    for (const px of big) {
      if (!wr.chance(0.7)) continue;
      const p = px.p;
      const cap = p.capitals[0].settlement;
      const y = p.founded + wr.int(30, Math.max(31, Math.min(300, (p.ended < 0 ? END : p.ended) - p.founded - 10)));
      const builderRule = p.rulers.find((r) => y >= r.from && y < r.to);
      const kind = wr.pick(WONDER_KINDS);
      const capName = nameAtList(sets[cap].s.names, y);
      const adjs = ["Great", "High", "White", "Golden", "Old", "Black", "Silent", "Red"];
      const english = wr.chance(0.5) ? `the ${wr.pick(adjs)} ${titleCaseFirst(kind)} of ${capName}` : `the ${titleCaseFirst(kind)} of ${persons[builderRule?.person ?? p.founder].name.roman.split(" ")[0]}`;
      const id = wonders.length;
      const destroyed = wr.chance(0.4) ? Math.min(END - 1, y + wr.int(100, 900)) : -1;
      wonders.push({
        id, kind, name: sets[cap].s.names[0].name, english, settlement: cap, builder: builderRule?.person ?? -1, polity: p.id,
        begun: y - wr.int(5, 40), completed: y, destroyed, destroyCause: destroyed >= 0 ? wr.pick(["war", "earthquake", "fire", "decay"] as const) : undefined, religion: -1,
      });
      sets[cap].s.wonders.push(id);
      if (destroyed >= END) wonders[id].destroyed = -1;
      ev({ year: y, type: "wonderBuilt", importance: 3, cell: setsCell(cap), wonders: [id], settlements: [cap], polities: [p.id], persons: builderRule ? [builderRule.person] : undefined });
      if (wonders[id].destroyed >= 0) ev({ year: wonders[id].destroyed, type: "wonderDestroyed", importance: 3, cell: setsCell(cap), wonders: [id], settlements: [cap] });
    }
    const kr = rng.fork("works");
    const kinds: H.WorkKind[] = ["epic", "chronicle", "treatise", "poem", "lawCode", "hymn", "play", "map"];
    for (const px of pols) {
      const p = px.p;
      const sc = scriptAtX(px.cx, p.founded + 50);
      if (sc < 0 || !kr.chance(0.45)) continue;
      const y = Math.min(END - 1, Math.max(p.founded + 20, px.cx.c.scripts.find((s) => s.script >= 0)?.year ?? p.founded) + kr.int(10, 200));
      if (y >= (p.ended < 0 ? END : p.ended)) continue;
      const kind = kr.pick(kinds);
      const author = newPerson(px.cx, y, kr.chance(0.25) ? "f" : "m", kr.fork(`author${p.id}`), { born: y - kr.int(30, 60) });
      persons[author].died = y + kr.int(1, 25);
      persons[author].roles.push({ kind: kind === "epic" || kind === "poem" || kind === "play" || kind === "hymn" ? "poet" : "scholar", polity: p.id, religion: -1, from: y - 10, to: y + 5 });
      const la = langAt(px.cx, y);
      const m = L.proverb(la.lang, kr.fork(`inc${p.id}`));
      const t = L.motto(la.lang, kr.fork(`title${p.id}`));
      const rulerHere = p.rulers.find((r) => y >= r.from && y < r.to);
      const pName = nameAtList(p.names, y);
      const english =
        kind === "chronicle" ? `The Annals of ${pName}` : kind === "lawCode" ? `The Laws of ${persons[rulerHere?.person ?? p.founder].name.roman.split(" ")[0]}` :
        kind === "epic" ? `The Song of ${persons[p.founder].name.roman.split(" ")[0]}` : kind === "map" ? `The Description of the World` :
        kind === "treatise" ? `On ${kr.pick(["the Stars", "Rivers", "Kingship", "the Soul", "Numbers", "Horses", "Medicine"])}` : `“${t.translation}”`;
      const id = works.length;
      works.push({
        id, kind, title: { roman: t.text.replace(/[.!]$/, ""), gloss: t.translation, lang: la.hid }, english, author, year: y, lang: la.hid,
        subjectKind: kind === "epic" ? "person" : kind === "chronicle" ? "polity" : "none", subject: kind === "epic" ? p.founder : kind === "chronicle" ? p.id : -1,
        lost: kr.chance(0.25), incipit: { lang: la.hid, text: m.text, gloss: m.gloss, translation: m.translation, words: m.words },
      });
      ev({ year: y, type: "workWritten", importance: 2, cell: setsCell(p.capitals[0].settlement), works: [id], persons: [author], polities: [p.id] });
    }
    // Scriptures for the organised faiths.
    for (const r of religions) {
      if (r.founder < 0) continue;
      const cx = cultures[r.culture];
      const la = langAt(cx, r.founded + 40);
      const m = L.proverb(la.lang, kr.fork(`scr${r.id}`));
      const id = works.length;
      works.push({ id, kind: "scripture", title: r.name, english: `the Book of ${r.name.roman}`, author: r.founder, year: Math.min(END - 1, r.founded + 40), lang: la.hid, subjectKind: "religion", subject: r.id, lost: false, incipit: { lang: la.hid, text: m.text, gloss: m.gloss, translation: m.translation, words: m.words } });
      r.scripture = id;
    }
    for (const pl of plagues) {
      const affected = sets.filter((sx) => popOf(sx, pl.year) > 0 && ang(sx.s.cell, pl.cell) < pl.radius).map((sx) => sx.s.id);
      const deaths = Math.round(affected.reduce((a, id) => a + popOf(sets[id], pl.year), 0) * pl.severity * 3);
      const id = disasters.length;
      disasters.push({ id, kind: "plague", name: pl.name, start: pl.year, end: pl.year + rng.fork(`pl${id}`).int(2, 8), cell: pl.cell, deaths, settlements: affected });
      ev({ year: pl.year, type: "plague", importance: pl.name ? 5 : 3, cell: pl.cell, disasters: [id], settlements: affected.slice(0, 12) });
    }
    const dr = rng.fork("nature");
    for (const f of features) {
      if (f.kind !== "volcano" || !dr.chance(0.5)) continue;
      const y = dr.int(50, END - 10);
      const near = sets.filter((sx) => popOf(sx, y) > 0 && ang(sx.s.cell, f.anchor) < 0.06).map((sx) => sx.s.id);
      const id = disasters.length;
      disasters.push({ id, kind: "eruption", name: "", start: y, end: y + 1, cell: f.anchor, deaths: near.length * dr.int(200, 3000), settlements: near });
      ev({ year: y, type: "eruption", importance: near.length ? 3 : 2, cell: f.anchor, disasters: [id], settlements: near, features: [f.id] });
    }
    for (let k = 0; k < 6; k++) {
      let c = byScore[dr.int(0, Math.min(byScore.length - 1, 3000))];
      for (let t = 0; t < 30; t++) { const cc = byScore[dr.int(0, byScore.length - 1)]; if (world.seismicity[cc] > world.seismicity[c]) c = cc; }
      const y = dr.int(50, END - 10);
      const near = sets.filter((sx) => popOf(sx, y) > 0 && ang(sx.s.cell, c) < 0.05).map((sx) => sx.s.id);
      const id = disasters.length;
      const kind = dr.pick(["earthquake", "flood", "famine", "drought"] as const);
      disasters.push({ id, kind, name: "", start: y, end: y + (kind === "famine" || kind === "drought" ? dr.int(1, 4) : 1), cell: c, deaths: near.length * dr.int(100, 2000), settlements: near });
      ev({ year: y, type: kind, importance: 2, cell: c, disasters: [id], settlements: near });
    }
    // Trade routes between great cities.
    const tr = rng.fork("trade");
    const greats = sets.filter((sx) => popOf(sx, END - 1) > 0).sort((a, b) => popOf(b, END - 1) - popOf(a, END - 1)).slice(0, 16);
    for (let k = 0; k + 1 < greats.length && tradeRoutes.length < 9; k += 2) {
      const a = greats[k], b = greats.slice(k + 1).sort((x, y) => ang(x.s.cell, a.s.cell) - ang(y.s.cell, a.s.cell))[0];
      if (!b || ang(a.s.cell, b.s.cell) > 0.9) continue;
      const path = shortestPath(a.s.cell, b.s.cell);
      if (!path) continue;
      const crossesSea = path.some((c) => wet(c));
      const goods: string[] = [];
      for (const c of path) for (const key of RESOURCE_KEYS) if (world.resources[c] & Resource[key] && !goods.includes(key.toLowerCase()) && goods.length < 4) goods.push(key.toLowerCase());
      const founded = Math.max(a.s.founded, b.s.founded) + tr.int(100, 600);
      if (founded >= END - 20) continue;
      const id = tradeRoutes.length;
      tradeRoutes.push({ id, kind: crossesSea ? "sea" : "land", name: `the ${titleCaseFirst(goods[0] ?? "amber")} Road`, from: a.s.id, to: b.s.id, path, goods, founded, ended: -1 });
      ev({ year: founded, type: "tradeRouteOpened", importance: 2, cell: a.s.cell, settlements: [a.s.id, b.s.id] });
    }
    function shortestPath(from: number, to: number): number[] | null {
      const prevC = new Int32Array(n).fill(-1);
      const d = new Float64Array(n).fill(Infinity);
      heap.clear();
      d[from] = 0;
      heap.push(0, from);
      while (heap.size) {
        const c = heap.pop();
        const dc = heap.lastKey;
        if (c === to) break;
        if (dc > d[c]) continue;
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const j = adj[k];
          let e = edgeLand[k];
          if (!(e < Infinity)) e = edgeSea[k] * 0.8;
          if (!(e < Infinity)) continue;
          const nd = dc + e;
          if (nd < d[j]) { d[j] = nd; prevC[j] = c; heap.push(nd, j); }
        }
      }
      if (prevC[to] < 0) return null;
      const out: number[] = [];
      for (let c = to; c >= 0; c = prevC[c]) { out.push(c); if (c === from) break; }
      return out.reverse();
    }
  }
  function scriptAtX(cx: CultureX, y: number): number {
    let s = -1;
    for (const e of cx.c.scripts) if (e.year <= y) s = e.script;
    return s;
  }

  // ---------------------------------------------------------------- feature names
  progress("names", 0.96);
  const featureNames: H.FeatureNaming[] = [];
  {
    const nameable = new Set(["river", "mountains", "sea", "ocean", "lake", "desert", "forest", "continent", "island", "bay", "strait", "steppe", "jungle", "marsh", "peninsula", "hills", "volcano", "archipelago", "plain", "tundra", "glacier"]);
    const fr = rng.fork("featurenames");
    for (const f of features) {
      if (!nameable.has(f.kind)) continue;
      const land = nearestLand(f);
      if (land < 0) continue;
      const names: H.FeatureNaming["names"] = [];
      const seenC = new Set<number>();
      for (let y = 0; y < END && names.length < 3; y += 150) {
        const ci = tmpCultureAt(land, y);
        if (ci < 0 || seenC.has(ci)) continue;
        seenC.add(ci);
        const cx = cultures[ci];
        const la = langAt(cx, y);
        const d: L.FeatureDescriptors = {};
        if (f.size > 2e6 || (f.kind === "river" && f.size > 1500)) d.size = "great";
        if (f.attrs.salty) d.salt = true;
        if (f.kind === "desert" && fr.chance(0.5)) d.temp = "hot";
        if (fr.chance(0.3)) d.color = fr.pick(["white", "black", "red", "green", "blue", "golden", "grey"]);
        try {
          const nm = L.nameFeature(la.lang, fr.fork(`f${f.id}-${ci}`), L.featureKindToNameKind(f.kind), d, { registry: reg });
          names.push({ year: Math.max(y, cx.c.born), culture: ci, name: wn(nm, la.hid) });
          if (names.length === 1) ev({ year: Math.max(y, cx.c.born), type: "featureNamed", importance: f.size > 1e6 ? 2 : 1, cell: f.anchor, features: [f.id], cultures: [ci] });
        } catch { /* skip */ }
      }
      if (names.length) featureNames.push({ feature: f.id, names });
    }
    function nearestLand(f: GeoFeature): number {
      if (habitable[f.anchor]) return f.anchor;
      for (let i = 0; i < f.cells.length && i < 400; i++) {
        const c = f.cells[i];
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) if (habitable[adj[k]]) return adj[k];
      }
      return -1;
    }
  }

  // ---------------------------------------------------------------- ages & finalisation
  progress("ages", 0.98);
  const ages: H.History["ages"] = [];
  {
    const ar = rng.fork("ages");
    const cuts = [0, END * ar.range(0.13, 0.2), END * ar.range(0.32, 0.4), END * ar.range(0.52, 0.6), END * ar.range(0.72, 0.8), END].map((x) => Math.round(x / 10) * 10);
    const biggestIn = (a: number, b: number): PolX | undefined => {
      let best: PolX | undefined, bs = -1;
      for (const px of pols) {
        const o0 = Math.max(a, px.p.founded), o1 = Math.min(b, px.p.ended < 0 ? END : px.p.ended);
        if (o1 <= o0) continue;
        const s = (o1 - o0) * px.src.reach * px.src.weight;
        if (s > bs) { bs = s; best = px; }
      }
      return best;
    };
    const used = new Set<string>();
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const big = biggestIn(a, b);
      const bigName = big ? nameAtList(big.p.names, Math.max(a, big.p.founded)) : "";
      const plague = disasters.find((d) => d.kind === "plague" && d.name && d.start >= a && d.start < b);
      const faith = religions.find((r) => r.founder >= 0 && r.founded >= a && r.founded < b);
      let name: string;
      if (i === 0) name = "the Age of Founding";
      else if (i === 1) name = ar.pick(["the Age of Bronze Kings", "the Age of the First Crowns", "the Age of Chieftains"]);
      else if (plague && !used.has("plague")) { name = `the Age after ${plague.name.replace(/^the /, "the ")}`; used.add("plague"); }
      else if (faith && !used.has("faith")) { name = `the Age of ${titleCaseFirst(faith.english.replace(/^the /, ""))}`; used.add("faith"); }
      else if (big && !used.has(bigName)) { name = `the ${big.cx.c.adjective} Ascendancy`; used.add(bigName); }
      else name = ar.pick(["the Long Peace", "the Age of Iron", "the Age of Sails", "the Age of Many Crowns"]);
      if (used.has(name)) name = ar.pick(["the Age of Sails", "the Age of Iron", "the Long Peace"]);
      used.add(name);
      const nWars = wars.filter((w) => w.start >= a && w.start < b).length;
      const nPol = pols.filter((px) => px.p.founded >= a && px.p.founded < b).length;
      const summary = i === 0
        ? `The first peoples settle the river valleys and coasts; villages grow into towns, and the first chiefdoms appear.`
        : `${nPol} realms rose and ${nWars} wars were fought${big ? `; the age was dominated by ${polTitle(big, Math.max(a, big.p.founded))}` : ""}${plague ? `, and ${plague.name} swept the land in ${plague.start}` : ""}.`;
      ages.push({ name, start: a, end: b, summary });
    }
    function polTitle(px: PolX, y: number): string {
      const nm = nameAtList(px.p.names, y);
      let g = px.p.governments[0].gov;
      for (const e of px.p.governments) if (e.year <= y) g = e.gov;
      const t: Record<string, string> = { empire: "Empire", kingdom: "Kingdom", chiefdom: "Chiefdom", tribe: "tribes", horde: "Horde", republic: "Republic", cityState: "city", theocracy: "Holy Realm", confederation: "Confederation", principality: "Principality" };
      return g === "tribe" ? `the ${px.cx.c.adjective} tribes` : `the ${t[g]} of ${nm}`;
    }
  }
  // Golden ages for the greatest realms.
  for (const px of pols.filter((p) => p.src.reach > 1800).slice(0, 6)) {
    const y = px.p.founded + Math.round((((px.p.ended < 0 ? END : px.p.ended) - px.p.founded) * 0.4));
    ev({ year: y, type: "goldenAge", importance: 4, cell: setsCell(px.p.capitals[0].settlement), polities: [px.p.id] });
  }
  // Holy cities and seats of learning.
  for (const w of works) if (w.kind === "treatise" || w.kind === "chronicle") {
    const p = pols.find((px) => px.p.id === (persons[w.author].roles[0]?.polity ?? -1));
    if (p) { const s = sets[p.p.capitals[0].settlement].s; if (!s.tags.includes("seat of learning")) s.tags.push("seat of learning"); }
  }

  // Events: sort, assign ids, fix up person deeds.
  const order = events.map((e, i) => i).sort((a, b) => events[a].year - events[b].year || a - b);
  const remap = new Int32Array(events.length);
  order.forEach((old, i) => (remap[old] = i));
  const finalEvents: H.HEvent[] = order.map((old, i) => ({ id: i, ...events[old] }));
  for (const p of persons) p.deeds = p.deeds.map((d) => remap[d]).sort((a, b) => a - b);
  for (const p of persons) for (const e of p.roles) if (e.to < e.from) e.to = e.from;

  for (let i = 0; i < worldStats.pop.length; i++) {
    const y = i * SAMPLE;
    worldStats.wars.push(wars.filter((w) => w.start <= y && (w.end < 0 || w.end >= y)).length);
  }
  progress("done", 1);
  return {
    endYear: END,
    sampleStep: SAMPLE,
    cultures: cultures.map((c) => c.c),
    languages,
    scripts,
    settlements: sets.map((s) => s.s),
    polities: pols.map((p) => p.p),
    persons,
    dynasties,
    religions,
    deities,
    myths,
    wars,
    battles,
    wonders,
    works,
    tradeRoutes,
    disasters,
    featureNames,
    events: finalEvents,
    timeline: tl,
    ages,
    worldStats,
  };
}

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function hsl(h: number, s: number, l: number): H.RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function titleCaseFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function numberWord(n: number): string {
  const w: Record<number, string> = { 40: "Forty", 50: "Fifty", 60: "Sixty", 70: "Seventy", 80: "Eighty", 90: "Ninety", 100: "Hundred" };
  return w[n] ?? String(n);
}
