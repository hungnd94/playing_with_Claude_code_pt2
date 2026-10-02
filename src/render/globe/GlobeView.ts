/**
 * GlobeView — a WebGL2 orthographic globe (and flat map) for Palimpsest.
 *
 * See src/render/README.md for the full API. In short:
 *
 *   const globe = new GlobeView(canvas, { autoRotate: true });
 *   globe.setBaked(bakeGlobe(world));           // terrain + cell ids + warp
 *   globe.setWorld(world);                      // mesh & land/water flags (overlays, picking)
 *   globe.setOverlay({ colors, groups });       // per-cell fills + borders; cheap to update
 *   globe.setMarkers([...]); globe.setLabels([...]);
 *   globe.onPick((cell, lat, lon) => ...);
 *
 * Rendering happens only when something changed (or while animating).
 */
import { CellLocator, type SphereMesh } from "../../core/sphere";
import type { PhysicalWorld } from "../../world/types";
import { decodeCellId } from "../bake/cellids";
import { dirToUV, sampleWarp, unwarp, type WarpLattice } from "../bake/context";
import type { BakedGlobe } from "../bake/index";
import type { RiverGeometry } from "../bake/rivers";
import {
  angularDistance, clampView, GLOBE_FIT, makeFrame, project, slerpLatLon, toLatLonDeg, unproject, wrapDeg,
  type Frame, type ProjectionMode, type V3, type ViewState,
} from "./camera";
import { compileProgram, createTexture, halveRGBA, parseColor, Uniforms } from "./gl";
import { LabelLayer, type Box, type GlobeLabel, type LabelTheme } from "./labels";
import { buildLineGeometry, LINE_STRIDE, type GlobeLine } from "./lines";
import { FULLSCREEN_VS, GLOBE_FS, LINE_FS, LINE_VS, MARKER_FS, MARKER_VS, RIVER_FS, RIVER_VS } from "./shaders";

export type { GlobeLabel, LabelStyleName, LabelTheme } from "./labels";
export type { GlobeLine, LineStyle } from "./lines";
export type { ViewState, ProjectionMode } from "./camera";

export type { ColorLike } from "./lines";
import type { ColorLike } from "./lines";

export interface GlobeOptions {
  /** Initial view (degrees; zoom 1 = whole globe). */
  view?: Partial<ViewState>;
  mode?: ProjectionMode;
  /** Auto-rotation speed in degrees/second (true = 3). Stops on the first interaction. */
  autoRotate?: boolean | number;
  minZoom?: number;
  maxZoom?: number;
  /** Cap on devicePixelRatio (default 2). */
  maxPixelRatio?: number;
  /** "stars" (default) or "transparent". */
  background?: "stars" | "transparent";
  /** Day/night lighting 0..1 (default 1). */
  lighting?: number;
  /** Night-side ambient light (default 0.17). */
  night?: number;
  /** Atmosphere strength (default 1). */
  atmosphere?: number;
  /**
   * Procedural cloud cover opacity (default 0.6). Clouds fade out as you zoom
   * in (gone by zoom ≈ 2.5) and almost vanish while an overlay is shown.
   */
  clouds?: number;
  exposure?: number;
  /**
   * Sun direction. In "camera" mode (default) it is given in view space
   * (x right, y up, z towards the viewer) and the lighting follows the camera;
   * in "world" mode it is a fixed world-space vector (real day/night).
   */
  sun?: { mode: "camera" | "world"; dir: V3 };
  /** Canvas for labels; created as an absolutely positioned sibling if omitted. */
  labelCanvas?: HTMLCanvasElement;
  fontFamily?: string;
  labelTheme?: LabelTheme;
  /** Enable mouse/touch interaction (default true). */
  interactive?: boolean;
  /**
   * Honour the user's `prefers-reduced-motion` setting (default true): no
   * auto-rotation, near-instant flyTo, no animated line flow.
   */
  respectReducedMotion?: boolean;
}

export interface HighlightCellsOptions {
  /** Highlight colour (default warm gold). */
  color?: ColorLike;
  /** Strength 0..1 (default 1). */
  strength?: number;
}

export interface OverlayOptions {
  /** RGBA per cell (4·n bytes). Alpha 0 = no fill. */
  colors: Uint8Array;
  /** Group id per cell; borders are drawn where neighbouring cells of the same land/water class differ. Default: no borders. */
  groups?: Uint32Array;
  /** Fill opacity multiplier (default 0.75). */
  opacity?: number;
  /** Border ink colour (default dark sepia). */
  borderColor?: ColorLike;
  /** Border width in CSS px (default 1.4). */
  borderWidth?: number;
  /** Coastline ink colour; alpha 0 disables (default faint ink). */
  coastColor?: ColorLike;
  /** Desaturate the terrain under fills, 0..1 (default 0.25). */
  terrainFade?: number;
  /** Watercolour effect: edge darkening, grain, inner border band, 0..1 (default 1). */
  wash?: number;
}

export type MarkerShape = "circle" | "square" | "diamond" | "star" | "triangle" | "ring";

export interface GlobeMarker {
  xyz: readonly [number, number, number] | ArrayLike<number>;
  /** Diameter in CSS px (default 7). */
  size?: number;
  /** CSS hex or [r,g,b,a(0..1)] (default parchment white). */
  color?: ColorLike;
  shape?: MarkerShape;
}

export type PickHandler = (cell: number, lat: number, lon: number) => void;

const SHAPES: Record<MarkerShape, number> = { circle: 0, square: 1, diamond: 2, star: 3, triangle: 4, ring: 5 };
const DATA_W = 2048;

interface FlyAnim {
  t0: number;
  dur: number;
  from: ViewState;
  to: ViewState;
  bump: number;
}

export class GlobeView {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Uniforms;
  private mprog: WebGLProgram;
  private mu: Uniforms;
  private vao: WebGLVertexArrayObject;
  private mvao: WebGLVertexArrayObject;
  private mbuf: WebGLBuffer;
  private markerCount = 0;
  private rprog: WebGLProgram;
  private ru: Uniforms;
  private rvao: WebGLVertexArrayObject;
  private rbuf: WebGLBuffer;
  private ribuf: WebGLBuffer;
  private riverIndexCount = 0;
  private riverColor: [number, number, number] = [42 / 255, 92 / 255, 134 / 255];
  private riverWidth = 1;
  private markerList: GlobeMarker[] = [];
  private lprog: WebGLProgram;
  private lu: Uniforms;
  private lvao: WebGLVertexArrayObject;
  private lbuf: WebGLBuffer;
  private libuf: WebGLBuffer;
  private lineIndexCount = 0;
  private lineAnimated = false;
  private lineList: GlobeLine[] = [];
  private hlCellsOn = false;
  private hlColor: [number, number, number, number] = [1, 0.8, 0.45, 1];
  private hlBuf: Uint8Array | null = null;
  private reducedMotion = false;
  private t0 = typeof performance !== "undefined" ? performance.now() : 0;
  /** Drawn marker positions (after inverse warp) + size, for label collision. */
  private markerScreen: [number, number, number, number][] = [];

