/**
 * Encyclopedia tab: an article for a reference, the "place" page for a
 * picked globe cell, or (no target) the index of the encyclopedia.
 */
import { useMemo, useState } from "preact/hooks";
import type { EntityKind, Ref, SearchEntry } from "../../../narrative/types";
import { BIOME_NAMES } from "../../../world/types";
import { app, type Loc } from "../../state/app";
import { useStore } from "../../state/store";
import { ArticleView, KIND_LABEL } from "./ArticleView";
import { EntityLink, NativeName, RichText, YearLink } from "../rich/Rich";
import { EmblemImg } from "../rich/figures/Figure";
import { settlementNear } from "../../engine/locate";
import { stageController } from "../stage/bus";
import { cellLatLon, formatLatLon } from "../../engine/geo";
import { featureNameAt, polityTitleAt, capFirst } from "../../engine/describe";
import { entryAt, formatPop, nameAt, popAt, rulerAt, personName } from "../../engine/query";

export function EncyclopediaPane({ loc }: { loc: Loc }) {
  if (loc.ref) return <ArticlePage r={loc.ref} />;
  if (loc.sub !== undefined) return <PlacePage cell={loc.sub} />;
  return <EncyclopediaIndex />;
}

function ArticlePage({ r }: { r: Ref }) {
  const narrative = useStore(app, (s) => s.narrative);
  const a = useMemo(() => {
    if (!narrative) return null;
    try {
      return narrative.article(r);
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [narrative, r.kind, r.id]);
  if (!a) return <p class="pane-empty">This article has not been written.</p>;
  return <ArticleView a={a} />;
}

const INDEX_GROUPS: { kinds: EntityKind[]; title: string }[] = [
  { kinds: ["polity"], title: "Realms" },
  { kinds: ["settlement"], title: "Cities and towns" },
  { kinds: ["person"], title: "People" },
  { kinds: ["dynasty"], title: "Houses" },
  { kinds: ["war", "battle"], title: "Wars and battles" },
  { kinds: ["culture"], title: "Peoples" },
  { kinds: ["language", "script"], title: "Tongues and scripts" },
  { kinds: ["religion", "deity"], title: "Faiths and gods" },
  { kinds: ["wonder", "work"], title: "Monuments and works" },
  { kinds: ["feature"], title: "Lands and waters" },
  { kinds: ["disaster", "tradeRoute"], title: "Plagues, disasters and trade roads" },
];

function EncyclopediaIndex() {
  const narrative = useStore(app, (s) => s.narrative);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const idx = useMemo(() => (narrative ? narrative.searchIndex() : []), [narrative]);
  const groups = useMemo(() => {
    return INDEX_GROUPS.map((g) => ({
      ...g,
      items: idx.filter((e) => g.kinds.includes(e.ref.kind)).sort((a, b) => b.weight - a.weight),
    }));
  }, [idx]);
  if (!narrative) return <p class="pane-empty">The encyclopedia will be written when history is done.</p>;
  return (
    <div class="enc-index">
      <header class="art-head">
        <div class="art-kicker">Encyclopedia</div>
        <h1 class="art-title">Index of Things Remembered</h1>
        <p class="art-sub">
          {idx.length.toLocaleString("en-GB")} entries. Every name in every article is a link; press <kbd>/</kbd> to search them all.
        </p>
      </header>
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.title} class="enc-group">
            <h2>
              {g.title} <span class="enc-count num">{g.items.length}</span>
            </h2>
            <ul class="enc-list">
              {(open[g.title] ? g.items.slice(0, 400) : g.items.slice(0, 18)).map((e: SearchEntry) => (
                <li key={`${e.ref.kind}${e.ref.id}`}>
                  <EntityLink ref_={e.ref}>{e.label}</EntityLink>
                  <span class="enc-type">{e.type}</span>
                </li>
              ))}
            </ul>
            {g.items.length > 18 ? (
              <button class="more-btn" onClick={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}>
                {open[g.title] ? "Fewer" : `All ${Math.min(400, g.items.length)}`}
              </button>
            ) : null}
          </section>
        ) : null,
      )}
    </div>
  );
}

