/**
 * Geometric and classic small charges: mullet, estoile, crescent, roundel,
 * annulet, lozenge, fusil, mascle, billet, goutte, escutcheon, fleur-de-lis,
 * escallop, martlet-free foils (cinquefoil, quatrefoil, trefoil), pheon, and
 * the family of crosses.
 */
import type { ChargeArt } from "./art";
import { blob, circleD, curve, f, limb, mirrorX, polyD, rotPts, smooth, type Pt, type SPt } from "../path";

const C = 50;

export function starPoints(n: number, R: number, r: number, cx = C, cy = C, rot = -90): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 === 0 ? R : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

export function mullet(points = 5, pierced = false): ChargeArt {
  const n = Math.max(4, Math.min(8, points));
  const ratio = n === 5 ? 0.4 : n === 6 ? 0.5 : n === 4 ? 0.36 : 0.56;
  let d = polyD(starPoints(n, 50, 50 * ratio));
  if (pierced) d += circleD(C, C, 50 * ratio * 0.55);
  const layers: ChargeArt["layers"] = [{ role: "body", d, evenodd: pierced }];
  // Bevel lines: from centre to each outer point — gives the "faceted" look of painted mullets.
  if (!pierced) {
    const pts = starPoints(n, 50, 50 * ratio);
    let l = "";
    for (let i = 0; i < pts.length; i += 2) l += `M${C} ${C}L${f(C + (pts[i][0] - C) * 0.82)} ${f(C + (pts[i][1] - C) * 0.82)}`;
    layers.push({ role: "line", d: l, w: 1.1 });
  }
  return { layers };
}

/** Estoile: a star of six (or more) wavy rays. */
export function estoile(points = 6): ChargeArt {
  const n = Math.max(5, Math.min(12, points));
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    const ux = Math.cos(a), uy = Math.sin(a);
    const nx = -uy, ny = ux;
    const L = i % 2 === 0 || n < 8 ? 50 : 40;
    const sp: [number, number, number][] = [];
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const off = [0, 3.2, -3.4, 3.4, -1.8, 0];
    const wid = [19, 15, 11.5, 8, 4.2, 0.3];
    for (let k = 0; k < steps.length; k++) {
      const r = steps[k] * L;
      sp.push([C + ux * r + nx * off[k], C + uy * r + ny * off[k], wid[k]]);
    }
    d += limb(sp, { start: "round", end: "flat" });
  }
  d += circleD(C, C, 11);
  return { layers: [{ role: "body", d }] };
}

