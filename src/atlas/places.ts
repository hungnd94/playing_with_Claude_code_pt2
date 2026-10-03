/**
 * Settlements, ruins, battles and trade routes visible on a plate at a year.
 * Pure: positions are screen pixels; drawing lives in icons.ts.
 */
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import { chaikin, type Pt } from "./contour";
import { sampleAt, type FieldGrid } from "./field";
import { capitalAt, governmentAt, nameAt, ownerOfSettlement, peakPop, polityAlive, popAt, settlementAlive } from "./hist";
import type { Projection } from "./projection";

export type PlaceTier = "capital" | "city" | "town" | "village" | "ruin";

export interface PlaceMark {
  id: number;
  x: number;
  y: number;
  tier: PlaceTier;
  /** Population at the year (peak population for ruins). */
  pop: number;
  name: string;
  owner: number;
  port: boolean;
  walled: boolean;
  /** ≥ 60 000 people: drawn larger. */
  great: boolean;
  /** Realm whose capital this is (-1 if none); its colour flies on the pennant. */
  capitalOf: number;
  /** Capital of a small realm (on this plate): drawn as a modest seat, not a castle. */
  minor: boolean;
  /** Pennant colour (realm colour), RGB, for capitals. */
  color: [number, number, number] | null;
  holy: boolean;
  /** Icon half-width (px) — labels keep clear of it. */
  r: number;
  /** Importance for ordering (higher first). */
  rank: number;
}

export interface RouteLine {
  id: number;
  kind: "land" | "river" | "sea";
  pts: Pt[];
}

export interface BattleMark {
  id: number;
  x: number;
  y: number;
  year: number;
  name: string;
  kind: string;
  /** Men engaged (both sides), for ordering. */
  size: number;
}

const OUT = { x: 0, y: 0 };

/** Town ranks used by the history ("town" ≥ 5k, "city" ≥ 20k, "great city" ≥ 60k). */
export const TOWN_POP = 5000;
export const CITY_POP = 20000;
export const GREAT_POP = 60000;

export function iconHalfWidth(tier: PlaceTier, great: boolean, k: number, minor = false): number {
  switch (tier) {
    case "capital": return minor ? 4.2 * k : (great ? 8.5 : 7.5) * k;
    case "city": return (great ? 7.5 : 6) * k;
    case "town": return 3.2 * k;
    case "village": return 2.1 * k;
    case "ruin": return 4 * k;
  }
}

