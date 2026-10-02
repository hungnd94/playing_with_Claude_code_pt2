// Gallery of fully random scripts (no options), to spot ugly outliers.
//   npx tsx tools/script-gallery.ts [seed] [count] [derive]
//   node tools/shot.mjs out/script/gallery.html out/script/gallery.png 1400 1000 --full=1
// With a third argument, each script is shown next to a derived descendant.
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import * as S from "../src/script";
import type { Script } from "../src/script";
import { INVENTORIES, randomWords, romanize } from "./script-samples";

const seed = process.argv[2] ?? "gallery";
const count = +(process.argv[3] ?? 24);
const derive = !!process.argv[4];
mkdirSync("out/script", { recursive: true });
const invNames = Object.keys(INVENTORIES);

const css = `body{background:#efe6d2;color:#2a2018;font-family:Georgia,serif;margin:0;padding:16px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.c{background:#faf5e8;border:1px solid #d9cdb0;border-radius:8px;padding:10px 12px}
.m{font-size:12px;color:#6b5a45;font-style:italic;margin-bottom:6px}
.g{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:flex-end}
.w{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:6px;align-items:flex-end}
.w span{font-size:11px;color:#6b5a45;display:block;text-align:center}`;

function cell(s: Script, inv: (typeof INVENTORIES)[string], k: number): string {
  const letters = s.order.map((id) => s.glyphs.find((g) => g.id === id)!).filter((g) => g && g.role !== "mark").slice(0, 28);
  const meta = `${s.id} · ${s.kind}${s.ortho.vowelMode !== "none" ? ` (${s.ortho.vowelMode})` : ""} · ${s.morph.family} · ${s.style.tool} · ${s.direction} · ${s.glyphs.length} glyphs`;
  let h = `<div class="m">${meta}${s.parent ? `<br>${s.history.slice(1).join("; ")}` : ""}</div><div class="g">`;
  for (const g of letters) h += S.renderGlyphSVG(s, g, { size: 26, color: "#1f160c", padding: 0.05 });
  h += `</div><div class="w">`;
  for (const w of randomWords(inv, new Rng(`${seed}/w${k}`), 4)) h += `<div>${S.renderWordSVG(s, w, { size: 26, color: "#1f160c" })}<span>${romanize(w)}</span></div>`;
  return h + `</div>`;
}

let html = `<!doctype html><meta charset=utf-8><style>${css}</style><div class="grid">`;
for (let i = 0; i < count; i++) {
  const invName = invNames[i % invNames.length];
  const inv = INVENTORIES[invName];
  const s = S.createScript(inv, new Rng(`${seed}/${i}`), { id: `R${i}` });
  html += `<div class="c" id="R${i}">${cell(s, inv, i)}`;
  if (derive) {
    const inv2 = INVENTORIES[invNames[(i * 7 + 3) % invNames.length]];
    const d = S.deriveScript(s, new Rng(`${seed}/d${i}`), { id: `R${i}d`, inventory: inv2, drift: 0.7 });
    html += `<hr style="border:0;border-top:1px dashed #cdbf9f">${cell(d, inv2, i + 1000)}`;
  }
  html += `</div>`;
}
html += `</div>`;
writeFileSync("out/script/gallery.html", html);
console.log("wrote out/script/gallery.html");
