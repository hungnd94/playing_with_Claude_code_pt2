/**
 * Seals and medallions: a device (a charge, a shield of arms engraved with
 * hatching, or a mon) in a field ringed by a legend, impressed in wax, cast
 * in metal, or stamped in vermilion ink.
 *
 * The relief is built once as a mask (white = raised) and then lit three
 * times — shadow, highlight, body — to give the impression depth.
 */
import type { Rng } from "../core/rng";
import { hashString } from "../core/rng";
import type { Tincture } from "../world/concepts";
import type { Arms, Attitude, ChargeId, ShieldShape } from "./types";
import { CHARGES, chargeArt, chargeDef } from "./charges/index";
import { paintCharge } from "./charges/paint";
import { autoId, defsMarkup, mix, uid, type Ctx } from "./ctx";
import { circleD, f, polyD, samplePath, type Pt } from "./path";
import { fitScale } from "./place";
import { renderCoat } from "./render";
import { SHAPES, shapeFrame } from "./shapes";
import { ILLUMINATED } from "./tinctures";
import { describeMon, generateMon, monMarkup, type Mon } from "./mon";
import { blazon } from "./blazon";

export const SEAL_SHAPES = ["round", "vesica", "square"] as const;
export type SealShape = (typeof SEAL_SHAPES)[number];

export const SEAL_MATERIALS = ["redWax", "greenWax", "brownWax", "blackWax", "bronze", "gold", "lead", "vermilion"] as const;
export type SealMaterial = (typeof SEAL_MATERIALS)[number];

export type SealDevice =
  | { kind: "charge"; charge: ChargeId; attitude?: Attitude; count?: number }
  | { kind: "arms"; arms: Arms; shape?: ShieldShape }
  | { kind: "mon"; mon: Mon };

export interface Seal {
  shape: SealShape;
  material: SealMaterial;
  device: SealDevice;
  /** The legend round the border (rendered in capitals). Absent → an ornamental border. */
  legend?: string;
  /** Border between legend and field. */
  border: "beaded" | "plain" | "cabled";
  /** Field behind the device. */
  field: "plain" | "diaper" | "stars" | "sprigs";
}

interface MaterialPaint {
  base: string;
  light: string;
  dark: string;
  /** Wax overflows its impression as an irregular blob; metal and ink do not. */
  kind: "wax" | "metal" | "ink";
}

const MATERIALS: Record<SealMaterial, MaterialPaint> = {
  redWax: { base: "#a3221c", light: "#d4554a", dark: "#5a0f0c", kind: "wax" },
  greenWax: { base: "#2f5a2b", light: "#5f8f4f", dark: "#152b13", kind: "wax" },
  brownWax: { base: "#7b4a22", light: "#b07a45", dark: "#3d220c", kind: "wax" },
  blackWax: { base: "#2a2522", light: "#5d5650", dark: "#0d0b0a", kind: "wax" },
  bronze: { base: "#9a6a35", light: "#e2b77a", dark: "#4b2f12", kind: "metal" },
  gold: { base: "#cf9f2f", light: "#fae29a", dark: "#7a5410", kind: "metal" },
  lead: { base: "#7d8186", light: "#c4c8cc", dark: "#3c3f42", kind: "metal" },
  vermilion: { base: "#c23a24", light: "#d85a40", dark: "#8f2414", kind: "ink" },
};

// ---------------------------------------------------------------------------
// Geometry (200-unit frame, centre 100,100)

const C = 100;

interface SealGeom {
  /** Outline of the matrix (the impression's edge). */
  outer: string;
  /** Path the legend runs along (clockwise from the top). */
  legendPath: string;
  legendLen: number;
  /** Border line(s) inside the legend band. */
  rimOuter: string;
  rimInner: string;
  /** Points for the bead row. */
  beads: Pt[];
  /** Field (inside the legend band) for clipping the diaper. */
  field: string;
  /** Box available to the device. */
  dev: { x: number; y: number; w: number; h: number };
  w: number;
  h: number;
}

