/**
 * Mon: circular, monochrome, (mostly) rotationally symmetric crests in the
 * manner of Japanese kamon — swirling commas, blossoms, leaves, crossed
 * feathers and blades, rings of stars, waves, interlocking rings, and any
 * heraldic charge cut as a stencil — within an optional enclosure (ring,
 * double ring, hexagon, lozenge, chamfered square, four-lobed melon).
 *
 * A mon is one ink on one ground. Interior lines and the gaps that separate
 * overlapping parts are cut out of the ink, so the design is rendered through
 * an SVG mask: white adds ink, black cuts it away. The ground can be omitted
 * (transparent) and the mon still reads correctly.
 */
import type { Rng } from "../core/rng";
import type { Tincture } from "../world/concepts";
import type { Attitude, ChargeId } from "./types";
import { CHARGES, chargeArt, chargeDef } from "./charges/index";
import { paintCharge } from "./charges/paint";
import { autoId, defsMarkup, uid, type Ctx } from "./ctx";
import { circleD, f, limb, polyD, smooth, type Pt, type SPt } from "./path";
import { fitScale } from "./place";
import { ILLUMINATED, PALETTES, type Palette } from "./tinctures";

export const MON_ENCLOSURES = ["none", "ring", "thinRing", "thickRing", "doubleRing", "hexagon", "lozenge", "square", "melon"] as const;
export type MonEnclosure = (typeof MON_ENCLOSURES)[number];

export const MON_GEOMETRIC = [
  "scales", "fourSquares", "linkedRings", "squareRing", "fourLozenges", "nineStars", "threeStars", "snakeEye", "fret", "cartWheel",
  "waves", "sunRays", "moonStar", "mountains",
] as const;
export type MonGeometric = (typeof MON_GEOMETRIC)[number];

export type MonPetal = "round" | "notched" | "pointed" | "rayed";
export type MonLeaf = "heart" | "oak" | "blade";

export type MonMotif =
  /** Swirling commas (tomoe). */
  | { kind: "commas"; n: number; swirl: 1 | -1 }
  /** A blossom of n petals. */
  | { kind: "flower"; n: number; petal: MonPetal }
  /** n leaves radiating from the centre. */
  | { kind: "leaves"; n: number; leaf: MonLeaf }
  /** Two leaves embracing, optionally around a small charge. */
  | { kind: "embrace"; leaf: MonLeaf; inner?: ChargeId }
  /** n copies of a charge around the centre, heads outward (or inward). */
  | { kind: "radial"; charge: ChargeId; n: number; inward?: boolean; attitude?: Attitude }
  /** Two long charges crossed in saltire. */
  | { kind: "crossed"; charge: ChargeId }
  /** A single charge. */
  | { kind: "single"; charge: ChargeId; attitude?: Attitude }
  /** Two charges face to face. */
  | { kind: "facing"; charge: ChargeId; attitude?: Attitude }
  | { kind: "geometric"; shape: MonGeometric };

export interface Mon {
  motif: MonMotif;
  enclosure: MonEnclosure;
  /** Colour of the design. Default sable. */
  ink?: Tincture;
  /** Colour of the ground. Default argent. */
  ground?: Tincture;
}

// ---------------------------------------------------------------------------
// Drawing primitives (200 × 200 frame, centre 100,100)

const C = 100;
const D2R = Math.PI / 180;
/** Polar point: radius, angle in degrees clockwise from the top. */
const pol = (r: number, a: number, cx = C, cy = C): Pt => [cx + r * Math.sin(a * D2R), cy - r * Math.cos(a * D2R)];

type Op = { add: string } | { cut: string } | { cutLine: string; w: number } | { addLine: string; w: number } | { raw: string };

/** Rotate a list of local points (x right, y outward = up) to angle a about the centre. */
function place(pts: readonly SPt[], a: number): SPt[] {
  const c = Math.cos(a * D2R), s = Math.sin(a * D2R);
  return pts.map((p) => {
    const x = p[0], y = -p[1];
    const q: SPt = [C + x * c - y * s, C + x * s + y * c];
    if (p.length === 3) return [q[0], q[1], p[2]];
    return q;
  });
}

function mirrored(half: SPt[]): SPt[] {
  // half runs from the base (x=0) out along the right side to the tip (x=0)
  const back = half.slice(1, -1).reverse().map((p) => (p.length === 3 ? [-p[0], p[1], p[2]] : [-p[0], p[1]]) as SPt);
  return [...half, ...back];
}

// ---------------------------------------------------------------------------
// Enclosures

interface Enc {
  ops: Op[];
  /** Radius available to the motif. */
  r: number;
}

function polygonD(n: number, R: number, rot: number): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push(pol(R, rot + (i * 360) / n));
  return polyD(pts);
}

function melonD(R: number): string {
  const pts: Pt[] = [];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * 360;
    const k = Math.abs(Math.cos(2 * a * D2R));
    pts.push(pol(R * (0.8 + 0.2 * Math.pow(k, 0.55)), a));
  }
  return polyD(pts);
}

function enclosure(e: MonEnclosure): Enc {
  switch (e) {
    case "ring":
      return { ops: [{ add: circleD(C, C, 99) }, { cut: circleD(C, C, 88) }], r: 82 };
    case "thinRing":
      return { ops: [{ add: circleD(C, C, 99) }, { cut: circleD(C, C, 93) }], r: 87 };
    case "thickRing":
      return { ops: [{ add: circleD(C, C, 99) }, { cut: circleD(C, C, 79) }], r: 73 };
    case "doubleRing":
      return { ops: [{ add: circleD(C, C, 99) }, { cut: circleD(C, C, 94) }, { add: circleD(C, C, 89.5) }, { cut: circleD(C, C, 84) }], r: 78 };
    case "hexagon":
      return {
        ops: [{ add: polygonD(6, 99, 90) }, { cut: polygonD(6, 88, 90) }, { add: polygonD(6, 84, 90) }, { cut: polygonD(6, 80, 90) }],
        r: 64,
      };
    case "lozenge":
      return { ops: [{ add: polygonD(4, 99, 0) }, { cut: polygonD(4, 86, 0) }], r: 52 };
    case "square": {
      const sq = (h: number, k: number) => polyD([[C - h + k, C - h], [C + h - k, C - h], [C + h, C - h + k], [C + h, C + h - k], [C + h - k, C + h], [C - h + k, C + h], [C - h, C + h - k], [C - h, C - h + k]]);
      return { ops: [{ add: sq(90, 24) }, { cut: sq(80, 20) }], r: 72 };
    }
    case "melon":
      return { ops: [{ add: melonD(99) }, { cut: melonD(88) }], r: 64 };
    default:
      return { ops: [], r: 97 };
  }
}

