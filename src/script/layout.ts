/**
 * Text layout: clusters → positioned glyph outlines.
 *
 * All layout coordinates are in "units" of 1/100 em (glyph body height =
 * 100 units, y down, baseline at y = 100). Each placed item carries SVG path
 * data in its own unit space and an affine matrix into word space.
 */
import type { Script, Stroke, ScriptStyle } from "./types";
import { spellWord, formOf, glyphOf, blockVertical, type Cluster, type SpellOptions } from "./spell";
import { outlinePolys, polysToPath } from "./outline";
import { transformStrokes, translate, scale, mul, strokesBBox, line, smooth, dot, type Mat, type P, apply } from "./geom";
import { fitStrokes } from "./families";
import { hashString } from "../core/rng";

export interface Outline {
  /** SVG path data, units (1/100 em). */
  d: string;
  /** Ink bounding box in units. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedItem {
  d: string;
  /** Affine matrix [a b c d e f] from item units to word units. */
  m: Mat;
}

export interface WordLayout {
  items: PlacedItem[];
  /** Ink bounding box in word units. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  direction: Script["direction"];
  /** Number of orthographic clusters (letters, syllables, blocks). */
  clusters: number;
}

// ---------------------------------------------------------------------------
// Outline cache
// ---------------------------------------------------------------------------

const cache = new Map<string, Outline>();
const MAX_CACHE = 20000;

export function styleKey(s: ScriptStyle): string {
  return `${s.tool}/${s.weight}/${s.contrast}/${s.nibAngle}/${s.cornering}/${s.slant}/${s.serif}/${s.taper}`;
}

/** Outline strokes with a style (slant applied), cached by key. */
export function outlineStrokes(style: ScriptStyle, strokes: Stroke[], key: string, seed = 0, weightScale = 1): Outline {
  const k = key ? `${styleKey(style)}|${weightScale}|${key}` : "";
  if (k) {
    const hit = cache.get(k);
    if (hit) return hit;
  }
  const sl = style.slant;
  const st = sl ? transformStrokes(strokes, [1, 0, -sl, 1, sl, 0], false) : strokes;
  const polys = outlinePolys(st, style, seed, weightScale);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys)
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
  if (!isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  const o: Outline = { d: polysToPath(polys), x0: x0 * 100, y0: y0 * 100, x1: x1 * 100, y1: y1 * 100 };
  if (k) {
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(k, o);
  }
  return o;
}

export function clearOutlineCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Units (one cluster each)
// ---------------------------------------------------------------------------

interface Unit {
  strokes: Stroke[];
  adv: number; // em
  entry?: P;
  exit?: P;
  key: string;
  /** ink box in em (skeleton-based estimate) */
  top: number;
  bottom: number;
  /** Stroke weight multiplier (syllable blocks are drawn lighter). */
  wscale?: number;
}

function markStrokes(s: Script, id: number): Stroke[] {
  const g = glyphOf(s, id);
  if (!g) return [];
  return g.strokes.map((st) => ({ ...st, w: (st.w ?? 1) * 0.92 }));
}

