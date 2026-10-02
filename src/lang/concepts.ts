/**
 * The concept list: every language has a word for each of these.
 *
 * A concept is a language-independent meaning with an English gloss. Concepts
 * carry a part of speech, a "tier" (1 = core vocabulary, short roots; 3 = rarer,
 * longer roots), tags used by the naming engine, English morphology for the
 * mini-grammar's translations, and optional derivation recipes ("sea" may be
 * coined as great+water in some languages, "queen" as king+FEM, "temple" as
 * god+house), which gives lexicons internal structure and etymologies.
 *
 * Every entry of EMBLEM_CONCEPTS (src/world/concepts.ts) is present.
 */
import { EMBLEM_CONCEPTS } from "../world/concepts";

export type PartOfSpeech = "n" | "v" | "adj" | "num" | "pron" | "func";

/**
 * Recipes: "cmp:a+b" compound (a modifies b), "dim:a" diminutive, "aug:a"
 * augmentative, "fem:a" feminine, "agt:a" agent noun, "abs:a" abstract noun,
 * "plc:a" place noun.
 */
export interface Concept {
  id: string;
  pos: PartOfSpeech;
  /** 1 core … 3 rare. Drives root length. */
  tier: 1 | 2 | 3;
  tags: string[];
  /** English gloss (defaults to id). */
  en: string;
  /** Irregular English plural (nouns). */
  pl?: string;
  /** Irregular English past tense (verbs). */
  past?: string;
  /** Irregular English 3rd person singular (verbs). */
  s3?: string;
  /** Mass noun in English ("iron", "water"): no article / plural. */
  mass?: boolean;
  /** Optional derivation recipes, one of which a language may use instead of a root. */
  recipes?: string[];
}

type Row = [id: string, pos: PartOfSpeech, tier: 1 | 2 | 3, tags: string, extra?: Partial<Concept>];

