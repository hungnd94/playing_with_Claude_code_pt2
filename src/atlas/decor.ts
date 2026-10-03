/**
 * Plate furniture: title cartouche (with the native name, lettered in the
 * native script when the people write), compass rose turned to local true
 * north (with portolan rhumb lines over the sea), a double scale bar (a native
 * unit above, kilometres below), the graticule with ticks and a degree band in
 * the frame, and a locator globe inset.
 *
 * `planDecor` (pure) chooses positions by scoring candidate boxes against an
 * importance grid of the plate (land, settlements, rivers); the draw*
 * functions use only the standard 2D context API.
 */
import type { Pt } from "./contour";
import { locatorFor, type FieldGrid } from "./field";
import type { Box } from "./labels";
import type { MapRect, Projection } from "./projection";
import type { Measure } from "./model";
import type { PlaceMark } from "./places";
import type { NativeUnit, PlateTitle } from "./names";
import { font, rgba, type Palette } from "./style";
import type { Ctx2D } from "./paper";
import { makeCanvas } from "./paper";
import type { PhysicalWorld } from "../world/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScriptLine {
  /** Path data (units of 1/100 em) with affine matrices, as laid out by src/script. */
  items: { d: string; m: number[] }[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Script name, for a tooltip/legend. */
  name: string;
}

export interface CartoucheLine {
  kind: "pre" | "main" | "rule" | "native" | "script" | "sub";
  text: string;
  /** Baseline (text) or centre (rule/script) y, px. */
  y: number;
  size: number;
}

export interface Cartouche {
  box: MapRect;
  lines: CartoucheLine[];
  script: ScriptLine | null;
  /** Script ink height, px. */
  scriptSize: number;
}

export interface Compass {
  x: number;
  y: number;
  r: number;
  /** Screen angle of true north at the rose, radians (0 = up, positive = clockwise). */
  north: number;
}

export interface ScaleBar {
  x: number;
  y: number;
  /** Width of one native unit step and the number of steps. */
  stepPx: number;
  steps: number;
  stepValue: number;
  caption: string;
  word: string;
  gloss: string;
  kmStepPx: number;
  kmSteps: number;
  kmStep: number;
  box: MapRect;
}

export interface GraticuleTick {
  x: number;
  y: number;
  side: "t" | "b" | "l" | "r";
  label: string;
}

export interface Graticule {
  lines: { pts: Pt[]; major: boolean; equator: boolean }[];
  ticks: GraticuleTick[];
  /** Minor crossings of each frame side (positions along the side, px), for the degree band. */
  band: { side: "t" | "b" | "l" | "r"; at: number[] }[];
}

export interface Inset {
  x: number;
  y: number;
  r: number;
  /** RGBA raster (size × size) of the globe disc. */
  size: number;
  rgba: Uint8ClampedArray;
  /** The plate's outline on the globe (inset px). */
  outline: Pt[];
}

export interface Decor {
  cartouche: Cartouche | null;
  compass: Compass | null;
  scale: ScaleBar | null;
  graticule: Graticule;
  inset: Inset | null;
  /** Boxes reserved for furniture (labels and glyphs keep out). */
  reserved: Box[];
}

export interface DecorInput {
  world: PhysicalWorld;
  proj: Projection;
  f: FieldGrid;
  k: number;
  width: number;
  height: number;
  measure: Measure;
  title: PlateTitle;
  script: ScriptLine | null;
  unit: NativeUnit;
  places: PlaceMark[];
  pal: Palette;
  /** Draw the locator inset (skipped on near-global views). */
  inset: boolean;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

class Importance {
  readonly cols: number;
  readonly rows: number;
  readonly v: Float32Array;
  constructor(readonly rect: MapRect, readonly cell: number) {
    this.cols = Math.ceil(rect.w / cell);
    this.rows = Math.ceil(rect.h / cell);
    this.v = new Float32Array(this.cols * this.rows);
  }
  add(x: number, y: number, w: number): void {
    const i = Math.floor((x - this.rect.x) / this.cell), j = Math.floor((y - this.rect.y) / this.cell);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    this.v[j * this.cols + i] += w;
  }
  mean(b: Box): number {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((b.x0 - this.rect.x) / c)), i1 = Math.min(this.cols - 1, Math.floor((b.x1 - this.rect.x) / c));
    const j0 = Math.max(0, Math.floor((b.y0 - this.rect.y) / c)), j1 = Math.min(this.rows - 1, Math.floor((b.y1 - this.rect.y) / c));
    let s = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { s += this.v[j * this.cols + i]; n++; }
    return n ? s / n : 0;
  }
}

const overlaps = (a: Box, b: Box, pad = 0) => a.x0 - pad < b.x1 && a.x1 + pad > b.x0 && a.y0 - pad < b.y1 && a.y1 + pad > b.y0;

