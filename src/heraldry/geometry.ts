/**
 * Geometry of field divisions and ordinaries within a frame.
 *
 * Divisions and variations are expressed as sets of half-planes bounded by
 * (possibly patterned) lines; the second tincture occupies their XOR, which
 * an SVG path with fill-rule="evenodd" renders directly. This makes
 * "quarterly", "gyronny", "barry wavy", "chequy" and "per chevron engrailed"
 * all fall out of the same few lines of code.
 */
import type { Field, Line, Ordinary, OrdinaryKind } from "./types";
import { patternLine, isParallel, isUpperOnly, lineSpec } from "./lines";
import { inPoly, polyD, type Pt } from "./path";
import { insetPoly, type Frame } from "./shapes";

const FAR = 3000;

const nrm = (dx: number, dy: number): Pt => {
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};

/** A straight or bent line, as a polyline that runs well beyond the frame. */
export interface DivLine {
  pts: Pt[];
}

function extend(p: Pt, dir: Pt, L: number): [Pt, Pt] {
  return [
    [p[0] - dir[0] * L, p[1] - dir[1] * L],
    [p[0] + dir[0] * L, p[1] + dir[1] * L],
  ];
}

/** Bend direction (dexter chief corner → fess point). */
export function bendDir(fr: Frame, sinister = false): Pt {
  return sinister ? nrm(fr.fx - (fr.x + fr.w), fr.fy - fr.y) : nrm(fr.fx - fr.x, fr.fy - fr.y);
}

export const CHEVRON_ANGLE = (40 * Math.PI) / 180;

/** Apex height (centre line) of a chevron in this frame. */
export function chevronApex(fr: Frame): number {
  return fr.fy - fr.h * 0.1;
}

function chevronLine(fr: Frame, apexY: number, inverted = false): Pt[] {
  const L = fr.w * 3;
  const c = Math.cos(CHEVRON_ANGLE), s = Math.sin(CHEVRON_ANGLE) * (inverted ? -1 : 1);
  return [
    [fr.fx - c * L, apexY + s * L],
    [fr.fx, apexY],
    [fr.fx + c * L, apexY + s * L],
  ];
}

/**
 * Half-plane polygon bounded by `line` (patterned), on the side given:
 * +1 = left of travel (screen space), -1 = right of travel.
 */
export function halfPlane(base: Pt[], line: Line | undefined, fr: Frame, side: 1 | -1, anchor?: Pt): Pt[] {
  const pts = patternLine(base, line, { u: fr.u, side: 1, anchor: anchor ?? [fr.fx, fr.fy] });
  const a = base[0], b = base[base.length - 1];
  const d = nrm(b[0] - a[0], b[1] - a[1]);
  const n: Pt = [d[1] * side, -d[0] * side];
  return [...pts, [b[0] + n[0] * FAR, b[1] + n[1] * FAR], [a[0] + n[0] * FAR, a[1] + n[1] * FAR]];
}

function straightHalf(base: Pt[], fr: Frame, side: 1 | -1): Pt[] {
  return halfPlane(base, "straight", fr, side);
}

export interface Division {
  /** One path per tincture after the first; each is evenodd. Index i → tinctures[i + 1]. */
  regions: string[];
  /** Lines to stroke as partition lines (patterned), for crisp edges between tinctures. */
  lines: Pt[][];
}

