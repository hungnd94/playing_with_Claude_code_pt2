/**
 * Run a real world + history and look at what the language engine produced:
 * every language (school, depth, sample words) and every name in the history
 * (settlements, polities, persons, features, deities…), with statistics of
 * spelling problems and the worst offenders. Writes all names to
 * out/lang/history-<seed>.json for further analysis.
 *
 *   NODE_OPTIONS=--max-old-space-size=3072 npx tsx tools/lang-history.ts <seed> [years=3000] [--langs] [--worst=60]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Rng } from "../src/core/rng";
import { generatePhysical } from "../src/geo/index";
import { DEFAULT_PARAMS } from "../src/world/types";
import { runSimulation } from "../src/history/index";
import type { History, WName } from "../src/history/types";
import { romanizeWord, ugliness, type Language as LLang } from "../src/lang";

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith("--"));
const seed = pos[0] ?? "palimpsest";
const years = Number(pos[1] ?? DEFAULT_PARAMS.years);
const SHOW_LANGS = args.includes("--langs");
const WORST = Number(args.find((a) => a.startsWith("--worst="))?.split("=")[1] ?? 60);

const t0 = performance.now();
const world = generatePhysical({ ...DEFAULT_PARAMS, seed, years }, new Rng(seed));
const sim = runSimulation(world, new Rng(seed), { years });
const h: History = sim.h;
console.log(`seed ${seed}: generated in ${((performance.now() - t0) / 1000).toFixed(1)} s; ${h.languages.length} languages`);

interface Entry {
  kind: string;
  roman: string;
  gloss: string;
  lang: number;
  etym?: string;
}
const names: Entry[] = [];
const push = (kind: string, n: WName | undefined) => {
  if (n && n.roman) names.push({ kind, roman: n.roman, gloss: n.gloss, lang: n.lang, etym: n.etym });
};
for (const s of h.settlements) for (const r of s.names) push("settlement", r.name);
for (const p of h.polities) for (const r of p.names) push("polity", r.name);
for (const p of h.persons) push("person", p.name);
for (const d of h.dynasties) push("dynasty", d.name);
for (const c of h.cultures) push("people", c.name);
for (const d of h.deities) push("deity", d.name);
for (const r of h.religions) push("religion", r.name);
for (const f of h.featureNames) for (const r of f.names) push("feature", r.name);
for (const l of h.languages) push("language", l.endonym);

const VOWEL = /[aeiouäöüáéíóúàèìòùâêîôûāēīōūăĕĭŏŭæøåœəëïıǫęąãẽĩõũȳýǣőűơưůÿěėǿ]/u;
function problems(s: string): string[] {
  const out: string[] = [];
  const low = s.toLowerCase().normalize("NFC");
  for (const w of low.split(/[ -]/)) {
    let vr = 0;
    let cr = 0;
    let maxV = 0;
    let maxC = 0;
    for (const ch of w) {
      if (ch === "'" || ch === "ʻ" || ch === "ʿ" || ch === "ʾ") {
        vr = 0;
        cr = 0;
        continue;
      }
      if (VOWEL.test(ch)) {
        vr++;
        cr = 0;
      } else if (ch === "y" || ch === "w") {
        vr = 0;
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
    if (/^(.)\1/u.test(w) && !/^(ll|rr|ff)/.test(w)) out.push("initial-double");
    if ([...w].length > 13) out.push("long");
  }
  for (const ch of low) if ([...ch.normalize("NFD")].filter((c) => /\p{M}/u.test(c)).length >= 2) out.push("stacked");
  if (/([aeiouäöü])\1[aeiouäöüáéíóúâêîôûāēīōū]|[aeiouäöüáéíóúâêîôûāēīōū]([aeiouäöü])\2/u.test(low)) out.push("double+V");
  if ((s.match(/['ʻʿʾ]/g) ?? []).length >= 2) out.push("apostrophes");
  return [...new Set(out)];
}

const langData = (id: number) => h.languages[id]?.data as LLang | undefined;
const counts = new Map<string, number>();
const scored = names.map((n) => {
  const ps = problems(n.roman);
  for (const p of ps) counts.set(p, (counts.get(p) ?? 0) + 1);
  return { ...n, ps, score: ugliness(n.roman) + ps.length * 2 };
});
const uniq = new Map<string, (typeof scored)[number]>();
for (const s of scored) uniq.set(s.roman + "|" + s.lang, s);

if (SHOW_LANGS) {
  for (const l of h.languages) {
    const L = l.data as LLang;
    const W = ["water", "fire", "stone", "sun", "moon", "king", "god", "mother", "wolf", "sea"];
    const ns = [...uniq.values()].filter((n) => n.lang === l.id);
    console.log(`\n■ ${l.id} ${l.name} (${l.origin}, ${L.phonology.style} → ${L.orthography.school}/${L.orthography.long}, depth ${L.lineage.length}, ${l.born}–${l.ended < 0 ? "" : l.ended})`);
    console.log("   " + W.map((c) => romanizeWord(L.orthography, L.lexicon[c].form)).join(" "));
    const pick = (k: string, m: number) => ns.filter((n) => n.kind === k).slice(0, m).map((n) => n.roman);
    console.log("   " + [...pick("settlement", 12), ...pick("polity", 3), ...pick("person", 8)].join(", "));
  }
}

console.log(`\n${names.length} names (${uniq.size} distinct)`);
console.log("problems: " + [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${((v / names.length) * 100).toFixed(2)}%)`).join(", "));
const worst = [...uniq.values()].sort((a, b) => b.score - a.score).slice(0, WORST);
console.log(`\nworst ${WORST}:`);
for (const w of worst) {
  const L = langData(w.lang);
  console.log(`  ${w.roman.padEnd(32)} ${w.kind.padEnd(10)} ${w.ps.join(",").padEnd(24)} ${h.languages[w.lang]?.name ?? "?"}/${L?.orthography.school ?? "?"}`);
}
mkdirSync("out/lang", { recursive: true });
writeFileSync(`out/lang/history-${seed}.json`, JSON.stringify({ names: [...uniq.values()], languages: h.languages.map((l) => ({ id: l.id, name: l.name, origin: l.origin, parent: l.parent, data: l.data })) }));
console.log(`wrote out/lang/history-${seed}.json`);
