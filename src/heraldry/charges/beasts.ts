/**
 * Beasts: lion (rampant, passant), wolf (rampant, passant), bear, stag, boar,
 * horse, bull. Drawn facing dexter (the viewer's left), as heraldic convention requires.
 */
import type { ChargeId } from "../types";
import type { ChargeArt, ChargeDef } from "./art";
import { circleD, curve, ellipseD, limb, smooth, type SPt } from "../path";
import { hoof, lock, paw, tufts } from "./kit";

type Spine = [number, number, number][];

function legWithPaw(spine: Spine, px: number, py: number, dir: number, s: number) {
  const p = paw(px, py, dir, s);
  return { leg: limb(spine, { start: "round", end: "round" }) + p.pad, claws: p.claws, toes: p.toes };
}

// ---------------------------------------------------------------------------
// Shared helpers

/** Transform a list of points: scale about origin, rotate (deg) about origin, then translate. */
export function xf(pts: readonly SPt[], dx: number, dy: number, rot = 0, k = 1): SPt[] {
  const c = Math.cos((rot * Math.PI) / 180), sn = Math.sin((rot * Math.PI) / 180);
  return pts.map((p) => {
    const x = p[0] * k, y = p[1] * k;
    const q: SPt = p.length === 3 ? [dx + x * c - y * sn, dy + x * sn + y * c, p[2]] : [dx + x * c - y * sn, dy + x * sn + y * c];
    return q;
  });
}
function xfSpine(sp: Spine, dx: number, dy: number, rot = 0, k = 1): Spine {
  return xf(sp.map(([x, y]) => [x, y] as SPt), dx, dy, rot, k).map((p, i) => [p[0], p[1], sp[i][2] * k] as [number, number, number]);
}
/** Transform an SVG path made only of absolute M/L/Q/C/Z commands. */
export function xfPath(d: string, dx: number, dy: number, rot = 0, k = 1): string {
  const c = Math.cos((rot * Math.PI) / 180), sn = Math.sin((rot * Math.PI) / 180);
  return d.replace(/(-?\d*\.?\d+)[ ,](-?\d*\.?\d+)/g, (_m, a: string, b: string) => {
    const x = parseFloat(a) * k, y = parseFloat(b) * k;
    return `${(dx + x * c - y * sn).toFixed(1)} ${(dy + x * sn + y * c).toFixed(1)}`;
  });
}

interface HeadArt {
  head: string;
  ear: string;
  tongue: string;
  lines: string;
  eye: string;
  teeth: string;
}

/**
 * Lion's head in profile facing dexter, jaws open, in a local frame
 * (about 32 × 24, gape at the origin side), then placed at (dx, dy) rotated by rot.
 */
function lionHead(dx: number, dy: number, rot: number, k = 1): HeadArt {
  const head: SPt[] = [
    [27, 0.5],
    [19, 0],
    [13, 2.2],
    [8.5, 4.6],
    [3.5, 6.2],
    [0.6, 7.6, 1],
    [0.4, 10.6],
    [2.4, 12.4],
    [7, 13],
    [12.5, 14.4, 1],
    [6.5, 16.2],
    [2.6, 18, 1],
    [3.4, 21.4],
    [9, 23.2],
    [17, 23.4],
    [25, 20.6],
    [31, 14],
    [31.5, 6.5],
  ];
  const ear: SPt[] = [[21.5, 2], [25, -5, 1], [30, 1.5], [27, 5]];
  const tongue: [number, number, number][] = [
    [11, 15.2, 3.6],
    [5, 15.4, 3.4],
    [-1, 14.6, 2.8],
    [-5.5, 11.8, 2],
    [-7, 7.5, 1.2],
    [-5.6, 4.6, 0.2],
  ];
  const teeth =
    "M2.6 12.2L3.8 15.2L5 12.6Z M7.4 13.1L8.2 14.9L9.1 13.3Z M3.4 17.6L4.3 15.4L5.4 17.3Z";
  const lines =
    "M9.5 3.6Q13 2.4 16.5 4" + // brow
    "M2.6 8.4Q4 7.4 5.4 8.6" + // nostril
    "M13.6 14.6Q17 13.6 19.5 15.5M14 17.2Q17.4 17.2 19.4 19.2" + // jowl wrinkles
    "M9 9.6Q13.5 10.6 17 9.2"; // cheek
  return {
    head: smooth(xf(head, dx, dy, rot, k), true),
    ear: smooth(xf(ear, dx, dy, rot, k), true),
    tongue: limb(xfSpine(tongue, dx, dy, rot, k), { start: "round", end: "flat" }),
    lines: xfPath(lines, dx, dy, rot, k),
    eye: smooth(xf([[11, 6.4, 1], [13.2, 5.2], [15.4, 6.2, 1], [13.2, 7.6]], dx, dy, rot, k), true),
    teeth: xfPath(teeth, dx, dy, rot, k),
  };
}