  private tex: Record<string, WebGLTexture | null> = {
    terrain: null, ids: null, warp: null, sites: null, adjStart: null, adj: null, ovColor: null, ovGroup: null, hlCells: null,
  };
  private terrainSize: [number, number] = [1, 1];
  private idSize: [number, number] = [1, 1];
  private idData: Uint8Array | null = null;
  private warpLattice: WarpLattice | null = null;
  private mesh: SphereMesh | null = null;
  private wet: Uint8Array | null = null;
  private locator: CellLocator | null = null;
  private dataRows = 1;
  private ovColorBuf: Uint8Array | null = null;
  private ovGroupBuf: Uint32Array | null = null;
  private bfsQueue: Int32Array | null = null;
  private highlight: number | null = null;
  private overlay: {
    on: boolean; opacity: number; border: [number, number, number, number]; borderWidth: number;
    coast: [number, number, number, number]; terrainFade: number; wash: number;
  } = { on: false, opacity: 0.85, border: [0, 0, 0, 0], borderWidth: 1.4, coast: [0, 0, 0, 0], terrainFade: 0.35, wash: 1 };

  private labelCanvas: HTMLCanvasElement;
  private ownsLabelCanvas: boolean;
  private labels: LabelLayer;

  private opts: Required<Omit<GlobeOptions, "labelCanvas" | "view" | "sun" | "fontFamily" | "labelTheme" | "respectReducedMotion">> & { sun: { mode: "camera" | "world"; dir: V3 } };
  private state: ViewState;
  private mode: ProjectionMode;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private lastT = 0;
  private autoRotate = 0;
  private velocity = { lon: 0, lat: 0 }; // deg/ms
  private fly: FlyAnim | null = null;
  private zoomAnim: { t0: number; dur: number; from: number; to: number; anchor: [number, number] | null } | null = null;
  private pickHandlers: PickHandler[] = [];
  private hoverHandlers: PickHandler[] = [];
  private hoverCell = -2;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private cleanup: (() => void)[] = [];
  private maxTex: number;
  /** Cyclone centres + twists for the cloud field (see shaders.ts). */
  private cyclones = makeCyclones(1);

  constructor(canvas: HTMLCanvasElement, options: GlobeOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: options.background === "transparent", premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error("GlobeView: WebGL2 is not available");
    this.gl = gl;
    this.maxTex = 4096;
    const ar = options.autoRotate === true ? 3 : typeof options.autoRotate === "number" ? options.autoRotate : 0;
    this.opts = {
      mode: options.mode ?? "globe",
      autoRotate: ar,
      minZoom: options.minZoom ?? 0.75,
      maxZoom: options.maxZoom ?? 14,
      maxPixelRatio: options.maxPixelRatio ?? 2,
      background: options.background ?? "stars",
      lighting: options.lighting ?? 1,
      night: options.night ?? 0.17,
      atmosphere: options.atmosphere ?? 1,
      clouds: options.clouds ?? 0.6,
      exposure: options.exposure ?? 1.0,
      interactive: options.interactive ?? true,
      sun: options.sun ?? { mode: "camera", dir: [-0.55, 0.42, 0.72] },
    };
    // Reduced motion: no auto-rotation or flowing lines, near-instant flights.
    if (options.respectReducedMotion !== false && typeof matchMedia === "function") {
      const mq = matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = mq.matches;
      const onMq = (): void => {
        this.reducedMotion = mq.matches;
        if (this.reducedMotion) this.autoRotate = 0;
        this.requestRender();
      };
      mq.addEventListener?.("change", onMq);
      this.cleanup.push(() => mq.removeEventListener?.("change", onMq));
    }
    this.autoRotate = this.reducedMotion ? 0 : ar;
    this.mode = this.opts.mode;
    this.state = { lat: options.view?.lat ?? 18, lon: options.view?.lon ?? 0, zoom: options.view?.zoom ?? 1 };

    // GL objects (re-created after a context loss).
    this.prog = this.mprog = this.rprog = this.lprog = null as unknown as WebGLProgram;
    this.u = this.mu = this.ru = this.lu = null as unknown as Uniforms;
    this.vao = this.mvao = this.rvao = this.lvao = null as unknown as WebGLVertexArrayObject;
    this.mbuf = this.rbuf = this.ribuf = this.lbuf = this.libuf = null as unknown as WebGLBuffer;
    this.initGL();

    // Label canvas.
    if (options.labelCanvas) {
      this.labelCanvas = options.labelCanvas;
      this.ownsLabelCanvas = false;
    } else {
      const lc = document.createElement("canvas");
      lc.style.position = "absolute";
      lc.style.pointerEvents = "none";
      lc.className = "globe-labels";
      canvas.insertAdjacentElement("afterend", lc);
      this.labelCanvas = lc;
      this.ownsLabelCanvas = true;
    }
    const lctx = this.labelCanvas.getContext("2d");
    if (!lctx) throw new Error("GlobeView: 2D canvas not available");
    this.labels = new LabelLayer(lctx);
    if (options.fontFamily) this.labels.fontFamily = options.fontFamily;
    if (options.labelTheme) this.labels.setTheme(options.labelTheme);

    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    const onWin = (): void => this.resize();
    window.addEventListener("resize", onWin);
    this.cleanup.push(() => window.removeEventListener("resize", onWin));
    // Survive a lost WebGL context (common on mobile when backgrounded).
    const onLost = (e: Event): void => {
      e.preventDefault();
      this.contextLost = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    };
    const onRestored = (): void => {
      this.contextLost = false;
      this.restoreGL();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    this.cleanup.push(() => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    });
    if (this.opts.interactive) this.attachControls();
    this.requestRender();
  }

  private contextLost = false;
  /** Last inputs, kept so everything can be re-uploaded after a context loss. */
  private inputs: {
    terrain?: [Uint8Array, number, number];
    ids?: [Uint8Array, number, number];
    warp?: [Uint8Array, number, number, number];
    mesh?: [SphereMesh, Uint8Array | undefined];
    overlay?: OverlayOptions | null;
    rivers?: RiverGeometry | null;
    hlCells?: [ArrayLike<number> | null, HighlightCellsOptions | undefined];
  } = {};

  private initGL(): void {
    const gl = this.gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.prog = compileProgram(gl, FULLSCREEN_VS, GLOBE_FS);
    this.u = new Uniforms(gl, this.prog);
    this.mprog = compileProgram(gl, MARKER_VS, MARKER_FS);
    this.mu = new Uniforms(gl, this.mprog);
    this.vao = gl.createVertexArray()!;
    this.mvao = gl.createVertexArray()!;
    this.mbuf = gl.createBuffer()!;
    this.setupMarkerVAO();
    this.rprog = compileProgram(gl, RIVER_VS, RIVER_FS);
    this.ru = new Uniforms(gl, this.rprog);
    this.rvao = gl.createVertexArray()!;
    this.rbuf = gl.createBuffer()!;
    this.ribuf = gl.createBuffer()!;
    this.setupRiverVAO();
    this.lprog = compileProgram(gl, LINE_VS, LINE_FS);
    this.lu = new Uniforms(gl, this.lprog);
    this.lvao = gl.createVertexArray()!;
    this.lbuf = gl.createBuffer()!;
    this.libuf = gl.createBuffer()!;
    this.setupLineVAO();
  }

