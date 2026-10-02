/**
 * Dev-harness page for the globe: generates + bakes in a worker, then shows
 * the globe with a fake political overlay, labels and markers.
 *
 * URL params: ?seed=…&cells=40000&w=4096&real=1&layer=political&mode=flat&zoom=…&lat=…&lon=…
 * Exposes `window.__globe` for scripted screenshots (see tools/shot.mjs --eval).
 */
import { Rng } from "../src/core/rng";
import { MinHeap } from "../src/core/heap";
import { GlobeView, type GlobeLabel, type GlobeLine, type GlobeMarker } from "../src/render/globe/GlobeView";
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
  /** [lat, lon] of an interesting place: "coast" | "river" | "mountain" | "border". */
  spot?(kind: string): [number, number];
  /** Highlight the realm at [lat, lon]. */
  highlightAt?(c: [number, number]): void;
  /** Show the demo polyline layer (trade routes, a war front). */
  showLines?(on: boolean): void;
  /** Highlight the drainage basin of the river through [lat, lon]. */
  highlightBasinAt?(c: [number, number]): void;
  /** Clear highlights / lines (used between scripted views). */
  reset?(): void;
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
    // Demo of a highlighted cell set: the drainage basin upstream of the picked land cell.
    const basin = upstreamBasin(world, cell);
    view.setHighlightCells(basin.length > 1 ? basin : null, { color: "#ffd98a" });
    void view.flyTo(lat, lon, Math.max(view.getView().zoom, 3));
  });
  // Overlay update cost (what timeline scrubbing pays per frame).
  const tu0 = performance.now();
  for (let i = 0; i < 20; i++) view.setOverlay(pol.overlay);
  const tu1 = performance.now();
  apply();
  const all = { ...timings, upload: t1 - t0, politics: t2 - t1, overlay: t3 - t2, overlayUpdate: (tu1 - tu0) / 20, total: performance.now() - tStart };
  const latLonOf = (c: number): [number, number] => [(world.mesh.lat[c] * 180) / Math.PI, (world.mesh.lon[c] * 180) / Math.PI];
  w.__globe = {
    view, ready: true, world, timings: all,
    setLayer: (l) => { layer = l; apply(); },
    spot: (kind) => latLonOf(findSpot(world, kind, pol.realmOf)),
    highlightAt: (c) => {
      const p = view.projectLatLon(c[0], c[1]);
      const hit = view.pickAt(p.x, p.y);
      if (hit && pol.realmOf[hit.cell] >= 0) view.setHighlight(pol.realmOf[hit.cell] + 1);
    },
    showLines: (on) => view.setLines(on ? pol.lines : null),
    highlightBasinAt: (c: [number, number]) => {
      const p = view.projectLatLon(c[0], c[1]);
      const hit = view.pickAt(p.x, p.y);
      if (hit) view.setHighlightCells(upstreamBasin(world, mouthOf(world, hit.cell)), { color: "#ffd98a" });
    },
    reset: () => { view.setHighlight(null); view.setLines(null); view.setHighlightCells(null); },
  };
  status.textContent = `${source} world · ${world.mesh.n} cells · ${baked.terrain.width}×${baked.terrain.height} · world ${timings.world.toFixed(0)} ms · bake ${timings.bake.toFixed(0)} ms`;
  console.log("timings", JSON.stringify(all));
  view.render();
}

/** Cells draining through `cell` (its upstream basin, including itself). */
function upstreamBasin(world: PhysicalWorld, cell: number): number[] {
  if (cell < 0 || !world.isLand[cell]) return [];
  const n = world.mesh.n;
  const up: number[][] = [];
  const head = new Int32Array(n).fill(-1), next = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const d = world.downstream[i];
    if (d >= 0) { next[i] = head[d]; head[d] = i; }
  }
  void up;
  const out = [cell];
  for (let k = 0; k < out.length; k++) for (let u = head[out[k]]; u >= 0; u = next[u]) out.push(u);
  return out;
}

/** Follow the drainage downstream to the last land cell (the river mouth). */
function mouthOf(world: PhysicalWorld, cell: number): number {
  let c = cell;
  for (let g = 0; g < world.mesh.n; g++) {
    const d = world.downstream[c];
    if (d < 0 || !world.isLand[d] || world.lakeId[d] >= 0) break;
    c = d;
  }
  return c;
}

