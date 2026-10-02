# Brief: procedural writing systems (src/script/)

You own: `src/script/**`, `tests/script/**`, `tools/script-*.ts`.

Purpose. Writing is invented by some culture and spreads by borrowing and modification, like
real scripts (Proto-Sinaitic → Phoenician → Greek/Aramaic → …). Each script has its own visual
personality, glyphs look handwritten with a particular tool (brush, reed pen, stylus on clay,
chisel, broad-nib pen, knife on wood/bark); descendants resemble ancestors yet differ. The UI
shows script charts, a family tree with glyph evolution tables, and place names in native
script beneath their romanisation on maps and in the encyclopedia.

Interface with src/lang (don't import it): phonemes are IPA strings; inventory
`{ consonants: string[]; vowels: string[] }`; a word is `string[]` of IPA phonemes (long vowels
"aː", affricates "tʃ", aspirates "pʰ", nasal vowels "ã" are single strings). Own IPA classifier.

Design (document in `src/script/README.md`): kinds alphabet/abjad/abugida/syllabary/featural
blocks; directions ltr/rtl/ttb; per-script style (tool, contrast, nib angle, cornering, slant,
proportions, headline/cursive/none, terminals, stroke count, symmetry, diacritics); glyphs from
strokes on an anchor lattice with a per-script grammar, distinguishable (rasterised
near-duplicate rejection), outlines respecting the tool; `deriveScript(parent, rng, opts)` with
glyph mutations, style drift, kind changes, per-glyph lineage; `adaptScript(script, inventory,
rng)`; `layoutWord`, `renderWordSVG(script, word, { size, color })`, `renderGlyphSVG`,
`scriptChartSVG`, `evolutionTableSVG` (unique defs ids); fields id/parent/kind/direction/style/
bornYear; plain JSON.

Visual verification: `tools/script-demo.ts` → out/script/demo.html; screenshot with
`node tools/shot.mjs out/script/demo.html out/script/demo.png 1400 1600 --full=1` (and zoomed
crops `--dpr=2 --selector=...`), READ the PNGs, iterate until scripts feel at home beside
Ge'ez, Tifinagh, Runic, Brahmi, Hebrew, Mongolian, Cherokee, Linear B, Ogham, Georgian,
Javanese, Syriac.
Tests: determinism, glyph coverage, adaptation covers inventory, finite layout, valid SVG.
Performance: create < 50 ms.