// ---------------------------------------------------------------------------
// Motifs

function commas(n: number, swirl: 1 | -1, r: number): Op[] {
  const ops: Op[] = [];
  if (n <= 1) {
    // a single comma (hidari-tomoe alone): a large head and a long tail round the rim
    return commas1(swirl, r);
  }
  // head centre radius, head radius, sweep to the next head, total sweep
  const cfg = n === 2 ? { h: 0.36, a: 0.33, dn: 180, d: 280, gap: 0.12 } : n === 3 ? { h: 0.42, a: 0.255, dn: 120, d: 212, gap: 0.12 } : { h: 0.48, a: 0.2, dn: 90, d: 168, gap: 0.1 };
  const tn = cfg.dn / cfg.d;
  const gap = cfg.gap;
  const wAt = (t: number) => 2 * cfg.a * Math.pow(1 - t, 1.4);
  // the tail passes outside the next head with a clear gap
  const rOut = Math.min(0.99 - wAt(tn) / 2 - 0.01, cfg.h + cfg.a + gap + wAt(tn) / 2);
  for (let i = 0; i < n; i++) {
    const a0 = (i * 360) / n;
    const sp: [number, number, number][] = [];
    const N = 24;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const u = Math.min(1, t / tn);
      const rr = (cfg.h + (rOut - cfg.h) * (1 - (1 - u) * (1 - u)) - (t > tn ? (t - tn) * 0.06 : 0)) * r;
      const p = pol(rr, a0 + swirl * t * cfg.d);
      sp.push([p[0], p[1], Math.max(0.15, wAt(t) * r)]);
    }
    ops.push({ add: limb(sp, { start: "round", end: "flat", perSeg: 5 }) });
  }
  return ops;
}

function commas1(swirl: 1 | -1, r: number): Op[] {
  const sp: [number, number, number][] = [];
  const N = 30;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const rr = (0.32 + 0.52 * (1 - (1 - Math.min(1, t * 2.2)) ** 2)) * r;
    const p = pol(rr, 200 + swirl * t * 300);
    sp.push([p[0], p[1], Math.max(0.15, 2 * 0.5 * r * Math.pow(1 - t, 1.1))]);
  }
  return [{ add: limb(sp, { start: "round", end: "flat", perSeg: 5 }) }];
}

function petalShape(petal: MonPetal, n: number, r: number): SPt[] {
  const tn = Math.tan(Math.PI / n);
  // (fraction of the sector's half-width at that radius, radius) → local point
  const P = (fw: number, y: number, sharp = false): SPt => (sharp ? [fw * y * tn * r, y * r, 1] : [fw * y * tn * r, y * r]);
  switch (petal) {
    case "notched":
      return mirrored([P(0, 0.1, true), P(0.9, 0.3), P(0.95, 0.6), P(0.78, 0.86), P(0.36, 0.99), P(0, 0.86, true)]);
    case "pointed":
      return mirrored([P(0, 0.06, true), P(0.96, 0.3), P(0.9, 0.56), P(0.55, 0.8), P(0, 1.0, true)]);
    case "rayed":
      return mirrored([P(0, 0.2, true), P(0.8, 0.32), P(0.86, 0.6), P(0.86, 0.9), P(0, 0.99)]);
    default:
      return [];
  }
}

function flower(n: number, petal: MonPetal, r: number): Op[] {
  const ops: Op[] = [];
  const gap = r * 0.035;
  if (petal === "round") {
    const rho = r * 0.56;
    const pr = Math.min(r - rho, rho * Math.sin(Math.PI / n) * 1.08);
    for (let i = 0; i < n; i++) {
      const p = pol(rho, (i * 360) / n);
      ops.push({ cut: circleD(p[0], p[1], pr + gap) }, { add: circleD(p[0], p[1], pr) });
    }
    ops.push({ add: circleD(C, C, rho * 0.9) });
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) * (360 / n);
      ops.push({ cutLine: polyD([pol(rho * 0.62, a), pol(rho * 1.25, a)], false), w: gap * 1.6 });
    }
    ops.push({ cut: circleD(C, C, rho * 0.4) }, { add: circleD(C, C, rho * 0.16) });
    for (let i = 0; i < n * 2; i++) {
      const a = (i + 0.5) * (180 / n);
      const p = pol(rho * 0.33, a);
      ops.push({ addLine: polyD([pol(rho * 0.12, a), p], false), w: gap * 0.9 }, { add: circleD(p[0], p[1], gap * 1.2) });
    }
    return ops;
  }
  if (petal === "rayed") {
    // chrysanthemum: many long petals around a disc
    const shape = petalShape("rayed", n, r);
    for (let i = 0; i < n; i++) ops.push({ add: smooth(place(shape, (i * 360) / n), true) });
    for (let i = 0; i < n; i++) ops.push({ cutLine: polyD([pol(r * 0.24, (i + 0.5) * (360 / n)), pol(r * 1.05, (i + 0.5) * (360 / n))], false), w: gap * 1.1 });
    ops.push({ cut: circleD(C, C, r * 0.27) }, { add: circleD(C, C, r * 0.22) });
    return ops;
  }
  const shape = petalShape(petal, n, r);
  for (let i = 0; i < n; i++) ops.push({ add: smooth(place(shape, (i * 360) / n), true) });
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * (360 / n);
    ops.push({ cutLine: polyD([pol(r * 0.08, a), pol(r * 1.05, a)], false), w: gap * 1.3 });
  }
  if (petal === "pointed") {
    // bellflower: a vein down each petal and a small star at the heart
    for (let i = 0; i < n; i++) {
      const a = (i * 360) / n;
      ops.push({ cutLine: polyD([pol(r * 0.36, a), pol(r * 0.72, a)], false), w: gap * 1.1 });
    }
    const star: Pt[] = [];
    for (let i = 0; i < n * 2; i++) star.push(pol(i % 2 ? r * 0.1 : r * 0.26, (i * 180) / n));
    ops.push({ cutLine: polyD(star), w: gap * 1.1 });
  } else {
    ops.push({ cut: circleD(C, C, r * 0.2) }, { add: circleD(C, C, r * 0.09) });
    for (let i = 0; i < n; i++) {
      const a = (i * 360) / n;
      const p = pol(r * 0.17, a);
      ops.push({ addLine: polyD([pol(r * 0.08, a), p], false), w: gap * 0.8 }, { add: circleD(p[0], p[1], gap * 1.1) });
    }
  }
  return ops;
}

