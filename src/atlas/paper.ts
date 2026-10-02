/**
 * Procedural parchment: base tone with mottling and fibres (drawn first), and
 * an ageing overlay (darkened edges, vignette, stains, foxing, grain) drawn
 * last with `multiply` so it also ages the ink. Standard 2D context API only.
 */
import { Noise3 } from "../core/noise";
import { Rng } from "../core/rng";
import { hexRgb, type Palette } from "./style";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement | OffscreenCanvas): Ctx2D {
  return c.getContext("2d") as Ctx2D;
}

/** Base parchment: fill, broad mottling, fibres. */
export function drawPaperBase(ctx: Ctx2D, w: number, h: number, pal: Palette, rng: Rng): void {
  ctx.save();
  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, w, h);
  // Mottling at 1/4 resolution, upscaled smoothly.
  const s = 4;
  const mw = Math.ceil(w / s), mh = Math.ceil(h / s);
  const cv = makeCanvas(mw, mh);
  const c2 = ctxOf(cv);
  const img = c2.createImageData(mw, mh);
  const nz = new Noise3(rng.fork("mottle"));
  const dark = hexRgb(pal.paperDark);
  const light: [number, number, number] = [250, 244, 228];
  const d = img.data;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const u = (x * s) / 260, v = (y * s) / 260;
      const broad = nz.fbm(u, v, 0.3, 4, 2.1, 0.55);
      const blot = nz.fbm(u * 3.1 + 7, v * 3.1 - 2, 4.7, 3);
      const t = 0.55 * broad + 0.3 * blot;
      const o = 4 * (y * mw + x);
      if (t > 0) {
        d[o] = dark[0]; d[o + 1] = dark[1]; d[o + 2] = dark[2];
        d[o + 3] = Math.min(255, t * 150);
      } else {
        d[o] = light[0]; d[o + 1] = light[1]; d[o + 2] = light[2];
        d[o + 3] = Math.min(255, -t * 120);
      }
    }
  }
  c2.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.55;
  ctx.drawImage(cv as CanvasImageSource, 0, 0, mw * s, mh * s);
  ctx.globalAlpha = 1;

  // Fibres: short, faint, gently curved strokes.
  const fr = rng.fork("fibres");
  const nF = Math.round((w * h) / 900);
  ctx.lineCap = "round";
  for (let i = 0; i < nF; i++) {
    const x = fr.next() * w, y = fr.next() * h;
    const a = fr.next() * Math.PI;
    const L = 3 + fr.exponential(5);
    const bend = fr.range(-0.6, 0.6);
    const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dx / 2 - dy * bend * 0.5, y + dy / 2 + dx * bend * 0.5, x + dx, y + dy);
    const darkF = fr.chance(0.6);
    ctx.strokeStyle = darkF ? `rgba(120,95,60,${fr.range(0.04, 0.11).toFixed(3)})` : `rgba(255,252,240,${fr.range(0.1, 0.25).toFixed(3)})`;
    ctx.lineWidth = fr.range(0.35, 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

/** Ageing overlay: multiply-blended edges, stains, foxing and grain. */
export function drawPaperAgeing(ctx: Ctx2D, w: number, h: number, pal: Palette, rng: Rng, strength = 1): void {
  ctx.save();
  const s = 3;
  const mw = Math.ceil(w / s), mh = Math.ceil(h / s);
  const cv = makeCanvas(mw, mh);
  const c2 = ctxOf(cv);
  const img = c2.createImageData(mw, mh);
  const nz = new Noise3(rng.fork("age"));
  const d = img.data;
  const edge = Math.min(w, h) * 0.11;
  // Stains: a few soft blots with darker tide-mark rims.
  const sr = rng.fork("stains");
  const stains: { x: number; y: number; r: number; k: number }[] = [];
  const nStains = sr.int(2, 4);
  for (let i = 0; i < nStains; i++) {
    stains.push({ x: sr.range(0.05, 0.95) * w, y: sr.range(0.05, 0.95) * h, r: sr.range(0.05, 0.16) * Math.min(w, h), k: sr.range(0.5, 1) });
  }
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const px = x * s, py = y * s;
      // edge darkening with a ragged inner limit
      const de = Math.min(px, py, w - px, h - py);
      const rag = 0.6 + 0.4 * nz.fbm(px / 90, py / 90, 1.7, 3);
      let e = Math.max(0, 1 - de / (edge * rag));
      e = e * e * e * 0.55;
      // vignette
      const vx = (px / w - 0.5) * 2, vy = (py / h - 0.5) * 2;
      const vig = Math.max(0, Math.hypot(vx * 0.92, vy) - 0.55) * 0.35;
      // stains
      let st = 0;
      for (const sn of stains) {
        const dd = Math.hypot(px - sn.x, py - sn.y);
        if (dd > sn.r * 1.5) continue;
        const wob = 1 + 0.28 * nz.noise(px / 60 + sn.x, py / 60, 9.1);
        const q = dd / (sn.r * wob);
        if (q < 1.15) {
          const inner = q < 1 ? 0.22 * (1 - q * q) : 0;
          const rim = Math.exp(-((q - 1) * (q - 1)) / 0.006) * 0.12;
          st += sn.k * (inner + rim) * 0.22;
        }
      }
      // grain
      const g = nz.noise(px / 2.3, py / 2.3, 5.5) * 0.05;
      const t = Math.min(1, (e + vig + st) * strength + Math.max(0, g));
      const o = 4 * (y * mw + x);
      // multiply colour: lerp white → aged brown
      d[o] = 255 - t * (255 - 150);
      d[o + 1] = 255 - t * (255 - 112);
      d[o + 2] = 255 - t * (255 - 62);
      d[o + 3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cv as CanvasImageSource, 0, 0, mw * s, mh * s);

  // Foxing: clusters of small rusty spots.
  const fx = rng.fork("foxing");
  const clusters = fx.int(4, 9);
  for (let c = 0; c < clusters; c++) {
    const nearEdge = fx.chance(0.7);
    let cx = fx.next() * w, cy = fx.next() * h;
    if (nearEdge) {
      if (fx.chance(0.5)) cx = fx.chance(0.5) ? fx.range(0, 0.12) * w : fx.range(0.88, 1) * w;
      else cy = fx.chance(0.5) ? fx.range(0, 0.12) * h : fx.range(0.88, 1) * h;
    }
    const n = fx.int(3, 18);
    for (let i = 0; i < n; i++) {
      const x = cx + fx.normal(0, 22), y = cy + fx.normal(0, 22);
      const r = 0.6 + fx.exponential(1.6);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      const a = fx.range(0.12, 0.38);
      gr.addColorStop(0, `rgba(150,96,48,${a.toFixed(3)})`);
      gr.addColorStop(0.45, `rgba(170,118,64,${(a * 0.6).toFixed(3)})`);
      gr.addColorStop(1, "rgba(200,160,110,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
