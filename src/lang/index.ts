/**
 * Palimpsest language engine — public API. See src/lang/README.md.
 */
export type {
  Word,
  StressRule,
  Harmony,
  Flavour,
  Phonology,
  AffixKind,
  Affix,
  Morphology,
  Orthography,
  SpellingRule,
  SoundChange,
  LineageStep,
  Lexeme,
  LexOrigin,
  NamingCulture,
  Language,
  Name,
  NamePart,
  NameKind,
  EtymStep,
  NameRegistry,
} from "./types";
export { FLAVOURS } from "./types";

export {
  CONCEPTS,
  CONCEPT_BY_ID,
  CONCEPT_IDS,
  concept,
  hasConcept,
  conceptsWithTag,
  englishPlural,
  english3sg,
  englishPast,
  type Concept,
  type PartOfSpeech,
} from "./concepts";

export { features, phonemeFor, isVowel, isConsonant, describePhoneme, phonemeDistance, sonority, type Features } from "./phoneme";
export { isValidWord, syllabify, stressedSyllable, vowelQualities } from "./phonology";
export { generateWord, generateRoot } from "./wordgen";
export { romanizeWord, romanizeName, ipaWord, ipaPhrase, ugliness, schoolIds } from "./orthography";
export { applyChange, applyChanges, changeTemplateIds } from "./soundchange";
export { wordFor, originText } from "./lexicon";

export {
  createProtoLanguage,
  createProtoLanguages,
  deriveLanguage,
  inventory,
  describeLanguage,
  protoLabel,
  oldLabel,
  middleLabel,
  stageLabel,
  citationLabel,
  languageToJSON,
  languageFromJSON,
  ancestry,
  correspondences,
  isCognate,
  retainsWord,
  type ProtoOptions,
  type DeriveOptions,
} from "./language";

export {
  createRegistry,
  registerName,
  isNameUsed,
  nameSettlement,
  nameRealm,
  namePeople,
  demonymFor,
  nameFeature,
  featureKindToNameKind,
  nameDeity,
  nameReligion,
  nameDynasty,
  namePerson,
  epithetFor,
  nameTitle,
  nameLanguage,
  hyphenated,
  type NameOptions,
  type SettlementSite,
  type RealmOptions,
  type PeopleOptions,
  type FeatureDescriptors,
  type DeityOptions,
  type ReligionOptions,
  type DynastyOptions,
  type PersonOptions,
} from "./naming";

export { evolveName, borrowName, adaptWord, evolveWord, renderEtymology, ancestorLabel, pathBetween, type BorrowOptions } from "./etymology";

export { sentence, phrase, motto, proverb, inscription, type NP, type Clause, type Phrase, type Sentence, type Relation } from "./grammar";

export { asciiFold } from "./util";

export { toWName, toUtterance, displayParts, stageLabels, type WNameOptions } from "./bridge";
export { SOUND_STYLES, type SoundStyle } from "./styles";
export { pickStyle } from "./genphon";
