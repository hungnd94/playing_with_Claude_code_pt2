// Visual demo of procedural writing systems.
//   npx tsx tools/script-demo.ts [seed]
//   node tools/shot.mjs out/script/demo.html out/script/demo.png 1400 2000 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import * as S from "../src/script";
import type { Script, ScriptKind, Family, Tool, Direction } from "../src/script";
import { INVENTORIES, romanize, randomWords } from "./script-samples";

const seed = process.argv[2] ?? "palimpsest";
mkdirSync("out/script", { recursive: true });

interface Spec {
  inv: string;
  kind?: ScriptKind;
  family?: Family;
  tool?: Tool;
  direction?: Direction;
}

const SPECS: Spec[] = [
  { inv: "germanic", kind: "alphabet", family: "stave" },
  { inv: "semitic", kind: "abjad", family: "cursive" },
  { inv: "indic", kind: "abugida", family: "hanging" },
  { inv: "japonic", kind: "syllabary", family: "linear" },
  { inv: "semitic", kind: "abjad", family: "square" },
  { inv: "caucasian", kind: "alphabet", family: "round" },
  { inv: "bantu", kind: "abugida", family: "geometric" },
  { inv: "polynesian", kind: "featural" },
  { inv: "small", kind: "abugida", family: "syllabic" },
  { inv: "japonic", kind: "syllabary", family: "wedge" },
  { inv: "nasal", kind: "alphabet", family: "geometric" },
  { inv: "germanic", kind: "alphabet", family: "tally" },
  { inv: "indic", kind: "abugida", family: "round" },
  { inv: "semitic", kind: "alphabet", family: "cursive", direction: "ttb" },
  { inv: "caucasian", kind: "alphabet", family: "cursive", direction: "ltr", tool: "pen" },
  { inv: "bantu", kind: "featural", tool: "brush" },
  { inv: "germanic", kind: "alphabet", family: "square", tool: "brush" },
  { inv: "indic", kind: "abugida", family: "hanging", tool: "brush" },
];

const css = `
body{background:#efe6d2;color:#2a2018;font-family:'Gentium Book Plus',Georgia,serif;margin:0;padding:24px 32px}
h1{font-weight:normal;font-size:30px;margin:0 0 4px} h2{font-weight:normal;font-size:22px;margin:28px 0 8px;border-bottom:1px solid #cdbf9f}
.card{background:#faf5e8;border:1px solid #d9cdb0;border-radius:10px;padding:14px 18px;margin:14px 0;box-shadow:0 1px 3px #0001}
.meta{font-size:13px;color:#6b5a45;font-style:italic;margin-bottom:8px}
.words{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:10px;align-items:flex-end}
.word{display:flex;flex-direction:column;align-items:center;gap:2px}
.word .r{font-size:13px;color:#6b5a45}
.flex{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
`;

function wordsHtml(s: Script, words: string[][], size = 30): string {
  return (
    `<div class="words">` +
    words
      .map((w) => `<div class="word">${S.renderWordSVG(s, w, { size, color: "#1f160c" })}<span class="r">${romanize(w)} <span style="opacity:.6">/${w.join("")}/</span></span></div>`)
      .join("") +
    `</div>`
  );
}

function card(s: Script, title: string, words: string[][]): string {
  const meta = `${s.kind}${s.ortho.vowelMode !== "none" ? ` (${s.ortho.vowelMode})` : ""} · ${s.morph.family} family · ${s.style.tool} · ${s.direction} · ${s.glyphs.length} glyphs`;
  return `<div class="card" id="${s.id}"><div style="font-size:19px">${title}</div><div class="meta">${meta}<br>${s.history.join("; ")}</div>${S.scriptChartSVG(s, { size: 34, columns: 12 })}${wordsHtml(s, words)}</div>`;
}