/** Compute the regions of a divided or varied field. */
export function divideField(field: Field, fr: Frame): Division {
  const { x, y, w, h, fx, fy } = fr;
  const line = field.line ?? "straight";
  const fess: Pt = [fx, fy];
  const halves: { base: Pt[]; side: 1 | -1; anchor?: Pt }[] = [];
  const V = (cx: number): Pt[] => [[cx, y - FAR / 10], [cx, y + h + FAR / 10]];
  const H = (cy: number): Pt[] => [[x - FAR / 10, cy], [x + w + FAR / 10, cy]];
  const ref: Pt = [x + w * 0.02, y + h * 0.02]; // dexter chief: must be the first tincture
  switch (field.partition) {
    case "plain":
      return { regions: [], lines: [] };
    case "perPale":
      halves.push({ base: V(fx), side: 1 });
      break;
    case "perFess":
      halves.push({ base: H(fy), side: -1 });
      break;
    case "perBend":
    case "perBendSinister": {
      const sin = field.partition === "perBendSinister";
      const d = bendDir(fr, sin);
      const [a, b] = extend(fess, d, w * 3);
      halves.push({ base: [a, b], side: sin ? 1 : -1 });
      break;
    }
    case "perChevron":
      halves.push({ base: chevronLine(fr, fr.fy - fr.h * 0.04), side: -1 });
      break;
    case "quarterly":
      halves.push({ base: V(fx), side: 1 }, { base: H(fy), side: -1 });
      break;
    case "perSaltire":
    case "gyronny": {
      const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
      halves.push({ base: extend(fess, d1, w * 3), side: 1 }, { base: extend(fess, d2, w * 3), side: 1 });
      if (field.partition === "gyronny") halves.push({ base: V(fx), side: 1 }, { base: H(fy), side: -1 });
      break;
    }
    case "tiercedInPale":
    case "tiercedInFess":
    case "perPall": {
      // three tinctures: build regions directly
      const regs: string[] = [];
      const lines: Pt[][] = [];
      if (field.partition === "tiercedInPale") {
        const a = halfPlane(V(x + w / 3), line, fr, 1), b = halfPlane(V(x + (2 * w) / 3), line, fr, 1);
        regs.push(polyD(a) + polyD(b), polyD(b));
        lines.push(V(x + w / 3), V(x + (2 * w) / 3));
      } else if (field.partition === "tiercedInFess") {
        const y1 = y + h * 0.3, y2 = y + h * 0.6;
        const a = halfPlane(H(y1), line, fr, -1), b = halfPlane(H(y2), line, fr, -1);
        regs.push(polyD(a) + polyD(b), polyD(b));
        lines.push(H(y1), H(y2));
      } else {
        // per pall: chief wedge t0, dexter t1, sinister t2
        const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
        const A: Pt[] = [[fx - d1[0] * w * 3, fy - d1[1] * w * 3], fess, [fx, y + h + FAR / 10]];
        const B: Pt[] = [[fx - d2[0] * w * 3, fy - d2[1] * w * 3], fess, [fx, y + h + FAR / 10]];
        const pa = patternLine(A, line, { u: fr.u, side: 1, anchor: fess });
        const pb = patternLine(B, line, { u: fr.u, side: 1, anchor: fess });
        // dexter region: left of A (travel from top-left down)
        const dex: Pt[] = [...pa, [x - FAR, y + h + FAR], [x - FAR, y - FAR]];
        const sin: Pt[] = [...pb, [x + w + FAR, y + h + FAR], [x + w + FAR, y - FAR]];
        regs.push(polyD(dex), polyD(sin));
        lines.push(A, B);
      }
      return { regions: regs, lines };
    }
    case "paly":
    case "barry":
    case "bendy":
    case "bendySinister":
    case "chevronny": {
      const n = Math.max(3, field.count ?? (field.partition === "barry" ? 6 : 6));
      if (field.partition === "paly") for (let k = 1; k < n; k++) halves.push({ base: V(x + (w * k) / n), side: 1, anchor: [x + (w * k) / n, fy] });
      else if (field.partition === "barry") for (let k = 1; k < n; k++) halves.push({ base: H(y + (h * k) / n), side: -1, anchor: [fx, y + (h * k) / n] });
      else if (field.partition === "chevronny") {
        const step = (h * 1.15) / n;
        const top = chevronApex(fr) - step * Math.ceil(n / 2);
        for (let k = 0; k < n + 3; k++) {
          const ay = top + k * step;
          halves.push({ base: chevronLine(fr, ay), side: -1, anchor: [fx, ay] });
        }
      } else {
        const sin = field.partition === "bendySinister";
        const d = bendDir(fr, sin);
        const nn: Pt = [-d[1], d[0]];
        const corners: Pt[] = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
        const proj = corners.map((c) => (c[0] - fx) * nn[0] + (c[1] - fy) * nn[1]);
        const m0 = Math.min(...proj), m1 = Math.max(...proj);
        for (let k = 1; k < n; k++) {
          const m = m0 + ((m1 - m0) * k) / n;
          const p: Pt = [fx + nn[0] * m, fy + nn[1] * m];
          halves.push({ base: extend(p, d, w * 3), side: 1, anchor: p });
        }
      }
      break;
    }
    case "chequy":
    case "lozengy": {
      const n = Math.max(3, field.count ?? 6);
      const cw = w / n;
      if (field.partition === "chequy") {
        for (let k = 1; k < n; k++) halves.push({ base: V(x + cw * k), side: 1 });
        const rows = Math.ceil(h / cw);
        for (let k = 1; k < rows + 1; k++) halves.push({ base: H(y + cw * k), side: -1 });
      } else {
        const ch = cw * 1.35;
        const r = ch / cw;
        const dA = nrm(1, r), dB = nrm(1, -r);
        // family A: y = r (x - x0) + k ch ; family B: y = -r (x - x0) + k ch
        const kmin = -Math.ceil((r * w) / ch) - 2, kmax = Math.ceil(h / ch) + Math.ceil((r * w) / ch) + 2;
        for (let k = kmin; k <= kmax; k++) {
          const pA: Pt = [x, y + k * ch];
          halves.push({ base: extend(pA, dA, w * 4), side: 1 });
          const pB: Pt = [x + w / 2 - cw / 2, y + k * ch + (r * (w / 2 - cw / 2))];
          halves.push({ base: extend(pB, dB, w * 4), side: 1 });
        }
      }
      break;
    }
  }
  let d = "";
  let parity = 0;
  const lines: Pt[][] = [];
  for (const hp of halves) {
    const poly = halfPlane(hp.base, line, fr, hp.side, hp.anchor);
    d += polyD(poly);
    if (inPoly(ref, straightHalf(hp.base, fr, hp.side))) parity ^= 1;
    lines.push(hp.base);
  }
  if (parity) {
    // The dexter chief is covered an odd number of times: flip by adding a frame-covering rectangle.
    d += polyD([[x - FAR, y - FAR], [x + w + FAR, y - FAR], [x + w + FAR, y + h + FAR], [x - FAR, y + h + FAR]]);
  }
  return { regions: [d], lines };
}