function vesicaD(cx: number, cy: number, hw: number, hh: number): string {
  // two circular arcs meeting in points at top and bottom
  const R = (hw * hw + hh * hh) / (2 * hw);
  return `M${f(cx)} ${f(cy - hh)}A${f(R)} ${f(R)} 0 0 1 ${f(cx)} ${f(cy + hh)}A${f(R)} ${f(R)} 0 0 1 ${f(cx)} ${f(cy - hh)}Z`;
}

function vesicaPts(cx: number, cy: number, hw: number, hh: number, n: number): Pt[] {
  const R = (hw * hw + hh * hh) / (2 * hw);
  const pts: Pt[] = [];
  const a = Math.asin(hh / R);
  // right arc centred at (cx - (R - hw), cy), left arc mirrored
  for (let i = 0; i < n; i++) {
    const t = -a + (2 * a * i) / n;
    pts.push([cx - (R - hw) + R * Math.cos(t), cy + R * Math.sin(t)]);
  }
  for (let i = 0; i < n; i++) {
    const t = a - (2 * a * i) / n;
    pts.push([cx + (R - hw) - R * Math.cos(t), cy + R * Math.sin(t)]);
  }
  return pts;
}

function perimeter(pts: Pt[]): number {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    L += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return L;
}

function geom(shape: SealShape, hasLegend: boolean): SealGeom {
  const band = hasLegend ? 22 : 12;
  if (shape === "vesica") {
    const hw = 64, hh = 100;
    const lp = vesicaPts(C, C, hw - 11, hh - 15, 40);
    // start the legend at the top point, clockwise
    const start = lp.length - 1;
    const ordered = [...lp.slice(start), ...lp.slice(0, start)];
    const beads = vesicaPts(C, C, hw - band + 2, hh - band * 1.6, 26);
    return {
      outer: vesicaD(C, C, hw, hh),
      legendPath: polyD(ordered, false),
      legendLen: perimeter(lp),
      rimOuter: vesicaD(C, C, hw - 3.5, hh - 5),
      rimInner: vesicaD(C, C, hw - band, hh - band * 1.5),
      beads: hasLegend ? beads : [],
      field: vesicaD(C, C, hw - band, hh - band * 1.5),
      dev: { x: C - (hw - band) * 0.82, y: C - (hh - band * 1.5) * 0.66, w: (hw - band) * 1.64, h: (hh - band * 1.5) * 1.32 },
      w: hw * 2,
      h: hh * 2,
    };
  }
  if (shape === "square") {
    const s = 96, k = band;
    const sq = (h: number) => polyD([[C - h, C - h], [C + h, C - h], [C + h, C + h], [C - h, C + h]]);
    const beads: Pt[] = [];
    return {
      outer: sq(s),
      legendPath: polyD([[C - s + 11, C - s + 11], [C + s - 11, C - s + 11], [C + s - 11, C + s - 11], [C - s + 11, C + s - 11], [C - s + 11, C - s + 11]], false),
      legendLen: 8 * (s - 11),
      rimOuter: sq(s - 4),
      rimInner: sq(s - k),
      beads,
      field: sq(s - k),
      dev: { x: C - (s - k) * 0.86, y: C - (s - k) * 0.86, w: (s - k) * 1.72, h: (s - k) * 1.72 },
      w: s * 2,
      h: s * 2,
    };
  }
  const R = 98;
  const rl = R - 13;
  const beads: Pt[] = [];
  const rb = R - band - 1;
  const nb = Math.round((2 * Math.PI * rb) / 6.2);
  for (let i = 0; i < nb; i++) beads.push([C + rb * Math.sin((i / nb) * 2 * Math.PI), C - rb * Math.cos((i / nb) * 2 * Math.PI)]);
  return {
    outer: circleD(C, C, R),
    legendPath: `M${C} ${f(C - rl)}A${f(rl)} ${f(rl)} 0 1 1 ${C} ${f(C + rl)}A${f(rl)} ${f(rl)} 0 1 1 ${C} ${f(C - rl)}`,
    legendLen: 2 * Math.PI * rl,
    rimOuter: circleD(C, C, R - 3.5),
    rimInner: circleD(C, C, R - band - 4),
    beads: hasLegend ? beads : [],
    field: circleD(C, C, R - band - 4),
    dev: { x: C - (R - band - 4) * 0.74, y: C - (R - band - 4) * 0.74, w: (R - band - 4) * 1.48, h: (R - band - 4) * 1.48 },
    w: R * 2,
    h: R * 2,
  };
}

