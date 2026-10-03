# src/heraldry — arms, blazon, flags, banners, mon and seals

Every realm, dynasty, city and religious order in Palimpsest bears an emblem.
This module invents them (deterministically, from an `Rng` stream), describes
them in correct English blazon, differences them for cadet branches, marshals
them when realms unite or houses marry, and paints them as self-contained SVG
strings — large for encyclopedia plates, tiny for map markers.

Everything is **plain JSON data + DOM-free string rendering**, so generation
runs in the worker and rendering anywhere (worker, main thread, Node).

```
types.ts        the data model (Arms = SimpleArms | MarshalledArms, Field, Ordinary, ChargeGroup, …)
emblem.ts       the facade history/app use: generateEmblem, renderEmblemSVG, differenceEmblem, marshalEmblems …
generate.ts     the arms grammar (styles, rule of tincture, canting, complexity distribution)
styles.ts       heraldic traditions (anglo, french, germanic, iberian, italian, nordic, ecclesiastical,
                steppe, saracenic, baroque) + randomStyle(rng) for invented peoples
blazon.ts       English blazon
cadency.ts      differenceArms (labels, brisures, bordures, tincture/line changes, canton, baston),
                marshalArms (quarterly, grand quarters, impaled, per fess, escutcheon of pretence), canting
render.ts       renderArmsSVG + coat layout (layoutSimple, markSpot for brisures)
geometry.ts     divisions (half-planes, evenodd) and ordinaries (bands, ray ordinaries with patterned edges)
lines.ts        lines of partition (wavy, indented, dancetty, embattled, engrailed, invected, nebuly, raguly, dovetailed)
layout.ts       charge placement: rows fitted into the visible polygon by silhouette profile,
                compartments around ordinaries (bestFit), orles, chiefs, bordures
shapes.ts       10 shield shapes, frames, robust polygon inset
ctx.ts, place.ts per-SVG id/defs context, tincture paints (metal gradients, furs, Petra Sancta hatching), charge placement
charges/        the 72 charges: art (layered paths), registry, paint
banner.ts       banner, gonfanon, vexillum, pennon, standard, nobori — arms laid out on cloth
flag.ts         vexillological flags (23 patterns, devices, livery derived from arms)
mon.ts          Japanese-style radial monochrome crests (+ differenceMon for branch families)
seal.ts         seals in wax, metal or vermilion ink, with a legend ring
```

## The data model

`Arms` is either `SimpleArms` or `MarshalledArms` (see `types.ts`, fully commented):

- **Field**: `partition` (plain; per pale/fess/bend/bend sinister/chevron/saltire; quarterly; gyronny;
  per pall; tierced in pale/fess; variations paly, barry, bendy, chequy, lozengy, chevronny), its
  `tinctures` (metals or, argent; colours gules, azure, vert, purpure, sable, tenné, sanguine; furs
  ermine, ermines, erminois, pean, vair, counter-vair, potent), a `line` of partition and a `count`.
- **semy**: the field strewn with a small charge (semy-de-lis, crusily, billetty, goutty…).
- **ordinary**: fess, pale, bend, bend sinister, chevron, cross, saltire, pall, pile, orle, fret,
  chevron reversed, pall reversed, base — with `line`, diminutive `count` (bars, pallets, bendlets,
  chevronels, piles), `cotised`, `counterchanged`, and `charges` lying on it.
- **charges**: `ChargeGroup` = charge id + `count` + `arrangement` (auto, in pale, in fess, in bend,
  2-1, 1-2, in cross, in saltire, in orle, 3-2-1, crossed…) + tincture + attitude (rampant, passant,
  displayed, close, naiant, hauriant…) + `armed`, `crowned`, `reversed`, `inverted`, `points`,
  `pierced`, `counterchanged`. Charges lie alone, *between* an ordinary, or with `secondary`
  charges ("a lion within an orle of martlets").
- **chief**, **bordure** (lined, compony, charged), **canton** (charged), **difference**
  (label, brisures for the 2nd–9th sons, baston; `at` says where a brisure lies).
- `MarshalledArms`: `method` quarterly / impaled / perFess / single, `coats` (themselves Arms —
  grand quarters nest), optional `escutcheon` of pretence, `difference` over all.

