# Brief: the application (src/app/)

You own: `src/app/**` (index.html fragment, main.tsx, worker.ts, styles, components),
`tests/app/**`, `tools/app-*.ts`. Read `docs/UI.md` (your spec), `docs/HISTORY.md`,
`src/world/world.ts`, `src/world/types.ts`, `src/history/types.ts`, `src/narrative/types.ts`
(Article/Rich/Chronicle/Search contract you render), and `tools/build.mjs` (bundles
src/app/worker.ts into `__WORKER_SOURCE__`, src/app/main.tsx with Preact JSX + CSS; writes
dist/index.html and dist/artifact.html). `npm run build`, screenshot with
`node tools/shot.mjs dist/index.html out/app/x.png 1440 900 --wait=15000` (supports
`--waitfor=<js predicate>`, `--eval=<js>`; expose `window.__app` for scripted navigation).
Look at desktop (1440×900) and phone (390×844), light and dark.

Hosting (published as a claude.ai Artifact — obey strictly): one self-contained file; only
Google Fonts external; index.html is a fragment (no doctype/html/head/body) starting with
<title>Palimpsest</title>, font links, <style>, root div, <script>; host pads :root with
safe-area insets — keep it; fixed bars add env(safe-area-inset-*); height:100% not 100vh;
Workers from blob: URLs OK, service workers not; no alert/confirm/prompt/downloads/print; only
bare `#token` hashes (`#seed-<word>`); localStorage only for conveniences in try/catch. Theme:
every colour a token on :root (light), redefined under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…; color-scheme: dark} }`
and `:root[data-theme="dark"]`; body explicit background. Phone width without horizontal
scroll; prefers-reduced-motion; visible focus; stable ids on form controls.

Build:
1. Pipeline (worker.ts + protocol.ts): generate → `generatePhysical` with progress → post world
   (transfer arrays) → bake textures (src/render bake functions; 2048 first, 4096 later
   optional) → post → `simulateHistory` (src/history/index.ts; feature-detect; until it works
   use your mock in src/app/dev/) with live snapshots → post History → done; errors posted.
2. Shell per docs/UI.md: top bar, globe stage (GlobeView; overlay from timeline layers at the
   current year via `src/history/query.ts` `layerAt` when present), settlement markers, labels,
   reading pane with tabs (World, Chronicle, Encyclopedia, Atlas, Tongues, Scripts, Faiths,
   Heraldry) + back/forward, timeline dial (age bands, event histogram, play/pause/speed,
   keyboard), search palette ("/", ⌘K), genesis experience (stage captions, live history with
   year counter and ticker, skip), seed entry + curated seeds, `#seed-` deep links.
3. Rich renderer for src/narrative/types.ts: links (hover pings the globe; click opens article
   and flies there), native names (italic + hover card: IPA, gloss, etymology, native script via
   src/script when literate), years (→ timeline), blocks (drop caps, headings, interlinear
   utterances, quotes, lists, tables, figures: emblems via src/heraldry, elegant SVG charts with
   theme tokens, family/language/script/religion trees, script samples/charts, phoneme charts
   (IPA consonant table + vowel trapezoid), cognate tables, mini maps). The narrative engine
   (src/narrative: articleFor, chronicle, worldOverview, searchIndex) is being written; until
   it exists use a minimal fallback in src/app/dev/ behind one import site.
4. Viewers: Tongues, Scripts, Heraldry roll, Faiths.
5. Performance: 60 fps scrubbing (overlay = small texture upload), windowed long lists, lazy
   articles.

Typography: "IM Fell English", "IM Fell English SC" (display, labels), "Alegreya" (reading),
"Alegreya Sans", "Alegreya Sans SC" (UI chrome), fallback stacks, tabular numerals; check
diacritics (š, ā, ŋ, þ, ǫ…). Identity per docs/UI.md — no generic dashboard look.
