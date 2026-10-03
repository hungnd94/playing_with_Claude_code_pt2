/**
 * Quality invariants of the language engine: coherent spellings, readable name
 * lengths, distinct daughter names, regular stages, clean vocabulary, the
 * history bridge and lexicon etymologies.
 */
import { describe, expect, it } from "vitest";
import { Rng } from "../../src/core/rng";
import {
  CONCEPTS,
  createProtoLanguage,
  createRegistry,
  deriveLanguage,
  FLAVOURS,
  motto,
  nameFeature,
  namePerson,
  nameSettlement,
  romanizeWord,
  stageLabels,
  toUtterance,
  toWName,
  wordEtymology,
  evolveName,
  applyChanges,
  type Language,
} from "../../src/lang";
import { markTypes } from "../../src/lang/orthography";
import { nuclei } from "../../src/lang/phonology";
import { obscene } from "../../src/lang/util";

interface Fam {
  p: Language;
  d: Language[];
  g: Language[];
}

const FAMS: Fam[] = Array.from({ length: 16 }, (_, i) => {
  const rng = new Rng("q" + i);
  const p = createProtoLanguage(rng.fork("p"), { flavour: FLAVOURS[i % FLAVOURS.length] });
  const d = [0, 1].map((k) => deriveLanguage(p, rng.fork("d" + k), 500 + k * 50, { avoidNames: [p.name] }));
  const g = d.map((x, k) => deriveLanguage(x, rng.fork("g" + k), 1000, { avoidNames: [p.name, ...d.map((y) => y.name)] }));
  return { p, d, g };
});
const ALL = FAMS.flatMap((f) => [f.p, ...f.d, ...f.g]);

describe("orthography", () => {
  it("never spells a phoneme with a raw IPA letter", () => {
    for (const l of ALL) {
      for (const [p, s] of Object.entries(l.orthography.map)) expect(markTypes(s), `${p} → ${s} in ${l.name} (${l.orthography.school})`).not.toContain("ipa");
      for (const c of CONCEPTS) {
        const r = romanizeWord(l.orthography, l.lexicon[c.id].form);
        expect(markTypes(r), `${r} in ${l.name}`).not.toContain("ipa");
      }
    }
  });

  it("gives each language a restrained set of diacritics", () => {
    let restrained = 0;
    for (const l of ALL) {
      const counts = new Map<string, number>();
      for (const c of CONCEPTS) for (const m of new Set(markTypes(romanizeWord(l.orthography, l.lexicon[c.id].form)))) counts.set(m, (counts.get(m) ?? 0) + 1);
      const kinds = [...counts.values()].filter((n) => n >= CONCEPTS.length * 0.01).length;
      expect(kinds, `${l.name} (${l.orthography.school}): ${[...counts.keys()].join(" ")}`).toBeLessThanOrEqual(7);
      if (kinds <= 4) restrained++;
    }
    expect(restrained / ALL.length).toBeGreaterThan(0.8);
  });

  it("records one long-vowel and one nasal-vowel convention, inherited by daughters", () => {
    for (const f of FAMS) {
      expect(["double", "macron", "acute", "circumflex"]).toContain(f.p.orthography.long);
      expect(["n", "tilde-ao", "ogonek", "tilde"]).toContain(f.p.orthography.nasal);
      for (const d of [...f.d, ...f.g]) expect(d.orthography.long).toBeTruthy();
    }
  });
});

describe("vocabulary", () => {
  it("contains no word spelling an English obscenity", () => {
    for (const l of ALL) for (const c of CONCEPTS) expect(obscene(romanizeWord(l.orthography, l.lexicon[c.id].form)), `${c.id} in ${l.name}`).toBe(false);
  });

  it("keeps core vocabulary more stable than rare words", () => {
    let core = 0;
    let coreN = 0;
    let rare = 0;
    let rareN = 0;
    for (const f of FAMS)
      for (const d of f.d)
        for (const c of CONCEPTS) {
          const kept = d.lexicon[c.id].origin.kind === "inherited";
          if (c.tier === 1) {
            coreN++;
            if (kept) core++;
          } else if (c.tier === 3) {
            rareN++;
            if (kept) rare++;
          }
        }
    expect(core / coreN).toBeGreaterThan(rare / rareN);
  });

  it("explains lexicon words with etymologies", () => {
    const f = FAMS[0];
    const by = new Map(ALL.map((l) => [l.id, l]));
    const g = f.g[0];
    let inherited = 0;
    for (const c of CONCEPTS) {
      const e = wordEtymology(g, c.id, (id) => by.get(id));
      if (g.lexicon[c.id].origin.kind === "inherited") {
        expect(e, c.id).toMatch(/^from /);
        expect(e).toContain(`'${c.en}'`);
        inherited++;
      }
    }
    expect(inherited).toBeGreaterThan(CONCEPTS.length * 0.8);
  });
});