// ---------------------------------------------------------------------------
// Ordinaries

export interface OrdShape {
  /** Polygons that together (union) make up the ordinary. */
  polys: Pt[][];
  /** For voided shapes (orle): evenodd path instead of polys. */
  evenodd?: string;
}

export interface OrdMetrics {
  /** Band width of the principal ordinary. */
  band: number;
}

export function bandWidth(kind: OrdinaryKind, fr: Frame, count = 1, charged = false): number {
  const w = fr.w;
  if (count > 1) {
    const base = kind === "chevron" ? 0.15 : kind === "pile" ? 0.22 : 0.13;
    return w * base * (count > 2 ? 0.85 : 1);
  }
  switch (kind) {
    case "fess": case "pale": return w * (charged ? 0.32 : 0.29);
    case "bend": case "bendSinister": return w * (charged ? 0.3 : 0.27);
    case "chevron": case "chevronReversed": return w * (charged ? 0.27 : 0.24);
    case "cross": return w * (charged ? 0.27 : 0.24);
    case "saltire": return w * (charged ? 0.26 : 0.22);
    case "pall": case "pallReversed": return w * 0.2;
    case "orle": return w * 0.07;
    case "fret": return w * 0.1;
    default: return w * 0.28;
  }
}

/** Centre lines of the bands making up an ordinary (used for both drawing and charge placement). */
export interface Band {
  /** Centre polyline (2 points for a straight band, 3 for a chevron). */
  c: Pt[];
  /** Half width. */
  hw: number;
}

