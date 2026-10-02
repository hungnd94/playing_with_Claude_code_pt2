// Render one or a few arms at several sizes (development aid).
//   npx tsx tools/heraldry-one.ts '<json arms>' ...
import { writeFileSync, mkdirSync } from "node:fs";
import { renderArmsSVG } from "../src/heraldry/render";
import type { Arms } from "../src/heraldry/types";
const list = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => JSON.parse(a) as Arms);
let html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px}.r{display:flex;gap:16px;align-items:flex-end;margin-bottom:16px}</style></head><body>`;
for (const a of list) {
  html += `<div class="r">`;
  for (const s of [380, 200, 110, 64, 36]) html += renderArmsSVG(a, { size: s });
  html += `</div>`;
}
html += `</body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync("out/heraldry/one.html", html);
