/**
 * Glyph mutations used when scripts descend from one another: the kinds of
 * change real letters undergo — simplification, cursivisation, angular
 * re-cutting for new tools, losing horizontals on wood, rotation and
 * reflection, extra strokes, lengthened stems, slow drift of proportions.
 */
import type { Rng } from "../core/rng";
import type { Stroke, Tool } from "./types";
import type { Shape } from "./families";
import { cloneStrokes, endpoints, mul, rotate, sampleRaw, scale, smooth, strokeLength, strokesBBox, transformStrokes, translate, type P } from "./geom";
import { differentiate, type Differentiator } from "./marks";

export type MutationOp =
  | "jitter"
  | "simplify"
  | "cursivize"
  | "angularize"
  | "deHorizontal"
  | "rotate"
  | "reflect"
  | "addStroke"
  | "elongate"
  | "lean"
  | "stretch"
  | "loopify"
  | "open"
  | "close"
  | "feet"
  | "hooks"
  | "headline"
  | "narrow"
  | "wide"
  | "roundify"
  | "squarify"
  | "openTop"
  | "flags"
  | "startLoops"
  | "tails"
  | "rotateAll";

/** A headline stroke (Brahmic shirorekha segment): horizontal along y≈0 spanning the box. */
export function isHeadline(st: Stroke, w: number): boolean {
  return !st.dot && st.pts.length === 2 && Math.abs(st.pts[0][1]) < 0.02 && Math.abs(st.pts[1][1]) < 0.02 && Math.abs(st.pts[1][0] - st.pts[0][0]) > w * 0.7;
}

function fitBack(strokes: Stroke[], w: number): { strokes: Stroke[]; w: number } {
  const bb = strokesBBox(strokes);
  // keep glyph inside a sane box: x from ~0
  const dx = -Math.min(bb.x0, 0) + (bb.x0 > 0.15 ? -bb.x0 + 0.02 : 0);
  const s = dx ? transformStrokes(strokes, translate(dx, 0)) : strokes;
  const nb = strokesBBox(s);
  return { strokes: s, w: Math.max(0.25, Math.min(1.6, Math.max(w * 0.7, nb.x1 + 0.02))) };
}

/** Polyline through a smooth stroke's nodes or an arc's subdivision (a cut or pressed version). */
function angularStroke(st: Stroke): Stroke {
  if (st.dot !== undefined) return st;
  if (st.smooth) {
    const o: Stroke = { pts: st.pts.map((p) => [p[0], p[1]] as P) };
    if (st.closed) o.closed = true;
    if (st.w !== undefined) o.w = st.w;
    return o;
  }
  if (!st.bend || st.bend.every((b) => Math.abs(b) < 0.02)) return st;
  // subdivide arcs into 2–3 chords
  const raw = sampleRaw(st, 0.01);
  const pts: P[] = [];
  const nodes = raw.nodes;
  for (let k = 0; k < nodes.length - 1; k++) {
    const i0 = nodes[k];
    const i1 = nodes[k + 1];
    const b = st.bend[k] ?? 0;
    pts.push([raw.xy[2 * i0], raw.xy[2 * i0 + 1]]);
    if (Math.abs(b) > 0.02) {
      const n = Math.abs(b) > 0.3 ? 3 : 2;
      for (let j = 1; j < n; j++) {
        const i = Math.round(i0 + ((i1 - i0) * j) / n);
        pts.push([raw.xy[2 * i], raw.xy[2 * i + 1]]);
      }
    }
  }
  if (!st.closed) {
    const last = nodes[nodes.length - 1];
    pts.push([raw.xy[2 * last], raw.xy[2 * last + 1]]);
  }
  const o: Stroke = { pts: pts.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000] as P) };
  if (st.closed) o.closed = true;
  if (st.w !== undefined) o.w = st.w;
  return o;
}

