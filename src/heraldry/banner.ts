/**
 * Banners: the cloth forms on which arms and devices were carried —
 * the square banner of arms on a lance, the tailed gonfanon and the fringed
 * vexillum hung from a crossbar, the triangular pennon, the long tapering
 * swallow-tailed standard, and the tall nobori of the eastern tradition.
 * The design on the cloth is an ordinary `Arms` laid out in the cloth's
 * outline, so every partition, ordinary and charge works on every banner.
 */
import type { Rng } from "../core/rng";
import type { Tincture } from "../world/concepts";
import type { Arms, ChargeId } from "./types";
import { autoId, defsMarkup, mix, uid, type Ctx } from "./ctx";
import { f, polyD, smooth, type Pt } from "./path";
import { renderCoat, resolvePalette } from "./render";
import { clipPolyRect, type Frame } from "./shapes";
import { blazon } from "./blazon";
import { generateArms } from "./generate";
import { resolveStyle, type HeraldryStyle, type StyleName } from "./styles";
import { TINT_NAMES, type Palette } from "./tinctures";

export const BANNER_SHAPES = ["banner", "gonfanon", "vexillum", "pennon", "standard", "nobori"] as const;
export type BannerShape = (typeof BANNER_SHAPES)[number];

export const FINIALS = ["spear", "cross", "ball", "crescent", "trident", "sun", "eagle"] as const;
export type Finial = (typeof FINIALS)[number];

export interface Banner {
  shape: BannerShape;
  /** The design on the cloth. */
  arms: Arms;
  /** Tails of a gonfanon (2–5). */
  tails?: number;
  /** Fringe along the free edge. */
  fringe?: Tincture;
  /** Ornament on top of the staff. */
  finial?: Finial;
  /** Cords and tassels (vexillum, gonfanon). */
  cords?: Tincture;
}

// ---------------------------------------------------------------------------
// Geometry

interface Cloth {
  w: number;
  h: number;
  poly: Pt[];
  /** Fess point of the design. */
  fess: Pt;
  /** "hang": from a crossbar on a central staff; "staff": attached along the hoist; "nobori": hoist + top bar. */
  mount: "hang" | "staff" | "nobori";
  /** Bottom edge for the fringe (hang) or fly edge (staff). */
  fringeEdge?: [Pt, Pt];
}

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function clothOf(b: Banner): Cloth {
  switch (b.shape) {
    case "gonfanon": {
      const w = 200, h = 300, hb = 200;
      const n = Math.max(2, Math.min(5, b.tails ?? 3));
      const tw = w / n;
      const pts: Pt[] = [[0, 0], [w, 0]];
      for (let i = n - 1; i >= 0; i--) {
        const xa = i * tw, xb = (i + 1) * tw;
        const r = tw * 0.36;
        const tipY = h - r;
        pts.push([xb, i === n - 1 ? hb + 10 : hb]);
        pts.push([xb - tw * 0.06, tipY - 18]);
        pts.push(...arcPts((xa + xb) / 2, tipY, r * 1.05, 0.1, Math.PI - 0.1, 10).map(([x, y]) => [x, y + 4] as Pt));
        pts.push([xa + tw * 0.06, tipY - 18]);
      }
      pts.push([0, hb + 10]);
      return { w, h, poly: pts, fess: [w / 2, hb * 0.52], mount: "hang" };
    }
    case "vexillum": {
      const w = 200, h = 190;
      return { w, h, poly: [[0, 0], [w, 0], [w, h], [0, h]], fess: [w / 2, h * 0.5], mount: "hang", fringeEdge: [[0, h], [w, h]] };
    }
    case "pennon": {
      const w = 300, h = 150;
      return { w, h, poly: [[0, 0], [w, h * 0.47], [w, h * 0.53], [0, h]], fess: [w * 0.3, h * 0.5], mount: "staff" };
    }
    case "standard": {
      const w = 380, h = 140;
      const poly: Pt[] = [[0, 0], [w * 0.55, h * 0.08], [w, h * 0.2], [w * 0.8, h * 0.5], [w, h * 0.8], [w * 0.55, h * 0.92], [0, h]];
      return { w, h, poly, fess: [w * 0.22, h * 0.5], mount: "staff" };
    }
    case "nobori": {
      const w = 110, h = 360;
      return { w, h, poly: [[0, 0], [w, 0], [w, h], [0, h]], fess: [w / 2, h * 0.36], mount: "nobori" };
    }
    default: {
      const w = 200, h = 230;
      return { w, h, poly: [[0, 0], [w, 0], [w, h], [0, h]], fess: [w / 2, h * 0.47], mount: "staff", fringeEdge: [[w, 0], [w, h]] };
    }
  }
}

