# src/script — progress log

Resume notes for whoever picks this up next. Keep it short and current.

## Done (inherited WIP snapshot, verified 2026-10-02)
- Data model (`types.ts`), IPA classifier (`ipa.ts`), 11 design families
  (`families.ts`, `special.ts`), tool-aware outlines (`outline.ts`), raster
  distinctness + tangle rejection (`raster.ts`, `factory.ts`), marks /
  diacritics / Ethiopic ops / syllabics rotations (`marks.ts`), creation of all
  5 kinds (`create.ts`), derivation + adaptation (`evolve.ts`, `mutate.ts`),
  spelling (`spell.ts`), layout (`layout.ts`), SVG charts/tables/tree (`svg.ts`).
- Tests: 22 passing (`npx vitest run tests/script`).
- Demo: `npx tsx tools/script-demo.ts` → out/script/demo.html.

## Assessment of the snapshot (what looked wrong)
1. Syllabary creation 50–135 ms (budget 50 ms).
2. Descendant scripts look almost identical to parents (mutations ≈ jitter).
3. Ogham-like vowel notches invisible; cuneiform has near-duplicate single wedges.
4. Featural arc-vowels look odd; blocks cramped.
5. LTR pen cursive (S15) blobby.
6. No README.md / PROGRESS.md.
7. `ç` classified as stop (NFD splits the cedilla); `tɬ` as lateral fricative.

## Done this session
- Perf: exact block-norm upper bound in `maxSimilarity`, scratch rasters,
  padded-grid blur, typed-array `overlapFraction`, size-relaxed threshold for
  big sign sets, fewer last-resort tries. Mean create ≈ 5 ms; worst syllabary
  ≈ 20 ms warm (timings on this shared 4-core box are noisy).
- Wedge family rewritten as cluster composer (no more duplicate single wedges);
  hanging conjunct compounds and geometric pairs for big sign sets.
- IPA: cedilla (ç), lateral affricate tɬ, stress/syllable marks ignored by spelling.
- Evolution: script-wide habits per tool (roundify via Chaikin + outward bow,
  squarify, openTop, flags, tails, startLoops, feet, hooks, cursivize,
  angularize, deHorizontal, rotateAll for cuneiform), forced habit on tool
  change, per-letter idiosyncrasies, collision resolution with differentiators,
  history notes per habit, per-glyph notes ("turned on its side"…).
- Ogham vowel notches visible; featural vowels: hooked-stem and dotted styles;
  blocks taller and lighter (Unit.wscale); cursive weight ×0.8; rhombic pen
  dots; spaced paired dots.

## Todo
- Family tree: same lineages in every node.
- Demo: random scripts, place-name labels, deep single-lineage table.
- README.md with final API; tests for new behaviour.

## Decisions
- Do not import src/lang; own IPA classifier cross-checked once against
  lang's `allPhonemes()` (scratch script, not committed).