export function ordinaryBands(o: Ordinary, fr: Frame): Band[] {
  const n = Math.max(1, o.count ?? 1);
  const bw = bandWidth(o.kind, fr, n, !!o.charges);
  const hw = bw / 2;
  const { x, y, w, h, fx, fy } = fr;
  const L = w * 3;
  const bands: Band[] = [];
  const spread = (i: number, total: number, span: number) => (i - (total - 1) / 2) * span;
  switch (o.kind) {
    case "fess": {
      const gap = n === 1 ? 0 : Math.min(h * 0.22, (h * 0.62) / n);
      for (let i = 0; i < n; i++) {
        const cy = fy + spread(i, n, gap) + (n > 1 ? h * 0.02 : 0);
        bands.push({ c: [[x - L, cy], [x + w + L, cy]], hw });
      }
      break;
    }
    case "pale": {
      const gap = n === 1 ? 0 : Math.min(w * 0.3, (w * 0.75) / n);
      for (let i = 0; i < n; i++) {
        const cx = fx + spread(i, n, gap);
        bands.push({ c: [[cx, y - L], [cx, y + h + L]], hw });
      }
      break;
    }
    case "bend":
    case "bendSinister": {
      const sin = o.kind === "bendSinister";
      const d = bendDir(fr, sin);
      const nn: Pt = [-d[1], d[0]];
      const gap = n === 1 ? 0 : w * 0.24;
      for (let i = 0; i < n; i++) {
        const off = spread(i, n, gap);
        const p: Pt = [fx + nn[0] * off, fy + nn[1] * off];
        bands.push({ c: extend(p, d, L), hw });
      }
      break;
    }
    case "chevron":
    case "chevronReversed": {
      const inv = o.kind === "chevronReversed";
      const gap = n === 1 ? 0 : h * 0.2;
      const apex0 = inv ? fy + h * 0.14 : chevronApex(fr);
      for (let i = 0; i < n; i++) {
        const ay = apex0 + spread(i, n, gap) * (inv ? -1 : 1) + (n > 1 ? (inv ? -1 : 1) * h * 0.04 : 0);
        bands.push({ c: chevronLine(fr, ay, inv), hw });
      }
      break;
    }
    case "cross":
      bands.push({ c: [[fx, y - L], [fx, y + h + L]], hw }, { c: [[x - L, fy], [x + w + L, fy]], hw });
      break;
    case "saltire":
    case "fret":
      bands.push({ c: extend([fx, fy], bendDir(fr, false), L), hw }, { c: extend([fx, fy], bendDir(fr, true), L), hw });
      break;
    case "pall":
    case "pallReversed": {
      if (o.kind === "pall") {
        const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
        bands.push(
          { c: [[fx - d1[0] * L, fy - d1[1] * L], [fx + d1[0] * hw, fy + d1[1] * hw]], hw },
          { c: [[fx - d2[0] * L, fy - d2[1] * L], [fx + d2[0] * hw, fy + d2[1] * hw]], hw },
          { c: [[fx, fy - hw], [fx, y + h + L]], hw },
        );
      } else {
        const cy = fy + h * 0.06;
        const d1 = nrm(x - fx, y + h - cy), d2 = nrm(x + w - fx, y + h - cy);
        bands.push(
          { c: [[fx, y - L], [fx, cy + hw]], hw },
          { c: [[fx - d1[0] * hw, cy - d1[1] * hw], [fx + d1[0] * L, cy + d1[1] * L]], hw },
          { c: [[fx - d2[0] * hw, cy - d2[1] * hw], [fx + d2[0] * L, cy + d2[1] * L]], hw },
        );
      }
      break;
    }
    default:
      break;
  }
  return bands;
}

