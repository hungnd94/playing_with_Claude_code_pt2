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
import { polySpanBetween, resampleClosed, type Pt } from "./path";

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
  void fit;
  const path = insetPoly(fr.poly, inset);
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
  return out;
}

/** Slots for charges lying on an ordinary. */
export function onOrdinarySlots(o: Ordinary, fr: Frame, fit: Pt[], count: number, cs: ChargeShape | number, symmetric: boolean): Slot[] {
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
      const rot = symmetric ? 0 : o.kind === "bend" ? ang : ang - 180;
      const step = Math.min(fr.w * 0.34, s * 1.25);
      for (let i = 0; i < count; i++) {
        const t = (i - (count - 1) / 2) * step;
        out.push({ x: fx + d[0] * t, y: fy + d[1] * t, s: s * (count > 3 ? 0.85 : 1), rot });
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

/** Slots for charges on the field around ("between") an ordinary. */
export function betweenSlots(o: Ordinary, fr: Frame, fit: Pt[], count: number, cs: ChargeShape | number): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const aspect = shape.aspect;
  const bands = ordinaryBands(o, fr);
  const bw = bandWidth(o.kind, fr, Math.max(1, o.count ?? 1), !!o.charges);
  const { x, y, w, h, fx, fy } = fr;
  const m = w * 0.06;
  const gapBand = w * 0.04;
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

/** Slots on a chief. */
export function chiefSlots(fr: Frame, count: number, cs: ChargeShape | number): Slot[] {
  const shape: ChargeShape = typeof cs === "number" ? { aspect: cs } : cs;
  const aspect = shape.aspect;
  const ch = chiefHeight(fr);
  const box: Box = { x0: fr.x + fr.w * 0.04, y0: fr.y + ch * 0.1, x1: fr.x + fr.w * 0.96, y1: fr.y + ch * 0.9 };
  return rows(fr.poly, box, [count], shape, { gap: 0.05, margin: fr.w * 0.03 });
}

export function bordureSlots(fr: Frame, count: number): Slot[] {
  const bw = bordureWidth(fr, true);
  return orleSlots(fr, fr.poly, count, bw / 2, 0.95).map((s) => ({ ...s, s: Math.min(s.s * 1.6, bw * 0.84) }));
}

export { boxOf };
