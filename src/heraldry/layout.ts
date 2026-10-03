/**
 * Charge placement: computes slots (centre, size, rotation) for groups of
 * charges — alone on the field, around ("between") an ordinary, on an
 * ordinary, on a chief, canton or bordure, or in orle.
 *
 * Rows of charges are fitted into the visible polygon by a small search over
 * charge size and vertical offset, so the same arrangement adapts to a
 * heater's tapering base, a round targe or a lozenge.
 */
import type { Arrangement, Ordinary } from "./types";
import { bandWidth, bendDir, chevronApex, CHEVRON_ANGLE, ordinaryBands, chiefHeight, bordureWidth } from "./geometry";
import { insetPoly, spanOver, type Frame } from "./shapes";
import { inPoly, polySpanBetween, resampleClosed, type Pt } from "./path";
import { lineSpec } from "./lines";

export interface Slot {
  x: number;
  y: number;
  /** Size of the square cell the charge must fit in. */
  s: number;
  /** Rotation in degrees. */
  rot?: number;
  /** Mirror horizontally (respectant pairs). */
  flip?: boolean;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What layout needs to know about a charge's shape. */
export interface ChargeShape {
  /** Width / height of the charge's bounding box. */
  aspect: number;
  /** Silhouette bands (see charges/index.ts); absent → treat as a rectangle. */
  profile?: { v0: number; v1: number; u0: number; u1: number }[];
}

/** Charge width/height inside a cell of height s (matches the renderer's fit rule). */
export function chargeDims(s: number, aspect: number): [number, number] {
  const a = Math.max(0.42, Math.min(1.6, aspect));
  const cw = s * a;
  const h = Math.min(s, cw / aspect);
  return [h * aspect, h];
}

/** Does a charge of cell height s centred at (x, y) fit inside the polygon? */
export function fits(poly: Pt[], x: number, y: number, s: number, shape: ChargeShape, margin: number): boolean {
  const [w, h] = chargeDims(s, shape.aspect);
  const bands = shape.profile && shape.profile.length ? shape.profile : [{ v0: 0, v1: 1, u0: 0, u1: 1 }];
  for (const b of bands) {
    const y0 = y - h / 2 + b.v0 * h, y1 = y - h / 2 + b.v1 * h;
    const sp = spanIn(poly, y0, y1, margin);
    if (!sp) return false;
    const x0 = x - w / 2 + b.u0 * w, x1 = x - w / 2 + b.u1 * w;
    if (x0 < sp[0] - 1e-6 || x1 > sp[1] + 1e-6) return false;
  }
  return true;
}

function spanIn(poly: Pt[], y0: number, y1: number, margin: number): [number, number] | null {
  const s = polySpanBetween(poly, y0, y1);
  if (!s) return null;
  let [lo, hi] = s;
  lo += margin;
  hi -= margin;
  return lo < hi ? [lo, hi] : null;
}

/**
 * Fit rows of charges (e.g. [2, 1]) into a box within a polygon.
 * aspect = charge width / height; ideal = preferred vertical centre.
 */
export function rows(poly: Pt[], box: Box, counts: number[], shapeOrAspect: ChargeShape | number, opts: { ideal?: number; cx?: number; gap?: number; margin?: number; maxS?: number } = {}): Slot[] {
  const shape: ChargeShape = typeof shapeOrAspect === "number" ? { aspect: shapeOrAspect } : shapeOrAspect;
  const aspect = shape.aspect;
  const nR = counts.length;
  const a = Math.max(0.42, Math.min(1.6, aspect));
  const gapK = opts.gap ?? 0.16;
  const margin = opts.margin ?? 0;
  const bh = box.y1 - box.y0;
  const ideal = opts.ideal ?? (box.y0 + box.y1) / 2;
  const tryFit = (s: number, extra: number): Slot[] | null => {
    const cw = s * a;
    const gap = s * gapK + extra;
    const chH = chargeDims(s, aspect)[1];
    const blockH = nR * chH + (nR - 1) * gap;
    if (blockH > bh + 1e-6) return null;
    const tIdeal = Math.max(0, Math.min(1, (ideal - blockH / 2 - box.y0) / Math.max(1e-6, bh - blockH)));
    const cands: number[] = [];
    for (let k = 0; k <= 20; k++) cands.push(k / 20);
    cands.sort((p, q) => Math.abs(p - tIdeal) - Math.abs(q - tIdeal));
    for (const t of cands) {
      const top = box.y0 + t * (bh - blockH);
      const out: Slot[] = [];
      let ok = true;
      for (let r = 0; r < nR && ok; r++) {
        const yc = top + r * (chH + gap) + chH / 2;
        const chW = chargeDims(s, aspect)[0];
        // Use the span at the charge's widest part for spacing, the silhouette for the fit test.
        const sp = spanIn(poly, yc - chH * 0.25, yc + chH * 0.1, margin);
        if (!sp) { ok = false; break; }
        const lo = Math.max(sp[0], box.x0), hi = Math.min(sp[1], box.x1);
        const n = counts[r];
        const avail = hi - lo;
        if (n * chW + (n - 1) * s * 0.08 > avail + 1e-6) { ok = false; break; }
        // Spread across the available width, but not wider than a comfortable spacing.
        const pitch = Math.min(avail / n, Math.max(cw, chW) * 1.9);
        const centre = opts.cx !== undefined ? Math.max(lo + (pitch * n) / 2, Math.min(hi - (pitch * n) / 2, opts.cx)) : (lo + hi) / 2;
        for (let j = 0; j < n; j++) {
          const x = centre + (j - (n - 1) / 2) * pitch;
          if (yc - chH / 2 < box.y0 - 1e-6 || yc + chH / 2 > box.y1 + 1e-6 || !fits(poly, x, yc, s, shape, margin)) { ok = false; break; }
          out.push({ x, y: yc, s });
        }
      }
      if (ok) return out;
    }
    return null;
  };
  let lo = 0, hi = Math.min(bh * 1.7, opts.maxS ?? Infinity);
  let best: Slot[] | null = null;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    const r = tryFit(mid, 0);
    if (r) { best = r; lo = mid; } else hi = mid;
  }
  if (!best) return [];
  if (nR > 1) {
    // Use some leftover height to breathe between rows.
    const s = best[0].s;
    let elo = 0, ehi = s * 0.7;
    for (let it = 0; it < 12; it++) {
      const mid = (elo + ehi) / 2;
      const r = tryFit(s, mid);
      if (r) { best = r; elo = mid; } else ehi = mid;
    }
  }
  return best;
}

