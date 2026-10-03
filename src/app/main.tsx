/**
 * Palimpsest — application entry. Boots the theme, the playback loop and the
 * generation pipeline for the seed in `#seed-<word>` (or a curated seed).
 */
import { render } from "preact";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/stage.css";
import "./styles/timeline.css";
import "./styles/pane.css";
import "./styles/article.css";
import "./styles/figures.css";
import "./styles/overlays.css";
import "./styles/viewers.css";
import { App } from "./ui/App";
import { app, initTheme, navigate, openRef, setYear, currentLoc } from "./state/app";
import { initPlayback, finishGenesis } from "./state/playback";
import { generate } from "./state/generation";
import { CURATED_SEEDS, seedFromHash, writeSeedHash } from "./state/seed";

declare const __DEV__: boolean;

initTheme();
initPlayback();

function startFromHash(): void {
  const fromHash = seedFromHash();
  const seed = fromHash ?? CURATED_SEEDS[0].seed;
  if (!fromHash) writeSeedHash(seed);
  if (seed !== app.get().seed) generate(seed);
}

window.addEventListener("hashchange", () => {
  const s = seedFromHash();
  if (s && s !== app.get().seed) generate(s);
});

render(<App />, document.getElementById("app")!);
startFromHash();

// Scripted navigation for screenshots and tests.
(window as unknown as Record<string, unknown>).__app = {
  store: app,
  get: () => app.get(),
  set: (p: Parameters<typeof app.set>[0]) => app.set(p),
  open: openRef,
  navigate,
  setYear,
  skip: finishGenesis,
  loc: () => currentLoc(),
  ready: () => app.get().phase === "ready" && !!app.get().baked,
  dev: typeof __DEV__ !== "undefined" ? __DEV__ : false,
};
