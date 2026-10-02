/**
 * Works of hands and parts of the body: tower, castle, bridge, key, sword,
 * spear, axe, crown, wheel, ship, horn, hammer, anchor, bell, cup, hand,
 * heart, eye, feather.
 */
import type { ChargeId } from "../types";
import type { ChargeArt, ChargeDef } from "./art";
import { blob, circleD, curve, ellipseD, f, limb, mirrorX, polyD, smooth, type Pt, type SPt } from "../path";

/** Masonry joints inside a rectangle. */
function masonry(x0: number, y0: number, x1: number, y1: number, course = 8, brick = 12): string {
  let d = "";
  let row = 0;
  for (let y = y0 + course; y < y1 - 1; y += course, row++) {
    d += `M${f(x0 + 0.8)} ${f(y)}H${f(x1 - 0.8)}`;
  }
  row = 0;
  for (let y = y0; y < y1 - 1; y += course, row++) {
    const off = row % 2 ? brick / 2 : 0;
    for (let x = x0 + off + brick; x < x1 - 2; x += brick) d += `M${f(x)} ${f(y + 0.6)}V${f(Math.min(y1, y + course) - 0.6)}`;
  }
  return d;
}

/** n merlons spanning [x0, x1], tops at yTop, height h. */
function merlons(x0: number, x1: number, yTop: number, h: number, n: number): string {
  const w = (x1 - x0) / (n * 2 - 1);
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 2 * w;
    d += polyD([[x, yTop], [x + w, yTop], [x + w, yTop + h + 0.5], [x, yTop + h + 0.5]]);
  }
  return d;
}

function archD(x0: number, x1: number, yBottom: number, ySpring: number): string {
  const r = (x1 - x0) / 2;
  return `M${f(x0)} ${f(yBottom)}V${f(ySpring)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(ySpring)}V${f(yBottom)}Z`;
}

// ---------------------------------------------------------------------------

function tower(): ChargeArt {
  const body = polyD([[28, 26], [72, 26], [74, 96], [26, 96]]);
  const parapet = polyD([[21, 17], [79, 17], [79, 27], [21, 27]]);
  const m = merlons(21, 79, 5, 12.5, 3);
  const door = archD(42, 58, 96, 80);
  const windows = archD(47, 53, 52, 44) + archD(34.5, 39.5, 70, 63) + archD(60.5, 65.5, 70, 63);
  return {
    layers: [
      { role: "body", d: body + parapet + m },
      { role: "line", d: masonry(28, 27, 72, 96, 8.5, 11) + "M21 22H79", w: 0.9 },
      { role: "ink", d: door + windows },
    ],
  };
}

function castle(): ChargeArt {
  const keep = polyD([[36, 18], [64, 18], [64, 60], [36, 60]]) + merlons(35, 65, 8, 10.5, 3);
  const wall = polyD([[18, 54], [82, 54], [82, 96], [18, 96]]) + merlons(26, 74, 46, 8.5, 5);
  const towerL = polyD([[4, 36], [28, 36], [29, 96], [3, 96]]) + polyD([[2, 30], [30, 30], [30, 37], [2, 37]]) + merlons(2, 30, 20, 10.5, 3);
  const towerR = polyD(mirrorX([[4, 36], [28, 36], [29, 96], [3, 96]], 50) as Pt[]) + polyD([[70, 30], [98, 30], [98, 37], [70, 37]]) + merlons(70, 98, 20, 10.5, 3);
  const gate = archD(40, 60, 96, 76);
  const win = archD(47, 53, 40, 31) + archD(13.5, 18.5, 58, 50) + archD(81.5, 86.5, 58, 50) + archD(13.5, 18.5, 80, 72) + archD(81.5, 86.5, 80, 72);
  return {
    layers: [
      { role: "body", d: keep },
      { role: "line", d: masonry(36, 19, 64, 54, 7.5, 9), w: 0.85 },
      { role: "body", d: wall },
      { role: "line", d: masonry(29, 55, 71, 96, 8, 10), w: 0.85 },
      { role: "body", d: towerL + towerR },
      { role: "line", d: masonry(4, 37, 28, 96, 8, 9) + masonry(72, 37, 96, 96, 8, 9), w: 0.85 },
      { role: "ink", d: gate + win },
      { role: "line", d: "M44 77V96M50 75V96M56 77V96M40.5 84H59.5", w: 1 },
    ],
  };
}

