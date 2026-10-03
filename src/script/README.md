# Writing systems (`src/script`)

Procedural scripts that are **invented** by a people for its language, **descend**
from one another as hands, tools and languages change, and are **borrowed** and
reshaped by neighbours — the way Proto-Sinaitic became Phoenician, Greek,
Aramaic, Brahmi and their children. Every glyph is drawn from strokes with a
particular tool (brush, broad-nibbed pen, reed, stylus on clay, chisel, knife
on wood, stylus on palm leaf), every glyph keeps its lineage, and any word in
IPA can be written and rendered to SVG or a canvas path.

Everything is deterministic in the `Rng` it is given and plain JSON (a
`Script` crosses the worker boundary and survives
`JSON.parse(JSON.stringify(s))` unchanged). DOM-free; import from
`src/script/index.ts`. The module does not import `src/lang`: it takes IPA
strings and has its own phoneme classifier (`ipa.ts`, checked against every
phoneme `src/lang` can produce).

```ts
import * as S from "../script";

const inv = L.inventory(language);                    // { consonants: string[]; vowels: string[] }
const proto = S.createScript(inv, rng.fork("scr0"), { id: "S0", bornYear: 412 });
const later = S.deriveScript(proto, rng.fork("scr1"), { id: "S1", bornYear: 900, inventory: L.inventory(daughter) });
const borrowed = S.adaptScript(later, L.inventory(neighbour), rng.fork("scr2"), { id: "S2", bornYear: 1050 });

S.renderWordSVG(borrowed, name.phonemes, { size: 28 });         // <svg> of a word (phonemes = string[])
S.renderTextSVG(borrowed, name.words, { size: 28 });            // several words with the word divider
S.textOutline(borrowed, name.words, { size: 18, horizontal: true }); // { d, width, height, baseline } for a map label
S.scriptChartSVG(borrowed);                                     // letter / syllable chart
S.familyTreeSVG([proto, later, borrowed], { labels: { S0: "Old Keshi", S1: "Keshi", S2: "Varan" } });
S.evolutionTableSVG([proto, later, borrowed], { layout: "columns" });
S.describeScript(borrowed, { name: "Varan", parentName: "Keshi" }).sentences;
// ["Varan is an alphabet of 31 letters, 22 for consonants and 9 for vowels.",
//  "It was borrowed from Keshi: 3 letters took new values, 5 new letters were made …", …]
```

---

## 1. The data model (`types.ts`)

A `Script` holds:

