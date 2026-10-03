/**
 * Birds: eagle displayed, raven close, falcon close, owl, swan rousant, martlet.
 */
import type { ChargeId } from "../types";
import type { ChargeArt, ChargeDef } from "./art";
import { circleD, curve, ellipseD, f, limb, mirrorX, smooth, type SPt } from "../path";
import { crownOn, maneLocks } from "./beasts";

/** A long feather from (x0, y0) to (x1, y1), rounded tip. */
function plume(x0: number, y0: number, x1: number, y1: number, w0: number, w1 = w0 * 0.8, bend = 0): string {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
  const P = (t: number, w: number): [number, number, number] => {
    const b = Math.sin(Math.PI * t) * bend;
    return [x0 + (x1 - x0) * t + nx * b, y0 + (y1 - y0) * t + ny * b, w];
  };
  // a blade: full width most of the way, then a rounded, slightly pointed tip
  return limb([P(0, w0), P(0.45, (w0 + w1) / 2 * 1.04), P(0.78, w1 * 1.04), P(0.93, w1 * 0.72), P(1, w1 * 0.2)], { start: "round", end: "flat" });
}

function talons(x: number, y: number, dir: number, s: number): string {
  // three forward toes and a hind toe, each ending in a hooked claw
  let d = "";
  const a0 = (dir * Math.PI) / 180;
  for (const off of [-0.75, 0, 0.75, Math.PI - 0.2]) {
    const a = a0 + off;
    const L = off > 2 ? 0.75 * s : s;
    const mx = x + Math.cos(a) * L * 0.6, my = y + Math.sin(a) * L * 0.6;
    const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
    const cx = ex + Math.cos(a + 1.3) * s * 0.38, cy = ey + Math.sin(a + 1.3) * s * 0.38;
    d += limb([[x, y, s * 0.3], [mx, my, s * 0.24], [ex, ey, s * 0.2], [cx, cy, 0.2]], { start: "round", end: "flat" });
  }
  return d;
}

// ---------------------------------------------------------------------------

