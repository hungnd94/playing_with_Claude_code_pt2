/**
 * Label planning: builds candidates for every nameable thing on the plate and
 * places them greedily by cartographic priority with the LabelPlacer.
 *
 *  - realms: large letter-spaced capitals along the curved axis of the realm's
 *    main territory, kept inside it;
 *  - oceans / seas / gulfs / lakes: italic, letter-spaced, curved along the
 *    local shape of the open water, away from the shore; oceans and great seas
 *    carry their English sense beneath ("the North Ocean");
 *  - settlements: beside their icon, in the preferred cartographic positions;
 *  - ranges, deserts, forests…: along the axis of the region;
 *  - rivers: along a smooth stretch of their course, just above the water;
 *  - islands: inside when large, else beside the shore;
 *  - battles: crossed swords with name and year.
 *
 * Pure (text measurement injected).
 */
import type { History } from "../history/types";
import type { GeoFeature, PhysicalWorld } from "../world/types";
import { decimate, type Pt } from "./contour";
import { nodeAt, sampleAt, type FieldGrid } from "./field";
import {
  advances, areaAxis, layoutOnPath, layoutStraight, offsetPath, pathLength, pointCandidates, readable, smoothPath, spinePath,
  styleFont, displayText, type Box, type Candidate, type LabelKind, type LabelPlacer, type Layout, type PlacedLabel, type TextStyle,
} from "./labels";
import type { Measure } from "./model";
import type { Occupancy } from "./occupancy";
import type { BattleMark, PlaceMark } from "./places";
import type { PoliticalGeom, RealmGeom } from "./political";
import type { Projection } from "./projection";
import type { RiverPath } from "./rivers";
import { featureLabel, realmName } from "./names";
import { mix, type AtlasStyle, type Palette } from "./style";
import type { WaterGeometry } from "./water";

export interface LabelInput {
  world: PhysicalWorld;
  h: History;
  year: number;
  proj: Projection;
  f: FieldGrid;
  water: WaterGeometry;
  rivers: RiverPath[];
  pol: PoliticalGeom | null;
  places: PlaceMark[];
  battles: BattleMark[];
  k: number;
  pal: Palette;
  style: AtlasStyle;
  measure: Measure;
  placer: LabelPlacer;
  occ: Occupancy;
  /** Owner per cell at the year (for feature names in the holder's tongue). */
  ownerCell: Int32Array | null;
  /** The plate is about a war: show all its battles (swords even without a label). */
  focusWar?: boolean;
}

export interface LabelResult {
  labels: PlacedLabel[];
  /** Settlements whose icon is drawn. */
  shown: PlaceMark[];
  /** Battles drawn. */
  battles: BattleMark[];
}

const OUT = { x: 0, y: 0 };

function darken(c: [number, number, number], ink: string, t: number): string {
  const h = ink.replace("#", "");
  const ik: [number, number, number] = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const m = mix(c, ik, t);
  return `rgb(${m[0] | 0},${m[1] | 0},${m[2] | 0})`;
}

