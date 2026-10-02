import { describe, it, expect } from "vitest";
import { makeFrame, project, unproject, clampView, slerpLatLon, toLatLonDeg, fromLatLonDeg, wrapDeg } from "../../src/render/globe/camera";
import { Rng } from "../../src/core/rng";

describe("globe camera", () => {
  it("unproject ∘ project is the identity on the visible hemisphere", () => {
    const rng = new Rng("cam");
    for (let t = 0; t < 50; t++) {
      const f = makeFrame({ lat: rng.range(-90, 90), lon: rng.range(-180, 180), zoom: rng.range(0.8, 12) }, "globe", 1280, 800);
      for (let i = 0; i < 20; i++) {
        const [x, y, z] = rng.unitVector();
        const pr = project(f, x, y, z, { x: 0, y: 0, depth: 0 });
        if (pr.depth <= 0.01) continue;
        const p = unproject(f, pr.x, pr.y)!;
        expect(p).not.toBeNull();
        expect(Math.hypot(p[0] - x, p[1] - y, p[2] - z)).toBeLessThan(1e-6);
      }
    }
  });

  it("puts the view centre at the screen centre, north up, east right", () => {
    const f = makeFrame({ lat: 30, lon: 40, zoom: 1 }, "globe", 1000, 600);
    const c = fromLatLonDeg(30, 40);
    const pc = project(f, c[0], c[1], c[2], { x: 0, y: 0, depth: 0 });
    expect(pc.x).toBeCloseTo(500, 6);
    expect(pc.y).toBeCloseTo(300, 6);
    const n = fromLatLonDeg(31, 40);
    expect(project(f, n[0], n[1], n[2], { x: 0, y: 0, depth: 0 }).y).toBeLessThan(300);
    const e = fromLatLonDeg(30, 41);
    expect(project(f, e[0], e[1], e[2], { x: 0, y: 0, depth: 0 }).x).toBeGreaterThan(500);
  });

  it("flat mode round-trips and wraps longitudes", () => {
    const f = makeFrame({ lat: 10, lon: 170, zoom: 2 }, "flat", 1280, 800);
    const p = fromLatLonDeg(12, -175); // across the antimeridian, just east of the centre
    const pr = project(f, p[0], p[1], p[2], { x: 0, y: 0, depth: 0 });
    expect(pr.x).toBeGreaterThan(640);
    const back = unproject(f, pr.x, pr.y)!;
    const [lat, lon] = toLatLonDeg(back);
    expect(lat).toBeCloseTo(12, 6);
    expect(wrapDeg(lon + 175)).toBeCloseTo(0, 6);
  });

  it("clamps zoom and latitude", () => {
    const v = clampView({ lat: 120, lon: 540, zoom: 100 }, "globe", 800, 600, 0.75, 14);
    expect(v.lat).toBe(90);
    expect(v.lon).toBe(-180);
    expect(v.zoom).toBe(14);
    const fl = clampView({ lat: 89, lon: 0, zoom: 1 }, "flat", 1280, 800, 0.75, 14);
    expect(fl.lat).toBeLessThan(89);
  });

  it("great-circle interpolation hits its endpoints", () => {
    const [a, b] = slerpLatLon(10, 20, -30, 150, 0);
    expect(a).toBeCloseTo(10, 6);
    expect(b).toBeCloseTo(20, 6);
    const [c, d] = slerpLatLon(10, 20, -30, 150, 1);
    expect(c).toBeCloseTo(-30, 6);
    expect(d).toBeCloseTo(150, 6);
  });
});
