/**
 * Exercises the app's read side against a generated history (real simulation
 * or the stand-in): narrative (overview, every kind of article on a sample,
 * chronicle, search index, "this age"), the overlay engine for every layer at
 * several years, and `locate` for every kind of reference. Prints failures
 * and timings — run it whenever src/history or src/narrative change.
 *
 *   npx tsx tools/app-check.ts [seed] [--engine=sim|mock] [--cells=40000] [--all]
 */
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS } from "../src/world/types";
import { runHistory, validateHistory } from "../src/app/engine/history";
import { createNarrative } from "../src/app/engine/narrative";
import { OverlayEngine, type OverlayLayer } from "../src/app/engine/overlay";
import { locate } from "../src/app/engine/locate";
import type { EntityKind, Ref } from "../src/narrative/types";

const args = process.argv.slice(2);
const seed = args.find((a) => !a.startsWith("--")) ?? "velmarra";
const cells = +(args.find((a) => a.startsWith("--cells="))?.slice(8) ?? DEFAULT_PARAMS.cells);
const engineArg = args.find((a) => a.startsWith("--engine="))?.slice(9) as "sim" | "mock" | undefined;
const all = args.includes("--all");

const t0 = performance.now();
const world = generatePhysical({ ...DEFAULT_PARAMS, seed, cells }, new Rng(seed));
const t1 = performance.now();
const run = runHistory(world, { engine: engineArg });
const h = run.history;
const t2 = performance.now();
console.log(`seed ${seed}: physical ${(t1 - t0).toFixed(0)} ms, history (${run.source}) ${(t2 - t1).toFixed(0)} ms${run.fallbackReason ? ` — ${run.fallbackReason}` : ""}`);
const bad = validateHistory(h);
if (bad.length) console.log("validateHistory:", bad.join(", "));

let failures = 0;
const fail = (what: string, e: unknown): void => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${what}: ${e instanceof Error ? e.message : String(e)}${e instanceof Error && e.stack ? "\n    " + e.stack.split("\n").slice(1, 4).join("\n    ") : ""}`);
};
const time = <T>(label: string, f: () => T): T | undefined => {
  const a = performance.now();
  try {
    const r = f();
    console.log(`  ${label.padEnd(28)} ${(performance.now() - a).toFixed(0).padStart(6)} ms`);
    return r;
  } catch (e) {
    fail(label, e);
    return undefined;
  }
};

const nar = time("createNarrative", () => createNarrative(world, h));
if (nar) {
  console.log(`narrative source: ${nar.source}`);
  time("overview", () => nar.overview());
  const chron = time("chronicle", () => nar.chronicle());
  if (chron) console.log(`    ${chron.length} entries, ${chron.filter((c) => c.legendary).length} legendary`);
  const idx = time("searchIndex", () => nar.searchIndex());
  if (idx) console.log(`    ${idx.length} entries`);
  for (const y of [0, Math.round(h.endYear / 3), h.endYear]) time(`atYear(${y})`, () => nar.atYear(y));
  const kinds: [EntityKind, number][] = [
    ["settlement", h.settlements.length], ["polity", h.polities.length], ["person", h.persons.length], ["dynasty", h.dynasties.length],
    ["culture", h.cultures.length], ["language", h.languages.length], ["script", h.scripts.length], ["religion", h.religions.length],
    ["deity", h.deities.length], ["myth", h.myths.length], ["war", h.wars.length], ["battle", h.battles.length], ["wonder", h.wonders.length],
    ["work", h.works.length], ["tradeRoute", h.tradeRoutes.length], ["disaster", h.disasters.length], ["feature", world.features.length],
    ["age", h.ages.length], ["event", h.events.length],
  ];
  for (const [kind, n] of kinds) {
    if (!n) continue;
    const ids = all ? [...Array(n).keys()] : [0, 1, Math.floor(n / 2), n - 1].filter((v, i, a) => v < n && a.indexOf(v) === i);
    const a0 = performance.now();
    let ok = 0;
    for (const id of ids) {
      try {
        const art = nar.article({ kind, id });
        if (!art.title) throw new Error("empty title");
        ok++;
      } catch (e) {
        fail(`article ${kind}:${id}`, e);
      }
      try {
        nar.label({ kind, id });
      } catch (e) {
        fail(`label ${kind}:${id}`, e);
      }
    }
    console.log(`  articles ${kind.padEnd(12)} ${ok}/${ids.length} ok, ${((performance.now() - a0) / ids.length).toFixed(1)} ms each`);
  }
  const ev = h.events.slice(0, all ? h.events.length : 500);
  let hf = 0;
  for (const e of ev) {
    try {
      nar.headline(e.id);
    } catch (err) {
      hf++;
      if (hf < 4) fail(`headline ${e.type}#${e.id}`, err);
    }
  }
  if (hf) console.log(`  headlines: ${hf} failures`);
}

const eng = new OverlayEngine(world, h);
for (const layer of ["realms", "peoples", "tongues", "faiths", "population"] as OverlayLayer[]) {
  for (const y of [0, Math.round(h.endYear / 2), h.endYear]) {
    try {
      const a = performance.now();
      const f = eng.build(layer, y);
      let filled = 0;
      if (f) for (let i = 3; i < f.colors.length; i += 4) if (f.colors[i]) filled++;
      if (y === h.endYear) console.log(`  overlay ${layer.padEnd(11)} @${y}: ${filled} cells, ${(performance.now() - a).toFixed(1)} ms`);
    } catch (e) {
      fail(`overlay ${layer}@${y}`, e);
    }
  }
}
const refs: Ref[] = [];
for (const k of ["settlement", "polity", "person", "dynasty", "culture", "language", "script", "religion", "deity", "war", "battle", "wonder", "work", "tradeRoute", "disaster", "feature"] as EntityKind[]) {
  for (const id of [0, 3]) refs.push({ kind: k, id });
}
let located = 0;
for (const r of refs) {
  try {
    if (locate(world, h, eng, r, h.endYear)) located++;
  } catch (e) {
    fail(`locate ${r.kind}:${r.id}`, e);
  }
}
console.log(`  locate: ${located}/${refs.length} placed`);
console.log(failures ? `${failures} FAILURES` : "all checks passed");
process.exitCode = failures ? 1 : 0;
