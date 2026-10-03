/**
 * The simulation context: the world, per-system random streams, the output
 * records being built, the runtime state that drives them, per-cell layers and
 * the event log. Systems (settlements.ts, polities.ts, war.ts, …) are plain
 * functions over a `Sim`.
 *
 * Output records (`History` entities) are created as soon as an entity comes
 * into being and filled in as the simulation runs; runtime state (`SetS`,
 * `PolS`, …) lives beside them and is discarded at the end. Names are kept as
 * the language engine's rich `Name` objects (so they can evolve through sound
 * changes) and converted to `WName` when the run is finalised.
 */
import { Rng } from "../core/rng";
import type { PhysicalWorld } from "../world/types";
import type { Language as LLang, Name as LName } from "../lang/index";
import type { HeraldryStyle } from "../heraldry/styles";
import { buildGeo, Searcher, type Geo } from "./geo";
import type {
  Archetype, Battle, CasusBelli, Culture, CultureValues, Deity, DeathCause, Disaster, Dynasty, EventData, EventType, Government,
  HEvent, History, Id, Language, Myth, Person, Polity, Religion, ReligionKind, RGB, Script, Settlement, SuccessionLaw, TradeRoute,
  Trait, War, Wonder, Work, FeatureNaming, NameChangeReason,
} from "./types";
import { Names } from "./names";

/** Years between population/stat samples. */
export const SAMPLE_STEP = 10;
/** Years between timeline snapshots. */
export const TIMELINE_STEP = 5;
/** Snapshots between keyframes. */
export const KEY_EVERY = 20;

/** Technology level names (see docs/HISTORY.md). */
export const TECH_LEVELS = ["Neolithic", "Bronze", "Writing", "Iron", "Classical", "Medieval", "Early modern"] as const;

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface SetS {
  id: number;
  rec: Settlement;
  cell: number;
  alive: boolean;
  /** District population (town + hinterland). */
  pop: number;
  /** Carrying capacity of the district at current technology. */
  cap: number;
  /** Σ food potential of the catchment cells (updated with catchments). */
  food: number;
  /** Urban (displayed) population. */
  urban: number;
  culture: number;
  religion: number;
  owner: number;
  /** Enemy polity holding the settlement during a war, or -1. */
  occupier: number;
  occWar: number;
  loyalty: number;
  /** Target loyalty (recomputed every few years). */
  loyaltyTarget: number;
  /** Year it came under its current owner. */
  ownerSince: number;
  /** Year its culture last changed. */
  cultureSince: number;
  walls: boolean;
  port: boolean;
  /** Trade wealth 0..~2. */
  wealth: number;
  /** War damage 0..1, decays. */
  devast: number;
  lastPlague: number;
  /** Current name (language engine object) and its language id (History id). */
  name: LName;
  /** Neighbouring settlements (by catchment adjacency). */
  nbrs: number[];
  /** Catchment cells range in Sim.catchCells. */
  catchStart: number;
  catchLen: number;
  /** Highest urban milestone announced (0 none, 1 town, 2 city, 3 great city, 4 metropolis). */
  rank: number;
  nextFoundTry: number;
  /** Distance (travel cost) to its owner's capital. */
  capDist: number;
  holy: boolean;
  /** Seat (settlement id) of the province it belongs to; = own id for seats and unowned towns. */
  seat: number;
  /** Year walls were raised or -1 (mirrors rec.walled). */
  lastSack: number;
  /** Trade routes touching the town (ids). */
  routes: number[];
  /** Year of the last revolt it took part in. */
  lastRevolt: number;
}