/** Flame-like locks of a mane: each [baseX, baseY, tipX, tipY, width, curl]. */
export function maneLocks(list: [number, number, number, number, number, number][]): string {
  let d = "";
  for (const [x0, y0, x1, y1, w, curl] of list) {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const P = (t: number, o: number, ww: number): [number, number, number] => [x0 + dx * t + nx * o, y0 + dy * t + ny * o, ww];
    d += limb([P(0, 0, w), P(0.28, curl * 0.55, w * 0.88), P(0.56, curl, w * 0.6), P(0.8, curl * 0.45, w * 0.3), P(1, -curl * 0.7, 0.15)], {
      start: "round",
      end: "flat",
    });
  }
  return d;
}

// ---------------------------------------------------------------------------
// Lion rampant

function lionRampant(): ChargeArt {
  const H = lionHead(19, 5.5, -20, 1.14);
  const mane = maneLocks([
    [44, 2, 57, -3, 10, -3],
    [47, 8, 63, 4, 11, -3.5],
    [49, 15, 67, 14, 11.5, -3.5],
    [50, 22, 67, 25, 11.5, -3.5],
    [49, 29, 64, 36, 11.5, -3.5],
    [47, 34, 59, 46, 11, -3],
    [43, 37, 50, 52, 10.5, -3],
    [38, 34, 39, 51, 10, -2.5],
    [33, 30, 30, 46, 9, 2.5],
    [28, 27, 22, 39, 8, 3],
  ]);
  const torso = smooth(
    [
      [33, 33],
      [28.5, 43],
      [30, 53],
      [37, 61],
      [45, 66],
      [51, 73],
      [57, 84],
      [66, 89],
      [77, 85],
      [80, 75],
      [74, 64],
      [67, 56],
      [61, 45],
      [56, 34],
      [47, 27],
    ],
    true,
  );
  const upper = legWithPaw([[45, 40, 15], [34, 44, 12], [26, 43, 10.5], [19, 33, 8.6], [13, 22, 6.6], [10, 16, 6.4]], 8.2, 9.5, -108, 6.8);
  const lower = legWithPaw([[43, 49, 14.5], [36, 59, 12], [31, 63, 10.5], [23, 59, 8.4], [15, 53, 6.6], [12, 51, 6.4]], 7, 48.5, -166, 6.8);
  const hindRaised = legWithPaw([[64, 80, 22], [54, 88, 16], [48, 93, 12], [43, 100, 8.5], [37, 104, 7], [32, 105, 6.8]], 26, 105, 184, 7.2);
  const hindStand = legWithPaw([[71, 82, 22], [67, 92, 16], [64, 99, 12], [70, 108, 8.2], [67, 115, 6.8], [63, 119.5, 6.8]], 57.5, 120.5, 188, 7.4);
  const legTufts = maneLocks([
    [29, 45, 37, 55, 7, 2],
    [33, 63, 40, 73, 7, 2],
    [44, 99, 46, 111, 6.5, 2.5],
    [70, 107, 81, 112, 6.5, -2],
  ]);
  const tail = limb(
    [
      [76, 78, 6.2],
      [87, 69, 5.4],
      [92, 55, 4.8],
      [88, 42, 4.3],
      [87, 31, 3.8],
      [91, 22, 3.4],
    ],
    { start: "round", end: "round" },
  );
  const tailTuft = maneLocks([
    [91, 23, 99, 8, 8, -3],
    [90, 22, 86, 6, 7.5, 3],
    [92, 24, 102, 21, 7, -3],
    [89, 25, 79, 15, 6.5, 2.5],
  ]);
  const body = "M58 68Q65 69 72 75M63 83Q67 78 75 77";
  const maneLines =
    "M50 11Q56 10 60 8M51 19Q57 19 62 20M51 27Q56 29 60 33M48 35Q52 40 54 45M40 40Q42 45 41 49M33 34Q32 39 31 43";
  return {
    layers: [
      { role: "body", d: tail + tailTuft },
      { role: "line", d: "M92 21Q96 15 98 11M90 21Q88 15 88 10", w: 1 },
      { role: "body", d: upper.leg + hindRaised.leg },
      { role: "accent", d: upper.claws + hindRaised.claws },
      { role: "line", d: upper.toes + hindRaised.toes, w: 1 },
      { role: "body", d: torso + lower.leg + hindStand.leg + legTufts },
      { role: "accent", d: lower.claws + hindStand.claws },
      { role: "line", d: lower.toes + hindStand.toes + body, w: 1.1 },
      { role: "body", d: mane },
      { role: "line", d: maneLines, w: 1.05 },
      { role: "accent", d: H.tongue },
      { role: "body", d: H.head + H.ear },
      { role: "body", d: H.teeth, noOutline: true },
      { role: "crown", d: crownOn(40, 3.5, 16) },
      { role: "line", d: H.lines + H.teeth, w: 1.05 },
      { role: "ink", d: H.eye },
    ],
  };
}

// ---------------------------------------------------------------------------
// Lion passant

