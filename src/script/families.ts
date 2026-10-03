/**
 * Glyph design families: structural grammars that build glyph skeletons.
 *
 * Each script draws its glyphs from one family with its own parameters (a
 * random subset of the family's vocabulary, proportions, preferences), so
 * glyphs within a script share a "hand" while staying distinguishable.
 */
import type { Rng } from "../core/rng";
import type { Family, Stroke } from "./types";
import { circle, dot, line, poly, sampleRaw, smooth, type P } from "./geom";

export interface Shape {
  strokes: Stroke[];
  w: number;
  h?: number;
  entry?: P;
  exit?: P;
}

export interface GenCtx {
  /** Typical glyph width (style.width). */
  W: number;
  p: Record<string, number>;
  role: "consonant" | "vowel" | "syllable";
  /** 0..1: how much complexity the glyph set needs (big syllabaries → 1). */
  big: number;
  /** Tool restrictions. */
  noHorizontal: boolean;
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Points on an ellipse from angle a0 to a1 (y-down angles: 0 right, π/2 down). */
function arcPoints(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): P[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 4)));
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function openArc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Stroke {
  return smooth(arcPoints(cx, cy, rx, ry, a0, a1));
}

function ring(cx: number, cy: number, rx: number, ry = rx): Stroke {
  if (Math.abs(rx - ry) < 1e-6) return circle(cx, cy, rx);
  const pts = arcPoints(cx, cy, rx, ry, 0, TAU).slice(0, -1);
  return smooth(pts, undefined, true);
}

const J = (rng: Rng, a: number): number => rng.range(-a, a);

function jitterPts(rng: Rng, pts: P[], a: number): P[] {
  return pts.map((p) => [p[0] + J(rng, a), p[1] + J(rng, a)] as P);
}

function mirrorX(strokes: Stroke[], w: number): Stroke[] {
  return strokes.map((s) => {
    const o: Stroke = { ...s, pts: s.pts.map((p) => [w - p[0], p[1]] as P) };
    if (s.bend) o.bend = s.bend.map((b) => -b);
    return o;
  });
}

function mirrorY(strokes: Stroke[], y0: number, y1: number): Stroke[] {
  return strokes.map((s) => {
    const o: Stroke = { ...s, pts: s.pts.map((p) => [p[0], y0 + y1 - p[1]] as P) };
    if (s.bend) o.bend = s.bend.map((b) => -b);
    return o;
  });
}

/** Fit strokes (by node bbox) into a target box, preserving aspect if `keep`. */
export function fitStrokes(strokes: Stroke[], x0: number, y0: number, x1: number, y1: number, keep = false): Stroke[] {
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const s of strokes)
    for (const p of s.pts) {
      const r = s.dot ?? 0;
      bx0 = Math.min(bx0, p[0] - r);
      by0 = Math.min(by0, p[1] - r);
      bx1 = Math.max(bx1, p[0] + r);
      by1 = Math.max(by1, p[1] + r);
    }
  // circles extend beyond nodes
  const bw = Math.max(1e-6, bx1 - bx0);
  const bh = Math.max(1e-6, by1 - by0);
  let sx = (x1 - x0) / bw;
  let sy = (y1 - y0) / bh;
  if (bw < 0.05) sx = 1;
  if (bh < 0.05) sy = 1;
  if (keep) sx = sy = Math.min(sx, sy);
  const cx = (bx0 + bx1) / 2;
  const cy = (by0 + by1) / 2;
  const tx = (x0 + x1) / 2;
  const ty = (y0 + y1) / 2;
  return strokes.map((s) => {
    const o: Stroke = { ...s, pts: s.pts.map((p) => [tx + (p[0] - cx) * sx, ty + (p[1] - cy) * sy] as P) };
    if (s.dot !== undefined) o.dot = s.dot * Math.sqrt(Math.abs(sx * sy));
    return o;
  });
}

function weighted<T>(rng: Rng, items: [T, number][]): T {
  return rng.weighted(items);
}

// ---------------------------------------------------------------------------
// Family parameters
// ---------------------------------------------------------------------------

export function familyParams(rng: Rng, family: Family): Record<string, number> {
  const r = rng;
  const on = (p: number): number => (r.chance(p) ? r.range(0.4, 1) : 0);
  switch (family) {
    case "stave":
      return {
        left: r.range(0.45, 0.95),
        slope: r.range(0.55, 1.05),
        two: r.range(0.06, 0.2),
        free: r.range(0.08, 0.22),
        pocket: r.range(0.2, 0.7),
        cross: r.range(0.05, 0.4),
        reach: r.range(0.75, 1),
        bent: r.chance(0.3) ? 1 : 0,
      };
    case "geometric": {
      const p: Record<string, number> = {
        ring: on(0.7),
        square: on(0.5),
        tri: on(0.5),
        lines: on(0.85),
        cross: on(0.55),
        arc: on(0.6),
        zig: on(0.4),
        dots: on(0.55),
        fork: on(0.45),
        sym: r.range(0.45, 0.95),
        dotAdd: r.range(0, 0.5),
        stem: r.range(0, 0.45),
        tall: r.range(0, 1),
      };
      if (p.ring + p.square + p.tri + p.arc < 0.5) p.ring = 0.8;
      return p;
    }
    case "hanging":
      return {
        stem: r.range(0.45, 0.75),
        loop: r.range(0.15, 0.55),
        angular: r.chance(0.3) ? r.range(0.4, 1) : 0,
        curl: r.range(0.1, 0.45),
        nukta: r.range(0, 0.25),
        sx: r.range(0.78, 0.9),
        knot: r.range(0, 0.4),
        wob: r.range(0.02, 0.06),
      };
    case "round":
      return {
        circ: r.range(0, 1), // Burmese-like circle bias
        mean: r.range(0, 1), // meander bias
        asc: r.chance(0.5) ? r.range(0.1, 0.4) : 0,
        curl: r.range(0.1, 0.6),
        gap: r.range(0.2, 0.7),
        loop: r.range(0.1, 0.5),
        topHook: r.chance(0.4) ? r.range(0.2, 0.6) : 0,
        wave: r.range(0, 0.6),
      };
    case "square":
      return {
        roundCorner: r.range(0, 0.5),
        tick: r.range(0, 0.6),
        ext: r.range(0.1, 0.35),
        diag: r.range(0.1, 0.4),
        detached: r.range(0.1, 0.5),
        barY: r.range(0.03, 0.12),
        legX: r.range(0.82, 0.95),
        overhang: r.range(0, 0.15),
        mirror: r.chance(0.5) ? 1 : 0,
        legSlant: r.chance(0.4) ? r.range(-0.18, 0.18) : 0,
        foot: r.chance(0.45) ? r.range(0.3, 0.8) : 0,
        footDir: r.chance(0.5) ? 1 : -1,
        barCurve: r.chance(0.35) ? r.range(-0.08, 0.08) : 0,
      };
    case "cursive":
      return {
        tooth: r.range(0.38, 0.62),
        asc: r.range(-0.45, -0.2),
        loopR: r.range(0.12, 0.2),
        desc: r.range(1.3, 1.5),
        dotRate: r.range(0.5, 0.95),
        nonJoin: r.range(0.1, 0.3),
        swash: r.range(0, 1),
        slantTeeth: r.range(-0.15, 0.15),
      };
    case "wedge":
      return {
        horiz: r.range(0.3, 0.6),
        vert: r.range(0.2, 0.5),
        diag: r.range(0.05, 0.3),
        wink: r.range(0.1, 0.4),
        max: r.int(4, 6),
      };
    case "linear":
      return {
        stem: r.range(0.35, 0.8),
        sym: r.range(0.5, 0.95),
        ring: r.range(0, 1),
        chev: r.range(0, 1),
        cup: r.range(0, 1),
        bar: r.range(0.2, 1),
        legs: r.range(0, 1),
        box: r.range(0, 0.6),
        dots: r.range(0, 0.6),
        tiers: r.range(0.3, 0.9),
      };
    case "tally":
      return { across: r.range(0.3, 0.7), notch: r.chance(0.6) ? 1 : 0, spacing: r.range(0.13, 0.18) };
    case "featural":
      return { bar: r.range(0.5, 1), circ: r.range(0, 1), vstyle: r.weighted([[0, 0.45], [1, 0.35], [2, 0.2]] as [number, number][]) };
    case "syllabic":
      return { closed: r.range(0.1, 0.5), hook: r.range(0, 0.7), ringPart: r.range(0, 0.5) };
  }
}

// ---------------------------------------------------------------------------
// Stave (runic)
// ---------------------------------------------------------------------------

