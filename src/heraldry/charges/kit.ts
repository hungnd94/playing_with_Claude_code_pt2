/**
 * Anatomy kit for drawing heraldic beasts: paws with claws, hooves, tufts,
 * flame-like manes, feathers. All return path strings in the caller's frame.
 */
import { limb, smooth, tuft, type SPt } from "../path";

const rad = (d: number) => (d * Math.PI) / 180;

/** A paw: a palm with `n` toes pointing in direction `dir` (degrees), each toe with a hooked claw. */
export function paw(x: number, y: number, dir: number, s: number, n = 4): { pad: string; claws: string; toes: string } {
  const a = rad(dir);
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const P = (along: number, side: number): SPt => [x + ux * along * s + nx * side * s, y + uy * along * s + ny * side * s];
  let pad = smooth([P(-0.95, -0.5), P(-0.2, -0.72), P(0.35, -0.66), P(0.5, 0), P(0.35, 0.66), P(-0.2, 0.72), P(-0.95, 0.5)], true);
  let claws = "";
  let toes = "";
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. 0.5
    const spread = t * 1.25;
    const ang = a + t * 0.9;
    const reach = 0.62 - Math.abs(t) * 0.22;
    const cx = x + ux * reach * s + nx * spread * s;
    const cy = y + uy * reach * s + ny * spread * s;
    const r = 0.36 * s;
    pad += smooth(
      Array.from({ length: 10 }, (_, k) => {
        const q = (k / 10) * Math.PI * 2;
        const rr = r * (1 + 0.18 * Math.cos(q - ang));
        return [cx + Math.cos(q) * rr, cy + Math.sin(q) * rr] as SPt;
      }),
      true,
    );
    const bx = cx + Math.cos(ang) * r * 0.75, by = cy + Math.sin(ang) * r * 0.75;
    const mx = bx + Math.cos(ang) * 0.36 * s, my = by + Math.sin(ang) * 0.36 * s;
    const tx = mx + Math.cos(ang + 1) * 0.34 * s, ty = my + Math.sin(ang + 1) * 0.34 * s;
    claws += limb([[bx, by, 0.27 * s], [mx, my, 0.18 * s], [tx, ty, 0.02]], { start: "round", end: "flat" });
    if (i > 0) {
      const t2 = (i - 0.5) / (n - 1) - 0.5;
      const q = P(0.55 - Math.abs(t2) * 0.2, t2 * 1.25);
      const q2 = P(0.15, t2 * 0.9);
      toes += `M${q[0].toFixed(1)} ${q[1].toFixed(1)}L${q2[0].toFixed(1)} ${q2[1].toFixed(1)}`;
    }
  }
  return { pad, claws, toes };
}

/** A cloven hoof at the end of a leg pointing in direction `dir`. */
export function hoof(x: number, y: number, dir: number, s: number): { d: string; line: string } {
  const a = rad(dir);
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const P = (along: number, side: number): SPt => [x + ux * along * s + nx * side * s, y + uy * along * s + ny * side * s];
  const d = smooth([[...P(-0.2, -0.5)], [...P(0.9, -0.62), 1] as SPt, [...P(1.05, 0.15)], [...P(0.85, 0.62), 1] as SPt, [...P(-0.2, 0.5)]], true);
  const q1 = P(0.35, 0), q2 = P(1, 0);
  const line = `M${q1[0].toFixed(1)} ${q1[1].toFixed(1)}L${q2[0].toFixed(1)} ${q2[1].toFixed(1)}`;
  return { d, line };
}

/** Several tufts from base points to tip points: [x0, y0, x1, y1, width, bend]. */
export function tufts(list: [number, number, number, number, number, number][]): string {
  return list.map(([a, b, c, d, w, k]) => tuft(a, b, c, d, w, k)).join("");
}

/** A wavy, flame-like lock of hair or tail tuft through points with tapering width. */
export function lock(pts: [number, number][], w0: number): string {
  const n = pts.length;
  return limb(
    pts.map(([x, y], i) => [x, y, w0 * (1 - i / (n - 1)) ** 0.9 + (i === n - 1 ? 0 : 0.2)] as [number, number, number]),
    { start: "round", end: "flat" },
  );
}