/** Circle–circle crescent, horns upward. */
export function crescentPath(cx: number, cy: number, R: number, thick = 0.24): string {
  const r = R * 0.86;
  const dd = R * thick + (R - r);
  const c2y = cy - dd;
  const a = (R * R - r * r + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const iy = cy - a;
  const x1 = cx - h, x2 = cx + h;
  void c2y;
  return `M${f(x1)} ${f(iy)}A${f(R)} ${f(R)} 0 1 0 ${f(x2)} ${f(iy)}A${f(r)} ${f(r)} 0 1 1 ${f(x1)} ${f(iy)}Z`;
}

export function crescent(): ChargeArt {
  return { layers: [{ role: "body", d: crescentPath(C, 56, 42, 0.26) }] };
}

export const roundel = (): ChargeArt => ({
  layers: [{ role: "body", d: circleD(C, C, 46) }],
});

export const annulet = (): ChargeArt => ({
  layers: [{ role: "body", d: circleD(C, C, 46) + circleD(C, C, 31), evenodd: true }],
});

export const lozenge = (): ChargeArt => ({
  layers: [{ role: "body", d: polyD([[50, 2], [84, 50], [50, 98], [16, 50]]) }],
});
export const fusil = (): ChargeArt => ({
  layers: [{ role: "body", d: polyD([[50, 0], [72, 50], [50, 100], [28, 50]]) }],
});
export const mascle = (): ChargeArt => ({
  layers: [
    {
      role: "body",
      d: polyD([[50, 2], [84, 50], [50, 98], [16, 50]]) + polyD([[50, 22], [69.5, 50], [50, 78], [30.5, 50]]),
      evenodd: true,
    },
  ],
});
export const billet = (): ChargeArt => ({
  layers: [{ role: "body", d: polyD([[29, 6], [71, 6], [71, 94], [29, 94]]) }],
});

export const goutte = (): ChargeArt => ({
  layers: [
    {
      role: "body",
      d: "M50 2C51 18 55 30 63 42C71 54 76 61 76 71A26 26 0 0 1 24 71C24 61 29 54 37 42C45 30 49 18 50 2Z",
    },
    { role: "shine", d: "M38 66C38 58 42 52 46 47C44 55 43 62 45 72C42 72 38 70 38 66Z" },
  ],
});

export const ESCUTCHEON_D = "M8 6H92V46C92 72 74 88 50 97C26 88 8 72 8 46Z";
export const escutcheon = (): ChargeArt => ({ layers: [{ role: "body", d: ESCUTCHEON_D }] });

// ---------------------------------------------------------------------------
// Fleur-de-lis

export function fleurDeLis(): ChargeArt {
  // Central petal: a lance-shaped leaf with a swelling belly.
  const centre = "M43.5 58C37 47 37.5 33 42 23C44.5 16.5 47.5 10 50 3C52.5 10 55.5 16.5 58 23C62.5 33 63 47 56.5 58Z";
  // Side petal (dexter): springs from the band, arches up and outward, then curls down to a point.
  const side: [number, number, number][] = [
    [41.5, 62, 14],
    [37.5, 48, 15.5],
    [31, 36.5, 15],
    [22, 29.5, 13.5],
    [12.5, 30.5, 10.5],
    [6.5, 37.5, 7.6],
    [5.5, 46, 4.6],
    [9, 52, 1.8],
    [13, 53.5, 0.2],
  ];
  const sideD = limb(side, { start: "flat", end: "flat" });
  const sideMirror = limb(side.map(([x, y, w]) => [100 - x, y, w] as [number, number, number]), { start: "flat", end: "flat" });
  // Lower lobes beneath the band.
  const footC = "M44 68H56C56 76 53.5 83 50 92C46.5 83 44 76 44 68Z";
  const lowSide: [number, number, number][] = [
    [43.5, 66, 11],
    [38, 72.5, 9.5],
    [31, 77, 7],
    [24.5, 76.5, 4],
    [21, 72.5, 1.2],
    [21.5, 69.5, 0.2],
  ];
  const lowD = limb(lowSide, { start: "flat", end: "flat" });
  const lowM = limb(lowSide.map(([x, y, w]) => [100 - x, y, w] as [number, number, number]), { start: "flat", end: "flat" });
  const band = "M29 56.5H71Q74.5 56.5 74.5 60V65.5Q74.5 69 71 69H29Q25.5 69 25.5 65.5V60Q25.5 56.5 29 56.5Z";
  return {
    layers: [
      { role: "body", d: sideD + sideMirror + lowD + lowM + footC },
      { role: "body", d: centre },
      { role: "body", d: band },
      {
        role: "line",
        d: "M50 12C48.5 26 48 42 49.5 55M35 42C31 36 24.5 34 17.5 36.5M29.5 62.5H70.5",
        w: 1.1,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Escallop (hinge in chief, as in English heraldry)

export function escallop(): ChargeArt {
  const lobes = 11;
  const hx = 50, hy = 17;
  const rx = 47, ry = 78;
  const th0 = (166 * Math.PI) / 180, th1 = (14 * Math.PI) / 180;
  const rim: Pt[] = [];
  for (let i = 0; i <= lobes; i++) {
    const t = th0 + ((th1 - th0) * i) / lobes;
    rim.push([hx + rx * Math.cos(t), hy + ry * Math.sin(t)]);
  }
  let d = `M${hx - 7} ${hy + 6}L${f(rim[0][0])} ${f(rim[0][1])}`;
  for (let i = 0; i < lobes; i++) {
    const p = rim[i], q = rim[i + 1];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const dx = mx - hx, dy = my - hy;
    const L = Math.hypot(dx, dy);
    d += `Q${f(mx + (dx / L) * 9)} ${f(my + (dy / L) * 9)} ${f(q[0])} ${f(q[1])}`;
  }
  d += `L${hx + 7} ${hy + 6}Z`;
  const ears = "M27 9.5H73L64 26H36Z";
  let ribs = "";
  for (let i = 1; i < lobes; i++) {
    const p = rim[i];
    const sx = hx + (p[0] - hx) * 0.1, sy = hy + 9;
    ribs += curve([[sx, sy], [hx + (p[0] - hx) * 0.55, hy + (p[1] - hy) * 0.55], [p[0] - (p[0] - hx) * 0.02, p[1] - 1.5]]);
  }
  return {
    layers: [
      { role: "body", d },
      { role: "body", d: ears },
      { role: "line", d: ribs, w: 1.35 },
      { role: "line", d: "M35 12.5L39 23M65 12.5L61 23", w: 1.1 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Foils

function foil(n: number, slipped: boolean): ChargeArt {
  const R = n === 3 ? 21 : n === 4 ? 21.5 : 19;
  const dist = n === 3 ? 22 : n === 4 ? 27 : 29;
  const cy = n === 3 ? 41 : 50;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
    const px = C + Math.cos(a) * dist, py = cy + Math.sin(a) * dist;
    // A petal: round with a gently pointed tip.
    const pts: SPt[] = [];
    const N = 16;
    for (let k = 0; k < N; k++) {
      const t = (k / N) * Math.PI * 2;
      const tipness = Math.max(0, Math.cos(t)) ** 6;
      const rr = R * (1 + 0.16 * tipness);
      pts.push([px + Math.cos(a + t) * rr, py + Math.sin(a + t) * rr]);
    }
    d += blob(pts);
  }
  const layers: ChargeArt["layers"] = [];
  if (slipped) {
    layers.push({ role: "body", d: limb([[50, 50, 7], [52, 70, 6.2], [57, 86, 5], [63, 96, 4]], { end: "round" }) });
  }
  layers.push({ role: "body", d: d + (n === 3 ? "" : circleD(C, cy, dist - R * 0.3)) });
  if (n === 3) {
    layers.push({ role: "line", d: "M50 38L50 25M48 42L38 48M52 42L62 48", w: 1.2 });
  } else {
    // pierced: a hole ringed by its own outline
    layers.push({ role: "body", d: circleD(C, cy, 11) + circleD(C, cy, 6.5), evenodd: true });
  }
  return { layers };
}
export const cinquefoil = (): ChargeArt => foil(5, false);
export const quatrefoil = (): ChargeArt => foil(4, false);
export const trefoil = (): ChargeArt => foil(3, true);

// ---------------------------------------------------------------------------
// Pheon (arrowhead, point downward, inner edges engrailed)

export function pheon(): ChargeArt {
  const left: SPt[] = [
    [50, 98, 1],
    [6, 26, 1],
    [21, 22, 1],
  ];
  // engrailed inner edge from the barb tip toward the socket
  const inner: SPt[] = [];
  const P0: Pt = [21, 22], P1: Pt = [44, 46];
  const k = 3;
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    inner.push([P0[0] + (P1[0] - P0[0]) * t, P0[1] + (P1[1] - P0[1]) * t, 1]);
  }
  let d = `M50 98L6 26L21 22`;
  for (let i = 1; i < inner.length; i++) {
    const a = inner[i - 1], b = inner[i];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    d += `Q${f(mx + 4)} ${f(my - 5)} ${f(b[0])} ${f(b[1])}`;
  }
  d += `L44 2H56L56 46`;
  const innerR = mirrorX(inner, 50).reverse();
  for (let i = 1; i < innerR.length; i++) {
    const a = innerR[i - 1], b = innerR[i];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    d += `Q${f(mx - 4)} ${f(my - 5)} ${f(b[0])} ${f(b[1])}`;
  }
  d += `L94 26Z`;
  void left;
  return {
    layers: [
      { role: "body", d },
      { role: "line", d: "M50 90L50 50M44 10H56", w: 1.2 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Crosses

function fourWay(arm: SPt[] | string, cx = C, cy = C): string {
  if (typeof arm === "string") throw new Error("fourWay expects points");
  let d = "";
  for (let i = 0; i < 4; i++) d += polyD(rotPts(arm, i * 90, cx, cy) as Pt[]);
  return d;
}
function fourWaySmooth(arm: SPt[], cx = C, cy = C): string {
  let d = "";
  for (let i = 0; i < 4; i++) d += smooth(rotPts(arm, i * 90, cx, cy), true);
  return d;
}

export function crossCouped(): ChargeArt {
  const w = 13;
  return {
    layers: [{ role: "body", d: polyD([[50 - w, 4], [50 + w, 4], [50 + w, 50 - w], [96, 50 - w], [96, 50 + w], [50 + w, 50 + w], [50 + w, 96], [50 - w, 96], [50 - w, 50 + w], [4, 50 + w], [4, 50 - w], [50 - w, 50 - w]]) }],
  };
}

export function crossPatty(): ChargeArt {
  // One arm (pointing up) with concave flanks.
  let d = "";
  for (let i = 0; i < 4; i++) {
    const arm: SPt[] = [
      [43, 50, 1],
      [41.5, 30],
      [35, 14],
      [25, 3, 1],
      [75, 3, 1],
      [65, 14],
      [58.5, 30],
      [57, 50, 1],
    ];
    d += smooth(rotPts(arm, i * 90, C, C), true);
  }
  return { layers: [{ role: "body", d }] };
}

export function crossCrosslet(): ChargeArt {
  const w = 7;
  const arm: SPt[] = [
    [50 - w, 50],
    [50 - w, 30],
    [50 - 17, 30],
    [50 - 17, 30 - 2 * w],
    [50 - w, 30 - 2 * w],
    [50 - w, 3],
    [50 + w, 3],
    [50 + w, 30 - 2 * w],
    [50 + 17, 30 - 2 * w],
    [50 + 17, 30],
    [50 + w, 30],
    [50 + w, 50],
  ];
  return { layers: [{ role: "body", d: fourWay(arm) }] };
}

export function crossPotent(): ChargeArt {
  const w = 8;
  const arm: SPt[] = [
    [50 - w, 50],
    [50 - w, 17],
    [50 - 22, 17],
    [50 - 22, 3],
    [50 + 22, 3],
    [50 + 22, 17],
    [50 + w, 17],
    [50 + w, 50],
  ];
  return { layers: [{ role: "body", d: fourWay(arm) }] };
}

export function crossMoline(): ChargeArt {
  let d = "";
  for (let i = 0; i < 4; i++) {
    const r = (sp: [number, number, number][]) =>
      sp.map(([x, y, w]) => {
        const q = rotPts([[x, y]], i * 90, C, C)[0];
        return [q[0], q[1], w] as [number, number, number];
      });
    d += polyD(rotPts([[43, 50], [43, 22], [57, 22], [57, 50]], i * 90, C, C) as Pt[]);
    const flukeL: [number, number, number][] = [
      [47.5, 24, 11],
      [44, 13, 10],
      [37.5, 6.5, 8.6],
      [30.5, 6.5, 7],
      [26.5, 11, 4.6],
      [27.2, 16, 1.4],
      [29.6, 17.4, 0.2],
    ];
    const flukeR = flukeL.map(([x, y, w]) => [100 - x, y, w] as [number, number, number]);
    d += limb(r(flukeL), { start: "round", end: "flat" }) + limb(r(flukeR), { start: "round", end: "flat" });
  }
  return { layers: [{ role: "body", d }] };
}

export function crossFlory(): ChargeArt {
  let d = "";
  for (let i = 0; i < 4; i++) {
    const r = (pts: SPt[]) => rotPts(pts, i * 90, C, C);
    // Stem, flaring slightly
    d += smooth(r([[44, 50, 1], [44.5, 30], [46, 22, 1], [54, 22, 1], [55.5, 30], [56, 50, 1]]), true);
    // Central petal of the fleur
    d += smooth(r([[45, 24, 1], [44, 15], [50, 2, 1], [56, 15], [55, 24, 1]]), true);
    // Side petals
    const sp: [number, number, number][] = [[46, 23, 7], [39, 17, 6.5], [32, 15.5, 5], [28, 19, 2.6], [30, 23, 0.3]];
    const rr = (s: [number, number, number][]) => s.map(([x, y, w]) => { const q = r([[x, y]])[0]; return [q[0], q[1], w] as [number, number, number]; });
    d += limb(rr(sp), { start: "round", end: "flat" });
    d += limb(rr(sp.map(([x, y, w]) => [100 - x, y, w] as [number, number, number])), { start: "round", end: "flat" });
    // band
    d += polyD(r([[40, 23], [60, 23], [60, 28.5], [40, 28.5]]) as Pt[]);
  }
  return { layers: [{ role: "body", d }] };
}

export { fourWaySmooth };
