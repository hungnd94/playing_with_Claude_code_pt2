/**
 * Generate a physical world and its history, print diagnostics, write maps.
 *
 *   npx tsx tools/history-run.ts <seed> [years] [--no-maps] [--chronicle=N]
 *
 * Prints timings per system, statistics per century, the top polities by peak
 * area with their fates, sample dynasties, the largest wars and a raw
 * chronicle of importance ≥ 4 events. Writes out/history/<seed>/:
 *   political-<year>.png every 250 years, cultures-<year>.png and
 *   religions-<year>.png every 500 years, chronicle.txt (all events ≥ 3).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS } from "../src/world/types";
import { runSimulation } from "../src/history/index";
import { describeEvent, historyNamer } from "../src/history/describe";
import { polityTitle, regnalName, rulerTitle, polityName, settlementName, populationAt, layerAt } from "../src/history/query";
import type { History } from "../src/history/types";
import { MapCanvas, politicalMap, layerMap } from "./history-map";
import { validateHistory } from "../src/history/validate";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const seed = args[0] ?? "palimpsest";
const years = Number(args[1] ?? DEFAULT_PARAMS.years);
const chronN = Number([...flags].find((f) => f.startsWith("--chronicle="))?.split("=")[1] ?? 400);
const dir = `out/history/${seed}`;
mkdirSync(dir, { recursive: true });

const t0 = performance.now();
const world = generatePhysical({ ...DEFAULT_PARAMS, seed, years }, new Rng(seed));
const tPhys = performance.now() - t0;
const t1 = performance.now();
const cpu0 = process.cpuUsage();
let snaps = 0;
const sim = runSimulation(world, new Rng(seed), { years, onSnapshot: () => snaps++ });
const tHist = performance.now() - t1;
const cpu = process.cpuUsage(cpu0);
const h: History = sim.h;

const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
console.log(`seed "${seed}": physical ${(tPhys / 1000).toFixed(2)} s, history ${(tHist / 1000).toFixed(2)} s wall / ${((cpu.user + cpu.system) / 1e6).toFixed(2)} s CPU (${snaps} live snapshots)`);
console.log("timings (ms): " + Object.entries(sim.timings).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", "));

// ---------------------------------------------------------------- validity
const problems = validateHistory(h, 30);
console.log(problems.length ? `validateHistory: ${problems.length} problem(s):\n  ` + problems.join("\n  ") : "validateHistory: ok");

// ---------------------------------------------------------------- counts
const importance = [0, 0, 0, 0, 0, 0];
for (const e of h.events) importance[e.importance]++;
const byType = new Map<string, number>();
for (const e of h.events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
const families = new Set(h.languages.map((l) => l.family));
const organised = h.religions.filter((r) => !["folk", "pantheon", "ancestor"].includes(r.kind));
const indepEnd = h.polities.filter((p) => p.ended < 0 && (p.overlords[p.overlords.length - 1]?.overlord ?? -1) < 0);
console.log(`\nsettlements ever ${h.settlements.length}, alive at end ${h.settlements.filter((s) => s.ended < 0).length}`);
console.log(`polities ever ${h.polities.length}, independent at end ${indepEnd.length}`);
console.log(`persons ${h.persons.length}, dynasties ${h.dynasties.length}`);
console.log(`wars ${h.wars.length}, battles ${h.battles.length}`);
console.log(`cultures ${h.cultures.length}, languages ${h.languages.length} in ${families.size} families, scripts ${h.scripts.length} (${h.scripts.filter((s) => s.how === "invented").length} invented)`);
console.log(`religions ${h.religions.length} (${organised.length} organised), deities ${h.deities.length}, myths ${h.myths.length}`);
console.log(`wonders ${h.wonders.length}, works ${h.works.length}, trade routes ${h.tradeRoutes.length}, disasters ${h.disasters.length}`);
console.log(`events ${h.events.length}; by importance 1..5: ${importance.slice(1).join(" / ")} (≥4: ${(((importance[4] + importance[5]) / h.events.length) * 100).toFixed(1)}%)`);
console.log("events by type: " + [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));

// ---------------------------------------------------------------- per century
console.log("\nyear   setl  polities  wars  +wars   pop(M)  tech  clim  langs  rels  top%  (top realm)");
const ws = h.worldStats;
let landCells = 0;
for (let i = 0; i < world.mesh.n; i++) if (world.isLand[i] && world.lakeId[i] < 0) landCells++;
let maxShare = 0, maxShareAt = "";
for (let y = 0; y <= h.endYear; y += 100) {
  const k = y / h.sampleStep;
  const langs = h.languages.filter((l) => l.born <= y && (l.ended < 0 || l.ended > y)).length;
  const rels = h.religions.filter((r) => r.founded <= y && (r.ended < 0 || r.ended > y)).length;
  const started = h.wars.filter((w) => w.start >= y && w.start < y + 100).length;
  const layer = layerAt(h.timeline.owner, h.timeline, Math.min(y, (h.timeline.snapshots - 1) * h.timeline.step));
  const cnt = new Map<number, number>();
  for (let i = 0; i < layer.length; i++) if (layer[i] >= 0) cnt.set(layer[i], (cnt.get(layer[i]) ?? 0) + 1);
  let top = -1, tc = 0;
  for (const [p, c] of cnt) if (c > tc) { tc = c; top = p; }
  const share = (100 * tc) / landCells;
  if (share > maxShare) { maxShare = share; maxShareAt = `${top >= 0 ? polityName(h, top, y).roman : "-"} in ${y}`; }
  console.log(`${String(y).padStart(4)} ${String(ws.settlements[k]).padStart(6)} ${String(ws.polities[k]).padStart(9)} ${String(ws.wars[k]).padStart(5)} ${String(started).padStart(6)} ${(ws.pop[k] / 1e6).toFixed(1).padStart(8)} ${ws.tech[k].toFixed(2).padStart(5)} ${ws.climate[k].toFixed(2).padStart(5)} ${String(langs).padStart(6)} ${String(rels).padStart(5)} ${share.toFixed(1).padStart(5)}  ${top >= 0 ? polityName(h, top, y).roman : ""}`);
}
console.log(`largest realm ever: ${maxShare.toFixed(1)}% of land (${maxShareAt}); land cells ${landCells}`);

// ---------------------------------------------------------------- top polities
console.log("\nTop 20 polities by peak area:");
const top = h.polities.slice().sort((a, b) => b.peak.areaKm2 - a.peak.areaKm2).slice(0, 20);
for (const p of top) {
  const end = p.ended >= 0 ? `${p.ended} (${p.endReason})` : "present";
  const yr = p.peak.year;
  console.log(`  ${polityTitle(h, p.id, yr).padEnd(40)} ${p.founded}–${end}  peak ${fmt(p.peak.areaKm2)} km² in ${yr}, ${p.rulers.length} rulers, ${p.wars.length} wars, culture ${h.cultures[p.culture].adjective}`);
}

// ---------------------------------------------------------------- dynasties
const dyn = h.dynasties.map((d) => ({ d, n: h.persons.filter((x) => x.dynasty === d.id && x.roles.some((r) => r.kind === "ruler")).length })).filter((x) => x.n >= 4);
dyn.sort((a, b) => b.n - a.n);
for (const { d } of [dyn[0], dyn[Math.floor(dyn.length / 3)], dyn[Math.floor((2 * dyn.length) / 3)]].filter(Boolean)) {
  const end = d.extinct >= 0 ? d.extinct : "present";
  console.log(`\nDynasty ${d.name.roman} ('${d.name.gloss}') ${d.founded}–${end}${d.parent >= 0 ? ` (cadet of ${h.dynasties[d.parent].name.roman})` : ""} — ${d.emblem.blazon}`);
  const rulers = h.persons.filter((x) => x.dynasty === d.id && x.roles.some((r) => r.kind === "ruler"));
  for (const r of rulers.slice(0, 16)) {
    const roles = r.roles.filter((x) => x.kind === "ruler");
    const pol = roles[0].polity;
    console.log(`  ${rulerTitle(h, pol, roles[0].from, r.sex)} ${regnalName(h, r.id)} of ${polityName(h, pol, roles[0].from).roman} r. ${roles[0].from}–${roles[0].to}, ${r.born}–${r.died} (${r.deathCause}) [${r.traits.join(", ")}]`);
  }
}

// ---------------------------------------------------------------- wars
console.log("\nLargest wars:");
for (const w of h.wars.slice().sort((a, b) => b.casualties - a.casualties).slice(0, 10)) {
  console.log(`  ${w.name} (${w.start}–${w.end}, ${w.casusBelli}): ${w.attackers.map((p) => polityName(h, p, w.start).roman).join("+")} vs ${w.defenders.map((p) => polityName(h, p, w.start).roman).join("+")}; ${w.battles.length} battles, ${fmt(w.casualties)} dead, ${w.outcome}; ${w.treaty}`);
}

// ---------------------------------------------------------------- largest cities
console.log("\nLargest settlements at the end:");
for (const s of h.settlements.filter((s) => s.ended < 0).sort((a, b) => populationAt(h, b, h.endYear) - populationAt(h, a, h.endYear)).slice(0, 10)) {
  const nm = settlementName(h, s.id, h.endYear);
  console.log(`  ${nm.roman} '${nm.gloss}' pop ${fmt(populationAt(h, s, h.endYear))}, founded ${s.founded}, ${s.names.length} names: ${s.names.map((n) => n.name.roman).join(" → ")}  ${nm.etym ?? ""}`);
}

// ---------------------------------------------------------------- chronicle
const lines: string[] = [];
for (const e of h.events) {
  if (e.importance < 3) continue;
  lines.push(`${String(e.year).padStart(4)} [${e.importance}] ${describeEvent(e, historyNamer(h, e.year))}`);
}
writeFileSync(`${dir}/chronicle.txt`, lines.join("\n"));
console.log(`\nChronicle (importance ≥ 4, first ${chronN}):`);
let shown = 0;
for (const e of h.events) {
  if (e.importance < 4) continue;
  if (shown++ >= chronN) break;
  console.log(`${String(e.year).padStart(4)} ${describeEvent(e, historyNamer(h, e.year))}`);
}

// ---------------------------------------------------------------- maps
if (!flags.has("--no-maps")) {
  const tm = performance.now();
  const cv = new MapCanvas(world, 1200, 600);
  for (let y = 0; y <= h.endYear; y += 250) {
    politicalMap(cv, h, y);
    cv.save(`${dir}/political-${String(y).padStart(4, "0")}.png`);
  }
  for (let y = 500; y <= h.endYear; y += 500) {
    layerMap(cv, h, y, "culture");
    cv.save(`${dir}/cultures-${String(y).padStart(4, "0")}.png`);
    layerMap(cv, h, y, "religion");
    cv.save(`${dir}/religions-${String(y).padStart(4, "0")}.png`);
  }
  console.log(`\nmaps written to ${dir}/ in ${((performance.now() - tm) / 1000).toFixed(1)} s`);
}
