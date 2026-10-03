/**
 * Heavens, elements and plants: sun in splendour, moon, flame, thunderbolt,
 * wave, mountain, tree, oak, pine, rose, garb (wheat).
 */
import type { ChargeId } from "../types";
import type { ChargeArt, ChargeDef } from "./art";
import { blob, circleD, curve, ellipseD, f, limb, mirrorX, polyD, rotPts, smooth, type Pt, type SPt } from "../path";

const rad = (d: number) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------

function sun(): ChargeArt {
  let rays = "";
  for (let i = 0; i < 16; i++) {
    const a = rad(-90 + i * 22.5);
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    if (i % 2 === 0) {
      const b = 6.2, r0 = 19, r1 = 50;
      rays += smooth(
        [
          [50 + ux * r0 + nx * b, 50 + uy * r0 + ny * b, 1],
          [50 + ux * r1, 50 + uy * r1, 1],
          [50 + ux * r0 - nx * b, 50 + uy * r0 - ny * b, 1],
        ],
        true,
      );
    } else {
      const sp: [number, number, number][] = [];
      const st = [19, 26, 33, 39, 44.5];
      const off = [0, 2.6, -2.6, 2, 0];
      const wd = [11, 8.6, 6.2, 3.6, 0.3];
      for (let k = 0; k < st.length; k++) sp.push([50 + ux * st[k] + nx * off[k], 50 + uy * st[k] + ny * off[k], wd[k]]);
      rays += limb(sp, { start: "round", end: "flat" });
    }
  }
  const disc = circleD(50, 50, 22);
  const face =
    // brows
    "M38.5 40.5Q42.5 37.5 46.5 40M53.5 40Q57.5 37.5 61.5 40.5" +
    // eyes (upper lids)
    "M39.5 45.5Q42.5 43 45.5 45.5M54.5 45.5Q57.5 43 60.5 45.5" +
    // nose
    "M50 42.5C49.3 47 48 50.5 47.5 53C49 54.5 51 54.5 52.5 53.5" +
    // mouth
    "M44.5 58.5Q50 62 55.5 58.5M46.5 61.8Q50 63.4 53.5 61.8" +
    // cheeks
    "M37 52Q38.5 55 41 56M63 52Q61.5 55 59 56";
  return {
    layers: [
      { role: "body", d: rays },
      { role: "body", d: disc },
      { role: "line", d: face, w: 1.25 },
      { role: "ink", d: ellipseD(42.5, 46.3, 1.6, 1.1) + ellipseD(57.5, 46.3, 1.6, 1.1) },
    ],
  };
}

function moon(): ChargeArt {
  // Increscent: horns to the dexter (viewer's left), a face in profile on the inner edge.
  const R = 44, cx = 56, cy = 50;
  const r = 35, ix = 39, iy = 50;
  // outer arc points (right side, from top horn to bottom horn)
  const dd = cx - ix;
  const a = (R * R - r * r + dd * dd) / (2 * dd);
  const h = Math.sqrt(R * R - a * a);
  const hx = cx - a;
  const top: Pt = [hx, cy - h], bot: Pt = [hx, cy + h];
  const outer: SPt[] = [];
  const t0 = Math.atan2(top[1] - cy, top[0] - cx);
  let t1 = Math.atan2(bot[1] - cy, bot[0] - cx);
  if (t1 < t0) t1 += Math.PI * 2;
  for (let i = 0; i <= 24; i++) {
    const t = t0 + ((t1 - t0) * i) / 24;
    outer.push([cx + Math.cos(t) * R, cy + Math.sin(t) * R]);
  }
  // inner edge: from bottom horn back up to top horn along the inner circle, with a profile.
  const inner: SPt[] = [];
  const u0 = Math.atan2(bot[1] - iy, bot[0] - ix), u1 = Math.atan2(top[1] - iy, top[0] - ix);
  const N = 40;
  for (let i = 1; i < N; i++) {
    const t = u0 + ((u1 - u0) * i) / N;
    let rr = r;
    const y = iy + Math.sin(t) * r;
    // profile bumps (negative = toward the dark side, i.e. the face juts out to the left)
    const bump = (yc: number, w: number, amp: number) => amp * Math.exp(-(((y - yc) / w) ** 2));
    rr -= bump(52.5, 3.2, 6.5); // nose
    rr += bump(57.5, 1.2, 1.4); // under nose
    rr -= bump(60.5, 1.5, 2.2); // upper lip
    rr -= bump(64.2, 1.5, 2); // lower lip
    rr += bump(66.8, 1.3, 1.2);
    rr -= bump(71, 3, 2.6); // chin
    rr -= bump(41, 6, 1.6); // brow
    rr += bump(47.5, 1.6, 1.3); // eye socket
    inner.push([ix + Math.cos(t) * rr, iy + Math.sin(t) * rr]);
  }
  const pts: SPt[] = [[top[0], top[1], 1], ...outer.slice(1, -1), [bot[0], bot[1], 1], ...inner];
  return {
    layers: [
      { role: "body", d: smooth(pts, true) },
      { role: "line", d: "M69.5 45.2Q73 43.6 76 45.4M71.5 39.3Q75 37.3 79 38.8M73.5 59.5Q75.5 61.5 74.5 63.5M76 72Q79 70 82 71", w: 1.25 },
      { role: "ink", d: ellipseD(73, 46.6, 1.7, 1.1) },
    ],
  };
}

