# render — progress log

Resumable notes for whoever picks this up next. See README.md for the API.

## Done (inherited from the first engineer, verified 2026-10-02)
- bake/: shared BakeContext (warp lattice, triangle walk, shared coast field), bakeTerrain,
  bakeCellIds, bakeWarp, bakeRivers (Chaikin + meander + tributary snapping), bakeGlobe.
  Coast consistency exact (0 mismatches at 2048 and 4096 on the real world).
- globe/: GlobeView (full-screen ray–sphere, textureGrad, bicubic magnification, analytic
  overlay borders with watercolour wash, highlight group, markers, labels, vector rivers,
  clouds, atmosphere, stars, flat mode, flyTo, inertia, pinch, keyboard, context loss).
- tests/render: bake determinism, id round trip, coast consistency, camera math (17 tests).
- tools: globe-dev.ts (harness), globe-bake.ts (Node PNGs), mock-world.ts.

## Assessment at resume
- Timing (real world, 40k cells, Node): terrain 2048 ≈ 1.7 s (target < 1.5), ids 0.35 s;
  terrain 4096 ≈ 4.4 s, ids 1.1 s.
- Visual issues: straight-edged sea-ice band; cell-shaped blotchy shelf patches; cloud
  streaks look like brush strokes; rivers slightly heavy at whole-globe zoom.
- Missing from spec: `setLines` polyline layer, highlight a *set of cells*, `clearOverlay`,
  prefers-reduced-motion for auto-rotate, PROGRESS.md.

## In progress
- tools/globe-shots.ts: multi-view screenshots in one browser session.

## Todo
- [ ] bake perf (2048 < 1.5 s)
- [ ] smooth ocean depth (soft shelves), natural sea-ice edge
- [ ] setLines, highlight cells, clearOverlay, reduced motion
- [ ] cloud look, river weight
- [ ] dev harness: lines demo, spot finder for scripted views
- [ ] tests for new API pieces (pure helpers)

## Decisions
- (inherited) Terrain alpha = signed coast field (≥128 land); ids alpha 255 land / 128 water.
- (inherited) Rivers drawn as GL ribbons by default (crisp at any zoom); can be baked in.