function eagleDisplayed(): ChargeArt {
  // Right (sinister) half; the dexter half is mirrored.
  const wingBone = limb(
    [
      [55, 40, 10],
      [66, 30, 8.6],
      [78, 19, 7.4],
      [89, 9, 6],
      [96, 4, 4],
    ],
    { start: "round", end: "round" },
  );
  const fe: [number, number, number, number][] = [
    [92, 6, 100, 22], [88, 10, 99, 32], [83, 15, 96, 42], [77, 20, 91, 52], [71, 26, 84, 59], [65, 32, 76, 63], [59, 38, 67, 64],
  ];
  let feathers = "";
  for (const [a, b, c, d] of fe) feathers += plume(a, b, c, d, 9, 8.2, -1.2);
  const coverts = smooth(
    [
      [54, 35],
      [64, 26],
      [76, 16],
      [88, 7],
      [93, 13],
      [88, 22],
      [80, 30],
      [72, 38],
      [64, 46],
      [56, 52],
    ],
    true,
  );
  const leg = plume(54, 62, 63, 72, 9, 6.4, 1);
  const shank = limb([[63, 72, 4], [67, 78, 3.6]], { start: "round", end: "round" });
  const claws = talons(68, 79, 40, 7);
  const tailFeathers = plume(50, 66, 50, 94, 8.4, 8) + plume(52, 66, 59.5, 92, 8, 7.6, 0.5) + plume(54, 65, 67, 88, 7.6, 7, 1);
  const half = (d: string) => d + mirrorPath(d);
  const torso = smooth(
    [
      [50, 33],
      [57, 39],
      [60, 50],
      [58, 62],
      [53, 70],
      [50, 71],
      [47, 70],
      [42, 62],
      [40, 50],
      [43, 39],
    ],
    true,
  );
  const neck = limb([[50, 40, 12], [48, 30, 9.6], [46, 24, 9]], { start: "round", end: "round" });
  const head = smooth(
    [
      [53, 20],
      [51, 14],
      [45, 12],
      [39.5, 14],
      [36.5, 18],
      [38, 22.5],
      [43, 26],
      [50, 26],
    ],
    true,
  );
  const beak = smooth([[39, 15, 1], [33, 15.5], [29, 18], [28.5, 22.5, 1], [31, 20.5], [34.5, 21.5], [39, 23, 1]], true);
  const tongue = limb([[33, 21.5, 2.2], [29, 24, 1.8], [27, 27.5, 1.2], [27.5, 30, 0.2]], { start: "round", end: "flat" });
  let featherLines = "";
  // scallops on the breast
  for (let r = 0; r < 4; r++) {
    for (let c = -1; c <= 1; c++) {
      const x = 50 + c * 5.4 + (r % 2 ? 2.7 : 0);
      const y = 42 + r * 6;
      if (Math.abs(x - 50) > 8 - r * 0.5) continue;
      featherLines += `M${f(x - 2.6)} ${f(y)}Q${f(x)} ${f(y + 3.2)} ${f(x + 2.6)} ${f(y)}`;
    }
  }
  // feather divisions on wings
  let wl = "";
  for (const [a, b, c, d] of fe) wl += `M${f(a + (c - a) * 0.4)} ${f(b + (d - b) * 0.4)}L${f(a + (c - a) * 0.86)} ${f(b + (d - b) * 0.86)}`;
  wl += "M58 41Q65 39 70 33M62 44Q70 42 76 35M66 46Q74 44 81 38";
  return {
    layers: [
      { role: "body", d: half(feathers) },
      { role: "line", d: wl + mirrorPath(wl), w: 1 },
      { role: "body", d: half(wingBone + coverts) },
      { role: "line", d: half("M60 33Q66 31 70 26M67 27Q73 24 77 19M74 21Q80 18 84 13"), w: 1 },
      { role: "body", d: half(tailFeathers) },
      { role: "line", d: half("M52 76V90M56 75L60 87"), w: 0.9 },
      { role: "accent", d: half(shank + claws) },
      { role: "body", d: half(leg) },
      { role: "line", d: half("M56 64Q58 68 61 68M57 68Q59 71 62 71"), w: 0.9 },
      { role: "body", d: torso + neck },
      { role: "line", d: featherLines, w: 0.95 },
      { role: "accent", d: tongue },
      { role: "accent", d: beak },
      { role: "body", d: head },
      { role: "crown", d: crownOn(46, 13, 14) },
      { role: "line", d: "M39.4 16.4Q42 15 44.5 16.5M48 20Q50.5 23 49.5 27M33.5 18.2Q35 18.8 36 18", w: 1 },
      { role: "ink", d: smooth([[41, 18.2, 1], [43, 16.9], [45.2, 17.8, 1], [43.1, 19.2]], true) },
    ],
  };
}

/** Mirror a path's absolute coordinates about x = 50. */
function mirrorPath(d: string): string {
  return d.replace(/([MLQCHVZ])([^MLQCHVZ]*)/gi, (_m, cmd: string, args: string) => {
    if (cmd === "Z" || cmd === "z") return cmd;
    const nums = args.trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (cmd === "H") return "H" + nums.map((x) => f(100 - x)).join(" ");
    if (cmd === "V") return "V" + nums.join(" ");
    const out: string[] = [];
    for (let i = 0; i < nums.length; i += 2) out.push(`${f(100 - nums[i])} ${f(nums[i + 1])}`);
    return cmd + out.join(" ");
  });
}

// ---------------------------------------------------------------------------