/** Conventional rows for a count when arrangement is "auto". */
export function autoRows(count: number, aspect: number): number[] {
  switch (count) {
    case 1: return [1];
    case 2: return aspect > 1.25 ? [1, 1] : [2];
    case 3: return [2, 1];
    case 4: return [2, 2];
    case 5: return [2, 1, 2];
    case 6: return [3, 2, 1];
    case 7: return [3, 3, 1];
    case 8: return [3, 2, 3];
    case 9: return [3, 3, 3];
    case 10: return [4, 3, 2, 1];
    default: {
      const r: number[] = [];
      let left = count;
      while (left > 0) { r.push(Math.min(4, left)); left -= 4; }
      return r;
    }
  }
}

function boxOf(fr: Frame): Box {
  return { x0: fr.x, y0: fr.y, x1: fr.x + fr.w, y1: fr.y + fr.h };
}

/** Slots for charges alone on the field (or in a region of it). */
export function fieldSlots(fr: Frame, fit: Pt[], count: number, arrangement: Arrangement | undefined, cs: ChargeShape | number, long = false): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const aspect = shape.aspect;
  const m = fr.w * 0.065;
  const box: Box = { x0: fr.x + m, y0: fr.y + m, x1: fr.x + fr.w - m, y1: fr.y + fr.h - m * 0.5 };
  const arr = arrangement ?? "auto";
  const ideal = fr.fy;
  switch (arr) {
    case "pale": return rows(fit, box, Array(count).fill(1), shape, { ideal, margin: m * 0.5 });
    case "fess": return rows(fit, box, [count], shape, { ideal, margin: m * 0.5 });
    case "twoOne": return rows(fit, box, count === 3 ? [2, 1] : autoRows(count, aspect), shape, { ideal, margin: m * 0.5 });
    case "oneTwo": return rows(fit, box, [1, Math.max(1, count - 1)], shape, { ideal, margin: m * 0.5 });
    case "twoTwo": return rows(fit, box, [2, 2], shape, { ideal, margin: m * 0.5 });
    case "threeTwoOne": return rows(fit, box, [3, 2, 1], shape, { ideal, margin: m * 0.5 });
    case "chief": return rows(fit, { ...box, y1: fr.y + fr.h * 0.42 }, [count], shape, { ideal: fr.y, margin: m * 0.5 });
    case "saltire":
      if (count === 5) return rows(fit, box, [2, 1, 2], shape, { ideal, margin: m * 0.5 });
      break;
    case "crossed":
      if (count === 2) {
        const s = Math.min(fr.w, fr.h) * 0.78;
        return [
          { x: fr.fx, y: fr.fy, s, rot: -45 },
          { x: fr.fx, y: fr.fy, s, rot: 45, flip: true },
        ];
      }
      break;
    case "bend":
    case "bendSinister": {
      const d = bendDir(fr, arr === "bendSinister");
      const n = count;
      const span = Math.min(fr.w, fr.h) * 0.72;
      const s0 = Math.min(fr.w * 0.36, (span / n) * 1.05);
      const out: Slot[] = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * span;
        out.push({ x: fr.fx + d[0] * t, y: fr.fy - fr.h * 0.02 + d[1] * t, s: s0 });
      }
      return shrinkToFit(out, fit, m * 0.4, shape);
    }
    case "cross": {
      const s = fr.w * 0.26;
      const dx = fr.w * 0.3, dy = fr.w * 0.3;
      const pts: Pt[] = [[fr.fx, fr.fy - dy], [fr.fx - dx, fr.fy], [fr.fx + dx, fr.fy], [fr.fx, fr.fy + dy]];
      if (count === 5) pts.splice(2, 0, [fr.fx, fr.fy]);
      return shrinkToFit(pts.map(([x, y]) => ({ x, y, s })), fit, m * 0.4, shape);
    }
    case "orle":
      return orleSlots(fr, fit, count, fr.w * 0.13);
    default:
      break;
  }
  if (long && count === 2 && arr === "auto") {
    // Two long charges (swords, keys) are conventionally crossed in saltire.
    return fieldSlots(fr, fit, 2, "crossed", shape);
  }
  if (count >= 8 && arr === "auto") return orleSlots(fr, fit, count, fr.w * 0.13);
  return rows(fit, box, autoRows(count, aspect), shape, { ideal, margin: m * 0.5 });
}

