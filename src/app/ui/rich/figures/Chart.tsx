/**
 * Time-series figure: one small multiple per series (never a dual axis),
 * thin 2px line over a faint area, recessive grid, crosshair + readout on
 * hover, the current year marked, click to move the timeline.
 */
import { useRef, useState } from "preact/hooks";
import { app, setYear } from "../../../state/app";
import { useStore } from "../../../state/store";
import { interruptGenesis } from "../../../state/playback";

export interface Series {
  label: string;
  years: number[];
  values: number[];
}

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e4) return Math.round(v / 1e3) + "k";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(Math.round(v));
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const W = 560, H = 132, PL = 44, PR = 10, PT = 12, PB = 22;

function OneChart({ s, k, x0, x1 }: { s: Series; k: number; x0: number; x1: number }) {
  const year = useStore(app, (st) => st.year);
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const n = Math.min(s.years.length, s.values.length);
  if (n < 2) return null;
  const max = niceMax(Math.max(...s.values.slice(0, n)));
  const sx = (y: number): number => PL + ((y - x0) / Math.max(1, x1 - x0)) * (W - PL - PR);
  const sy = (v: number): number => PT + (1 - v / max) * (H - PT - PB);
  let d = "";
  for (let i = 0; i < n; i++) d += `${i ? "L" : "M"}${sx(s.years[i]).toFixed(1)} ${sy(s.values[i]).toFixed(1)}`;
  const area = `${d}L${sx(s.years[n - 1]).toFixed(1)} ${sy(0)}L${sx(s.years[0]).toFixed(1)} ${sy(0)}Z`;
  const span = x1 - x0;
  const step = span > 2000 ? 500 : span > 800 ? 250 : span > 300 ? 100 : 50;
  const xt: number[] = [];
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) xt.push(t);
  const nearest = (clientX: number): number => {
    const r = svg.current!.getBoundingClientRect();
    const yv = x0 + ((((clientX - r.left) / r.width) * W - PL) / (W - PL - PR)) * (x1 - x0);
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dd = Math.abs(s.years[i] - yv);
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    }
    return bi;
  };
  const hv = hover !== null ? { x: sx(s.years[hover]), y: sy(s.values[hover]), yr: s.years[hover], v: s.values[hover] } : null;
  const cur = year >= x0 && year <= x1 ? sx(year) : null;
  const color = `var(--chart-${(k % 3) + 1})`;
  return (
    <div class="chart">
      <div class="chart-title">{s.label}</div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        class="chart-svg"
        role="img"
        aria-label={`${s.label} from ${s.years[0]} to ${s.years[n - 1]}; peak ${compact(Math.max(...s.values))}`}
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          interruptGenesis();
          setYear(s.years[nearest(e.clientX)]);
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PL} x2={W - PR} y1={sy(max * f)} y2={sy(max * f)} class={f === 0 ? "chart-base" : "chart-grid"} />
            <text x={PL - 6} y={sy(max * f) + 3.5} class="chart-ylab" text-anchor="end">
              {compact(max * f)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={t} x={sx(t)} y={H - 6} class="chart-xlab" text-anchor="middle">
            {t}
          </text>
        ))}
        <path d={area} fill={color} opacity="0.12" />
        <path d={d} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {cur !== null ? <line x1={cur} x2={cur} y1={PT - 4} y2={H - PB} class="chart-now" /> : null}
        {hv ? (
          <g class="chart-hover">
            <line x1={hv.x} x2={hv.x} y1={PT} y2={H - PB} />
            <circle cx={hv.x} cy={hv.y} r="4" fill={color} />
            <g transform={`translate(${Math.min(W - PR - 92, Math.max(PL, hv.x + 8))} ${PT})`}>
              <rect width="92" height="30" rx="3" class="chart-tip" />
              <text x="8" y="12" class="chart-tip-y">
                {hv.yr}
              </text>
              <text x="8" y="25" class="chart-tip-v">
                {compact(hv.v)}
              </text>
            </g>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export function ChartFigure({ series }: { series: Series[] }) {
  const all = series.filter((s) => s.years.length > 1);
  if (!all.length) return null;
  const x0 = Math.min(...all.map((s) => s.years[0]));
  const x1 = Math.max(...all.map((s) => s.years[s.years.length - 1]));
  return (
    <div class="charts">
      {all.map((s, k) => (
        <OneChart key={k} s={s} k={k} x0={x0} x1={x1} />
      ))}
    </div>
  );
}