/** A tongue of fire along a centre line, tapering from w0 to a fine point. */
function tongue(pts: [number, number][], w0: number): string {
  const n = pts.length - 1;
  return limb(pts.map(([x, y], i) => [x, y, Math.max(0.3, w0 * Math.pow(1 - i / n, 0.85))] as [number, number, number]), { start: "round", end: "flat" });
}

function flame(): ChargeArt {
  // Five tongues of fire rising from a common root, the outer ones curling inward.
  const body =
    tongue([[50, 86], [46, 70], [53, 52], [47, 33], [51, 16], [57, 2]], 27) +
    tongue([[42, 85], [32, 71], [34, 55], [25, 42], [23, 28], [28, 17]], 19) +
    tongue([[58, 85], [68, 72], [66, 57], [75, 45], [77, 32], [72, 21]], 19) +
    tongue([[37, 88], [24, 81], [18, 69], [20, 57], [16, 49]], 13) +
    tongue([[63, 88], [76, 81], [82, 70], [80, 59], [84, 51]], 13) +
    smooth([[28, 84], [38, 78], [50, 77], [62, 78], [72, 84], [70, 92], [60, 97], [50, 98], [40, 97], [30, 92]], true);
  const inner = tongue([[50, 90], [47.5, 79], [51.5, 67], [48.5, 56], [50.5, 47]], 11);
  return {
    layers: [
      { role: "body", d: body },
      { role: "line", d: "M50 86Q47 72 52 58M41 84Q34 76 33 66M59 84Q66 76 67 66", w: 1.1 },
      { role: "shine", d: inner },
    ],
  };
}

/** A bold bolt of lightning, zigzagging down to a point, with a lesser fork. */
function lightningBolt(): ChargeArt {
  const bolt = smooth(
    [[56, 1, 1], [83, 1, 1], [62, 37, 1], [78, 36, 1], [48, 72, 1], [58, 71, 1], [27, 99, 1], [36, 64, 1], [26, 65, 1], [39, 39, 1], [29, 40, 1]],
    true,
  );
  return {
    layers: [
      { role: "body", d: bolt },
      { role: "line", d: "M60 5L42 37M66 40L44 66", w: 1 },
      { role: "shine", d: smooth([[60, 5, 1], [75, 5, 1], [52, 37, 1], [45, 37, 1]], true) },
    ],
  };
}