// Tag glossary:
//   geo       landscape noun            water   watery thing
//   head      settlement-name head      feat    natural-feature head
//   mod       good place-name modifier  name    personal-name element
//   fem       feminine name element     deity   deity domain
//   beast/bird/plant/tree/crop          sky/elem/time/season
//   color/qual/dir/num                  person/kin/role
//   body/abstract/virtue/material/object/weapon/tool/build
//   animate   can be an agent           temp/size/salt descriptors
const ROWS: Row[] = [
  // ---- landscape & water ----
  ["river", "n", 1, "geo water feat head mod"],
  ["stream", "n", 2, "geo water feat head", { recipes: ["dim:river"] }],
  ["lake", "n", 1, "geo water feat head mod", { recipes: ["cmp:still+water"] }],
  ["sea", "n", 1, "geo water feat mod deity name", { recipes: ["cmp:great+water", "cmp:salt+water"] }],
  ["ocean", "n", 3, "geo water feat", { recipes: ["aug:sea", "cmp:great+sea"] }],
  ["bay", "n", 2, "geo water feat head"],
  ["island", "n", 1, "geo feat head mod", { recipes: ["cmp:water+land", "cmp:sea+land"] }],
  ["mountain", "n", 1, "geo feat head mod"],
  ["hill", "n", 1, "geo feat head mod", { recipes: ["dim:mountain"] }],
  ["peak", "n", 2, "geo feat head", { recipes: ["cmp:mountain+head"] }],
  ["valley", "n", 1, "geo feat head mod"],
  ["forest", "n", 1, "geo feat head mod"],
  ["wood", "n", 1, "geo material head mod", { mass: true }],
  ["plain", "n", 2, "geo feat head"],
  ["field", "n", 1, "geo head mod"],
  ["meadow", "n", 2, "geo head mod", { recipes: ["dim:field"] }],
  ["marsh", "n", 2, "geo feat head mod"],
  ["desert", "n", 2, "geo feat head", { recipes: ["cmp:dry+land", "cmp:empty+land"] }],
  ["sand", "n", 1, "geo material mod", { mass: true }],
  ["stone", "n", 1, "geo material mod head name"],
  ["rock", "n", 1, "geo feat head mod"],
  ["cliff", "n", 2, "geo feat head"],
  ["cave", "n", 2, "geo head mod"],
  ["spring", "n", 2, "geo water head mod", { recipes: ["cmp:water+eye"] }],
  ["well", "n", 2, "geo water head build"],
  ["ford", "n", 2, "geo water head"],
  ["bridge", "n", 2, "build head object"],
  ["harbor", "n", 2, "geo water head build", { recipes: ["cmp:ship+home", "cmp:ship+bay"] }],
  ["coast", "n", 2, "geo head"],
  ["shore", "n", 2, "geo water head"],
  ["cape", "n", 2, "geo feat head", { recipes: ["cmp:land+head"] }],
  ["ice", "n", 1, "geo elem mod temp", { mass: true }],
  ["snow", "n", 1, "elem mod temp", { mass: true }],
  ["land", "n", 1, "geo head"],
  ["earth", "n", 1, "geo elem deity", { mass: true }],
  ["clay", "n", 2, "material", { mass: true }],
  ["road", "n", 1, "geo head build"],
  ["path", "n", 2, "geo"],
  ["pass", "n", 2, "geo head", { pl: "passes" }],
  ["gorge", "n", 3, "geo head"],
  ["waterfall", "n", 3, "geo water head", { recipes: ["cmp:white+water", "cmp:fall+water"] }],
  ["mouth", "n", 1, "body geo head"],
  ["dune", "n", 3, "geo"],
  ["oasis", "n", 3, "geo water head", { pl: "oases" }],
  ["heath", "n", 3, "geo head mod", { mass: true }],
  ["reef", "n", 3, "geo water"],
  ["strait", "n", 3, "geo water feat", { recipes: ["cmp:narrow+water"] }],
  ["shallows", "n", 3, "geo water", { pl: "shallows" }],
  ["volcano", "n", 3, "geo feat", { recipes: ["cmp:fire+mountain"], pl: "volcanoes" }],
  ["glacier", "n", 3, "geo feat", { recipes: ["cmp:ice+river"] }],
  ["mound", "n", 2, "geo head mod"],
  ["grove", "n", 2, "geo head mod", { recipes: ["dim:forest"] }],
  ["water", "n", 1, "elem water mod", { mass: true }],
  ["place", "n", 1, "head"],
  ["side", "n", 2, "geo"],
  ["deep", "n", 2, "geo water", { en: "deep" }],
  ["salt", "n", 1, "material mod salt", { mass: true }],

  // ---- settlements & works ----
  ["town", "n", 1, "build head"],
  ["city", "n", 2, "build head", { pl: "cities", recipes: ["aug:town", "cmp:great+town"] }],
  ["village", "n", 2, "build head", { recipes: ["dim:town", "dim:house"] }],
  ["fort", "n", 2, "build head", { recipes: ["cmp:wall+place"] }],
  ["castle", "n", 2, "build head object"],
  ["tower", "n", 2, "build head object"],
  ["wall", "n", 1, "build head"],
  ["gate", "n", 1, "build head"],
  ["market", "n", 2, "build head", { recipes: ["plc:trade"] }],
  ["temple", "n", 2, "build head", { recipes: ["cmp:god+house"] }],
  ["shrine", "n", 3, "build head", { recipes: ["dim:temple"] }],
  ["hall", "n", 2, "build head"],
  ["house", "n", 1, "build head"],
  ["home", "n", 1, "build head name"],
  ["farm", "n", 2, "build head"],
  ["mill", "n", 3, "build head", { recipes: ["cmp:water+wheel"] }],
  ["camp", "n", 2, "build head"],
  ["palace", "n", 3, "build head", { recipes: ["cmp:king+house", "aug:house"] }],
  ["tomb", "n", 3, "build head", { recipes: ["cmp:death+house", "cmp:stone+house"] }],
  ["garden", "n", 2, "build head"],
  ["stead", "n", 2, "build head", { en: "stead" }],
  ["throne", "n", 3, "object"],
  ["seat", "n", 2, "object head"],

  // ---- plants ----
  ["tree", "n", 1, "plant mod"],
  ["oak", "n", 2, "plant tree mod name"],
  ["pine", "n", 2, "plant tree mod"],
  ["ash", "n", 2, "plant tree mod name", { pl: "ash trees" }],
  ["birch", "n", 2, "plant tree mod", { pl: "birches" }],
  ["yew", "n", 3, "plant tree mod"],
  ["willow", "n", 2, "plant tree mod"],
  ["cedar", "n", 3, "plant tree mod"],
  ["palm", "n", 3, "plant tree mod"],
  ["apple", "n", 2, "plant crop mod"],
  ["vine", "n", 2, "plant crop mod"],
  ["olive", "n", 3, "plant crop mod"],
  ["rose", "n", 2, "plant mod fem"],
  ["lily", "n", 3, "plant mod fem", { pl: "lilies" }],
  ["reed", "n", 2, "plant mod"],
  ["grass", "n", 1, "plant mod", { mass: true }],
  ["flower", "n", 2, "plant fem"],
  ["leaf", "n", 1, "plant", { pl: "leaves" }],
  ["root", "n", 1, "plant"],
  ["seed", "n", 2, "plant crop"],
  ["thorn", "n", 2, "plant mod"],
  ["moss", "n", 3, "plant mod", { mass: true }],
  ["wheat", "n", 2, "plant crop mod deity", { mass: true }],
  ["barley", "n", 2, "plant crop mod", { mass: true }],
  ["rice", "n", 2, "plant crop mod", { mass: true }],
  ["berry", "n", 2, "plant", { pl: "berries" }],

  // ---- beasts ----
  ["wolf", "n", 1, "beast animate mod name", { pl: "wolves" }],
  ["bear", "n", 1, "beast animate mod name"],
  ["lion", "n", 2, "beast animate mod name"],
  ["eagle", "n", 2, "bird beast animate mod name"],
  ["raven", "n", 2, "bird beast animate mod name"],
  ["falcon", "n", 2, "bird beast animate mod name"],
  ["owl", "n", 2, "bird beast animate mod", { recipes: ["cmp:night+bird"] }],
  ["swan", "n", 2, "bird beast animate mod name fem"],
  ["stag", "n", 2, "beast animate mod name"],
  ["deer", "n", 1, "beast animate mod", { pl: "deer" }],
  ["boar", "n", 2, "beast animate mod name"],
  ["horse", "n", 1, "beast animate mod name"],
  ["bull", "n", 2, "beast animate mod name"],
  ["ox", "n", 2, "beast animate mod", { pl: "oxen" }],
  ["cow", "n", 1, "beast animate mod"],
  ["sheep", "n", 1, "beast animate mod", { pl: "sheep" }],
  ["goat", "n", 2, "beast animate mod"],
  ["dog", "n", 1, "beast animate mod"],
  ["fox", "n", 2, "beast animate mod", { pl: "foxes" }],
  ["hare", "n", 2, "beast animate mod"],
  ["serpent", "n", 2, "beast animate mod name"],
  ["dragon", "n", 3, "beast animate mod name", { recipes: ["cmp:fire+serpent", "aug:serpent"] }],
  ["fish", "n", 1, "beast animate mod", { pl: "fish" }],
  ["whale", "n", 3, "beast animate mod", { recipes: ["aug:fish", "cmp:great+fish"] }],
  ["seal", "n", 3, "beast animate mod", { recipes: ["cmp:sea+dog"] }],
  ["bee", "n", 2, "beast animate mod"],
  ["crane", "n", 3, "bird beast animate mod"],
  ["dove", "n", 2, "bird beast animate mod fem"],
  ["heron", "n", 3, "bird beast animate mod"],
  ["otter", "n", 3, "beast animate mod", { recipes: ["cmp:water+dog"] }],
  ["elk", "n", 3, "beast animate mod"],
  ["camel", "n", 3, "beast animate mod"],
  ["elephant", "n", 3, "beast animate mod"],
  ["tiger", "n", 3, "beast animate mod name"],
  ["bird", "n", 1, "bird beast animate mod"],
  ["horse-herd", "n", 3, "beast", { en: "herd", recipes: ["cmp:horse+people"] }],

  // ---- sky, elements, time ----
  ["sun", "n", 1, "sky deity mod name"],
  ["moon", "n", 1, "sky deity mod name fem"],
  ["star", "n", 1, "sky deity mod name fem"],
  ["sky", "n", 1, "sky deity mod", { pl: "skies" }],
  ["cloud", "n", 2, "sky mod"],
  ["rain", "n", 1, "sky elem deity mod", { mass: true }],
  ["wind", "n", 1, "sky elem deity mod"],
  ["storm", "n", 2, "sky elem deity mod name"],
  ["thunder", "n", 2, "sky elem deity mod name", { mass: true }],
  ["lightning", "n", 2, "sky elem mod", { mass: true, recipes: ["cmp:sky+fire"] }],
  ["fire", "n", 1, "elem deity mod name"],
  ["flame", "n", 2, "elem mod name"],
  ["smoke", "n", 2, "elem mod", { mass: true }],
  ["ashes", "n", 2, "elem", { en: "ash", mass: true }],
  ["light", "n", 1, "sky elem mod name fem", { mass: true }],
  ["shadow", "n", 2, "sky mod"],
  ["night", "n", 1, "time deity mod"],
  ["day", "n", 1, "time"],
  ["dawn", "n", 2, "time deity mod fem", { recipes: ["cmp:sun+rise"] }],
  ["evening", "n", 2, "time mod"],
  ["year", "n", 1, "time"],
  ["winter", "n", 1, "time season mod deity"],
  ["summer", "n", 1, "time season mod fem"],
  ["springtime", "n", 2, "time season fem", { en: "spring" }],
  ["autumn", "n", 2, "time season"],
  ["frost", "n", 2, "elem mod temp", { mass: true }],
  ["mist", "n", 2, "elem mod", { mass: true }],
  ["rainbow", "n", 3, "sky", { recipes: ["cmp:rain+bow", "cmp:sky+bow"] }],
  ["wave", "n", 2, "water elem mod name"],
  ["tide", "n", 3, "water"],
  ["time", "n", 2, "abstract", { mass: true }],

  // ---- colours ----
  ["white", "adj", 1, "color mod name"],
  ["black", "adj", 1, "color mod"],
  ["red", "adj", 1, "color mod name"],
  ["green", "adj", 1, "color mod"],
  ["blue", "adj", 2, "color mod"],
  ["yellow", "adj", 2, "color mod"],
  ["grey", "adj", 2, "color mod"],
  ["brown", "adj", 2, "color mod"],
  ["golden", "adj", 3, "color mod name", { recipes: ["adj:gold"] }],

  // ---- qualities ----
  ["great", "adj", 1, "qual size mod name"],
  ["small", "adj", 1, "qual size mod"],
  ["old", "adj", 1, "qual mod"],
  ["new", "adj", 1, "qual mod"],
  ["young", "adj", 1, "qual mod"],
  ["high", "adj", 1, "qual mod name"],
  ["low", "adj", 2, "qual mod"],
  ["deep.adj", "adj", 1, "qual mod", { en: "deep" }],
  ["long", "adj", 1, "qual size mod"],
  ["broad", "adj", 2, "qual size mod"],
  ["narrow", "adj", 2, "qual size mod"],
  ["cold", "adj", 1, "qual temp mod"],
  ["hot", "adj", 1, "qual temp mod"],
  ["holy", "adj", 2, "qual mod name"],
  ["bright", "adj", 2, "qual mod name fem"],
  ["dark", "adj", 1, "qual mod"],
  ["swift", "adj", 2, "qual mod name"],
  ["slow", "adj", 2, "qual mod"],
  ["strong", "adj", 1, "qual mod name"],
  ["fair", "adj", 2, "qual mod name fem"],
  ["wild", "adj", 2, "qual mod"],
  ["far", "adj", 2, "qual mod"],
  ["near", "adj", 2, "qual mod"],
  ["good", "adj", 1, "qual mod name"],
  ["evil", "adj", 2, "qual mod"],
  ["true", "adj", 2, "qual mod name"],
  ["wise", "adj", 2, "qual mod name"],
  ["bold", "adj", 2, "qual mod name"],
  ["proud", "adj", 3, "qual mod"],
  ["sweet", "adj", 2, "qual mod fem"],
  ["bitter", "adj", 2, "qual mod"],
  ["rich", "adj", 2, "qual mod"],
  ["full", "adj", 2, "qual"],
  ["empty", "adj", 2, "qual mod"],
  ["still", "adj", 2, "qual mod", { en: "still" }],
  ["hidden", "adj", 3, "qual mod"],
  ["free", "adj", 2, "qual mod name"],
  ["noble", "adj", 2, "qual mod name"],
  ["fierce", "adj", 2, "qual mod name"],
  ["gentle", "adj", 2, "qual mod fem"],
  ["dry", "adj", 1, "qual mod"],
  ["wet", "adj", 2, "qual"],
  ["sharp", "adj", 2, "qual mod"],
  ["first", "adj", 2, "qual mod"],
  ["last", "adj", 2, "qual mod"],
  ["lonely", "adj", 3, "qual mod", { en: "lone" }],
  ["eternal", "adj", 3, "qual mod", { recipes: ["cmp:all+day"] }],
  ["dead", "adj", 2, "qual mod"],
  ["silent", "adj", 3, "qual mod"],
  ["beloved", "adj", 2, "qual name fem", { en: "dear" }],
  ["north", "adj", 2, "dir mod"],
  ["south", "adj", 2, "dir mod"],
  ["east", "adj", 2, "dir mod", { recipes: ["cmp:sun+rise"] }],
  ["west", "adj", 2, "dir mod", { recipes: ["cmp:sun+fall"] }],
  ["upper", "adj", 2, "dir mod"],
  ["lower", "adj", 2, "dir mod"],
  ["middle", "adj", 2, "dir mod"],

  // ---- people ----
  ["man", "n", 1, "person animate", { pl: "men" }],
  ["woman", "n", 1, "person animate", { pl: "women" }],
  ["child", "n", 1, "person animate", { pl: "children" }],
  ["person", "n", 2, "person animate"],
  ["people", "n", 1, "person animate name", { en: "people", pl: "peoples" }],
  ["king", "n", 1, "role animate name", { recipes: ["agt:rule"] }],
  ["queen", "n", 2, "role animate fem", { recipes: ["fem:king", "cmp:king+woman"] }],
  ["lord", "n", 1, "role animate name", { recipes: ["cmp:bread+guard"] }],
  ["lady", "n", 2, "role animate fem", { pl: "ladies", recipes: ["fem:lord"] }],
  ["chief", "n", 2, "role animate", { recipes: ["cmp:head+man"] }],
  ["prince", "n", 2, "role animate", { recipes: ["cmp:king+son"] }],
  ["priest", "n", 2, "role animate", { recipes: ["cmp:god+man", "agt:bless"] }],
  ["god", "n", 1, "role animate name deity"],
  ["goddess", "n", 2, "role animate fem", { pl: "goddesses", recipes: ["fem:god"] }],
  ["spirit", "n", 2, "role animate"],
  ["hero", "n", 2, "role animate", { pl: "heroes" }],
  ["warrior", "n", 2, "role animate", { recipes: ["agt:fight", "cmp:war+man"] }],
  ["hunter", "n", 2, "role animate", { recipes: ["agt:hunt"] }],
  ["smith", "n", 2, "role animate deity"],
  ["shepherd", "n", 3, "role animate", { recipes: ["cmp:sheep+man"] }],
  ["farmer", "n", 2, "role animate", { recipes: ["cmp:field+man", "agt:sow"] }],
  ["fisher", "n", 3, "role animate", { recipes: ["cmp:fish+man"] }],
  ["sailor", "n", 3, "role animate", { recipes: ["agt:sail.v", "cmp:sea+man"] }],
  ["merchant", "n", 3, "role animate", { recipes: ["agt:trade"] }],
  ["singer", "n", 3, "role animate", { recipes: ["agt:sing"] }],
  ["sage", "n", 3, "role animate", { recipes: ["cmp:wise+man"] }],
  ["healer", "n", 3, "role animate"],
  ["judge", "n", 3, "role animate"],
  ["stranger", "n", 2, "person animate"],
  ["guest", "n", 2, "person animate name"],
  ["friend", "n", 1, "person animate name", { recipes: ["agt:love"] }],
  ["enemy", "n", 2, "person animate", { pl: "enemies" }],
  ["mother", "n", 1, "kin animate deity"],
  ["father", "n", 1, "kin animate"],
  ["son", "n", 1, "kin animate"],
  ["daughter", "n", 1, "kin animate"],
  ["brother", "n", 1, "kin animate"],
  ["sister", "n", 1, "kin animate"],
  ["wife", "n", 2, "kin animate", { pl: "wives" }],
  ["husband", "n", 2, "kin animate", { recipes: ["cmp:house+lord"] }],
  ["ancestor", "n", 3, "kin animate", { recipes: ["cmp:old+father"] }],
  ["elder", "n", 2, "kin animate", { recipes: ["cmp:old+man"] }],
  ["kin", "n", 2, "kin", { mass: true }],
  ["clan", "n", 2, "kin"],
  ["host", "n", 2, "person", { en: "host" }],

  // ---- body ----
  ["hand", "n", 1, "body name"],
  ["heart", "n", 1, "body name"],
  ["eye", "n", 1, "body"],
  ["head", "n", 1, "body head"],
  ["blood", "n", 1, "body mod", { mass: true }],
  ["bone", "n", 1, "body mod"],
  ["tongue", "n", 2, "body"],
  ["ear", "n", 1, "body"],
  ["hair", "n", 1, "body", { mass: true }],
  ["foot", "n", 1, "body", { pl: "feet" }],
  ["arm", "n", 1, "body name"],
  ["tooth", "n", 1, "body", { pl: "teeth" }],
  ["face", "n", 2, "body"],
  ["breath", "n", 2, "body"],
  ["feather", "n", 2, "body mod"],
  ["wing", "n", 2, "body mod"],
  ["beard", "n", 2, "body"],
  ["claw", "n", 2, "body"],

  // ---- abstract ----
  ["peace", "n", 2, "abstract name", { mass: true }],
  ["war", "n", 1, "abstract deity name", { mass: true }],
  ["battle", "n", 2, "abstract name"],
  ["death", "n", 1, "abstract deity", { mass: true, recipes: ["abs:die"] }],
  ["life", "n", 1, "abstract deity fem", { pl: "lives", mass: true, recipes: ["abs:live"] }],
  ["soul", "n", 2, "abstract"],
  ["dream", "n", 2, "abstract deity"],
  ["song", "n", 2, "abstract fem", { recipes: ["abs:sing"] }],
  ["word", "n", 1, "abstract"],
  ["name", "n", 1, "abstract"],
  ["law", "n", 2, "abstract deity", { mass: true }],
  ["truth", "n", 2, "abstract name", { mass: true, recipes: ["abs:true"] }],
  ["hope", "n", 2, "abstract fem", { mass: true }],
  ["glory", "n", 2, "abstract name", { mass: true }],
  ["honour", "n", 2, "abstract name", { mass: true }],
  ["wisdom", "n", 2, "abstract deity name", { mass: true, recipes: ["abs:wise"] }],
  ["faith", "n", 2, "abstract", { mass: true }],
  ["fear.n", "n", 2, "abstract", { en: "fear", mass: true, recipes: ["abs:fear"] }],
  ["joy", "n", 2, "abstract fem", { mass: true }],
  ["sorrow", "n", 2, "abstract", { mass: true }],
  ["love.n", "n", 2, "abstract deity fem", { en: "love", mass: true, recipes: ["abs:love"] }],
  ["strength", "n", 2, "abstract name", { mass: true, recipes: ["abs:strong"] }],
  ["victory", "n", 2, "abstract name", { pl: "victories", recipes: ["abs:conquer"] }],
  ["fate", "n", 2, "abstract deity", { mass: true }],
  ["fame", "n", 2, "abstract name", { mass: true }],
  ["memory", "n", 3, "abstract", { mass: true, recipes: ["abs:remember"] }],
  ["power", "n", 2, "abstract name", { mass: true }],
  ["freedom", "n", 3, "abstract", { mass: true, recipes: ["abs:free"] }],
  ["mercy", "n", 3, "abstract fem", { mass: true }],
  ["courage", "n", 3, "abstract", { mass: true, recipes: ["abs:bold"] }],
  ["gift", "n", 2, "abstract name fem"],
  ["oath", "n", 2, "abstract"],
  ["blessing", "n", 3, "abstract fem", { recipes: ["abs:bless"] }],
  ["curse", "n", 3, "abstract"],
  ["secret", "n", 3, "abstract fem"],
  ["silence", "n", 3, "abstract", { mass: true, recipes: ["abs:silent"] }],
  ["way", "n", 1, "abstract geo"],
  ["will", "n", 2, "abstract name", { mass: true }],
  ["harvest", "n", 2, "abstract deity", { recipes: ["abs:reap"] }],
  ["hunt.n", "n", 2, "abstract deity", { en: "hunt", recipes: ["abs:hunt"] }],
  ["trade.n", "n", 3, "abstract deity", { en: "trade", mass: true, recipes: ["abs:trade"] }],
  ["healing", "n", 3, "abstract deity", { mass: true }],
  ["guard.n", "n", 2, "abstract name", { en: "guard", recipes: ["agt:guard"] }],
  ["counsel", "n", 3, "abstract name", { mass: true }],
  ["realm", "n", 2, "abstract head"],

  // ---- materials & objects ----
  ["iron", "n", 1, "material mod name", { mass: true }],
  ["gold", "n", 1, "material mod name", { mass: true }],
  ["silver", "n", 2, "material mod name", { mass: true }],
  ["copper", "n", 2, "material mod", { mass: true }],
  ["bronze", "n", 2, "material mod", { mass: true }],
  ["tin", "n", 3, "material mod", { mass: true }],
  ["bread", "n", 1, "material", { mass: true }],
  ["wine", "n", 2, "material mod deity", { mass: true }],
  ["beer", "n", 2, "material", { mass: true }],
  ["milk", "n", 1, "material", { mass: true }],
  ["honey", "n", 2, "material mod", { mass: true }],
  ["meat", "n", 1, "material", { mass: true }],
  ["oil", "n", 2, "material", { mass: true }],
  ["wool", "n", 2, "material", { mass: true }],
  ["amber", "n", 3, "material mod fem", { mass: true }],
  ["pearl", "n", 3, "material mod fem"],
  ["jewel", "n", 3, "material mod fem"],
  ["ship", "n", 1, "object mod name"],
  ["boat", "n", 2, "object"],
  ["sail", "n", 2, "object"],
  ["oar", "n", 2, "object"],
  ["sword", "n", 2, "weapon object mod name"],
  ["spear", "n", 2, "weapon object mod name"],
  ["shield", "n", 2, "weapon object mod name"],
  ["helm", "n", 2, "weapon object name"],
  ["bow", "n", 2, "weapon object mod"],
  ["arrow", "n", 2, "weapon object mod"],
  ["axe", "n", 2, "weapon tool object mod name"],
  ["hammer", "n", 2, "tool object mod name"],
  ["crown", "n", 2, "object mod name", { recipes: ["cmp:king+ring"] }],
  ["ring", "n", 2, "object mod name"],
  ["horn", "n", 2, "object body mod"],
  ["wheel", "n", 2, "object tool mod"],
  ["cart", "n", 2, "object"],
  ["key", "n", 2, "object tool mod"],
  ["anchor", "n", 3, "object tool mod"],
  ["bell", "n", 2, "object mod"],
  ["cup", "n", 2, "object mod"],
  ["torch", "n", 3, "object mod", { pl: "torches" }],
  ["banner", "n", 3, "object"],
  ["chain", "n", 3, "object tool"],
  ["net", "n", 2, "object tool"],
  ["plough", "n", 3, "object tool"],
  ["drum", "n", 3, "object"],
  ["harp", "n", 3, "object"],
  ["mirror", "n", 3, "object fem"],
  ["thread", "n", 3, "object"],

  // ---- numbers ----
  ["one", "num", 1, "num"],
  ["two", "num", 1, "num"],
  ["three", "num", 1, "num mod"],
  ["four", "num", 1, "num"],
  ["five", "num", 1, "num"],
  ["seven", "num", 2, "num mod"],
  ["nine", "num", 2, "num mod"],
  ["ten", "num", 2, "num"],
  ["hundred", "num", 3, "num mod"],
  ["thousand", "num", 3, "num mod"],

  // ---- pronouns & function words ----
  ["I", "pron", 1, "pron", { en: "I" }],
  ["you", "pron", 1, "pron"],
  ["he", "pron", 1, "pron"],
  ["we", "pron", 1, "pron"],
  ["you.pl", "pron", 1, "pron", { en: "you" }],
  ["they", "pron", 1, "pron"],
  ["and", "func", 1, "func"],
  ["not", "func", 1, "func"],
  ["all", "func", 1, "func"],
  ["this", "func", 1, "func"],
  ["that", "func", 1, "func"],

  // ---- verbs ----
  ["be", "v", 1, "verb", { s3: "is", past: "was" }],
  ["have", "v", 1, "verb", { s3: "has", past: "had" }],
  ["go", "v", 1, "verb", { s3: "goes", past: "went" }],
  ["come", "v", 1, "verb", { past: "came" }],
  ["see", "v", 1, "verb", { past: "saw" }],
  ["give", "v", 1, "verb", { past: "gave" }],
  ["take", "v", 1, "verb", { past: "took" }],
  ["make", "v", 1, "verb", { past: "made" }],
  ["die", "v", 1, "verb"],
  ["live", "v", 1, "verb"],
  ["fight", "v", 1, "verb", { past: "fought" }],
  ["rule", "v", 2, "verb"],
  ["love", "v", 1, "verb"],
  ["fear", "v", 1, "verb"],
  ["sing", "v", 1, "verb", { past: "sang" }],
  ["speak", "v", 1, "verb", { past: "spoke" }],
  ["know", "v", 1, "verb", { past: "knew" }],
  ["remember", "v", 2, "verb"],
  ["build", "v", 2, "verb", { past: "built" }],
  ["burn", "v", 1, "verb"],
  ["fall", "v", 1, "verb", { past: "fell" }],
  ["rise", "v", 1, "verb", { past: "rose" }],
  ["flow", "v", 2, "verb"],
  ["shine", "v", 2, "verb", { past: "shone" }],
  ["sleep", "v", 1, "verb", { past: "slept" }],
  ["guard", "v", 2, "verb"],
  ["bless", "v", 2, "verb", { s3: "blesses" }],
  ["endure", "v", 3, "verb"],
  ["conquer", "v", 3, "verb"],
  ["return", "v", 2, "verb"],
  ["break", "v", 1, "verb", { past: "broke" }],
  ["hunt", "v", 2, "verb"],
  ["eat", "v", 1, "verb", { past: "ate" }],
  ["drink", "v", 1, "verb", { past: "drank" }],
  ["hear", "v", 1, "verb", { past: "heard" }],
  ["find", "v", 1, "verb", { past: "found" }],
  ["seek", "v", 2, "verb", { past: "sought" }],
  ["wait", "v", 2, "verb"],
  ["grow", "v", 1, "verb", { past: "grew" }],
  ["sow", "v", 2, "verb"],
  ["reap", "v", 3, "verb"],
  ["hold", "v", 1, "verb", { past: "held" }],
  ["carry", "v", 2, "verb", { s3: "carries", past: "carried" }],
  ["lead", "v", 2, "verb", { past: "led" }],
  ["follow", "v", 2, "verb"],
  ["wake", "v", 2, "verb", { past: "woke" }],
  ["stand", "v", 1, "verb", { past: "stood" }],
  ["kill", "v", 1, "verb"],
  ["sail.v", "v", 2, "verb", { en: "sail" }],
  ["wander", "v", 3, "verb"],
  ["weep", "v", 2, "verb", { past: "wept" }],
  ["open", "v", 2, "verb"],
  ["cross", "v", 2, "verb", { s3: "crosses" }],
  ["forget", "v", 2, "verb", { past: "forgot" }],
  ["forgive", "v", 3, "verb", { past: "forgave" }],
  ["trade", "v", 3, "verb"],
  ["swear", "v", 3, "verb", { past: "swore" }],
  ["fly", "v", 2, "verb", { s3: "flies", past: "flew" }],
  ["run", "v", 1, "verb", { past: "ran" }],
  ["win", "v", 2, "verb", { past: "won" }],
  ["call", "v", 2, "verb"],
  ["serve", "v", 2, "verb"],
  ["bring", "v", 1, "verb", { past: "brought" }],
  ["keep", "v", 2, "verb", { past: "kept" }],
  ["bend", "v", 2, "verb", { past: "bent" }],
  ["yield", "v", 3, "verb"],
  ["wash", "v", 2, "verb", { s3: "washes" }],
  ["shelter", "v", 3, "verb"],
];

