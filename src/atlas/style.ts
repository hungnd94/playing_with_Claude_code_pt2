/**
 * Palettes and typography for the three plate styles.
 */

export type AtlasStyle = "antique" | "political" | "relief";

export interface Palette {
  paper: string;
  paperDark: string;
  ink: string;
  inkSoft: string;
  /** Sea wash and its coastal deepening. */
  water: string;
  waterDeep: string;
  waterInk: string;
  /** Lake wash. */
  lake: string;
  river: string;
  /** Shadow tint on mountain flanks (multiplied over paper). */
  shadow: string;
  forestTint: string;
  /** Land tint (very light) under the glyphs; "" = none. */
  landTint: string;
  /** Opacity of realm washes. */
  realmWash: number;
  /** Opacity of the realm edge band. */
  realmEdge: number;
  /** Hillshade strength (relief style). */
  hillshade: number;
  /** Biome colour wash strength (relief style). */
  biomeWash: number;
  route: string;
  routeSea: string;
  red: string;
}

export const PALETTES: Record<AtlasStyle, Palette> = {
  antique: {
    paper: "#eee1c4",
    paperDark: "#d9c49b",
    ink: "#3a2a1c",
    inkSoft: "#6b5541",
    water: "#b8c7bd",
    waterDeep: "#8fa8a3",
    waterInk: "#3f5a63",
    lake: "#b4c6c0",
    river: "#3f5a6b",
    shadow: "#8a7458",
    forestTint: "#a7a77a",
    landTint: "",
    realmWash: 0.13,
    realmEdge: 0.5,
    hillshade: 0.0,
    biomeWash: 0.0,
    route: "#7a4a2a",
    routeSea: "#5b6f7d",
    red: "#9a3524",
  },
  political: {
    paper: "#efe3c9",
    paperDark: "#d8c39c",
    ink: "#33261a",
    inkSoft: "#64503d",
    water: "#b3c8c6",
    waterDeep: "#86a6ab",
    waterInk: "#3b5764",
    lake: "#aec6c6",
    river: "#3a5770",
    shadow: "#857055",
    forestTint: "#a6a57c",
    landTint: "",
    realmWash: 0.3,
    realmEdge: 0.65,
    hillshade: 0.0,
    biomeWash: 0.0,
    route: "#7a4a2a",
    routeSea: "#4f6a7d",
    red: "#9a3524",
  },
  relief: {
    paper: "#ece0c6",
    paperDark: "#d4bf98",
    ink: "#36291d",
    inkSoft: "#685441",
    water: "#a9c1c4",
    waterDeep: "#7f9fa8",
    waterInk: "#36566a",
    lake: "#a6c0c4",
    river: "#2f5272",
    shadow: "#7d6a52",
    forestTint: "#93a16f",
    landTint: "",
    realmWash: 0.0,
    realmEdge: 0.35,
    hillshade: 0.55,
    biomeWash: 0.32,
    route: "#7a4a2a",
    routeSea: "#4f6a7d",
    red: "#9a3524",
  },
};

export const FONT_ROMAN = `"IM Fell English", "IM FELL English", Georgia, "Times New Roman", serif`;
export const FONT_SC = `"IM Fell English SC", "IM FELL English SC", Georgia, "Times New Roman", serif`;

export function font(size: number, opts: { italic?: boolean; sc?: boolean } = {}): string {
  return `${opts.italic ? "italic " : ""}${size.toFixed(1)}px ${opts.sc ? FONT_SC : FONT_ROMAN}`;
}

/** Parse "#rrggbb" → [r, g, b]. */
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgba(c: [number, number, number] | string, a: number): string {
  const [r, g, b] = typeof c === "string" ? hexRgb(c) : c;
  return `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
}

/** Mix two colours. */
export function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Soften a realm colour into a watercolour pigment: pull saturation and
 * lightness towards an earthy middle so washes sit on parchment.
 */
export function pigment(c: [number, number, number]): [number, number, number] {
  const [r, g, b] = c.map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  s = Math.min(0.62, Math.max(0.3, s * 0.85));
  const L = Math.min(0.56, Math.max(0.4, l));
  const C = (1 - Math.abs(2 * L - 1)) * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - C / 2;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) [rr, gg, bb] = [C, X, 0];
  else if (h < 120) [rr, gg, bb] = [X, C, 0];
  else if (h < 180) [rr, gg, bb] = [0, C, X];
  else if (h < 240) [rr, gg, bb] = [0, X, C];
  else if (h < 300) [rr, gg, bb] = [X, 0, C];
  else [rr, gg, bb] = [C, 0, X];
  return [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255];
}
