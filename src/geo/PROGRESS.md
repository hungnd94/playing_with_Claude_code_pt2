# geo — progress notes

Handover notes for whoever resumes this module. Keep short; update after every major step.

## Done (inherited WIP snapshot, verified working)
- Full pipeline in `index.ts`: mesh → plates → elevation → erosion → sea level → climate → hydrology → biomes → fertility/resources → features. All `PhysicalWorld` fields filled.
- `travel.ts` (cellDistanceKm, landMoveCost, seaMoveCost), tests in `tests/geo/physical.test.ts` (33 passing).
- Tools: `tools/geo-maps.ts <seed> [cells] [width]` → out/geo/<seed>/*.png + features.txt; `tools/geo-montage.ts [cells] seeds…` → out/geo/montage*.png.

## In progress (session 2)
- Visual quality pass: interior mountain ranges, intricate coasts/fjords, narrower pack ice, world variety, continent splitting at isthmuses.

## Todo
- (see in-progress)

## Decisions
- Sea level chosen by flood-level quantile so ocean fraction matches by area (±0.2%).
- Lakes: only significant depressions keep lakes (ranked, `maxLakes`); others become sediment flats.