/** Shrink slots until each fits inside the polygon. */
function shrinkToFit(slots: Slot[], fit: Pt[], margin: number, shape?: ChargeShape): Slot[] {
  return slots.map((sl) => {
    let s = sl.s;
    for (let it = 0; it < 30; it++) {
      if (shape && !sl.rot) {
        if (fits(fit, sl.x, sl.y, s, shape, margin)) break;
      } else {
        const sp = spanIn(fit, sl.y - s * 0.45, sl.y + s * 0.45, margin);
        if (sp && sl.x - s * 0.45 >= sp[0] && sl.x + s * 0.45 <= sp[1]) break;
      }
      s *= 0.94;
    }
    return { ...sl, s };
  });
}

/** Charges set around the edge of the field ("in orle") or on a bordure. */
export function orleSlots(fr: Frame, fit: Pt[], count: number, inset: number, sizeK = 1): Slot[] {
  // Follow the visible field (inside any bordure, below any chief).
  const path = insetPoly(fit, fit === fr.poly ? inset : inset * 0.72);
  const pts = resampleClosed(path, 1);
  // cumulative length
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[pts.length];
  // start at top centre
  let s0 = 0, best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dd = Math.abs(pts[i][0] - fr.fx) + (pts[i][1] > fr.fy ? 1e6 : 0);
    if (dd < best) { best = dd; s0 = cum[i]; }
  }
  const step = total / count;
  const out: Slot[] = [];
  const size = Math.min(step * 0.78, inset * 1.55) * sizeK;
  for (let k = 0; k < count; k++) {
    const s = (s0 + step * (k + 0.5)) % total;
    let j = 0;
    while (j < pts.length - 1 && cum[j + 1] < s) j++;
    const a = pts[j], b = pts[(j + 1) % pts.length];
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, s: size });
  }
  // Around sharp corners (a lozenge's points) neighbours come closer than the path length suggests.
  let dmin = Infinity;
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) dmin = Math.min(dmin, Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y));
  if (out.length > 1 && dmin * 0.92 < size) for (const o of out) o.s = dmin * 0.92;
  return out;
}

