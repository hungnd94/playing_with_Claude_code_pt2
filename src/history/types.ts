/**
 * History data contracts.
 *
 * The simulation (src/history) produces a `History`; the narrative engine,
 * atlas renderer and UI consume it. Everything here is plain JSON plus typed
 * arrays so it survives structured-clone from the generation worker.
 *
 * Conventions
 *  - Ids are dense indices into the corresponding array (`history.persons[id]`).
 *  - `-1` means "none".
 *  - Years are integers from 0 (dawn of history) to `history.endYear`.
 *  - Things that change over time are stored as change lists
 *    (`{ year, ... }[]`, sorted by year); the value at year Y is the last
 *    entry with `year <= Y` (see helpers in ./query.ts).
 */
import type { EmblemConcept } from "../world/concepts";

export type Id = number;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A name in some language, as stored in history (adapted from the language engine's richer Name). */
export interface WName {
  /** Display form, romanised and capitalised, e.g. "Kešdavar". */
  roman: string;
  /** Literal English meaning, e.g. "Stone Ford". May be "" if opaque. */
  gloss: string;
  /** Language id the name belongs to. */
  lang: Id;
  /** IPA transcription, e.g. "ˈkeʃdavar". */
  ipa?: string;
  /** Phonemes (IPA segments) — used to write the name in a native script. */
  phonemes?: string[];
  /** Morpheme breakdown. */
  parts?: { roman: string; gloss: string }[];
  /** Pre-rendered etymology, e.g. "from Old Keshi *Kaś-tabar 'stone ford'". */
  etym?: string;
}

export type NameChangeReason = "founded" | "evolved" | "conquest" | "renamed" | "borrowed" | "assimilated" | "restored";

export interface NameRecord {
  year: number;
  name: WName;
  reason: NameChangeReason;
}

/** Opaque emblem payload produced by src/heraldry; `kind` says which renderer to use. */
export interface Emblem {
  kind: "arms" | "mon" | "seal" | "banner";
  /** The heraldry module's data object (Arms, Mon, …). */
  data: unknown;
  /** Blazon or description, English. */
  blazon: string;
}

/** A sentence in a language with interlinear gloss (mottoes, proverbs, inscriptions). */
export interface Utterance {
  lang: Id;
  /** Romanised native text. */
  text: string;
  /** Morpheme-by-morpheme gloss line (Leipzig style). */
  gloss: string;
  /** Free English translation. */
  translation: string;
  /** Words as phoneme arrays (for native-script rendering). */
  words?: string[][];
}

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Peoples
// ---------------------------------------------------------------------------

export type Archetype =
  | "riverine"
  | "coastal"
  | "steppe"
  | "forest"
  | "mountain"
  | "desert"
  | "jungle"
  | "tundra"
  | "island";

export interface CultureValues {
  /** Each 0..1. */
  martial: number;
  mercantile: number;
  piety: number;
  art: number;
  expansion: number;
  seafaring: number;
}

export interface Culture {
  id: Id;
  /** Endonym of the people. */
  name: WName;
  /** English adjective / demonym used in prose, e.g. "Ashkari". */
  adjective: string;
  parent: Id;
  children: Id[];
  born: number;
  /** Year the culture ceased to exist as a distinct people (assimilated, split entirely, extinct), or -1. */
  ended: number;
  homeCell: number;
  archetype: Archetype;
  values: CultureValues;
  /** Language spoken over time (languages also evolve in place: Old X → Middle X → X). */
  languages: { year: number; lang: Id }[];
  /** Writing system in use over time (-1 = illiterate). */
  scripts: { year: number; script: Id }[];
  /** Technology level over time (see TECH_LEVELS). */
  tech: { year: number; level: number }[];
  heraldicStyle: Emblem["kind"];
  /** Map colour for the culture layer. */
  color: RGB;
  /** Native titles, e.g. { ruler: <word for king>, priest: … }. */
  titles: Partial<Record<"ruler" | "emperor" | "chief" | "priest" | "noble" | "general", WName>>;
  /** The people's ancestral folk religion. */
  folkReligion: Id;
  /** Founding (root) culture of this people's family tree (= own id for founding cultures). */
  family: Id;
  /** Settlement or polity the people were named after when they split off, or -1. */
  namedAfter: Id;
}

export interface Language {
  id: Id;
  /** Name of the language in English prose, e.g. "Old Keshi". */
  name: string;
  /** Endonym. */
  endonym: WName;
  parent: Id;
  children: Id[];
  /** Year it emerged (split or stage change). */
  born: number;
  /** Year it gave way to its next in-place stage or ceased to be spoken, or -1 if still spoken at the end. */
  ended: number;
  culture: Id;
  /** Root (proto-)language of its family. */
  family: Id;
  /**
   * How it arose: "proto" (a founding people's tongue), "split" (a daughter
   * language of a people that broke away), "stage" (a later stage of the same
   * people's language: Old X → Middle X → X).
   */
  origin: "proto" | "split" | "stage";
  /** The language engine's serialisable language object (src/lang `Language`). */
  data: unknown;
}

export type ScriptKind = "alphabet" | "abjad" | "abugida" | "syllabary" | "featural";

export interface Script {
  id: Id;
  /** English name, e.g. "Keshi script" or a native-derived name. */
  name: string;
  nativeName?: WName;
  kind: ScriptKind;
  parent: Id;
  children: Id[];
  born: number;
  /** Culture that invented or adapted it. */
  culture: Id;
  /** How it arose: invented from nothing, borrowed and adapted to a new language, or evolved in place. */
  how: "invented" | "adapted" | "derived";
  /** Settlement where it is said to have been invented/adapted, or -1. */
  origin: Id;
  /** The script module's serialisable object. */
  data: unknown;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface Settlement {
  id: Id;
  cell: number;
  /** Earlier settlement at the same site whose ruins this one was built on, or -1. */
  ruinsOf: Id;
  /** Render position (unit vector, jittered within the cell so maps don't look gridded). */
  pos: [number, number, number];
  names: NameRecord[];
  founded: number;
  /** Year abandoned/destroyed, or -1. */
  ended: number;
  endReason?: "sacked" | "abandoned" | "disaster" | "plague";
  founderCulture: Id;
  /** Settlement it was founded from (colony/daughter), or -1. */
  mother: Id;
  /** Person credited with the founding, or -1. */
  founder: Id;
  /**
   * Population of the town itself (urban; what an encyclopedia quotes), sampled
   * every `history.sampleStep` years starting at sample index `popStart`
   * (sample k ↔ year k * sampleStep). The rural hinterland is counted in the
   * owning polity's `stats.pop`.
   */
  popStart: number;
  pop: number[];
  cultures: { year: number; culture: Id }[];
  religions: { year: number; religion: Id }[];
  owners: { year: number; polity: Id }[];
  port: boolean;
  /** Year walls were raised, or -1. */
  walled: number;
  wonders: Id[];
  /** Free-form distinctions, e.g. "holy city", "seat of learning", "trade hub", "capital". */
  tags: string[];
  /** Occupations during wars (settlement held by an enemy without a peace yet), for the atlas. */
  occupations: { from: number; to: number; by: Id; war: Id }[];
}

/** Names of a geographic feature in the languages of the peoples who knew it. */
export interface FeatureNaming {
  feature: Id;
  names: { year: number; culture: Id; name: WName }[];
}

// ---------------------------------------------------------------------------
// Realms & people
// ---------------------------------------------------------------------------

export type Government =
  | "tribe"
  | "chiefdom"
  | "kingdom"
  | "empire"
  | "cityState"
  | "republic"
  | "theocracy"
  | "confederation"
  | "horde"
  | "principality";

export type PolityEndReason = "conquered" | "collapsed" | "merged" | "dissolved" | "absorbed" | "extinct";

/**
 * Succession laws: primogeniture (eldest son, then daughters), seniority (eldest
 * male of the dynasty), elective (magnates choose among the royal kin),
 * tanistry (the ablest kinsman; steppe and clan peoples), election (a
 * republic's council elects any citizen), appointment (a theocracy's clergy
 * appoint a priest).
 */
export type SuccessionLaw = "primogeniture" | "seniority" | "elective" | "tanistry" | "election" | "appointment";

export interface Polity {
  id: Id;
  /** Core name over time (e.g. "Ashkar"); prose builds titles like "Kingdom of Ashkar" from this + government. */
  names: NameRecord[];
  governments: { year: number; gov: Government }[];
  succession: { year: number; law: SuccessionLaw }[];
  founded: number;
  ended: number;
  endReason?: PolityEndReason;
  /** Founding person, or -1. */
  founder: Id;
  predecessors: Id[];
  successors: Id[];
  capitals: { year: number; settlement: Id }[];
  /** Founding (ruling) culture. */
  culture: Id;
  /** Ruling culture over time (changes when the ruling people splits off a daughter people or shifts). */
  cultures: { year: number; culture: Id }[];
  /** State religion over time. */
  religions: { year: number; religion: Id }[];
  /**
   * Ruler sequence (persons): hereditary rulers, elected heads, appointed
   * priests. `to` = -1 while still reigning at the end of the run. Regents are
   * not listed here (they carry a "regent" role and a `regency` event).
   */
  rulers: { person: Id; from: number; to: number }[];
  /** Overlord over time (-1 = independent). */
  overlords: { year: number; overlord: Id }[];
  emblem: Emblem;
  /** Flag data from the heraldry module, if any. */
  flag?: unknown;
  motto?: Utterance;
  color: RGB;
  wars: Id[];
  /**
   * Series sampled every `history.sampleStep` years from sample index `statStart`:
   * total population (urban + rural), land area, settlement count, military strength (soldiers).
   */
  statStart: number;
  stats: { pop: number[]; areaKm2: number[]; settlements: number[]; strength: number[] };
  /** Peak land area (km²) and the year it was reached. */
  peak: { areaKm2: number; year: number };
}

export type Sex = "m" | "f";

export type Trait =
  | "ambitious"
  | "content"
  | "brave"
  | "craven"
  | "cruel"
  | "kind"
  | "just"
  | "pious"
  | "cynical"
  | "wise"
  | "foolish"
  | "scholarly"
  | "charismatic"
  | "shy"
  | "greedy"
  | "generous"
  | "sickly"
  | "strong"
  | "mad"
  | "cunning"
  | "honest"
  | "builder"
  | "warlike"
  | "peaceful";

export type DeathCause =
  | "natural"
  | "illness"
  | "plague"
  | "battle"
  | "assassinated"
  | "executed"
  | "accident"
  | "childbirth"
  | "infancy"
  | "disaster"
  | "unknown";

export type RoleKind =
  | "ruler"
  | "heir"
  | "consort"
  | "regent"
  | "general"
  | "admiral"
  | "prophet"
  | "highPriest"
  | "founder"
  | "scholar"
  | "poet"
  | "builder"
  | "explorer"
  | "rebel"
  | "pretender";

export interface Role {
  kind: RoleKind;
  polity: Id;
  religion: Id;
  from: number;
  to: number;
}

export interface Person {
  id: Id;
  name: WName;
  sex: Sex;
  born: number;
  died: number;
  deathCause: DeathCause;
  /** Settlement or -1. */
  deathPlace: Id;
  father: Id;
  mother: Id;
  spouses: Id[];
  children: Id[];
  dynasty: Id;
  culture: Id;
  religion: Id;
  traits: Trait[];
  /** Posthumous English epithet, e.g. "the Bold", or "". */
  epithet: string;
  /** Regnal number (1 = first of that name in that realm; display "II" only when > 1 or later reused). */
  regnal: number;
  roles: Role[];
  /** Event ids in which this person is a principal actor. */
  deeds: Id[];
}

export interface Dynasty {
  id: Id;
  name: WName;
  founder: Id;
  /** Seat settlement, or -1. */
  seat: Id;
  /** Parent dynasty for cadet branches, or -1. */
  parent: Id;
  culture: Id;
  emblem: Emblem;
  motto?: Utterance;
  founded: number;
  /** Year the last member died, or -1. */
  extinct: number;
  polities: Id[];
}

// ---------------------------------------------------------------------------
// Belief
// ---------------------------------------------------------------------------

export type ReligionKind = "folk" | "pantheon" | "monotheism" | "dualism" | "philosophy" | "mystery" | "ancestor";

export interface Religion {
  id: Id;
  name: WName;
  /** English name for prose, e.g. "the Faith of the Burning Star" or "Oshanism". */
  english: string;
  kind: ReligionKind;
  parent: Id;
  children: Id[];
  founded: number;
  ended: number;
  founder: Id;
  /** Holy city settlement, or -1. */
  holyCity: Id;
  culture: Id;
  deities: Id[];
  /** Tenet keys (narrative turns them into prose). */
  tenets: string[];
  symbol: EmblemConcept;
  /** Title of clergy in the faith's language. */
  clergy?: WName;
  /** Sacred text, a Work id or -1. */
  scripture: Id;
  color: RGB;
  emblem?: Emblem;
}

export type DeityDomain =
  | "sky" | "sun" | "moon" | "stars" | "storm" | "sea" | "river" | "mountain" | "earth" | "harvest"
  | "war" | "death" | "fire" | "forge" | "love" | "wisdom" | "trickery" | "hunt" | "healing"
  | "home" | "travel" | "fate" | "night" | "dawn" | "wine" | "beasts" | "underworld" | "creation";

export interface Deity {
  id: Id;
  name: WName;
  religion: Id;
  domains: DeityDomain[];
  sex: Sex | "none";
  /** English epithets, e.g. "the Shepherd of Storms". */
  epithets: string[];
  symbol: EmblemConcept;
  /** Geographic feature this deity embodies (a specific river/mountain), or -1. */
  feature: Id;
  parents: Id[];
  consort: Id;
  children: Id[];
}

/** Structured myth; the narrative engine renders it to prose. */
export interface Myth {
  id: Id;
  religion: Id;
  kind: "creation" | "flood" | "originOfPeople" | "deed" | "hero" | "endOfWorld" | "founding";
  actors: Id[]; // deity ids (or person ids for "hero"/"founding", see data)
  features: Id[]; // geographic features involved
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Conflict
// ---------------------------------------------------------------------------

export type CasusBelli =
  | "conquest"
  | "succession"
  | "holyWar"
  | "independence"
  | "revenge"
  | "trade"
  | "raid"
  | "reconquest"
  | "civilWar"
  | "subjugation";

export type WarOutcome = "attackerVictory" | "defenderVictory" | "whitePeace" | "stalemate" | "ongoing";

export interface War {
  id: Id;
  /** English name, chosen by the simulation from its course (e.g. "the War of the Salt Marshes"). */
  name: string;
  casusBelli: CasusBelli;
  attackers: Id[];
  defenders: Id[];
  /** Polities that joined later, with the side and year they joined. */
  joined: { polity: Id; side: "attacker" | "defender"; year: number }[];
  start: number;
  end: number;
  outcome: WarOutcome;
  battles: Id[];
  /** Settlements that changed hands at the peace. */
  transfers: { settlement: Id; from: Id; to: Id }[];
  /** Peace treaty name (e.g. "the Peace of Tor Oshen"), or "". */
  treaty: string;
  /** Settlement where peace was signed, or -1. */
  treatySite: Id;
  casualties: number;
  /** Person who claimed the throne in a succession war, etc. */
  claimant: Id;
}

export interface Battle {
  id: Id;
  war: Id;
  year: number;
  kind: "field" | "siege" | "naval" | "ambush" | "sack";
  /** English name, e.g. "Battle of the Velm Ford". */
  name: string;
  cell: number;
  /** Settlement nearest/at the site, or -1. */
  site: Id;
  /** Geographic feature the battle is named after, or -1. */
  feature: Id;
  attacker: { polity: Id; commander: Id; strength: number; losses: number };
  defender: { polity: Id; commander: Id; strength: number; losses: number };
  /** "attacker" | "defender" | "draw". */
  victor: "attacker" | "defender" | "draw";
  /** Notable persons killed. */
  slain: Id[];
}

// ---------------------------------------------------------------------------
// Works & things
// ---------------------------------------------------------------------------

export type WonderKind =
  | "temple" | "palace" | "wall" | "library" | "lighthouse" | "colossus" | "bridge" | "canal"
  | "tomb" | "observatory" | "arena" | "aqueduct" | "cathedral" | "harbor" | "academy" | "garden" | "fortress";

export interface Wonder {
  id: Id;
  kind: WonderKind;
  /** Native name (if any) and English name for prose. */
  name: WName;
  english: string;
  settlement: Id;
  builder: Id;
  /** Polity that built it. */
  polity: Id;
  begun: number;
  completed: number;
  destroyed: number;
  destroyCause?: "war" | "earthquake" | "fire" | "decay" | "flood";
  /** Deity/religion dedication, or -1. */
  religion: Id;
}

export type WorkKind = "epic" | "chronicle" | "scripture" | "treatise" | "poem" | "lawCode" | "map" | "hymn" | "play";

export interface Work {
  id: Id;
  kind: WorkKind;
  title: WName;
  english: string;
  author: Id;
  year: number;
  lang: Id;
  /** What it is about: event / person / polity / war ids (typed by `subjectKind`). */
  subjectKind: "event" | "person" | "polity" | "war" | "religion" | "none";
  subject: Id;
  /** Lost works survive only by reputation. */
  lost: boolean;
  /** An opening line in the original language with translation, if generated. */
  incipit?: Utterance;
}

export interface TradeRoute {
  id: Id;
  kind: "land" | "river" | "sea";
  name: string;
  from: Id;
  to: Id;
  /** Cells along the route. */
  path: number[];
  goods: string[];
  founded: number;
  ended: number;
}

export interface Disaster {
  id: Id;
  kind: "plague" | "eruption" | "earthquake" | "flood" | "famine" | "drought" | "fire" | "tsunami";
  /** English name if it earned one, e.g. "the Grey Death". */
  name: string;
  start: number;
  end: number;
  cell: number;
  deaths: number;
  settlements: Id[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventType =
  // founding & growth
  | "settlementFounded" | "settlementAbandoned" | "settlementGrew" | "colonyFounded" | "portFounded" | "wallsBuilt"
  | "settlementRenamed" | "capitalMoved" | "polityRenamed"
  // realms
  | "polityFounded" | "polityUnified" | "governmentChanged" | "polityCollapsed" | "polityAnnexed" | "independence"
  | "vassalized" | "vassalFreed" | "union" | "partition"
  // rulers & dynasties
  | "birth" | "death" | "marriage" | "accession" | "abdication" | "deposition" | "regency" | "dynastyFounded"
  | "successionCrisis" | "assassination" | "usurpation" | "coup"
  // conflict
  | "warDeclared" | "warJoined" | "battle" | "siege" | "conquest" | "sack" | "peace" | "rebellion" | "revoltCrushed"
  | "raid" | "massacre" | "alliance" | "allianceBroken"
  // belief
  | "religionFounded" | "prophetBorn" | "conversion" | "stateReligion" | "schism" | "heresySuppressed" | "templeBuilt"
  | "pilgrimage" | "miracle"
  // culture & knowledge
  | "cultureSplit" | "languageSplit" | "languageEvolved" | "languageShift" | "scriptInvented" | "scriptAdopted" | "invention" | "techSpread"
  | "workWritten" | "wonderBuilt" | "wonderDestroyed" | "goldenAge" | "darkAge" | "featureNamed" | "firstContact"
  | "exploration" | "migration"
  // economy & nature
  | "tradeRouteOpened" | "tradeRouteClosed" | "plague" | "famine" | "earthquake" | "eruption" | "flood" | "drought";

export interface HEvent {
  id: Id;
  year: number;
  type: EventType;
  /** 1 (trivia) … 5 (world-historical). The chronicle filters on this. */
  importance: number;
  /** Primary location cell, or -1. */
  cell: number;
  /** Cross-references, for linking and filtering. Omit empty arrays. */
  polities?: Id[];
  persons?: Id[];
  settlements?: Id[];
  cultures?: Id[];
  religions?: Id[];
  wars?: Id[];
  battles?: Id[];
  dynasties?: Id[];
  wonders?: Id[];
  works?: Id[];
  disasters?: Id[];
  features?: Id[];
  languages?: Id[];
  scripts?: Id[];
  /** Type-specific details (documented next to each emitter in src/history). */
  data?: Record<string, unknown>;
}

/**
 * The `data` payload of each event type. Every event also carries the generic
 * cross-reference arrays of `HEvent` (polities, persons, …); `data` says which
 * role each referenced entity played. All values are plain JSON.
 *
 * Common conventions: `polity`/`settlement`/`person` fields are ids; `-1`
 * means none; names are not repeated here (look them up at `event.year` with
 * the helpers in ./query.ts) except where the event itself is about a name.
 */
export interface EventData {
  settlementFounded: {
    settlement: Id; culture: Id; polity: Id; mother: Id; founder: Id;
    /** Built on the ruins of this settlement, or -1. */
    ruinsOf: Id;
    /** Concept ids describing the site (river, ford, coast, oak, salt…). */
    site: string[];
    /** One of the first settlements of a people (year-0 hearths). */
    hearth: boolean;
  };
  colonyFounded: EventData["settlementFounded"] & { across: "sea" | "lake"; landmass: Id; distanceKm: number };
  settlementAbandoned: { settlement: Id; cause: "decline" | "sacked" | "disaster" | "plague" | "famine" | "war"; pop: number; polity: Id };
  /** A settlement passed a size milestone ("town" ≥ 5k, "city" ≥ 20k, "great city" ≥ 60k, "metropolis" ≥ 150k). */
  settlementGrew: { settlement: Id; pop: number; rank: "town" | "city" | "great city" | "metropolis"; polity: Id; largestInWorld: boolean };
  portFounded: { settlement: Id; polity: Id };
  wallsBuilt: { settlement: Id; polity: Id; ruler: Id; reason: "war" | "wealth" | "raids" };
  settlementRenamed: { settlement: Id; from: string; to: string; reason: NameChangeReason; polity: Id; culture: Id };
  polityRenamed: { polity: Id; from: string; to: string; reason: NameChangeReason };
  capitalMoved: { polity: Id; from: Id; to: Id; reason: "lost" | "growth" | "conquest" | "disaster" };

  polityFounded: {
    polity: Id; capital: Id; founder: Id; gov: Government; culture: Id;
    how: "chiefdom" | "secession" | "rebellion" | "successor" | "colony" | "migration" | "faction" | "restoration";
    /** Polity it broke away from / succeeded, or -1. */
    parent: Id;
  };
  polityUnified: { polity: Id; members: Id[]; how: "confederation" | "conquest" | "marriage" };
  governmentChanged: { polity: Id; from: Government; to: Government; reason: string };
  polityCollapsed: { polity: Id; successors: Id[]; causes: string[]; peakAreaKm2: number; age: number };
  polityAnnexed: { polity: Id; by: Id; war: Id; last: Id };
  independence: { polity: Id; from: Id; war: Id };
  vassalized: { vassal: Id; overlord: Id; war: Id };
  vassalFreed: { vassal: Id; overlord: Id; reason: "war" | "decline" | "overlordFell" };
  union: { senior: Id; junior: Id; ruler: Id; kind: "personal" | "merger" };
  partition: { polity: Id; among: Id[] };

  birth: { person: Id; father: Id; mother: Id; polity: Id };
  death: { person: Id; age: number; cause: DeathCause; polity: Id; ruler: boolean; place: Id; killer: Id };
  marriage: { a: Id; b: Id; polities: Id[]; alliance: boolean };
  accession: {
    person: Id; polity: Id; predecessor: Id; age: number;
    how: SuccessionLaw | "founding" | "usurpation" | "conquest" | "claim" | "restoration" | "union";
    /** "Oshar III" at the time (epithets are posthumous; see Person.epithet). */
    regnalName: string;
    relation: string;
  };
  abdication: { person: Id; polity: Id; successor: Id; reason: string };
  deposition: { person: Id; polity: Id; by: Id };
  regency: { regent: Id; ward: Id; polity: Id };
  dynastyFounded: { dynasty: Id; founder: Id; polity: Id; parent: Id };
  successionCrisis: { polity: Id; deceased: Id; claimants: Id[] };
  assassination: { victim: Id; polity: Id; culprit: Id; motive: string };
  usurpation: { usurper: Id; deposed: Id; polity: Id; dynasty: Id };
  coup: { polity: Id; leader: Id; from: Government; to: Government };

  warDeclared: { war: Id; casusBelli: CasusBelli; attacker: Id; defender: Id; claimant: Id; targets: Id[] };
  warJoined: { war: Id; polity: Id; side: "attacker" | "defender"; reason: "alliance" | "overlord" | "kin" | "faith" };
  battle: { war: Id; battle: Id; victor: Id; loser: Id; kind: Battle["kind"]; attackerLosses: number; defenderLosses: number; decisive: boolean };
  siege: { war: Id; battle: Id; settlement: Id; besieger: Id; defender: Id; outcome: "taken" | "repulsed"; walls: boolean };
  conquest: { settlement: Id; from: Id; to: Id; war: Id };
  sack: { settlement: Id; by: Id; war: Id; deaths: number; destroyed: boolean };
  peace: { war: Id; treaty: string; site: Id; outcome: WarOutcome; transfers: number; years: number };
  rebellion: { rebels: Id; against: Id; settlements: Id[]; leader: Id; cause: string };
  revoltCrushed: { rebels: Id; polity: Id; leader: Id };
  raid: { raider: Id; target: Id; settlement: Id; plunder: number; bySea: boolean };
  massacre: { settlement: Id; by: Id; deaths: number; reason: string };
  alliance: { a: Id; b: Id; reason: "marriage" | "faith" | "kin" | "threat" };
  allianceBroken: { a: Id; b: Id; reason: string };

  religionFounded: { religion: Id; founder: Id; holyCity: Id; kind: ReligionKind; parent: Id };
  prophetBorn: { person: Id; religion: Id };
  conversion: { polity: Id; ruler: Id; from: Id; to: Id };
  stateReligion: { polity: Id; religion: Id; from: Id };
  schism: { religion: Id; parent: Id; founder: Id; issue: string; center: Id };
  heresySuppressed: { religion: Id; heresy: Id; polity: Id; ruler: Id };
  templeBuilt: { wonder: Id; religion: Id; deity: Id; settlement: Id };
  pilgrimage: { person: Id; religion: Id; holyCity: Id };
  miracle: { religion: Id; settlement: Id; kind: string };

  cultureSplit: { culture: Id; parent: Id; language: Id; cause: "distance" | "sea" | "realm" };
  languageSplit: { language: Id; parent: Id; culture: Id };
  languageEvolved: { language: Id; previous: Id; culture: Id; renamedPlaces: number };
  languageShift: { culture: Id; from: Id; settlements: Id[]; polity: Id; cause: "conquest" | "migration" | "prestige" };
  scriptInvented: { script: Id; culture: Id; settlement: Id; person: Id };
  scriptAdopted: { script: Id; source: Id; culture: Id; via: "neighbours" | "trade" | "conquest" | "faith" };
  invention: { tech: string; level: number; culture: Id; settlement: Id; person: Id; first: boolean };
  techSpread: { tech: string; level: number; culture: Id; from: Id };
  workWritten: { work: Id; author: Id; kind: WorkKind };
  wonderBuilt: { wonder: Id; kind: WonderKind; polity: Id; builder: Id; settlement: Id; years: number };
  wonderDestroyed: { wonder: Id; cause: NonNullable<Wonder["destroyCause"]>; by: Id };
  goldenAge: { polity: Id; ruler: Id; reasons: string[] };
  darkAge: { polity: Id; reasons: string[] };
  featureNamed: { feature: Id; culture: Id; name: string; gloss: string; first: boolean };
  firstContact: { a: Id; b: Id; settlementA: Id; settlementB: Id };
  exploration: { person: Id; polity: Id; from: Id; landmass: Id };
  migration: { culture: Id; polity: Id; from: number; to: number; settlements: Id[]; cause: string };

  tradeRouteOpened: { route: Id; from: Id; to: Id; goods: string[]; kind: TradeRoute["kind"] };
  tradeRouteClosed: { route: Id; reason: string };
  plague: { disaster: Id; origin: Id; deaths: number; settlements: number; phase: "outbreak" | "arrival" | "end" };
  famine: { disaster: Id; deaths: number; cause: string };
  earthquake: { disaster: Id; deaths: number; settlement: Id; magnitude: number };
  eruption: { disaster: Id; deaths: number; feature: Id; vei: number };
  flood: { disaster: Id; deaths: number; feature: Id; settlement: Id };
  drought: { disaster: Id; deaths: number; cause: string };
}

/** Compile-time guarantee that every EventType has its data documented above. */
export type AllEventDataDocumented = { [K in EventType]: EventData[K] };

// ---------------------------------------------------------------------------
// Timeline (for scrubbing map layers through time)
// ---------------------------------------------------------------------------

/**
 * A per-cell integer layer through time, stored as keyframes + diffs.
 * Snapshot s describes year `s * timeline.step`. Snapshot s is reconstructed
 * from keyframe floor(s / keyEvery) followed by diffs up to s.
 */
export interface LayerTimeline {
  /** Full per-cell arrays (value or -1), one per `keyEvery` snapshots. */
  keyframes: Int32Array[];
  /** For each snapshot s: cells whose value changed since snapshot s-1, and their new values. */
  diffCells: Int32Array[];
  diffValues: Int32Array[];
}

export interface Timeline {
  step: number;
  keyEvery: number;
  snapshots: number;
  /** Owning polity per land cell. */
  owner: LayerTimeline;
  /** Dominant culture per land cell. */
  culture: LayerTimeline;
  /** Dominant religion per land cell. */
  religion: LayerTimeline;
}

// ---------------------------------------------------------------------------
// The whole history
// ---------------------------------------------------------------------------

export interface History {
  endYear: number;
  /** Years between samples of population/stat series. */
  sampleStep: number;
  cultures: Culture[];
  languages: Language[];
  scripts: Script[];
  settlements: Settlement[];
  polities: Polity[];
  persons: Person[];
  dynasties: Dynasty[];
  religions: Religion[];
  deities: Deity[];
  myths: Myth[];
  wars: War[];
  battles: Battle[];
  wonders: Wonder[];
  works: Work[];
  tradeRoutes: TradeRoute[];
  disasters: Disaster[];
  featureNames: FeatureNaming[];
  events: HEvent[];
  timeline: Timeline;
  /** Named ages of world history, derived after the simulation (e.g. "the Age of Bronze Kings"). */
  ages: { name: string; start: number; end: number; summary: string }[];
  /** World-wide series sampled every `sampleStep` years (index k ↔ year k * sampleStep). */
  worldStats: {
    pop: number[];
    settlements: number[];
    /** Independent polities. */
    polities: number[];
    /** Wars in progress. */
    wars: number[];
    /** Global temperature anomaly, °C (cold and warm centuries). */
    climate: number[];
    /** Highest technology level reached by any people. */
    tech: number[];
  };
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

/** Small payload streamed every ~10 simulated years for the "history unfolding" preview. */
export interface LiveSnapshot {
  year: number;
  endYear: number;
  /** Owning polity per cell (copy; -1 = none). */
  owner: Int32Array;
  /** Colour and current core name of every polity present in `owner`. */
  polities: Record<number, { color: RGB; name: string }>;
  /** The most important events since the previous snapshot (≤ 6), with a plain one-line headline. */
  events: { event: HEvent; headline: string }[];
  stats: { settlements: number; polities: number; pop: number; wars: number };
}

/** Typed view of an event's data (the payload is stored untyped in `HEvent.data`). */
export type EventDataOf<K extends EventType> = EventData[K];
