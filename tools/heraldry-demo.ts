// Heraldry showcase: every capability of src/heraldry on one page.
//
//   npx tsx tools/heraldry-demo.ts [seed] [--only=sectionId,...]
//   node tools/shot.mjs out/heraldry/demo.html out/heraldry/demo.png 1500 1000 --full=1
//   node tools/shot.mjs out/heraldry/demo.html out/heraldry/demo-rolls.png 1500 1000 --selector=#rolls
//
// Sections: rolls, canting, cadency, marshalling, field, lines, ordinaries, charges, shields, sizes, flags,
// banners, mon, seals, icons.
import { writeFileSync, mkdirSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { EMBLEM_CONCEPTS } from "../src/world/concepts";
import {
  generateArms, blazon, renderArmsSVG, differenceArms, marshalArms, cantingCharges, STYLES, randomStyle,
  generateEmblem, renderEmblemSVG, differenceEmblem, marshalEmblems, describeEmblem, generateFlag, renderFlagSVG,
  describeFlag, FLAG_PATTERNS, generateBanner, renderBannerSVG, describeBanner, BANNER_SHAPES, generateMon,
  renderMonSVG, describeMon, differenceMon, generateSeal, renderSealSVG, describeSeal, SEAL_MATERIALS, ALL_CHARGE_IDS,
  chargeDef, CADENCY_ORDER, PARTITIONS, LINES, ORDINARIES, SHIELD_SHAPES, FURS, renderChargeSVG,
  type Arms, type SimpleArms, type StyleName, type Tint, type ShieldShape, type HeraldryStyle,
} from "../src/heraldry";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const seed = args.find((a) => !a.startsWith("--")) ?? "palimpsest";
const only = flags.only ? new Set(flags.only.split(",")) : null;
const rng = new Rng(seed);
const STYLE_NAMES = Object.keys(STYLES) as StyleName[];
const t0 = Date.now();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const card = (svg: string, caption: string, sub = "", w = 0) =>
  `<figure class="card"${w ? ` style="width:${w}px"` : ""}>${svg}<figcaption>${sub ? `<b>${esc(sub)}</b> ` : ""}${esc(caption)}</figcaption></figure>`;
const sections: [string, string, string, () => string][] = [];
const section = (id: string, title: string, intro: string, body: () => string) => sections.push([id, title, intro, body]);
const plain = (t: Tint): SimpleArms => ({ kind: "simple", field: { partition: "plain", tinctures: [t] } });

// ---------------------------------------------------------------------------

section("rolls", "Rolls of arms", "Twelve coats from each heraldic tradition, generated with its tastes in tinctures, divisions, charges and shield shape, and blazoned in English.", () => {
  let s = "";
  const styles: [string, HeraldryStyle | StyleName][] = STYLE_NAMES.map((n) => [n, n]);
  styles.push(["invented: “Velmarri”", randomStyle(rng.fork("inv1"), "velmarri")], ["invented: “Ashkar”", randomStyle(rng.fork("inv2"), "ashkar")]);
  for (const [name, style] of styles) {
    const shape = typeof style === "string" ? STYLES[style].shape : style.shape;
    s += `<h3>${esc(name)}</h3><div class="grid g6">`;
    for (let i = 0; i < 12; i++) {
      const a = generateArms(rng.fork(`roll-${name}-${i}`), { style });
      s += card(renderArmsSVG(a, { size: 150, shape }), blazon(a) + (a.exception ? ` [${a.exception}]` : ""));
    }
    s += `</div>`;
  }
  return s;
});

section("canting", "Canting arms", "Houses whose names pun on a charge bear it. The same name gives arms, a banner, a mon and a seal in four traditions.", () => {
  const names: [string, string][] = [
    ["Varrakel", "Wolf-spear"], ["Tor Oshen", "Stone Ford"], ["Kešdavar", "Red Tower"], ["Hrafnhol", "Raven's Hill"],
    ["Eikvald", "Oak Crown"], ["Naurhaven", "Ship Haven"], ["Sól Ennar", "Sun Gate"], ["Brandmere", "Fire Lake"],
  ];
  let s = `<div class="rows">`;
  names.forEach(([roman, gloss], i) => {
    const words = gloss.split(/[\s-]+/);
    const st = STYLE_NAMES[i % STYLE_NAMES.length];
    const r = rng.fork("cant" + i);
    const arms = generateEmblem(r.fork("a"), { kind: "arms", style: st, gloss: words });
    const ban = generateEmblem(r.fork("b"), { kind: "banner", style: st, gloss: words });
    const mon = generateEmblem(r.fork("m"), { kind: "mon", gloss: words });
    const seal = generateEmblem(r.fork("s"), { kind: "seal", gloss: words, legend: roman });
    s += `<div class="row"><div class="name"><b>${roman}</b><br><i>“${gloss}”</i><br><small>cants on: ${cantingCharges(words).join(", ")}</small></div>`;
    for (const e of [arms, ban, mon, seal]) s += card(renderEmblemSVG(e, { size: 150, shape: STYLES[st].shape }), e.blazon, e.kind, 190);
    s += `</div>`;
  });
  return s + `</div>`;
});

section("cadency", "A house and its cadets", "The head of the house; the heir with a label; younger sons with the English brisures (crescent for the second son, mullet for the third…); cadet branches differenced by bordure, tincture, line, canton and baston; then a mon house's branches.", () => {
  const head = generateArms(rng.fork("house"), { style: "anglo", motifs: ["lion"], motifChance: 1 });
  let s = `<div class="grid g6">` + card(renderArmsSVG(head, { size: 150 }), blazon(head), "Head of the house");
  s += card(renderArmsSVG(differenceArms(head, rng.fork("heir"), "label"), { size: 150 }), blazon(differenceArms(head, rng.fork("heir"), "label")), "Heir");
  CADENCY_ORDER.forEach((_, i) => {
    const d = differenceArms(head, rng.fork("son" + i), "brisure", i + 2);
    s += card(renderArmsSVG(d, { size: 150 }), blazon(d), `${["2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"][i]} son`);
  });
  for (const k of ["bordure", "tincture", "line", "canton", "bendlet"] as const) {
    const d = differenceArms(head, rng.fork("k" + k), k);
    s += card(renderArmsSVG(d, { size: 150 }), blazon(d), `cadet (${k})`);
  }
  // Second generation: a cadet of a cadet.
  const c1 = differenceArms(head, rng.fork("g1"), "bordure");
  const c2 = differenceArms(c1, rng.fork("g2"), "brisure", 3);
  s += card(renderArmsSVG(c2, { size: 150 }), blazon(c2), "3rd son of a cadet");
  s += `</div><h3>Branches of a mon house</h3><div class="grid g8">`;
  const mon = generateMon(rng.fork("monhouse"), { motifs: ["feather"] });
  s += card(renderMonSVG(mon, { size: 120, background: "disc" }), describeMon(mon), "main line");
  let cur = mon;
  for (let i = 0; i < 7; i++) {
    const d = differenceMon(i < 4 ? mon : cur, rng.fork("mb" + i));
    cur = d;
    s += card(renderMonSVG(d, { size: 120, background: "disc" }), describeMon(d), `branch ${i + 1}`);
  }
  return s + `</div>`;
});

section("marshalling", "Marshalling", "Realms united in one crown quarter their arms; marriages impale; an heiress's arms ride over all on an escutcheon of pretence; grand quarters when more than four coats meet.", () => {
  const coats = [0, 1, 2, 3, 4].map((i) => generateArms(rng.fork("mc" + i), { style: STYLE_NAMES[(i * 3) % STYLE_NAMES.length] }));
  const items: [Arms, string][] = [
    [coats[0], "first realm"], [coats[1], "second realm"], [marshalArms([coats[0], coats[1]]), "union of two realms"],
    [marshalArms([coats[0], coats[2]], { method: "impaled" }), "a marriage"], [marshalArms([coats[0], coats[1], coats[2]]), "three realms"],
    [marshalArms(coats.slice(0, 4), { escutcheon: coats[4] }), "four realms, an elected king's arms over all"],
    [marshalArms(coats), "five realms (grand quarters)"], [marshalArms([coats[3]], { escutcheon: coats[2] }), "an heiress's arms in pretence"],
    [marshalArms([coats[1], coats[3]], { method: "perFess" }), "per fess"],
    [differenceArms(marshalArms([coats[0], coats[1]]), rng.fork("ml"), "label"), "the union's heir"],
  ];
  let s = `<div class="grid g5">`;
  for (const [a, cap] of items) s += card(renderArmsSVG(a, { size: 190 }), blazon(a), cap);
  const e1 = generateEmblem(rng.fork("me1"), { kind: "banner", style: "germanic" }), e2 = generateEmblem(rng.fork("me2"), { kind: "seal", arms: coats[2], legend: "Ondrek" });
  const me = marshalEmblems([e1, e2]);
  s += card(renderEmblemSVG(me, { size: 190 }), me.blazon, "banner of a union");
  return s + `</div>`;
});

section("field", "The field", "Divisions and variations of the field, and the furs.", () => {
  let s = `<div class="grid g9">`;
  const pal: Tint[][] = [["azure", "or"], ["gules", "argent"], ["sable", "or"], ["vert", "argent"], ["argent", "gules", "azure"]];
  PARTITIONS.forEach((p, i) => {
    const three = p === "perPall" || p === "tiercedInPale" || p === "tiercedInFess";
    const a: SimpleArms = { kind: "simple", field: { partition: p, tinctures: three ? pal[4] : pal[i % 4] } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  });
  for (const fur of FURS) {
    const a = plain(fur);
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  return s + `</div>`;
});

section("lines", "Lines of partition", "Every line, on a division, an ordinary and a bordure.", () => {
  let s = `<div class="grid g9">`;
  for (const l of LINES) {
    const a: SimpleArms = { kind: "simple", field: { partition: "perFess", tinctures: ["gules", "or"], line: l } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  for (const l of LINES) {
    const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "bend", tincture: "azure", line: l } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  for (const l of LINES) {
    const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: ["vert"] }, ordinary: { kind: "chevron", tincture: "or", line: l } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  for (const l of LINES) {
    const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: ["azure"] }, ordinary: { kind: "cross", tincture: "argent", line: l } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  for (const l of LINES) {
    const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "saltire", tincture: "gules", line: l } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  for (const l of LINES) {
    const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, bordure: { tincture: "sable", line: l }, chief: { tincture: "gules", line: l } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  }
  return s + `</div>`;
});

section("ordinaries", "Ordinaries", "The honourable ordinaries, their diminutives, cotised and charged.", () => {
  let s = `<div class="grid g9">`;
  const tints: [Tint, Tint][] = [["or", "gules"], ["argent", "azure"], ["gules", "or"], ["azure", "argent"], ["sable", "or"], ["vert", "argent"]];
  ORDINARIES.forEach((k, i) => {
    const [f, o] = tints[i % tints.length];
    const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: [f] }, ordinary: { kind: k, tincture: o } };
    s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  });
  const extra: SimpleArms[] = [
    { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "fess", tincture: "gules", count: 2 } },
    { kind: "simple", field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "chevron", tincture: "sable", count: 3 } },
    { kind: "simple", field: { partition: "plain", tinctures: ["azure"] }, ordinary: { kind: "bend", tincture: "or", count: 3 } },
    { kind: "simple", field: { partition: "plain", tinctures: ["gules"] }, ordinary: { kind: "pale", tincture: "argent", count: 3 } },
    { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "bend", tincture: "sable", cotised: true } },
    { kind: "simple", field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "pile", tincture: "azure", count: 3 } },
    { kind: "simple", field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "fess", tincture: "azure", charges: { charge: "mullet", count: 3, tincture: "or" } }, charges: { charge: "crossCrosslet", count: 6, tincture: "azure" } },
    { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "chevron", tincture: "gules", charges: { charge: "escallop", count: 3, tincture: "or" } }, charges: { charge: "martlet", count: 3, tincture: "sable" } },
    { kind: "simple", field: { partition: "plain", tinctures: ["azure"] }, ordinary: { kind: "cross", tincture: "or", charges: { charge: "roundel", count: 5, tincture: "gules" } } },
    { kind: "simple", field: { partition: "plain", tinctures: ["gules"] }, ordinary: { kind: "saltire", tincture: "argent", charges: { charge: "rose", count: 1, tincture: "gules" } }, charges: { charge: "wheat", count: 4, tincture: "or" } },
    { kind: "simple", field: { partition: "plain", tinctures: ["vert"] }, ordinary: { kind: "bend", tincture: "argent", charges: { charge: "lion", count: 3, tincture: "sable", attitude: "passant" } } },
    { kind: "simple", field: { partition: "plain", tinctures: ["sable"] }, ordinary: { kind: "pale", tincture: "or", charges: { charge: "key", count: 3, tincture: "sable" } }, charges: { charge: "tower", count: 2, tincture: "argent" } },
    { kind: "simple", field: { partition: "perPale", tinctures: ["argent", "gules"] }, ordinary: { kind: "chevron", tincture: "argent", counterchanged: true } },
    { kind: "simple", field: { partition: "plain", tinctures: ["or"] }, ordinary: { kind: "orle", tincture: "azure" }, charges: { charge: "eagle", count: 1, tincture: "sable" } },
    { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, canton: { tincture: "gules", charge: { charge: "lion", count: 1, tincture: "or" } }, ordinary: { kind: "fess", tincture: "azure", count: 2 } },
    { kind: "simple", field: { partition: "plain", tinctures: ["azure"] }, chief: { tincture: "or", charges: { charge: "eagle", count: 1, tincture: "sable" } }, charges: { charge: "fleurDeLis", count: 3, tincture: "or" } },
    { kind: "simple", field: { partition: "plain", tinctures: ["gules"] }, bordure: { tincture: "argent", compony: "azure" }, charges: { charge: "castle", count: 1, tincture: "or" } },
    { kind: "simple", field: { partition: "plain", tinctures: ["or"] }, bordure: { tincture: "gules", charges: { charge: "castle", count: 8, tincture: "or" } }, charges: { charge: "lion", count: 1, tincture: "purpure" } },
  ];
  for (const a of extra) s += card(renderArmsSVG(a, { size: 110 }), blazon(a));
  return s + `</div>`;
});

