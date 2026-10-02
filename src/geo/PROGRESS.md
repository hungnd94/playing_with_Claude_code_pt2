# geo — progress notes

Handover notes for whoever resumes this module. Keep short; update after every major step.

## Done
- Full pipeline in `index.ts`: mesh → style → plates → elevation → interior lift → erosion → fjords → sea level → climate → hydrology → biomes → fertility/resources → features. All `PhysicalWorld` fields filled.
- `travel.ts` (cellDistanceKm, landMoveCost, seaMoveCost); tests in `tests/geo/physical.test.ts`.
- Tools: `tools/geo-maps.ts <seed> [cells] [width]` → out/geo/<seed>/*.png + features.txt;
  `tools/geo-montage.ts [cells] seeds…` → out/geo/montage*.png;
  `tools/geo-zoom.ts <seed> [cells] [lat,lon,radiusDeg …]` → close-up orthographic relief (auto views if none given).
- Session 2 (quality pass):
  - `style.ts`: per-world archetype knobs (supercontinent / archipelago / dispersed / earthlike): assembly, shelf, coastRough, warp, micro, hotspots, plateau, fragment.
  - plates: assembly-driven continental clustering + convergent motion (collisions inside supercontinents); mild bias of continents away from poles.
  - elevation: continent–continent boundaries always build suture ranges (incl. transforms); passive-margin great escarpments; rugged highlands instead of flat mesas; stronger paleo-suture belts; coastline displacement in km (additive crust perturbation, shelf-floored) with fjord/skerry ridged term at high latitudes; fragmentation basins floored at shelf depth.
  - `liftInteriors` (after provisional sea level): interiors higher than coasts; hypsometry now ≈ Earth (>1 km ≈ 15–30 % of land, >2 km ≈ 4–8 %).
  - `carveFjords` (erosion.ts): glacial troughs along drainage paths at high latitudes.
  - climate: zonal temperature table refit to Earth (high latitudes were 3–4 °C too cold); rain-out efficiency table rebalanced; meridional eddy moisture exchange (±5°); more cold-land recycling → zonal precipitation ≈ Earth.
  - pack ice threshold −9 °C (starts ≈ 68–70°).

## In progress
- Features: split supercontinents into continents at isthmuses; keep total ≤ ~250.

## Todo
- Visual check of biomes/natural for 5+ seeds; desert extent / east-coast monsoon check.
- Performance pass (machine is shared/noisy; measure best-of-N). Budget 40k < 2.5 s.
- Tests for new behaviour (style variety, fjords, continent split); final report.

## Decisions
- Sea level chosen by flood-level quantile so ocean fraction matches by area (±0.2 %). Shelf = drowned coastal plain (by design; `style.shelf` sets how much).
- Lakes: only significant depressions keep lakes (ranked, `maxLakes`); others become sediment flats.
- Scratch scripts live in the shared scratchpad under `geo-s2/` (other engineers share the scratchpad root).
