/**
 * Debug map rendering for the history simulation (Node only): equirectangular
 * political / cultural / religious maps over a pale relief, with borders,
 * settlements, capitals and a few labels. Used by tools/history-run.ts.
 */
import { CellLocator } from "../src/core/sphere";
import type { PhysicalWorld } from "../src/world/types";
import type { History, RGB } from "../src/history/types";
import { layerAt, populationAt, settlementName, polityName, capitalAt } from "../src/history/query";
import { writePNG } from "./png";

const FONT: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7], "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7], "6": [7, 4, 7, 5, 7], "7": [7, 1, 1, 2, 2], "8": [7, 5, 7, 5, 7], "9": [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], "-": [0, 0, 7, 0, 0], ".": [0, 0, 0, 0, 2], ":": [0, 2, 0, 2, 0], " ": [0, 0, 0, 0, 0],
  "'": [2, 2, 0, 0, 0],
};

export class MapCanvas {
  readonly rgba: Uint8ClampedArray;
  readonly pix: Int32Array;
  readonly base: Uint8ClampedArray;
  constructor(readonly world: PhysicalWorld, readonly w: number, readonly h: number) {
    this.rgba = new Uint8ClampedArray(w * h * 4);
    this.pix = new Int32Array(w * h);
    const loc = new CellLocator(world.mesh);
    let hint = -1;
    for (let y = 0; y < h; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
      for (let x = 0; x < w; x++) {
        const lon = -Math.PI + ((x + 0.5) / w) * 2 * Math.PI;
        const c = loc.find(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat), hint);
        this.pix[y * w + x] = c;
        hint = c;
      }
    }
    this.base = new Uint8ClampedArray(w * h * 4);
    const { elevation, isLand, lakeId, riverOrder } = world;
    for (let i = 0; i < w * h; i++) {
      const c = this.pix[i];
      let col: RGB;
      if (!isLand[c]) {
        const d = Math.min(1, -elevation[c] / 5);
        col = [Math.round(196 - 60 * d), Math.round(214 - 50 * d), Math.round(226 - 30 * d)];
      } else if (lakeId[c] >= 0) col = [150, 186, 214];
      else {
        const e = Math.min(1, Math.max(0, elevation[c]) / 3.5);
        col = [Math.round(236 - 80 * e), Math.round(230 - 90 * e), Math.round(212 - 90 * e)];
        if (riverOrder[c] >= 3) col = [Math.round(col[0] * 0.8), Math.round(col[1] * 0.88), Math.round(col[2] * 1.02)];
      }
      this.base[4 * i] = col[0];
      this.base[4 * i + 1] = col[1];
      this.base[4 * i + 2] = col[2];
      this.base[4 * i + 3] = 255;
    }
  }

  reset(): void {
    this.rgba.set(this.base);
  }

  /** Colour cells by a per-cell layer value with a colour function, with borders between values. */
  overlay(layer: Int32Array, color: (v: number) => RGB | null, alpha = 0.7, borders = true): void {
    const { w, h, pix, rgba } = this;
    for (let i = 0; i < w * h; i++) {
      const v = layer[pix[i]];
      if (v < 0) continue;
      const col = color(v);
      if (!col) continue;
      rgba[4 * i] += (col[0] - rgba[4 * i]) * alpha;
      rgba[4 * i + 1] += (col[1] - rgba[4 * i + 1]) * alpha;
      rgba[4 * i + 2] += (col[2] - rgba[4 * i + 2]) * alpha;
    }
    if (!borders) return;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = layer[pix[i]];
        const r = layer[pix[y * w + ((x + 1) % w)]];
        const d = y + 1 < h ? layer[pix[i + w]] : v;
        if ((v !== r && (v >= 0 || r >= 0)) || (v !== d && (v >= 0 || d >= 0))) {
          if (!this.world.isLand[pix[i]]) continue;
          rgba[4 * i] *= 0.35;
          rgba[4 * i + 1] *= 0.35;
          rgba[4 * i + 2] *= 0.35;
        }
      }
    }
  }

  project(pos: [number, number, number]): [number, number] {
    const lat = Math.asin(Math.max(-1, Math.min(1, pos[2])));
    const lon = Math.atan2(pos[1], pos[0]);
    return [((lon + Math.PI) / (2 * Math.PI)) * this.w, ((Math.PI / 2 - lat) / Math.PI) * this.h];
  }

  dot(x: number, y: number, r: number, col: RGB): void {
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        this.set(Math.floor(x + dx), Math.floor(y + dy), col);
      }
    }
  }

  set(x: number, y: number, col: RGB): void {
    if (y < 0 || y >= this.h) return;
    x = ((x % this.w) + this.w) % this.w;
    const i = 4 * (y * this.w + x);
    this.rgba[i] = col[0];
    this.rgba[i + 1] = col[1];
    this.rgba[i + 2] = col[2];
  }

  text(s: string, x: number, y: number, scale: number, col: RGB, shadow: RGB | null = [255, 255, 255]): void {
    const ascii = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    const draw = (ox: number, oy: number, c: RGB) => {
      let cx = ox;
      for (const ch of ascii) {
        const g = FONT[ch];
        if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r] & (4 >> k)) for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) this.set(cx + k * scale + a, oy + r * scale + b, c);
        cx += 4 * scale;
      }
    };
    if (shadow) {
      draw(x + 1, y, shadow);
      draw(x - 1, y, shadow);
      draw(x, y + 1, shadow);
      draw(x, y - 1, shadow);
    }
    draw(x, y, col);
  }

  save(path: string): void {
    writePNG(path, this.w, this.h, this.rgba);
  }
}

