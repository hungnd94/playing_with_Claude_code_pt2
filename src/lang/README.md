# Language engine (`src/lang`)

Procedural languages that split into families by **regular sound change**, and
that name everything in the world with a literal gloss, a morpheme breakdown,
IPA and an etymology:

> Kešdavar /ˈkeʃdavar/ — from Old Keshi *Kaś-tabar 'stone ford'

Everything is deterministic in the `Rng` it is given and plain JSON (languages,
names and registries cross the Web Worker boundary and survive
`JSON.parse(JSON.stringify(x))` unchanged). Import from `src/lang/index.ts`.

```ts
import * as L from "../lang";

const proto = L.createProtoLanguage(rng.fork("lang0"), { flavour: "river", id: "0" });
const daughter = L.deriveLanguage(proto, rng.fork("split1"), 600, { id: "1" });
const old = L.deriveLanguage(daughter, rng.fork("stage1"), 1100, { id: "2", stage: true });

// (outputs below are illustrative)
const reg = L.createRegistry();                       // one per world
const town = L.nameSettlement(proto, rng, { features: ["river", "ford", "oak"] }, { registry: reg });
town.roman;  // "Kaśtabar"     town.gloss // "Stone Ford"     town.ipa // "ˈkaɕtabar"
const later = L.evolveName(town, proto, old);
later.etym;  // "from Old Keshi Kešdabar, from Proto-Keshi *Kaś-tabar 'stone ford'"
const motto = L.motto(daughter, rng);
motto.interlinear; // ["kaś-a  tabar-im", "stone-DEF  endure-3SG", "'The Stone Endures'"]
```

---

## 1. How a language is made

1. **Sound style** (`styles.ts`). 26 correlated bundles loosely modelled on areal
   types (finnic, norse, celtic, semitic, japonic, nahuan, polynesian,
   kartvelian, turkic, mongolic, slavic, germanic, bantu, mayan, sinitic,
   indic, dravidian, latinate, hellenic, iranian, quechuan, austronesian, inuit,
   vasconic, riverine, magyar): inventory, clusters, finals, word length,
   stress, harmony, banned sequences, preferred final vowels, grammar and
   naming tendencies, spelling traditions and sound-change *drift* (Celtic
   lenition, Polynesian k > ʔ…). The homeland `flavour` biases the choice;
   styles already used in the world become unlikely (`avoid`).
2. **Phonology** (`genphon.ts`, `phonology.ts`): inventory with mutation,
   sonority-respecting onset/coda/final clusters, Zipfian frequencies,
   stress rule, optional vowel harmony, syllable canon.
3. **Lexicon** (`concepts.ts`, `lexicon.ts`): 483 concepts (328 nouns, 68
   verbs, 66 adjectives, numerals, pronouns, function words; every
   `EMBLEM_CONCEPTS` entry). Core words get short roots; some words are built by recipe
   (sea = great+water, queen = king-FEM, temple = god+house) so lexicons have
   internal etymologies.
4. **Morphology** (`morphology.ts`): word order, adpositions vs case, adjective
   and possessor order, articles, gender, agreement, compounding order and
   linkers, derivational affixes (place, land, demonym, adjective, diminutive,
   augmentative, agent, abstract, feminine, patronymic, dynasty, collective),
   inflection (plural, definite, cases, tense, imperative, negation, person).
   Some affixes are grammaticalised from roots ("place" from the word for
   *land*). Junctions are repaired the language's way (harmony, elision,
   glides, nasal assimilation, epenthesis, deletion).
5. **Orthography** (`orthography.ts`): one of 26 spelling traditions, adapted
   to the inventory without collisions. Each tradition declares the diacritic
   types it uses natively and spellings that would import a foreign mark pay a
   penalty, so a language looks like *one* system (Czech carons and acutes,
   Hawaiian macrons and ʻokina, Welsh circumflexes, Finnish ä ö). Long vowels
   follow one convention per language (ā / aa / á / â), nasal vowels too
   (French-style *an/am*, Polish *ą ę*, Portuguese *ã õ*). The commoner of e
   and ə gets the plain letter (French e/é). Contextual rules: c/qu, diphthong
   glides (ai, au), m before labials, nk, n'g, Welsh i for j before vowels…
