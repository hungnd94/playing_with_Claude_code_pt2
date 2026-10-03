/**
 * Political geometry at a year: realm territories (closed loops for
 * watercolour washes, slightly dilated into the sea so that washes clipped to
 * the land meet the coastline exactly), realm borders (drawn once, only where
 * land meets land), vassal relations, and the main territorial component of
 * every realm (node positions for the label axis).
 */
import type { History } from "../history/types";
import type { PhysicalWorld } from "../world/types";
import { chaikin, decimate, marchingSquares, polylineLength, type Pt } from "./contour";
import type { FieldGrid } from "./field";
import { ownerAt, overlordAt, polityAlive } from "./hist";
import { PIGMENTS, mix } from "./style";

export interface RealmGeom {
  id: number;
  /** Wash colour (a watercolour pigment; vassals: their suzerain's, lighter), RGB. */
  color: [number, number, number];
  /** Direct overlord at the year (-1 = independent). */
  overlord: number;
  /** Top of the vassal chain (= id when independent). */
  suzerain: number;
  /** Closed screen loops (even-odd) of the territory (dilated into water). */
  loops: Pt[][];
  /** Land node count (area proxy). */
  nodes: number;
  /** Node positions (subsampled) of the largest connected part, for the label axis. */
  xs: number[];
  ys: number[];
  /** Node count of the largest connected part. */
  mainNodes: number;
  /** Wash strength multiplier: 1 normally; < 1 for realms outside a plate's subject. */
  emphasis: number;
}

export interface BorderLine {
  pts: Pt[];
  /** "realm" between realms of different suzerainties; "vassal" inside one suzerainty; "frontier" against unclaimed land. */
  kind: "realm" | "vassal" | "frontier";
}

export interface PoliticalGeom {
  realms: RealmGeom[];
  borders: BorderLine[];
  /** Owner per grid node, land only (-1 none / water). */
  ownerNode: Int32Array;
  /** Owner per cell at the year. */
  ownerCell: Int32Array;
}