export function planDecor(inp: DecorInput): Decor {
  const { proj, f, k, measure } = inp;
  const rect = proj.rect;
  const imp = new Importance(rect, 12 * k);
  // Land counts, settlements count a lot.
  for (let j = 0; j < f.gy; j += 2)
    for (let i = 0; i < f.gx; i += 2) {
      const q = j * f.gx + i;
      if (f.coast[q] > 0) imp.add(f.x0 + i * f.step, f.y0 + j * f.step, ((2 * f.step) / imp.cell) ** 2);
    }
  for (const p of inp.places) {
    const w = p.tier === "capital" ? 8 : p.tier === "city" ? 5 : p.tier === "town" ? 2 : 0.7;
    imp.add(p.x, p.y, w);
  }
  const reserved: Box[] = [];
  const m = 10 * k;

  // ---- cartouche
  let cartouche: Cartouche | null = null;
  {
    const t = inp.title;
    const preSize = 15.5 * k, nativeSize = 15 * k, subSize = 14 * k, scriptSize = 22 * k;
    let mainSize = 30 * k;
    const mainText = t.main.toLocaleUpperCase();
    const maxW = Math.min(rect.w * 0.44, 640 * k);
    const mainFont = (s: number) => font(s, { sc: true });
    const spaced = (fnt: string, s: string, em: number, size: number) => measure(fnt, s) + Math.max(0, Array.from(s).length - 1) * em * size;
    while (mainSize > 17 * k && spaced(mainFont(mainSize), mainText, 0.08, mainSize) > maxW - 50 * k) mainSize *= 0.93;
    const native = t.native ? t.native.name.roman + (t.native.name.gloss ? `  ·  ‘${t.native.name.gloss}’` : "") : "";
    const widths = [
      t.pre ? measure(font(preSize, { italic: true }), t.pre) : 0,
      spaced(mainFont(mainSize), mainText, 0.08, mainSize),
      native ? measure(font(nativeSize, { italic: true }), native) : 0,
      t.sub ? measure(font(subSize, { italic: true }), t.sub) : 0,
    ];
    let sw = 0;
    if (inp.script) sw = ((inp.script.x1 - inp.script.x0) / 100) * scriptSize;
    const padX = 30 * k, padY = 20 * k;
    const w = Math.min(maxW, Math.max(rect.w * 0.2, Math.max(...widths, sw) + 2 * padX));
    const lines: CartoucheLine[] = [];
    let y = padY;
    if (t.pre) { y += preSize * 1.05; lines.push({ kind: "pre", text: t.pre, y, size: preSize }); y += preSize * 0.35; }
    y += mainSize * 0.92;
    lines.push({ kind: "main", text: mainText, y, size: mainSize });
    y += 10 * k;
    lines.push({ kind: "rule", text: "", y: y + 3 * k, size: 6 * k });
    y += 12 * k;
    if (native) { y += nativeSize * 1.0; lines.push({ kind: "native", text: native, y, size: nativeSize }); y += nativeSize * 0.3; }
    if (inp.script && sw > 0 && sw < w - padX) { y += scriptSize * 0.75; lines.push({ kind: "script", text: inp.script.name, y, size: scriptSize }); y += scriptSize * 0.75; }
    if (t.sub) { y += subSize * 1.15; lines.push({ kind: "sub", text: t.sub, y, size: subSize }); }
    const h = y + padY;
    const corners: { x: number; y: number; pref: number }[] = [
      { x: rect.x + m, y: rect.y + rect.h - m - h, pref: 0 },
      { x: rect.x + rect.w - m - w, y: rect.y + rect.h - m - h, pref: 0.02 },
      { x: rect.x + m, y: rect.y + m, pref: 0.04 },
      { x: rect.x + rect.w - m - w, y: rect.y + m, pref: 0.06 },
    ];
    let best = corners[0], bc = Infinity;
    for (const c of corners) {
      const cost = imp.mean({ x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h }) + c.pref;
      if (cost < bc) { bc = cost; best = c; }
    }
    const box = { x: best.x, y: best.y, w, h };
    for (const l of lines) l.y += box.y;
    cartouche = { box, lines, script: lines.some((l) => l.kind === "script") ? inp.script : null, scriptSize };
    reserved.push({ x0: box.x - 6 * k, y0: box.y - 6 * k, x1: box.x + w + 6 * k, y1: box.y + h + 6 * k });
  }

  // ---- inset
  let inset: Inset | null = null;
  if (inp.inset) {
    const r = Math.round(54 * k);
    const s = 2 * r + 16 * k;
    const cands = [
      { x: rect.x + rect.w - m - s, y: rect.y + m },
      { x: rect.x + m, y: rect.y + m },
      { x: rect.x + rect.w - m - s, y: rect.y + rect.h - m - s },
      { x: rect.x + m, y: rect.y + rect.h - m - s },
    ];
    let best: { x: number; y: number } | null = null, bc = Infinity;
    for (const c of cands) {
      const b = { x0: c.x, y0: c.y, x1: c.x + s, y1: c.y + s };
      if (reserved.some((o) => overlaps(o, b, 4 * k))) continue;
      const cost = imp.mean(b);
      if (cost < bc) { bc = cost; best = c; }
    }
    if (best) {
      inset = buildInset(inp.world, proj, best.x + s / 2, best.y + s / 2, r);
      reserved.push({ x0: best.x, y0: best.y, x1: best.x + s, y1: best.y + s });
    }
  }

  // ---- scale bar
  let scale: ScaleBar | null = null;
  {
    const kmPx = proj.kmPerPx;
    const targetPx = Math.min(rect.w * 0.2, 330 * k);
    const unitKm = inp.unit.km;
    const nice = (x: number) => {
      const p = Math.pow(10, Math.floor(Math.log10(x)));
      const q = x / p;
      return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p;
    };
    // Native: 4-5 steps.
    const totalUnits = (targetPx * kmPx) / unitKm;
    let stepValue = nice(totalUnits / 4);
    if (stepValue < 0.25) stepValue = 0.25;
    const steps = Math.max(2, Math.min(6, Math.round(totalUnits / stepValue)));
    const stepPx = (stepValue * unitKm) / kmPx;
    const kmStep = nice((steps * stepPx * kmPx) / 4);
    const kmSteps = Math.max(2, Math.floor((steps * stepPx * kmPx) / kmStep));
    const kmStepPx = kmStep / kmPx;
    const barW = Math.max(steps * stepPx, kmSteps * kmStepPx);
    const capW = Math.max(measure(font(13 * k, { italic: true }), inp.unit.caption), inp.unit.word ? measure(font(11.5 * k, { italic: true }), `(${inp.unit.word}, ‘${inp.unit.gloss}’)`) : 0);
    const w = Math.max(barW + 30 * k, capW + 10 * k);
    const h = 70 * k;
    const cands: { x: number; y: number }[] = [];
    const bottom = rect.y + rect.h - m - h, top = rect.y + m;
    for (const yy of [bottom, top]) for (const fx of [0, 0.25, 0.5, 0.75, 1]) cands.push({ x: rect.x + m + (rect.w - 2 * m - w) * fx, y: yy });
    if (cartouche) {
      const cb = cartouche.box;
      cands.unshift({ x: cb.x + (cb.w - w) / 2, y: cb.y > rect.y + rect.h / 2 ? cb.y - h - 8 * k : cb.y + cb.h + 8 * k });
    }
    let best: { x: number; y: number } | null = null, bc = Infinity;
    cands.forEach((c, i) => {
      const b = { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h };
      if (b.x0 < rect.x || b.x1 > rect.x + rect.w || b.y0 < rect.y || b.y1 > rect.y + rect.h) return;
      if (reserved.some((o) => overlaps(o, b, 4 * k))) return;
      const cost = imp.mean(b) + i * 0.004;
      if (cost < bc) { bc = cost; best = c; }
    });
    if (best) {
      const b = best as { x: number; y: number };
      scale = {
        x: b.x + (w - barW) / 2, y: b.y + 30 * k, stepPx, steps, stepValue, caption: inp.unit.caption, word: inp.unit.word, gloss: inp.unit.gloss,
        kmStepPx, kmSteps, kmStep, box: { x: b.x, y: b.y, w, h },
      };
      reserved.push({ x0: b.x, y0: b.y, x1: b.x + w, y1: b.y + h });
    }
  }

  // ---- compass rose: prefer open water, away from the centre
  let compass: Compass | null = null;
  {
    const r = Math.min(70 * k, Math.max(44 * k, Math.min(rect.w, rect.h) * 0.072));
    const step = 18 * k;
    let best: { x: number; y: number } | null = null, bc = Infinity;
    const cx0 = rect.x + rect.w / 2, cy0 = rect.y + rect.h / 2;
    for (let y = rect.y + r + 2.2 * m; y <= rect.y + rect.h - r - 1.5 * m; y += step)
      for (let x = rect.x + r + 1.5 * m; x <= rect.x + rect.w - r - 1.5 * m; x += step) {
        const b = { x0: x - r * 1.3, y0: y - r * 1.35, x1: x + r * 1.3, y1: y + r * 1.3 };
        if (reserved.some((o) => overlaps(o, b, 6 * k))) continue;
        const central = 1 - Math.min(1, Math.hypot((x - cx0) / (rect.w / 2), (y - cy0) / (rect.h / 2)));
        const cost = imp.mean(b) + 0.35 * central;
        if (cost < bc) { bc = cost; best = { x, y }; }
      }
    if (best) {
      const b = best as { x: number; y: number };
      // True north at the rose: direction to a point slightly north.
      const ll = proj.inverseLatLon(b.x, b.y);
      let north = 0;
      if (ll) {
        const o = { x: 0, y: 0 };
        const lat = (ll[0] * Math.PI) / 180, lon = (ll[1] * Math.PI) / 180;
        if (Math.abs(ll[0]) < 89.5 && proj.forwardLatLon(Math.min(Math.PI / 2, lat + 0.002), lon, o)) north = Math.atan2(o.x - b.x, -(o.y - b.y));
      }
      compass = { x: b.x, y: b.y, r, north };
      reserved.push({ x0: b.x - r * 1.25, y0: b.y - r * 1.35, x1: b.x + r * 1.25, y1: b.y + r * 1.25 });
    }
  }

  const graticule = buildGraticule(proj, k);
  return { cartouche, compass, scale, graticule, inset, reserved };
}