/** Styles per label kind (sizes in px at k = 1). */
function styles(pal: Palette, k: number) {
  const halo = pal.paper;
  return {
    realm: (size: number, spacing: number, color: string): TextStyle => ({ size, sc: true, caps: true, spacing, color, halo, haloWidth: size * 0.22, opacity: 0.92 }),
    ocean: (size: number): TextStyle => ({ size, italic: true, caps: true, spacing: 0.42, color: pal.waterInk, halo: pal.water, haloWidth: size * 0.3, opacity: 0.9 }),
    oceanGloss: (size: number): TextStyle => ({ size, italic: true, spacing: 0.08, color: pal.waterInk, halo: pal.water, haloWidth: size * 0.3, opacity: 0.8 }),
    sea: (size: number): TextStyle => ({ size, italic: true, caps: true, spacing: 0.3, color: pal.waterInk, halo: pal.water, haloWidth: size * 0.3, opacity: 0.9 }),
    bay: (size: number): TextStyle => ({ size, italic: true, spacing: 0.12, color: pal.waterInk, halo: pal.water, haloWidth: size * 0.3, opacity: 0.9 }),
    lake: (size: number): TextStyle => ({ size, italic: true, spacing: 0.08, color: pal.waterInk, halo: pal.lake, haloWidth: size * 0.28, opacity: 0.92 }),
    river: (size: number): TextStyle => ({ size, italic: true, spacing: 0.1, color: pal.waterInk, halo: halo, haloWidth: size * 0.25, opacity: 0.95 }),
    range: (size: number): TextStyle => ({ size, sc: true, caps: true, spacing: 0.32, color: pal.ink, halo, haloWidth: size * 0.28, opacity: 0.9 }),
    region: (size: number): TextStyle => ({ size, italic: true, spacing: 0.3, color: pal.inkSoft, halo, haloWidth: size * 0.25, opacity: 0.85 }),
    island: (size: number): TextStyle => ({ size, italic: true, spacing: 0.06, color: pal.ink, halo, haloWidth: size * 0.25, opacity: 0.92 }),
    capital: (size: number): TextStyle => ({ size, sc: true, spacing: 0.05, color: pal.ink, halo, haloWidth: Math.max(2.6 * k, size * 0.24), opacity: 1 }),
    city: (size: number): TextStyle => ({ size, spacing: 0.02, color: pal.ink, halo, haloWidth: Math.max(2.4 * k, size * 0.24), opacity: 1 }),
    town: (size: number): TextStyle => ({ size, spacing: 0.02, color: pal.ink, halo, haloWidth: Math.max(2.2 * k, size * 0.24), opacity: 0.95 }),
    village: (size: number): TextStyle => ({ size, italic: true, spacing: 0.02, color: pal.inkSoft, halo, haloWidth: Math.max(2 * k, size * 0.24), opacity: 0.95 }),
    ruin: (size: number): TextStyle => ({ size, italic: true, spacing: 0.04, color: pal.inkSoft, halo, haloWidth: Math.max(2 * k, size * 0.24), opacity: 0.9 }),
    battle: (size: number): TextStyle => ({ size, italic: true, spacing: 0.03, color: pal.red, halo, haloWidth: Math.max(2 * k, size * 0.24), opacity: 0.95 }),
  };
}