section("charges", "Charges", "Every charge — all of the world's emblem concepts and the classic heraldic charges — large, in each attitude.", () => {
  let s = `<div class="grid g8">`;
  const tints: [Tint, Tint][] = [["gules", "or"], ["azure", "argent"], ["argent", "sable"], ["or", "vert"], ["sable", "or"], ["vert", "argent"], ["argent", "gules"], ["purpure", "or"]];
  let i = 0;
  for (const id of ALL_CHARGE_IDS) {
    const def = chargeDef(id);
    for (const att of def.attitudes ?? [undefined]) {
      const [f, c] = tints[i++ % tints.length];
      const a: SimpleArms = { kind: "simple", field: { partition: "plain", tinctures: [f] }, charges: { charge: id, count: 1, tincture: c, attitude: att } };
      s += card(renderArmsSVG(a, { size: 140 }), blazon(a));
    }
  }
  return s + `</div>`;
});

section("shields", "Shields and finishes", "One coat on every shield shape; then the rich, flat and hatched (Petra Sancta) finishes, and the flat palette.", () => {
  const a = generateArms(rng.fork("shields"), { style: "baroque", complexity: 0.6 });
  let s = `<p class="blazon">${esc(blazon(a))}</p><div class="grid g10">`;
  for (const shape of SHIELD_SHAPES) s += card(renderArmsSVG(a, { size: 120, shape }), shape);
  s += `</div><div class="grid g5">`;
  const b = marshalArms([generateArms(rng.fork("sh2"), { style: "iberian" }), generateArms(rng.fork("sh3"), { style: "germanic" })]);
  for (const [opts, cap] of [[{ finish: "rich", texture: true }, "rich, textured"], [{ finish: "rich" }, "rich"], [{ finish: "flat" }, "flat"], [{ finish: "hatched" }, "hatched"], [{ palette: "flat", finish: "flat" }, "flat palette"]] as const) {
    s += card(renderArmsSVG(b, { size: 230, ...opts }), cap);
  }
  return s + `</div>`;
});

