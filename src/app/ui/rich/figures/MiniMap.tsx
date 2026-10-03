/** Mini map figure: the entity's place on the baked globe at a year. */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Ref } from "../../../../narrative/types";
import { app, openRef } from "../../../state/app";
import { useStore } from "../../../state/store";
import { layerAt } from "../../../../history/query";
import { locate } from "../../../engine/locate";
import { cellXYZ } from "../../../engine/geo";
import { renderMiniMap, projectMini, type MiniMapSpec } from "../../../engine/minimap";
import { stageController } from "../../stage/bus";
import { nameAt } from "../../../engine/query";
import { IconTarget } from "../../icons";

export function MiniMap({ focus, year }: { focus: Ref; year: number }) {
  const world = useStore(app, (s) => s.world);
  const history = useStore(app, (s) => s.history);
  const baked = useStore(app, (s) => s.baked);
  const dark = useStore(app, (s) => s.dark);
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<{ x: number; y: number; label: string; kind: string }[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const c = cv.current, host = box.current;
    if (!c || !host || !world || !history || !baked) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const cssW = Math.min(620, Math.max(240, host.clientWidth || 480));
        const cssH = Math.round(cssW * 0.56);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
        c.width = W;
        c.height = H;
        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;
        const t = locate(world, history, stageController()?.overlayEngine ?? null, focus, year);
        if (!t) {
          setFailed(true);
          return;
        }
        const n = world.mesh.n;
        const tl = history.timeline;
        const owner = layerAt(tl.owner, tl, year);
        let fm: Uint8Array | null = null;
        if (focus.kind === "polity" || focus.kind === "culture" || focus.kind === "religion" || focus.kind === "feature" || focus.kind === "language") {
          fm = new Uint8Array(n);
          if (focus.kind === "polity") for (let i = 0; i < n; i++) fm[i] = owner[i] === focus.id ? 1 : 0;
          else if (focus.kind === "culture" || focus.kind === "language") {
            const cid = focus.kind === "culture" ? focus.id : history.languages[focus.id]?.culture ?? -1;
            const cul = layerAt(tl.culture, tl, year);
            for (let i = 0; i < n; i++) fm[i] = cul[i] === cid ? 1 : 0;
          } else if (focus.kind === "religion") {
            const rel = layerAt(tl.religion, tl, year);
            for (let i = 0; i < n; i++) fm[i] = rel[i] === focus.id ? 1 : 0;
          } else if (t.cells) for (const cc of t.cells) fm[cc] = 1;
          let any = 0;
          for (let i = 0; i < n; i++) any += fm[i];
          if (!any) fm = null;
        }
        // Frame: territory radius, or a regional view around a point.
        let radius = 9;
        if (t.zoom) radius = Math.max(5, Math.min(55, (Math.asin(Math.min(1, 1 / t.zoom)) * 180) / Math.PI * 0.75));
        if (t.point && !fm) radius = 7;
        const spec: MiniMapSpec = { width: W, height: H, lat: t.lat, lon: t.lon, radiusDeg: radius, focus: fm, owner, tint: dark ? [222, 182, 96] : [168, 67, 42], ink: [40, 24, 12] };
        const g = c.getContext("2d");
        if (!g) return;
        const img = g.createImageData(W, H);
        renderMiniMap(baked, spec, img.data);
        g.putImageData(img, 0, 0);
        // Marks: the point of interest and the largest towns in view.
        const m: { x: number; y: number; label: string; kind: string }[] = [];
        if (t.point) {
          const p = projectMini(spec, t.point);
          if (p) m.push({ x: p[0] / dpr, y: p[1] / dpr, label: focus.kind === "settlement" ? nameAt(history.settlements[focus.id].names, year).roman : focus.kind === "battle" ? "" : "", kind: "focus" });
        }
        if (t.line) {
          g.strokeStyle = dark ? "rgba(240,214,150,0.95)" : "rgba(120,40,20,0.9)";
          g.lineWidth = 2.2 * dpr;
          g.setLineDash([5 * dpr, 4 * dpr]);
          g.beginPath();
          let first = true;
          for (const q of t.line) {
            const p = projectMini(spec, q);
            if (!p) continue;
            if (first) g.moveTo(p[0], p[1]);
            else g.lineTo(p[0], p[1]);
            first = false;
          }
          g.stroke();
        }
        const towns = history.settlements
          .filter((s) => s.founded <= year && (s.ended < 0 || s.ended > year))
          .map((s) => ({ s, pop: s.pop[Math.max(0, Math.min(s.pop.length - 1, Math.floor(year / history.sampleStep) - s.popStart))] ?? 0 }))
          .sort((a, b) => b.pop - a.pop);
        let k = 0;
        for (const { s } of towns) {
          if (k >= 7) break;
          if (focus.kind === "settlement" && s.id === focus.id) continue;
          const p = projectMini(spec, s.pos ?? cellXYZ(world, s.cell));
          if (!p || p[0] < 30 || p[1] < 14 || p[0] > W - 30 || p[1] > H - 14) continue;
          m.push({ x: p[0] / dpr, y: p[1] / dpr, label: nameAt(s.names, year).roman, kind: "town" });
          k++;
        }
        setMarks(m);
        setFailed(false);
      } catch (e) {
        console.warn("minimap failed", e);
        setFailed(true);
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [focus.kind, focus.id, year, world, history, baked, dark]);

  if (!baked) return <div class="minimap is-waiting">The map is being drawn…</div>;
  if (failed) return null;
  return (
    <div class="minimap" ref={box}>
      <canvas ref={cv} role="img" aria-label="Map" />
      {marks.map((m, i) => (
        <span key={i} class={`mm-mark mm-${m.kind}`} style={{ left: `${m.x}px`, top: `${m.y}px` }}>
          <span class="mm-dot" />
          {m.label ? <span class="mm-label">{m.label}</span> : null}
        </span>
      ))}
      <button class="mm-fly" onClick={() => openRef(focus)} title="Show on the globe" aria-label="Show on the globe">
        <IconTarget size={14} />
      </button>
    </div>
  );
}
