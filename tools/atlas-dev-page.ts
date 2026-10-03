/**
 * Atlas dev-harness page (bundled by tools/atlas-dev.ts): generates a world
 * and a history (the real simulation when it produces realms, else the mock in
 * tools/atlas-mock-history.ts), then renders several plates and reports
 * timings in `window.__atlas`.
 *
 * Query params: seed, cells, w, h, plates=0,2 (indices), style=…, year=…,
 *   history=auto|real|mock|none, view=lat,lon,radiusKm (single custom plate),
 *   dpr (canvas pixel ratio).
 */
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS, type PhysicalWorld } from "../src/world/types";
import type { History } from "../src/history/types";
import { simulateHistory } from "virtual:history";
import { makeMockHistory } from "./atlas-mock-history";
import {
  renderAtlasPlate, planContinentView, planRealmView, planRegionView, planWarView, planPointView, largestRealms,
  type AtlasStyle, type PlannedView,
} from "../src/atlas/index";

interface PlateSpec {
  name: string;
  plan: PlannedView;
  style: AtlasStyle;
  history: boolean;
  title?: string;
}

const q = new URLSearchParams(location.search || location.hash.slice(1));
const seed = q.get("seed") ?? "velmarra";
const cells = +(q.get("cells") ?? 40000);
const W = +(q.get("w") ?? 1600);
const H = +(q.get("h") ?? 1100);
const DPR = +(q.get("dpr") ?? 1);
const histMode = q.get("history") ?? "auto";
const status = document.getElementById("status")!;
const host = document.getElementById("plates")!;
const out = { done: false, timings: [] as Record<string, number>[], specs: [] as { name: string; style: string }[], error: "", history: "", labels: [] as number[] };
(window as unknown as { __atlas: typeof out }).__atlas = out;

function choosePlates(world: PhysicalWorld, history: History | null): PlateSpec[] {
  const specs: PlateSpec[] = [];
  const aspect = W / H;
  const year = +(q.get("year") ?? (history ? Math.round(history.endYear * 0.6) : 0));
  const custom = q.get("view");
  if (custom) {
    const [lat, lon, r] = custom.split(",").map(Number);
    specs.push({ name: "custom", plan: planPointView(lat, lon, r, year), style: (q.get("style") as AtlasStyle) ?? "antique", history: !!history });
    return specs;
  }
  const conts = world.features.filter((f) => f.kind === "continent").sort((a, b) => b.size - a.size);
  if (conts[0]) specs.push({ name: "continent", plan: planContinentView(world, conts[0].id, year, { aspect }), style: "antique", history: !!history });
  if (history) {
    const big = largestRealms(history, year, 3);
    if (big[0] !== undefined) specs.push({ name: "realm", plan: planRealmView(world, history, big[0], year, { aspect }), style: "political", history: true });
  }
  const rivers = world.features.filter((f) => f.kind === "river").sort((a, b) => b.size - a.size);
  if (rivers[0]) {
    const p = planRegionView(world, rivers[0].id, year, { aspect });
    p.view.radiusKm = Math.min(p.view.radiusKm, 900);
    specs.push({ name: "river", plan: p, style: "relief", history: !!history });
  }
  const ranges = world.features.filter((f) => f.kind === "mountains").sort((a, b) => b.size - a.size);
  if (ranges[0]) specs.push({ name: "range", plan: planRegionView(world, ranges[0].id, year, { aspect }), style: "antique", history: !!history });
  if (history && history.wars.length) {
    const wars = history.wars.slice().sort((a, b) => b.battles.length - a.battles.length || a.id - b.id);
    specs.push({ name: "war", plan: planWarView(world, history, wars[0].id, undefined, { aspect }), style: "political", history: true });
  }
  if (conts[1]) specs.push({ name: "continent2", plan: planContinentView(world, conts[1].id, year, { aspect }), style: "political", history: !!history });
  if (conts[0]) specs.push({ name: "nohistory", plan: planContinentView(world, conts[0].id, 0, { aspect }), style: "relief", history: false });
  const st = q.get("style") as AtlasStyle | null;
  if (st) for (const s of specs) s.style = st;
  const only = q.get("plates");
  if (only) {
    const keep = new Set(only.split(",").map(Number));
    return specs.filter((_, k) => keep.has(k));
  }
  return specs;
}

function makeHistory(world: PhysicalWorld): History | null {
  if (histMode === "none") return null;
  if (histMode !== "mock" && typeof simulateHistory === "function") {
    try {
      const t0 = performance.now();
      const h = simulateHistory(world, new Rng(seed), {}) as History;
      const ms = performance.now() - t0;
      if (histMode === "real" || (h && h.polities && h.polities.length > 0)) {
        out.history = `real (${ms.toFixed(0)} ms, ${h.polities.length} polities)`;
        return h;
      }
    } catch (e) {
      console.warn("simulateHistory failed:", (e as Error).message);
    }
  }
  const t0 = performance.now();
  const h = makeMockHistory(world, seed, 1500);
  out.history = `mock (${(performance.now() - t0).toFixed(0)} ms)`;
  return h;
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
  status.textContent = `world ${seed}: ${cells} cells in ${genMs.toFixed(0)} ms; history…`;
  await new Promise((r) => setTimeout(r, 0));
  const history = makeHistory(world);
  status.textContent = `world ${seed}: ${cells} cells in ${genMs.toFixed(0)} ms; history ${out.history}`;
  const specs = choosePlates(world, history);
  out.specs = specs.map((s) => ({ name: s.name, style: s.style }));
  for (let n = 0; n < specs.length; n++) {
    const s = specs[n];
    const canvas = document.createElement("canvas");
    canvas.className = "plate";
    canvas.id = `plate${n}`;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    host.appendChild(canvas);
    const cap = document.createElement("div");
    cap.className = "cap";
    host.appendChild(cap);
    await new Promise((r) => setTimeout(r, 0));
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);
    const res = renderAtlasPlate(ctx, {
      world,
      history: s.history ? history : null,
      year: s.plan.year,
      view: s.plan.view,
      subject: s.plan.subject,
      width: W,
      height: H,
      seed,
      style: s.style,
      title: s.title,
    });
    out.timings.push(res.timings);
    out.labels.push(res.model.labels.length);
    const v = s.plan.view;
    const tt = Object.entries(res.timings).map(([k, x]) => `${k} ${x}`).join(" · ");
    cap.textContent = `#${n} ${s.name} (${s.style}, year ${s.plan.year}) ${v.centerLat.toFixed(1)},${v.centerLon.toFixed(1)} r=${v.radiusKm.toFixed(0)}km — ${res.model.labels.length} labels — ${tt}`;
    console.log(`plate ${n} ${s.name}: ${res.model.labels.length} labels; ${tt}`);
  }
  out.done = true;
}

main().catch((e) => {
  out.error = String(e && (e as Error).stack ? (e as Error).stack : e);
  console.error(out.error);
  status.textContent = "error: " + out.error;
  out.done = true;
});