section("sizes", "Sizes", "From encyclopedia plate down to map marker: detail lines drop out and outlines thicken as the shield shrinks.", () => {
  const items = [0, 1, 2].map((i) => generateEmblem(rng.fork("sz" + i), { kind: "arms", style: STYLE_NAMES[i * 2] }));
  items.push(generateEmblem(rng.fork("szb"), { kind: "banner", style: "steppe" }), generateEmblem(rng.fork("szm"), { kind: "mon" }), generateEmblem(rng.fork("szs"), { kind: "seal", legend: "Hasvald" }));
  let s = "";
  for (const e of items) {
    s += `<div class="sizes">`;
    for (const size of [260, 140, 72, 40, 24, 16]) s += `<span>${renderEmblemSVG(e, { size })}</span>`;
    s += `</div>`;
  }
  return s;
});

section("flags", "Flags", "Vexillological designs: every pattern once, then flags derived from realms' arms (livery colours and principal charge).", () => {
  let s = `<div class="grid g6">`;
  FLAG_PATTERNS.forEach((p, i) => {
    const st = STYLE_NAMES[i % STYLE_NAMES.length];
    const arms = generateArms(rng.fork("fa" + i), { style: st });
    const fl = generateFlag(rng.fork("fl" + i), { arms, style: st, pattern: p });
    s += card(renderFlagSVG(fl, { size: 200 }), describeFlag(fl), p);
  });
  for (let i = 0; i < 7; i++) {
    const st = STYLE_NAMES[i % STYLE_NAMES.length];
    const arms = generateArms(rng.fork("fx" + i), { style: st });
    const fl = generateFlag(rng.fork("fy" + i), { arms, style: st });
    s += `<figure class="card pair">${renderArmsSVG(arms, { size: 70, shape: STYLES[st].shape })}${renderFlagSVG(fl, { size: 150 })}<figcaption>${esc(describeFlag(fl))}</figcaption></figure>`;
  }
  return s + `</div>`;
});

