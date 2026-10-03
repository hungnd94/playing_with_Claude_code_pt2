/** An encyclopedia article: title, native name, infobox, body, see also. */
import type { Article, EntityKind } from "../../../narrative/types";
import { Blocks } from "../rich/Blocks";
import { EntityLink, NativeName, RichText } from "../rich/Rich";
import { EmblemImg } from "../rich/figures/Figure";
import { app } from "../../state/app";
import { useStore } from "../../state/store";

export const KIND_LABEL: Record<EntityKind, string> = {
  world: "The world",
  settlement: "Place",
  polity: "Realm",
  person: "Person",
  dynasty: "House",
  culture: "People",
  language: "Tongue",
  script: "Script",
  religion: "Faith",
  deity: "Deity",
  myth: "Myth",
  war: "War",
  battle: "Battle",
  wonder: "Monument",
  work: "Work",
  tradeRoute: "Trade road",
  disaster: "Disaster",
  feature: "Landscape",
  age: "Age",
  event: "Event",
  year: "Year",
};

export function ArticleView({ a }: { a: Article }) {
  const narrative = useStore(app, (s) => s.narrative);
  const lead = a.blocks.findIndex((b) => b.t === "p");
  const blocks = a.blocks.map((b, i) => (i === lead && b.t === "p" && b.dropCap === undefined ? { ...b, dropCap: true } : b));
  const hasInfo = a.infobox.length > 0 || !!a.emblem;
  return (
    <article class={`article art-${a.ref.kind}`} aria-labelledby="art-title">
      <header class="art-head">
        <div class="art-kicker">{KIND_LABEL[a.ref.kind]}</div>
        <h1 class="art-title" id="art-title">
          {a.title}
        </h1>
        {a.native ? (
          <div class="art-native">
            <NativeName name={a.native} />
            {a.native.ipa ? <span class="art-ipa">/{a.native.ipa}/</span> : null}
            {a.native.gloss ? <span class="art-gloss">“{a.native.gloss}”</span> : null}
          </div>
        ) : null}
        {a.subtitle ? <p class="art-sub">{a.subtitle}</p> : null}
      </header>
      {hasInfo ? (
        <aside class="infobox" aria-label="Summary">
          {a.emblem ? (
            <div class="infobox-emblem">
              <EmblemImg emblem={a.emblem} size={150} />
            </div>
          ) : null}
          {a.infobox.length ? (
            <dl>
              {a.infobox.map((r, i) => (
                <div class="ib-row" key={i}>
                  <dt>{r.label}</dt>
                  <dd>
                    <RichText content={r.value} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {a.emblem?.blazon ? <p class="ib-blazon">{a.emblem.blazon}</p> : null}
        </aside>
      ) : null}
      <div class="art-body">
        <Blocks blocks={blocks} />
      </div>
      {a.seeAlso && a.seeAlso.length ? (
        <footer class="see-also">
          <h2>See also</h2>
          <ul>
            {a.seeAlso.map((r, i) => (
              <li key={i}>
                <EntityLink ref_={r}>{narrative ? narrative.label(r) : `${r.kind} ${r.id}`}</EntityLink>
                <span class="see-kind">{KIND_LABEL[r.kind]}</span>
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  );
}

export function RichLine({ r }: { r: Parameters<typeof RichText>[0]["content"] }) {
  return <RichText content={r} />;
}
