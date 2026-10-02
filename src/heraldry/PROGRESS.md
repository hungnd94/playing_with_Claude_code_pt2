# Heraldry — progress log

(Keep this short; update after every major step so a successor can resume.)

## Done (inherited from first engineer, WIP snapshot)
- Data model `types.ts` (Arms = SimpleArms | MarshalledArms, furs, lines, partitions, ordinaries, charges, cadency).
- Tinctures + 2 palettes (`illuminated`, `flat`), rule of tincture helpers.
- Charge registry (72 charges: all EMBLEM_CONCEPTS + classic) with layered art (body/accent/crown/ink/line/shine/shade).
- Field divisions with patterned lines (evenodd half-planes), ordinaries, chief, bordure (incl. compony), canton, semy, label/brisures.
- Layout engine fitting charge silhouettes into shield polygons.
- Generator `generateArms(rng, {style, motifs, colours, complexity})` + 9 style presets + `randomStyle`.
- `differenceArms`, `marshalArms`, `cantingCharge(s)`.
- `blazon(arms)`.
- `renderArmsSVG` with 10 shield shapes, metal gradients, sheen, vignette, optional texture.
- Dev tools: tools/heraldry-sheet.ts, -scratch.ts, -gen-preview.ts, -one.ts.

## Resumed by second engineer — plan
1. Public API `index.ts` + `renderEmblemSVG` dispatcher.
2. Tests (determinism, tincture, blazon sanity, SVG well-formedness/unique ids).
3. Demo tool tools/heraldry-demo.ts → out/heraldry/demo.html.
4. Fix generator/blazon/layout bugs seen in preview (erminois on Or, piles, wavy saltire, blazon phrasing).
5. Flags + banners, mon, seals.
6. Charge art polish (falcon looks like a parrot, horse salient weak, wolf head cat-like, stag single antler, bull head).
7. README.md with API.

## In progress
- (see plan)

## Decisions
- Emblem.data holds the module's plain JSON object (Arms | Mon | Seal | Banner); `renderEmblemSVG` dispatches on `kind`.