describe("names", () => {
  it("are short and readable", () => {
    const reg = createRegistry();
    const syl: number[] = [];
    for (const l of ALL.slice(0, 24)) {
      const r = new Rng("len" + l.id);
      for (let i = 0; i < 12; i++) {
        for (const n of [nameSettlement(l, r, { features: ["river", "oak"] }, { registry: reg }), nameFeature(l, r, i % 2 ? "river" : "range", {}, { registry: reg })]) {
          syl.push(n.words.reduce((a, w) => a + nuclei(w).length, 0));
          expect(n.roman.length).toBeGreaterThan(1);
        }
      }
    }
    const mean = syl.reduce((a, b) => a + b, 0) / syl.length;
    expect(mean).toBeLessThan(3.4);
    expect(syl.filter((s) => s >= 6).length / syl.length).toBeLessThan(0.02);
  });

  it("distinguishes daughter languages from their parent and siblings", () => {
    for (const f of FAMS) {
      const names = [f.p.name, ...f.d.map((x) => x.name)];
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
      for (const d of f.d) expect(d.name.slice(0, 3).toLowerCase(), `${d.name} vs ${f.p.name}`).not.toBe(f.p.name.slice(0, 3).toLowerCase());
    }
  });
});

describe("stages", () => {
  it("keep the name, evolve the endonym regularly, and label Old/Middle", () => {
    const rng = new Rng("stages");
    const a = createProtoLanguage(rng.fork("a"), { flavour: "river" });
    const b = deriveLanguage(a, rng.fork("b"), 400, { stage: true });
    const c = deriveLanguage(b, rng.fork("c"), 800, { stage: true });
    expect(b.name).toBe(a.name);
    expect(c.name).toBe(a.name);
    const step = c.lineage[c.lineage.length - 1];
    expect(applyChanges(step.changes, b.endonymPhonemes, step.stressBefore).word).toEqual(c.endonymPhonemes);
    expect(c.lineage.length).toBe(2);
    expect(step.changes.length).toBeGreaterThanOrEqual(2);
    expect(stageLabels(a.name, 3)).toEqual([`Old ${a.name}`, `Middle ${a.name}`, a.name]);
    // a place name carried through both stages reproduces the regular sound laws
    const n = nameSettlement(a, rng, {}, { registry: createRegistry() });
    const e = evolveName(n, a, c);
    expect(e.history.length).toBeGreaterThanOrEqual(1);
    expect(e.etym).toMatch(/from /);
  });
});

describe("bridge", () => {
  it("converts names and sentences to the history contracts", () => {
    const rng = new Rng("bridge");
    const l = createProtoLanguage(rng.fork("l"), { id: "7" });
    const reg = createRegistry();
    const p = namePerson(l, rng, { registry: reg, father: namePerson(l, rng, { registry: reg }), epithet: true });
    const w = toWName(p);
    expect(w.lang).toBe(7);
    expect(w.roman).toBe(p.roman);
    expect(w.phonemes).toEqual(p.phonemes);
    expect(w.parts!.length).toBeGreaterThan(0);
    const d = deriveLanguage(l, rng.fork("d"), 600, { id: "8" });
    const t = nameSettlement(l, rng, {}, { registry: reg });
    const wt = toWName(evolveName(t, l, d), undefined, { label: (s) => (s.lang === "7" ? "Old Test" : s.label) });
    expect(wt.lang).toBe(8);
    expect(wt.etym).toContain("Old Test");
    const u = toUtterance(motto(d, rng));
    expect(u.lang).toBe(8);
    expect(u.text.length).toBeGreaterThan(0);
    expect(u.gloss.split(" ").length).toBe(u.words!.length);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });
});

describe("contact", () => {
  it("borrows mostly cultural vocabulary, adapted to the borrower and inherited as one set", async () => {
    const { withLoanwords, isValidWord } = await import("../../src/lang");
    const [a, b] = [FAMS[1].p, FAMS[2].p];
    const a2 = withLoanwords(a, b, new Rng("loans"));
    const loans = CONCEPTS.filter((c) => a2.lexicon[c.id].origin.kind === "borrowed");
    expect(loans.length).toBeGreaterThan(3);
    const cultural = loans.filter((c) => c.tags.some((t) => ["role", "build", "material", "object", "weapon", "tool", "crop", "abstract"].includes(t)));
    expect(cultural.length / loans.length).toBeGreaterThan(0.6);
    for (const c of loans) expect(isValidWord(a2.phonology, a2.lexicon[c.id].form), c.id).toBe(true);
    expect(a.lexicon[loans[0].id].origin.kind).not.toBe("borrowed"); // the original is untouched
    const d = deriveLanguage(a2, new Rng("loan-d"), 700);
    const kept = loans.filter((c) => d.lexicon[c.id].origin.kind === "inherited");
    for (const c of kept) expect(d.lexicon[c.id].since).toBe(a2.lexicon[c.id].since);
  });
});