Charges are every `EMBLEM_CONCEPTS` entry (so names can cant) plus the classic ones (mullet,
crescent, roundel, annulet, lozenge, fusil, mascle, billet, fleur-de-lis, six crosses, escallop,
martlet, cinque/quatre/trefoil, pheon, escutcheon, goutte). Each is layered art in a 100-unit
frame — body, accent (claws, tongue, beak, attires), crown, interior lines, ink, shine and shade —
drawn as a bold heraldic silhouette with an outline that fuses overlapping parts.

`Mon`, `Seal`, `Banner` and `Flag` are similarly plain objects (see their files).

## Public API (`src/heraldry/index.ts`)

### The emblem facade — what history and the app should call

History stores `{ kind, data, blazon }` (`Emblem` in src/history/types.ts); kind is the tradition.

```ts
generateEmblem(rng, { kind?: "arms"|"mon"|"seal"|"banner", style?, gloss?: string[], motifs?, colours?,
                      legend?, ecclesiastical?, arms?, material?, complexity?, motifChance? }): HeraldicEmblem
renderEmblemSVG(emblem, { size?=160, idPrefix?, shape?, palette?, finish?, background?, staff?, texture?, attrs? }): string
describeEmblem(emblem): string                 // blazon (arms, banners) or description (mon, seals)
differenceEmblem(emblem, rng, { method?, son? }): HeraldicEmblem   // cadet branch, any kind
marshalEmblems([a, b, …], "quarterly"|"impaled"|"perFess"): HeraldicEmblem
emblemArms(emblem): Arms | undefined           // the shield an emblem carries, if any
emblemColours(emblem): Tint[]                  // principal tinctures, most prominent first
isArms / isMon / isSeal / isBanner             // recognise data
styleShape(style): ShieldShape
```