/** Join strokes whose ends meet into single pen paths, and smooth them. */
function cursivizeStrokes(strokes: Stroke[], w: number): Stroke[] {
  const out = cloneStrokes(strokes);
  const free = out.filter((s) => !s.dot && !s.closed && !isHeadline(s, w));
  for (let pass = 0; pass < 3; pass++) {
    let merged = false;
    for (let i = 0; i < free.length && !merged; i++)
      for (let j = 0; j < free.length && !merged; j++) {
        if (i === j) continue;
        const A = free[i];
        const B = free[j];
        const ae = A.pts[A.pts.length - 1];
        for (const rev of [false, true]) {
          const bp = rev ? B.pts.slice().reverse() : B.pts;
          const bs = bp[0];
          if (Math.hypot(ae[0] - bs[0], ae[1] - bs[1]) < 0.09) {
            A.pts = [...A.pts, ...bp.slice(1)];
            A.smooth = 1;
            delete A.bend;
            free.splice(j, 1);
            out.splice(out.indexOf(B), 1);
            merged = true;
            break;
          }
        }
      }
    if (!merged) break;
  }
  for (const s of out) {
    if (s.dot || isHeadline(s, w) || s.pts.length < 3) continue;
    if (!s.smooth) {
      s.smooth = 1;
      delete s.bend;
    }
    delete s.sharp;
  }
  return out;
}

function deHorizontalStrokes(strokes: Stroke[], rng: Rng): Stroke[] {
  const out = cloneStrokes(strokes);
  for (const s of out) {
    if (s.dot) continue;
    for (let i = 0; i < s.pts.length - 1 + (s.closed ? 1 : 0); i++) {
      const a = s.pts[i];
      const b = s.pts[(i + 1) % s.pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      if (Math.abs(dx) > 0.12 && Math.abs(dy) < Math.abs(dx) * 0.3) {
        const t = (rng.chance(0.5) ? 1 : -1) * Math.abs(dx) * 0.45;
        if (i + 1 < s.pts.length || !s.closed) b[1] = Math.round((b[1] + t) * 1000) / 1000;
      }
    }
  }
  return out;
}

export interface MutateCtx {
  tool: Tool;
  headline: boolean;
  diffs: Differentiator[];
  /** Direction of added feet (+1 right, -1 left). */
  footDir?: number;
  /** Direction of top flags and tails (+1 right, -1 left). */
  flagDir?: number;
  /** Letters join on the baseline: leave baseline connectors alone. */
  joins?: boolean;
}

// ---------------------------------------------------------------------------
// Script-wide restyling helpers
// ---------------------------------------------------------------------------

const isBaselineConnector = (st: Stroke): boolean =>
  !st.dot && st.pts.length === 2 && Math.abs(st.pts[0][1] - 1) < 0.04 && Math.abs(st.pts[1][1] - 1) < 0.04;

function centroid(strokes: Stroke[]): P {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const st of strokes) {
    if (st.dot !== undefined) continue;
    const xy = sampleRaw(st, 0.06).xy;
    for (let i = 0; i < xy.length; i += 2) {
      sx += xy[i];
      sy += xy[i + 1];
      n++;
    }
  }
  return n ? [sx / n, sy / n] : [0.4, 0.5];
}

/** Bend sign (+ = bulge to the left of travel) that makes segment a→b bow away from point c. */
function outwardBend(a: P, b: P, c: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const lx = dy / L;
  const ly = -dx / L;
  const mx = (a[0] + b[0]) / 2 - c[0];
  const my = (a[1] + b[1]) / 2 - c[1];
  const d = mx * lx + my * ly;
  // Segments through the middle of the letter barely bow.
  return Math.abs(d) < 0.08 ? Math.sign(d || 1) * 0.35 : Math.sign(d);
}

/**
 * Chaikin corner cutting: each segment is replaced by points at `r` and
 * `1 - r` along it (r = 0.25 converges to a quadratic B-spline). Open paths
 * keep their end points.
 */
function chaikin(pts: P[], closed: boolean, r: number, iters: number): P[] {
  let cur = pts;
  for (let it = 0; it < iters; it++) {
    const out: P[] = [];
    const n = cur.length;
    if (!closed) out.push(cur[0]);
    const nseg = closed ? n : n - 1;
    for (let i = 0; i < nseg; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      out.push([a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r], [a[0] + (b[0] - a[0]) * (1 - r), a[1] + (b[1] - a[1]) * (1 - r)]);
    }
    if (!closed) out.push(cur[n - 1]);
    cur = out;
  }
  return cur;
}

