// Charge sheet: every charge drawn large, for close inspection while drawing.
//
//   npx tsx tools/heraldry-sheet.ts [filter...] [--size=240] [--grid] [--cols=6]
//   node tools/shot.mjs out/heraldry/sheet.html out/heraldry/sheet.png 1500 900 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { ALL_CHARGE_IDS, CHARGES, chargeArt } from "../src/heraldry/charges/index";
import { paintCharge } from "../src/heraldry/charges/paint";
import { ILLUMINATED } from "../src/heraldry/tinctures";
import type { Attitude, ChargeId } from "../src/heraldry/types";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const filters = args.filter((a) => !a.startsWith("--"));
const size = +(flags.size ?? 240);
const cols = +(flags.cols ?? 6);
const P = ILLUMINATED.tinctures;
const combos: [string, string, string][] = [
  [P.gules.base, "url(#or)", "or on gules"],
  [P.azure.base, "url(#ar)", "argent on azure"],
  [P.argent.base, P.sable.base, "sable on argent"],
  [P.or.base, P.vert.base, "vert on or"],
];
const ids: { id: ChargeId; att?: Attitude }[] = [];
for (const id of ALL_CHARGE_IDS) {
  const def = CHARGES[id];
  if (!def) continue;
  if (filters.length && !filters.some((f) => id.toLowerCase().includes(f.toLowerCase()))) continue;
  if (def.attitudes && def.attitudes.length > 1) for (const a of def.attitudes) ids.push({ id, att: a });
  else ids.push({ id });
}
let cells = "";
ids.forEach(({ id, att }, i) => {
  const { art, box } = chargeArt(id, { attitude: att });
  const [bg, fg] = combos[i % combos.length];
  const pad = 14;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const k = (size - pad * 2) / Math.max(bw, bh);
  const tx = (size - bw * k) / 2 - box.x0 * k;
  const ty = (size - bh * k) / 2 - box.y0 * k;
  const g = paintCharge(art, {
    body: fg, accent: P.gules.base === bg ? P.azure.base : P.gules.base, crown: "url(#or)", contour: ILLUMINATED.contour,
    detail: fg === P.sable.base ? ILLUMINATED.contourOnDark : ILLUMINATED.contour, outlineW: 1.1 / k * 2.2, lineK: 1, detailOn: true,
  });
  let grid = "";
  if (flags.grid) {
    for (let v = 0; v <= 100; v += 10) {
      grid += `<line x1="${v}" y1="0" x2="${v}" y2="100" stroke="#fff" stroke-opacity="${v % 50 ? 0.15 : 0.4}" stroke-width="${0.6 / k * 2}"/>`;
      grid += `<line x1="0" y1="${v}" x2="100" y2="${v}" stroke="#fff" stroke-opacity="${v % 50 ? 0.15 : 0.4}" stroke-width="${0.6 / k * 2}"/>`;
    }
  }
  cells += `<div class="c"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${bg}"/><g transform="translate(${tx} ${ty}) scale(${k})">${grid}${g}</g></svg><div>${id}${att ? " " + att : ""}</div></div>`;
});
const defs = `<svg width="0" height="0" style="position:absolute"><defs>
<linearGradient id="or" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P.or.light}"/><stop offset=".55" stop-color="${P.or.base}"/><stop offset="1" stop-color="${P.or.dark}"/></linearGradient>
<linearGradient id="ar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="${P.argent.base}"/><stop offset="1" stop-color="${P.argent.dark}"/></linearGradient>
</defs></svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#2a2622;color:#ddd;font:13px sans-serif;margin:10px}.g{display:grid;grid-template-columns:repeat(${cols},${size}px);gap:10px}.c div{text-align:center;padding:3px}</style></head><body>${defs}<div class="g">${cells}</div></body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync(flags.out ?? "out/heraldry/sheet.html", html);
console.log(`wrote ${flags.out ?? "out/heraldry/sheet.html"} (${ids.length} charges)`);
