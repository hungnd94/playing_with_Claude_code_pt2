// Large-glyph inspection sheet: one row of big glyphs + a word per tool/family combo.
//   [N=glyphs] [TOOLS=pen,knife] npx tsx tools/script-zoom.ts [family] [kind] [seed]
//   node tools/shot.mjs out/script/zoom.html out/script/zoom.png 1400 900 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import * as S from "../src/script";
import type { Family, ScriptKind, Tool } from "../src/script";
import { INVENTORIES, randomWords } from "./script-samples";

const famArg = process.argv[2] as Family | undefined;
const kindArg = process.argv[3] as ScriptKind | undefined;
const seed = process.argv[4] ?? "zoom";
mkdirSync("out/script", { recursive: true });
const combos: [Family, ScriptKind, Tool][] = famArg
  ? ((process.env.TOOLS?.split(",") ?? ["pen", "reed", "brush", "needle", "chisel", "knife", "stylus"]) as Tool[]).map((t) => [famArg, kindArg ?? "alphabet", t])
  : [
      ["stave", "alphabet", "knife"],
      ["geometric", "abjad", "chisel"],
      ["hanging", "abugida", "pen"],
      ["round", "alphabet", "needle"],
      ["square", "abjad", "reed"],
      ["cursive", "abjad", "reed"],
      ["wedge", "syllabary", "stylus"],
      ["linear", "syllabary", "brush"],
    ];
let html = `<!doctype html><meta charset=utf-8><style>body{background:#f4ecd8;font:13px Georgia,serif;margin:16px;color:#4a3b28} .row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:flex-end;margin:6px 0 22px}</style>`;
combos.forEach(([family, kind, tool], i) => {
  const inv = kind === "syllabary" ? INVENTORIES.japonic : kind === "abugida" ? INVENTORIES.indic : kind === "abjad" ? INVENTORIES.semitic : INVENTORIES.germanic;
  const s = S.createScript(inv, new Rng(`${seed}/${i}`), { family, kind, tool });
  html += `<div>${family} / ${kind} / ${tool} — w ${s.style.weight} c ${s.style.contrast} nib ${(s.style.nibAngle * 57.3).toFixed(0)}° corner ${s.style.cornering} slant ${s.style.slant}</div><div class=row>`;
  const gl = s.order.map((id) => s.glyphs.find((g) => g.id === id)!).slice(0, +(process.env.N ?? 14));
  for (const g of gl) html += S.renderGlyphSVG(s, g, { size: 72, color: "#1d1408" });
  html += `</div><div class=row>`;
  for (const w of randomWords(inv, new Rng(`${seed}/w${i}`), 4)) html += S.renderWordSVG(s, w, { size: 56, color: "#1d1408" });
  html += `</div>`;
});
writeFileSync("out/script/zoom.html", html);
console.log("wrote out/script/zoom.html");
