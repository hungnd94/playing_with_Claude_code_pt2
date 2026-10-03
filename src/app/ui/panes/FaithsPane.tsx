/**
 * Faiths: how the religions spread over time, the faiths and their gods,
 * and per-faith pages (pantheon, myths, tenets, holy city, spread).
 */
import { useMemo, useRef, useState } from "preact/hooks";
import type { History, Id, Religion } from "../../../history/types";
import { LayerCursor } from "../../../history/query";
import { app, navigate, setYear } from "../../state/app";
import { useStore } from "../../state/store";
import { interruptGenesis } from "../../state/playback";
import { EntityLink, NativeName, RichText, YearLink, activate } from "../rich/Rich";
import { Fleuron } from "../rich/Blocks";
import { EmblemImg } from "../rich/figures/Figure";
import { MiniMap } from "../rich/figures/MiniMap";
import { rgbCss } from "../../engine/overlay";
import { faithSeal } from "../../engine/emblem";
import { capFirst } from "../../engine/describe";
import { personName } from "../../engine/query";

export function openFaith(id: Id): void {
  navigate({ tab: "faiths", sub: id, ref: { kind: "religion", id } });
}

function FaithLink({ id, h }: { id: Id; h: History }) {
  const go = (): void => openFaith(id);
  return (
    <a class="lk" role="link" tabIndex={0} onClick={go} onKeyDown={(e) => activate(e, go)}>
      {capFirst(h.religions[id]?.english ?? "?")}
    </a>
  );
}

interface Spread {
  years: number[];
  series: { id: Id; share: number[] }[];
}

function computeSpread(h: History, top = 6): Spread {
  const tl = h.timeline;
  const cur = new LayerCursor(tl.religion, tl);
  const step = Math.max(tl.step, Math.round(h.endYear / 80 / tl.step) * tl.step);
  const years: number[] = [];
  const counts = new Map<Id, number[]>();
  let k = 0;
  for (let y = 0; y <= h.endYear; y += step, k++) {
    const arr = cur.at(y);
    let total = 0;
    const m = new Map<Id, number>();
    for (let c = 0; c < arr.length; c++) {
      const r = arr[c];
      if (r < 0) continue;
      total++;
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    years.push(y);
    for (const [r, n] of m) {
      let a = counts.get(r);
      if (!a) counts.set(r, (a = []));
      a[k] = n / Math.max(1, total);
    }
  }
  const peak = [...counts.entries()].map(([id, a]) => ({ id, a: years.map((_, i) => a[i] ?? 0), peak: Math.max(...a.filter((x) => x !== undefined)) }));
  peak.sort((a, b) => b.peak - a.peak || a.id - b.id);
  return { years, series: peak.slice(0, top).map((p) => ({ id: p.id, share: p.a })) };
}

function SpreadChart({ h }: { h: History }) {
  const sp = useMemo(() => computeSpread(h), [h]);
  const year = useStore(app, (s) => s.year);
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 600, H = 220, PL = 36, PR = 10, PT = 10, PB = 22;
  const n = sp.years.length;
  if (n < 2 || !sp.series.length) return null;
  const max = Math.min(1, Math.ceil(Math.max(...sp.series.flatMap((s) => s.share)) * 10) / 10 || 1);
  const sx = (i: number): number => PL + (i / (n - 1)) * (W - PL - PR);
  const sy = (v: number): number => PT + (1 - v / max) * (H - PT - PB);
  const idx = (clientX: number): number => {
    const r = svg.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((((clientX - r.left) / r.width) * W - PL) / (W - PL - PR)) * (n - 1))));
  };
  const curX = PL + (year / Math.max(1, h.endYear)) * (W - PL - PR);
  return (
    <figure class="fig fig-chart">
      <div class="chart-title">Share of the peopled land, by faith</div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        class="chart-svg"
        role="img"
        aria-label="Spread of the faiths over time"
        onPointerMove={(e) => setHover(idx(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          interruptGenesis();
          setYear(sp.years[idx(e.clientX)]);
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PL} x2={W - PR} y1={sy(max * f)} y2={sy(max * f)} class={f === 0 ? "chart-base" : "chart-grid"} />
            <text x={PL - 6} y={sy(max * f) + 3.5} class="chart-ylab" text-anchor="end">
              {Math.round(max * f * 100)}%
            </text>
          </g>
        ))}
        {sp.years.map((y, i) =>
          y % 500 === 0 ? (
            <text key={y} x={sx(i)} y={H - 6} class="chart-xlab" text-anchor="middle">
              {y}
            </text>
          ) : null,
        )}
        {sp.series.map((s) => {
          let d = "";
          s.share.forEach((v, i) => (d += `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`));
          return <path key={s.id} d={d} fill="none" stroke={rgbCss(h.religions[s.id].color)} stroke-width="2" stroke-linejoin="round" />;
        })}
        <line x1={curX} x2={curX} y1={PT} y2={H - PB} class="chart-now" />
        {hover !== null ? (
          <g class="chart-hover">
            <line x1={sx(hover)} x2={sx(hover)} y1={PT} y2={H - PB} />
            {sp.series.map((s) => (
              <circle key={s.id} cx={sx(hover)} cy={sy(s.share[hover])} r="3.5" fill={rgbCss(h.religions[s.id].color)} />
            ))}
          </g>
        ) : null}
      </svg>
      <ul class="chart-legend">
        {sp.series.map((s) => (
          <li key={s.id}>
            <span class="legend-sw" style={{ background: rgbCss(h.religions[s.id].color) }} aria-hidden="true" />
            <FaithLink id={s.id} h={h} />
            {hover !== null ? <span class="num legend-val"> {Math.round(s.share[hover] * 100)}%</span> : null}
          </li>
        ))}
        {hover !== null ? <li class="legend-year num">in {sp.years[hover]}</li> : null}
      </ul>
    </figure>
  );
}