/** The classical winged thunderbolt (kept for large renderings; not used by the generator). */
export function thunderbolt(): ChargeArt {
  // The heraldic thunderbolt: a flaming twisted bar, winged, with four forked bolts in saltire.
  let bolts = "";
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const ex = 50 + sx * 39, ey = 50 + sy * 41;
    const dx = ex - 50, dy = ey - 50;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const P = (t: number, o: number): [number, number, number] => [50 + ux * L * t + nx * o, 50 + uy * L * t + ny * o, 5.4];
    bolts += limb([P(0.12, 0), P(0.42, 7), P(0.5, -6), P(0.82, 4)], { perSeg: 1, start: "flat", end: "flat" });
    const tip: Pt = [ex + ux * 6, ey + uy * 6];
    const base: Pt = [50 + ux * L * 0.8 + nx * 4, 50 + uy * L * 0.8 + ny * 4];
    bolts += polyD([
      [base[0] + nx * 7, base[1] + ny * 7],
      tip,
      [base[0] - nx * 7, base[1] - ny * 7],
      [base[0] + ux * 3, base[1] + uy * 3],
    ]);
  }
  // wings: fans of feathers
  let wings = "";
  let wl = "";
  for (const side of [-1, 1]) {
    const feathers: [number, number][] = [[-48, -24], [-46, -12], [-41, -2], [-34, 7], [-25, 13]];
    for (const [fx, fy] of feathers) {
      const ex = 50 + side * -fx, ey = 49 + fy;
      wings += limb([[50 + side * 6, 49, 9], [50 + side * (6 + (-fx - 6) * 0.55), 49 + fy * 0.55 - 2, 8.5], [ex, ey, 3.2]], { start: "round", end: "round" });
    }
    wings += smooth(
      [
        [50, 42],
        [50 + side * 18, 37],
        [50 + side * 30, 36],
        [50 + side * 27, 47],
        [50 + side * 17, 55],
        [50, 56],
      ].map(([x, y]) => [x, y] as SPt),
      true,
    );
    wl += curve([[50 + side * 13, 45], [50 + side * 20, 42], [50 + side * 27, 40]]);
  }
  const bar = smooth([[50, 22, 1], [55, 30], [56.5, 50], [55, 70], [50, 78, 1], [45, 70], [43.5, 50], [45, 30]], true);
  const fl = (y: number, dir: number) =>
    smooth([[45, y], [42, y + dir * 6], [46, y + dir * 9], [47, y + dir * 5], [50, y + dir * 14, 1], [53, y + dir * 5], [54, y + dir * 9], [58, y + dir * 6], [55, y]], true);
  let twist = "";
  for (let y = 30; y <= 68; y += 7.5) twist += `M44.5 ${f(y + 3)}Q50 ${f(y - 1.5)} 55.5 ${f(y - 3)}`;
  return {
    layers: [
      { role: "body", d: bolts },
      { role: "body", d: wings },
      { role: "line", d: wl, w: 1.1 },
      { role: "body", d: bar + fl(26, -1) + fl(74, 1) },
      { role: "line", d: twist, w: 1.1 },
    ],
  };
}

function wave(): ChargeArt {
  const body: SPt[] = [
    [3, 92, 1],
    [97, 92, 1],
    [97, 64],
    [93, 47],
    [85, 31],
    [74, 19],
    [60, 11],
    [45, 10],
    [32, 14],
    [21, 22],
    [14, 32],
    [13, 42],
    [10, 45, 1],
    [17, 47],
    [16, 51, 1],
    [23, 51],
    [24, 55, 1],
    [30, 51],
    [34, 45],
    [33, 36],
    [27, 33, 1],
    [32, 27],
    [40, 24],
    [49, 26],
    [56, 33],
    [59, 44],
    [57, 57],
    [50, 66],
    [40, 71],
    [28, 71],
    [18, 74],
    [9, 79],
    [3, 84],
  ];
  const lines =
    curve([[88, 60], [84, 44], [75, 31], [62, 22], [48, 19]]) +
    curve([[80, 72], [76, 56], [70, 44], [64, 36]]) +
    curve([[70, 84], [67, 74], [62, 66]]) +
    curve([[36, 28], [44, 29], [50, 35], [52, 44], [49, 52]]) +
    curve([[12, 86], [26, 80], [42, 78], [54, 81]]);
  return { layers: [{ role: "body", d: smooth(body, true) }, { role: "line", d: lines, w: 1.3 }] };
}

