// Visual demo of procedural writing systems.
//   npx tsx tools/script-demo.ts [seed]
//   node tools/shot.mjs out/script/demo.html out/script/demo.png 1400 1600 --full=1
//   zoom on one section: --selector="#S7" / "#tree" / "#evo1" / "#deep" / "#names" / "#dark"
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
.desc{font-size:14px;line-height:1.45;max-width:980px;margin:4px 0 10px}
.words{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:10px;align-items:flex-end}
.word{display:flex;flex-direction:column;align-items:center;gap:2px}
.word .r{font-size:13px;color:#6b5a45}
.flex{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.map{background:#e9dcb8;border-radius:8px;padding:6px;display:inline-block}
.dark{background:#0b0f1a;color:#d9d2c0;border-color:#24304a}
.dark .meta{color:#9aa3b8}
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

function card(s: Script, title: string, words: string[][], names?: { name: string; parentName?: string }): string {
  const meta = `${s.kind}${s.ortho.vowelMode !== "none" ? ` (${s.ortho.vowelMode})` : ""} · ${s.morph.family} family · ${s.style.tool} · ${s.direction} · ${s.glyphs.length} glyphs`;
  const desc = S.describeScript(s, names ?? { name: s.id }).sentences.join(" ");
  return `<div class="card" id="${s.id}"><div style="font-size:19px">${title}</div><div class="meta">${meta}</div><div class="desc">${desc}</div>${S.scriptChartSVG(s, { size: 34, columns: 12 })}${wordsHtml(s, words)}</div>`;
}

const t0 = performance.now();
let html = `<!doctype html><meta charset="utf-8"><title>Palimpsest scripts</title><link href="https://fonts.googleapis.com/css2?family=Gentium+Book+Plus:ital@0;1&display=swap" rel="stylesheet"><style>${css}</style>`;
html += `<h1>Palimpsest — writing systems</h1><div class="meta">seed “${seed}”</div>`;

// ---------------------------------------------------------------------------
// Invented scripts (fixed specs, then fully random ones)
// ---------------------------------------------------------------------------
html += `<h2>Invented scripts</h2>`;
const times: number[] = [];
const invented: Script[] = [];
SPECS.forEach((spec, i) => {
  const inv = INVENTORIES[spec.inv];
  const rng = new Rng(`${seed}/${i}`);
  const a = performance.now();
  const s = S.createScript(inv, rng, { id: `S${i + 1}`, kind: spec.kind, family: spec.family, tool: spec.tool, direction: spec.direction, bornYear: -1200 + i * 100 });
  times.push(performance.now() - a);
  invented.push(s);
  const words = randomWords(inv, new Rng(`${seed}/words/${i}`), 7);
  html += card(s, `Script ${s.id} <span style="font-size:14px;color:#6b5a45">for a ${spec.inv} language</span>`, words);
});
html += `<h2>Random scripts (no options)</h2>`;
const invNames = Object.keys(INVENTORIES);
for (let i = 0; i < 6; i++) {
  const invName = invNames[(i * 5 + 2) % invNames.length];
  const inv = INVENTORIES[invName];
  const s = S.createScript(inv, new Rng(`${seed}/random/${i}`), { id: `R${i + 1}` });
  html += card(s, `Script ${s.id} <span style="font-size:14px;color:#6b5a45">for a ${invName} language</span>`, randomWords(inv, new Rng(`${seed}/rw/${i}`), 6));
}

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
const famNames: Record<string, string> = { Proto: "Old Keshi", West: "Varan", East: "Hushet", South: "Ombrai", North: "Thrall runes", Uncial: "Varan book hand", Book: "Hushet square", Palm: "Ombrai leaf hand", Island: "Tavu" };
html += `<div class="card" id="tree">${S.familyTreeSVG(fam, { size: 26, labels: Object.fromEntries(fam.map((s) => [s.id, `${famNames[s.id]} · ${s.bornYear}`])) })}</div>`;
html += `<div class="card" id="evo1"><div style="font-size:19px">West branch: ${famNames.Proto} → ${famNames.West} → ${famNames.North} / ${famNames.Uncial}</div>${S.evolutionTableSVG([root, greekish, runic, uncial], { size: 34, maxRows: 36, layout: "columns", wrap: 18, headings: [root, greekish, runic, uncial].map((s) => `${famNames[s.id]} · ${s.bornYear}`) })}</div>`;
html += `<div class="card" id="evo2"><div style="font-size:19px">East and South</div>${S.evolutionTableSVG([root, aramaic, square, brahmi, palm, borrowed], { size: 34, maxRows: 36, layout: "columns", wrap: 18, headings: [root, aramaic, square, brahmi, palm, borrowed].map((s) => `${famNames[s.id]} · ${s.bornYear}`) })}</div>`;
for (const s of fam) {
  const parent = fam.find((p) => p.id === s.parent);
  html += card(s, `${famNames[s.id]} <span style="font-size:14px;color:#6b5a45">${s.bornYear}</span>`, randomWords(s.inventory, new Rng(`${seed}/fw/${s.id}`), 6), {
    name: famNames[s.id],
    parentName: parent ? famNames[parent.id] : undefined,
  });
}

// ---------------------------------------------------------------------------
// One lineage over many generations (how far letters drift)
// ---------------------------------------------------------------------------
html += `<h2>One lineage over seven generations</h2>`;
const chainInvs = ["semitic", "semitic", "germanic", "germanic", "caucasian", "nasal", "germanic"];
const chain: Script[] = [S.createScript(INVENTORIES[chainInvs[0]], new Rng(`${seed}/chain`), { id: "G0", kind: "abjad", family: "square", tool: "reed", direction: "rtl", bornYear: -2000 })];
for (let g = 1; g < chainInvs.length; g++) {
  const prev = chain[g - 1];
  chain.push(S.deriveScript(prev, new Rng(`${seed}/chain/${g}`), { id: `G${g}`, bornYear: prev.bornYear + 350, inventory: INVENTORIES[chainInvs[g]], drift: 0.65 }));
}
html += `<div class="card" id="deep"><div class="meta">${chain.map((s) => `${s.id}: ${s.kind}, ${s.style.tool}, ${s.direction}`).join(" → ")}</div>${S.evolutionTableSVG(chain, { size: 30, maxRows: 22, layout: "rows" })}</div>`;

// ---------------------------------------------------------------------------
// Place names: romanisation with the native spelling beneath (map labels)
// ---------------------------------------------------------------------------
html += `<h2>Place names in native script</h2>`;
const placeScripts: Script[] = [invented[0], invented[1], invented[2], invented[3], invented[6], invented[7], invented[11], invented[13]];
let labels = "";
placeScripts.forEach((s, i) => {
  const inv = s.inventory;
  const nameWords = randomWords(inv, new Rng(`${seed}/place/${i}`), 2).map((w) => (w.length < 4 ? [...w, ...randomWords(inv, new Rng(`${seed}/pl2/${i}`), 1)[0]] : w));
  const words = i % 3 === 0 ? nameWords : [nameWords[0]];
  const roman = words.map(romanize).join(" ");
  const o = S.textOutline(s, words, { size: 22, horizontal: true, salt: i });
  const W = Math.max(o.width, roman.length * 9.5) + 24;
  const H = o.height + 40;
  const ox = (W - o.width) / 2;
  labels +=
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="margin:6px 14px">` +
    `<circle cx="${W / 2}" cy="8" r="3.5" fill="#5a3b1d"/>` +
    `<text x="${W / 2}" y="30" text-anchor="middle" font-family="'Gentium Book Plus',Georgia,serif" font-size="17" fill="#2a1d10" stroke="#e9dcb8" stroke-width="3" paint-order="stroke">${roman}</text>` +
    `<g transform="translate(${ox} 36)"><path d="${o.d}" fill="#5a3b1d" stroke="#e9dcb8" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round"/></g></svg>`;
});
html += `<div class="card" id="names"><div class="meta">Each label: the romanised name, and beneath it the same name in its people's script (wordOutline / textOutline, as a map would draw it; vertical scripts set on the line).</div><div class="map">${labels}</div></div>`;

// ---------------------------------------------------------------------------
// Theme neutrality: default chart colours on a dark page
// ---------------------------------------------------------------------------
html += `<h2>Default colours on a dark page</h2>`;
html += `<div class="card dark" id="dark"><div class="meta">Charts, trees and words with default options inherit currentColor.</div>${S.scriptChartSVG(invented[4], { size: 28, columns: 14 })}<div style="margin-top:10px">${S.familyTreeSVG(fam.slice(0, 4), { size: 22 })}</div><div class="words">${randomWords(invented[2].inventory, new Rng("dk"), 5)
  .map((w) => S.renderWordSVG(invented[2], w, { size: 30 }))
  .join("")}</div></div>`;

writeFileSync("out/script/demo.html", html);
console.log(`wrote out/script/demo.html in ${(performance.now() - t0).toFixed(0)} ms; create times: ${times.map((t) => t.toFixed(1)).join(", ")} ms`);