function genStave(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const W = c.W;
  const sl = p.slope;
  const u = rng.next();
  if (u < p.free) {
    // Staveless figures.
    const kind = weighted(rng, [
      ["chev", 1],
      ["diamond", 0.7],
      ["x", 0.6],
      ["zig", 0.7],
      ["diamondLegs", 0.4],
      ["smallChev", 0.5],
      ["bowtie", 0.3],
    ] as [string, number][]);
    const m = rng.chance(0.5);
    let st: Stroke[] = [];
    switch (kind) {
      case "chev":
        st = [poly([[W, 0.08], [0.05, 0.5], [W, 0.92]])];
        break;
      case "smallChev":
        st = [poly([[W * 0.85, 0], [W * 0.1, 0.32], [W * 0.85, 0.64]])];
        break;
      case "diamond":
        st = [poly([[W / 2, 0], [W, 0.5], [W / 2, 1], [0, 0.5]], undefined, true)];
        break;
      case "x":
        st = [line(0, 0, W, 1), line(W, 0, 0, 1)];
        break;
      case "zig":
        st = [poly([[W * 0.85, 0], [W * 0.1, 0.32], [W * 0.9, 0.68], [W * 0.15, 1]])];
        break;
      case "diamondLegs":
        st = [poly([[W / 2, 0], [W, 0.4], [W / 2, 0.8], [0, 0.4]], undefined, true), line(W / 2, 0.8, 0, 1), line(W / 2, 0.8, W, 1)];
        st = [poly([[W / 2, 0], [W * 0.95, 0.35], [0.05 * W, 0.75], [0, 1]]), poly([[W / 2, 0], [W * 0.05, 0.35], [W * 0.95, 0.75], [W, 1]])];
        break;
      case "bowtie":
        st = [poly([[0, 0.1], [W, 0.9], [W, 0.1], [0, 0.9]], undefined, true)];
        break;
    }
    return { strokes: m ? mirrorX(st, W) : st, w: W };
  }
  if (u < p.free + p.two) {
    const Wd = W * 1.35;
    const kind = weighted(rng, [
      ["X", 1],
      ["V", 1],
      ["diag", 1],
      ["N", 0.8],
      ["M", 0.5],
    ] as [string, number][]);
    const st: Stroke[] = [line(0, 0, 0, 1), line(Wd, 0, Wd, 1)];
    switch (kind) {
      case "X":
        st.push(line(0, 0, Wd, 1), line(Wd, 0, 0, 1));
        break;
      case "V":
        st.push(poly([[0, 0], [Wd / 2, 0.4 + J(rng, 0.08)], [Wd, 0]]));
        break;
      case "diag":
        st.push(line(0, 0.28, Wd, 0.62));
        break;
      case "N":
        st[1] = line(Wd, 0.32, Wd, 1);
        st.push(line(0, 0, Wd, 0.32));
        break;
      case "M":
        st.push(poly([[0, 0], [Wd / 2, 0.45], [Wd, 0]]), line(Wd / 2, 0.45, Wd / 2, 1));
        break;
    }
    return { strokes: st, w: Wd };
  }
  const left = rng.chance(p.left);
  const sx = left ? 0 : W / 2;
  const R = (left ? W : W / 2) * p.reach;
  const st: Stroke[] = [line(sx, 0, sx, 1)];
  const used = new Set<string>();
  const nb = 1 + (rng.chance(0.55) ? 1 : 0) + (rng.chance(0.15 + c.big * 0.25) ? 1 : 0);
  let added = 0;
  for (let tries = 0; added < nb && tries < 12; tries++) {
    const side = left ? 1 : rng.chance(0.5) ? 1 : -1;
    const kind = weighted(rng, [
      ["flag", 1],
      ["flagUp", 0.35],
      ["pocket", p.pocket * 1.5],
      ["leg", 0.5],
      ["cross", left ? 0 : p.cross * 2],
      ["arrow", left ? 0.05 : 0.5],
      ["fork", left ? 0.05 : 0.45],
      ["hook", p.bent ? 0.6 : 0.1],
    ] as [string, number][]);
    const y = rng.pick([0, 0, 0.25, 0.5]);
    const key = `${kind === "arrow" || kind === "fork" || kind === "cross" ? 0 : side}:${y}`;
    if (used.has(key)) continue;
    let s: Stroke | null = null;
    switch (kind) {
      case "flag": {
        const dy = Math.min(0.55, sl * R);
        if (y + dy > 1.02) continue;
        s = line(sx, y, sx + side * R, y + dy);
        break;
      }
      case "flagUp": {
        const y0 = y + 0.45;
        const dy = Math.min(0.5, sl * R);
        if (y0 - dy < -0.02) continue;
        s = line(sx, y0, sx + side * R, y0 - dy);
        used.add(`${side}:${y0}`);
        break;
      }
      case "pocket": {
        const h = rng.pick([0.4, 0.5]);
        if (y + h > 1.01) continue;
        s = poly([[sx, y], [sx + side * R * 0.9, y + h / 2], [sx, y + h]]);
        used.add(`${side}:${y + 0.25}`);
        break;
      }
      case "leg": {
        const y0 = y < 0.4 ? 0.5 : y;
        if (used.has(`${side}:${y0}`)) continue;
        s = line(sx, y0, sx + side * R, 1);
        used.add(`${side}:${y0}`);
        break;
      }
      case "cross": {
        const yc = 0.3 + rng.next() * 0.4;
        const d = sl * R * 0.5;
        s = line(sx - R * 0.85, yc - d, sx + R * 0.85, yc + d);
        if (rng.chance(0.5)) s = line(sx - R * 0.85, yc + d, sx + R * 0.85, yc - d);
        break;
      }
      case "arrow": {
        const d = Math.min(0.45, sl * R * 0.9);
        s = poly([[sx - R * 0.9, d], [sx, 0], [sx + R * 0.9, d]]);
        used.add("1:0").valueOf();
        used.add("-1:0");
        break;
      }
      case "fork": {
        const y0 = y < 0.3 ? 0.45 : y + 0.2;
        const d = Math.min(0.45, sl * R * 0.9);
        s = poly([[sx - R * 0.9, y0 - d], [sx, y0], [sx + R * 0.9, y0 - d]]);
        used.add("1:0");
        used.add("-1:0");
        break;
      }
      case "hook": {
        const dy = Math.min(0.35, sl * R * 0.6);
        if (y + 2 * dy > 1.02) continue;
        s = poly([[sx, y], [sx + side * R * 0.85, y + dy], [sx + side * R * 0.85, y + dy + 0.3]]);
        break;
      }
    }
    if (!s) continue;
    used.add(key);
    st.push(s);
    added++;
  }
  // Some staves are shortened (ᛁ-like letters stay full).
  let strokes = st;
  if (left && rng.chance(0.12)) strokes = mirrorX(st, W);
  return { strokes, w: W };
}

// ---------------------------------------------------------------------------
// Geometric (Tifinagh, Old South Arabian, Phoenician monumental)
// ---------------------------------------------------------------------------

type Box = [number, number, number, number];

