/**
 * Placing charge artwork outside the shield renderer: flags, banners, mon,
 * seals and stand-alone charge icons all need "draw this charge, painted like
 * so, centred here at this size". Artwork is emitted once into <defs> per
 * (charge, paint, scale) and instanced with <use>.
 */
import type { Attitude, ChargeId, Tint } from "./types";
import { chargeArt } from "./charges/index";
import { paintCharge, type ChargePaint } from "./charges/paint";
import { autoId, chargeFill, defsMarkup, detailColor, uid, type Ctx } from "./ctx";
import { f, type BBox } from "./path";
import { ILLUMINATED, PALETTES, type Palette } from "./tinctures";
import { chargeDef } from "./charges/index";

export interface ChargeSpec {
  charge: ChargeId;
  attitude?: Attitude;
  points?: number;
  pierced?: boolean;
  /** Face sinister. */
  reversed?: boolean;
  /** Upside down. */
  inverted?: boolean;
}

export interface Placement {
  x: number;
  y: number;
  /** Size of the square cell the charge must fit in. */
  s: number;
  rot?: number;
  flip?: boolean;
}

/** Scale that fits a charge's box into a cell of size s (same rule as the shield renderer). */
export function fitScale(box: BBox, s: number): number {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const cw = s * Math.max(0.42, Math.min(1.6, bw / bh));
  return Math.min(cw / bw, s / bh) * 0.97;
}

/**
 * Draw a charge at each placement with an explicit paint. `paintKey` must
 * identify the paint uniquely (it is used to share one <defs> entry).
 */
export function placeCharge(ctx: Ctx, spec: ChargeSpec, paint: (k: number, box: BBox) => ChargePaint, paintKey: string, at: Placement[]): string {
  const { art, box } = chargeArt(spec.charge, { attitude: spec.attitude, points: spec.points, pierced: spec.pierced });
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  let s = "";
  for (const p of at) {
    const k = fitScale(box, p.s);
    const key = `pc|${spec.charge}|${spec.attitude ?? ""}|${spec.points ?? ""}|${spec.pierced ? 1 : 0}|${paintKey}|${f(k)}`;
    let id = ctx.ids.get(key);
    if (!id) {
      id = uid(ctx, "p");
      ctx.defs.set(key, `<g id="${id}">${paintCharge(art, paint(k, box))}</g>`);
      ctx.ids.set(key, id);
    }
    const fx = (spec.reversed ? -1 : 1) * (p.flip ? -1 : 1);
    const fy = spec.inverted ? -1 : 1;
    const rot = p.rot ? ` rotate(${f(p.rot)})` : "";
    s += `<use href="#${id}" transform="translate(${f(p.x)} ${f(p.y)})${rot} scale(${f(k * fx)} ${f(k * fy)}) translate(${f(-cx)} ${f(-cy)})"/>`;
  }
  return s;
}

/** Paint for a charge in heraldic colours (tincture body, conventional accents, contour outline). */
export function heraldicPaint(ctx: Ctx, t: Tint, accent: Tint, opts: { crowned?: Tint; detail?: boolean } = {}) {
  return (k: number, box: BBox): ChargePaint => {
    const px = k * ctx.px * Math.max(box.x1 - box.x0, box.y1 - box.y0);
    return {
      body: chargeFill(ctx, t, box, k),
      accent: chargeFill(ctx, accent, box, k),
      crown: opts.crowned ? chargeFill(ctx, opts.crowned, box, k) : "",
      contour: ctx.pal.contour,
      detail: detailColor(ctx, t),
      outlineW: ctx.ow / k,
      lineK: Math.max(0.7, Math.min(1.25, 60 / px + 0.6)),
      detailOn: (opts.detail ?? true) && px > 22,
    };
  };
}

/**
 * Monochrome paint: the whole charge in one colour, interior lines cut out in
 * the ground colour (the look of mon, stencils, stamps and flag devices).
 */
export function monoPaint(ctx: Ctx, ink: string, ground: string, opts: { outline?: string; lineK?: number } = {}) {
  return (k: number, box: BBox): ChargePaint => {
    const px = k * ctx.px * Math.max(box.x1 - box.x0, box.y1 - box.y0);
    return {
      body: ink,
      accent: ink,
      crown: ink,
      contour: opts.outline ?? ink,
      detail: ground,
      outlineW: opts.outline ? ctx.ow / k : 0.0001,
      lineK: (opts.lineK ?? 1) * Math.max(0.8, Math.min(1.4, 60 / px + 0.7)),
      detailOn: px > 26,
      tone: false,
    };
  };
}

export interface ChargeIconOptions extends ChargeSpec {
  tincture?: Tint;
  /** Background: a tincture for a rounded tile / disc, or none. */
  field?: Tint;
  /** "tile" (rounded square), "disc", or "none". Default "none" (or "tile" when field is set). */
  frame?: "tile" | "disc" | "none";
  size?: number;
  idPrefix?: string;
  palette?: Palette | "illuminated" | "flat";
  finish?: "rich" | "flat";
  attrs?: string;
}

/** A single charge as a stand-alone SVG icon (religious symbols, legends, pickers). */
export function renderChargeSVG(opts: ChargeIconOptions): string {
  const size = opts.size ?? 64;
  const pal = typeof opts.palette === "string" ? PALETTES[opts.palette] ?? ILLUMINATED : opts.palette ?? ILLUMINATED;
  const V = 100;
  const ctx: Ctx = {
    id: opts.idPrefix ?? autoId(),
    pal,
    defs: new Map(),
    ids: new Map(),
    n: 0,
    px: size / V,
    ow: Math.max(0.6, Math.min(1.5, 0.45 + size / 320)) / (size / V),
    shading: (opts.finish ?? "rich") === "rich",
  };
  const t = opts.tincture ?? "or";
  const def = chargeDef(opts.charge);
  const conv = def.accentDefault;
  const accent: Tint = !conv || conv === "same" ? t : conv === "gules" ? (t === "gules" || opts.field === "gules" ? "azure" : "gules") : conv;
  const frame = opts.frame ?? (opts.field ? "tile" : "none");
  let bg = "";
  if (opts.field && frame !== "none") {
    const fill = pal.tinctures[opts.field in pal.tinctures ? (opts.field as keyof typeof pal.tinctures) : "argent"].base;
    bg =
      frame === "disc"
        ? `<circle cx="50" cy="50" r="48.5" fill="${fill}" stroke="${pal.contour}" stroke-width="${f(ctx.ow * 1.4)}"/>`
        : `<rect x="1.5" y="1.5" width="97" height="97" rx="14" fill="${fill}" stroke="${pal.contour}" stroke-width="${f(ctx.ow * 1.4)}"/>`;
  }
  const cell = frame === "disc" ? 66 : frame === "tile" ? 76 : 92;
  const body = placeCharge(ctx, opts, heraldicPaint(ctx, t, accent), `h-${t}-${accent}`, [{ x: 50, y: 50, s: cell }]);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${f(size)}" height="${f(size)}"${opts.attrs ? " " + opts.attrs : ""}>` +
    defsMarkup(ctx) +
    bg +
    body +
    `</svg>`
  );
}