// ---------------------------------------------------------------------------
// Graticule
// ---------------------------------------------------------------------------

function fmtDeg(v: number, lat: boolean): string {
  const a = Math.round(Math.abs(v));
  if (a === 0) return lat ? "0°" : "0°";
  if (lat) return `${a}°${v > 0 ? "N" : "S"}`;
  if (a === 180) return "180°";
  return `${a}°${v > 0 ? "E" : "W"}`;
}

export function buildGraticule(proj: Projection, k: number): Graticule {
  const rect = proj.rect;
  const angR = proj.view.radiusKm / proj.R; // radians to the nearest edge
  const degR = (angR * 180) / Math.PI;
  const g = degR > 30 ? 15 : degR > 14 ? 10 : degR > 6 ? 5 : degR > 2.5 ? 2 : 1;
  const minor = g >= 10 ? g / 5 : g >= 5 ? 1 : g / 2;
  // Visible extents.
  let latMin = 90, latMax = -90;
  const lon0 = proj.view.centerLon;
  let dlMin = 180, dlMax = -180;
  const N = 14;
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const ll = proj.inverseLatLon(rect.x + (rect.w * i) / N, rect.y + (rect.h * j) / N);
      if (!ll) continue;
      latMin = Math.min(latMin, ll[0]);
      latMax = Math.max(latMax, ll[0]);
      let dl = ll[1] - lon0;
      while (dl > 180) dl -= 360;
      while (dl < -180) dl += 360;
      dlMin = Math.min(dlMin, dl);
      dlMax = Math.max(dlMax, dl);
    }
  const o = { x: 0, y: 0 };
  // Pole in view → all longitudes.
  const poleN = proj.forwardLatLon(Math.PI / 2, 0, o) && o.x > rect.x && o.x < rect.x + rect.w && o.y > rect.y && o.y < rect.y + rect.h;
  const poleS = proj.forwardLatLon(-Math.PI / 2, 0, o) && o.x > rect.x && o.x < rect.x + rect.w && o.y > rect.y && o.y < rect.y + rect.h;
  if (poleN) latMax = 90;
  if (poleS) latMin = -90;
  if (poleN || poleS) { dlMin = -180; dlMax = 180; }
  latMin = Math.max(-90, latMin - minor);
  latMax = Math.min(90, latMax + minor);
  dlMin -= minor;
  dlMax += minor;
  const D = Math.PI / 180;
  const lines: Graticule["lines"] = [];
  const pad = 40 * k;
  const inBig = (x: number, y: number) => x > rect.x - pad && x < rect.x + rect.w + pad && y > rect.y - pad && y < rect.y + rect.h + pad;
  const trace = (fn: (t: number) => [number, number], t0: number, t1: number, dt: number): Pt[][] => {
    const segs: Pt[][] = [];
    let cur: Pt[] = [];
    for (let t = t0; t <= t1 + 1e-9; t += dt) {
      const [la, lo] = fn(t);
      if (proj.forwardLatLon(la * D, lo * D, o) && inBig(o.x, o.y)) cur.push([o.x, o.y]);
      else if (cur.length) { if (cur.length > 1) segs.push(cur); cur = []; }
    }
    if (cur.length > 1) segs.push(cur);
    return segs;
  };
  const dStep = Math.max(0.05, Math.min(1, degR / 60));
  const ticks: GraticuleTick[] = [];
  const band: Graticule["band"] = [{ side: "t", at: [] }, { side: "b", at: [] }, { side: "l", at: [] }, { side: "r", at: [] }];
  const crossings = (segs: Pt[][], label: string, isMajor: boolean, kind: "lat" | "lon") => {
    for (const s of segs)
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i];
        const edges: ["t" | "b" | "l" | "r", number][] = [["t", rect.y], ["b", rect.y + rect.h], ["l", rect.x], ["r", rect.x + rect.w]];
        for (const [side, v] of edges) {
          const horiz = side === "t" || side === "b";
          const pa = horiz ? a[1] : a[0], pb = horiz ? b[1] : b[0];
          if ((pa - v) * (pb - v) > 0 || pa === pb) continue;
          const t = (v - pa) / (pb - pa);
          const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
          const along = horiz ? x : y;
          if (horiz ? x < rect.x || x > rect.x + rect.w : y < rect.y || y > rect.y + rect.h) continue;
          // Band: meridians mark the top/bottom, parallels the sides.
          if ((kind === "lon") === horiz) band.find((bb) => bb.side === side)!.at.push(along);
          if (isMajor) ticks.push({ x: horiz ? x : v, y: horiz ? v : y, side, label });
        }
      }
  };
  // Parallels.
  for (let lat = Math.ceil(latMin / minor) * minor; lat <= latMax + 1e-9; lat += minor) {
    if (Math.abs(lat) >= 89.999) continue;
    const isMajor = Math.abs(lat / g - Math.round(lat / g)) < 1e-6;
    const segs = trace((t) => [lat, lon0 + t], dlMin, dlMax, dStep);
    crossings(segs, fmtDeg(lat, true), isMajor, "lat");
    if (isMajor) for (const s of segs) lines.push({ pts: s, major: true, equator: Math.abs(lat) < 1e-6 });
  }
  // Meridians.
  const lonStart = Math.ceil((lon0 + dlMin) / minor) * minor;
  for (let lon = lonStart; lon <= lon0 + dlMax + 1e-9; lon += minor) {
    let L = lon;
    while (L > 180) L -= 360;
    while (L <= -180) L += 360;
    const isMajor = Math.abs(L / g - Math.round(L / g)) < 1e-6;
    const segs = trace((t) => [t, L], Math.max(-89.9, latMin), Math.min(89.9, latMax), dStep);
    crossings(segs, fmtDeg(L, false), isMajor, "lon");
    if (isMajor) for (const s of segs) lines.push({ pts: s, major: true, equator: false });
  }
  for (const b of band) b.at.sort((x, y) => x - y);
  // Drop ticks too close to each other or to the corners.
  const kept: GraticuleTick[] = [];
  for (const t of ticks) {
    const along = t.side === "t" || t.side === "b" ? t.x : t.y;
    const lo = t.side === "t" || t.side === "b" ? rect.x : rect.y;
    const hi = lo + (t.side === "t" || t.side === "b" ? rect.w : rect.h);
    if (along - lo < 26 * k || hi - along < 26 * k) continue;
    if (kept.some((q) => q.side === t.side && Math.abs((q.side === "t" || q.side === "b" ? q.x : q.y) - along) < 40 * k)) continue;
    kept.push(t);
  }
  return { lines, ticks: kept, band };
}

