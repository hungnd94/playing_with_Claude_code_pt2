/**
 * The globe stage: starfield + placeholder planet (first frame is never
 * empty), the WebGL globe, the layer rail, legend, hover card and genesis.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { app, LAYERS, type LayerId } from "../../state/app";
import { useStore } from "../../state/store";
import { StageController } from "./controller";
import { setStageController, stageController } from "./bus";
import { describeCell } from "../../engine/describe";
import { Genesis } from "./Genesis";
import { Legend } from "./Legend";

function drawStars(cv: HTMLCanvasElement): void {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  const g = cv.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, cv.width, cv.height);
  // Deterministic scatter (a tiny LCG) so the sky does not flicker between frames.
  let s = 1234567;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const n = Math.round((r.width * r.height) / 1400);
  for (let i = 0; i < n; i++) {
    const x = rnd() * cv.width, y = rnd() * cv.height;
    const m = Math.pow(rnd(), 3.2);
    const a = 0.25 + 0.75 * m;
    const rad = (0.35 + 1.25 * m) * dpr;
    const warm = rnd();
    g.fillStyle = warm < 0.2 ? `rgba(255,226,190,${a})` : warm > 0.85 ? `rgba(200,215,255,${a})` : `rgba(235,235,245,${a})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
}

export function Stage() {
  const host = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const stars = useRef<HTMLCanvasElement>(null);
  const ctlRef = useRef<StageController | null>(null);
  const [ready, setReady] = useState(false);
  const [noGL, setNoGL] = useState<string | null>(null);
  const [tip, setTip] = useState<{ cell: number; x: number; y: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const genesis = useStore(app, (s) => s.genesis);

  useEffect(() => {
    const cv = stars.current;
    if (!cv) return;
    drawStars(cv);
    const ro = new ResizeObserver(() => drawStars(cv));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = glCanvas.current;
    if (!cv) return;
    let ctl: StageController;
    try {
      ctl = new StageController(cv);
    } catch (e) {
      setNoGL(e instanceof Error ? e.message : String(e));
      return;
    }
    ctlRef.current = ctl;
    setStageController(ctl);
    (window as unknown as { __globe?: unknown }).__globe = ctl.globe;
    ctl.onReveal = () => setReady(true);
    if (app.get().baked) setReady(true);
    ctl.onHoverCell = (cell) => {
      const p = pointer.current;
      setTip(cell >= 0 && p.inside ? { cell, x: p.x, y: p.y } : null);
    };
    return () => {
      setStageController(null);
      ctl.dispose();
      ctlRef.current = null;
    };
  }, []);

  const onMove = (e: PointerEvent): void => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.pointerType === "mouse" };
    if (tip) setTip({ ...tip, x: pointer.current.x, y: pointer.current.y });
  };

  return (
    <section
      class={`stage ${ready ? "is-ready" : ""} ${genesis ? "is-genesis" : ""}`}
      ref={host}
      aria-label="Globe"
      onPointerMove={onMove}
      onPointerLeave={() => {
        pointer.current.inside = false;
        setTip(null);
      }}
    >
      <canvas class="stage-stars" ref={stars} aria-hidden="true" />
      <div class="proto-planet" aria-hidden="true">
        <div class="proto-planet-body" />
      </div>
      <canvas class="globe-canvas" ref={glCanvas} tabIndex={0} aria-label="Interactive globe: drag to rotate, scroll to zoom, click a place to read about it" />
      {noGL ? (
        <div class="stage-note" role="status">
          <strong>The globe cannot be drawn here</strong>
          <span>WebGL 2 is unavailable ({noGL}). Everything else — the encyclopedia, chronicle and atlas — still works.</span>
        </div>
      ) : null}
      <LayerRail />
      <Legend />
      {tip ? <HoverCard cell={tip.cell} x={tip.x} y={tip.y} /> : null}
      <Genesis />
    </section>
  );
}

function HoverCard(props: { cell: number; x: number; y: number }) {
  const [world, history, layer, year] = useStore(app, (s) => [s.world, s.history, s.layer, s.year] as const);
  if (!world) return null;
  const d = describeCell(world, history, stageController()?.overlayEngine ?? null, layer, props.cell, year);
  const flip = props.x > 260;
  return (
    <div class="globe-tip" style={{ transform: `translate(${flip ? props.x - 14 : props.x + 14}px, ${props.y + 14}px) translateX(${flip ? "-100%" : "0"})` }} aria-hidden="true">
      <div class="globe-tip-title">{d.title}</div>
      {d.sub ? <div class="globe-tip-sub">{d.sub}</div> : null}
    </div>
  );
}

function LayerRail() {
  const layer = useStore(app, (s) => s.layer);
  const show = useStore(app, (s) => s.show);
  const hasHistory = useStore(app, (s) => !!s.history);
  const set = (id: LayerId): void => app.set({ layer: id });
  const toggle = (k: keyof typeof show): void => app.set((s) => ({ show: { ...s.show, [k]: !s.show[k] } }));
  return (
    <nav class="layer-rail" aria-label="Map layers">
      <div class="rail-group" role="radiogroup" aria-label="Layer">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            id={`layer-${l.id}`}
            role="radio"
            aria-checked={layer === l.id}
            class={`rail-btn ${layer === l.id ? "is-on" : ""}`}
            disabled={!hasHistory && l.id !== "terrain"}
            title={l.hint}
            onClick={() => set(l.id)}
          >
            <span class="rail-swatch" data-layer={l.id} aria-hidden="true" />
            {l.label}
          </button>
        ))}
      </div>
      <div class="rail-sep" aria-hidden="true" />
      <div class="rail-group" aria-label="Show">
        {(
          [
            ["settlements", "Towns"],
            ["labels", "Names"],
            ["routes", "Trade roads"],
            ["battles", "Battles"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} class="rail-check" for={`show-${k}`}>
            <input id={`show-${k}`} type="checkbox" checked={show[k]} disabled={!hasHistory} onChange={() => toggle(k)} />
            <span class="rail-tick" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </nav>
  );
}
