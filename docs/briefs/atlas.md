# Brief: fantasy-cartography atlas plates (src/atlas/)

You own: `src/atlas/**`, `tests/atlas/**`, `tools/atlas-*.ts`.

Context: PhysicalWorld (`src/world/types.ts`, `generatePhysical` in src/geo) — elevation, rivers
(downstream/flow/riverOrder), lakes, biomes, features with attrs. History (`src/history`,
being built; contract in `src/history/types.ts`, helpers in `src/history/query.ts` when present)
provides settlements, realms with territory over time (`timeline.owner`), FeatureNaming, trade
routes, battles. The app shows an Atlas pane: a plate of the region in view at the current
year, plus full-screen.

API: `renderAtlasPlate(ctx: CanvasRenderingContext2D, input: { world; history: History | null;
year; view: { centerLat; centerLon; radiusKm }; width; height; seed; style?: 'antique' |
'political' | 'relief'; title? }, opts?)` — pure geometry separated (testable in Node), drawing
uses only the standard 2D context API (works with OffscreenCanvas). Plus view planners for a
realm/region/war/continent at a year.

Look: the best hand-made fantasy maps (Tolkien, Blaeu/Mercator plates, modern fantasy
cartographers). Azimuthal projection with graticule ticks; procedural parchment (fibres,
mottling, foxing, stains, aged edges) inside an ornamental double-rule frame; water wash, inked
varying-weight coasts with concentric ripple lines; hand-drawn mountain glyphs (lit flank +
hatched shadow, sized by elevation, along ridges, back-to-front), hills, volcanoes; forests as
tree-glyph clusters by biome (deciduous, conifer, palm), jungle, marsh tufts, desert stipple/
dunes, ice hatching — readable density; tapered meandering rivers with mouths; political
watercolour washes with darker edges, dashed borders, vassals lighter; settlement icons by
size, capitals, ruins; trade routes dotted; optional battle sites. Labels with a real placement
engine: realms in large letter-spaced capitals curved along the territory's axis; seas/lakes in
italic curved letter-spaced text; rivers along their paths; ranges along their axes; cities
beside icons; glyph-by-glyph curved text. Fonts "IM Fell English"/"IM Fell English SC" (Google
Fonts) with graceful fallback. Title cartouche (e.g. "The Realms of the Velm Basin · in the
Year 1182" with the native name beneath), procedural compass rose, scale bar in a native unit,
optional locator inset. Names from history at `year`; without history, omit (or dev-only
throwaway names). Seeded decoration. 1600×1100 plate < 1.5 s in Chromium.

Dev harness `tools/atlas-dev.ts` → out/atlas/atlas-dev.html (real world; history if
`simulateHistory` works, else the mock in tools/atlas-mock-history.ts), several plates; screenshot
(`node tools/shot.mjs out/atlas/atlas-dev.html out/atlas/plate.png 1600 1100 --wait=8000`, crops
with `--dpr=2 --selector=...`), READ, iterate until plates look hand-made and gorgeous.
Tests: projection round-trips, no label overlaps in a sample, deterministic finite geometry.
