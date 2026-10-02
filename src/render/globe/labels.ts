/**
 * Map labels drawn on a 2D canvas laid over the globe, with classic
 * cartographic styling (letter-spaced capitals for regions, italics for water)
 * and greedy collision avoidance by priority. Labels on the far side are
 * hidden; labels fade out towards the limb.
 */
import { project, type Frame, type Projected } from "./camera";

export type LabelStyleName = "city" | "capital" | "region" | "sea" | "feature";

export interface GlobeLabel {
  /** Position on the unit sphere (e.g. a cell centre). */
  xyz: readonly [number, number, number] | ArrayLike<number>;
  text: string;
  /** Higher wins when labels collide (default 0). */
  priority?: number;
  style: LabelStyleName;
  /** Size multiplier (default 1); e.g. scale region labels by realm size. */
  size?: number;
  /** Only show at or above this zoom (default 0). */
  minZoom?: number;
}

export type LabelTheme = "light" | "dark";

interface StyleDef {
  size: number;
  weight: number;
  italic: boolean;
  upper: boolean;
  /** Letter spacing in em. */
  spacing: number;
  fill: string;
  halo: string;
  haloWidth: number;
  /** Font size grows as zoom^k. */
  zoomK: number;
  point: boolean;
}

const LIGHT: Record<LabelStyleName, StyleDef> = {
  capital: { size: 14, weight: 600, italic: false, upper: false, spacing: 0.02, fill: "#fff6e4", halo: "rgba(16,12,8,0.78)", haloWidth: 3, zoomK: 0.12, point: true },
  city: { size: 12, weight: 500, italic: false, upper: false, spacing: 0.02, fill: "#f1e8d4", halo: "rgba(16,12,8,0.72)", haloWidth: 2.6, zoomK: 0.1, point: true },
  region: { size: 12.5, weight: 600, italic: false, upper: true, spacing: 0.3, fill: "rgba(255,243,220,0.94)", halo: "rgba(24,16,8,0.55)", haloWidth: 2.6, zoomK: 0.38, point: false },
  sea: { size: 13, weight: 500, italic: true, upper: false, spacing: 0.2, fill: "rgba(196,224,248,0.9)", halo: "rgba(4,14,34,0.55)", haloWidth: 2.4, zoomK: 0.32, point: false },
  feature: { size: 11.5, weight: 500, italic: true, upper: false, spacing: 0.08, fill: "rgba(246,232,206,0.92)", halo: "rgba(20,14,8,0.6)", haloWidth: 2.4, zoomK: 0.22, point: true },
};

const DARK: Record<LabelStyleName, StyleDef> = {
  capital: { ...LIGHT.capital, fill: "#1c140e", halo: "rgba(252,247,236,0.85)" },
  city: { ...LIGHT.city, fill: "#2b2118", halo: "rgba(252,247,236,0.8)" },
  region: { ...LIGHT.region, fill: "rgba(70,44,30,0.88)", halo: "rgba(252,247,236,0.55)" },
  sea: { ...LIGHT.sea, fill: "rgba(36,72,110,0.88)", halo: "rgba(240,246,252,0.5)" },
  feature: { ...LIGHT.feature, fill: "rgba(80,58,36,0.9)", halo: "rgba(252,247,236,0.6)" },
};

export const DEFAULT_FONT = '"EB Garamond", "Cormorant Garamond", Garamond, Georgia, "Bitstream Charter", "Liberation Serif", serif';