/** The outline polygon of a band with patterned edges. */
function bandPoly(b: Band, line: Line | undefined, fr: Frame, upperOnlyOk: boolean, scale = 1): Pt[] {
  const c = b.c;
  // Offset polyline by ±hw (miter at the chevron apex).
  const off = (s: number): Pt[] => {
    if (c.length === 2) {
      const d = nrm(c[1][0] - c[0][0], c[1][1] - c[0][1]);
      const n: Pt = [d[1] * s, -d[0] * s];
      return c.map((p) => [p[0] + n[0] * b.hw, p[1] + n[1] * b.hw] as Pt);
    }
    const out: Pt[] = [];
    for (let i = 0; i < c.length; i++) {
      const a = c[Math.max(0, i - 1)], bb = c[Math.min(c.length - 1, i + 1)];
      if (i === 0 || i === c.length - 1) {
        const d = nrm(bb[0] - a[0], bb[1] - a[1]);
        out.push([c[i][0] + d[1] * s * b.hw, c[i][1] - d[0] * s * b.hw]);
      } else {
        const d1 = nrm(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
        const d2 = nrm(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]);
        const n1: Pt = [d1[1], -d1[0]], n2: Pt = [d2[1], -d2[0]];
        let mx = n1[0] + n2[0], my = n1[1] + n2[1];
        const ml = Math.hypot(mx, my) || 1;
        mx /= ml; my /= ml;
        const k = b.hw / Math.max(0.2, mx * n1[0] + my * n1[1]);
        out.push([c[i][0] + mx * k * s, c[i][1] + my * k * s]);
      }
    }
    return out;
  };
  const left = off(1); // left of travel
  const right = off(-1);
  const anchor = c.length === 3 ? c[1] : ([fr.fx, fr.fy] as Pt);
  // Which edge is "upper"? For horizontal-ish bands travelling right, left of travel is up.
  const upperOnly = upperOnlyOk && isUpperOnly(line);
  const travelRight = c[c.length - 1][0] > c[0][0] + 1e-6;
  const leftIsUpper = travelRight;
  const pl = upperOnly && !leftIsUpper ? left : patternLine(left, line, { u: fr.u, side: 1, anchor, scale });
  const rr = right.slice().reverse();
  const pr = upperOnly && leftIsUpper ? rr : patternLine(rr, line, { u: fr.u, side: 1, anchor, scale, halfShift: isParallel(line) });
  return [...pl, ...pr];
}

function lineX(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/** Intersection of two polylines nearest a vertex (the outermost crossing within `reach`), as indices + point. */
function junction(a: Pt[], b: Pt[], v: Pt, reach: number): { ia: number; ib: number; p: Pt } | null {
  const near = (p: Pt, q: Pt) => Math.min(Math.hypot(p[0] - v[0], p[1] - v[1]), Math.hypot(q[0] - v[0], q[1] - v[1])) < reach;
  let best: { ia: number; ib: number; p: Pt } | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < a.length - 1; i++) {
    const p0 = a[i], p1 = a[i + 1];
    if (!near(p0, p1)) continue;
    const r: Pt = [p1[0] - p0[0], p1[1] - p0[1]];
    for (let j = 0; j < b.length - 1; j++) {
      const q0 = b[j], q1 = b[j + 1];
      if (!near(q0, q1)) continue;
      const sv: Pt = [q1[0] - q0[0], q1[1] - q0[1]];
      const den = r[0] * sv[1] - r[1] * sv[0];
      if (Math.abs(den) < 1e-12) continue;
      const qp: Pt = [q0[0] - p0[0], q0[1] - p0[1]];
      const t = (qp[0] * sv[1] - qp[1] * sv[0]) / den;
      const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const score = i + t + j + u;
      if (score > bestScore) {
        bestScore = score;
        best = { ia: i, ib: j, p: [p0[0] + r[0] * t, p0[1] + r[1] * t] };
      }
    }
  }
  return best;
}

/**
 * An ordinary made of arms radiating from a centre (chevron, cross, saltire,
 * pall): one polygon with patterned edges. Patterns are phased from the
 * centre so the arms are symmetric; "parallel" lines (wavy, nebuly…) keep
 * both edges of an arm parallel while the dexter and sinister arms mirror
 * each other; adjacent edges are joined where they actually cross.
 * `upperOnly`: lines that only treat the upper edge (embattled, raguly,
 * dovetailed) do so here (chevrons); otherwise they treat every edge.
 */