function buildConcepts(): Concept[] {
  const out: Concept[] = [];
  const seen = new Set<string>();
  for (const [id, pos, tier, tags, extra] of ROWS) {
    if (seen.has(id)) throw new Error(`duplicate concept ${id}`);
    seen.add(id);
    out.push({ id, pos, tier, tags: tags.split(" ").filter(Boolean), en: extra?.en ?? id, ...extra });
  }
  for (const e of EMBLEM_CONCEPTS) {
    if (!seen.has(e)) throw new Error(`emblem concept ${e} missing from lexicon concepts`);
    const c = out.find((x) => x.id === e)!;
    if (!c.tags.includes("emblem")) c.tags.push("emblem");
  }
  return out;
}

export const CONCEPTS: readonly Concept[] = buildConcepts();
export const CONCEPT_BY_ID: Readonly<Record<string, Concept>> = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));
export const CONCEPT_IDS: readonly string[] = CONCEPTS.map((c) => c.id);

export function concept(id: string): Concept {
  const c = CONCEPT_BY_ID[id];
  if (!c) throw new Error(`unknown concept "${id}"`);
  return c;
}

export function hasConcept(id: string): boolean {
  return id in CONCEPT_BY_ID;
}

export function conceptsWithTag(tag: string): string[] {
  return CONCEPTS.filter((c) => c.tags.includes(tag)).map((c) => c.id);
}