function mountain(): ChargeArt {
  const pts: SPt[] = [
    [1, 94, 1],
    [8, 80],
    [15, 64],
    [20, 52],
    [25, 41, 1],
    [30, 46],
    [35, 50, 1],
    [40, 37],
    [45, 22],
    [50, 7, 1],
    [55, 18],
    [61, 31],
    [65, 40, 1],
    [70, 35],
    [75, 29, 1],
    [81, 41],
    [87, 56],
    [93, 74],
    [99, 94, 1],
  ];
  const snow =
    "M43.5 26L47 30L50 25.5L53.5 30.5L57.5 25.5" +
    "M22 46L25 49L28 45.5" +
    "M72 33L75 36.5L78 33.5";
  const ridges =
    curve([[50, 9], [48, 30], [43, 50], [42, 70], [38, 90]]) +
    curve([[25, 43], [24, 60], [20, 78], [17, 92]]) +
    curve([[75, 31], [74, 50], [77, 70], [80, 90]]) +
    curve([[57, 40], [58, 56], [60, 70]]) +
    curve([[32, 62], [30, 74]]) +
    curve([[66, 60], [68, 74], [67, 86]]);
  return {
    layers: [
      { role: "body", d: smooth(pts, true) },
      { role: "line", d: snow, w: 1.3 },
      { role: "line", d: ridges, w: 1.15 },
    ],
  };
}

/** A scalloped leafy crown. */
function crown(cx: number, cy: number, rx: number, ry: number, lobes: number, depth: number, phase = 0): SPt[] {
  const pts: SPt[] = [];
  for (let i = 0; i < lobes; i++) {
    for (let k = 0; k < 4; k++) {
      const t = rad(phase + ((i + k / 4) * 360) / lobes);
      const bulge = k === 0 ? 0 : k === 2 ? 1 : 0.75;
      const rr = 1 + (depth * bulge) / Math.min(rx, ry);
      pts.push(k === 0 ? [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, 1] : [cx + Math.cos(t) * rx * rr, cy + Math.sin(t) * ry * rr]);
    }
  }
  return pts;
}

function roots(x: number, y: number, spread: number, n: number, len: number, w: number): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const ex = x + t * spread, ey = y + len * (1 - Math.abs(t) * 0.35);
    d += limb(
      [
        [x + t * w * 0.25, y - 4, w * 0.55],
        [x + t * spread * 0.45, y + len * 0.45, w * 0.32],
        [ex, ey, 0.4],
      ],
      { start: "round", end: "flat" },
    );
  }
  return d;
}

function tree(): ChargeArt {
  // A tree eradicated: a stout trunk, its roots torn up, and a crown built of
  // clumps of foliage in three ranks, the nearer overlapping the farther.
  const trunk = smooth([[44, 50], [45.5, 66], [43.5, 80], [40, 86, 1], [60, 86, 1], [56.5, 80], [54.5, 66], [56, 50]], true);
  const branches = limb([[49, 62, 6], [41, 54, 4.4], [33, 49, 2.6]], { end: "round" }) + limb([[51, 60, 6], [60, 52, 4.4], [67, 48, 2.6]], { end: "round" });
  const clumps = (list: [number, number, number][]) => list.map(([x, y, r]) => circleD(x, y, r)).join("");
  const back = clumps([[50, 13, 12.5], [35, 19, 11], [65, 19, 11]]);
  const mid = clumps([[23, 32, 11], [77, 32, 11], [41, 28, 12], [59, 28, 12]]);
  const front = clumps([[30, 45, 11.5], [70, 45, 11.5], [50, 41, 12.5]]);
  const tufts = (list: [number, number, number][]) => list.map(([x, y, r]) => `M${x - r * 0.55} ${y + r * 0.2}Q${x} ${y - r * 0.35} ${x + r * 0.55} ${y + r * 0.2}`).join("");
  return {
    layers: [
      { role: "body", d: roots(50, 84, 27, 5, 13, 13) + trunk + branches },
      { role: "line", d: "M47 84C48 76 47 68 48 58M53 84C52 76 53 68 52 58", w: 1.1 },
      { role: "body", d: back },
      { role: "line", d: tufts([[50, 13, 12.5], [35, 19, 11], [65, 19, 11]]), w: 1.1 },
      { role: "body", d: mid },
      { role: "line", d: tufts([[23, 32, 11], [77, 32, 11], [41, 28, 12], [59, 28, 12]]), w: 1.1 },
      { role: "body", d: front },
      { role: "line", d: tufts([[30, 45, 11.5], [70, 45, 11.5], [50, 41, 12.5]]), w: 1.1 },
    ],
  };
}

