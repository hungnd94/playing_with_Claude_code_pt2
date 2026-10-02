# Brief: the physical planet (src/geo/)

You own: `src/geo/**`, `tests/geo/**`, `tools/geo-*.ts`. You may make **additive** changes to the
physical-world interfaces in `src/world/types.ts` (never rename/remove fields — the renderer,
atlas and history are built against them; mention additions in your report).

Read `src/core/sphere.ts` (CSR adjacency, CCW neighbours, CellLocator nearest-cell and
locateTriangle+barycentrics), `src/core/noise.ts`, `src/core/rng.ts`, `src/core/heap.ts`,
`src/world/types.ts` (PhysicalWorld — fill every field meaningfully).

API: `generatePhysical(params: WorldParams, rng: Rng, onProgress?: (stage, fraction) => void): PhysicalWorld`
in `src/geo/index.ts`, mesh via `buildSphereMesh(params.cells, rng.fork("mesh"))`.

Pipeline & realism targets:
1. Plates: sizes vary a lot, irregular boundaries, continental fraction, Euler poles, boundaries
   classified (convergent/divergent/transform) with intensity.
2. Elevation: continental vs oceanic crust, shelves, cordilleras + trenches + volcanic arcs,
   continental collisions → broad ranges/plateaus, island arcs, rifts, ridges, hotspot chains,
   domain-warped multi-scale noise. Intricate coastlines (bays, peninsulas, inland seas,
   archipelagos, fjords at high latitude) — not blobs, not speckle. Interior ranges too.
3. Erosion: stream-power + thermal; dendritic valleys, lowland plains. Fast.
4. Sea level to match `params.oceanFraction` (±1%) by area.
5. Climate: insolation/tilt, lapse rate, continentality → tempRange, temperatureOffset;
   three-cell winds deflected by mountains; moisture advection, orographic rain, rain shadows,
   ITCZ, subtropical deserts, wet temperate west coasts, dry interiors, polar deserts.
6. Hydrology: priority-flood, lakes (salty endorheic in arid lands), downstream forest rooted at
   ocean/endorheic lakes, discharge in m³/s from real areas (biggest rivers Amazon/Nile scale),
   riverOrder.
7. Biomes: Whittaker-style + Alpine, Wetland, water biomes.
8. Fertility 0..1 (Nile effect) & resources with geologic logic; sparse enough to matter.
9. Features: continents, islands, oceans, seas, bays, straits, lakes, rivers (source→mouth),
   ranges, hills, volcanoes, deserts, forests, jungles, steppes, tundra, marshes, plains,
   peninsulas, archipelagos, glaciers — curated (dozens to ~250) with writer-friendly attrs.
   Fill landmassOf / waterBodyOf / regionOf.
10. `src/geo/travel.ts`: `cellDistanceKm`, `landMoveCost`, `seaMoveCost` (documented).

Performance: 40k cells < 2.5 s in Node. Determinism tested.
Tools: `tools/geo-maps.ts <seed> [cells]` → out/geo/<seed>/*.png; look at many seeds.
Tests: determinism; ocean fraction; acyclic downstream ending in ocean/lake; flows sane; every
land cell has a landmass; biome/water consistency; features valid.
