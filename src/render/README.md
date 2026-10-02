# render — globe & texture baking

Two halves:

* **`render/bake/`** — DOM-free, deterministic texture bakers. Run them in the
  generation worker (or Node) and transfer the buffers to the main thread.
* **`render/globe/`** — `GlobeView`, a WebGL2 globe (and flat map) with
  per-cell overlays, rivers, markers and labels. Main thread only.

```ts
// worker
import { bakeGlobe, bakedTransferables } from "../render/bake";
const baked = bakeGlobe(world, { width: 4096 });            // ≈ 5–6 s at 4096, ≈ 1.6 s at 2048 (Node)
postMessage({ baked }, bakedTransferables(baked));

// main thread
import { GlobeView } from "../render";
const globe = new GlobeView(canvas, { autoRotate: true });   // canvas inside a position:relative box
globe.setBaked(baked);              // terrain + cell ids + warp + vector rivers
globe.setWorld(world);              // mesh + land/water flags (overlays, picking)
globe.setOverlay({ colors, groups });   // every timeline tick: cheap
globe.setMarkers([...]); globe.setLabels([...]);
globe.onPick((cell, lat, lon) => …); globe.onHover((cell) => globe.setHighlight(realmOf[cell]));
```

## Baking (`render/bake`)

All images are equirectangular RGBA8, `width = 2·height`, row 0 = north,
column 0 = longitude −180°, u = (lon + π) / 2π, v = (π/2 − lat) / π.

| function | output |
|---|---|
| `bakeTerrain(world, w, h, opts?)` | RGB: painterly satellite colours with baked NW hillshade, snow, ice, ocean depth, shelves, tropical shallows, lakes, rivers (opt-out `rivers: false`). **A: signed coast field**, `≥ 128 ⇔ land`; its bilinear 0.5-contour is the sub-texel coastline. |
| `bakeCellIds(world, w, h, { terrain? })` | RGB = 24-bit cell id (`encodeCellId` / `decodeCellId`), A = 255 land / 128 water. Pass the terrain of the same size to reuse its coast decision (faster, identical). |
| `bakeWarp(world)` | the warp lattice (RGB = displacement xyz, 128 = 0, ±`amp`). Size depends only on the mesh. |
| `bakeRivers(world, opts?)` | `RiverGeometry` — smoothed, meandering, tapered river polylines for `GlobeView.setRivers`. |
| `bakeGlobe(world, opts?)` | all of the above; terrain baked *without* rivers (the globe draws them as vector ribbons; `bakeRiversIntoTerrain: true` to keep them). |

**How it works** (`context.ts`). Every pixel direction p is displaced by a
smooth, fold-free warp field to q = p + warp(p) (a fixed lattice, quantised and
bilinearly sampled exactly as the GPU samples it). Everything is evaluated at
q: the Delaunay triangle containing q is found by a visibility walk from the
previous pixel's triangle; land/water is decided by **one shared function**,
`BakeContext.coastField`: barycentric blend of per-cell signed landness
(±0.5…1, steeper coasts for high land / deep water) plus bounded fractal noise
— *only in triangles whose cells disagree*, so a land pixel always has a land
cell among its vertices. Cell ids are the nearest cell of the pixel's own class
to q. Hence: land pixels ↔ land cells, water pixels ↔ water cells (lakes count
as water), exactly — tested in `tests/render`.

Terrain colour: land colours come only from land vertices (and water from water
vertices), with sharpened, noise-perturbed barycentric weights (patchy,
organic biome edges rather than a Voronoi mosaic or a blur), plus low- and
high-frequency "pigment" noise. Relief: interpolated elevation is blurred
(isotropic on the sphere) to remove triangle facets, then ridged-multifractal
detail is added in proportion to altitude (ice sheets and pack ice stay smooth),
and the result is hill-shaded from the NW. Snow uses temperature corrected by
the lapse rate at the detailed elevation and is shed by steep slopes.

Rivers: chains along the drainage graph that follow their largest upstream
branch (so main stems stay continuous), Chaikin-smoothed, resampled, meandered
with noise (tapering to zero at the ends), tributary mouths snapped onto their
trunk, and finally mapped through the inverse warp so they sit on the warped
terrain. Width ∝ log discharge.

Deterministic: all noise derives from `new Rng(world.params.seed).fork("render-bake")`.

## `GlobeView` (`render/globe`)

`new GlobeView(canvas, opts?)` — opts: `view {lat, lon, zoom}`, `mode`
(`"globe" | "flat"`), `autoRotate` (deg/s or `true`; stops on interaction),
`minZoom` (0.75), `maxZoom` (14), `maxPixelRatio` (2), `background`
(`"stars" | "transparent"`), `lighting` (0…1), `night` (night-side ambient,
0.17), `atmosphere` (1), `exposure` (1), `sun` (`{mode:"camera"|"world", dir}`
— default camera-relative, from the upper left, matching the baked NW
hillshade), `labelCanvas`, `fontFamily`, `labelTheme` (`"light"` text with dark
halos for the satellite look, or `"dark"` for parchment), `interactive`.
The label canvas is created as an absolutely positioned sibling of `canvas`, so
put the canvas in a positioned container.