  private restoreGL(): void {
    for (const k of Object.keys(this.tex)) this.tex[k] = null;
    this.initGL();
    const i = this.inputs;
    if (i.terrain) this.setTerrain(...i.terrain);
    if (i.ids) this.setCellIds(...i.ids);
    if (i.warp) this.setWarp(...i.warp);
    if (i.mesh) this.setMesh(...i.mesh);
    if (i.overlay) this.setOverlay(i.overlay);
    if (i.rivers) this.setRivers(i.rivers);
    if (i.hlCells) this.setHighlightCells(...i.hlCells);
    this.setMarkers(this.markerList);
    this.setLines(this.lineList);
    this.requestRender();
  }

  // ===================================================================== data

  /** Terrain RGBA (from bakeTerrain): RGB colour, A = coast field. */
  setTerrain(rgba: Uint8Array, width: number, height: number): void {
    this.inputs.terrain = [rgba, width, height];
    const gl = this.gl;
    let data = rgba, w = width, h = height;
    while (w > this.maxTex || h > this.maxTex) {
      data = halveRGBA(data, w, h, false);
      w >>= 1;
      h >>= 1;
    }
    this.tex.terrain = createTexture(gl, w, h, data, {
      internalFormat: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR_MIPMAP_LINEAR, magFilter: gl.LINEAR, wrapS: gl.REPEAT, wrapT: gl.CLAMP_TO_EDGE,
      mipmap: true, anisotropy: 8,
    }, this.tex.terrain);
    this.terrainSize = [w, h];
    this.requestRender();
  }

  /** Cell-id RGBA (from bakeCellIds). Kept on the CPU too, for exact picking. */
  setCellIds(rgba: Uint8Array, width: number, height: number): void {
    this.inputs.ids = [rgba, width, height];
    const gl = this.gl;
    let data = rgba, w = width, h = height;
    while (w > this.maxTex || h > this.maxTex) {
      data = halveRGBA(data, w, h, true);
      w >>= 1;
      h >>= 1;
    }
    this.tex.ids = createTexture(gl, w, h, data, {
      internalFormat: gl.RGBA8UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_BYTE,
      minFilter: gl.NEAREST, magFilter: gl.NEAREST,
    }, this.tex.ids);
    this.idSize = [w, h];
    this.idData = data;
    this.requestRender();
  }