function geoPrimitive(rng: Rng, kind: string, b: Box, noH: boolean): Stroke[] {
  const [x0, y0, x1, y1] = b;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = x1 - x0;
  const h = y1 - y0;
  const rx = w / 2;
  const ry = h / 2;
  switch (kind) {
    case "ring":
      return [ring(cx, cy, Math.min(rx, ry * 1.1), Math.min(ry, rx * 1.25))];
    case "square":
      return [poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], undefined, true)];
    case "triUp":
      return [poly([[cx, y0], [x1, y1], [x0, y1]], undefined, true)];
    case "triDown":
      return [poly([[x0, y0], [x1, y0], [cx, y1]], undefined, true)];
    case "triSide":
      return [poly([[x0, y0], [x1, cy], [x0, y1]], undefined, true)];
    case "diamond":
      return [poly([[cx, y0], [x1, cy], [cx, y1], [x0, cy]], undefined, true)];
    case "vline":
      return [line(cx, y0, cx, y1)];
    case "hlines":
      return noH ? [line(x0, y0 + h * 0.3, x1, y0 + h * 0.1), line(x0, y1 - h * 0.1, x1, y1 - h * 0.3)] : [line(x0, y0 + h * 0.2, x1, y0 + h * 0.2), line(x0, y1 - h * 0.2, x1, y1 - h * 0.2)];
    case "vlines":
      return [line(x0 + w * 0.15, y0, x0 + w * 0.15, y1), line(x1 - w * 0.15, y0, x1 - w * 0.15, y1)];
    case "plus":
      return noH ? [line(cx, y0, cx, y1), line(x0, cy + h * 0.15, x1, cy - h * 0.15)] : [line(cx, y0, cx, y1), line(x0, cy, x1, cy)];
    case "saltire":
      return [line(x0, y0, x1, y1), line(x1, y0, x0, y1)];
    case "arcL":
      return [openArc(cx + rx * 0.35, cy, rx * 1.1, ry, Math.PI * 0.5 - 0.05 + Math.PI * 0, Math.PI * 1.5 + 0.05)].map((s) => s);
    case "arcR":
      return [openArc(cx - rx * 0.35, cy, rx * 1.1, ry, -Math.PI * 0.5 - 0.05, Math.PI * 0.5 + 0.05)];
    case "cup":
      return [openArc(cx, cy - ry * 0.35, rx, ry * 1.1, 0, Math.PI)];
    case "cap":
      return [openArc(cx, cy + ry * 0.35, rx, ry * 1.1, Math.PI, TAU)];
    case "zigN":
      return [poly([[x0, y1], [x0, y0], [x1, y1], [x1, y0]])];
    case "zigZ":
      return noH ? [poly([[x0, y0 + h * 0.15], [x1, y0], [x0, y1], [x1, y1 - h * 0.15]])] : [poly([[x0, y0], [x1, y0], [x0, y1], [x1, y1]])];
    case "zigM":
      return [poly([[x0, y1], [x0 + w * 0.25, y0], [cx, y1 - h * 0.35], [x1 - w * 0.25, y0], [x1, y1]])];
    case "zigW":
      return [poly([[x0, y0], [x0 + w * 0.25, y1], [cx, y0 + h * 0.35], [x1 - w * 0.25, y1], [x1, y0]])];
    case "zigSig":
      return [poly([[x1, y0], [x0, y0 + h * 0.1], [cx, cy], [x0, y1 - h * 0.1], [x1, y1]])];
    case "forkY":
      return [poly([[x0, y0], [cx, cy], [x1, y0]]), line(cx, cy, cx, y1)];
    case "forkPsi":
      return [poly([[x0, y0], [x0 + w * 0.1, cy - h * 0.05], [cx, cy + h * 0.05], [x1 - w * 0.1, cy - h * 0.05], [x1, y0]]), line(cx, y0, cx, y1)];
    case "chevV":
      return [poly([[x0, y0], [cx, y1], [x1, y0]])];
    case "chevA":
      return [poly([[x0, y1], [cx, y0], [x1, y1]])];
    case "chevL":
      return [poly([[x1, y0], [x0, cy], [x1, y1]])];
    case "hourglass":
      return [poly([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], undefined, true)];
    case "ladder":
      return noH ? [line(x0 + w * 0.2, y0, x0 + w * 0.2, y1), line(x1 - w * 0.2, y0, x1 - w * 0.2, y1), line(x0 + w * 0.2, cy + 0.1, x1 - w * 0.2, cy - 0.1)] : [line(x0 + w * 0.2, y0, x0 + w * 0.2, y1), line(x1 - w * 0.2, y0, x1 - w * 0.2, y1), line(x0 + w * 0.2, cy, x1 - w * 0.2, cy)];
    case "comb":
      return [poly([[x1, y0], [x0, y0], [x0, y1], [x1, y1]]), line(x0, cy, x1 - w * 0.15, cy)];
    case "bracket":
      return [poly([[x1, y0], [x0, y0], [x0, y1], [x1, y1]])];
    case "angle":
      return [poly([[x0, y0], [x0, y1], [x1, y1]])];
    case "dots2h":
      return [dot(x0 + w * 0.25, cy, 0.06), dot(x1 - w * 0.25, cy, 0.06)];
    case "dots2v":
      return [dot(cx, y0 + h * 0.25, 0.06), dot(cx, y1 - h * 0.25, 0.06)];
    case "dots3":
      return [dot(cx, y0 + h * 0.2, 0.06), dot(x0 + w * 0.2, y1 - h * 0.2, 0.06), dot(x1 - w * 0.2, y1 - h * 0.2, 0.06)];
    case "dots4":
      return [dot(x0 + w * 0.22, y0 + h * 0.22, 0.06), dot(x1 - w * 0.22, y0 + h * 0.22, 0.06), dot(x0 + w * 0.22, y1 - h * 0.22, 0.06), dot(x1 - w * 0.22, y1 - h * 0.22, 0.06)];
    case "dots5":
      return [...geoPrimitive(rng, "dots4", b, noH), dot(cx, cy, 0.06)];
  }
  return [line(cx, y0, cx, y1)];
}

function genGeometric(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const W = c.W;
  const noH = c.noHorizontal;
  const kinds: [string, number][] = [
    ["ring", p.ring * 1.2],
    ["square", p.square],
    ["triUp", p.tri * 0.6],
    ["triDown", p.tri * 0.5],
    ["triSide", p.tri * 0.4],
    ["diamond", (p.tri + p.square) * 0.35],
    ["vline", p.lines * 0.3],
    ["hlines", p.lines * 0.45],
    ["vlines", p.lines * 0.35],
    ["plus", p.cross * 0.8],
    ["saltire", p.cross * 0.8],
    ["arcL", p.arc * 0.6],
    ["arcR", p.arc * 0.6],
    ["cup", p.arc * 0.6],
    ["cap", p.arc * 0.5],
    ["zigN", p.zig * 0.15],
    ["zigZ", p.zig * 0.2],
    ["zigM", p.zig * 0.15],
    ["zigW", p.zig * 0.15],
    ["zigSig", p.zig * 0.3],
    ["forkY", p.fork * 0.6],
    ["forkPsi", p.fork * 0.5],
    ["chevV", (p.tri + p.zig) * 0.25],
    ["chevA", (p.tri + p.zig) * 0.25],
    ["chevL", (p.tri + p.zig) * 0.2],
    ["hourglass", p.tri * 0.3],
    ["ladder", p.lines * 0.25],
    ["comb", p.square * 0.15],
    ["bracket", p.square * 0.5],
    ["angle", p.square * 0.3],
    ["dots2h", p.dots * 0.1],
    ["dots3", p.dots * 0.12],
    ["dots4", p.dots * 0.06],
    ["dots5", p.dots * 0.03],
  ];
  const base = weighted(rng, kinds);
  const tall = p.tall > 0.5;
  const Wb = base.startsWith("dots") ? W * 0.8 : W;
  const box: Box = [0, 0, Wb, 1];
  const comp = rng.next();
  let st: Stroke[] = [];
  const stacked = comp < 0.16 + c.big * 0.38 && !base.startsWith("dots");
  const paired = !stacked && comp < 0.18 + c.big * 0.5 && !base.startsWith("dots");
  if (paired) {
    // A small primitive attached to the side of a main one, sharing its stem line
    // (big sign sets need compounds; side by side they must still read as one sign).
    const k2 = weighted(rng, kinds.filter((k) => !k[0].startsWith("dots") && k[0] !== base && k[0] !== "ring"));
    const mw = W * 0.8;
    const sw = W * 0.42;
    const y0 = rng.pick([0, 0.3, 0.55]);
    st = [...geoPrimitive(rng, base, [0, 0, mw, 1], noH), line(mw, y0 + 0.22, mw + 0.06, y0 + 0.22), ...geoPrimitive(rng, k2, [mw + 0.06, y0, mw + 0.06 + sw, y0 + 0.45], noH)];
    const w = mw + 0.06 + sw;
    return { strokes: rng.chance(0.5) ? mirrorX(st, w) : st, w };
  }
  if (stacked) {
    // Two primitives stacked, or a primitive on a stem.
    const k2 = weighted(rng, kinds.filter((k) => !k[0].startsWith("dots")));
    const top = tall ? 0.5 : 0.45;
    if (rng.chance(0.5)) {
      st = [...geoPrimitive(rng, base, [W * 0.18, 0, W * 0.82, top], noH), ...geoPrimitive(rng, k2, [W * 0.1, top + 0.08, W * 0.9, 1], noH)];
    } else {
      st = [...geoPrimitive(rng, base, [W * 0.1, 0, W * 0.9, 0.55], noH), line(W / 2, 0.55, W / 2, 1)];
    }
  } else {
    st = geoPrimitive(rng, base, box, noH);
  }
  // Modifiers.
  const closedish = ["ring", "square", "triUp", "triDown", "diamond", "triSide"].includes(base);
  const m = rng.next();
  if (closedish && m < 0.3 + p.dotAdd * 0.4) st.push(dot(Wb / 2, base === "triUp" ? 0.66 : base === "triDown" ? 0.34 : 0.5, 0.06));
  else if (closedish && m < 0.55) {
    if (rng.chance(0.5)) st.push(line(Wb / 2, -0.08, Wb / 2, 1.08));
    else if (!noH) st.push(line(-0.08, 0.5, Wb + 0.08, 0.5));
    else st.push(line(Wb / 2, 0.15, Wb / 2, 0.85));
  } else if (m < 0.55 + p.dotAdd * 0.5) {
    const where = rng.int(0, 3);
    if (where === 0) st.push(dot(Wb + 0.14, 0.5, 0.06));
    else if (where === 1) st.push(dot(-0.14, 0.5, 0.06), dot(Wb + 0.14, 0.5, 0.06));
    else if (where === 2) st.push(dot(Wb / 2, -0.2, 0.06));
    else st.push(dot(Wb / 2, 1.2, 0.06));
  } else if (m < 0.7 + p.stem * 0.3 && !stacked && rng.chance(p.stem)) {
    // Long stem through or below (South Arabian feel).
    st = [...fitStrokes(st, Wb * 0.1, 0.0, Wb * 0.9, 0.62), line(Wb / 2, 0.62, Wb / 2, 1)];
  }
  // Symmetry tendency: mirror asymmetrical ones randomly to vary handedness.
  if (rng.chance(0.5)) st = mirrorX(st, Wb);
  if (rng.chance(0.2)) st = mirrorY(st, 0, 1);
  return { strokes: st, w: Wb };
}