function bridge(): ChargeArt {
  const arches: [number, number][] = [[10, 32], [39, 61], [68, 90]];
  let d = "M2 30H98V94";
  for (let i = arches.length - 1; i >= 0; i--) {
    const [a, b] = arches[i];
    const r = (b - a) / 2;
    d += `H${b}V72A${f(r)} ${f(r)} 0 0 0 ${a} 72V94`;
  }
  d += "H2Z";
  const m = merlons(2, 98, 20, 10.5, 7);
  let vous = "";
  for (const [a, b] of arches) {
    const cx = (a + b) / 2, r = (b - a) / 2;
    for (let k = 0; k <= 6; k++) {
      const t = Math.PI + (Math.PI * k) / 6;
      vous += `M${f(cx + Math.cos(t) * r)} ${f(72 + Math.sin(t) * r)}L${f(cx + Math.cos(t) * (r + 5.5))} ${f(72 + Math.sin(t) * (r + 5.5))}`;
    }
  }
  return {
    layers: [
      { role: "body", d: d + m },
      { role: "line", d: "M2 38H98M2 46H98" + vous + "M2 30.5H98", w: 0.9 },
    ],
  };
}

function key(): ChargeArt {
  const shaft = polyD([[46.5, 30], [53.5, 30], [53.5, 92], [46.5, 92]]) + circleD(50, 92.5, 3.6);
  const collar = smooth([[43, 33, 1], [57, 33, 1], [57, 38, 1], [43, 38, 1]], true) + smooth([[44, 66, 1], [56, 66, 1], [56, 69.5, 1], [44, 69.5, 1]], true);
  const bit = polyD([[53, 73], [73, 73], [73, 79], [66, 79], [66, 83], [73, 83], [73, 91], [53, 91]]);
  // Bow: a quatrefoil ring.
  const lobes: SPt[] = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const r = 15 + 2.6 * Math.cos(4 * t);
    lobes.push([50 + Math.cos(t) * r, 17 + Math.sin(t) * r * 0.95]);
  }
  const bow = smooth(lobes, true) + circleD(50, 17, 6.2);
  return {
    layers: [
      { role: "body", d: shaft + bit },
      { role: "body", d: collar },
      { role: "body", d: bow, evenodd: true },
      { role: "line", d: "M58 76H71M58 87H71", w: 0.9 },
    ],
  };
}

function sword(): ChargeArt {
  const blade = smooth([[50, 1, 1], [55, 13], [55.2, 66, 1], [44.8, 66, 1], [45, 13]], true);
  const guard = smooth([[24, 66.5], [37, 65], [50, 64.8], [63, 65], [76, 66.5], [77.5, 70, 1], [63, 71], [50, 71.2], [37, 71], [22.5, 70, 1]], true);
  const grip = smooth([[46.2, 71, 1], [53.8, 71, 1], [53, 88, 1], [47, 88, 1]], true);
  const pommel = circleD(50, 92.5, 5.8);
  return {
    layers: [
      { role: "body", d: blade },
      { role: "line", d: "M50 12V61", w: 1.3 },
      { role: "accent", d: grip },
      { role: "line", d: "M46.5 75L53.5 73.5M46.6 79L53.4 77.5M46.8 83L53.2 81.5M47 87L53 85.5", w: 0.9 },
      { role: "accent", d: guard + pommel },
      { role: "line", d: "M47 92.5H53", w: 0.9 },
    ],
  };
}

function spear(): ChargeArt {
  const head = smooth([[50, 1, 1], [56, 12], [57.5, 20], [54, 28], [52.6, 33, 1], [47.4, 33, 1], [46, 28], [42.5, 20], [44, 12]], true);
  const socket = smooth([[46, 32, 1], [54, 32, 1], [54.5, 38, 1], [45.5, 38, 1]], true);
  const lugs = smooth([[38, 42, 1], [62, 42, 1], [60, 45, 1], [40, 45, 1]], true);
  const shaft = limb([[50, 36, 5.2], [50, 97, 4.8]], { start: "flat", end: "round" });
  return {
    layers: [
      { role: "body", d: shaft },
      { role: "body", d: lugs },
      { role: "body", d: socket },
      { role: "body", d: head },
      { role: "line", d: "M50 6V30M47.8 60L50 57M47.8 70L50 67M47.8 80L50 77", w: 1.1 },
    ],
  };
}

