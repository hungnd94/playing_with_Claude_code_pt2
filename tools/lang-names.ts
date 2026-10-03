/**
 * Name statistics and samples across many languages (proto-languages and
 * daughters): syllable-length distribution per name kind, share of opaque
 * names, letters per name, and random samples to read.
 *
 *   npx tsx tools/lang-names.ts [nLangs=24] [--samples=8] [--kind=settlement]
 */
import { Rng } from "../src/core/rng";
import {
  createProtoLanguage,
  createRegistry,
  deriveLanguage,
  FLAVOURS,
  nameDeity,
  nameDynasty,
  nameFeature,
  namePeople,
  namePerson,
  nameRealm,
  nameReligion,
  nameSettlement,
  type Language,
  type Name,
} from "../src/lang";
import { nuclei } from "../src/lang/phonology";

const args = process.argv.slice(2);
const nLangs = Number(args.find((a) => !a.startsWith("--")) ?? 24);
const nSamples = Number(args.find((a) => a.startsWith("--samples="))?.slice(10) ?? 6);
const onlyKind = args.find((a) => a.startsWith("--kind="))?.slice(7);

const langs: Language[] = [];
for (let i = 0; i < nLangs; i++) {
  const rng = new Rng("names" + i);
  const p = createProtoLanguage(rng.fork("p"), { flavour: FLAVOURS[i % FLAVOURS.length] });
  langs.push(i % 2 ? deriveLanguage(p, rng.fork("d"), 600) : p);
}
const reg = createRegistry();
const r = new Rng("names-gen");
const SITES = [["river", "ford"], ["hill", "oak"], ["coast", "harbor"], ["marsh", "reed"], ["mountain", "pass"], [], ["forest", "wolf"], ["lake"], ["spring", "ash"], []];

type Gen = (l: Language, i: number) => Name;
const kinds: [string, Gen][] = [
  ["settlement", (l, i) => nameSettlement(l, r, { features: SITES[i % SITES.length] }, { registry: reg })],
  ["person-m", (l) => namePerson(l, r, { gender: "m", registry: reg, fresh: true })],
  ["person-f", (l) => namePerson(l, r, { gender: "f", registry: reg, fresh: true })],
  ["river", (l) => nameFeature(l, r, "river", {}, { registry: reg })],
  ["range", (l) => nameFeature(l, r, "range", {}, { registry: reg })],
  ["sea", (l) => nameFeature(l, r, "sea", {}, { registry: reg })],
  ["forest", (l) => nameFeature(l, r, "forest", {}, { registry: reg })],
  ["island", (l) => nameFeature(l, r, "island", {}, { registry: reg })],
  ["deity", (l, i) => nameDeity(l, r, { domain: ["sun", "moon", "war", "sea", "death", "harvest", "storm", "wisdom"][i % 8], gender: i % 2 ? "f" : "m", registry: reg })],
  ["realm", (l) => nameRealm(l, r, { registry: reg })],
  ["people", (l) => namePeople(l, r, { registry: reg })],
  ["religion", (l) => nameReligion(l, r, { registry: reg })],
  ["dynasty", (l) => nameDynasty(l, r, { founder: namePerson(l, r, { registry: reg }), registry: reg })],
];

for (const [kind, gen] of kinds) {
  if (onlyKind && kind !== onlyKind) continue;
  const syl: number[] = [];
  let opaque = 0;
  let letters = 0;
  let total = 0;
  const samples: string[] = [];
  for (const l of langs) {
    for (let i = 0; i < 20; i++) {
      const n = gen(l, i);
      const s = n.words.reduce((a, w) => a + nuclei(w).length, 0);
      syl.push(s);
      if (!n.gloss) opaque++;
      letters += [...n.roman.replace(/[\s'ʻ-]/g, "")].length;
      total++;
      if (i < nSamples && samples.length < nSamples * 6 && langs.indexOf(l) < 6) samples.push(`${n.roman}${n.gloss ? ` '${n.gloss}'` : ""}`);
    }
  }
  const hist = [1, 2, 3, 4, 5, 6].map((k) => syl.filter((x) => (k === 6 ? x >= 6 : x === k)).length / syl.length);
  const mean = syl.reduce((a, b) => a + b, 0) / syl.length;
  console.log(
    `${kind.padEnd(11)} syl ${mean.toFixed(2)}  [1:${pct(hist[0])} 2:${pct(hist[1])} 3:${pct(hist[2])} 4:${pct(hist[3])} 5:${pct(hist[4])} 6+:${pct(hist[5])}]  letters ${(letters / total).toFixed(1)}  opaque ${pct(opaque / total)}`,
  );
  if (nSamples) console.log("   " + samples.join("; "));
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`.padStart(3);
}
