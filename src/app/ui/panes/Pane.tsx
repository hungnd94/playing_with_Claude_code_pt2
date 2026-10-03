/**
 * The reading pane: tabs, back/forward, collapse/expand, and the page for the
 * current location. Scroll positions are remembered per history entry.
 */
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { app, back, currentLoc, forward, navigate, TABS, type TabId } from "../../state/app";
import { useStore } from "../../state/store";
import { IconBack, IconForward, IconExpand, IconCollapse, IconPaneRight } from "../icons";
import { WorldPane } from "./WorldPane";
import { ChroniclePane } from "./ChroniclePane";
import { EncyclopediaPane } from "./EncyclopediaPane";
import { AtlasPane } from "./AtlasPane";
import { TonguesPane } from "./TonguesPane";
import { ScriptsPane } from "./ScriptsPane";
import { FaithsPane } from "./FaithsPane";
import { HeraldryPane } from "./HeraldryPane";

const scrolls = new Map<string, number>();

export function Pane() {
  const loc = useStore(app, (s) => currentLoc(s));
  const navIndex = useStore(app, (s) => s.nav.index);
  const canBack = useStore(app, (s) => s.nav.index > 0);
  const canFwd = useStore(app, (s) => s.nav.index < s.nav.stack.length - 1);
  const pane = useStore(app, (s) => s.pane);
  const ready = useStore(app, (s) => !!s.history && !!s.narrative);
  const body = useRef<HTMLDivElement>(null);
  const key = `${navIndex}:${loc.tab}:${loc.ref?.kind ?? ""}:${loc.ref?.id ?? ""}:${loc.sub ?? ""}`;

  // Restore (or reset) scroll on location change.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    el.scrollTop = scrolls.get(key) ?? 0;
    const onScroll = (): void => {
      scrolls.set(key, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [key]);

  useEffect(() => {
    if (scrolls.size > 300) scrolls.clear();
  }, [key]);

  const go = (tab: TabId): void => {
    if (tab === loc.tab && !loc.ref && loc.sub === undefined) return;
    navigate({ tab });
  };

  return (
    <section class={`pane pane-${pane}`} aria-label="Reading pane">
      <div class="pane-head">
        <div class="pane-nav">
          <button class="pn-btn" onClick={back} disabled={!canBack} aria-label="Back" title="Back">
            <IconBack />
          </button>
          <button class="pn-btn" onClick={forward} disabled={!canFwd} aria-label="Forward" title="Forward">
            <IconForward />
          </button>
        </div>
        <nav class="tabs" role="tablist" aria-label="Pages">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              role="tab"
              aria-selected={loc.tab === t.id}
              aria-controls="pane-body"
              class={`tab ${loc.tab === t.id ? "is-on" : ""}`}
              onClick={() => go(t.id)}
              disabled={!ready && t.id !== "world"}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div class="pane-size">
          <button
            class="pn-btn pn-expand"
            onClick={() => app.set((s) => ({ pane: s.pane === "expanded" ? "normal" : "expanded" }))}
            aria-label={pane === "expanded" ? "Restore the reading pane" : "Widen the reading pane"}
            title={pane === "expanded" ? "Restore" : "Widen for reading"}
          >
            {pane === "expanded" ? <IconCollapse /> : <IconExpand />}
          </button>
          <button class="pn-btn" onClick={() => app.set({ pane: "collapsed" })} aria-label="Hide the reading pane" title="Hide the pane (globe only)">
            <IconPaneRight />
          </button>
        </div>
      </div>
      <div class="pane-body" id="pane-body" role="tabpanel" aria-labelledby={`tab-${loc.tab}`} ref={body} tabIndex={-1}>
        {loc.tab === "world" ? (
          <WorldPane />
        ) : loc.tab === "chronicle" ? (
          <ChroniclePane sub={loc.sub} />
        ) : loc.tab === "article" ? (
          <EncyclopediaPane loc={loc} />
        ) : loc.tab === "atlas" ? (
          <AtlasPane />
        ) : loc.tab === "tongues" ? (
          <TonguesPane sub={loc.sub} />
        ) : loc.tab === "scripts" ? (
          <ScriptsPane sub={loc.sub} />
        ) : loc.tab === "faiths" ? (
          <FaithsPane sub={loc.sub} />
        ) : loc.tab === "heraldry" ? (
          <HeraldryPane />
        ) : null}
      </div>
    </section>
  );
}

/** Shown when the pane is collapsed: a slim handle to bring it back. */
export function PaneHandle() {
  const pane = useStore(app, (s) => s.pane);
  if (pane !== "collapsed") return null;
  return (
    <button class="pane-handle" onClick={() => app.set({ pane: "normal" })} aria-label="Show the reading pane">
      <IconBack size={14} />
      <span>Read</span>
    </button>
  );
}
