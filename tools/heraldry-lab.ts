// Heraldry lab: focused visual test sheets for development.
//
//   npx tsx tools/heraldry-lab.ts <set> [--size=130] [--shape=heater] [--out=out/heraldry/lab.html]
//   npx tsx tools/heraldry-shots.ts out/heraldry/lab.html out/heraldry/lab "#lab=lab"
//
// Sets: lines (every line on every ordinary/division), coats (hand-built problem coats; JSON per line in
// --file=...), random:<style>:<n>:<seed> (a style's roll with blazons).
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { renderArmsSVG, blazon, generateArms, LINES, STYLES, type Arms, type SimpleArms, type ShieldShape, type OrdinaryKind, type Partition, type StyleName } from "../src/heraldry";

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.join("=") || "1"]; }));
const set = argv.find((a) => !a.startsWith("--")) ?? "lines";
const size = +(flags.size ?? 130);
const shape = (flags.shape ?? "heater") as ShieldShape;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const S = (x: Omit<SimpleArms, "kind">): SimpleArms => ({ kind: "simple", ...x });

let body = "";
const cell = (a: Arms, cap?: string, sh: ShieldShape = shape) =>
  `<figure>${renderArmsSVG(a, { size, shape: sh })}<figcaption>${esc(cap ?? blazon(a))}</figcaption></figure>`;

if (set === "lines") {
  const ords: OrdinaryKind[] = (flags.ords?.split(",") as OrdinaryKind[]) ?? ["fess", "pale", "bend", "chevron", "cross", "saltire", "pall", "pile", "chevronReversed", "pallReversed", "orle", "base"];
  const divs: Partition[] = (flags.divs?.split(",") as Partition[]) ?? ["perFess", "perBend", "perChevron", "perSaltire", "perPall", "barry", "bendy"];
  const lines = (flags.lines?.split(",") ?? LINES) as (typeof LINES)[number][];
  body += `<table><tr><th></th>${lines.map((l) => `<th>${l}</th>`).join("")}</tr>`;
  for (const o of ords) {
    body += `<tr><th>${o}</th>`;
    for (const line of lines) body += `<td>${renderArmsSVG(S({ field: { partition: "plain", tinctures: ["vert"] }, ordinary: { kind: o, tincture: "or", line } }), { size, shape })}</td>`;
    body += `</tr>`;
  }
  for (const d of divs) {
    body += `<tr><th>${d}</th>`;
    for (const line of lines) body += `<td>${renderArmsSVG(S({ field: { partition: d, tinctures: d === "perPall" ? ["argent", "gules", "azure"] : ["argent", "azure"], line } }), { size, shape })}</td>`;
    body += `</tr>`;
  }
  body += `</table>`;
} else if (set === "coats") {
  const src = readFileSync(flags.file ?? "out/heraldry/lab-coats.jsonl", "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  body += `<div class="g">`;
  for (const l of src) {
    const [json, sh] = l.split("\t");
    const a = JSON.parse(json) as Arms;
    body += cell(a, undefined, (sh as ShieldShape) ?? shape);
  }
  body += `</div>`;
} else if (set.startsWith("random")) {
  const [, st = "anglo", n = "24", seed = "lab"] = set.split(":");
  const rng = new Rng(seed);
  body += `<div class="g">`;
  for (let i = 0; i < +n; i++) {
    const a = generateArms(rng.fork("c" + i), { style: st as StyleName });
    body += cell(a, blazon(a) + (a.exception ? ` [${a.exception}]` : ""), (flags.shape as ShieldShape) ?? STYLES[st as StyleName].shape);
  }
  body += `</div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#efe8dc;margin:10px;font:11px Georgia,serif;color:#333}
table{border-collapse:collapse}td,th{padding:3px;text-align:center;font-weight:normal}th{font-size:11px}
.g{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:${size + 40}px;text-align:center}figcaption{font-size:10.5px;line-height:1.25}
</style></head><body><div id="lab">${body}</div></body></html>`;
mkdirSync("out/heraldry", { recursive: true });
const out = flags.out ?? "out/heraldry/lab.html";
writeFileSync(out, html);
console.log("wrote", out, (html.length / 1024).toFixed(0) + " KB");
