/**
 * Scripts: the families of writing with a few glyphs per node, and per-script
 * pages with the full sign chart, the glyph evolution table down its lineage,
 * the history of its letters, who wrote with it, and a sample text.
 */
import { useMemo } from "preact/hooks";
import type { History, Id } from "../../../history/types";
import type { Script as SScript } from "../../../script/types";
import { app, navigate } from "../../state/app";
import { useStore } from "../../state/store";
import { EntityLink, NativeName, YearLink, activate } from "../rich/Rich";
import { Interlinear, Fleuron } from "../rich/Blocks";
import { chartSVG, evolutionSVG, scriptData, scriptTreeSVG, wordSVG } from "../../engine/scripts";
import { entryAt } from "../../engine/query";

const KIND_TEXT: Record<string, string> = {
  alphabet: "an alphabet: letters for consonants and vowels alike",
  abjad: "an abjad: letters for consonants, vowels left to the reader or marked with points",
  abugida: "an abugida: each consonant sign carries a vowel, changed by marks",
  syllabary: "a syllabary: one sign for each syllable",
  featural: "a featural script: the shapes of its signs mirror how the sounds are made",
};

export function openScript(id: Id): void {
  navigate({ tab: "scripts", sub: id, ref: { kind: "script", id } });
}

function ScriptLink({ id, h }: { id: Id; h: History }) {
  const go = (): void => openScript(id);
  return (
    <a class="lk" role="link" tabIndex={0} onClick={go} onKeyDown={(e) => activate(e, go)}>
      {h.scripts[id]?.name}
    </a>
  );
}

function rootOf(h: History, id: Id): Id {
  let r = id;
  for (let i = 0; i < 50 && h.scripts[r]?.parent >= 0; i++) r = h.scripts[r].parent;
  return r;
}