function clothFrame(c: Cloth): Frame {
  return { x: 0, y: 0, w: c.w, h: c.h, fx: c.fess[0], fy: c.fess[1], poly: c.poly, d: polyD(c.poly), u: Math.min(c.w, c.h * 0.87) / 200, rect: false };
}

// ---------------------------------------------------------------------------
// Rendering

export interface BannerRenderOptions {
  /** Output height in pixels. Default 240. */
  size?: number;
  idPrefix?: string;
  palette?: Palette | "illuminated" | "flat";
  finish?: "rich" | "flat";
  attrs?: string;
  /**
   * Draw the staff, crossbar, finial and cords (default true). With false only the
   * cloth is drawn — the compact form for small icons in lists and on maps.
   */
  staff?: boolean;
}

const STAFF_W = 9;
const FINIAL_S = 46;

/** Extents of a rendered banner in its own units (for fitting it into a box before rendering). */
export function bannerExtents(b: Banner, staff = true): { minX: number; minY: number; maxX: number; maxY: number; cx0: number; cy0: number } {
  const cloth = clothOf(b);
  if (!staff) {
    const fr = cloth.fringeEdge && b.fringe ? 14 : 0;
    const hang = cloth.mount === "hang";
    return { minX: -3, minY: -3, maxX: cloth.w + 3 + (hang ? 0 : fr), maxY: cloth.h + 3 + (hang ? fr : 0), cx0: 0, cy0: 0 };
  }
  if (cloth.mount === "hang") {
    return { minX: -14, maxX: cloth.w + 14, minY: -FINIAL_S - 30 - (b.cords ? 40 : 0), maxY: cloth.h + 70 + (cloth.fringeEdge ? 14 : 0), cx0: 0, cy0: 0 };
  }
  if (cloth.mount === "staff") {
    const cx0 = STAFF_W / 2, cy0 = 18;
    return { minX: -STAFF_W, maxX: cx0 + cloth.w + (cloth.fringeEdge ? 18 : 6), minY: -FINIAL_S - 4, maxY: cy0 + cloth.h + Math.max(80, cloth.h * 0.4), cx0, cy0 };
  }
  const cx0 = STAFF_W / 2, cy0 = 16;
  return { minX: -STAFF_W, maxX: cx0 + cloth.w + 14, minY: -FINIAL_S - 4, maxY: cy0 + cloth.h + 60, cx0, cy0 };
}

/** Width / height of a rendered banner. */
export function bannerAspect(b: Banner, staff = true): number {
  const e = bannerExtents(b, staff);
  return (e.maxX - e.minX) / (e.maxY - e.minY);
}

function gold(ctx: Ctx): string {
  const id = uid(ctx, "gold");
  const p = ctx.pal.tinctures.or;
  ctx.defs.set(id, `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.dark}"/><stop offset=".45" stop-color="${p.light}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient>`);
  return `url(#${id})`;
}

function wood(ctx: Ctx, horizontal = false): string {
  const id = uid(ctx, "wood");
  const c = ctx.pal.proper.wood;
  ctx.defs.set(
    id,
    `<linearGradient id="${id}" x1="0" y1="0" x2="${horizontal ? 0 : 1}" y2="${horizontal ? 1 : 0}"><stop offset="0" stop-color="${mix(c, "#000000", 0.45)}"/><stop offset=".4" stop-color="${mix(c, "#ffffff", 0.25)}"/><stop offset="1" stop-color="${mix(c, "#000000", 0.5)}"/></linearGradient>`,
  );
  return `url(#${id})`;
}

