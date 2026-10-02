/**
 * Settlements, ruins, battles and trade routes visible on a plate at a year.
 */
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import type { Pt } from "./contour";
import { sampleAt, type FieldGrid } from "./field";
import { capitalAt, nameAt, ownerOfSettlement, peakPop, polityAlive, popAt, settlementAlive } from "./hist";
import type { Projection } from "./projection";

export type PlaceTier = "capital" | "city" | "town" | "village" | "ruin";

export interface PlaceMark {
  id: number;
  x: number;
  y: number;
  tier: PlaceTier;
  pop: number;
  name: string;
  owner: number;
  port: boolean;
  walled: boolean;
  /** Icon radius (px). */
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
}

const OUT = { x: 0, y: 0 };

export function selectPlaces(world: PhysicalWorld, h: History, year: number, proj: Projection, f: FieldGrid, k: number): PlaceMark[] {
  const rect = proj.rect;
  const capitals = new Set<number>();
  for (const p of h.polities) if (polityAlive(p, year)) {
    const c = capitalAt(p, year);
    if (c >= 0) capitals.add(c);
  }
  const marks: PlaceMark[] = [];
  for (const s of h.settlements) {
    const alive = settlementAlive(s, year);
    const ruined = !alive && s.ended >= 0 && s.ended <= year && s.founded <= year;
    if (!alive && !ruined) continue;
    const [x3, y3, z3] = s.pos ?? [world.mesh.xyz[3 * s.cell], world.mesh.xyz[3 * s.cell + 1], world.mesh.xyz[3 * s.cell + 2]];
    if (!proj.inCap(x3, y3, z3) || !proj.forward(x3, y3, z3, OUT)) continue;
    let x = OUT.x, y = OUT.y;
    if (x < rect.x + 8 * k || x > rect.x + rect.w - 8 * k || y < rect.y + 8 * k || y > rect.y + rect.h - 8 * k) continue;
    // Keep the mark on land (coast noise may put a jittered position in the water).
    if (sampleAt(f, f.coast, x, y) <= 0.05) {
      const c = s.cell;
      if (!proj.forward(world.mesh.xyz[3 * c], world.mesh.xyz[3 * c + 1], world.mesh.xyz[3 * c + 2], OUT)) continue;
      let ok = false;
      for (let t = 0.25; t <= 1.0001; t += 0.25) {
        const px = x + (OUT.x - x) * t, py = y + (OUT.y - y) * t;
        if (sampleAt(f, f.coast, px, py) > 0.05) { x = px; y = py; ok = true; break; }
      }
      if (!ok) continue;
    }
    const name = (nameAt(s.names, year) ?? s.names[0]?.name)?.roman ?? "";
    if (ruined) {
      const peak = peakPop(s);
      if (peak < 3000) continue;
      // Re-founded at the same place? Then the new settlement is shown instead.
      marks.push({ id: s.id, x, y, tier: "ruin", pop: peak, name, owner: -1, port: false, walled: false, r: 3.2 * k, rank: Math.log10(peak + 1) - 1.4 });
      continue;
    }
    const pop = popAt(h, s, year);
    const isCap = capitals.has(s.id);
    const tier: PlaceTier = isCap ? "capital" : pop >= 20000 ? "city" : pop >= 4000 ? "town" : "village";
    const r = (tier === "capital" ? 5.2 : tier === "city" ? 4.4 : tier === "town" ? 3.0 : 1.9) * k;
    const rank = Math.log10(pop + 10) + (isCap ? 2 : 0) + (s.walled >= 0 && s.walled <= year ? 0.2 : 0);
    marks.push({ id: s.id, x, y, tier, pop, name, owner: ownerOfSettlement(s, year), port: s.port, walled: s.walled >= 0 && s.walled <= year, r, rank });
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
    if (anyIn && pts.length >= 2) out.push({ id: r.id, kind: r.kind, pts });
  }
  return out;
}

export function selectBattles(world: PhysicalWorld, h: History, year: number, proj: Projection, window = 60): BattleMark[] {
  const out: BattleMark[] = [];
  const xyz = world.mesh.xyz;
  const rect = proj.rect;
  for (const b of h.battles ?? []) {
    if (b.year > year || b.year < year - window) continue;
    const c = b.cell;
    if (!proj.inCap(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]) || !proj.forward(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], OUT)) continue;
    if (OUT.x < rect.x + 10 || OUT.x > rect.x + rect.w - 10 || OUT.y < rect.y + 10 || OUT.y > rect.y + rect.h - 10) continue;
    out.push({ id: b.id, x: OUT.x, y: OUT.y, year: b.year, name: b.name });
  }
  return out;
}
