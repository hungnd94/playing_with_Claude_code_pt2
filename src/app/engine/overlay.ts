/**
 * Globe overlay layers at a year: per-cell RGBA + border groups for
 * GlobeView.setOverlay, plus realm label anchors. DOM-free and allocation-free
 * per call (buffers are reused), so it can run at every timeline tick.
 */
import type { PhysicalWorld } from "../../world/types";
import type { History, Id, LiveSnapshot, RGB } from "../../history/types";
import { LayerCursor, snapshotIndex } from "../../history/query";
import { entryAt, popAt } from "./query";

export type OverlayLayer = "terrain" | "realms" | "peoples" | "tongues" | "faiths" | "population";

export interface OverlayFrame {
  colors: Uint8Array;
  groups: Uint32Array;
  /** Layer-specific look (opacity, border weight). */
  opacity: number;
  borderWidth: number;
  wash: number;
}

export interface RealmAnchor {
  polity: Id;
  cells: number;
  /** Cell nearest to the territory's centroid that belongs to it. */
  cell: number;
  xyz: [number, number, number];
}

/** Distinct, earthy hues for language families (golden-angle walk over a muted wheel). */
export function familyColor(index: number, shade: number): RGB {
  const hue = (index * 137.508 + 28) % 360;
  const l = 0.5 + 0.12 * Math.sin(shade * 2.3) ;
  const s = 0.42 + 0.1 * Math.cos(shade * 1.7);
  return hslRgb(hue, s, l);
}

