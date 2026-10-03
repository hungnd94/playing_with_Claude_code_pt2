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

## In progress (session 3)
- Orthography coherence overhaul → name length/quality → daughter names → grammar fix →
  performance → README + tests → multi-seed review.

## Todo
1. README.md (API).
2. derive performance < 10 ms (profile: isVowel, applyChange env matching).
3. Offensive-word sanitising of lexicon forms.
4. Name quality pass (length, variety, glosses), persons, deities, features.
5. More tests (styles, cognates, bridge, stage); final multi-seed review.

## Decisions
- Keep the existing data model (plain JSON `Language`, `Name`); extend, don't replace.
