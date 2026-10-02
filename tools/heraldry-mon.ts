// Mon preview (development aid).
//   npx tsx tools/heraldry-mon.ts && node tools/shot.mjs out/heraldry/mon.html out/heraldry/mon.png 1400 900 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { generateMon, renderMonSVG, describeMon, MON_GEOMETRIC, MON_ENCLOSURES, type Mon } from "../src/heraldry/mon";
import { EMBLEM_CONCEPTS } from "../src/world/concepts";

const size = +(process.argv[2] ?? 150);
const fixed: Mon[] = [
  { motif: { kind: "commas", n: 3, swirl: 1 }, enclosure: "ring" },
  { motif: { kind: "commas", n: 2, swirl: -1 }, enclosure: "none" },
  { motif: { kind: "commas", n: 4, swirl: 1 }, enclosure: "thickRing" },
  { motif: { kind: "flower", n: 5, petal: "round" }, enclosure: "none" },
  { motif: { kind: "flower", n: 5, petal: "notched" }, enclosure: "ring" },
  { motif: { kind: "flower", n: 5, petal: "pointed" }, enclosure: "none" },
  { motif: { kind: "flower", n: 16, petal: "rayed" }, enclosure: "none" },
  { motif: { kind: "leaves", n: 3, leaf: "heart" }, enclosure: "ring" },
  { motif: { kind: "leaves", n: 3, leaf: "oak" }, enclosure: "none" },
  { motif: { kind: "leaves", n: 5, leaf: "blade" }, enclosure: "doubleRing" },
  { motif: { kind: "embrace", leaf: "oak" }, enclosure: "ring" },
  { motif: { kind: "embrace", leaf: "heart", inner: "mullet" }, enclosure: "none" },
  { motif: { kind: "crossed", charge: "feather" }, enclosure: "ring" },
  { motif: { kind: "crossed", charge: "sword" }, enclosure: "none" },
  { motif: { kind: "crossed", charge: "key" }, enclosure: "hexagon" },
  { motif: { kind: "radial", charge: "sword", n: 3 }, enclosure: "ring" },
  { motif: { kind: "radial", charge: "fish", n: 3 }, enclosure: "none" },
  { motif: { kind: "radial", charge: "anchor", n: 3 }, enclosure: "ring" },
  { motif: { kind: "radial", charge: "heart", n: 4, inward: true }, enclosure: "thinRing" },
  { motif: { kind: "single", charge: "wolf" }, enclosure: "ring" },
  { motif: { kind: "single", charge: "eagle" }, enclosure: "none" },
  { motif: { kind: "facing", charge: "swan" }, enclosure: "ring" },
  { motif: { kind: "facing", charge: "horse" }, enclosure: "none" },
  { motif: { kind: "single", charge: "tower" }, enclosure: "square" },
  ...MON_GEOMETRIC.map((g, i) => ({ motif: { kind: "geometric", shape: g }, enclosure: MON_ENCLOSURES[i % MON_ENCLOSURES.length] }) as Mon),
];
let html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px;font:12px Georgia,serif}.g{display:grid;grid-template-columns:repeat(8,${size + 10}px);gap:12px}.c{text-align:center}.b{font-size:11px;line-height:1.25;margin-top:4px}</style></head><body><div class="g">`;
for (const m of fixed) html += `<div class="c">${renderMonSVG(m, { size })}<div class="b">${describeMon(m)}</div></div>`;
html += `</div><h3>Generated (canting on each emblem concept)</h3><div class="g">`;
const rng = new Rng("mon");
for (const c of EMBLEM_CONCEPTS) {
  const m = generateMon(rng.fork(c), { motifs: [c] });
  html += `<div class="c">${renderMonSVG(m, { size })}<div class="b"><b>${c}</b>: ${describeMon(m)}</div></div>`;
}
html += `</div></body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync("out/heraldry/mon.html", html);
console.log("ok");
