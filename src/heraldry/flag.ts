/**
 * Flags: vexillological designs (bands, tricolours, Nordic and centred
 * crosses, saltires, cantons, hoist triangles, serrations, palls, rays…),
 * optionally carrying a device — a charge, a ring or row of stars, or the
 * full coat of arms. Generation can derive a realm's flag from its arms
 * (livery colours + principal charge). Plain JSON data; DOM-free rendering.
 */
import type { Rng } from "../core/rng";
import type { Tincture } from "../world/concepts";
import type { Arms, Attitude, ChargeId, ShieldShape } from "./types";
import { CHARGES, chargeDef } from "./charges/index";
import { autoId, defsMarkup, mix, uid, type Ctx } from "./ctx";
import { f, polyD, circleD, type Pt } from "./path";
import { monoPaint, placeCharge, type Placement } from "./place";
import { subpaths } from "./charges/paint";
import { renderCoat } from "./render";
import { SHAPES, shapeFrame } from "./shapes";
import { FLAT, ILLUMINATED, PALETTES, isMetal, type Palette } from "./tinctures";
import { resolveStyle, type HeraldryStyle, type StyleName } from "./styles";

export const FLAG_PATTERNS = [
  "plain", "bicolorH", "bicolorV", "tribandH", "tribandHWide", "tribandV", "centralBandV", "stripes", "nordic", "cross",
  "swissCross", "saltire", "saltireQuartered", "canton", "hoistTriangle", "diagonal", "diagonalBand", "quartered",
  "border", "disc", "serrated", "pall", "rays",
] as const;
export type FlagPattern = (typeof FLAG_PATTERNS)[number];

export const FLAG_SHAPES = ["rect", "swallowtail", "pennant", "tongued"] as const;
export type FlagShape = (typeof FLAG_SHAPES)[number];

export interface FlagDevice {
  /** A charge drawn as a flat silhouette in `tincture` (details cut out in the ground colour). */
  charge?: ChargeId;
  attitude?: Attitude;
  /** Mullet / estoile points. */
  points?: number;
  /** Several charges (stars, usually): ring, row, arc or a scattered constellation. */
  count?: number;
  arrangement?: "single" | "ring" | "row" | "arc" | "column";
  tincture?: Tincture;
  /** The full coat of arms on a small shield instead of a charge. */
  arms?: Arms;
  shield?: ShieldShape;
  /** A disc of this tincture behind the device. */
  disc?: Tincture;
}

export interface Flag {
  /** Width / height (1.5 = 3:2). */
  ratio: number;
  pattern: FlagPattern;
  /** Colours of the pattern's regions, in the pattern's order (see describeFlag). */
  colours: Tincture[];
  /** Number of stripes (stripes) or rays (rays) or teeth (serrated). */
  count?: number;
  /** Narrow border separating the cross/band from the field. */
  fimbriation?: Tincture;
  device?: FlagDevice;
  shape?: FlagShape;
}

// ---------------------------------------------------------------------------
// Geometry

interface Region {
  d: string;
  c: Tincture;
  /** Subpaths are holes (border); otherwise subpaths are unioned. */
  evenodd?: boolean;
}
interface Anchor {
  x: number;
  y: number;
  /** Cell size for the device. */
  s: number;
  /** Tincture(s) under the device. */
  bg: Tincture[];
}
interface Layout {
  regions: Region[];
  anchor: Anchor;
}

