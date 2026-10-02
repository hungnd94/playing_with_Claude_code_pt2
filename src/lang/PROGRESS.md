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

## In progress
- (see todo)

## Todo
1. toWName / toUtterance helpers (history contract) + README.md.
2. Cognate tracking on lexemes (`Lexeme.since`) → correct † in comparisons.
3. derive performance < 10 ms.
4. Archetype-driven proto-languages (coherent looks) + orthography cleanup.
5. Sound-change magnitude per split; plausibility review.
6. Name quality pass (length, variety, glosses), persons, deities, features.
7. Stage evolution helper (Old X → Middle X → X).
8. More tests; final multi-seed review.

## Decisions
- Keep the existing data model (plain JSON `Language`, `Name`); extend, don't replace.