function axe(): ChargeArt {
  const haft = limb([[57, 5, 6.4], [58, 50, 6.4], [57, 96, 5.6]], { start: "round", end: "round" });
  const blade = smooth(
    [
      [56, 13],
      [46, 11],
      [34, 6],
      [22, 2, 1],
      [15, 13],
      [11, 28],
      [13, 42],
      [21, 55, 1],
      [28, 46],
      [38, 39],
      [56, 36],
    ],
    true,
  );
  const spike = smooth([[58, 17], [70, 21], [80, 25, 1], [70, 28], [58, 32]], true);
  const top = smooth([[54.5, 7], [57, -2, 1], [59.5, 7]], true);
  return {
    layers: [
      { role: "body", d: haft },
      { role: "body", d: blade + spike + top },
      { role: "line", d: "M22 7C17 18 16 34 23 48M54 18C46 18 40 22 34 30", w: 1.1 },
      { role: "line", d: "M55 44L60 46M55 60L60 62M55 76L60 78", w: 0.9 },
    ],
  };
}

function crownCharge(): ChargeArt {
  const band = smooth(
    [
      [11, 60, 1],
      [30, 64.5],
      [50, 66],
      [70, 64.5],
      [89, 60, 1],
      [89, 82, 1],
      [70, 87],
      [50, 89],
      [30, 87],
      [11, 82, 1],
    ],
    true,
  );
  // strawberry leaf
  const leaf = (x: number, base: number, top: number, w: number): string => {
    const h = base - top;
    return (
      smooth([[x - w * 0.18, base + 2], [x - w * 0.22, base - h * 0.45], [x - w * 0.12, base - h * 0.75], [x, top, 1], [x + w * 0.12, base - h * 0.75], [x + w * 0.22, base - h * 0.45], [x + w * 0.18, base + 2]], true) +
      limb([[x - w * 0.1, base, w * 0.24], [x - w * 0.34, base - h * 0.42, w * 0.22], [x - w * 0.5, base - h * 0.34, w * 0.14], [x - w * 0.52, base - h * 0.16, 0.5]], { start: "round", end: "flat" }) +
      limb([[x + w * 0.1, base, w * 0.24], [x + w * 0.34, base - h * 0.42, w * 0.22], [x + w * 0.5, base - h * 0.34, w * 0.14], [x + w * 0.52, base - h * 0.16, 0.5]], { start: "round", end: "flat" })
    );
  };
  const leaves = leaf(50, 66, 18, 30) + leaf(19, 62, 33, 20) + leaf(81, 62, 33, 20);
  const pearls = limb([[35, 66, 3], [35, 45, 2.2]], { start: "flat", end: "flat" }) + limb([[65, 66, 3], [65, 45, 2.2]], { start: "flat", end: "flat" }) + circleD(35, 42, 4.3) + circleD(65, 42, 4.3);
  const jewels = smooth([[50, 70.5, 1], [55, 77, 1], [50, 83.5, 1], [45, 77, 1]], true) + ellipseD(31, 75.5, 4.2, 5.2) + ellipseD(69, 75.5, 4.2, 5.2) + ellipseD(16, 71.8, 2.4, 4.2) + ellipseD(84, 71.8, 2.4, 4.2);
  return {
    layers: [
      { role: "body", d: leaves + pearls },
      { role: "body", d: band },
      { role: "line", d: "M12 65Q50 72 88 65M12 78Q50 86 88 78", w: 1 },
      { role: "ink", d: jewels },
      { role: "shine", d: ellipseD(30, 74, 1.5, 2) + ellipseD(68, 74, 1.5, 2) + ellipseD(49, 75.5, 1.4, 1.8) },
    ],
  };
}