function lionPassant(): ChargeArt {
  const H = lionHead(2, 7, -6, 1.1);
  const mane = maneLocks([
    [30, 6, 42, 2, 10, -3],
    [33, 12, 47, 10, 11, -3],
    [35, 19, 49, 21, 11, -3],
    [34, 26, 46, 33, 11, -3],
    [31, 31, 38, 44, 10.5, -2.5],
    [25, 30, 26, 45, 10, 2],
    [19, 27, 15, 39, 9, 2.5],
  ]);
  const torso = smooth(
    [
      [22, 30],
      [19, 40],
      [24, 50],
      [36, 55],
      [52, 53],
      [66, 52],
      [80, 56],
      [92, 52],
      [97, 42],
      [94, 30],
      [82, 26],
      [64, 30],
      [48, 28],
      [36, 20],
    ],
    true,
  );
  const foreRaised = legWithPaw([[30, 44, 13], [21, 54, 10.5], [14, 56, 8.6], [8, 52, 7], [5, 49, 6.6]], 3.5, 46.5, -118, 6.4);
  const foreStand = legWithPaw([[34, 44, 14], [33, 56, 11], [34, 66, 8.2], [32, 74, 7]], 26.5, 76.5, 178, 6.6);
  const hindFar = legWithPaw([[80, 40, 17], [73, 54, 12.5], [79, 64, 8.6], [76, 72, 7]], 69.5, 75.5, 182, 6.6);
  const hindNear = legWithPaw([[89, 42, 18], [83, 55, 13], [90, 66, 8.6], [88, 74, 7]], 81.5, 77, 180, 6.8);
  const foreFar = legWithPaw([[42, 44, 12], [42, 58, 9.5], [44, 68, 7.4], [43, 74, 6.6]], 37, 77, 182, 6.2);
  const tufts2 = maneLocks([
    [22, 54, 27, 63, 6, 1.5],
    [34, 63, 39, 70, 5.5, 1.5],
    [79, 63, 87, 69, 5.5, -1.5],
    [90, 65, 98, 70, 5.5, -1.5],
  ]);
  const tail = limb([[95, 34, 5.6], [104, 26, 4.8], [106, 15, 4.2], [100, 7, 3.6], [92, 6, 3.2]], { start: "round", end: "round" });
  const tailTuft = maneLocks([
    [92, 7, 80, 4, 7.5, 2.5],
    [92, 6, 83, -4, 7, -2.5],
    [93, 8, 82, 13, 6.5, 2],
  ]);
  return {
    layers: [
      { role: "body", d: hindFar.leg + foreFar.leg + tail + tailTuft },
      { role: "accent", d: hindFar.claws + foreFar.claws },
      { role: "line", d: hindFar.toes + foreFar.toes, w: 1 },
      { role: "body", d: torso + foreRaised.leg + foreStand.leg + hindNear.leg + tufts2 },
      { role: "accent", d: foreRaised.claws + foreStand.claws + hindNear.claws },
      { role: "line", d: foreRaised.toes + foreStand.toes + hindNear.toes + "M68 40Q78 38 86 46M54 38Q60 44 62 50", w: 1.05 },
      { role: "body", d: mane },
      { role: "line", d: "M34 10Q40 9 44 7M36 18Q42 19 46 21M34 27Q39 31 42 36", w: 1.05 },
      { role: "accent", d: H.tongue },
      { role: "body", d: H.head + H.ear },
      { role: "body", d: H.teeth, noOutline: true },
      { role: "crown", d: crownOn(22, 5, 15) },
      { role: "line", d: H.lines + H.teeth, w: 1.05 },
      { role: "ink", d: H.eye },
    ],
  };
}

// ---------------------------------------------------------------------------
// Wolf

function wolfHead(dx: number, dy: number, rot: number, k = 1): HeadArt {
  const head: SPt[] = [
    [27, 2.5],
    [20, 1.5],
    [14, 3.4],
    [9.5, 6],
    [3, 8],
    [-1.5, 9, 1],
    [-1, 11.6],
    [2.5, 12.6],
    [8, 13.2],
    [15.5, 14.5, 1],
    [8, 16],
    [2, 17.2],
    [-0.5, 18.2, 1],
    [1.5, 20.6],
    [9, 21.4],
    [17, 21.6],
    [25, 20],
    [31, 14],
    [31.5, 7],
  ];
  const ear: SPt[] = [[19, 3], [21.5, -9, 1], [27.5, -2], [28.5, 4]];
  const tongue: [number, number, number][] = [
    [13, 15.3, 3.6],
    [6, 16, 3.6],
    [1, 17.6, 3.2],
    [-2.4, 20.6, 2.4],
    [-3.2, 24.2, 1],
    [-2.6, 25.6, 0.2],
  ];
  const teeth = "M1.8 12.4L2.8 15.4L4 12.7Z M7 13.1L7.7 14.8L8.5 13.3Z M1.6 17.1L2.6 14.8L3.6 17Z";
  const lines =
    "M7.5 5.4Q11 4.2 14 5.2" + // brow
    "M0.2 9.4Q1.4 8.4 2.6 9.6" + // nostril
    "M15.8 14.6Q19 13.8 21 15.5" +
    "M22.5 4Q24.5 0 25 -4" + // inner ear
    "M24 17Q28 20 32 19M26 12Q30 14 33 13M25 8Q29 9 32 7"; // ruff hint
  return {
    head: smooth(xf(head, dx, dy, rot, k), true),
    ear: smooth(xf(ear, dx, dy, rot, k), true),
    tongue: limb(xfSpine(tongue, dx, dy, rot, k), { start: "round", end: "flat" }),
    lines: xfPath(lines, dx, dy, rot, k),
    eye: smooth(xf([[11.6, 7.4, 1], [13.8, 5.9], [16.2, 6.6, 1], [13.9, 8]], dx, dy, rot, k), true),
    teeth: xfPath(teeth, dx, dy, rot, k),
  };
}

