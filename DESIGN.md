# Palimpsest — design document

> A world, its peoples, their tongues, and thousands of years of their history,
> grown from a single seed.

Palimpsest generates an entire planet and its past from one seed string, then
lets you explore it in the browser: spin the globe, scrub through three
thousand years of history and watch borders flow like ink, read the
encyclopedia the world writes about itself, trace how a city's name drifted
through five daughter languages, and look at the coats of arms of dynasties that
never existed.

Everything is procedural and deterministic. Nothing is hand-authored except the
rules.

---

## 1. The experience

1. **Genesis.** The page opens on a dark sky. A planet condenses: tectonic
   plates appear, mountains rise along their collisions, oceans fill, winds and
   rain sweep across it, rivers carve their way to the sea, biomes bloom.
2. **History.** The first peoples appear in fertile river valleys. As the
   simulation runs, settlements spread, realms form, borders flow and break,
   and a ticker of chronicle entries scrolls past ("1182 — The Ashkari host
   crosses the Velm and burns Tor Oshen").
3. **Exploration.** When generation finishes the user can:
   - rotate/zoom the **globe** (WebGL), switch layers (terrain, political,
     cultures, languages, religions, population), and scrub the **timeline**;
   - open an **atlas** plate: a fantasy-cartography map of a region at a given
     year, with hand-drawn mountains, forests, curved labels, cartouche and
     compass;
   - browse the **encyclopedia**: every settlement, realm, ruler, war, battle,
     people, language, script, religion, deity, river and mountain range has a
     generated article, cross-linked;
   - read the **chronicle** (annals by year, filterable by region/realm);
   - study **languages**: phoneme inventories, sound laws, family trees,
     comparative word lists with cognates, etymologies of place names;
   - see **writing systems** evolve, and names written in native scripts;
   - see **heraldry**: arms with proper blazon, banners, mottoes in the
     realm's own language with interlinear gloss.

The whole app ships as **one self-contained HTML file** (plus Google Fonts).

---

## 2. Architecture

```
seed ─▶ core/sphere ─▶ geo/* ───────────────▶ PhysicalWorld
                                   │
         lang/* ◀──┐               ▼
       script/* ◀──┼──────── history/* ──────▶ History (entities + events + timeline)
     heraldry/* ◀──┘               │
                                   ▼
                            narrative/* ─────▶ prose: chronicle, articles
                                   │
            render/globe, render/atlas, app/* (Preact UI, main thread)
```

* **Generation runs in a Web Worker** (`src/app/worker.ts`) and streams
  progress/preview snapshots to the UI. Every generation module must therefore
  be **DOM-free** and also runnable under Node (tests and CLI tools).
* **Rendering** (`src/render/*`) and **UI** (`src/app/*`) run on the main
  thread. CPU-heavy texture baking functions live in `render/` but must be
  DOM-free too so they can run in the worker.

### Directory ownership

| Directory | Contents |
|---|---|
| `src/core/` | RNG, noise, vectors, heap, sphere mesh — shared utilities |
| `src/world/` | Shared data contracts (`types.ts`) and the top-level `generateWorld` pipeline |
| `src/geo/` | Plates, elevation, erosion, climate, hydrology, biomes, resources, feature extraction |
| `src/lang/` | Phonology, lexicon, morphology, sound change, language families, naming, romanisation, mini-grammar |
| `src/script/` | Procedural writing systems: glyph generation, script evolution, text layout → SVG |
| `src/heraldry/` | Coats of arms, blazon, flags/banners, emblems → SVG |
| `src/history/` | The civilisation simulation |
| `src/narrative/` | Prose generation: chronicle lines, encyclopedia articles, myths |
| `src/render/` | WebGL globe, texture baking, 2D atlas cartography |
| `src/app/` | Preact UI shell, worker entry, styles |
| `tools/` | Build script, CLI generators, debug image dumpers, screenshot tool |
| `tests/` | Vitest suites, mirroring `src/` (`tests/geo/…`) |
| `out/` | Scratch output from tools (git-ignored) |

---

## 3. Conventions (all modules)

* **TypeScript, strict.** `npm run typecheck` must pass. ES2022. No `enum`
  (use `as const` objects) because builds use isolated modules.
* **Determinism is sacred.** All randomness comes from `Rng` (`src/core/rng.ts`).
  Never use `Math.random()`, `Date.now()`, or iteration over unordered
  structures whose order could vary. Each subsystem takes its own stream via
  `rng.fork("label")` so that changes in one subsystem never perturb another.
  The same seed must reproduce the same world bit-for-bit.
* **Data layout.** Per-cell data are typed arrays of length `mesh.n`. Avoid
  per-cell objects in hot paths. Graph traversal uses the CSR adjacency
  (`mesh.adjStart`, `mesh.adj`).
* **Sphere conventions.** Unit sphere, +z = north pole, `lat = asin(z)`,
  `lon = atan2(y, x)`. Triangles and neighbour lists are CCW seen from outside.
  See `src/core/sphere.ts`.
* **Units.** Elevation in km (sea level 0), temperature °C, precipitation
  mm/year, river discharge m³/s, distances km (planet radius in
  `params.radiusKm`), time in years (`year` 0 = start of history).
* **Performance budget.** Full generation (40k cells, 3000 years) should take
  under ~20 s in a browser worker on a mid-range laptop. Physical generation
  should be well under 3 s. Measure with `npm run gen`.
* **No runtime dependencies** beyond `delaunator` and `preact` (both bundled).
  Do not add packages without a strong reason.
* **Tests** live in `tests/<module>/*.test.ts` and run with `npx vitest run tests/<module>`.
  Test invariants and determinism, not exact random outputs.
* **Debug tools** live in `tools/` and write into `out/` (git-ignored).
  `tools/png.ts` writes PNGs from RGBA buffers. `tools/shot.mjs` screenshots an
  HTML file with headless Chromium (WebGL works via SwiftShader). Use them to
  *look* at what you generate: open the PNG with the image-reading tool.
* **Writing style for generated English text**: plain, concrete, varied; the
  tone of a good encyclopedia or a sober chronicle, never purple. No emoji.

---

## 4. Module contracts

### 4.1 core
`Rng`, `Noise3` (3D simplex, fbm, ridged, warped), `vec3` helpers, `MinHeap`,
`SphereMesh` + `CellLocator` (nearest cell, containing triangle + barycentrics).

### 4.2 geo → `PhysicalWorld` (`src/world/types.ts`)
Entry point: `generatePhysical(params: WorldParams, rng: Rng, onProgress?): PhysicalWorld`
in `src/geo/index.ts`. Pipeline: plates → elevation → erosion → sea level →
climate (temperature, wind, moisture, precipitation) → hydrology (depression
filling, lakes, drainage, discharge, river order) → biomes → fertility &
resources → feature extraction (continents, islands, oceans, seas, bays,
straits, lakes, rivers, mountain ranges, deserts, forests, …).

### 4.3 lang
A language is a phonology + lexicon + morphology + orthography. Languages
descend from proto-languages through **regular sound changes**, so daughter
languages show systematic correspondences and names evolve plausibly. The
history simulation asks it for names (settlements, realms, peoples, rivers,
mountains, deities, people) with glosses and etymologies, for loanword
adaptation when a name crosses languages, and for small sentences (mottoes,
proverbs, inscriptions) with interlinear glosses. See `src/lang/README.md`.

### 4.4 script
Writing systems (alphabets, abjads, abugidas, syllabaries) with procedurally
generated glyphs in a consistent per-script style; scripts descend from
ancestors by glyph mutation and are adapted when borrowed. Renders words to SVG.
See `src/script/README.md`.

### 4.5 heraldry
Coats of arms following the rule of tincture, divisions, ordinaries, charges
(including canting charges keyed to lexicon concepts), proper blazon text,
cadency/marshalling when dynasties branch or merge, banners/flags, and
non-European emblem styles (radial mon-like emblems, seals). Renders SVG.
See `src/heraldry/README.md`.

### 4.6 history (phase 2)
Agent-based simulation over the physical world: cultures, settlements, realms,
rulers and dynasties, diplomacy and war, religion, technology and writing,
trade, plagues and disasters, migrations, cultural and linguistic divergence.
Produces typed entities, an event log, and a compact timeline (territory
snapshots) for scrubbing.

### 4.7 narrative (phase 2)
Turns the event log and entity data into chronicle entries and encyclopedia
articles with consistent cross-references.

### 4.8 render
* `render/globe`: WebGL2 orthographic globe, terrain texture baked on CPU from
  the physical world, a cell-id texture for per-cell overlays (political,
  culture, …) whose colours update instantly when the timeline moves.
* `render/atlas` (phase 2): fantasy cartography in 2D canvas/SVG.

### 4.9 app
Preact UI; one HTML file; generation in a worker; globe + timeline +
encyclopedia + chronicle + atlas + language/script/heraldry viewers.