/** One leaf pointing up (outward), base at y = b, tip at y = t, in local coordinates. Veins are open polylines. */
function leafShape(leaf: MonLeaf, b: number, t: number, w: number): { outline: SPt[]; veins: SPt[][] } {
  const L = t - b;
  const at = (u: number) => b + L * u;
  if (leaf === "heart") {
    const outline: SPt[] = [
      [0, at(0.1), 1],
      [w * 0.3, at(-0.02)],
      [w * 0.62, at(0.06)],
      [w * 0.68, at(0.32)],
      [w * 0.5, at(0.62)],
      [w * 0.22, at(0.86)],
      [0, at(1), 1],
      [-w * 0.22, at(0.86)],
      [-w * 0.5, at(0.62)],
      [-w * 0.68, at(0.32)],
      [-w * 0.62, at(0.06)],
      [-w * 0.3, at(-0.02)],
    ];
    const veins: SPt[][] = [[[0, at(0.1)], [0, at(0.5)], [0, at(0.88)]]];
    for (const s of [-1, 1]) {
      veins.push([[0, at(0.18)], [s * w * 0.3, at(0.2)], [s * w * 0.5, at(0.3)]]);
      veins.push([[0, at(0.34)], [s * w * 0.26, at(0.42)], [s * w * 0.4, at(0.56)]]);
      veins.push([[0, at(0.52)], [s * w * 0.16, at(0.62)], [s * w * 0.24, at(0.74)]]);
    }
    return { outline, veins };
  }
  if (leaf === "oak") {
    const half: SPt[] = [[0, at(0), 1]];
    const lobes = 4;
    const lw = (i: number) => w * (0.42 + 0.28 * Math.sin(((i + 0.6) / lobes) * Math.PI));
    for (let i = 0; i < lobes; i++) {
      const u0 = 0.08 + (i / lobes) * 0.8, u1 = u0 + 0.8 / lobes;
      const ww = lw(i);
      half.push([ww * 0.55, at(u0 + 0.02), 1]);
      half.push([ww * 0.98, at(u0 + 0.3 * (u1 - u0))]);
      half.push([ww, at(u0 + 0.62 * (u1 - u0))]);
    }
    half.push([w * 0.12, at(0.95)]);
    half.push([0, at(1), 1]);
    const outline = mirrored(half);
    const veins: SPt[][] = [[[0, at(0.02)], [0, at(0.5)], [0, at(0.9)]]];
    for (let i = 0; i < lobes; i++) {
      const u0 = 0.08 + (i / lobes) * 0.8, u1 = u0 + 0.8 / lobes;
      for (const s of [-1, 1]) veins.push([[0, at(u0 + 0.04)], [s * lw(i) * 0.4, at(u0 + 0.3 * (u1 - u0))], [s * lw(i) * 0.72, at(u0 + 0.5 * (u1 - u0))]]);
    }
    return { outline, veins };
  }
  // blade (bamboo / willow)
  const outline: SPt[] = [
    [0, at(0), 1],
    [w * 0.34, at(0.12)],
    [w * 0.5, at(0.36)],
    [w * 0.36, at(0.68)],
    [0, at(1), 1],
    [-w * 0.36, at(0.68)],
    [-w * 0.5, at(0.36)],
    [-w * 0.34, at(0.12)],
  ];
  return { outline, veins: [[[0, at(0.06)], [0, at(0.45)], [0, at(0.8)]]] };
}

function leaves(n: number, leaf: MonLeaf, r: number): Op[] {
  const ops: Op[] = [];
  const w = leaf === "blade" ? r * Math.min(0.62, 2.4 / n) : r * (n <= 3 ? 0.98 : 0.8);
  const base = leaf === "heart" ? r * 0.16 : r * 0.12;
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n;
    const { outline, veins } = leafShape(leaf, base, r * 0.99, w);
    ops.push({ cutLine: smooth(place(outline, a), true), w: r * 0.06 });
    ops.push({ add: smooth(place(outline, a), true) });
    for (const v of veins) ops.push({ cutLine: smooth(place(v, a), false), w: r * 0.034 });
    // stem
    ops.push({ addLine: polyD([pol(0, a), pol(base + r * 0.06, a)], false), w: r * 0.07 });
  }
  ops.push({ add: circleD(C, C, r * 0.09) });
  return ops;
}

