// Debug: render raw glyph candidates for each family × tool into out/script/families.html
//   npx tsx tools/script-families.ts [family] [tool]
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { familyParams, genGlyph, type GenCtx } from "../src/script/families";
import { randomStyle, FAMILY_TOOLS } from "../src/script/style";
import { outlinePolys, polysToPath } from "../src/script/outline";
import type { Family, Tool } from "../src/script/types";
import { FAMILIES } from "../src/script/types";

const famArg = process.argv[2] as Family | undefined;
const toolArg = process.argv[3] as Tool | undefined;
mkdirSync("out/script", { recursive: true });
let html = `<!doctype html><meta charset=utf-8><style>body{background:#f4ecd8;font:12px sans-serif;margin:16px} .row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px} svg{background:#fbf6ea}</style>`;
const fams = famArg ? [famArg] : FAMILIES.filter((f) => !["tally", "featural", "syllabic"].includes(f));
for (const fam of fams) {
  const tools = toolArg ? [toolArg] : FAMILY_TOOLS[fam].map((t) => t[0]);
  for (const tool of tools) {
    const rng = new Rng(`fam-${fam}-${tool}`);
    const style = randomStyle(rng, fam, tool, "ltr");
    const p = familyParams(rng, fam);
    const ctx: GenCtx = { W: style.width, p, role: "consonant", big: 0.3, noHorizontal: tool === "knife" };
    html += `<h3>${fam} / ${tool} w=${style.weight} c=${style.contrast} nib=${(style.nibAngle * 57.3).toFixed(0)} corner=${style.cornering}</h3><div class=row>`;
    for (let i = 0; i < 24; i++) {
      const g = genGlyph(fam, rng, ctx);
      const d = polysToPath(outlinePolys(g.strokes, style, i));
      const vbW = (g.w + 0.6) * 100;
      html += `<svg width="${vbW * 0.6}" height="${210 * 0.6}" viewBox="-30 -55 ${vbW} 210"><path d="${d}" fill="#1d1408"/></svg>`;
    }
    html += `</div>`;
  }
}
writeFileSync("out/script/families.html", html);
console.log("wrote out/script/families.html");
