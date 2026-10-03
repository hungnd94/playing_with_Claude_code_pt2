/**
 * Tongues: the language families as trees, and per-language pages with IPA
 * charts, sound laws, a grammar sketch, sample vocabulary, a comparative
 * cognate table across the family, place-name etymologies and the script.
 */
import { useMemo } from "preact/hooks";
import type { History, Id, Language as HLanguage } from "../../../history/types";
import type { Language as LLanguage } from "../../../lang/types";
import { describeLanguage } from "../../../lang/language";
import { romanizeWord, ipaWord } from "../../../lang/orthography";
import { CONCEPT_BY_ID } from "../../../lang/concepts";
import { app, navigate } from "../../state/app";
import { useStore } from "../../state/store";
import { EntityLink, NativeName, YearLink, activate } from "../rich/Rich";
import { TreeView, type TNode } from "../rich/figures/Tree";
import { PhonemeFigure } from "../rich/figures/Phonemes";
import { CognateTable, langData } from "../rich/figures/Cognates";
import { Fleuron } from "../rich/Blocks";
import { chartSVG, scriptForLanguage, wordSVG } from "../../engine/scripts";
import { nameAt, popAt } from "../../engine/query";

const SAMPLE = ["water", "fire", "stone", "sun", "moon", "star", "river", "mountain", "sea", "tree", "earth", "sky", "mother", "father", "king", "god", "horse", "house", "one", "two", "three", "blood", "eat", "see"];
const COGNATE = ["water", "fire", "stone", "sun", "mother", "king", "river", "two", "horse", "god"];

function familyTree(h: History, root: Id): TNode | null {
  const L = h.languages[root];
  if (!L) return null;
  const walk = (id: Id, d: number): TNode => {
    const x = h.languages[id];
    return {
      ref: { kind: "language", id },
      label: x.name,
      sub: `${x.born}–${x.ended >= 0 ? x.ended : ""}`,
      dead: x.ended >= 0 && !x.children.length,
      children: d < 14 ? x.children.map((c) => walk(c, d + 1)) : [],
    };
  };
  return walk(root, 0);
}

/** Open a language inside the Tongues tab. */
export function openTongue(id: Id): void {
  navigate({ tab: "tongues", sub: id, ref: { kind: "language", id } });
}

function TongueLink({ id, h }: { id: Id; h: History }) {
  const go = (): void => openTongue(id);
  return (
    <a class="lk" role="link" tabIndex={0} onClick={go} onKeyDown={(e) => activate(e, go)}>
      {h.languages[id]?.name}
    </a>
  );
}

function Families() {
  const h = useStore(app, (s) => s.history)!;
  const fams = useMemo(() => {
    const roots = h.languages.filter((l) => l.parent < 0);
    return roots
      .map((r) => {
        const members = h.languages.filter((l) => l.family === r.id);
        return { root: r, members, living: members.filter((l) => l.ended < 0) };
      })
      .sort((a, b) => b.members.length - a.members.length);
  }, [h]);
  const living = h.languages.filter((l) => l.ended < 0).length;
  return (
    <div class="article tongues">
      <header class="art-head">
        <div class="art-kicker">Tongues</div>
        <h1 class="art-title">The Tongues of the World</h1>
        <p class="art-sub">
          {h.languages.length} tongues in {fams.length} families have been spoken; {living} are spoken still. Each descends from its parent by regular sound laws, so kindred words answer one another across the family.
        </p>
      </header>
      {fams.map((f) => {
        const t = familyTree(h, f.root.id);
        return (
          <section key={f.root.id} class="family">
            <h2>
              The {f.root.name.replace(/^(Old|Proto-|Middle|Later) ?/, "")} family
              <span class="enc-count num"> {f.members.length} tongues · {f.living.length} living</span>
            </h2>
            <p class="family-living">
              Living:{" "}
              {f.living.length
                ? f.living.map((l, i) => (
                    <span key={l.id}>
                      {i ? ", " : ""}
                      <TongueLink id={l.id} h={h} />
                    </span>
                  ))
                : "none — the family is extinct."}
            </p>
            {t && t.children.length ? <TreeView root={t} /> : null}
          </section>
        );
      })}
    </div>
  );
}

function soundLaws(d: LLanguage): { step: LLanguage["lineage"][number]; i: number }[] {
  return d.lineage.map((step, i) => ({ step, i }));
}

