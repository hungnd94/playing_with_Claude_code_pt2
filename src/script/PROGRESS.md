# src/script — progress log

Resume notes for whoever picks this up next. Keep it short and current.

## Done (inherited WIP snapshot, verified 2026-10-02)
- Data model (`types.ts`), IPA classifier (`ipa.ts`), 11 design families
  (`families.ts`, `special.ts`), tool-aware outlines (`outline.ts`), raster
  distinctness + tangle rejection (`raster.ts`, `factory.ts`), marks /
  diacritics / Ethiopic ops / syllabics rotations (`marks.ts`), creation of all
  5 kinds (`create.ts`), derivation + adaptation (`evolve.ts`, `mutate.ts`),
  spelling (`spell.ts`), layout (`layout.ts`), SVG charts/tables/tree (`svg.ts`).
- Perf work, wedge cluster composer, evolution habits per tool, Ogham notches,
  featural vowel styles (session of 2026-10-02).

## Done (session 2026-10-03)
- Verified against real `src/lang` inventories (scratch script, not committed):
  all 223 lang phonemes classify with the right vowel/consonant split; every
  kind × 21 languages writes every phoneme after create/derive/adapt.
- Perf: `maxSimilarity(r, list, stop)` skips rasters whose block bound cannot
  reach `stop` (NB: with a stop it returns the first hit above it, not the max);
  sqrt-based Catmull–Rom; coarser raster sampling (0.06 em).
- Syllabics rewritten: 4 orientations max (Cree), extra vowels = orientation +
  dot beside (`vowelOps` reused in rotate mode, Carrier-style) then ring above;
  27 base bodies (mostly asymmetric) + variants; bounded search with
  least-confusable fallback; systematic consonant derivation (bar/tick/hook).
  `assignRotations` in create.ts shared with evolve.ts.
- Raster dot signature (`Raster.dots`): letters whose dot counts above/inside/
  below differ score ×0.94 — blurred bitmaps could not tell ب from ت.
- Cursive dots placed clear of the letter's own ink (`addDots` + `inkSpan`);
  reused skeletons never repeat a dot pattern.
- Derived letters (Ž from Z) must differ from their base (sim < 0.955 first
  pass); fallback is the most distinct try, not the first.
- NEW `distinct.ts` — `ensureDistinct(builder)` safety net run at the end of
  create/derive/adapt: rasterises every written unit (letters, fused forms,
  rotated forms, syllables; finals among themselves); fused forms that vanish
  get irregular per-consonant ops (`ortho.vowelOpsFor`, optional field, read
  via `vowelOpsOf` in spell.ts); colliding letters: the younger one gets a
  differentiator. `invalidateForms(script)` clears spell caches.
- Fused abugidas: long/nasal vowels always marked; > 9 qualities → sign mode.
- Featural: h no longer identical to ʔ; look-alikes get visible dots.
- Scratch checker (re-create if needed): over 150 random scripts, max
  similarity between any two distinct written units ≤ 0.985 (was 1.000).

- Charts: theme-neutral defaults (currentColor + opacity; accents #b8692f /
  #4f8c99), tall grids split into side-by-side panels (`gridCells`,
  `gridRows`), sample-word cells centred on ink (labels no longer overlapped).
- Family tree: one slot per shared lineage (telling letters preferred), lost
  letters shown as a faint dash; `nodeFill` option.
- NEW `describe.ts` — `describeScript(script, {name, parentName})` → facts +
  in-world English sentences (kind, direction/tool, traits, lineage). History
  notes in evolve.ts are now full clauses ("it came to be written with…").
- NEW `wordOutline` / `textOutline` (svg.ts) → one pixel-space path for
  canvas Path2D map labels; `LayoutOptions.horizontal` sets ttb scripts on a
  line; `transformPath` in layout.ts.
- Kinds follow the language: `kindWeights(inv)` biases invention (few vowels →
  abjad, small syllable sets → syllabary); derive/adapt feel `kindPressure`
  (abjad → alphabet with ≥5 vowel qualities; syllabary → abugida when signs
  would exceed ~110). NEW syllabary → abugida transition. `AdaptOptions.kind`.
- Tests: legibility.test.ts, api.test.ts (32 passing). All test files set
  `vi.setConfig({ testTimeout: 60000 })` (box load reached 12 → 5 s timeouts).
- Fused forms judged geometrically (`fusedChecker` in distinct.ts: added
  strokes must stand clear of the consonant's ink by ~nib width and differ from
  the other forms' additions) instead of raster cosine (which could not see a
  foot or tick). Fused mode only for geometric/linear (75%), square/stave
  (30%); hanging/round always use signs.
- Pen dots: lozenge pulled square to the nib (were dashes). Featural weight ×0.82.
- Evolution: per-letter idiosyncrasies no longer wasted on jitter; rotate,
  reflect, simplify, addStroke boosted — deep lineages drift visibly.
- Demo rewritten: specified + random scripts with describeScript prose, named
  family tree / evolution tables, 7-generation lineage (#deep), map labels
  (#names, textOutline), default colours on a dark page (#dark).
- README.md written (design + full API).

## Todo (next)
- Perf re-check when the box is quiet (load was 6–12 on 4 cores); fused
  abugidas 20–90 ms under load.
- Survey gallery with descendants (`script-gallery.ts seed 24 1`) for oddities.

## Decisions
- Do not import src/lang; own IPA classifier cross-checked against lang's
  `allPhonemes()` (scratch script, not committed).
- Public signatures stay stable (history engineer calls createScript /
  deriveScript / adaptScript); additions only as optional fields/options.