- `renderEmblemSVG` fits the emblem into a **size × size box** (the SVG's own width/height follow the
  emblem's proportions). Banners drop their staff below 72 px (`staff` overrides). It dispatches on
  `kind` but trusts the data, so `Arms` stored under kind `"banner"` paint on a banner, under
  `"seal"` impress in wax, and unknown data draws a blank shield rather than throwing.
- Canting: pass the bearer's English name gloss as `gloss` (`["Wolf", "spear"]`); the herald finds
  wolf and spear (`cantingCharges`, with synonyms: "ford" → wave, "hold" → castle, "fire" → flame…).

### Arms

```ts
generateArms(rng, { style?: HeraldryStyle | StyleName, motifs?: ChargeId[], motifChance?=0.92,
                    colours?: Tint[], complexity?: number }): SimpleArms
blazon(arms, { ofTheField?, ordinals? }): string
differenceArms(arms, rng, kind="auto"|"label"|"brisure"|"bordure"|"tincture"|"line"|"canton"|"bendlet", son?): Arms
marshalArms(coats, { method?="quarterly"|"impaled"|"perFess"|"single", escutcheon? }): Arms
cantingCharge(glossWords): EmblemConcept | undefined     cantingCharges(glossWords): EmblemConcept[]
checkTincture(arms): TinctureViolation[]
renderArmsSVG(arms, { shape?="heater", size?=200 (px wide), idPrefix?, palette?="illuminated"|"flat",
                      finish?="rich"|"flat"|"hatched", texture?, ink?, paper?, pad?, attrs? }): string
renderChargeSVG({ charge, attitude?, tincture?, field?, frame?: "tile"|"disc"|"none", size?, … }): string
STYLES, randomStyle(rng, name), resolveStyle(style)
```

### Flags, banners, mon, seals

```ts
generateFlag(rng, { arms?, colours?, motifs?, style?, device?, pattern? }): Flag     renderFlagSVG(flag, { size?, … })   describeFlag(flag)
generateBanner(rng, { style?, motifs?, colours?, arms?, shape? }): Banner           renderBannerSVG(banner | arms, { size? (px tall), staff?, … })   describeBanner(b)
generateMon(rng, { motifs?, abstraction?, ink?, ground? }): Mon                     renderMonSVG(mon, { size?, background? })   describeMon(m)   differenceMon(m, rng)
generateSeal(rng, { legend?, arms?, mon?, motifs?, ecclesiastical?, material? }): Seal   renderSealSVG(seal, { size?, font? })   describeSeal(s)
```

All `generate*` functions are deterministic in their `rng`; all `render*` functions are pure
string builders. Every id in an SVG is prefixed with `idPrefix` (or an automatic unique prefix), so
any number of emblems can share a page; with an explicit `idPrefix` the output is byte-identical
across runs.

## How the generator thinks

- **Plans** in the proportions of medieval rolls of arms: one ordinary (often with charges between),
  charges on a plain field, a divided field, a variation, a semé field. Then additions — chief,
  bordure, canton — whose probability grows with the style's `complexity`. Most coats stay simple
  (tests require >40 % with a single element and <12 % with four or more).
- **Rule of tincture**: everything is tinctured to contrast with what it lies on (`over()`); a
  repair pass fixes slips; 1.2 % of coats break the rule on purpose and are flagged
  (`exception: "metal on metal (arms of enquiry)"`). A stricter *readability* rule also keeps
  ermine off argent, azure off vair, a chief off an ordinary of its own tincture, a bordure off its
  chief.
- **Divided fields are tinctured by what lies on them**: charges over a metal-and-colour division are
  counterchanged; a metal charge lies on two colours ("Per pale Azure and Gules, three lions Or"); a
  colour on two metals.
- **Canting**: a coat decides once whether it cants (`motifChance`); the motif — the head word of the
  name most often — is used exactly once, and if the grammar never placed it, `ensureMotif` puts it
  where it fits (principal charge, between or on the ordinary, on a chief).
- **Styles** weight tinctures, partitions, ordinaries, charges, categories, lines, plans and
  additions, and choose a shield shape; `randomStyle` invents a coherent tradition for a new people.

## How the renderer thinks

- The field is a frame (box + visible polygon: the shield outline, or a quarter of it). Divisions are
  XORs of half-planes bounded by patterned lines, filled evenodd.
- Ordinaries are bands or "ray ordinaries" (cross, saltire, chevron, pall) whose patterned edges are
  phased from the centre — parallel for wavy/nebuly, mirrored for engrailed — and joined where they
  actually cross. Waves and zigzags flatten automatically on diagonals so they never become stairs.
- Charges are fitted, not placed: each charge's silhouette profile is tested against the polygon it
  must sit in, and sizes/positions are searched. Charges *between* an ordinary fill the real
  compartments it leaves (`compartments` + `bestFit`), on any shield shape.
- Marks of cadency find a free spot (middle chief, fess point, dexter chief) and a contrasting tincture.
- Finishes: `rich` (illuminated-manuscript pigments, metal gradients, sheen, vignette, optional
  parchment texture), `flat`, and `hatched` (engraved Petra Sancta hatching, used for seals).
  Detail lines drop out and outlines thicken as size shrinks.

## Tools

```
npx tsx tools/heraldry-demo.ts [seed] [--only=rolls,canting,cadency,marshalling,field,lines,ordinaries,
                                        charges,shields,sizes,flags,banners,mon,seals,icons]
node tools/shot.mjs out/heraldry/demo.html out/heraldry/demo.png 1400 1000 --full=1
node tools/shot.mjs out/heraldry/demo.html out/heraldry/roll.png 1400 1000 --selector=#roll-anglo
npx tsx tools/heraldry-sheet.ts [filter…] [--size=240] [--cols=6] [--grid]   # charge art, large
npx tsx tools/heraldry-gen-preview.ts [style] [n] [seed]                    # one style's roll
npx tsx tools/heraldry-{flags,mon,seals,one,scratch}.ts                      # older focused previews
npx vitest run tests/heraldry
```

## Performance (Node, one core)

generateArms ≈ 0.12 ms, blazon ≈ 0.13 ms, differenceArms ≈ 0.02 ms (brisures ≈ 1 ms: they lay the
coat out to find a free spot), renderArmsSVG ≈ 2 ms and ≈ 19 KB per coat at 150 px (rich finish).
The whole demo page (≈ 600 emblems) builds in under a second.