function oak(): ChargeArt {
  // A broad oak with a deeply lobed crown and acorns.
  const pts: SPt[] = [];
  const lobes = 9;
  for (let i = 0; i < lobes; i++) {
    const base = -90 + (i * 360) / lobes + 20;
    const t0 = rad(base), t1 = rad(base + 360 / lobes / 2), t2 = rad(base + (360 / lobes) * 0.25), t3 = rad(base + (360 / lobes) * 0.75);
    const rx = 43, ry = 31, cx = 50, cy = 37;
    pts.push([cx + Math.cos(t0) * rx * 0.86, cy + Math.sin(t0) * ry * 0.84, 1]);
    pts.push([cx + Math.cos(t2) * rx * 1.02, cy + Math.sin(t2) * ry * 1.02]);
    pts.push([cx + Math.cos(t1) * rx * 1.08, cy + Math.sin(t1) * ry * 1.1]);
    pts.push([cx + Math.cos(t3) * rx * 1.02, cy + Math.sin(t3) * ry * 1.02]);
  }
  const trunk = smooth([[40, 56], [43, 70], [40, 84], [36, 88, 1], [64, 88, 1], [60, 84], [57, 70], [60, 56]], true) + roots(50, 86, 24, 5, 10, 14);
  const limbs = limb([[47, 64, 6], [38, 54, 4.5], [28, 49, 3]], { end: "round" }) + limb([[53, 62, 6], [63, 53, 4.5], [73, 48, 3]], { end: "round" });
  // acorns hanging below the crown
  let acorns = "";
  let cups = "";
  for (const [x, y] of [[22, 58], [36, 66], [64, 66], [78, 58], [50, 70]] as Pt[]) {
    if (x === 50) continue;
    acorns += ellipseD(x, y + 4, 3.6, 5);
    cups += smooth([[x - 4.6, y + 1.5], [x, y - 2.5], [x + 4.6, y + 1.5], [x + 3.4, y + 3.4, 1], [x - 3.4, y + 3.4, 1]], true);
  }
  return {
    layers: [
      { role: "body", d: trunk + limbs },
      { role: "body", d: smooth(pts, true) },
      { role: "accent", d: acorns },
      { role: "accent", d: cups },
      {
        role: "line",
        d:
          "M24 34Q30 28 36 32M44 22Q50 16 56 22M64 32Q70 27 76 34M34 46Q40 42 46 46M56 46Q62 42 68 46M18 44Q22 41 26 44M76 44Q80 41 84 44" +
          "M45 86C46 78 44 70 46 60M55 86C54 78 56 70 54 60M50 84C51 76 49 68 50 62",
        w: 1.2,
      },
    ],
  };
}

function pine(): ChargeArt {
  const tiers = 5;
  let d = "";
  let lines = "";
  for (let i = 0; i < tiers; i++) {
    const top = 4 + i * 14;
    const bot = top + 26;
    const hw = 10 + i * 7.5;
    const pts: SPt[] = [
      [50, top, 1],
      [50 + hw * 0.55, top + (bot - top) * 0.55],
      [50 + hw, bot, 1],
      [50 + hw * 0.66, bot - 3.5],
      [50 + hw * 0.4, bot, 1],
      [50 + hw * 0.12, bot - 3.5],
      [50 - hw * 0.12, bot - 3.5],
      [50 - hw * 0.4, bot, 1],
      [50 - hw * 0.66, bot - 3.5],
      [50 - hw, bot, 1],
      [50 - hw * 0.55, top + (bot - top) * 0.55],
    ];
    d += smooth(pts, true);
    if (i > 0) lines += `M${f(50 - hw * 0.5)} ${f(top + 6)}Q50 ${f(top + 11)} ${f(50 + hw * 0.5)} ${f(top + 6)}`;
  }
  const trunk = polyD([[45, 84], [55, 84], [56, 96], [44, 96]]);
  return {
    layers: [
      { role: "body", d: trunk + roots(50, 94, 14, 3, 5, 9) },
      { role: "body", d },
      { role: "line", d: lines, w: 1.15 },
    ],
  };
}

