import { describe, expect, it } from "vitest";
import { Rng } from "../../src/core/rng";
import { EMBLEM_CONCEPTS } from "../../src/world/concepts";
import {
  adaptWord,
  applyChanges,
  borrowName,
  CONCEPTS,
  createProtoLanguage,
  createProtoLanguages,
  createRegistry,
  deriveLanguage,
  evolveName,
  evolveWord,
  FLAVOURS,
  generateRoot,
  inventory,
  isValidWord,
  languageFromJSON,
  languageToJSON,
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
  sentence,
  vowelQualities,
  type Language,
} from "../../src/lang";
import { tables } from "../../src/lang/phonology";

const SEEDS = ["t-alpha", "t-beta", "t-gamma", "t-delta", "t-eps", "t-zeta"];

function family(seed: string): { proto: Language; kids: Language[]; grandkids: Language[] } {
  const rng = new Rng(seed);
  const proto = createProtoLanguage(rng.fork("proto"), { flavour: FLAVOURS[seed.length % FLAVOURS.length] });
  const kids = [0, 1].map((i) => deriveLanguage(proto, rng.fork(`kid${i}`), 500));
  const grandkids = kids.map((k, i) => deriveLanguage(k, rng.fork(`gk${i}`), 1000));
  return { proto, kids, grandkids };
}

const FAMILIES = SEEDS.map(family);
const ALL: Language[] = FAMILIES.flatMap((f) => [f.proto, ...f.kids, ...f.grandkids]);

describe("proto-languages", () => {
  it("are deterministic", () => {
    const a = createProtoLanguage(new Rng("det"), { flavour: "coast" });
    const b = createProtoLanguage(new Rng("det"), { flavour: "coast" });
    expect(languageToJSON(a)).toBe(languageToJSON(b));
    const c = createProtoLanguage(new Rng("det2"), { flavour: "coast" });
    expect(languageToJSON(a)).not.toBe(languageToJSON(c));
  });

  it("have typologically plausible inventories", () => {
    for (let i = 0; i < 40; i++) {
      const l = createProtoLanguage(new Rng(`inv${i}`), { flavour: FLAVOURS[i % FLAVOURS.length] });
      const inv = inventory(l);
      expect(inv.consonants.length).toBeGreaterThanOrEqual(10);
      expect(inv.consonants.length).toBeLessThanOrEqual(30);
      const q = vowelQualities(l.phonology).length;
      expect(q).toBeGreaterThanOrEqual(3);
      expect(q).toBeLessThanOrEqual(10);
      // near-universals
      expect(inv.consonants).toContain("m");
      expect(inv.consonants).toContain("n");
      expect(inv.consonants.some((c) => c === "t" || c === "k")).toBe(true);
      expect(inv.vowels).toContain("a");
    }
  });

  it("generate words that obey their own phonotactics", () => {
    for (const f of FAMILIES) {
      const l = f.proto;
      const rng = new Rng("words" + l.id);
      for (let i = 0; i < 300; i++) {
        const w = generateRoot(l.phonology, rng, 1 + (i % 3));
        expect(isValidWord(l.phonology, w), `${w.join("")} in ${l.name}`).toBe(true);
      }
      // every root of the lexicon is valid (derived words may have junction material)
      for (const c of CONCEPTS) {
        const lx = l.lexicon[c.id];
        if (lx.origin.kind === "root") expect(isValidWord(l.phonology, lx.form), `${c.id}=${lx.form.join("")}`).toBe(true);
      }
    }
  });

  it("use only inventory phonemes in the lexicon", () => {
    for (const l of ALL) {
      const t = tables(l.phonology);
      for (const c of CONCEPTS) for (const p of l.lexicon[c.id].form) expect(t.cons.has(p) || t.vows.has(p), `${p} in ${l.name}`).toBe(true);
    }
  });

  it("have a word for every concept, including every emblem concept", () => {
    for (const l of ALL) {
      for (const e of EMBLEM_CONCEPTS) expect(l.lexicon[e]?.form.length, `${e} in ${l.name}`).toBeGreaterThan(0);
      for (const c of CONCEPTS) expect(l.lexicon[c.id]?.form.length).toBeGreaterThan(0);
    }
  });

  it("look distinct from each other", () => {
    const ls = createProtoLanguages(new Rng("distinct"), 5);
    const schools = new Set(ls.map((l) => l.orthography.school));
    expect(schools.size).toBeGreaterThanOrEqual(3);
    const water = new Set(ls.map((l) => romanizeWord(l.orthography, l.lexicon.water.form)));
    expect(water.size).toBeGreaterThanOrEqual(4);
  });
});

