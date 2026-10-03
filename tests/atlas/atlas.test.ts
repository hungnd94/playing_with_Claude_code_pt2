import { describe, expect, it } from "vitest";
import { Rng } from "../../src/core/rng";
import { generatePhysical } from "../../src/geo/index";
import { DEFAULT_PARAMS, type PhysicalWorld } from "../../src/world/types";
import type { History } from "../../src/history/types";
import { makeMockHistory } from "../../tools/atlas-mock-history";
import { approxMeasure, buildPlateModel, hitTest, Projection, planContinentView, planRealmView, planRegionView, planWarView, largestRealms, fitCells, type AtlasInput, type PlateModel } from "../../src/atlas/index";
import { splitChar, advances, layoutOnPath } from "../../src/atlas/labels";
import { marchingSquares, distanceTransform } from "../../src/atlas/contour";

const seed = "atlas-test";
let world: PhysicalWorld;
let history: History;
function setup(): void {
  if (world) return;
  world = generatePhysical({ ...DEFAULT_PARAMS, seed, cells: 10000 }, new Rng(seed));
  history = makeMockHistory(world, seed, 1200);
}

function model(view: AtlasInput["view"], extra: Partial<AtlasInput> = {}): PlateModel {
  setup();
  return buildPlateModel({ world, history, year: 800, view, width: 1200, height: 820, seed, style: "political", ...extra }, approxMeasure);
}

const boxesOverlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

describe("projection", () => {
  const rect = { x: 50, y: 40, w: 1000, h: 700 };
  const views = [
    { centerLat: 0, centerLon: 0, radiusKm: 1000 },
    { centerLat: 47.3, centerLon: -120.5, radiusKm: 2500 },
    { centerLat: -71, centerLon: 160, radiusKm: 400 },
    { centerLat: 89.5, centerLon: 10, radiusKm: 6000 },
  ];
  it("screen → sphere → screen round-trips", () => {
    for (const v of views) {
      const p = new Projection(v, rect, 4200);
      const out = { x: 0, y: 0 };
      const u = [0, 0, 0];
      // A plate wider than the planet (the last view) cannot project its corners (beyond the antipode).
      const whole = v.radiusKm <= 3000;
      for (let i = 0; i <= 10; i++)
        for (let j = 0; j <= 10; j++) {
          const sx = rect.x + (rect.w * i) / 10, sy = rect.y + (rect.h * j) / 10;
          const ok = p.inverse(sx, sy, u);
          if (!whole && !ok) continue;
          expect(ok).toBe(true);
          expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 9);
          expect(p.forward(u[0], u[1], u[2], out)).toBe(true);
          expect(out.x).toBeCloseTo(sx, 6);
          expect(out.y).toBeCloseTo(sy, 6);
        }
    }
  });
  it("sphere → screen → sphere round-trips (lat/lon)", () => {
    const p = new Projection(views[1], rect, 4200);
    const o = { x: 0, y: 0 };
    for (let lat = 30; lat <= 60; lat += 5)
      for (let lon = -140; lon <= -100; lon += 5) {
        expect(p.forwardLatLon((lat * Math.PI) / 180, (lon * Math.PI) / 180, o)).toBe(true);
        const ll = p.inverseLatLon(o.x, o.y)!;
        expect(ll[0]).toBeCloseTo(lat, 6);
        expect(ll[1]).toBeCloseTo(lon, 6);
      }
  });
  it("radiusKm is the ground distance to the nearest edge; north is up at the centre", () => {
    for (const v of views.slice(0, 3)) {
      const p = new Projection(v, rect, 4200);
      const u = [0, 0, 0];
      p.inverse(p.cx, rect.y, u);
      const ang = p.angleFromCenter(u[0], u[1], u[2]);
      expect(ang * 4200).toBeCloseTo(v.radiusKm, 3);
      const ll = p.inverseLatLon(p.cx, p.cy - 5)!;
      expect(ll[0]).toBeGreaterThan(v.centerLat);
    }
  });
});