function LanguagePage({ id }: { id: Id }) {
  const h = useStore(app, (s) => s.history)!;
  const year = useStore(app, (s) => s.year);
  useStore(app, (s) => s.dark);
  const L: HLanguage | undefined = h.languages[id];
  const d = L ? langData(h, id) : null;
  if (!L || !d) return <p class="pane-empty">No record of this tongue.</p>;
  const C = h.cultures[L.culture];
  const fam = h.languages[L.family];
  const par = L.parent >= 0 ? h.languages[L.parent] : null;
  const desc = (() => {
    try {
      return describeLanguage(d);
    } catch {
      return [];
    }
  })();
  const vocab = SAMPLE.filter((c) => CONCEPT_BY_ID[c] && d.lexicon[c]).map((c) => {
    const f = d.lexicon[c].form;
    let roman = "", ipa = "";
    try {
      roman = romanizeWord(d.orthography, f);
      ipa = ipaWord(f, d.phonology.stress, d.phonology);
    } catch {
      roman = f.join("");
    }
    return { c, en: CONCEPT_BY_ID[c].en, roman, ipa, form: f, origin: d.lexicon[c].origin };
  });
  const kin = [id, ...h.languages.filter((l) => l.family === L.family && l.id !== id && (l.ended < 0 || l.id === L.parent)).map((l) => l.id)].slice(0, 6);
  const sid = scriptForLanguage(h, id, L.ended >= 0 ? L.ended - 1 : year);
  const places = h.settlements
    .map((s) => ({ s, n: s.names.find((r) => r.name.lang === id)?.name }))
    .filter((x) => x.n && (x.n.gloss || x.n.etym))
    .sort((a, b) => Math.max(...b.s.pop, 0) - Math.max(...a.s.pop, 0))
    .slice(0, 14);
  const features = h.featureNames.flatMap((f) => f.names.filter((n) => n.name.lang === id).map((n) => ({ f: f.feature, n: n.name }))).slice(0, 8);
  const laws = soundLaws(d);
  const last = laws[laws.length - 1];
  const tree = familyTree(h, L.family);
  return (
    <article class="article tongue">
      <header class="art-head">
        <div class="art-kicker">
          <a class="lk" role="link" tabIndex={0} onClick={() => navigate({ tab: "tongues" })} onKeyDown={(e) => activate(e, () => navigate({ tab: "tongues" }))}>
            Tongues
          </a>{" "}
          · {fam && fam.id !== id ? `${fam.name.replace(/^(Old|Proto-|Middle|Later) ?/, "")} family` : "a family of its own"}
        </div>
        <h1 class="art-title">{L.name}</h1>
        <div class="art-native">
          <NativeName name={L.endonym} />
          {L.endonym.ipa ? <span class="art-ipa">/{L.endonym.ipa}/</span> : null}
          {L.endonym.gloss ? <span class="art-gloss">“{L.endonym.gloss}”</span> : null}
        </div>
        <p class="art-sub">
          Spoken by the {C ? <EntityLink ref_={{ kind: "culture", id: C.id }}>{C.adjective}</EntityLink> : "?"} from <YearLink year={L.born} />
          {L.ended >= 0 ? (
            <>
              {" "}
              to <YearLink year={L.ended} />
            </>
          ) : (
            " to the present"
          )}
          {par ? (
            <>
              ; {L.origin === "stage" ? "a later stage of" : "a daughter of"} <TongueLink id={par.id} h={h} />
            </>
          ) : (
            "; the root of its family"
          )}
          .{" "}
          <EntityLink ref_={{ kind: "language", id }} tab="article">
            Read the article
          </EntityLink>
        </p>
      </header>
      {desc.length ? (
        <section class="grammar">
          <h2>In brief</h2>
          <ul class="brief">
            {desc.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <Fleuron />
      <h2>Sounds</h2>
      <PhonemeFigure lang={d} />
      {laws.length ? (
        <>
          <Fleuron />
          <h2>Sound laws</h2>
          {last ? (
            <p>
              {last.step.toName} arose from {h.languages.find((x) => (x.data as LLanguage | undefined)?.id === last.step.from)?.name ?? "its ancestor"} about <YearLink year={last.step.year} /> through these regular changes:
            </p>
          ) : null}
          <ol class="laws">
            {(last ? last.step.changes : []).map((c, i) => (
              <li key={i}>
                <span class="law-notation ipa">{c.notation}</span>
                <span class="law-name">{c.name}.</span> <span class="law-desc">{c.description}</span>
              </li>
            ))}
          </ol>
          {laws.length > 1 ? (
            <details class="lineage">
              <summary>The whole descent from the root ({laws.length} steps)</summary>
              <ol>
                {laws.map(({ step, i }) => (
                  <li key={i}>
                    <strong>{step.toName}</strong> <span class="num">({step.year})</span>: {step.changes.map((c) => c.notation).join(" · ")}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : null}
      <Fleuron />
      <h2>Words</h2>
      <div class="table-wrap">
        <table class="vocab">
          <thead>
            <tr>
              <th scope="col">Meaning</th>
              <th scope="col">Word</th>
              <th scope="col">Sound</th>
              {sid >= 0 ? <th scope="col">Written</th> : null}
              <th scope="col">Origin</th>
            </tr>
          </thead>
          <tbody>
            {vocab.map((v) => (
              <tr key={v.c}>
                <td>‘{v.en}’</td>
                <td>
                  <em class="vocab-w">{v.roman}</em>
                </td>
                <td class="ipa">/{v.ipa}/</td>
                {sid >= 0 ? <td class="vocab-script" dangerouslySetInnerHTML={{ __html: wordSVG(h, sid, v.form, 22) }} /> : null}
                <td class="vocab-origin">{originText(v.origin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {kin.length > 1 ? (
        <>
          <Fleuron />
          <h2>Kindred tongues</h2>
          <CognateTable h={h} languages={kin} concepts={COGNATE} />
        </>
      ) : null}
      {places.length || features.length ? (
        <>
          <Fleuron />
          <h2>Names on the land</h2>
          <ul class="etyms">
            {places.map(({ s, n }) => (
              <li key={s.id}>
                <EntityLink ref_={{ kind: "settlement", id: s.id }}>
                  <NativeName name={n!} plain />
                </EntityLink>
                {n!.gloss ? <span class="ety-gloss"> “{n!.gloss}”</span> : null}
                {n!.etym ? <span class="ety-etym"> — {n!.etym}</span> : null}
                <span class="ety-now">{nameAt(s.names, year).roman !== n!.roman ? ` (now ${nameAt(s.names, year).roman})` : ""}</span>
              </li>
            ))}
            {features.map(({ f, n }, i) => (
              <li key={`f${i}`}>
                <EntityLink ref_={{ kind: "feature", id: f }}>
                  <NativeName name={n} plain />
                </EntityLink>
                {n.gloss ? <span class="ety-gloss"> “{n.gloss}”</span> : null}
                {n.etym ? <span class="ety-etym"> — {n.etym}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {sid >= 0 ? (
        <>
          <Fleuron />
          <h2>Writing</h2>
          <p>
            Written in the <EntityLink ref_={{ kind: "script", id: sid }}>{h.scripts[sid].name}</EntityLink>
            {h.scripts[sid].kind ? `, ${h.scripts[sid].kind === "abugida" ? "an" : "a"} ${h.scripts[sid].kind}` : ""}.
          </p>
          <div class="script-word">
            <span class="script-ink" dangerouslySetInnerHTML={{ __html: L.endonym.phonemes ? wordSVG(h, sid, L.endonym.phonemes, 54) : "" }} />
            <span class="script-word-roman">{L.endonym.roman}</span>
          </div>
          <div class="script-chart" dangerouslySetInnerHTML={{ __html: chartSVG(h, sid, 30) }} />
        </>
      ) : (
        <p class="pane-hint">The {C?.adjective ?? ""} did not write this tongue.</p>
      )}
      {tree && tree.children.length ? (
        <>
          <Fleuron />
          <h2>The family</h2>
          <TreeView root={tree} highlight={{ kind: "language", id }} />
        </>
      ) : null}
      <PopNote h={h} id={id} />
    </article>
  );
}

function PopNote({ h, id }: { h: History; id: Id }) {
  const L = h.languages[id];
  const y = L.ended >= 0 ? L.ended - 1 : h.endYear;
  let n = 0;
  for (const s of h.settlements) {
    const n0 = s.names.length ? nameAt(s.names, y) : null;
    if (n0 && n0.lang === id) n += popAt(s, y, h.sampleStep);
  }
  if (n <= 0) return null;
  return (
    <p class="pane-hint">
      Towns bearing names in this tongue held some {Math.round(n).toLocaleString("en-GB")} people in {y}.
    </p>
  );
}

function originText(o: LLanguage["lexicon"][string]["origin"]): string {
  switch (o.kind) {
    case "root":
      return "ancestral root";
    case "inherited":
      return "inherited";
    case "compound":
      return `compound: ${o.parts.map((p) => CONCEPT_BY_ID[p]?.en ?? p).join(" + ")}`;
    case "derived":
      return `from ‘${CONCEPT_BY_ID[o.base]?.en ?? o.base}’`;
    case "coined":
      return "new coinage";
    case "shift":
      return `once meant ‘${CONCEPT_BY_ID[o.from]?.en ?? o.from}’`;
    case "borrowed":
      return `loan from ${o.langName}`;
    default:
      return "";
  }
}

export function TonguesPane({ sub }: { sub?: number }) {
  const h = useStore(app, (s) => s.history);
  if (!h) return <p class="pane-empty">The tongues are still dividing.</p>;
  return sub !== undefined && h.languages[sub] ? <LanguagePage id={sub} /> : <Families />;
}