describe("sound change", () => {
  it("is regular: the daughter's inherited words are the parent's words through its sound laws", () => {
    for (const f of FAMILIES) {
      for (const [parent, kid] of [
        [f.proto, f.kids[0]],
        [f.proto, f.kids[1]],
        [f.kids[0], f.grandkids[0]],
        [f.kids[1], f.grandkids[1]],
      ] as [Language, Language][]) {
        const step = kid.lineage[kid.lineage.length - 1];
        expect(step.from).toBe(parent.id);
        expect(step.changes.length).toBeGreaterThanOrEqual(3);
        let inherited = 0;
        for (const c of CONCEPTS) {
          const lx = kid.lexicon[c.id];
          if (lx.origin.kind !== "inherited") continue;
          inherited++;
          const r = applyChanges(step.changes, parent.lexicon[c.id].form, step.stressBefore).word;
          expect(r.join(" "), `${c.id}`).toBe(lx.form.join(" "));
        }
        expect(inherited).toBeGreaterThan(CONCEPTS.length * 0.8);
      }
    }
  });

  it("every change has a description and a notation", () => {
    for (const l of ALL)
      for (const s of l.lineage)
        for (const ch of s.changes) {
          expect(ch.name.length).toBeGreaterThan(2);
          expect(ch.description.length).toBeGreaterThan(10);
          expect(ch.notation.length).toBeGreaterThan(2);
        }
  });

  it("evolves names regularly down several generations", () => {
    const f = FAMILIES[0];
    const rng = new Rng("evolve");
    for (let i = 0; i < 20; i++) {
      const n = nameSettlement(f.proto, rng, { features: ["river", "ford"] });
      const e = evolveName(n, f.proto, f.grandkids[0]);
      expect(e.lang).toBe(f.grandkids[0].id);
      expect(e.words[0].join(" ")).toBe(evolveWord(n.words[0], f.proto, f.grandkids[0])!.join(" "));
      expect(e.etym).toMatch(/^from /);
      expect(e.etym).toContain(`Proto-${f.proto.name}`);
      expect(e.history.length).toBeGreaterThanOrEqual(1);
      expect(e.gloss).toBe(n.gloss);
    }
  });

  it("is deterministic", () => {
    const p = FAMILIES[1].proto;
    const a = deriveLanguage(p, new Rng("same"), 300);
    const b = deriveLanguage(p, new Rng("same"), 300);
    expect(languageToJSON(a)).toBe(languageToJSON(b));
  });

  it("does not modify the parent", () => {
    const p = createProtoLanguage(new Rng("parent"));
    const before = languageToJSON(p);
    deriveLanguage(p, new Rng("child"), 100);
    expect(languageToJSON(p)).toBe(before);
  });
});

describe("borrowing", () => {
  it("adapts names to the target inventory and phonotactics", () => {
    for (let i = 0; i < ALL.length; i++) {
      const src = ALL[i];
      const tgt = ALL[(i * 7 + 3) % ALL.length];
      if (src.id === tgt.id) continue;
      const rng = new Rng("borrow" + i);
      const t = tables(tgt.phonology);
      for (let k = 0; k < 8; k++) {
        const n = k % 2 ? namePerson(src, rng) : nameSettlement(src, rng);
        const b = borrowName(n, tgt, { from: src });
        for (const w of b.words) {
          for (const p of w) expect(t.cons.has(p) || t.vows.has(p), `${p} from ${n.roman} into ${tgt.name}`).toBe(true);
          expect(isValidWord(tgt.phonology, w), `${w.join("")} (${n.roman}) into ${tgt.name}`).toBe(true);
        }
        expect(b.etym).toMatch(/^borrowed from /);
        expect(b.gloss).toBe(n.gloss);
      }
    }
  });

  it("adaptWord is deterministic and idempotent on native words", () => {
    const l = FAMILIES[2].proto;
    for (const c of ["water", "stone", "king"]) {
      const w = l.lexicon[c].form;
      expect(adaptWord(w, l)).toEqual(w);
    }
  });
});

