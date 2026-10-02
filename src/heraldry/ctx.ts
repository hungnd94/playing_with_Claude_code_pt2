/**
 * Per-SVG render context: unique ids, <defs> collection, and paint lookup for
 * tinctures (metal gradients, fur patterns, flat colours).
 */
import type { Tint } from "./types";
import { FUR_PARTS, isFur, type Palette } from "./tinctures";
import { f, type BBox } from "./path";

export interface Ctx {
  id: string;
  pal: Palette;
  defs: Map<string, string>;
  n: number;
  /** Pixels per shield unit (for deciding how much detail to draw). */
  px: number;
  /** Outline width in shield units. */
  ow: number;
  /** Paint metals with gradients. */
  shading: boolean;
}

let globalCounter = 0;

/** A fresh id prefix (used when the caller gives none). */
export function autoId(): string {
  globalCounter = (globalCounter + 1) % 1e9;
  return `hz${globalCounter.toString(36)}`;
}

export function uid(ctx: Ctx, tag: string): string {
  return `${ctx.id}-${tag}${(ctx.n++).toString(36)}`;
}

export function defsMarkup(ctx: Ctx): string {
  let s = "";
  for (const v of ctx.defs.values()) s += v;
  return s ? `<defs>${s}</defs>` : "";
}

/** Fill for a large region (field, ordinary): metals get a soft diagonal sheen. */
export function regionFill(ctx: Ctx, t: Tint, furScale = 1): string {
  if (isFur(t)) return `url(#${furPattern(ctx, t, furScale)})`;
  const paint = ctx.pal.tinctures[t];
  if (!ctx.shading || (t !== "or" && t !== "argent")) return paint.base;
  const key = `rg-${t}`;
  const id = `${ctx.id}-${key}`;
  if (!ctx.defs.has(key)) {
    const k = ctx.pal.metalSheen;
    const mid = t === "or" ? 0.5 : 0.55;
    ctx.defs.set(
      key,
      `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${mix(paint.base, paint.light, 0.75 * k)}"/>` +
        `<stop offset="${mid}" stop-color="${paint.base}"/>` +
        `<stop offset="1" stop-color="${mix(paint.base, paint.dark, 0.7 * k)}"/></linearGradient>`,
    );
  }
  return `url(#${id})`;
}

/** Fill for a charge, in the charge's own coordinate box (userSpaceOnUse so all parts share one sweep). */
export function chargeFill(ctx: Ctx, t: Tint, box: BBox): string {
  if (isFur(t)) return `url(#${furPattern(ctx, t, (box.x1 - box.x0) / 160)})`;
  const paint = ctx.pal.tinctures[t];
  if (!ctx.shading) return paint.base;
  const metal = t === "or" || t === "argent";
  const key = `cg-${t}-${Math.round(box.x0)}-${Math.round(box.y0)}-${Math.round(box.x1)}-${Math.round(box.y1)}`;
  const id = `${ctx.id}-${key}`;
  if (!ctx.defs.has(key)) {
    const k = metal ? ctx.pal.metalSheen : ctx.pal.metalSheen * 0.45;
    const stops = metal
      ? `<stop offset="0" stop-color="${mix(paint.base, paint.light, 0.85 * k)}"/><stop offset=".45" stop-color="${paint.base}"/><stop offset="1" stop-color="${mix(paint.base, paint.dark, 0.85 * k)}"/>`
      : `<stop offset="0" stop-color="${mix(paint.base, paint.light, 0.7 * k)}"/><stop offset=".5" stop-color="${paint.base}"/><stop offset="1" stop-color="${mix(paint.base, paint.dark, 0.7 * k)}"/>`;
    ctx.defs.set(
      key,
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(box.x0)}" y1="${f(box.y0)}" x2="${f(box.x1)}" y2="${f(box.y1)}">${stops}</linearGradient>`,
    );
  }
  return `url(#${id})`;
}

export function flatColor(ctx: Ctx, t: Tint): string {
  return ctx.pal.tinctures[isFur(t) ? FUR_PARTS[t][0] : t].base;
}

/** Contour colour to use for detail lines on a given tincture. */
export function detailColor(ctx: Ctx, t: Tint): string {
  const dark = t === "sable" || t === "ermines" || t === "pean";
  return dark ? ctx.pal.contourOnDark : ctx.pal.contour;
}

