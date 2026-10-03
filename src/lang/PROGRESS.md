# Language engine — progress log

Owner dirs: `src/lang/**`, `tests/lang/**`, `tools/lang-*.ts`. Tests: `npx vitest run tests/lang`.
Demo: `npx tsx tools/lang-demo.ts <seed>`.

## Done (inherited from the first engineer, WIP snapshot)
- Phoneme feature table (`phoneme.ts`), phonology generation + validation (`phonology.ts`),
  word generation (`wordgen.ts`), ~480 concepts (`concepts.ts`), lexicon with derivation
  recipes (`lexicon.ts`), morphology + junction repair (`morphology.ts`), orthography
  schools (`orthography.ts`), sound-change catalogue + engine (`soundchange.ts`),
  families (`language.ts`), naming API (`naming.ts`), evolve/borrow/etymology
  (`etymology.ts`), mini-grammar (`grammar.ts`), naming culture (`culture.ts`).
- 22 passing tests in `tests/lang/lang.test.ts`; demo tool works.

## Assessment at resume (session 2)
- Languages look random rather than coherent (school picked independently of feel:
  "anglo" with ò/è, "nordic" with ejectives, ă everywhere in "slavic").
- Some daughters barely change (a split could change <5% of words).
- Comparative table: replacements made in an intermediate ancestor are not marked
  (origin becomes "inherited" again one generation later).
- derive ≈ 20 ms (budget 10 ms).
- Missing: `toWName`/`toUtterance`, README.md, stage evolution (Old/Middle X).

## Done in session 2
- `styles.ts`: 26 sound styles (finnic, norse, celtic, semitic, japonic, nahuan, polynesian,
  kartvelian, turkic, mongolic, slavic, germanic, bantu, mayan, sinitic, indic, dravidian,
  latinate, hellenic, iranian, quechuan, austronesian, inuit, vasconic, riverine, magyar):
  correlated inventory/clusters/finals/word length/stress/harmony/banned CV/final vowels,
  morphology hints, naming hints, spelling school, sound-change drift tendencies.
- `genphon.ts`: style-driven phonology generator (replaces the old free-parameter one);
  `pickStyle` avoids styles already used in the world.
- Phonology gained optional `style`, `wFinal`, `wFinalV`, `banned`, `pGeminate`
  (daughters re-derive them empirically in `phonologyFromCorpus`).
- Orthography: school table rewritten (26 schools incl. new bantu/mayan/inuit/malay/
  iranian/mongolic), per-language spelling variants, long vowels on marked letters (ê not èè).
- Morphology: fem/adj/abstract affixes suffixal; prefixes short (CV/V); style prefixes (Bantu).
- Naming culture: short favourite heads/elements, clipped head forms (`headForms`),
  male name endings (`maleEnding`), both evolve in daughters.
- Sound change: 12 new templates (polynesian-shift, s>h, gradation, spirantisation before i,
  lenition, final raising, lowering before r, d-flapping, final n>ŋ, ts before u,
  sonorant palatalisation, vowel lowering, diphthongisation), conflict groups, style drift,
  minimum impact per split (30%; 20% for stages), automatic repairs (glide absorption…).
- `Lexeme.since` cognate tracking + `isCognate`/`retainsWord`; demo † fixed.
- `bridge.ts`: `toWName`, `toUtterance`, `displayParts`, `stageLabels`.
- `deriveLanguage(..., { stage: true })` for Old/Middle/Modern stages.

## Assessment at resume (session 3)
- Tests pass (22), tsc clean for lang. Warm timings: proto 7 ms, derive 12-14 ms (budget 10),
  names 30-120 µs (nameFeature over 0.1 ms). Hotspots: soundchange `count()` in template
  weights (recomputed after every accepted change), naming `choose()` building full Names
  (ipa, parts, titleCase, offensive check) for every rejected candidate.