describe("naming", () => {
  it("returns complete names", () => {
    for (const l of ALL.slice(0, 10)) {
      const rng = new Rng("names" + l.id);
      const reg = createRegistry();
      const people = namePeople(l, rng, { registry: reg });
      const cap = nameSettlement(l, rng, { features: ["hill"] }, { registry: reg });
      const names = [
        cap,
        nameSettlement(l, rng, { mother: cap }, { registry: reg }),
        nameRealm(l, rng, { people, capital: cap, registry: reg }),
        people,
        nameFeature(l, rng, "river", { color: "white" }, { registry: reg }),
        nameFeature(l, rng, "range", {}, { registry: reg }),
        nameDeity(l, rng, { domain: "sun", registry: reg }),
        nameReligion(l, rng, { registry: reg }),
        nameDynasty(l, rng, { founder: namePerson(l, rng, { registry: reg }), registry: reg }),
        namePerson(l, rng, { gender: "f", epithet: true, registry: reg }),
      ];
      for (const n of names) {
        expect(n.lang).toBe(l.id);
        expect(n.roman.length).toBeGreaterThan(1);
        expect(n.ipa.length).toBeGreaterThan(1);
        expect(n.phonemes.length).toBeGreaterThan(1);
        expect(n.parts.length).toBeGreaterThan(0);
        expect(typeof n.gloss).toBe("string");
        expect(n.roman[0]).toBe(n.roman[0].toUpperCase());
        for (const p of n.phonemes) expect(p === " " || tables(l.phonology).cons.has(p) || tables(l.phonology).vows.has(p), `${p} in ${n.roman}`).toBe(true);
      }
    }
  });

  it("does not repeat place names within a language", () => {
    for (const l of ALL.slice(0, 6)) {
      const rng = new Rng("unique" + l.id);
      const reg = createRegistry();
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        const n = nameSettlement(l, rng, { features: i % 3 ? ["river"] : [] }, { registry: reg });
        expect(seen.has(n.roman), n.roman).toBe(false);
        seen.add(n.roman);
      }
    }
  });

  it("romanisation rarely collides within a language", () => {
    for (const l of ALL) {
      const byRoman = new Map<string, string>();
      let distinctForms = 0;
      let collisions = 0;
      const seenForms = new Set<string>();
      for (const c of CONCEPTS) {
        const f = l.lexicon[c.id].form.join(" ");
        if (seenForms.has(f)) continue;
        seenForms.add(f);
        distinctForms++;
        const r = romanizeWord(l.orthography, l.lexicon[c.id].form);
        if (byRoman.has(r)) collisions++;
        byRoman.set(r, f);
      }
      expect(collisions / distinctForms, l.name).toBeLessThan(0.02);
      // the spelling map itself is injective
      const vals = Object.entries(l.orthography.map).filter(([, s]) => s !== "");
      expect(new Set(vals.map(([, s]) => s)).size, l.name).toBe(vals.length);
    }
  });

  it("is deterministic given the rng", () => {
    const l = FAMILIES[3].kids[0];
    const a = nameSettlement(l, new Rng("x"), { features: ["oak"] }, { registry: createRegistry() });
    const b = nameSettlement(l, new Rng("x"), { features: ["oak"] }, { registry: createRegistry() });
    expect(a).toEqual(b);
  });
});

describe("grammar", () => {
  it("produces aligned interlinear glosses", () => {
    for (const l of ALL.slice(0, 12)) {
      const rng = new Rng("motto" + l.id);
      for (let i = 0; i < 6; i++) {
        const s = i % 2 ? motto(l, rng) : proverb(l, rng);
        const native = s.segmented.split(" ");
        const gloss = s.gloss.split(" ");
        expect(native.length, `${s.segmented} / ${s.gloss}`).toBe(gloss.length);
        native.forEach((w, k) => expect(w.split("-").length, `${w} / ${gloss[k]}`).toBe(gloss[k].split("-").length));
        expect(s.words.length).toBe(native.length);
        expect(s.translation.length).toBeGreaterThan(2);
        expect(s.interlinear).toHaveLength(3);
      }
    }
  });

  it("renders simple clauses with English translations", () => {
    const l = FAMILIES[0].proto;
    const s = sentence(l, { subject: { head: "we" }, verb: "remember" }, { title: true });
    expect(s.translation).toBe("We Remember");
    const t = sentence(l, { subject: { head: "wolf", def: true, adj: ["old"] }, verb: "fear", negative: true, object: { head: "night", def: true } });
    expect(t.translation).toBe("The old wolf does not fear the night.");
  });
});

describe("serialisation", () => {
  it("round-trips through JSON and keeps behaving identically", () => {
    for (const l of [FAMILIES[0].proto, FAMILIES[0].grandkids[1]]) {
      const copy = languageFromJSON(JSON.stringify(l));
      expect(copy).toEqual(l);
      const a = nameSettlement(l, new Rng("rt"), { features: ["river"] }, { registry: createRegistry() });
      const b = nameSettlement(copy, new Rng("rt"), { features: ["river"] }, { registry: createRegistry() });
      expect(b).toEqual(a);
      const d1 = deriveLanguage(l, new Rng("rt-d"), 900);
      const d2 = deriveLanguage(copy, new Rng("rt-d"), 900);
      expect(languageToJSON(d2)).toBe(languageToJSON(d1));
    }
  });

  it("names and registries are plain JSON", () => {
    const l = FAMILIES[4].proto;
    const reg = createRegistry();
    const n = namePerson(l, new Rng("p"), { registry: reg, father: namePerson(l, new Rng("f"), { registry: reg }) });
    expect(JSON.parse(JSON.stringify(n))).toEqual(n);
    expect(JSON.parse(JSON.stringify(reg))).toEqual(reg);
  });
});

describe("performance", () => {
  it("meets the budgets (generous margins for CI noise)", () => {
    const rng = new Rng("perf");
    let t = performance.now();
    const ls: Language[] = [];
    for (let i = 0; i < 10; i++) ls.push(createProtoLanguage(rng.fork(`p${i}`)));
    const proto = (performance.now() - t) / 10;
    t = performance.now();
    for (let i = 0; i < 10; i++) deriveLanguage(ls[i], rng.fork(`d${i}`), 500);
    const derive = (performance.now() - t) / 10;
    const reg = createRegistry();
    t = performance.now();
    for (let i = 0; i < 1000; i++) nameSettlement(ls[i % 10], rng, { features: ["river"] }, { registry: reg });
    const name = (performance.now() - t) / 1000;
    expect(proto).toBeLessThan(60);
    expect(derive).toBeLessThan(40);
    expect(name).toBeLessThan(0.5);
  });
});
