/**
 * Glyph mutations used when scripts descend from one another: the kinds of
 * change real letters undergo — simplification, cursivisation, angular
 * re-cutting for new tools, losing horizontals on wood, rotation and
 * reflection, extra strokes, lengthened stems, slow drift of proportions.
 */
import type { Rng } from "../core/rng";
import type { Stroke, Tool } from "./types";
import type { Shape } from "./families";
import { cloneStrokes, mul, rotate, sampleRaw, scale, strokeLength, strokesBBox, transformStrokes, translate, type P } from "./geom";
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
  | "wide";

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
      const a = 0.04 * amount;
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
      const a = rng.normal(0, 0.12 * amount);
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