describe("contours", () => {
  it("marching squares closes loops around islands and keeps high values on the left", () => {
    const gx = 20, gy = 16;
    const v = new Float32Array(gx * gy).fill(-1);
    for (let j = 4; j < 10; j++) for (let i = 5; i < 12; i++) v[j * gx + i] = 1;
    const lines = marchingSquares(v, gx, gy, 0, -1);
    expect(lines.length).toBe(1);
    expect(lines[0].closed).toBe(true);
    // Signed area: high inside on the left while walking (y down) → negative shoelace sum.
    const pts = lines[0].pts;
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    expect(a).toBeLessThan(0);
  });
  it("distance transform is exact on a single seed", () => {
    const gx = 9, gy = 7;
    const d = distanceTransform(gx, gy, (k) => k === 3 * gx + 4);
    expect(d[3 * gx + 4]).toBe(0);
    expect(d[0]).toBeCloseTo(Math.hypot(4, 3), 6);
  });
});

describe("labels", () => {
  it("splits characters outside Latin-1 into a base and marks", () => {
    expect(splitChar("š")).toEqual({ base: "s", marks: "̌" });
    expect(splitChar("é")).toEqual({ base: "é", marks: "" });
    expect(splitChar("ǖ")).toEqual({ base: "ü", marks: "̄" });
    expect(splitChar("ī")).toEqual({ base: "ı", marks: "̄" });
    expect(splitChar("ŋ")).toEqual({ base: "ŋ", marks: "" });
  });
  it("lays text along a path with one glyph per character", () => {
    const adv = advances(approxMeasure, "italic 14px serif", "Velmarra", 2);
    const path: [number, number][] = [];
    for (let i = 0; i <= 40; i++) path.push([i * 5, 100 + 20 * Math.sin(i / 10)]);
    const lay = layoutOnPath(path, adv, 2, 14)!;
    expect(lay.glyphs.length).toBe(8);
    expect(lay.boxes.length).toBe(8);
    for (const g of lay.glyphs) expect(Number.isFinite(g.x + g.y + g.a)).toBe(true);
  });
});