function wheel(): ChargeArt {
  let spokes = "";
  for (let i = 0; i < 8; i++) {
    const t = (i * Math.PI) / 4 + Math.PI / 8;
    const ux = Math.cos(t), uy = Math.sin(t);
    spokes += limb([[50 + ux * 8, 50 + uy * 8, 6.2], [50 + ux * 40, 50 + uy * 40, 4.8]], { start: "flat", end: "flat" });
  }
  let nails = "";
  for (let i = 0; i < 8; i++) {
    const t = (i * Math.PI) / 4 + Math.PI / 8;
    nails += circleD(50 + Math.cos(t) * 42, 50 + Math.sin(t) * 42, 1.3);
  }
  return {
    layers: [
      { role: "body", d: spokes },
      { role: "body", d: circleD(50, 50, 47) + circleD(50, 50, 37.5), evenodd: true },
      { role: "body", d: circleD(50, 50, 11.5) + circleD(50, 50, 3.8), evenodd: true },
      { role: "ink", d: nails },
      { role: "line", d: circleD(50, 50, 8), w: 0.9 },
    ],
  };
}

function ship(): ChargeArt {
  const hull = smooth(
    [
      [5, 47, 1],
      [12, 58],
      [24, 63],
      [50, 64.5],
      [76, 63],
      [88, 57],
      [95, 45, 1],
      [93, 58],
      [87, 69],
      [73, 79],
      [50, 83],
      [27, 79],
      [13, 69],
      [7, 58],
    ],
    true,
  );
  const posts = limb([[8, 52, 4], [4, 42, 3.4], [6, 34, 2.6], [11, 33, 1.6]], { end: "round" }) + limb([[92, 50, 4], [96, 40, 3.4], [94, 32, 2.6], [89, 31, 1.6]], { end: "round" });
  const mast = limb([[50, 66, 3.8], [50, 7, 3]], { start: "flat", end: "round" });
  const yard = limb([[23, 15, 2.8], [50, 13.5, 3], [77, 15, 2.8]], { start: "round", end: "round" });
  const sail = smooth([[25, 16, 1], [75, 16, 1], [79, 34], [77, 54, 1], [50, 58], [23, 54, 1], [21, 34]], true);
  const pennon = smooth([[51, 3, 1], [70, 4.5], [64, 8.2, 1], [72, 12, 1], [51, 11, 1]], true);
  let oars = "";
  for (const x of [26, 40, 54, 68]) oars += limb([[x + 2, 72, 2.6], [x - 9, 96, 2.2]], { start: "flat", end: "round" });
  return {
    layers: [
      { role: "body", d: oars },
      { role: "body", d: mast + pennon },
      { role: "body", d: sail },
      { role: "line", d: "M37 17C38.5 30 38.5 44 37 56M50 17V57.5M63 17C61.5 30 61.5 44 63 56M23 35.5Q50 40 79 35.5", w: 1 },
      { role: "body", d: yard },
      { role: "body", d: posts + hull },
      { role: "line", d: "M11 64Q50 74 89 64M17 71Q50 80 83 71", w: 1 },
      { role: "ink", d: circleD(30, 68, 1.6) + circleD(42, 70, 1.6) + circleD(58, 70, 1.6) + circleD(70, 68, 1.6) },
    ],
  };
}

function horn(): ChargeArt {
  const string = limb([[24, 56, 2.6], [22, 34, 2.6], [32, 18, 2.6], [50, 13, 2.6], [67, 19, 2.6], [74, 34, 2.6], [70, 52, 2.6]], { start: "round", end: "round" });
  const tassels = smooth([[48, 13, 1], [52, 13, 1], [54, 22], [50, 26, 1], [46, 22]], true);
  const bodyD = limb(
    [
      [10, 40, 4.4],
      [15, 52, 6],
      [26, 62, 8.5],
      [42, 67, 11],
      [58, 64, 14],
      [71, 55, 17.5],
      [80, 43, 21.5],
      [84, 34, 25],
    ],
    { start: "flat", end: "flat" },
  );
  const mouth = ellipseD(84.8, 32.2, 6, 13.6, -55);
  const piece = smooth([[6.5, 36, 1], [13.5, 36, 1], [12.5, 41, 1], [7.5, 41, 1]], true);
  const virols = limb([[20, 52, 6.2], [25, 61, 6.6]], { start: "flat", end: "flat", perSeg: 1 }) +
    limb([[45, 61, 7.4], [47, 72, 7.4]], { start: "flat", end: "flat", perSeg: 1 }) +
    limb([[64, 52, 7.6], [72, 64, 7.6]], { start: "flat", end: "flat", perSeg: 1 });
  return {
    layers: [
      { role: "body", d: string + tassels },
      { role: "body", d: bodyD + piece },
      { role: "body", d: mouth },
      { role: "shade", d: ellipseD(85.6, 31.6, 3.6, 10, -55) },
      { role: "accent", d: virols },
    ],
  };
}