Data
* `setTerrain(rgba, w, h)`, `setCellIds(rgba, w, h)`, `setWarp(rgba, w, h, amp)`,
  `setBaked(baked)` — textures larger than `MAX_TEXTURE_SIZE` are halved on the CPU.
* `setMesh(mesh, wet?)` / `setWorld(world)` — sites, adjacency and land/water flags
  as data textures (needed for overlays; also a picking fallback).
* `setRivers(geometry | null, { color?, width? })`.

Overlay — `setOverlay({ colors, groups?, opacity?, borderColor?, borderWidth?, coastColor?, terrainFade?, wash? } | null)`
* `colors`: `Uint8Array(4·n)` RGBA per cell (alpha 0 = unfilled); `groups`:
  `Uint32Array(n)`; borders appear wherever neighbouring cells *of the same
  land/water class* have different groups (so coasts are never "borders").
* Cost per call: copy + one O(n) BFS (hop distance to the nearest border, for the
  watercolour edge) + two small `texSubImage2D` — ≈ 1–3 ms for 40 k cells. Fine
  at 60 Hz while scrubbing.
* Look: watercolour wash that keeps the terrain's light and shade, deepening
  towards borders and coasts (over ~1–2 cells), paper grain, a pigment band
  inside each border, crisp anti-aliased ink borders of constant screen width,
  faint ink coastline. Fills stop exactly at the (sub-texel) coastline.
* Borders are computed **analytically** in the shader: the id texture names a
  candidate cell; the shader re-derives the owner among it and its neighbours
  (nearest same-class site to the warped position) and measures the distance to
  the bisector planes of foreign neighbours in screen pixels — so borders stay
  smooth and crisp at any zoom, not texel staircases.
* `setHighlight(group | null)` — deeper wash, luminous inner rim and heavier border
  for one group (hover/selection).

Markers & labels
* `setMarkers([{ xyz, size?, color?, shape? }])` — GL point sprites;
  `shape`: `circle | square | diamond | star | triangle | ring`; hidden on the
  far side, faded at the limb. Colours: CSS hex or `[r,g,b,a]` (a in 0…1).
* `setLabels([{ xyz, text, style, priority?, size?, minZoom? }])` — `style`:
  `capital | city` (beside the point), `region` (letter-spaced capitals; grows
  with zoom), `sea` (letter-spaced italic), `feature` (italic). Greedy collision
  avoidance by priority (point labels also avoid markers, and try four
  positions), never past the limb, dimmed on the night side.
* Marker and label positions are given in cell space (e.g. a cell centre) and
  mapped through the inverse warp, so a city sits inside its drawn cell.

View & interaction
* Drag to rotate (north stays up) with inertia; wheel / pinch zoom about the
  cursor; double-click / double-tap zooms in; keyboard: arrows, `+`/`-`, `0`.
* `flyTo(lat, lon, zoom?, ms?)` → `Promise` (zooms out mid-flight for long hops),
  `getView()`, `setView({lat, lon, zoom})`, `setMode("globe" | "flat")`,
  `setAutoRotate(speed)`, `setOptions({...})`, `projectLatLon(lat, lon)`,
  `pickAt(x, y)`.
* `onPick((cell, lat, lon) => …)` on click/tap, `onHover(…)` (cell −1 when
  leaving the planet); both return an unsubscribe function. Picking reads the
  CPU copy of the id texture, so it matches what is drawn.
* Renders only when something changed (or while animating); handles resize,
  devicePixelRatio and WebGL context loss/restore. `dispose()` frees everything.

Rendering notes: the planet is a full-screen triangle; each fragment intersects
the orthographic ray with the sphere and computes **exact texture-coordinate
gradients** from the hit point, so `textureGrad` has no antimeridian seam and
mip selection is right up to the limb (anisotropic filtering helps at the
poles). When magnified, the terrain is sampled bicubically, the coastline is
rebuilt from the coast field with sub-texel fractal detail, and procedural
grain proportional to local contrast is added. Lighting: wrapped diffuse with a
warm terminator, readable bluish night side, glittering sun glint on water,
Fresnel-like limb scattering, atmospheric halo, luminance-preserving tone map,
faint parallax starfield.

## Dev tools

* `npx tsx tools/globe-dev.ts` → `out/globe/globe-dev.html` (worker-baked world,
  fake politics, labels, markers; `window.__globe` handle). URL params:
  `seed, cells, w, real=1, layer=terrain|political, mode=flat, lat, lon, zoom, rotate=1`.
  `node tools/shot.mjs "out/globe/globe-dev.html?w=2048" out/globe/shot.png 1280 800 --waitfor="window.__globe?.ready" --wait=1000`
* `npx tsx tools/globe-bake.ts [--w=2048] [--real] [--seed=…] [--crop=x,y,w,h]` → PNGs + timings + coast-consistency check.
* `tools/mock-world.ts` — a plausible `PhysicalWorld` without `src/geo`.
