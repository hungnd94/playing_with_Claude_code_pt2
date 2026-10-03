// Scratch debugging entry (overwritten freely).
import { writeFileSync } from "node:fs";
import { Rng } from "../src/core/rng";
import * as S from "../src/script";
import { INVENTORIES } from "./script-samples";
const invNames = Object.keys(INVENTORIES);
let html = `<!doctype html><meta charset=utf-8><body style="background:#f4ecd8">`;
for (const i of [3, 6]) {
  const s = S.createScript(INVENTORIES[invNames[i % invNames.length]], new Rng(`g7/${i}`), { id: `R${i}` });
  const inv2 = INVENTORIES[invNames[(i * 7 + 3) % invNames.length]];
  const d = S.deriveScript(s, new Rng(`g7/d${i}`), { id: `R${i}d`, inventory: inv2, drift: 0.7 });
  for (const sc of [s, d]) {
    html += `<div>`;
    for (const w of [["k", "a"], ["k", "u"], ["t", "a", "z"], ["s", "o"], ["k", "u", "b", "a"]]) html += S.renderWordSVG(sc, w, { size: 90, color: "#222" }) + " ";
    html += `</div>`;
    const sp = S.spellWord(sc, ["k", "a"]);
    console.log(sc.id, JSON.stringify(sp));
  }
}
writeFileSync("out/script/dbg.html", html);