const rect = (x: number, y: number, w: number, h: number) => polyD([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);

function band(a: Pt, b: Pt, hw: number): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * hw, ny = (dx / L) * hw;
  return polyD([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
}

/** Colour i of the flag, cycling sensibly when fewer colours were given. */
function col(fl: Flag, i: number): Tincture {
  const c = fl.colours;
  if (i < c.length) return c[i];
  if (i === 2 && c.length >= 1) return c[0];
  return c[i % c.length];
}

function layoutFlag(fl: Flag, W: number, H: number): Layout {
  const R: Region[] = [];
  const c0 = col(fl, 0), c1 = col(fl, 1), c2 = col(fl, 2);
  const fim = fl.fimbriation;
  let anchor: Anchor = { x: W / 2, y: H / 2, s: H * 0.55, bg: [c0] };
  const add = (d: string, c: Tincture, evenodd = false) => R.push({ d, c, evenodd });
  add(rect(0, 0, W, H), c0);
  switch (fl.pattern) {
    case "plain":
      anchor = { x: W / 2, y: H / 2, s: H * 0.66, bg: [c0] };
      break;
    case "bicolorH":
      add(rect(0, H / 2, W, H / 2), c1);
      anchor = { x: H * 0.42, y: H * 0.25, s: H * 0.36, bg: [c0] };
      break;
    case "bicolorV":
      add(rect(W / 2, 0, W / 2, H), c1);
      anchor = { x: W / 4, y: H / 2, s: Math.min(W / 2, H) * 0.62, bg: [c0] };
      break;
    case "tribandH":
      add(rect(0, H / 3, W, H / 3), c1);
      add(rect(0, (2 * H) / 3, W, H / 3), c2);
      anchor = { x: W / 2, y: H / 2, s: H * 0.31, bg: [c1] };
      break;
    case "tribandHWide":
      add(rect(0, H / 4, W, H / 2), c1);
      add(rect(0, (3 * H) / 4, W, H / 4), c2);
      anchor = { x: W * 0.36, y: H / 2, s: H * 0.43, bg: [c1] };
      break;
    case "tribandV":
      add(rect(W / 3, 0, W / 3, H), c1);
      add(rect((2 * W) / 3, 0, W / 3, H), c2);
      anchor = { x: W / 2, y: H / 2, s: Math.min((W / 3) * 0.86, H * 0.55), bg: [c1] };
      break;
    case "centralBandV":
      add(rect(W / 4, 0, W / 2, H), c1);
      add(rect((3 * W) / 4, 0, W / 4, H), c2);
      anchor = { x: W / 2, y: H / 2, s: Math.min(W / 2, H) * 0.66, bg: [c1] };
      break;
    case "stripes": {
      const n = Math.max(3, fl.count ?? 7);
      const sh = H / n;
      for (let i = 1; i < n; i += 2) add(rect(0, i * sh, W, sh), c1);
      if (fl.colours.length >= 3) {
        const ch = sh * Math.ceil(n / 2 - 0.01 + (n % 2 ? 0 : 0));
        const rows = n >= 7 ? Math.ceil(n / 2) : n % 2 ? Math.ceil(n / 2) : n / 2;
        const cH = Math.min(H, rows * sh || ch);
        const cW = Math.min(W * 0.42, cH * 1.2);
        add(rect(0, 0, cW, cH), c2);
        anchor = { x: cW / 2, y: cH / 2, s: Math.min(cW, cH) * 0.78, bg: [c2] };
      } else anchor = { x: W / 2, y: H / 2, s: H * 0.5, bg: [c0, c1] };
      break;
    }
    case "nordic": {
      const xc = H / 2;
      const cw = H * (fim ? 0.12 : 0.17);
      if (fim) {
        const fw = cw + H * 0.12;
        add(rect(xc - fw / 2, 0, fw, H) + rect(0, H / 2 - fw / 2, W, fw), fim);
      }
      add(rect(xc - cw / 2, 0, cw, H) + rect(0, H / 2 - cw / 2, W, cw), c1);
      const q = xc - (fim ? cw / 2 + H * 0.06 : cw / 2);
      anchor = { x: q / 2, y: q / 2, s: q * 0.8, bg: [c0] };
      break;
    }
    case "cross": {
      const cw = H * (fim ? 0.15 : 0.2);
      if (fim) {
        const fw = cw + H * 0.1;
        add(rect(W / 2 - fw / 2, 0, fw, H) + rect(0, H / 2 - fw / 2, W, fw), fim);
      }
      add(rect(W / 2 - cw / 2, 0, cw, H) + rect(0, H / 2 - cw / 2, W, cw), c1);
      const qx = (W / 2 - cw / 2 - (fim ? H * 0.05 : 0)) / 2, qy = (H / 2 - cw / 2 - (fim ? H * 0.05 : 0)) / 2;
      anchor = { x: qx, y: qy, s: Math.min(qx, qy) * 1.6, bg: [c0] };
      break;
    }
    case "swissCross": {
      const a = H * 0.625, t = a * 0.3;
      add(rect(W / 2 - t / 2, H / 2 - a / 2, t, a) + rect(W / 2 - a / 2, H / 2 - t / 2, a, t), c1);
      anchor = { x: W / 2, y: H / 2, s: t * 0.8, bg: [c1] };
      break;
    }
    case "saltire":
    case "saltireQuartered": {
      if (fl.pattern === "saltireQuartered") {
        add(polyD([[0, 0], [W / 2, H / 2], [0, H]]) + polyD([[W, 0], [W / 2, H / 2], [W, H]]), c2);
      }
      const hw = H * (fim ? 0.075 : 0.1);
      if (fim) add(band([0, 0], [W, H], hw + H * 0.045) + band([0, H], [W, 0], hw + H * 0.045), fim);
      add(band([0, 0], [W, H], hw) + band([0, H], [W, 0], hw), c1);
      anchor = { x: W / 2, y: H * 0.17, s: H * 0.2, bg: [c0] };
      break;
    }
    case "canton": {
      if (fl.colours.length >= 3) add(rect(0, H / 2, W, H / 2), c2);
      const cw = Math.min(W * 0.45, H * 0.6), chh = H / 2;
      add(rect(0, 0, cw, chh), c1);
      anchor = { x: cw / 2, y: chh / 2, s: Math.min(cw, chh) * 0.8, bg: [c1] };
      break;
    }
    case "hoistTriangle": {
      // Bands behind (bicolour, or tribands when 4 colours), triangle at the hoist.
      const bandsN = fl.colours.length >= 4 ? 3 : 2;
      const cols = bandsN === 3 ? [c0, c1, col(fl, 3)] : [c0, c1];
      for (let i = 1; i < bandsN; i++) add(rect(0, (i * H) / bandsN, W, H / bandsN), cols[i]);
      const tip = Math.min(W * 0.45, H * 0.87);
      if (fim) add(polyD([[0, -H * 0.12], [tip + H * 0.12, H / 2], [0, H * 1.12]]), fim);
      add(polyD([[0, 0], [tip, H / 2], [0, H]]), c2);
      anchor = { x: tip * 0.36, y: H / 2, s: tip * 0.5, bg: [c2] };
      break;
    }
    case "diagonal":
      add(polyD([[W, 0], [W, H], [0, H]]), c1);
      anchor = { x: W * 0.27, y: H * 0.3, s: H * 0.38, bg: [c0] };
      break;
    case "diagonalBand": {
      add(polyD([[W, 0], [W, H], [0, H]]), c2);
      const hw = H * 0.13;
      if (fim) add(band([0, H], [W, 0], hw + H * 0.05), fim);
      add(band([-W * 0.1, H * 1.1], [W * 1.1, -H * 0.1], hw), c1);
      anchor = { x: W * 0.22, y: H * 0.27, s: H * 0.32, bg: [c0] };
      break;
    }
    case "quartered":
      add(rect(W / 2, 0, W / 2, H / 2) + rect(0, H / 2, W / 2, H / 2), c1);
      anchor = { x: W / 4, y: H / 4, s: H * 0.36, bg: [c0] };
      break;
    case "border": {
      const b = H * 0.11;
      add(polyD([[0, 0], [W, 0], [W, H], [0, H]]) + polyD([[b, b], [b, H - b], [W - b, H - b], [W - b, b]]), c1, true);
      anchor = { x: W / 2, y: H / 2, s: H * 0.56, bg: [c0] };
      break;
    }
    case "disc": {
      const cx = W * 0.46, r = H * 0.3;
      if (fim) add(circleD(cx, H / 2, r + H * 0.04), fim);
      add(circleD(cx, H / 2, r), c1);
      anchor = { x: cx, y: H / 2, s: r * 1.25, bg: [c1] };
      break;
    }
    case "serrated": {
      const n = Math.max(3, fl.count ?? 7);
      const bx = W * 0.27, tooth = W * 0.09;
      const pts: Pt[] = [[0, 0], [bx, 0]];
      for (let i = 0; i < n; i++) {
        pts.push([bx + tooth, ((i + 0.5) * H) / n], [bx, ((i + 1) * H) / n]);
      }
      pts.push([0, H]);
      add(polyD(pts), c1);
      anchor = { x: bx + tooth + (W - bx - tooth) / 2, y: H / 2, s: H * 0.5, bg: [c0] };
      break;
    }
    case "pall": {
      // A horizontal Y: the arms run from the hoist corners to a junction, then a band to the fly.
      add(rect(0, H / 2, W, H / 2), c2);
      const hw = H * (fim ? 0.085 : 0.11), fw = fim ? H * 0.06 : 0;
      const J: Pt = [W * 0.36, H / 2];
      const L = Math.hypot(J[0], J[1]);
      const ux = J[0] / L, uy = J[1] / L;
      const ext = H * 0.4;
      const yArms = (w: number) =>
        band([-ux * ext, -uy * ext], [J[0] + ux * w, J[1] + uy * w], w) +
        band([-ux * ext, H + uy * ext], [J[0] + ux * w, H - J[1] - uy * w], w) +
        rect(J[0] - w, H / 2 - w, W - J[0] + w + 2, 2 * w);
      if (fim) add(yArms(hw + fw), fim);
      add(yArms(hw), c1);
      // Hoist triangle inside the mouth of the Y, bounded by the inner edges of the arms.
      const off = hw + fw;
      const yTop = (off * L) / J[0];
      const xTip = J[0] - (off * L) / J[1];
      const tri = col(fl, 3);
      add(polyD([[0, yTop], [xTip, H / 2], [0, H - yTop]]), tri);
      anchor = { x: xTip * 0.34, y: H / 2, s: Math.min(xTip * 0.55, (H - 2 * yTop) * 0.5), bg: [tri] };
      break;
    }
    case "rays": {
      const n = Math.max(8, fl.count ?? 16);
      const cx = W / 2, cy = H / 2, Rr = Math.hypot(W, H);
      let d = "";
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n, a1 = a0 + (Math.PI * 2) / n;
        d += polyD([[cx, cy], [cx + Math.cos(a0) * Rr, cy + Math.sin(a0) * Rr], [cx + Math.cos(a1) * Rr, cy + Math.sin(a1) * Rr]]);
      }
      add(d, c1);
      const r = H * 0.22;
      add(circleD(cx, cy, r), c2 === c0 ? c1 : c2);
      anchor = { x: cx, y: cy, s: r * 1.3, bg: [c2 === c0 ? c1 : c2] };
      break;
    }
  }
  return { regions: R, anchor };
}

function outlinePath(shape: FlagShape, W: number, H: number): string {
  switch (shape) {
    case "swallowtail":
      return polyD([[0, 0], [W, 0], [W * 0.78, H / 2], [W, H], [0, H]]);
    case "tongued":
      return polyD([[0, 0], [W, 0], [W * 0.8, H * 0.36], [W, H * 0.42], [W, H * 0.58], [W * 0.8, H * 0.64], [W, H], [0, H]]);
    case "pennant":
      return polyD([[0, 0], [W, H * 0.42], [W, H * 0.58], [0, H]]);
    default:
      return polyD([[0, 0], [W, 0], [W, H], [0, H]]);
  }
}

// ---------------------------------------------------------------------------
// Rendering

export interface FlagRenderOptions {
  /** Output width in pixels. Default 180. */
  size?: number;
  idPrefix?: string;
  palette?: Palette | "illuminated" | "flat";
  /** "rich": soft cloth folds and sheen. Default "rich". */
  finish?: "rich" | "flat";
  attrs?: string;
}

function devicePlacements(dv: FlagDevice, a: Anchor): Placement[] {
  const n = Math.max(1, dv.count ?? 1);
  const arr = dv.arrangement ?? (n === 1 ? "single" : "ring");
  if (n === 1 || arr === "single") return [{ x: a.x, y: a.y, s: a.s }];
  const out: Placement[] = [];
  if (arr === "ring") {
    const R = a.s * 0.42;
    const s = Math.min(a.s * 0.3, ((2 * Math.PI * R) / n) * 0.78);
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      out.push({ x: a.x + Math.cos(t) * R, y: a.y + Math.sin(t) * R, s });
    }
  } else if (arr === "arc") {
    const R = a.s * 0.55;
    const s = Math.min(a.s * 0.28, ((Math.PI * R) / n) * 0.85);
    for (let i = 0; i < n; i++) {
      const t = Math.PI * (1.12 + (0.76 * i) / Math.max(1, n - 1));
      out.push({ x: a.x + Math.cos(t) * R, y: a.y + a.s * 0.3 + Math.sin(t) * R, s });
    }
  } else if (arr === "column") {
    const s = Math.min(a.s * 0.4, (a.s * 1.3) / n);
    for (let i = 0; i < n; i++) out.push({ x: a.x, y: a.y + (i - (n - 1) / 2) * s * 1.15, s });
  } else {
    const s = Math.min(a.s * 0.42, (a.s * 1.6) / n);
    for (let i = 0; i < n; i++) out.push({ x: a.x + (i - (n - 1) / 2) * s * 1.2, y: a.y, s });
  }
  return out;
}