function embrace(leaf: MonLeaf, inner: ChargeId | undefined, r: number, ctx: Ctx): Op[] {
  const ops: Op[] = [];
  // two leaves rising from crossed stems at the base, curving up round the sides, tips nearly meeting above
  const len = r * 1.3, lw = leaf === "blade" ? r * 0.62 : r * 0.5;
  for (const side of [-1, 1]) {
    const { outline, veins } = leafShape(leaf, 0, len, lw);
    const bend = (p: SPt): SPt => {
      const u = p[1] / len; // 0 base … 1 tip
      const ang = side * (196 - u * 166);
      const rad = r * 0.72 + p[0] * side * 0.95;
      const q = pol(rad, ang);
      return p.length === 3 ? [q[0], q[1], p[2]] : q;
    };
    // densify the outline so the bend follows the arc
    const dense: SPt[] = [];
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i], q = outline[(i + 1) % outline.length];
      dense.push(p);
      if (p[2] !== 1 || q[2] !== 1) for (let k = 1; k < 3; k++) dense.push([p[0] + ((q[0] - p[0]) * k) / 3, p[1] + ((q[1] - p[1]) * k) / 3]);
    }
    const pts = dense.map(bend);
    ops.push({ cutLine: smooth(pts, true), w: r * 0.06 }, { add: smooth(pts, true) });
    for (const v of veins.slice(0, 5)) ops.push({ cutLine: smooth(v.map(bend), false), w: r * 0.026 });
    const s0 = pol(r * 0.72, side * 196), s1 = pol(r * 0.95, -side * 160);
    ops.push({ addLine: polyD([s0, s1], false), w: r * 0.07 });
  }
  if (inner) ops.push(...chargeOps(ctx, { charge: inner }, [{ x: C, y: C - r * 0.02, s: r * 0.8, rot: 0 }], r));
  return ops;
}

interface MonPlacement {
  x: number;
  y: number;
  s: number;
  rot: number;
  flip?: boolean;
}

/** A charge cut as a stencil: white body, black gaps and detail lines. */
function chargeOps(ctx: Ctx, spec: { charge: ChargeId; attitude?: Attitude }, at: MonPlacement[], r: number): Op[] {
  const { art, box } = chargeArt(spec.charge, { attitude: spec.attitude });
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  let s = "";
  for (const p of at) {
    const k = fitScale(box, p.s);
    const key = `mon|${spec.charge}|${spec.attitude ?? ""}|${f(k)}`;
    let id = ctx.ids.get(key);
    if (!id) {
      id = uid(ctx, "mc");
      const gap = (r * 0.022) / k;
      ctx.defs.set(
        key,
        `<g id="${id}">${paintCharge(art, { body: "#fff", accent: "#fff", crown: "#fff", contour: "#000", detail: "#000", outlineW: gap, lineK: Math.max(1.1, Math.min(2.2, (r * 0.014) / k)), detailOn: true, tone: false })}</g>`,
      );
      ctx.ids.set(key, id);
    }
    s += `<use href="#${id}" transform="translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.rot)}) scale(${f(k * (p.flip ? -1 : 1))} ${f(k)}) translate(${f(-cx)} ${f(-cy)})"/>`;
  }
  return [{ raw: s }];
}

function aspectOf(id: ChargeId, att?: Attitude): number {
  const { box } = chargeArt(id, { attitude: att });
  return (box.x1 - box.x0) / (box.y1 - box.y0);
}

function radial(ctx: Ctx, m: Extract<MonMotif, { kind: "radial" }>, r: number): Op[] {
  const n = Math.max(2, m.n);
  const asp = aspectOf(m.charge, m.attitude);
  // cell size so that neighbours do not collide and the outer end stays inside
  const long = asp < 0.6;
  const rho = long ? r * 0.54 : r * (n <= 3 ? 0.5 : n <= 5 ? 0.58 : 0.64);
  const sCirc = ((2 * Math.PI * rho) / n) * (long ? 2.2 : 0.92) / Math.max(0.42, Math.min(1.6, asp));
  const s = Math.min(long ? r * 0.9 : (r - rho) * 2 * 0.98, sCirc);
  const at: MonPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n;
    const p = pol(rho, a);
    at.push({ x: p[0], y: p[1], s, rot: a + (m.inward ? 180 : 0) });
  }
  return chargeOps(ctx, m, at, r);
}

// ---------------------------------------------------------------------------
// Geometric motifs