- Orthography incoherent in places: daughter "reforms" borrow 1-2 random consonant spellings
  from any school (ň/č in an Andean-spelled language, ng' in a Polynesian one); long vowels
  mix marks (ô and ō in one Turkic language); nasal vowels with tildes everywhere (ẽ ĩ ũ);
  bantu ŋ "ng'" before k ("jing'kaya"); nahuatl w-after-vowel "uh" gives "ouh".
- Names too long (6-7 syllable feature/deity names), "Place of Suns" glosses, too many
  "(meaning lost)" settlements in proto-languages, male ending in hiatus ("Mungāō").
- Daughter language names all share the parent's stem (Miden, Mide, Mideme, Midheni, Mize).
- Grammar: article/adjective order bug ("hu mi man" = deep DEF river).

## Done in session 3
- Orthography rework (`orthography.ts`): schools declare native diacritic types (`marks`);
  candidate spellings pay a penalty per foreign mark (acute lighter; raw IPA letters
  never win); one long-vowel convention per language (`Orthography.long`), nasal vowels by
  convention (`Orthography.nasal`: "an/am" French-style by default, ą ę Polish/Norse,
  ã õ Romance), digraph vowels with conventional long forms (ae → ai, aw → au); rules
  indexed per phoneme (faster romanisation); new SpellingRule envs (`before: labial|velar`,
  `after: backvowel`); ŋk → nk, n+g → n'g; Welsh-style j → i before vowels.
- The commoner of e/ə gets the plain letter "e" (French e/é): no more "ë"-strewn daughters.
- Daughter reforms are coherent: shift to a related tradition (12%), drop one kind of
  diacritic (12%), or a single local innovation (14%). Newly arisen natural sounds reclaim
  their letter (h from x takes "h"; the glottal stop that had borrowed it becomes ').
- No long lax vowels (ɛː ɔː əː) in proto-systems.
- `repairWord` handles ji/wu, palatal+j and banned CV pairs.
- Tools: `tools/lang-bench.ts` (timings), `tools/lang-ortho.ts` (spelling inspector).
- Naming (`naming.ts` rewrite, same exports): candidates are cheap drafts, only the winner
  is finalised (parts, IPA, gloss); compound elements of 3+ syllables use a clipped
  combining form (per-language, cached); per-kind ideal/max syllables in scoring (opaque
  drafts get a small penalty so length scoring does not favour them); shorter modifiers;
  "Place of the Sun" for unique things; plural English glosses for ranges/hills;
  distinguisher fallback keeps words separate; male ending never creates hiatus; epithet
  before the name only 20% (AN languages). Mean syllables: settlements 2.9, features ~3,
  religions 3.5 (were 3.2 / 3.7 / 4.2, with 5-7 syllable outliers).
- `hyphenated()`/etymology segmentation attach linking vowels to the preceding morpheme.
- Daughter languages get varied English names and endonyms (`setDaughterEndonym`): the
  inherited self-name worn down by the split's sound changes, a landscape/direction
  ("those of the coast", "forest people"), or a new opaque tribal name; never confusable
  with parent/siblings (shared 3-letter prefix or small edit distance). `englishFrom`
  builds stems from the first syllable(s); proto endonyms ≤ 3 syllables.
- Sound change: cluster assimilation only between vowels (no word-initial geminates).
- Borrowing: hiatus-repair glide never creates *ji/*wu (was an infinite ping-pong);
  glides missing in the target are dropped next to vowels when hiatus is illegal.

- Grammar: free articles/plural words frame the whole NP (DEF deep river, not deep DEF river).
- Performance (wall, loaded shared container): proto ~4-7 ms, derive ~6.5 ms (was 12-14),
  names 35-75 µs. How: template-weight `count()` stops once its threshold is settled and
  is normalised to a 130-word calibration so candidate changes are evaluated on a 90-word
  sample; `stressedVowel()` (one allocation-free pass) replaces stress masks in
  `applyChange`; char-code `isVowel`; `phonologyFromCorpus` fast paths; no interim
  phonology in `deriveLanguage` (replacement words use the parent's junction rules and
  new adpositions are coined in parent shape and evolved — the daughter's phonotactics are
  inferred from its finished lexicon anyway); name pools keep a cached spelling set and a
  shared cumulative Zipf table; offensiveness checked only for accepted candidates.
  `tools/lang-bench.ts` warms up the JIT and reports CPU and wall time.

- Orthography: raw IPA letters can never be chosen while any generated spelling is free
  (β → vh); a school's own listed spellings are exempt from the foreign-mark penalty
  (semitic ü); a respelled e (after ə took "e") avoids the long-vowel mark (é vs ê/êê) and
  its long form doubles bare (ee). Stages reform their spelling less often than splits.
- Sound change: Hawaiian-type k > ʔ (t > k) now rare outside polynesian drift.
- Lexical replacement: core (tier 1) words replaced a quarter as often; semantic shifts only
  along a curated table of attested-type paths (head ← cup, year ← summer, town ← fort/farm,
  god ← sky, spirit ← breath…), else coinage.
- New API (additive): `wordEtymology(lang, concept, resolve, label?)` for lexicon words.
- `src/lang/README.md`: full API documentation.

- Obscenity sanitising: `obscene()` (util.ts); proto words that spell an English obscenity
  are regenerated, daughter words replaced by coinages (taboo replacement); language names
  and endonym sources checked too; names use `offensive()` = obscene + a joke-word list.
- Tests: `tests/lang/quality.test.ts` (10 tests: no raw IPA in spellings, restrained
  diacritics, long/nasal conventions, clean vocabulary, core vocabulary more stable,
  lexicon etymologies, short names, distinct daughter names, stages, bridge). 32 total.

- New API (additive): `loanwords` / `withLoanwords` (`contact.ts`): cultural vocabulary
  borrowed from a donor, adapted to the borrower; test in quality.test.ts (33 tests).

- Review fixes: diaeresis (ü ö ä) is a light foreign mark and y prefers ü (no Spanish-
  looking "ue"); English language names lose doubled vowels (Aahaa → Aha); the generic
  onset rule (used when a language has no opinion) only allows s+C and obstruent+liquid/
  glide (no /ˈhm/ syllabifications); person names: style-dependent length ideal (compound
  names 3-4 syllables), culture-flavoured descriptive adjectives, gentle short-word
  preference; `choose()` accepts the first acceptable candidate on length/ugliness alone
  (preserving the generator's opaque/transparent mix) and only ranks leftovers by opacity.

- `SettlementSite.river?: Name` (additive): towns named after their river ("Avon Mouth",
  "Bridge on the Avon"); 'beloved' no longer used in descriptive names ("Dear Deer").

## In progress (session 3)
- Orthography coherence overhaul → name length/quality → daughter names → grammar fix →
  performance → README + tests → multi-seed review.

## Todo
1. Final multi-seed review (demo, all sections, many seeds).

## Decisions
- Keep the existing data model (plain JSON `Language`, `Name`); extend, don't replace.