// ---------------------------------------------------------------------------
// Hanging (Brahmic): bodies hang from a headline; right stems; bowls & loops
// ---------------------------------------------------------------------------

type Mk = (pts: P[], sharp?: number[]) => Stroke;

/**
 * Brahmic-style letters: a body hanging from the headline (cup, bowl, loop,
 * double curve, hook, ring…) usually joined to a right-hand stem, plus an
 * optional secondary element (top loop, slash, crossbar, curl beside the stem,
 * foot) — the way Devanagari letters are assembled from a small kit of parts.
 */
function genHanging(rng: Rng, c: GenCtx): Shape {
  const base = genHangingLetter(rng, c);
  // Large sign sets need more forms: conjunct-like compounds, a half-form
  // (the body without its stem) squeezed in front of a full letter.
  if (rng.chance(c.big * 0.35)) {
    const first = genHangingLetter(rng, { ...c, big: 0 });
    const sx = first.w * c.p.sx;
    const body = first.strokes.filter((s) => !(s.pts.length === 2 && Math.abs(s.pts[0][0] - sx) < 0.02 && Math.abs(s.pts[1][0] - sx) < 0.02));
    const half = fitStrokes(body, 0, 0.0, first.w * 0.48, 0.72);
    const k = 0.92;
    const second = base.strokes.map((s) => ({ ...s, pts: s.pts.map((q) => [first.w * 0.42 + q[0] * k, q[1]] as P) }));
    return { strokes: [...half, ...second], w: first.w * 0.42 + base.w * k };
  }
  if (rng.chance(c.big * 0.5)) {
    // A second distinguishing element: a nukta-like dot or a small loop at the foot.
    const W = base.w;
    const extra = rng.chance(0.5) ? dot(W * 0.3, 1.2, 0.055) : smooth([[W * 0.55, 0.92], [W * 0.38, 1.12], [W * 0.18, 1.0]]);
    return { ...base, strokes: [...base.strokes, extra] };
  }
  return base;
}

function genHangingLetter(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const W = c.W * rng.range(0.92, 1.12);
  const sx = W * p.sx;
  const L = W * 0.08;
  const bodyR = sx - W * 0.1;
  const mid = (L + bodyR) / 2;
  const wob = p.wob;
  const angular = rng.chance(p.angular);
  const mk: Mk = (pts, sharp) => (angular ? poly(jitterPts(rng, pts, wob)) : smooth(jitterPts(rng, pts, wob), sharp));
  const st: Stroke[] = [];
  const allowed = (p.seedMask ?? 0xffff) >>> 0;
  const prim: [string, number][] = (
    [
      ["cup", 1],
      ["bowl", 1],
      ["loop", 0.6 + p.loop],
      ["three", 0.5],
      ["hook", 0.6],
      ["ring", 0.4],
      ["zig", 0.3 + p.angular],
      ["tick", 0.5],
      ["eye", 0.5],
      ["wave", 0.4],
      ["spiral", 0.3 + p.curl],
      ["ess", 0.4],
    ] as [string, number][]
  ).filter((_, i) => (allowed >> i) & 1);
  const kind = weighted(rng, prim.length >= 4 ? prim : [["cup", 1], ["bowl", 1], ["loop", 1], ["hook", 1]]);
  const depth = rng.range(0.5, 0.78);
  let stem = true;
  let free: P | null = null; // free end for a terminal curl
  switch (kind) {
    case "cup": // प
      st.push(mk([[L + W * 0.06, 0], [L, depth * 0.55], [L + W * 0.1, depth], [mid, depth + 0.04], [sx, depth - 0.04]]));
      break;
    case "bowl": // ब
      st.push(mk([[sx, 0.2], [L + W * 0.04, 0.32], [L + W * 0.12, 0.82], [mid + W * 0.05, 0.92], [sx, 0.74]]));
      break;
    case "loop": // क-like knot
      st.push(mk([[mid, 0], [mid, 0.32], [L + W * 0.12, 0.7], [L, 0.48], [L + W * 0.2, 0.34], [mid + W * 0.08, 0.52], [sx, 0.55]]));
      break;
    case "three": // ड / ३
      stem = rng.chance(0.25);
      st.push(mk([[L + W * 0.05, 0.08], [mid + W * 0.15, 0.14], [mid + W * 0.08, 0.42], [mid - W * 0.12, 0.5], [mid + W * 0.2, 0.68], [mid + W * 0.05, 0.96], [L, 0.86]]));
      free = [L, 0.86];
      break;
    case "hook": // ट
      stem = rng.chance(0.2);
      st.push(mk([[mid, 0], [mid, 0.3], [bodyR, 0.6], [mid, 0.96], [L + W * 0.05, 0.78]]));
      free = [L + W * 0.05, 0.78];
      break;
    case "ring": // ठ
      stem = rng.chance(0.35);
      st.push(line(mid, 0, mid, 0.18), ring(mid, 0.5, Math.min(0.3, (bodyR - L) / 2), 0.32));
      break;
    case "zig":
      st.push(poly(jitterPts(rng, [[L, 0.04], [mid + W * 0.08, 0.42], [L, 0.84], [sx, 0.84]], wob)));
      break;
    case "tick": // ग
      st.push(mk([[L + W * 0.18, 0], [L + W * 0.18, 0.62], [L, 0.8]]));
      break;
    case "eye": // closed body against the stem
      st.push(mk([[sx, 0.45], [mid, 0.3], [L, 0.62], [mid, 0.95], [sx, 0.8]]));
      break;
    case "wave": // humped body
      st.push(mk([[L, 0.3], [L + W * 0.12, 0.08], [mid, 0.4], [bodyR - W * 0.05, 0.12], [sx, 0.4]]));
      break;
    case "spiral": // curl hanging at lower left
      st.push(mk([[mid + W * 0.08, 0], [mid, 0.4], [L, 0.75], [mid - W * 0.05, 0.95], [mid + W * 0.1, 0.78], [mid - W * 0.05, 0.65]]));
      stem = rng.chance(0.6);
      break;
    case "ess":
      stem = rng.chance(0.3);
      st.push(mk([[bodyR, 0.1], [L + W * 0.1, 0.25], [mid, 0.5], [bodyR, 0.75], [L + W * 0.05, 0.92]]));
      free = [L + W * 0.05, 0.92];
      break;
  }
  if (stem) {
    const foot = rng.chance(0.15);
    st.push(foot ? smooth([[sx, 0], [sx, 0.88], [sx - W * 0.12, 1.02]]) : line(sx, 0, sx, rng.chance(0.15) ? 0.7 : 1));
  }
  // Terminal curl on a free end.
  if (free && rng.chance(p.curl)) {
    const [x, y] = free;
    st.push(ring(x - 0.07, y - 0.02, 0.075));
  }
  // Secondary element.
  const sec = rng.next();
  const big = c.big * 0.3;
  if (sec < 0.18 + big) {
    // loop touching the headline at the top-left
    st.push(ring(L + W * 0.12, 0.17, 0.1));
  } else if (sec < 0.32 + big && stem) {
    // curl beside the stem (फ)
    st.push(smooth([[sx, 0.22], [sx + W * 0.2, 0.2], [sx + W * 0.2, 0.46], [sx + W * 0.02, 0.48]]));
  } else if (sec < 0.44 + big) {
    // slash across the body (ष)
    st.push(line(L + W * 0.05, 0.62, mid + W * 0.12, 0.18));
  } else if (sec < 0.54 + big && stem) {
    // crossbar from the stem
    st.push(line(mid, 0.45, sx, 0.45));
  } else if (sec < 0.62 + big && stem) {
    // tail curling from the stem foot
    st.push(smooth([[sx, 0.78], [sx + W * 0.12, 1.05], [sx - W * 0.25, 1.14]]));
  }
  if (rng.chance(p.nukta)) st.push(dot(mid, 1.2, 0.055));
  return { strokes: st, w: W };
}

