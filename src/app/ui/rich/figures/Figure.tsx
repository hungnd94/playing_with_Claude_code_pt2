/** Figure dispatcher for article blocks. */
import type { Figure as Fig, Rich } from "../../../../narrative/types";
import type { Emblem } from "../../../../history/types";
import { app } from "../../../state/app";
import { useStore } from "../../../state/store";
import { RichText } from "../Rich";
import { ChartFigure } from "./Chart";
import { MiniMap } from "./MiniMap";
import { TreeFigure } from "./Tree";
import { PhonemeFigure } from "./Phonemes";
import { CognateTable, langData } from "./Cognates";
import { emblemSVG } from "../../../engine/emblem";
import { chartSVG, wordSVG } from "../../../engine/scripts";

export function EmblemImg({ emblem, size, class: cls, title }: { emblem: Emblem; size: number; class?: string; title?: string }) {
  const svg = emblemSVG(emblem, size);
  if (!svg) return null;
  return <span class={`emblem emblem-${emblem.kind} ${cls ?? ""}`} role="img" aria-label={title ?? emblem.blazon} title={title ?? emblem.blazon} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function ScriptFigure({ fig }: { fig: Extract<Fig, { kind: "script" }> }) {
  const h = useStore(app, (s) => s.history);
  useStore(app, (s) => s.dark);
  if (!h || !h.scripts[fig.script]) return null;
  if (fig.word && fig.word.length) {
    const svg = wordSVG(h, fig.script, fig.word, 54);
    return svg ? (
      <div class="script-word">
        <span class="script-ink" dangerouslySetInnerHTML={{ __html: svg }} />
        {fig.caption ? <span class="script-word-roman">{fig.caption}</span> : null}
      </div>
    ) : null;
  }
  const svg = chartSVG(h, fig.script, 34);
  return svg ? <div class="script-chart" dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

function Inner({ figure }: { figure: Fig }) {
  const h = useStore(app, (s) => s.history);
  switch (figure.kind) {
    case "emblem":
      return (
        <div class={`fig-emblem ${figure.size === "small" ? "is-small" : ""}`}>
          <EmblemImg emblem={figure.emblem} size={figure.size === "small" ? 96 : 200} />
          {figure.emblem.blazon ? <p class="blazon">{figure.emblem.blazon}</p> : null}
        </div>
      );
    case "chart":
      return <ChartFigure series={figure.series} />;
    case "map":
      return <MiniMap focus={figure.focus} year={figure.year} />;
    case "tree":
      return <TreeFigure fig={figure} />;
    case "script":
      return <ScriptFigure fig={figure} />;
    case "phonemes":
      return h ? <PhonemeFigure lang={langData(h, figure.language)} /> : null;
    case "cognates":
      return h ? <CognateTable h={h} languages={figure.languages} concepts={figure.concepts} /> : null;
    default:
      return null;
  }
}

export function Figure({ figure, caption }: { figure: Fig; caption?: Rich }) {
  return (
    <figure class={`fig fig-${figure.kind}`}>
      <Inner figure={figure} />
      {caption && caption.length ? (
        <figcaption>
          <RichText content={caption} />
        </figcaption>
      ) : null}
    </figure>
  );
}
