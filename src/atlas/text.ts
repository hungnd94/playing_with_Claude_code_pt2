/**
 * Drawing placed labels glyph by glyph: a soft halo in the local ground colour
 * first (all labels), then the ink, then combining marks drawn as small pen
 * strokes so that names outside Latin-1 stay in the map face.
 */
import type { PlacedGlyph, PlacedLabel } from "./labels";
import type { Ctx2D } from "./paper";
import { rgba } from "./style";

/** Baseline offset from the glyph's visual centre line, in em. */
function baselineOffset(caps: boolean): number {
  return caps ? 0.34 : 0.26;
}

/** Do all glyphs share one rotation (a straight label)? */
function straightAngle(l: PlacedLabel): number | null {
  const gs = l.glyphs;
  if (!gs.length) return null;
  const a0 = gs[0].a;
  for (const g of gs) if (Math.abs(g.a - a0) > 0.002) return null;
  return a0;
}

type SpacingCtx = Ctx2D & { letterSpacing?: string };

/**
 * Draw one label pass (halo stroke or ink fill). Straight labels go in a single
 * call with canvas letter spacing (much faster than glyph by glyph); curved
 * labels are drawn glyph by glyph along their path.
 */
type SetT = (a: number, b: number, c: number, d: number, e: number, f: number) => void;

function pass(ctx: Ctx2D, T: SetT, l: PlacedLabel, bo: number, stroke: boolean, canSpace: boolean): void {
  const a0 = straightAngle(l);
  const gs = l.glyphs;
  if (a0 !== null && canSpace && gs.length > 1) {
    const g0 = gs[0];
    const ca = Math.cos(a0), sa = Math.sin(a0);
    // Left edge of the first glyph, on the centre line.
    const x = g0.x - (g0.w / 2) * ca, y = g0.y - (g0.w / 2) * sa;
    const sp = gs.length > 1 ? Math.hypot(gs[1].x - g0.x, gs[1].y - g0.y) - (g0.w + gs[1].w) / 2 : 0;
    const sctx = ctx as SpacingCtx;
    sctx.letterSpacing = `${Math.max(0, sp).toFixed(2)}px`;
    T(ca, sa, -sa, ca, x, y);
    ctx.textAlign = "left";
    const text = gs.map((g) => g.ch).join("");
    if (stroke) ctx.strokeText(text, 0, bo);
    else ctx.fillText(text, 0, bo);
    sctx.letterSpacing = "0px";
    ctx.textAlign = "center";
    return;
  }
  for (const g of gs) {
    if (g.ch.trim() === "") continue;
    const ca = Math.cos(g.a), sa = Math.sin(g.a);
    T(ca, sa, -sa, ca, g.x, g.y);
    if (stroke) ctx.strokeText(g.ch, 0, bo);
    else ctx.fillText(g.ch, 0, bo);
  }
}

/**
 * Draw labels. `base` is the context's transform when the plate is drawn
 * (e.g. a device-pixel-ratio scale); glyph transforms are composed with it.
 */