function renderDevice(ctx: Ctx, dv: FlagDevice, a: Anchor): string {
  let s = "";
  const pal = ctx.pal;
  if (dv.disc) s += `<circle cx="${f(a.x)}" cy="${f(a.y)}" r="${f(a.s * 0.62)}" fill="${pal.tinctures[dv.disc].base}"/>`;
  const ground = dv.disc ?? a.bg[0];
  if (dv.arms) {
    const shape = dv.shield ?? "heater";
    const def = SHAPES[shape];
    // Arms may straddle bands, as on many real flags.
    const big = Math.abs(a.x - FH * 0.5 * (a.x > FH ? 2 : 1)) < 1 || a.s < FH * 0.4 ? Math.min(FH * 0.6, Math.max(a.s * 1.25, FH * 0.5)) : a.s;
    const k = (big * 0.92) / Math.max(def.w, def.h);
    const sub: Ctx = { ...ctx, px: ctx.px * k, ow: ctx.ow / k };
    const fr = shapeFrame(shape);
    const clip = uid(ctx, "fa");
    ctx.defs.set(clip, `<clipPath id="${clip}"><path d="${def.d}"/></clipPath>`);
    const inner = renderCoat(dv.arms, fr, sub);
    ctx.n = sub.n;
    s +=
      `<g transform="translate(${f(a.x - (def.w * k) / 2)} ${f(a.y - (def.h * k) / 2)}) scale(${f(k)})">` +
      `<g clip-path="url(#${clip})">${inner}</g>` +
      `<path d="${def.d}" fill="none" stroke="${pal.contour}" stroke-width="${f(sub.ow * 1.6)}"/></g>`;
    return s;
  }
  if (!dv.charge) return s;
  const t = dv.tincture ?? "or";
  const ink = pal.tinctures[t].base;
  const gr = pal.tinctures[ground].base;
  s += placeCharge(
    ctx,
    { charge: dv.charge, attitude: dv.attitude, points: dv.points },
    monoPaint(ctx, ink, gr),
    `m-${t}-${ground}`,
    devicePlacements(dv, dv.disc ? { ...a, s: a.s * 0.82 } : a),
  );
  return s;
}