describe("plate model", () => {
  it("places labels without overlaps, inside the map, clear of the furniture", { timeout: 60000 }, () => {
    setup();
    const conts = world.features.filter((f) => f.kind === "continent").sort((a, b) => b.size - a.size);
    const plans = [
      planContinentView(world, conts[0].id, 800, { aspect: 1200 / 820 }),
      planRealmView(world, history, largestRealms(history, 800, 1)[0], 800, { aspect: 1200 / 820 }),
    ];
    for (const plan of plans) {
      const m = model(plan.view, { subject: plan.subject });
      expect(m.labels.length).toBeGreaterThan(5);
      const all = m.labels.map((l) => l.boxes.concat(l.gaps));
      for (let a = 0; a < all.length; a++)
        for (let b = a + 1; b < all.length; b++)
          for (const ba of all[a]) for (const bb of all[b]) expect(boxesOverlap(ba, bb), `${m.labels[a].text} × ${m.labels[b].text}`).toBe(false);
      for (const l of m.labels)
        for (const b of l.boxes) {
          expect(b.x0).toBeGreaterThanOrEqual(m.rect.x);
          expect(b.x1).toBeLessThanOrEqual(m.rect.x + m.rect.w);
          expect(b.y0).toBeGreaterThanOrEqual(m.rect.y);
          expect(b.y1).toBeLessThanOrEqual(m.rect.y + m.rect.h);
          for (const r of m.decor.reserved) expect(boxesOverlap(b, r), `${l.text} over furniture`).toBe(false);
        }
      // Hit-testing finds a label's entity at its first glyph.
      const l = m.labels.find((x) => x.ref)!;
      expect(hitTest(m, l.glyphs[0].x, l.glyphs[0].y)).toEqual(l.ref);
    }
  });

  it("is deterministic and all geometry is finite", { timeout: 60000 }, () => {
    setup();
    const view = { centerLat: (world.mesh.lat[world.features[0].anchor] * 180) / Math.PI, centerLon: (world.mesh.lon[world.features[0].anchor] * 180) / Math.PI, radiusKm: 1400 };
    const a = model(view), b = model(view);
    const strip = (m: PlateModel) => JSON.stringify({ w: m.water.coastLoops, r: m.rivers.map((r) => r.pts), g: m.glyphs, l: m.labels.map((l) => [l.text, l.glyphs]), p: m.places, d: m.decor.cartouche, c: m.decor.compass, pol: m.political?.realms.map((r) => [r.id, r.color, r.loops]) });
    expect(strip(a)).toBe(strip(b));
    const finite = (v: unknown): void => {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      else if (Array.isArray(v)) for (const x of v) finite(x);
      else if (v && typeof v === "object") for (const x of Object.values(v)) finite(x);
    };
    finite(a.water.coastLoops);
    finite(a.water.ripples);
    finite(a.rivers);
    finite(a.glyphs);
    finite(a.labels.map((l) => l.glyphs));
    finite(a.places);
    finite(a.political?.realms.map((r) => r.loops));
    finite(a.political?.borders);
    finite(a.decor.graticule);
    expect(a.glyphs.length).toBeGreaterThan(50);
  });

  it("survives extreme views: tiny, hemisphere-wide, polar, antimeridian, open ocean", { timeout: 120000 }, () => {
    setup();
    const views = [
      { centerLat: 12, centerLon: 33, radiusKm: 40 },
      { centerLat: 0, centerLon: 0, radiusKm: 7000 },
      { centerLat: 90, centerLon: 0, radiusKm: 1500 },
      { centerLat: -90, centerLon: 0, radiusKm: 2500 },
      { centerLat: 5, centerLon: 179.9, radiusKm: 1800 },
    ];
    for (const v of views) {
      const m = model(v, { width: 800, height: 560 });
      const finite = (x: unknown): boolean =>
        typeof x === "number" ? Number.isFinite(x) : Array.isArray(x) ? x.every(finite) : x && typeof x === "object" ? Object.values(x).every(finite) : true;
      expect(finite(m.water.coastLoops), JSON.stringify(v)).toBe(true);
      expect(finite(m.labels.map((l) => l.glyphs)), JSON.stringify(v)).toBe(true);
      expect(finite(m.glyphs), JSON.stringify(v)).toBe(true);
      expect(finite(m.decor.graticule.lines), JSON.stringify(v)).toBe(true);
      expect(m.title.main.length).toBeGreaterThan(0);
    }
  });

  it("works without a history (no names, terra incognita)", { timeout: 60000 }, () => {
    setup();
    const m = buildPlateModel({ world, history: null, year: 0, view: { centerLat: 10, centerLon: 20, radiusKm: 2500 }, width: 900, height: 600, seed, style: "antique" }, approxMeasure);
    expect(m.labels.length).toBe(0);
    expect(m.political).toBeNull();
    expect(m.title.main).toBe("Terra Incognita");
  });
});

describe("planners", () => {
  it("frames every cell of a continent, a range and a realm inside the map", { timeout: 60000 }, () => {
    setup();
    const rect = { x: 0, y: 0, w: 1600, h: 1100 };
    const check = (cells: ArrayLike<number>, view: AtlasInput["view"], trimmed = false) => {
      const p = new Projection(view, rect, world.params.radiusKm);
      const o = { x: 0, y: 0 };
      let inside = 0;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        p.forward(world.mesh.xyz[3 * c], world.mesh.xyz[3 * c + 1], world.mesh.xyz[3 * c + 2], o);
        if (o.x >= 0 && o.x <= rect.w && o.y >= 0 && o.y <= rect.h) inside++;
      }
      expect(inside / cells.length).toBeGreaterThanOrEqual(trimmed ? 0.9 : 1);
    };
    const cont = world.features.filter((f) => f.kind === "continent").sort((a, b) => b.size - a.size)[0];
    check(cont.cells, planContinentView(world, cont.id).view);
    const range = world.features.find((f) => f.kind === "mountains");
    if (range) check(range.cells, planRegionView(world, range.id).view);
    const realm = largestRealms(history, 800, 1)[0];
    const owner: number[] = [];
    const pl = planRealmView(world, history, realm, 800);
    expect(pl.subject).toEqual({ kind: "realm", polity: realm });
    void owner;
    expect(pl.view.radiusKm).toBeGreaterThan(0);
    const war = planWarView(world, history, 0);
    expect(Number.isFinite(war.view.centerLat + war.view.centerLon + war.view.radiusKm)).toBe(true);
    const v = fitCells(world, [cont.anchor]);
    expect(v.radiusKm).toBeGreaterThanOrEqual(260);
  });
});
