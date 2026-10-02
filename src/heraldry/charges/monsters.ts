/**
 * Monsters and creatures of water: dragon rampant, serpent nowed, fish naiant/hauriant.
 */
import type { ChargeId } from "../types";
import type { ChargeArt, ChargeDef } from "./art";
import { circleD, curve, f, limb, polyD, smooth, splinePts, type Pt, type SPt } from "../path";
import { paw } from "./kit";
import { maneLocks, xf, xfPath } from "./beasts";

type Spine = [number, number, number][];

function legWithPaw(spine: Spine, px: number, py: number, dir: number, s: number) {
  const p = paw(px, py, dir, s, 3);
  return { leg: limb(spine, { start: "round", end: "round" }) + p.pad, claws: p.claws, toes: p.toes };
}

// ---------------------------------------------------------------------------

function dragonRampant(): ChargeArt {
  // Head: long jaws open, horns swept back, in a local frame then tilted.
  const H: SPt[] = [
    [27, 2],
    [19, 2],
    [12, 4.5],
    [5, 6.5],
    [-1, 8, 1],
    [-1.5, 10.6],
    [3, 12],
    [9, 12.6],
    [17, 14, 1],
    [9, 15.6],
    [2, 17.4],
    [-1, 18.6, 1],
    [1, 21],
    [9, 21.6],
    [18, 21.4],
    [26, 18.5],
    [31, 12],
    [31, 5],
  ];
  const T = (pts: SPt[]) => xf(pts, 15, 8, -22, 1.12);
  const head = smooth(T(H), true);
  const horn1 = limb(T([[22, 3], [30, -3], [38, -6], [44, -5]]).map((p, i) => [p[0], p[1], [4.6, 3.6, 2.2, 0.3][i]] as [number, number, number]), { start: "round", end: "flat" });
  const horn2 = limb(T([[16, 3.5], [21, -3], [27, -8], [33, -10]]).map((p, i) => [p[0], p[1], [3.8, 3, 1.8, 0.3][i]] as [number, number, number]), { start: "round", end: "flat" });
  const frill = maneLocks(
    T([[29, 9], [29, 15], [26, 19]]).map((p, i) => {
      const tips: [number, number][] = [[38, 9], [37, 18], [33, 24]];
      const q = T([tips[i] as SPt])[0];
      return [p[0], p[1], q[0], q[1], 5.5, -1.5] as [number, number, number, number, number, number];
    }),
  );
  const tongue = limb(T([[14, 15.2], [6, 15.6], [-2, 15], [-7, 13]]).map((p, i) => [p[0], p[1], [2.6, 2.4, 2, 1.6][i]] as [number, number, number]), { start: "round", end: "flat" });
  const barb = smooth(T([[-6, 10.4, 1], [-12, 13, 1], [-6, 15.6, 1], [-7.6, 13]]), true);
  const teeth = xfPath("M2 12L3 14.6L4.1 12.3Z M7.2 12.7L8 14.4L8.8 12.9Z M2.6 17.3L3.5 15.2L4.5 17.2Z", 15, 8, -22, 1.12);
  const faceLines = xfPath("M8 4.4Q11.5 3.4 15 4.6M0.4 8.6Q1.6 7.8 2.8 8.8M18 14.4Q21.5 13.8 23.5 15.8M20 18Q24 19 27 17", 15, 8, -22, 1.12);
  const eye = smooth(T([[10.5, 6.6, 1], [12.8, 5.3], [15.2, 6.2, 1], [12.9, 7.6]]), true);

  const neck = limb([[44, 44, 14], [40, 32, 11.5], [38, 22, 10.5]], { start: "round", end: "round" });
  const torso = smooth(
    [
      [34, 36],
      [30, 46],
      [32, 56],
      [39, 63],
      [47, 69],
      [53, 77],
      [58, 86],
      [66, 90],
      [76, 85],
      [78, 74],
      [72, 63],
      [65, 54],
      [59, 43],
      [53, 33],
      [44, 28],
    ],
    true,
  );
  // wing: arm with fingers and a membrane with scalloped trailing edge
  const shoulder: Pt = [55, 36], elbow: Pt = [64, 18], wrist: Pt = [80, 4];
  const tips: Pt[] = [[100, 6], [101, 24], [96, 40], [84, 50], [70, 54]];
  let membrane = `M${shoulder[0]} ${shoulder[1]}L${elbow[0]} ${elbow[1]}L${wrist[0]} ${wrist[1]}L${tips[0][0]} ${tips[0][1]}`;
  for (let i = 1; i < tips.length; i++) {
    const a = tips[i - 1], b = tips[i];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const cx = (mx * 2 + wrist[0]) / 3, cy = (my * 2 + wrist[1]) / 3;
    membrane += `Q${f(cx)} ${f(cy)} ${f(b[0])} ${f(b[1])}`;
  }
  membrane += `Q62 52 ${shoulder[0]} ${shoulder[1] + 10}Z`;
  const arm = limb([[shoulder[0], shoulder[1], 7.6], [elbow[0], elbow[1], 5.6], [wrist[0], wrist[1], 4.2], [wrist[0] + 6, wrist[1] - 2, 2]], { start: "round", end: "round" });
  let ribs = "";
  for (const t of tips) ribs += `M${wrist[0]} ${wrist[1]}Q${f((wrist[0] + t[0]) / 2 + 2)} ${f((wrist[1] + t[1]) / 2 - 2)} ${f(t[0])} ${f(t[1])}`;
  ribs += `M${elbow[0]} ${elbow[1]}Q66 40 70 54`;
  const farWing = smooth([[58, 34], [60, 14], [66, 0, 1], [72, 12], [70, 24], [66, 34]], true);

  const upper = legWithPaw([[44, 42, 12.5], [33, 46, 10], [25, 42, 8.6], [18, 31, 6.8], [13, 24, 6]], 11, 18.5, -112, 6.4);
  const lower = legWithPaw([[42, 51, 12.5], [35, 61, 10], [29, 64, 8.6], [21, 58, 6.8], [14, 53, 6]], 9.4, 50.6, -162, 6.4);
  const hindRaised = legWithPaw([[64, 80, 19], [54, 88, 14], [47, 94, 10.5], [42, 101, 7.4], [36, 104, 6.2]], 30, 104.5, 184, 6.8);
  const hindStand = legWithPaw([[71, 82, 19], [66, 93, 14], [63, 99, 10.5], [69, 108, 7.4], [66, 115, 6.2], [63, 119, 6]], 57.5, 120, 188, 7);
  const tailSp = splinePts(
    [
      [75, 80],
      [86, 92],
      [96, 98],
      [101, 88],
      [96, 76],
      [88, 72],
      [86, 62],
      [93, 56],
    ],
    6,
  );
  const tail = limb(
    tailSp.map((p, i) => [p[0], p[1], 8.5 * (1 - i / tailSp.length) + 1.6] as [number, number, number]),
    { start: "round", end: "round" },
  );
  const end = tailSp[tailSp.length - 1];
  const tailBarb = smooth([[end[0] - 4, end[1] + 3, 1], [end[0] + 4, end[1] - 9, 1], [end[0] + 7, end[1] + 4, 1], [end[0] + 1, end[1] + 1]], true);
  // belly scales
  let scales = "";
  for (let i = 0; i < 7; i++) {
    const y = 40 + i * 6.5;
    const x0 = 31 + Math.max(0, i - 2) * 2.6, x1 = x0 + 10 - i * 0.3;
    scales += `M${f(x0)} ${f(y)}Q${f((x0 + x1) / 2)} ${f(y + 2.4)} ${f(x1)} ${f(y + 1.5)}`;
  }
  for (let i = 0; i < 3; i++) scales += `M${f(38 + i * 1.5)} ${f(22 + i * 6)}Q${f(42 + i * 1.5)} ${f(24 + i * 6)} ${f(46 + i * 1)} ${f(23 + i * 6)}`;
  let back = "";
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const x = 46 + t * 26, y = 30 + t * 32;
    back += smooth([[x - 2.6, y + 1.6, 1], [x + 3.2, y - 3.4, 1], [x + 2.6, y + 3.4, 1]], true);
  }
  return {
    layers: [
      { role: "body", d: farWing },
      { role: "body", d: tail + tailBarb },
      { role: "line", d: curve(tailSp.slice(4, -3).map((p) => [p[0], p[1]] as SPt)), w: 0.9 },
      { role: "body", d: upper.leg + hindRaised.leg },
      { role: "accent", d: upper.claws + hindRaised.claws },
      { role: "body", d: membrane + arm },
      { role: "line", d: ribs, w: 1 },
      { role: "body", d: back },
      { role: "body", d: torso + neck + lower.leg + hindStand.leg },
      { role: "accent", d: lower.claws + hindStand.claws },
      { role: "line", d: scales + lower.toes + hindStand.toes + upper.toes + hindRaised.toes + "M60 70Q66 72 72 76M64 82Q68 78 74 78", w: 1 },
      { role: "body", d: frill + horn2 },
      { role: "accent", d: tongue + barb },
      { role: "body", d: head + horn1 },
      { role: "body", d: teeth, noOutline: true },
      { role: "line", d: faceLines + teeth, w: 1 },
      { role: "ink", d: eye },
    ],
  };
}