const t0 = performance.now();
let html = `<!doctype html><meta charset="utf-8"><title>Palimpsest scripts</title><link href="https://fonts.googleapis.com/css2?family=Gentium+Book+Plus:ital@0;1&display=swap" rel="stylesheet"><style>${css}</style>`;
html += `<h1>Palimpsest — writing systems</h1><div class="meta">seed “${seed}”</div>`;
html += `<h2>Invented scripts</h2>`;
const times: number[] = [];
SPECS.forEach((spec, i) => {
  const inv = INVENTORIES[spec.inv];
  const rng = new Rng(`${seed}/${i}`);
  const a = performance.now();
  const s = S.createScript(inv, rng, { id: `S${i + 1}`, kind: spec.kind, family: spec.family, tool: spec.tool, direction: spec.direction, bornYear: -1200 + i * 100 });
  times.push(performance.now() - a);
  const words = randomWords(inv, new Rng(`${seed}/words/${i}`), 7);
  html += card(s, `Script ${s.id} <span style="font-size:14px;color:#6b5a45">for a ${spec.inv} language</span>`, words);
});
// ---------------------------------------------------------------------------
// A family of scripts over three generations
// ---------------------------------------------------------------------------
html += `<h2>A script family over three generations</h2>`;
const fam: Script[] = [];
const famRng = new Rng(`${seed}/family`);
const rootInv = INVENTORIES.semitic;
const root = S.createScript(rootInv, famRng.fork("root"), { id: "Proto", kind: "abjad", family: "geometric", tool: "chisel", direction: "rtl", bornYear: -1500 });
fam.push(root);
const greekish = S.deriveScript(root, famRng.fork("a"), { id: "West", bornYear: -900, inventory: INVENTORIES.germanic, kind: "alphabet", tool: "pen", direction: "ltr", drift: 0.5 });
const aramaic = S.deriveScript(root, famRng.fork("b"), { id: "East", bornYear: -800, inventory: INVENTORIES.semitic, tool: "reed", drift: 0.7 });
const brahmi = S.deriveScript(root, famRng.fork("c"), { id: "South", bornYear: -600, inventory: INVENTORIES.indic, kind: "abugida", tool: "brush", direction: "ltr", drift: 0.6 });
fam.push(greekish, aramaic, brahmi);
const runic = S.deriveScript(greekish, famRng.fork("a1"), { id: "North", bornYear: -200, inventory: INVENTORIES.germanic, tool: "knife", drift: 0.6 });
const uncial = S.deriveScript(greekish, famRng.fork("a2"), { id: "Uncial", bornYear: 100, inventory: INVENTORIES.caucasian, tool: "brush", drift: 0.6 });
const square = S.deriveScript(aramaic, famRng.fork("b1"), { id: "Book", bornYear: -300, inventory: INVENTORIES.semitic, tool: "pen", drift: 0.5 });
const palm = S.deriveScript(brahmi, famRng.fork("c1"), { id: "Palm", bornYear: 200, inventory: INVENTORIES.indic, tool: "needle", drift: 0.6 });
const borrowed = S.adaptScript(palm, INVENTORIES.polynesian, famRng.fork("c2"), { id: "Island", bornYear: 600 });
fam.push(runic, uncial, square, palm, borrowed);
html += `<div class="card" id="tree">${S.familyTreeSVG(fam, { size: 26 })}</div>`;
html += `<div class="card" id="evo1"><div style="font-size:19px">West branch: Proto → West → North / Uncial</div>${S.evolutionTableSVG([root, greekish, runic, uncial], { size: 34, maxRows: 36, layout: "columns", wrap: 18 })}</div>`;
html += `<div class="card" id="evo2"><div style="font-size:19px">East and South: Proto → East → Book; Proto → South → Palm → Island</div>${S.evolutionTableSVG([root, aramaic, square, brahmi, palm, borrowed], { size: 34, maxRows: 36, layout: "columns", wrap: 18 })}</div>`;
for (const s of fam) {
  const inv = s.inventory;
  html += card(s, `${s.id} <span style="font-size:14px;color:#6b5a45">${s.bornYear}</span>`, randomWords(inv, new Rng(`${seed}/fw/${s.id}`), 6));
}
writeFileSync("out/script/demo.html", html);
console.log(`wrote out/script/demo.html in ${(performance.now() - t0).toFixed(0)} ms; create times: ${times.map((t) => t.toFixed(1)).join(", ")} ms`);
