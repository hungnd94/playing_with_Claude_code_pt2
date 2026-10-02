# History simulation — design

The history simulation turns a lifeless `PhysicalWorld` into a world with a
past. It is an agent-based model at the scale of *settlements, realms and
notable people*, ticking once per year for `params.years` years (default
3000). Its product is a `History` (`src/history/types.ts`).

The goal is not realism for its own sake but **stories that feel inevitable in
hindsight**: geography should shape history (river valleys cradle the first
cities, steppes breed horse empires, mountains shelter holdouts, straits become
choke points, deserts are crossed by caravans), and causes should be legible
(the war began because the king's brother died without heirs; the empire
fragmented after the plague; the city's name changed when the conquerors'
language replaced the old one).

## Scale

* ~40k cells, of which ~35% land. A cell is roughly 70–90 km across.
* At most one settlement per cell. Expect ~1,500–5,000 settlements over the
  whole history, ~50–300 polities, ~5k–30k recorded persons (rulers, their
  families, generals, prophets, scholars), ~10k–60k events.
* Persons are only those history would remember. No commoners.

## Time and technology

Technology is tracked per culture as a level that rises through inventions
and diffusion. Levels (`TECH_LEVELS`, fractional values allowed for
progress):

| Level | Name | Effects |
|---|---|---|
| 0 | Neolithic | villages, tribes; land capacity ×1 |
| 1 | Bronze | chiefdoms → kingdoms; ×1.4 capacity; copper+tin trade matters |
| 2 | Writing | scripts appear; administration reach +; chronicles become reliable |
| 3 | Iron | ×1.7 capacity; armies larger; iron deposits matter |
| 4 | Classical | coinage, roads, philosophy; empires; organised religions |
| 5 | Medieval | castles, heavy cavalry, feudal vassals; ×2.2 capacity |
| 6 | Early modern | printing, gunpowder, ocean navigation; ×2.8 capacity |

Seafaring range grows with level and with a culture's `seafaring` value
(coastal hopping early, open-ocean crossings late), which drives colonisation
of other continents and first-contact events.

Before a culture has writing, its events are still simulated but the
narrative presents them as legend ("it is said…"). This is recorded per event
via the culture's script history, so prose can change register as literacy
spreads.

## Peoples and their tongues

* **Origins.** 8–16 founding cultures appear at year 0 in the best
  agricultural sites (river valleys, floodplains, fertile coasts), spread
  across landmasses; plus 1–3 pastoral peoples on steppes. Each gets a
  proto-language (seeded with a flavour from its homeland), an archetype, and
  value weights.
* **Divergence.** When a culture's settlements become separated (by sea, by
  distance > N days' travel from its cultural core, or by long rule under
  different realms), the separated group can **split** into a daughter culture
  with a daughter language (`deriveLanguage`); existing place names in that
  group **evolve** through the new sound laws (recorded as `evolved` name
  changes). Languages also evolve in place every ~500–800 years
  ("Old X" → "Middle X" → "X").
* **Assimilation.** Settlements under long foreign rule, or swamped by
  migrants, shift culture; when they do, their names may be **borrowed** into
  the new language (`borrowName`) — an exonym replaces the old name, and the
  old one survives in the name history.
* **Naming.** Settlements are named by founders from site descriptors (river,
  ford, hill, oak, salt, the colour of the stone, a founder's name, "New X"
  for colonies). Geographic features are named by the first culture to live
  beside them, from their attributes (the Great River, the White Mountains,
  the Salt Sea). Other cultures name them again in their own tongues.

## Settlements and population

* Each settlement owns a catchment (cells nearest to it by travel cost within a
  radius). Carrying capacity = Σ fertility × area × density(tech) over the
  catchment, plus bonuses for rivers, coasts, resources, trade and capital
  status. Urban population (what is displayed) is a tech-dependent fraction.
* Growth is logistic with noise; losses come from war, sieges, plague,
  famine and disasters.
* Under population pressure a settlement founds daughters at good free sites
  within reach (score: fertility, river, coast, resources, defensibility,
  distance), keeping a minimum spacing. Seafaring cultures found colonies
  across water.
* Settlements can be sacked, abandoned or ruined; ruins can be resettled
  later (often with a borrowed form of the old name).

## Realms

* Polities form when a settlement cluster of one culture passes size and tech
  thresholds (tribe → chiefdom → kingdom). Government types change over time
  (kingdom → empire when ruling several cultures or many settlements;
  city-states and republics among mercantile coastal cultures; theocracies
  where a faith is strong; hordes among steppe peoples; confederations from
  alliances).
