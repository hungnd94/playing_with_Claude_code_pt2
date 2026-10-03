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

## Done
- (see above)

## In progress
- political washes/borders, settlements, label placement, decorations.

## Todo
- cartouche, compass rose, scale bar (native unit), graticule ticks, locator inset
- forests as masses, terrain polish, relief style
- view planners (realm / region / war / continent)
- tests (projection round trips, no label overlaps, determinism, finite geometry)
- performance (< 1.5 s for 1600×1100)

## Decisions
- View: centerLat/centerLon in degrees (like the globe camera), radiusKm = ground distance from centre to the nearest edge of the inner map area.
- Projection: Lambert azimuthal equal-area centred on the view, north up at the centre.
- Pure geometry (`buildPlateModel`) separated from drawing (`drawPlate`), which only uses the standard 2D context API.