export interface PolS {
  id: number;
  rec: Polity;
  alive: boolean;
  /** Current ruling culture. */
  culture: number;
  capital: number;
  gov: Government;
  law: SuccessionLaw;
  ruler: number;
  /** Heir apparent/presumptive, or -1. */
  heir: number;
  dynasty: number;
  religion: number;
  overlord: number;
  /** The senior realm this one shares a ruler with (personal union), or -1. */
  unionWith: number;
  /** 0..1: how firmly the ruler holds the realm (legitimacy of the line, recent troubles). */
  legitimacy: number;
  prestige: number;
  treasury: number;
  /** 0..~2: accumulated war weariness (decays in peace). */
  warWeariness: number;
  /** Current settlements (rebuilt every year, ascending ids). */
  sets: number[];
  /** Provinces: seat settlement → member settlements (seat included). Rebuilt every 10 years and after transfers. */
  provinces: Map<number, number[]>;
  /** District population (towns + hinterland). */
  pop: number;
  /** Soldiers the realm can raise. */
  strength: number;
  cells: number;
  /** Land area, km² (with `cells`, refreshed with the layers). */
  area: number;
  allies: number[];
  /** polity id → year until which a truce holds. */
  truces: Map<number, number>;
  /** settlement id → year lost (claims for reconquest). */
  claims: Map<number, number>;
  /** polity id → grudge strength (decays). */
  grudges: Map<number, number>;
  /** polity id → year of the last royal marriage between the houses. */
  ties: Map<number, number>;
  wars: number[];
  name: LName;
  color: RGB;
  lastSuccession: number;
  /** A faction/rebel polity created for a civil war or revolt. */
  rebel: boolean;
  /** Accumulated crisis (succession troubles, lost wars, plague, revolts); collapse when high. */
  crisis: number;
  /**
   * Group feeling of the ruling elite (Ibn Khaldun's asabiyya), ~0..1.1: high in
   * young realms, eroded by size, luxury and time, renewed by new dynasties,
   * victories and danger. Low cohesion loosens loyalty and breeds crises.
   */
  cohesion: number;
  /** Personal rate at which this realm's cohesion erodes (×). */
  decay: number;
  /** Year the current golden age ends (or 0). */
  goldenAge: number;
  regent: number;
  regentUntil: number;
  founded: number;
  /** Count of revolts in the last decades (decays). */
  revolts: number;
  lastWonder: number;
  lastWar: number;
  /** Year of the last government change. */
  govSince: number;
  /** Settlements gained by conquest in the last decades (decays) — drives empire formation and "the Conqueror". */
  conquests: number;
  /** Strongest peak of strength reached (for decline detection). */
  peakStrength: number;
  /** Set of cultures among its settlements (rebuilt yearly): culture → district pop. */
  cultureMix: Map<number, number>;
  /** Realms it has swallowed (annexed, absorbed, merged), in order — the members of a unification. */
  absorbed: number[];
}

/** How much a realm matters to the chronicle: 0 minor, 1 sizeable, 2 great (an empire or a realm of 35+ towns). */
export function stature(P: PolS): 0 | 1 | 2 {
  if (P.gov === "empire" || P.sets.length >= 35) return 2;
  return P.sets.length >= 10 ? 1 : 0;
}

export interface CulS {
  id: number;
  rec: Culture;
  alive: boolean;
  lang: LLang;
  /** History language id of `lang`. */
  langId: number;
  /** Year the current language stage began, and the year the next stage is due. */
  stageDue: number;
  tech: number;
  script: number;
  /** Highest integer tech level announced. */
  techAnnounced: number;
  values: CultureValues;
  archetype: Archetype;
  style: HeraldryStyle;
  /** Core cell (capital of its main realm or largest town). */
  core: number;
  folk: number;
  sets: number;
  pop: number;
  /** Cultures in contact (rebuilt with territory). */
  contacts: Set<number>;
  /** Female succession allowed (cognatic). */
  cognatic: boolean;
  law: SuccessionLaw;
  /** Sea raiders (cold-coast seafarers who plunder rather than trade). */
  raiders: boolean;
  /** Index of the next named technology (see tech.ts TECHS) this people has not yet mastered. */
  nextTech: number;
  /** Largest town (urban pop) of the people, refreshed every few years. */
  bigCity: number;
  bigUrban: number;
  /** Mean trade wealth of its towns. */
  wealth: number;
  /** Year it last split off a daughter people (cooldown). */
  lastSplit: number;
}

export interface PerS {
  id: number;
  rec: Person;
  alive: boolean;
  spouse: number;
  /** Polities this person currently rules. */
  rules: number[];
  /**
   * Generations from a ruler (0 = ruler or heir; 1 = their children; 2 =
   * grandchildren; 9 = untracked noble/consort). Births are simulated only
   * for couples where one partner has `dist` 0.
   */
  dist: number;
  martial: number;
  diplomacy: number;
  stewardship: number;
  learning: number;
  /** Deeds tally for epithets. */
  tally: Record<string, number>;
  /** Accession age (for "the Child"). */
  accAge: number;
  /** Home polity (where the person lives / belongs), or -1. */
  polity: number;
  /** Children born (all, including those who died). */
  births: number;
}

