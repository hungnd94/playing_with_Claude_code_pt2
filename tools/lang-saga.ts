/**
 * A quick stand-in for a 3000-year history, for judging what names look like
 * after many generations: 14 proto-languages (as the history makes them), each
 * evolving in place (Old → Middle → modern stages every 700–1100 years) and
 * splitting now and then. Names coined at every point are carried down by
 * regular evolution. Prints, per surviving language, a sample of inherited and
 * fresh names, then statistics of spelling problems across all of them and the
 * worst offenders.
 *
 *   npx tsx tools/lang-saga.ts [seed=saga] [--years=3000] [--families=14] [--quiet] [--worst=40] [--family=k]
 */
import { Rng } from "../src/core/rng";
import {
  createProtoLanguage,
  createRegistry,
  deriveLanguage,
  evolveName,
  FLAVOURS,
  nameFeature,
  namePerson,
  nameRealm,
  nameSettlement,
  romanizeWord,
  type Language,
  type Name,
} from "../src/lang";
import { ugliness } from "../src/lang/orthography";

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith("--"));
const flag = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const seed = pos[0] ?? "saga";
const YEARS = Number(flag("years", "3000"));
const NFAM = Number(flag("families", "14"));
const QUIET = args.includes("--quiet");
const WORST = Number(flag("worst", "40"));
const ONLY = flag("family", "");

interface Node {
  lang: Language;
  born: number;
  stageDue: number;
  names: Name[];
  persons: Name[];
  alive: boolean;
  family: number;
}

const rng = new Rng(seed);
const reg = createRegistry();
const protos: Language[] = [];
const nodes: Node[] = [];
const t0 = performance.now();
let derives = 0;

function coin(n: Node, r: Rng, k: number): void {
  for (let i = 0; i < k; i++) n.names.push(nameSettlement(n.lang, r, {}, { registry: reg }));
  n.names.push(nameFeature(n.lang, r, "river", {}, { registry: reg }));
  n.names.push(nameRealm(n.lang, r, { registry: reg }));
  for (let i = 0; i < 4; i++) n.persons.push(namePerson(n.lang, r, { gender: i % 2 ? "f" : "m", registry: reg }));
}

for (let f = 0; f < NFAM; f++) {
  const fr = rng.fork(`proto${f}`);
  const p = createProtoLanguage(fr, { flavour: FLAVOURS[fr.int(0, FLAVOURS.length - 1)], avoid: protos, year: 0, id: `f${f}` });
  protos.push(p);
  const n: Node = { lang: p, born: 0, stageDue: fr.int(700, 1100), names: [], persons: [], alive: true, family: f };
  coin(n, fr.fork("names"), 10);
  nodes.push(n);
}

const used = new Set(protos.map((p) => p.name.toLowerCase()));
for (let year = 100; year <= YEARS; year += 100) {
  for (const n of nodes.slice()) {
    if (!n.alive) continue;
    const r = rng.fork(`${n.lang.id}/${year}`);
    if (year >= n.stageDue) {
      const nl = deriveLanguage(n.lang, r.fork("stage"), year, { stage: true, id: `${n.lang.id}s` });
      derives++;
      const m: Node = { lang: nl, born: year, stageDue: year + r.int(700, 1100), names: n.names.map((x) => evolveName(x, n.lang, nl)), persons: n.persons.map((x) => evolveName(x, n.lang, nl)), alive: true, family: n.family };
      n.alive = false;
      coin(m, r.fork("names"), 4);
      nodes.push(m);
      continue;
    }
    const famSize = nodes.filter((x) => x.alive && x.family === n.family).length;
    if (year > 300 && famSize < 4 && r.chance(0.035)) {
      const nl = deriveLanguage(n.lang, r.fork("split"), year, { avoidNames: [...used], id: `${n.lang.id}d${year}` });
      derives++;
      used.add(nl.name.toLowerCase());
      const m: Node = { lang: nl, born: year, stageDue: year + r.int(700, 1100), names: n.names.map((x) => evolveName(x, n.lang, nl)), persons: n.persons.map((x) => evolveName(x, n.lang, nl)), alive: true, family: n.family };
      coin(m, r.fork("names"), 4);
      nodes.push(m);
    }
  }
}
const ms = performance.now() - t0;

// ---------------------------------------------------------------- report
const leaves = nodes.filter((n) => n.alive && (!ONLY || String(n.family) === ONLY));
const all: { roman: string; lang: Language; name: Name }[] = [];
for (const n of leaves) for (const x of [...n.names, ...n.persons]) all.push({ roman: x.roman, lang: n.lang, name: x });

