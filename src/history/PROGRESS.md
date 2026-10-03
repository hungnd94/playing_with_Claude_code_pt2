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
- [ ] polities (formation, provinces, government, loyalty, revolts, collapse, vassals)
- [ ] persons/dynasties/succession/marriage/epithets
- [ ] diplomacy & war (battles, sieges, peace, raids, migrations)
- [ ] tech & scripts; religion; disasters & climate; trade; wonders & works
- [ ] divergence (culture splits, language stages, assimilation, renames)
- [ ] ages, query additions, tests, tuning, perf

## Decisions
- Provinces: every 10 years each polity's settlements are grouped into
  provinces (a seat town + up to ~8 neighbours); war goals, occupation, revolts
  and successor states operate on provinces so conquest scales with realm size.
- `Polity.culture` = founding culture; `Polity.cultures` (added) = ruling
  culture over time (changes when the people splits/shifts).
- `Polity.rulers[].to` = -1 while reigning at the end of the run; regents are
  not listed in `rulers` (they get a "regent" role + a `regency` event).

## Tuning notes
