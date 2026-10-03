/**
 * Short descriptions of a globe cell for tooltips and the place page header.
 */
import { BIOME_NAMES, type PhysicalWorld } from "../../world/types";
import type { History, Id } from "../../history/types";
import { polityTitle as hqPolityTitle } from "../../history/query";
import type { OverlayEngine, OverlayLayer } from "./overlay";
import { entryAt, nameAt, popAt, formatPop } from "./query";

export function polityTitleAt(h: History, id: Id, year: number): string {
  const P = h.polities[id];
  if (!P) return "?";
  const y = Math.min(Math.max(year, P.founded), P.ended >= 0 ? Math.max(P.founded, P.ended - 1) : year);
  try {
    const t = hqPolityTitle(h, id, y);
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch {
    return nameAt(P.names, y).roman;
  }
}

export function featureNameAt(h: History | null, feature: Id, year: number): string | null {
  if (!h) return null;
  const fn = h.featureNames.find((f) => f.feature === feature);
  if (!fn) return null;
  for (const n of fn.names) if (n.year <= year) return n.name.roman;
  return null;
}

export function landscapeOf(world: PhysicalWorld, h: History | null, cell: number, year: number): string {
  const b = BIOME_NAMES[world.biome[cell]] ?? "land";
  const parts: string[] = [b.charAt(0).toUpperCase() + b.slice(1)];
  const region = world.regionOf[cell];
  const lm = world.isLand[cell] ? world.landmassOf[cell] : world.waterBodyOf[cell];
  const rn = region >= 0 ? featureNameAt(h, region, year) : null;
  const ln = lm >= 0 ? featureNameAt(h, lm, year) : null;
  if (rn) parts.push(rn);
  if (ln) parts.push(ln);
  const elev = world.elevation[cell];
  if (world.isLand[cell] && elev > 1.2) parts.push(`${Math.round(elev * 1000).toLocaleString("en-GB")} m`);
  return parts.join(" · ");
}

/** Tooltip lines for a hovered cell in a layer at a year. */
export function describeCell(world: PhysicalWorld, h: History | null, engine: OverlayEngine | null, layer: OverlayLayer, cell: number, year: number): { title: string; sub: string } {
  const land = !!world.isLand[cell] && world.lakeId[cell] < 0;
  const scape = landscapeOf(world, h, cell, year);
  if (!h || !engine || !land) return { title: scape.split(" · ")[1] ?? scape.split(" · ")[0], sub: scape };
  if (layer === "realms" || layer === "terrain" || layer === "population") {
    const o = engine.ownerAt(year)?.[cell] ?? -1;
    if (o >= 0 && h.polities[o]) {
      const P = h.polities[o];
      const ov = entryAt(P.overlords, year);
      const sub = ov && ov.overlord >= 0 && ov.year <= year && h.polities[ov.overlord] ? `vassal of ${nameAt(h.polities[ov.overlord].names, year).roman} · ${scape}` : scape;
      if (layer === "population") {
        const near = nearestTown(world, h, cell, year);
        return { title: near ?? polityTitleAt(h, o, year), sub: `${polityTitleAt(h, o, year)} · ${scape}` };
      }
      return { title: polityTitleAt(h, o, year), sub };
    }
    return { title: "Unclaimed land", sub: scape };
  }
  if (layer === "peoples") {
    const c = engine.cultureAt(year)?.[cell] ?? -1;
    const C = h.cultures[c];
    return C ? { title: `The ${C.adjective}`, sub: `${C.name.roman}${C.name.gloss ? ` “${C.name.gloss}”` : ""} · ${scape}` } : { title: "Unpeopled", sub: scape };
  }
  if (layer === "tongues") {
    const c = engine.cultureAt(year)?.[cell] ?? -1;
    const C = h.cultures[c];
    const l = C ? (entryAt(C.languages, year)?.lang ?? -1) : -1;
    const L = h.languages[l];
    if (!L) return { title: "No tongue recorded", sub: scape };
    const fam = h.languages[L.family];
    return { title: L.name, sub: `${fam && fam.id !== L.id ? `${fam.name} family · ` : ""}${scape}` };
  }
  if (layer === "faiths") {
    const r = engine.religionAt(year)?.[cell] ?? -1;
    const R = h.religions[r];
    return R ? { title: capFirst(R.english), sub: `${R.name.roman} · ${scape}` } : { title: "No faith recorded", sub: scape };
  }
  return { title: scape, sub: "" };
}

function nearestTown(world: PhysicalWorld, h: History, cell: number, year: number): string | null {
  const { adjStart, adj } = world.mesh;
  const near = new Set<number>([cell]);
  for (let k = adjStart[cell]; k < adjStart[cell + 1]; k++) near.add(adj[k]);
  let best: string | null = null, bp = 0;
  for (const s of h.settlements) {
    if (!near.has(s.cell) || year < s.founded || (s.ended >= 0 && year >= s.ended)) continue;
    const p = popAt(s, year, h.sampleStep);
    if (p > bp) {
      bp = p;
      best = `${nameAt(s.names, year).roman}, ${formatPop(p)}`;
    }
  }
  return best;
}

export function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