function Symbol({ r, size = 72 }: { r: Religion; size?: number }) {
  return <EmblemImg emblem={r.emblem ?? faithSeal(r.id, r.symbol, r.name.roman)} size={size} title={`Sign: ${r.symbol}`} />;
}

function Overview() {
  const h = useStore(app, (s) => s.history)!;
  const organised = h.religions.filter((r) => r.kind !== "folk").sort((a, b) => a.founded - b.founded);
  const folk = h.religions.filter((r) => r.kind === "folk");
  return (
    <div class="article faiths">
      <header class="art-head">
        <div class="art-kicker">Faiths</div>
        <h1 class="art-title">Gods and Faiths</h1>
        <p class="art-sub">
          {h.religions.length} faiths and {h.deities.length} gods. Every people began with the gods of its own rivers and mountains; some faiths were later revealed, preached and carried far by kings and armies.
        </p>
      </header>
      <SpreadChart h={h} />
      {organised.length ? (
        <>
          <h2>The great faiths</h2>
          <div class="faith-cards">
            {organised.map((r) => (
              <article key={r.id} class="faith-card">
                <Symbol r={r} />
                <div>
                  <h3>
                    <FaithLink id={r.id} h={h} />
                  </h3>
                  <div class="faith-native">
                    <NativeName name={r.name} />
                  </div>
                  <p>
                    {capFirst(r.kind)}, founded <YearLink year={r.founded} />
                    {r.founder >= 0 ? (
                      <>
                        {" "}
                        by <EntityLink ref_={{ kind: "person", id: r.founder }}>{personName(h, r.founder)}</EntityLink>
                      </>
                    ) : null}
                    {r.holyCity >= 0 ? (
                      <>
                        ; holy city <EntityLink ref_={{ kind: "settlement", id: r.holyCity }}>{h.settlements[r.holyCity].names[0].name.roman}</EntityLink>
                      </>
                    ) : null}
                    {r.ended >= 0 ? (
                      <>
                        ; extinct by <YearLink year={r.ended} />
                      </>
                    ) : null}
                    .
                  </p>
                  {r.tenets.length ? <p class="faith-tenets">{r.tenets.slice(0, 3).map(capFirst).join(" · ")}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      <Fleuron />
      <h2>The old gods of the peoples</h2>
      <ul class="enc-list">
        {folk.map((r) => (
          <li key={r.id}>
            <FaithLink id={r.id} h={h} /> <span class="enc-type">{r.deities.length} gods</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FaithPage({ id }: { id: Id }) {
  const h = useStore(app, (s) => s.history)!;
  const narrative = useStore(app, (s) => s.narrative);
  const year = useStore(app, (s) => s.year);
  const R = h.religions[id];
  if (!R) return null;
  const gods = R.deities.map((d) => h.deities[d]).filter(Boolean);
  const myths = h.myths.filter((m) => m.religion === id);
  const C = h.cultures[R.culture];
  return (
    <article class="article faith-page">
      <header class="art-head">
        <div class="art-kicker">
          <a class="lk" role="link" tabIndex={0} onClick={() => navigate({ tab: "faiths" })} onKeyDown={(e) => activate(e, () => navigate({ tab: "faiths" }))}>
            Faiths
          </a>{" "}
          · {R.kind}
        </div>
        <h1 class="art-title">{capFirst(R.english)}</h1>
        <div class="art-native">
          <NativeName name={R.name} />
          {R.name.gloss ? <span class="art-gloss">“{R.name.gloss}”</span> : null}
        </div>
        <p class="art-sub">
          {R.kind === "folk" ? "The ancestral faith" : "A faith"} of the {C ? <EntityLink ref_={{ kind: "culture", id: C.id }}>{C.adjective}</EntityLink> : "?"}, from <YearLink year={R.founded} />
          {R.parent >= 0 ? (
            <>
              , sprung from <FaithLink id={R.parent} h={h} />
            </>
          ) : null}
          .{" "}
          <EntityLink ref_={{ kind: "religion", id }} tab="article">
            Read the article
          </EntityLink>
        </p>
      </header>
      <div class="faith-seal">
        <Symbol r={R} size={120} />
      </div>
      <figure class="fig fig-map">
        <MiniMap focus={{ kind: "religion", id }} year={Math.min(Math.max(year, R.founded), R.ended >= 0 ? R.ended - 1 : year)} />
        <figcaption>
          Its faithful in <span class="num">{Math.min(Math.max(year, R.founded), R.ended >= 0 ? R.ended - 1 : year)}</span>
        </figcaption>
      </figure>
      {R.tenets.length ? (
        <>
          <h2>Teachings</h2>
          <ul>
            {R.tenets.map((t, i) => (
              <li key={i}>{capFirst(t)}.</li>
            ))}
          </ul>
        </>
      ) : null}
      {gods.length ? (
        <>
          <Fleuron />
          <h2>{gods.length === 1 ? "The god" : "The gods"}</h2>
          <dl class="pantheon">
            {gods.map((g) => (
              <div key={g.id} class="god">
                <dt>
                  <EntityLink ref_={{ kind: "deity", id: g.id }}>
                    <NativeName name={g.name} plain />
                  </EntityLink>
                  {g.epithets[0] ? <span class="god-epithet">, {g.epithets[0]}</span> : null}
                </dt>
                <dd>
                  {g.domains.map(capFirst).join(", ")}
                  {g.symbol ? <span class="god-symbol"> · sign: {g.symbol}</span> : null}
                  {g.feature >= 0 ? (
                    <span>
                      {" "}
                      · dwells in <EntityLink ref_={{ kind: "feature", id: g.feature }}>{narrative?.label({ kind: "feature", id: g.feature }) ?? "?"}</EntityLink>
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {myths.length && narrative ? (
        <>
          <Fleuron />
          <h2>What is told</h2>
          {myths.slice(0, 4).map((m) => {
            const a = narrative.article({ kind: "myth", id: m.id });
            const q = a.blocks.find((b) => b.t === "quote");
            return (
              <section key={m.id}>
                <h3>{a.title}</h3>
                {q && q.t === "quote" ? (
                  <blockquote>
                    {q.content.map((r, i) => (
                      <p key={i}>
                        <RichText content={r} />
                      </p>
                    ))}
                  </blockquote>
                ) : null}
              </section>
            );
          })}
        </>
      ) : null}
      {R.children.length ? (
        <>
          <h2>Offshoots</h2>
          <ul>
            {R.children.map((c) => (
              <li key={c}>
                <FaithLink id={c} h={h} />, from <YearLink year={h.religions[c].founded} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

export function FaithsPane({ sub }: { sub?: number }) {
  const h = useStore(app, (s) => s.history);
  if (!h) return <p class="pane-empty">No god has yet been named.</p>;
  return sub !== undefined && h.religions[sub] ? <FaithPage id={sub} /> : <Overview />;
}
