/**
 * Small spherical helpers for the UI (DOM-free).
 */
import type { PhysicalWorld } from "../../world/types";

export type XYZ = [number, number, number];

const DEG = 180 / Math.PI;

export function cellXYZ(world: PhysicalWorld, cell: number): XYZ {
  const x = world.mesh.xyz;
  return [x[3 * cell], x[3 * cell + 1], x[3 * cell + 2]];
}

export function cellLatLon(world: PhysicalWorld, cell: number): [number, number] {
  return [world.mesh.lat[cell] * DEG, world.mesh.lon[cell] * DEG];
}

export function xyzLatLon(v: ArrayLike<number>): [number, number] {
  const z = Math.max(-1, Math.min(1, v[2]));
  return [Math.asin(z) * DEG, Math.atan2(v[1], v[0]) * DEG];
}

/** Mean direction of a set of cells (normalised), plus the angular radius (degrees) that covers ~90% of them. */
export function cellsCentroid(world: PhysicalWorld, cells: ArrayLike<number>): { xyz: XYZ; radiusDeg: number; nearest: number } | null {
  if (!cells.length) return null;
  const p = world.mesh.xyz;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    x += p[3 * c];
    y += p[3 * c + 1];
    z += p[3 * c + 2];
  }
  const l = Math.hypot(x, y, z) || 1;
  x /= l;
  y /= l;
  z /= l;
  const ang: number[] = [];
  let best = cells[0], bestDot = -2;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const d = p[3 * c] * x + p[3 * c + 1] * y + p[3 * c + 2] * z;
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
    ang.push(Math.acos(Math.max(-1, Math.min(1, d))));
  }
  ang.sort((a, b) => a - b);
  const r = ang[Math.min(ang.length - 1, Math.floor(ang.length * 0.9))] * DEG;
  return { xyz: [x, y, z], radiusDeg: r, nearest: best };
}

/** Zoom level that frames an angular radius (degrees) on the globe (zoom 1 = whole globe). */
export function zoomForRadius(radiusDeg: number): number {
  const r = Math.max(2, Math.min(90, radiusDeg));
  // At zoom z the visible half-height is ≈ asin(1 / (z·k)); k compensates for the fit margin.
  const s = Math.sin((r * 1.35 * Math.PI) / 180);
  return Math.max(1, Math.min(7, 1 / Math.max(0.12, s)));
}

/** Great-circle distance between two cells, km. */
export function cellDistanceKm(world: PhysicalWorld, a: number, b: number): number {
  const p = world.mesh.xyz;
  const d = p[3 * a] * p[3 * b] + p[3 * a + 1] * p[3 * b + 1] + p[3 * a + 2] * p[3 * b + 2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * world.params.radiusKm;
}

/** Cells within `hops` adjacency steps of `start` (including it). */
export function cellsAround(world: PhysicalWorld, start: number, hops: number): number[] {
  const { adjStart, adj } = world.mesh;
  const seen = new Set<number>([start]);
  let frontier = [start];
  for (let h = 0; h < hops; h++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const nb = adj[k];
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

export function formatLatLon(lat: number, lon: number): string {
  const a = Math.abs(lat), b = Math.abs(lon);
  return `${a.toFixed(1)}° ${lat >= 0 ? "N" : "S"}, ${b.toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;
}