function corvid(kind: "raven" | "falcon"): ChargeArt {
  const falcon = kind === "falcon";
  const body: SPt[] = falcon
    ? [[28, 22], [36, 30], [45, 44], [52, 60], [56, 74], [52, 82], [42, 80], [32, 70], [24, 54], [22, 38], [21, 28]]
    : [[24, 34], [34, 30], [50, 34], [68, 44], [80, 54], [76, 64], [60, 66], [44, 64], [32, 58], [24, 48], [20, 40]];
  const head: SPt[] = falcon
    ? [[29, 4], [36, 7], [38, 15], [35, 23], [28, 26], [20, 24], [16, 18], [18, 9], [23, 5]]
    : [[27, 18], [33, 20], [36, 27], [34, 35], [27, 39], [20, 37], [16, 31], [17, 24], [21, 19]];
  const beak: SPt[] = falcon
    ? [[18, 9, 1], [12, 10], [8.5, 13], [8.6, 17.5, 1], [11, 16], [14, 16.5], [17, 16, 1]]
    : [[19, 21.5, 1], [11, 22.5], [3, 26.5], [0.5, 29.5, 1], [6, 29.2], [12, 30], [18, 32, 1]];
  const wing: SPt[] = falcon
    ? [[34, 28, 1], [44, 38], [53, 54], [60, 72], [64, 86, 1], [58, 80], [52, 74], [44, 62], [36, 48], [32, 36]]
    : [[34, 34, 1], [50, 38], [68, 47], [84, 58], [98, 66, 1], [86, 64], [72, 60], [56, 56], [42, 50], [34, 42]];
  const tail: SPt[] = falcon
    ? [[50, 72], [58, 82], [62, 96], [57, 98, 1], [53, 97], [49, 98, 1], [46, 86], [44, 76]]
    : [[70, 52], [84, 58], [99, 66], [97, 70, 1], [92, 70], [94, 74, 1], [82, 70], [68, 64]];
  const legs = falcon
    ? limb([[38, 76, 4], [37, 84, 3.4]], { start: "round", end: "round" }) + limb([[46, 78, 4], [46, 85, 3.4]], { start: "round", end: "round" })
    : limb([[42, 62, 4.4], [40, 72, 3.6], [38, 80, 3.2]], { start: "round", end: "round" }) + limb([[52, 62, 4.4], [54, 72, 3.6], [53, 80, 3.2]], { start: "round", end: "round" });
  const feet = falcon ? talons(37, 85, 175, 6) + talons(46, 86, 175, 6) : talons(38, 81, 175, 6.5) + talons(53, 81, 175, 6.5);
  const perch = falcon ? smooth([[24, 87.5, 1], [64, 87.5, 1], [64, 92, 1], [24, 92, 1]], true) : "";
  const bells = falcon ? circleD(33.5, 81.5, 2.6) + circleD(50.5, 82.5, 2.6) : "";
  let lines = "";
  if (falcon) {
    lines += "M38 34Q46 46 52 64M42 40Q50 54 56 72M48 64Q52 74 58 82";
    for (const [x, y] of [[28, 40], [32, 48], [26, 52], [34, 58], [30, 64], [38, 68]] as [number, number][]) lines += `M${x - 2} ${y}Q${x} ${y + 2.4} ${x + 2} ${y}`;
    lines += "M28 22Q33 24 34 18M50 82V96M54 84L55 96";
  } else {
    lines += "M42 42Q58 46 74 55M48 47Q62 51 80 59M58 53Q72 57 88 63M78 61L90 66M86 67L96 69";
    lines += "M28 46Q32 50 36 50M30 52Q34 56 38 56";
  }
  return {
    layers: [
      ...(falcon ? [{ role: "body" as const, d: perch }] : []),
      { role: "accent", d: legs + feet },
      ...(falcon ? [{ role: "accent" as const, d: bells }] : []),
      { role: "body", d: smooth(tail, true) },
      { role: "body", d: smooth(body, true) + smooth(head, true) },
      { role: "body", d: smooth(wing, true) },
      { role: "line", d: lines, w: 1 },
      { role: "accent", d: smooth(beak, true) },
      {
        role: "line",
        d: falcon ? "M17 13.6Q19 13.2 20 14M22 19Q26 22 30 21" : "M5 28.4Q11 27.6 17 28.6M24 24Q27 23 30 24.5",
        w: 1,
      },
      { role: "ink", d: falcon ? circleD(24, 12.5, 2.1) : circleD(25.5, 26.5, 2) },
    ],
  };
}