/** Height in viewBox units; width is ratio × this. */
const FH = 200;

export function renderFlagSVG(fl: Flag, opts: FlagRenderOptions = {}): string {
  const W = Math.round(FH * fl.ratio), H = FH;
  const size = opts.size ?? 180;
  const pal = typeof opts.palette === "string" ? PALETTES[opts.palette] ?? FLAT : opts.palette ?? FLAT;
  const px = size / W;
  const ctx: Ctx = {
    id: opts.idPrefix ?? autoId(),
    pal,
    defs: new Map(),
    ids: new Map(),
    n: 0,
    px,
    ow: Math.max(0.5, Math.min(1.4, 0.4 + size / 360)) / px,
    shading: (opts.finish ?? "rich") === "rich",
  };
  const lay = layoutFlag(fl, W, H);
  let body = "";
  for (const r of lay.regions) {
    const fill = pal.tinctures[r.c].base;
    if (r.evenodd) body += `<path d="${r.d}" fill="${fill}" fill-rule="evenodd"/>`;
    else {
      const parts = subpaths(r.d);
      body += parts.length === 1 ? `<path d="${r.d}" fill="${fill}"/>` : `<g fill="${fill}">${parts.map((p) => `<path d="${p}"/>`).join("")}</g>`;
    }
  }
  if (fl.device) body += renderDevice(ctx, fl.device, lay.anchor);
  const shape = fl.shape ?? "rect";
  const outline = outlinePath(shape, W, H);
  const clip = uid(ctx, "fl");
  ctx.defs.set(clip, `<clipPath id="${clip}"><path d="${outline}"/></clipPath>`);
  let finish = "";
  if (ctx.shading) {
    const g = uid(ctx, "fold");
    // Soft folds of hanging cloth: alternating light and shade, strongest near the hoist.
    const stops = [
      [0, "#000", 0.1], [0.06, "#fff", 0.1], [0.17, "#000", 0.05], [0.3, "#fff", 0.12], [0.45, "#000", 0.08],
      [0.6, "#fff", 0.1], [0.76, "#000", 0.07], [0.9, "#fff", 0.06], [1, "#000", 0.1],
    ] as const;
    ctx.defs.set(
      g,
      `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2=".12">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`,
    );
    finish = `<rect width="${W}" height="${H}" fill="url(#${g})"/>`;
  }
  const edge = mix(pal.contour, "#888888", 0.35);
  const height = (size * H) / W;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W + 2} ${H + 2}" width="${f(size)}" height="${f(height)}"${opts.attrs ? " " + opts.attrs : ""}>` +
    defsMarkup(ctx) +
    `<g clip-path="url(#${clip})">${body}${finish}</g>` +
    `<path d="${outline}" fill="none" stroke="${edge}" stroke-width="${f(ctx.ow * 1.1)}" stroke-linejoin="round"/></svg>`
  );
}