section("banners", "Banners", "Arms carried on cloth: banners of arms, tailed gonfanons, fringed vexilla, pennons, standards and the tall nobori.", () => {
  let s = `<div class="flexrow">`;
  for (let i = 0; i < 12; i++) {
    const st = STYLE_NAMES[i % STYLE_NAMES.length];
    const b = generateBanner(rng.fork("bn" + i), { style: st, shape: BANNER_SHAPES[i % BANNER_SHAPES.length] });
    s += card(renderBannerSVG(b, { size: 260 }), describeBanner(b), "", 300);
  }
  return s + `</div>`;
});

section("mon", "Mon", "Radial monochrome crests in the manner of kamon: commas, blossoms, leaves, crossed and radiating charges, creatures face to face, geometric figures — and a mon canting on each emblem concept.", () => {
  let s = `<div class="grid g10">`;
  for (const c of EMBLEM_CONCEPTS) {
    const m = generateMon(rng.fork("mon" + c), { motifs: [c] });
    s += card(renderMonSVG(m, { size: 112, background: "disc" }), describeMon(m), c);
  }
  for (let i = 0; i < 14; i++) {
    const m = generateMon(rng.fork("mona" + i), { abstraction: 1 });
    s += card(renderMonSVG(m, { size: 112, background: "disc" }), describeMon(m));
  }
  return s + `</div>`;
});

