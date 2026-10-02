// Scratch renderer for hand-built arms (development aid).
//   npx tsx tools/heraldry-scratch.ts && node tools/shot.mjs out/heraldry/scratch.html out/heraldry/scratch.png 1400 900 --full=1
import { writeFileSync, mkdirSync } from "node:fs";
import { renderArmsSVG } from "../src/heraldry/render";
import type { Arms, ShieldShape } from "../src/heraldry/types";

const A = (x: Omit<Extract<Arms, { kind: "simple" }>, "kind">): Arms => ({ kind: "simple", ...x });
const list: [Arms, ShieldShape?][] = [
  [A({ field: { partition: "perPale", tinctures: ["or", "vert"] }, charges: { charge: "mullet", count: 1, tincture: "gules" } })],
  [A({ field: { partition: "plain", tinctures: ["azure"] }, ordinary: { kind: "bend", tincture: "or", line: "wavy" }, charges: { charge: "mullet", count: 2, tincture: "argent", points: 6 } })],
  [A({ field: { partition: "quarterly", tinctures: ["or", "gules"] } })],
  [A({ field: { partition: "gyronny", tinctures: ["or", "sable"] } })],
  [A({ field: { partition: "barry", tinctures: ["argent", "azure"], line: "wavy", count: 6 } })],
  [A({ field: { partition: "chequy", tinctures: ["or", "azure"] }, chief: { tincture: "gules", charges: { charge: "fleurDeLis", count: 3, tincture: "or" } } })],
  [A({ field: { partition: "lozengy", tinctures: ["argent", "gules"] } })],
  [A({ field: { partition: "perChevron", tinctures: ["gules", "argent"], line: "engrailed" } })],
  [A({ field: { partition: "plain", tinctures: ["gules"] }, ordinary: { kind: "chevron", tincture: "argent" }, charges: { charge: "crossPatty", count: 3, tincture: "argent" } })],
  [A({ field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "fess", tincture: "sable", line: "indented" }, charges: { charge: "escallop", count: 3, tincture: "gules" } })],
  [A({ field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "cross", tincture: "gules", line: "engrailed" }, charges: { charge: "roundel", count: 4, tincture: "azure" } })],
  [A({ field: { partition: "plain", tinctures: ["ermine"] }, ordinary: { kind: "saltire", tincture: "gules" } })],
  [A({ field: { partition: "plain", tinctures: ["vair"] }, ordinary: { kind: "pale", tincture: "gules", charges: { charge: "mullet", count: 3, tincture: "or" } } })],
  [A({ field: { partition: "plain", tinctures: ["azure"] }, ordinary: { kind: "pall", tincture: "argent" }, charges: { charge: "crescent", count: 3, tincture: "or" } })],
  [A({ field: { partition: "plain", tinctures: ["sable"] }, ordinary: { kind: "pile", tincture: "or" }, bordure: { tincture: "gules", line: "engrailed" } })],
  [A({ field: { partition: "perBend", tinctures: ["argent", "purpure"], line: "nebuly" } })],
  [A({ field: { partition: "plain", tinctures: ["gules"] }, ordinary: { kind: "fess", tincture: "or", line: "embattled" } })],
  [A({ field: { partition: "plain", tinctures: ["vert"] }, ordinary: { kind: "bend", tincture: "argent", cotised: true, charges: { charge: "fleurDeLis", count: 3, tincture: "vert" } } })],
  [A({ field: { partition: "paly", tinctures: ["or", "gules"], count: 6 }, canton: { tincture: "ermine" } })],
  [A({ field: { partition: "bendy", tinctures: ["or", "azure"], count: 6 }, bordure: { tincture: "gules", charges: { charge: "roundel", count: 8, tincture: "or" } } })],
  [A({ field: { partition: "perSaltire", tinctures: ["or", "gules"] } })],
  [A({ field: { partition: "perPall", tinctures: ["gules", "or", "azure"] } })],
  [A({ field: { partition: "plain", tinctures: ["azure"] }, semy: { charge: "fleurDeLis", tincture: "or" } }), "french"],
  [A({ field: { partition: "chevronny", tinctures: ["argent", "sable"], count: 6 } }), "iberian"],
  [A({ field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "chevron", tincture: "sable", count: 3 } }), "german"],
  [A({ field: { partition: "plain", tinctures: ["gules"] }, ordinary: { kind: "orle", tincture: "or" }, charges: { charge: "annulet", count: 1, tincture: "argent" } }), "oval"],
  [A({ field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "fess", tincture: "azure", count: 2, line: "wavy" } }), "lozenge"],
  [A({ field: { partition: "perFess", tinctures: ["azure", "or"], line: "dancetty" }, charges: { charge: "crossCrosslet", count: 3, tincture: "or", counterchanged: true } }), "round"],
  [A({ field: { partition: "plain", tinctures: ["purpure"] }, ordinary: { kind: "fret", tincture: "or" } }), "swiss"],
  [A({ field: { partition: "plain", tinctures: ["sable"] }, ordinary: { kind: "saltire", tincture: "argent", line: "raguly" }, difference: [{ mark: "label", tincture: "gules" }] })],
  [{ kind: "marshalled", method: "quarterly", coats: [
    A({ field: { partition: "plain", tinctures: ["gules"] }, charges: { charge: "crossPatty", count: 3, tincture: "or" } }),
    A({ field: { partition: "barry", tinctures: ["argent", "azure"], count: 6 } }),
    A({ field: { partition: "barry", tinctures: ["argent", "azure"], count: 6 } }),
    A({ field: { partition: "plain", tinctures: ["gules"] }, charges: { charge: "crossPatty", count: 3, tincture: "or" } }),
  ], escutcheon: A({ field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "chevron", tincture: "gules" } }) }],
  [{ kind: "marshalled", method: "impaled", coats: [
    A({ field: { partition: "plain", tinctures: ["azure"] }, charges: { charge: "fleurDeLis", count: 3, tincture: "or" } }),
    A({ field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "pale", tincture: "gules", count: 3 } }),
  ] }],
  [A({ field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "chevronReversed", tincture: "azure" }, charges: { charge: "mullet", count: 3, tincture: "gules" } })],
  [A({ field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "pallReversed", tincture: "vert" } , bordure: { tincture: "gules", compony: "argent" }})],
  [A({ field: { partition: "tiercedInPale", tinctures: ["azure", "argent", "gules"] }, ordinary: { kind: "base", tincture: "vert", line: "wavy" } })],
  [A({ field: { partition: "plain", tinctures: ["gules"] }, charges: { charge: "mullet", count: 6, tincture: "argent" }, ordinary: undefined }), "heater"],
];
let html = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#e9e4d8;margin:12px;font:12px sans-serif}.g{display:flex;flex-wrap:wrap;gap:14px}</style></head><body><div class="g">`;
for (const [a, shape] of list) html += `<div>${renderArmsSVG(a, { size: 150, shape: shape ?? "heater" })}</div>`;
html += `</div></body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync("out/heraldry/scratch.html", html);
console.log("ok", html.length);
