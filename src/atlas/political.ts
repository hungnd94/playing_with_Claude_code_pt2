/**
 * Political geometry at a year: realm territories (closed loops for
 * watercolour washes), realm borders (drawn once, only over land), vassal
 * relations, and per-realm node sets for label axes.
 */
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import { chaikin, decimate, marchingSquares, polylineLength, type Pt } from "./contour";
import type { FieldGrid } from "./field";
import { ownerAt, overlordAt, polityAlive } from "./hist";
import { pigment } from "./style";

export interface RealmGeom {
  id: number;
  /** Wash colour (pigment), RGB. */
  color: [number, number, number];
  overlord: number;
  /** Closed screen loops (even-odd) of the territory. */
  loops: Pt[][];
  /** Node count (area proxy). */
  nodes: number;
  /** Node screen positions (subsampled) for the label axis. */
  xs: number[];
  ys: number[];
}

export interface BorderLine {
  pts: Pt[];
  /** "realm" between independent realms; "vassal" between a vassal and its overlord or fellow vassals. */
  kind: "realm" | "vassal";
}

export interface PoliticalGeom {
  realms: RealmGeom[];
  borders: BorderLine[];
  /** Owner per grid node (-1 none / water). */
  ownerNode: Int32Array;
  /** Owner per cell at the year. */
  ownerCell: Int32Array;
}

export function buildPolitical(world: PhysicalWorld, h: History, year: number, f: FieldGrid, k: number): PoliticalGeom | null {
  const owner = ownerAt(h, year);
  if (!owner) return null;
  const { gx, gy, step } = f;
  const N = gx * gy;
  const ownerNode = new Int32Array(N).fill(-1);
  const counts = new Map<number, number>();
  for (let q = 0; q < N; q++) {
    const c = f.landCell[q];
    if (c < 0 || f.coast[q] <= 0) continue;
    const o = owner[c];
    if (o < 0 || !h.polities[o] || !polityAlive(h.polities[o], year)) continue;
    ownerNode[q] = o;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const minNodes = Math.max(30, (N / 4000) | 0);
  const realms: RealmGeom[] = [];
  const ids = [...counts.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const cnt = counts.get(id)!;
    if (cnt < minNodes) continue;
    // Bounding box of the realm's nodes.
    let i0 = gx, i1 = 0, j0 = gy, j1 = 0;
    const xs: number[] = [], ys: number[] = [];
    const sub = Math.max(1, Math.round(Math.sqrt(cnt / 3000)));
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        if (ownerNode[j * gx + i] !== id) continue;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
        if (i % sub === 0 && j % sub === 0) {
          xs.push(f.x0 + i * step);
          ys.push(f.y0 + j * step);
        }
      }
    const bw = i1 - i0 + 3, bh = j1 - j0 + 3;
    const mask = new Float32Array(bw * bh);
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) {
        const gi = i0 - 1 + i, gj = j0 - 1 + j;
        if (gi < 0 || gj < 0 || gi >= gx || gj >= gy) continue;
        mask[j * bw + i] = ownerNode[gj * gx + gi] === id ? 1 : 0;
      }
    const raw = marchingSquares(mask, bw, bh, 0.5, 0);
    const loops: Pt[][] = [];
    for (const l of raw) {
      const scr: Pt[] = l.pts.map(([i, j]) => [f.x0 + (i0 - 1 + i) * step, f.y0 + (j0 - 1 + j) * step]);
      if (polylineLength(scr, true) < 10 * k) continue;
      loops.push(chaikin(decimate({ pts: scr, closed: true }, step * 0.8), 3).pts);
    }
    const p = h.polities[id];
    realms.push({ id, color: pigment(p.color as [number, number, number]), overlord: overlordAt(p, year), loops, nodes: cnt, xs, ys });
  }

  // Borders: walk each realm's loops; keep stretches where the other side is land of another owner.
  const borders: BorderLine[] = [];
  const nodeOwnerAt = (x: number, y: number): number | null => {
    const i = Math.round((x - f.x0) / step), j = Math.round((y - f.y0) / step);
    if (i < 0 || j < 0 || i >= gx || j >= gy) return null;
    const q = j * gx + i;
    if (f.coast[q] <= 0) return null; // water
    return ownerNode[q];
  };
  const realmSet = new Map(realms.map((r) => [r.id, r]));
  const vassalPair = (a: number, b: number) => {
    const ra = realmSet.get(a), rb = b >= 0 ? realmSet.get(b) : undefined;
    if (!ra || !rb) return false;
    return ra.overlord === b || rb.overlord === a || (ra.overlord >= 0 && ra.overlord === rb.overlord);
  };
  for (const r of realms) {
    for (const loop of r.loops) {
      const n = loop.length;
      let run: Pt[] = [];
      let runKind: BorderLine["kind"] = "realm";
      const flush = () => {
        if (run.length >= 3 && polylineLength(run) > 4 * k) borders.push({ pts: run, kind: runKind });
        run = [];
      };
      for (let q = 0; q <= n; q++) {
        const p = loop[q % n];
        const a = loop[(q - 1 + n) % n], b = loop[(q + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        // inside (mask high) is on the left: outside normal = (-dy, dx)
        const off = step * 1.6;
        const o = nodeOwnerAt(p[0] + (-dy / L) * off, p[1] + (dx / L) * off);
        const draw = o !== null && o !== r.id && (o === -1 || !realmSet.has(o) || r.id < o);
        const kind: BorderLine["kind"] = o !== null && o >= 0 && vassalPair(r.id, o) ? "vassal" : "realm";
        if (draw) {
          if (run.length && kind !== runKind) {
            run.push(p);
            flush();
          }
          runKind = kind;
          run.push(p);
        } else if (run.length) {
          run.push(p);
          flush();
        }
      }
      flush();
    }
  }
  return { realms, borders, ownerNode, ownerCell: owner };
}