export function planLabels(inp: LabelInput): LabelResult {
  const { world, h, year, proj, f, water, pol, k, pal, measure, placer, occ } = inp;
  const S = styles(pal, k);
  const rect = proj.rect;
  const labels: PlacedLabel[] = [];
  const pad = 1.6 * k;
  const ownerNode = pol?.ownerNode ?? null;
  const isWater = (x: number, y: number) => sampleAt(f, f.coast, x, y) <= 0;
  const distWater = (x: number, y: number) => water.distPx[nodeAt(f, x, y)];
  const ownerAtPx = (x: number, y: number) => (ownerNode ? ownerNode[nodeAt(f, x, y)] : -1);
  const inRect = (x: number, y: number, m: number) => x > rect.x + m && x < rect.x + rect.w - m && y > rect.y + m && y < rect.y + rect.h - m;
  // Scale class: km per pixel at the centre (≈ 8 for a continent, 2 for a region, < 1 close up).
  const kmpp = proj.kmPerPx;
  const area = rect.w * rect.h;
  const zoom = Math.max(0.5, Math.min(2.5, 4 / kmpp)); // > 1 when zoomed in

  const place = (id: string, kind: LabelKind, text: string, st: TextStyle, cands: Candidate[], ref?: PlacedLabel["ref"], p = pad): PlacedLabel | null => {
    if (!cands.length) return null;
    const pl = placer.place(id, kind, text, st, cands, p, ref);
    if (pl) labels.push(pl);
    return pl;
  };

  /** Soft cost of what a layout covers: rivers/coasts (occupancy), and water for land labels. */
  const coverCost = (lay: Layout, landLabel: boolean): number => {
    let c = 0;
    for (const b of lay.boxes) {
      c += occ.sumIn(b.x0, b.y0, b.x1, b.y1) * 0.04;
      if (landLabel && isWater((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)) c += 0.6;
    }
    return c / Math.max(1, lay.boxes.length);
  };

  // ------------------------------------------------------------------ settlements: icons first
  const shown: PlaceMark[] = [];
  const iconIndex: Box[] = [];
  const iconBox = (m: PlaceMark): Box => ({ x0: m.x - m.r, y0: m.y - m.r * (m.minor ? 2.6 : m.tier === "capital" || m.tier === "city" ? 1.5 : 1.05), x1: m.x + m.r * (m.minor ? 1.6 : 1), y1: m.y + m.r * 0.75 });
  const iconHits = (b: Box, gap: number) => iconIndex.some((o) => b.x0 - gap < o.x1 && b.x1 + gap > o.x0 && b.y0 - gap < o.y1 && b.y1 + gap > o.y0);
  const major = inp.places.filter((m) => m.tier === "capital" || m.tier === "city" || m.tier === "town");
  const maxMajor = Math.round((area / (17000 * k * k)) * Math.min(1.6, zoom));
  const townGap = Math.max(4 * k, (16 * k) / zoom);
  for (const m of major) {
    if (shown.length >= maxMajor && m.tier === "town") continue;
    const b = iconBox(m);
    if (iconHits(b, m.tier === "town" ? townGap : 3 * k)) continue;
    iconIndex.push(b);
    placer.obstacle(b);
    shown.push(m);
  }

  const placeLabelFor = (m: PlaceMark): PlacedLabel | null => {
    const size = (m.tier === "capital" ? (m.minor ? 12.2 : m.great ? 15.5 : 14) : m.tier === "city" ? (m.great ? 14 : 12.6) : m.tier === "town" ? 11.2 : 9.8) * k;
    const st = m.tier === "capital" ? S.capital(size) : m.tier === "city" ? S.city(size) : m.tier === "town" ? S.town(size) : m.tier === "ruin" ? S.ruin(size * 0.95) : S.village(size);
    const text = m.tier === "ruin" ? `ruins of ${m.name}` : m.name;
    const cands = pointCandidates(measure, m.x, m.y + (m.tier === "capital" || m.tier === "city" ? -m.r * 0.35 : 0), m.r + 0.5 * k, text, st);
    for (const c of cands) c.cost += coverCost(c.layout, true);
    return place(`place:${m.id}`, m.tier === "ruin" ? "ruin" : m.tier, text, st, cands, { type: "settlement", id: m.id }, 1.2 * k);
  };

  // Capitals' names first: they matter most.
  for (const m of shown) if (m.tier === "capital") placeLabelFor(m);

  // ------------------------------------------------------------------ realms
  if (pol) {
    const realms = pol.realms.slice().sort((a, b) => b.nodes - a.nodes || a.id - b.id);
    const minArea = 2600 * k * k;
    for (const r of realms) {
      if (r.mainNodes * f.step * f.step < minArea) continue;
      const nm = realmName(h, r.id, year);
      if (!nm) continue;
      placeRealm(r, nm.roman);
    }
  }

  function placeRealm(r: RealmGeom, name: string): void {
    const ax = areaAxis(r.xs, r.ys);
    if (!ax) return;
    const A = ax.u1 - ax.u0;
    const T = Math.max(6 * k, 2 * ax.half);
    const vassal = r.overlord >= 0;
    const text = name.toLocaleUpperCase();
    const n = Array.from(text).length;
    const color = inp.style === "political" ? darken(r.color, pal.ink, 0.62) : pal.ink;
    const maxSize = (vassal ? 22 : 34) * k;
    const minSize = (vassal ? 9.5 : 11) * k;
    let size = Math.min(maxSize, T * 0.62, (0.78 * A) / Math.max(3, n * 0.95));
    if (size < minSize) size = minSize;
    const cands: Candidate[] = [];
    let st: TextStyle | null = null;
    for (let attempt = 0; attempt < 5 && size >= minSize * 0.92; attempt++, size *= 0.86) {
      const fnt = styleFont({ size, sc: true, spacing: 0, color, halo: "", haloWidth: 0 });
      const plain = advances(measure, fnt, text, 0);
      // Spread the letters over ~70% of the axis (more for short names in large realms).
      const want = Math.min(0.82, 0.55 + 0.03 * Math.max(0, 10 - n)) * A;
      let spacingEm = n > 1 ? (want - plain.total) / ((n - 1) * size) : 0;
      spacingEm = Math.max(0.12, Math.min(vassal ? 0.7 : 1.15, spacingEm));
      const sp = spacingEm * size;
      const adv = advances(measure, fnt, text, sp);
      if (adv.total > A * 0.98 && attempt < 4) continue;
      st = S.realm(size, spacingEm, color);
      if (vassal) st.opacity = 0.78;
      const paths: { path: Pt[]; dvf: number; straight: number }[] = [];
      for (const dvf of [0, 0.18, -0.18, 0.36, -0.36]) paths.push({ path: spinePath(ax, -0.15, 1.15, dvf * T, 40), dvf, straight: 0 });
      // Straight fallbacks through the centre, horizontal and gently tilted.
      for (const tilt of [0, 0.25, -0.25]) {
        for (const dy of [0, -0.22 * T, 0.22 * T]) {
          const L0 = A * 0.6, ca = Math.cos(tilt), sa = Math.sin(tilt);
          paths.push({ path: [[ax.cx - L0 * ca, ax.cy + dy - L0 * sa], [ax.cx + L0 * ca, ax.cy + dy + L0 * sa]], dvf: Math.abs(dy) / T, straight: 0.6 + Math.abs(tilt) });
        }
      }
      for (const { path, dvf, straight } of paths) {
        const L = pathLength(path);
        for (const cf of [0.5, 0.42, 0.58, 0.34, 0.66]) {
          const lay = layoutOnPath(path, adv, sp, size, L * cf);
          if (!lay || lay.maxTurn > 0.3 || lay.maxTilt > 0.8) continue;
          // Every letter inside the realm, on land.
          let out = 0, wet = 0;
          for (const g of lay.glyphs) {
            if (g.ch.trim() === "") continue;
            const o = ownerAtPx(g.x, g.y);
            if (o !== r.id) out++;
            if (isWater(g.x, g.y)) wet++;
          }
          const frac = out / Math.max(1, n);
          if (frac > 0.2 || wet > 0) continue;
          const cost = frac * 4 + Math.abs(dvf) * 1.5 + Math.abs(cf - 0.5) * 2 + lay.maxTurn + attempt * 0.25 + straight;
          cands.push({ layout: lay, cost });
        }
      }
      if (cands.length) break;
    }
    if (st && cands.length) place(`realm:${r.id}`, "realm", name, st, cands, { type: "polity", id: r.id }, 2 * k);
  }

  // ------------------------------------------------------------------ waters
  type Body = { feat: GeoFeature; nodes: number[] };
  const bodies = new Map<number, Body>();
  {
    const { gx, gy } = f;
    const sub = 2;
    for (let j = 0; j < gy; j += sub)
      for (let i = 0; i < gx; i += sub) {
        const q = j * gx + i;
        if (f.coast[q] > 0 || f.cell[q] < 0) continue;
        const x = f.x0 + i * f.step, y = f.y0 + j * f.step;
        if (!inRect(x, y, 6 * k)) continue;
        const wb = world.waterBodyOf[f.cell[q]];
        let fid = wb;
        // Lakes are land cells in the mesh (waterBodyOf = -1): use the lake feature.
        if (fid < 0 && world.lakeId[f.cell[q]] >= 0) fid = lakeFeature(world.lakeId[f.cell[q]]);
        if (fid < 0) continue;
        let b = bodies.get(fid);
        if (!b) bodies.set(fid, (b = { feat: world.features[fid], nodes: [] }));
        b.nodes.push(q);
      }
  }
  function lakeFeature(lake: number): number {
    if (!lakeFeatCache) {
      lakeFeatCache = new Map();
      for (const ft of world.features) if (ft.kind === "lake") for (const c of ft.cells) if (world.lakeId[c] >= 0) lakeFeatCache.set(world.lakeId[c], ft.id);
    }
    return lakeFeatCache.get(lake) ?? -1;
  }

  const waterOrder = (b: Body) => (b.feat.kind === "ocean" ? 0 : b.feat.kind === "sea" ? 1 : b.feat.kind === "bay" ? 2 : 3);
  const waterBodies = [...bodies.values()].filter((b) => b.feat).sort((a, b) => waterOrder(a) - waterOrder(b) || b.nodes.length - a.nodes.length || a.feat.id - b.feat.id);

  function placeWater(b: Body): void {
    const nn = featureLabel(h, inp.ownerCell, b.feat, year);
    if (!nn) return;
    const kind = b.feat.kind;
    const areaPx = b.nodes.length * (2 * f.step) ** 2;
    const name = nn.name.roman;
    const n = Array.from(name).length;
    let st: TextStyle;
    if (kind === "ocean") st = S.ocean(Math.min(26 * k, Math.max(15 * k, Math.sqrt(areaPx) / 26)));
    else if (kind === "sea") st = S.sea(Math.min(19 * k, Math.max(12 * k, Math.sqrt(areaPx) / 26)));
    else if (kind === "bay") st = S.bay(Math.min(14 * k, Math.max(10.5 * k, Math.sqrt(areaPx) / 24)));
    else st = S.lake(Math.min(13.5 * k, Math.max(9.5 * k, Math.sqrt(areaPx) / 18)));
    const text = displayText(name, st);
    const fnt = styleFont(st);
    const sp = st.spacing * st.size;
    const adv = advances(measure, fnt, text, sp);
    const glossText = (kind === "ocean" || (kind === "sea" && b.nodes.length > 1500)) && nn.name.gloss ? `the ${nn.name.gloss}` : "";
    const id = `water:${b.feat.id}`;
    const ref = { type: "feature", id: b.feat.id };
    // Room needed around each glyph (from the shore).
    const clear = st.size * (kind === "lake" ? 0.45 : 0.75);
    // Candidate centres: well inside the water, spread out.
    const byDist = b.nodes.slice().sort((p, q) => water.distPx[q] - water.distPx[p] || p - q);
    const centres: number[] = [];
    const minSep = Math.max(adv.total * 0.5, 40 * k);
    for (const q of byDist) {
      if (centres.length >= 7) break;
      const x = f.x0 + (q % f.gx) * f.step, y = f.y0 + Math.floor(q / f.gx) * f.step;
      if (water.distPx[q] < clear) break;
      if (centres.some((c) => Math.hypot(f.x0 + (c % f.gx) * f.step - x, f.y0 + Math.floor(c / f.gx) * f.step - y) < minSep)) continue;
      centres.push(q);
    }
    const cands: Candidate[] = [];
    // Body centroid (for a mild preference to stay central).
    let mx = 0, my = 0;
    for (const q of b.nodes) { mx += f.x0 + (q % f.gx) * f.step; my += f.y0 + Math.floor(q / f.gx) * f.step; }
    mx /= b.nodes.length; my /= b.nodes.length;
    const diag = Math.hypot(rect.w, rect.h);
    for (const q of centres) {
      const cx = f.x0 + (q % f.gx) * f.step, cy = f.y0 + Math.floor(q / f.gx) * f.step;
      // Local axis of the water around the centre.
      const R = Math.max(adv.total * 0.75, 30 * k);
      const xs: number[] = [], ys: number[] = [];
      for (const p of b.nodes) {
        const x = f.x0 + (p % f.gx) * f.step, y = f.y0 + Math.floor(p / f.gx) * f.step;
        if (Math.abs(x - cx) < R && Math.abs(y - cy) < R * 0.7) { xs.push(x); ys.push(y); }
      }
      const ax = areaAxis(xs, ys);
      const paths: Pt[][] = [];
      paths.push([[cx - adv.total, cy], [cx + adv.total, cy]]);
      if (ax && n > 3) {
        // Curved along the local axis, through the centre.
        const ux = ax.ux, uy = ax.uy;
        const flat = Math.abs(Math.atan2(uy, ux)) < 0.6;
        if (flat) {
          const bend = Math.max(-0.25, Math.min(0.25, ax.c * adv.total)) * adv.total * 0.5;
          const pts: Pt[] = [];
          for (let t = -1; t <= 1.0001; t += 0.1) {
            const u = t * adv.total;
            pts.push([cx + ux * u + uy * bend * t * t, cy + uy * u - ux * bend * t * t]);
          }
          paths.push(readable(pts));
        }
      }
      for (let pi = 0; pi < paths.length; pi++) {
        const lay = layoutOnPath(paths[pi], adv, sp, st.size);
        if (!lay) continue;
        let ok = true, minD = Infinity;
        for (const g of lay.glyphs) {
          if (g.ch.trim() === "") continue;
          const d = distWater(g.x, g.y);
          if (d < clear || isWater(g.x, g.y) === false) { ok = false; break; }
          minD = Math.min(minD, d);
        }
        if (!ok) continue;
        const cost = -Math.min(3, minD / (st.size * 2)) * 0.3 + (Math.hypot(cx - mx, cy - my) / diag) * 2 + (pi === 0 ? 0.15 : 0);
        cands.push({ layout: lay, cost });
      }
    }
    if (!cands.length && kind === "lake") {
      // Beside a small lake: a point label at the lake's centroid with the lake's radius.
      const rr = Math.sqrt(areaPx / Math.PI);
      const pc = pointCandidates(measure, mx, my, rr + 2 * k, name, st);
      for (const c of pc) {
        let wet = 0;
        for (const bx of c.layout.boxes) if (isWater((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2)) wet++;
        c.cost += wet * 0.8 + coverCost(c.layout, true);
        cands.push(c);
      }
      const st2 = { ...st, halo: pal.paper };
      place(id, "lake", name, st2, cands, ref);
      return;
    }
    const pl = place(id, kind === "ocean" ? "ocean" : kind === "sea" ? "sea" : kind === "bay" ? "bay" : "lake", name, st, cands, ref);
    if (pl && glossText) {
      // The English sense beneath, in small italics.
      const gst = S.oceanGloss(Math.max(9.5 * k, st.size * 0.5));
      const gadv = advances(measure, styleFont(gst), glossText, gst.spacing * gst.size);
      const gl = pl.glyphs;
      const mid = gl[Math.floor(gl.length / 2)];
      const gc: Candidate[] = [];
      for (const dy of [st.size * 0.95, -st.size * 0.95]) {
        const lay = layoutStraight(mid.x, mid.y + dy, gadv, gst.spacing * gst.size, gst.size);
        let ok = true;
        for (const g of lay.glyphs) if (g.ch.trim() && distWater(g.x, g.y) < gst.size * 0.6) { ok = false; break; }
        if (ok) gc.push({ layout: lay, cost: dy > 0 ? 0 : 0.5 });
      }
      place(`${id}:gloss`, "note", glossText, gst, gc, ref, 1 * k);
    }
  }
  let lakeFeatCache: Map<number, number> | null = null;

  // Oceans, then cities, seas, …
  for (const b of waterBodies) if (b.feat.kind === "ocean") placeWater(b);
  for (const m of shown) if (m.tier === "city") placeLabelFor(m);
  for (const b of waterBodies) if (b.feat.kind === "sea") placeWater(b);

  // ------------------------------------------------------------------ ranges & regions
  const regionFeats = world.features.filter((ft) =>
    ft.kind === "mountains" || ft.kind === "hills" || ft.kind === "desert" || ft.kind === "forest" || ft.kind === "jungle" ||
    ft.kind === "marsh" || ft.kind === "steppe" || ft.kind === "tundra" || ft.kind === "glacier" || ft.kind === "plain" || ft.kind === "peninsula");
  const featPts = (ft: GeoFeature): { xs: number[]; ys: number[] } => {
    const xs: number[] = [], ys: number[] = [];
    const xyz = world.mesh.xyz;
    for (const c of ft.cells) {
      if (!proj.inCap(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]) || !proj.forward(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2], OUT)) continue;
      if (!inRect(OUT.x, OUT.y, 4 * k)) continue;
      xs.push(OUT.x);
      ys.push(OUT.y);
    }
    return { xs, ys };
  };
  const pxPerCell = (world.mesh.meanSpacing * proj.R) / proj.kmPerPx;

  function placeRegion(ft: GeoFeature, minPts: number): void {
    const { xs, ys } = featPts(ft);
    if (xs.length < minPts) return;
    const nn = featureLabel(h, inp.ownerCell, ft, year);
    if (!nn) return;
    const ax = areaAxis(xs, ys);
    if (!ax) return;
    const isRange = ft.kind === "mountains" || ft.kind === "hills";
    const A = Math.max(ax.u1 - ax.u0, pxPerCell);
    const name = nn.name.roman;
    const n = Array.from(name).length;
    const base = isRange ? Math.min(16 * k, Math.max(10 * k, A / (n * 1.5))) : Math.min(14 * k, Math.max(9.5 * k, A / (n * 1.6)));
    const st0 = isRange ? S.range(base) : S.region(base);
    const text = displayText(name, st0);
    const cands: Candidate[] = [];
    let st = st0;
    for (const spEm of [isRange ? 0.5 : 0.45, 0.3, 0.15]) {
      st = { ...st0, spacing: spEm };
      const sp = spEm * st.size;
      const adv = advances(measure, styleFont(st), text, sp);
      if (adv.total > A * 1.25) continue;
      const half = Math.max(ax.half, pxPerCell * 0.5);
      for (const dvf of [0, 0.6, -0.6, 1.2, -1.2]) {
        const path = spinePath(ax, -0.4, 1.4, dvf * half, 40);
        const L = pathLength(path);
        for (const cf of [0.5, 0.4, 0.6]) {
          const lay = layoutOnPath(path, adv, sp, st.size, L * cf);
          if (!lay || lay.maxTurn > 0.35 || lay.maxTilt > 0.85) continue;
          let wet = 0;
          for (const g of lay.glyphs) if (g.ch.trim() && isWater(g.x, g.y)) wet++;
          if (wet > 0) continue;
          cands.push({ layout: lay, cost: Math.abs(dvf) * 0.6 + Math.abs(cf - 0.5) + coverCost(lay, true) + (spEm < 0.3 ? 0.3 : 0) });
        }
      }
      if (cands.length > 6) break;
    }
    place(`feature:${ft.id}`, isRange ? "range" : "region", name, st, cands, { type: "feature", id: ft.id });
  }

  const ranges = regionFeats.filter((ft) => ft.kind === "mountains").sort((a, b) => b.size - a.size || a.id - b.id);
  for (const ft of ranges) placeRegion(ft, 3);

  // ------------------------------------------------------------------ rivers
  const byFeature = new Map<number, RiverPath[]>();
  for (const r of inp.rivers) if (r.feature >= 0) {
    let a = byFeature.get(r.feature);
    if (!a) byFeature.set(r.feature, (a = []));
    a.push(r);
  }
  const riverFeats = [...byFeature.keys()].map((id) => world.features[id]).sort((a, b) => b.size - a.size || a.id - b.id);
  const placeRiver = (ft: GeoFeature): void => {
    const nn = featureLabel(h, inp.ownerCell, ft, year);
    if (!nn) return;
    const runs = byFeature.get(ft.id)!.slice().sort((a, b) => pathLength(b.pts) - pathLength(a.pts));
    const name = nn.name.roman;
    const flow = Math.max(...runs.map((r) => r.maxFlow));
    const st = S.river(Math.min(13 * k, Math.max(10 * k, (9.5 + Math.log2(1 + flow / 2000)) * k)));
    const sp = st.spacing * st.size;
    const adv = advances(measure, styleFont(st), name, sp);
    const cands: Candidate[] = [];
    for (const run of runs.slice(0, 2)) {
      const base = smoothPath(decimate({ pts: run.pts, closed: false }, 2 * k).pts, 3 * k, 6);
      const L = pathLength(base);
      if (L < adv.total * 1.25) continue;
      const wmax = Math.max(...run.width);
      for (const side of [1, -1]) {
        const off = side * (wmax / 2 + st.size * 0.62);
        const path = offsetPath(readable(base), off);
        const PL = pathLength(path);
        for (const cf of [0.55, 0.42, 0.68, 0.3, 0.8, 0.2]) {
          const lay = layoutOnPath(path, adv, sp, st.size, PL * cf);
          if (!lay || lay.maxTurn > 0.42 || lay.maxTilt > 1.25) continue;
          let wet = 0;
          for (const g of lay.glyphs) if (g.ch.trim() && isWater(g.x, g.y)) wet++;
          if (wet > 1) continue;
          cands.push({ layout: lay, cost: lay.maxTurn * 2.5 + Math.abs(cf - 0.55) * 0.8 + (side < 0 ? 0.25 : 0) + wet * 0.5 + coverCost(lay, false) * 0.5 });
        }
      }
    }
    place(`river:${ft.id}`, "river", name, st, cands, { type: "feature", id: ft.id }, 1.2 * k);
  };
  const majorRivers = riverFeats.filter((ft) => (byFeature.get(ft.id) ?? []).some((r) => r.maxFlow > 1500));
  for (const ft of majorRivers) placeRiver(ft);

  for (const b of waterBodies) if (b.feat.kind === "bay" || b.feat.kind === "lake") placeWater(b);
  for (const m of shown) if (m.tier === "town") placeLabelFor(m);

  // ------------------------------------------------------------------ islands
  const islands = world.features.filter((ft) => ft.kind === "island" || ft.kind === "archipelago").sort((a, b) => b.size - a.size || a.id - b.id);
  let nIslands = 0;
  for (const ft of islands) {
    if (nIslands >= 6 + 6 * zoom) break;
    const { xs, ys } = featPts(ft);
    if (!xs.length) continue;
    nIslands++;
    const nn = featureLabel(h, inp.ownerCell, ft, year);
    if (!nn) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]); }
    const span = Math.max(x1 - x0, y1 - y0) + pxPerCell;
    const st = S.island(Math.min(13 * k, Math.max(9.5 * k, span / 9)));
    const name = nn.name.roman;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const cands = pointCandidates(measure, cx, cy, Math.max(4 * k, span / 2), name, st);
    for (const c of cands) {
      let dry = 0;
      for (const bx of c.layout.boxes) if (!isWater((bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2)) dry++;
      c.cost += dry * 0.15;
    }
    if (span > 120 * k) placeRegion(ft, 3);
    else place(`feature:${ft.id}`, "island", name, st, cands, { type: "feature", id: ft.id });
  }

  // ------------------------------------------------------------------ other regions, minor rivers
  const others = regionFeats.filter((ft) => ft.kind !== "mountains").sort((a, b) => b.size - a.size || a.id - b.id);
  let nRegions = 0;
  const maxRegions = Math.round(6 + 4 * zoom);
  for (const ft of others) {
    if (nRegions >= maxRegions) break;
    const before = labels.length;
    placeRegion(ft, Math.round(9 / zoom));
    if (labels.length > before) nRegions++;
  }
  let nMinor = 0;
  if (zoom > 0.8) for (const ft of riverFeats) {
    if (majorRivers.includes(ft) || nMinor >= 4 + 6 * zoom) continue;
    const before = labels.length;
    placeRiver(ft);
    if (labels.length > before) nMinor++;
  }

  // ------------------------------------------------------------------ villages and ruins: icon only with a label
  const maxMinor = kmpp > 3.4 ? 0 : Math.round((area / (40000 * k * k)) * zoom);
  let nMinorPlaces = 0;
  for (const m of inp.places) {
    if (m.tier !== "village" && m.tier !== "ruin") continue;
    const greatRuin = m.tier === "ruin" && m.pop >= 20000;
    if (!greatRuin && nMinorPlaces >= maxMinor) continue;
    nMinorPlaces++;
    const b = iconBox(m);
    if (iconHits(b, 4 * k) || placer.labels.hits(b, 1 * k) || placer.hard.hits(b, 0)) continue;
    const pl = placeLabelFor(m);
    if (!pl) continue;
    iconIndex.push(b);
    placer.obstacle(b);
    shown.push(m);
  }

  // ------------------------------------------------------------------ battles
  const battles: BattleMark[] = [];
  const maxBattles = inp.focusWar ? 24 : Math.round(3 + 2 * zoom);
  for (const bm0 of inp.battles) {
    if (battles.length >= maxBattles) break;
    const r = 5 * k;
    // The swords sit at the site, or just beside the town they are named after.
    let bm: BattleMark | null = null;
    for (let t = 0; t < 9 && !bm; t++) {
      const a = (t - 1) * (Math.PI / 4) - Math.PI / 4;
      const d = t === 0 ? 0 : 12 * k;
      const x = bm0.x + Math.cos(a) * d, y = bm0.y + Math.sin(a) * d;
      const b: Box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
      if (iconHits(b, 1.5 * k) || placer.labels.hits(b, 1 * k) || placer.hard.hits(b, 0) || !inRect(x, y, 8 * k)) continue;
      bm = { ...bm0, x, y };
    }
    if (!bm) continue;
    const b: Box = { x0: bm.x - r, y0: bm.y - r, x1: bm.x + r, y1: bm.y + r };
    const text = `${bm.name}, ${bm.year}`;
    const st = S.battle(9.6 * k);
    const cands = pointCandidates(measure, bm.x, bm.y, r + 1 * k, text, st);
    const pl = place(`battle:${bm.id}`, "battle", text, st, cands, { type: "battle", id: bm.id }, 1 * k);
    if (!pl && !inp.focusWar) continue;
    iconIndex.push(b);
    placer.obstacle(b);
    battles.push(bm);
  }

  return { labels, shown, battles };
}