section("seals", "Seals", "Seals in wax, metal and vermilion: a device, a shield of arms or a mon, within a legend.", () => {
  const legends = ["Sigillum Kešdavar Regis", "Tor Oshen", "Velmarra Ashkari", "Sigillum Communitatis Urbis Olvenna", "Ondrek", "Brotherhood of the Burning Star", "", "Hasvald son of Hrom"];
  let s = `<div class="grid g6">`;
  for (let i = 0; i < 18; i++) {
    const r = rng.fork("seal" + i);
    const kind = i % 3;
    const seal = generateSeal(r, {
      legend: legends[i % legends.length] || undefined,
      arms: kind === 1 ? generateArms(r.fork("a"), { style: STYLE_NAMES[i % STYLE_NAMES.length] }) : undefined,
      mon: kind === 2 && i % 2 ? generateMon(r.fork("m")) : undefined,
      ecclesiastical: i === 5 || i === 11,
      material: SEAL_MATERIALS[i % SEAL_MATERIALS.length],
    });
    s += card(renderSealSVG(seal, { size: 190 }), describeSeal(seal));
  }
  return s + `</div>`;
});

section("icons", "Icons", "Stand-alone charge icons (for religions, legends and pickers) and emblems at list size.", () => {
  let s = `<div class="icons">`;
  const fields: Tint[] = ["azure", "gules", "sable", "vert", "purpure", "argent", "or"];
  ALL_CHARGE_IDS.forEach((id, i) => {
    const field = fields[i % fields.length];
    const t: Tint = field === "argent" || field === "or" ? "sable" : i % 2 ? "or" : "argent";
    s += `<span title="${id}">${renderChargeSVG({ charge: id, tincture: t, field, frame: i % 2 ? "disc" : "tile", size: 44 })}</span>`;
  });
  s += `</div><div class="icons">`;
  for (let i = 0; i < 40; i++) s += `<span>${renderEmblemSVG(generateEmblem(rng.fork("ic" + i), { kind: (["arms", "arms", "banner", "mon", "seal"] as const)[i % 5], style: STYLE_NAMES[i % STYLE_NAMES.length], legend: "Ondrek" }), { size: 36, shape: STYLES[STYLE_NAMES[i % STYLE_NAMES.length]].shape })}</span>`;
  return s + `</div>`;
});