function rose(): ChargeArt {
  let outer = "";
  let inner = "";
  let barbs = "";
  for (let i = 0; i < 5; i++) {
    const a = -90 + i * 72;
    const t = rad(a);
    const cx = 50 + Math.cos(t) * 23, cy = 50 + Math.sin(t) * 23;
    // petal with a notch at its tip
    const pts: SPt[] = [];
    const R = 22;
    for (let k = 0; k <= 16; k++) {
      const u = rad(a - 150 + (k * 300) / 16);
      const notch = Math.abs(k - 8) < 0.5 ? 0.86 : 1;
      pts.push([cx + Math.cos(u) * R * notch, cy + Math.sin(u) * R * notch, Math.abs(k - 8) < 0.5 ? 1 : 0] as SPt);
    }
    pts.push([50 + Math.cos(t) * 4, 50 + Math.sin(t) * 4]);
    outer += smooth(pts.map((p) => (p[2] ? p : [p[0], p[1]])) as SPt[], true);
    const ti = rad(a + 36);
    inner += blob(Array.from({ length: 12 }, (_, k) => {
      const u = (k / 12) * Math.PI * 2;
      return [50 + Math.cos(ti) * 11 + Math.cos(u) * 11, 50 + Math.sin(ti) * 11 + Math.sin(u) * 11] as SPt;
    }));
    const tb = rad(a + 36);
    const bx = 50 + Math.cos(tb) * 49, by = 50 + Math.sin(tb) * 49;
    const nx = -Math.sin(tb), ny = Math.cos(tb);
    barbs += smooth([[50 + Math.cos(tb) * 34 + nx * 7, 50 + Math.sin(tb) * 34 + ny * 7], [bx, by, 1], [50 + Math.cos(tb) * 34 - nx * 7, 50 + Math.sin(tb) * 34 - ny * 7]], true);
  }
  let seeds = "";
  for (let i = 0; i < 7; i++) {
    const t = rad(i * (360 / 7));
    seeds += circleD(50 + Math.cos(t) * 4.6, 50 + Math.sin(t) * 4.6, 1.15);
  }
  return {
    layers: [
      { role: "accent", d: barbs },
      { role: "body", d: outer },
      { role: "body", d: inner },
      { role: "crown", d: circleD(50, 50, 8) },
      { role: "ink", d: seeds },
    ],
  };
}

function ear(ang: number, r0: number, r1: number, cx: number, cy: number, w: number): { d: string; l: string } {
  const a = rad(ang);
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const P = (r: number, o: number): SPt => [cx + ux * r + nx * o, cy + uy * r + ny * o];
  const L = r1 - r0;
  const pts: SPt[] = [[...P(r0, 0), 1] as SPt];
  // grain bumps up one side and down the other
  const k = 5;
  for (let i = 1; i <= k; i++) {
    const r = r0 + (L * (i - 0.5)) / k;
    const ww = w * (i === k ? 0.62 : 1) * (0.7 + 0.3 * Math.sin((Math.PI * i) / (k + 1)));
    pts.push(P(r, ww / 2));
    pts.push([...P(r + L / k / 2, ww / 2.25), 1] as SPt);
  }
  pts.push([...P(r1, 0), 1] as SPt);
  for (let i = k; i >= 1; i--) {
    const r = r0 + (L * (i - 0.5)) / k;
    const ww = w * (i === k ? 0.62 : 1) * (0.7 + 0.3 * Math.sin((Math.PI * i) / (k + 1)));
    pts.push([...P(r + L / k / 2, -ww / 2.25), 1] as SPt);
    pts.push(P(r, -ww / 2));
  }
  const tip = P(r1, 0);
  const l =
    `M${f(tip[0])} ${f(tip[1])}L${f(tip[0] + ux * 6 + nx * 1.5)} ${f(tip[1] + uy * 6 + ny * 1.5)}` +
    `M${f(P(r0 + L * 0.15, 0)[0])} ${f(P(r0 + L * 0.15, 0)[1])}L${f(P(r1 - L * 0.12, 0)[0])} ${f(P(r1 - L * 0.12, 0)[1])}`;
  return { d: smooth(pts, true), l };
}