export function selectPlaces(world: PhysicalWorld, h: History, year: number, proj: Projection, f: FieldGrid, k: number): PlaceMark[] {
  const rect = proj.rect;
  // Seats of states (kingdoms and up) are drawn as castles; chiefs' and tribes' seats as towns.
  const capitals = new Map<number, number>();
  for (const p of h.polities) if (polityAlive(p, year)) {
    const c = capitalAt(p, year);
    const gov = governmentAt(p, year);
    if (gov === "tribe" || gov === "chiefdom") continue;
    if (c >= 0 && !capitals.has(c)) capitals.set(c, p.id);
  }
  // Sites re-occupied by a living settlement do not show their older ruins.
  const reoccupied = new Set<number>();
  for (const s of h.settlements) if (s.ruinsOf >= 0 && settlementAlive(s, year)) reoccupied.add(s.ruinsOf);
  const marks: PlaceMark[] = [];
  const xyz = world.mesh.xyz;
  const m = 10 * k;
  for (const s of h.settlements) {
    const alive = settlementAlive(s, year);
    const ruined = !alive && s.ended >= 0 && s.ended <= year && s.founded <= year;
    if (!alive && !ruined) continue;
    if (ruined && reoccupied.has(s.id)) continue;
    const [x3, y3, z3] = s.pos ?? [xyz[3 * s.cell], xyz[3 * s.cell + 1], xyz[3 * s.cell + 2]];
    if (!proj.inCap(x3, y3, z3) || !proj.forward(x3, y3, z3, OUT)) continue;
    let x = OUT.x, y = OUT.y;
    if (x < rect.x + m || x > rect.x + rect.w - m || y < rect.y + m || y > rect.y + rect.h - m) continue;
    // Keep the mark on land (coast noise may put a jittered position in the water).
    if (sampleAt(f, f.coast, x, y) <= 0.06) {
      const c = s.cell;
      if (!proj.forward(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], OUT)) continue;
      let ok = false;
      for (let t = 0.25; t <= 1.0001; t += 0.25) {
        const px = x + (OUT.x - x) * t, py = y + (OUT.y - y) * t;
        if (sampleAt(f, f.coast, px, py) > 0.06) { x = px; y = py; ok = true; break; }
      }
      if (!ok) continue;
    }
    const name = (nameAt(s.names, year) ?? s.names[0]?.name)?.roman ?? "";
    if (!name) continue;
    const holy = (s.tags ?? []).some((t) => /holy/i.test(t));
    if (ruined) {
      const peak = peakPop(s);
      if (peak < TOWN_POP) continue;
      marks.push({ id: s.id, x, y, tier: "ruin", pop: peak, name, owner: -1, port: false, walled: false, great: false, capitalOf: -1, minor: false, color: null, holy, r: iconHalfWidth("ruin", false, k), rank: Math.log10(peak + 1) - 1.6 });
      continue;
    }
    const pop = popAt(h, s, year);
    const capOf = capitals.get(s.id) ?? -1;
    const great = pop >= GREAT_POP;
    const tier: PlaceTier = capOf >= 0 ? "capital" : pop >= CITY_POP ? "city" : pop >= TOWN_POP ? "town" : "village";
    const walled = s.walled >= 0 && s.walled <= year;
    const rank = Math.log10(pop + 10) + (capOf >= 0 ? 2.2 : 0) + (walled ? 0.15 : 0) + (holy ? 0.3 : 0);
    const col = capOf >= 0 ? (h.polities[capOf].color as [number, number, number]) : null;
    marks.push({ id: s.id, x, y, tier, pop, name, owner: ownerOfSettlement(s, year), port: s.port, walled, great, capitalOf: capOf, minor: false, color: col, holy, r: iconHalfWidth(tier, great, k), rank });
  }
  marks.sort((a, b) => b.rank - a.rank || a.id - b.id);
  return marks;
}

export function selectRoutes(world: PhysicalWorld, h: History, year: number, proj: Projection): RouteLine[] {
  const out: RouteLine[] = [];
  const xyz = world.mesh.xyz;
  for (const r of h.tradeRoutes ?? []) {
    if (r.founded > year || (r.ended >= 0 && r.ended <= year)) continue;
    const pts: Pt[] = [];
    let anyIn = false;
    for (const c of r.path) {
      if (!proj.forward(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], OUT)) continue;
      pts.push([OUT.x, OUT.y]);
      if (proj.inCap(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2])) anyIn = true;
    }
    if (!anyIn || pts.length < 2) continue;
    out.push({ id: r.id, kind: r.kind, pts: pts.length >= 3 ? chaikin({ pts, closed: false }, 3).pts : pts });
  }
  return out;
}

/**
 * Battles of the last `window` years before `year`, largest first (or every
 * battle of a war, in order, when given).
 */
export function selectBattles(world: PhysicalWorld, h: History, year: number, proj: Projection, k: number, opts: { window?: number; war?: number } = {}): BattleMark[] {
  const out: BattleMark[] = [];
  const xyz = world.mesh.xyz;
  const rect = proj.rect;
  const win = opts.window ?? 25;
  const m = 14 * k;
  for (const b of h.battles ?? []) {
    if (opts.war !== undefined && opts.war >= 0) {
      if (b.war !== opts.war) continue;
    } else if (b.year > year || b.year < year - win) continue;
    const c = b.cell;
    if (c < 0 || !proj.inCap(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]) || !proj.forward(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], OUT)) continue;
    if (OUT.x < rect.x + m || OUT.x > rect.x + rect.w - m || OUT.y < rect.y + m || OUT.y > rect.y + rect.h - m) continue;
    const size = (b.attacker?.strength ?? 0) + (b.defender?.strength ?? 0);
    const name = b.name.replace(/^the /, "");
    out.push({ id: b.id, x: OUT.x, y: OUT.y, year: b.year, name: name[0] ? name[0].toUpperCase() + name.slice(1) : name, kind: b.kind, size });
  }
  if (opts.war !== undefined && opts.war >= 0) out.sort((a, b) => b.size - a.size || a.year - b.year || a.id - b.id);
  else out.sort((a, b) => b.size - a.size || b.year - a.year || a.id - b.id);
  return out;
}