6. **Naming culture** (`culture.ts`): favourite settlement heads (and their
   clipped combining forms, like -bury), name patterns, personal-name style
   (dithematic, monothematic, descriptive, opaque), female marking,
   patronymics, epithets, dynasty style, male name endings.
7. **Self-name and English name**: proto-languages are named from their word
   for *people*; daughters from the inherited self-name worn down by their sound
   changes, a landscape or direction ("those of the coast"), or a new tribal
   name — never confusable with parent or siblings.

## 2. How a daughter is made (`deriveLanguage`)

1. 3–8 **regular sound changes** (2–5 for a stage) chosen from 64 attested-type
   templates (`soundchange.ts`: lenition, voicing, spirantisation, chain
   shifts, Grimm-like shifts, palatalisation, assibilation, apocope, syncope,
   final reduction, umlaut, breaking, diphthongisation, monophthongisation,
   nasalisation, rhotacism, debuccalisation, gradation, metathesis,
   compensatory lengthening, cluster assimilation, prothesis, stress shifts,
   Polynesian k > ʔ, …), each adapted to the current inventory, evaluated on a
   sample of the lexicon (must change enough words, may not merge too many,
   create monster clusters or tiny words) and weighted by the family's drift.
   Changes are data: an explicit phoneme map plus environments, a stress
   condition and exceptions, with an English description and a notation
   ("*p t k > b d g / V_V"). Application is simultaneous, so the same rules
   reproduce every inherited word: **cognates are regular**.
2. The lexicon and every affix are pushed through the changes.
3. Grammar drifts (word order, adjective order, case erosion into adpositions,
   a demonstrative becoming an article…).
4. 3–8 % of the lexicon is replaced (2–5 % for a stage), core vocabulary least:
   new coinages, attested-type semantic shifts (head ← 'cup', year ← 'summer',
   town ← 'enclosure'), new derivations. `Lexeme.since` records where each word's
   line of descent began, so `isCognate` is exact.
5. Phonotactics, frequencies and inventory are re-inferred from the evolved
   lexicon; the spelling drifts (new sounds spelled the tradition's way; now
   and then a coherent reform: a related tradition, one diacritic dropped, or
   one local innovation like kh → ch); naming customs drift.

---

## 3. API reference

### Languages

| function | notes |
|---|---|
| `createProtoLanguage(rng, opts?)` | `opts: { flavour?, style?, id?, name?, avoid?: Language[], year? }`. `id` defaults to a random string; pass `String(historyLanguageId)` to make the bridge trivial. |
| `createProtoLanguages(rng, n, flavours?)` | n mutually distinct proto-languages. |
| `deriveLanguage(parent, rng, year, opts?)` | `opts: { id?, name?, stage?, avoidNames?, minChanges?, maxChanges?, replacement?, minImpact? }`. `stage: true` = the same people's language a few centuries on (keeps the English name, evolves the endonym regularly, gentler change). The parent is not modified. |
| `inventory(lang)` | `{ consonants, vowels }` (IPA) for the script module. |
| `describeLanguage(lang)` | 4 English sentences (inventory, syllables/stress/harmony, syntax, compounding/spelling). |
| `protoLabel`, `oldLabel`, `middleLabel`, `stageLabel(name, stage)`, `citationLabel(lang)`, `stageLabels(name, count)` | "Proto-Keshi", "Old Keshi", … `stageLabels("Keshi", 3)` → `["Old Keshi", "Middle Keshi", "Keshi"]`. |
| `isCognate(a, b, concept)`, `retainsWord(lang, ancestor, concept)` | Exact cognacy via `Lexeme.since`. |
| `correspondences(ancestor, descendant)` | proto phoneme → reflex counts over inherited words. |
| `ancestry(lang)`, `pathBetween(from, to)` | lineage ids / the `LineageStep`s from an ancestor down. |
| `languageToJSON`, `languageFromJSON` | plain JSON round trip. |

