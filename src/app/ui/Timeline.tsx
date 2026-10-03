/**
 * The timeline dial: a brass-and-ink scrubber across all years, the named
 * ages as bands, event density as a faint histogram (wars, plagues, golden
 * ages), play/pause, step and speed. Always visible.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { app, SPEEDS, setPlaying, setYear } from "../state/app";
import { useStore } from "../state/store";
import { interruptGenesis, step } from "../state/playback";
import type { History } from "../../history/types";
import { IconPause, IconPlay, IconStepBack, IconStepFwd } from "./icons";

const BIN = 10;
const WAR = new Set(["warDeclared", "battle", "siege", "sack", "conquest", "massacre", "raid", "rebellion"]);
const DARK = new Set(["plague", "famine", "earthquake", "eruption", "flood", "drought", "darkAge", "polityCollapsed"]);
const GOLD = new Set(["goldenAge", "wonderBuilt", "workWritten", "religionFounded", "scriptInvented", "invention"]);

interface Bins {
  war: Float32Array;
  dark: Float32Array;
  gold: Float32Array;
  other: Float32Array;
  max: number;
}

function binEvents(h: History): Bins {
  const n = Math.floor(h.endYear / BIN) + 1;
  const b: Bins = { war: new Float32Array(n), dark: new Float32Array(n), gold: new Float32Array(n), other: new Float32Array(n), max: 1 };
  for (const e of h.events) {
    if (e.importance < 2) continue;
    const i = Math.min(n - 1, Math.floor(e.year / BIN));
    const w = Math.pow(e.importance, 1.6);
    if (WAR.has(e.type)) b.war[i] += w;
    else if (DARK.has(e.type)) b.dark[i] += w;
    else if (GOLD.has(e.type)) b.gold[i] += w;
    else b.other[i] += w * 0.6;
  }
  // Smooth lightly (3-bin box) so it reads as density, not noise.
  const sm = (a: Float32Array): Float32Array => a.map((v, i) => (0.25 * (a[i - 1] ?? v) + 0.5 * v + 0.25 * (a[i + 1] ?? v)));
  b.war = sm(b.war);
  b.dark = sm(b.dark);
  b.gold = sm(b.gold);
  b.other = sm(b.other);
  for (let i = 0; i < n; i++) b.max = Math.max(b.max, b.war[i] + b.dark[i] + b.gold[i] + b.other[i]);
  return b;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function Timeline() {
  const history = useStore(app, (s) => s.history);
  const year = useStore(app, (s) => s.year);
  const playing = useStore(app, (s) => s.playing);
  const speed = useStore(app, (s) => s.speed);
  const dark = useStore(app, (s) => s.dark);
  const liveEnd = useStore(app, (s) => s.live?.endYear ?? 0);
  const genesis = useStore(app, (s) => s.genesis);
  const end = history?.endYear ?? (liveEnd || 3000);
  const cv = useRef<HTMLCanvasElement>(null);
  const dial = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const bins = useMemo(() => (history ? binEvents(history) : null), [history]);

  // Draw the histogram on resize / data / theme change.
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const draw = (): void => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      const g = c.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, c.width, c.height);
      if (!bins) return;
      const n = bins.war.length;
      const W = c.width, H = c.height;
      const cols = [token("--ev"), token("--golden"), token("--plague"), token("--war")];
      const bw = W / n;
      for (let i = 0; i < n; i++) {
        const parts = [bins.other[i], bins.gold[i], bins.dark[i], bins.war[i]];
        let y = H;
        for (let k = 0; k < 4; k++) {
          const hgt = Math.sqrt(parts[k] / bins.max) * H * 0.95;
          if (hgt < 0.2) continue;
          g.fillStyle = cols[k];
          g.globalAlpha = k === 0 ? 0.55 : 0.8;
          g.fillRect(i * bw, y - hgt, Math.max(1, bw - 0.4 * dpr), hgt);
          y -= hgt;
        }
      }
      g.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [bins, dark]);

  const yearAtX = (clientX: number): number => {
    const r = dial.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * end);
  };
  const drag = useRef(false);
  const onDown = (e: PointerEvent): void => {
    if (!history) return;
    drag.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    interruptGenesis();
    setPlaying(false);
    setYear(yearAtX(e.clientX));
  };
  const onMove = (e: PointerEvent): void => {
    if (!history) return;
    const y = yearAtX(e.clientX);
    if (drag.current) setYear(y);
    else if (e.pointerType === "mouse") setHover(y);
  };
  const onUp = (): void => {
    drag.current = false;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!history) return;
    const big = e.shiftKey ? 100 : 10;
    let handled = true;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") step(-big);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") step(big);
    else if (e.key === "PageDown") step(-100);
    else if (e.key === "PageUp") step(100);
    else if (e.key === "Home") step(-end);
    else if (e.key === "End") step(end);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const ages = history?.ages ?? [];
  const age = ages.find((a) => a.start <= year && year <= a.end);
  const hoverAge = hover !== null ? ages.find((a) => a.start <= hover && hover <= a.end) : undefined;
  const ticks: number[] = [];
  const major = end > 2000 ? 500 : end > 800 ? 250 : 100;
  for (let t = 0; t <= end; t += major) ticks.push(t);
  const pct = (y: number): string => `${(y / Math.max(1, end)) * 100}%`;

  return (
    <footer class={`timeline ${history ? "" : "is-waiting"}`} aria-label="Timeline">
      <div class="tl-controls">
        <button class="tl-btn" onClick={() => step(-10)} disabled={!history} title="Back 10 years (←, shift: 100)" aria-label="Back 10 years">
          <IconStepBack />
        </button>
        <button
          class="tl-btn tl-play"
          onClick={() => {
            if (genesis) interruptGenesis();
            setPlaying(!playing);
          }}
          disabled={!history}
          title={playing ? "Pause (space)" : "Play (space)"}
          aria-label={playing ? "Pause" : "Play"}
          aria-pressed={playing}
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
        <button class="tl-btn" onClick={() => step(10)} disabled={!history} title="Forward 10 years (→, shift: 100)" aria-label="Forward 10 years">
          <IconStepFwd />
        </button>
        <button
          class="tl-speed"
          id="tl-speed"
          disabled={!history}
          onClick={() => {
            const i = SPEEDS.indexOf(speed);
            app.set({ speed: SPEEDS[(i + 1) % SPEEDS.length] ?? 50 });
          }}
          title="Playback speed (years per second)"
          aria-label={`Speed: ${speed} years per second`}
        >
          <span class="num">{speed}</span>
          <span class="tl-speed-unit">yrs/s</span>
        </button>
      </div>
      <div
        class="tl-dial"
        ref={dial}
        role="slider"
        tabIndex={0}
        id="timeline-dial"
        aria-label="Year"
        aria-valuemin={0}
        aria-valuemax={end}
        aria-valuenow={year}
        aria-valuetext={`Year ${year}${age ? `, ${age.name}` : ""}`}
        aria-disabled={!history}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
      >
        <canvas class="tl-hist" ref={cv} aria-hidden="true" />
        <div class="tl-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} class="tl-tick" style={{ left: pct(t) }}>
              <span class="num">{t}</span>
            </span>
          ))}
        </div>
        <div class="tl-ages" aria-hidden="true">
          {ages.map((a, i) => (
            <span
              key={a.start}
              class={`tl-age ${i % 2 ? "is-odd" : ""} ${age === a ? "is-current" : ""}`}
              style={{ left: pct(a.start), width: `calc(${pct(a.end - a.start)} - 1px)` }}
              title={a.name}
            >
              <span class="tl-age-name">{a.name.replace(/^the /, "")}</span>
            </span>
          ))}
        </div>
        {hover !== null && !drag.current ? (
          <div class="tl-ghost" style={{ left: pct(hover) }} aria-hidden="true">
            <span class="tl-ghost-label">
              <span class="num">{hover}</span>
              {hoverAge ? <em> · {hoverAge.name.replace(/^the /, "")}</em> : null}
            </span>
          </div>
        ) : null}
        <div class="tl-thumb" style={{ left: pct(year) }} aria-hidden="true">
          <span class="tl-thumb-head" />
        </div>
      </div>
      <div class="tl-readout" aria-live="off">
        <div class="tl-year">
          <span class="tl-year-label">Year</span>
          <span class="tl-year-num num">{year}</span>
        </div>
        <div class="tl-age-now">{age ? age.name.replace(/^the /, "The ") : history ? "" : genesis ? "History unfolds" : ""}</div>
      </div>
    </footer>
  );
}