export function rayOrdinary(C: Pt, rays: Pt[], hw: number, line: Line | undefined, fr: Frame, upperOnly = false, scale = 1, lens?: number[]): Pt[] {
  const R = rays.map((d, i) => ({ d: nrm(d[0], d[1]), L: lens?.[i] ?? fr.w * 3 }));
  R.sort((a, b) => Math.atan2(a.d[1], a.d[0]) - Math.atan2(b.d[1], b.d[0]));
  const n = R.length;
  const spec = line && line !== "straight" ? lineSpec(line) : null;
  const up = isUpperOnly(line);
  const par = isParallel(line) && !up;
  // nn: the normal toward the next ray (clockwise on screen).
  const nnOf = (d: Pt): Pt => [-d[1], d[0]];
  const verts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = R[i], b = R[(i + 1) % n];
    const na = nnOf(a.d), nb = nnOf(b.d);
    const pa: Pt = [C[0] + na[0] * hw, C[1] + na[1] * hw];
    const pb: Pt = [C[0] - nb[0] * hw, C[1] - nb[1] * hw];
    verts.push(lineX(pa, a.d, pb, b.d) ?? [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]);
  }
  const tAlong = (p: Pt, d: Pt) => (p[0] - C[0]) * d[0] + (p[1] - C[1]) * d[1];
  const amp = spec ? spec.amp * fr.u * scale : 0, per = spec ? spec.period * fr.u * scale : 0;
  const back = hw * 2 + (amp + per) * 2;
  const reach = hw * 1.5 + (amp + per) * 2;
  const edge = (d: Pt, L: number, side: 1 | -1, t0: number): Pt[] => {
    const nn = nnOf(d);
    const o: Pt = [C[0] + nn[0] * hw * side, C[1] + nn[1] * hw * side];
    const base: Pt[] = [[o[0] + d[0] * t0, o[1] + d[1] * t0], [o[0] + d[0] * L, o[1] + d[1] * L]];
    if (!spec) return base;
    // outward normal of this edge (away from the arm)
    const out: Pt = [nn[0] * side, nn[1] * side];
    if (up && upperOnly && !(out[1] < -1e-6)) return base;
    const shift = par && (out[1] > 1e-6 || (Math.abs(out[1]) <= 1e-6 && out[0] > 0));
    // patternLine displaces along (dy, -dx) of travel = -nn for outward travel.
    return patternLine(base, line, { u: fr.u, side: side === 1 ? -1 : 1, anchor: C, scale, halfShift: shift });
  };
  const A: Pt[][] = [], B: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const r = R[i];
    const tA = Math.min(0, tAlong(verts[(i + n - 1) % n], r.d)) - back;
    const tB = Math.min(0, tAlong(verts[i], r.d)) - back;
    A.push(edge(r.d, r.L, -1, tA));
    B.push(edge(r.d, r.L, 1, tB));
  }
  // Join B[i] to A[i+1] where they cross near the inner vertex.
  const As = A.map((x) => x.slice()), Bs = B.map((x) => x.slice());
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x = junction(B[i], A[j], verts[i], reach);
    if (x) {
      Bs[i] = [x.p, ...B[i].slice(x.ia + 1)];
      As[j] = [x.p, ...A[j].slice(x.ib + 1)];
    } else {
      const v = verts[i];
      Bs[i] = [v, ...B[i].filter((p) => tAlong(p, R[i].d) > tAlong(v, R[i].d))];
      As[j] = [v, ...A[j].filter((p) => tAlong(p, R[j].d) > tAlong(v, R[j].d))];
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(...As[i], ...Bs[i].slice().reverse());
  return out;
}

