/**
 * Atlas: a fantasy-cartography plate (src/atlas) of the region in view on the
 * globe — or of the realm / war / land last read about — at the timeline's
 * year, drawn on demand; full-screen view; click a name to open it.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Ref } from "../../../narrative/types";
import { renderAtlasPlate, ensureAtlasFonts, hitTest, planContinentView, planPointView, planRealmView, planRegionView, planWarView, type AtlasStyle, type PlannedView, type PlateModel } from "../../../atlas/index";
import { app, openRef } from "../../state/app";
import { useStore } from "../../state/store";
import { stageController } from "../stage/bus";
import { IconExpand, IconClose, IconGlobe } from "../icons";

const PW = 1600, PH = 1100;
const ASPECT = PW / PH;

type Subject = { label: string; plan: () => PlannedView | null; key: string };

function viewOfGlobe(year: number): PlannedView | null {
  const s = app.get();
  const g = stageController()?.globe;
  if (!s.world || !g) return null;
  const v = g.getView();
  const cv = g.canvas.getBoundingClientRect();
  const fit = 0.4 * Math.min(cv.width || 800, cv.height || 600) * v.zoom;
  const half = Math.min(1, (Math.min(cv.width || 800, cv.height || 600) / 2) / fit);
  const ang = Math.asin(half) * 0.85;
  const R = s.world.params.radiusKm;
  // Whole-hemisphere plates are slow and say little: cap at a large region.
  return planPointView(v.lat, v.lon, Math.max(300, Math.min(2400, ang * R)), year);
}

export function AtlasPane() {
  const world = useStore(app, (s) => s.world);
  const history = useStore(app, (s) => s.history);
  const year = useStore(app, (s) => s.year);
  const seed = useStore(app, (s) => s.seed);
  const stack = useStore(app, (s) => s.nav.stack.slice(0, s.nav.index));
  const [style, setStyle] = useState<AtlasStyle>("antique");
  const [which, setWhich] = useState<"subject" | "view">("subject");
  const [state, setState] = useState<"idle" | "drawing" | "done" | "error">("idle");
  const [drawnYear, setDrawnYear] = useState(-1);
  const [full, setFull] = useState(false);
  const [tick, setTick] = useState(0);
  const cv = useRef<HTMLCanvasElement>(null);
  const model = useRef<PlateModel | null>(null);
  const [ms, setMs] = useState(0);

  // The thing last read about, if it can be mapped.
  const subject: Subject | null = useMemo(() => {
    if (!world || !history) return null;
    for (let i = stack.length - 1; i >= 0; i--) {
      const r: Ref | undefined = stack[i].ref;
      if (!r) continue;
      const n = app.get().narrative;
      const label = n ? n.label(r, year) : `${r.kind} ${r.id}`;
      if (r.kind === "polity") {
        const P = history.polities[r.id];
        const y = Math.min(Math.max(year, P.founded), P.ended >= 0 ? P.ended - 1 : year);
        return { label, key: `p${r.id}`, plan: () => planRealmView(world, history, r.id, y, { aspect: ASPECT }) };
      }
      if (r.kind === "war") return { label, key: `w${r.id}`, plan: () => planWarView(world, history, r.id, undefined, { aspect: ASPECT }) };
      if (r.kind === "feature") {
        const f = world.features[r.id];
        if (!f) continue;
        return { label, key: `f${r.id}`, plan: () => (f.kind === "continent" || f.kind === "island" ? planContinentView(world, r.id, year, { aspect: ASPECT }) : planRegionView(world, r.id, year, { aspect: ASPECT })) };
      }
      if (r.kind === "settlement") {
        const s = history.settlements[r.id];
        const lat = (Math.asin(Math.max(-1, Math.min(1, s.pos[2]))) * 180) / Math.PI;
        const lon = (Math.atan2(s.pos[1], s.pos[0]) * 180) / Math.PI;
        return { label, key: `s${r.id}`, plan: () => planPointView(lat, lon, 700, year) };
      }
      if (r.kind === "battle") {
        const b = history.battles[r.id];
        return { label, key: `b${r.id}`, plan: () => planWarView(world, history, b.war, b.year, { aspect: ASPECT }) };
      }
    }
    return null;
  }, [world, history, stack.length, stack[stack.length - 1]]);

  const draw = (): void => {
    const c = cv.current;
    if (!c || !world || !history) return;
    setState("drawing");
    const y = app.get().year;
    window.setTimeout(async () => {
      try {
        await ensureAtlasFonts();
        const plan = which === "subject" && subject ? subject.plan() : viewOfGlobe(y);
        if (!plan) throw new Error("nothing to map");
        c.width = PW;
        c.height = PH;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas");
        const t0 = performance.now();
        const res = renderAtlasPlate(ctx, { world, history, year: plan.year ?? y, view: plan.view, subject: plan.subject, width: PW, height: PH, seed, style } as Parameters<typeof renderAtlasPlate>[1]);
        setMs(Math.round(performance.now() - t0));
        model.current = res.model;
        setDrawnYear(plan.year ?? y);
        setState("done");
      } catch (e) {
        console.error("atlas failed", e);
        setState("error");
      }
    }, 60);
  };

  // Draw on first open, and when the subject/style changes.
  useEffect(() => {
    if (world && history) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, history, style, which, subject?.key, tick]);

  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [full]);

  const onClick = (e: MouseEvent): void => {
    const c = cv.current, m = model.current;
    if (!c || !m) return;
    const r = c.getBoundingClientRect();
    // object-fit: contain — map the click into canvas pixels.
    const s = Math.min(r.width / c.width, r.height / c.height);
    const ox = r.left + (r.width - c.width * s) / 2, oy = r.top + (r.height - c.height * s) / 2;
    const x = (e.clientX - ox) / s, y = (e.clientY - oy) / s;
    const hit = hitTest(m, x, y);
    if (!hit) return;
    const kind = hit.type === "settlement" ? "settlement" : hit.type === "polity" ? "polity" : hit.type === "feature" ? "feature" : hit.type === "battle" ? "battle" : null;
    if (kind) {
      setFull(false);
      openRef({ kind, id: hit.id });
    }
  };

  if (!world || !history) return <p class="pane-empty">The cartographer waits for history.</p>;
  return (
    <div class="atlas-pane">
      <header class="art-head">
        <div class="art-kicker">Atlas</div>
        <h1 class="art-title">{which === "subject" && subject ? subject.label : "The region in view"}</h1>
        <p class="art-sub">
          A plate drawn for the year <span class="num">{drawnYear >= 0 ? drawnYear : year}</span>
          {drawnYear >= 0 && drawnYear !== year ? <> (the timeline is at <span class="num">{year}</span>)</> : null}. Click a name on the plate to read about it.
        </p>
      </header>
      <div class="filters atlas-controls" role="group" aria-label="Plate">
        <div class="seg" role="radiogroup" aria-label="Subject">
          {subject ? (
            <button role="radio" aria-checked={which === "subject"} class={`seg-btn ${which === "subject" ? "is-on" : ""}`} onClick={() => setWhich("subject")}>
              {subject.label.length > 24 ? subject.label.slice(0, 23) + "…" : subject.label}
            </button>
          ) : null}
          <button role="radio" aria-checked={which === "view" || !subject} class={`seg-btn ${which === "view" || !subject ? "is-on" : ""}`} onClick={() => setWhich("view")}>
            <IconGlobe size={13} /> Region in view
          </button>
        </div>
        <select id="atlas-style" aria-label="Style" value={style} onChange={(e) => setStyle((e.currentTarget as HTMLSelectElement).value as AtlasStyle)}>
          <option value="antique">Antique</option>
          <option value="political">Political</option>
          <option value="relief">Relief</option>
        </select>
        <button class="seg-btn atlas-redraw" onClick={() => setTick((t) => t + 1)} disabled={state === "drawing"}>
          Redraw for <span class="num">{year}</span>
        </button>
        <button class="pn-btn" onClick={() => setFull(true)} aria-label="Full screen" title="Full screen" disabled={state !== "done"}>
          <IconExpand />
        </button>
      </div>
      <div class={`atlas-plate ${full ? "is-full" : ""} is-${state}`}>
        {full ? (
          <button class="dlg-close atlas-close" onClick={() => setFull(false)} aria-label="Close full screen">
            <IconClose />
          </button>
        ) : null}
        <canvas ref={cv} width={PW} height={PH} onClick={onClick} role="img" aria-label="Atlas plate" />
        {state === "drawing" ? <div class="atlas-wait">The cartographer is at work…</div> : null}
        {state === "error" ? <div class="atlas-wait">The plate could not be drawn.</div> : null}
      </div>
      {state === "done" && ms ? <p class="pane-hint">Drawn in {(ms / 1000).toFixed(1)} s.</p> : null}
    </div>
  );
}
