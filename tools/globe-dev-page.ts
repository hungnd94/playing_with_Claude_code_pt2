/**
 * Dev-harness page for the globe: generates + bakes in a worker, then shows
 * the globe with a fake political overlay, labels and markers.
 *
 * URL params: ?seed=…&cells=40000&w=4096&real=1&layer=political&mode=flat&zoom=…&lat=…&lon=…
 * Exposes `window.__globe` for scripted screenshots (see tools/shot.mjs --eval).
 */
import { Rng } from "../src/core/rng";
import { MinHeap } from "../src/core/heap";
import { GlobeView, type GlobeLabel, type GlobeMarker } from "../src/render/globe/GlobeView";
import type { BakedGlobe } from "../src/render/bake/index";
import { BIOME_NAMES, type PhysicalWorld } from "../src/world/types";

const params = new URLSearchParams(location.search);
const seed = params.get("seed") ?? "mock";
const cells = +(params.get("cells") ?? 40000);
const width = +(params.get("w") ?? 4096);
const real = params.get("real") === "1";

const status = document.getElementById("status")!;
const canvas = document.getElementById("globe") as HTMLCanvasElement;
const info = document.getElementById("info")!;

interface Handle {
  view: GlobeView;
  ready: boolean;
  world?: PhysicalWorld;
  setLayer(l: "terrain" | "political"): void;
  timings?: Record<string, number>;
}
const w = window as unknown as { __globe: Handle };

const view = new GlobeView(canvas, {
  autoRotate: params.get("rotate") === "1",
  view: {
    lat: +(params.get("lat") ?? 22),
    lon: +(params.get("lon") ?? 10),
    zoom: +(params.get("zoom") ?? 1),
  },
  mode: params.get("mode") === "flat" ? "flat" : "globe",
});
w.__globe = { view, ready: false, setLayer: () => {} };

const workerUrl = URL.createObjectURL(new Blob([__GLOBE_WORKER__], { type: "text/javascript" }));
const worker = new Worker(workerUrl);
const tStart = performance.now();
status.textContent = "generating world…";
worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "progress") status.textContent = `${m.stage}…`;
  else if (m.type === "log") console.log("[worker]", m.msg);
  else if (m.type === "done") onWorld(m.world as PhysicalWorld, m.baked as BakedGlobe, m.source, m.timings);
};
worker.postMessage({ seed, cells, width, real });

function onWorld(world: PhysicalWorld, baked: BakedGlobe, source: string, timings: Record<string, number>): void {
  const t0 = performance.now();
  view.setBaked(baked);
  view.setWorld(world);
  const t1 = performance.now();
  const rng = new Rng(seed).fork("dev-politics");
  const pol = fakePolitics(world, rng, 22);
  const t2 = performance.now();
  view.setOverlay(pol.overlay);
  const t3 = performance.now();
  view.setMarkers(pol.markers);
  view.setLabels(pol.labels);
  let layer = params.get("layer") === "terrain" ? "terrain" : "political";
  const apply = (): void => {
    if (layer === "political") view.setOverlay(pol.overlay);
    else view.setOverlay(null);
    view.setLabels(layer === "political" ? pol.labels : pol.labels.filter((l) => l.style !== "region"));
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-layer]")) b.classList.toggle("on", b.dataset.layer === layer);
  };
  apply();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-layer]")) {
    b.onclick = () => { layer = b.dataset.layer!; apply(); };
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    b.onclick = () => {
      view.setMode(b.dataset.mode as "globe" | "flat");
      for (const o of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) o.classList.toggle("on", o === b);
    };
    b.classList.toggle("on", b.dataset.mode === view.getMode());
  }
  document.getElementById("spin")!.onclick = () => view.setAutoRotate(4);
  view.onHover((cell, lat, lon) => {
    view.setHighlight(layer === "political" && cell >= 0 && pol.realmOf[cell] >= 0 ? pol.realmOf[cell] + 1 : null);
    if (cell < 0) { info.textContent = ""; return; }
    const r = pol.realmOf[cell];
    info.textContent = `cell ${cell} · ${lat.toFixed(1)}°, ${lon.toFixed(1)}° · ${BIOME_NAMES[world.biome[cell]]} · ${world.elevation[cell].toFixed(2)} km · ${world.temperature[cell].toFixed(0)} °C${r >= 0 ? " · " + pol.realms[r].name : ""}`;
  });
  view.onPick((cell, lat, lon) => {
    console.log("pick", cell, lat.toFixed(2), lon.toFixed(2));
    void view.flyTo(lat, lon, Math.max(view.getView().zoom, 3));
  });
  // Overlay update cost (what timeline scrubbing pays per frame).
  const tu0 = performance.now();
  for (let i = 0; i < 20; i++) view.setOverlay(pol.overlay);
  const tu1 = performance.now();
  apply();
  const all = { ...timings, upload: t1 - t0, politics: t2 - t1, overlay: t3 - t2, overlayUpdate: (tu1 - tu0) / 20, total: performance.now() - tStart };
  w.__globe = { view, ready: true, world, setLayer: (l) => { layer = l; apply(); }, timings: all };
  status.textContent = `${source} world · ${world.mesh.n} cells · ${baked.terrain.width}×${baked.terrain.height} · world ${timings.world.toFixed(0)} ms · bake ${timings.bake.toFixed(0)} ms`;
  console.log("timings", JSON.stringify(all));
  view.render();
}

