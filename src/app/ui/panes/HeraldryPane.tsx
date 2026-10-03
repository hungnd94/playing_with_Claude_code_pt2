/**
 * Heraldry: the roll of arms — every realm's and house's arms with blazon,
 * filterable by year (those bearing arms at the timeline's year) and kind.
 * Rendered in batches as the roll is scrolled.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Emblem, History, Id } from "../../../history/types";
import { app } from "../../state/app";
import { useStore } from "../../state/store";
import { EntityLink, YearLink } from "../rich/Rich";
import { EmblemImg } from "../rich/figures/Figure";
import { flagSVG } from "../../engine/emblem";
import { polityTitleAt } from "../../engine/describe";

interface Entry {
  kind: "polity" | "dynasty";
  id: Id;
  name: string;
  emblem: Emblem;
  from: number;
  to: number;
  flag?: unknown;
  motto?: string;
}

const BATCH = 30;

export function HeraldryPane() {
  const h = useStore(app, (s) => s.history);
  const year = useStore(app, (s) => s.year);
  const [kind, setKind] = useState<"all" | "polity" | "dynasty">("polity");
  const [when, setWhen] = useState<"now" | "ever">("now");
  const [count, setCount] = useState(BATCH);
  const entries = useMemo(() => (h ? collect(h) : []), [h]);
  const list = useMemo(() => {
    const yb = Math.floor(year / 10) * 10;
    return entries.filter((e) => (kind === "all" || e.kind === kind) && (when === "ever" || (e.from <= yb && (e.to < 0 || e.to > yb))));
  }, [entries, kind, when, Math.floor(year / 10)]);
  useEffect(() => setCount(BATCH), [kind, when]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setCount((c) => c + BATCH);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);
  if (!h) return <p class="pane-empty">No arms have yet been borne.</p>;
  return (
    <div class="article roll">
      <header class="art-head">
        <div class="art-kicker">Heraldry</div>
        <h1 class="art-title">The Roll of Arms</h1>
        <p class="art-sub">
          {when === "now" ? (
            <>
              Arms borne in <YearLink year={year} />: {list.length} {kind === "dynasty" ? "houses" : kind === "polity" ? "realms" : "realms and houses"}.
            </>
          ) : (
            <>All {list.length} arms ever borne, in order of their granting.</>
          )}{" "}
          Arms follow the rule of tincture; cadet houses bear their fathers' arms differenced.
        </p>
      </header>
      <div class="filters" role="group" aria-label="Filters">
        <div class="seg" role="radiogroup" aria-label="Bearers">
          {(
            [
              ["polity", "Realms"],
              ["dynasty", "Houses"],
              ["all", "Both"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={kind === k} class={`seg-btn ${kind === k ? "is-on" : ""}`} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        <div class="seg" role="radiogroup" aria-label="When">
          {(
            [
              ["now", `In ${year}`],
              ["ever", "All time"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={when === k} class={`seg-btn ${when === k ? "is-on" : ""}`} onClick={() => setWhen(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <ul class="arms-grid">
        {list.slice(0, count).map((e) => (
          <li key={`${e.kind}${e.id}`} class="arms-card">
            <div class="arms-art">
              <EmblemImg emblem={e.emblem} size={96} />
              {e.flag ? <span class="arms-flag" aria-hidden="true" dangerouslySetInnerHTML={{ __html: flagSVG(e.flag, 54) }} /> : null}
            </div>
            <div class="arms-name">
              <EntityLink ref_={{ kind: e.kind, id: e.id }}>{e.kind === "polity" ? polityTitleAt(h, e.id, when === "now" ? year : e.from) : `House of ${e.name}`}</EntityLink>
            </div>
            <div class="arms-dates num">
              {e.from}–{e.to >= 0 ? e.to : ""}
            </div>
            <p class="arms-blazon">{e.emblem.blazon}</p>
            {e.motto ? <p class="arms-motto">“{e.motto}”</p> : null}
          </li>
        ))}
      </ul>
      {count < list.length ? <div ref={sentinel} class="annals-more" aria-hidden="true">…</div> : <div ref={sentinel} />}
    </div>
  );
}

function collect(h: History): Entry[] {
  const out: Entry[] = [];
  for (const p of h.polities) {
    if (!p.emblem) continue;
    out.push({ kind: "polity", id: p.id, name: p.names[0]?.name.roman ?? "?", emblem: p.emblem, from: p.founded, to: p.ended, flag: p.flag, motto: p.motto?.translation });
  }
  for (const d of h.dynasties) {
    if (!d.emblem) continue;
    out.push({ kind: "dynasty", id: d.id, name: d.name.roman, emblem: d.emblem, from: d.founded, to: d.extinct, motto: d.motto?.translation });
  }
  out.sort((a, b) => a.from - b.from || a.id - b.id);
  return out;
}
