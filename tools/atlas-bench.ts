/**
 * CPU-time benchmark of the atlas plate model (geometry, labels, glyph
 * placement) in Node, robust to a busy machine (process.cpuUsage, not wall
 * clock). Drawing is measured in Chromium by the dev harness.
 *
 *   npx tsx tools/atlas-bench.ts [seed] [--history=mock|real] [--runs=3]
 */
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS } from "../src/world/types";
import type { History } from "../src/history/types";
import { simulateHistory } from "../src/history/index";
import { makeMockHistory } from "./atlas-mock-history";
import { approxMeasure, buildPlateModel, largestRealms, planContinentView, planRealmView, planRegionView, type PlannedView } from "../src/atlas/index";

const args = process.argv.slice(2);
const seed = args.find((a) => !a.startsWith("--")) ?? "velmarra";
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const runs = +flag("runs", "3");
const W = 1600, H = 1100;

const world = generatePhysical({ ...DEFAULT_PARAMS, seed }, new Rng(seed));
let history: History;
if (flag("history", "mock") === "real") history = simulateHistory(world, new Rng(seed), {});
else history = makeMockHistory(world, seed, 1500);
const year = Math.round(history.endYear * 0.6);
const aspect = W / H;
const plans: [string, PlannedView][] = [];
const conts = world.features.filter((f) => f.kind === "continent").sort((a, b) => b.size - a.size);
plans.push(["continent", planContinentView(world, conts[0].id, year, { aspect })]);
const big = largestRealms(history, year, 1);
if (big.length) plans.push(["realm", planRealmView(world, history, big[0], year, { aspect })]);
const river = world.features.filter((f) => f.kind === "river").sort((a, b) => b.size - a.size)[0];
const rp = planRegionView(world, river.id, year, { aspect });
rp.view.radiusKm = Math.min(rp.view.radiusKm, 900);
plans.push(["river", rp]);

for (const [name, plan] of plans) {
  for (const style of ["antique", "political", "relief"] as const) {
    const cpu: number[] = [];
    let timings: Record<string, number> = {};
    for (let r = 0; r < runs; r++) {
      const c0 = process.cpuUsage();
      const m = buildPlateModel({ world, history, year: plan.year, view: plan.view, subject: plan.subject, width: W, height: H, seed, style }, approxMeasure);
      const c1 = process.cpuUsage(c0);
      cpu.push((c1.user + c1.system) / 1000);
      timings = m.timings;
    }
    cpu.sort((a, b) => a - b);
    const top = Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ");
    console.log(`${name.padEnd(10)} ${style.padEnd(9)} model cpu ${cpu[0].toFixed(0)} ms (min of ${runs})  | wall: ${top}`);
  }
}