function hammer(): ChargeArt {
  const head = smooth(
    [
      [12, 6, 1],
      [30, 6, 1],
      [32, 10],
      [62, 11],
      [86, 14, 1],
      [86, 19, 1],
      [62, 22],
      [32, 23],
      [30, 27, 1],
      [12, 27, 1],
    ],
    true,
  );
  const handle = limb([[50, 20, 8.6], [50, 60, 8], [50, 96, 7.4]], { start: "flat", end: "round" });
  return {
    layers: [
      { role: "body", d: handle },
      { role: "line", d: "M48 34C47 50 49 66 48 84M52 40C53 56 51 72 52 90", w: 0.9 },
      { role: "body", d: head },
      { role: "line", d: "M30 9V24M46 12V21", w: 1 },
    ],
  };
}

function anchor(): ChargeArt {
  const ring = circleD(50, 10, 8) + circleD(50, 10, 4.4);
  const stock = smooth([[23, 22, 1], [77, 22, 1], [77, 28.5, 1], [23, 28.5, 1]], true) + circleD(22, 25.2, 4.6) + circleD(78, 25.2, 4.6);
  const shank = polyD([[46, 16], [54, 16], [54.5, 84], [45.5, 84]]);
  const arms = limb(
    [
      [17, 60, 5.6],
      [20, 72, 6.4],
      [30, 84, 7.4],
      [50, 90, 8.6],
      [70, 84, 7.4],
      [80, 72, 6.4],
      [83, 60, 5.6],
    ],
    { start: "flat", end: "flat" },
  );
  const flukeL = smooth([[9, 67, 1], [13, 47, 1], [26, 64, 1], [19, 62]], true);
  const flukeR = smooth(mirrorX([[9, 67, 1], [13, 47, 1], [26, 64, 1], [19, 62]], 50), true);
  const crown = smooth([[44, 89], [50, 99, 1], [56, 89]], true);
  return {
    layers: [
      { role: "body", d: shank + arms + flukeL + flukeR + crown },
      { role: "body", d: stock },
      { role: "body", d: ring, evenodd: true },
    ],
  };
}

function bell(): ChargeArt {
  const crownLoop = smooth([[42, 13], [42, 6], [46, 2], [54, 2], [58, 6], [58, 13]], false) ;
  void crownLoop;
  const loop = circleD(50, 7.5, 6.6) + circleD(50, 7.5, 3.2);
  const body = smooth(
    [
      [50, 11],
      [62, 13],
      [69, 21],
      [71, 37],
      [74, 56],
      [81, 71],
      [91, 80],
      [92, 86, 1],
      [50, 88],
      [8, 86, 1],
      [9, 80],
      [19, 71],
      [26, 56],
      [29, 37],
      [31, 21],
      [38, 13],
    ],
    true,
  );
  return {
    layers: [
      { role: "body", d: loop, evenodd: true },
      { role: "body", d: circleD(50, 91, 5.6) },
      { role: "body", d: body },
      { role: "line", d: "M29.5 29Q50 33 70.5 29M28.5 35Q50 39 71.5 35M14 77Q50 84 86 77M11 81.5Q50 88.5 89 81.5", w: 1.05 },
      { role: "shine", d: "M37 20C33 34 32 52 27 68C30 66 33 62 35 56C37 44 37 30 41 19Z" },
    ],
  };
}