function buildUnit(s: Script, c: Cluster): Unit {
  if (c.block) return buildBlock(s, c);
  const strokes: Stroke[] = [];
  let x = 0;
  const keyParts: string[] = [];
  // Pre-base signs sit on the reading-direction side: left in ltr, right in rtl.
  const rtl = s.direction === "rtl" || (s.direction === "ttb" && s.style.joins);
  const leftMarks = rtl ? c.after : c.before;
  const rightMarks = rtl ? c.before : c.after;
  for (const id of leftMarks) {
    const g = glyphOf(s, id);
    if (!g) continue;
    strokes.push(...transformStrokes(markStrokes(s, id), translate(x, 0)));
    x += g.w + 0.03;
    keyParts.push(`b${id}`);
  }
  let entry: P | undefined;
  let exit: P | undefined;
  let top = 0;
  let bottom = 1;
  let ax = x + 0.3;
  if (c.base) {
    const f = formOf(s, c.base);
    if (f) {
      const bx = x;
      const bb = strokesBBox(f.strokes);
      let fs = f.strokes;
      if (c.small) {
        // raised final: sits high on the line
        const lift = -Math.max(0, bb.y0) - 0.02;
        fs = transformStrokes(fs, translate(0, lift));
        top = Math.min(top, bb.y0 + lift);
      } else {
        top = Math.min(top, bb.y0);
        bottom = Math.max(bottom, bb.y1);
      }
      strokes.push(...transformStrokes(fs, translate(bx, 0)));
      keyParts.push(`g${c.base.g}${c.base.ops ? "o" + c.base.ops.join(".") : ""}${c.base.rot !== undefined ? "r" + c.base.rot : ""}${c.small ? "s" : ""}`);
      ax = bx + (bb.x0 + bb.x1) / 2;
      if (f.entry) entry = [f.entry[0] + bx, f.entry[1]];
      if (f.exit) exit = [f.exit[0] + bx, f.exit[1]];
      // Subjoined conjuncts.
      let sy = Math.max(1.04, bb.y1 + 0.04);
      for (const sub of c.sub) {
        const sf = formOf(s, sub);
        if (!sf) continue;
        const k = 0.6;
        const sbb = strokesBBox(sf.strokes);
        const sx = bx + (bb.x0 + bb.x1) / 2 - ((sbb.x0 + sbb.x1) / 2) * k;
        const m = mul(translate(sx, sy - sbb.y0 * k), scale(k));
        strokes.push(...transformStrokes(sf.strokes, m));
        sy += (sbb.y1 - sbb.y0) * k + 0.05;
        keyParts.push(`u${sub.g}`);
      }
      bottom = Math.max(bottom, sy - 0.04);
      x = bx + f.w;
    }
  }
  // Above / below marks, stacked.
  let ay = Math.min(0, top) - 0.07;
  for (const id of c.above) {
    const ms = markStrokes(s, id);
    const mb = strokesBBox(ms);
    strokes.push(...transformStrokes(ms, translate(ax, ay)));
    ay += Math.min(-0.2, mb.y0 - 0.06);
    keyParts.push(`a${id}`);
  }
  top = Math.min(top, ay);
  let by = Math.max(1, bottom) + 0.07;
  for (const id of c.below) {
    const ms = markStrokes(s, id);
    const mb = strokesBBox(ms);
    strokes.push(...transformStrokes(ms, translate(ax, by)));
    by += Math.max(0.2, mb.y1 + 0.06);
    keyParts.push(`w${id}`);
  }
  bottom = Math.max(bottom, by);
  for (const id of rightMarks) {
    const g = glyphOf(s, id);
    if (!g) continue;
    strokes.push(...transformStrokes(markStrokes(s, id), translate(x + 0.02, 0)));
    x += g.w + 0.03;
    keyParts.push(`f${id}`);
  }
  return { strokes, adv: Math.max(0.12, x), entry, exit, key: keyParts.join(""), top, bottom };
}

