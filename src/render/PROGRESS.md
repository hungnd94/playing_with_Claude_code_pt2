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

## Done this session
- tools/globe-shots.ts: many scripted views in one browser session (`--only=a,b --prefix=x`).
- Warp lattice: noise at half res + exact ×2 Catmull–Rom (context 505 → ~250 ms).
- Terrain: land relief and sea depth in separate buffers (no coastal drop shadows / ringed
  lakes); depth blurred at half res → soft shelves; turbid silty shallows; procedural sea
  ice from interpolated temperature + 4 noise scales (continent-scale lobes, floes, leads),
  threshold derived from the world's SeaIce cells; frozen lakes; less pink deserts.
- Clouds: weather-coverage-thresholded billowy fbm + 7 seeded cyclone swirls; shadows
  hidden under their clouds and at the limb. Glint fades with zoom. Lighter river ink.
- API: `setLines` (globe/lines.ts geometry + LINE_VS/FS: constant px width, mitres, casing,
  dashed/dotted, arrowheads, animated flow, flat-map wrap copies), `setHighlightCells`,
  `clearOverlay`, prefers-reduced-motion (no auto-rotate/flow, instant flyTo).
- Dev page: `g.spot(kind)`, `g.highlightAt`, `g.highlightBasinAt`, `g.showLines`, `g.reset`;
  click = upstream drainage basin highlight; demo trade routes / campaigns / sea route.

## In progress
- Soft-Voronoi (rounded) group borders in the shader instead of cell-polygon zigzags.

## Todo
- [ ] stronger group highlight + focus dimming of other groups
- [ ] bake perf (2048 < 1.5 s cold incl. context; currently ≈ 1.6–1.9 s on a loaded box)
- [ ] tests for lines geometry, highlight, new bake invariants (ice, finite)
- [ ] README update (setLines, setHighlightCells, clearOverlay, reduced motion, profile)
- [ ] check 4096 close-ups

## Decisions
- The scratchpad dir is shared with other engineers: use scratchpad/render-eng/ only.
- src/geo is edited concurrently and sometimes throws; profile with tools/mock-world.ts.
- (inherited) Terrain alpha = signed coast field (≥128 land); ids alpha 255 land / 128 water.
- (inherited) Rivers drawn as GL ribbons by default (crisp at any zoom); can be baked in.