// ---------------------------------------------------------------------------
// Round (Burmese, Javanese, Georgian, Sinhala)
// ---------------------------------------------------------------------------

/**
 * Round scripts (Burmese, Javanese, Sinhala, Georgian, Telugu): glyphs drawn
 * mostly in one continuous pen path built from circular "units" — open
 * circles, cups, caps — of a common radius, with curls at the start, tails,
 * inner marks and top ticks.
 */
function genRound(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const r = 0.44;
  const two = rng.chance(0.22 + p.wave * 0.3 + c.big * 0.15);
  const W = two ? c.W * 1.45 : c.W * rng.range(0.88, 1.05);
  const pts: P[] = [];
  const st: Stroke[] = [];
  const unitW = two ? W / 2 : W;
  const rx = Math.min(r, unitW / 2) * 0.96;
  const ry = r;
  // Gap direction (angle in y-down coords) of the open circle.
  const gapDirs = [-Math.PI / 2, Math.PI / 2, 0, Math.PI, -Math.PI / 4, -Math.PI * 0.75, Math.PI / 4];
  const unit = (cx: number, dirIdx: number, gapSize: number, reverse: boolean): P[] => {
    const g = gapDirs[dirIdx];
    const a0 = g + gapSize / 2;
    const a1 = g + TAU - gapSize / 2;
    const ptsU = arcPoints(cx, 0.5, rx, ry, a0, a1);
    return reverse ? ptsU.reverse() : ptsU;
  };
  const gapSize = 0.55 + p.gap * 1.6;
  if (!two) {
    const d = rng.int(0, gapDirs.length - 1);
    pts.push(...unit(W / 2, d, gapSize * rng.range(0.7, 1.3), rng.chance(0.5)));
  } else {
    // Two lobes joined in one stroke (ω, m, ɷ…).
    const kind = rng.int(0, 2);
    if (kind === 0) {
      // caps (m-like humps)
      pts.push(...arcPoints(unitW / 2, 0.5, rx, ry, Math.PI * 0.8, Math.PI * 2.2));
      pts.push(...arcPoints(unitW * 1.5, 0.5, rx, ry, Math.PI * 0.8, Math.PI * 2.2).slice(1));
    } else if (kind === 1) {
      // cups (ω-like)
      pts.push(...arcPoints(unitW / 2, 0.5, rx, ry, Math.PI * 1.2, -Math.PI * 0.2));
      pts.push(...arcPoints(unitW * 1.5, 0.5, rx, ry, Math.PI * 1.2, -Math.PI * 0.2).slice(1));
    } else {
      // open circle + small lobe (Burmese-like pair)
      pts.push(...unit(unitW / 2, rng.pick([0, 2, 3]), gapSize, false));
      const e = pts[pts.length - 1];
      pts.push([e[0] + 0.1, e[1] + 0.1], ...arcPoints(unitW * 1.5, 0.62, rx * 0.8, ry * 0.75, Math.PI, Math.PI * 2.6).slice(1));
    }
  }
  // Start curl: a small inward spiral at the beginning of the stroke.
  if (rng.chance(p.curl)) {
    const s0 = pts[0];
    const s1 = pts[1];
    const cx = W / 2;
    const toC: P = [cx - s0[0], 0.5 - s0[1]];
    const l = Math.hypot(toC[0], toC[1]) || 1;
    const k = 0.13;
    const q: P = [s0[0] + (toC[0] / l) * k, s0[1] + (toC[1] / l) * k];
    // curl: from inside point loop back to s0
    const dir: P = [s1[0] - s0[0], s1[1] - s0[1]];
    const m: P = [q[0] - dir[0] * 0.6, q[1] - dir[1] * 0.6];
    pts.unshift(q, m);
    pts.unshift([q[0] + (s0[0] - q[0]) * 0.2 + dir[0] * 0.3, q[1] + (s0[1] - q[1]) * 0.2 + dir[1] * 0.3]);
  }
  // Tail: ascender, descender or a flick at the end.
  const tail = rng.next();
  const e = pts[pts.length - 1];
  if (tail < p.asc) {
    const up = e[1] < 0.5 || rng.chance(0.4);
    pts.push([e[0] + (rng.next() - 0.5) * 0.1, up ? -0.42 : 1.42]);
  } else if (tail < p.asc + 0.25) {
    const ex = e[0] + (e[0] < W / 2 ? -0.12 : 0.12);
    pts.push([ex, e[1] + (e[1] < 0.5 ? -0.08 : 0.1)]);
  }
  st.push(smooth(pts));
  // Inner element / top tick / terminal loop.
  const extra = rng.next();
  const ccx = two ? (rng.chance(0.5) ? unitW / 2 : unitW * 1.5) : W / 2;
  if (extra < 0.2) st.push(ring(ccx, 0.5, 0.11));
  else if (extra < 0.32) st.push(dot(ccx, 0.5, 0.06));
  else if (extra < 0.44) st.push(smooth([[ccx - 0.04, 0.3], [ccx + 0.04, 0.55], [ccx - 0.02, 0.8]]));
  if (rng.chance(p.topHook)) st.push(smooth([[ccx - 0.16, -0.06], [ccx - 0.06, -0.16], [ccx + 0.02, -0.04], [ccx + 0.14, -0.22]]));
  if (rng.chance(p.loop * 0.5)) {
    const end = st[0].pts[st[0].pts.length - 1];
    st.push(ring(end[0] + (end[0] < W / 2 ? -0.06 : 0.06), end[1], 0.065));
  }
  let strokes = st;
  if (rng.chance(0.3)) strokes = mirrorX(strokes, W);
  return { strokes, w: W };
}

// ---------------------------------------------------------------------------
// Square (Hebrew / Aramaic)
// ---------------------------------------------------------------------------

