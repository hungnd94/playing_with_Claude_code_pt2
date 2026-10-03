/**
 * The hover card for native names: the word in its own script (when its
 * people could write), IPA, literal gloss, morpheme breakdown, etymology.
 * One global card, positioned next to the hovered name.
 */
import type { WName } from "../../../history/types";
import { app } from "../../state/app";
import { createStore, useStore } from "../../state/store";
import { scriptForLanguage, wordSVG } from "../../engine/scripts";

const card = createStore<{ name: WName | null; rect: { x: number; y: number; w: number; h: number } | null }>({ name: null, rect: null });
let hideT = 0;

export function showNameCard(name: WName, r: DOMRect): void {
  clearTimeout(hideT);
  card.set({ name, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
}

export function hideNameCard(): void {
  clearTimeout(hideT);
  hideT = window.setTimeout(() => card.set({ name: null, rect: null }), 80);
}

export function NameCardHost() {
  const { name, rect } = useStore(card, (s) => s);
  const history = useStore(app, (s) => s.history);
  const year = useStore(app, (s) => s.year);
  if (!name || !rect) return null;
  const L = history?.languages[name.lang];
  const sid = history && name.phonemes?.length ? scriptForLanguage(history, name.lang, year) : -1;
  const svg = sid >= 0 && history && name.phonemes ? wordSVG(history, sid, name.phonemes, 34) : "";
  const W = 300;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = rect.x + rect.w / 2 - W / 2;
  x = Math.max(8, Math.min(vw - W - 8, x));
  const below = rect.y < vh * 0.45;
  const style = below ? { left: `${x}px`, top: `${rect.y + rect.h + 8}px` } : { left: `${x}px`, bottom: `${vh - rect.y + 8}px` };
  return (
    <div class="name-card" style={{ ...style, width: `${W}px` }} role="tooltip">
      {svg ? (
        <div class="name-card-script" aria-hidden="true">
          <span dangerouslySetInnerHTML={{ __html: svg }} />
          <span class="name-card-script-name">{history?.scripts[sid]?.name}</span>
        </div>
      ) : null}
      <div class="name-card-roman">{name.roman}</div>
      {name.ipa ? <div class="name-card-ipa">/{name.ipa}/</div> : null}
      {name.gloss ? <div class="name-card-gloss">“{name.gloss}”</div> : null}
      {name.parts && name.parts.length > 1 ? (
        <div class="name-card-parts">
          {name.parts.map((p, i) => (
            <span key={i}>
              {i ? <span class="plus"> + </span> : null}
              <em>{p.roman}</em>
              {p.gloss ? <span class="pg"> ‘{p.gloss}’</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      {name.etym ? <div class="name-card-etym">{name.etym}</div> : null}
      {L ? <div class="name-card-lang">{L.name}</div> : null}
    </div>
  );
}
