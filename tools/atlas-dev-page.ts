/**
 * Atlas dev-harness page (bundled by tools/atlas-dev.ts): generates a world
 * (and a history: the real simulation if available, else a mock), then
 * renders several plates and reports timings in `window.__atlas`.
 */
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS, type PhysicalWorld } from "../src/world/types";
import type { History } from "../src/history/types";
import { renderAtlasPlate, type AtlasStyle, type AtlasView } from "../src/atlas/index";

interface PlateSpec {
  name: string;
  view: AtlasView;
  style: AtlasStyle;
  year: number;
  political: boolean;
  title?: string;
}

const q = new URLSearchParams(location.search || location.hash.slice(1));
const seed = q.get("seed") ?? "velmarra";
const cells = +(q.get("cells") ?? 40000);
const W = +(q.get("w") ?? 1600);
const H = +(q.get("h") ?? 1100);
const status = document.getElementById("status")!;
const host = document.getElementById("plates")!;
const out = { done: false, timings: [] as Record<string, number>[], specs: [] as PlateSpec[], error: "" };
(window as unknown as { __atlas: typeof out }).__atlas = out;

function deg(r: number): number {
  return (r * 180) / Math.PI;
}

function choosePlates(world: PhysicalWorld, history: History | null): PlateSpec[] {
  const specs: PlateSpec[] = [];
  const R = world.params.radiusKm;
  const conts = world.features.filter((f) => f.kind === "continent").sort((a, b) => b.size - a.size);
  const year = history ? Math.round(history.endYear * 0.6) : 0;
  const custom = q.get("view");
  if (custom) {
    const [lat, lon, r] = custom.split(",").map(Number);
    specs.push({ name: "custom", view: { centerLat: lat, centerLon: lon, radiusKm: r }, style: (q.get("style") as AtlasStyle) ?? "antique", year: +(q.get("year") ?? year), political: !!history });
    return specs;
  }
  const c0 = conts[0];
  if (c0) {
    const i = c0.anchor;
    const rad = Math.min(4200, Math.sqrt(c0.size / Math.PI) * 1.05);
    specs.push({ name: "continent", view: { centerLat: deg(world.mesh.lat[i]), centerLon: deg(world.mesh.lon[i]), radiusKm: rad }, style: "antique", year, political: false });
  }
  // Coastal close-up around the mouth of the largest river.
  const rivers = world.features.filter((f) => f.kind === "river").sort((a, b) => b.size - a.size);
  if (rivers[0]) {
    const i = rivers[0].anchor;
    specs.push({ name: "coast", view: { centerLat: deg(world.mesh.lat[i]), centerLon: deg(world.mesh.lon[i]), radiusKm: 520 }, style: "relief", year, political: false });
  }
  // A regional view on a mountain range.
  const ranges = world.features.filter((f) => f.kind === "mountains").sort((a, b) => b.size - a.size);
  if (ranges[0]) {
    const i = ranges[0].anchor;
    specs.push({ name: "range", view: { centerLat: deg(world.mesh.lat[i]), centerLon: deg(world.mesh.lon[i]), radiusKm: 1300 }, style: "antique", year, political: !!history });
  }
  void R;
  const only = q.get("plates");
  if (only) {
    const keep = new Set(only.split(",").map(Number));
    return specs.filter((_, k) => keep.has(k));
  }
  const st = q.get("style") as AtlasStyle | null;
  if (st) for (const s of specs) s.style = st;
  return specs;
}

async function main(): Promise<void> {
  try {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load('20px "IM Fell English"'),
      document.fonts.load('italic 20px "IM Fell English"'),
      document.fonts.load('20px "IM Fell English SC"'),
    ]).catch(() => undefined);
  } catch {
    /* fonts optional */
  }
  status.textContent = "generating world…";
  await new Promise((r) => setTimeout(r, 0));
  const tg = performance.now();
  const world = generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed));
  const genMs = performance.now() - tg;
  const history: History | null = null;
  status.textContent = `world ${seed}: ${cells} cells in ${genMs.toFixed(0)} ms`;
  const specs = choosePlates(world, history);
  out.specs = specs;
  for (let n = 0; n < specs.length; n++) {
    const s = specs[n];
    const canvas = document.createElement("canvas");
    canvas.className = "plate";
    canvas.id = `plate${n}`;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    host.appendChild(canvas);
    const cap = document.createElement("div");
    cap.className = "cap";
    host.appendChild(cap);
    await new Promise((r) => setTimeout(r, 0));
    const ctx = canvas.getContext("2d")!;
    const res = renderAtlasPlate(ctx, {
      world,
      history: s.political ? history : null,
      year: s.year,
      view: s.view,
      width: W,
      height: H,
      seed,
      style: s.style,
      title: s.title,
    });
    out.timings.push(res.timings);
    const tt = Object.entries(res.timings).map(([k, v]) => `${k} ${v}`).join(" · ");
    cap.textContent = `#${n} ${s.name} (${s.style}) ${s.view.centerLat.toFixed(1)},${s.view.centerLon.toFixed(1)} r=${s.view.radiusKm.toFixed(0)}km — ${tt}`;
    console.log(`plate ${n} ${s.name}: ${tt}`);
  }
  out.done = true;
}

main().catch((e) => {
  out.error = String(e && (e as Error).stack ? (e as Error).stack : e);
  console.error(out.error);
  status.textContent = "error: " + out.error;
  out.done = true;
});
