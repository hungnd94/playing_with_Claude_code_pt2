/**
 * Lines of partition: wavy, indented, dancetty, embattled, engrailed,
 * invected, nebuly, raguly and dovetailed edges, applied along any polyline
 * (straight division lines, chevron edges, or the inner edge of a bordure).
 *
 * Each line is one period of (u, v) samples: u ∈ [0, 1] runs along the base
 * line (it may briefly go backwards to make overhangs, as nebuly and
 * dovetailed do), v ∈ [-1, 1] is the offset along the normal. v > 0 points
 * "outward" (away from the ordinary, or toward the side given by the caller).
 * Every period is symmetric about u = 0.5 so that patterns can be centred on
 * the axis of the shield.
 */
import type { Line } from "./types";
import type { Pt } from "./path";

interface LineSpec {
  /** Period, in shield units (a 200-unit-wide shield). */
  period: number;
  /** Amplitude (half the peak-to-trough height), in shield units. */
  amp: number;
  /** One period of samples. */
  pts: Pt[];
  /** Both edges of a band use the same displacement (wavy band) rather than mirrored (engrailed band). */
  parallel: boolean;
  /** Only the upper (chief-ward) edge of horizontal ordinaries is treated (embattled). */
  upperOnly?: boolean;
}

function sampled(n: number, fn: (t: number) => Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(fn(i / n));
  return out;
}

const SPECS: Record<Exclude<Line, "straight">, LineSpec> = {
  wavy: { period: 46, amp: 7, parallel: true, pts: sampled(24, (t) => [t, -Math.cos(2 * Math.PI * t)]) },
  indented: { period: 17, amp: 5.2, parallel: true, pts: [[0, -1], [0.5, 1], [1, -1]] },
  dancetty: { period: 64, amp: 15, parallel: true, pts: [[0, -1], [0.5, 1], [1, -1]] },
  embattled: {
    period: 38,
    amp: 8,
    parallel: true,
    upperOnly: true,
    pts: [[0, -1], [0.25, -1], [0.25, 1], [0.75, 1], [0.75, -1], [1, -1]],
  },
  engrailed: {
    period: 25,
    amp: 6,
    parallel: false,
    pts: sampled(14, (t) => [t, 1 - 2 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * 0.95]),
  },
  invected: {
    period: 25,
    amp: 6,
    parallel: false,
    pts: sampled(14, (t) => [t, -(1 - 2 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * 0.95)]),
  },
  nebuly: {
    period: 46,
    amp: 11,
    parallel: true,
    pts: sampled(40, (t) => {
      const a = 2 * Math.PI * t;
      return [t + 0.14 * Math.sin(2 * a), -Math.cos(a) * 0.95 - 0.05 * Math.cos(3 * a)];
    }),
  },
  raguly: {
    period: 30,
    amp: 7.5,
    parallel: true,
    upperOnly: true,
    pts: [[0, -1], [0.22, -1], [0.38, 1], [0.78, 1], [0.62, -1], [1, -1]],
  },
  dovetailed: {
    period: 40,
    amp: 7.5,
    parallel: true,
    upperOnly: true,
    pts: [[0, -1], [0.3, -1], [0.2, 1], [0.8, 1], [0.7, -1], [1, -1]],
  },
};

export function lineSpec(line: Line): LineSpec | null {
  return line === "straight" ? null : SPECS[line];
}

export function isUpperOnly(line: Line | undefined): boolean {
  return !!line && line !== "straight" && !!SPECS[line].upperOnly;
}
export function isParallel(line: Line | undefined): boolean {
  return !!line && line !== "straight" && SPECS[line].parallel;
}

interface Arc {
  pts: Pt[];
  cum: number[];
  total: number;
}

function arc(pts: readonly Pt[], closed: boolean): Arc {
  const p = closed ? [...pts, pts[0]] : pts.slice();
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { pts: p as Pt[], cum, total: cum[cum.length - 1] };
}

/** Position and unit normal (to the left of travel, i.e. (-dy, dx) in y-down coordinates rotated) at arc length s. */
function at(a: Arc, s: number, closed: boolean): { p: Pt; n: Pt } {
  if (closed) s = ((s % a.total) + a.total) % a.total;
  let i = 1;
  // binary search
  let lo = 1, hi = a.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a.cum[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  i = lo;
  const p0 = a.pts[i - 1], p1 = a.pts[i];
  const segLen = a.cum[i] - a.cum[i - 1] || 1;
  const t = (s - a.cum[i - 1]) / segLen;
  const dx = (p1[0] - p0[0]) / segLen, dy = (p1[1] - p0[1]) / segLen;
  // Extrapolate linearly beyond the ends.
  return { p: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], n: [dy, -dx] };
}