function genSquare(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const narrow = rng.chance(0.1);
  const W = narrow ? c.W * 0.42 : c.W * rng.range(0.9, 1.1);
  const ty = p.barY;
  const lx = W * 0.08;
  const rx = narrow ? W * 0.75 : W * p.legX;
  const bot = 0.97;
  const st: Stroke[] = [];
  const slant = p.legSlant;
  const roundC = rng.chance(p.roundCorner);
  // Script habits: slanted legs ending in feet, slightly bowed bars.
  const leg = (x: number, y0: number, y1: number): P[] => {
    const pts: P[] = [[x, y0], [x + slant * (y1 - y0), y1]];
    return pts;
  };
  const withFoot = (pts: P[]): P[] => {
    if (!rng.chance(p.foot)) return pts;
    const e = pts[pts.length - 1];
    return [...pts, [e[0] + p.footDir * W * 0.16, e[1] + 0.02]];
  };
  const path = (pts: P[]): Stroke => (roundC ? smooth(pts, []) : poly(pts));
  const bar = (x0: number, x1: number, y: number): Stroke => {
    const s = line(x0, y, x1, y);
    if (p.barCurve) s.bend = [p.barCurve * (rng.chance(0.5) ? 1 : 0.6)];
    return s;
  };
  if (narrow) {
    const k = rng.int(0, 3);
    if (k === 0) st.push(path(withFoot([[0, ty], [rx, ty], ...leg(rx, ty, 1).slice(1)])));
    else if (k === 1) st.push(bar(0, W, ty), path(withFoot(leg(W / 2, ty, 1))));
    else if (k === 2) st.push(path([[0, ty], [rx, ty], [rx, 0.45]]));
    else st.push(path(withFoot(leg(W / 2, -0.35, 1))), line(W / 2, 0.3, W, 0.15));
    return { strokes: p.mirror ? mirrorX(st, W) : st, w: W };
  }
  const structure = weighted(rng, [
    ["TR", 1],
    ["TRB", 1],
    ["TRl", 0.8],
    ["TRL", 0.7],
    ["box", 0.45],
    ["UB", 0.6],
    ["diag", p.diag * 2],
    ["arms", 0.5],
    ["Y", 0.5],
    ["asc", p.ext * 2],
    ["desc", p.ext * 2],
    ["TL", 0.5],
    ["LB", 0.6],
    ["Z", 0.4],
    ["hook", 0.5],
    ["mid", 0.5],
    ["fork", 0.4],
  ] as [string, number][]);
  const top = ty;
  const ox = W * p.overhang;
  switch (structure) {
    case "TR":
      st.push(path(withFoot([[lx - ox, top], ...leg(rx, top, bot)])));
      break;
    case "TRB":
      st.push(path([[lx, top], ...leg(rx, top, bot)]), bar(lx - ox, W + W * 0.06, bot));
      break;
    case "TRl":
      st.push(path(withFoot([[lx - ox, top], ...leg(rx, top, bot)])), path(leg(lx + W * 0.06, 0.4, bot)));
      break;
    case "TRL":
      st.push(path([[lx, bot], [lx, top], ...leg(rx, top, bot)]));
      break;
    case "box":
      st.push(roundC ? smooth([[lx, top], [rx, top], [rx, bot], [lx, bot]], [], true) : poly([[lx, top], [rx, top], [rx, bot], [lx, bot]], undefined, true));
      break;
    case "UB":
      st.push(path([[lx, top], [lx, bot], [rx, bot], [rx, top + 0.2]]));
      if (rng.chance(0.6)) st.push(poly([[lx + W * 0.25, top + 0.05], [rx * 0.7, 0.45]]));
      break;
    case "diag":
      st.push(line(lx, top, rx, bot), line(rx, top, rx * 0.72, 0.45), line(lx + W * 0.2, 0.55, lx, bot));
      break;
    case "arms":
      st.push(path([[lx, top], [lx + W * 0.1, bot], [rx, bot], [rx, top]]), line(W * 0.48, top, W * 0.38, 0.6));
      break;
    case "Y":
      st.push(line(lx, top, W * 0.55, 0.7), poly([[rx, top], [W * 0.5, 0.75], [lx - ox, bot]]));
      break;
    case "asc":
      st.push(path([[lx, -0.42], [lx, top + 0.25], [rx, top + 0.25], [rx, 0.62], [W * 0.45, bot]]));
      break;
    case "desc":
      st.push(path([[lx, top], [rx, top], [rx, 0.6]]), path(withFoot(leg(lx + W * 0.1, 0.35, 1.42))));
      break;
    case "TL":
      st.push(path(withFoot([[rx + ox, top], ...leg(lx, top, bot)])));
      if (rng.chance(0.5)) st.push(path(leg(rx * 0.8, 0.4, bot)));
      break;
    case "LB":
      st.push(path([[lx, top], [lx + W * 0.08, bot], [rx + ox, bot]]), line(rx, top, W * 0.4, 0.55));
      break;
    case "Z":
      st.push(path([[lx, top], [rx, top], [lx, bot], [rx + ox, bot]]));
      break;
    case "hook":
      st.push(smooth([[lx, top + 0.1], [rx * 0.6, top], [rx, 0.3], [rx, 0.75], [rx * 0.55, bot], [lx, 0.8]]));
      break;
    case "mid":
      st.push(path(withFoot(leg(rx, top, bot))), bar(lx, rx, 0.48), path(leg(lx, top, 0.48)));
      break;
    case "fork":
      st.push(path([[lx, top], [W * 0.5, 0.5], [rx, top]]), path(withFoot(leg(W * 0.5, 0.5, bot))));
      break;
  }
  // Interior differentiator or crown tick.
  const t = rng.next();
  if (t < p.tick * 0.5) st.push(line(lx + W * 0.02, top, lx - W * 0.06, top - 0.16));
  else if (t < p.tick * 0.5 + 0.12) st.push(dot(W * 0.45, 0.55, 0.055));
  else if (t < p.tick * 0.5 + 0.2 && structure !== "box") st.push(line(W * 0.45, top + 0.15, W * 0.45, 0.6));
  return { strokes: p.mirror ? mirrorX(st, W) : st, w: W };
}

// ---------------------------------------------------------------------------
// Cursive (Arabic, Syriac, Mongolian): built right-to-left on the baseline
// ---------------------------------------------------------------------------

export const CURSIVE_SKELETONS = [
  "tooth",
  "teeth",
  "alif",
  "lam",
  "loop",
  "eye",
  "bowl",
  "peak",
  "ra",
  "dal",
  "kaf",
  "ta",
  "hump",
  "cup",
  "mim",
  "waw",
] as const;
export type CursiveSkel = (typeof CURSIVE_SKELETONS)[number];

const NON_JOINING: CursiveSkel[] = ["alif", "ra", "dal", "waw"];

/** Build a cursive letter skeleton (rtl: entry at right, exit at left). */
export function cursiveSkeleton(kind: CursiveSkel, rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const T = p.tooth; // tooth top y
  const asc = p.asc;
  const lr = p.loopR;
  const desc = p.desc;
  const sl = p.slantTeeth;
  let W = c.W;
  const st: Stroke[] = [];
  let exit: P | undefined = [0, 1];
  let entry: P | undefined;
  switch (kind) {
    case "tooth": {
      W *= 0.55;
      st.push(line(W, 1, 0, 1), smooth([[W * 0.45, 1], [W * 0.45 + sl * 0.3, T + 0.05]]));
      break;
    }
    case "teeth": {
      W *= 1.1;
      st.push(line(W, 1, 0, 1));
      for (let i = 0; i < 3; i++) st.push(line(W * (0.22 + i * 0.28), 1, W * (0.22 + i * 0.28) + sl * 0.2, T + 0.18));
      break;
    }
    case "alif": {
      W *= 0.32;
      st.push(smooth([[W * 0.6 + sl * 0.3, asc], [W * 0.5, 0.5], [W * 0.45, 1]]));
      exit = undefined;
      entry = [W * 0.45, 1];
      break;
    }
    case "lam": {
      W *= 0.55;
      st.push(smooth([[W * 0.55 + sl * 0.3, asc], [W * 0.5, 0.6], [W * 0.3, 0.95], [0, 1]]), line(W, 1, W * 0.35, 1));
      break;
    }
    case "loop": {
      W *= 0.75;
      // Pen comes along the baseline, rises into a loop, and leaves along the baseline.
      st.push(smooth([[W, 1], [W * 0.55, 0.98], [W * 0.35, 0.8], [W * 0.5, 1 - lr * 2.6], [W * 0.75, 0.82], [W * 0.5, 0.97], [0, 1]]));
      break;
    }
    case "eye": {
      W *= 1.05;
      st.push(smooth([[W, 1], [W * 0.9, 0.98], [W * 0.62, 0.6], [W * 0.25, 0.68], [W * 0.18, 0.96], [0, 1]]), line(W * 0.4, 1, W * 0.18, 1));
      break;
    }
    case "bowl": {
      W *= 0.9;
      st.push(smooth([[W, 1], [W * 0.75, 1.0], [W * 0.68, 0.8], [W * 0.58, 1.12], [W * 0.38, desc - 0.06], [W * 0.1, 1.22], [0, 1]]));
      break;
    }
    case "peak": {
      W *= 0.8;
      st.push(smooth([[W, 1], [W * 0.7, 0.92], [W * 0.62, T - 0.02], [W * 0.25, T + 0.05]], [2]), line(W * 0.62, 0.9, 0, 1));
      break;
    }
    case "ra": {
      W *= 0.45;
      st.push(smooth([[W, 0.82], [W * 0.75, 1.05], [W * 0.35, 1.32], [0, 1.38]]));
      exit = undefined;
      entry = [W * 0.9, 0.95];
      break;
    }
    case "dal": {
      W *= 0.55;
      st.push(smooth([[W * 0.35, T + 0.02], [W * 0.75, 0.75], [W * 0.75, 1], [0, 1]], [2]));
      exit = undefined;
      entry = [W * 0.75, 1];
      break;
    }
    case "kaf": {
      W *= 0.9;
      st.push(poly([[W * 0.95, asc + 0.15], [W * 0.25, 0.72], [W * 0.5, 1]]), line(W, 1, 0, 1));
      break;
    }
    case "ta": {
      W *= 1.0;
      st.push(smooth([[W, 1], [W * 0.88, 0.98], [W * 0.6, 0.62], [W * 0.22, 0.68], [W * 0.15, 0.97], [0, 1]]), line(W * 0.45, asc + 0.08, W * 0.45 - 0.04, 0.68));
      break;
    }
    case "hump": {
      W *= 0.8;
      st.push(smooth([[W, 1], [W * 0.75, 0.97], [W * 0.5, T + 0.08], [W * 0.25, 0.97], [0, 1]]));
      break;
    }
    case "cup": {
      W *= 0.7;
      st.push(smooth([[W * 0.35, T], [W * 0.75, T + 0.12], [W * 0.62, 0.92]]), line(W, 1, 0, 1));
      break;
    }
    case "mim": {
      W *= 0.7;
      st.push(smooth([[W, 1], [W * 0.6, 0.9], [W * 0.45, 0.72], [W * 0.25, 0.85], [W * 0.38, 1.0], [W * 0.3, 1.25], [W * 0.12, desc - 0.05]]), line(W * 0.42, 1, 0, 1));
      break;
    }
    case "waw": {
      W *= 0.6;
      st.push(smooth([[W, 1], [W * 0.7, 0.95], [W * 0.5, 0.72], [W * 0.75, 0.62], [W * 0.82, 0.9], [W * 0.5, 1.2], [W * 0.1, 1.3]]));
      exit = undefined;
      break;
    }
  }
  if (!entry) entry = [W, 1];
  return { strokes: st, w: W, entry, exit };
}