// ---------------------------------------------------------------------------

/**
 * A falcon close: upright, deep-chested, round-headed, with a short hooked beak,
 * the dark "moustache" of the peregrine, its long wing folded over a barred
 * breast, bells on its legs and jesses fluttering.
 */
function falconClose(): ChargeArt {
  const head = smooth([[33, 4.5], [41, 6.5], [45.5, 12.5], [45, 19.5], [41, 25], [33, 27.5], [27, 24.5], [24.5, 18], [26, 10], [29, 6]], true);
  const beak = smooth([[27, 11, 1], [21.5, 11.2], [17.6, 14.2], [17.2, 19.4, 1], [19.8, 17.6], [22.2, 18.6], [26, 19.5, 1]], true);
  const body = smooth(
    [[35, 22], [45, 23], [53, 29], [58, 40], [59, 54], [56, 66], [50, 75], [41, 79], [32, 77], [26, 70], [22.5, 59], [22.5, 46], [25, 34], [29, 26]],
    true,
  );
  const wing = smooth(
    [[40, 26, 1], [50, 28], [57, 36], [61, 48], [63, 62], [64.5, 76], [66, 91, 1], [60, 85], [54, 77], [47, 65], [41, 52], [37, 40], [36, 31]],
    true,
  );
  const tail = smooth([[47, 71], [55, 73], [60, 86], [62, 97], [57, 98.5, 1], [53, 96.5], [48.5, 98.5, 1], [45, 86], [43, 76]], true);
  const legs = limb([[35, 74, 6], [34, 83, 4.6], [33, 88, 4]], { start: "round", end: "round" }) + limb([[45, 75, 6], [45, 84, 4.6], [45.5, 89, 4]], { start: "round", end: "round" });
  const feet = talons(33, 89, 172, 5.6) + talons(45.5, 90, 178, 5.6);
  const bells = circleD(30.2, 83.5, 2.4) + circleD(49.2, 84, 2.4);
  // breast barring, wing coverts and primaries
  let lines = "M41 31Q50 40 54 56M45 33Q55 46 58 64M50 60Q57 70 61 84M53 70Q59 79 63 90";
  for (const [x, y] of [[29, 38], [35, 36], [27, 46], [33, 45], [29, 54], [35, 53], [31, 62], [37, 61], [34, 69]] as [number, number][]) {
    lines += `M${x - 2.2} ${y - 0.6}Q${x} ${y + 1.8} ${x + 2.2} ${y - 0.6}`;
  }
  lines += "M51 82L52.5 96M55 81L57 96";
  return {
    layers: [
      { role: "body", d: tail },
      { role: "accent", d: legs + feet },
      { role: "body", d: body + head },
      { role: "body", d: wing },
      { role: "accent", d: bells },
      { role: "line", d: "M28.3 84H32.1M47.3 84.5H51.1", w: 0.8 },
      { role: "line", d: lines, w: 1 },
      { role: "line", d: "M28 9.5Q33 7 38.5 9.5M26.5 16Q28.5 17 30 16.5", w: 1 },
      { role: "accent", d: beak },
      { role: "line", d: "M22 13.8Q20 15.6 19.6 18", w: 0.9 },
      { role: "ink", d: circleD(32, 13, 2.3) },
      // the peregrine's dark moustache under the eye
      { role: "ink", d: smooth([[30.4, 16.4, 1], [32.2, 16.8], [32.4, 21.5], [31.2, 24.2, 1], [30.2, 21]], true) },
    ],
  };
}