export interface PatternOpts {
  /** Unit scale: shield width / 200. */
  u: number;
  /** +1: v > 0 displaces to the left of travel (in screen space: rotate travel direction by -90°); -1: to the right. */
  side: 1 | -1;
  /** A point on (or near) the line where a period should be centred, for symmetry. */
  anchor?: Pt;
  /** Treat as a closed loop (bordure); the period is adjusted to tile seamlessly. */
  closed?: boolean;
  /** Multiplier for the period and amplitude (diminutives use smaller patterns). */
  scale?: number;
  /** Shift the phase by half a period (used to keep both edges of a band parallel). */
  halfShift?: boolean;
  /**
   * Lengthen the period of waves and zigzags on diagonal lines (default true): a
   * wave steep enough to read well on a fess turns into a staircase at 45°.
   */
  autoStretch?: boolean;
}

/** Lines whose look depends on their steepness (smooth waves and zigzags). */
const STRETCHY: readonly Line[] = ["wavy", "nebuly", "dancetty", "indented"];

/** 0 for horizontal or vertical lines, up to 1 for 45° ones (length-weighted |sin 2θ| over segments). */
function diagonality(pts: readonly Pt[]): number {
  let wsum = 0, lsum = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dy);
    if (!L) continue;
    wsum += L * Math.abs((2 * dx * dy) / (L * L)); // |sin 2θ|
    lsum += L;
  }
  return lsum ? wsum / lsum : 0;
}

/**
 * Apply a line of partition along a polyline. Returns the displaced polyline.
 * Straight lines return the input unchanged.
 */
export function patternLine(pts: readonly Pt[], line: Line | undefined, o: PatternOpts): Pt[] {
  const spec = line ? lineSpec(line) : null;
  if (!spec || pts.length < 2) return pts.slice() as Pt[];
  const k = (o.scale ?? 1) * o.u;
  const dg = !o.closed && o.autoStretch !== false && STRETCHY.includes(line!) ? diagonality(pts) : 0;
  let P = spec.period * k * (1 + 0.25 * dg);
  const A = (spec.amp * k) / (1 + 0.35 * dg);
  const a = arc(pts, !!o.closed);
  if (o.closed) {
    const n = Math.max(6, Math.round(a.total / P));
    P = a.total / n;
  }
  // Phase: the centre of a period (u = 0.5) falls on the anchor's projection.
  let s0 = 0;
  if (o.anchor) {
    let best = Infinity;
    for (let i = 1; i < a.pts.length; i++) {
      const p0 = a.pts[i - 1], p1 = a.pts[i];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const L2 = dx * dx + dy * dy || 1;
      let t = ((o.anchor[0] - p0[0]) * dx + (o.anchor[1] - p0[1]) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      const qx = p0[0] + dx * t, qy = p0[1] + dy * t;
      const dd = Math.hypot(qx - o.anchor[0], qy - o.anchor[1]);
      if (dd < best) {
        best = dd;
        s0 = a.cum[i - 1] + t * Math.sqrt(L2);
      }
    }
  }
  let start = s0 - P * 0.5 - Math.ceil((s0 - P * 0.5) / P) * P;
  if (o.halfShift) start -= P / 2;
  if (o.closed) start = s0 - P * 0.5;
  const end = o.closed ? start + a.total : a.total;
  const out: Pt[] = [];
  const first = at(a, 0, !!o.closed);
  if (!o.closed) out.push(first.p);
  for (let base = start; base < end - 1e-6; base += P) {
    for (let j = 0; j < spec.pts.length; j++) {
      if (j === spec.pts.length - 1 && base + P < end - 1e-6) continue; // shared with next period
      const [uu, vv] = spec.pts[j];
      const s = base + uu * P;
      if (!o.closed && (s < 0 || s > a.total)) continue;
      const { p, n } = at(a, s, !!o.closed);
      out.push([p[0] + n[0] * vv * A * o.side, p[1] + n[1] * vv * A * o.side]);
    }
  }
  if (!o.closed) out.push(at(a, a.total, false).p);
  return out;
}