function finialSVG(ctx: Ctx, kind: Finial, x: number, y: number, s: number): string {
  const g = gold(ctx);
  const st = `stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 1.2)}" stroke-linejoin="round"`;
  const P = (pts: [number, number][]) => polyD(pts.map(([u, v]) => [x + u * s, y + v * s] as Pt));
  const knob = `<ellipse cx="${f(x)}" cy="${f(y + 0.04 * s)}" rx="${f(0.16 * s)}" ry="${f(0.09 * s)}" fill="${g}" ${st}/>`;
  switch (kind) {
    case "cross":
      return knob + `<path d="${P([[-0.06, 0], [-0.06, -0.5], [-0.22, -0.5], [-0.22, -0.62], [-0.06, -0.62], [-0.06, -0.8], [0.06, -0.8], [0.06, -0.62], [0.22, -0.62], [0.22, -0.5], [0.06, -0.5], [0.06, 0]])}" fill="${g}" ${st}/>`;
    case "ball":
      return knob + `<circle cx="${f(x)}" cy="${f(y - 0.2 * s)}" r="${f(0.19 * s)}" fill="${g}" ${st}/>`;
    case "crescent": {
      const r = 0.3 * s;
      const d = `M${f(x - r)} ${f(y - 0.55 * s)}A${f(r)} ${f(r)} 0 0 0 ${f(x + r)} ${f(y - 0.55 * s)}A${f(r * 0.78)} ${f(r * 0.86)} 0 0 1 ${f(x - r)} ${f(y - 0.55 * s)}Z`;
      return knob + `<path d="${P([[-0.04, 0], [-0.04, -0.3], [0.04, -0.3], [0.04, 0]])}" fill="${g}" ${st}/><path d="${d}" fill="${g}" ${st}/>`;
    }
    case "trident":
      return (
        knob +
        `<path d="${P([[-0.05, 0], [-0.05, -0.32], [-0.26, -0.36], [-0.3, -0.72], [-0.22, -0.56], [-0.18, -0.44], [-0.05, -0.42], [-0.05, -0.62], [0, -0.86], [0.05, -0.62], [0.05, -0.42], [0.18, -0.44], [0.22, -0.56], [0.3, -0.72], [0.26, -0.36], [0.05, -0.32], [0.05, 0]])}" fill="${g}" ${st}/>`
      );
    case "sun": {
      let d = "";
      const cx = x, cy = y - 0.36 * s;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, a1 = a + Math.PI / 12, a2 = a - Math.PI / 12;
        const R = i % 2 ? 0.3 : 0.36;
        d += polyD([[cx + Math.cos(a2) * 0.14 * s, cy + Math.sin(a2) * 0.14 * s], [cx + Math.cos(a) * R * s, cy + Math.sin(a) * R * s], [cx + Math.cos(a1) * 0.14 * s, cy + Math.sin(a1) * 0.14 * s]]);
      }
      return knob + `<path d="${P([[-0.04, 0], [-0.04, -0.12], [0.04, -0.12], [0.04, 0]])}" fill="${g}" ${st}/><path d="${d}" fill="${g}" ${st}/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(0.16 * s)}" fill="${g}" ${st}/>`;
    }
    case "eagle": {
      // a small gilt eagle with raised wings
      const d =
        P([[-0.05, 0], [-0.1, -0.2], [-0.42, -0.32], [-0.46, -0.62], [-0.3, -0.44], [-0.14, -0.4], [-0.08, -0.5], [-0.14, -0.58], [-0.04, -0.66], [0.04, -0.6], [0.08, -0.5], [0.14, -0.4], [0.3, -0.44], [0.46, -0.62], [0.42, -0.32], [0.1, -0.2], [0.05, 0]]);
      return knob + `<path d="${d}" fill="${g}" ${st}/>`;
    }
    default:
      return (
        knob +
        `<path d="${smooth([[x - 0.05 * s, y], [x - 0.13 * s, y - 0.25 * s], [x - 0.11 * s, y - 0.5 * s], [x, y - 0.95 * s, 1], [x + 0.11 * s, y - 0.5 * s], [x + 0.13 * s, y - 0.25 * s], [x + 0.05 * s, y]], true)}" fill="${g}" ${st}/>` +
        `<path d="M${f(x)} ${f(y - 0.1 * s)}L${f(x)} ${f(y - 0.8 * s)}" stroke="${ctx.pal.contour}" stroke-opacity=".45" stroke-width="${f(ctx.ow)}"/>`
      );
  }
}

function fringeSVG(ctx: Ctx, a: Pt, b: Pt, t: Tincture, len: number): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;
  const nx = uy, ny = -ux; // outward for a top→bottom fly edge or left→right bottom edge is (uy, -ux) flipped below
  const out: Pt = [-nx, -ny];
  const p = ctx.pal.tinctures[t];
  const n = Math.round(L / 4.2);
  let strands = "";
  for (let i = 0; i <= n; i++) {
    const x = a[0] + (dx * i) / n, y = a[1] + (dy * i) / n;
    strands += `M${f(x)} ${f(y)}l${f(out[0] * len)} ${f(out[1] * len)}`;
  }
  const bandW = len * 0.32;
  const bandPoly = polyD([a, b, [b[0] + out[0] * bandW, b[1] + out[1] * bandW], [a[0] + out[0] * bandW, a[1] + out[1] * bandW]]);
  return (
    `<path d="${strands}" stroke="${ctx.pal.contour}" stroke-width="${f(2.6)}" stroke-linecap="round"/>` +
    `<path d="${strands}" stroke="${p.base}" stroke-width="${f(1.6)}" stroke-linecap="round"/>` +
    `<path d="${bandPoly}" fill="${p.dark}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow)}"/>`
  );
}

