/** The application shell: top bar, globe stage, reading pane, timeline. */
import { useEffect } from "preact/hooks";
import { app, back, forward, LAYERS, navigate, setPlaying, TABS } from "../state/app";
import { useStore } from "../state/store";
import { interruptGenesis, step } from "../state/playback";
import { TopBar } from "./TopBar";
import { Stage } from "./stage/Stage";
import { Pane, PaneHandle } from "./panes/Pane";
import { Timeline } from "./Timeline";
import { SearchPalette } from "./overlays/Search";
import { SeedDialog } from "./overlays/SeedDialog";
import { NameCardHost } from "./rich/NameCard";

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function onKey(e: KeyboardEvent): void {
  const s = app.get();
  if (e.key === "Escape") {
    if (s.overlay) {
      app.set({ overlay: null });
      e.preventDefault();
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    app.set({ overlay: s.overlay === "search" ? null : "search" });
    return;
  }
  if (isTyping(e.target) || s.overlay || e.metaKey || e.ctrlKey) return;
  const target = e.target as HTMLElement | null;
  const onGlobe = target?.classList?.contains("globe-canvas");
  const onSlider = target?.getAttribute?.("role") === "slider";
  if (e.key === "/") {
    e.preventDefault();
    app.set({ overlay: "search" });
  } else if (e.key === " " && (!target || target === document.body || onGlobe || target.classList?.contains("pane-body"))) {
    if (!s.history) return;
    e.preventDefault();
    if (s.genesis) interruptGenesis();
    setPlaying(!app.get().playing);
  } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) {
    e.preventDefault();
    if (e.key === "ArrowLeft") back();
    else forward();
  } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !onGlobe && !onSlider) {
    if (!s.history) return;
    e.preventDefault();
    step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 100 : 10));
  } else if (/^[1-8]$/.test(e.key) && !e.altKey && s.narrative) {
    const t = TABS.find((x) => x.key === e.key);
    if (t) navigate({ tab: t.id });
  }
}

function LayersSheet() {
  const layer = useStore(app, (s) => s.layer);
  return (
    <div class="scrim" onClick={() => app.set({ overlay: null })}>
      <div class="layers-sheet" role="dialog" aria-label="Map layers" onClick={(e) => e.stopPropagation()}>
        {LAYERS.map((l) => (
          <button key={l.id} class={`rail-btn ${layer === l.id ? "is-on" : ""}`} onClick={() => app.set({ layer: l.id, overlay: null })}>
            <span class="rail-swatch" data-layer={l.id} aria-hidden="true" />
            {l.label}
            <span class="sheet-hint">{l.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const overlay = useStore(app, (s) => s.overlay);
  const pane = useStore(app, (s) => s.pane);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class={`shell pane-${pane}`}>
      <TopBar />
      <main class="main">
        <Stage />
        <PaneHandle />
        <Pane />
      </main>
      <Timeline />
      {overlay === "search" ? <SearchPalette /> : overlay === "seed" ? <SeedDialog /> : overlay === "layers" ? <LayersSheet /> : null}
      <NameCardHost />
    </div>
  );
}
