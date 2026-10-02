# app — progress log

Owner: `src/app/**`, `tests/app/**`, `tools/app-*.ts`. Spec: `docs/UI.md`.
Build: `npm run build` → `dist/index.html`. Screens: `npx tsx tools/app-shot.ts` (see below).

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
- (nothing yet)

## In progress
- step 1–2

## Decisions
- Single import sites: `engine/history.ts` (simulateHistory or mock), `engine/narrative.ts`
  (src/narrative or dev fallback). Switch those two files when the real modules land.