function tassel(ctx: Ctx, x: number, y: number, t: Tincture, s: number): string {
  const p = ctx.pal.tinctures[t];
  const d = smooth([[x, y], [x + 0.16 * s, y + 0.3 * s], [x + 0.22 * s, y + 0.95 * s, 1], [x - 0.22 * s, y + 0.95 * s, 1], [x - 0.16 * s, y + 0.3 * s]], true);
  return (
    `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.12 * s)}" fill="${p.base}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow)}"/>` +
    `<path d="${d}" fill="${p.base}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow)}"/>` +
    `<path d="M${f(x - 0.1 * s)} ${f(y + 0.4 * s)}L${f(x - 0.12 * s)} ${f(y + 0.9 * s)}M${f(x + 0.08 * s)} ${f(y + 0.4 * s)}L${f(x + 0.1 * s)} ${f(y + 0.9 * s)}" stroke="${p.dark}" stroke-width="${f(ctx.ow)}"/>`
  );
}

export function renderBannerSVG(input: Banner | Arms, opts: BannerRenderOptions = {}): string {
  const b: Banner = "shape" in input && "arms" in input ? input : { shape: "banner", arms: input as Arms, finial: "spear" };
  const cloth = clothOf(b);
  const pal = resolvePalette(opts.palette);
  const staffW = STAFF_W;
  const withStaff = opts.staff !== false;
  // Layout of the whole object in banner units.
  let parts = "";
  const size = opts.size ?? 240;
  const finS = FINIAL_S;
  const { minX, minY, maxX, maxY, cx0, cy0 } = bannerExtents(b, withStaff);
  const vw = maxX - minX, vh = maxY - minY;
  const px = size / vh;
  const ctx: Ctx = {
    id: opts.idPrefix ?? autoId(),
    pal,
    defs: new Map(),
    ids: new Map(),
    n: 0,
    px,
    ow: Math.max(0.6, Math.min(1.6, 0.45 + size / 380)) / px,
    shading: (opts.finish ?? "rich") === "rich",
  };
  const fr = clothFrame(cloth);
  const clip = uid(ctx, "cl");
  ctx.defs.set(clip, `<clipPath id="${clip}"><path d="${fr.d}"/></clipPath>`);
  let design: string;
  if (b.shape === "pennon" || b.shape === "standard") {
    // Long cloths: the field runs the whole length; the full arms sit in a panel at the hoist.
    const first = (a: Arms): Extract<Arms, { kind: "simple" }> => (a.kind === "simple" ? a : first(a.coats[0]));
    const fly: Arms = { kind: "simple", field: first(b.arms).field };
    const flyFr: Frame = { ...fr, fx: cloth.w * 0.62, fy: cloth.h / 2, u: cloth.h / 200 };
    const ph = cloth.h;
    const panelPoly = clipPolyRect(cloth.poly, 0, 0, ph, cloth.h);
    const panel: Frame = { x: 0, y: 0, w: ph, h: cloth.h, fx: ph / 2, fy: cloth.h / 2, poly: panelPoly, d: polyD(panelPoly), u: ph / 200, rect: false };
    const pclip = uid(ctx, "pn");
    ctx.defs.set(pclip, `<clipPath id="${pclip}"><path d="${panel.d}"/></clipPath>`);
    design =
      renderCoat(fly, flyFr, ctx) +
      `<g clip-path="url(#${pclip})">${renderCoat(b.arms, panel, ctx)}</g>` +
      `<path d="M${f(ph)} -5V${f(cloth.h + 5)}" stroke="${pal.contour}" stroke-width="${f(ctx.ow * 1.6)}"/>`;
  } else design = renderCoat(b.arms, fr, ctx);
  if (ctx.shading) {
    const g = uid(ctx, "fold");
    const folds = cloth.mount === "hang" || cloth.mount === "nobori";
    const stops = folds
      ? [[0, "#000", 0.16], [0.12, "#fff", 0.14], [0.27, "#000", 0.1], [0.42, "#fff", 0.16], [0.58, "#000", 0.12], [0.74, "#fff", 0.14], [0.88, "#000", 0.08], [1, "#000", 0.2]]
      : [[0, "#000", 0.14], [0.1, "#fff", 0.16], [0.24, "#000", 0.08], [0.4, "#fff", 0.12], [0.57, "#000", 0.12], [0.75, "#fff", 0.1], [1, "#000", 0.14]];
    ctx.defs.set(
      g,
      `<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${f(cloth.w)}" y2="${f(cloth.w * 0.08)}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`,
    );
    const top = uid(ctx, "top");
    ctx.defs.set(top, `<linearGradient id="${top}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".07" stop-color="#000" stop-opacity="0"/></linearGradient>`);
    design += `<path d="${fr.d}" fill="url(#${g})"/><path d="${fr.d}" fill="url(#${top})"/>`;
  }
  const clothSVG =
    `<g transform="translate(${f(cx0)} ${f(cy0)})">` +
    `<g clip-path="url(#${clip})">${design}</g>` +
    (b.fringe && cloth.fringeEdge ? fringeSVG(ctx, cloth.fringeEdge[0], cloth.fringeEdge[1], b.fringe, 13) : "") +
    `<path d="${fr.d}" fill="none" stroke="${pal.contour}" stroke-width="${f(ctx.ow * 1.6)}" stroke-linejoin="round"/></g>`;
  const st = `stroke="${pal.contour}" stroke-width="${f(ctx.ow * 1.2)}"`;
  const fin = b.finial ?? "spear";
  if (!withStaff) {
    parts += clothSVG;
  } else if (cloth.mount === "hang") {
    const sx = cloth.w / 2;
    const barY = -6;
    const top = barY - (b.cords ? 40 : 18);
    parts += `<rect x="${f(sx - staffW / 2)}" y="${f(top)}" width="${staffW}" height="${f(maxY - top)}" fill="${wood(ctx)}" ${st}/>`;
    if (b.cords) {
      const c = pal.tinctures[b.cords];
      parts += `<path d="M${f(-6)} ${f(barY)}L${f(sx)} ${f(top + 4)}L${f(cloth.w + 6)} ${f(barY)}" fill="none" stroke="${pal.contour}" stroke-width="${f(3.2)}"/><path d="M${f(-6)} ${f(barY)}L${f(sx)} ${f(top + 4)}L${f(cloth.w + 6)} ${f(barY)}" fill="none" stroke="${c.base}" stroke-width="${f(2)}"/>`;
    }
    parts += clothSVG;
    parts += `<rect x="-12" y="${f(barY - 4)}" width="${f(cloth.w + 24)}" height="8" rx="3" fill="${wood(ctx, true)}" ${st}/>`;
    parts += `<circle cx="-12" cy="${f(barY)}" r="5.5" fill="${gold(ctx)}" ${st}/><circle cx="${f(cloth.w + 12)}" cy="${f(barY)}" r="5.5" fill="${gold(ctx)}" ${st}/>`;
    if (b.cords) parts += tassel(ctx, -10, barY + 6, b.cords, 34) + tassel(ctx, cloth.w + 10, barY + 6, b.cords, 34);
    parts += finialSVG(ctx, fin, sx, top, finS);
  } else {
    const top = -2;
    parts += `<rect x="${f(-staffW / 2)}" y="${f(top)}" width="${staffW}" height="${f(maxY - top)}" fill="${wood(ctx)}" ${st}/>`;
    if (cloth.mount === "nobori") {
      parts += `<rect x="${f(-staffW / 2)}" y="${f(cy0 - 7)}" width="${f(cloth.w + staffW + 4)}" height="6" rx="2" fill="${wood(ctx, true)}" ${st}/>`;
    }
    parts += clothSVG;
    // lashings along the hoist
    const n = Math.max(3, Math.round(cloth.h / 40));
    for (let i = 0; i < n; i++) {
      const yy = cy0 + ((i + 0.5) * cloth.h) / n;
      parts += `<rect x="${f(-staffW / 2 - 1)}" y="${f(yy - 2.2)}" width="${f(staffW + 6)}" height="4.4" rx="2" fill="${pal.tinctures.or.dark}" ${st}/>`;
    }
    parts += finialSVG(ctx, fin, 0, top, finS);
  }
  const width = (size * vw) / vh;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(minX)} ${f(minY)} ${f(vw)} ${f(vh)}" width="${f(width)}" height="${f(size)}"${opts.attrs ? " " + opts.attrs : ""}>` +
    defsMarkup(ctx) +
    parts +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Description & generation

