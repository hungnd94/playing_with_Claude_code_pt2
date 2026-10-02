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
  culture: Id;
  /** The language engine's serialisable language object. */
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
  /** Population sampled every `history.sampleStep` years starting at sample index `popStart`. */
  popStart: number;
  pop: number[];
  cultures: { year: number; culture: Id }[];
  religions: { year: number; religion: Id }[];
  owners: { year: number; polity: Id }[];
  port: boolean;
  /** Year walls were raised, or -1. */
  walled: number;
  wonders: Id[];
  /** Free-form distinctions, e.g. "holy city", "seat of learning". */
  tags: string[];
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

export interface Polity {
  id: Id;
  /** Core name over time (e.g. "Ashkar"); prose builds titles like "Kingdom of Ashkar" from this + government. */
  names: NameRecord[];
  governments: { year: number; gov: Government }[];
  founded: number;
  ended: number;
  endReason?: PolityEndReason;
  /** Founding person, or -1. */
  founder: Id;
  predecessors: Id[];
  successors: Id[];
  capitals: { year: number; settlement: Id }[];
  culture: Id;
  religions: { year: number; religion: Id }[];
  /** Ruler sequence (persons), including regents/elected heads. */
  rulers: { person: Id; from: number; to: number }[];
  /** Overlord over time (-1 = independent). */
  overlords: { year: number; overlord: Id }[];
  emblem: Emblem;
  /** Flag data from the heraldry module, if any. */
  flag?: unknown;
  motto?: Utterance;
  color: RGB;
  wars: Id[];
  /** Series sampled every `history.sampleStep` years from sample index `statStart`. */
  statStart: number;
  stats: { pop: number[]; areaKm2: number[]; settlements: number[]; strength: number[] };
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
  | "settlementRenamed" | "capitalMoved"
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
  | "cultureSplit" | "languageSplit" | "languageShift" | "scriptInvented" | "scriptAdopted" | "invention" | "techSpread"
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
}