// ---------------------------------------------------------------------------
// Furs

const ERMINE_SPOT =
  "M0 -2.2C.5 1 1.6 3.4 3.4 5.9L1.3 5.1L0 7.6L-1.3 5.1L-3.4 5.9C-1.6 3.4 -.5 1 0 -2.2Z" +
  "M0 -5.4a1.25 1.25 0 1 1 0 2.5a1.25 1.25 0 1 1 0 -2.5Z" +
  "M-2.1 -3.4a1.1 1.1 0 1 1 0 2.2a1.1 1.1 0 1 1 0 -2.2Z" +
  "M2.1 -3.4a1.1 1.1 0 1 1 0 2.2a1.1 1.1 0 1 1 0 -2.2Z";

export function furPattern(ctx: Ctx, fur: Tint, scale: number): string {
  const s = Math.max(0.15, Math.round(scale * 20) / 20);
  const key = `fur-${fur}-${s}`;
  const id = `${ctx.id}-${key.replace(".", "_")}`;
  if (ctx.defs.has(key)) return id;
  const [a, b] = FUR_PARTS[fur as keyof typeof FUR_PARTS];
  const ca = ctx.pal.tinctures[a].base, cb = ctx.pal.tinctures[b].base;
  let body = "";
  let w = 0, h = 0;
  if (fur === "ermine" || fur === "ermines" || fur === "erminois" || fur === "pean") {
    w = 30 * s; h = 34 * s;
    const k = 1.75 * s;
    body =
      `<rect width="${f(w)}" height="${f(h)}" fill="${ca}"/>` +
      `<path d="${ERMINE_SPOT}" fill="${cb}" transform="translate(${f(w * 0.25)} ${f(h * 0.25)}) scale(${f(k)})"/>` +
      `<path d="${ERMINE_SPOT}" fill="${cb}" transform="translate(${f(w * 0.75)} ${f(h * 0.75)}) scale(${f(k)})"/>`;
  } else if (fur === "vair" || fur === "countervair") {
    w = 30 * s; h = 50 * s;
    const bell = (x: number, y: number, bw: number, bh: number, up: boolean) => {
      const pts = up
        ? [[0, 1], [0.1, 0.62], [0.1, 0.3], [0.5, 0], [0.9, 0.3], [0.9, 0.62], [1, 1]]
        : [[0, 0], [0.1, 0.38], [0.1, 0.7], [0.5, 1], [0.9, 0.7], [0.9, 0.38], [1, 0]];
      return "M" + pts.map(([px, py]) => `${f(x + px * bw)} ${f(y + py * bh)}`).join("L") + "Z";
    };
    const rowH = h / 2;
    let d = bell(0, 0, w, rowH, true);
    if (fur === "vair") d += bell(-w / 2, rowH, w, rowH, true) + bell(w / 2, rowH, w, rowH, true);
    else d += bell(0, rowH, w, rowH, false);
    body = `<rect width="${f(w)}" height="${f(h)}" fill="${ca}"/><path d="${d}" fill="${cb}"/>`;
  } else {
    // potent
    w = 33.4 * s; h = 33.4 * s;
    const r = h / 2;
    const T = (x: number, y: number, up: boolean) => {
      const pts = up
        ? [[0, 1], [0, 0.5], [0.25, 0.5], [0.25, 0], [0.75, 0], [0.75, 0.5], [1, 0.5], [1, 1]]
        : [[0, 0], [0, 0.5], [0.25, 0.5], [0.25, 1], [0.75, 1], [0.75, 0.5], [1, 0.5], [1, 0]];
      return "M" + pts.map(([px, py]) => `${f(x + px * w)} ${f(y + py * r)}`).join("L") + "Z";
    };
    const d = T(0, 0, true) + T(-w / 2, r, true) + T(w / 2, r, true);
    body = `<rect width="${f(w)}" height="${f(h)}" fill="${ca}"/><path d="${d}" fill="${cb}"/>`;
  }
  ctx.defs.set(key, `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f(w)}" height="${f(h)}">${body}</pattern>`);
  return id;
}

// ---------------------------------------------------------------------------

export function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return "#" + [r, g, bl].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}
function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  const v = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