function owl(): ChargeArt {
  const body = smooth([[50, 34], [66, 40], [74, 56], [72, 74], [62, 88], [50, 91], [38, 88], [28, 74], [26, 56], [34, 40]], true);
  const head = smooth(
    [
      [50, 12],
      [62, 13],
      [70, 6, 1],
      [72, 18],
      [75, 30],
      [70, 42],
      [60, 47],
      [50, 48],
      [40, 47],
      [30, 42],
      [25, 30],
      [28, 18],
      [30, 6, 1],
      [38, 13],
    ],
    true,
  );
  const wings = smooth([[30, 46, 1], [24, 60], [24, 76], [30, 88], [38, 92, 1], [34, 76], [32, 60]], true) + smooth(mirrorX([[30, 46, 1], [24, 60], [24, 76], [30, 88], [38, 92, 1], [34, 76], [32, 60]], 50), true);
  const feet = talons(43, 90, 95, 6) + talons(57, 90, 85, 6);
  let breast = "";
  for (let r = 0; r < 5; r++) {
    for (let c = -2; c <= 2; c++) {
      const x = 50 + c * 6 + (r % 2 ? 3 : 0);
      const y = 56 + r * 6.4;
      if (Math.abs(x - 50) > 15 - r * 1.2) continue;
      breast += `M${f(x - 2.4)} ${f(y)}L${f(x)} ${f(y + 2.4)}L${f(x + 2.4)} ${f(y)}`;
    }
  }
  return {
    layers: [
      { role: "accent", d: feet },
      { role: "body", d: body },
      { role: "line", d: breast, w: 1 },
      { role: "body", d: wings },
      { role: "line", d: "M28 62Q30 72 33 80M70 62Q68 72 65 80M26 70Q28 78 31 84M72 70Q70 78 67 84", w: 0.9 },
      { role: "body", d: head },
      { role: "line", d: circleD(39.5, 29, 9.2) + circleD(60.5, 29, 9.2) + "M44 16Q50 20 56 16M34 13L36 18M66 13L64 18", w: 1.1 },
      { role: "shade", d: circleD(39.5, 29, 5.6) + circleD(60.5, 29, 5.6) },
      { role: "ink", d: circleD(39.5, 29, 3.4) + circleD(60.5, 29, 3.4) },
      { role: "shine", d: circleD(38.3, 27.8, 1.1) + circleD(59.3, 27.8, 1.1) },
      { role: "accent", d: smooth([[47, 33, 1], [53, 33, 1], [50, 41, 1]], true) },
    ],
  };
}

function swan(): ChargeArt {
  const body = smooth([[40, 64], [52, 60], [70, 60], [86, 58], [97, 52, 1], [94, 64], [86, 76], [70, 82], [52, 82], [40, 78], [34, 70]], true);
  const neck = limb([[42, 68, 13], [32, 60, 9.5], [26, 48, 7.6], [28, 36, 6.6], [32, 26, 6.4], [28, 17, 6.6]], { start: "round", end: "round" });
  const head = smooth([[34, 15], [30, 10], [24, 10], [20, 13], [19.5, 17], [23, 20], [30, 21]], true);
  const beak = smooth([[21, 13, 1], [14, 15], [8.5, 19.5, 1], [15, 19.5], [21, 19, 1]], true);
  const knob = circleD(20.5, 13, 2.4);
  let wingFar = "";
  for (const [x0, y0, x1, y1] of [[60, 50, 74, 2], [64, 50, 84, 4], [66, 52, 92, 10]] as [number, number, number, number][]) wingFar += plume(x0, y0, x1, y1, 8, 7, -3);
  // near wing: an arched covert with primaries sweeping up and back
  let prim = "";
  const pf: [number, number, number, number][] = [
    [62, 30, 84, 4], [66, 34, 92, 10], [70, 40, 98, 20], [72, 46, 100, 32], [74, 52, 99, 44], [74, 58, 95, 54],
  ];
  for (const [x0, y0, x1, y1] of pf) prim += plume(x0, y0, x1, y1, 8.6, 7.6, -2.2);
  const wingNear = prim + smooth([[46, 64, 1], [47, 50], [52, 36], [60, 24], [70, 16], [80, 10, 1], [78, 22], [76, 36], [78, 50], [80, 60, 1], [64, 66]], true);
  const feet = smooth([[56, 82], [52, 92, 1], [58, 90], [62, 94, 1], [64, 88], [70, 92, 1], [66, 82]], true);
  let wl = "M52 54Q58 46 66 42M54 44Q60 36 68 32M52 62Q62 56 72 54M58 30Q64 24 72 20";
  for (const [x0, y0, x1, y1] of pf) wl += `M${f(x0 + (x1 - x0) * 0.55)} ${f(y0 + (y1 - y0) * 0.55)}L${f(x0 + (x1 - x0) * 0.88)} ${f(y0 + (y1 - y0) * 0.88)}`;
  return {
    layers: [
      { role: "body", d: wingFar },
      { role: "accent", d: feet },
      { role: "body", d: body + neck },
      { role: "line", d: "M52 74Q66 78 84 70M60 66Q74 68 88 62", w: 1 },
      { role: "body", d: wingNear },
      { role: "line", d: wl, w: 1 },
      { role: "accent", d: beak },
      { role: "body", d: head },
      { role: "ink", d: knob + smooth([[25, 13.6, 1], [26.8, 12.6], [28.6, 13.4, 1], [26.9, 14.4]], true) },
    ],
  };
}

