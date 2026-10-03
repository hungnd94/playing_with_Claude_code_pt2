/** The thin top bar: wordmark, world name + seed, search, new world, theme. */
import { useState } from "preact/hooks";
import { app, cycleTheme } from "../state/app";
import { useStore } from "../state/store";
import { seedTitle } from "../state/seed";
import { IconCopy, IconDice, IconMoon, IconSearch, IconSun, IconLayers } from "./icons";

export function Wordmark() {
  return (
    <span class="wordmark" aria-label="Palimpsest">
      <svg class="wordmark-orn" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1" />
        <circle cx="12" cy="12" r="6.4" fill="none" stroke="currentColor" stroke-width=".6" opacity=".7" />
        <path d="M12 1.5 13.1 10.9 22.5 12 13.1 13.1 12 22.5 10.9 13.1 1.5 12 10.9 10.9z" fill="currentColor" />
        <path d="M4.6 4.6 11.3 11.3M19.4 4.6 12.7 11.3M4.6 19.4 11.3 12.7M19.4 19.4 12.7 12.7" stroke="currentColor" stroke-width=".7" opacity=".6" />
      </svg>
      <span class="wordmark-text">Palimpsest</span>
    </span>
  );
}

export function TopBar() {
  const seed = useStore(app, (s) => s.seed);
  const theme = useStore(app, (s) => s.dark);
  const source = useStore(app, (s) => s.historySource);
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    const base = (() => {
      try {
        return location.href.split("#")[0];
      } catch {
        return "";
      }
    })();
    const text = `${base}#seed-${seed}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <header class="topbar">
      <Wordmark />
      <span class="topbar-sep" aria-hidden="true" />
      <div class="world-id">
        <span class="world-name" title={source === "mock" ? "History by the stand-in engine" : undefined}>
          {seed ? seedTitle(seed) : "—"}
        </span>
        <button class="seed-chip" onClick={copy} title="Copy a link to this world" aria-label={`Seed ${seed}. Copy link`}>
          <span class="seed-chip-label">seed</span>
          <span class="seed-chip-value">{seed}</span>
          <IconCopy size={13} />
          <span class={`seed-chip-done ${copied ? "is-on" : ""}`} aria-live="polite">
            {copied ? "copied" : ""}
          </span>
        </button>
      </div>
      <div class="topbar-actions">
        <button class="tb-btn tb-search" onClick={() => app.set({ overlay: "search" })} aria-label="Search (/)" title="Search every name (/ or ⌘K)">
          <IconSearch />
          <span class="tb-label">Search</span>
          <kbd>/</kbd>
        </button>
        <button class="tb-btn tb-layers" onClick={() => app.set((s) => ({ overlay: s.overlay === "layers" ? null : "layers" }))} aria-label="Map layers" title="Map layers">
          <IconLayers />
        </button>
        <button class="tb-btn" onClick={() => app.set({ overlay: "seed" })} title="Make a new world" aria-label="New world">
          <IconDice />
          <span class="tb-label">New world</span>
        </button>
        <button class="tb-btn tb-icon" onClick={cycleTheme} title={theme ? "Vellum (light) theme" : "Lapis (dark) theme"} aria-label={theme ? "Switch to light theme" : "Switch to dark theme"}>
          {theme ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </header>
  );
}