function familyIds(h: History, root: Id): Id[] {
  const out: Id[] = [];
  const walk = (id: Id): void => {
    out.push(id);
    for (const c of h.scripts[id]?.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

function Families() {
  const h = useStore(app, (s) => s.history)!;
  useStore(app, (s) => s.dark);
  const roots = useMemo(() => h.scripts.filter((s) => s.parent < 0).sort((a, b) => a.born - b.born), [h]);
  if (!h.scripts.length) {
    return (
      <div class="article">
        <header class="art-head">
          <div class="art-kicker">Scripts</div>
          <h1 class="art-title">No letters</h1>
          <p class="art-sub">No people of this world ever learned to write. Its history survives only as legend.</p>
        </header>
      </div>
    );
  }
  return (
    <div class="article scripts">
      <header class="art-head">
        <div class="art-kicker">Scripts</div>
        <h1 class="art-title">The Letters of the World</h1>
        <p class="art-sub">
          {h.scripts.length} scripts in {roots.length} {roots.length === 1 ? "family" : "families"}. Each was invented once, then borrowed, adapted and worn into new shapes by every hand that took it up.
        </p>
      </header>
      {roots.map((r) => {
        const ids = familyIds(h, r.id);
        const svg = scriptTreeSVG(h, ids);
        const C = h.cultures[r.culture];
        return (
          <section key={r.id} class="family">
            <h2>
              The {r.name} family <span class="enc-count num">{ids.length} scripts</span>
            </h2>
            <p>
              Invented <YearLink year={r.born} />
              {C ? (
                <>
                  {" "}
                  by the <EntityLink ref_={{ kind: "culture", id: C.id }}>{C.adjective}</EntityLink>
                </>
              ) : null}
              {r.origin >= 0 && h.settlements[r.origin] ? (
                <>
                  {" "}
                  at <EntityLink ref_={{ kind: "settlement", id: r.origin }}>{h.settlements[r.origin].names[0].name.roman}</EntityLink>
                </>
              ) : null}
              ; {KIND_TEXT[r.kind] ?? r.kind}.
            </p>
            {svg ? <div class="script-tree" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
            <ul class="script-list">
              {ids.map((id) => (
                <li key={id}>
                  <ScriptLink id={id} h={h} /> <span class="enc-type">{h.scripts[id].kind}, {h.scripts[id].born}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ScriptPage({ id }: { id: Id }) {
  const h = useStore(app, (s) => s.history)!;
  useStore(app, (s) => s.dark);
  const S = h.scripts[id];
  const d: SScript | null = scriptData(h, id);
  if (!S || !d) return <p class="pane-empty">No record of this script.</p>;
  const lineage: Id[] = [];
  for (let x = id, i = 0; x >= 0 && i < 30; i++) {
    lineage.unshift(x);
    x = h.scripts[x]?.parent ?? -1;
  }
  const C = h.cultures[S.culture];
  const users = h.cultures.filter((c) => c.scripts.some((e) => e.script === id));
  // A sample: the motto of a realm of its people, written in it.
  const motto = h.polities.find((p) => p.culture === S.culture && p.motto?.words?.length && p.founded >= S.born)?.motto ?? h.polities.find((p) => p.culture === S.culture && p.motto?.words?.length)?.motto;
  const langId = C ? (entryAt(C.languages, Math.max(S.born, C.born))?.lang ?? -1) : -1;
  const endo = langId >= 0 ? h.languages[langId]?.endonym : undefined;
  const evo = lineage.length > 1 ? evolutionSVG(h, lineage.slice(-6), 28) : "";
  return (
    <article class="article script-page">
      <header class="art-head">
        <div class="art-kicker">
          <a class="lk" role="link" tabIndex={0} onClick={() => navigate({ tab: "scripts" })} onKeyDown={(e) => activate(e, () => navigate({ tab: "scripts" }))}>
            Scripts
          </a>{" "}
          · {S.kind}
        </div>
        <h1 class="art-title">{S.name}</h1>
        {S.nativeName ? (
          <div class="art-native">
            <NativeName name={S.nativeName} />
            {S.nativeName.gloss ? <span class="art-gloss">“{S.nativeName.gloss}”</span> : null}
          </div>
        ) : null}
        <p class="art-sub">
          {S.how === "invented" ? "Invented" : S.how === "adapted" ? "Adapted" : "Grew out of its parent"} <YearLink year={S.born} />
          {C ? (
            <>
              {" "}
              by the <EntityLink ref_={{ kind: "culture", id: C.id }}>{C.adjective}</EntityLink>
            </>
          ) : null}
          {S.parent >= 0 ? (
            <>
              {" "}
              from the <ScriptLink id={S.parent} h={h} />
            </>
          ) : null}
          ; {KIND_TEXT[S.kind] ?? S.kind}. {d.direction === "rtl" ? "Written right to left." : d.direction === "ttb" ? "Written in columns from the top." : ""}{" "}
          <EntityLink ref_={{ kind: "script", id }} tab="article">
            Read the article
          </EntityLink>
        </p>
      </header>
      {endo?.phonemes ? (
        <div class="script-word">
          <span class="script-ink" dangerouslySetInnerHTML={{ __html: wordSVG(h, id, endo.phonemes, 60) }} />
          <span class="script-word-roman">{endo.roman}</span>
        </div>
      ) : null}
      <h2>The signs</h2>
      <div class="script-chart" dangerouslySetInnerHTML={{ __html: chartSVG(h, id, 32) }} />
      {d.history?.length ? (
        <>
          <Fleuron />
          <h2>How its letters came to be</h2>
          <ul>
            {d.history.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      ) : null}
      {evo ? (
        <>
          <Fleuron />
          <h2>Descent of the letters</h2>
          <p class="fig-note">Each row follows one letter from the oldest script of the line (left) to this one (right).</p>
          <div class="script-evo" dangerouslySetInnerHTML={{ __html: evo }} />
        </>
      ) : null}
      {motto ? (
        <>
          <Fleuron />
          <h2>A specimen</h2>
          <Interlinear u={motto} />
        </>
      ) : null}
      <Fleuron />
      <h2>Its writers</h2>
      <ul>
        {users.map((c) => {
          const e = c.scripts.find((x) => x.script === id)!;
          const next = c.scripts.find((x) => x.year > e.year);
          return (
            <li key={c.id}>
              The <EntityLink ref_={{ kind: "culture", id: c.id }}>{c.adjective}</EntityLink>, from <YearLink year={e.year} />
              {next ? (
                <>
                  {" "}
                  until <YearLink year={next.year} />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {S.children.length ? (
        <>
          <h3>Daughter scripts</h3>
          <ul>
            {S.children.map((c) => (
              <li key={c}>
                <ScriptLink id={c} h={h} /> <span class="enc-type">{h.scripts[c].born}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

export function ScriptsPane({ sub }: { sub?: number }) {
  const h = useStore(app, (s) => s.history);
  if (!h) return <p class="pane-empty">Letters have not yet been invented.</p>;
  void rootOf;
  return sub !== undefined && h.scripts[sub] ? <ScriptPage id={sub} /> : <Families />;
}