/** A representative cell for scripted views. */
function findSpot(world: PhysicalWorld, kind: string, realmOf: Int32Array): number {
  const n = world.mesh.n;
  let best = 0, bestS = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!world.isLand[i] || world.lakeId[i] >= 0) continue;
    let s = -Infinity;
    const absLat = Math.abs(world.mesh.lat[i]);
    if (kind === "coast") s = world.coastDist[i] === 1 ? world.flow[i] : -Infinity;
    else if (kind === "river") s = world.coastDist[i] >= 3 && world.coastDist[i] <= 8 ? world.flow[i] * (absLat < 1.1 ? 1 : 0) : -Infinity;
    else if (kind === "mountain") s = world.elevation[i] * (absLat < 1.0 ? 1 : 0);
    else if (kind === "border") {
      const { adj, adjStart } = world.mesh;
      const seen = new Set<number>();
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (realmOf[j] >= 0) seen.add(realmOf[j]);
        for (let k2 = adjStart[j]; k2 < adjStart[j + 1]; k2++) if (realmOf[adj[k2]] >= 0) seen.add(realmOf[adj[k2]]);
      }
      s = seen.size * 10 - absLat * 3 - Math.abs(world.coastDist[i] - 4);
    }
    if (s > bestS) { bestS = s; best = i; }
  }
  return best;
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
  // Lines: trade routes between neighbouring capitals (dashed, flowing),
  // campaign arrows, and a sea route (dotted).
  const lines: GlobeLine[] = [];
  const caps = realms.filter((r) => r.cells.length >= 3).map((r) => r.seed);
  const dot = (a: number, b: number): number => xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2];
  const seen = new Set<string>();
  for (const a of caps) {
    const near = caps.filter((b) => b !== a).sort((b, c) => dot(a, c) - dot(a, b)).slice(0, 2);
    for (const b of near) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key) || dot(a, b) < Math.cos(0.5)) continue;
      seen.add(key);
      // A gently bowed route through a midpoint pushed sideways.
      const m = [xyz[3 * a] + xyz[3 * b], xyz[3 * a + 1] + xyz[3 * b + 1], xyz[3 * a + 2] + xyz[3 * b + 2]];
      const side = [xyz[3 * a + 1] * xyz[3 * b + 2] - xyz[3 * a + 2] * xyz[3 * b + 1], xyz[3 * a + 2] * xyz[3 * b] - xyz[3 * a] * xyz[3 * b + 2], xyz[3 * a] * xyz[3 * b + 1] - xyz[3 * a + 1] * xyz[3 * b]];
      const k = (rng.next() - 0.5) * 0.5;
      const mid: [number, number, number] = [m[0] / 2 + side[0] * k, m[1] / 2 + side[1] * k, m[2] / 2 + side[2] * k];
      lines.push({ points: [pos(a), mid, pos(b)], smooth: true, style: "dashed", width: 1.6, color: "#f3e3b8", flow: 14 });
    }
  }
  for (let t = 0; t < 3 && caps.length > 3; t++) {
    const a = caps[t * 2], b = caps.filter((c) => c !== a).sort((x, y) => dot(a, y) - dot(a, x))[0];
    const m: [number, number, number] = [xyz[3 * a] + xyz[3 * b] + 0.06 * (rng.next() - 0.5), xyz[3 * a + 1] + xyz[3 * b + 1], xyz[3 * a + 2] + xyz[3 * b + 2] + 0.06];
    lines.push({ points: [pos(a), m, pos(b)], smooth: true, width: 3, color: "#c8402c", arrow: true, casing: 1.2 });
  }
  if (seaSeeds.length >= 3) {
    lines.push({ points: [pos(seaSeeds[0]), pos(seaSeeds[1]), pos(seaSeeds[2])], smooth: true, style: "dotted", width: 2.4, color: "#bfe0ff", casing: 0.8 });
  }
  return {
    overlay: { colors, groups, borderWidth: 1.3 },
    labels, markers, realms, realmOf, lines,
  };
}