interface Prepared {
  label: GlobeLabel;
  x: number;
  y: number;
  z: number;
  text: string;
  style: StyleDef;
  priority: number;
  order: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class LabelLayer {
  private items: Prepared[] = [];
  private widthCache = new Map<string, number>();
  private styles: Record<LabelStyleName, StyleDef> = LIGHT;
  private hasLetterSpacing: boolean;
  fontFamily = DEFAULT_FONT;

  constructor(private ctx: CanvasRenderingContext2D) {
    this.hasLetterSpacing = "letterSpacing" in ctx;
  }

  setTheme(theme: LabelTheme): void {
    this.styles = theme === "dark" ? DARK : LIGHT;
    for (const it of this.items) it.style = this.styles[it.label.style] ?? this.styles.city;
  }

  /** Set labels. `place` maps a cell-space position to the drawn position (inverse warp). */
  setLabels(list: readonly GlobeLabel[], place?: (x: number, y: number, z: number) => [number, number, number]): void {
    this.items = list.map((label, order) => {
      let x = label.xyz[0], y = label.xyz[1], z = label.xyz[2];
      if (place) [x, y, z] = place(x, y, z);
      const style = this.styles[label.style] ?? this.styles.city;
      return {
        label, x, y, z, style, order,
        text: style.upper ? label.text.toLocaleUpperCase() : label.text,
        priority: label.priority ?? 0,
      };
    });
    this.items.sort((a, b) => b.priority - a.priority || a.order - b.order);
  }

  /**
   * Lay out and draw all labels for the given frame. Coordinates in CSS px.
   * `daylight(x,y,z)` (0..1) dims labels on the night side; `obstacles` are
   * screen boxes (e.g. markers) that labels must not cover.
   */
  draw(
    frame: Frame, dpr: number, zoom: number,
    markerRadius: (label: GlobeLabel) => number,
    daylight?: (x: number, y: number, z: number) => number,
    obstacles: Box[] = [],
  ): void {
    const ctx = this.ctx;
    const W = frame.width, H = frame.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.items.length === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    // Point labels avoid markers too; area labels (regions, seas) may sit over them.
    const placed: Box[] = [];
    const R2 = (frame.radius - 1) * (frame.radius - 1);
    const inDisc = (b: Box): boolean => {
      if (frame.mode !== "globe") return true;
      const ym = 0.5 * (b.y0 + b.y1) - frame.cy;
      const dx0 = b.x0 + 2 - frame.cx, dx1 = b.x1 - 2 - frame.cx;
      return dx0 * dx0 + ym * ym < R2 && dx1 * dx1 + ym * ym < R2;
    };
    const pr: Projected = { x: 0, y: 0, depth: 0 };
    const pad = 2;
    for (const it of this.items) {
      if ((it.label.minZoom ?? 0) > zoom) continue;
      project(frame, it.x, it.y, it.z, pr);
      if (pr.depth < 0.06) continue;
      if (pr.x < -200 || pr.x > W + 200 || pr.y < -50 || pr.y > H + 50) continue;
      let fade = frame.mode === "globe" ? smooth(0.06, 0.4, pr.depth) : 1;
      if (daylight) fade *= 0.5 + 0.5 * daylight(it.x, it.y, it.z);
      const st = it.style;
      const size = st.size * Math.pow(Math.max(1, zoom), st.zoomK) * (it.label.size ?? 1);
      const font = `${st.italic ? "italic " : ""}${st.weight} ${size.toFixed(1)}px ${this.fontFamily}`;
      const spacingPx = st.spacing * size;
      const w = this.measure(font, it.text, spacingPx);
      const h = size * 1.05;
      // Candidate anchor positions.
      let chosen: Box | null = null;
      let tx = 0, align: CanvasTextAlign = "left";
      if (st.point) {
        const off = markerRadius(it.label) + 3;
        const cands: [number, number, CanvasTextAlign][] = [
          [pr.x + off, pr.y, "left"],
          [pr.x - off, pr.y, "right"],
          [pr.x + off * 0.7, pr.y - h * 0.75, "left"],
          [pr.x + off * 0.7, pr.y + h * 0.75, "left"],
        ];
        for (const [cx, cy, al] of cands) {
          const x0 = al === "left" ? cx : cx - w;
          const b = { x0: x0 - pad, y0: cy - h / 2 - pad, x1: x0 + w + pad, y1: cy + h / 2 + pad };
          if (!collides(placed, b) && !collides(obstacles, b) && onScreen(b, W, H) && inDisc(b)) {
            chosen = b;
            tx = cx;
            align = al;
            pr.y = cy;
            break;
          }
        }
      } else {
        const b = { x0: pr.x - w / 2 - pad, y0: pr.y - h / 2 - pad, x1: pr.x + w / 2 + pad, y1: pr.y + h / 2 + pad };
        if (!collides(placed, b) && onScreen(b, W, H) && inDisc(b)) {
          chosen = b;
          tx = pr.x;
          align = "center";
        }
      }
      if (!chosen) continue;
      placed.push(chosen);
      ctx.globalAlpha = fade;
      ctx.font = font;
      this.drawText(ctx, it.text, tx, pr.y, align, spacingPx, st);
    }
    ctx.globalAlpha = 1;
  }

  private measure(font: string, text: string, spacingPx: number): number {
    const key = font + "|" + text;
    let w = this.widthCache.get(key);
    if (w === undefined) {
      const ctx = this.ctx;
      ctx.font = font;
      if (this.hasLetterSpacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
      w = ctx.measureText(text).width;
      if (this.widthCache.size > 4000) this.widthCache.clear();
      this.widthCache.set(key, w);
    }
    return w + spacingPx * Math.max(0, [...text].length - 1);
  }

  private drawText(
    ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
    align: CanvasTextAlign, spacingPx: number, st: StyleDef,
  ): void {
    ctx.strokeStyle = st.halo;
    ctx.lineWidth = st.haloWidth;
    ctx.fillStyle = st.fill;
    if (spacingPx < 0.05) {
      ctx.textAlign = align;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      return;
    }
    if (this.hasLetterSpacing) {
      const c = ctx as unknown as { letterSpacing: string };
      c.letterSpacing = `${spacingPx.toFixed(2)}px`;
      // Canvas adds the spacing after every glyph, including the last: compensate.
      const w = ctx.measureText(text).width - spacingPx;
      const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
      ctx.textAlign = "left";
      ctx.strokeText(text, x0, y);
      ctx.fillText(text, x0, y);
      c.letterSpacing = "0px";
      return;
    }
    // Manual letter spacing.
    const chars = [...text];
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacingPx * (chars.length - 1);
    let cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
    ctx.textAlign = "left";
    for (let i = 0; i < chars.length; i++) {
      ctx.strokeText(chars[i], cx, y);
      ctx.fillText(chars[i], cx, y);
      cx += widths[i] + spacingPx;
    }
  }
}

function collides(boxes: Box[], b: Box): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i];
    if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
  }
  return false;
}

function onScreen(b: Box, W: number, H: number): boolean {
  return b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