// ---------------------------------------------------------------------------
// Rendering

export interface SealRenderOptions {
  size?: number;
  idPrefix?: string;
  attrs?: string;
  /** Font family for the legend. */
  font?: string;
}

/** A tiny deterministic noise from a string, for the irregular wax edge. */
function waxBlob(seed: number, R: number, cx: number, cy: number, sx = 1, sy = 1): string {
  const ph = [0, 1, 2, 3, 4].map((i) => ((seed >>> (i * 5)) & 31) / 31 * Math.PI * 2);
  const pts: Pt[] = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R * (1 + 0.045 * Math.sin(3 * a + ph[0]) + 0.03 * Math.sin(5 * a + ph[1]) + 0.022 * Math.sin(8 * a + ph[2]) + 0.012 * Math.sin(13 * a + ph[3]) + 0.008 * Math.sin(21 * a + ph[4]));
    pts.push([cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r * sy]);
  }
  return polyD(pts);
}

function deviceRelief(ctx: Ctx, d: SealDevice, box: SealGeom["dev"]): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (d.kind === "mon") {
    const k = Math.min(box.w, box.h) / 200;
    return `<g transform="translate(${f(cx - 100 * k)} ${f(cy - 100 * k)}) scale(${f(k)})">${monMarkup(ctx, d.mon, "#fff", "none")}</g>`;
  }
  if (d.kind === "arms") {
    const shape = d.shape ?? "heater";
    const def = SHAPES[shape];
    const k = Math.min(box.w / def.w, box.h / def.h) * 0.96;
    const sub: Ctx = { ...ctx, px: ctx.px * k, ow: (ctx.ow * 1.1) / k, hatch: { ink: "#000", paper: "#fff" }, pal: { ...ctx.pal, contour: "#000", contourOnDark: "#fff" } };
    const fr = shapeFrame(shape);
    const clip = uid(ctx, "sa");
    ctx.defs.set(clip, `<clipPath id="${clip}"><path d="${def.d}"/></clipPath>`);
    const inner = renderCoat(d.arms, fr, sub);
    ctx.n = sub.n;
    return (
      `<g transform="translate(${f(cx - (def.w * k) / 2)} ${f(cy - (def.h * k) / 2)}) scale(${f(k)})">` +
      `<path d="${def.d}" fill="#fff"/><g clip-path="url(#${clip})">${inner}</g>` +
      `<path d="${def.d}" fill="none" stroke="#000" stroke-width="${f(sub.ow * 3.2)}"/><path d="${def.d}" fill="none" stroke="#fff" stroke-width="${f(sub.ow * 1.2)}"/></g>`
    );
  }
  // charge(s) as a stencil: body raised, detail lines and gaps sunk
  const { art, box: cb } = chargeArt(d.charge, { attitude: d.attitude });
  const n = Math.max(1, Math.min(3, d.count ?? 1));
  const cell = n === 1 ? Math.min(box.w, box.h) * 1.02 : Math.min(box.w, box.h) * 0.52;
  const k = fitScale(cb, cell);
  const id = uid(ctx, "sc");
  const gap = 1.3 / k;
  ctx.defs.set(id, `<g id="${id}">${paintCharge(art, { body: "#fff", accent: "#fff", crown: "#fff", contour: "#000", detail: "#000", outlineW: gap, lineK: Math.max(1, Math.min(2, 1.3 / k / 1.5)), detailOn: true, tone: false })}</g>`);
  const pcx = (cb.x0 + cb.x1) / 2, pcy = (cb.y0 + cb.y1) / 2;
  const spots: Pt[] = n === 1 ? [[cx, cy]] : n === 2 ? [[cx - box.w * 0.24, cy], [cx + box.w * 0.24, cy]] : [[cx - box.w * 0.24, cy - box.h * 0.2], [cx + box.w * 0.24, cy - box.h * 0.2], [cx, cy + box.h * 0.25]];
  return spots.map(([x, y]) => `<use href="#${id}" transform="translate(${f(x)} ${f(y)}) scale(${f(k)}) translate(${f(-pcx)} ${f(-pcy)})"/>`).join("");
}