const SHAPE_NAME: Record<BannerShape, string> = {
  banner: "A banner",
  gonfanon: "A gonfanon",
  vexillum: "A vexillum",
  pennon: "A pennon",
  standard: "A standard",
  nobori: "A nobori",
};

export function describeBanner(b: Banner): string {
  let s = SHAPE_NAME[b.shape];
  if (b.shape === "gonfanon") s += ` of ${["", "", "two", "three", "four", "five"][Math.max(2, Math.min(5, b.tails ?? 3))]} tails`;
  const extras: string[] = [];
  if (b.fringe) extras.push(`fringed ${TINT_NAMES[b.fringe]}`);
  if (b.cords) extras.push(`corded ${TINT_NAMES[b.cords]}`);
  if (b.finial && b.finial !== "spear") extras.push(`on a staff headed with ${b.finial === "eagle" ? "an eagle" : `a ${b.finial}`}`);
  return `${s}${extras.length ? ", " + extras.join(", ") : ""}: ${blazon(b.arms)}`;
}

export interface BannerOptions {
  style?: HeraldryStyle | StyleName;
  motifs?: ChargeId[];
  colours?: Tincture[];
  /** Use these arms on the cloth instead of generating a design. */
  arms?: Arms;
  shape?: BannerShape;
}

const SHAPE_W: Record<string, Partial<Record<BannerShape, number>>> = {
  steppe: { standard: 3, pennon: 4, gonfanon: 2, nobori: 1 },
  nordic: { gonfanon: 3, pennon: 2, banner: 1.5 },
  ecclesiastical: { gonfanon: 4, vexillum: 3 },
  italian: { gonfanon: 3, vexillum: 1.5 },
};