export function hslRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbCss(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** Population heat ramp (pale straw → ember → oxblood). t in 0..1. */
const HEAT: RGB[] = [[236, 214, 150], [226, 160, 82], [196, 92, 52], [140, 40, 38], [84, 18, 30]];
function heat(t: number): RGB {
  const x = Math.max(0, Math.min(0.9999, t)) * (HEAT.length - 1);
  const i = Math.floor(x);
  return mix(HEAT[i], HEAT[i + 1], x - i);
}

export class OverlayEngine {
  readonly n: number;
  private colors: Uint8Array;
  private groups: Uint32Array;
  private owner: LayerCursor | null = null;
  private culture: LayerCursor | null = null;
  private religion: LayerCursor | null = null;
  private heatBuf: Float32Array;
  private heatTmp: Float32Array;
  /** Language family index per language id (for the Tongues layer). */
  private famIndex = new Map<Id, number>();
  private famShade = new Map<Id, number>();

  constructor(private world: PhysicalWorld, private history: History | null) {
    this.n = world.mesh.n;
    this.colors = new Uint8Array(this.n * 4);
    this.groups = new Uint32Array(this.n);
    this.heatBuf = new Float32Array(this.n);
    this.heatTmp = new Float32Array(this.n);
    if (history) {
      const t = history.timeline;
      this.owner = new LayerCursor(t.owner, t);
      this.culture = new LayerCursor(t.culture, t);
      this.religion = new LayerCursor(t.religion, t);
      const fams: Id[] = [];
      for (const l of history.languages) if (!fams.includes(l.family)) fams.push(l.family);
      fams.sort((a, b) => a - b);
      const perFam = new Map<Id, number>();
      for (const l of history.languages) {
        this.famIndex.set(l.id, fams.indexOf(l.family));
        const k = perFam.get(l.family) ?? 0;
        perFam.set(l.family, k + 1);
        this.famShade.set(l.id, k);
      }
    }
  }

  /** Owner polity per cell at a year (owned by the engine; copy to keep). */
  ownerAt(year: number): Int32Array | null {
    return this.owner ? this.owner.at(year) : null;
  }
  cultureAt(year: number): Int32Array | null {
    return this.culture ? this.culture.at(year) : null;
  }
  religionAt(year: number): Int32Array | null {
    return this.religion ? this.religion.at(year) : null;
  }

  /** Key that changes exactly when the overlay for (layer, year) changes. */
  key(layer: OverlayLayer, year: number): string {
    const h = this.history;
    if (!h || layer === "terrain") return layer;
    if (layer === "population") return `${layer}:${Math.floor(year / h.sampleStep)}`;
    return `${layer}:${snapshotIndex(h.timeline, year)}`;
  }

  build(layer: OverlayLayer, year: number): OverlayFrame | null {
    const h = this.history;
    if (!h || layer === "terrain") return null;
    const { colors, groups, n } = this;
    colors.fill(0);
    groups.fill(0);
    const land = this.world.isLand;
    const lakes = this.world.lakeId;
    const put = (c: number, rgb: RGB, a: number, g: number): void => {
      colors[4 * c] = rgb[0];
      colors[4 * c + 1] = rgb[1];
      colors[4 * c + 2] = rgb[2];
      colors[4 * c + 3] = a;
      groups[c] = g;
    };
    let opacity = 0.78, borderWidth = 1.3, wash = 1;
    if (layer === "realms") {
      const own = this.owner!.at(year);
      const cache = new Map<Id, RGB>();
      const col = (p: Id): RGB => {
        let c = cache.get(p);
        if (c) return c;
        const P = h.polities[p];
        c = P ? P.color : [128, 128, 128];
        const ov = P ? entryAt(P.overlords, year) : undefined;
        if (ov && ov.overlord >= 0 && ov.year <= year && h.polities[ov.overlord]) {
          // Vassals take a lighter tint of their overlord's colour so blocs read as one.
          c = mix(mix(c, h.polities[ov.overlord].color, 0.6), [245, 238, 220], 0.28);
        }
        cache.set(p, c);
        return c;
      };
      for (let c = 0; c < n; c++) {
        const p = own[c];
        if (p < 0 || !land[c] || lakes[c] >= 0) continue;
        put(c, col(p), 255, p + 1);
      }
      opacity = 0.8;
      borderWidth = 1.4;
    } else if (layer === "peoples") {
      const cul = this.culture!.at(year);
      for (let c = 0; c < n; c++) {
        const k = cul[c];
        if (k < 0 || !land[c] || lakes[c] >= 0) continue;
        put(c, h.cultures[k]?.color ?? [128, 128, 128], 255, k + 1);
      }
      opacity = 0.74;
      borderWidth = 1.0;
    } else if (layer === "tongues") {
      const cul = this.culture!.at(year);
      const langOf = new Map<Id, Id>();
      for (let c = 0; c < n; c++) {
        const k = cul[c];
        if (k < 0 || !land[c] || lakes[c] >= 0) continue;
        let l = langOf.get(k);
        if (l === undefined) {
          const C = h.cultures[k];
          l = C ? (entryAt(C.languages, year)?.lang ?? -1) : -1;
          langOf.set(k, l);
        }
        if (l < 0) continue;
        put(c, familyColor(this.famIndex.get(l) ?? 0, this.famShade.get(l) ?? 0), 255, l + 1);
      }
      opacity = 0.74;
      borderWidth = 1.0;
    } else if (layer === "faiths") {
      const rel = this.religion!.at(year);
      for (let c = 0; c < n; c++) {
        const r = rel[c];
        if (r < 0 || !land[c] || lakes[c] >= 0) continue;
        put(c, h.religions[r]?.color ?? [128, 128, 128], 255, r + 1);
      }
      opacity = 0.74;
      borderWidth = 1.0;
    } else if (layer === "population") {
      const hb = this.heatBuf, tmp = this.heatTmp;
      hb.fill(0);
      let maxPop = 1;
      for (const s of h.settlements) {
        if (year < s.founded || (s.ended >= 0 && year >= s.ended)) continue;
        const p = popAt(s, year, h.sampleStep);
        hb[s.cell] += p;
        if (p > maxPop) maxPop = p;
      }
      // Rural hinterland: owned land carries a little population too.
      const own = this.owner!.at(year);
      for (let c = 0; c < n; c++) if (own[c] >= 0 && land[c]) hb[c] += 400 * this.world.fertility[c];
      // Diffuse over the land graph (3 passes) so towns glow over their hinterland.
      const { adjStart, adj } = this.world.mesh;
      for (let pass = 0; pass < 3; pass++) {
        for (let c = 0; c < n; c++) {
          if (!land[c]) {
            tmp[c] = 0;
            continue;
          }
          let s = 0, k = 0;
          for (let j = adjStart[c]; j < adjStart[c + 1]; j++) {
            const nb = adj[j];
            if (land[nb]) {
              s += hb[nb];
              k++;
            }
          }
          tmp[c] = 0.5 * hb[c] + (k ? (0.5 * s) / k : 0);
        }
        hb.set(tmp);
      }
      // Scale by the distribution of peopled cells (log), so the ramp spans sparse → teeming.
      const vals: number[] = [];
      for (let c = 0; c < n; c++) if (hb[c] > 1 && land[c]) vals.push(hb[c]);
      vals.sort((a, b) => a - b);
      const q = (f: number): number => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))] ?? 1;
      const lo = Math.log(Math.max(1, q(0.15))), hi = Math.log(Math.max(q(0.15) * 4, q(0.995)));
      for (let c = 0; c < n; c++) {
        const v = hb[c];
        if (v <= 1 || !land[c] || lakes[c] >= 0) continue;
        const t = Math.max(0, Math.min(1, (Math.log(v) - lo) / (hi - lo)));
        if (t <= 0.02) continue;
        put(c, heat(t), Math.round(Math.min(1, 0.18 + 0.95 * Math.sqrt(t)) * 255), 0);
      }
      void maxPop;
      opacity = 0.85;
      borderWidth = 0;
      wash = 0.4;
    }
    return { colors, groups, opacity, borderWidth, wash };
  }

  /** Overlay from a live preview snapshot (owner + polity colours only). */
  buildLive(snap: LiveSnapshot): OverlayFrame {
    const { colors, groups, n } = this;
    colors.fill(0);
    groups.fill(0);
    const land = this.world.isLand, lakes = this.world.lakeId;
    for (let c = 0; c < n; c++) {
      const p = snap.owner[c];
      if (p < 0 || !land[c] || lakes[c] >= 0) continue;
      const col = snap.polities[p]?.color ?? [150, 140, 120];
      colors[4 * c] = col[0];
      colors[4 * c + 1] = col[1];
      colors[4 * c + 2] = col[2];
      colors[4 * c + 3] = 255;
      groups[c] = p + 1;
    }
    return { colors, groups, opacity: 0.8, borderWidth: 1.3, wash: 1 };
  }

  /** Territory anchors of every polity present in an owner array, largest first. */
  realmAnchors(owner: Int32Array): RealmAnchor[] {
    const p = this.world.mesh.xyz;
    const acc = new Map<Id, { x: number; y: number; z: number; n: number }>();
    for (let c = 0; c < owner.length; c++) {
      const o = owner[c];
      if (o < 0) continue;
      let a = acc.get(o);
      if (!a) acc.set(o, (a = { x: 0, y: 0, z: 0, n: 0 }));
      a.x += p[3 * c];
      a.y += p[3 * c + 1];
      a.z += p[3 * c + 2];
      a.n++;
    }
    const best = new Map<Id, { cell: number; d: number }>();
    const unit = new Map<Id, [number, number, number]>();
    for (const [o, a] of acc) {
      const l = Math.hypot(a.x, a.y, a.z) || 1;
      unit.set(o, [a.x / l, a.y / l, a.z / l]);
    }
    for (let c = 0; c < owner.length; c++) {
      const o = owner[c];
      if (o < 0) continue;
      const u = unit.get(o)!;
      const d = p[3 * c] * u[0] + p[3 * c + 1] * u[1] + p[3 * c + 2] * u[2];
      const b = best.get(o);
      if (!b || d > b.d) best.set(o, { cell: c, d });
    }
    const out: RealmAnchor[] = [];
    for (const [o, a] of acc) {
      const cell = best.get(o)!.cell;
      // Label at the centroid when it lies inside (convex-ish realms), else at the nearest owned cell.
      const u = unit.get(o)!;
      const inside = best.get(o)!.d > Math.cos(1.5 * this.world.mesh.meanSpacing);
      out.push({ polity: o, cells: a.n, cell, xyz: inside ? u : [p[3 * cell], p[3 * cell + 1], p[3 * cell + 2]] });
    }
    out.sort((a, b) => b.cells - a.cells || a.polity - b.polity);
    return out;
  }
}