// ---------------------------------------------------------------------------
// Locator inset
// ---------------------------------------------------------------------------

function buildInset(world: PhysicalWorld, proj: Projection, cx: number, cy: number, r: number): Inset {
  const size = 2 * r;
  const rgbaArr = new Uint8ClampedArray(size * size * 4);
  const loc = locatorFor(world);
  const c = proj.c, e = proj.e, n = proj.n;
  // Orthographic globe centred on the plate centre; tilt the view a little south so the north reads "up".
  let hint = -1;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const X = (i + 0.5 - r) / r, Y = (r - j - 0.5) / r;
      const rho2 = X * X + Y * Y;
      const o = 4 * (j * size + i);
      if (rho2 >= 1) continue;
      const Z = Math.sqrt(1 - rho2);
      const x = c[0] * Z + e[0] * X + n[0] * Y;
      const y = c[1] * Z + e[1] * X + n[1] * Y;
      const z = c[2] * Z + e[2] * X + n[2] * Y;
      const cell = loc.find(x, y, z, hint);
      hint = cell;
      const land = world.isLand[cell] && world.lakeId[cell] < 0;
      // Limb shading.
      const shade = 0.78 + 0.22 * Z;
      if (land) {
        const el = Math.max(0, world.elevation[cell]);
        const t = Math.min(1, el / 3);
        rgbaArr[o] = (214 - 40 * t) * shade;
        rgbaArr[o + 1] = (196 - 46 * t) * shade;
        rgbaArr[o + 2] = (158 - 50 * t) * shade;
      } else {
        rgbaArr[o] = 150 * shade;
        rgbaArr[o + 1] = 176 * shade;
        rgbaArr[o + 2] = 178 * shade;
      }
      rgbaArr[o + 3] = 255;
    }
  // Plate outline: rect boundary → sphere → orthographic.
  const outline: Pt[] = [];
  const rect = proj.rect;
  const v = [0, 0, 0];
  const per = 24;
  const pts: [number, number][] = [];
  for (let s = 0; s < per; s++) pts.push([rect.x + (rect.w * s) / per, rect.y]);
  for (let s = 0; s < per; s++) pts.push([rect.x + rect.w, rect.y + (rect.h * s) / per]);
  for (let s = 0; s < per; s++) pts.push([rect.x + rect.w - (rect.w * s) / per, rect.y + rect.h]);
  for (let s = 0; s < per; s++) pts.push([rect.x, rect.y + rect.h - (rect.h * s) / per]);
  for (const [sx, sy] of pts) {
    if (!proj.inverse(sx, sy, v)) continue;
    const X = v[0] * e[0] + v[1] * e[1] + v[2] * e[2];
    const Y = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    const Z = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
    const L = Z < 0 ? Math.hypot(X, Y) || 1 : 1;
    outline.push([cx + (X / L) * r, cy - (Y / L) * r]);
  }
  return { x: cx, y: cy, r, size, rgba: rgbaArr, outline };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface DecorEnv {
  pal: Palette;
  k: number;
  colour: boolean;
}