function PlacePage({ cell }: { cell: number }) {
  const world = useStore(app, (s) => s.world);
  const h = useStore(app, (s) => s.history);
  const year = useStore(app, (s) => s.year);
  const narrative = useStore(app, (s) => s.narrative);
  if (!world) return null;
  const [lat, lon] = cellLatLon(world, cell);
  const land = !!world.isLand[cell];
  const lake = world.lakeId[cell] >= 0;
  const biome = BIOME_NAMES[world.biome[cell]] ?? "";
  const region = world.regionOf[cell];
  const mass = land ? world.landmassOf[cell] : world.waterBodyOf[cell];
  const engine = stageController()?.overlayEngine ?? null;
  const owner = h && engine ? (engine.ownerAt(year)?.[cell] ?? -1) : -1;
  const culture = h && engine ? (engine.cultureAt(year)?.[cell] ?? -1) : -1;
  const religion = h && engine ? (engine.religionAt(year)?.[cell] ?? -1) : -1;
  const sid = h ? settlementNear(world, h, cell, year) : -1;
  const S = h && sid >= 0 ? h.settlements[sid] : null;
  const P = h && owner >= 0 ? h.polities[owner] : null;
  const C = h && culture >= 0 ? h.cultures[culture] : null;
  const R = h && religion >= 0 ? h.religions[religion] : null;
  const lang = C ? (entryAt(C.languages, year)?.lang ?? -1) : -1;
  const fname = (f: number): string | null => (f >= 0 ? featureNameAt(h, f, year) : null);
  const title = S ? nameAt(S.names, year).roman : fname(region) ?? fname(mass) ?? capFirst(biome);
  const ruler = P && h ? rulerAt(P, year) : -1;
  // What happened here (this cell and its neighbours).
  const near = new Set<number>([cell]);
  for (let k = world.mesh.adjStart[cell]; k < world.mesh.adjStart[cell + 1]; k++) near.add(world.mesh.adj[k]);
  const events = h && narrative ? h.events.filter((e) => e.cell >= 0 && near.has(e.cell) && e.importance >= 2).sort((a, b) => b.importance - a.importance || a.year - b.year).slice(0, 12).sort((a, b) => a.year - b.year) : [];
  const temp = world.temperature[cell], rain = world.precipitation[cell], elev = world.elevation[cell];
  return (
    <article class="article place">
      <header class="art-head">
        <div class="art-kicker">
          A place in <span class="num">{year}</span> · {formatLatLon(lat, lon)}
        </div>
        <h1 class="art-title">{title}</h1>
        <p class="art-sub">
          {capFirst(biome)}
          {land && !lake ? `, ${Math.round(elev * 1000).toLocaleString("en-GB")} m above the sea` : lake ? "" : `, ${Math.round(-elev * 1000).toLocaleString("en-GB")} m deep`}
        </p>
      </header>
      <dl class="place-facts">
        {S && h ? (
          <div class="pf">
            <dt>Settlement</dt>
            <dd>
              <EntityLink ref_={{ kind: "settlement", id: S.id }}>{nameAt(S.names, year).roman}</EntityLink>
              <span class="pf-note">
                {" "}
                {formatPop(popAt(S, year, h.sampleStep))} souls, founded <YearLink year={S.founded} />
              </span>
            </dd>
          </div>
        ) : null}
        {P && h ? (
          <div class="pf">
            <dt>Realm</dt>
            <dd class="pf-realm">
              <EmblemImg emblem={P.emblem} size={40} class="pf-emblem" />
              <span>
                <EntityLink ref_={{ kind: "polity", id: P.id }}>{polityTitleAt(h, P.id, year)}</EntityLink>
                {ruler >= 0 ? (
                  <span class="pf-note">
                    {" "}
                    ruled by <EntityLink ref_={{ kind: "person", id: ruler }}>{personName(h, ruler)}</EntityLink>
                  </span>
                ) : null}
              </span>
            </dd>
          </div>
        ) : land && !lake && h ? (
          <div class="pf">
            <dt>Realm</dt>
            <dd class="pf-note">No realm held this land in {year}.</dd>
          </div>
        ) : null}
        {C && h ? (
          <div class="pf">
            <dt>People</dt>
            <dd>
              <EntityLink ref_={{ kind: "culture", id: C.id }}>The {C.adjective}</EntityLink>
              {lang >= 0 ? (
                <span class="pf-note">
                  , speaking <EntityLink ref_={{ kind: "language", id: lang }}>{h.languages[lang].name}</EntityLink>
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {R ? (
          <div class="pf">
            <dt>Faith</dt>
            <dd>
              <EntityLink ref_={{ kind: "religion", id: R.id }}>{capFirst(R.english)}</EntityLink>
            </dd>
          </div>
        ) : null}
        <div class="pf">
          <dt>Land</dt>
          <dd>
            {[region, mass].filter((f) => f >= 0).map((f, i) => (
              <span key={f}>
                {i ? ", " : ""}
                <EntityLink ref_={{ kind: "feature", id: f }}>{fname(f) ?? world.features[f]?.kind ?? "?"}</EntityLink>
              </span>
            ))}
            {world.riverOrder[cell] > 0 ? <span class="pf-note"> · a river flows here ({Math.round(world.flow[cell]).toLocaleString("en-GB")} m³/s)</span> : null}
          </dd>
        </div>
        <div class="pf">
          <dt>Climate</dt>
          <dd class="pf-note">
            {temp.toFixed(0)} °C mean, {Math.round(rain).toLocaleString("en-GB")} mm of rain a year
          </dd>
        </div>
      </dl>
      {events.length && narrative ? (
        <section>
          <h2>What happened here</h2>
          <ul class="place-events">
            {events.map((e) => (
              <li key={e.id}>
                <YearLink year={e.year} /> — <RichText content={narrative.headline(e.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {S && C && h ? (
        <p class="place-native">
          Its people called it <NativeName name={nameAt(S.names, year)} />.
        </p>
      ) : null}
      <p class="pane-hint">{KIND_LABEL.feature} and history at this spot change with the timeline. Click elsewhere on the globe to read about another place.</p>
    </article>
  );
}
