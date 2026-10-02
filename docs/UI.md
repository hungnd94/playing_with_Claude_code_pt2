# Palimpsest — interface design

## Identity

The interface is an **astronomer-cartographer's instrument**: a night-sky
workspace in which the planet floats, surrounded by the apparatus of a
scholar — a brass timeline dial, vellum pages of the encyclopedia, an atlas
plate, heraldic rolls. It should feel like a precious object, not a dashboard.

* **Dark theme (default feel):** deep lapis-black (`#0b0f1a`-ish, blue-biased,
  never neutral grey), with gilt (`#c9a45c`-ish) as the single accent for
  focus, links and the timeline; vellum (`#efe6d2`-ish) only for paper
  surfaces (atlas plates, the encyclopedia page in light mode).
* **Light theme:** vellum ground, iron-gall ink text (`#2a2117`-ish), lapis
  (`#2d4f8a`-ish) links, vermilion (`#a8432a`-ish) only for rubrics (initial
  capitals, the current-year marker). Not a mirror of the dark theme.
* **Type:** a characterful old-style display face for titles and map labels
  (IM Fell English / IM Fell English SC — the real 17th-century Fell types),
  a humanist literary serif for reading (Alegreya), its sans sibling for UI
  chrome and small caps labels (Alegreya Sans / Alegreya Sans SC), tabular
  figures for years and numbers. Generated native names may contain diacritics
  (š, ā, ŋ, þ…): the faces must cover Latin Extended-A/B — check fallback.
* Ornament is restrained and earned: rubricated drop caps on article leads,
  fleurons between sections, hairline double rules on infoboxes, a compass
  rose on the atlas. No emoji, no gradients-on-everything, no rounded "cards"
  on every block.

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ PALIMPSEST  ·  world "Velmarra" (seed)   [layers] [new world] │  top bar (thin)
├───────────────────────────────┬───────────────────────────────┤
│                               │  Encyclopedia / Chronicle /   │
│            GLOBE              │  Atlas / Tongues / Faiths …   │
│   (rotate, zoom, pick)        │  (reading pane, scrolls)      │
│                               │                               │
├───────────────────────────────┴───────────────────────────────┤
│ ◀ ▶  ───────●──────────────────────────────── Year 1182  ⏵ 1× │  timeline dial
│      age bands: Age of Founding | Bronze Kings | …            │
└───────────────────────────────────────────────────────────────┘
```

* Desktop: globe left (~58%), reading pane right; the pane can be collapsed to
  give the globe the whole screen, or expanded for reading.
* Phone: globe on top (45vh), pane below as a sheet with tabs; timeline pinned
  to the bottom with safe-area padding.
* The **timeline** is always visible: a scrubber across all years with the
  named ages as bands, event density as a faint histogram (wars red-ish,
  plagues dark, golden ages gilt), play/pause and speed. Scrubbing updates
  the globe overlays instantly and the "This age" summary in the pane.

## Flow

1. **Genesis screen** (first load): the globe appears immediately as the
   planet generates — stage captions in small caps ("Plates drift… Mountains
   rise… Rain falls… Rivers find the sea…"). Then the history runs live:
   year counter racing, borders spreading, a ticker of major events fading in
   and out. A "Skip to the present" control. The first frame must never be
   empty: show the starfield and a placeholder planet.
2. **Explore**: on completion the timeline sits at the final year, the pane
   shows the **World** article (overview: continents, the great realms of the
   present, the ages of history, the most famous people, a list of "curious
   facts" mined from the data).
3. Clicking the globe selects the cell → pane shows the place at the current
   year: settlement (if any) → realm → culture → landscape, with links.
4. Every name in text is a link. Hovering a link to a place pings it on the
   globe; opening an article flies the globe there and highlights it (realm
   territory, war theatre, culture area, religion spread, route of a trade
   road, a river's course).
5. **Search** (⌘K / "/"): fuzzy search over all entity names (native and
   English), with type badges.
6. **New world**: seed input + "random" + a few curated seeds; changing the
   seed regenerates. The current seed is shown and copyable so worlds can be
   shared (and `#seed-<word>` deep links work).

## Panes

* **World** — overview article (see above).
* **Chronicle** — annals: year headings, one line per event, importance
  filter (major / notable / all), filters by realm/culture/region, legend
  register for preliterate events, jumps the timeline when a year is clicked.
* **Encyclopedia** — article view for any entity: title with native name,
  IPA and gloss; infobox (emblem, dates, capital, rulers, population sparkline
  …); body sections; "See also". Back/forward history inside the pane.
* **Atlas** — an atlas plate (fantasy cartography) of the region in view at
  the current year, generated on demand; can be expanded full screen.
* **Tongues** — language family trees (as a proper tree diagram), per-language
  pages with phoneme charts (IPA consonant/vowel tables), sound laws, sample
  vocabulary, a comparative cognate table across a family, place-name
  etymologies, the native script chart.
* **Scripts** — script family tree with glyph evolution tables.
* **Faiths** — religions and pantheons, myths, holy cities, spread over time.
* **Heraldry** — the roll of arms: all realms and dynasties' arms with
  blazons, filterable by year.

## Layers (globe)

Terrain (no overlay) · Realms (political, with borders) · Peoples (culture) ·
Tongues (language family colouring) · Faiths (religion) · Population (heat of
settlements) · plus toggles for settlements, labels, trade routes, battles.

## Interaction details

* Keyboard: space play/pause, ←/→ step 10 years (shift: 100), "/" search,
  "Esc" closes overlays.
* All state that matters is in the URL hash as a bare token where possible
  (`#seed-velmarra`), everything else in memory.
* `prefers-reduced-motion`: no auto-rotation, instant transitions.
