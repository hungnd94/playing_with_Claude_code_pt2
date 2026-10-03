/**
 * Imperative bridge between the store and the WebGL globe: pushes textures,
 * overlays, markers, labels, highlights and camera flights to GlobeView only
 * when their inputs change (the year ticks at 60 Hz while playing; the overlay
 * is rebuilt only when the timeline snapshot changes).
 */
import { GlobeView, type GlobeLabel, type GlobeMarker, type GlobeLine } from "../../../render/index";
import type { History, Id } from "../../../history/types";
import type { PhysicalWorld } from "../../../world/types";
import type { Ref } from "../../../narrative/types";
import { app, currentLoc, type AppState } from "../../state/app";
import { OverlayEngine } from "../../engine/overlay";
import { locate, type Target } from "../../engine/locate";
import { cellXYZ, cellsAround, type XYZ } from "../../engine/geo";
import { capitalAt, entryAt, nameAt, popAt } from "../../engine/query";

const LABEL_FONT = '"IM Fell English", "Alegreya", "Iowan Old Style", Georgia, serif';

export interface HoverInfo {
  cell: number;
  x: number;
  y: number;
}

export class StageController {
  readonly globe: GlobeView;
  private engine: OverlayEngine | null = null;
  private engineFor: { world: PhysicalWorld | null; history: History | null } = { world: null, history: null };
  private overlayKey = "";
  private markerKey = "";
  private focusKey = "";
  private hoverRef: Ref | null = null;
  private pingTimer = 0;
  private baseMarkers: GlobeMarker[] = [];
  private unsub: () => void;
  private revealed = false;
  private focusTarget: Target | null = null;
  onReveal: (() => void) | null = null;
  onHoverCell: ((cell: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.globe = new GlobeView(canvas, {
      autoRotate: 2.2,
      view: { lat: 18, lon: 10, zoom: 1 },
      fontFamily: LABEL_FONT,
      labelTheme: "light",
      clouds: 0.5,
    });
    this.globe.onPick((cell) => {
      if (cell < 0) return;
      const s = app.get();
      if (!s.world) return;
      app.set({ pickedCell: cell });
      import("../../state/app").then(({ navigate }) => navigate({ tab: "article", sub: cell }));
    });
    this.globe.onHover((cell) => {
      this.hoverCell(cell);
      this.onHoverCell?.(cell);
    });
    this.unsub = app.subscribe((s, prev) => this.update(s, prev));
    this.update(app.get(), null);
    // Labels are drawn on a 2D canvas: redraw once the web fonts arrive.
    try {
      document.fonts?.ready.then(() => {
        this.markerKey = "";
        this.update(app.get(), app.get());
      });
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    this.unsub();
    clearInterval(this.pingTimer);
    this.globe.dispose();
  }

  get overlayEngine(): OverlayEngine | null {
    return this.engine;
  }

  private ensureEngine(s: AppState): OverlayEngine | null {
    if (!s.world) return (this.engine = null);
    if (this.engineFor.world !== s.world || this.engineFor.history !== s.history) {
      this.engine = new OverlayEngine(s.world, s.history);
      this.engineFor = { world: s.world, history: s.history };
      this.overlayKey = "";
      this.markerKey = "";
      this.focusKey = "";
    }
    return this.engine;
  }

  private update(s: AppState, prev: AppState | null): void {
    const g = this.globe;
    if (!prev || s.world !== prev.world) {
      if (s.world) g.setWorld(s.world);
      else {
        g.clearOverlay();
        g.setMarkers([]);
        g.setLabels([]);
        g.setLines(null);
        this.revealed = false;
      }
    }
    if (!prev || s.baked !== prev.baked) {
      if (s.baked) {
        g.setBaked(s.baked);
        if (!this.revealed) {
          this.revealed = true;
          this.onReveal?.();
        }
      }
    }
    const engine = this.ensureEngine(s);
    if (!engine) return;
    this.updateOverlay(s, engine);
    this.updateMarkers(s, engine);
    this.updateFocus(s, engine);
  }

  private updateOverlay(s: AppState, engine: OverlayEngine): void {
    const g = this.globe;
    if (!s.history) {
      if (s.live) {
        const key = `live:${s.live.year}`;
        if (key !== this.overlayKey) {
          this.overlayKey = key;
          const f = engine.buildLive(s.live);
          g.setOverlay({ colors: f.colors, groups: f.groups, opacity: f.opacity, borderWidth: f.borderWidth, wash: f.wash });
        }
      } else if (this.overlayKey !== "none") {
        this.overlayKey = "none";
        g.clearOverlay();
      }
      return;
    }
    const key = `${engine.key(s.layer, s.year)}|${s.dark ? 1 : 0}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const f = engine.build(s.layer, s.year);
    if (!f) g.clearOverlay();
    else
      g.setOverlay({
        colors: f.colors,
        groups: f.groups,
        opacity: f.opacity,
        borderWidth: f.borderWidth,
        wash: f.wash,
        borderColor: [42, 26, 14, 0.85],
      });
    this.refreshHighlight(s);
  }

  // ------------------------------------------------------------- markers & labels

  private updateMarkers(s: AppState, engine: OverlayEngine): void {
    const h = s.history;
    if (!h || !s.world) {
      if (this.markerKey !== "none") {
        this.markerKey = "none";
        this.baseMarkers = [];
        this.globe.setMarkers([]);
        this.globe.setLabels(s.live ? this.liveLabels(s, engine) : []);
      } else if (s.live) this.globe.setLabels(this.liveLabels(s, engine));
      return;
    }
    const bucket = Math.floor(s.year / (s.playing ? 20 : 5));
    const key = `${bucket}|${s.layer}|${s.show.settlements}|${s.show.labels}|${s.show.routes}|${s.show.battles}|${s.pickedCell}`;
    if (key === this.markerKey) return;
    this.markerKey = key;
    const world = s.world;
    const y = s.year;
    const markers: GlobeMarker[] = [];
    const labels: GlobeLabel[] = [];
    const lines: GlobeLine[] = [];
    // Capitals of every polity alive now.
    const capitals = new Map<Id, Id>();
    for (const p of h.polities) {
      if (y < p.founded || (p.ended >= 0 && y >= p.ended)) continue;
      const c = capitalAt(p, y);
      if (c >= 0) {
        const ov = entryAt(p.overlords, y);
        capitals.set(c, ov && ov.overlord >= 0 && ov.year <= y ? 1 : 2);
      }
    }
    const alive: { id: Id; pop: number }[] = [];
    for (const st of h.settlements) {
      if (y < st.founded || (st.ended >= 0 && y >= st.ended)) continue;
      alive.push({ id: st.id, pop: popAt(st, y, h.sampleStep) });
    }
    alive.sort((a, b) => b.pop - a.pop || a.id - b.id);
    if (s.show.settlements) {
      const lim = Math.min(alive.length, 700);
      for (let i = 0; i < lim; i++) {
        const { id, pop } = alive[i];
        const st = h.settlements[id];
        const cap = capitals.get(id) ?? 0;
        const size = Math.max(2.6, Math.min(9, 2.2 + 1.9 * Math.log10(Math.max(100, pop) / 300)));
        if (cap === 2) markers.push({ xyz: st.pos, size: size + 3.5, color: [232, 199, 122, 1], shape: "star" });
        else if (cap === 1) markers.push({ xyz: st.pos, size: size + 2, color: [232, 214, 170, 1], shape: "diamond" });
        else markers.push({ xyz: st.pos, size, color: pop < 2500 ? [243, 234, 214, 0.65] : [246, 238, 220, 0.95], shape: "circle" });
      }
    }
    if (s.show.labels) {
      // Realm names, largest first.
      if (s.layer === "realms" || s.layer === "terrain") {
        const own = engine.ownerAt(y);
        if (own && s.layer === "realms") {
          const anchors = engine.realmAnchors(own).slice(0, 40);
          for (const a of anchors) {
            if (a.cells < 12) continue;
            const P = h.polities[a.polity];
            if (!P) continue;
            const name = nameAt(P.names, Math.max(y, P.founded)).roman;
            const size = Math.max(0.7, Math.min(1.9, 0.55 + Math.log10(a.cells) * 0.42));
            labels.push({ xyz: a.xyz, text: name, style: "region", priority: 1000 + a.cells, size, minZoom: a.cells > 400 ? 0 : a.cells > 120 ? 1.15 : 1.7 });
          }
        }
      }
      if (s.layer === "peoples" || s.layer === "tongues" || s.layer === "faiths") {
        labels.push(...this.areaLabels(s, engine));
      }
      // Towns: capitals first, then by size.
      let count = 0;
      for (const { id, pop } of alive) {
        if (count >= 120) break;
        const st = h.settlements[id];
        const cap = capitals.get(id) ?? 0;
        if (!cap && pop < 4000) continue;
        const name = nameAt(st.names, Math.max(y, st.founded)).roman;
        labels.push({
          xyz: st.pos,
          text: name,
          style: cap ? "capital" : "city",
          priority: (cap === 2 ? 600 : cap ? 300 : 0) + Math.log10(Math.max(10, pop)) * 40,
          minZoom: cap === 2 ? (pop > 20000 ? 1.1 : 1.6) : cap ? 2.2 : pop > 30000 ? 2 : 3,
        });
        count++;
      }
      // Seas and mountain ranges, in the tongue of whoever named them first.
      labels.push(...this.featureLabels(s));
    }
    if (s.show.routes) {
      for (const r of h.tradeRoutes) {
        if (y < r.founded || (r.ended >= 0 && y >= r.ended) || r.path.length < 2) continue;
        lines.push({
          points: r.path.map((c) => cellXYZ(world, c)),
          color: r.kind === "sea" ? [150, 196, 226, 0.9] : [236, 206, 140, 0.95],
          width: 1.6,
          style: r.kind === "sea" ? "dashed" : "dotted",
          smooth: true,
          casing: 0.8,
          flow: 14,
        });
      }
    }
    if (s.show.battles) {
      for (const b of h.battles) {
        if (b.year > y || b.year < y - 40) continue;
        const fade = 1 - (y - b.year) / 45;
        markers.push({ xyz: cellXYZ(world, b.cell), size: 7 + 4 * fade, color: [214, 84, 52, 0.35 + 0.6 * fade], shape: "triangle" });
      }
    }
    if (s.pickedCell >= 0) markers.push({ xyz: cellXYZ(world, s.pickedCell), size: 15, color: [240, 214, 150, 1], shape: "ring" });
    this.baseMarkers = markers;
    this.routeLines = lines;
    this.globe.setMarkers(markers);
    this.globe.setLabels(labels);
    this.applyLines();
  }

  private routeLines: GlobeLine[] = [];

  private applyLines(): void {
    const t = this.hoverTarget ?? this.focusTarget;
    const list = t?.line ? [...this.routeLines, { points: t.line, color: [240, 214, 150, 1], width: 2.6, casing: 1.2, smooth: true } as GlobeLine] : this.routeLines;
    this.globe.setLines(list.length ? list : null);
  }

  private liveLabels(s: AppState, engine: OverlayEngine): GlobeLabel[] {
    if (!s.live) return [];
    const anchors = engine.realmAnchors(s.live.owner).slice(0, 24);
    const out: GlobeLabel[] = [];
    for (const a of anchors) {
      if (a.cells < 15) continue;
      const name = s.live.polities[a.polity]?.name;
      if (!name) continue;
      out.push({ xyz: a.xyz, text: name, style: "region", priority: a.cells, size: Math.max(0.7, Math.min(1.8, 0.55 + Math.log10(a.cells) * 0.42)) });
    }
    return out;
  }

  private areaLabels(s: AppState, engine: OverlayEngine): GlobeLabel[] {
    const h = s.history!;
    const y = s.year;
    const arr = s.layer === "faiths" ? engine.religionAt(y) : engine.cultureAt(y);
    if (!arr) return [];
    const anchors = engine.realmAnchors(arr).slice(0, 30);
    const out: GlobeLabel[] = [];
    const seenLang = new Set<Id>();
    for (const a of anchors) {
      if (a.cells < 20) continue;
      let text = "";
      if (s.layer === "faiths") text = h.religions[a.polity]?.name.roman ?? "";
      else if (s.layer === "peoples") text = h.cultures[a.polity]?.name.roman ?? "";
      else {
        const C = h.cultures[a.polity];
        const l = C ? (entryAt(C.languages, y)?.lang ?? -1) : -1;
        if (l < 0 || seenLang.has(l)) continue;
        seenLang.add(l);
        text = h.languages[l]?.name ?? "";
      }
      if (!text) continue;
      out.push({ xyz: a.xyz, text, style: "region", priority: 1000 + a.cells, size: Math.max(0.7, Math.min(1.7, 0.5 + Math.log10(a.cells) * 0.4)) });
    }
    return out;
  }

  private featureLabels(s: AppState): GlobeLabel[] {
    const h = s.history!, world = s.world!;
    const out: GlobeLabel[] = [];
    for (const fn of h.featureNames) {
      const f = world.features[fn.feature];
      if (!f) continue;
      const style = f.kind === "ocean" || f.kind === "sea" || f.kind === "bay" || f.kind === "lake" ? "sea" : f.kind === "mountains" || f.kind === "desert" || f.kind === "forest" || f.kind === "jungle" ? "feature" : null;
      if (!style) continue;
      let name: string | null = null;
      for (const n of fn.names) if (n.year <= s.year) {
        name = n.name.roman;
        break;
      }
      if (!name) continue;
      const big = f.kind === "ocean" ? 0 : f.kind === "sea" ? 1.3 : f.kind === "mountains" ? 1.9 : 2.4;
      out.push({ xyz: cellXYZ(world, f.anchor), text: name, style, priority: Math.log10(Math.max(10, f.size)) * 20, minZoom: big, size: f.kind === "ocean" ? 1.2 : 1 });
    }
    return out;
  }

  // ------------------------------------------------------------- focus, hover, ping

  private updateFocus(s: AppState, engine: OverlayEngine): void {
    const loc = currentLoc(s);
    const ref: Ref | null = loc.ref ?? null;
    const bucket = Math.floor(s.year / 25);
    const key = ref ? `${ref.kind}:${ref.id}` : loc.tab === "article" && loc.sub !== undefined ? `cell:${loc.sub}` : "";
    const fullKey = `${key}|${bucket}|${s.layer}|${s.history ? 1 : 0}`;
    if (fullKey === this.focusKey) return;
    const moved = !this.focusKey.startsWith(key + "|") || !this.focusKey;
    this.focusKey = fullKey;
    if (!s.world) return;
    if (!ref) {
      this.focusTarget = null;
      this.refreshHighlight(s);
      if (loc.tab === "article" && loc.sub !== undefined && moved && !s.genesis) {
        // Place page: the picked cell.
        this.globe.setHighlightCells(cellsAround(s.world, loc.sub, 0), { strength: 0.8 });
      }
      return;
    }
    const t = locate(s.world, s.history, engine, ref, s.year);
    this.focusTarget = t;
    this.refreshHighlight(s);
    if (t && moved && !s.genesis && ref.kind !== "world" && ref.kind !== "age" && ref.kind !== "language" && ref.kind !== "script") {
      const v = this.globe.getView();
      const zoom = Math.max(v.zoom > 1.2 ? Math.min(v.zoom, t.zoom) : 1, Math.min(t.zoom, 4.5));
      this.globe.setAutoRotate(0);
      void this.globe.flyTo(t.lat, t.lon, zoom, 1100);
    }
  }

  /** Apply focus (or hover) highlight according to the current layer. */
  private refreshHighlight(s: AppState): void {
    const t = this.hoverTarget ?? this.focusTarget;
    const g = this.globe;
    this.applyLines();
    if (!t) {
      g.setHighlight(null);
      g.setHighlightCells(null);
      return;
    }
    if (t.group && t.group.layer === s.layer) {
      g.setHighlight(t.group.id);
      g.setHighlightCells(null);
    } else {
      g.setHighlight(null);
      if (t.cells && t.cells.length) g.setHighlightCells(t.cells, { strength: this.hoverTarget ? 0.7 : 0.55 });
      else g.setHighlightCells(null);
    }
  }

  private hoverTarget: Target | null = null;

  /** Pointer over the globe: lift the realm/people/faith under it. */
  hoverCell(cell: number): void {
    const s = app.get();
    if (this.hoverTarget) return;
    const e = this.engine;
    if (cell < 0 || !e || !s.history || !s.world || !s.world.isLand[cell]) {
      this.refreshHighlight(s);
      return;
    }
    let group = 0;
    const y = s.year;
    if (s.layer === "realms") group = (e.ownerAt(y)?.[cell] ?? -1) + 1;
    else if (s.layer === "peoples") group = (e.cultureAt(y)?.[cell] ?? -1) + 1;
    else if (s.layer === "faiths") group = (e.religionAt(y)?.[cell] ?? -1) + 1;
    else if (s.layer === "tongues") {
      const C = s.history.cultures[e.cultureAt(y)?.[cell] ?? -1];
      group = C ? (entryAt(C.languages, y)?.lang ?? -1) + 1 : 0;
    }
    if (group > 0) this.globe.setHighlight(group);
    else this.refreshHighlight(s);
  }

  /** Hovering a link in the pane: ping the place on the globe. */
  ping(ref: Ref | null): void {
    const s = app.get();
    if (sameRef(ref, this.hoverRef)) return;
    this.hoverRef = ref;
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
    if (!ref || !s.world) {
      this.hoverTarget = null;
      this.globe.setMarkers(this.baseMarkers);
      this.refreshHighlight(s);
      return;
    }
    const t = this.engine ? locate(s.world, s.history, this.engine, ref, s.year) : null;
    this.hoverTarget = t && (t.cells?.length || t.line || t.group) ? t : null;
    this.refreshHighlight(s);
    const point: XYZ | undefined = t?.point;
    if (point) {
      const t0 = performance.now();
      const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const tick = (): void => {
        const k = ((performance.now() - t0) % 1100) / 1100;
        const size = reduce ? 18 : 10 + 22 * k;
        const alpha = reduce ? 1 : 1 - k;
        this.globe.setMarkers([...this.baseMarkers, { xyz: point, size: 9, color: [240, 214, 150, 1], shape: "circle" }, { xyz: point, size, color: [240, 214, 150, alpha], shape: "ring" }]);
      };
      tick();
      if (!reduce) this.pingTimer = window.setInterval(tick, 33);
    }
  }
}

function sameRef(a: Ref | null, b: Ref | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}
