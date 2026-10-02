# Brief: the history simulation (src/history/)

You own: `src/history/**` (including `types.ts`, the contract I drafted — refine/extend it,
keep it coherent, documented, plain JSON + typed arrays; the narrative engine, atlas and app
are built against it, so avoid gratuitous renames), `tests/history/**`, `tools/history-*.ts`.

Read first: `docs/HISTORY.md` (the simulation design — follow it), `src/history/types.ts`,
`docs/UI.md` (how output is used), `src/world/types.ts`, `src/geo/index.ts` +
`src/geo/travel.ts`, `src/lang/index.ts` + README (naming, deriveLanguage, evolveName,
borrowName, sentences/mottoes, toWName/toUtterance), `src/script/index.ts` + README,
`src/heraldry/index.ts` + README (generateArms, differenceArms, marshalArms, cantingCharge,
blazon, mon/seal, flags, renderEmblemSVG), `src/world/concepts.ts`.

The goal: stories that feel inevitable in hindsight — geography shapes destiny, causes are
legible, memorable arcs (a dynasty's rise and fall, a long war, a great migration, a prophet's
faith sweeping a continent). Think Dwarf Fortress legends, Crusader Kings dynasties, an
Europa Universalis map in motion, a real historical atlas.

API: `simulateHistory(world: PhysicalWorld, rng: Rng, opts?: { years?; onProgress?(year,
fraction); onSnapshot?(snap: LiveSnapshot) }): History` in `src/history/index.ts`; `onSnapshot`
every ~10 simulated years with a small payload for the live preview (year, per-cell owner or a
diff, polity colours, the most important recent events). `src/history/query.ts`: value-at-year
for change lists, fast `layerAt(timeline.layer, year)` (called while scrubbing), current
names of settlements/polities/features at a year, ruler at year, polity title builder
("Kingdom of Ashkar", "the Ashkari Empire", "Most Serene Republic of …"), regnal display names
("Oshar III the Bold"), person age, population at year, etc.

Architecture: a `Sim` context (world, rng forks, entity arrays, spatial indices, event emitter)
and system modules (demography & settlement, territory, polities & government, rulers/
dynasties/succession, diplomacy & war, religion & myth, culture/language/script divergence &
diffusion, technology, trade, disasters & plague, wonders & works, feature naming, ages) with
init/tick in a fixed order; expensive scans every 5–10 years. Target: default run (40k cells,
3000 years) **< 15 s in Node**.

Integration: names via the lang API converted to WName with etym strings; per-world
registries; settlement names from real site descriptors (river/ford/coast/harbor/hill/
mountain/forest/marsh/oak/pine/salt/stone/colours… from the actual cell) and founder/
mother-city patterns; evolveName on splits/language stages, borrowName (exonyms) on
conquest/assimilation, old names kept; FeatureNaming by first settlers then others. One
proto-language per founding culture, deriveLanguage for splits and Old → Middle → modern
stages; Language entries with English names. Writing invented a few times (tech ≥ 2, big
cities), others adapt/derive scripts from contacts. Emblems for polities, dynasties (canting
from the dynasty name gloss), religions; cadet differencing; marshalling for unions; culture
picks the tradition. Mottoes via lang sentences. Deterministic.

Tuning targets (default world): 1.5k–5k settlements ever; at the end 15–60 independent
polities, largest < 30% of land; several empires rose and fell; ≥1 major collapse; borders
shift each century; 150–600 wars with battles, sieges, named treaties, succession wars and
rebellions; 20–60 languages in 5–14 families; 3–10 scripts (1–3 inventions); 3–8 organised
religions plus folk faiths, schisms; dynasties from decades to centuries; traits, epithets,
regnal numbers, plausible family trees; plagues every few centuries; eruptions/earthquakes near
plate boundaries; famines in cold centuries; 10k–60k events with full cross-references and
`data` a writer needs (who, where, why, outcome); ~2–5% importance ≥ 4.

Tools: `tools/history-run.ts <seed> [years]` — timings per system, per-century stats, top
polities and fates, sample dynasties, biggest wars, a raw chronicle of importance ≥ 4; PNG
political maps every 250 years in out/history/<seed>/ — LOOK at them (contiguous realms following
rivers/mountains, believable change). Read the chronicle as a historian would; iterate.
Tests: determinism; referential integrity; sorted change lists; birth < death, parents older
than children; layerAt equals simulated state at snapshots; no ended polity owns cells.