/** Dot patterns that distinguish letters sharing a cursive skeleton. */
export const DOT_PATTERNS = ["", "a1", "b1", "a2", "b2", "a3", "b3", "i1"] as const;

/** Vertical extent of a shape's ink between x0 and x1 (null when none). */
function inkSpan(strokes: Stroke[], x0: number, x1: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const st of strokes) {
    const xy = st.dot !== undefined ? [st.pts[0][0], st.pts[0][1]] : sampleRaw(st, 0.04).xy;
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < x0 || xy[i] > x1) continue;
      if (xy[i + 1] < lo) lo = xy[i + 1];
      if (xy[i + 1] > hi) hi = xy[i + 1];
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

export function addDots(shape: Shape, pattern: string, T: number): Shape {
  if (!pattern) return shape;
  const W = shape.w;
  const where = pattern[0];
  const n = +pattern[1];
  let y = where === "a" ? Math.min(T - 0.24, 0.32) : where === "b" ? 1.26 : 0.82;
  let cx = W / 2;
  // Dots must sit clear of the letter's own strokes (below a descending
  // bowl, above an ascender, or beside it when that would go too far).
  const half = n === 1 ? 0.07 : 0.16;
  const clear = (x: number): number => {
    const span = inkSpan(shape.strokes, x - half, x + half);
    if (!span) return y;
    if (where === "a") return Math.min(y, span[0] - 0.15);
    if (where === "b") return Math.max(y, span[1] + 0.15);
    return y;
  };
  if (where !== "i") {
    const xs = [cx, W * 0.28, W * 0.72, where === "a" ? W + 0.12 : -0.1];
    let best = cx;
    let by = clear(cx);
    for (const x of xs) {
      const yy = clear(x);
      const cost = Math.abs(yy - y) + Math.abs(x - cx) * 0.4;
      if (cost < Math.abs(by - y) + Math.abs(best - cx) * 0.4) {
        best = x;
        by = yy;
      }
    }
    cx = best;
    y = Math.max(-0.5, Math.min(1.5, by));
  }
  // Paired dots sit a little apart and slightly stepped, as a calligrapher sets them.
  const d = 0.17;
  const r = 0.052;
  const dots: Stroke[] = [];
  if (n === 1) dots.push(dot(cx, y, r));
  else if (n === 2) dots.push(dot(cx - d / 2, y + 0.015, r), dot(cx + d / 2, y - 0.015, r));
  else dots.push(dot(cx - d / 2, y + (where === "a" ? 0.07 : -0.07), r), dot(cx + d / 2, y + (where === "a" ? 0.07 : -0.07), r), dot(cx, y + (where === "a" ? -0.08 : 0.08), r));
  return { ...shape, strokes: [...shape.strokes, ...dots] };
}

export function isNonJoining(kind: CursiveSkel): boolean {
  return NON_JOINING.includes(kind);
}

function genCursive(rng: Rng, c: GenCtx): Shape {
  const kind = rng.pick(CURSIVE_SKELETONS);
  const s = cursiveSkeleton(kind, rng, c);
  return addDots(s, rng.chance(c.p.dotRate) ? rng.pick(DOT_PATTERNS) : "", c.p.tooth);
}

// ---------------------------------------------------------------------------
// Wedge (cuneiform / Ugaritic)
// ---------------------------------------------------------------------------

/**
 * Cuneiform-like signs, composed the way real signs are: one to three
 * clusters side by side (rows of verticals, stacks of horizontals, groups of
 * corner wedges, diagonals, crosses), sometimes threaded on a long horizontal.
 * Lengths are quantised (full / half / short) so signs read as distinct
 * arrangements rather than near-identical strokes of slightly different size.
 */
function genWedge(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const st: Stroke[] = [];
  const H = (x: number, y: number, len: number, small = false): void => {
    const s = line(x, y, x + len, y);
    if (small) s.w = 0.8;
    st.push(s);
  };
  const V = (x: number, y0: number, y1: number, small = false): void => {
    const s = line(x, y0, x, y1);
    if (small) s.w = 0.8;
    st.push(s);
  };
  const Wk = (x: number, y: number): void => {
    st.push(dot(x, y, 0.09));
  };
  /** Draw one cluster with its left edge at x; returns its width. */
  // A lone wedge is only ever full-size and centred, so that look-alikes are caught.
  const cluster = (x: number, kind: string, slim: boolean, alone: boolean): number => {
    switch (kind) {
      case "V": {
        const n = weighted(rng, [[1, 1], [2, 1], [3, 0.7], [4, slim ? 0 : 0.25]] as [number, number][]);
        const tiers = n >= 2 && rng.chance(0.3) ? 2 : 1;
        const short = tiers === 1 && !(alone && n === 1) && rng.chance(0.25);
        for (let i = 0; i < n; i++) {
          const xx = x + 0.06 + i * 0.19;
          if (tiers === 2) {
            V(xx, 0.04, 0.44, true);
            if (i < n - (rng.chance(0.4) ? 1 : 0)) V(xx, 0.56, 0.96, true);
          } else if (short) V(xx, 0.28, 0.72, true);
          else V(xx, 0.04, 0.96);
        }
        return 0.12 + (n - 1) * 0.19;
      }
      case "H": {
        const n = weighted(rng, [[1, 1], [2, 1], [3, 0.6]] as [number, number][]);
        const len = slim ? 0.4 : alone && n === 1 ? 0.62 : rng.pick([0.42, 0.62]);
        const ys = n === 1 ? [alone ? 0.5 : rng.pick([0.22, 0.5, 0.78])] : n === 2 ? (rng.chance(0.5) ? [0.3, 0.7] : [0.18, 0.5]) : [0.16, 0.5, 0.84];
        ys.forEach((y, i) => H(x, y, len - (n === 3 && i === 1 && rng.chance(0.4) ? 0.14 : 0), n === 3));
        return len;
      }
      case "W": {
        const n = weighted(rng, [[1, 1], [2, 1], [3, 0.8]] as [number, number][]);
        const arr = n === 1 ? "one" : rng.pick(n === 3 ? ["row", "col", "tri"] : ["row", "col"]);
        if (arr === "one") Wk(x + 0.12, alone ? 0.5 : rng.pick([0.3, 0.5]));
        else if (arr === "row") for (let i = 0; i < n; i++) Wk(x + 0.12 + i * 0.26, 0.5);
        else if (arr === "col") for (let i = 0; i < n; i++) Wk(x + 0.12, n === 2 ? 0.3 + i * 0.4 : 0.18 + i * 0.32);
        else {
          Wk(x + 0.12, 0.25);
          Wk(x + 0.12, 0.75);
          Wk(x + 0.38, 0.5);
        }
        return arr === "row" ? 0.12 + (n - 1) * 0.26 + 0.1 : arr === "tri" ? 0.48 : 0.22;
      }
      case "D": {
        const k = rng.int(0, 2);
        if (k === 0) st.push(line(x, 0.06, x + 0.5, 0.62));
        else if (k === 1) st.push(line(x, 0.94, x + 0.5, 0.38));
        else st.push(line(x, 0.06, x + 0.5, 0.62), line(x, 0.94, x + 0.5, 0.38));
        return 0.5;
      }
      case "X": {
        const len = slim ? 0.46 : rng.pick([0.5, 0.7]);
        const y = rng.pick([0.3, 0.5]);
        H(x, y, len);
        const nv = rng.chance(0.3) ? 2 : 1;
        for (let i = 0; i < nv; i++) V(x + len * (nv === 1 ? 0.55 : 0.4 + i * 0.3), 0.04, 0.96);
        if (rng.chance(0.3)) H(x, 0.84, len * 0.6, true);
        return len;
      }
      case "HV": {
        const n = rng.chance(0.35) ? 2 : 1;
        const len = 0.36;
        for (let i = 0; i < n; i++) H(x, n === 1 ? 0.5 : 0.3 + i * 0.4, len);
        V(x + len + 0.06, 0.04, 0.96);
        return len + 0.1;
      }
    }
    return 0.2;
  };
  const kinds: [string, number][] = [
    ["V", p.vert * 1.4 + 0.3],
    ["H", p.horiz * 1.4 + 0.2],
    ["W", p.wink + 0.15],
    ["D", p.diag + 0.05],
    ["X", 0.45],
    ["HV", 0.4],
  ];
  const big = c.big;
  const ncol = weighted(rng, [[1, 0.55 - big * 0.3], [2, 0.35 + big * 0.1], [3, 0.08 + big * 0.25]] as [number, number][]);
  let x = 0;
  let prev = "";
  for (let k = 0; k < ncol; k++) {
    let kind = weighted(rng, kinds);
    for (let t = 0; t < 3 && kind === prev && kind !== "V"; t++) kind = weighted(rng, kinds);
    x += cluster(x, kind, ncol >= 3, ncol === 1) + 0.12;
    prev = kind;
  }
  let w = x - 0.12;
  // A long horizontal threading the clusters (a common cuneiform frame).
  if (ncol >= 2 && rng.chance(0.15 + big * 0.2)) {
    st.unshift(line(-0.06, rng.pick([0.5, 0.36]), w + 0.04, rng.pick([0.5, 0.36])));
    st[0].pts[1][1] = st[0].pts[0][1];
  }
  w = Math.max(0.35, w);
  // Signs too wide for the line are compressed horizontally (scribes squeeze, they do not shrink).
  if (w > 1.25) {
    const k = 1.25 / w;
    for (const s of st) for (const q of s.pts) q[0] *= k;
    w = 1.25;
  }
  return { strokes: st, w };
}