  /** Warp lattice (from bakeWarp): lets the shader place cell borders analytically. */
  setWarp(rgba: Uint8Array, width: number, height: number, amp: number): void {
    this.inputs.warp = [rgba, width, height, amp];
    const gl = this.gl;
    this.tex.warp = createTexture(gl, width, height, rgba, {
      internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR, magFilter: gl.LINEAR, wrapS: gl.REPEAT, wrapT: gl.CLAMP_TO_EDGE,
    }, this.tex.warp);
    const vec = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) vec[3 * i + c] = ((rgba[4 * i + c] - 127.5) / 127.5) * amp;
    }
    this.warpLattice = { width, height, amp, rgba, vec };
    this.setMarkers(this.markerList);
    if (this.lineList.length) this.setLines(this.lineList);
    this.requestRender();
  }

  /** Everything from `bakeGlobe` at once. */
  setBaked(b: BakedGlobe): void {
    this.setTerrain(b.terrain.rgba, b.terrain.width, b.terrain.height);
    this.setCellIds(b.cellIds.rgba, b.cellIds.width, b.cellIds.height);
    this.setWarp(b.warp.rgba, b.warp.width, b.warp.height, b.warp.amp);
    if (b.rivers) this.setRivers(b.rivers);
  }

  /**
   * Vector rivers (from `bakeRivers` / `bakeGlobe`), drawn as anti-aliased,
   * tapered ribbons lit like the terrain and clipped at coasts and lakes. Their
   * screen width grows gently with zoom (cartographic symbolisation), so they
   * stay crisp and proportionate from the whole globe to the closest view.
   * `style.width` multiplies the width (0 hides them). `null` removes them.
   */
  setRivers(r: RiverGeometry | null, style: { color?: ColorLike; width?: number } = {}): void {
    this.inputs.rivers = r;
    const gl = this.gl;
    if (style.color) {
      const c = parseColor(style.color, [0, 0, 0, 1]);
      this.riverColor = [c[0], c[1], c[2]];
    }
    if (style.width !== undefined) this.riverWidth = style.width;
    if (!r || r.start.length < 2) {
      this.riverIndexCount = 0;
      this.requestRender();
      return;
    }
    const nPaths = r.start.length - 1;
    const total = r.start[nPaths];
    const verts = new Float32Array(total * 2 * 9);
    const idx: number[] = [];
    const P = r.pts;
    for (let pi = 0; pi < nPaths; pi++) {
      const a = r.start[pi], b = r.start[pi + 1];
      if (b - a < 2) continue;
      const anchor = Math.atan2(P[3 * a + 1], P[3 * a]);
      for (let k = a; k < b; k++) {
        const k0 = Math.max(a, k - 1), k1 = Math.min(b - 1, k + 1);
        const tx = P[3 * k1] - P[3 * k0], ty = P[3 * k1 + 1] - P[3 * k0 + 1], tz = P[3 * k1 + 2] - P[3 * k0 + 2];
        const px = P[3 * k], py = P[3 * k + 1], pz = P[3 * k + 2];
        let nx = py * tz - pz * ty, ny = pz * tx - px * tz, nz = px * ty - py * tx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        for (let side = 0; side < 2; side++) {
          const o = (2 * k + side) * 9;
          verts[o] = px; verts[o + 1] = py; verts[o + 2] = pz;
          verts[o + 3] = nx; verts[o + 4] = ny; verts[o + 5] = nz;
          verts[o + 6] = side === 0 ? -1 : 1;
          // Taper to a point at the source.
          verts[o + 7] = r.hw[k] * Math.min(1, (k - a + 1) / 5);
          verts[o + 8] = anchor;
        }
        if (k + 1 < b) {
          const v = 2 * k;
          idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
    }
    gl.bindVertexArray(this.rvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rbuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ribuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.riverIndexCount = idx.length;
    this.requestRender();
  }

  /**
   * Mesh for overlays and picking. `wet[i]` = 1 for water cells (ocean or lake);
   * overlays only consider cells of the pixel's own land/water class.
   */
  setMesh(mesh: SphereMesh, wet?: Uint8Array): void {
    this.inputs.mesh = [mesh, wet];
    const gl = this.gl;
    this.mesh = mesh;
    this.wet = wet ?? new Uint8Array(mesh.n);
    this.locator = null;
    const n = mesh.n;
    const rows = Math.ceil((n + 1) / DATA_W);
    const adjRows = Math.ceil(mesh.adj.length / DATA_W);
    this.dataRows = rows;
    const sites = new Float32Array(DATA_W * rows * 4);
    for (let i = 0; i < n; i++) {
      sites[4 * i] = mesh.xyz[3 * i];
      sites[4 * i + 1] = mesh.xyz[3 * i + 1];
      sites[4 * i + 2] = mesh.xyz[3 * i + 2];
      sites[4 * i + 3] = this.wet[i] ? 1 : 0;
    }
    const nearest = { minFilter: gl.NEAREST, magFilter: gl.NEAREST };
    this.tex.sites = createTexture(gl, DATA_W, rows, sites, { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, ...nearest }, this.tex.sites);
    const as = new Uint32Array(DATA_W * rows);
    as.set(mesh.adjStart);
    this.tex.adjStart = createTexture(gl, DATA_W, rows, as, { internalFormat: gl.R32UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_INT, ...nearest }, this.tex.adjStart);
    const adj = new Uint32Array(DATA_W * adjRows);
    adj.set(mesh.adj);
    this.tex.adj = createTexture(gl, DATA_W, adjRows, adj, { internalFormat: gl.R32UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_INT, ...nearest }, this.tex.adj);
    this.ovColorBuf = new Uint8Array(DATA_W * rows * 4);
    this.ovGroupBuf = new Uint32Array(2 * DATA_W * rows);
    this.tex.ovColor = createTexture(gl, DATA_W, rows, this.ovColorBuf, { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, ...nearest }, this.tex.ovColor);
    this.tex.ovGroup = createTexture(gl, DATA_W, rows, this.ovGroupBuf, { internalFormat: gl.RG32UI, format: gl.RG_INTEGER, type: gl.UNSIGNED_INT, ...nearest }, this.tex.ovGroup);
    this.bfsQueue = new Int32Array(n);
    this.hlBuf = new Uint8Array(DATA_W * rows);
    this.tex.hlCells = createTexture(gl, DATA_W, rows, this.hlBuf, { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, ...nearest }, this.tex.hlCells);
    this.hlCellsOn = false;
    this.requestRender();
  }

  /** Convenience: mesh + land/water flags from a PhysicalWorld. */
  setWorld(world: PhysicalWorld): void {
    const n = world.mesh.n;
    const wet = new Uint8Array(n);
    for (let i = 0; i < n; i++) wet[i] = !world.isLand[i] || world.lakeId[i] >= 0 ? 1 : 0;
    this.setMesh(world.mesh, wet);
  }

  /**
   * Per-cell overlay (political, cultural, …). Cheap: a small data-texture
   * upload, fine to call every frame while scrubbing a timeline. `null` hides it.
   */
  setOverlay(ov: OverlayOptions | null): void {
    this.inputs.overlay = ov;
    if (!ov) {
      this.overlay.on = false;
      this.requestRender();
      return;
    }
    if (!this.mesh || !this.ovColorBuf || !this.ovGroupBuf) throw new Error("GlobeView.setOverlay: call setMesh/setWorld first");
    const gl = this.gl;
    const n = this.mesh.n;
    if (ov.colors.length < 4 * n) throw new Error(`GlobeView.setOverlay: colors must have 4·n = ${4 * n} bytes`);
    this.ovColorBuf.set(ov.colors.subarray(0, 4 * n));
    this.computeEdgeHops(ov.groups ?? null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const rowsUsed = Math.ceil(n / DATA_W);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.ovColor);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DATA_W, rowsUsed, gl.RGBA, gl.UNSIGNED_BYTE, this.ovColorBuf);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.ovGroup);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DATA_W, rowsUsed, gl.RG_INTEGER, gl.UNSIGNED_INT, this.ovGroupBuf);
    const lin = (c: [number, number, number, number]): [number, number, number, number] => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, c[3]];
    this.overlay = {
      on: true,
      opacity: ov.opacity ?? 0.75,
      border: lin(parseColor(ov.borderColor, [0.16, 0.11, 0.08, 0.9])),
      borderWidth: ov.borderWidth ?? 1.4,
      coast: lin(parseColor(ov.coastColor, [0.12, 0.09, 0.07, 0.35])),
      terrainFade: ov.terrainFade ?? 0.25,
      wash: ov.wash ?? 1,
    };
    this.requestRender();
  }

  /**
   * Interleave (group, hops) per cell, where hops = cells to the nearest border
   * with a different group or coastline. Drives the watercolour edge
   * darkening, which then spans more than one cell. O(n) per update.
   */
  private computeEdgeHops(groups: Uint32Array | null): void {
    const mesh = this.mesh!, wet = this.wet!, buf = this.ovGroupBuf!, q = this.bfsQueue!;
    const n = mesh.n, { adj, adjStart } = mesh;
    const g = (i: number): number => (groups ? groups[i] : 0);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) {
      buf[2 * i] = g(i);
      buf[2 * i + 1] = 255;
      if (!groups) continue;
      const gi = groups[i];
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        // Foreign borders and coastlines both seed the wash's edge band.
        if (wet[j] !== wet[i] || groups[j] !== gi) {
          buf[2 * i + 1] = 0;
          q[tail++] = i;
          break;
        }
      }
    }
    while (head < tail) {
      const c = q[head++];
      const h = buf[2 * c + 1] + 1;
      if (h >= 255) continue;
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const j = adj[k];
        if (buf[2 * j + 1] > h && wet[j] === wet[c] && buf[2 * j] === buf[2 * c]) {
          buf[2 * j + 1] = h;
          q[tail++] = j;
        }
      }
    }
  }

  /**
   * Emphasise one overlay group (e.g. the realm under the cursor or the
   * selected one): deeper wash, luminous inner rim, heavier border. `null` clears.
   */
  setHighlight(group: number | null): void {
    if (group === this.highlight) return;
    this.highlight = group;
    this.requestRender();
  }

  /** Hide the overlay (same as `setOverlay(null)`). */
  clearOverlay(): void {
    this.setOverlay(null);
  }

  /**
   * Highlight a set of cells (a selection, search results, a river basin…),
   * independently of any overlay: a warm wash with a luminous inner glow and a
   * bright hairline around the set. `cells` lists cell indices; or pass a
   * Float32Array/Uint8Array of length n with per-cell strengths (0..1 / 0..255)
   * via `{ strength }`-less call: values > 0 are highlighted. `null` clears.
   */
  setHighlightCells(cells: ArrayLike<number> | null, opts?: HighlightCellsOptions): void {
    this.inputs.hlCells = [cells, opts];
    if (!this.mesh || !this.hlBuf) throw new Error("GlobeView.setHighlightCells: call setMesh/setWorld first");
    const n = this.mesh.n;
    const buf = this.hlBuf;
    buf.fill(0);
    if (!cells || cells.length === 0) {
      this.hlCellsOn = false;
      this.requestRender();
      return;
    }
    const perCell = cells.length === n && (cells instanceof Uint8Array || cells instanceof Float32Array || cells instanceof Float64Array);
    if (perCell) {
      const scale = cells instanceof Uint8Array ? 1 : 255;
      for (let i = 0; i < n; i++) buf[i] = Math.max(0, Math.min(255, Math.round(cells[i] * scale)));
    } else {
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        if (c >= 0 && c < n) buf[c] = 255;
      }
    }
    const c = parseColor(opts?.color, [1, 0.82, 0.48, 1]);
    this.hlColor = [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, Math.max(0, Math.min(1, opts?.strength ?? 1))];
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.hlCells);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DATA_W, Math.ceil(n / DATA_W), gl.RED, gl.UNSIGNED_BYTE, buf);
    this.hlCellsOn = true;
    this.requestRender();
  }

  /**
   * Polylines (trade routes, campaigns, war fronts, borders of a selection…)
   * with constant screen width, casing, dashes/dots, optional arrowheads and
   * animated flow. Positions are in cell space like markers (mapped through
   * the inverse warp). `null` or `[]` clears.
   */
  setLines(list: readonly GlobeLine[] | null): void {
    this.lineList = list ? list.slice() : [];
    const tmp = new Float64Array(3);
    const wl = this.warpLattice;
    const geo = buildLineGeometry(this.lineList, wl ? (x, y, z) => {
      unwarp(wl, x, y, z, tmp);
      return [tmp[0], tmp[1], tmp[2]];
    } : undefined);
    const gl = this.gl;
    gl.bindVertexArray(this.lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lbuf);
    gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.libuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.lineIndexCount = geo.indices.length;
    this.lineAnimated = geo.animated;
    this.requestRender();
  }

  /** Point markers drawn in GL (hidden on the far side of the globe). */
  setMarkers(list: readonly GlobeMarker[]): void {
    this.markerList = list.slice();
    const gl = this.gl;
    const stride = 9; // pos3 size1 color4 shape1
    const data = new Float32Array(list.length * stride);
    const tmp = new Float64Array(3);
    this.markerScreen = [];
    list.forEach((m, i) => {
      let x = m.xyz[0], y = m.xyz[1], z = m.xyz[2];
      if (this.warpLattice) {
        unwarp(this.warpLattice, x, y, z, tmp);
        x = tmp[0]; y = tmp[1]; z = tmp[2];
      }
      const c = parseColor(m.color, [0.98, 0.95, 0.88, 1]);
      this.markerScreen.push([x, y, z, m.size ?? 7]);
      data.set([x, y, z, m.size ?? 7, c[0], c[1], c[2], c[3], SHAPES[m.shape ?? "circle"] ?? 0], i * stride);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mbuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.markerCount = list.length;
    this.requestRender();
  }

  /** Text labels drawn on the 2D overlay canvas with collision avoidance. */
  setLabels(list: readonly GlobeLabel[]): void {
    const tmp = new Float64Array(3);
    this.labels.setLabels(list, this.warpLattice ? (x, y, z) => {
      unwarp(this.warpLattice!, x, y, z, tmp);
      return [tmp[0], tmp[1], tmp[2]];
    } : undefined);
    this.requestRender();
  }

  setLabelTheme(theme: LabelTheme): void {
    this.labels.setTheme(theme);
    this.requestRender();
  }

  // ===================================================================== view

  getView(): ViewState {
    return { ...this.state };
  }

  setView(v: Partial<ViewState>): void {
    this.fly = null;
    this.zoomAnim = null;
    this.state = this.clamp({ ...this.state, ...v });
    this.requestRender();
  }

  getMode(): ProjectionMode {
    return this.mode;
  }

  setMode(mode: ProjectionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.state = this.clamp(this.state);
    this.requestRender();
  }

  /** Degrees per second; 0 stops. */
  setAutoRotate(speed: number | boolean): void {
    this.autoRotate = speed === true ? 3 : speed === false ? 0 : speed;
    if (this.reducedMotion) this.autoRotate = 0;
    this.requestRender();
  }

  /** Change lighting/appearance options at runtime. */
  setOptions(o: Partial<Pick<GlobeOptions, "lighting" | "night" | "atmosphere" | "clouds" | "exposure" | "sun" | "background" | "minZoom" | "maxZoom">>): void {
    Object.assign(this.opts, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
    this.requestRender();
  }

  /** Animate to (lat, lon) in degrees and optional zoom. Resolves when done. */
  flyTo(lat: number, lon: number, zoom?: number, durationMs?: number): Promise<void> {
    this.autoRotate = 0;
    this.velocity = { lon: 0, lat: 0 };
    const from = { ...this.state };
    const to = this.clamp({ lat, lon, zoom: zoom ?? from.zoom });
    const ang = angularDistance(from.lat, from.lon, to.lat, to.lon);
    let dur = durationMs ?? Math.min(2600, 700 + 900 * ang + 250 * Math.abs(Math.log(to.zoom / from.zoom)));
    const maxZ = Math.max(from.zoom, to.zoom);
    // Zoom out mid-flight in proportion to distance (more when we start/end close in).
    let bump = Math.min(maxZ - 1, maxZ * Math.min(1, ang / 1.2)) * 0.8;
    if (this.reducedMotion) {
      dur = Math.min(dur, 160);
      bump = 0;
    }
    this.fly = { t0: performance.now(), dur, from, to, bump: Math.max(0, bump) };
    this.zoomAnim = null;
    this.requestRender();
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.fly === null || this.disposed) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  /** Screen position (CSS px) of a lat/lon, and whether it is on the visible side. */
  projectLatLon(lat: number, lon: number): { x: number; y: number; visible: boolean } {
    const f = this.frame();
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    const c = Math.cos(la);
    const pr = project(f, c * Math.cos(lo), c * Math.sin(lo), Math.sin(la), { x: 0, y: 0, depth: 0 });
    return { x: pr.x, y: pr.y, visible: pr.depth > 0 };
  }

  /** Cell and lat/lon under a screen point (CSS px relative to the canvas), or null. */
  pickAt(x: number, y: number): { cell: number; lat: number; lon: number } | null {
    const p = unproject(this.frame(), x, y);
    if (!p) return null;
    const [lat, lon] = toLatLonDeg(p);
    return { cell: this.cellAt(p), lat, lon };
  }

  onPick(cb: PickHandler): () => void {
    this.pickHandlers.push(cb);
    return () => { this.pickHandlers = this.pickHandlers.filter((h) => h !== cb); };
  }

  onHover(cb: PickHandler): () => void {
    this.hoverHandlers.push(cb);
    return () => { this.hoverHandlers = this.hoverHandlers.filter((h) => h !== cb); };
  }

  requestRender(): void {
    this.dirty = true;
    this.schedule();
  }

  /** Draw immediately (synchronously). */
  render(): void {
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const f of this.cleanup) f();
    const gl = this.gl;
    for (const k of Object.keys(this.tex)) if (this.tex[k]) gl.deleteTexture(this.tex[k]);
    gl.deleteProgram(this.prog);
    gl.deleteProgram(this.mprog);
    gl.deleteBuffer(this.mbuf);
    gl.deleteProgram(this.rprog);
    gl.deleteProgram(this.lprog);
    gl.deleteBuffer(this.lbuf);
    gl.deleteBuffer(this.libuf);
    gl.deleteVertexArray(this.lvao);
    gl.deleteBuffer(this.rbuf);
    gl.deleteBuffer(this.ribuf);
    gl.deleteVertexArray(this.rvao);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.mvao);
    if (this.ownsLabelCanvas) this.labelCanvas.remove();
  }

  // ===================================================================== internals

  private clamp(s: ViewState): ViewState {
    return clampView(s, this.mode, this.cssW, this.cssH, this.opts.minZoom, this.opts.maxZoom);
  }

  private frame(): Frame {
    return makeFrame(this.state, this.mode, this.cssW, this.cssH);
  }

  private cellAt(p: V3): number {
    if (this.idData) {
      const uv = new Float64Array(2);
      dirToUV(p[0], p[1], p[2], uv);
      const [w, h] = this.idSize;
      const x = Math.min(w - 1, Math.max(0, Math.floor(uv[0] * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor(uv[1] * h)));
      return decodeCellId(this.idData, 4 * (y * w + x));
    }
    if (this.mesh) {
      if (!this.locator) this.locator = new CellLocator(this.mesh);
      let [x, y, z] = p;
      if (this.warpLattice) {
        const uv = new Float64Array(2);
        const d = new Float64Array(3);
        dirToUV(x, y, z, uv);
        sampleWarp(this.warpLattice, uv[0], uv[1], d);
        x += d[0]; y += d[1]; z += d[2];
        const l = Math.hypot(x, y, z);
        x /= l; y /= l; z /= l;
      }
      return this.locator.find(x, y, z);
    }
    return -1;
  }

  private resize(): void {
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth || c.width);
    const h = Math.max(1, c.clientHeight || c.height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const lc = this.labelCanvas;
    if (lc.width !== W || lc.height !== H) {
      lc.width = W;
      lc.height = H;
    }
    if (this.ownsLabelCanvas) {
      lc.style.left = `${c.offsetLeft}px`;
      lc.style.top = `${c.offsetTop}px`;
      lc.style.width = `${w}px`;
      lc.style.height = `${h}px`;
    }
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.state = this.clamp(this.state);
    this.requestRender();
  }

  private schedule(): void {
    if (this.raf || this.disposed || this.contextLost) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      this.tick(t);
    });
  }

  private tick(t: number): void {
    const dt = this.lastT ? Math.min(64, t - this.lastT) : 16;
    this.lastT = t;
    let animating = false;
    if (this.fly) {
      const f = this.fly;
      const k = Math.min(1, (performance.now() - f.t0) / f.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const [lat, lon] = slerpLatLon(f.from.lat, f.from.lon, f.to.lat, f.to.lon, e);
      const zl = Math.exp(Math.log(f.from.zoom) + (Math.log(f.to.zoom) - Math.log(f.from.zoom)) * e);
      const zoom = zl / (1 + (f.bump / Math.max(1, zl)) * Math.sin(Math.PI * e));
      this.state = this.clamp({ lat, lon, zoom });
      if (k >= 1) {
        this.state = this.clamp(f.to);
        this.fly = null;
      }
      animating = true;
      this.dirty = true;
    } else {
      if (this.zoomAnim) {
        const z = this.zoomAnim;
        const k = Math.min(1, (performance.now() - z.t0) / z.dur);
        const e = 1 - Math.pow(1 - k, 3);
        const target = Math.exp(Math.log(z.from) + (Math.log(z.to) - Math.log(z.from)) * e);
        this.zoomAround(target, z.anchor);
        if (k >= 1) this.zoomAnim = null;
        animating = true;
      }
      if (Math.abs(this.velocity.lon) + Math.abs(this.velocity.lat) > 1e-5 && !this.dragging) {
        this.state = this.clamp({ ...this.state, lon: this.state.lon + this.velocity.lon * dt, lat: this.state.lat + this.velocity.lat * dt });
        const decay = Math.exp(-dt / 320);
        this.velocity.lon *= decay;
        this.velocity.lat *= decay;
        animating = true;
        this.dirty = true;
      } else if (!this.dragging) {
        this.velocity = { lon: 0, lat: 0 };
      }
      if (this.lineAnimated && this.lineIndexCount > 0 && !this.reducedMotion && !(typeof document !== "undefined" && document.hidden)) {
        animating = true;
        this.dirty = true;
      }
      if (this.autoRotate && !this.dragging && this.mode === "globe") {
        this.state = this.clamp({ ...this.state, lon: this.state.lon + (this.autoRotate * dt) / 1000 });
        animating = true;
        this.dirty = true;
      }
    }
    if (this.dirty) this.draw();
    if (animating) this.schedule();
  }

  private sunWorld(f: Frame): V3 {
    const s = this.opts.sun;
    let x: number, y: number, z: number;
    if (s.mode === "world") {
      [x, y, z] = s.dir;
    } else {
      const [a, b, c] = s.dir;
      x = a * f.east[0] + b * f.north[0] + c * f.center[0];
      y = a * f.east[1] + b * f.north[1] + c * f.center[1];
      z = a * f.east[2] + b * f.north[2] + c * f.center[2];
    }
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  private draw(): void {
    this.dirty = false;
    if (this.contextLost) return;
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const f = this.frame();
    const dpr = this.dpr;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    const u = this.u;
    this.commonUniforms(u, f, W, H);
    u.i("uTransparentBg", this.opts.background === "transparent" ? 1 : 0);
    u.f("uStarOffset", -this.state.lon * 6, this.state.lat * 6);
    u.i("uDataW", DATA_W);

    const bind = (unit: number, name: string, tex: WebGLTexture | null): void => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      u.i(name, unit);
    };
    bind(0, "uTerrain", this.tex.terrain);
    bind(1, "uIds", this.tex.ids);
    bind(2, "uWarp", this.tex.warp);
    bind(3, "uSites", this.tex.sites);
    bind(4, "uAdjStart", this.tex.adjStart);
    bind(5, "uAdj", this.tex.adj);
    bind(6, "uOvColor", this.tex.ovColor);
    bind(7, "uOvGroup", this.tex.ovGroup);
    bind(8, "uHlCells", this.tex.hlCells);
    u.i("uHlOn", this.hlCellsOn && !!this.tex.ids && !!this.tex.sites ? 1 : 0);
    u.f("uHlColor", ...this.hlColor);
    u.i("uHasTerrain", this.tex.terrain ? 1 : 0);
    u.f("uTerrainSize", this.terrainSize[0], this.terrainSize[1]);
    u.i("uIdSize", this.idSize[0], this.idSize[1]);
    u.i("uHasWarp", this.warpLattice ? 1 : 0);
    u.f("uWarpAmp", this.warpLattice ? this.warpLattice.amp : 0);
    const ovOn = this.overlay.on && !!this.tex.ids && !!this.tex.sites;
    u.i("uOvOn", ovOn ? 1 : 0);
    const ov = this.overlay;
    u.f("uOvOpacity", ov.opacity);
    u.f("uBorderColor", ...ov.border);
    u.f("uBorderWidth", ov.borderWidth);
    u.f("uCoastColor", ...ov.coast);
    u.f("uTerrainFade", ov.terrainFade);
    u.f("uWash", ov.wash);
    u.i("uHasHighlight", this.highlight === null ? 0 : 1);
    {
      const l = u.loc("uHighlight");
      if (l) gl.uniform1ui(l, this.highlight ?? 0);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Rivers: vector ribbons with a cartographic (zoom-damped) width.
    if (this.riverIndexCount > 0 && this.tex.terrain && this.riverWidth > 0) {
      const base = this.mode === "globe" ? GLOBE_FIT * Math.min(this.cssW, this.cssH) : Math.min(this.cssW / (2 * Math.PI), this.cssH / Math.PI);
      const scale = base * dpr * Math.pow(this.state.zoom, 0.45) * 0.6 * this.riverWidth;
      {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.rprog);
        const r = this.ru;
        this.commonUniforms(r, f, W, H);
        r.f("uRiverScale", scale);
        r.f("uRiverAlpha", 1);
        r.f("uRiverColor", this.riverColor[0] ** 2.2, this.riverColor[1] ** 2.2, this.riverColor[2] ** 2.2);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex.terrain);
        r.i("uTerrain", 0);
        gl.bindVertexArray(this.rvao);
        for (const sh of this.mode === "globe" ? [0] : [-2 * Math.PI, 0, 2 * Math.PI]) {
          r.f("uLonShift", sh);
          gl.drawElements(gl.TRIANGLES, this.riverIndexCount, gl.UNSIGNED_INT, 0);
        }
        gl.disable(gl.BLEND);
      }
    }

    // Lines (routes, fronts, arrows).
    if (this.lineIndexCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.lprog);
      const l = this.lu;
      this.commonUniforms(l, f, W, H);
      l.f("uTime", this.reducedMotion ? 0 : (performance.now() - this.t0) / 1000);
      gl.bindVertexArray(this.lvao);
      // The flat map repeats horizontally: draw the copies that can be on screen.
      const shifts = this.mode === "globe" ? [0] : [-2 * Math.PI, 0, 2 * Math.PI];
      for (const sh of shifts) {
        l.f("uLonShift", sh);
        gl.drawElements(gl.TRIANGLES, this.lineIndexCount, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.BLEND);
    }

    // Markers.
    if (this.markerCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.mprog);
      const m = this.mu;
      m.f("uRes", W, H);
      m.f("uCenterPx", f.cx * dpr, H - f.cy * dpr);
      m.f("uRadiusPx", f.radius * dpr);
      m.f("uDpr", dpr);
      m.f("uEast", ...f.east);
      m.f("uNorth", ...f.north);
      m.f("uCenter", ...f.center);
      m.i("uMode", this.mode === "globe" ? 0 : 1);
      m.f("uFlatCenter", f.lon0, f.lat0);
      m.f("uFlatScale", f.scale / dpr);
      gl.bindVertexArray(this.mvao);
      gl.drawArrays(gl.POINTS, 0, this.markerCount);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);

    // Labels (markers are obstacles; night-side labels are dimmed).
    const sun = this.sunWorld(f);
    const lit = this.mode === "globe" && this.opts.lighting > 0;
    const obstacles: Box[] = [];
    const pr = { x: 0, y: 0, depth: 0 };
    for (const m of this.markerScreen) {
      project(f, m[0], m[1], m[2], pr);
      if (pr.depth < 0.05 || pr.x < -20 || pr.y < -20 || pr.x > this.cssW + 20 || pr.y > this.cssH + 20) continue;
      const r = m[3] / 2 + 1;
      obstacles.push({ x0: pr.x - r, y0: pr.y - r, x1: pr.x + r, y1: pr.y + r });
    }
    this.labels.draw(
      f, dpr, this.state.zoom,
      (label) => (label.style === "capital" ? 5 : label.style === "city" ? 3.5 : 4),
      lit ? (x, y, z) => smoothstepJS(-0.25, 0.3, x * sun[0] + y * sun[1] + z * sun[2]) * this.opts.lighting + (1 - this.opts.lighting) : undefined,
      obstacles,
    );
  }

  private setupRiverVAO(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.rvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rbuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ribuf);
    const stride = 9 * 4;
    const attr = (name: string, size: number, offset: number): void => {
      const loc = gl.getAttribLocation(this.rprog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr("aPos", 3, 0);
    attr("aSideDir", 3, 3);
    attr("aSide", 1, 6);
    attr("aHw", 1, 7);
    attr("aAnchor", 1, 8);
    gl.bindVertexArray(null);
  }

  private setupLineVAO(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lbuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.libuf);
    const stride = LINE_STRIDE * 4;
    const attr = (name: string, size: number, offset: number): void => {
      const loc = gl.getAttribLocation(this.lprog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr("aPos", 3, 0);
    attr("aPrev", 3, 3);
    attr("aNext", 3, 6);
    attr("aSide", 1, 9);
    attr("aDist", 1, 10);
    attr("aColor", 4, 11);
    attr("aWidth", 1, 15);
    attr("aCasing", 1, 16);
    attr("aStyle", 1, 17);
    attr("aKind", 1, 18);
    attr("aLonU", 1, 19);
    attr("aFlow", 1, 20);
    attr("aCaseA", 1, 21);
    attr("aAnchor", 1, 22);
    gl.bindVertexArray(null);
  }

  /** Uniforms shared by the globe and river programs. */
  private commonUniforms(u: Uniforms, f: Frame, W: number, H: number): void {
    const dpr = this.dpr;
    u.f("uRes", W, H);
    u.f("uCenterPx", f.cx * dpr, H - f.cy * dpr);
    u.f("uRadiusPx", f.radius * dpr);
    u.f("uDpr", dpr);
    u.f("uEast", ...f.east);
    u.f("uNorth", ...f.north);
    u.f("uCenter", ...f.center);
    u.i("uMode", this.mode === "globe" ? 0 : 1);
    u.f("uFlatCenter", f.lon0, f.lat0);
    u.f("uFlatScale", f.scale / dpr);
    u.f("uSun", ...this.sunWorld(f));
    u.f("uLighting", this.opts.lighting);
    u.f("uNight", this.opts.night);
    u.f("uAtmos", this.opts.atmosphere);
    u.f("uExposure", this.opts.exposure);
    u.f("uSpacing", this.mesh ? this.mesh.meanSpacing : 0.02);
    // Sun glint: a planetary-scale highlight; it would read as a smudge in close-ups.
    u.f("uGlint", 1 - 0.88 * smoothstepJS(1, 3, this.state.zoom));
    const zf = 1 - smoothstepJS(1.25, 2.6, this.state.zoom);
    u.f("uClouds", this.opts.clouds * zf * (this.overlay.on ? 0.12 : 1));
    const cl = u.loc("uCyclones");
    if (cl) {
      this.gl.uniform4fv(cl, this.cyclones);
      u.i("uCycloneCount", this.cyclones.length / 4);
    }
  }

  private setupMarkerVAO(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.mvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mbuf);
    const stride = 9 * 4;
    const attr = (name: string, size: number, offset: number): void => {
      const loc = gl.getAttribLocation(this.mprog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr("aPos", 3, 0);
    attr("aSize", 1, 3);
    attr("aColor", 4, 4);
    attr("aShape", 1, 8);
    gl.bindVertexArray(null);
  }

  // ===================================================================== interaction

  private dragging = false;

  private zoomAround(newZoom: number, anchor: [number, number] | null): void {
    const before = anchor ? unproject(this.frame(), anchor[0], anchor[1]) : null;
    this.state = this.clamp({ ...this.state, zoom: newZoom });
    if (before && anchor) {
      const after = unproject(this.frame(), anchor[0], anchor[1]);
      if (after) {
        const [la0, lo0] = toLatLonDeg(before);
        const [la1, lo1] = toLatLonDeg(after);
        this.state = this.clamp({ ...this.state, lat: this.state.lat + (la0 - la1), lon: this.state.lon + wrapDeg(lo0 - lo1) });
      }
    }
    this.dirty = true;
  }

  private panBy(dx: number, dy: number): void {
    // dx, dy in CSS px; "grab" the surface.
    const f = this.frame();
    let dLon: number, dLat: number;
    if (this.mode === "globe") {
      const c = Math.max(0.2, Math.cos((this.state.lat * Math.PI) / 180));
      dLon = (-dx / (f.radius * c)) * (180 / Math.PI);
      dLat = (dy / f.radius) * (180 / Math.PI);
    } else {
      dLon = -dx * f.scale * (180 / Math.PI);
      dLat = dy * f.scale * (180 / Math.PI);
    }
    this.state = this.clamp({ ...this.state, lon: this.state.lon + dLon, lat: this.state.lat + dLat });
    this.dirty = true;
  }

  private attachControls(): void {
    const c = this.canvas;
    c.style.touchAction = "none";
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt = { x: 0, y: 0, t: 0 };
    let moved = 0;
    let lastTap = { t: 0, x: 0, y: 0 };
    let samples: { t: number; lon: number; lat: number }[] = [];
    let pinch: { d: number; mx: number; my: number } | null = null;
    const local = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const stopAnims = (): void => {
      this.autoRotate = 0;
      this.fly = null;
      this.zoomAnim = null;
    };
    const onDown = (e: PointerEvent): void => {
      stopAnims();
      c.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      pointers.set(e.pointerId, { x, y });
      this.velocity = { lon: 0, lat: 0 };
      if (pointers.size === 1) {
        downAt = { x, y, t: performance.now() };
        moved = 0;
        this.dragging = true;
        samples = [{ t: performance.now(), lon: this.state.lon, lat: this.state.lat }];
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
      this.requestRender();
    };
    const onMove = (e: PointerEvent): void => {
      const [x, y] = local(e);
      const p = pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse") this.hover(x, y);
        return;
      }
      const dx = x - p.x, dy = y - p.y;
      p.x = x;
      p.y = y;
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch.d > 0 && d > 0) this.zoomAround(this.state.zoom * (d / pinch.d), [mx, my]);
        this.panBy(mx - pinch.mx, my - pinch.my);
        pinch = { d, mx, my };
        moved += 10;
      } else {
        moved += Math.abs(dx) + Math.abs(dy);
        this.panBy(dx, dy);
        const now = performance.now();
        samples.push({ t: now, lon: this.state.lon, lat: this.state.lat });
        while (samples.length > 2 && now - samples[0].t > 90) samples.shift();
      }
      this.requestRender();
    };
    const onUp = (e: PointerEvent): void => {
      const [x, y] = local(e);
      const had = pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!had) return;
      if (pointers.size === 0) {
        this.dragging = false;
        const now = performance.now();
        if (moved < 5 && now - downAt.t < 450) {
          // Tap / click.
          if (now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 24) {
            this.zoomInAt(x, y);
            lastTap = { t: 0, x: 0, y: 0 };
          } else {
            lastTap = { t: now, x, y };
            this.emitPick(x, y);
          }
        } else if (samples.length >= 2) {
          const a = samples[0], b = samples[samples.length - 1];
          const dt = b.t - a.t;
          if (dt > 0 && now - b.t < 80) {
            this.velocity = { lon: wrapDeg(b.lon - a.lon) / dt, lat: (b.lat - a.lat) / dt };
          }
        }
      }
      this.requestRender();
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      stopAnims();
      const [x, y] = local(e);
      const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0018;
      const target = (this.zoomAnim ? this.zoomAnim.to : this.state.zoom) * Math.exp(-e.deltaY * k);
      this.zoomAnim = { t0: performance.now(), dur: 180, from: this.state.zoom, to: Math.max(this.opts.minZoom, Math.min(this.opts.maxZoom, target)), anchor: [x, y] };
      this.requestRender();
    };
    const onDbl = (e: MouseEvent): void => {
      e.preventDefault();
    };
    const onLeave = (): void => {
      if (this.hoverCell !== -2) {
        this.hoverCell = -2;
        for (const h of this.hoverHandlers) h(-1, NaN, NaN);
      }
    };
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onUp);
    c.addEventListener("pointerleave", onLeave);
    c.addEventListener("wheel", onWheel, { passive: false });
    c.addEventListener("dblclick", onDbl);
    // Keyboard: arrows pan, +/- zoom, 0 resets the zoom.
    if (c.tabIndex < 0) c.tabIndex = 0;
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const f = this.frame();
      const stepPx = Math.min(f.width, f.height) * (e.shiftKey ? 0.4 : 0.15);
      const pan = (dx: number, dy: number): void => {
        const before = { ...this.state };
        this.panBy(dx, dy);
        const to = { ...this.state };
        this.state = before;
        void this.flyTo(to.lat, to.lon, to.zoom, 260);
      };
      const zoomBy = (k: number): void => {
        stopAnims();
        const target = Math.max(this.opts.minZoom, Math.min(this.opts.maxZoom, this.state.zoom * k));
        this.zoomAnim = { t0: performance.now(), dur: 220, from: this.state.zoom, to: target, anchor: null };
        this.requestRender();
      };
      switch (e.key) {
        case "ArrowLeft": pan(stepPx, 0); break;
        case "ArrowRight": pan(-stepPx, 0); break;
        case "ArrowUp": pan(0, stepPx); break;
        case "ArrowDown": pan(0, -stepPx); break;
        case "+": case "=": zoomBy(1.5); break;
        case "-": case "_": zoomBy(1 / 1.5); break;
        case "0": void this.flyTo(this.state.lat, this.state.lon, 1, 600); break;
        default: return;
      }
      e.preventDefault();
    };
    c.addEventListener("keydown", onKey);
    this.cleanup.push(() => {
      c.removeEventListener("pointerdown", onDown);
      c.removeEventListener("pointermove", onMove);
      c.removeEventListener("pointerup", onUp);
      c.removeEventListener("pointercancel", onUp);
      c.removeEventListener("pointerleave", onLeave);
      c.removeEventListener("wheel", onWheel);
      c.removeEventListener("dblclick", onDbl);
      c.removeEventListener("keydown", onKey);
    });
  }

  private zoomInAt(x: number, y: number): void {
    const p = unproject(this.frame(), x, y);
    if (!p) return;
    const [lat, lon] = toLatLonDeg(p);
    void this.flyTo(lat, lon, Math.min(this.opts.maxZoom, this.state.zoom * 2), 700);
  }

  private emitPick(x: number, y: number): void {
    if (this.pickHandlers.length === 0) return;
    const hit = this.pickAt(x, y);
    if (!hit) return;
    for (const h of this.pickHandlers) h(hit.cell, hit.lat, hit.lon);
  }

  private hoverPending: [number, number] | null = null;
  private hover(x: number, y: number): void {
    if (this.hoverHandlers.length === 0) return;
    const first = this.hoverPending === null;
    this.hoverPending = [x, y];
    if (!first) return;
    requestAnimationFrame(() => {
      const hp = this.hoverPending;
      this.hoverPending = null;
      if (!hp || this.disposed) return;
      const hit = this.pickAt(hp[0], hp[1]);
      const cell = hit ? hit.cell : -1;
      if (cell === this.hoverCell) return;
      this.hoverCell = cell;
      for (const h of this.hoverHandlers) h(cell, hit ? hit.lat : NaN, hit ? hit.lon : NaN);
    });
  }
}

/** A few mid-latitude cyclones (counter-clockwise in the north, clockwise in the south). */
function makeCyclones(seed: number): Float32Array {
  let st = (seed * 2654435761) >>> 0 || 1;
  const rnd = (): number => {
    st ^= st << 13; st >>>= 0;
    st ^= st >>> 17;
    st ^= st << 5; st >>>= 0;
    return st / 4294967296;
  };
  const out = new Float32Array(4 * 7);
  for (let i = 0; i < 7; i++) {
    const north = i % 2 === 0;
    const lat = (north ? 1 : -1) * (0.55 + 0.45 * rnd());
    const lon = rnd() * 2 * Math.PI;
    out[4 * i] = Math.cos(lat) * Math.cos(lon);
    out[4 * i + 1] = Math.cos(lat) * Math.sin(lon);
    out[4 * i + 2] = Math.sin(lat);
    out[4 * i + 3] = (north ? 1 : -1) * (1.3 + 1.1 * rnd());
  }
  return out;
}

function smoothstepJS(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
