// Flags & banners preview (development aid).
//   npx tsx tools/heraldry-flags.ts [n] [seed] && node tools/shot.mjs out/heraldry/flags.html out/heraldry/flags.png 1400 900 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { generateArms } from "../src/heraldry/generate";
import { generateFlag, renderFlagSVG, describeFlag, FLAG_PATTERNS } from "../src/heraldry/flag";
import { STYLES, type StyleName } from "../src/heraldry/styles";

const n = +(process.argv[2] ?? 40);
const seed = process.argv[3] ?? "flags";
const rng = new Rng(seed);
const styles = Object.keys(STYLES) as StyleName[];
let html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px;font:12px Georgia,serif}.g{display:grid;grid-template-columns:repeat(6,210px);gap:14px}.c{text-align:center}.b{font-size:11px;line-height:1.25;margin-top:4px}</style></head><body><div class="g">`;
for (let i = 0; i < n; i++) {
  const style = styles[i % styles.length];
  const r = rng.fork(i);
  const arms = generateArms(r.fork("arms"), { style });
  const fl = generateFlag(r.fork("flag"), { arms, style, pattern: i < FLAG_PATTERNS.length ? FLAG_PATTERNS[i] : undefined });
  html += `<div class="c">${renderFlagSVG(fl, { size: 200 })}<div class="b">${describeFlag(fl)} <i>(${style})</i></div></div>`;
}
html += `</div></body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync("out/heraldry/flags.html", html);
console.log("ok");

// Banners
import { generateBanner, renderBannerSVG, describeBanner, BANNER_SHAPES } from "../src/heraldry/banner";
let bh = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px;font:12px Georgia,serif}.g{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end}.c{text-align:center;max-width:300px}.b{font-size:11px;line-height:1.25;margin-top:4px}</style></head><body><div class="g">`;
for (let i = 0; i < 18; i++) {
  const style = styles[i % styles.length];
  const r = rng.fork("banner" + i);
  const b = generateBanner(r, { style, shape: BANNER_SHAPES[i % BANNER_SHAPES.length] });
  bh += `<div class="c">${renderBannerSVG(b, { size: 300 })}<div class="b">${describeBanner(b)} <i>(${style})</i></div></div>`;
}
bh += `</div></body></html>`;
writeFileSync("out/heraldry/banners.html", bh);