/**
 * A banner for a tradition that carries its emblems on cloth rather than
 * shields (or a realm's war banner when `arms` is given).
 */
export function generateBanner(rng: Rng, opts: BannerOptions = {}): Banner {
  const st = resolveStyle(opts.style);
  const sw = SHAPE_W[st.name] ?? {};
  const shape =
    opts.shape ??
    rng.weighted(([["banner", 3], ["gonfanon", 3], ["vexillum", 2], ["pennon", 2], ["standard", 1.5], ["nobori", 1.2]] as [BannerShape, number][]).map(([k, v]) => [k, v * (sw[k] ?? 1)] as [BannerShape, number]));
  // Cloths favour bold, simple designs: fewer additions, more divided fields and single charges.
  const clothStyle: HeraldryStyle = {
    ...st,
    complexity: Math.min(st.complexity, 0.35),
    plans: { ...st.plans, charges: (st.plans?.charges ?? 1) * 1.4, semy: 0.3, variation: (st.plans?.variation ?? 1) * 1.2 },
    bordure: (st.bordure ?? 1) * 0.4,
    canton: (st.canton ?? 1) * 0.3,
  };
  const arms = opts.arms ?? generateArms(rng.fork("cloth"), { style: clothStyle, motifs: opts.motifs, colours: opts.colours });
  const b: Banner = { shape, arms };
  if (shape === "gonfanon") b.tails = rng.weighted([[3, 6], [2, 2], [4, 2], [5, 1]] as [number, number][]);
  if ((shape === "vexillum" || shape === "banner") && rng.chance(shape === "vexillum" ? 0.85 : 0.35)) b.fringe = rng.pick(["or", "or", "argent"] as Tincture[]);
  if ((shape === "vexillum" || shape === "gonfanon") && rng.chance(0.55)) b.cords = rng.pick(["or", "gules", "argent"] as Tincture[]);
  const finW: Record<string, Partial<Record<Finial, number>>> = {
    ecclesiastical: { cross: 8 },
    steppe: { crescent: 4, trident: 3, sun: 2 },
    nordic: { spear: 4 },
    germanic: { eagle: 2 },
  };
  const fw = finW[st.name] ?? {};
  b.finial = rng.weighted(([["spear", 5], ["cross", 1.2], ["ball", 1.5], ["crescent", 0.8], ["trident", 0.5], ["sun", 0.7], ["eagle", 0.6]] as [Finial, number][]).map(([k, v]) => [k, v * (fw[k] ?? 1)] as [Finial, number]));
  return b;
}