export function buildPolitical(world: PhysicalWorld, h: History, year: number, f: FieldGrid, k: number): PoliticalGeom | null {
  void world;
  const owner = ownerAt(h, year);
  if (!owner) return null;
  const { gx, gy, step } = f;
  const N = gx * gy;
  const ownerNode = new Int32Array(N).fill(-1);
  const counts = new Map<number, number>();
  const alive = new Map<number, boolean>();
  const isAlive = (o: number) => {
    let a = alive.get(o);
    if (a === undefined) {
      a = !!h.polities[o] && polityAlive(h.polities[o], year);
      alive.set(o, a);
    }
    return a;
  };
  for (let q = 0; q < N; q++) {
    const c = f.landCell[q];
    if (c < 0 || f.coast[q] <= 0) continue;
    const o = owner[c];
    if (o < 0 || !isAlive(o)) continue;
    ownerNode[q] = o;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  if (counts.size === 0) return { realms: [], borders: [], ownerNode, ownerCell: owner };

  // Dilate into water by a few nodes (4-neighbour propagation), for the wash loops.
  const dil = Int32Array.from(ownerNode);
  const D = Math.max(2, Math.ceil((7 * k) / step));
  let frontier: number[] = [];
  for (let q = 0; q < N; q++) if (dil[q] >= 0) frontier.push(q);
  for (let pass = 0; pass < D && frontier.length; pass++) {
    const next: number[] = [];
    for (const q of frontier) {
      const i = q % gx, j = (q - i) / gx;
      const o = dil[q];
      if (i > 0 && dil[q - 1] < 0 && f.coast[q - 1] <= 0) { dil[q - 1] = o; next.push(q - 1); }
      if (i < gx - 1 && dil[q + 1] < 0 && f.coast[q + 1] <= 0) { dil[q + 1] = o; next.push(q + 1); }
      if (j > 0 && dil[q - gx] < 0 && f.coast[q - gx] <= 0) { dil[q - gx] = o; next.push(q - gx); }
      if (j < gy - 1 && dil[q + gx] < 0 && f.coast[q + gx] <= 0) { dil[q + gx] = o; next.push(q + gx); }
    }
    frontier = next;
  }

  // Largest 4-connected component of each realm's land nodes.
  const comp = new Int32Array(N).fill(-1);
  const bestComp = new Map<number, { id: number; size: number }>();
  let compId = 0;
  const stack: number[] = [];
  for (let q0 = 0; q0 < N; q0++) {
    const o = ownerNode[q0];
    if (o < 0 || comp[q0] >= 0) continue;
    let size = 0;
    comp[q0] = compId;
    stack.push(q0);
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const i = q % gx;
      if (i > 0 && comp[q - 1] < 0 && ownerNode[q - 1] === o) { comp[q - 1] = compId; stack.push(q - 1); }
      if (i < gx - 1 && comp[q + 1] < 0 && ownerNode[q + 1] === o) { comp[q + 1] = compId; stack.push(q + 1); }
      if (q >= gx && comp[q - gx] < 0 && ownerNode[q - gx] === o) { comp[q - gx] = compId; stack.push(q - gx); }
      if (q + gx < N && comp[q + gx] < 0 && ownerNode[q + gx] === o) { comp[q + gx] = compId; stack.push(q + gx); }
    }
    const b = bestComp.get(o);
    if (!b || size > b.size) bestComp.set(o, { id: compId, size });
    compId++;
  }

  const suzerainOf = (id: number): number => {
    let cur = id;
    for (let guard = 0; guard < 8; guard++) {
      const p = h.polities[cur];
      if (!p) break;
      const ov = overlordAt(p, year);
      if (ov < 0 || ov === cur || !h.polities[ov] || !isAlive(ov)) break;
      cur = ov;
    }
    return cur;
  };

  const minNodes = Math.max(8, Math.round((40 * k * k) / (step * step)));
  const realms: RealmGeom[] = [];
  const ids = [...counts.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const cnt = counts.get(id)!;
    if (cnt < minNodes) continue;
    const bc = bestComp.get(id)!;
    // Bounding box of the realm's dilated nodes, and the main component's node positions.
    let i0 = gx, i1 = 0, j0 = gy, j1 = 0;
    const xs: number[] = [], ys: number[] = [];
    const sub = Math.max(1, Math.round(Math.sqrt(bc.size / 2500)));
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        const q = j * gx + i;
        if (dil[q] !== id) continue;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
        if (comp[q] === bc.id && i % sub === 0 && j % sub === 0) {
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
        mask[j * bw + i] = dil[gj * gx + gi] === id ? 1 : 0;
      }
    const raw = marchingSquares(mask, bw, bh, 0.5, 0);
    const loops: Pt[][] = [];
    for (const l of raw) {
      const scr: Pt[] = l.pts.map(([i, j]) => [f.x0 + (i0 - 1 + i) * step, f.y0 + (j0 - 1 + j) * step]);
      if (polylineLength(scr, true) < 8 * k) continue;
      loops.push(chaikin(decimate({ pts: scr, closed: true }, step * 0.8), 3).pts);
    }
    const p = h.polities[id];
    const ov = overlordAt(p, year);
    realms.push({
      id, color: [0, 0, 0], overlord: ov >= 0 && isAlive(ov) ? ov : -1, suzerain: suzerainOf(id),
      loops, nodes: cnt, xs, ys, mainNodes: bc.size, emphasis: 1,
    });
  }

  assignPigments(h, realms, ownerNode, gx, gy, counts);

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
  const sameSuzerainty = (a: number, b: number) => {
    const ra = realmSet.get(a), rb = b >= 0 ? realmSet.get(b) : undefined;
    if (!ra || !rb) return false;
    return ra.suzerain === rb.suzerain;
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
        const inside = nodeOwnerAt(p[0] - (-dy / L) * off, p[1] - (dx / L) * off);
        // Draw each shared border once (from the lower id), and edges against unclaimed land.
        const draw = o !== null && inside !== null && o !== r.id && (o === -1 || !realmSet.has(o) || r.id < o);
        const kind: BorderLine["kind"] = o === -1 || (o !== null && !realmSet.has(o)) ? "frontier" : o !== null && sameSuzerainty(r.id, o) ? "vassal" : "realm";
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

/** Squared distance between colours in a rough perceptual space. */
function colourDist(a: readonly number[], b: readonly number[]): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * Colour realms like a hand-tinted plate: each suzerainty (a realm with its
 * vassals) takes the pigment nearest its own colour that no neighbouring
 * suzerainty on the plate uses; vassals wear a lighter wash of it.
 */
function assignPigments(h: History, realms: RealmGeom[], ownerNode: Int32Array, gx: number, gy: number, counts: Map<number, number>): void {
  const byId = new Map(realms.map((r) => [r.id, r]));
  const blockOf = (o: number) => byId.get(o)?.suzerain ?? o;
  // Adjacency between blocks (from node neighbours).
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    let s = adj.get(a);
    if (!s) adj.set(a, (s = new Set()));
    s.add(b);
  };
  for (let j = 0; j < gy; j++)
    for (let i = 0; i < gx; i++) {
      const q = j * gx + i;
      const a = ownerNode[q];
      if (a < 0) continue;
      const right = i < gx - 1 ? ownerNode[q + 1] : -1, down = j < gy - 1 ? ownerNode[q + gx] : -1;
      for (const b of [right, down]) {
        if (b < 0 || b === a) continue;
        const A = blockOf(a), B = blockOf(b);
        if (A !== B) { link(A, B); link(B, A); }
      }
    }
  // Block sizes (all member nodes).
  const size = new Map<number, number>();
  for (const [o, n] of counts) size.set(blockOf(o), (size.get(blockOf(o)) ?? 0) + n);
  const blocks = [...size.keys()].sort((a, b) => (size.get(b)! - size.get(a)!) || a - b);
  const chosen = new Map<number, number>();
  for (const b of blocks) {
    const own = (h.polities[b]?.color ?? [128, 128, 128]) as number[];
    const order = PIGMENTS.map((p, i) => ({ i, d: colourDist(p, own) })).sort((x, y) => x.d - y.d || x.i - y.i);
    const used = new Set<number>();
    for (const nb of adj.get(b) ?? []) if (chosen.has(nb)) used.add(chosen.get(nb)!);
    const pick = order.find((o) => !used.has(o.i)) ?? order[0];
    chosen.set(b, pick.i);
  }
  for (const r of realms) {
    const pi = chosen.get(r.suzerain) ?? chosen.get(r.id) ?? 0;
    const base = PIGMENTS[pi];
    r.color = r.suzerain !== r.id ? mix(base, [250, 244, 228], 0.38) : [base[0], base[1], base[2]];
  }
}

/**
 * Mute every realm outside the plate's subject (a realm and its vassals, or
 * the belligerents of a war), so the subject reads first.
 */
export function emphasise(pol: PoliticalGeom, focus: Set<number>, muted = 0.42): void {
  if (!focus.size) return;
  for (const r of pol.realms) r.emphasis = focus.has(r.id) || focus.has(r.suzerain) ? 1 : muted;
}
