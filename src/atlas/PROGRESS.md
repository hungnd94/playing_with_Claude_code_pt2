# atlas — progress notes

Owner: src/atlas/**, tests/atlas/**, tools/atlas-*.ts. Debug output: out/atlas/.

## Done
- (starting) read DESIGN.md, world/history contracts. history has only types.ts so far → dev harness uses a mock history (tools/atlas-mock-history.ts).

## In progress
- projection, field sampling, contours, harness.

## Todo
- relief glyphs, vegetation, rivers, political, settlements, labels, decorations, tests, perf.

## Decisions
- View: centerLat/centerLon in degrees (like the globe camera), radiusKm = ground distance from centre to the nearest edge of the inner map area.
- Projection: Lambert azimuthal equal-area centred on the view, north up at the centre.
- Pure geometry (`buildPlateModel`) separated from drawing (`drawPlate`), which only uses the standard 2D context API.