function buildBlock(s: Script, c: Cluster): Unit {
  const b = c.block!;
  const vertical = blockVertical(s, b.vowel);
  const hasCoda = b.coda.length > 0;
  const strokes: Stroke[] = [];
  const put = (ids: number[], x0: number, y0: number, x1: number, y1: number): void => {
    const n = ids.length;
    ids.forEach((id, i) => {
      const g = glyphOf(s, id);
      if (!g) return;
      const w = (x1 - x0) / n;
      strokes.push(...fitStrokes(g.strokes, x0 + i * w + 0.02, y0, x0 + (i + 1) * w - 0.02, y1));
    });
  };
  // Blocks are a little taller than the body and drawn lighter, as in Hangul.
  const T = -0.12;
  const S = 1.0;
  const H = S - T;
  const Y = (f: number): number => T + f * H;
  if (vertical) {
    const yb = hasCoda ? 0.56 : 1;
    put(b.onset, 0.03, Y(0.05), 0.58, Y(yb - 0.05));
    put([b.vowel], 0.66, Y(0), 0.97, Y(yb));
    if (hasCoda) put(b.coda, 0.1, Y(0.64), 0.9, Y(1));
  } else {
    const y1 = hasCoda ? 0.3 : 0.46;
    put(b.onset, 0.14, Y(0.02), 0.86, Y(y1));
    const vy = hasCoda ? 0.42 : 0.6;
    put([b.vowel], 0.02, Y(vy - 0.1), 0.98, Y(vy + 0.1));
    if (hasCoda) put(b.coda, 0.14, Y(0.64), 0.86, Y(1));
  }
  return { strokes, adv: 1.04, key: `B${b.onset.join(".")}v${b.vowel}c${b.coda.join(".")}`, top: T, bottom: 1, wscale: 0.82 };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export interface LayoutOptions extends SpellOptions {
  /** Hand irregularity (default true). */
  jitter?: boolean;
  /** Seed salt for jitter (e.g. a place id) so repeated words vary slightly. */
  salt?: number;
  /**
   * Set a vertical (ttb) script on a horizontal line, e.g. for map labels:
   * column scripts built on a spine (Mongolian- or Ogham-like) lie on their
   * side as their horizontal ancestors were written; stacked-block scripts
   * run left to right, as Korean does in horizontal text.
   */
  horizontal?: boolean;
}

function unitOutline(s: Script, u: Unit): Outline {
  return outlineStrokes(s.style, u.strokes, `${s.id}|${u.key}`, hashString(u.key) & 0xffff, u.wscale ?? 1);
}

function jitterMat(s: Script, i: number, key: string, salt: number, cx: number, cy: number): Mat {
  const j = s.style.jitter;
  if (j <= 0 || s.style.joins || s.style.stemline) return [1, 0, 0, 1, 0, 0];
  const h = hashString(`${key}:${i}:${salt}`, 7);
  const r1 = ((h & 0xff) / 255 - 0.5) * 2;
  const r2 = (((h >>> 8) & 0xff) / 255 - 0.5) * 2;
  const r3 = (((h >>> 16) & 0xff) / 255 - 0.5) * 2;
  const a = r1 * 0.022 * j;
  const sc = 1 + r3 * 0.03 * j;
  const dy = r2 * 2.2 * j;
  const c = Math.cos(a) * sc;
  const sn = Math.sin(a) * sc;
  // rotate+scale about (cx, cy)
  return [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy + dy];
}

/** Lay out one word (a list of IPA phonemes). */
export function layoutWord(s: Script, word: string[], opts: LayoutOptions = {}): WordLayout {
  const clusters = spellWord(s, word, opts);
  return layoutClusters(s, clusters, opts);
}

/** Lay out several words with the script's word divider. */
export function layoutText(s: Script, words: string[][], opts: LayoutOptions = {}): WordLayout {
  const all: (Cluster | "sep")[] = [];
  words.forEach((w, i) => {
    if (i > 0) all.push("sep");
    all.push(...spellWord(s, w, opts));
  });
  return layoutClusters(s, all, opts);
}

function separatorUnit(s: Script): Unit {
  const sep = s.style.separator;
  const st: Stroke[] =
    sep === "dot"
      ? [dot(0.12, 0.5, 0.06)]
      : sep === "colon"
        ? [dot(0.12, 0.3, 0.055), dot(0.12, 0.72, 0.055)]
        : sep === "bar"
          ? [line(0.12, 0.05, 0.12, 0.95)]
          : [];
  return { strokes: st, adv: sep === "space" ? 0.45 : 0.24, key: `sep-${sep}`, top: 0, bottom: 1 };
}

function layoutClusters(s: Script, clusters: (Cluster | "sep")[], opts: LayoutOptions): WordLayout {
  const st = s.style;
  const units = clusters.map((c) => (c === "sep" ? separatorUnit(s) : buildUnit(s, c)));
  const items: PlacedItem[] = [];
  const dir = s.direction;
  const spine = dir === "ttb" && (st.joins || st.stemline);
  const rotated = spine && !opts.horizontal;
  const upright = dir === "ttb" && !spine && !opts.horizontal;
  const rtl = dir === "rtl" || (spine && st.joins);
  const extra: Stroke[] = [];
  const salt = opts.salt ?? 0;
  const jitter = opts.jitter !== false;
  let pen = 0;
  let minX = 0;
  let maxX = 0;
  let prevExit: P | null = null;
  units.forEach((u, i) => {
    const o = unitOutline(s, u);
    const isSep = clusters[i] === "sep";
    let X: number;
    let Y = 0;
    if (upright) {
      const h = Math.max(1, u.bottom - u.top);
      X = -u.adv / 2;
      Y = pen - Math.min(0, u.top);
      pen += h + st.spacing + 0.18;
    } else if (rtl) {
      X = -(pen + u.adv);
      pen += u.adv;
    } else {
      X = pen;
      pen += u.adv;
    }
    // Gap after this unit.
    const next = units[i + 1];
    let gap = st.spacing;
    if (st.joins) {
      const joinable = !!u.exit && !!next?.entry && !isSep && clusters[i + 1] !== "sep";
      gap = joinable ? 0 : 0.16;
    }
    if (!upright) pen += gap;
    // Connector for cursive joins whose points do not meet.
    if (st.joins && u.entry && prevExit && !isSep) {
      const ex: P = [X + u.entry[0], u.entry[1]];
      if (Math.hypot(ex[0] - prevExit[0], ex[1] - prevExit[1]) > 0.01) extra.push(line(prevExit[0], prevExit[1], ex[0], ex[1]));
    }
    prevExit = u.exit && !isSep ? [X + u.exit[0], u.exit[1]] : null;
    const m0: Mat = translate(X * 100, Y * 100);
    const jm = jitter && !isSep ? jitterMat(s, i, u.key, salt, (o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2) : null;
    items.push({ d: o.d, m: jm ? mul(m0, jm) : m0 });
    minX = Math.min(minX, X);
    maxX = Math.max(maxX, X + u.adv);
  });
  // Word-final swash for joined scripts.
  if (st.joins && prevExit && (s.morph.p.swash ?? 0) > 0.35) {
    const [ex, ey] = prevExit as P;
    const d = rtl ? -1 : 1;
    if ((s.morph.p.swash ?? 0) > 0.7) extra.push(smooth([[ex, ey], [ex + d * 0.22, ey + 0.02], [ex + d * 0.42, ey + 0.2], [ex + d * 0.34, ey + 0.36]]));
    else extra.push(smooth([[ex, ey], [ex + d * 0.3, ey], [ex + d * 0.42, ey - 0.12]]));
  }
  // Headline and stem line.
  if (st.headline && units.length) extra.push(line(minX + 0.01, 0, maxX - 0.01, 0));
  if (st.stemline && units.length) extra.push(line(minX - 0.18, 0.5, maxX + 0.1, 0.5));
  if (extra.length) {
    const o = outlineStrokes(s.style, extra, "", 1);
    items.push({ d: o.d, m: [1, 0, 0, 1, 0, 0] });
  }
  // Bounding box from item outlines.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const extraOutline = extra.length ? outlineStrokes(s.style, extra, "", 1) : null;
  units.forEach((u, i) => {
    const o = unitOutline(s, u);
    const m = items[i].m;
    for (const p of [
      [o.x0, o.y0],
      [o.x1, o.y0],
      [o.x0, o.y1],
      [o.x1, o.y1],
    ] as P[]) {
      const q = apply(m, p);
      x0 = Math.min(x0, q[0]);
      y0 = Math.min(y0, q[1]);
      x1 = Math.max(x1, q[0]);
      y1 = Math.max(y1, q[1]);
    }
  });
  if (extraOutline) {
    x0 = Math.min(x0, extraOutline.x0);
    y0 = Math.min(y0, extraOutline.y0);
    x1 = Math.max(x1, extraOutline.x1);
    y1 = Math.max(y1, extraOutline.y1);
  }
  if (!isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 50;
    y1 = 100;
  }
  const shown: Script["direction"] = dir === "ttb" && opts.horizontal ? (rtl ? "rtl" : "ltr") : dir;
  let layout: WordLayout = { items, x0, y0, x1, y1, direction: shown, clusters: units.length };
  if (rotated) layout = rotateLayout(layout, st.joins);
  return layout;
}

/** Rotate a horizontal layout into a vertical column (cursive: 90° CCW so rtl reads top-down). */
function rotateLayout(l: WordLayout, ccw: boolean): WordLayout {
  const R: Mat = ccw ? [0, -1, 1, 0, 0, 0] : [0, -1, 1, 0, 0, 0];
  const items = l.items.map((it) => ({ d: it.d, m: mul(R, it.m) }));
  const corners: P[] = [
    [l.x0, l.y0],
    [l.x1, l.y0],
    [l.x0, l.y1],
    [l.x1, l.y1],
  ].map((p) => apply(R, p as P));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { ...l, items, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// ---------------------------------------------------------------------------
// Flattening (one path in pixel space, e.g. for a canvas Path2D)
// ---------------------------------------------------------------------------

const f1 = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * Apply an affine matrix to path data made of M / l / z commands (the form
 * this module emits); returns absolute M / L / Z path data.
 */
export function transformPath(d: string, m: Mat): string {
  const tok = d.match(/[MLlz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = "";
  let x = 0;
  let y = 0;
  let i = 0;
  const emit = (c: string, px: number, py: number): void => {
    const q = apply(m, [px, py]);
    out.push(`${c}${f1(q[0])} ${f1(q[1])}`);
  };
  while (i < tok.length) {
    const t = tok[i];
    if (t === "M" || t === "L" || t === "l") {
      cmd = t;
      i++;
      continue;
    }
    if (t === "z") {
      out.push("Z");
      i++;
      continue;
    }
    const a = +tok[i];
    const b = +tok[i + 1];
    i += 2;
    if (cmd === "M") {
      x = a;
      y = b;
      emit("M", x, y);
      cmd = "L";
    } else if (cmd === "L") {
      x = a;
      y = b;
      emit("L", x, y);
    } else {
      x += a;
      y += b;
      emit("L", x, y);
    }
  }
  return out.join("");
}