function wolfRampant(): ChargeArt {
  const H = wolfHead(14, 9, -24, 1.18);
  const ruff = maneLocks([
    [40, 12, 49, 14, 8, -2],
    [42, 19, 51, 25, 8.5, -2],
    [40, 26, 47, 35, 8.5, -2],
    [36, 30, 37, 42, 8, 2],
    [30, 30, 27, 40, 7, 2],
  ]);
  const torso = smooth(
    [
      [32, 30],
      [28, 41],
      [31, 52],
      [39, 60],
      [47, 66],
      [53, 75],
      [59, 85],
      [68, 89],
      [77, 84],
      [78, 73],
      [71, 62],
      [63, 52],
      [57, 40],
      [51, 30],
      [43, 22],
    ],
    true,
  );
  const upper = legWithPaw([[42, 38, 12], [31, 42, 10], [23, 38, 8.4], [16, 27, 6.6], [12, 20, 6]], 9.8, 15, -112, 6);
  const lower = legWithPaw([[40, 47, 12], [34, 57, 10], [29, 61, 8.4], [21, 57, 6.8], [14, 52, 6]], 9.4, 50, -164, 6);
  const hindRaised = legWithPaw([[63, 80, 19], [53, 88, 14], [47, 93, 10.5], [42, 100, 7.5], [36, 103, 6.2]], 30.5, 103.5, 184, 6.6);
  const hindStand = legWithPaw([[70, 82, 19], [66, 93, 14], [63, 99, 10.5], [69, 108, 7.4], [66, 115, 6.2], [63, 119, 6]], 57, 120, 188, 6.8);
  const tail = limb(
    [
      [75, 78, 7],
      [84, 84, 7.6],
      [90, 94, 7.8],
      [91, 106, 7],
      [87, 116, 5],
      [81, 121, 0.6],
    ],
    { start: "round", end: "flat" },
  );
  const tailFur = maneLocks([
    [88, 90, 97, 94, 5.5, -1.5],
    [90, 100, 98, 106, 5.5, -1.5],
    [89, 109, 95, 116, 5, -1.5],
  ]);
  const fur = "M84 88Q87 98 85 110M88 96Q91 104 89 112M58 66Q65 68 70 74M63 83Q67 78 73 78";
  return {
    layers: [
      { role: "body", d: tail + tailFur },
      { role: "body", d: upper.leg + hindRaised.leg },
      { role: "accent", d: upper.claws + hindRaised.claws },
      { role: "line", d: upper.toes + hindRaised.toes, w: 1 },
      { role: "body", d: torso + lower.leg + hindStand.leg },
      { role: "accent", d: lower.claws + hindStand.claws },
      { role: "line", d: lower.toes + hindStand.toes + fur, w: 1.05 },
      { role: "body", d: ruff },
      { role: "accent", d: H.tongue },
      { role: "body", d: H.head + H.ear },
      { role: "body", d: H.teeth, noOutline: true },
      { role: "line", d: H.lines + H.teeth, w: 1.05 },
      { role: "ink", d: H.eye },
    ],
  };
}

function wolfPassant(): ChargeArt {
  const H = wolfHead(1, 8, 4, 1.12);
  const ruff = maneLocks([
    [30, 12, 40, 16, 8, -2],
    [31, 19, 40, 26, 8.5, -2],
    [28, 25, 31, 36, 8, 2],
    [22, 26, 20, 35, 7, 2],
  ]);
  const torso = smooth(
    [
      [21, 28],
      [20, 39],
      [27, 48],
      [40, 51],
      [55, 49],
      [68, 49],
      [82, 52],
      [93, 47],
      [96, 37],
      [91, 28],
      [78, 26],
      [62, 28],
      [46, 26],
      [34, 16],
    ],
    true,
  );
  const foreRaised = legWithPaw([[28, 40, 11], [21, 50, 9], [15, 53, 7.4], [9, 50, 6], [6, 47, 5.6]], 4.6, 45, -116, 5.6);
  const foreStand = legWithPaw([[33, 40, 11.5], [32, 54, 9.2], [33, 64, 7], [31, 73, 6]], 25.8, 75.6, 178, 5.8);
  const foreFar = legWithPaw([[41, 40, 10], [41, 54, 8], [43, 64, 6.4], [42, 72, 5.8]], 36.6, 75.6, 182, 5.6);
  const hindFar = legWithPaw([[79, 38, 15], [73, 52, 11], [79, 63, 7.2], [76, 71, 6]], 70.6, 74.6, 182, 5.8);
  const hindNear = legWithPaw([[88, 40, 16], [82, 53, 11.5], [89, 64, 7.4], [87, 73, 6]], 81.4, 76, 180, 6);
  const tail = limb([[94, 36, 7], [102, 44, 7.6], [106, 56, 7.4], [104, 66, 5.6], [99, 72, 0.6]], { start: "round", end: "flat" });
  const tailFur = maneLocks([
    [103, 46, 111, 50, 5.5, -1.5],
    [106, 55, 112, 61, 5, -1.5],
  ]);
  return {
    layers: [
      { role: "body", d: hindFar.leg + foreFar.leg + tail + tailFur },
      { role: "accent", d: hindFar.claws + foreFar.claws },
      { role: "line", d: hindFar.toes + foreFar.toes, w: 1 },
      { role: "body", d: torso + foreRaised.leg + foreStand.leg + hindNear.leg },
      { role: "accent", d: foreRaised.claws + foreStand.claws + hindNear.claws },
      { role: "line", d: foreRaised.toes + foreStand.toes + hindNear.toes + "M66 38Q76 36 84 44M98 44Q104 52 103 62", w: 1.05 },
      { role: "body", d: ruff },
      { role: "accent", d: H.tongue },
      { role: "body", d: H.head + H.ear },
      { role: "body", d: H.teeth, noOutline: true },
      { role: "line", d: H.lines + H.teeth, w: 1.05 },
      { role: "ink", d: H.eye },
    ],
  };
}

