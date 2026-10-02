# Brief: the language engine (src/lang/)

You own: `src/lang/**`, `tests/lang/**`, `tools/lang-*.ts`. Read `src/world/concepts.ts` (every
EMBLEM_CONCEPTS entry in every lexicon), `src/core/rng.ts`, and `src/history/types.ts`
(WName, Utterance, Language): the history simulation converts your names/sentences into those
shapes — export `toWName(name)` and `toUtterance(sentence)` producing exactly those interfaces.
The history engineer is using your API *right now*: keep public signatures stable; if you must
change one, keep a compatible wrapper and note it in PROGRESS.md.

Purpose. Peoples speak procedurally generated languages that split into daughters via
**regular sound changes**, giving real families with cognates. Everything named in the world
gets a name with a literal gloss and an etymology, e.g. "Kešdavar (from Old Keshi *Kaś-tabar
'stone ford')", plus cognate tables, phoneme charts and sound laws ("*t > d / V_V").
Quality bar: each language has a distinct, coherent, natural 'look' (Finnish vs Welsh vs Arabic
vs Japanese vs Nahuatl vs Old Norse vs Hawaiian vs Georgian); names pronounceable and pleasant
in English text; sound changes attested-type.

Design (document final API in `src/lang/README.md`):
- Phonemes as IPA strings with features; words `string[]`; `inventory(lang)` →
  `{ consonants: string[]; vowels: string[] }` for the script module.
- Proto-languages: plausible inventories, sonority-respecting phonotactics, stress, optional
  harmony, Zipfian frequencies, word-shape preferences, optional homeland flavour.
- Lexicon (`concepts.ts`, ~300–500 concepts with POS incl. ~40 verbs); basic roots short.
- Morphology: compounding order, linkers, derivational affixes (place/land, demonym, adjective,
  diminutive, augmentative, agent, plural, genitive), article, noun–adjective order, clause
  order, case vs adpositions, tense/aspect, imperative.
- Orthography: realistic per-language spelling schools giving families a recognisable look that
  drifts in daughters; no ugly/ambiguous spellings; IPA with stress.
- Sound change: feature-based rules with environments, 3–8 per split, regular, each with a
  description and notation; inventory recomputed.
- Families: `deriveLanguage(parent, rng, year)`; Old/Middle/Proto labels; endonyms.
- Naming (called thousands of times): settlements (site descriptors, founder, "New X"), realms,
  peoples/demonyms, natural features with descriptors, deities by domain, religions,
  dynasties, personal names (gendered where marked; dithematic or simple; patronymics/clans).
  Each name: { lang, phonemes, roman, ipa, gloss, parts }. Uniqueness registry.
- `evolveName`, `borrowName`, etymology strings.
- Mini-grammar `sentence(lang, clause)` with Leipzig-style 3-line gloss; motto/proverb generator.
- Deterministic; plain-JSON serialisable (crosses a Web Worker boundary).

Tools: `tools/lang-demo.ts <seed>` — read critically for many seeds; iterate.
Tests: determinism, phonotactics, sound-change regularity, borrowName inventory, rare
romanisation collisions, EMBLEM concepts present, JSON round-trip.
Performance: proto < 20 ms, derive < 10 ms, name < 0.1 ms.