// ---------------------------------------------------------------------------
// English morphology (for glosses and free translations)
// ---------------------------------------------------------------------------

export function englishPlural(id: string): string {
  const c = CONCEPT_BY_ID[id];
  const w = c?.en ?? id;
  if (c?.pl) return c.pl;
  if (/(s|sh|ch|x|z)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  if (/(lf|af)$/.test(w)) return w.slice(0, -1) + "ves";
  return w + "s";
}

export function english3sg(id: string): string {
  const c = CONCEPT_BY_ID[id];
  const w = c?.en ?? id;
  if (c?.s3) return c.s3;
  if (/(s|sh|ch|x|z|o)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

export function englishPast(id: string): string {
  const c = CONCEPT_BY_ID[id];
  const w = c?.en ?? id;
  if (c?.past) return c.past;
  if (/e$/.test(w)) return w + "d";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ied";
  return w + "ed";
}

/** Agent noun in English ("hunt" → "hunter", "rule" → "ruler"). */
export function englishAgent(id: string): string {
  const w = CONCEPT_BY_ID[id]?.en ?? id;
  const special: Record<string, string> = { guard: "guardian", conquer: "conqueror", bless: "blesser", fight: "fighter", sail: "sailor" };
  if (special[w]) return special[w];
  if (/e$/.test(w)) return w + "r";
  if (/[^aeiou][aeiou][bdgmnpt]$/.test(w) && w.length <= 4) return w + w[w.length - 1] + "er";
  return w + "er";
}

export function titleCase(s: string): string {
  const small = new Set(["of", "the", "and", "a", "an", "in", "on", "by", "to"]);
  return s
    .split(" ")
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