function fieldPattern(ctx: Ctx, g: SealGeom, kind: Seal["field"]): string {
  if (kind === "plain") return "";
  const clip = uid(ctx, "sf");
  ctx.defs.set(clip, `<clipPath id="${clip}"><path d="${g.field}"/></clipPath>`);
  let d = "";
  const step = 15;
  if (kind === "diaper") {
    for (let k = -14; k <= 14; k++) {
      d += `M${f(C + k * step - 120)} ${f(C - 120)}l240 240M${f(C + k * step + 120)} ${f(C - 120)}l-240 240`;
    }
    return `<g clip-path="url(#${clip})"><path d="${d}" stroke="#fff" stroke-width="1.1" fill="none"/></g>`;
  }
  // stars / sprigs strewn
  let s = "";
  for (let j = -7; j <= 7; j++) {
    for (let i = -7; i <= 7; i++) {
      const x = C + i * step + (j % 2 ? step / 2 : 0), y = C + j * step * 0.9;
      if (kind === "stars") {
        const pts: Pt[] = [];
        for (let q = 0; q < 10; q++) {
          const a = (q / 10) * Math.PI * 2 - Math.PI / 2;
          const r = q % 2 ? 1.4 : 3.6;
          pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
        }
        s += polyD(pts);
      } else {
        s += `M${f(x)} ${f(y + 3.5)}V${f(y - 1)}` + circleD(x - 2.2, y - 2.2, 1.5) + circleD(x + 2.2, y - 2.2, 1.5) + circleD(x, y - 4, 1.5);
      }
    }
  }
  return `<g clip-path="url(#${clip})"><path d="${s}" fill="#fff" stroke="#fff" stroke-width=".8"/></g>`;
}

