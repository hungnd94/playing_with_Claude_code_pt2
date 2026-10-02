// Seals preview (development aid).
//   npx tsx tools/heraldry-seals.ts && node tools/shot.mjs out/heraldry/seals.html out/heraldry/seals.png 1400 900 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { generateArms } from "../src/heraldry/generate";
import { generateMon } from "../src/heraldry/mon";
import { generateSeal, renderSealSVG, describeSeal, SEAL_MATERIALS } from "../src/heraldry/seal";

const size = +(process.argv[2] ?? 200);
const rng = new Rng("seals");
const legends = ["Sigillum Kešdavar Regis", "Tor Oshen", "Velmarra Ashkari", "Sigillum Communitatis Urbis Olvenna", "Ondrek", "Brotherhood of the Burning Star", "", "Hasvald son of Hrom"];
let html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px;font:12px Georgia,serif}.g{display:grid;grid-template-columns:repeat(6,${size + 20}px);gap:12px;align-items:end}.c{text-align:center}.b{font-size:11px;line-height:1.25;margin-top:4px}</style></head><body><div class="g">`;
for (let i = 0; i < 24; i++) {
  const r = rng.fork(i);
  const kind = i % 4;
  const legend = legends[i % legends.length] || undefined;
  const seal = generateSeal(r, {
    legend,
    arms: kind === 1 ? generateArms(r.fork("a"), { style: "anglo" }) : undefined,
    mon: kind === 3 ? generateMon(r.fork("m")) : undefined,
    ecclesiastical: i === 5 || i === 11,
    material: SEAL_MATERIALS[i % SEAL_MATERIALS.length],
  });
  html += `<div class="c">${renderSealSVG(seal, { size })}<div class="b">${describeSeal(seal)}</div></div>`;
}
html += `</div></body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync("out/heraldry/seals.html", html);
console.log("ok");