/** Faint graticule lines (drawn under the glyphs). */
export function drawGraticuleLines(ctx: Ctx2D, g: Graticule, rect: MapRect, env: DecorEnv): void {
  const { pal, k } = env;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.lineCap = "round";
  for (const l of g.lines) {
    ctx.beginPath();
    ctx.moveTo(l.pts[0][0], l.pts[0][1]);
    for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i][0], l.pts[i][1]);
    ctx.strokeStyle = rgba(pal.waterInk, l.equator ? 0.42 : 0.2);
    ctx.lineWidth = (l.equator ? 0.9 : 0.55) * k;
    if (l.equator) ctx.setLineDash([6 * k, 2.5 * k, 1 * k, 2.5 * k]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Ticks, labels and the alternating degree band in the frame margin. */
export function drawGraticuleFrame(ctx: Ctx2D, g: Graticule, rect: MapRect, frame: MapRect, env: DecorEnv): void {
  const { pal, k } = env;
  ctx.save();
  // Degree band: a thin strip just outside the map rect, alternately inked.
  const bw = Math.max(2.5 * k, (rect.x - frame.x) * 0.38);
  for (const b of g.band) {
    const horiz = b.side === "t" || b.side === "b";
    const lo = horiz ? rect.x : rect.y;
    const hi = lo + (horiz ? rect.w : rect.h);
    const stops = [lo, ...b.at.filter((v) => v > lo && v < hi), hi];
    for (let i = 0; i < stops.length - 1; i++) {
      if (i % 2) continue;
      const a = stops[i], c = stops[i + 1];
      ctx.beginPath();
      if (b.side === "t") ctx.rect(a, rect.y - bw, c - a, bw);
      else if (b.side === "b") ctx.rect(a, rect.y + rect.h, c - a, bw);
      else if (b.side === "l") ctx.rect(rect.x - bw, a, bw, c - a);
      else ctx.rect(rect.x + rect.w, a, bw, c - a);
      ctx.fillStyle = rgba(pal.ink, 0.78);
      ctx.fill();
    }
    ctx.beginPath();
    if (b.side === "t") ctx.rect(rect.x, rect.y - bw, rect.w, bw);
    else if (b.side === "b") ctx.rect(rect.x, rect.y + rect.h, rect.w, bw);
    else if (b.side === "l") ctx.rect(rect.x - bw, rect.y, bw, rect.h);
    else ctx.rect(rect.x + rect.w, rect.y, bw, rect.h);
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 0.5 * k;
    ctx.stroke();
  }
  // Ticks into the map and labels in the outer margin.
  ctx.font = font(9.5 * k, { italic: true });
  ctx.fillStyle = pal.ink;
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 0.7 * k;
  const outer = rect.x - frame.x;
  for (const t of g.ticks) {
    ctx.beginPath();
    if (t.side === "t") { ctx.moveTo(t.x, rect.y - bw); ctx.lineTo(t.x, rect.y + 5 * k); }
    else if (t.side === "b") { ctx.moveTo(t.x, rect.y + rect.h + bw); ctx.lineTo(t.x, rect.y + rect.h - 5 * k); }
    else if (t.side === "l") { ctx.moveTo(rect.x - bw, t.y); ctx.lineTo(rect.x + 5 * k, t.y); }
    else { ctx.moveTo(rect.x + rect.w + bw, t.y); ctx.lineTo(rect.x + rect.w - 5 * k, t.y); }
    ctx.stroke();
    ctx.save();
    const mid = outer * 0.5 + bw * 0.5;
    if (t.side === "t") { ctx.translate(t.x, rect.y - mid - 0.5 * k); }
    else if (t.side === "b") { ctx.translate(t.x, rect.y + rect.h + mid + 0.5 * k); }
    else if (t.side === "l") { ctx.translate(rect.x - mid - 0.5 * k, t.y); ctx.rotate(-Math.PI / 2); }
    else { ctx.translate(rect.x + rect.w + mid + 0.5 * k, t.y); ctx.rotate(Math.PI / 2); }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Paper knock-out behind the numerals.
    const tw = ctx.measureText(t.label).width;
    ctx.fillStyle = pal.paper;
    ctx.fillRect(-tw / 2 - 2 * k, -5 * k, tw + 4 * k, 10 * k);
    ctx.fillStyle = pal.ink;
    ctx.fillText(t.label, 0, 0.5 * k);
    ctx.restore();
  }
  ctx.restore();
}

/** Portolan rhumb lines from the rose, over the sea only (caller clips to water). */
export function drawRhumbs(ctx: Ctx2D, c: Compass, rect: MapRect, env: DecorEnv): void {
  const { pal, k } = env;
  const L = Math.hypot(rect.w, rect.h);
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < 32; i++) {
    const a = c.north + (i * Math.PI) / 16;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.sin(a) * c.r * 1.02, c.y - Math.cos(a) * c.r * 1.02);
    ctx.lineTo(c.x + Math.sin(a) * L, c.y - Math.cos(a) * L);
    const card = i % 8 === 0, half = i % 4 === 0;
    ctx.strokeStyle = env.colour && i % 2 === 0 && !card ? rgba(pal.red, half ? 0.2 : 0.14) : rgba(pal.waterInk, card ? 0.24 : half ? 0.17 : 0.11);
    ctx.lineWidth = (card ? 0.7 : 0.5) * k;
    ctx.stroke();
  }
  ctx.restore();
}