function garb(): ChargeArt {
  const cx = 50, cy = 63;
  let back = "", front = "", lb = "", lf = "", stems = "";
  const backAngles = [-152, -134, -116, -64, -46, -28];
  const frontAngles = [-142, -122, -102, -78, -58, -38, -90];
  for (const a of backAngles) {
    const e = ear(a, 26, 53, cx, cy, 8.6);
    back += e.d; lb += e.l;
    const r = rad(a);
    stems += limb([[cx + Math.cos(r) * 4, cy + Math.sin(r) * 4, 3], [cx + Math.cos(r) * 28, cy + Math.sin(r) * 28, 2.6]], { start: "flat", end: "flat" });
  }
  for (const a of frontAngles) {
    const e = ear(a, a === -90 ? 21 : 19, a === -90 ? 51 : 45, cx, cy, 9.2);
    front += e.d; lf += e.l;
    const r = rad(a);
    stems += limb([[cx + Math.cos(r) * 4, cy + Math.sin(r) * 4, 3], [cx + Math.cos(r) * 21, cy + Math.sin(r) * 21, 2.6]], { start: "flat", end: "flat" });
  }
  const bundle = smooth([[41, 62], [59, 62], [62, 78], [69, 96, 1], [31, 96, 1], [38, 78]], true);
  const band = smooth([[36.5, 60, 1], [63.5, 60, 1], [64.5, 68, 1], [35.5, 68, 1]], true);
  let lines = "";
  for (let i = 0; i < 7; i++) {
    const x = 35.5 + i * 4.8;
    lines += curve([[50 + (x - 50) * 0.45, 69], [50 + (x - 50) * 0.75, 82], [x, 95]]);
  }
  return {
    layers: [
      { role: "body", d: back + stems },
      { role: "line", d: lb, w: 1 },
      { role: "body", d: front },
      { role: "line", d: lf, w: 1 },
      { role: "body", d: bundle },
      { role: "line", d: lines, w: 1 },
      { role: "body", d: band },
      { role: "line", d: "M37 64H63", w: 1 },
    ],
  };
}

export const NATURE: Partial<Record<ChargeId, ChargeDef>> = {
  sun: { name: "sun in splendour", plural: "suns in splendour", category: "celestial", symmetric: true, weight: 4, art: sun },
  moon: { name: "moon increscent", plural: "moons increscent", category: "celestial", weight: 2, art: moon },
  flame: { name: "flame", plural: "flames", category: "nature", symmetric: true, weight: 2, art: flame },
  lightning: { name: "bolt of lightning", plural: "bolts of lightning", category: "nature", long: true, weight: 1, art: lightningBolt },
  wave: { name: "wave of the sea", plural: "waves of the sea", category: "nature", weight: 1, art: wave },
  mountain: { name: "mountain", plural: "mountains", category: "nature", weight: 2, art: mountain },
  tree: { name: "tree eradicated", plural: "trees eradicated", category: "plant", symmetric: true, weight: 3, art: tree },
  oak: { name: "oak tree fructed", plural: "oak trees fructed", category: "plant", symmetric: true, weight: 2, accentDefault: "same", art: oak },
  pine: { name: "pine tree", plural: "pine trees", category: "plant", symmetric: true, weight: 2, art: pine },
  rose: { name: "rose", plural: "roses", category: "plant", symmetric: true, armedTerm: "barbed", accentDefault: "vert", weight: 6, art: rose },
  wheat: { name: "garb", plural: "garbs", category: "plant", symmetric: true, weight: 4, art: garb },
};

void rotPts;
