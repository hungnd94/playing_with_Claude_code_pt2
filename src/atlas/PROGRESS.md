# atlas — progress notes

Owner: src/atlas/**, tests/atlas/**, tools/atlas-*.ts. Debug output: out/atlas/.

## State when the 2nd engineer took over (container restart)
On disk and working: projection (Lambert azimuthal equal-area), field sampling (coast field
with noise only where land/water cells meet, warped land-cell lookup, smoothed elevation),
marching squares / chaikin / distance transform, water (coast loops, ripples), rivers
(tapered, meandering, clipped to shore), relief glyph placement (mountains, volcanoes,
hills), ground cover (trees by biome, marsh, grass, dunes, stipple, ice), glyph drawing,
parchment base + ageing overlay, plain frame. Written but NOT wired in: political.ts,
places.ts, labels.ts (engine), hist.ts. No tests, no decorations, no planners.

Real history (src/history) at this point: settlements, featureNames, timeline — but no
polities / routes / battles yet → the harness picks the mock unless polities exist.

## Done (session 2)
- planner.ts: fitCells + planContinentView / planRegionView / planRealmView / planWarView / planPointView, largestRealms.
- political.ts: realm loops dilated into the sea (washes meet the coast), main component per realm (label axis),
  borders realm / vassal / frontier, pigments from a curated watercolour set (style.ts PIGMENTS), graph-coloured
  per suzerainty, vassals = lighter tint of the suzerain.
- places.ts: tiers (capital/city/town/village/ruin, great ≥ 60k), pennant colour, reoccupied ruins hidden; routes; battles.
- icons.ts: village dot, town ring (+ wall ticks), city pictogram, capital castle with pennant, ruins, crossed swords, routes.
- labelplan.ts: priority placement (capitals → realms → oceans → cities → seas → ranges → rivers → bays/lakes → towns →
  islands → regions → minor rivers → villages/ruins → battles) with scale-aware budgets (no villages when > 3.4 km/px).
- labels.ts: Latin-1 decomposition (splitChar) so IM Fell is kept; text.ts draws marks (caron, macron…) by pen.
  Straight labels drawn with canvas letterSpacing in one call (label draw 628 ms → 12 ms).
- names.ts: feature names in the holder's tongue, realm titles (history/query polityTitle), plate titles, native unit.
- decor.ts: cartouche (concave corners, scrolls, native name + gloss, native-script lettering via src/script layoutWord
  → Path2D), compass rose turned to local true north + portolan rhumbs over water, double scale bar (native days' march
  + km), graticule with frame ticks/labels and an alternating degree band, locator globe inset.
- shade.ts: relief-style biome wash + hill-shading raster.
- harness: tools/atlas-dev-page.ts uses real history when it has polities, else the mock (history=auto|real|mock|none);
  7 plates (continent, realm, river, range, war, continent2, nohistory).

## In progress
- relief-style shading quality, terrain glyph polish at close zoom, label edge cases (near-vertical spines, gap boxes).

## Todo
- tests (projection round trips, no label overlaps, determinism, finite geometry)
- performance (< 1.5 s for 1600×1100): field, water, paper and ageing are the big items
- check with the real history once it has polities

## Decisions
- View: centerLat/centerLon in degrees (like the globe camera), radiusKm = ground distance from centre to the nearest edge of the inner map area.
- Projection: Lambert azimuthal equal-area centred on the view, north up at the centre.
- Pure geometry (`buildPlateModel`) separated from drawing (`drawPlate`), which only uses the standard 2D context API.
