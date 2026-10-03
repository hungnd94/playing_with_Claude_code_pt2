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
3. [x] tools/heraldry-demo.ts → out/heraldry/demo.html (15 sections; `--only=a,b`; groups have ids for
       `tools/shot.mjs --selector=#roll-anglo` etc.). Builds in <1 s.
3b. [x] Performance: render 11 ms → ~2 ms/coat (cached span tables in path.ts `polySpanBetween`; cached robust
       `insetPoly` in shapes.ts, which also fixed bordure spikes on French/German shields).
3c. [x] Layout: charges between chevron/saltire/cross/pall/pile/bend fill the actual compartments (layout.ts
       `compartments` + `bestFit`), any shield shape; principal inside an orle; orle spacing at sharp corners.
3d. [x] Ray ordinaries (cross/saltire/chevron/pall) with patterned lines rebuilt (geometry.ts `rayOrdinary`):
       symmetric phase, parallel edges, true junctions; diagonal waves/zigzags auto-flattened (lines.ts).
3e. [x] Fret interlaced properly; bordure compony segments follow normals.
3f. [x] Canting reliable: coat decides once to cant (motifChance, default .92), motif used once, `ensureMotif`
       inserts it (principal / on ordinary / on chief) if the grammar missed it.
4. [~] Generator/blazon fixes — DONE: blazon rewritten around merging "pieces" (Woodville "a fess and a canton
       Gules", "within"/"all within", "Azure crusily and a lion Or", orle "within an orle"); divided fields tinctured
       by content (counterchanged / colour-colour + metal charge / metal-metal); no furs over divisions; vair-like
       furs unreadable under their own tinctures; additions on divisions differ from all parts.
       Piles ×3 never patterned; dancetty only on fess/bend/pale.
5. [x] Charge art: stag (spread attires), falcon close (new, birds.ts `falconClose`), bull (humped, crescent horns),
       wolf head (canine profile) + deeper rampant torso, flame (five tongues), lightning (bold bolt, "bolt of
       lightning"; old winged `thunderbolt` kept exported), tree (layered foliage clumps), martlet (compact swallow).
       Remaining weaker ones: horse salient (thin), bull head (a little ovine).
       Cadency: brisures placed by `markSpot` (render.ts) at a free spot — middle chief / fess point / dexter chief —
       tinctured against what lies under it; `Difference.at` stores it. `layoutSimple` factors slot layout.
6. [x] Seal legends: short ones centred on top with pellets + rosette at the foot; long ones with word stops (·).
7. [x] Mon/seal canting honoured more reliably (97 %).
8. [x] README.md with API + design.
9. [x] New style `saracenic` (Mamluk-like: round shields, tierced fields, charged fess with cups etc.);
       HeraldryStyle.chargedOrdinary knob.

## Decisions
- Emblem.data holds the module's plain JSON object (Arms | Mon | Seal | Banner); `renderEmblemSVG` dispatches on
  `kind` but sniffs the data so Arms under kind "banner"/"mon"/"seal" still renders sensibly.