/** Political map of a history at a year. */
export function politicalMap(cv: MapCanvas, h: History, year: number, labels = true): void {
  cv.reset();
  const owner = layerAt(h.timeline.owner, h.timeline, year);
  cv.overlay(owner, (v) => h.polities[v]?.color ?? null, 0.62);
  drawSettlements(cv, h, year);
  if (labels) {
    // Label the largest realms at their capitals.
    const area = new Map<number, number>();
    for (let c = 0; c < owner.length; c++) if (owner[c] >= 0) area.set(owner[c], (area.get(owner[c]) ?? 0) + 1);
    const top = [...area.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    for (const [pid, cells] of top) {
      if (cells < 25) continue;
      const cap = capitalAt(h, pid, year);
      if (cap < 0) continue;
      const [x, y] = cv.project(h.settlements[cap].pos);
      cv.text(polityName(h, pid, year).roman, Math.round(x) + 4, Math.round(y) - 3, 1, [20, 20, 30]);
    }
  }
  cv.text(`YEAR ${year}`, 8, 8, 2, [30, 30, 40]);
}

export function layerMap(cv: MapCanvas, h: History, year: number, which: "culture" | "religion"): void {
  cv.reset();
  const layer = layerAt(h.timeline[which], h.timeline, year);
  cv.overlay(layer, (v) => (which === "culture" ? h.cultures[v]?.color : h.religions[v]?.color) ?? null, 0.7);
  drawSettlements(cv, h, year, false);
  // Label each culture/religion at its most common cell (approximate centroid).
  const pos = new Map<number, { x: number; y: number; n: number }>();
  for (let i = 0; i < cv.w * cv.h; i += 7) {
    const v = layer[cv.pix[i]];
    if (v < 0) continue;
    const p = pos.get(v) ?? { x: 0, y: 0, n: 0 };
    p.x += i % cv.w;
    p.y += Math.floor(i / cv.w);
    p.n++;
    pos.set(v, p);
  }
  for (const [v, p] of pos) {
    if (p.n < 40) continue;
    const name = which === "culture" ? h.cultures[v].adjective : h.religions[v].english.replace(/^the /, "");
    cv.text(name, Math.round(p.x / p.n) - name.length * 2, Math.round(p.y / p.n), 1, [10, 10, 20]);
  }
  cv.text(`${which.toUpperCase()} ${year}`, 8, 8, 2, [30, 30, 40]);
}

function drawSettlements(cv: MapCanvas, h: History, year: number, capitals = true): void {
  const caps = new Set<number>();
  if (capitals) for (const p of h.polities) if (p.founded <= year && (p.ended < 0 || p.ended > year)) caps.add(capitalAt(h, p.id, year));
  for (const s of h.settlements) {
    if (s.founded > year || (s.ended >= 0 && s.ended <= year)) continue;
    const pop = populationAt(h, s, year);
    const [x, y] = cv.project(s.pos);
    const r = pop > 60000 ? 2.6 : pop > 15000 ? 2 : pop > 3000 ? 1.4 : 0.9;
    if (caps.has(s.id)) cv.dot(x, y, r + 1.4, [140, 20, 20]);
    cv.dot(x, y, r, [30, 25, 20]);
  }
  void settlementName;
}