function fleurDeLis(ctx: Ctx2D, h: number): void {
  // Drawn upward from (0, 0) to (0, -h).
  const w = h * 0.62;
  ctx.beginPath();
  // central petal
  ctx.moveTo(0, -h * 0.18);
  ctx.bezierCurveTo(-w * 0.34, -h * 0.42, -w * 0.2, -h * 0.82, 0, -h);
  ctx.bezierCurveTo(w * 0.2, -h * 0.82, w * 0.34, -h * 0.42, 0, -h * 0.18);
  // side petals
  for (const s of [-1, 1]) {
    ctx.moveTo(s * w * 0.08, -h * 0.26);
    ctx.bezierCurveTo(s * w * 0.42, -h * 0.62, s * w * 0.95, -h * 0.55, s * w * 0.78, -h * 0.22);
    ctx.bezierCurveTo(s * w * 0.68, -h * 0.05, s * w * 0.44, -h * 0.2, s * w * 0.5, -h * 0.32);
    ctx.bezierCurveTo(s * w * 0.4, -h * 0.25, s * w * 0.2, -h * 0.14, s * w * 0.08, -h * 0.26);
  }
  // band
  ctx.rect(-w * 0.34, -h * 0.2, w * 0.68, h * 0.08);
  // foot
  ctx.moveTo(-w * 0.12, -h * 0.12);
  ctx.lineTo(w * 0.12, -h * 0.12);
  ctx.lineTo(0, 0);
  ctx.closePath();
}