| field | meaning |
|---|---|
| `id`, `parent`, `generation`, `bornYear` | identity and lineage (`parent` is the parent script's id, `null` if invented) |
| `kind` | `alphabet` · `abjad` · `abugida` · `syllabary` · `featural` |
| `direction` | `ltr` · `rtl` · `ttb` |
| `style` | how it is written: tool, nib weight, contrast, nib angle, cornering, slant, width, serif, taper, hand jitter, spacing, headline / joined letters / stem line, word divider |
| `morph` | generation DNA: design family + its parameters, preferred diacritics |
| `glyphs` | every letter, sign and mark: strokes on a lattice, box width, cursive entry/exit, mark position, `anc` (parent glyph id), `root` (lineage key of the earliest ancestor), `origin` (`invented` · `inherited` · `mutated` · `derived` · `repurposed`), a short `note` |
| `order` | traditional letter order (glyph ids) for charts |
| `ortho` | how sounds are written (below) |
| `inventory`, `sounds` | the language it was made or adapted for |
| `history` | plain clauses on what happened at this step (`describeScript` turns them into prose) |

Glyph space: x right, y **down**; the body ("x-height") spans y ∈ [0, 1] with
the baseline at y = 1; ascenders reach ≈ −0.45, descenders ≈ 1.45. A
`Stroke` is a centre-line through nodes; segments are straight or circular
arcs (`bend` = sagitta / chord), or a Catmull–Rom spline (`smooth`), or a dot.

**Orthography.** `letters` (phoneme → glyph), `marked` (phoneme → base +
combining mark), `digraphs`, abugida `vowelSigns` (−1 = inherent vowel),
fused `vowelOps` (Ethiopic-style changes to the consonant's shape) with
per-consonant irregular forms in `vowelOpsFor`, syllabics `rotations`,
syllabary `syllables` (`"C|V"` → glyph; `"|V"` for a bare vowel), abjad
`matres`, `finals` (coda signs), `virama`, `carrier` (vowel seat), and
flags for pointing, stacked conjuncts and coda strategy.

## 2. How a script is invented (`createScript`)

1. **Kind.** Unless forced, the language suggests one (`kindWeights`): few
   vowel qualities → abjad; a small set of possible syllables → syllabary;
   many vowels → alphabet; large consonant inventories → abugida.
2. **Design family** — a structural grammar modelled on a real cluster of
   scripts (`families.ts`, `special.ts`):
   `stave` (runic: staves and branches), `geometric` (Tifinagh, South
   Arabian), `hanging` (Brahmic bodies under a headline), `round`
   (Javanese, Burmese, Georgian), `square` (Hebrew, Aramaic), `cursive`
   (Arabic, Syriac, Mongolian: joined skeletons told apart by dots),
   `wedge` (cuneiform clusters), `linear` (Linear B, Vai emblematic signs),
   `tally` (Ogham notches on a stem line), `featural` (Hangul: shape shows
   place, extra strokes show manner, blocks per syllable), `syllabic`
   (Canadian syllabics: one shape turned four ways).
3. **Tool and style** (`style.ts`): the family suggests tools (stave →
   knife/chisel, wedge → stylus, round → palm-leaf stylus/pen/brush…); the tool
   sets weight, contrast, nib angle, cornering, taper and hand jitter;
   direction follows the family's habits.
4. **Glyphs** (`factory.ts`): candidates from the family grammar are
   rasterised (16×24, blurred, with a dot signature) and rejected if they look
   like an existing glyph or tangle on themselves; simpler shapes go to commoner
   sounds. Related sounds may share a shape plus a mark (voicing pairs,
   aspirates: "Ž from Z"); a derived letter must differ visibly from its base.
5. **Kind-specific construction** (`create.ts`): abjad vowel points and
   matres lectionis; abugida inherent vowel, vowel signs placed by vowel
   quality (Brahmic signs under a headline), virama or stacked conjuncts,
   independent vowels — or fused Ethiopic forms (≤ 9 vowel orders, else signs)
   — or syllabics orientations (four turns; further vowels add a dot or ring,
   as Carrier does; coda finals as small raised signs); syllabaries merge
   consonant series to keep ≤ ~96 signs (voicing by diacritic, liquids
   merged as in Linear B) and choose echo vowels or coda signs; featural
   scripts build consonants from place shapes + manner strokes and vowels from
   a long stroke + ticks/dots/hooks.
6. **Legibility pass** (`distinct.ts`): every unit a word can be written with
   (letters, fused and turned forms, syllables; finals among themselves) is
   compared; a fused form lost in its consonant becomes an irregular form, two
   colliding letters get one of the script's own differentiating marks.
   `confusables(script)` reports what is left (nothing at `DUP_LIMIT`).

## 3. How scripts descend and travel (`evolve.ts`, `mutate.ts`)

`deriveScript(parent, rng, { inventory?, drift?, tool?, kind?, direction? })`
— the same people's writing centuries later:

- **Tool change** (12–52 % by drift): stone → brush, reed → pen, pen → knife
  on wood… A new tool imposes its habit first (knife: no horizontals; stylus /
  chisel: curves broken into straight cuts; palm leaf: everything rounds).
- **Script-wide habits** of the hand (`chooseHabits`): roundify, squarify,
  open tops, feet, flags, tails, starting loops, hooks, cursive economy,
  narrowing/broadening, a headline appearing over an abugida, cuneiform signs
  turning on their side.
- **Per-letter idiosyncrasies**: turned on its side, reversed, lost a stroke,
  gained a mark, lengthened its stem, opened, closed into a loop.
- **Direction flips** mirror the letters (Greek turned to face its new direction).
- **Kind changes**, pushed by the daughter language (`kindPressure`): an abjad
  meeting many vowels turns spare consonant letters into vowel letters
  (alphabet) or makes its points obligatory (abugida); an alphabet's vowel
  letters can shrink into signs; a syllabary that cannot hold the language's
  syllables keeps one column as bare consonants and gains vowel signs.
- **Adaptation to the language**: exact matches kept, freed letters
  repurposed for the nearest missing sounds ("once /q/"), new letters derived
  from near ones with a diacritic, unneeded letters dropped.

`adaptScript(script, inventory, rng, { keepUnused?, kind? })` — a script
borrowed by another people: shapes unchanged, letters reassigned, new letters
made, kind changed when the borrowers' sounds demand it (or when forced).

Every glyph keeps `anc` and `root`, so `evolutionTableSVG` can line up one
letter across any set of scripts, and `history` records what happened.

## 4. Writing words (`spell.ts`, `layout.ts`)

`spellWord(script, phonemes)` turns IPA phonemes (a `string[]`; long vowels
"aː", affricates "tʃ", aspirates "pʰ", nasal vowels "ã" are single strings;
stress marks are ignored) into clusters: letters with marks, abjad words with
optional points and matres, abugida syllables with signs / fused forms /
turned forms, conjunct stacks, syllabary signs with echo vowels or coda
signs, featural blocks. A sound the script cannot write falls back to the
nearest writable one. `unwritable(script, phonemes)` lists failures (none for
the script's own inventory).

`layoutWord` / `layoutText` place clusters: pre-base vowel signs, stacked
marks, raised finals, joined cursive with connectors and a word-final swash,
headlines and stem lines across the word, vertical columns (spine scripts are
rotated, block scripts stacked upright), word dividers (space, dot, two dots,
bar), a light per-letter hand wobble (`salt` varies it per place).
`horizontal: true` sets a vertical script on a line (map labels).

Outlines (`outline.ts`) respect the tool: broad-nib thick–thin by nib angle,
reed softness, brush swell and tapered exits, chiselled flared terminals,
knife cuts that taper and overshoot, stylus wedges and Winkelhaken, needle
monoline; dots become rhombi, wedge heads or blobs as the tool makes them.

## 5. API

```ts
createScript(inventory, rng, { id?, bornYear?, kind?, family?, tool?, direction? }): Script
deriveScript(parent, rng, { id?, bornYear?, inventory?, drift? (0..1, default 0.5), tool?, kind?, direction? }): Script
adaptScript(script, inventory, rng, { id?, bornYear?, keepUnused?, kind? }): Script

spellWord(script, word, { pointed? }): Cluster[]
unwritable(script, phonemes): string[]
layoutWord(script, word, LayoutOptions): WordLayout       // items: { d, m }[] + ink box, units of 1/100 em
layoutText(script, words, LayoutOptions): WordLayout
  // LayoutOptions: { pointed?, jitter? (default true), salt?, horizontal? }

renderWordSVG(script, word, SvgOptions): string           // standalone <svg>
renderTextSVG(script, words, SvgOptions): string
renderGlyphSVG(script, glyphOrId, SvgOptions): string     // marks shown on a dotted circle
  // SvgOptions = LayoutOptions + { size? px per em (32), color? ("currentColor"), padding?, background?, ink? (bleed filter, unique ids), idPrefix?, title? }
wordOutline(script, word, SvgOptions): TextOutline        // { d, width, height, baseline, direction } in px: ctx.fill(new Path2D(d))
textOutline(script, words, SvgOptions): TextOutline

scriptChartSVG(script, { size?, color?, labelColor?, ruleColor?, columns?, headings?, background?, gridCells?, gridRows?, accentColors? }): string
evolutionTableSVG(scripts, { size?, color?, labelColor?, ruleColor?, accentColor?, maxRows?, headings?, layout? ("rows" | "columns"), wrap?, background? }): string
familyTreeSVG(scripts, { size?, color?, labelColor?, lineColor?, nodeFill?, labels?, sample?, background? }): string

describeScript(script, { name?, parentName? }): ScriptFacts   // counts, traits, kindNoun, toolPhrase, sentences, changes
confusables(script, limit?): { a, b, sim }[]                  // legibility diagnostics
classify(phoneme): PhonInfo;  phonDistance(a, b): number
```

**Charts.** Alphabets and abjads: letters in traditional order (derived and
repurposed letters flagged by a small accent dot), then vowel points and
marks on a dotted circle. Sign abugidas: consonants, independent vowels, the
vowel signs shown on the first consonant, other marks. Fused / turned
abugidas and syllabaries: consonant × vowel grids, split into side-by-side
panels when tall. Featural: consonants, vowels, sample blocks.

**Theming.** By default all SVG output inherits `currentColor` (labels and
rules at reduced opacity) so it sits on the light and the dark theme alike;
pass colours to override. SVGs use no `<defs>` unless `ink: true`, whose
filter id is unique per call (`idPrefix` to choose it).

**Glosses for UI.** `glyph.sound` is the value shown under chart cells
(syllables "ka", marks "◌u", the vowel killer "◌̸", a vowel seat "∅");
`glyph.note` says how a glyph arose ("from k with dot", "once /q/", "turned
on its side", "marked to tell it apart").

## 6. Tools

```
npx tsx tools/script-demo.ts [seed]      → out/script/demo.html (18 specified + 6 random scripts, a family tree,
                                            evolution tables, a seven-generation lineage, map labels, dark page)
node tools/shot.mjs out/script/demo.html out/script/demo.png 1400 1600 --full=1
node tools/shot.mjs out/script/demo.html out/script/tree.png 1400 1200 --selector="#tree"   (#S7, #deep, #names, #dark…)
npx tsx tools/script-gallery.ts [seed] [count] [derive]   → out/script/gallery.html (random scripts, optional descendants)
npx tsx tools/script-zoom.ts [family] [kind] [seed]       → out/script/zoom.html (big glyphs per tool)
npx tsx tools/script-families.ts [family] [tool]          → out/script/families.html (raw family candidates)
npx tsx tools/script-bench.ts                             → timings per kind/family
npx vitest run tests/script
```

## 7. Performance

Mean `createScript` ≈ 5–10 ms (warm); large syllabaries and fused abugidas
with the legibility pass ≈ 15–45 ms; `deriveScript` ≈ 5 ms; `renderWordSVG`
≈ 0.05 ms per word warm (outlines are cached per script, style and cluster).
The very first call in a process pays JIT warm-up (~50–100 ms). A script is
≈ 8 KB of JSON.

## 8. Limitations / ideas

- Ligatures beyond cursive joins and Brahmic stacks are not modelled.
- Stroke order and ductus are implicit in the outlines, not animated.
- Abugida vowel signs are generated per position, not from letter shapes,
  except when an alphabet's vowel letters shrink into signs.
- Numerals and punctuation beyond the word divider are not generated.
