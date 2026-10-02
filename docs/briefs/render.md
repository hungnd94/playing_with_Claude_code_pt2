# Brief: the WebGL globe renderer (src/render/)

You own: `src/render/**` (globe/, bake/, index.ts), `tests/render/**`, `tools/globe-*.ts`,
`tools/mock-world.ts`. The app engineer is integrating your API now: keep signatures stable.

Input: `PhysicalWorld` from `generatePhysical` (src/geo/index.ts), contract in
`src/world/types.ts`; mesh conventions and CellLocator in `src/core/sphere.ts`.

1. Baking (src/render/bake/, DOM-free, runs in a Web Worker):
   `bakeTerrain(world, w, h, opts)` → RGBA equirect (2:1; fast at 2048×1024, works at 4096×2048):
   painterly 'satellite' look, smooth biome blending (barycentric + pixel noise, no Voronoi
   mosaic), hillshading with detail noise, snow/ice, ocean depth gradient with shelves and
   tropical shallows, tapered meandering rivers (width ∝ log discharge), lakes, crisp fractal
   coasts consistent with cell land/water. `bakeCellIds(world, w, h, opts)` → cell index in
   24-bit RGB with organic domain warp, land↔land / water↔water consistent with the terrain
   coastline. Targets: 2048 < 1.5 s, 4096 < 5 s in Node.
2. GlobeView (src/render/globe/): WebGL2 orthographic globe via full-screen ray–sphere, seam-free
   sampling, soft terminator, readable night side, water glint, atmosphere, starfield.
   API (document in `src/render/README.md`): constructor/dispose, setTerrain, setCellIds,
   setMesh; `setOverlay({ colors, groups, opacity, borderColor, borderWidth })` cheap to update
   ~60×/s (watercolour fills stronger near borders, crisp ink borders, coasts respected);
   clear overlay; highlight one group or a set of cells; `setMarkers`; `setLabels` (2D overlay,
   priority collision avoidance, far-side hiding, limb fade, cartographic styles); `setLines`
   polylines (trade routes, rivers, fronts); camera (drag inertia north-up, wheel/pinch zoom
   1×–12×, double-click zoom, `flyTo`, get/setView, auto-rotate off under
   prefers-reduced-motion); `onPick`/`onHover`; dirty-flag rendering; resize/DPR; touch;
   optional flat equirect mode.
3. Dev harness `tools/globe-dev.ts` → out/globe/globe-dev.html with a real world, fake political
   overlay, labels, markers; `window.__globe` handle; screenshot (`node tools/shot.mjs
   out/globe/globe-dev.html out/globe/shot.png 1280 800 --wait=5000`), READ, iterate: whole
   globe, coastal close-up with rivers, political overlay.
Tests: bake determinism, id round-trip, coast consistency, finite outputs.
