// Preview generated arms with blazons for one style (development aid).
//   npx tsx tools/heraldry-gen-preview.ts [style] [n] [seed]
import { writeFileSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { generateArms } from "../src/heraldry/generate";
import { blazon } from "../src/heraldry/blazon";
import { renderArmsSVG } from "../src/heraldry/render";
import { STYLES, type StyleName } from "../src/heraldry/styles";
const style = (process.argv[2] ?? "anglo") as StyleName;
const n = +(process.argv[3] ?? 40);
const seed = process.argv[4] ?? "preview";
const rng = new Rng(seed);
let html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px;font:12px Georgia,serif}.g{display:grid;grid-template-columns:repeat(8,160px);gap:12px}.c{text-align:center}.b{font-size:11px;line-height:1.25;margin-top:4px}</style></head><body><div class="g">`;
for (let i = 0; i < n; i++) {
  const a = generateArms(rng.fork(i), { style });
  html += `<div class="c">${renderArmsSVG(a, { size: 140, shape: STYLES[style].shape })}<div class="b">${blazon(a)}${a.exception ? " <i>[" + a.exception + "]</i>" : ""}</div></div>`;
}
html += `</div></body></html>`;
writeFileSync("out/heraldry/preview.html", html);