/** Slots for charges lying on an ordinary. */
export function onOrdinarySlots(o: Ordinary, fr: Frame, fit: Pt[], count: number, cs: ChargeShape | number, symmetric: boolean, long = false): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const aspect = shape.aspect;
  const bands = ordinaryBands(o, fr);
  const bw = bandWidth(o.kind, fr, 1, true);
  const s = bw * 0.8;
  const out: Slot[] = [];
  const { fx, fy } = fr;
  switch (o.kind) {
    case "fess": {
      const cy = bands[0].c[0][1];
      const sp = spanOver(fr, cy - s / 2, cy + s / 2, fr.w * 0.06) ?? [fr.x, fr.x + fr.w];
      if (long && count === 1) {
        // A sword or spear on a fess lies fesswise, point to the dexter.
        const len = Math.min((sp[1] - sp[0]) * 0.86, (bw * 0.8) / Math.max(0.12, Math.min(1, aspect)));
        return [{ x: (sp[0] + sp[1]) / 2, y: cy, s: len, rot: -90 }];
      }
      const box: Box = { x0: sp[0], y0: cy - bw / 2, x1: sp[1], y1: cy + bw / 2 };
      return rows(fit, box, [count], shape, { ideal: cy, gap: 0.05, maxS: s, margin: fr.w * 0.04 });
    }
    case "pale": {
      const box: Box = { x0: fx - bw / 2, y0: fr.y + fr.w * 0.05, x1: fx + bw / 2, y1: fr.y + fr.h * 0.9 };
      return rows(fit, box, Array(count).fill(1), shape, { ideal: fy, maxS: s, margin: 0 }).map((sl) => ({ ...sl, x: fx }));
    }
    case "bend":
    case "bendSinister": {
      const d = bendDir(fr, o.kind === "bendSinister");
      const ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
      // Long charges lie bendwise along the bend; other asymmetric ones turn with it.
      const rot = long ? (o.kind === "bend" ? ang - 90 : ang + 90 - 180) : symmetric ? 0 : o.kind === "bend" ? ang : ang - 180;
      const step = Math.min(fr.w * 0.34, s * 1.25);
      for (let i = 0; i < count; i++) {
        const t = (i - (count - 1) / 2) * step;
        const sz = long ? Math.min(step * 0.92, (bw * 0.8) / Math.max(0.12, Math.min(1, aspect))) : s * (count > 3 ? 0.85 : 1);
        out.push({ x: fx + d[0] * t, y: fy + d[1] * t, s: sz, rot });
      }
      if (long && count === 1) {
        // A lone sword or spear runs along the bend; the bend itself bounds its length.
        out[0].s = Math.min(fr.w * 0.78, (bw * 0.8) / Math.max(0.12, Math.min(1, aspect)));
        return out;
      }
      return shrinkToFit(out, fit, 0);
    }
    case "chevron":
    case "chevronReversed": {
      const c = bands[0].c;
      const apex = c[1];
      const inv = o.kind === "chevronReversed";
      const ss = s * 0.9;
      out.push({ x: apex[0], y: apex[1] + (inv ? -1 : 1) * bw * 0.06, s: ss });
      const dist = fr.w * 0.27;
      for (let k = 1; out.length < count; k++) {
        for (const side of [-1, 1]) {
          if (out.length >= count) break;
          out.push({
            x: apex[0] + side * Math.cos(CHEVRON_ANGLE) * dist * k,
            y: apex[1] + Math.sin(CHEVRON_ANGLE) * dist * k * (inv ? -1 : 1),
            s: ss * 0.92,
          });
        }
      }
      if (count === 2) out.shift();
      return shrinkToFit(out.slice(0, count), fit, 0);
    }
    case "cross":
    case "saltire": {
      out.push({ x: fx, y: fy, s: s * 0.95 });
      if (count > 1) {
        const dist = fr.w * 0.3;
        const dirs: Pt[] = o.kind === "cross" ? [[0, -1], [-1, 0], [1, 0], [0, 1]] : [bendDir(fr, false), bendDir(fr, true)].flatMap((d) => [[-d[0], -d[1]] as Pt, d]);
        for (const d of dirs.slice(0, count - 1)) out.push({ x: fx + d[0] * dist, y: fy + d[1] * dist, s: s * 0.82 });
      }
      return shrinkToFit(out, fit, 0);
    }
    case "pall":
    case "pallReversed":
      return [{ x: fx, y: fy + (o.kind === "pall" ? bw * 0.2 : 0), s: s * 0.9 }];
    case "pile": {
      const tipY = fr.y + fr.h * 0.86;
      const n = count;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const yy = fr.y + (tipY - fr.y) * (0.12 + t * 0.62);
        const width = fr.w * 0.48 * (1 - (yy - fr.y) / (tipY - fr.y));
        out.push({ x: fx, y: yy, s: Math.min(width * 0.8, (fr.h * 0.62) / n) });
      }
      return out;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Compartments: the parts of the field an ordinary leaves free

/** Clip a polygon to the half-plane {p : (p − a) · n ≥ 0} (Sutherland–Hodgman). */
export function clipHalf(poly: readonly Pt[], a: Pt, n: Pt): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** A half-plane: points p with (p − a) · n ≥ 0. */
type Half = [Pt, Pt];

function region(fit: Pt[], halves: Half[]): Pt[] {
  let p: Pt[] = fit;
  for (const [a, n] of halves) {
    p = clipHalf(p, a, n);
    if (p.length < 3) return [];
  }
  return p;
}

/** Largest cell size for a charge centred at (x, y) in poly (binary search). */
function maxSizeAt(poly: Pt[], x: number, y: number, shape: ChargeShape, margin: number, hi: number): number {
  let lo = 0;
  if (!fits(poly, x, y, hi * 0.02, shape, margin)) return 0;
  for (let it = 0; it < 13; it++) {
    const mid = (lo + hi) / 2;
    if (fits(poly, x, y, mid, shape, margin)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The largest charge that fits a region, and where: a grid search over centres
 * refined by pattern search. With a cap, the most comfortable (most central)
 * position for a charge of the capped size is chosen.
 */
export function bestFit(poly: Pt[], shape: ChargeShape, margin: number, cap = Infinity): Slot | null {
  if (poly.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of poly) {
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  const hi = Math.max(x1 - x0, y1 - y0) * 1.2;
  let best = { x: 0, y: 0, s: 0 };
  const N = 9;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / N, y = y0 + ((y1 - y0) * (j + 0.5)) / N;
      if (!inPoly([x, y], poly)) continue;
      const sz = maxSizeAt(poly, x, y, shape, margin, hi);
      if (sz > best.s) best = { x, y, s: sz };
    }
  }
  if (best.s <= 0) return null;
  let step = Math.max(x1 - x0, y1 - y0) / N / 2;
  for (let k = 0; k < 5; k++, step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
        const sz = maxSizeAt(poly, best.x + dx, best.y + dy, shape, margin, hi);
        if (sz > best.s + 1e-6) {
          best = { x: best.x + dx, y: best.y + dy, s: sz };
          moved = true;
        }
      }
    }
  }
  return { x: best.x, y: best.y, s: Math.min(cap, best.s) };
}

/** k charges in one compartment: the single best place, or rows. */
function fillRegion(reg: Pt[], k: number, shape: ChargeShape, margin: number, cap: number): Slot[] {
  if (k <= 0 || reg.length < 3) return [];
  if (k === 1) {
    const b = bestFit(reg, shape, margin, cap);
    return b ? [b] : [];
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of reg) {
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  const counts = (x1 - x0) > (y1 - y0) * 1.3 ? [k] : (y1 - y0) > (x1 - x0) * 1.3 ? Array(k).fill(1) : autoRows(k, shape.aspect);
  return rows(reg, { x0, y0, x1, y1 }, counts, shape, { margin, maxS: cap });
}

/** Distance to keep between charges and the edge of an ordinary (more for patterned edges). */
function ordinaryGap(o: Ordinary, fr: Frame): number {
  const sp = o.line ? lineSpec(o.line) : null;
  return fr.w * 0.035 + (sp ? sp.amp * fr.u * 1.1 : 0);
}

/**
 * Compartments around an ordinary, each with the number of charges it takes,
 * for ordinaries whose compartments are wedges (chevron, saltire, pall, pile,
 * cross, bend). Returns null for the others.
 */
function compartments(o: Ordinary, fr: Frame, fit: Pt[], count: number): { reg: Pt[]; k: number }[] | null {
  const { x, y, w, h, fx, fy } = fr;
  const gap = ordinaryGap(o, fr);
  const bands = ordinaryBands(o, fr);
  const C: Pt = [fx, fy];
  const vSplit = (sgn: 1 | -1, off = 0): Half => [[fx + sgn * off, 0], [sgn, 0]]; // sgn 1: x ≥ fx (sinister)
  switch (o.kind) {
    case "chevron":
    case "chevronReversed": {
      const inv = o.kind === "chevronReversed";
      const top = bands[0], bot = bands[bands.length - 1];
      const outer = inv ? bot : top, inner = inv ? top : bot;
      const c = Math.cos(CHEVRON_ANGLE), sn = Math.sin(CHEVRON_ANGLE);
      // "away" side of the chevron (chief for a chevron) and the opening (base).
      const awayY = (b: typeof top) => b.c[1][1] + (inv ? 1 : -1) * (b.hw + gap) / c;
      const openY = (b: typeof top) => b.c[1][1] + (inv ? -1 : 1) * (b.hw + gap) / c;
      const nAwayL: Pt = inv ? [-sn, c] : [-sn, -c], nAwayR: Pt = inv ? [sn, c] : [sn, -c];
      const pa: Pt = [fx, awayY(outer)], po: Pt = [fx, openY(inner)];
      const dexA = region(fit, [[pa, nAwayL], vSplit(-1)]);
      const sinA = region(fit, [[pa, nAwayR], vSplit(1)]);
      const open = region(fit, [[po, [-nAwayL[0], -nAwayL[1]]], [po, [-nAwayR[0], -nAwayR[1]]]]);
      // 3 → one each side and one in the opening; 5 → two, two and one; 6 → two, two, two…
      const side = count < 2 ? 0 : count <= 4 ? 1 : Math.floor((count - 1) / 2);
      const rest = count - side * 2;
      return [{ reg: inv ? open : dexA, k: inv ? rest : side }, { reg: inv ? dexA : sinA, k: inv ? side : side }, { reg: inv ? sinA : open, k: inv ? side : rest }]
        .filter((q) => q.k > 0);
    }
    case "saltire": {
      const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
      const n1: Pt = [d1[1], -d1[0]]; // up-right normal of the bend line
      const n2: Pt = [-d2[1], d2[0]];
      const hw = bands[0].hw + gap;
      const at = (n: Pt, k: number): Half => [[C[0] + n[0] * hw * k, C[1] + n[1] * hw * k], [n[0] * k, n[1] * k]];
      const topR = region(fit, [at(n1, 1), at(n2, 1)]);
      const botR = region(fit, [at(n1, -1), at(n2, -1)]);
      const dexR = region(fit, [at(n1, -1), at(n2, 1)]);
      const sinR = region(fit, [at(n1, 1), at(n2, -1)]);
      const order = count === 2 ? [dexR, sinR] : count === 3 ? [topR, dexR, sinR] : [topR, dexR, sinR, botR];
      const per = Math.max(1, Math.floor(count / order.length));
      return order.map((reg, i) => ({ reg, k: i < count % order.length ? per + 1 : per })).filter((q) => q.k > 0);
    }
    case "cross": {
      const hw = bands[0].hw + gap;
      const q = (sx: 1 | -1, sy: 1 | -1) => region(fit, [[[fx + sx * hw, 0], [sx, 0]], [[0, fy + sy * hw], [0, sy]]]);
      const order = [q(-1, -1), q(1, -1), q(-1, 1), q(1, 1)];
      const per = Math.max(1, Math.floor(count / 4));
      return order.map((reg, i) => ({ reg, k: count < 4 ? (i < count ? 1 : 0) : i < count % 4 ? per + 1 : per })).filter((z) => z.k > 0);
    }
    case "pall":
    case "pallReversed": {
      const inv = o.kind === "pallReversed";
      const hw = bandWidth(o.kind, fr) / 2 + gap;
      if (!inv) {
        const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
        const n1: Pt = [d1[1], -d1[0]], n2: Pt = [-d2[1], d2[0]];
        const topR = region(fit, [[[C[0] + n1[0] * hw, C[1] + n1[1] * hw], n1], [[C[0] + n2[0] * hw, C[1] + n2[1] * hw], n2]]);
        const dexR = region(fit, [[[C[0] - n1[0] * hw, C[1] - n1[1] * hw], [-n1[0], -n1[1]]], vSplit(-1, hw)]);
        const sinR = region(fit, [[[C[0] - n2[0] * hw, C[1] - n2[1] * hw], [-n2[0], -n2[1]]], [[fx + hw, 0], [1, 0]]]);
        return [{ reg: topR, k: count >= 1 ? 1 : 0 }, { reg: dexR, k: count >= 2 ? Math.ceil((count - 1) / 2) : 0 }, { reg: sinR, k: count >= 3 ? Math.floor((count - 1) / 2) : 0 }].filter((z) => z.k > 0);
      }
      const cy = fy + h * 0.06;
      const C2: Pt = [fx, cy];
      const e1 = norm2([x - fx, y + h - cy]), e2 = norm2([x + w - fx, y + h - cy]);
      const m1: Pt = [e1[1], -e1[0]], m2: Pt = [-e2[1], e2[0]]; // normals pointing toward the base wedge
      const baseR = region(fit, [[[C2[0] + m1[0] * hw, C2[1] + m1[1] * hw], m1], [[C2[0] + m2[0] * hw, C2[1] + m2[1] * hw], m2]]);
      const dexR = region(fit, [[[C2[0] - m1[0] * hw, C2[1] - m1[1] * hw], [-m1[0], -m1[1]]], [[fx - hw, 0], [-1, 0]]]);
      const sinR = region(fit, [[[C2[0] - m2[0] * hw, C2[1] - m2[1] * hw], [-m2[0], -m2[1]]], [[fx + hw, 0], [1, 0]]]);
      return [{ reg: dexR, k: count >= 2 ? Math.ceil((count - 1) / 2) : 0 }, { reg: sinR, k: count >= 3 ? Math.floor((count - 1) / 2) : 0 }, { reg: baseR, k: 1 }].filter((z) => z.k > 0);
    }
    case "pile": {
      if ((o.count ?? 1) > 1) return null;
      const pw = w * 0.24;
      const tip: Pt = [fx, y + h * 0.86];
      const eL = norm2([tip[0] - (fx - pw), tip[1] - (y - 20)]), eR = norm2([tip[0] - (fx + pw), tip[1] - (y - 20)]);
      const nL: Pt = [-eL[1], eL[0]], nR: Pt = [eR[1], -eR[0]]; // outward normals (dexter / sinister)
      const dexR = region(fit, [[[tip[0] + nL[0] * gap * 1.5, tip[1] + nL[1] * gap * 1.5], nL]]);
      const sinR = region(fit, [[[tip[0] + nR[0] * gap * 1.5, tip[1] + nR[1] * gap * 1.5], nR]]);
      return [{ reg: dexR, k: Math.ceil(count / 2) }, { reg: sinR, k: Math.floor(count / 2) }].filter((z) => z.k > 0);
    }
    case "bend":
    case "bendSinister": {
      const outerHw = (bands.length - 1) / 2 * w * 0.24 + bands[0].hw + gap + (o.cotised ? w * 0.1 : 0);
      const d = bendDir(fr, o.kind === "bendSinister");
      let nUp: Pt = [d[1], -d[0]];
      if (nUp[1] > 0) nUp = [-nUp[0], -nUp[1]];
      const upR = region(fit, [[[C[0] + nUp[0] * outerHw, C[1] + nUp[1] * outerHw], nUp]]);
      const dnR = region(fit, [[[C[0] - nUp[0] * outerHw, C[1] - nUp[1] * outerHw], [-nUp[0], -nUp[1]]]]);
      return [{ reg: upR, k: Math.ceil(count / 2) }, { reg: dnR, k: Math.floor(count / 2) }].filter((z) => z.k > 0);
    }
    default:
      return null;
  }
}

function norm2(v: Pt): Pt {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Charges several to a compartment set along a line through it (bendwise for a bend). */
function lineInRegion(reg: Pt[], k: number, dir: Pt, shape: ChargeShape, margin: number, cap: number): Slot[] {
  // centroid of the region
  let cx = 0, cy = 0;
  for (const [px, py] of reg) { cx += px; cy += py; }
  cx /= reg.length; cy /= reg.length;
  const one = bestFit(reg, shape, margin, cap);
  if (!one) return [];
  const centre: Pt = [(one.x + cx) / 2, (one.y + cy) / 2];
  // shrink until k charges in a row along dir all fit
  let s = one.s;
  for (let it = 0; it < 40; it++) {
    const step = s * 1.12;
    const out: Slot[] = [];
    let ok = true;
    for (let i = 0; i < k && ok; i++) {
      const t = (i - (k - 1) / 2) * step;
      const sl = { x: centre[0] + dir[0] * t, y: centre[1] + dir[1] * t, s };
      if (!fits(reg, sl.x, sl.y, s, shape, margin)) ok = false;
      out.push(sl);
    }
    if (ok) return out;
    s *= 0.93;
  }
  return [];
}

/** Slots for charges on the field around ("between") an ordinary. */
export function betweenSlots(o: Ordinary, fr: Frame, fit: Pt[], count: number, cs: ChargeShape | number): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const aspect = shape.aspect;
  const bands = ordinaryBands(o, fr);
  const bw = bandWidth(o.kind, fr, Math.max(1, o.count ?? 1), !!o.charges);
  const { x, y, w, h, fx, fy } = fr;
  const m = w * 0.06;
  const gapBand = w * 0.04;
  const comps = compartments(o, fr, fit, count);
  if (comps) {
    const cap = w * (count <= 3 ? 0.34 : count <= 4 ? 0.3 : 0.24);
    const margin = w * 0.012;
    const dir = o.kind === "bend" || o.kind === "bendSinister" ? bendDir(fr, o.kind === "bendSinister") : null;
    const out: Slot[] = [];
    for (const c of comps) {
      if (dir && c.k > 1) out.push(...lineInRegion(c.reg, c.k, dir, shape, margin, cap));
      else out.push(...fillRegion(c.reg, c.k, shape, margin, cap));
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    if (out.length === count) return equalise(out);
  }
  switch (o.kind) {
    case "fess": {
      const top = bands[0].c[0][1] - bands[0].hw - gapBand;
      const bot = bands[bands.length - 1].c[0][1] + bands[bands.length - 1].hw + gapBand;
      const upN = count === 1 ? 1 : count === 2 ? 1 : count === 3 ? 2 : count === 4 ? 2 : count === 6 ? 3 : Math.ceil(count / 2);
      const dnN = count - upN;
      const up = rows(fit, { x0: x + m, y0: y + m * 0.6, x1: x + w - m, y1: top }, [upN], shape, { margin: m * 0.4 });
      const dn = dnN > 0 ? rows(fit, { x0: x + m, y0: bot, x1: x + w - m, y1: y + h - m * 0.3 }, dnN === 3 ? [2, 1] : [dnN], shape, { margin: m * 0.4, ideal: bot }) : [];
      return equalise([...up, ...dn]);
    }
    case "pale": {
      const per = Math.ceil(count / 2);
      const left = rows(fit, { x0: x + m * 0.5, y0: y + m, x1: fx - bw / 2 - gapBand, y1: y + h - m }, Array(per).fill(1), shape, { margin: m * 0.3, ideal: fy });
      const right = rows(fit, { x0: fx + bw / 2 + gapBand, y0: y + m, x1: x + w - m * 0.5, y1: y + h - m }, Array(count - per).fill(1), shape, { margin: m * 0.3, ideal: fy });
      return equalise(interleave(left, right));
    }
    case "bend":
    case "bendSinister": {
      const sin = o.kind === "bendSinister";
      const d = bendDir(fr, sin);
      const nn: Pt = [-d[1], d[0]]; // for a dexter bend this points to dexter base... check sign below
      const outer = bands.length > 1 ? (bands.length - 1) / 2 * w * 0.24 : 0;
      const off = bands[0].hw + outer + w * 0.2;
      const per = Math.ceil(count / 2);
      const out: Slot[] = [];
      const s = Math.min(w * 0.3, count > 2 ? w * 0.19 : w * 0.3);
      for (const side of [-1, 1]) {
        const n = side === -1 ? per : count - per;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? (side === -1 ? -0.06 : 0.02) * w : (i - (n - 1) / 2) * s * 1.3;
          out.push({ x: fx + nn[0] * off * side + d[0] * t, y: fy + nn[1] * off * side + d[1] * t - h * 0.01, s });
        }
      }
      // order: chief side first
      out.sort((a, b) => a.y - b.y);
      return equalise(shrinkToFit(out, fit, m * 0.3, shape));
    }
    case "chevron":
    case "chevronReversed": {
      const inv = o.kind === "chevronReversed";
      const apexY = inv ? bands[0].c[1][1] : chevronApex(fr);
      const s = w * 0.25;
      const out: Slot[] = [];
      if (!inv) {
        const yy = y + Math.max(s * 0.62, (apexY - bw / 2 - y) * 0.48);
        out.push({ x: x + w * 0.21, y: yy, s }, { x: x + w * 0.79, y: yy, s });
        if (count >= 3) out.push({ x: fx, y: apexY + bw * 0.6 / Math.cos(CHEVRON_ANGLE) + (y + h - apexY) * 0.3, s });
      } else {
        out.push({ x: fx, y: y + h * 0.2, s });
        if (count >= 2) out.push({ x: x + w * 0.2, y: y + h * 0.66, s: s * 0.9 }, { x: x + w * 0.8, y: y + h * 0.66, s: s * 0.9 });
      }
      return equalise(shrinkToFit(out.slice(0, count), fit, m * 0.3, shape));
    }
    case "cross": {
      const hw = bands[0].hw + gapBand;
      const boxes: Box[] = [
        { x0: x + m * 0.5, y0: y + m * 0.5, x1: fx - hw, y1: fy - hw },
        { x0: fx + hw, y0: y + m * 0.5, x1: x + w - m * 0.5, y1: fy - hw },
        { x0: x + m * 0.5, y0: fy + hw, x1: fx - hw, y1: y + h },
        { x0: fx + hw, y0: fy + hw, x1: x + w - m * 0.5, y1: y + h },
      ];
      const out: Slot[] = [];
      for (const b of boxes.slice(0, count)) out.push(...rows(fit, b, [1], shape, { margin: m * 0.3 }));
      return equalise(out);
    }
    case "saltire": {
      const s = w * 0.22;
      const pts: Pt[] = [[fx, y + (fy - y) * 0.38], [x + w * 0.13, fy], [x + w * 0.87, fy], [fx, fy + (y + h - fy) * 0.55]];
      return equalise(shrinkToFit(pts.slice(0, count).map(([px, py]) => ({ x: px, y: py, s })), fit, m * 0.25, shape));
    }
    case "pall": {
      const s = w * 0.24;
      const pts: Pt[] = [[fx, y + (fy - y) * 0.36], [x + w * 0.17, y + h * 0.62], [x + w * 0.83, y + h * 0.62]];
      return equalise(shrinkToFit(pts.slice(0, count).map(([px, py]) => ({ x: px, y: py, s })), fit, m * 0.3, shape));
    }
    case "pallReversed": {
      const s = w * 0.24;
      const pts: Pt[] = [[x + w * 0.2, y + h * 0.3], [x + w * 0.8, y + h * 0.3], [fx, y + h * 0.8]];
      return equalise(shrinkToFit(pts.slice(0, count).map(([px, py]) => ({ x: px, y: py, s })), fit, m * 0.3, shape));
    }
    case "pile": {
      const s = w * 0.22;
      const pts: Pt[] = [[x + w * 0.15, y + h * 0.62], [x + w * 0.85, y + h * 0.62]];
      return equalise(shrinkToFit(pts.slice(0, count).map(([px, py]) => ({ x: px, y: py, s })), fit, m * 0.3, shape));
    }
    case "orle":
    case "fret": {
      const inner = insetPoly(fr.poly, w * 0.21);
      return fieldSlots(fr, inner, count, "auto", shape);
    }
    case "base": {
      const by = y + h * 0.8;
      return rows(fit, { x0: x + m, y0: y + m, x1: x + w - m, y1: by - gapBand }, autoRows(count, aspect), shape, { margin: m * 0.4 });
    }
    default:
      return [];
  }
}

function interleave(a: Slot[], b: Slot[]): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/** Charges of one group should all be the same size: use the smallest. */
function equalise(sl: Slot[]): Slot[] {
  if (!sl.length) return sl;
  const s = Math.min(...sl.map((q) => q.s));
  return sl.map((q) => ({ ...q, s }));
}

/**
 * Secondary charges set about a central one ("a rose between three martlets"):
 * the field round the principal is cut into sectors, one per charge, and each
 * charge fills the space its sector leaves beyond the principal.
 */
export function aroundSlots(principal: Slot, fr: Frame, fit: Pt[], count: number, cs: ChargeShape | number): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const ANGLES: Record<number, number[]> = {
    1: [90],
    2: [180, 0],
    3: [-135, -45, 90],
    4: [-135, -45, 45, 135],
    5: [-135, -45, 15, 90, 165],
  };
  const angs = (ANGLES[count] ?? ANGLES[5]).map((a) => (a * Math.PI) / 180);
  const sorted = angs.map((a, i) => ({ a, i })).sort((p, q) => p.a - q.a);
  const P: Pt = [principal.x, principal.y];
  const r = principal.s * 0.47 + fr.w * 0.025;
  const dir = (a: number): Pt => [Math.cos(a), Math.sin(a)];
  const out: Slot[] = new Array(angs.length);
  sorted.forEach(({ a, i }, k) => {
    const prev = sorted[(k + sorted.length - 1) % sorted.length].a, next = sorted[(k + 1) % sorted.length].a;
    let lo = (a + (prev < a ? prev : prev - 2 * Math.PI)) / 2;
    let hi = (a + (next > a ? next : next + 2 * Math.PI)) / 2;
    if (sorted.length === 1) { lo = a - Math.PI / 2; hi = a + Math.PI / 2; }
    const d1 = dir(lo), d2 = dir(hi), u = dir(a);
    const halves: Half[] = [[[P[0] + u[0] * r, P[1] + u[1] * r], u]];
    if (hi - lo < Math.PI * 1.001) {
      halves.push([P, [-d1[1], d1[0]]], [P, [d2[1], -d2[0]]]);
    }
    const reg = region(fit, halves);
    const b = bestFit(reg, shape, fr.w * 0.012, fr.w * 0.22);
    out[i] = b ?? { x: P[0] + u[0] * r * 1.5, y: P[1] + u[1] * r * 1.5, s: fr.w * 0.08 };
  });
  return equalise(out);
}

/** Slots on a chief. */
export function chiefSlots(fr: Frame, count: number, cs: ChargeShape | number, long = false): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const aspect = shape.aspect;
  const ch = chiefHeight(fr);
  if (long && count === 1) {
    // A lone sword or spear in chief lies fesswise.
    return [{ x: fr.fx, y: fr.y + ch * 0.5, s: Math.min(fr.w * 0.72, (ch * 0.72) / Math.max(0.12, Math.min(1, aspect))), rot: -90 }];
  }
  const box: Box = { x0: fr.x + fr.w * 0.04, y0: fr.y + ch * 0.1, x1: fr.x + fr.w * 0.96, y1: fr.y + ch * 0.9 };
  return rows(fr.poly, box, [count], shape, { gap: 0.05, margin: fr.w * 0.03 });
}

export function bordureSlots(fr: Frame, count: number): Slot[] {
  const bw = bordureWidth(fr, true);
  return orleSlots(fr, fr.poly, count, bw / 2, 0.95).map((s) => ({ ...s, s: Math.min(s.s * 1.6, bw * 0.84) }));
}

export { boxOf };