function martlet(): ChargeArt {
  // The heraldic martlet: a swallow without feet — tufts of feather where the legs
  // would be — with a short beak, wings close and a deeply forked tail.
  const body = smooth([[25, 30], [34, 27], [48, 30], [62, 37], [74, 43], [82, 47], [78, 54], [64, 55], [48, 54], [34, 50], [25, 44], [21, 37]], true);
  const head = smooth([[27, 20], [35, 22], [37, 30], [33, 37], [25, 39], [18.5, 35], [18, 27], [21.5, 22]], true);
  const beak = smooth([[18.6, 27.5, 1], [10.5, 30.6, 1], [18.4, 33.4, 1]], true);
  const tail = smooth([[70, 44, 1], [86, 40], [99, 34, 1], [90, 45], [99, 58, 1], [85, 53], [72, 52, 1]], true);
  const wing = smooth([[33, 32, 1], [46, 30], [60, 33], [76, 39], [93, 44, 1], [77, 47], [60, 46], [45, 43], [36, 40]], true);
  const tufts = maneLocks([
    [43, 52, 39, 63, 6.5, 1.6],
    [51, 53, 49.5, 64, 6.5, 1.6],
  ]);
  return {
    layers: [
      { role: "body", d: tufts + tail },
      { role: "body", d: body + head },
      { role: "body", d: wing },
      { role: "line", d: "M46 36Q60 38 78 43M51 40Q64 42 84 45M26 37Q30 41 36 41M86 44L96 38M86 50L95 55", w: 1 },
      { role: "accent", d: beak },
      { role: "ink", d: circleD(25.5, 28.5, 2) },
    ],
  };
}

export const BIRDS: Partial<Record<ChargeId, ChargeDef>> = {
  eagle: { name: "eagle", plural: "eagles", category: "bird", attitudes: ["displayed"], armedTerm: "beaked and membered", accentDefault: "or", weight: 10, art: eagleDisplayed },
  raven: { name: "raven", plural: "ravens", category: "bird", attitudes: ["close"], armedTerm: "beaked and legged", accentDefault: "same", weight: 3, art: () => corvid("raven") },
  falcon: { name: "falcon", plural: "falcons", category: "bird", attitudes: ["close"], armedTerm: "belled and jessed", accentDefault: "or", weight: 3, art: falconClose },
  owl: { name: "owl", plural: "owls", category: "bird", armedTerm: "beaked and membered", accentDefault: "or", weight: 2, art: owl },
  swan: { name: "swan", plural: "swans", category: "bird", attitudes: ["rising"], armedTerm: "beaked and membered", accentDefault: "gules", weight: 2, art: swan },
  martlet: { name: "martlet", plural: "martlets", category: "bird", accentDefault: "same", weight: 5, art: martlet },
};

void curve; void ellipseD;
