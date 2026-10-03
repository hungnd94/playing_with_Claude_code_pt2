# Brief: the narrative engine (src/narrative/)

You own: `src/narrative/**` (except `types.ts`, the contract with the UI — you may extend it
*additively*; note additions in PROGRESS.md), `tests/narrative/**`, `tools/narrative-*.ts`.

Read: `src/narrative/types.ts` (Article, Block, Inline/Rich, Figure, ChronicleEntry,
SearchEntry — what the app renders), `src/history/types.ts` and `src/history/query.ts`
(the data you write about; HEvent `data` payloads are documented next to their emitters in
src/history), `docs/HISTORY.md`, `docs/UI.md`, `src/world/types.ts` (features & attrs),
`src/lang/README.md` (etymologies, sentences/utterances, labels like "Old X").

Purpose. The world writes about itself. Every entity gets an encyclopedia article and every
event a chronicle line, all as structured rich text (never HTML) so every name is a link,
every year a timeline jump, every native word a hoverable gloss. The prose is what people
will read for hours — it must be good: the tone of a fine encyclopedia or a sober chronicle
(plain, concrete, varied, specific; never purple, never generic filler, no emoji), with cause
and consequence, aggregation (not one sentence per event), sensible pronouns, transitions
("Three years later…", "Under his son…", "Meanwhile, in the south…"), and numbers rounded the
way a historian would ("some 40,000 souls").

API (`src/narrative/index.ts`), all pure and deterministic given (world, args):
- `articleFor(world: World, ref: Ref, opts?: { year?: number }): Article` for every
  EntityKind: world overview, settlement, polity, person, dynasty, culture, language, script,
  religion, deity, myth, war, battle, wonder, work, trade route, disaster, feature, age,
  event, year. Lead paragraph with the essentials; infobox (emblem, dates, capitals, rulers,
  population/area sparklines as chart figures, languages, faith…); body sections in
  chronological narrative; figures where they earn their place (emblems, maps, charts, trees,
  script samples, phoneme charts, cognate tables, mottoes as utterances); See also.
  - Settlements: founding (by whom, why there), names through time with etymologies
    ("The city's name comes from Old Keshi *Kaś-tabar, 'stone ford'; under Ashkari rule it was
    known as Toroshan"), rulers, sieges, plagues, wonders, notable natives, population chart.
  - Polities: origins, rulers & dynasties, expansion and losses (with territory map figures at
    key years), wars, government changes, faith, culture, fate; title in native language.
  - Persons: a biography — birth, family, accession, deeds, marriages, children, death,
    epithet explained ("called the Builder for the walls of …"), regnal names.
  - Wars & battles: causes, belligerents, campaigns, decisive battles, commanders, casualties,
    the peace and its terms, consequences.
  - Cultures, languages (sound laws in notation + plain English, family tree, cognate table,
    sample sentence with interlinear gloss), scripts (origin story, chart, evolution), religions
    (founding, tenets in prose, pantheon, myths retold, schisms, spread), deities (domains,
    epithets, myths, cult centres), features (names in each language, geography in plain
    terms from attrs, history that happened there).
  - Myths are retold in a mythic register (still plain, concrete), from the structured Myth.
- `chronicle(world, opts: { from; to; minImportance; filter? }): ChronicleEntry[]` and
  `eventLine(world, eventId): Rich` — one good sentence per event, varied templates chosen
  deterministically, enriched with context (who ruled, what led to it), legendary register for
  events of not-yet-literate peoples ("It is said that…", "In the songs of the …").
- `worldOverview(world): Article` — the front page: the planet (continents, oceans, climate
  in brief), the realms of the present, the ages of history with one paragraph each, great
  figures, great wars, "curiosities" mined from the data (longest reign, oldest city, most
  renamed place, largest empire ever, the faith with most schisms…).
- `summarizePeriod(world, from, to): Block[]` — "this age/century in brief" for the timeline.
- `searchIndex(world): SearchEntry[]` — all entities with current/old/foreign names.
- Small text utilities (`text.ts`): a/an, plurals, ordinals, roman numerals, number words,
  list joining, rounding, date ranges, durations.

Quality process. `tools/narrative-dump.ts <seed>` generates a world + history and writes
out/narrative/<seed>/ with the world overview, the chronicle of major events, and a sample of
~40 articles of every kind rendered as plain text/markdown. READ them closely, as an editor
would, for several seeds. Hunt for: repetition, template feel, wrong pronouns/numbers/tenses,
contradictions with data, missing causes, dull lists, broken links, "undefined"/"NaN".
Rewrite until a reader would believe a person wrote it. If the history data lacks something
you need to tell a story well, write a precise request into PROGRESS.md under "requests for
history".
Tests: every entity of a generated world produces an article without throwing; no
"undefined"/"NaN"/"[object" in any text; all link refs valid; determinism.
Performance: an article < 20 ms; the full chronicle of major events < 300 ms.
