/**
 * Chronicle: annals by year, one line per event, importance and
 * realm/people/region filters, legends set apart for preliterate events.
 * Windowed: renders a slice around the timeline year and grows on demand.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { app, setYear } from "../../state/app";
import { useStore } from "../../state/store";
import { interruptGenesis } from "../../state/playback";
import { RichText } from "../rich/Rich";
import type { ChronicleEntry } from "../../../narrative/types";
import { polityTitleAt } from "../../engine/describe";
import { nameAt } from "../../engine/query";

const LEVELS = [
  { id: 4, label: "Major" },
  { id: 3, label: "Notable" },
  { id: 2, label: "All" },
] as const;

const PAGE = 160;

export function ChroniclePane({ sub }: { sub?: number }) {
  const narrative = useStore(app, (s) => s.narrative);
  const history = useStore(app, (s) => s.history);
  const world = useStore(app, (s) => s.world);
  const year = useStore(app, (s) => s.year);
  const [level, setLevel] = useState<number>(3);
  const [realm, setRealm] = useState<number>(-1);
  const [people, setPeople] = useState<number>(-1);
  const [region, setRegion] = useState<number>(-1);
  const all = useMemo(() => (narrative ? narrative.chronicle() : []), [narrative]);

  const realms = useMemo(() => {
    if (!history) return [];
    return history.polities
      .filter((p) => p.peak.areaKm2 > 0)
      .sort((a, b) => b.peak.areaKm2 - a.peak.areaKm2)
      .slice(0, 80)
      .map((p) => ({ id: p.id, label: `${polityTitleAt(history, p.id, p.peak.year)} (${p.founded}–${p.ended >= 0 ? p.ended : ""})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [history]);
  const peoples = useMemo(() => (history ? history.cultures.map((c) => ({ id: c.id, label: `The ${c.adjective}` })).sort((a, b) => a.label.localeCompare(b.label)) : []), [history]);
  const regions = useMemo(() => {
    if (!world || !history) return [];
    return world.features
      .filter((f) => f.kind === "continent" || (f.kind === "island" && f.size > 150000))
      .map((f) => {
        const fn = history.featureNames.find((x) => x.feature === f.id);
        const nm = fn?.names[0]?.name.roman;
        return { id: f.id, label: nm ? `${nm}` : `${f.kind === "continent" ? "Continent" : "Island"} ${f.id}`, size: f.size };
      })
      .sort((a, b) => b.size - a.size)
      .slice(0, 16);
  }, [world, history]);

  const list = useMemo(() => {
    if (!history || !world) return [] as ChronicleEntry[];
    return all.filter((e) => {
      if (e.importance < level) return false;
      const ev = history.events[e.event];
      if (realm >= 0 && !ev?.polities?.includes(realm)) return false;
      if (people >= 0) {
        const hit = ev?.cultures?.includes(people) || ev?.polities?.some((p) => history.polities[p]?.culture === people);
        if (!hit) return false;
      }
      if (region >= 0 && (e.cell < 0 || world.landmassOf[e.cell] !== region)) return false;
      return true;
    });
  }, [all, level, realm, people, region, history, world]);

  // Window around a target year.
  const target = sub ?? year;
  const startFor = (y: number): number => {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m].year < y) lo = m + 1;
      else hi = m;
    }
    return Math.max(0, lo - 12);
  };
  const [win, setWin] = useState<[number, number]>([0, PAGE]);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = startFor(target);
    setWin([s, Math.min(list.length, s + PAGE)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, sub]);
  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "start" });
  }, [win[0]]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setWin(([a, b]) => [a, Math.min(list.length, b + PAGE)]);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  if (!narrative || !history) return <p class="pane-empty">The chronicle will be written when history is done.</p>;

  const slice = list.slice(win[0], win[1]);
  const rows: preact.JSX.Element[] = [];
  let lastYear = -1;
  let lastAge = -1;
  let inLegend = false;
  for (const e of slice) {
    const ai = history.ages.findIndex((a) => a.start <= e.year && e.year <= a.end);
    if (ai !== lastAge && ai >= 0) {
      lastAge = ai;
      const A = history.ages[ai];
      rows.push(
        <li class="ce-age" key={`age${ai}-${e.event}`}>
          <span class="ce-age-name">{A.name.replace(/^the /, "The ")}</span>
          <span class="ce-age-span num">
            {A.start}–{A.end}
          </span>
        </li>,
      );
    }
    if (e.year !== lastYear) {
      lastYear = e.year;
      inLegend = false;
      rows.push(
        <li class="ce-year" key={`y${e.year}-${e.event}`}>
          <button
            class="ce-year-btn num"
            onClick={() => {
              interruptGenesis();
              setYear(e.year);
            }}
            title="Move the timeline here"
          >
            {e.year}
          </button>
        </li>,
      );
    }
    rows.push(
      <li key={e.event} class={`ce imp-${e.importance} ${e.legendary ? "is-legend" : ""}`}>
        {e.legendary && !inLegend ? <span class="ce-legend-mark" title="Told as legend: the people concerned did not yet write">legend</span> : null}
        <RichText content={e.text} />
      </li>,
    );
    inLegend = e.legendary;
  }
  const nowIdx = slice.findIndex((e) => e.year >= year);
  void nowIdx;
  return (
    <div class="chronicle">
      <header class="art-head">
        <div class="art-kicker">Annals</div>
        <h1 class="art-title">The Chronicle</h1>
        <p class="art-sub">
          {list.length.toLocaleString("en-GB")} entries{realm >= 0 ? ` concerning ${nameAt(history.polities[realm].names, history.polities[realm].peak.year).roman}` : ""}. Entries in the legend register record what was told, not written: the peoples concerned had no letters yet.
        </p>
      </header>
      <div class="filters" role="group" aria-label="Filters">
        <div class="seg" role="radiogroup" aria-label="Importance">
          {LEVELS.map((l) => (
            <button key={l.id} role="radio" aria-checked={level === l.id} class={`seg-btn ${level === l.id ? "is-on" : ""}`} onClick={() => setLevel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <select id="chron-realm" aria-label="Realm" value={realm} onChange={(e) => setRealm(+(e.currentTarget as HTMLSelectElement).value)}>
          <option value={-1}>All realms</option>
          {realms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select id="chron-people" aria-label="People" value={people} onChange={(e) => setPeople(+(e.currentTarget as HTMLSelectElement).value)}>
          <option value={-1}>All peoples</option>
          {peoples.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select id="chron-region" aria-label="Region" value={region} onChange={(e) => setRegion(+(e.currentTarget as HTMLSelectElement).value)}>
          <option value={-1}>All lands</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button class="seg-btn ce-follow" onClick={() => setWin([startFor(year), Math.min(list.length, startFor(year) + PAGE)])}>
          Go to <span class="num">{year}</span>
        </button>
      </div>
      {win[0] > 0 ? (
        <button class="more-btn" onClick={() => setWin(([a, b]) => [Math.max(0, a - PAGE), b])}>
          Earlier years
        </button>
      ) : null}
      <div ref={anchor} />
      <ol class="annals">{rows}</ol>
      {win[1] < list.length ? <div ref={sentinel} class="annals-more" aria-hidden="true">…</div> : <div ref={sentinel} class="annals-end">Here the chronicle ends.</div>}
    </div>
  );
}
