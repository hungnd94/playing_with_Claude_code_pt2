# History simulation — progress notes

Owner: history engineer. Successor: read this first, then `docs/HISTORY.md`,
`src/history/types.ts`, `src/history/index.ts`.

## Status (session 2, resumed after container restart)
Inherited (session 1, working): sim context (`sim.ts`), geo precompute (`geo.ts`),
naming adapter (`names.ts`), emblems adapter, founding cultures (`cultures.ts`),
settlements & demography & expansion (`settlements.ts`), catchment territory +
layers (`territory.ts`), folk religions (`folk.ts`), feature naming,
timeline recorder, stats, live snapshot, `describe.ts` (one-liners for every
event type), `query.ts`, `tools/history-run.ts` + `tools/history-map.ts`.
At resume: run produced settlements only (no polities, persons, wars, tech…);
5.7 s for 3000 years.

- [x] assessment (session 2)
- [x] **v1 works** (session 2): every system at least basic; `simulateHistory` runs
  3000 years in ~12 s (Node, shared box), `tools/history-run.ts` prints stats +
  chronicle and writes political/culture/religion maps.
  Systems: polities.ts (formation, provinces, government, loyalty, revolts,
  collapse, vassals, unions, confederations), people.ts (persons, dynasties,
  marriage, births, succession by law, regency, unions, civil wars, epithets,
  regnal numbers), war.ts (opinion, declarations, alliances, battles, sieges,
  sacks, peace/annexation/vassalage, names of wars/battles/treaties, raids,
  migrations, civil/claim wars), tech.ts (levels, named inventions, writing
  invented/adopted/derived), religion.ts (prophets, organised faiths, spread,
  conversions, schisms, heresies, pilgrimages, miracles), disasters.ts (climate,
  plague, eruptions, earthquakes, floods, famine, drought), trade.ts (routes with
  paths/goods/names, wealth), wonders.ts (wonders, works, walls, golden/dark
  ages), divergence.ts (language stages, culture splits, assimilation, conquest
  renames, restorations).
- [ ] tests (tests/history), query.ts additions, ages.ts
- [ ] tuning: realm life cycles (cohesion), map colours, famines, counts
- [ ] perf pass (< 15 s target with margin)

## Decisions
- Provinces: every 10 years each polity's settlements are grouped into
  provinces (a seat town + up to ~8 neighbours); war goals, occupation, revolts
  and successor states operate on provinces so conquest scales with realm size.
- `Polity.culture` = founding culture; `Polity.cultures` (added) = ruling
  culture over time (changes when the people splits/shifts).
- `Polity.rulers[].to` = -1 while reigning at the end of the run; regents are
  not listed in `rulers` (they get a "regent" role + a `regency` event).

## Tuning notes
