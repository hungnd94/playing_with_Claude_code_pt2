# Heraldry — progress log

(Keep this short; update after every major step so a successor can resume.)

## Done (engineers 1–2, found on disk by engineer 3)
- Data model `types.ts` (Arms = SimpleArms | MarshalledArms, furs, lines, partitions, ordinaries, charges, cadency).
- Tinctures + 2 palettes (`illuminated`, `flat`), rule of tincture helpers.
- Charge registry (72 charges: all EMBLEM_CONCEPTS + classic) with layered art (body/accent/crown/ink/line/shine/shade).
- Field divisions with patterned lines (evenodd half-planes), ordinaries, chief, bordure (incl. compony), canton, semy, label/brisures.
- Layout engine fitting charge silhouettes into shield polygons.
- Generator `generateArms(rng, {style, motifs, motifChance, colours, complexity})` + 9 style presets + `randomStyle`.
- `differenceArms`, `marshalArms`, `cantingCharge(s)`; `blazon(arms)`.
- `renderArmsSVG` with 10 shield shapes, rich/flat/hatched finishes.
- flag.ts (23 patterns, devices, describeFlag), banner.ts (6 cloth shapes), mon.ts (kamon-like), seal.ts (wax/metal/ink, legend ring).
- Dev tools: tools/heraldry-{sheet,scratch,gen-preview,one,flags,mon,seals}.ts.

## External callers (keep stable!)
- src/history/emblems.ts imports generateArms (generate.ts), differenceArms/marshalArms/cantingCharge (cadency.ts),
  blazon (blazon.ts), STYLES/randomStyle/HeraldryStyle (styles.ts), Arms/ChargeId/Tint (types.ts).
  NOTE: history currently stores kind "banner" with *Arms* data, and mon/seal cultures as kind "arms".
- src/app/engine/heraldry.ts re-exports generateArms, blazon, cantingCharges, differenceArms, Arms, StyleName.

## Engineer 3 — plan / status
1. [x] `index.ts` public API (emblem.ts facade; banner `staff:false` compact mode + bannerAspect; differenceMon;
       marshalling method "single" = one coat + escutcheon over all).
2. [x] tests/heraldry (arms.test.ts, emblems.test.ts, svgcheck.ts — 25 tests, ~4 s)
3. [ ] tools/heraldry-demo.ts → out/heraldry/demo.html (showcase of everything).
4. [~] Generator/blazon fixes — DONE: blazon rewritten around merging "pieces" (Woodville "a fess and a canton
       Gules", "within"/"all within", "Azure crusily and a lion Or", orle "within an orle"); divided fields tinctured
       by content (counterchanged / colour-colour + metal charge / metal-metal); no furs over divisions; vair-like
       furs unreadable under their own tinctures; additions on divisions differ from all parts.
       TODO: wavy cross/saltire/chevron shapes, piles with lines.
5. [ ] Charge art polish: wolf (cat-like), falcon (parrot), stag (one antler), bull (sheep), horse, lightning, flame,
       tree (cloud), eagle displayed.
6. [ ] Seal legends: short legends spread letter-by-letter around the ring (ugly) → fill with stops/ornament.
7. [ ] Mon: canting motif honoured more reliably.
8. [ ] README.md with API + design.

## Decisions
- Emblem.data holds the module's plain JSON object (Arms | Mon | Seal | Banner); `renderEmblemSVG` dispatches on
  `kind` but sniffs the data so Arms under kind "banner"/"mon"/"seal" still renders sensibly.