export function ordinaryShape(o: Ordinary, fr: Frame): OrdShape {
  const line = o.line ?? "straight";
  const n = Math.max(1, o.count ?? 1);
  const scale = n > 1 ? 0.7 : 1;
  const { x, y, w, h, fx } = fr;
  switch (o.kind) {
    case "pile": {
      const polys: Pt[][] = [];
      const np = Math.max(1, Math.min(3, n));
      for (let i = 0; i < np; i++) {
        const cx = np === 1 ? fx : x + w * (0.22 + (0.56 * i) / (np - 1));
        const pw = np === 1 ? w * 0.24 : w * 0.13;
        const tip: Pt = [np === 1 ? cx : fx + (cx - fx) * 0.35, y + h * (np === 1 ? 0.86 : 0.88)];
        const A: Pt[] = [[cx - pw, y - 20], tip];
        const B: Pt[] = [tip, [cx + pw, y - 20]];
        const pa = patternLine(A, line, { u: fr.u, side: 1, anchor: [cx - pw * 0.5, y + h * 0.4], scale });
        const pb = patternLine(B, line, { u: fr.u, side: 1, anchor: [cx + pw * 0.5, y + h * 0.4], scale });
        polys.push([...pa, ...pb.slice(1)]);
      }
      return { polys };
    }
    case "orle": {
      const d1 = w * 0.12, d2 = d1 + bandWidth("orle", fr);
      const outer = insetPoly(fr.poly, d1);
      const inner = insetPoly(fr.poly, d2);
      const po = patternLine(outer, line, { u: fr.u, side: 1, closed: true, scale: 0.6, anchor: [fr.fx, y] });
      const pi = patternLine(inner, line, { u: fr.u, side: -1, closed: true, scale: 0.6, anchor: [fr.fx, y] });
      return { polys: [], evenodd: polyD(po) + polyD(pi) };
    }
    case "base": {
      const by = y + h * 0.8;
      const top = patternLine([[x - 50, by], [x + w + 50, by]], line, { u: fr.u, side: 1, anchor: [fx, by] });
      return { polys: [[...top, [x + w + 50, y + h + 50], [x - 50, y + h + 50]]] };
    }
    case "cross":
    case "saltire":
    case "fret":
    case "pall":
    case "pallReversed": {
      const hw = bandWidth(o.kind, fr, 1, !!o.charges) / 2;
      const C: Pt = [fr.fx, fr.fy];
      let rays: Pt[];
      if (o.kind === "cross") rays = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      else if (o.kind === "saltire" || o.kind === "fret") {
        const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
        rays = [d1, [-d1[0], -d1[1]], d2, [-d2[0], -d2[1]]];
      } else if (o.kind === "pall") {
        const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
        rays = [[-d1[0], -d1[1]], [-d2[0], -d2[1]], [0, 1]];
      } else {
        const cy = fr.fy + fr.h * 0.06;
        C[1] = cy;
        rays = [[0, -1], [x - fx, y + h - cy], [x + w - fx, y + h - cy]];
      }
      if (o.kind === "fret") {
        return { polys: [rayOrdinary(C, rays, hw * 0.5, line, fr, false, scale)] };
      }
      return { polys: [rayOrdinary(C, rays, hw, line, fr, false, scale)] };
    }
    case "chevron":
    case "chevronReversed": {
      const bands = ordinaryBands(o, fr);
      const up = o.kind === "chevron";
      const c = Math.cos(CHEVRON_ANGLE), sn = Math.sin(CHEVRON_ANGLE) * (up ? 1 : -1);
      return { polys: bands.map((b) => rayOrdinary(b.c[1], [[-c, sn], [c, sn]], b.hw, line, fr, up, scale)) };
    }
    default: {
      const bands = ordinaryBands(o, fr);
      const polys = bands.map((b) => bandPoly(b, line, fr, o.kind !== "pale" && o.kind !== "cross" && o.kind !== "saltire" && o.kind !== "pall", scale));
      if (o.kind === "bend" || o.kind === "bendSinister" || o.kind === "fess" || o.kind === "pale") {
        if (o.cotised && n === 1) {
          // two narrow cotises on either side
          for (const b of bands) {
            const d = nrm(b.c[1][0] - b.c[0][0], b.c[1][1] - b.c[0][1]);
            const nn: Pt = [d[1], -d[0]];
            const cw = w * 0.035;
            for (const s of [-1, 1]) {
              const off = b.hw + w * 0.065;
              const cb: Band = { c: b.c.map((p) => [p[0] + nn[0] * off * s, p[1] + nn[1] * off * s] as Pt), hw: cw };
              polys.push(bandPoly(cb, "straight", fr, false));
            }
          }
        }
      }
      return { polys };
    }
  }
}

/** Chief geometry. */
export function chiefHeight(fr: Frame): number {
  return Math.min(fr.h * 0.3, fr.w * 0.3);
}
export function chiefPoly(fr: Frame, line: Line | undefined): Pt[] {
  const ch = chiefHeight(fr);
  const { x, y, w } = fr;
  const yb = y + ch;
  const edge = patternLine([[x + w + 40, yb], [x - 40, yb]], line, { u: fr.u, side: 1, anchor: [fr.fx, yb] });
  return [[x - 40, y - 40], [x + w + 40, y - 40], ...edge];
}

export function bordureWidth(fr: Frame, charged: boolean): number {
  return fr.w * (charged ? 0.125 : 0.105);
}

export function cantonBox(fr: Frame, sinister = false): [number, number, number, number] {
  const s = fr.w * 0.38;
  return [sinister ? fr.x + fr.w - s : fr.x, fr.y, s, s];
}
