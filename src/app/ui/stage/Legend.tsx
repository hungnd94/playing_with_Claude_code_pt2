/**
 * Map key for the current layer at the current year: the largest realms,
 * peoples, tongues or faiths with their colours (each a link).
 */
import { useMemo } from "preact/hooks";
import { app, openRef } from "../../state/app";
import { useStore } from "../../state/store";
import { stageController, pingRef } from "./bus";
import { familyColor, rgbCss } from "../../engine/overlay";
import { entryAt, formatPop, nameAt, seriesAt } from "../../engine/query";
import { polityTitleAt, capFirst } from "../../engine/describe";
import type { Ref, EntityKind } from "../../../narrative/types";
import type { RGB } from "../../../history/types";

interface Row {
  ref: Ref;
  label: string;
  color: string;
  share: number;
}

export function Legend() {
  const layer = useStore(app, (s) => s.layer);
  const history = useStore(app, (s) => s.history);
  const key = useStore(app, (s) => (s.history ? Math.floor(s.year / s.history.timeline.step) : -1));
  const year = app.get().year;
  const rows = useMemo(() => {
    const ctl = stageController();
    const e = ctl?.overlayEngine;
    const h = history;
    if (!h || !e) return [] as Row[];
    const count = (arr: Int32Array | null): Map<number, number> => {
      const m = new Map<number, number>();
      if (!arr) return m;
      for (let c = 0; c < arr.length; c++) if (arr[c] >= 0) m.set(arr[c], (m.get(arr[c]) ?? 0) + 1);
      return m;
    };
    let m: Map<number, number>;
    let kind: EntityKind;
    let colorOf: (id: number) => RGB;
    let labelOf: (id: number) => string;
    if (layer === "realms") {
      const own = e.ownerAt(year);
      m = count(own);
      // Fold vassals into their overlords for the key.
      const top = new Map<number, number>();
      for (const [p, n] of m) {
        const ov = entryAt(h.polities[p]?.overlords ?? [], year);
        const q = ov && ov.overlord >= 0 && ov.year <= year ? ov.overlord : p;
        top.set(q, (top.get(q) ?? 0) + n);
      }
      m = top;
      kind = "polity";
      colorOf = (id) => h.polities[id]?.color ?? [128, 128, 128];
      labelOf = (id) => polityTitleAt(h, id, year);
    } else if (layer === "peoples") {
      m = count(e.cultureAt(year));
      kind = "culture";
      colorOf = (id) => h.cultures[id]?.color ?? [128, 128, 128];
      labelOf = (id) => `The ${h.cultures[id]?.adjective ?? "?"}`;
    } else if (layer === "faiths") {
      m = count(e.religionAt(year));
      kind = "religion";
      colorOf = (id) => h.religions[id]?.color ?? [128, 128, 128];
      labelOf = (id) => capFirst(h.religions[id]?.english ?? "?");
    } else if (layer === "tongues") {
      const cul = count(e.cultureAt(year));
      m = new Map();
      for (const [c, n] of cul) {
        const l = entryAt(h.cultures[c]?.languages ?? [], year)?.lang ?? -1;
        const fam = h.languages[l]?.family ?? -1;
        if (fam >= 0) m.set(fam, (m.get(fam) ?? 0) + n);
      }
      kind = "language";
      const fams = [...new Set(h.languages.map((l) => l.family))].sort((a, b) => a - b);
      colorOf = (id) => familyColor(fams.indexOf(id), 0);
      labelOf = (id) => `${(h.languages[id]?.name ?? "?").replace(/^(Old|Proto-|Middle|Later) ?/, "")} family`;
    } else return [] as Row[];
    let total = 0;
    for (const n of m.values()) total += n;
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 6)
      .map(([id, n]) => ({ ref: { kind, id }, label: labelOf(id), color: rgbCss(colorOf(id)), share: n / Math.max(1, total) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, history, key]);

  if (!history) return null;
  const head = layer === "terrain" ? "The land" : layer === "population" ? "Where people lived" : layer === "realms" ? "Great realms" : layer === "peoples" ? "Peoples" : layer === "tongues" ? "Tongue families" : "Faiths";
  return (
    <aside class="legend" aria-label="Map key">
      <div class="legend-head">
        {head} <span class="legend-year num">· {year}</span>
      </div>
      {layer === "population" ? (
        <div class="legend-pop">
          <div class="legend-ramp" aria-hidden="true" />
          <div class="legend-ramp-labels">
            <span>sparse</span>
            <span>teeming</span>
          </div>
          <div class="legend-stat">
            World population ≈ <span class="num">{formatPop(seriesAt(history.worldStats.pop, 0, year, history.sampleStep))}</span>
          </div>
        </div>
      ) : layer === "terrain" ? (
        <div class="legend-stat">
          <span class="num">{seriesAt(history.worldStats.settlements, 0, year, history.sampleStep)}</span> towns and villages · <span class="num">{seriesAt(history.worldStats.polities, 0, year, history.sampleStep)}</span> realms
        </div>
      ) : (
        <ul class="legend-rows">
          {rows.map((r) => (
            <li key={`${r.ref.kind}${r.ref.id}`}>
              <button class="legend-row" onClick={() => openRef(r.ref)} onMouseEnter={() => pingRef(r.ref)} onMouseLeave={() => pingRef(null)} onFocus={() => pingRef(r.ref)} onBlur={() => pingRef(null)}>
                <span class="legend-sw" style={{ background: r.color }} aria-hidden="true" />
                <span class="legend-label">{r.label}</span>
                <span class="legend-share num">{Math.round(r.share * 100)}%</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export { nameAt };
