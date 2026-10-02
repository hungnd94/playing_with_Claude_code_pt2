/**
 * Application state and actions.
 */
import type { PhysicalWorld } from "../../world/types";
import type { History, LiveSnapshot } from "../../history/types";
import type { BakedGlobe } from "../../render/bake/index";
import type { Ref } from "../../narrative/types";
import type { Narrative } from "../engine/narrative";
import { createStore } from "./store";

export type LayerId = "terrain" | "realms" | "peoples" | "tongues" | "faiths" | "population";
export const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: "terrain", label: "Terrain", hint: "The land itself" },
  { id: "realms", label: "Realms", hint: "Polities and their borders" },
  { id: "peoples", label: "Peoples", hint: "Cultures" },
  { id: "tongues", label: "Tongues", hint: "Language families" },
  { id: "faiths", label: "Faiths", hint: "Religions" },
  { id: "population", label: "Population", hint: "Where people lived" },
];

export type TabId = "world" | "chronicle" | "article" | "atlas" | "tongues" | "scripts" | "faiths" | "heraldry";
export const TABS: { id: TabId; label: string; key: string }[] = [
  { id: "world", label: "World", key: "1" },
  { id: "chronicle", label: "Chronicle", key: "2" },
  { id: "article", label: "Encyclopedia", key: "3" },
  { id: "atlas", label: "Atlas", key: "4" },
  { id: "tongues", label: "Tongues", key: "5" },
  { id: "scripts", label: "Scripts", key: "6" },
  { id: "faiths", label: "Faiths", key: "7" },
  { id: "heraldry", label: "Heraldry", key: "8" },
];

/** A place in the reading pane. */
export interface Loc {
  tab: TabId;
  ref?: Ref;
  /** Sub-view inside a tab (e.g. a language id in Tongues). */
  sub?: number;
}

export type Phase = "idle" | "physical" | "history" | "ready" | "error";

export interface AppState {
  seed: string;
  phase: Phase;
  stage: string;
  stageFraction: number;
  error: string | null;
  world: PhysicalWorld | null;
  history: History | null;
  historySource: string;
  narrative: Narrative | null;
  baked: BakedGlobe | null;
  bakedWidth: number;
  live: LiveSnapshot | null;
  /** The genesis experience is running (captions, replay of history). */
  genesis: boolean;
  year: number;
  playing: boolean;
  /** Years per second while playing. */
  speed: number;
  layer: LayerId;
  show: { settlements: boolean; labels: boolean; routes: boolean; battles: boolean };
  nav: { stack: Loc[]; index: number };
  pane: "normal" | "collapsed" | "expanded";
  /** Entity under the pointer in the reading pane (pinged on the globe). */
  hover: Ref | null;
  /** Entity whose article is open (highlighted on the globe). */
  focus: Ref | null;
  /** Cell picked on the globe (for "this place" articles). */
  pickedCell: number;
  overlay: "search" | "seed" | "layers" | null;
  theme: "auto" | "light" | "dark";
  /** Resolved theme. */
  dark: boolean;
  timings: Record<string, number>;
}

export const app = createStore<AppState>({
  seed: "",
  phase: "idle",
  stage: "",
  stageFraction: 0,
  error: null,
  world: null,
  history: null,
  historySource: "",
  narrative: null,
  baked: null,
  bakedWidth: 0,
  live: null,
  genesis: true,
  year: 0,
  playing: false,
  speed: 50,
  layer: "realms",
  show: { settlements: true, labels: true, routes: false, battles: false },
  nav: { stack: [{ tab: "world" }], index: 0 },
  pane: "normal",
  hover: null,
  focus: null,
  pickedCell: -1,
  overlay: null,
  theme: "auto",
  dark: true,
  timings: {},
});

export const SPEEDS = [10, 25, 50, 100, 250];

export function currentLoc(s: AppState = app.get()): Loc {
  return s.nav.stack[s.nav.index] ?? { tab: "world" };
}

export function navigate(loc: Loc, opts: { replace?: boolean } = {}): void {
  app.set((s) => {
    const cur = s.nav.stack[s.nav.index];
    if (cur && sameLoc(cur, loc)) return {};
    const stack = s.nav.stack.slice(0, s.nav.index + (opts.replace ? 0 : 1));
    stack.push(loc);
    while (stack.length > 80) stack.shift();
    return { nav: { stack, index: stack.length - 1 }, pane: s.pane === "collapsed" ? "normal" : s.pane };
  });
}

export function sameLoc(a: Loc, b: Loc): boolean {
  return a.tab === b.tab && a.sub === b.sub && (a.ref?.kind ?? "") === (b.ref?.kind ?? "") && (a.ref?.id ?? -1) === (b.ref?.id ?? -1);
}

export function back(): void {
  app.set((s) => (s.nav.index > 0 ? { nav: { ...s.nav, index: s.nav.index - 1 } } : {}));
}

export function forward(): void {
  app.set((s) => (s.nav.index < s.nav.stack.length - 1 ? { nav: { ...s.nav, index: s.nav.index + 1 } } : {}));
}

/** Which tab an entity's page lives in. */
export function tabFor(ref: Ref): TabId {
  switch (ref.kind) {
    case "world":
      return "world";
    case "year":
      return "chronicle";
    default:
      return "article";
  }
}

export function openRef(ref: Ref): void {
  if (ref.kind === "year") {
    setYear(ref.id);
    navigate({ tab: "chronicle", sub: ref.id });
    return;
  }
  navigate({ tab: tabFor(ref), ref: ref.kind === "world" ? undefined : ref });
}

export function setYear(y: number): void {
  const h = app.get().history;
  const end = h?.endYear ?? 0;
  app.set({ year: Math.max(0, Math.min(end, Math.round(y))) });
}

export function setPlaying(p: boolean): void {
  const s = app.get();
  if (p && s.history && s.year >= s.history.endYear) app.set({ year: 0 });
  app.set({ playing: p });
}

const THEME_KEY = "palimpsest.theme";
export function initTheme(): void {
  let t: AppState["theme"] = "auto";
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") t = v;
  } catch { /* storage unavailable */ }
  applyTheme(t);
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", () => applyTheme(app.get().theme));
}

export function applyTheme(t: AppState["theme"]): void {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  const sys = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const dark = t === "dark" || (t === "auto" && sys);
  app.set({ theme: t, dark });
  try {
    if (t === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch { /* ignore */ }
}

export function cycleTheme(): void {
  const s = app.get();
  // auto → the opposite of what auto shows → the other → auto
  const next: AppState["theme"] = s.theme === "auto" ? (s.dark ? "light" : "dark") : s.theme === "light" ? "dark" : "light";
  applyTheme(next);
}