function geometric(ctx: Ctx, shape: MonGeometric, r: number): Op[] {
  const ops: Op[] = [];
  const gap = r * 0.045;
  switch (shape) {
    case "scales": {
      // three triangles in a triangle
      const R = r * 0.98;
      const A = pol(R, 0), B = pol(R, 120), Cc = pol(R, 240);
      const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const ab = mid(A, B), bc = mid(B, Cc), ca = mid(Cc, A);
      for (const tri of [[A, ab, ca], [ab, B, bc], [ca, bc, Cc]] as Pt[][]) ops.push({ add: polyD(tri) });
      ops.push({ cutLine: polyD([ab, bc, ca]), w: gap });
      return ops;
    }
    case "fourSquares": {
      const h = r * 0.3, d = r * 0.4;
      for (const a of [0, 90, 180, 270]) {
        const c = pol(d, a);
        const sq: Pt[] = [pol(h * 1.18, 0, c[0], c[1]), pol(h * 1.18, 90, c[0], c[1]), pol(h * 1.18, 180, c[0], c[1]), pol(h * 1.18, 270, c[0], c[1])];
        ops.push({ add: polyD(sq) });
        const sqi: Pt[] = [pol(h * 0.55, 0, c[0], c[1]), pol(h * 0.55, 90, c[0], c[1]), pol(h * 0.55, 180, c[0], c[1]), pol(h * 0.55, 270, c[0], c[1])];
        ops.push({ cut: polyD(sqi) });
      }
      return ops;
    }
    case "linkedRings": {
      const R = r * 0.56, t = r * 0.14, dx = r * 0.4;
      const ring = (x: number): Op[] => [
        { cutLine: circleD(x, C, R), w: gap * 1.6 },
        { cutLine: circleD(x, C, R - t), w: gap * 1.6 },
        { add: circleD(x, C, R) },
        { cut: circleD(x, C, R - t) },
      ];
      ops.push(...ring(C - dx), ...ring(C + dx));
      // interlace: the left ring passes over the right one at the upper crossing
      const cid = uid(ctx, "lk");
      ctx.defs.set(cid, `<clipPath id="${cid}"><rect x="${f(C - r * 0.3)}" y="${f(C - r)}" width="${f(r * 0.6)}" height="${f(r)}"/></clipPath>`);
      ops.push({ raw: `<g clip-path="url(#${cid})">${opsMarkup(ring(C - dx))}</g>` });
      return ops;
    }
    case "squareRing": {
      const h = r * 0.66, hi = r * 0.28;
      const sq = (k: number) => polyD([pol(k * Math.SQRT2, 45), pol(k * Math.SQRT2, 135), pol(k * Math.SQRT2, 225), pol(k * Math.SQRT2, 315)]);
      ops.push({ add: sq(h) }, { cut: sq(hi) });
      return ops;
    }
    case "fourLozenges": {
      const R = r * 0.98;
      const top = pol(R, 0), right = pol(R * 0.72, 90), bot = pol(R, 180), left = pol(R * 0.72, 270);
      ops.push({ add: polyD([top, right, bot, left]) });
      ops.push({ cutLine: polyD([[(top[0] + left[0]) / 2, (top[1] + left[1]) / 2], [(right[0] + bot[0]) / 2, (right[1] + bot[1]) / 2]], false), w: gap });
      ops.push({ cutLine: polyD([[(top[0] + right[0]) / 2, (top[1] + right[1]) / 2], [(left[0] + bot[0]) / 2, (left[1] + bot[1]) / 2]], false), w: gap });
      return ops;
    }
    case "nineStars": {
      ops.push({ add: circleD(C, C, r * 0.3) });
      for (let i = 0; i < 8; i++) {
        const p = pol(r * 0.72, i * 45);
        ops.push({ add: circleD(p[0], p[1], r * 0.21) });
      }
      return ops;
    }
    case "threeStars": {
      for (let i = 0; i < 3; i++) {
        const p = pol(r * 0.5, i * 120);
        ops.push({ add: circleD(p[0], p[1], r * 0.36) });
      }
      return ops;
    }
    case "snakeEye":
      ops.push({ add: circleD(C, C, r * 0.92) }, { cut: circleD(C, C, r * 0.52) });
      return ops;
    case "fret": {
      // a squared spiral of lightning, set lozengewise
      const step = r * 0.17;
      const pts: Pt[] = [];
      let x = 0, y = 0, len = 1, dir = 0;
      const dirs: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      pts.push([x, y]);
      for (let k = 0; k < 9; k++) {
        x += dirs[dir][0] * len * step;
        y += dirs[dir][1] * len * step;
        pts.push([x, y]);
        dir = (dir + 1) % 4;
        if (k % 2 === 1) len++;
      }
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const rot = (p: Pt): Pt => {
        const u = p[0] - cx, v = p[1] - cy;
        return [C + (u - v) * 0.7071, C + (u + v) * 0.7071];
      };
      const spiral = (pts: Pt[]) => polyD(pts.map(rot), false);
      ops.push({ addLine: spiral(pts), w: step * 0.55 });
      // and its twin, point-mirrored, interlocking
      ops.push({ addLine: polyD(pts.map((p) => rot([2 * cx - p[0], 2 * cy - p[1]])), false), w: step * 0.55 });
      return ops;
    }
    case "cartWheel": {
      const n = 12;
      ops.push({ add: circleD(C, C, r * 0.98) }, { cut: circleD(C, C, r * 0.8) });
      for (let i = 0; i < n; i++) ops.push({ addLine: polyD([pol(r * 0.2, (i * 360) / n), pol(r * 0.86, (i * 360) / n)], false), w: r * 0.09 });
      ops.push({ add: circleD(C, C, r * 0.3) }, { cut: circleD(C, C, r * 0.13) });
      return ops;
    }
    case "waves": {
      // overlapping fans of concentric arcs, row upon row, clipped to the round
      const R = r * 0.36;
      const rows = Math.ceil((2 * r) / (R * 0.5)) + 2;
      const fan: Op[] = [];
      for (let j = 0; j < rows; j++) {
        for (let i = -4; i <= 4; i++) {
          const x = C + i * R + (j % 2 ? R * 0.5 : 0);
          const y = C - r + j * R * 0.5;
          fan.push({ cutLine: `M${f(x - R)} ${f(y)}A${f(R)} ${f(R)} 0 0 1 ${f(x + R)} ${f(y)}Z`, w: gap * 0.9 });
          for (let k = 0; k < 4; k++) {
            const rr = R * (1 - k * 0.24);
            fan.push({ [k % 2 ? "cut" : "add"]: `M${f(x - rr)} ${f(y)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)}Z` } as Op);
          }
        }
      }
      const cid = uid(ctx, "wv");
      ctx.defs.set(cid, `<clipPath id="${cid}"><circle cx="${C}" cy="${C}" r="${f(r * 0.99)}"/></clipPath>`);
      ops.push({ raw: `<g clip-path="url(#${cid})">${opsMarkup(fan)}</g>` });
      return ops;
    }
    case "sunRays": {
      const n = 16;
      ops.push({ add: circleD(C, C, r * 0.5) });
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n;
        const long = i % 2 === 0;
        ops.push({ add: polyD([pol(r * 0.58, a - 7), pol(long ? r : r * 0.86, a), pol(r * 0.58, a + 7)]) });
      }
      return ops;
    }
    case "moonStar": {
      ops.push({ add: circleD(C, C, r * 0.95) }, { cut: circleD(C + r * 0.3, C - r * 0.12, r * 0.8) });
      ops.push({ add: circleD(C + r * 0.36, C - r * 0.2, r * 0.17) });
      return ops;
    }
    case "mountains": {
      // three peaks, the middle one tallest, cut by a parallel line
      const pk = (x: number, h: number, w: number) => polyD([[x - w, C + r * 0.5], [x, C + r * 0.5 - h], [x + w, C + r * 0.5]]);
      ops.push({ add: pk(C - r * 0.45, r * 0.85, r * 0.52) + pk(C + r * 0.45, r * 0.85, r * 0.52) });
      ops.push({ cutLine: polyD([[C - r * 0.45 - r * 0.62, C + r * 0.6], [C - r * 0.45, C + r * 0.5 - r * 0.85 - r * 0.08], [C - r * 0.45 + r * 0.62, C + r * 0.6]], false), w: gap });
      ops.push({ cutLine: polyD([[C + r * 0.45 - r * 0.62, C + r * 0.6], [C + r * 0.45, C + r * 0.5 - r * 0.85 - r * 0.08], [C + r * 0.45 + r * 0.62, C + r * 0.6]], false), w: gap });
      ops.push({ cutLine: polyD([[C - r * 0.7, C + r * 0.6], [C, C + r * 0.5 - r * 1.15 - r * 0.08], [C + r * 0.7, C + r * 0.6]], false), w: gap * 2.2 });
      ops.push({ add: pk(C, r * 1.15, r * 0.66) });
      ops.push({ cutLine: polyD([[C - r * 0.4, C + r * 0.5 - r * 0.45], [C, C + r * 0.5 - r * 0.85], [C + r * 0.4, C + r * 0.5 - r * 0.45]], false), w: gap });
      return ops;
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Assembly

function motifOps(ctx: Ctx, m: MonMotif, r: number): Op[] {
  switch (m.kind) {
    case "commas":
      return commas(m.n, m.swirl, r);
    case "flower":
      return flower(m.n, m.petal, r);
    case "leaves":
      return leaves(m.n, m.leaf, r);
    case "embrace":
      return embrace(m.leaf, m.inner, r, ctx);
    case "radial":
      return radial(ctx, m, r);
    case "crossed": {
      const s = r * 1.9;
      return chargeOps(ctx, m, [{ x: C, y: C, s, rot: -38 }, { x: C, y: C, s, rot: 38, flip: true }], r);
    }
    case "facing": {
      const asp = aspectOf(m.charge, m.attitude);
      const s = Math.min(r * 1.3, (r * 0.98) / Math.max(0.5, Math.min(1.6, asp)));
      return chargeOps(ctx, m, [{ x: C - r * 0.47, y: C, s, rot: 0, flip: true }, { x: C + r * 0.47, y: C, s, rot: 0 }], r);
    }
    case "single": {
      const asp = aspectOf(m.charge, m.attitude);
      const s = (r * 1.95) / Math.sqrt(1 + Math.min(1.6, Math.max(0.42, asp)) ** 2);
      return chargeOps(ctx, m, [{ x: C, y: C, s: Math.min(r * 1.7, s), rot: 0 }], r);
    }
    case "geometric":
      return geometric(ctx, m.shape, r);
  }
}

function opsMarkup(ops: Op[]): string {
  let s = "";
  for (const o of ops) {
    if ("add" in o) s += `<path d="${o.add}" fill="#fff"/>`;
    else if ("cut" in o) s += `<path d="${o.cut}" fill="#000"/>`;
    else if ("cutLine" in o) s += `<path d="${o.cutLine}" fill="none" stroke="#000" stroke-width="${f(o.w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if ("addLine" in o) s += `<path d="${o.addLine}" fill="none" stroke="#fff" stroke-width="${f(o.w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else s += o.raw;
  }
  return s;
}

/**
 * The mon's markup in a 200 × 200 frame (for embedding in seals, banners…).
 * `ink`/`ground` are CSS colours; ground "none" leaves the field transparent.
 */
export function monMarkup(ctx: Ctx, mon: Mon, ink: string, ground: string | "none", opts: { groundShape?: "disc" | "square" | "none" } = {}): string {
  const enc = enclosure(mon.enclosure);
  const m = mon.motif;
  const motif = motifOps(ctx, m, enc.r);
  const id = uid(ctx, "mon");
  const inner = opsMarkup(motif);
  ctx.defs.set(
    id,
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="-2" y="-2" width="204" height="204"><rect x="-2" y="-2" width="204" height="204" fill="#000"/>${opsMarkup(enc.ops)}${inner}</mask>`,
  );
  const gs = opts.groundShape ?? "none";
  const bg =
    ground === "none" || gs === "none"
      ? ""
      : gs === "disc"
        ? `<circle cx="${C}" cy="${C}" r="100" fill="${ground}"/>`
        : `<rect x="0" y="0" width="200" height="200" fill="${ground}"/>`;
  return `${bg}<rect x="-2" y="-2" width="204" height="204" fill="${ink}" mask="url(#${id})"/>`;
}

export interface MonRenderOptions {
  size?: number;
  idPrefix?: string;
  palette?: Palette | "illuminated" | "flat";
  /** Background behind the mon: a disc, a square tile, or none (transparent). Default "square". */
  background?: "disc" | "square" | "none";
  attrs?: string;
}

export function renderMonSVG(mon: Mon, opts: MonRenderOptions = {}): string {
  const size = opts.size ?? 160;
  const pal = typeof opts.palette === "string" ? PALETTES[opts.palette] ?? ILLUMINATED : opts.palette ?? ILLUMINATED;
  const ctx: Ctx = { id: opts.idPrefix ?? autoId(), pal, defs: new Map(), ids: new Map(), n: 0, px: size / 216, ow: 1, shading: false };
  const ink = pal.tinctures[mon.ink ?? "sable"].base;
  const ground = pal.tinctures[mon.ground ?? "argent"].base;
  const bgShape = opts.background ?? "square";
  const body = monMarkup(ctx, mon, ink, ground, { groundShape: bgShape });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 216 216" width="${f(size)}" height="${f(size)}"${opts.attrs ? " " + opts.attrs : ""}>` +
    (bgShape === "square" ? `<rect x="-8" y="-8" width="216" height="216" fill="${ground}"/>` : "") +
    defsMarkup(ctx) +
    body +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Description

const NUMW = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
const ENC_TEXT: Record<MonEnclosure, string> = {
  none: "",
  ring: "within a ring",
  thinRing: "within a thin ring",
  thickRing: "within a broad ring",
  doubleRing: "within a double ring",
  hexagon: "within a hexagon",
  lozenge: "within a lozenge",
  square: "within a square with canted corners",
  melon: "within a four-lobed melon frame",
};
const GEO_TEXT: Record<MonGeometric, string> = {
  scales: "three triangles conjoined in a triangle",
  fourSquares: "four squares set lozengewise",
  linkedRings: "two rings interlaced",
  squareRing: "a square voided, set lozengewise",
  fourLozenges: "a lozenge quartered into four",
  nineStars: "nine stars, one amid eight",
  threeStars: "three stars in triangle",
  snakeEye: "a snake's eye",
  fret: "two lightning frets interlocked",
  cartWheel: "a cartwheel of twelve spokes",
  waves: "a field of waves",
  sunRays: "a sun with sixteen rays",
  moonStar: "a crescent moon and a star",
  mountains: "three mountain peaks",
};
const PETAL_TEXT: Record<MonPetal, string> = { round: "plum blossom", notched: "cherry blossom", pointed: "bellflower", rayed: "chrysanthemum" };
const LEAF_TEXT: Record<MonLeaf, [string, string]> = { heart: ["heart-shaped leaf", "heart-shaped leaves"], oak: ["oak leaf", "oak leaves"], blade: ["slender leaf", "slender leaves"] };
const COLOUR: Record<Tincture, string> = { or: "gold", argent: "white", gules: "red", azure: "blue", vert: "green", purpure: "purple", sable: "black", tenne: "orange", sanguine: "crimson" };

function chargeNoun(id: ChargeId, n: number, att?: Attitude): string {
  const def = chargeDef(id);
  let s = n === 1 ? def.name : def.plural;
  if (att && def.attitudes && att !== def.attitudes[0]) s += " " + att;
  return s;
}

export function describeMon(mon: Mon): string {
  const m = mon.motif;
  let s: string;
  switch (m.kind) {
    case "commas": s = `${NUMW[m.n]} commas swirling ${m.swirl > 0 ? "sunwise" : "widdershins"}`; break;
    case "flower": s = `a ${m.petal === "rayed" ? `${NUMW[m.n] ?? m.n}-petalled ` : m.n !== 5 ? `${NUMW[m.n]}-petalled ` : ""}${PETAL_TEXT[m.petal]}`; break;
    case "leaves": s = `${NUMW[m.n]} ${LEAF_TEXT[m.leaf][1]} conjoined at the stems`; break;
    case "embrace": s = `two ${LEAF_TEXT[m.leaf][1]} embracing${m.inner ? ` ${/^[aeiou]/.test(chargeDef(m.inner).name) ? "an" : "a"} ${chargeDef(m.inner).name}` : ""}`; break;
    case "radial": s = `${NUMW[m.n]} ${chargeNoun(m.charge, m.n, m.attitude)} radiating, ${m.inward ? "heads inward" : "heads outward"}`; break;
    case "crossed": s = `two ${chargeNoun(m.charge, 2)} crossed`; break;
    case "facing": s = `two ${chargeNoun(m.charge, 2, m.attitude)} face to face`; break;
    case "single": { const nn = chargeNoun(m.charge, 1, m.attitude); s = `${/^[aeiou]/.test(nn) ? "an" : "a"} ${nn}`; break; }
    case "geometric": s = GEO_TEXT[m.shape]; break;
  }
  const enc = ENC_TEXT[mon.enclosure];
  const txt = `${s}${enc ? " " + enc : ""}`;
  return `${txt.charAt(0).toUpperCase()}${txt.slice(1)}, ${COLOUR[mon.ink ?? "sable"]} on ${COLOUR[mon.ground ?? "argent"]}.`;
}

// ---------------------------------------------------------------------------
// Generation

export interface MonOptions {
  /** Charges / concepts to cant on (the first usable one wins most of the time). */
  motifs?: ChargeId[];
  /** Prefer abstract motifs (commas, flowers, geometric) over charges. 0..1, default 0.5. */
  abstraction?: number;
  ink?: Tincture;
  ground?: Tincture;
}

const LONG_CROSSABLE: ChargeId[] = ["sword", "spear", "key", "feather", "axe", "hammer", "pine", "wheat", "horn", "anchor", "crossCouped"];
const RADIAL_OK: ChargeId[] = ["sword", "spear", "key", "feather", "axe", "hammer", "anchor", "bell", "heart", "fish", "flame", "wheat", "escallop", "fleurDeLis", "crescent", "mullet", "pheon", "lightning", "eye", "hand", "horn", "cup", "lozenge", "fusil", "goutte"];

/** Mon motifs a herald of this tradition might choose for a concept, with weights. */
function motifsFor(id: ChargeId, rng: Rng): [MonMotif, number][] {
  const def = CHARGES[id];
  if (!def) return [];
  const out: [MonMotif, number][] = [];
  const creature = def.category === "beast" || def.category === "bird" || def.category === "monster" || def.category === "fish";
  const special: Partial<Record<ChargeId, [MonMotif, number][]>> = {
    sun: [[{ kind: "geometric", shape: "sunRays" }, 6]],
    moon: [[{ kind: "geometric", shape: "moonStar" }, 6]],
    star: [[{ kind: "geometric", shape: "nineStars" }, 4], [{ kind: "geometric", shape: "threeStars" }, 3]],
    mullet: [[{ kind: "geometric", shape: "nineStars" }, 2], [{ kind: "geometric", shape: "threeStars" }, 2]],
    wave: [[{ kind: "geometric", shape: "waves" }, 6]],
    mountain: [[{ kind: "geometric", shape: "mountains" }, 6]],
    lightning: [[{ kind: "geometric", shape: "fret" }, 6]],
    eye: [[{ kind: "geometric", shape: "snakeEye" }, 6]],
    roundel: [[{ kind: "geometric", shape: "snakeEye" }, 3], [{ kind: "geometric", shape: "threeStars" }, 2]],
    annulet: [[{ kind: "geometric", shape: "linkedRings" }, 5]],
    wheel: [[{ kind: "geometric", shape: "cartWheel" }, 6]],
    lozenge: [[{ kind: "geometric", shape: "fourLozenges" }, 5]],
    fusil: [[{ kind: "geometric", shape: "fourLozenges" }, 5]],
    billet: [[{ kind: "geometric", shape: "fourSquares" }, 5]],
    mascle: [[{ kind: "geometric", shape: "squareRing" }, 5]],
    oak: [[{ kind: "leaves", n: 3, leaf: "oak" }, 5], [{ kind: "embrace", leaf: "oak" }, 4]],
    tree: [[{ kind: "leaves", n: 3, leaf: "heart" }, 3], [{ kind: "embrace", leaf: "heart" }, 2]],
    pine: [[{ kind: "leaves", n: 5, leaf: "blade" }, 2]],
    rose: [[{ kind: "flower", n: 5, petal: "notched" }, 5], [{ kind: "flower", n: 5, petal: "round" }, 3]],
    cinquefoil: [[{ kind: "flower", n: 5, petal: "round" }, 5]],
    quatrefoil: [[{ kind: "flower", n: 4, petal: "round" }, 5]],
    trefoil: [[{ kind: "leaves", n: 3, leaf: "heart" }, 5]],
    fleurDeLis: [[{ kind: "flower", n: 6, petal: "pointed" }, 2]],
    serpent: [[{ kind: "geometric", shape: "snakeEye" }, 3]],
    heart: [[{ kind: "radial", charge: "heart", n: 4, inward: true }, 4]],
    crescent: [[{ kind: "geometric", shape: "moonStar" }, 4]],
    flame: [[{ kind: "radial", charge: "flame", n: 3 }, 4]],
  };
  out.push(...(special[id] ?? []));
  if (LONG_CROSSABLE.includes(id)) out.push([{ kind: "crossed", charge: id }, 5]);
  if (RADIAL_OK.includes(id)) out.push([{ kind: "radial", charge: id, n: rng.pick([3, 3, 4, 5, 6]) }, 3]);
  if (creature) {
    const att = def.attitudes?.[0];
    out.push([{ kind: "single", charge: id, attitude: att }, 4]);
    out.push([{ kind: "facing", charge: id, attitude: att }, def.category === "bird" || def.category === "fish" ? 4 : 2]);
    if (id === "fish") out.push([{ kind: "radial", charge: "fish", n: 3 }, 4]);
  } else out.push([{ kind: "single", charge: id }, 3]);
  if (rng.chance(0.3)) out.push([{ kind: "embrace", leaf: rng.pick(["oak", "heart", "blade"] as MonLeaf[]), inner: id }, 1.5]);
  return out;
}

function abstractMotif(rng: Rng): MonMotif {
  return rng.weighted([
    [{ kind: "commas", n: rng.weighted([[3, 6], [2, 2], [4, 1]] as [number, number][]), swirl: rng.chance(0.5) ? 1 : -1 }, 6],
    [{ kind: "flower", n: 5, petal: rng.pick(["round", "notched", "pointed"] as MonPetal[]) }, 5],
    [{ kind: "flower", n: rng.pick([12, 16, 16, 24]), petal: "rayed" }, 2.5],
    [{ kind: "leaves", n: rng.weighted([[3, 5], [4, 1], [5, 1]] as [number, number][]), leaf: rng.pick(["heart", "oak", "blade"] as MonLeaf[]) }, 4],
    [{ kind: "embrace", leaf: rng.pick(["oak", "heart", "blade"] as MonLeaf[]) }, 2],
    [{ kind: "geometric", shape: rng.pick(MON_GEOMETRIC) }, 5],
  ] as [MonMotif, number][]);
}

/** Generate a mon. Deterministic in `rng`. */
export function generateMon(rng: Rng, opts: MonOptions = {}): Mon {
  const motifs = (opts.motifs ?? []).filter((m) => CHARGES[m]);
  let motif: MonMotif;
  if (motifs.length && rng.chance(1 - (opts.abstraction ?? 0.5) * 0.12)) {
    const cands = motifsFor(motifs[0], rng);
    motif = cands.length ? rng.weighted(cands) : abstractMotif(rng);
  } else if (!motifs.length && rng.chance(0.3 * (1 - (opts.abstraction ?? 0.5)) + 0.1)) {
    const id = rng.pick(["eagle", "falcon", "swan", "fish", "horse", "dragon", "sword", "key", "feather", "anchor", "bell", "wheel", "flame", "star", "sun", "moon", "wave", "mountain", "oak", "rose", "wheat"] as ChargeId[]);
    const cands = motifsFor(id, rng);
    motif = cands.length ? rng.weighted(cands) : abstractMotif(rng);
  } else motif = abstractMotif(rng);
  const enclosure: MonEnclosure =
    motif.kind === "geometric" && (motif.shape === "snakeEye" || motif.shape === "cartWheel")
      ? rng.pick(["none", "none", "thinRing"] as MonEnclosure[])
      : rng.weighted([["ring", 8], ["none", 6], ["thinRing", 3], ["thickRing", 2], ["doubleRing", 2], ["hexagon", 1.6], ["square", 1.1], ["melon", 1.1], ["lozenge", motif.kind === "geometric" || motif.kind === "flower" ? 1 : 0.2]] as [MonEnclosure, number][]);
  const mon: Mon = { motif, enclosure };
  const scheme = rng.weighted([[["sable", "argent"], 8], [["argent", "sable"], 4], [["or", "gules"], 1.2], [["argent", "azure"], 1.2], [["or", "sable"], 1], [["argent", "vert"], 0.6], [["gules", "argent"], 1]] as [[Tincture, Tincture], number][]);
  mon.ink = opts.ink ?? scheme[0];
  mon.ground = opts.ground ?? scheme[1];
  return mon;
}