* **Territory** is recomputed every 5 years with a multi-source Dijkstra over
  land travel cost from each owned settlement, weighted by settlement size and
  realm strength, bounded by an administrative reach that grows with tech and
  shrinks with distance from the capital.
* **Cohesion** (per settlement loyalty) falls with distance from the capital,
  cultural/religious difference from the rulers, recent conquest, war
  weariness, bad rulers and succession crises; low loyalty causes revolts and
  secession (new polity, often named after the region or the rebel city).
* Large polities in crisis (bad succession + revolts + invasion + plague)
  **collapse** into successor states. Collapses and golden ages are named.

## Rulers, dynasties and notable people

* Rulers have traits, marry (often across borders, creating alliances and
  claims), have children (realistic fertility and child mortality), and die
  (age, illness, battle, plague, assassination).
* Succession follows the realm's law (primogeniture, seniority, elective,
  tanistry for steppe peoples, election for republics, appointment for
  theocracies). No heir → crisis; rival claimants → succession war;
  usurpers found new dynasties; cadet branches form when younger sons get
  their own realms. Regnal numbers count earlier rulers of the same name in
  the realm and its predecessors.
* Posthumous **epithets** are earned from deeds (the Conqueror, the Builder,
  the Lawgiver, the Pious, the Cruel, the Unlucky, the Brief, the Old, the
  Child, the Mad, Kinslayer, the Great…).
* Generals emerge in wars; prophets in times of crisis; scholars, poets and
  builders in prosperous cities. Each gets a short life record.

## Diplomacy and war

* Relations between polities in contact track opinion (shared culture/language
  family, religion, royal marriages, trade, grudges from past wars, border
  friction, claims on each other's lost provinces). Alliances form and break.
* War probability rises with ruler ambition/aggression, relative strength,
  low opinion, claims and religious difference; falls with exhaustion.
  Casus belli is recorded.
* Wars proceed year by year: armies (fraction of strength by tech/culture)
  fight field battles at frontier sites and besiege settlements (walls,
  mountains and rivers favour defenders; commanders' skill matters). Notable
  persons can die in battle. Occupied settlements accumulate war score.
* Peace transfers occupied settlements by war score; total defeat means
  annexation or vassalage; long indecisive wars end in white peace.
* Wars, battles and treaties get names from places and causes ("the War of
  the Three Crowns", "the Salt War", "the Battle of Velm Ford", "the Peace of
  Tor Oshen"); long ones may earn "the Hundred Years' War"-style names.
* Nomad **migrations/invasions** occasionally sweep out of the steppe, and
  sea raiders from cold coasts, creating dramatic upheavals.

## Belief

* Each founding culture has a **folk religion** with a pantheon drawn from its
  world: gods of the specific great river and mountain it lives beside, of the
  sun, moon, sea, storm, harvest, death, forge… with family relations and
  structured myths (creation, flood, origin of the people).
* After writing and cities, **prophets** may found organised religions
  (monotheism, dualism, philosophy, mystery cults) with tenets, a holy city,
  clergy and scripture. Faiths spread by proximity, trade, conquest and royal
  conversion; they **schism** over doctrine or succession; holy wars follow.
* Temples and cathedrals are built; pilgrimages to holy cities; heresies
  suppressed.

## Knowledge, culture and trade

* Inventions occur in large, prosperous, connected cities and diffuse along
  borders and trade routes. **Writing** is invented a few times at most;
  other cultures borrow and adapt scripts from contacts, building script
  family trees that mirror contact history.
* **Trade routes** connect large settlements with complementary resources by
  land (caravans), river and sea; they carry goods, wealth, ideas, faith and
  plague.
* **Wonders** (temples, palaces, walls, libraries, lighthouses, tombs,
  observatories, aqueducts, bridges) are raised by rich rulers and destroyed
  by war or earthquakes. **Works** (epics, chronicles, scriptures, law codes,
  treatises) are written by notable persons about events and persons.

## Nature strikes back

* **Plagues** emerge in large connected cities and spread along trade routes
  and borders over a few years, killing 10–50% where they pass; the worst get
  names.
* **Eruptions** near volcanic cells, **earthquakes** on active boundaries,
  **floods** on great rivers, **famines** in marginal lands during global cold
  spells (a slow climate noise drives warm and cold centuries).

## Outputs

* Entities and the event log (`History`), with cross-references on every
  event so the encyclopedia can list "what happened here / to them".
* Timeline layers (owner polity, culture, religion per cell) every 5 years as
  keyframes + diffs.
* Population and realm statistics every 10 years.
* Named ages of world history, derived after the run from the biggest events.