// ---------------------------------------------------------------------------

let body = "";
let nav = "";
for (const [id, title, intro, fn] of sections) {
  if (only && !only.has(id)) continue;
  const t = Date.now();
  const content = fn();
  console.log(`${id.padEnd(12)} ${String(Date.now() - t).padStart(5)} ms  ${(content.length / 1024).toFixed(0)} KB`);
  nav += `<a href="#${id}">${title}</a>`;
  body += `<section id="${id}"><h2>${title}</h2><p class="intro">${intro}</p>${content}</section>`;
}
const css = `
:root{--ink:#2b2420;--muted:#6d6156;--paper:#efe8da;--card:#f7f2e7;--rule:#cfc3ad}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.4 Georgia,"DejaVu Serif",serif}
header{padding:28px 32px 12px;border-bottom:1px solid var(--rule)}header h1{margin:0;font-size:30px;letter-spacing:.04em;font-variant:small-caps}
header p{margin:6px 0 0;color:var(--muted)}nav{padding:10px 32px;display:flex;flex-wrap:wrap;gap:6px 16px;border-bottom:1px solid var(--rule);font-size:13px}
nav a{color:#7a2c1d;text-decoration:none}section{padding:18px 32px 26px;border-bottom:1px solid var(--rule);max-width:1600px}
h2{font-variant:small-caps;letter-spacing:.05em;font-size:24px;margin:6px 0 4px}h3{font-size:16px;margin:18px 0 8px;color:#5b3c28;font-style:italic;font-weight:normal}
.intro{color:var(--muted);margin:0 0 14px;max-width:900px}.grid{display:grid;gap:14px 12px;align-items:start}
.g5{grid-template-columns:repeat(5,1fr)}.g6{grid-template-columns:repeat(6,1fr)}.g8{grid-template-columns:repeat(8,1fr)}.g9{grid-template-columns:repeat(9,1fr)}.g10{grid-template-columns:repeat(10,1fr)}
.card{margin:0;text-align:center;background:var(--card);border:1px solid #e2d8c4;border-radius:6px;padding:10px 8px 8px}.card svg{display:block;margin:0 auto}
figcaption{font-size:11.5px;line-height:1.3;margin-top:6px;color:#3d332b}figcaption b{display:block;font-variant:small-caps;color:#7a2c1d;font-size:12px}
.rows .row{display:flex;gap:12px;align-items:stretch;margin-bottom:12px}.row .name{width:150px;flex:none;padding-top:30px;font-size:15px}.row .name small{color:var(--muted)}
.flexrow{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}.sizes{display:flex;gap:18px;align-items:flex-end;margin-bottom:14px}
.blazon{font-style:italic}.pair{display:flex;flex-direction:column;align-items:center;gap:6px}.pair svg{display:inline-block}
.icons{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}.icons span{display:inline-block}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Palimpsest — heraldry</title><style>${css}</style></head><body>
<header><h1>Palimpsest · Heraldry</h1><p>Arms, blazon, cadency and marshalling; flags, banners, mon and seals — generated from the seed “${esc(seed)}”.</p></header>
<nav>${nav}</nav>${body}</body></html>`;
mkdirSync("out/heraldry", { recursive: true });
writeFileSync("out/heraldry/demo.html", html);
console.log(`wrote out/heraldry/demo.html (${(html.length / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - t0} ms`);