// ---------------------------------------------------------------------------
// Bear passant

function bearPassant(): ChargeArt {
  const head = smooth(
    [
      [25, 10],
      [17, 9],
      [11, 11.5],
      [5, 15],
      [0.5, 17, 1],
      [0.4, 20.5],
      [3, 22.5],
      [8.5, 23.5],
      [14, 26],
      [21, 28],
      [30, 26],
      [33, 18],
    ],
    true,
  );
  const ear = circleD(24.5, 9.5, 4.6);
  const torso = smooth(
    [
      [27, 22],
      [22, 34],
      [25, 47],
      [38, 54],
      [56, 54],
      [72, 54],
      [86, 53],
      [96, 45],
      [97, 32],
      [90, 22],
      [76, 19],
      [60, 18],
      [48, 11],
      [36, 12],
    ],
    true,
  );
  const foreRaised = legWithPaw([[30, 40, 16], [22, 50, 13], [15, 54, 10.5], [10, 52, 9]], 6.5, 50.5, -128, 7.6);
  const foreStand = legWithPaw([[37, 44, 17], [36, 58, 14], [36, 68, 11.5]], 30.5, 74, 184, 7.8);
  const foreFar = legWithPaw([[46, 44, 15], [46, 58, 12.5], [47, 68, 10.5]], 41.5, 74, 184, 7.2);
  const hindFar = legWithPaw([[78, 40, 19], [75, 56, 14.5], [77, 68, 11]], 71.5, 74, 184, 7.4);
  const hindNear = legWithPaw([[88, 40, 20], [84, 56, 15], [87, 68, 11.5]], 81.5, 75, 184, 7.8);
  const tail = limb([[95, 34, 6], [100, 36, 5], [102, 40, 1.5]], { start: "round", end: "flat" });
  const fur =
    "M44 18Q52 16 58 20M40 26Q48 24 56 28M66 24Q74 22 82 26M70 32Q78 30 86 34M58 40Q64 46 64 52M14 14Q19 13 23 15M29 28Q33 34 32 40";
  return {
    layers: [
      { role: "body", d: hindFar.leg + foreFar.leg + tail },
      { role: "accent", d: hindFar.claws + foreFar.claws },
      { role: "line", d: hindFar.toes + foreFar.toes, w: 1 },
      { role: "body", d: torso + foreRaised.leg + foreStand.leg + hindNear.leg },
      { role: "accent", d: foreRaised.claws + foreStand.claws + hindNear.claws },
      { role: "line", d: foreRaised.toes + foreStand.toes + hindNear.toes + fur, w: 1.05 },
      { role: "body", d: ear },
      { role: "body", d: head },
      { role: "line", d: "M23 8.5Q25 6.5 27 8.5M8 15.5Q12 14 15 16M3.4 22.2Q8 22.4 11 24.4M18 22Q22 24 25 23", w: 1.05 },
      { role: "ink", d: ellipseD(1.9, 17.6, 1.9, 1.5) + smooth([[12.2, 17.4, 1], [14.2, 16.2], [16.4, 17, 1], [14.3, 18.3]], true) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Hoofed beasts

function hoofLeg(spine: Spine, hx: number, hy: number, dir: number, s: number) {
  const h = hoof(hx, hy, dir, s);
  return { leg: limb(spine, { start: "round", end: "round" }), hoof: h.d, line: h.line };
}

function stagTrippant(): ChargeArt {
  const torso = smooth(
    [
      [30, 48],
      [28, 60],
      [36, 70],
      [52, 72],
      [70, 71],
      [84, 70],
      [94, 62],
      [96, 51],
      [90, 44],
      [72, 44],
      [54, 46],
      [40, 42],
    ],
    true,
  );
  const neck = limb([[38, 52, 17], [30, 40, 13], [24, 28, 10.5]], { start: "round", end: "round" });
  const head = smooth(
    [
      [28, 20],
      [22, 18.5],
      [16, 20],
      [10, 23],
      [4.5, 26.5, 1],
      [4, 30],
      [8, 32],
      [16, 32.5],
      [24, 31],
      [30, 27],
    ],
    true,
  );
  const ear = smooth([[25, 21], [33, 13, 1], [35, 18], [29, 24]], true);
  // antlers (near and far): beam with tines
  const antler = (ox: number, oy: number, k: number, lean: number) => {
    const P = (x: number, y: number): [number, number] => [ox + (x + y * lean) * k, oy + y * k];
    const beam = limb(
      [
        [...P(0, 0), 3.6 * k],
        [...P(3, -10), 3.2 * k],
        [...P(8, -20), 2.8 * k],
        [...P(14, -30), 2.4 * k],
        [...P(18, -38), 1.6 * k],
        [...P(19, -43), 0.5],
      ] as [number, number, number][],
      { start: "round", end: "flat" },
    );
    const tine = (x0: number, y0: number, x1: number, y1: number, w: number) =>
      limb([[...P(x0, y0), w * k], [...P((x0 + x1) / 2 - 1, (y0 + y1) / 2), w * 0.7 * k], [...P(x1, y1), 0.4]] as [number, number, number][], { start: "round", end: "flat" });
    return beam + tine(1.5, -5, -7, -10, 2.6) + tine(5, -15, -3, -21, 2.4) + tine(10, -25, 4, -33, 2.2) + tine(15, -32, 24, -38, 2);
  };
  const antlers = antler(26, 20, 1, 0.02) + antler(22, 21, 0.95, -0.08);
  const foreRaised = hoofLeg([[36, 58, 10], [30, 72, 7], [25, 79, 5.4], [21, 86, 4.4]], 19.5, 88, 120, 4.6);
  const foreStand = hoofLeg([[40, 60, 10.5], [40, 76, 6.6], [41, 88, 4.6], [40, 98, 4.2]], 39.6, 100, 95, 4.6);
  const foreFar = hoofLeg([[48, 60, 9], [49, 76, 6], [50, 88, 4.4], [49, 98, 4]], 48.6, 100, 95, 4.4);
  const hindFar = hoofLeg([[80, 58, 13], [76, 72, 8], [81, 84, 5], [79, 97, 4.2]], 78.6, 100, 95, 4.4);
  const hindNear = hoofLeg([[88, 56, 14], [84, 72, 8.4], [89, 84, 5.2], [87, 97, 4.4]], 86.6, 100, 95, 4.6);
  const tail = smooth([[92, 47], [100, 41, 1], [97, 50]], true);
  return {
    layers: [
      { role: "accent", d: antler(22, 21, 0.95, -0.08) },
      { role: "body", d: hindFar.leg + foreFar.leg },
      { role: "body", d: hindFar.hoof + foreFar.hoof },
      { role: "body", d: tail + torso + neck + foreRaised.leg + foreStand.leg + hindNear.leg },
      { role: "body", d: foreRaised.hoof + foreStand.hoof + hindNear.hoof },
      { role: "line", d: foreRaised.line + foreStand.line + hindNear.line + hindFar.line + foreFar.line + "M36 56Q42 64 42 70M80 50Q86 56 88 64M56 64Q66 66 76 64", w: 1 },
      { role: "body", d: ear + head },
      { role: "accent", d: antler(26, 20, 1, 0.02) },
      { role: "line", d: "M28 16Q31 16 32 18M6.5 28.5Q8 27.6 9.4 28.6M8 31Q12 30.6 15 31.5", w: 1 },
      { role: "ink", d: smooth([[15, 24.2, 1], [17.2, 22.9], [19.6, 23.8, 1], [17.3, 25.1]], true) },
    ],
  };
  void antlers;
}

function boarPassant(): ChargeArt {
  const torso = smooth(
    [
      [30, 22],
      [24, 34],
      [26, 48],
      [38, 56],
      [58, 57],
      [76, 56],
      [90, 52],
      [98, 42],
      [97, 30],
      [88, 22],
      [70, 17],
      [52, 13],
      [40, 13],
    ],
    true,
  );
  const head = smooth(
    [
      [34, 16],
      [24, 20],
      [14, 27],
      [5.5, 33, 1],
      [2, 33],
      [1, 37],
      [2.4, 41],
      [6, 42, 1],
      [12, 43],
      [20, 45],
      [30, 44],
      [37, 38],
    ],
    true,
  );
  const ear = smooth([[27, 19], [29, 9, 1], [35, 14], [33, 20]], true);
  const tusk = limb([[9, 40, 3.2], [7, 36, 2.6], [8.5, 31, 1.6], [11, 28.5, 0.3]], { start: "round", end: "flat" });
  let bristles = "";
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const x = 30 + t * 50;
    const y = 15.5 - Math.sin(Math.PI * Math.min(1, t * 1.4)) * 2 + t * 5;
    bristles += limb([[x - 2, y + 4, 7], [x + 2.5, y - 4, 3.6], [x + 6, y - 8.5 + t * 2, 0.3]], { start: "round", end: "flat" });
  }
  const foreStand = hoofLeg([[34, 46, 12], [33, 58, 8.2], [34, 68, 6.2]], 33, 71, 95, 5.4);
  const foreFar = hoofLeg([[44, 48, 10], [44, 58, 7.4], [46, 68, 5.8]], 45.2, 71, 95, 5.2);
  const hindFar = hoofLeg([[78, 46, 14], [74, 58, 8.4], [78, 68, 6]], 77.4, 71, 95, 5.2);
  const hindNear = hoofLeg([[88, 44, 15], [84, 58, 9], [88, 68, 6.2]], 87.4, 71, 95, 5.4);
  const tail = limb([[96, 36, 2.6], [102, 33, 2.4], [104, 38, 2], [100, 41, 1.6], [101, 45, 0.6]], { start: "round", end: "flat" });
  return {
    layers: [
      { role: "body", d: hindFar.leg + foreFar.leg + hindFar.hoof + foreFar.hoof },
      { role: "body", d: bristles },
      { role: "body", d: tail + torso + foreStand.leg + hindNear.leg },
      { role: "body", d: foreStand.hoof + hindNear.hoof },
      {
        role: "line",
        d: foreStand.line + hindNear.line + hindFar.line + foreFar.line + "M30 30Q36 38 34 46M80 30Q88 36 88 46M50 22Q56 30 54 38M62 20Q70 26 68 36",
        w: 1,
      },
      { role: "body", d: ear + head },
      { role: "accent", d: tusk },
      { role: "line", d: "M29.5 13Q30.5 15 31.5 18M2.8 35.2Q4 34.2 5 35.4M6 41Q10 39.6 14 41M16 26Q20 24 24 25", w: 1 },
      { role: "ink", d: smooth([[17.6, 28.8, 1], [19.6, 27.6], [21.6, 28.3, 1], [19.7, 29.6]], true) },
    ],
  };
}

function horseSalient(): ChargeArt {
  const torso = smooth(
    [
      [36, 38],
      [32, 50],
      [36, 62],
      [46, 70],
      [56, 80],
      [64, 88],
      [74, 90],
      [82, 82],
      [80, 70],
      [72, 60],
      [62, 48],
      [52, 36],
      [44, 30],
    ],
    true,
  );
  const neck = limb([[46, 42, 20], [38, 28, 15], [31, 17, 11.5]], { start: "round", end: "round" });
  const head = smooth(
    [
      [36, 12],
      [29, 9],
      [22, 11],
      [15, 16],
      [9, 21],
      [6, 25.5, 1],
      [7.5, 29.5],
      [12, 30.5],
      [18, 28],
      [25, 25],
      [33, 22],
      [38, 17],
    ],
    true,
  );
  const ears = smooth([[30, 10], [31, 0.5, 1], [35.5, 8]], true) + smooth([[33, 11], [36, 2, 1], [38.5, 10]], true);
  const mane = maneLocks([
    [36, 9, 46, 6, 7, -2],
    [40, 14, 50, 13, 7.5, -2],
    [42, 20, 53, 22, 8, -2],
    [45, 26, 55, 31, 8, -2],
    [48, 32, 57, 40, 8, -2],
    [50, 38, 57, 48, 7.5, -2],
  ]) + maneLocks([[31, 8, 26, 2, 5, 1.5]]);
  const foreUpper = hoofLeg([[40, 48, 12], [30, 50, 9.2], [24, 42, 6.4], [19, 35, 5]], 16.5, 32.4, -130, 5.2);
  const foreLower = hoofLeg([[40, 56, 12], [30, 62, 9], [23, 56, 6.4], [17, 51, 5]], 13.6, 49.4, -150, 5.2);
  const hindFar = hoofLeg([[66, 80, 18], [56, 92, 12], [60, 104, 6.6], [56, 114, 5.2]], 54.6, 117, 108, 5.4);
  const hindNear = hoofLeg([[74, 82, 19], [68, 95, 12.5], [74, 106, 6.8], [70, 116, 5.4]], 68.4, 119, 105, 5.6);
  const tail = maneLocks([
    [80, 76, 92, 92, 9, -3],
    [80, 78, 88, 100, 8.5, 3],
    [81, 77, 96, 86, 7, -3],
  ]);
  return {
    layers: [
      { role: "body", d: tail },
      { role: "line", d: "M84 82Q88 90 90 96M83 86Q85 94 87 100", w: 1 },
      { role: "body", d: hindFar.leg + foreUpper.leg + hindFar.hoof + foreUpper.hoof },
      { role: "body", d: torso + neck + foreLower.leg + hindNear.leg },
      { role: "body", d: foreLower.hoof + hindNear.hoof },
      { role: "line", d: foreLower.line + foreUpper.line + hindNear.line + hindFar.line + "M40 48Q44 56 44 62M64 66Q72 70 76 78", w: 1 },
      { role: "body", d: mane },
      { role: "body", d: ears + head },
      { role: "line", d: "M8.2 25.6Q9.5 24.6 10.8 25.8M9 29Q13 28.4 16 29.2M27 22Q31 18 33 13", w: 1 },
      { role: "ink", d: smooth([[22.4, 15.6, 1], [24.6, 14.2], [27, 14.9, 1], [24.7, 16.4]], true) },
    ],
  };
}

function bullPassant(): ChargeArt {
  const torso = smooth(
    [
      [26, 26],
      [21, 38],
      [24, 52],
      [34, 60],
      [52, 60],
      [70, 59],
      [86, 58],
      [96, 50],
      [98, 37],
      [92, 27],
      [76, 23],
      [56, 22],
      [42, 16],
      [32, 17],
    ],
    true,
  );
  const dewlap = smooth([[22, 40], [26, 50], [30, 56], [30, 44]], true);
  const head = smooth(
    [
      [27, 17],
      [19, 16],
      [12, 18],
      [6.5, 24],
      [3.5, 32, 1],
      [4.5, 36],
      [9, 38],
      [15, 37],
      [22, 34],
      [29, 28],
    ],
    true,
  );
  const ear = smooth([[25, 21], [33, 19, 1], [28, 25]], true);
  const horns = limb([[19, 17, 4.2], [16, 10, 3.2], [18.5, 3.5, 2.2], [23, 1, 0.4]], { start: "round", end: "flat" }) +
    limb([[23, 17, 4], [25, 10, 3], [30, 6, 2], [34, 6.5, 0.4]], { start: "round", end: "flat" });
  const foreRaised = hoofLeg([[30, 50, 12], [24, 62, 8.6], [20, 68, 6.4], [16, 74, 5.4]], 14.4, 76, 118, 5.6);
  const foreStand = hoofLeg([[36, 52, 13], [36, 66, 8.4], [37, 76, 6.4]], 37, 80, 95, 5.8);
  const foreFar = hoofLeg([[46, 52, 11], [46, 66, 7.8], [47.5, 76, 6]], 47.6, 80, 95, 5.4);
  const hindFar = hoofLeg([[80, 48, 15], [76, 62, 9], [81, 72, 6.4], [80, 77, 5.6]], 79.6, 80, 95, 5.4);
  const hindNear = hoofLeg([[89, 46, 16], [85, 62, 9.6], [90, 73, 6.6], [89, 78, 5.8]], 88.6, 81, 95, 5.8);
  const tail = limb([[96, 36, 3.2], [101, 46, 2.8], [102, 58, 2.4], [101, 66, 2]], { start: "round", end: "round" }) + maneLocks([[101, 64, 98, 76, 6, 1.5], [102, 64, 104, 76, 5.5, -1.5]]);
  return {
    layers: [
      { role: "body", d: hindFar.leg + foreFar.leg + hindFar.hoof + foreFar.hoof + tail },
      { role: "body", d: torso + dewlap + foreRaised.leg + foreStand.leg + hindNear.leg },
      { role: "body", d: foreRaised.hoof + foreStand.hoof + hindNear.hoof },
      { role: "line", d: foreRaised.line + foreStand.line + hindNear.line + hindFar.line + foreFar.line + "M30 32Q36 40 34 50M82 30Q90 38 90 48M48 26Q58 30 66 28", w: 1 },
      { role: "accent", d: horns },
      { role: "body", d: ear + head },
      { role: "line", d: "M5 33Q6.6 31.8 8 33.2M7 36.6Q10 36 12 37M13 22Q16 21 19 22.5", w: 1 },
      { role: "ink", d: smooth([[13.4, 25.6, 1], [15.4, 24.4], [17.6, 25.2, 1], [15.5, 26.6]], true) },
    ],
  };
}

/** A small open crown sitting on a head, centred at (x, y) (base of the band), width w. */
export function crownOn(x: number, y: number, w: number): string {
  const h = w * 0.55;
  return smooth(
    [
      [x - w / 2, y, 1],
      [x - w / 2 - 1, y - h, 1],
      [x - w / 4, y - h * 0.45, 1],
      [x, y - h * 1.1, 1],
      [x + w / 4, y - h * 0.45, 1],
      [x + w / 2 + 1, y - h, 1],
      [x + w / 2, y, 1],
    ],
    true,
  );
}

export const BEASTS: Partial<Record<ChargeId, ChargeDef>> = {
  lion: {
    name: "lion",
    plural: "lions",
    category: "beast",
    attitudes: ["rampant", "passant"],
    armedTerm: "armed and langued",
    accentDefault: "gules",
    weight: 16,
    art: (o) => (o.attitude === "passant" ? lionPassant() : lionRampant()),
  },
  wolf: {
    name: "wolf",
    plural: "wolves",
    category: "beast",
    attitudes: ["rampant", "passant"],
    armedTerm: "armed and langued",
    accentDefault: "gules",
    weight: 4,
    art: (o) => (o.attitude === "passant" ? wolfPassant() : wolfRampant()),
  },
  bear: {
    name: "bear",
    plural: "bears",
    category: "beast",
    attitudes: ["passant"],
    armedTerm: "armed",
    accentDefault: "same",
    weight: 3,
    art: () => bearPassant(),
  },
  stag: {
    name: "stag",
    plural: "stags",
    category: "beast",
    attitudes: ["trippant"],
    armedTerm: "attired",
    accentDefault: "same",
    weight: 4,
    art: () => stagTrippant(),
  },
  boar: {
    name: "boar",
    plural: "boars",
    category: "beast",
    attitudes: ["passant"],
    armedTerm: "armed",
    accentDefault: "argent",
    weight: 3,
    art: () => boarPassant(),
  },
  horse: {
    name: "horse",
    plural: "horses",
    category: "beast",
    attitudes: ["salient"],
    weight: 3,
    art: () => horseSalient(),
  },
  bull: {
    name: "bull",
    plural: "bulls",
    category: "beast",
    attitudes: ["passant"],
    armedTerm: "armed",
    accentDefault: "same",
    weight: 2,
    art: () => bullPassant(),
  },
};

void circleD; void curve;
export type { SPt };