export interface RelS {
  id: number;
  rec: Religion;
  alive: boolean;
  organised: boolean;
  zeal: number;
  adherents: number;
}

export interface WarS {
  id: number;
  rec: War;
  active: boolean;
  att: number;
  def: number;
  attSide: number[];
  defSide: number[];
  cb: CasusBelli;
  claimant: number;
  targets: number[];
  occ: Map<number, number>;
  score: number;
  exhaustA: number;
  exhaustD: number;
  battlesA: number;
  battlesD: number;
  /** Ongoing siege progress per settlement. */
  siege: Map<number, number>;
  commanderA: number;
  commanderD: number;
  /** Last contested settlement (for the treaty site). */
  lastSite: number;
  /** Rebel/faction polity being fought, if any. */
  rebels: number;
  migration: boolean;
  /** Feature most fought over (for naming). */
  featureHits: Map<number, number>;
  slainNotables: number;
}

export interface PlagueS {
  id: number;
  rec: Disaster;
  infected: Set<number>;
  frontier: number[];
  lethality: number;
  contagion: number;
  years: number;
  great: boolean;
}

export interface SimOptions {
  years: number;
  onProgress?: (year: number, fraction: number) => void;
  onSnapshot?: (snap: import("./types").LiveSnapshot) => void;
}

/** Timings per system (ms), for tools. */
export type Timings = Record<string, number>;

export class Sim {
  readonly w: PhysicalWorld;
  readonly g: Geo;
  readonly n: number;
  readonly endYear: number;
  year = 0;
  readonly rng: Record<string, Rng>;
  readonly names: Names;
  readonly search: Searcher;
  readonly h: History;

  S: SetS[] = [];
  P: PolS[] = [];
  C: CulS[] = [];
  Pe: PerS[] = [];
  R: RelS[] = [];
  W: WarS[] = [];
  plagues: PlagueS[] = [];

  /** Living persons (ids), compacted periodically. */
  living: number[] = [];
  /** Members (ids, possibly dead or moved to another house) of each dynasty, for succession. */
  dynMembers = new Map<number, number[]>();
  /** Settlements founded or lost since the last catchment recomputation. */
  setChanges = 0;
  lastCatchments = -999;
  /** Alive settlements (ids), rebuilt when it changes. */
  aliveSets: number[] = [];
  setsDirty = true;

  // Per-cell layers.
  setAt: Int32Array;
  cellSet: Int32Array;
  cellOwner: Int32Array;
  cellCulture: Int32Array;
  cellReligion: Int32Array;
  /** Catchment cells by settlement (CSR into this buffer). */
  catchCells: Int32Array;
  /** Global temperature anomaly this year (°C). */
  climate = 0;
  /** Volcanic winter remaining years and strength. */
  volcanicWinter = 0;

  /** Which cultures have named which features: key feature*4096+culture. */
  featureNamed = new Set<number>();
  featureIdx = new Map<number, FeatureNaming>();
  /** Contact pairs between cultures already announced. */
  contacted = new Set<number>();
  /** Border length (cell edges) between polity pairs (pairKey). */
  borders = new Map<number, number>();
  /** Land neighbours of each polity. */
  polNbrs = new Map<number, number[]>();
  /** Sea neighbours of each polity (ports within sailing reach). */
  seaNbrs = new Map<number, number[]>();
  timings: Timings = {};
  /** World-first technology levels announced. */
  techFirst = 0;
  /** Event ids since last live snapshot. */
  recentEvents: number[] = [];
  /** Small per-run counters and flags used by systems (script inventions, world firsts, used names…). */
  counters: Record<string, number> = {};
  flags = new Set<string>();
  /** Deferred actions (scripture written decades after a founding, …), run in insertion order when due. */
  agenda: { year: number; run: () => void }[] = [];
  /** Cross-system callbacks filled in by modules (avoids import cycles). */
  hooks: { scripture?: (sim: Sim, religion: number) => void } = {};
  /**
   * Unity of each people: `divided` once no single realm holds most of its
   * towns (set when the people is split among rival realms), cleared when
   * one realm unites it again; `united` = times it has been united.
   */
  unity = new Map<number, { divided: boolean; since: number; united: number }>();
  /** Prophets born and awaiting their calling. */
  prophecies: { person: number; city: number; culture: number; due: number }[] = [];
  /** Scratch per-cell stamp for de-duplicating cell visits (bump `stampGen` before use). */
  stamp: Int32Array;
  stampGen = 0;