// ---------------------------------------------------------------------------
// Linear (Linear B, Cypriot, Vai, Cherokee-like emblematic signs)
// ---------------------------------------------------------------------------

function linearElement(rng: Rng, kind: string, cx: number, y0: number, y1: number, hw: number): Stroke[] {
  const cy = (y0 + y1) / 2;
  const h = y1 - y0;
  switch (kind) {
    case "bar":
      return [line(cx - hw, cy, cx + hw, cy)];
    case "bars":
      return [line(cx - hw, y0 + h * 0.25, cx + hw, y0 + h * 0.25), line(cx - hw, y1 - h * 0.25, cx + hw, y1 - h * 0.25)];
    case "chevUp":
      return [poly([[cx - hw, y1], [cx, y0], [cx + hw, y1]])];
    case "chevDown":
      return [poly([[cx - hw, y0], [cx, y1], [cx + hw, y0]])];
    case "cup":
      return [openArc(cx, y0, hw, h, 0, Math.PI)];
    case "cap":
      return [openArc(cx, y1, hw, h, Math.PI, TAU)];
    case "ring":
      return [ring(cx, cy, Math.min(hw, h / 2) * 0.95)];
    case "box":
      return [poly([[cx - hw * 0.8, y0], [cx + hw * 0.8, y0], [cx + hw * 0.8, y1], [cx - hw * 0.8, y1]], undefined, true)];
    case "tri":
      return [poly([[cx, y0], [cx + hw, y1], [cx - hw, y1]], undefined, true)];
    case "legs":
      return [line(cx, y0, cx - hw, y1), line(cx, y0, cx + hw, y1)];
    case "fork":
      return [line(cx, y1, cx - hw, y0), line(cx, y1, cx + hw, y0)];
    case "dots":
      return [dot(cx - hw * 0.7, cy, 0.055), dot(cx + hw * 0.7, cy, 0.055)];
    case "arms":
      return [poly([[cx - hw, y1], [cx - hw, cy], [cx + hw, cy], [cx + hw, y1]])];
    case "armsUp":
      return [poly([[cx - hw, y0], [cx - hw, cy], [cx + hw, cy], [cx + hw, y0]])];
    case "flag":
      return [poly([[cx, y0], [cx + hw, y0 + h * 0.4], [cx, y0 + h * 0.8]])];
    case "hook":
      return [smooth([[cx, y0], [cx + hw, cy], [cx, y1], [cx - hw * 0.6, y1 - h * 0.25]])];
    case "x":
      return [line(cx - hw, y0, cx + hw, y1), line(cx + hw, y0, cx - hw, y1)];
  }
  return [];
}

function genLinear(rng: Rng, c: GenCtx): Shape {
  const p = c.p;
  const W = c.W;
  const cx = W / 2;
  const st: Stroke[] = [];
  const tiers = rng.chance(p.tiers + c.big * 0.2) ? (rng.chance(0.35 + c.big * 0.3) ? 3 : 2) : 1;
  const el: [string, number][] = [
    ["bar", p.bar],
    ["bars", p.bar * 0.5],
    ["chevUp", p.chev],
    ["chevDown", p.chev * 0.8],
    ["cup", p.cup],
    ["cap", p.cup * 0.8],
    ["ring", p.ring],
    ["box", p.box],
    ["tri", p.chev * 0.4],
    ["legs", p.legs],
    ["fork", p.legs * 0.6],
    ["dots", p.dots],
    ["arms", p.box * 0.6 + 0.2],
    ["armsUp", p.box * 0.4 + 0.2],
    ["flag", 0.3 * (1 - p.sym)],
    ["hook", 0.3 * (1 - p.sym)],
    ["x", 0.25],
  ];
  const stem = rng.chance(p.stem);
  const bounds = tiers === 1 ? [[0, 1]] : tiers === 2 ? [[0, 0.46], [0.54, 1]] : [[0, 0.3], [0.36, 0.64], [0.7, 1]];
  const used = new Set<string>();
  for (const [y0, y1] of bounds) {
    let k = weighted(rng, el);
    for (let t = 0; t < 4 && used.has(k); t++) k = weighted(rng, el);
    used.add(k);
    const hw = (W / 2) * (tiers === 1 ? 1 : rng.range(0.7, 1));
    st.push(...linearElement(rng, k, cx, y0, y1, hw));
  }
  if (stem) st.push(line(cx, 0, cx, 1));
  // Asymmetric flick for character.
  if (rng.chance(1 - p.sym)) {
    const y = rng.range(0.2, 0.8);
    st.push(line(cx, y, cx + W * 0.45, y - 0.18));
  }
  let strokes = st;
  if (rng.chance(0.5)) strokes = mirrorX(strokes, W);
  return { strokes, w: W };
}

// ---------------------------------------------------------------------------
// Featural & syllabic base shapes (simple components)
// ---------------------------------------------------------------------------

/** Simple 1–3 stroke component shapes in the unit box (used by featural and syllabics scripts). */
export const COMPONENT_SHAPES: Record<string, () => Stroke[]> = {
  corner7: () => [poly([[0, 0], [1, 0], [1, 1]])], // ㄱ
  cornerL: () => [poly([[0, 0], [0, 1], [1, 1]])], // ㄴ
  box: () => [poly([[0, 0], [1, 0], [1, 1], [0, 1]], undefined, true)], // ㅁ
  hat: () => [poly([[0, 1], [0.5, 0], [1, 1]])], // ㅅ
  ring: () => [circle(0.5, 0.5, 0.5)], // ㅇ
  zig: () => [poly([[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 1], [1, 1]])], // ㄹ
  cup: () => [poly([[0, 0], [0, 1], [1, 1], [1, 0]])], // ㅂ-ish U
  tri: () => [poly([[0.5, 0], [1, 1], [0, 1]], undefined, true)],
  vee: () => [poly([[0, 0], [0.5, 1], [1, 0]])],
  half: () => [openArc(0.5, 0.5, 0.5, 0.5, -Math.PI / 2, Math.PI / 2)],
  cHook: () => [openArc(0.5, 0.5, 0.5, 0.5, Math.PI / 2, Math.PI * 1.5)],
  jhook: () => [smooth([[1, 0], [1, 0.7], [0.5, 1], [0, 0.7]])],
  stemFoot: () => [poly([[0, 0], [0, 1]]), line(0, 0, 1, 0)], // Γ
  sigma: () => [poly([[1, 0], [0, 0], [0.6, 0.5], [0, 1], [1, 1]])],
  ringStem: () => [circle(0.5, 0.3, 0.3), line(0.5, 0.6, 0.5, 1)],
  angle: () => [poly([[0, 0], [1, 0.5], [0, 1]])],
  ess: () => [smooth([[1, 0.05], [0.2, 0.15], [0.5, 0.5], [0.8, 0.85], [0, 0.95]])],
  bowlStem: () => [line(0, 0, 0, 1), smooth([[0, 0], [0.9, 0.25], [0, 0.5]])],
};

export function genGlyph(family: Family, rng: Rng, ctx: GenCtx): Shape {
  switch (family) {
    case "stave":
      return genStave(rng, ctx);
    case "geometric":
      return genGeometric(rng, ctx);
    case "hanging":
      return genHanging(rng, ctx);
    case "round":
      return genRound(rng, ctx);
    case "square":
      return genSquare(rng, ctx);
    case "cursive":
      return genCursive(rng, ctx);
    case "wedge":
      return genWedge(rng, ctx);
    case "linear":
    case "tally":
    case "featural":
    case "syllabic":
      return genLinear(rng, ctx);
  }
}
