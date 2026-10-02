/**
 * Runs the app's generation pipeline in Node (physical world + the history
 * engine behind src/app/engine/history.ts) and prints statistics/timings.
 *
 *   npx tsx tools/app-mock.ts [seed] [--cells=40000] [--json]
 */
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS } from "../src/world/types";
import { runHistory, HISTORY_SOURCE } from "../src/app/engine/history";

const args = process.argv.slice(2);
const seed = args.find((a) => !a.startsWith("--")) ?? "velmarra";
const cells = +(args.find((a) => a.startsWith("--cells="))?.slice(8) ?? DEFAULT_PARAMS.cells);

const t0 = performance.now();
const world = generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed));
const t1 = performance.now();
let last = t1;
const h = runHistory(world, {
  onProgress: (stage, f) => {
    const now = performance.now();
    console.log(`  ${stage.padEnd(14)} ${(f * 100).toFixed(0).padStart(3)}%  +${(now - last).toFixed(0)} ms`);
    last = now;
  },
});
const t2 = performance.now();
console.log(`history source: ${HISTORY_SOURCE}`);
console.log(`physical ${(t1 - t0).toFixed(0)} ms, history ${(t2 - t1).toFixed(0)} ms`);
const count = (k: keyof typeof h) => (Array.isArray(h[k]) ? (h[k] as unknown[]).length : 0);
for (const k of ["cultures", "languages", "scripts", "settlements", "polities", "persons", "dynasties", "religions", "deities", "wars", "battles", "wonders", "works", "disasters", "tradeRoutes", "featureNames", "events"] as const) {
  console.log(`  ${k.padEnd(14)} ${count(k)}`);
}
console.log("ages:", h.ages.map((a) => `${a.name} (${a.start}–${a.end})`).join("; "));
console.log("cultures:", h.cultures.map((c) => `${c.name.roman} [${c.adjective}, ${c.archetype}]`).join(", "));
console.log("languages:", h.languages.map((l) => l.name).join(", "));
console.log("polities (first 12):", h.polities.slice(0, 12).map((p) => `${p.names[0].name.roman} ${p.founded}–${p.ended}`).join(", "));
console.log("wars (first 8):", h.wars.slice(0, 8).map((w) => `${w.name} ${w.start}–${w.end}`).join("; "));
const bytes = JSON.stringify(h, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Int32Array).length : v)).length;
console.log(`approx JSON size (typed arrays as lengths): ${(bytes / 1e6).toFixed(1)} MB`);
