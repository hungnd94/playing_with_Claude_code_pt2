/**
 * Arms → SVG.
 *
 * `renderArmsSVG(arms, opts)` draws a coat on a shield of the chosen shape
 * with an optional rich finish (metal gradients, sheen, vignette, texture).
 * Every id in the output is prefixed with `idPrefix` (or an automatic unique
 * prefix), so any number of shields can live on one page.
 */
import type { Arms, ChargeGroup, Difference, MarshalledArms, Ordinary, ShieldShape, SimpleArms, Tint } from "./types";
import { chargeArt, chargeDef } from "./charges/index";
import { paintCharge } from "./charges/paint";
import { autoId, chargeFill, defsMarkup, detailColor, regionFill, uid, type Ctx } from "./ctx";
import { bendDir, bordureWidth, cantonBox, chiefHeight, chiefPoly, divideField, ordinaryShape } from "./geometry";
import { aroundSlots, betweenSlots, bordureSlots, chiefSlots, fieldSlots, onOrdinarySlots, rows, type ChargeShape, type Slot } from "./layout";
import { patternLine } from "./lines";
import { circleD, f, polyD, resampleClosed, type Pt } from "./path";
import { insetPoly, rectFrame, SHAPES, shapeFrame, subFrame, type Frame } from "./shapes";
import { ILLUMINATED, PALETTES, isMetal, type Palette } from "./tinctures";

export interface RenderOptions {
  shape?: ShieldShape;
  /** Output width in pixels (height follows the shape). Default 200. */
  size?: number;
  /** Prefix for every id in the SVG. Default: an automatic unique prefix. */
  idPrefix?: string;
  palette?: Palette | "illuminated" | "flat";
  /**
   * "rich": gradients, sheen and vignette. "flat": plain tinctures.
   * "hatched": engraved line-art with Petra Sancta hatching. Default "rich".
   */
  finish?: "rich" | "flat" | "hatched";
  /** Ink and paper colours for the hatched finish. */
  ink?: string;
  paper?: string;
  /** Faint parchment/paint texture (adds an SVG filter). Default false. */
  texture?: boolean;
  /** Extra attributes for the root <svg> (e.g. 'class="arms"'). */
  attrs?: string;
  /** Padding around the shield, in shield units (room for the outline). Default 3. */
  pad?: number;
}

export function resolvePalette(p: RenderOptions["palette"]): Palette {
  if (!p) return ILLUMINATED;
  if (typeof p === "string") return PALETTES[p] ?? ILLUMINATED;
  return p;
}

