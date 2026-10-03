/**
 * Block-level rich content: paragraphs (rubricated drop caps), headings with
 * fleurons, interlinear utterances, quotations, lists, tables and figures.
 */
import type { Block, Rich } from "../../../narrative/types";
import type { Utterance } from "../../../history/types";
import { app } from "../../state/app";
import { useStore } from "../../state/store";
import { RichText } from "./Rich";
import { Figure } from "./figures/Figure";
import { scriptForLanguage, textSVG } from "../../engine/scripts";

export function Fleuron() {
  return (
    <div class="fleuron" aria-hidden="true">
      <svg viewBox="0 0 120 14" width="120" height="14">
        <path d="M2 7h44M74 7h44" stroke="currentColor" stroke-width=".7" />
        <path d="M60 1.5c2.2 2.6 2.2 8.4 0 11-2.2-2.6-2.2-8.4 0-11z" fill="currentColor" />
        <path d="M60 7c-3.6-3.6-8.4-3.4-11 0 2.6 3.4 7.4 3.6 11 0zM60 7c3.6-3.6 8.4-3.4 11 0-2.6 3.4-7.4 3.6-11 0z" fill="none" stroke="currentColor" stroke-width=".8" />
        <circle cx="47" cy="7" r="1.1" fill="currentColor" />
        <circle cx="73" cy="7" r="1.1" fill="currentColor" />
      </svg>
    </div>
  );
}

export function Interlinear({ u, attribution }: { u: Utterance; attribution?: Rich }) {
  const history = useStore(app, (s) => s.history);
  const year = useStore(app, (s) => s.year);
  const words = u.text.split(/\s+/).filter(Boolean);
  const gl = u.gloss.split(/\s+/).filter(Boolean);
  const aligned = words.length === gl.length;
  const sid = history && u.words?.length ? scriptForLanguage(history, u.lang, year) : -1;
  const svg = sid >= 0 && history && u.words ? textSVG(history, sid, u.words, 26) : "";
  const lang = history?.languages[u.lang]?.name;
  return (
    <figure class="utterance">
      {svg ? <div class="utterance-script" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      {aligned ? (
        <div class="igt" role="table" aria-label="Interlinear gloss">
          {words.map((w, i) => (
            <span class="igt-col" role="row" key={i}>
              <span class="igt-w" role="cell">
                {w}
              </span>
              <span class="igt-g" role="cell">
                {smallCapsGloss(gl[i])}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <div class="igt-lines">
          <div class="igt-w">{u.text}</div>
          <div class="igt-g">{smallCapsGloss(u.gloss)}</div>
        </div>
      )}
      <figcaption>
        <span class="utterance-tr">“{u.translation}”</span>
        {attribution || lang ? (
          <span class="utterance-attr">
            {" — "}
            {attribution ? <RichText content={attribution} /> : null}
            {lang ? <span class="utterance-lang">{attribution ? ", " : ""}{lang}</span> : null}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Leipzig gloss: grammatical abbreviations (all-caps morphemes) in small caps. */
function smallCapsGloss(g: string) {
  const parts = g.split(/([-.=])/);
  return parts.map((p, i) => (/^[A-Z0-9]{1,6}$/.test(p) && /[A-Z]/.test(p) ? <abbr key={i} class="gl-abbr">{p.toLowerCase()}</abbr> : <span key={i}>{p}</span>));
}

export function BlockView({ b, index }: { b: Block; index: number }) {
  switch (b.t) {
    case "p":
      return (
        <p class={b.dropCap ? "lead" : undefined}>
          <RichText content={b.content} />
        </p>
      );
    case "h":
      return b.level === 2 ? (
        <>
          {index > 0 ? <Fleuron /> : null}
          <h2>{b.text}</h2>
        </>
      ) : (
        <h3>{b.text}</h3>
      );
    case "utterance":
      return <Interlinear u={b.utterance} attribution={b.attribution} />;
    case "quote":
      return (
        <blockquote>
          {b.content.map((r, i) => (
            <p key={i}>
              <RichText content={r} />
            </p>
          ))}
          {b.attribution ? (
            <footer>
              — <RichText content={b.attribution} />
            </footer>
          ) : null}
        </blockquote>
      );
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>
          <RichText content={it} />
        </li>
      ));
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div class="table-wrap">
          <table>
            {b.caption ? <caption>{b.caption}</caption> : null}
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <RichText content={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "figure":
      return <Figure figure={b.figure} caption={b.caption} />;
    default:
      return null;
  }
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} index={i} />
      ))}
    </>
  );
}