function cup(): ChargeArt {
  const finial = circleD(50, 7.5, 4.6) + polyD([[48, 11], [52, 11], [52.5, 16], [47.5, 16]]);
  const lid = smooth([[26, 31, 1], [33, 21], [42, 16.5], [50, 15.5], [58, 16.5], [67, 21], [74, 31, 1]], true);
  const rim = smooth([[24, 30, 1], [76, 30, 1], [76, 35, 1], [24, 35, 1]], true);
  const bowl = smooth([[27, 35, 1], [73, 35, 1], [72, 47], [66, 58], [57, 64], [43, 64], [34, 58], [28, 47]], true);
  const stem = polyD([[46, 62], [54, 62], [53.5, 88], [46.5, 88]]) + ellipseD(50, 75, 7.6, 4.4);
  const foot = smooth([[44, 86, 1], [56, 86, 1], [66, 92], [68, 96, 1], [32, 96, 1], [34, 92]], true);
  return {
    layers: [
      { role: "body", d: stem + foot },
      { role: "body", d: bowl },
      { role: "line", d: "M29 44Q50 49 71 44M33 55Q50 60 67 55", w: 1.05 },
      { role: "body", d: lid + finial },
      { role: "line", d: "M35 25Q50 21 65 25", w: 1 },
      { role: "body", d: rim },
      { role: "shine", d: "M35 38C33 44 34 52 39 58C39 52 38 45 39 38Z" },
    ],
  };
}

function hand(): ChargeArt {
  const palm = smooth([[33, 96, 1], [67, 96, 1], [68, 82], [70, 66], [69, 52], [60, 47], [44, 46], [33, 50], [30, 64], [31, 80]], true);
  const finger = (x0: number, y0: number, x1: number, y1: number, w: number) =>
    limb([[x0, y0, w], [(x0 * 2 + x1) / 3, (y0 * 2 + y1) / 3, w * 0.98], [x1, y1, w * 0.86]], { start: "round", end: "round" });
  const fingers =
    finger(38.5, 52, 33.5, 13, 10.4) + finger(48.5, 50, 47.5, 5.5, 10.6) + finger(58.5, 50, 61.5, 9, 10.2) + finger(66.5, 56, 73.5, 22, 9.4);
  const thumb = limb([[35, 76, 13], [27, 66, 11.5], [19, 55, 10.4], [13.5, 45.5, 9.4]], { start: "round", end: "round" });
  const lines =
    "M30.5 30Q34.5 31.8 38.5 29.6M31.5 20Q35 21.5 38 19.6M42.8 26Q47.6 27.8 52.4 25.6M43.2 15Q47.6 16.6 52 14.8" +
    "M56.4 28Q61 29.4 65.8 27M57 18.2Q61 19.4 65 17.4M68.2 39Q72.6 40.4 76 38M67.4 31Q71 31.8 74.6 29.8" +
    "M17.5 58Q21 61 24.5 58.5M41 64C44 72 47 80 46 92M58 59C52 62 46 66 42 72M64 66C58 70 52 74 48 80";
  return {
    layers: [
      { role: "body", d: fingers + thumb + palm },
      { role: "line", d: lines, w: 1.1 },
      { role: "line", d: "M33.5 92H66.5", w: 1.1 },
    ],
  };
}

function heart(): ChargeArt {
  return {
    layers: [
      { role: "body", d: "M50 93C40 83 7 61 6 36C5 18 17 7 30 7C40 7 47 13 50 22C53 13 60 7 70 7C83 7 95 18 94 36C93 61 60 83 50 93Z" },
      { role: "shine", d: "M20 22C16 28 16 38 20 46C21 38 23 31 28 25C26 23 23 21 20 22Z" },
    ],
  };
}

function eye(): ChargeArt {
  const almond = smooth([[3, 54, 1], [18, 40], [34, 33.5], [50, 32], [66, 33.5], [82, 40], [97, 54, 1], [82, 64], [66, 70], [50, 72], [34, 70], [18, 64]], true);
  const brow = smooth([[8, 30, 1], [24, 18], [42, 12], [60, 12.5], [78, 18], [93, 29, 1], [78, 24], [60, 19], [42, 19], [24, 23.5]], true);
  let lashes = "";
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const x = 14 + t * 72;
    const y = 54 - Math.sin(Math.PI * t) * 21;
    const dx = (x - 50) * 0.16;
    lashes += `M${f(x)} ${f(y)}L${f(x + dx)} ${f(y - 6)}`;
  }
  return {
    layers: [
      { role: "body", d: brow },
      { role: "body", d: almond },
      { role: "shade", d: circleD(50, 51, 17) },
      { role: "line", d: circleD(50, 51, 17) + lashes, w: 1.3 },
      { role: "ink", d: circleD(50, 51, 7.5) },
      { role: "shine", d: circleD(45.5, 46.5, 3) },
    ],
  };
}