export function makeCtx(opts: RenderOptions, unitsWide: number): Ctx {
  const size = opts.size ?? 200;
  const px = size / unitsWide;
  const outlinePx = Math.max(0.6, Math.min(1.7, 0.45 + size / 320));
  const hatched = opts.finish === "hatched";
  const ink = opts.ink ?? "#1b1714", paper = opts.paper ?? "#fbf8f0";
  const pal = resolvePalette(opts.palette);
  return {
    id: opts.idPrefix ?? autoId(),
    pal: hatched ? { ...pal, contour: ink, contourOnDark: paper } : pal,
    defs: new Map(),
    ids: new Map(),
    n: 0,
    px,
    ow: outlinePx / px,
    shading: (opts.finish ?? "rich") === "rich",
    hatch: hatched ? { ink, paper } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Charges

function accentFor(g: ChargeGroup, under: Tint): Tint {
  if (g.armed) return g.armed;
  const conv = chargeDef(g.charge).accentDefault;
  if (!conv || conv === "same") return g.tincture;
  if (conv === "gules") return g.tincture === "gules" || under === "gules" ? "azure" : "gules";
  if (conv === g.tincture) return conv === "or" ? "gules" : conv === "argent" ? "or" : "or";
  return conv;
}

/** Draw a group of charges into slots. */
function drawCharges(ctx: Ctx, g: ChargeGroup, slots: Slot[], under: Tint, tincture: Tint = g.tincture): string {
  if (!slots.length) return "";
  const { art, box } = chargeArt(g.charge, { attitude: g.attitude, points: g.points, pierced: g.pierced });
  const def = chargeDef(g.charge);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const accent = accentFor({ ...g, tincture }, under);
  let s = "";
  // Charges in a group share one size; build a single def and <use> it.
  const byScale = new Map<string, string>();
  for (const sl of slots) {
    const cw = (sl as Slot & { cw?: number }).cw ?? sl.s * Math.max(0.42, Math.min(1.6, bw / bh));
    const k = Math.min(cw / bw, sl.s / bh) * 0.97;
    const key = f(k);
    let id = byScale.get(key);
    if (!id) {
      id = uid(ctx, "c");
      const px = k * ctx.px * Math.max(bw, bh);
      const body = paintCharge(art, {
        body: chargeFill(ctx, tincture, box, k),
        accent: chargeFill(ctx, accent, box, k),
        crown: g.crowned ? chargeFill(ctx, g.crowned, box, k) : "",
        contour: ctx.pal.contour,
        detail: detailColor(ctx, tincture),
        outlineW: ctx.ow / k,
        lineK: Math.max(0.7, Math.min(1.25, 60 / px + 0.6)),
        detailOn: px > 22,
      });
      ctx.defs.set(id, `<g id="${id}">${body}</g>`);
      byScale.set(key, id);
    }
    const flipX = (g.reversed ? -1 : 1) * (sl.flip ? -1 : 1) * (def.symmetric && !sl.flip ? 1 : 1);
    const flipY = g.inverted ? -1 : 1;
    const rot = sl.rot ? ` rotate(${f(sl.rot)})` : "";
    s += `<use href="#${id}" transform="translate(${f(sl.x)} ${f(sl.y)})${rot} scale(${f(k * flipX)} ${f(k * flipY)}) translate(${f(-cx)} ${f(-cy)})"/>`;
  }
  return s;
}

function fieldUnder(a: SimpleArms): Tint {
  return a.field.tinctures[0];
}

// ---------------------------------------------------------------------------
// Coat

function strokeFill(d: string, fill: string, ctx: Ctx, evenodd = false): string {
  const fr = evenodd ? ` fill-rule="evenodd"` : "";
  return (
    `<path d="${d}" fill="${ctx.pal.contour}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 2)}" stroke-linejoin="round"${fr}/>` +
    `<path d="${d}" fill="${fill}"${fr}/>`
  );
}

function unionFill(polys: Pt[][], fill: string, ctx: Ctx): string {
  let under = "", over = "";
  for (const p of polys) {
    const d = polyD(p);
    under += `<path d="${d}"/>`;
    over += `<path d="${d}"/>`;
  }
  return (
    `<g fill="${ctx.pal.contour}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 2)}" stroke-linejoin="round">${under}</g>` +
    `<g fill="${fill}">${over}</g>`
  );
}

function clipDef(ctx: Ctx, d: string, evenodd = false): string {
  const id = uid(ctx, "k");
  ctx.defs.set(id, `<clipPath id="${id}"><path d="${d}"${evenodd ? ` clip-rule="evenodd"` : ""}/></clipPath>`);
  return id;
}

interface FieldInfo {
  /** Path of the region painted in the second tincture (for counterchanging). */
  region?: string;
  t0: Tint;
  t1?: Tint;
}

function renderField(a: SimpleArms, fr: Frame, ctx: Ctx): { svg: string; info: FieldInfo } {
  const fld = a.field;
  const t = fld.tinctures;
  const pad = 20;
  let s = `<rect x="${f(fr.x - pad)}" y="${f(fr.y - pad)}" width="${f(fr.w + 2 * pad)}" height="${f(fr.h + 2 * pad)}" fill="${regionFill(ctx, t[0], fr.u)}"/>`;
  const div = divideField(fld, fr);
  div.regions.forEach((d, i) => {
    const tint = t[i + 1] ?? t[t.length - 1];
    s += `<path d="${d}" fill="${regionFill(ctx, tint, fr.u)}" fill-rule="evenodd" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 0.9)}" stroke-linejoin="round"/>`;
  });
  return { svg: s, info: { t0: t[0], t1: t[1], region: div.regions.length === 1 ? div.regions[0] : undefined } };
}

/** Render a group of charges, handling counterchanging. */
function placeGroup(ctx: Ctx, g: ChargeGroup, slots: Slot[], info: FieldInfo, under: Tint): string {
  if (g.counterchanged && info.t1 && info.region) {
    const clip = clipDef(ctx, info.region, true);
    return drawCharges(ctx, g, slots, info.t0, info.t1) + `<g clip-path="url(#${clip})">${drawCharges(ctx, g, slots, info.t1, info.t0)}</g>`;
  }
  return drawCharges(ctx, g, slots, under);
}

function aspectOf(g: ChargeGroup): ChargeShape {
  const { box, profile } = chargeArt(g.charge, { attitude: g.attitude, points: g.points, pierced: g.pierced });
  let p = profile;
  if (g.inverted) p = p.map((b) => ({ v0: 1 - b.v1, v1: 1 - b.v0, u0: b.u0, u1: b.u1 }));
  if (g.reversed) p = p.map((b) => ({ ...b, u0: 1 - b.u1, u1: 1 - b.u0 }));
  return { aspect: (box.x1 - box.x0) / Math.max(1e-6, box.y1 - box.y0), profile: p };
}

function renderOrdinary(o: Ordinary, fr: Frame, ctx: Ctx, info: FieldInfo): string {
  if (o.kind === "fret") return renderFret(o, fr, ctx);
  const shape = ordinaryShape(o, fr);
  const paint = (t: Tint) => regionFill(ctx, t, fr.u);
  let s = shape.evenodd ? strokeFill(shape.evenodd, paint(o.tincture), ctx, true) : unionFill(shape.polys, paint(o.tincture), ctx);
  if (o.counterchanged && info.t1 && info.region) {
    const clip = clipDef(ctx, info.region, true);
    const alt = info.t0;
    s += `<g clip-path="url(#${clip})">${shape.evenodd ? strokeFill(shape.evenodd, paint(alt), ctx, true) : unionFill(shape.polys, paint(alt), ctx)}</g>`;
  }
  return s;
}

/**
 * A fret: a mascle interlaced with a saltire of the same width. One arm of the
 * saltire passes over the mascle at both its crossings, the other under it,
 * so the weave alternates all the way round the mascle.
 */
function renderFret(o: Ordinary, fr: Frame, ctx: Ctx): string {
  const paint = regionFill(ctx, o.tincture, fr.u);
  const bw = fr.w * 0.088, hw = bw / 2;
  const C: Pt = [fr.fx, fr.fy];
  const d1 = bendDir(fr, false), d2 = bendDir(fr, true);
  const L = fr.w * 3;
  const arm = (d: Pt): Pt[] => {
    const nx = -d[1] * hw, ny = d[0] * hw;
    return [[C[0] - d[0] * L + nx, C[1] - d[1] * L + ny], [C[0] + d[0] * L + nx, C[1] + d[1] * L + ny], [C[0] + d[0] * L - nx, C[1] + d[1] * L - ny], [C[0] - d[0] * L - nx, C[1] - d[1] * L - ny]];
  };
  // Mascle with sides square to the saltire's arms.
  const A = fr.w * 0.3, B = (A * d1[0]) / d1[1];
  const r = (A * B) / Math.hypot(A, B);
  const loz = (k: number): Pt[] => [[C[0], C[1] - B * k], [C[0] + A * k, C[1]], [C[0], C[1] + B * k], [C[0] - A * k, C[1]]];
  const mascle = polyD(loz((r + hw) / r)) + polyD(loz((r - hw) / r));
  let s = unionFill([arm(d1), arm(d2)], paint, ctx);
  s += strokeFill(mascle, paint, ctx, true);
  // Re-lay the dexter arm where it crosses over the mascle.
  for (const sgn of [-1, 1]) {
    const p: Pt = [C[0] + d1[0] * r * sgn, C[1] + d1[1] * r * sgn];
    const clip = clipDef(ctx, circleD(p[0], p[1], bw * 0.95));
    s += `<g clip-path="url(#${clip})">${unionFill([arm(d1)], paint, ctx)}</g>`;
  }
  return s;
}

function renderBordure(a: SimpleArms, fr: Frame, ctx: Ctx): string {
  const b = a.bordure!;
  const bw = bordureWidth(fr, !!b.charges);
  const outer = insetPoly(fr.poly, -fr.w * 0.1);
  const innerBase = insetPoly(fr.poly, bw);
  const inner = patternLine(innerBase, b.line, { u: fr.u, side: 1, closed: true, scale: 0.75, anchor: [fr.fx, fr.y] });
  const d = polyD(outer) + polyD(inner);
  let s = strokeFill(d, regionFill(ctx, b.tincture, fr.u), ctx, true);
  if (b.compony) s += componySegments(ctx, innerBase, fr, bw, d, b.compony);
  if (b.charges) s += drawCharges(ctx, b.charges, bordureSlots(fr, b.charges.count), b.tincture);
  return s;
}

/**
 * The alternate pieces of a bordure compony: equal lengths of the bordure's inner
 * edge, each pushed outward along its own normals, the first centred at the top.
 */
function componySegments(ctx: Ctx, inner: Pt[], fr: Frame, bw: number, bordureD: string, t: Tint): string {
  const ring = resampleClosed(inner, 1);
  const m = ring.length;
  let area = 0;
  for (let i = 0; i < m; i++) {
    const q = ring[(i + 1) % m];
    area += ring[i][0] * q[1] - q[0] * ring[i][1];
  }
  const sgn = area > 0 ? 1 : -1; // inward normal = (-ty, tx) * sgn, as in insetPoly
  const cum = [0];
  for (let i = 1; i <= m; i++) {
    const p = ring[i - 1], q = ring[i % m];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cum[m];
  const n = Math.max(12, Math.round(total / (fr.w * 0.2) / 2) * 2);
  const step = total / n;
  // arc position of the top centre
  let s0 = 0, best = Infinity;
  for (let i = 0; i < m; i++) {
    const dd = Math.abs(ring[i][0] - fr.fx) + (ring[i][1] > fr.fy ? 1e6 : 0);
    if (dd < best) { best = dd; s0 = cum[i]; }
  }
  const at = (sv: number): { p: Pt; nrm: Pt } => {
    sv = ((sv % total) + total) % total;
    let lo = 0, hi = m - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= sv) lo = mid; else hi = mid - 1;
    }
    const a = ring[lo], b = ring[(lo + 1) % m];
    const tt = (sv - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    return { p: [a[0] + tx * tt, a[1] + ty * tt], nrm: [(ty / L) * sgn, (-tx / L) * sgn] };
  };
  const reach = bw * 2.2;
  let d = "";
  for (let k = 0; k < n; k += 2) {
    const a0 = s0 - step / 2 + k * step;
    const pts: Pt[] = [], outer: Pt[] = [];
    for (let j = 0; j <= 8; j++) {
      const { p, nrm } = at(a0 + (step * j) / 8);
      pts.push(p);
      outer.push([p[0] + nrm[0] * reach, p[1] + nrm[1] * reach]);
    }
    d += polyD([...pts, ...outer.reverse()]);
  }
  const clip = clipDef(ctx, bordureD, true);
  return `<g clip-path="url(#${clip})"><path d="${d}" fill="${regionFill(ctx, t, fr.u)}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 0.9)}" stroke-linejoin="round"/></g>`;
}

function renderDifference(d: Difference, fr: Frame, ctx: Ctx, hasChief: boolean, spot: MarkSpot = "chief"): string {
  const { x, y, w, h, fx } = fr;
  if (d.mark === "label") {
    const n = d.points ?? 3;
    const top = y + (hasChief ? h * 0.035 : h * 0.07);
    const bh = w * 0.045;
    const x0 = x + w * (n === 5 ? 0.13 : 0.22), x1 = x + w * (n === 5 ? 0.87 : 0.78);
    const polys: Pt[][] = [[[x - w, top], [x + 2 * w, top], [x + 2 * w, top + bh], [x - w, top + bh]]];
    for (let i = 0; i < n; i++) {
      const cx = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const tw = w * (n === 5 ? 0.032 : 0.042), bw2 = w * (n === 5 ? 0.05 : 0.065);
      const L = w * (hasChief ? 0.1 : 0.12);
      polys.push([[cx - tw, top + bh * 0.5], [cx + tw, top + bh * 0.5], [cx + bw2, top + bh + L], [cx - bw2, top + bh + L]]);
    }
    // A label couped: trim the bar to the points' extent.
    polys[0] = [[x0 - w * 0.03, top], [x1 + w * 0.03, top], [x1 + w * 0.03, top + bh], [x0 - w * 0.03, top + bh]];
    return unionFill(polys, regionFill(ctx, d.tincture, fr.u), ctx);
  }
  if (d.mark === "bendlet") {
    const dir = bendDir(fr, false);
    const c: Pt = [fx, fr.fy];
    const L = w * 3, hw = w * 0.05;
    const nx = dir[1], ny = -dir[0];
    const poly: Pt[] = [
      [c[0] - dir[0] * L + nx * hw, c[1] - dir[1] * L + ny * hw],
      [c[0] + dir[0] * L + nx * hw, c[1] + dir[1] * L + ny * hw],
      [c[0] + dir[0] * L - nx * hw, c[1] + dir[1] * L - ny * hw],
      [c[0] - dir[0] * L - nx * hw, c[1] - dir[1] * L - ny * hw],
    ];
    return unionFill([poly], regionFill(ctx, d.tincture, fr.u), ctx);
  }
  const map: Record<string, ChargeGroup["charge"]> = {
    crescent: "crescent", mullet: "mullet", martlet: "martlet", annulet: "annulet", fleurDeLis: "fleurDeLis",
    rose: "rose", crossMoline: "crossMoline", quatrefoil: "quatrefoil",
  };
  const charge = map[d.mark];
  void h; void fx;
  return drawCharges(ctx, { charge, count: 1, tincture: d.tincture }, [spotPoint(spot, fr, hasChief)], "argent");
}

/** Where everything on a simple coat goes, in a given frame. */
export interface CoatLayout {
  /** Frame left once a chief is taken off the top. */
  main: Frame;
  /** Polygon charges must fit in (inside any bordure). */
  fit: Pt[];
  charges: Slot[];
  secondary: Slot[];
  onOrdinary: Slot[];
  chief: Slot[];
  canton: Slot[];
}

export function layoutSimple(a: SimpleArms, fr: Frame): CoatLayout {
  const ch = a.chief ? chiefHeight(fr) : 0;
  const main = a.chief ? subFrame(fr, fr.x, fr.y + ch, fr.w, fr.h - ch) : fr;
  // keep the fess point of the reduced frame where a herald would put it
  if (a.chief) main.fy = Math.min(main.fy, fr.y + ch + (fr.fy - fr.y) * 0.95);
  let fit = main.poly;
  if (a.bordure) fit = insetPoly(fit, bordureWidth(fr, !!a.bordure.charges) * 1.05);
  else if (a.chief) fit = insetPoly(fit, fr.w * 0.012);
  const L: CoatLayout = { main, fit, charges: [], secondary: [], onOrdinary: [], chief: [], canton: [] };
  if (a.charges) {
    const g = a.charges;
    const def = chargeDef(g.charge);
    if (a.ordinary) L.charges = betweenSlots(a.ordinary, main, fit, g.count, aspectOf(g));
    else if (a.secondary && (a.secondary.arrangement === "orle" || a.secondary.count >= 6)) {
      // A charge within an orle of others: it takes the space the orle leaves free.
      const orle = secondarySlots(main, fit, a.secondary.count, aspectOf(a.secondary), "orle");
      const inner = insetPoly(fit, (fit === main.poly ? main.w * 0.13 : main.w * 0.094) + (orle[0]?.s ?? 0) * 0.55);
      L.charges = fieldSlots(main, inner, g.count, g.arrangement, aspectOf(g), !!def.long);
    } else if (a.secondary) L.charges = principalWithSecondarySlots(main, fit, g, aspectOf(g));
    else L.charges = fieldSlots(main, fit, g.count, g.arrangement, aspectOf(g), !!def.long);
    if (a.secondary && !a.ordinary) {
      const sec = a.secondary;
      L.secondary = g.count === 1 && sec.count <= 5 && sec.arrangement !== "orle"
        ? aroundSlots(L.charges[0], main, fit, sec.count, aspectOf(sec))
        : secondarySlots(main, fit, sec.count, aspectOf(sec), sec.arrangement);
    }
  }
  if (a.ordinary?.charges) {
    const g = a.ordinary.charges;
    L.onOrdinary = onOrdinarySlots(a.ordinary, main, fit, g.count, aspectOf(g), !!chargeDef(g.charge).symmetric, !!chargeDef(g.charge).long);
  }
  if (a.chief?.charges) L.chief = chiefSlots(fr, a.chief.charges.count, aspectOf(a.chief.charges), !!chargeDef(a.chief.charges.charge).long);
  if (a.canton?.charge) {
    const [cx, cy, cw] = cantonBox(fr, a.canton.sinister);
    const sub = rectFrame(cx, cy, cw, cw);
    L.canton = rows(sub.poly, { x0: cx + cw * 0.12, y0: cy + cw * 0.12, x1: cx + cw * 0.88, y1: cy + cw * 0.88 }, [1], aspectOf(a.canton.charge));
  }
  return L;
}

export type MarkSpot = NonNullable<Difference["at"]>;

/** Centre and size of a brisure at a given spot. */
function spotPoint(spot: MarkSpot, fr: Frame, hasChief: boolean): Slot {
  const { x, y, w, h, fx, fy } = fr;
  const s = w * 0.13;
  switch (spot) {
    case "fess": return { x: fx, y: fy, s };
    case "dexterChief": return { x: x + w * 0.2, y: y + (hasChief ? chiefHeight(fr) * 0.5 : h * 0.14), s };
    case "sinisterChief": return { x: x + w * 0.8, y: y + (hasChief ? chiefHeight(fr) * 0.5 : h * 0.14), s };
    default: return { x: fx, y: y + (hasChief ? chiefHeight(fr) * 0.5 : h * 0.13), s };
  }
}

/** Ordinaries that cover the fess point. */
const THROUGH_FESS = ["fess", "pale", "bend", "bendSinister", "cross", "saltire", "pall", "pallReversed"];

/**
 * Where a brisure (mark of cadency) should go on a coat — the middle chief,
 * else the fess point, else the dexter chief, whichever no charge occupies —
 * and the tinctures it will lie on there.
 */
export function markSpot(a: SimpleArms): { at: MarkSpot; under: Tint[] } {
  const fr = shapeFrame("heater");
  const L = layoutSimple(a, fr);
  const occupied = [...L.charges, ...L.secondary, ...L.onOrdinary, ...L.chief, ...L.canton];
  const free = (sl: Slot) => occupied.every((o) => Math.hypot(o.x - sl.x, o.y - sl.y) > o.s * 0.5 + sl.s * 0.45);
  const cands: MarkSpot[] = a.canton && !a.canton.sinister ? ["chief", "fess", "sinisterChief"] : ["chief", "fess", "dexterChief", "sinisterChief"];
  const at = cands.find((c) => free(spotPoint(c, fr, !!a.chief))) ?? "fess";
  let under: Tint[];
  if (at === "fess") under = a.ordinary && THROUGH_FESS.includes(a.ordinary.kind) ? [a.ordinary.tincture] : a.field.tinctures;
  else if (a.chief) under = [a.chief.tincture];
  else if (at === "chief" && a.ordinary && ["pale", "cross", "pall"].includes(a.ordinary.kind)) under = [a.ordinary.tincture];
  else under = a.field.partition === "plain" ? a.field.tinctures : [a.field.tinctures[0]];
  return { at, under };
}

export function renderSimple(a: SimpleArms, fr: Frame, ctx: Ctx): string {
  const field = renderField(a, fr, ctx);
  let s = field.svg;
  const info = field.info;
  const L = layoutSimple(a, fr);
  const { main } = L;
  const under = fieldUnder(a);
  if (a.semy) {
    const sp = fr.w * 0.205;
    const slots: Slot[] = [];
    let row = 0;
    for (let yy = fr.y + sp * 0.4; yy < fr.y + fr.h + sp; yy += sp * 0.9, row++) {
      for (let xx = fr.x + (row % 2 ? sp / 2 : 0); xx < fr.x + fr.w + sp; xx += sp) slots.push({ x: xx, y: yy, s: sp * 0.5 });
    }
    s += drawCharges(ctx, { charge: a.semy.charge, count: slots.length, tincture: a.semy.tincture }, slots, under);
  }
  if (a.ordinary) s += renderOrdinary(a.ordinary, main, ctx, info);
  if (a.charges) s += placeGroup(ctx, a.charges, L.charges, info, under);
  if (a.secondary && a.charges && !a.ordinary) s += placeGroup(ctx, a.secondary, L.secondary, info, under);
  if (a.ordinary?.charges) s += drawCharges(ctx, a.ordinary.charges, L.onOrdinary, a.ordinary.tincture);
  if (a.bordure) s += renderBordure(a, fr, ctx);
  if (a.chief) {
    s += strokeFill(polyD(chiefPoly(fr, a.chief.line)), regionFill(ctx, a.chief.tincture, fr.u), ctx);
    if (a.chief.charges) s += drawCharges(ctx, a.chief.charges, L.chief, a.chief.tincture);
  }
  if (a.canton) {
    const [cx, cy, cw] = cantonBox(fr, a.canton.sinister);
    const pad = fr.w * 0.1;
    const poly: Pt[] = a.canton.sinister
      ? [[cx, cy - pad], [cx + cw + pad, cy - pad], [cx + cw + pad, cy + cw], [cx, cy + cw]]
      : [[cx - pad, cy - pad], [cx + cw, cy - pad], [cx + cw, cy + cw], [cx - pad, cy + cw]];
    s += strokeFill(polyD(poly), regionFill(ctx, a.canton.tincture, fr.u), ctx);
    if (a.canton.charge) s += drawCharges(ctx, a.canton.charge, L.canton, a.canton.tincture);
  }
  for (const d of a.difference ?? []) s += renderDifference(d, fr, ctx, !!a.chief, d.at ?? (d.mark === "label" || d.mark === "bendlet" ? "chief" : markSpot(a).at));
  return s;
}

/** A central charge accompanied by others: shrink the central one to leave room. */
function principalWithSecondarySlots(fr: Frame, fit: Pt[], g: ChargeGroup, aspect: ChargeShape): Slot[] {
  const sl = fieldSlots(fr, fit, g.count, g.arrangement, aspect);
  return sl.map((q) => ({ ...q, s: q.s * 0.72, y: q.y + fr.h * 0.01 }));
}

function secondarySlots(fr: Frame, fit: Pt[], count: number, aspect: ChargeShape, arrangement?: ChargeGroup["arrangement"]): Slot[] {
  const { x, y, w, h, fx, fy } = fr;
  const s = w * 0.17;
  let pts: Pt[] = [];
  if (arrangement === "orle" || count >= 6) return orleSlotsFor(fr, fit, count);
  if (count === 2) pts = [[x + w * 0.14, fy], [x + w * 0.86, fy]];
  else if (count === 3) pts = [[x + w * 0.17, y + h * 0.14], [x + w * 0.83, y + h * 0.14], [fx, y + h * 0.84]];
  else if (count === 4) pts = [[x + w * 0.15, y + h * 0.13], [x + w * 0.85, y + h * 0.13], [x + w * 0.2, y + h * 0.72], [x + w * 0.8, y + h * 0.72]];
  else pts = [[x + w * 0.15, y + h * 0.13], [x + w * 0.85, y + h * 0.13], [x + w * 0.15, y + h * 0.6], [x + w * 0.85, y + h * 0.6], [fx, y + h * 0.86]];
  void aspect;
  return pts.slice(0, count).map(([px, py]) => ({ x: px, y: py, s }));
}

function orleSlotsFor(fr: Frame, fit: Pt[], count: number): Slot[] {
  return fieldSlots(fr, fit, count, "orle", 1);
}

function renderMarshalled(m: MarshalledArms, fr: Frame, ctx: Ctx): string {
  const { x, y, w, h, fx, fy } = fr;
  const parts: Frame[] = [];
  if (m.method === "single") {
    parts.push(fr);
  } else if (m.method === "quarterly") {
    parts.push(subFrame(fr, x, y, fx - x, fy - y), subFrame(fr, fx, y, x + w - fx, fy - y), subFrame(fr, x, fy, fx - x, y + h - fy), subFrame(fr, fx, fy, x + w - fx, y + h - fy));
  } else if (m.method === "impaled") {
    parts.push(subFrame(fr, x, y, w / 2, h), subFrame(fr, x + w / 2, y, w / 2, h));
  } else {
    parts.push(subFrame(fr, x, y, w, fy - y), subFrame(fr, x, fy, w, y + h - fy));
  }
  let s = "";
  parts.forEach((p, i) => {
    const coat = m.coats[i] ?? m.coats[m.coats.length - 1];
    // Sub-frames keep proportions of the quarter itself; fess point from the visible area.
    const clip = clipDef(ctx, p.d);
    s += `<g clip-path="url(#${clip})">${renderCoat(coat, p, ctx)}</g>`;
  });
  // partition lines
  const ln = (a: Pt, b: Pt) => `<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 1.4)}"/>`;
  if (m.method === "quarterly") s += ln([fx, y - 5], [fx, y + h + 5]) + ln([x - 5, fy], [x + w + 5, fy]);
  else if (m.method === "impaled") s += ln([x + w / 2, y - 5], [x + w / 2, y + h + 5]);
  else if (m.method === "perFess") s += ln([x - 5, fy], [x + w + 5, fy]);
  if (m.escutcheon) {
    const ew = w * 0.36;
    const sh = SHAPES.heater;
    const k = ew / sh.w;
    const ex = fx - ew / 2, ey = fy - (sh.h * k) / 2;
    const sub: Ctx = { ...ctx, ow: ctx.ow / k, px: ctx.px * k };
    const efr = shapeFrame("heater");
    const clip = clipDef(sub, efr.d);
    const inner = renderCoat(m.escutcheon, efr, sub);
    ctx.n = sub.n;
    s +=
      `<g transform="translate(${f(ex)} ${f(ey)}) scale(${f(k)})">` +
      `<path d="${efr.d}" fill="none" stroke="${ctx.pal.contour}" stroke-width="${f(sub.ow * 3)}"/>` +
      `<g clip-path="url(#${clip})">${inner}</g>` +
      `<path d="${efr.d}" fill="none" stroke="${ctx.pal.contour}" stroke-width="${f(sub.ow * 1.6)}"/></g>`;
  }
  for (const d of m.difference ?? []) s += renderDifference(d, fr, ctx, false, d.at ?? "fess");
  return s;
}

/** Render any coat into a frame (caller clips to the frame). */
export function renderCoat(a: Arms, fr: Frame, ctx: Ctx): string {
  return a.kind === "marshalled" ? renderMarshalled(a, fr, ctx) : renderSimple(a, fr, ctx);
}

// ---------------------------------------------------------------------------
// Finish

export function finishDefs(ctx: Ctx, texture: boolean): { sheen: string; vignette: string; texture?: string } {
  const sheen = uid(ctx, "sh");
  const vig = uid(ctx, "vg");
  ctx.defs.set(
    sheen,
    `<radialGradient id="${sheen}" cx=".3" cy=".16" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".42" stop-color="#fff" stop-opacity=".06"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
  );
  ctx.defs.set(
    vig,
    `<radialGradient id="${vig}" cx=".5" cy=".42" r=".72"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient>`,
  );
  let tex: string | undefined;
  if (texture) {
    tex = uid(ctx, "tx");
    ctx.defs.set(
      tex,
      `<filter id="${tex}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="7"/>` +
        `<feColorMatrix values="0 0 0 0 .5  0 0 0 0 .42  0 0 0 0 .3  0 0 0 -1.6 1.05"/><feComposite in2="SourceGraphic" operator="in"/></filter>`,
    );
  }
  return { sheen, vignette: vig, texture: tex };
}

export function renderArmsSVG(arms: Arms, opts: RenderOptions = {}): string {
  const shape = opts.shape ?? "heater";
  const def = SHAPES[shape];
  const pad = opts.pad ?? 3;
  const ctx = makeCtx(opts, def.w + 2 * pad);
  const fr = shapeFrame(shape);
  const clip = uid(ctx, "shield");
  ctx.defs.set(clip, `<clipPath id="${clip}"><path d="${def.d}"/></clipPath>`);
  const body = renderCoat(arms, fr, ctx);
  let finish = "";
  if (ctx.shading) {
    const fd = finishDefs(ctx, !!opts.texture);
    if (fd.texture) finish += `<path d="${def.d}" filter="url(#${fd.texture})" opacity=".16" style="mix-blend-mode:multiply"/>`;
    finish += `<path d="${def.d}" fill="url(#${fd.vignette})"/><path d="${def.d}" fill="url(#${fd.sheen})"/>`;
  }
  const outline = `<path d="${def.d}" fill="none" stroke="${ctx.pal.contour}" stroke-width="${f(ctx.ow * 1.7)}" stroke-linejoin="round"/>`;
  const size = opts.size ?? 200;
  const vw = def.w + 2 * pad, vh = def.h + 2 * pad;
  const height = (size * vh) / vw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-pad)} ${f(-pad)} ${f(vw)} ${f(vh)}" width="${f(size)}" height="${f(height)}"${opts.attrs ? " " + opts.attrs : ""}>` +
    defsMarkup(ctx) +
    `<g clip-path="url(#${clip})">${body}${finish}</g>${outline}</svg>`
  );
}

export { isMetal };