const VOWEL = /[aeiouyäöüáéíóúàèìòùâêîôûāēīōūăĕĭŏŭæøåœəëïıǫęąãẽĩõũȳýǣőűơưůÿěôė]/u;
function problems(s: string): string[] {
  const out: string[] = [];
  const low = s.toLowerCase();
  const chars = [...low.normalize("NFC")];
  let vr = 0;
  let cr = 0;
  let maxV = 0;
  let maxC = 0;
  for (const ch of chars) {
    if (ch === " " || ch === "-" || ch === "'" || ch === "ʻ" || ch === "ʿ" || ch === "ʾ") {
      vr = 0;
      cr = 0;
      continue;
    }
    if (VOWEL.test(ch)) {
      vr++;
      cr = 0;
    } else {
      cr++;
      vr = 0;
    }
    maxV = Math.max(maxV, vr);
    maxC = Math.max(maxC, cr);
  }
  if (maxV >= 3) out.push("vowel-run");
  if (maxC >= 4) out.push("cons-run");
  for (const ch of low.normalize("NFC")) {
    const marks = [...ch.normalize("NFD")].filter((c) => /\p{M}/u.test(c)).length;
    if (marks >= 2) out.push("stacked");
  }
  // doubled vowel letter touching another vowel letter (oou, aae, iia)
  if (/([aeiouyäöü])\1/u.test(low) && /([aeiouyäöü])\1[aeiouyäöüáéíóúâêîôûāēīōū]|[aeiouyäöüáéíóúâêîôûāēīōū]([aeiouyäöü])\2/u.test(low)) out.push("double+V");
  for (const w of s.split(" ")) {
    if (/^(.)\1/u.test(w.toLowerCase()) && !/^(ll|rr)/.test(w.toLowerCase())) out.push("initial-double");
    if ([...w].length > 13) out.push("long");
  }
  const ap = (s.match(/['ʻʿʾ]/g) ?? []).length;
  if (ap >= 2) out.push("apostrophes");
  return out;
}

const counts = new Map<string, number>();
const worst: { s: string; score: number; why: string[]; lang: string }[] = [];
for (const x of all) {
  const ps = problems(x.roman);
  for (const p of new Set(ps)) counts.set(p, (counts.get(p) ?? 0) + 1);
  worst.push({ s: x.roman, score: ugliness(x.roman) + ps.length * 2, why: ps, lang: `${x.lang.name}/${x.lang.orthography.school}` });
}

if (!QUIET) {
  for (const n of leaves) {
    const L = n.lang;
    const marks = new Set<string>();
    for (const v of Object.values(L.orthography.map)) for (const ch of v.normalize("NFD")) if (/\p{M}/u.test(ch) || ch.charCodeAt(0) > 0x7f) marks.add(ch);
    console.log(`\n■ ${L.name} (family ${n.family}, depth ${L.lineage.length}, ${L.phonology.style ?? "?"} → ${L.orthography.school}, long ${L.orthography.long}) marks: ${[...marks].join(" ") || "-"}`);
    const W = ["water", "fire", "stone", "sun", "moon", "king", "god", "mother", "wolf", "sea"];
    console.log("   words: " + W.map((c) => romanWord(L, c)).join(" "));
    console.log("   old:   " + n.names.slice(0, 12).map((x) => `${x.roman}${x.gloss ? ` '${x.gloss}'` : ""}`).join(", "));
    console.log("   new:   " + n.names.slice(-6).map((x) => `${x.roman}${x.gloss ? ` '${x.gloss}'` : ""}`).join(", "));
    console.log("   people: " + n.persons.slice(0, 4).concat(n.persons.slice(-4)).map((x) => x.roman).join(", "));
  }
}

function romanWord(L: Language, c: string): string {
  return romanizeWord(L.orthography, L.lexicon[c].form);
}

console.log(`\n${leaves.length} living languages, ${all.length} names; ${derives} derivations in ${ms.toFixed(0)} ms`);
console.log("problems: " + [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${((v / all.length) * 100).toFixed(1)}%)`).join(", "));
worst.sort((a, b) => b.score - a.score);
console.log(`\nworst ${WORST}:`);
for (const w of worst.slice(0, WORST)) console.log(`  ${w.s.padEnd(30)} ${w.score.toFixed(1).padStart(5)}  ${w.why.join(",").padEnd(28)} ${w.lang}`);
