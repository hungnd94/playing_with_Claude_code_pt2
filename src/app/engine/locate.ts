/**
 * Where on the globe is an entity at a year? Used to fly the globe to an
 * opened article, to ping a hovered link, and to frame mini maps.
 */
import type { PhysicalWorld } from "../../world/types";
import type { History, Id } from "../../history/types";
import type { Ref } from "../../narrative/types";
import { cellsCentroid, cellXYZ, xyzLatLon, zoomForRadius, type XYZ } from "./geo";
import { capitalAt, entryAt, ownerAt } from "./query";
import type { OverlayEngine } from "./overlay";

export interface Target {
  lat: number;
  lon: number;
  zoom: number;
  /** Cells to highlight (territory, area, course), if any. */
  cells?: number[];
  /** Point of interest (settlement, battle). */
  point?: XYZ;
  /** Overlay group to highlight when the matching layer is shown. */
  group?: { layer: "realms" | "peoples" | "faiths"; id: number };
  /** Polyline (trade route, river), unit vectors. */
  line?: XYZ[];
}

function cellsWhere(arr: Int32Array | null, id: Id): number[] {
  const out: number[] = [];
  if (!arr) return out;
  for (let c = 0; c < arr.length; c++) if (arr[c] === id) out.push(c);
  return out;
}

function pointTarget(world: PhysicalWorld, xyz: XYZ, zoom = 3.2): Target {
  const [lat, lon] = xyzLatLon(xyz);
  return { lat, lon, zoom, point: xyz };
}

function areaTarget(world: PhysicalWorld, cells: number[], extra: Partial<Target> = {}): Target | null {
  const c = cellsCentroid(world, cells);
  if (!c) return null;
  const [lat, lon] = xyzLatLon(c.xyz);
  return { lat, lon, zoom: zoomForRadius(c.radiusDeg), cells, ...extra };
}

function settlementXYZ(h: History, world: PhysicalWorld, id: Id): XYZ | null {
  const s = h.settlements[id];
  if (!s) return null;
  return s.pos ? [s.pos[0], s.pos[1], s.pos[2]] : cellXYZ(world, s.cell);
}

/** Year at which an entity is best shown if `year` falls outside its life. */
function clampLife(year: number, from: number, to: number): number {
  if (year < from) return from;
  if (to >= 0 && year >= to) return Math.max(from, to - 1);
  return year;
}