// ---------------------------------------------------------------------------

function serpentNowed(): ChargeArt {
  // Centre line of the knotted body, from the head (left) to the tail (right).
  const pts: Pt[] = [
    [14, 26],
    [24, 30],
    [34, 38],
    [42, 50],
    [44, 64],
    [38, 76],
    [26, 80],
    [16, 72],
    [18, 58],
    [30, 50],
    [46, 46],
    [62, 46],
    [76, 52],
    [82, 66],
    [76, 80],
    [62, 82],
    [54, 72],
    [58, 58],
    [70, 46],
    [82, 36],
    [92, 30],
    [99, 32],
  ];
  const sp = splinePts(pts, 6);
  const N = sp.length;
  const w = (i: number) => {
    const t = i / (N - 1);
    return t < 0.06 ? 7 + t * 40 : 9.6 * (1 - Math.max(0, t - 0.75) * 3.2) + 0.6;
  };
  const seg = (a: number, b: number) => limb(sp.slice(a, b + 1).map((p, i) => [p[0], p[1], w(a + i)] as [number, number, number]), { start: a === 0 ? "round" : "flat", end: b >= N - 1 ? "flat" : "flat" });
  // split so that crossings alternate over/under
  const c1 = Math.round(N * 0.33), c2 = Math.round(N * 0.62);
  const partA = seg(0, c1 + 1), partB = seg(c1, c2 + 1), partC = seg(c2, N - 1);
  // scale chevrons along the back
  let scales = "";
  for (let i = 4; i < N - 4; i += 3) {
    const a = sp[i - 1], b = sp[i + 1], p = sp[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const ww = w(i) * 0.32;
    scales += `M${f(p[0] + nx * ww - ux * 1.6)} ${f(p[1] + ny * ww - uy * 1.6)}L${f(p[0] + ux * 1.2)} ${f(p[1] + uy * 1.2)}L${f(p[0] - nx * ww - ux * 1.6)} ${f(p[1] - ny * ww - uy * 1.6)}`;
  }
  const head = smooth([[18, 21], [12, 18.5], [5, 19], [0.5, 22.5, 1], [3, 25.6], [1, 28.4, 1], [6, 31], [14, 31.5], [20, 29]], true);
  const tongue = limb([[2, 25.6, 1.6], [-4, 25.4, 1.4], [-8, 25, 1]], { start: "round", end: "flat" }) +
    limb([[-7.6, 25, 1], [-11, 22.6, 0.3]], { start: "round", end: "flat" }) + limb([[-7.6, 25.2, 1], [-11, 27.8, 0.3]], { start: "round", end: "flat" });
  return {
    layers: [
      { role: "body", d: partA },
      { role: "body", d: partB },
      { role: "body", d: partC },
      { role: "line", d: scales, w: 0.9 },
      { role: "accent", d: tongue },
      { role: "body", d: head },
      { role: "line", d: "M4 25.4Q8 25.8 11 25", w: 1 },
      { role: "ink", d: circleD(10.5, 22.6, 1.7) },
    ],
  };
}

// ---------------------------------------------------------------------------

function fish(): ChargeArt {
  const body = smooth(
    [
      [2, 27, 1],
      [8, 19],
      [20, 12.5],
      [36, 9.5],
      [52, 11],
      [66, 16],
      [78, 22],
      [83, 25],
      [78, 30],
      [66, 35],
      [52, 39.5],
      [36, 41],
      [20, 39],
      [9, 34],
    ],
    true,
  );
  const tail = smooth([[78, 25], [88, 16], [99, 5, 1], [96, 18], [94, 26], [96, 35], [99, 47, 1], [88, 35]], true);
  const dorsal = smooth([[34, 11], [38, 3, 1], [46, 1.5], [56, 4, 1], [62, 14]], true);
  const anal = smooth([[54, 38], [60, 45, 1], [66, 44], [70, 33]], true);
  const pect = smooth([[25, 30], [34, 37], [37, 44, 1], [30, 40], [23, 34]], true);
  const pelvic = smooth([[38, 40], [42, 47, 1], [46, 46], [46, 40]], true);
  let scales = "";
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 7; c++) {
      const x = 30 + c * 6.4 + (r % 2 ? 3.2 : 0);
      const y = 18 + r * 7.2;
      if (x > 74 - Math.abs(r - 1) * 6) continue;
      scales += `M${f(x)} ${f(y - 2.8)}Q${f(x + 3.4)} ${f(y)} ${f(x)} ${f(y + 2.8)}`;
    }
  }
  return {
    layers: [
      { role: "body", d: dorsal + anal + tail },
      { role: "line", d: "M40 3.5L42 10M46 2L47 10M52 3L52 11M86 18L94 10M88 25L96 25M86 32L94 40M60 42L63 38M65 42L66 37", w: 0.9 },
      { role: "body", d: body },
      { role: "line", d: scales + "M22 14Q27 25 22 37M5 27.5Q8 28.6 11 28", w: 1 },
      { role: "body", d: pect + pelvic },
      { role: "line", d: "M27 32L33 38M30 31L35 37", w: 0.9 },
      { role: "ink", d: circleD(13.5, 22, 2.4) },
      { role: "shine", d: circleD(12.8, 21.2, 0.8) },
    ],
  };
}

