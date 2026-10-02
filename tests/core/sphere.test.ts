import { describe, it, expect } from "vitest";
import { Rng } from "../../src/core/rng";
import { buildSphereMesh, CellLocator } from "../../src/core/sphere";

describe("sphere mesh", () => {
  const mesh = buildSphereMesh(4000, new Rng("test"));

  it("is a closed triangulation (Euler characteristic 2)", () => {
    const V = mesh.n;
    const F = mesh.numTris;
    const E = mesh.adj.length / 2;
    expect(V - E + F).toBe(2);
    for (let e = 0; e < mesh.halfedges.length; e++) expect(mesh.halfedges[mesh.halfedges[e]]).toBe(e);
  });

  it("has symmetric adjacency", () => {
    for (let i = 0; i < mesh.n; i += 7) {
      for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
        const j = mesh.adj[k];
        const nj = Array.from(mesh.adj.subarray(mesh.adjStart[j], mesh.adjStart[j + 1]));
        expect(nj).toContain(i);
      }
    }
  });

  it("cell areas sum to 4π", () => {
    let s = 0;
    for (let i = 0; i < mesh.n; i++) s += mesh.area[i];
    expect(Math.abs(s - 4 * Math.PI)).toBeLessThan(1e-2);
  });

  it("corners lie between consecutive neighbours", () => {
    for (let i = 0; i < mesh.n; i += 13) {
      const s = mesh.adjStart[i], e = mesh.adjStart[i + 1];
      for (let k = s; k < e; k++) {
        const t = mesh.cellTris[k];
        const tri = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
        expect(tri).toContain(i);
        expect(tri).toContain(mesh.adj[k]);
        expect(tri).toContain(mesh.adj[k + 1 < e ? k + 1 : s]);
      }
    }
  });

  it("locator finds the true nearest cell", () => {
    const loc = new CellLocator(mesh);
    const rng = new Rng("q");
    for (let q = 0; q < 300; q++) {
      const [x, y, z] = rng.unitVector();
      const found = loc.find(x, y, z);
      let best = -1, bd = -2;
      for (let i = 0; i < mesh.n; i++) {
        const d = mesh.xyz[3 * i] * x + mesh.xyz[3 * i + 1] * y + mesh.xyz[3 * i + 2] * z;
        if (d > bd) { bd = d; best = i; }
      }
      expect(found).toBe(best);
      const w = new Float64Array(3);
      const t = loc.locateTriangle(x, y, z, w);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(Math.abs(w[0] + w[1] + w[2] - 1)).toBeLessThan(1e-6);
    }
  });
});

describe("rng", () => {
  it("is deterministic and forkable", () => {
    const a = new Rng("seed");
    const b = new Rng("seed");
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
    const f1 = new Rng("seed").fork("x");
    const f2 = new Rng("seed").fork("x");
    expect(f1.next()).toBe(f2.next());
    expect(new Rng("seed").fork("y").next()).not.toBe(new Rng("seed").fork("x").next());
  });
});