function feather(): ChargeArt {
  const vane = smooth(
    [
      [49, 78],
      [58, 73],
      [66, 61],
      [71, 46],
      [72, 31],
      [67, 17],
      [58, 7],
      [48, 2, 1],
      [43, 10],
      [38, 22],
      [35, 33, 1],
      [39, 34.5],
      [35.5, 42],
      [34.5, 54],
      [36.5, 63, 1],
      [40, 63],
      [41, 70],
      [45, 76],
    ],
    true,
  );
  const quill = limb([[49, 74, 3.6], [50.5, 86, 3], [52, 97, 1.6]], { start: "flat", end: "round" });
  let barbs = "";
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const y = 72 - t * 62;
    const x = 49 - Math.sin(t * 2.6) * 1.5 + t * -1;
    barbs += `M${f(x)} ${f(y)}Q${f(x + 10)} ${f(y - 5)} ${f(x + 18 - t * 4)} ${f(y - 11 + t * 2)}`;
    if (i > 0 && i < 8) barbs += `M${f(x)} ${f(y)}Q${f(x - 6)} ${f(y - 4)} ${f(x - 10 + t * 2)} ${f(y - 9)}`;
  }
  return {
    layers: [
      { role: "body", d: quill },
      { role: "body", d: vane },
      { role: "line", d: curve([[50, 90], [49, 70], [48, 45], [47.5, 25], [48, 6]]), w: 1.5 },
      { role: "line", d: barbs, w: 0.9 },
    ],
  };
}

export const OBJECTS: Partial<Record<ChargeId, ChargeDef>> = {
  tower: { name: "tower", plural: "towers", category: "building", symmetric: true, weight: 4, art: tower },
  castle: { name: "castle", plural: "castles", category: "building", symmetric: true, weight: 4, art: castle },
  bridge: { name: "bridge of three arches", plural: "bridges of three arches", category: "building", symmetric: true, weight: 1, art: bridge },
  key: { name: "key", plural: "keys", category: "object", long: true, weight: 3, art: key },
  sword: { name: "sword", plural: "swords", category: "weapon", symmetric: true, long: true, armedTerm: "hilted and pommelled", accentDefault: "same", weight: 4, art: sword },
  spear: { name: "spear", plural: "spears", category: "weapon", symmetric: true, long: true, weight: 2, art: spear },
  axe: { name: "battle-axe", plural: "battle-axes", category: "weapon", long: true, weight: 2, art: axe },
  crown: { name: "crown", plural: "crowns", category: "object", symmetric: true, weight: 4, art: crownCharge },
  wheel: { name: "wheel", plural: "wheels", category: "object", symmetric: true, weight: 2, art: wheel },
  ship: { name: "ship", plural: "ships", category: "object", weight: 2, art: ship },
  horn: { name: "hunting horn", plural: "hunting horns", category: "object", armedTerm: "garnished", accentDefault: "same", weight: 2, art: horn },
  hammer: { name: "hammer", plural: "hammers", category: "object", long: true, weight: 1, art: hammer },
  anchor: { name: "anchor", plural: "anchors", category: "object", symmetric: true, weight: 2, art: anchor },
  bell: { name: "bell", plural: "bells", category: "object", symmetric: true, weight: 1, art: bell },
  cup: { name: "covered cup", plural: "covered cups", category: "object", symmetric: true, weight: 2, art: cup },
  hand: { name: "dexter hand appaumy", plural: "dexter hands appaumy", category: "body", weight: 1, art: hand },
  heart: { name: "heart", plural: "hearts", category: "body", symmetric: true, weight: 2, art: heart },
  eye: { name: "eye", plural: "eyes", category: "body", symmetric: true, weight: 1, art: eye },
  feather: { name: "feather", plural: "feathers", category: "nature", weight: 1, art: feather },
};

void blob;