function fishHauriant(): ChargeArt {
  const a = fish();
  // rotate a quarter turn so the head points up: (x, y) → (100 − y, x)
  const rot = (d: string) => d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_m, x: string, y: string) => `${f(100 - +y)} ${f(+x)}`);
  return {
    layers: a.layers.map((l) => ({
      ...l,
      d: l.d.includes("a") ? rotCircle(l.d) : rot(l.d),
    })),
  };
}

/** circleD paths contain relative arcs; rebuild them rotated. */
function rotCircle(d: string): string {
  return d.replace(/M(-?\d*\.?\d+) (-?\d*\.?\d+)a(-?\d*\.?\d+) (-?\d*\.?\d+) 0 1 1 (-?\d*\.?\d+) 0a[^Z]*Z/g, (_m, x: string, y: string, r: string) => {
    const cx = +x + +r, cy = +y;
    return circleD(100 - cy, cx, +r);
  });
}

export const MONSTERS: Partial<Record<ChargeId, ChargeDef>> = {
  dragon: { name: "dragon", plural: "dragons", category: "monster", attitudes: ["rampant"], armedTerm: "armed and langued", accentDefault: "gules", weight: 3, art: dragonRampant },
  serpent: { name: "serpent nowed", plural: "serpents nowed", category: "monster", attitudes: ["nowed"], armedTerm: "langued", accentDefault: "gules", weight: 2, art: serpentNowed },
  fish: {
    name: "fish",
    plural: "fish",
    category: "fish",
    attitudes: ["naiant", "hauriant"],
    weight: 3,
    art: (o) => (o.attitude === "hauriant" ? fishHauriant() : fish()),
  },
};

void polyD;