export function drawLabels(ctx: Ctx2D, labels: PlacedLabel[]): void {
  ctx.save();
  const base = ctx.getTransform();
  const canSpace = "letterSpacing" in ctx;
  // Glyph transforms composed with the base transform.
  const T: SetT = (a, b, c, d, e, f) =>
    ctx.setTransform(base.a * a + base.c * b, base.b * a + base.d * b, base.a * c + base.c * d, base.b * c + base.d * d, base.a * e + base.c * f + base.e, base.b * e + base.d * f + base.f);
  {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    // Halos for every label first, so that no halo erases another label's ink.
    for (const l of labels) {
      if (!l.style.halo) continue;
      ctx.font = l.font;
      ctx.strokeStyle = rgba(l.style.halo, l.kind === "ocean" || l.kind === "sea" || l.kind === "bay" ? 0.55 : 0.72);
      ctx.lineWidth = l.style.haloWidth;
      pass(ctx, T, l, baselineOffset(!!l.style.caps) * l.style.size, true, canSpace);
    }
    for (const l of labels) {
      ctx.font = l.font;
      ctx.fillStyle = l.style.color;
      ctx.strokeStyle = l.style.color;
      ctx.globalAlpha = l.style.opacity ?? 1;
      const caps = !!l.style.caps;
      const bo = baselineOffset(caps) * l.style.size;
      pass(ctx, T, l, bo, false, canSpace);
      for (const g of l.glyphs) {
        if (!g.marks) continue;
        const ca = Math.cos(g.a), sa = Math.sin(g.a);
        T(ca, sa, -sa, ca, g.x, g.y);
        drawMarks(ctx, g, l.style.size, bo, !!l.style.italic, caps || isUpper(g.ch), !!l.style.sc);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.setTransform(base);
  ctx.restore();
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLocaleLowerCase() && ch === ch.toLocaleUpperCase();
}

/** Combining marks above/below a glyph in its local frame (origin = centre line, x centred). */
function drawMarks(ctx: Ctx2D, g: PlacedGlyph, size: number, baseline: number, italic: boolean, upper: boolean, sc: boolean): void {
  const s = size;
  const top = baseline - (upper ? 0.7 : sc ? 0.52 : 0.46) * s;
  const slant = italic ? 0.2 : 0;
  const lw = Math.max(0.6, 0.065 * s);
  let above = top - 0.1 * s;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  for (const m of Array.from(g.marks)) {
    const cp = m.codePointAt(0) ?? 0;
    const below = cp === 0x323 || cp === 0x327 || cp === 0x328 || cp === 0x331 || cp === 0x325 || cp === 0x32d;
    const yy = below ? baseline + 0.14 * s : above;
    const xx = below ? 0 : slant * (baseline - yy);
    const w = 0.17 * s;
    ctx.beginPath();
    switch (cp) {
      case 0x300: // grave
        ctx.moveTo(xx - w * 0.6, yy - w * 0.9);
        ctx.lineTo(xx + w * 0.3, yy);
        break;
      case 0x301: // acute
        ctx.moveTo(xx - w * 0.3, yy);
        ctx.lineTo(xx + w * 0.6, yy - w * 0.9);
        break;
      case 0x30b: // double acute
        ctx.moveTo(xx - w * 0.8, yy);
        ctx.lineTo(xx - w * 0.1, yy - w * 0.9);
        ctx.moveTo(xx + w * 0.1, yy);
        ctx.lineTo(xx + w * 0.8, yy - w * 0.9);
        break;
      case 0x302: // circumflex
        ctx.moveTo(xx - w, yy);
        ctx.lineTo(xx, yy - w * 0.8);
        ctx.lineTo(xx + w, yy);
        break;
      case 0x30c: // caron
        ctx.moveTo(xx - w, yy - w * 0.8);
        ctx.lineTo(xx, yy);
        ctx.lineTo(xx + w, yy - w * 0.8);
        break;
      case 0x303: // tilde
        ctx.moveTo(xx - w * 1.1, yy - w * 0.2);
        ctx.bezierCurveTo(xx - w * 0.5, yy - w * 1.0, xx + w * 0.1, yy + w * 0.4, xx + w * 1.1, yy - w * 0.6);
        break;
      case 0x304: // macron
      case 0x331: // macron below
        ctx.moveTo(xx - w * 1.1, yy - w * 0.3);
        ctx.lineTo(xx + w * 1.1, yy - w * 0.3);
        break;
      case 0x306: // breve
        ctx.moveTo(xx - w, yy - w * 0.9);
        ctx.quadraticCurveTo(xx, yy + w * 0.3, xx + w, yy - w * 0.9);
        break;
      case 0x311: // inverted breve
        ctx.moveTo(xx - w, yy);
        ctx.quadraticCurveTo(xx, yy - w * 1.2, xx + w, yy);
        break;
      case 0x307: // dot above
      case 0x323: // dot below
        ctx.arc(xx, yy - w * 0.35, lw * 0.9, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 0x308: // diaeresis
        ctx.arc(xx - w * 0.6, yy - w * 0.35, lw * 0.85, 0, Math.PI * 2);
        ctx.moveTo(xx + w * 0.6 + lw, yy - w * 0.35);
        ctx.arc(xx + w * 0.6, yy - w * 0.35, lw * 0.85, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 0x30a: // ring above
      case 0x325: // ring below
        ctx.arc(xx, yy - w * 0.45, w * 0.45, 0, Math.PI * 2);
        break;
      case 0x327: // cedilla
        ctx.moveTo(xx, yy - w * 0.4);
        ctx.quadraticCurveTo(xx + w * 0.9, yy + w * 0.2, xx - w * 0.4, yy + w * 0.8);
        break;
      case 0x328: // ogonek
        ctx.moveTo(xx + w * 0.4, yy - w * 0.5);
        ctx.quadraticCurveTo(xx - w * 0.6, yy + w * 0.3, xx + w * 0.6, yy + w * 0.8);
        break;
      case 0x32d: // circumflex below
        ctx.moveTo(xx - w, yy + w * 0.6);
        ctx.lineTo(xx, yy - w * 0.2);
        ctx.lineTo(xx + w, yy + w * 0.6);
        break;
      default:
        break;
    }
    ctx.stroke();
    if (!below) above -= 0.2 * s;
  }
}