export function locate(world: PhysicalWorld, h: History | null, engine: OverlayEngine | null, ref: Ref, year: number): Target | null {
  if (ref.kind === "world") return { lat: 15, lon: 0, zoom: 1 };
  if (!h) return null;
  switch (ref.kind) {
    case "settlement": {
      const p = settlementXYZ(h, world, ref.id);
      return p ? pointTarget(world, p, 3.4) : null;
    }
    case "polity": {
      const P = h.polities[ref.id];
      if (!P) return null;
      const y = clampLife(year, P.founded, P.ended);
      const cells = cellsWhere(engine?.ownerAt(y) ?? null, ref.id);
      if (cells.length) return areaTarget(world, cells, { group: { layer: "realms", id: ref.id + 1 } });
      const cap = capitalAt(P, y);
      const p = cap >= 0 ? settlementXYZ(h, world, cap) : null;
      return p ? pointTarget(world, p, 2.6) : null;
    }
    case "culture": {
      const C = h.cultures[ref.id];
      if (!C) return null;
      const y = clampLife(year, C.born, C.ended);
      const cells = cellsWhere(engine?.cultureAt(y) ?? null, ref.id);
      if (cells.length) return areaTarget(world, cells, { group: { layer: "peoples", id: ref.id + 1 } });
      return pointTarget(world, cellXYZ(world, C.homeCell), 2.4);
    }
    case "language": {
      const L = h.languages[ref.id];
      if (!L) return null;
      return locate(world, h, engine, { kind: "culture", id: L.culture }, clampLife(year, L.born, L.ended));
    }
    case "script": {
      const S = h.scripts[ref.id];
      if (!S) return null;
      if (S.origin >= 0) return locate(world, h, engine, { kind: "settlement", id: S.origin }, year);
      return locate(world, h, engine, { kind: "culture", id: S.culture }, Math.max(year, S.born));
    }
    case "religion": {
      const R = h.religions[ref.id];
      if (!R) return null;
      const y = clampLife(year, R.founded, R.ended);
      const cells = cellsWhere(engine?.religionAt(y) ?? null, ref.id);
      const hc = R.holyCity >= 0 ? settlementXYZ(h, world, R.holyCity) : null;
      if (cells.length) return areaTarget(world, cells, { group: { layer: "faiths", id: ref.id + 1 }, point: hc ?? undefined });
      return hc ? pointTarget(world, hc, 2.6) : null;
    }
    case "deity": {
      const D = h.deities[ref.id];
      if (!D) return null;
      if (D.feature >= 0) return locate(world, h, engine, { kind: "feature", id: D.feature }, year);
      return locate(world, h, engine, { kind: "religion", id: D.religion }, year);
    }
    case "myth": {
      const M = h.myths[ref.id];
      return M ? locate(world, h, engine, { kind: "religion", id: M.religion }, year) : null;
    }
    case "person": {
      const P = h.persons[ref.id];
      if (!P) return null;
      const role = P.roles.find((r) => r.kind === "ruler") ?? P.roles[0];
      if (role && role.polity >= 0 && h.polities[role.polity]) {
        const cap = capitalAt(h.polities[role.polity], role.from);
        if (cap >= 0) return locate(world, h, engine, { kind: "settlement", id: cap }, role.from);
      }
      if (P.deathPlace >= 0) return locate(world, h, engine, { kind: "settlement", id: P.deathPlace }, year);
      return locate(world, h, engine, { kind: "culture", id: P.culture }, P.born);
    }
    case "dynasty": {
      const D = h.dynasties[ref.id];
      if (!D) return null;
      if (D.seat >= 0) return locate(world, h, engine, { kind: "settlement", id: D.seat }, year);
      if (D.polities[0] !== undefined) return locate(world, h, engine, { kind: "polity", id: D.polities[0] }, year);
      return null;
    }
    case "war": {
      const W = h.wars[ref.id];
      if (!W) return null;
      const cells = W.battles.map((b) => h.battles[b]?.cell).filter((c): c is number => c !== undefined && c >= 0);
      if (cells.length) return areaTarget(world, cells.length === 1 ? [cells[0]] : cells, { cells: [] });
      const a = W.attackers[0];
      return a !== undefined ? locate(world, h, engine, { kind: "polity", id: a }, W.start) : null;
    }
    case "battle": {
      const B = h.battles[ref.id];
      return B ? pointTarget(world, cellXYZ(world, B.cell), 3.6) : null;
    }
    case "wonder": {
      const W = h.wonders[ref.id];
      return W && W.settlement >= 0 ? locate(world, h, engine, { kind: "settlement", id: W.settlement }, year) : null;
    }
    case "work": {
      const W = h.works[ref.id];
      if (!W) return null;
      if (W.author >= 0) return locate(world, h, engine, { kind: "person", id: W.author }, W.year);
      return null;
    }
    case "disaster": {
      const D = h.disasters[ref.id];
      if (!D) return null;
      if (D.settlements.length > 1) {
        const cells = D.settlements.map((s) => h.settlements[s]?.cell).filter((c): c is number => c !== undefined);
        return areaTarget(world, cells, { cells: [] });
      }
      return D.cell >= 0 ? pointTarget(world, cellXYZ(world, D.cell), 3) : null;
    }
    case "tradeRoute": {
      const T = h.tradeRoutes[ref.id];
      if (!T || !T.path.length) return null;
      const t = areaTarget(world, T.path, { cells: [] });
      if (t) t.line = T.path.map((c) => cellXYZ(world, c));
      return t;
    }
    case "feature": {
      const F = world.features[ref.id];
      if (!F) return null;
      const cells = Array.from(F.cells);
      if (F.kind === "river") {
        const t = areaTarget(world, cells, { cells });
        if (t) t.line = cells.map((c) => cellXYZ(world, c));
        return t;
      }
      return areaTarget(world, cells.length > 4000 ? cells.filter((_, i) => i % 4 === 0) : cells);
    }
    case "age": {
      return { lat: 15, lon: 0, zoom: 1 };
    }
    case "event": {
      const E = h.events[ref.id];
      return E && E.cell >= 0 ? pointTarget(world, cellXYZ(world, E.cell), 3) : null;
    }
    default:
      return null;
  }
}

/** The settlement a picked cell refers to (on it, else the largest within 1 hop), or -1. */
export function settlementNear(world: PhysicalWorld, h: History, cell: number, year: number): Id {
  const { adjStart, adj } = world.mesh;
  const near = new Set<number>([cell]);
  for (let k = adjStart[cell]; k < adjStart[cell + 1]; k++) near.add(adj[k]);
  let best = -1, bestPop = -1;
  for (const s of h.settlements) {
    if (!near.has(s.cell) || year < s.founded || (s.ended >= 0 && year >= s.ended)) continue;
    const onCell = s.cell === cell ? 1e9 : 0;
    const p = (s.pop[Math.min(s.pop.length - 1, Math.max(0, Math.floor(year / h.sampleStep) - s.popStart))] ?? 0) + onCell;
    if (p > bestPop) {
      bestPop = p;
      best = s.id;
    }
  }
  return best;
}

export { ownerAt, entryAt };