export function drawCompass(ctx: Ctx2D, c: Compass, env: DecorEnv): void {
  const { pal, k } = env;
  const R = c.r;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.north);
  ctx.lineJoin = "miter";
  // Rings.
  const ring = (r: number, w: number) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = w;
    ctx.stroke();
  };
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = rgba(pal.paper, 0.82);
  ctx.fill();
  ctx.strokeStyle = pal.ink;
  ring(R * 0.9, 0.9 * k);
  ring(R * 0.8, 0.6 * k);
  ring(R * 0.42, 0.6 * k);
  // Degree ticks between the outer rings.
  ctx.beginPath();
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const r0 = R * (i % 4 === 0 ? 0.8 : 0.84);
    ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
    ctx.lineTo(Math.sin(a) * R * 0.9, -Math.cos(a) * R * 0.9);
  }
  ctx.lineWidth = 0.5 * k;
  ctx.stroke();
  // Star points: 8 by-points, 4 half-winds, 4 cardinals (back to front).
  const pt = (a: number, len: number, wid: number, dark: string, light: string) => {
    const tip: Pt = [Math.sin(a) * len, -Math.cos(a) * len];
    const l: Pt = [Math.sin(a - Math.PI / 2) * wid, -Math.cos(a - Math.PI / 2) * wid];
    const r: Pt = [Math.sin(a + Math.PI / 2) * wid, -Math.cos(a + Math.PI / 2) * wid];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(l[0], l[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.closePath();
    ctx.fillStyle = light;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r[0], r[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.closePath();
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.stroke();
  };
  ctx.lineWidth = 0.6 * k;
  ctx.strokeStyle = pal.ink;
  const red = env.colour ? rgba(pal.red, 0.85) : pal.inkSoft;
  for (let i = 0; i < 8; i++) pt(((2 * i + 1) * Math.PI) / 8, R * 0.56, R * 0.07, rgba(pal.ink, 0.55), pal.paper);
  for (let i = 0; i < 4; i++) pt(((2 * i + 1) * Math.PI) / 4, R * 0.72, R * 0.1, red, pal.paper);
  for (let i = 0; i < 4; i++) pt((i * Math.PI) / 2, R * (i === 0 ? 0.98 : 0.92), R * 0.13, pal.ink, pal.paper);
  // Centre boss.
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.025, 0, Math.PI * 2);
  ctx.fillStyle = pal.ink;
  ctx.fill();
  // Fleur-de-lis beyond the north point.
  ctx.save();
  ctx.translate(0, -R * 0.99);
  fleurDeLis(ctx, R * 0.36);
  ctx.fillStyle = env.colour ? rgba(pal.red, 0.9) : pal.ink;
  ctx.fill("nonzero");
  ctx.lineWidth = 0.5 * k;
  ctx.strokeStyle = pal.ink;
  ctx.stroke();
  ctx.restore();
  // Cardinal letters (E, S, W) just outside the ring.
  ctx.font = font(R * 0.2, { sc: true });
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pal.ink;
  const letters: [string, number][] = [["E", Math.PI / 2], ["S", Math.PI], ["W", (3 * Math.PI) / 2]];
  for (const [ch, a] of letters) {
    ctx.save();
    ctx.translate(Math.sin(a) * R * 1.07, -Math.cos(a) * R * 1.07);
    ctx.rotate(a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

export function drawScaleBar(ctx: Ctx2D, s: ScaleBar, env: DecorEnv): void {
  const { pal, k } = env;
  ctx.save();
  const h = 4 * k;
  const total = s.steps * s.stepPx;
  // Native bar: alternating segments, the first subdivided into quarters.
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 0.7 * k;
  for (let i = 0; i < s.steps; i++) {
    const x = s.x + i * s.stepPx;
    if (i === 0) {
      for (let q = 0; q < 4; q++) {
        ctx.beginPath();
        ctx.rect(x + (q * s.stepPx) / 4, s.y + (q % 2 ? h / 2 : 0), s.stepPx / 4, h / 2);
        ctx.fillStyle = pal.ink;
        ctx.fill();
      }
    } else if (i % 2 === 1) {
      ctx.beginPath();
      ctx.rect(x, s.y, s.stepPx, h);
      ctx.fillStyle = pal.ink;
      ctx.fill();
    }
  }
  ctx.strokeRect(s.x, s.y, total, h);
  ctx.font = font(10.5 * k, { italic: true });
  ctx.fillStyle = pal.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 2 : 1));
  for (let i = 0; i <= s.steps; i++) ctx.fillText(fmt(i * s.stepValue), s.x + i * s.stepPx, s.y - 3.5 * k);
  // Caption above.
  ctx.font = font(13 * k, { italic: true });
  const cx = s.x + total / 2;
  ctx.fillText(s.caption, cx, s.y - 17 * k);
  // Kilometre bar below.
  const ky = s.y + h + 9 * k;
  ctx.beginPath();
  ctx.moveTo(s.x, ky);
  ctx.lineTo(s.x + s.kmSteps * s.kmStepPx, ky);
  for (let i = 0; i <= s.kmSteps; i++) {
    ctx.moveTo(s.x + i * s.kmStepPx, ky - 2.5 * k);
    ctx.lineTo(s.x + i * s.kmStepPx, ky + 2.5 * k);
  }
  ctx.lineWidth = 0.7 * k;
  ctx.stroke();
  ctx.font = font(9.5 * k, { italic: true });
  for (let i = 0; i <= s.kmSteps; i++) ctx.fillText(String(i * s.kmStep), s.x + i * s.kmStepPx, ky + 12 * k);
  ctx.textAlign = "left";
  ctx.fillText("km", s.x + s.kmSteps * s.kmStepPx + 5 * k, ky + 3 * k);
  if (s.word) {
    ctx.textAlign = "center";
    ctx.font = font(11 * k, { italic: true });
    ctx.fillStyle = pal.inkSoft;
    ctx.fillText(`(${s.word}, ‘a ${s.gloss}’s march’)`, cx, ky + 26 * k);
  }
  ctx.restore();
}

/** Ornamental cartouche panel with concave corners, double rules, scrolls and the title lines. */
export function drawCartouche(ctx: Ctx2D, c: Cartouche, env: DecorEnv): void {
  const { pal, k } = env;
  const { x, y, w, h } = c.box;
  const cr = 9 * k;
  const panel = (inset: number) => {
    const x0 = x + inset, y0 = y + inset, x1 = x + w - inset, y1 = y + h - inset, r = Math.max(2 * k, cr - inset * 0.6);
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x1 - r, y0);
    ctx.arc(x1, y0, r, Math.PI, Math.PI / 2, true);
    ctx.lineTo(x1, y1 - r);
    ctx.arc(x1, y1, r, -Math.PI / 2, Math.PI, true);
    ctx.lineTo(x0 + r, y1);
    ctx.arc(x0, y1, r, 0, -Math.PI / 2, true);
    ctx.lineTo(x0, y0 + r);
    ctx.arc(x0, y0, r, Math.PI / 2, 0, true);
    ctx.closePath();
  };
  ctx.save();
  // Shadow.
  ctx.save();
  ctx.translate(2.5 * k, 3 * k);
  panel(0);
  ctx.fillStyle = rgba(pal.ink, 0.16);
  ctx.fill();
  ctx.restore();
  panel(0);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1.8 * k;
  ctx.stroke();
  panel(4 * k);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  // Light wash inside.
  panel(4 * k);
  ctx.fillStyle = rgba(pal.paperDark, 0.16);
  ctx.fill();
  // Corner rosettes.
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as Pt[]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4 * k, 0, Math.PI * 2);
    ctx.fillStyle = pal.ink;
    ctx.fill();
  }
  // Scroll flourishes at the top and bottom centres.
  const scroll = (cy: number, dir: number) => {
    const cx = x + w / 2;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(cx, cy);
      ctx.bezierCurveTo(cx + s * 14 * k, cy - dir * 9 * k, cx + s * 30 * k, cy + dir * 4 * k, cx + s * 44 * k, cy - dir * 2 * k);
      ctx.moveTo(cx + s * 44 * k, cy - dir * 2 * k);
      ctx.bezierCurveTo(cx + s * 50 * k, cy - dir * 5 * k, cx + s * 52 * k, cy - dir * 10 * k, cx + s * 47 * k, cy - dir * 10 * k);
    }
    ctx.lineWidth = 0.9 * k;
    ctx.strokeStyle = pal.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - dir * 6 * k);
    ctx.lineTo(cx + 4 * k, cy);
    ctx.lineTo(cx, cy + dir * 6 * k);
    ctx.lineTo(cx - 4 * k, cy);
    ctx.closePath();
    ctx.fillStyle = env.colour ? rgba(pal.red, 0.85) : pal.ink;
    ctx.fill();
  };
  scroll(y, 1);
  scroll(y + h, -1);
  // Text.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cx = x + w / 2;
  for (const l of c.lines) {
    switch (l.kind) {
      case "pre":
        ctx.font = font(l.size, { italic: true });
        ctx.fillStyle = pal.inkSoft;
        ctx.fillText(l.text, cx, l.y);
        break;
      case "main":
        ctx.font = font(l.size, { sc: true });
        ctx.fillStyle = env.colour ? mixInk(pal) : pal.ink;
        spacedText(ctx, l.text, cx, l.y, l.size * 0.08);
        break;
      case "rule": {
        const half = Math.min(w * 0.36, 160 * k);
        ctx.beginPath();
        ctx.moveTo(cx - half, l.y);
        ctx.quadraticCurveTo(cx - half * 0.5, l.y - 1.2 * k, cx - 7 * k, l.y);
        ctx.moveTo(cx + 7 * k, l.y);
        ctx.quadraticCurveTo(cx + half * 0.5, l.y - 1.2 * k, cx + half, l.y);
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 0.8 * k;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, l.y - 3.5 * k);
        ctx.lineTo(cx + 4.5 * k, l.y);
        ctx.lineTo(cx, l.y + 3.5 * k);
        ctx.lineTo(cx - 4.5 * k, l.y);
        ctx.closePath();
        ctx.fillStyle = pal.ink;
        ctx.fill();
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + s * (half + 2.5 * k), l.y, 1.4 * k, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "native":
        ctx.font = font(l.size, { italic: true });
        ctx.fillStyle = pal.ink;
        ctx.fillText(l.text, cx, l.y);
        break;
      case "script":
        if (c.script) drawScriptLine(ctx, c.script, cx, l.y, c.scriptSize, env.colour ? mixInk(pal) : pal.ink);
        break;
      case "sub":
        ctx.font = font(l.size, { italic: true });
        ctx.fillStyle = pal.inkSoft;
        ctx.fillText(l.text, cx, l.y);
        break;
    }
  }
  ctx.restore();
}