  constructor(w: PhysicalWorld, rng: Rng, opts: SimOptions) {
    this.w = w;
    this.n = w.mesh.n;
    this.endYear = opts.years;
    this.g = buildGeo(w);
    this.search = new Searcher(w, this.g);
    const labels = ["cultures", "settle", "polity", "people", "war", "diplo", "religion", "tech", "trade", "disaster", "works", "names", "emblems", "features", "lang", "script", "climate", "ages", "misc"];
    this.rng = Object.fromEntries(labels.map((l) => [l, rng.fork(l)]));
    this.names = new Names(this);
    this.setAt = new Int32Array(this.n).fill(-1);
    this.cellSet = new Int32Array(this.n).fill(-1);
    this.cellOwner = new Int32Array(this.n).fill(-1);
    this.cellCulture = new Int32Array(this.n).fill(-1);
    this.cellReligion = new Int32Array(this.n).fill(-1);
    this.catchCells = new Int32Array(this.n);
    this.stamp = new Int32Array(this.n);
    this.h = {
      endYear: opts.years,
      sampleStep: SAMPLE_STEP,
      cultures: [], languages: [], scripts: [], settlements: [], polities: [], persons: [], dynasties: [], religions: [], deities: [],
      myths: [], wars: [], battles: [], wonders: [], works: [], tradeRoutes: [], disasters: [], featureNames: [], events: [],
      timeline: {
        step: TIMELINE_STEP, keyEvery: KEY_EVERY, snapshots: 0,
        owner: { keyframes: [], diffCells: [], diffValues: [] },
        culture: { keyframes: [], diffCells: [], diffValues: [] },
        religion: { keyframes: [], diffCells: [], diffValues: [] },
      },
      ages: [],
      worldStats: { pop: [], settlements: [], polities: [], wars: [], climate: [], tech: [] },
    };
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /**
   * Record an event. `refs` are the cross-reference arrays; `actors` (default:
   * all `refs.persons`) get the event in their `deeds`.
   */
  emit<K extends EventType>(type: K, importance: number, cell: number, refs: Omit<HEvent, "id" | "year" | "type" | "importance" | "cell" | "data">, data: EventData[K], actors?: number[]): HEvent {
    const e: HEvent = { id: this.h.events.length, year: this.year, type, importance: Math.max(1, Math.min(5, Math.round(importance))), cell };
    for (const k of Object.keys(refs) as (keyof typeof refs)[]) {
      const arr = refs[k];
      if (!arr || !arr.length) continue;
      const clean: number[] = [];
      for (const x of arr) if (x >= 0 && !clean.includes(x)) clean.push(x);
      if (clean.length) (e as unknown as Record<string, number[]>)[k] = clean;
    }
    e.data = data as unknown as Record<string, unknown>;
    this.h.events.push(e);
    const who = actors ?? e.persons ?? [];
    for (const p of who) if (p >= 0 && this.h.persons[p]) {
      const d = this.h.persons[p].deeds;
      if (d[d.length - 1] !== e.id) d.push(e.id);
    }
    if (e.importance >= 3) this.recentEvents.push(e.id);
    return e;
  }

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  cultureLang(c: number): LLang {
    return this.C[c].lang;
  }

  /** Current alive settlement list (rebuilt lazily). */
  alive(): number[] {
    if (this.setsDirty) {
      this.aliveSets = [];
      for (const s of this.S) if (s.alive) this.aliveSets.push(s.id);
      this.setsDirty = false;
    }
    return this.aliveSets;
  }

  /** Effective controller of a settlement (occupier during war, else owner). */
  controller(s: SetS): number {
    return s.occupier >= 0 ? s.occupier : s.owner;
  }

  /** Independent top-level polity (follows overlords). */
  topOf(p: number): number {
    let q = p;
    for (let i = 0; i < 8 && q >= 0 && this.P[q].overlord >= 0; i++) q = this.P[q].overlord;
    return q;
  }

  techOf(p: number): number {
    return this.C[this.P[p].culture].tech;
  }

  /** Root culture (family) of a culture. */
  familyOf(c: number): number {
    return this.C[c].rec.family;
  }

  /** Change-list push that collapses same-year entries and skips no-ops. */
  pushChange<T extends { year: number }>(list: T[], entry: T, same: (a: T, b: T) => boolean): void {
    const last = list[list.length - 1];
    if (last && same(last, entry)) return;
    if (last && last.year === entry.year) list[list.length - 1] = entry;
    else list.push(entry);
    // A same-year overwrite may now equal the previous entry.
    const l2 = list.length;
    if (l2 >= 2 && same(list[l2 - 2], list[l2 - 1])) list.pop();
  }

  setOwner(s: SetS, owner: number): void {
    if (s.owner === owner) return;
    s.owner = owner;
    s.ownerSince = this.year;
    s.occupier = -1;
    s.occWar = -1;
    this.pushChange(s.rec.owners, { year: this.year, polity: owner }, (a, b) => a.polity === b.polity);
  }

  setCulture(s: SetS, c: number): void {
    if (s.culture === c) return;
    s.culture = c;
    s.cultureSince = this.year;
    this.pushChange(s.rec.cultures, { year: this.year, culture: c }, (a, b) => a.culture === b.culture);
  }

  setReligion(s: SetS, r: number): void {
    if (s.religion === r) return;
    s.religion = r;
    this.pushChange(s.rec.religions, { year: this.year, religion: r }, (a, b) => a.religion === b.religion);
  }

  renameSettlement(s: SetS, name: LName, reason: NameChangeReason): void {
    s.name = name;
    const rec = s.rec.names;
    const last = rec[rec.length - 1];
    if (last && last.year === this.year) rec[rec.length - 1] = { year: this.year, name: name as never, reason };
    else rec.push({ year: this.year, name: name as never, reason });
  }

  renamePolity(p: PolS, name: LName, reason: NameChangeReason): void {
    p.name = name;
    const rec = p.rec.names;
    const last = rec[rec.length - 1];
    if (last && last.year === this.year) rec[rec.length - 1] = { year: this.year, name: name as never, reason };
    else rec.push({ year: this.year, name: name as never, reason });
  }

  setGov(p: PolS, gov: Government): void {
    if (p.gov === gov) return;
    p.gov = gov;
    this.pushChange(p.rec.governments, { year: this.year, gov }, (a, b) => a.gov === b.gov);
  }

  setLaw(p: PolS, law: SuccessionLaw): void {
    p.law = law;
    this.pushChange(p.rec.succession, { year: this.year, law }, (a, b) => a.law === b.law);
  }

  setCapital(p: PolS, sid: number): void {
    if (p.capital === sid) return;
    p.capital = sid;
    this.pushChange(p.rec.capitals, { year: this.year, settlement: sid }, (a, b) => a.settlement === b.settlement);
  }

  setStateReligion(p: PolS, r: number): void {
    if (p.religion === r) return;
    p.religion = r;
    this.pushChange(p.rec.religions, { year: this.year, religion: r }, (a, b) => a.religion === b.religion);
  }

  setOverlord(p: PolS, o: number): void {
    if (p.overlord === o) return;
    p.overlord = o;
    this.pushChange(p.rec.overlords, { year: this.year, overlord: o }, (a, b) => a.overlord === b.overlord);
  }

  /** Name of a settlement right now (roman). */
  sName(sid: number): string {
    return sid >= 0 ? this.S[sid].name.roman : "?";
  }
  pName(pid: number): string {
    return pid >= 0 ? this.P[pid].name.roman : "?";
  }

  /** Great-circle distance between two cells, km. */
  distKm(a: number, b: number): number {
    const p = this.w.mesh.xyz;
    const d = p[3 * a] * p[3 * b] + p[3 * a + 1] * p[3 * b + 1] + p[3 * a + 2] * p[3 * b + 2];
    return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * this.w.params.radiusKm;
  }

  time<T>(label: string, f: () => T): T {
    const t0 = performance.now();
    const r = f();
    this.timings[label] = (this.timings[label] ?? 0) + performance.now() - t0;
    return r;
  }
}

export type {
  Archetype, Battle, Culture, Deity, DeathCause, Dynasty, Government, Id, Language, Myth, Person, Polity, Religion, ReligionKind,
  Script, Settlement, TradeRoute, Trait, War, Wonder, Work,
};