/** Points along the legend's path, clockwise from the top, evenly spaced. */
function legendLoop(g: SealGeom, n = 180): Pt[] {
  const pts = samplePath(g.legendPath, 2)[0] ?? [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const sv = (k / n) * total;
    while (j < cum.length - 2 && cum[j + 1] < sv) j++;
    const t = (sv - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

/**
 * The legend round the seal, in capitals with medieval word stops. A long
 * legend runs right round the band; a short one is set across the top at its
 * natural spacing, and the rest of the band is filled with pellets and a
 * rosette at the foot, as seal engravers did.
 */
function legendMarkup(ctx: Ctx, g: SealGeom, legend: string, font: string): string {
  const words = legend.toUpperCase().split(/\s+/).filter(Boolean);
  const text = `✠ ${words.join(" · ")}`;
  const L = g.legendLen * 0.985;
  const est = (fs: number) => [...text].length * fs * 0.72;
  if (est(13.5) > L * 0.62) {
    const pid = uid(ctx, "lp");
    ctx.defs.set(pid, `<path id="${pid}" d="${g.legendPath}"/>`);
    const fs = 13.5;
    const adjust = est(fs) + fs > L ? "spacingAndGlyphs" : "spacing";
    return `<text font-family="${font}" font-size="${fs}" font-weight="700" fill="#fff" dominant-baseline="central" textLength="${f(L)}" lengthAdjust="${adjust}"><textPath href="#${pid}" startOffset="0">${escapeXml(text + " ·")}</textPath></text>`;
  }
  // Short legend: centred on the top, on a path that starts at the foot.
  const loop = legendLoop(g);
  const n = loop.length;
  const bottom = loop.reduce((bi, p, i) => (p[1] > loop[bi][1] ? i : bi), 0);
  const fromFoot = [...loop.slice(bottom), ...loop.slice(0, bottom), loop[bottom]];
  const pid = uid(ctx, "lp");
  ctx.defs.set(pid, `<path id="${pid}" d="${polyD(fromFoot, false)}"/>`);
  const fs = 15;
  const span = Math.min(L * 0.62, est(fs) * 1.12);
  let ornament = "";
  const total = g.legendLen;
  for (let k = 0; k < n; k++) {
    const sv = (k / n) * total;
    const fromTop = Math.min(sv, total - sv);
    if (fromTop < span / 2 + 7) continue;
    const [x, y] = loop[k];
    const atFoot = Math.abs(fromTop - total / 2) < total / n / 2 + 1e-6;
    if (atFoot) {
      // a cinquefoil rosette
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * Math.PI * 2 - Math.PI / 2;
        ornament += circleD(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2);
      }
    } else if (k % 3 === 0) ornament += circleD(x, y, Math.abs(fromTop - total / 2) < total * 0.12 ? 1.9 : 1.5);
  }
  return (
    `<text font-family="${font}" font-size="${fs}" font-weight="700" fill="#fff" dominant-baseline="central" text-anchor="middle" textLength="${f(span)}" lengthAdjust="spacing">` +
    `<textPath href="#${pid}" startOffset="50%">${escapeXml(text)}</textPath></text>` +
    (ornament ? `<path d="${ornament}" fill="#fff"/>` : "")
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ornamentBand(g: SealGeom, shape: SealShape): string {
  // with no legend: a ring of small pellets and rosettes
  if (shape !== "round") return "";
  let s = "";
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 91;
    const x = C + r * Math.sin(a), y = C - r * Math.cos(a);
    s += i % 3 === 0 ? circleD(x, y, 2.6) : circleD(x, y, 1.3);
  }
  void g;
  return `<path d="${s}" fill="#fff"/>`;
}

export function renderSealSVG(seal: Seal, opts: SealRenderOptions = {}): string {
  const size = opts.size ?? 180;
  const mat = MATERIALS[seal.material];
  const hasLegend = !!seal.legend && seal.shape !== "square";
  const g = geom(seal.shape, hasLegend);
  const pad = mat.kind === "wax" ? 22 : 6;
  const vw = 200 + pad * 2, vh = (seal.shape === "vesica" ? 200 : g.h) + pad * 2;
  const ctx: Ctx = { id: opts.idPrefix ?? autoId(), pal: ILLUMINATED, defs: new Map(), ids: new Map(), n: 0, px: size / vw, ow: 1.1, shading: false };
  const font = opts.font ?? "Cinzel, 'Trajan Pro', 'Times New Roman', Georgia, serif";
  // --- relief mask (white = raised)
  let relief = "";
  relief += `<path d="${g.outer}" fill="#fff"/><path d="${g.rimOuter}" fill="#000"/>`;
  if (hasLegend) {
    relief += `<path d="${g.rimOuter}" fill="none" stroke="#fff" stroke-width="1.6"/>`;
    relief += legendMarkup(ctx, g, seal.legend!, font);
  } else relief += ornamentBand(g, seal.shape);
  relief += `<path d="${g.rimInner}" fill="none" stroke="#fff" stroke-width="${seal.border === "plain" ? 2.6 : 1.3}"/>`;
  if (seal.border === "beaded" && g.beads.length) relief += `<path d="${g.beads.map(([x, y]) => circleD(x, y, 1.9)).join("")}" fill="#fff"/>`;
  if (seal.border === "cabled") {
    let d = "";
    const n = 60;
    for (let i = 0; i < n; i++) {
      if (seal.shape !== "round") break;
      const a = (i / n) * Math.PI * 2, r = 98 - (hasLegend ? 22 : 12) - 1;
      d += `M${f(C + (r - 2) * Math.sin(a))} ${f(C - (r - 2) * Math.cos(a))}L${f(C + (r + 2) * Math.sin(a + 0.06))} ${f(C - (r + 2) * Math.cos(a + 0.06))}`;
    }
    relief += `<path d="${d}" stroke="#fff" stroke-width="1.6"/>`;
  }
  relief += fieldPattern(ctx, g, seal.field);
  // clear a little room round the device so it stands proud of the field pattern
  relief += deviceRelief(ctx, seal.device, g.dev);
  const mask = uid(ctx, "rl");
  ctx.defs.set(mask, `<mask id="${mask}" maskUnits="userSpaceOnUse" x="-40" y="-40" width="280" height="280"><rect x="-40" y="-40" width="280" height="280" fill="#000"/>${relief}</mask>`);
  const seed = hashString(JSON.stringify(seal));
  let s = "";
  const lit = (dx: number, dy: number, fill: string, op = 1) =>
    `<g transform="translate(${f(dx)} ${f(dy)})"><rect x="-40" y="-40" width="280" height="280" fill="${fill}" fill-opacity="${op}" mask="url(#${mask})"/></g>`;
  if (mat.kind === "wax") {
    const vg = uid(ctx, "wx");
    ctx.defs.set(vg, `<radialGradient id="${vg}" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="${mix(mat.base, mat.light, 0.35)}"/><stop offset=".6" stop-color="${mat.base}"/><stop offset="1" stop-color="${mat.dark}"/></radialGradient>`);
    const sx = seal.shape === "vesica" ? 0.74 : 1;
    s += `<path d="${waxBlob(seed, 112, C + 2.5, C + 3.5, sx, 1.02)}" fill="#000" fill-opacity=".25"/>`;
    s += `<path d="${waxBlob(seed, 112, C, C, sx, 1.02)}" fill="url(#${vg})"/>`;
    // the sunken impression
    s += `<path d="${g.outer}" fill="${mix(mat.base, mat.dark, 0.25)}"/>`;
    s += `<path d="${g.outer}" fill="none" stroke="${mat.light}" stroke-opacity=".5" stroke-width="2.2" transform="translate(1.2 1.6)"/>`;
    s += `<path d="${g.outer}" fill="none" stroke="${mat.dark}" stroke-opacity=".7" stroke-width="2.2" transform="translate(-0.8 -1)"/>`;
    s += lit(1.3, 1.7, mat.dark, 0.9) + lit(-0.8, -1, mat.light, 0.85) + lit(0, 0, mix(mat.base, mat.light, 0.12));
    const gl = uid(ctx, "gloss");
    ctx.defs.set(gl, `<radialGradient id="${gl}" cx=".32" cy=".26" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    s += `<path d="${waxBlob(seed, 112, C, C, sx, 1.02)}" fill="url(#${gl})"/>`;
  } else if (mat.kind === "metal") {
    const mg = uid(ctx, "mt");
    ctx.defs.set(mg, `<linearGradient id="${mg}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mat.light}"/><stop offset=".5" stop-color="${mat.base}"/><stop offset="1" stop-color="${mat.dark}"/></linearGradient>`);
    s += `<path d="${g.outer}" fill="#000" fill-opacity=".3" transform="translate(2 3)"/>`;
    s += `<path d="${g.outer}" fill="url(#${mg})"/>`;
    s += `<path d="${g.outer}" fill="${mat.dark}" fill-opacity=".25"/>`;
    s += lit(1, 1.3, mat.dark, 0.95) + lit(-0.7, -0.9, mat.light, 0.95) + lit(0, 0, mat.base);
    const sh = uid(ctx, "msh");
    ctx.defs.set(sh, `<linearGradient id="${sh}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>`);
    s += `<path d="${g.outer}" fill="url(#${sh})"/>`;
    s += `<path d="${g.outer}" fill="none" stroke="${mat.dark}" stroke-width="1.2"/>`;
  } else {
    // ink stamp: flat vermilion, slightly uneven
    const tex = uid(ctx, "ink");
    ctx.defs.set(
      tex,
      `<filter id="${tex}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="${seed % 97}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.9"/><feComposite in="SourceGraphic" operator="in"/></filter>`,
    );
    s += `<g filter="url(#${tex})">${lit(0, 0, mat.base)}</g>`;
  }
  const height = (size * vh) / vw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-pad)} ${f(C - vh / 2)} ${f(vw)} ${f(vh)}" width="${f(size)}" height="${f(height)}"${opts.attrs ? " " + opts.attrs : ""}>` +
    defsMarkup(ctx) +
    s +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Description & generation

const MATERIAL_TEXT: Record<SealMaterial, string> = {
  redWax: "in red wax",
  greenWax: "in green wax",
  brownWax: "in brown wax",
  blackWax: "in black wax",
  bronze: "cast in bronze",
  gold: "of gold",
  lead: "a leaden bulla",
  vermilion: "stamped in vermilion",
};

export function describeSeal(s: Seal): string {
  const shape = s.shape === "vesica" ? "A pointed oval seal" : s.shape === "square" ? "A square seal" : "A round seal";
  let dev: string;
  if (s.device.kind === "arms") dev = `a shield of arms (${blazon(s.device.arms)})`;
  else if (s.device.kind === "mon") dev = describeMon(s.device.mon).replace(/, \w+ on \w+\.$/, "").replace(/^./, (c) => c.toLowerCase());
  else {
    const def = chargeDef(s.device.charge);
    const n = s.device.count ?? 1;
    const noun = n === 1 ? def.name : def.plural;
    const att = s.device.attitude && def.attitudes && s.device.attitude !== def.attitudes[0] ? " " + s.device.attitude : "";
    dev = n === 1 ? `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}${att}` : `${["", "", "two", "three"][n]} ${noun}${att}`;
  }
  const field = s.field === "diaper" ? " on a diapered field" : s.field === "stars" ? " on a field strewn with stars" : s.field === "sprigs" ? " on a field of sprigs" : "";
  const mat = s.material === "lead" ? ", a leaden bulla" : ` ${MATERIAL_TEXT[s.material]}`;
  const legend = s.legend ? `; legend: ✠ ${s.legend.toUpperCase().split(/\s+/).join(" · ")}` : "";
  return `${shape}${mat}: ${dev}${field}${legend}.`;
}

export interface SealOptions {
  /** Legend text (typically the bearer's name in its own language). */
  legend?: string;
  /** Use these arms as the device. */
  arms?: Arms;
  /** Use this mon as the device. */
  mon?: Mon;
  /** Charges to cant on. */
  motifs?: ChargeId[];
  /** Ecclesiastical seals are pointed ovals. */
  ecclesiastical?: boolean;
  material?: SealMaterial;
}

export function generateSeal(rng: Rng, opts: SealOptions = {}): Seal {
  const shape: SealShape = opts.ecclesiastical ? "vesica" : rng.weighted([["round", 10], ["vesica", 1.5], ["square", 1.2]] as [SealShape, number][]);
  const material: SealMaterial =
    opts.material ??
    (shape === "square"
      ? "vermilion"
      : rng.weighted([["redWax", 8], ["greenWax", 3], ["brownWax", 3], ["blackWax", 1], ["bronze", 2], ["gold", 1], ["lead", 1.5]] as [SealMaterial, number][]));
  let device: SealDevice;
  const motifs = (opts.motifs ?? []).filter((m) => CHARGES[m]);
  if (opts.arms) device = { kind: "arms", arms: opts.arms, shape: rng.pick(["heater", "heater", "french", "iberian"] as ShieldShape[]) };
  else if (opts.mon) device = { kind: "mon", mon: opts.mon };
  else if (shape === "square" && rng.chance(0.5)) device = { kind: "mon", mon: generateMon(rng.fork("mon"), { motifs }) };
  else {
    const charge: ChargeId = motifs.length && rng.chance(0.97)
      ? rng.pick(motifs)
      : rng.weighted([["lion", 4], ["eagle", 4], ["tower", 2], ["castle", 2], ["key", 2], ["ship", 2], ["fleurDeLis", 2], ["crown", 2], ["stag", 1.5], ["horse", 1.5], ["sun", 1.5], ["star", 1], ["tree", 1.5], ["cup", 1], ["hand", 1], ["bell", 1]] as [ChargeId, number][]);
    const def = CHARGES[charge];
    device = { kind: "charge", charge };
    if (def.attitudes && def.attitudes.length > 1) device.attitude = rng.pick(def.attitudes);
    if (def.category !== "beast" && def.category !== "monster" && def.category !== "building" && rng.chance(0.15)) device.count = 3;
  }
  const seal: Seal = {
    shape,
    material,
    device,
    border: rng.weighted([["beaded", 5], ["plain", 3], ["cabled", 2]] as [Seal["border"], number][]),
    field: rng.weighted([["plain", 6], ["diaper", 2], ["stars", 1.2], ["sprigs", 1.2]] as [Seal["field"], number][]),
  };
  if (opts.legend) seal.legend = opts.legend;
  if (device.kind === "arms" || device.kind === "mon") seal.field = rng.chance(0.7) ? "plain" : seal.field;
  return seal;
}