`Language` fields of interest: `id`, `name` (English, mutable by the caller),
`endonym`, `endonymPhonemes`, `endonymGloss`, `parent`, `depth`, `year`,
`attested` (proto-languages cite with *), `phonology`, `morphology`,
`orthography`, `lexicon[concept] = { form, origin, since }`, `naming`,
`lineage: LineageStep[]` (every sound-change step from the root down, each
with `from`, `to`, `toName`, `year`, `stressBefore`, `changes`, `orthography`).

### Naming

All naming functions take the language, an `Rng`, kind-specific options and
`{ registry?, unique? }`. Pass one `createRegistry()` per world: names are
unique per language (collisions get "Upper", "New"… as real toponymy does) and
personal names are drawn Zipf-style from a growing pool, so names recur.

| function | options |
|---|---|
| `nameSettlement(lang, rng, site?, opts?)` | `site: { features?: concept[], founder?: Name, mother?: Name, river?: Name, pattern? }` — "Stone Ford", "Place of Oaks", "Little Hill", "Ulfr's Stead", "New Kesh", "Avon Mouth"/"Bridge on the Avon" (when the river's name is given), opaque old names. |
| `nameRealm(lang, rng, o?)` | `{ people?, capital?, feature?, founder? }` — "Land of the Ashkari", "Keshland". |
| `namePeople(lang, rng, o?)` | `{ place?, feature? }` — demonyms, "the True People", "Children of the Moon", opaque ethnonyms. |
| `demonymFor(lang, place)` | "of Kešdavar". |
| `nameFeature(lang, rng, kind, d?, opts?)` | `kind: NameKind` (river, range, sea, lake, forest, desert, island, archipelago, volcano, continent, …); `d: { color?, size?, temp?, salt?, dir?, concepts? }`. `featureKindToNameKind(geoKind)` maps world feature kinds. |
| `nameDeity(lang, rng, o?)` | `{ domain?, gender? }` — "Lady of the Moon", "the Shining One", opaque theonyms; `meta.domain`, `meta.gender`. |
| `nameReligion(lang, rng, o?)` | `{ deity?, founder?, concept? }` — "the Way of the Dawn", "Teaching of Oshar". |
| `nameDynasty(lang, rng, o?)` | `{ founder?, seat? }` — "Kin of Oshar" or "House of Oshar" per culture. |
| `namePerson(lang, rng, o?)` | `{ gender?, father?, clan?, epithet?: boolean \| concept, fresh? }` — given name + patronymic/clan + epithet ("Wulfgar Eadricson the Bold"); `meta.given`, `meta.gender`, `meta.givenIndex`. |
| `epithetFor(lang, rng, concept?)` | "the Bold" as a native phrase. |
| `nameTitle(lang, role)` | "ruler", "emperor", "chief", "priest", "noble", "general" or any role concept. |
| `nameLanguage(lang)` | the endonym as a `Name`. |
| `hyphenated(name)` | citation form with morpheme boundaries: "Kaś-tabar". |
| `registerName`, `isNameUsed` | registry helpers. |

`Name`: `{ lang, kind, phonemes (words separated by " "), words, roman, ipa,
gloss (title case, "" if opaque), parts: NamePart[], history: EtymStep[],
etym, meta? }`. Names stay short: inside compounds, 3+-syllable words appear in
a clipped combining form, and candidates are scored for length per kind
(settlements and features average ~3 syllables).

### Names and words through time

| function | notes |
|---|---|
| `evolveName(name, from, to)` | regular descendant through every intermediate step (each step recorded in `history`); borrows if `to` does not descend from `from`. |
| `borrowName(name, to, { from?, label?, year? })` | nearest-phoneme mapping + phonotactic repair; `etym` "borrowed from …". |
| `adaptWord(word, lang)`, `evolveWord(word, from, to)` | the same for bare words. |
| `renderEtymology(name, { label?, maxSteps? })` | "from Middle Keshi Kešdabar, from Proto-Keshi *Kaś-tabar 'stone ford'"; `label(step)` relabels stages (e.g. with the history's current language names). |
| `wordEtymology(lang, concept, resolve, label?)` | etymology of a lexicon word: "from Old Keshi *kaś, from Proto-Keshi *kaś 'stone'", "a compound of 'god' and 'house'", "originally 'cup'", "of unknown origin". `resolve(engineId)` returns ancestor languages. |

### Language contact

| function | notes |
|---|---|
| `loanwords(lang, donor, rng, { count?, concepts?, cultural? })` | the lexicon entries `lang` would take from `donor`: mostly cultural vocabulary (titles, buildings, metals, crops, weapons, law, faith), rarely core words, never pronouns or low numerals; adapted to the borrower's phonology; `origin: { kind: "borrowed", lang, langName }`, a new `since`. |
| `withLoanwords(lang, donor, rng, opts?)` | a copy of `lang` with those loans (or apply `loanwords(...)` in place). Good at conquest/assimilation/trade events, before the next stage is derived; daughters inherit the loans. |

### Mini-grammar

`sentence(lang, clause, { title? })`, `phrase(lang, { nps? | adjectives? })`,
`motto(lang, rng)`, `proverb(lang, rng)`, `inscription(lang, ruler, thing?, verb?)`
→ `Sentence { lang, words, text, segmented, gloss, translation, ipa, interlinear }`.
`Clause = { subject?: NP, verb?, object?: NP, oblique?: { rel, np }, tense?,
imperative?, negative?, and?: Clause }`, `NP = { head? | name?, adj?, plural?,
def?, indef?, num?, dem?, poss? }`. Word order, adpositions or case, articles,
agreement and pro-drop follow the language; the gloss line is Leipzig style
(`stone-DEF endure-3SG`).

### Bridge to the history contracts (`src/history/types.ts`)

| function | notes |
|---|---|
| `toWName(name, lang?, { label?, maxSteps? })` | → `WName { roman, gloss, lang, ipa, phonemes, parts, etym }`. `lang` is the history language id or a resolver from engine ids; default `Number(name.lang)` (when languages were created with numeric-string ids). |
| `toUtterance(sentence, lang?)` | → `Utterance { lang, text, gloss, translation, words }`. |
| `displayParts(name)` | morpheme breakdown with plain-English affix glosses. |

### Lower level

`romanizeWord(orthography, word)`, `romanizeName`, `ipaWord(word, stress,
phonology?)`, `ipaPhrase`, `features(ipa)`, `describePhoneme`, `isVowel`,
`phonemeDistance`, `isValidWord(phonology, word)`, `syllabify`,
`stressedSyllable`, `generateWord`, `generateRoot`, `applyChange(s)`,
`wordFor(lang, concept)`, `originText(origin)`, `CONCEPTS`, `CONCEPT_BY_ID`,
`hasConcept`, `conceptsWithTag`, `SOUND_STYLES`, `pickStyle`, `schoolIds()`,
`changeTemplateIds()`.

---

## 4. Conventions and guarantees

* **Determinism**: the same `Rng` state and inputs give identical output.
  Naming draws from the `rng` passed in; derivation forks labelled sub-streams.
* **Stability for consumers**: the app reads `phonology.stress`,
  `orthography`, `lexicon[c].form/origin/since` and `lineage[].changes`
  (`name`, `description`, `notation`) directly; these shapes are stable.
* **Every concept exists in every language**, including all `EMBLEM_CONCEPTS`.
* **Performance** (warm JIT, shared loaded container; `npx tsx tools/lang-bench.ts`):
  proto-language ~4–7 ms, derive ~6–9 ms, a name 35–75 µs. A language is ~55 KB
  of JSON.

## 5. Tools

* `npx tsx tools/lang-demo.ts [seed] [--section=protos,tree,compare,places,evolve,borrow,persons,gods,mottoes,features] [--out]`
  — the showcase: proto-languages, a family tree with sound laws, a comparative
  word list with correspondences, names of every kind, names through time,
  borrowings, persons, gods, mottoes with interlinear glosses.
* `npx tsx tools/lang-names.ts [nLangs] [--samples=n] [--kind=k]` — name length
  and opacity statistics per kind, with samples.
* `npx tsx tools/lang-ortho.ts [seeds…]` — spelling traditions and the
  diacritics each language actually uses, down two generations.
* `npx tsx tools/lang-bench.ts [n]` — timings.
* Tests: `npx vitest run tests/lang`.