/** Resample a dense node list to at most `max` nodes evenly spaced by arc length (keeps ends). */
function thin(pts: P[], max: number, closed: boolean): P[] {
  if (pts.length <= max) return pts;
  const path = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = cum[cum.length - 1];
  const m = closed ? max : max - 1;
  const out: P[] = [];
  let j = 0;
  for (let i = 0; i < m; i++) {
    const t = (i / m) * total;
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const f = (t - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out.push([path[j][0] + (path[j + 1][0] - path[j][0]) * f, path[j][1] + (path[j + 1][1] - path[j][1]) * f]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

const r3p = (p: P): P => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];

/**
 * Palm-leaf / brush rounding: straight strokes bow outward, corners are cut
 * into curves, polygons become loops. `k` 0..1 sets how far it goes; it is
 * cumulative, so a second rounding generation rounds further.
 */
function roundifyStrokes(strokes: Stroke[], k: number, joins: boolean): Stroke[] {
  const c = centroid(strokes);
  return strokes.map((st) => {
    if (st.dot !== undefined || (joins && isBaselineConnector(st))) return st;
    const n = st.pts.length;
    const closed = !!st.closed;
    const isCircle = closed && n <= 4 && !!st.bend && st.bend.every((b) => Math.abs(b) > 0.15);
    if (isCircle) return st;
    if (n === 2 && !closed) {
      // A straight stroke bows outward (more if it already bowed).
      const b0 = st.bend?.[0] ?? 0;
      const s = b0 !== 0 ? Math.sign(b0) : outwardBend(st.pts[0], st.pts[1], c);
      const mag = Math.min(0.3, Math.abs(b0) + k * 0.16 * Math.abs(s));
      return { ...st, pts: st.pts.map((p) => [p[0], p[1]] as P), bend: [Math.round(Math.sign(s) * mag * 1000) / 1000] };
    }
    // Polylines (possibly with arcs) and smooth paths: cut the corners.
    let pts: P[];
    if (st.bend && st.bend.some((b) => Math.abs(b) > 0.02)) {
      // Sample arcs at their midpoints so the curvature survives.
      const raw = sampleRaw(st, 0.02);
      pts = [];
      for (let i = 0; i < raw.nodes.length - (closed ? 1 : 0); i++) {
        const a = raw.nodes[i];
        pts.push([raw.xy[2 * a], raw.xy[2 * a + 1]]);
        const b = raw.nodes[i + 1];
        if (b !== undefined && (st.bend[i] ?? 0) !== 0) {
          const m = Math.round((a + b) / 2);
          pts.push([raw.xy[2 * m], raw.xy[2 * m + 1]]);
        }
      }
      if (!closed) pts.push(st.pts[n - 1]);
    } else pts = st.pts.map((p) => [p[0], p[1]] as P);
    const keepSharp = new Set(st.smooth && k < 0.6 ? (st.sharp ?? []) : []);
    let out: P[];
    if (keepSharp.size) {
      out = pts; // sharp nodes are deliberate; leave the path alone at low strength
    } else {
      // Sides bulge outward (an arch ∧ becomes ∩, a triangle a loop), then corners are cut.
      const bowed: P[] = [];
      const m = pts.length;
      const nseg = closed ? m : m - 1;
      for (let i = 0; i < m; i++) {
        bowed.push(pts[i]);
        if (i >= nseg) continue;
        const a = pts[i];
        const b = pts[(i + 1) % m];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.12) continue;
        const sgn = outwardBend(a, b, c);
        const lx = (b[1] - a[1]) / L;
        const ly = -(b[0] - a[0]) / L;
        const mag = k * 0.13 * L * sgn;
        bowed.push([(a[0] + b[0]) / 2 + lx * mag, (a[1] + b[1]) / 2 + ly * mag]);
      }
      const ratio = 0.1 + 0.15 * k;
      out = chaikin(bowed, closed, ratio, k > 0.55 ? 2 : 1);
      out = thin(out, closed ? 12 : 10, closed);
    }
    const o = smooth(out.map(r3p), [...keepSharp], closed);
    if (st.w !== undefined) o.w = st.w;
    return o;
  });
}

/** Book-hand squaring: curves become chords, near-axis segments snap to the axes. */
function squarifyStrokes(strokes: Stroke[], joins: boolean): Stroke[] {
  return strokes.map((st0) => {
    if (st0.dot !== undefined || (joins && isBaselineConnector(st0))) return st0;
    const st = angularStroke(st0);
    const pts = st.pts.map((p) => [p[0], p[1]] as P);
    const n = pts.length;
    const nseg = st.closed ? n : n - 1;
    for (let i = 0; i < nseg; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
      if (i + 1 === n && st.closed) continue; // do not move the first node again
      if (ang < 0.4) b[1] = a[1];
      else if (ang > Math.PI / 2 - 0.4) b[0] = a[0];
    }
    const o: Stroke = { pts };
    if (st.closed) o.closed = true;
    if (st.w !== undefined) o.w = st.w;
    return o;
  });
}

/** Open closed heads (Phoenician → Aramaic): a gap at the top of every closed stroke. */
function openTopStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((st) => {
    if (st.dot !== undefined || !st.closed) return st;
    const n = st.pts.length;
    if (!st.smooth && !st.bend && n >= 3) {
      // Polygon: drop the top-most side.
      let top = 0;
      let ty = Infinity;
      for (let i = 0; i < n; i++) {
        const y = (st.pts[i][1] + st.pts[(i + 1) % n][1]) / 2;
        if (y < ty) {
          ty = y;
          top = i;
        }
      }
      const pts: P[] = [];
      for (let k = 1; k <= n; k++) pts.push([st.pts[(top + k) % n][0], st.pts[(top + k) % n][1]]);
      const o: Stroke = { pts };
      if (st.w !== undefined) o.w = st.w;
      return o;
    }
    // Curved loop: cut a gap of ~70° around its top.
    const xy = sampleRaw(st, 0.03).xy;
    const m = xy.length / 2 - 1;
    if (m < 8) return st;
    let top = 0;
    for (let i = 0; i < m; i++) if (xy[2 * i + 1] < xy[2 * top + 1]) top = i;
    const gap = Math.max(2, Math.round(m * 0.1));
    const pts: P[] = [];
    const step = Math.max(1, Math.round(m / 10));
    for (let k = gap; k <= m - gap; k += step) {
      const i = (top + k) % m;
      pts.push([Math.round(xy[2 * i] * 1000) / 1000, Math.round(xy[2 * i + 1] * 1000) / 1000]);
    }
    const last = (top + m - gap) % m;
    pts.push([Math.round(xy[2 * last] * 1000) / 1000, Math.round(xy[2 * last + 1] * 1000) / 1000]);
    const o = smooth(pts);
    if (st.w !== undefined) o.w = st.w;
    return o;
  });
}

/** Apply one mutation to a glyph shape. */
export function mutateShape(shape: Shape, op: MutationOp, rng: Rng, ctx: MutateCtx, amount = 1): Shape {
  const w = shape.w;
  const head = shape.strokes.filter((s) => isHeadline(s, w));
  let body = shape.strokes.filter((s) => !isHeadline(s, w));
  const bb = strokesBBox(body);
  const cx = (bb.x0 + bb.x1) / 2;
  const cy = (bb.y0 + bb.y1) / 2;
  const keep = (strokes: Stroke[], nw = w): Shape => {
    const f = fitBack([...strokes], nw);
    const hs = head.map((h) => ({ ...h, pts: [[0, 0], [f.w, 0]] as P[] }));
    return { ...shape, strokes: [...hs, ...f.strokes], w: f.w };
  };
  switch (op) {
    case "jitter": {
      const a = 0.025 * amount;
      body = cloneStrokes(body);
      for (const s of body)
        for (const p of s.pts) {
          p[0] = Math.round((p[0] + rng.normal(0, a)) * 1000) / 1000;
          if (!(ctx.headline && Math.abs(p[1]) < 0.02)) p[1] = Math.round((p[1] + rng.normal(0, a)) * 1000) / 1000;
        }
      return keep(body);
    }
    case "simplify": {
      if (body.length >= 2) {
        const lens = body.map((s) => strokeLength(s));
        const total = lens.reduce((x, y) => x + y, 0);
        let mi = 0;
        for (let i = 1; i < lens.length; i++) if (lens[i] < lens[mi]) mi = i;
        if (lens[mi] < total * 0.35) return keep(body.filter((_, i) => i !== mi));
      }
      // drop an interior node of the most complex stroke
      const s = body.slice().sort((x, y) => y.pts.length - x.pts.length)[0];
      if (s && s.pts.length >= 4) {
        const i = rng.int(1, s.pts.length - 2);
        const ns: Stroke = { ...s, pts: s.pts.filter((_, k) => k !== i) };
        if (ns.bend) ns.bend = ns.bend.filter((_, k) => k !== i);
        if (ns.sharp) ns.sharp = ns.sharp.filter((k) => k !== i).map((k) => (k > i ? k - 1 : k));
        return keep(body.map((x) => (x === s ? ns : x)));
      }
      return shape;
    }
    case "cursivize":
      return keep(cursivizeStrokes(body, w));
    case "angularize":
      return keep(body.map(angularStroke));
    case "deHorizontal":
      return keep(deHorizontalStrokes(body.map(angularStroke), rng));
    case "rotate": {
      const a = rng.pick([Math.PI / 2, -Math.PI / 2, Math.PI]);
      const m = mul(translate(cx, 0.5), mul(rotate(a), translate(-cx, -cy)));
      let st = transformStrokes(body, m);
      const nb = strokesBBox(st);
      // squeeze into the body height
      const h = nb.y1 - nb.y0;
      if (h > 1.1) st = transformStrokes(st, mul(translate(0, 0.5), mul(scale(1, 1 / h), translate(0, -(nb.y0 + nb.y1) / 2))));
      return keep(st, Math.max(0.35, nb.x1 - nb.x0 + 0.05));
    }
    case "reflect":
      return keep(transformStrokes(body, [-1, 0, 0, 1, w, 0]));
    case "addStroke":
      return keep(differentiate({ strokes: body, w }, rng.pick(ctx.diffs), rng).strokes);
    case "elongate": {
      // find the most vertical straight-ish segment and extend it
      let best: { s: Stroke; i: number; up: boolean } | null = null;
      let bl = 0;
      for (const s of body) {
        if (s.dot || s.closed) continue;
        for (let i = 0; i < s.pts.length - 1; i++) {
          const a = s.pts[i];
          const b = s.pts[i + 1];
          const dy = Math.abs(b[1] - a[1]);
          const dx = Math.abs(b[0] - a[0]);
          if (dy > bl && dx < dy * 0.4) {
            bl = dy;
            best = { s, i, up: rng.chance(0.5) };
          }
        }
      }
      if (!best || bl < 0.3) return shape;
      const out = cloneStrokes(body);
      const s = out[body.indexOf(best.s)];
      const a = s.pts[best.i];
      const b = s.pts[best.i + 1];
      const top = a[1] < b[1] ? a : b;
      const bot = a[1] < b[1] ? b : a;
      const isEndTop = s.pts.indexOf(top) === 0 || s.pts.indexOf(top) === s.pts.length - 1;
      const isEndBot = s.pts.indexOf(bot) === 0 || s.pts.indexOf(bot) === s.pts.length - 1;
      if (best.up && isEndTop && !ctx.headline) top[1] = Math.min(top[1], -0.36);
      else if (isEndBot) bot[1] = Math.max(bot[1], 1.36);
      else return shape;
      return keep(out);
    }
    case "lean": {
      const a = rng.normal(0, 0.06 * amount);
      return keep(transformStrokes(body, mul(translate(cx, 1), mul(rotate(a), translate(-cx, -1)))));
    }
    case "stretch": {
      const k = Math.exp(rng.normal(0, 0.12 * amount));
      return keep(transformStrokes(body, scale(k, 1)), w * k);
    }
    case "loopify": {
      const out = cloneStrokes(body);
      const ends: { s: Stroke; atStart: boolean }[] = [];
      for (const s of out) if (!s.dot && !s.closed && s.pts.length >= 2) ends.push({ s, atStart: true }, { s, atStart: false });
      if (!ends.length) return shape;
      const e = rng.pick(ends);
      const p = e.atStart ? e.s.pts[0] : e.s.pts[e.s.pts.length - 1];
      const r = 0.075;
      out.push({ pts: [[p[0] - r, p[1] - r * 0.6], [p[0] + r, p[1] - r * 0.6]], bend: [0.5, 0.5], closed: true });
      return keep(out);
    }
    case "open": {
      // open a closed stroke (a ring becomes a hook)
      const out = cloneStrokes(body);
      const c = out.find((s) => s.closed && !s.dot);
      if (!c) return shape;
      c.closed = undefined;
      delete c.closed;
      if (c.bend && c.bend.length > c.pts.length - 1) c.bend = c.bend.slice(0, c.pts.length - 1);
      if (c.pts.length === 2 && c.bend) c.bend = [c.bend[0] * 1.5];
      return keep(out);
    }
    case "feet": {
      // short horizontal feet on bottom ends of near-vertical strokes (Ge'ez-like serifs)
      const out = cloneStrokes(body);
      const dir = ctx.footDir ?? 1;
      let added = 0;
      for (const st of body) {
        if (st.dot || st.closed || st.pts.length < 2) continue;
        for (const atStart of [true, false]) {
          const p0 = atStart ? st.pts[0] : st.pts[st.pts.length - 1];
          const p1 = atStart ? st.pts[1] : st.pts[st.pts.length - 2];
          if (p0[1] < 0.8 || Math.abs(p0[0] - p1[0]) > Math.abs(p0[1] - p1[1]) * 0.6) continue;
          // Already footed (a short stroke leaving this end)? Then leave it.
          const footed = body.some(
            (o) => o !== st && !o.dot && o.pts.length === 2 && Math.hypot(o.pts[0][0] - p0[0], o.pts[0][1] - p0[1]) < 0.03 && Math.abs(o.pts[1][1] - p0[1]) < 0.05,
          );
          if (footed) continue;
          out.push({ pts: [[p0[0], p0[1]], [p0[0] + dir * 0.14, p0[1]]] });
          added++;
        }
      }
      return added ? keep(out) : shape;
    }
    case "hooks": {
      const out = cloneStrokes(body);
      let added = 0;
      for (const st of out) {
        if (st.dot || st.closed || st.pts.length < 2 || added > 1) continue;
        const e = st.pts[st.pts.length - 1];
        const q = st.pts[st.pts.length - 2];
        if (e[1] < 0.7) continue;
        const dx = e[0] - q[0];
        const side = dx >= 0 ? 1 : -1;
        st.pts.push([e[0] + side * 0.09, e[1] + 0.05], [e[0] + side * 0.15, e[1] - 0.06]);
        st.smooth = 1;
        delete st.bend;
        added++;
      }
      return added ? keep(out) : shape;
    }
    case "headline": {
      // hang the letter from a top bar (as Brahmi's head-marks grew into Devanagari's shirorekha)
      const nb = strokesBBox(body);
      const dy = -Math.max(0, nb.y0);
      const out = transformStrokes(body, translate(0, dy));
      return { ...shape, strokes: [{ pts: [[0, 0], [w, 0]] }, ...fitBack(out, w).strokes], w };
    }
    case "narrow":
      return keep(transformStrokes(body, mul(translate(cx, 0), mul(scale(0.78, 1), translate(-cx, 0)))), w * 0.8);
    case "wide":
      return keep(transformStrokes(body, mul(translate(cx, 0), mul(scale(1.22, 1), translate(-cx, 0)))), w * 1.2);
    case "roundify":
      return keep(roundifyStrokes(body, Math.min(1, amount), !!ctx.joins));
    case "squarify":
      return keep(squarifyStrokes(body, !!ctx.joins));
    case "openTop":
      return keep(openTopStrokes(body));
    case "flags": {
      // Small flags at the tops of stems (Aramaic / Hebrew crowns, Latin serifs).
      if (ctx.headline) return shape;
      const dir = ctx.flagDir ?? -1;
      const out = cloneStrokes(body);
      const tops = endpoints(body)
        .filter((e) => e.p[1] < 0.2 && Math.abs(e.dir[1]) > 0.75)
        .sort((a, b) => a.p[1] - b.p[1])
        .slice(0, 2);
      for (const e of tops) {
        const [x, y] = e.p;
        out.push({ pts: [[x, y + 0.02], [x + dir * 0.03, y - 0.03], [x + dir * 0.13, y - 0.05]], smooth: 1 });
      }
      return tops.length ? keep(out) : shape;
    }
    case "startLoops": {
      // The pen begins with a small loop at the top-most free end (South Indian, Javanese hands).
      const out = cloneStrokes(body);
      const ends = endpoints(body).filter((e) => e.p[1] < 0.55);
      if (!ends.length) return shape;
      const e = ends.reduce((a, b) => (b.p[1] < a.p[1] ? b : a));
      const r = 0.065;
      const [x, y] = e.p;
      const cxl = x + e.dir[0] * r * 0.9;
      const cyl = y + e.dir[1] * r * 0.9;
      out.push({ pts: [[cxl - r, cyl], [cxl + r, cyl]], bend: [0.5, 0.5], closed: true });
      return keep(out);
    }
    case "tails": {
      // The lowest stem runs on below the line and turns (Aramaic final forms, Sogdian).
      const dir = ctx.flagDir ?? -1;
      const ends = endpoints(body).filter((e) => e.p[1] > 0.85 && e.p[1] < 1.1 && Math.abs(e.dir[1]) > 0.8 && e.dir[1] > 0);
      if (!ends.length) return shape;
      const e = ends.reduce((a, b) => (b.p[0] * -dir > a.p[0] * -dir ? b : a));
      const [x, y] = e.p;
      const out = cloneStrokes(body);
      out.push({ pts: [[x, y - 0.02], [x + e.dir[0] * 0.05, 1.22], [x + dir * 0.14, 1.4]], smooth: 1 });
      return keep(out);
    }
    case "rotateAll": {
      // Whole-sign rotation by 90° anticlockwise (as cuneiform turned in the second millennium BCE).
      const m = mul(translate(cx, 0.5), mul(rotate(-Math.PI / 2), translate(-cx, -cy)));
      let st = transformStrokes(body, m);
      const nb = strokesBBox(st);
      const h = nb.y1 - nb.y0;
      if (h > 1.05) st = transformStrokes(st, mul(translate(0, 0.5), mul(scale(1 / h, 1 / h), translate(-(nb.x0 + nb.x1) / 2 + 0.5 * h, -(nb.y0 + nb.y1) / 2))));
      const fb = strokesBBox(st);
      return keep(st, Math.max(0.35, fb.x1 - fb.x0 + 0.05));
    }
    case "close": {
      const out = cloneStrokes(body);
      const c = out.find((s) => !s.closed && !s.dot && s.pts.length >= 3 && Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 0.45);
      if (!c) return shape;
      c.closed = true;
      if (c.bend) c.bend.push(0);
      return keep(out);
    }
  }
}

/** Mutation weights given the descendant's tool and whether the tool changed. */
export function mutationWeights(from: Tool, to: Tool): [MutationOp, number][] {
  const soft = (t: Tool): boolean => t === "pen" || t === "brush" || t === "reed" || t === "needle";
  const w: [MutationOp, number][] = [
    ["jitter", 3],
    ["simplify", 1.2],
    ["lean", 0.8],
    ["stretch", 0.8],
    ["elongate", 0.5],
    ["addStroke", 0.6],
    ["reflect", 0.2],
    ["rotate", 0.15],
    ["open", 0.3],
    ["close", 0.2],
  ];
  if (soft(to)) w.push(["cursivize", from !== to && !soft(from) ? 3 : 0.8], ["loopify", to === "needle" || to === "brush" ? 0.5 : 0.2]);
  if (to === "knife") w.push(["deHorizontal", 2], ["angularize", 2]);
  if (to === "stylus" || to === "chisel") w.push(["angularize", to === "stylus" ? 2 : 0.8]);
  return w;
}
