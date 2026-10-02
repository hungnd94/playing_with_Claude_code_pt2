/**
 * Language engine showcase.
 *
 *   npx tsx tools/lang-demo.ts [seed] [--section=protos,tree,compare,places,evolve,borrow,persons,gods,mottoes,features] [--out]
 *
 * Prints proto-languages, a family tree with sound laws, a comparative word
 * list, settlement names with etymologies, names evolving down the tree,
 * borrowings, personal names, deities, mottoes and proverbs. With --out the
 * report is also written to out/lang-demo-<seed>.txt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Rng } from "../src/core/rng";
import {
  borrowName,
  CONCEPT_BY_ID,
  correspondences,
  createProtoLanguages,
  createRegistry,
  deriveLanguage,
  describeLanguage,
  evolveName,
  hyphenated,
  inventory,
  motto,
  nameDeity,
  nameDynasty,
  nameFeature,
  namePeople,
  namePerson,
  nameRealm,
  nameReligion,
  nameSettlement,
  proverb,
  romanizeWord,
  ipaWord,
  type Flavour,
  type Language,
  type Name,
} from "../src/lang";

const args = process.argv.slice(2);
const seed = args.find((a) => !a.startsWith("--")) ?? "palimpsest";
const secArg = args.find((a) => a.startsWith("--section="));
const sections = new Set(secArg ? secArg.slice(10).split(",") : ["protos", "tree", "compare", "places", "evolve", "borrow", "persons", "gods", "mottoes", "features"]);
const lines: string[] = [];
const out = (s = "") => lines.push(s);
const hr = (title: string) => {
  out("");
  out("═".repeat(78));
  out(title);
  out("═".repeat(78));
};

const rng = new Rng(seed);
const flavours: Flavour[] = rng.fork("flavours").sample(["steppe", "coast", "islands", "jungle", "mountains", "desert", "forest", "tundra", "river", "plains"], 5) as Flavour[];
const t0 = performance.now();
const protos = createProtoLanguages(rng.fork("protos"), 5, flavours);
const tProto = (performance.now() - t0) / 5;
const reg = createRegistry();

const SAMPLE = ["water", "fire", "stone", "river", "mountain", "sun", "moon", "star", "wolf", "horse", "king", "god", "mother", "man", "woman", "iron", "gold", "sea", "tree", "ford"];

function w(l: Language, c: string): string {
  return romanizeWord(l.orthography, l.lexicon[c].form);
}

if (sections.has("protos")) {
  hr(`PROTO-LANGUAGES  (seed "${seed}")`);
  for (const l of protos) {
    out("");
    out(`■ ${l.name}  — endonym ${l.endonym} '${l.endonymGloss}'  [homeland: ${l.flavour ?? "—"}]`);
    for (const d of describeLanguage(l)) out(`  ${d}`);
    const inv = inventory(l);
    out(`  Consonants: ${inv.consonants.map((p) => `${p}‹${l.orthography.map[p] ?? "?"}›`).join(" ")}`);
    out(`  Vowels:     ${inv.vowels.map((p) => `${p}‹${l.orthography.map[p] ?? "?"}›`).join(" ")}`);
    const ph = l.phonology;
    out(`  Onset clusters: ${ph.onsetClusters.map((c) => c.join("")).join(" ") || "none"}`);
    out(`  Codas: ${ph.codas.join(" ") || "none"}; finals: ${ph.finals.join(" ") || "none"}${ph.finalClusters.length ? `; final clusters: ${ph.finalClusters.map((c) => c.join("")).join(" ")}` : ""}`);
    out(`  Words: ${SAMPLE.map((c) => `${CONCEPT_BY_ID[c].en} ${w(l, c)} /${ipaWord(l.lexicon[c].form, ph.stress, ph)}/`).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Family tree
// ---------------------------------------------------------------------------
interface Node {
  lang: Language;
  children: Node[];
}
const root = protos[0];
const t1 = performance.now();
let derived = 0;
function grow(n: Node, depth: number, year: number, branching: number[]): void {
  if (depth >= branching.length) return;
  for (let i = 0; i < branching[depth]; i++) {
    const child = deriveLanguage(n.lang, rng.fork(`derive/${n.lang.id}/${i}`), year + 500 + i * 60, { avoidNames: [...usedNames] });
    usedNames.add(child.name);
    derived++;
    const c: Node = { lang: child, children: [] };
    n.children.push(c);
    grow(c, depth + 1, year + 500, branching);
  }
}
const usedNames = new Set(protos.map((l) => l.name));
const tree: Node = { lang: root, children: [] };
grow(tree, 0, 0, [2, 2, 1]);
const tDerive = (performance.now() - t1) / derived;
const all: Language[] = [];
const leaves: Language[] = [];
(function walk(n: Node) {
  all.push(n.lang);
  if (!n.children.length) leaves.push(n.lang);
  n.children.forEach(walk);
})(tree);
const byId = new Map(all.map((l) => [l.id, l]));
const label = (l: Language) => (l.depth === 0 ? `Proto-${l.name}` : l.name);

if (sections.has("tree")) {
  hr(`FAMILY TREE OF PROTO-${root.name.toUpperCase()}`);
  (function show(n: Node, indent: string) {
    const l = n.lang;
    out(`${indent}${label(l)} (${l.endonym}, ${l.year === 0 ? "c. year 0" : `from year ${l.year}`}) — ${l.orthography.school} spelling, stress ${l.phonology.stress}`);
    const step = l.lineage[l.lineage.length - 1];
    if (step) {
      for (const ch of step.changes) out(`${indent}   • ${ch.name}: ${ch.notation} — ${ch.description}`);
    }
    for (const c of n.children) show(c, indent + "    ");
  })(tree, "");
}

if (sections.has("compare")) {
  hr("COMPARATIVE WORD LIST (cognates; † = replaced)");
  const concepts = ["water", "fire", "stone", "sun", "night", "mother", "wolf", "horse", "king", "tree", "river", "mountain", "blood", "heart", "two"];
  const cols = [root, ...leaves];
  const width = 13;
  out("".padEnd(10) + cols.map((l) => label(l).slice(0, width - 1).padEnd(width)).join(""));
  for (const c of concepts) {
    let row = CONCEPT_BY_ID[c].en.padEnd(10);
    for (const l of cols) {
      const lx = l.lexicon[c];
      const inherited = l.depth === 0 || lx.origin.kind === "inherited";
      const s = (l.depth === 0 ? "*" : "") + romanizeWord(l.orthography, lx.form) + (inherited ? "" : "†");
      row += s.padEnd(width);
    }
    out(row);
  }
  out("");
  out("Regular correspondences (proto phoneme → reflexes in each branch, with counts):");
  for (const leaf of leaves.slice(0, 4)) {
    const corr = correspondences(root, leaf);
    const show = Object.entries(corr)
      .filter(([p]) => !/[ː̃]/.test(p))
      .slice(0, 14)
      .map(([p, m]) =>
        `*${p} → ${Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([x, n]) => `${x}(${n})`)
          .join("/")}`,
      );
    out(`  ${label(leaf)}: ${show.join("; ")}`);
  }
}

if (sections.has("places")) {
  hr("SETTLEMENT NAMES");
  const sites = [["river", "ford", "oak"], ["hill", "iron"], ["coast", "harbor"], ["marsh", "reed"], ["mountain", "pass"], ["spring", "ash"], [], ["forest", "wolf"], ["lake", "swan"], []];
  for (const l of [...protos, ...all.slice(1)]) {
    const r = rng.fork(`places/${l.id}`);
    out("");
    out(`■ ${label(l)}`);
    const ns = sites.map((f) => nameSettlement(l, r, { features: f }, { registry: reg }));
    for (const n of ns) out(`  ${n.roman.padEnd(18)} /${n.ipa}/  ${hyphenated(n).padEnd(20)} '${n.gloss || "(meaning lost)"}'`);
  }
}

if (sections.has("evolve")) {
  hr("PLACE NAMES THROUGH TIME (regular sound change down the tree)");
  const r = rng.fork("evolve");
  const olds: Name[] = [];
  for (let i = 0; i < 6; i++) olds.push(nameSettlement(root, r, { features: [r.pick(["river", "hill", "stone", "oak", "ford", "lake", "wolf", "gold"])] }, { registry: reg }));
  olds.push(nameFeature(root, r, "river", {}, { registry: reg }));
  olds.push(nameFeature(root, r, "range", { color: "white" }, { registry: reg }));
  for (const n of olds) {
    out("");
    out(`*${hyphenated(n)} '${n.gloss || "?"}' (Proto-${root.name})`);
    for (const leaf of leaves) {
      const e = evolveName(n, root, leaf);
      out(`   ${label(leaf).padEnd(12)} ${e.roman.padEnd(16)} /${e.ipa}/  — ${e.etym}`);
    }
  }
}

if (sections.has("borrow")) {
  hr("BORROWINGS (adapted to the borrowing language's sounds)");
  const r = rng.fork("borrow");
  const src = protos[0];
  const srcNames = [0, 1, 2].map(() => nameSettlement(src, r, {}, { registry: reg }));
  srcNames.push(namePerson(src, r, { gender: "m" }));
  for (const tgt of protos.slice(1)) {
    out(`  into ${tgt.name}: ` + srcNames.map((n) => `${n.roman} → ${borrowName(n, tgt, { from: src }).roman}`).join("; "));
  }
  const b = borrowName(srcNames[0], protos[1], { from: src });
  out(`  e.g. ${b.roman}: ${b.etym}`);
}

if (sections.has("persons")) {
  hr("PERSONS");
  for (const l of [...protos, ...leaves]) {
    const r = rng.fork(`persons/${l.id}`);
    const people: string[] = [];
    let father: Name | undefined;
    for (let i = 0; i < 10; i++) {
      const n = namePerson(l, r, { gender: i % 3 === 2 ? "f" : "m", father: i % 4 === 1 ? father : undefined, epithet: i % 5 === 4, registry: reg });
      if (i % 3 !== 2) father = n;
      people.push(`${n.roman}${n.gloss ? ` '${n.gloss}'` : ""}`);
    }
    out(`■ ${label(l)} (${l.naming.personStyle}): ${people.join("; ")}`);
  }
}

if (sections.has("gods")) {
  hr("GODS, FAITHS, REALMS, PEOPLES, DYNASTIES");
  for (const l of protos) {
    const r = rng.fork(`gods/${l.id}`);
    const domains = ["sun", "moon", "war", "sea", "death", "harvest", "storm", "wisdom"];
    const gods = domains.map((d, i) => nameDeity(l, r, { domain: d, gender: i % 2 ? "f" : "m", registry: reg }));
    out(`■ ${l.name}`);
    out(`  gods: ${gods.map((g) => `${g.roman} (${g.meta?.domain}${g.gloss ? `, '${g.gloss}'` : ""})`).join("; ")}`);
    const faith = nameReligion(l, r, { deity: gods[0], registry: reg });
    const people = namePeople(l, r, { registry: reg });
    const cap = nameSettlement(l, r, {}, { registry: reg });
    const realm = nameRealm(l, r, { people, capital: cap, registry: reg });
    const founder = namePerson(l, r, { gender: "m", registry: reg });
    const dyn = nameDynasty(l, r, { founder, seat: cap, registry: reg });
    out(`  faith: ${faith.roman} '${faith.gloss}'; people: ${people.roman} '${people.gloss || "?"}'; realm: ${realm.roman} '${realm.gloss}'; dynasty: ${dyn.roman} '${dyn.gloss}'`);
  }
}

if (sections.has("features")) {
  hr("NATURAL FEATURES");
  const kinds = ["river", "range", "sea", "lake", "forest", "desert", "island", "archipelago", "volcano", "continent"] as const;
  for (const l of protos) {
    const r = rng.fork(`features/${l.id}`);
    out(`■ ${l.name}: ` + kinds.map((k) => {
      const n = nameFeature(l, r, k, {}, { registry: reg });
      return `${k} ${n.roman}${n.gloss ? ` '${n.gloss}'` : ""}`;
    }).join("; "));
  }
}

if (sections.has("mottoes")) {
  hr("MOTTOES & PROVERBS (interlinear)");
  for (const l of [...protos, leaves[0]]) {
    const r = rng.fork(`motto/${l.id}`);
    out(`■ ${label(l)}`);
    for (let i = 0; i < 3; i++) {
      const s = motto(l, r);
      out("    " + s.interlinear[0]);
      out("    " + s.interlinear[1]);
      out("    " + s.interlinear[2]);
      out("");
    }
    const p = proverb(l, r);
    out("    " + p.interlinear[0]);
    out("    " + p.interlinear[1]);
    out("    " + p.interlinear[2]);
    out("");
  }
}

// performance
const tn = performance.now();
const pr = rng.fork("perf");
let nNames = 0;
for (let i = 0; i < 2000; i++) {
  const l = all[i % all.length];
  nameSettlement(l, pr, { features: ["river"] }, { registry: reg });
  namePerson(l, pr, { registry: reg });
  nNames += 2;
}
const tName = (performance.now() - tn) / nNames;
hr("PERFORMANCE");
out(`proto-language: ${tProto.toFixed(2)} ms   derive: ${tDerive.toFixed(2)} ms   name: ${(tName * 1000).toFixed(1)} µs`);

const text = lines.join("\n");
console.log(text);
if (args.includes("--out")) {
  mkdirSync("out", { recursive: true });
  writeFileSync(`out/lang-demo-${seed}.txt`, text);
}
void byId;
