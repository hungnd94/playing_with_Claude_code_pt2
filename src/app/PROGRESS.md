# app — progress log

Owner: `src/app/**`, `tests/app/**`, `tools/app-*.ts`. Spec: `docs/UI.md`.
Build: `npm run build` → `dist/index.html`. Screens: see "Tools" below.

## Plan
1. engine/query.ts (timeline reconstruction, value-at-year helpers) — until src/history/query.ts lands.
2. dev/mockHistory.ts — procedural stand-in History built from the PhysicalWorld with the real
   lang/script/heraldry modules (so every viewer is testable before src/history exists).
3. protocol.ts + worker.ts — generate physical → post → bake (second worker) → history → post.
4. Shell: top bar, globe stage, reading pane with tabs + back/forward, timeline dial, layers.
5. Rich renderer + figures; dev/mockNarrative.ts fallback behind engine/narrative.ts.
6. Panes: World, Chronicle, Encyclopedia, Atlas, Tongues, Scripts, Faiths, Heraldry.
7. Search palette, genesis, seed dialog, #seed- deep links, theme toggle.
8. Polish: phone layout, reduced motion, perf, tests.

## Done
- Session 1 (predecessor): steps 1–3 written: engine/query.ts, dev/mockHistory.ts (works: 40k
  cells → ~5 s, 19 cultures, 49 languages, 269 polities, 22k events), dev/mockNarrative.ts
  (complete fallback articles/chronicle/search), protocol.ts, worker.ts, state/{store,app,
  generation}.ts, styles/tokens.css. `npx tsx tools/app-mock.ts [seed]` runs the pipeline in Node.

## Session 2 (resumed 2026-10-03 after a container restart)
- Assessment: everything typechecks; no UI yet (main.tsx placeholder). src/history has a
  partial sim (no "v1 works" yet), src/narrative has only types.ts → keep mock + fallback.

## In progress
- Visual review pass: phone layout, light theme, population layer, genesis polish.

## Todo (next)
- Curated seed notes must describe what the seeds really grow (generate and check each).
- Tests in tests/app (overlay engine, search, seed parsing, locate, validateHistory).
- Switch engine/history.ts SIM_READY when src/history says "v1 works"; engine/narrative.ts when
  src/narrative lands.
- Atlas draws on the main thread (~1.5 s); consider OffscreenCanvas in a worker.

## Decisions
- Single import sites: `engine/history.ts` (simulateHistory or mock), `engine/narrative.ts`
  (src/narrative or dev fallback). Switch those two files when the real modules land.

### Session 2 — milestone 2 (viewers)
- Viewers: Tongues (family trees; language pages: brief grammar from describeLanguage, IPA
  consonant table + vowel trapezoid, sound laws of the last split + whole lineage, sample
  vocabulary with IPA/native script/origin, cognate table, place-name etymologies, script),
  Scripts (family trees with glyphs via script/svg familyTreeSVG, script pages: chart, history
  notes, evolution table down the lineage, specimen motto, users), Faiths (spread-over-time
  chart, cards with seals (engine/emblem faithSeal when a faith has no emblem), faith pages with
  pantheon, myths, teachings, mini map), Heraldry (roll of arms, realms/houses, in-year/all,
  batched), Atlas (src/atlas plate of the last-read realm/war/land or the region in view,
  styles, full screen, click-through via hitTest).
- openRef keeps language/script/religion inside their viewer tab when already there
  (`EntityLink tab="article"` forces the encyclopedia).

### Session 2 — milestone 1 (shell end-to-end)
- Pipeline works in Chromium with real geo + render: physical → globe bake (2048 then 4096 in a
  second worker) → mock history → narrative fallback → explore. Genesis: CSS proto-planet +
  starfield until the bake lands, stage captions, replay of history on the timeline with ticker.
- Shell: TopBar, Stage (GlobeView via ui/stage/controller.ts: overlay per layer from
  engine/overlay.ts using src/history/query LayerCursor, settlement markers, realm/city/sea
  labels, hover card, link ping, fly-to on article open), layer rail + legend, Timeline dial
  (histogram, age bands, ghost hover, keyboard), Pane (tabs, back/forward, collapse/expand),
  World (this-age + overview), Chronicle (filters, windowed), Encyclopedia (article, place
  page for picked cells, index), Search palette, Seed dialog, NameCard hover.
- Rich renderer: links/native/years, blocks incl. interlinear utterances with native script,
  figures (emblem, chart small-multiples, mini map from baked textures, trees, IPA charts,
  cognate table, script word/chart).
- tools/app-shots.ts: scripted screenshots in one Chromium session (see header).
- Fonts for screenshots: Google Fonts are blocked by the sandbox CA in Chromium, so the TTFs
  were installed to ~/.local/share/fonts/palimpsest (outside the repo; re-run the snippet in
  this file's history if the container is fresh — or just accept fallback fonts).