// ---------------------------------------------------------------------------
// Description

const COLOUR_WORD: Record<Tincture, string> = {
  or: "gold", argent: "white", gules: "red", azure: "blue", vert: "green", purpure: "purple", sable: "black", tenne: "orange",
  sanguine: "crimson",
};

export function colourWord(t: Tincture): string {
  return COLOUR_WORD[t];
}

function listAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function deviceText(dv: FlagDevice): string {
  if (dv.arms) return "the coat of arms";
  if (!dv.charge) return "";
  const def = chargeDef(dv.charge);
  const n = Math.max(1, dv.count ?? 1);
  const nums = ["", "a", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"];
  let noun = n === 1 ? def.name : def.plural;
  if (dv.charge === "mullet") noun = n === 1 ? "star" : "stars";
  if (dv.attitude && def.attitudes && dv.attitude !== def.attitudes[0]) noun += " " + dv.attitude;
  const head = n === 1 ? `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}` : `${nums[n] ?? n} ${noun}`;
  const arr = n > 1 ? { ring: " in a ring", row: " in a row", arc: " in an arc", column: " in a column", single: "" }[dv.arrangement ?? "ring"] : "";
  return `${head}${arr} in ${COLOUR_WORD[dv.tincture ?? "or"]}${dv.disc ? ` on a ${COLOUR_WORD[dv.disc]} disc` : ""}`;
}

/** Plain-English description of a flag, in the manner of a vexillological reference. */
export function describeFlag(fl: Flag): string {
  const c = (i: number) => COLOUR_WORD[col(fl, i)];
  let s: string;
  switch (fl.pattern) {
    case "plain": s = `Plain ${c(0)}`; break;
    case "bicolorH": s = `Horizontal bicolour of ${c(0)} over ${c(1)}`; break;
    case "bicolorV": s = `Vertical bicolour of ${c(0)} and ${c(1)}`; break;
    case "tribandH": s = col(fl, 0) === col(fl, 2) ? `${cap(c(0))} with a broad horizontal ${c(1)} band` : `Horizontal tricolour of ${c(0)}, ${c(1)} and ${c(2)}`; break;
    case "tribandHWide": s = `${cap(c(0))}, ${c(1)} and ${c(2)} horizontal bands, the middle one twice as wide`; break;
    case "tribandV": s = col(fl, 0) === col(fl, 2) ? `${cap(c(0))} with a vertical ${c(1)} band` : `Vertical tricolour of ${c(0)}, ${c(1)} and ${c(2)}`; break;
    case "centralBandV": s = col(fl, 0) === col(fl, 2) ? `${cap(c(0))} with a broad central ${c(1)} panel` : `${cap(c(0))} and ${c(2)} with a broad central ${c(1)} panel`; break;
    case "stripes": s = `${fl.count ?? 7} horizontal stripes of ${c(0)} and ${c(1)}${fl.colours.length >= 3 ? `, with a ${c(2)} canton` : ""}`; break;
    case "nordic": s = `${cap(c(0))} with a ${c(1)} Nordic cross${fl.fimbriation ? ` bordered ${COLOUR_WORD[fl.fimbriation]}` : ""}`; break;
    case "cross": s = `${cap(c(0))} with a ${c(1)} cross${fl.fimbriation ? ` bordered ${COLOUR_WORD[fl.fimbriation]}` : ""}`; break;
    case "swissCross": s = `${cap(c(0))} with a couped ${c(1)} cross in the centre`; break;
    case "saltire": s = `${cap(c(0))} with a ${c(1)} saltire${fl.fimbriation ? ` bordered ${COLOUR_WORD[fl.fimbriation]}` : ""}`; break;
    case "saltireQuartered": s = `A ${c(1)} saltire dividing ${c(0)} triangles above and below from ${c(2)} ones at hoist and fly`; break;
    case "canton": s = `${cap(c(0))}${fl.colours.length >= 3 ? ` over ${c(2)}` : ""} with a ${c(1)} canton`; break;
    case "hoistTriangle": s = `Horizontal bands of ${listAnd(fl.colours.slice(0, fl.colours.length >= 4 ? 3 : 2).map(colourWord))} with a ${c(2)} triangle at the hoist`; break;
    case "diagonal": s = `Divided diagonally, ${c(0)} over ${c(1)}`; break;
    case "diagonalBand": s = `${cap(c(0))} and ${c(2)}, divided by a diagonal ${c(1)} band${fl.fimbriation ? ` edged ${COLOUR_WORD[fl.fimbriation]}` : ""}`; break;
    case "quartered": s = `Quartered ${c(0)} and ${c(1)}`; break;
    case "border": s = `${cap(c(0))} with a ${c(1)} border`; break;
    case "disc": s = `${cap(c(0))} with a ${c(1)} disc${fl.fimbriation ? ` ringed ${COLOUR_WORD[fl.fimbriation]}` : ""}`; break;
    case "serrated": s = `${cap(c(0))} with a serrated ${c(1)} band at the hoist`; break;
    case "pall": s = `${cap(c(0))} over ${c(2)}, a ${c(1)} pall${fl.fimbriation ? ` edged ${COLOUR_WORD[fl.fimbriation]}` : ""} and a ${COLOUR_WORD[col(fl, 3)]} triangle at the hoist`; break;
    case "rays": s = `${fl.count ?? 16} alternating ${c(0)} and ${c(1)} rays about a central disc`; break;
  }
  const dv = fl.device ? deviceText(fl.device) : "";
  const shape = fl.shape && fl.shape !== "rect" ? `; ${fl.shape === "pennant" ? "a tapering pennant" : fl.shape === "tongued" ? "swallow-tailed with a tongue" : "swallow-tailed"}` : "";
  return `${s}${dv ? `, charged with ${dv}` : ""}${shape}.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Generation

export interface FlagOptions {
  /** Derive colours and device from these arms (a realm's livery). */
  arms?: Arms;
  /** Preferred colours (overrides those from arms). */
  colours?: Tincture[];
  /** Charges to prefer for the device (canting). */
  motifs?: ChargeId[];
  style?: HeraldryStyle | StyleName;
  /** Force or forbid a device. */
  device?: boolean | "arms" | "charge" | "stars";
  /** Force a pattern. */
  pattern?: FlagPattern;
}

const PATTERN_BASE: Record<FlagPattern, number> = {
  plain: 3, bicolorH: 8, bicolorV: 4, tribandH: 10, tribandHWide: 3, tribandV: 10, centralBandV: 1.5, stripes: 3, nordic: 4,
  cross: 4, swissCross: 1.5, saltire: 2.5, saltireQuartered: 1, canton: 3, hoistTriangle: 4, diagonal: 2.5, diagonalBand: 2,
  quartered: 1.5, border: 1.5, disc: 2.5, serrated: 1.2, pall: 0.8, rays: 1.4,
};

const STYLE_PATTERNS: Record<string, Partial<Record<FlagPattern, number>>> = {
  anglo: { cross: 3, canton: 2.5, saltire: 2, stripes: 1.6 },
  french: { tribandV: 3, plain: 1.5, border: 2 },
  germanic: { tribandH: 3, bicolorH: 2.5, quartered: 1.5 },
  iberian: { tribandHWide: 4, bicolorV: 1.5, diagonal: 1.5 },
  italian: { tribandV: 2.5, bicolorV: 2, bicolorH: 2 },
  nordic: { nordic: 8, bicolorH: 1.5 },
  ecclesiastical: { swissCross: 4, cross: 3, saltire: 2, bicolorV: 2 },
  steppe: { plain: 3, disc: 3, rays: 3, serrated: 2, bicolorH: 1.5 },
  baroque: { tribandHWide: 2, tribandH: 1.5, canton: 2, quartered: 2 },
};

function contrasts(a: Tincture, b: Tincture): boolean {
  return a !== b && isMetal(a) !== isMetal(b);
}

/** Main tinctures of a coat: field first, then the most prominent charge or ordinary. */
export function liveryOf(arms: Arms): Tincture[] {
  const a = arms.kind === "simple" ? arms : (function first(m: Arms): Extract<Arms, { kind: "simple" }> {
    return m.kind === "simple" ? m : first(m.coats[0]);
  })(arms);
  const plain = (t: string): Tincture | undefined => (["or", "argent", "gules", "azure", "vert", "purpure", "sable", "tenne", "sanguine"].includes(t) ? (t as Tincture) : undefined);
  const out: Tincture[] = [];
  const push = (t?: string) => {
    const p = t ? plain(t) ?? (t === "ermine" || t === "vair" ? "argent" : t === "erminois" ? "or" : t === "ermines" || t === "pean" ? "sable" : undefined) : undefined;
    if (p && !out.includes(p)) out.push(p);
  };
  for (const t of a.field.tinctures) push(t);
  push(a.charges?.tincture);
  push(a.ordinary?.tincture);
  push(a.chief?.tincture);
  push(a.bordure?.tincture);
  push(a.semy?.tincture);
  return out;
}

function principalCharge(arms: Arms): { charge: ChargeId; attitude?: Attitude; tincture: Tincture } | undefined {
  const a = arms.kind === "simple" ? arms : undefined;
  if (!a) return arms.kind === "marshalled" ? principalCharge(arms.coats[0]) : undefined;
  const g = a.charges ?? a.ordinary?.charges ?? a.chief?.charges;
  if (!g) return undefined;
  const t = liveryOf({ ...a, field: { partition: "plain", tinctures: [g.tincture] } })[0];
  return { charge: g.charge, attitude: g.attitude, tincture: t };
}

const FLAG_TINCTURES: Tincture[] = ["gules", "argent", "azure", "or", "vert", "sable", "purpure", "tenne", "sanguine"];
const FLAG_TINT_W: Record<Tincture, number> = { gules: 30, argent: 26, azure: 22, or: 18, vert: 14, sable: 9, purpure: 2, tenne: 2, sanguine: 3 };

/** Generate a flag. Deterministic in `rng`. */
export function generateFlag(rng: Rng, opts: FlagOptions = {}): Flag {
  const st = resolveStyle(opts.style);
  const w = (t: Tincture) => FLAG_TINT_W[t] * (st.tinctures?.[t] ?? 1);
  // Colour pool: livery first.
  let pool: Tincture[] = opts.colours?.slice() ?? (opts.arms ? liveryOf(opts.arms) : []);
  pool = pool.filter((t, i) => pool.indexOf(t) === i);
  const pickNew = (ok: (t: Tincture) => boolean): Tincture => {
    const cand = FLAG_TINCTURES.filter((t) => !pool.includes(t) && ok(t));
    const t = cand.length ? rng.weighted(cand.map((c) => [c, w(c)] as [Tincture, number])) : rng.pick(FLAG_TINCTURES.filter((t) => ok(t)).concat(["argent"]));
    pool.push(t);
    return t;
  };
  while (pool.length < 2) pickNew((t) => pool.length === 0 || contrasts(t, pool[0]));
  if (pool.length > 1 && !pool.slice(1).some((t) => contrasts(t, pool[0]))) pickNew((t) => contrasts(t, pool[0]));
  // Pattern
  const sp = STYLE_PATTERNS[st.name] ?? {};
  const picked = rng.weighted(FLAG_PATTERNS.map((p) => [p, PATTERN_BASE[p] * (sp[p] ?? 1)] as [FlagPattern, number]));
  const pattern = opts.pattern ?? picked;
  const fl: Flag = { ratio: rng.weighted([[1.5, 10], [2, 5], [5 / 3, 3], [4 / 3, 1.5], [1.25, 1]] as [number, number][]), pattern, colours: [] };
  if (pattern === "swissCross") fl.ratio = rng.chance(0.5) ? 1 : 1.5;
  if (pattern === "centralBandV") fl.ratio = 2;
  if (pattern === "nordic") fl.ratio = rng.pick([1.32, 1.375, 1.5]);
  const a0 = pool[0];
  const contrastWith = (t: Tincture) => pool.find((x) => contrasts(x, t)) ?? pickNew((x) => contrasts(x, t));
  const other = (excl: Tincture[], need?: Tincture) => pool.find((x) => !excl.includes(x) && (!need || contrasts(x, need))) ?? pickNew((x) => !excl.includes(x) && (!need || contrasts(x, need)));
  switch (pattern) {
    case "plain":
    case "bicolorH":
    case "bicolorV":
    case "diagonal":
    case "quartered":
    case "border":
    case "disc":
    case "serrated":
    case "swissCross": {
      const b = contrastWith(a0);
      fl.colours = rng.chance(0.3) && pattern !== "plain" ? [b, a0] : [a0, b];
      if (pattern === "disc" && rng.chance(0.2)) fl.fimbriation = isMetal(fl.colours[0]) ? other([...fl.colours]) : "argent";
      break;
    }
    case "tribandH":
    case "tribandV":
    case "tribandHWide":
    case "centralBandV": {
      const mid = rng.chance(0.55) ? (isMetal(a0) ? a0 : contrastWith(a0)) : a0;
      const outer = mid === a0 ? contrastWith(a0) : a0;
      const third = rng.chance(0.55) ? outer : other([mid, outer], mid);
      fl.colours = [outer, mid, third];
      if (rng.chance(0.25) && fl.colours[0] !== fl.colours[2]) fl.colours = [fl.colours[2], mid, fl.colours[0]];
      break;
    }
    case "stripes": {
      const b = contrastWith(a0);
      fl.colours = [a0, b];
      fl.count = rng.pick([5, 7, 9, 9, 11, 13]);
      if (rng.chance(0.6)) fl.colours.push(other([a0, b]));
      break;
    }
    case "nordic":
    case "cross":
    case "saltire": {
      const b = contrastWith(a0);
      fl.colours = [a0, b];
      if (rng.chance(0.35)) {
        // Fimbriated: a colour cross on a colour field, edged with a metal.
        const fieldC = isMetal(a0) ? b : a0;
        const crossC = other([fieldC, "or", "argent"]);
        if (!isMetal(crossC)) {
          fl.colours = [fieldC, crossC];
          fl.fimbriation = rng.pick(["argent", "argent", "or"] as Tincture[]);
        }
      }
      break;
    }
    case "saltireQuartered": {
      const b = contrastWith(a0);
      fl.colours = [a0, b, other([a0, b], b)];
      break;
    }
    case "canton":
    case "hoistTriangle":
    case "diagonalBand":
    case "pall":
    case "rays": {
      const b = contrastWith(a0);
      const c = other([a0, b]);
      fl.colours = pattern === "rays" ? [a0, b, rng.chance(0.5) ? a0 : c] : [a0, b, c];
      if (pattern === "hoistTriangle" && rng.chance(0.3)) fl.colours = [a0, b, c, a0];
      if (pattern === "pall") fl.colours = [a0, b, c, other([a0, b, c])];
      if ((pattern === "diagonalBand" || pattern === "pall" || pattern === "hoistTriangle") && rng.chance(0.4)) {
        fl.fimbriation = isMetal(fl.colours[1]) ? other([...fl.colours]) : rng.pick(["argent", "or"] as Tincture[]);
        if (fl.fimbriation === fl.colours[1]) delete fl.fimbriation;
      }
      if (pattern === "rays") fl.count = rng.pick([12, 16, 16, 24]);
      break;
    }
  }
  if (pattern === "serrated") fl.count = rng.int(5, 9);
  // Device
  const wantDevice =
    opts.device === undefined ? rng.chance(deviceChance(pattern)) : opts.device !== false;
  if (wantDevice) fl.device = makeDevice(rng, fl, opts);
  // Shape
  if (rng.chance(0.07)) fl.shape = rng.weighted([["swallowtail", 5], ["tongued", 1.5], ["pennant", 1.5]] as [FlagShape, number][]);
  return fl;
}

function deviceChance(p: FlagPattern): number {
  switch (p) {
    case "plain": case "disc": case "canton": case "hoistTriangle": case "border": case "centralBandV": case "rays": return 0.85;
    case "swissCross": return 0;
    case "nordic": case "cross": case "saltire": case "saltireQuartered": case "stripes": return 0.12;
    default: return 0.45;
  }
}

function makeDevice(rng: Rng, fl: Flag, opts: FlagOptions): FlagDevice | undefined {
  const lay = layoutFlag(fl, FH * fl.ratio, FH);
  const bg = lay.anchor.bg;
  const kind =
    typeof opts.device === "string"
      ? opts.device
      : rng.weighted([["charge", 6], ["stars", 2.5], ["arms", opts.arms ? 2.2 : 0]] as ["charge" | "stars" | "arms", number][]);
  if (kind === "arms" && opts.arms) {
    return { arms: opts.arms, shield: rng.pick(["heater", "heater", "french", "iberian", "oval"] as ShieldShape[]) };
  }
  const tintFor = (pref?: Tincture): Tincture => {
    const ok = (t: Tincture) => bg.every((b) => contrasts(t, b));
    if (pref && ok(pref)) return pref;
    const inFlag = fl.colours.filter(ok);
    if (inFlag.length) return rng.pick(inFlag);
    const any = FLAG_TINCTURES.filter(ok);
    return any.length ? rng.pick(any) : bg.includes("argent") ? "sable" : "argent";
  };
  if (kind === "stars") {
    const n = rng.weighted([[1, 5], [3, 2], [5, 2], [7, 1.2], [9, 0.6], [12, 1]] as [number, number][]);
    const charge: ChargeId = rng.chance(0.75) ? "mullet" : "star";
    const dv: FlagDevice = { charge, count: n, tincture: tintFor(rng.chance(0.6) ? "argent" : "or") };
    if (charge === "mullet" && rng.chance(0.25)) dv.points = rng.pick([6, 7, 8]);
    if (n > 1) dv.arrangement = n >= 7 ? "ring" : rng.weighted([["ring", 2], ["row", 2], ["arc", 2], ["column", fl.pattern === "bicolorV" ? 1 : 0]] as [FlagDevice["arrangement"] & string, number][]);
    if (n === 1 && rng.chance(0.3)) dv.charge = rng.pick(["crescent", "sun", "star"] as ChargeId[]);
    return dv;
  }
  const pc = opts.arms ? principalCharge(opts.arms) : undefined;
  let charge: ChargeId;
  let attitude: Attitude | undefined;
  const motifs = (opts.motifs ?? []).filter((m) => CHARGES[m]);
  if (motifs.length && rng.chance(0.7)) charge = rng.pick(motifs);
  else if (pc && rng.chance(0.75)) {
    charge = pc.charge;
    attitude = pc.attitude;
  } else {
    charge = rng.weighted([
      ["sun", 4], ["moon", 2], ["mullet", 4], ["crescent", 3], ["eagle", 3], ["lion", 2.5], ["tree", 2], ["crossPatty", 2], ["wheel", 1.5],
      ["sword", 1.5], ["crown", 2], ["star", 2], ["horse", 1.5], ["tower", 1.5], ["key", 1], ["fleurDeLis", 1.5], ["flame", 1], ["mountain", 1], ["ship", 1],
    ] as [ChargeId, number][]);
  }
  const dv: FlagDevice = { charge, tincture: tintFor(pc?.charge === charge ? pc.tincture : undefined) };
  if (attitude) dv.attitude = attitude;
  if (bg.length > 1 || rng.chance(0.1)) {
    const discs = FLAG_TINCTURES.filter((t) => !bg.includes(t) && t !== dv.tincture && contrasts(t, dv.tincture!));
    if (discs.length) dv.disc = rng.pick(discs);
  }
  return dv;
}

export { ILLUMINATED };