// ---------------------------------------------------------------------------
// Fake politics: ~20 realms grown over land by a terrain-aware Dijkstra.

const PALETTE = [
  "#d98c7a", "#e2b85c", "#9fb874", "#7fa8c9", "#b494c4", "#e09a62", "#7fbfb0", "#c9a47e",
  "#a6b96a", "#d68fa0", "#9b9fd4", "#e7c48a", "#86b98f", "#c97f6c", "#8eb0a6", "#d6a6c4",
  "#b8a35d", "#7f9fb8", "#cc9b6d", "#9fc0d6", "#c4ad91", "#a48cb0",
];

function syllableName(rng: Rng): string {
  const on = ["k", "t", "v", "s", "m", "n", "r", "l", "d", "g", "th", "sh", "b", "z", "kh", "h"];
  const nu = ["a", "e", "i", "o", "u", "ae", "ia", "ou", "ei"];
  const co = ["", "", "n", "r", "s", "l", "th", "m", "sk", "nd"];
  const n = rng.int(2, 3);
  let s = "";
  for (let i = 0; i < n; i++) s += rng.pick(on) + rng.pick(nu) + (i === n - 1 ? rng.pick(co) : "");
  return s[0].toUpperCase() + s.slice(1);
}

function fakePolitics(world: PhysicalWorld, rng: Rng, k: number) {
  const mesh = world.mesh;
  const n = mesh.n;
  const { xyz, adj, adjStart } = mesh;
  const wet = (i: number): boolean => !world.isLand[i] || world.lakeId[i] >= 0;
  const landCells: number[] = [];
  for (let i = 0; i < n; i++) if (!wet(i) && world.biome[i] !== 5) landCells.push(i);
  // Spread-out seeds: best of several random candidates (farthest from existing seeds).
  const seeds: number[] = [];
  for (let s = 0; s < k && landCells.length; s++) {
    let best = -1, bestD = -1;
    for (let t = 0; t < 30; t++) {
      const c = rng.pick(landCells);
      let d = 4;
      for (const o of seeds) {
        const dd = Math.acos(Math.max(-1, Math.min(1, xyz[3 * c] * xyz[3 * o] + xyz[3 * c + 1] * xyz[3 * o + 1] + xyz[3 * c + 2] * xyz[3 * o + 2])));
        d = Math.min(d, dd);
      }
      const fert = world.fertility[c] || 0.5;
      const score = d * (0.6 + fert);
      if (score > bestD) { bestD = score; best = c; }
    }
    seeds.push(best);
  }
  const realmOf = new Int32Array(n).fill(-1);
  const cost = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(n);
  seeds.forEach((s, r) => { cost[s] = 0; realmOf[s] = r; heap.push(0, s); });
  const reach = seeds.map(() => 0.3 + rng.next() * 0.45);
  while (heap.size) {
    const c = heap.pop();
    const cc = heap.lastKey;
    if (cc > cost[c]) continue;
    for (let q = adjStart[c]; q < adjStart[c + 1]; q++) {
      const u = adj[q];
      if (wet(u)) continue;
      const d = Math.acos(Math.max(-1, Math.min(1, xyz[3 * c] * xyz[3 * u] + xyz[3 * c + 1] * xyz[3 * u + 1] + xyz[3 * c + 2] * xyz[3 * u + 2])));
      const climb = Math.max(0, world.elevation[u] - world.elevation[c]);
      const rough = 1 + 0.8 * Math.max(0, world.elevation[u] - 1.5) + 2.5 * climb + (world.riverOrder[u] >= 3 ? 0.6 : 0);
      const nc = cc + d * rough;
      if (nc < cost[u] && nc < reach[realmOf[c]]) {
        cost[u] = nc;
        realmOf[u] = realmOf[c];
        heap.push(nc, u);
      }
    }
  }
  // Colour realms so neighbours differ.
  const realmAdj = seeds.map(() => new Set<number>());
  for (let i = 0; i < n; i++) {
    const r = realmOf[i];
    if (r < 0) continue;
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const o = realmOf[adj[q]];
      if (o >= 0 && o !== r) realmAdj[r].add(o);
    }
  }
  const colorIdx = seeds.map(() => -1);
  const order = rng.shuffle(PALETTE.map((_, i) => i));
  seeds.forEach((_, r) => {
    const used = new Set([...realmAdj[r]].map((o) => colorIdx[o]));
    colorIdx[r] = order.find((c) => !used.has(c) && !colorIdx.includes(c)) ?? order.find((c) => !used.has(c)) ?? 0;
  });
  const realms = seeds.map((s, r) => ({ seed: s, name: syllableName(rng), color: PALETTE[colorIdx[r]], cells: [] as number[] }));
  for (let i = 0; i < n; i++) if (realmOf[i] >= 0) realms[realmOf[i]].cells.push(i);

  const colors = new Uint8Array(4 * n);
  const groups = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const r = realmOf[i];
    if (r < 0) continue;
    const hex = parseInt(realms[r].color.slice(1), 16);
    colors[4 * i] = (hex >> 16) & 255;
    colors[4 * i + 1] = (hex >> 8) & 255;
    colors[4 * i + 2] = hex & 255;
    colors[4 * i + 3] = 255;
    groups[i] = r + 1;
  }

  // Labels & markers.
  const labels: GlobeLabel[] = [];
  const markers: GlobeMarker[] = [];
  const pos = (c: number): [number, number, number] => [xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]];
  // Interior depth (hops from the realm border) to place region names centrally.
  const depth = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (realmOf[i] < 0) continue;
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) if (realmOf[adj[q]] !== realmOf[i]) { depth[i] = 0; frontier.push(i); break; }
  }
  for (let d = 1; frontier.length; d++) {
    const next: number[] = [];
    for (const c of frontier) for (let q = adjStart[c]; q < adjStart[c + 1]; q++) {
      const u = adj[q];
      if (realmOf[u] === realmOf[c] && depth[u] < 0) { depth[u] = d; next.push(u); }
    }
    frontier = next;
  }
  for (const [r, realm] of realms.entries()) {
    if (realm.cells.length < 3) continue;
    let center = realm.cells[0];
    for (const c of realm.cells) if (depth[c] > depth[center]) center = c;
    labels.push({ xyz: pos(center), text: realm.name, priority: 50 + Math.sqrt(realm.cells.length), style: "region", size: Math.min(1.5, 0.75 + Math.sqrt(realm.cells.length) / 40) });
    markers.push({ xyz: pos(realm.seed), size: 10, shape: "star", color: "#fff3c4" });
    labels.push({ xyz: pos(realm.seed), text: syllableName(rng), priority: 80, style: "capital" });
    const nCities = Math.min(5, Math.floor(realm.cells.length / 40));
    for (let t = 0; t < nCities; t++) {
      const c = rng.pick(realm.cells);
      if (depth[c] < 1) continue;
      markers.push({ xyz: pos(c), size: 6, shape: "circle", color: "#f6efe0" });
      labels.push({ xyz: pos(c), text: syllableName(rng), priority: 20 + rng.next() * 10, style: "city" });
    }
    void r;
  }
  // Seas: deep-water cells far from land, spread out.
  const ocean: number[] = [];
  for (let i = 0; i < n; i++) if (!world.isLand[i] && world.coastDist[i] <= -5) ocean.push(i);
  const seaSeeds: number[] = [];
  for (let s = 0; s < 9 && ocean.length; s++) {
    let best = ocean[0], bestD = -1;
    for (let t = 0; t < 60; t++) {
      const c = rng.pick(ocean);
      let d = 4;
      for (const o of seaSeeds) d = Math.min(d, Math.acos(Math.max(-1, Math.min(1, xyz[3 * c] * xyz[3 * o] + xyz[3 * c + 1] * xyz[3 * o + 1] + xyz[3 * c + 2] * xyz[3 * o + 2]))));
      if (d > bestD) { bestD = d; best = c; }
    }
    seaSeeds.push(best);
    labels.push({ xyz: pos(best), text: `${rng.pick(["Sea of", "Gulf of", "The", "Bay of"])} ${syllableName(rng)}`.replace(/^The (.*)$/, "The $1 Ocean"), priority: 40, style: "sea" });
  }
  // Mountains: highest cells, spread out.
  const high = landCells.filter((c) => world.elevation[c] > 2.2).sort((a, b) => world.elevation[b] - world.elevation[a]);
  const peaks: number[] = [];
  for (const c of high) {
    if (peaks.length >= 10) break;
    if (peaks.some((o) => xyz[3 * c] * xyz[3 * o] + xyz[3 * c + 1] * xyz[3 * o + 1] + xyz[3 * c + 2] * xyz[3 * o + 2] > Math.cos(0.25))) continue;
    peaks.push(c);
    markers.push({ xyz: pos(c), size: 7, shape: "triangle", color: "#e8dcc8" });
    labels.push({ xyz: pos(c), text: `Mt. ${syllableName(rng)}`, priority: 30, style: "feature", minZoom: 1.5 });
  }
  return {
    overlay: { colors, groups, borderWidth: 1.3 },
    labels, markers, realms, realmOf,
  };
}