function mixInk(pal: Palette): string {
  // A warmer, slightly red-brown ink for titles in colour styles.
  return pal.red === "#9a3524" ? "#5a2418" : pal.ink;
}

function spacedText(ctx: Ctx2D, text: string, cx: number, y: number, spacing: number): void {
  const chars = Array.from(text);
  const ws = chars.map((c) => ctx.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += ws[i] + spacing;
  }
  ctx.textAlign = "center";
}

function drawScriptLine(ctx: Ctx2D, s: ScriptLine, cx: number, cy: number, size: number, color: string): void {
  if (typeof Path2D === "undefined") return;
  const sc = size / 100;
  const w = (s.x1 - s.x0) * sc, h = (s.y1 - s.y0) * sc;
  ctx.save();
  ctx.translate(cx - w / 2 - s.x0 * sc, cy - h / 2 - s.y0 * sc);
  ctx.scale(sc, sc);
  ctx.fillStyle = color;
  for (const it of s.items) {
    const m = it.m;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    try {
      ctx.fill(new Path2D(it.d));
    } catch {
      /* malformed path: skip */
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Locator globe with the plate's outline. */
export function drawInset(ctx: Ctx2D, ins: Inset, env: DecorEnv): void {
  const { pal, k } = env;
  const cv = makeCanvas(ins.size, ins.size);
  const c2 = cv.getContext("2d") as Ctx2D | null;
  ctx.save();
  // Paper disc behind (with a soft shadow ring).
  ctx.beginPath();
  ctx.arc(ins.x + 1.5 * k, ins.y + 2 * k, ins.r + 3 * k, 0, Math.PI * 2);
  ctx.fillStyle = rgba(pal.ink, 0.14);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ins.x, ins.y, ins.r + 4 * k, 0, Math.PI * 2);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  if (c2) {
    const img = c2.createImageData(ins.size, ins.size);
    img.data.set(ins.rgba);
    c2.putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ins.x, ins.y, ins.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(cv as CanvasImageSource, ins.x - ins.r, ins.y - ins.r, ins.size, ins.size);
    ctx.restore();
  }
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1.1 * k;
  ctx.beginPath();
  ctx.arc(ins.x, ins.y, ins.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.5 * k;
  ctx.beginPath();
  ctx.arc(ins.x, ins.y, ins.r + 4 * k, 0, Math.PI * 2);
  ctx.stroke();
  if (ins.outline.length > 2) {
    ctx.beginPath();
    ctx.moveTo(ins.outline[0][0], ins.outline[0][1]);
    for (let i = 1; i < ins.outline.length; i++) ctx.lineTo(ins.outline[i][0], ins.outline[i][1]);
    ctx.closePath();
    ctx.fillStyle = env.colour ? rgba(pal.red, 0.16) : rgba(pal.ink, 0.12);
    ctx.fill();
    ctx.strokeStyle = env.colour ? pal.red : pal.ink;
    ctx.lineWidth = 1.2 * k;
    ctx.stroke();
  }
  ctx.restore();
}
