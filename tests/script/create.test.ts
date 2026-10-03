import { describe, it, expect, vi } from "vitest";
import { Rng } from "../../src/core/rng";
import { createScript, unwritable, SCRIPT_KINDS, FAMILIES, spellWord } from "../../src/script";
import type { Family, ScriptKind } from "../../src/script";
import { INV } from "./fixtures";

// Generation is CPU-heavy and the test box is shared: generous per-test timeouts.
vi.setConfig({ testTimeout: 60000 });

const combos: [ScriptKind, Family | undefined][] = [
  ["alphabet", "stave"],
  ["alphabet", "geometric"],
  ["alphabet", "round"],
  ["alphabet", "tally"],
  ["alphabet", "cursive"],
  ["abjad", "square"],
  ["abjad", "cursive"],
  ["abjad", "wedge"],
  ["abugida", "hanging"],
  ["abugida", "round"],
  ["abugida", "geometric"],
  ["abugida", "syllabic"],
  ["syllabary", "linear"],
  ["syllabary", "wedge"],
  ["featural", "featural"],
];

describe("createScript", () => {
  it("is deterministic", () => {
    for (const kind of SCRIPT_KINDS) {
      const a = createScript(INV.indic, new Rng("det"), { kind });
      const b = createScript(INV.indic, new Rng("det"), { kind });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    const c = createScript(INV.indic, new Rng("det2"), { kind: "alphabet" });
    const d = createScript(INV.indic, new Rng("det"), { kind: "alphabet" });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(d));
  });

  it("is plain JSON that survives a round trip", () => {
    const s = createScript(INV.semitic, new Rng("json"), { kind: "abjad" });
    const t = JSON.parse(JSON.stringify(s));
    expect(t).toEqual(s);
    expect(typeof s.id).toBe("string");
    expect(s.parent).toBeNull();
    expect(["ltr", "rtl", "ttb"]).toContain(s.direction);
  });

  it("can write every phoneme of its inventory, for every kind and family", () => {
    for (const [kind, family] of combos) {
      for (const inv of Object.values(INV)) {
        const s = createScript(inv, new Rng(`w/${kind}/${family}/${inv.consonants[1]}`), { kind, family });
        expect(s.kind).toBe(kind);
        expect(unwritable(s, [...inv.consonants, ...inv.vowels])).toEqual([]);
      }
    }
  });

  it("makes the right number of glyphs for the kind", () => {
    const alpha = createScript(INV.germanic, new Rng("n1"), { kind: "alphabet", family: "geometric" });
    // every plain phoneme gets its own letter (secondary features may share a base)
    const plain = [...INV.germanic.consonants, ...INV.germanic.vowels].filter((p) => !p.includes("ː"));
    for (const p of plain) expect(alpha.ortho.letters[p]).toBeDefined();
    const letters = new Set(Object.values(alpha.ortho.letters));
    expect(letters.size).toBe(Object.keys(alpha.ortho.letters).length); // one glyph per letter

    const abjad = createScript(INV.semitic, new Rng("n2"), { kind: "abjad" });
    for (const c of INV.semitic.consonants) expect(abjad.ortho.letters[c] ?? abjad.ortho.marked[c] ?? abjad.ortho.digraphs[c]).toBeDefined();
    for (const v of ["a", "i", "u"]) expect(abjad.ortho.vowelSigns[v]).toBeDefined();

    const syl = createScript(INV.tiny, new Rng("n3"), { kind: "syllabary" });
    const sylGlyphs = syl.glyphs.filter((g) => g.role === "syllable");
    // (consonant series + vowel-only) × vowels for a small inventory without merging
    expect(sylGlyphs.length).toBe((INV.tiny.consonants.length + 1) * INV.tiny.vowels.length);

    const abu = createScript(INV.indic, new Rng("n4"), { kind: "abugida", family: "hanging" });
    expect(abu.ortho.inherent).toBe("a");
    expect(abu.ortho.vowelSigns["a"]).toBe(-1);
  });

  it("keeps glyphs mutually distinguishable", async () => {
    const { rasterize, similarity } = await import("../../src/script/raster");
    for (const family of ["stave", "geometric", "round", "square", "hanging"] as Family[]) {
      const kind: ScriptKind = family === "hanging" ? "abugida" : "alphabet";
      const s = createScript(INV.germanic, new Rng(`dist/${family}`), { kind, family });
      const gl = s.glyphs.filter((g) => g.role === "consonant" || g.role === "vowel");
      const rs = gl.map((g) => rasterize(g.strokes, g.w));
      let dupes = 0;
      for (let i = 0; i < rs.length; i++) for (let j = 0; j < i; j++) if (similarity(rs[i], rs[j]) > 0.985) dupes++;
      expect(dupes).toBeLessThanOrEqual(1);
    }
  });

  it("has finite geometry everywhere", () => {
    for (const family of FAMILIES) {
      const kind: ScriptKind = family === "featural" ? "featural" : family === "syllabic" ? "abugida" : "alphabet";
      const s = createScript(INV.caucasian, new Rng(`fin/${family}`), { kind, family });
      for (const g of s.glyphs) {
        expect(Number.isFinite(g.w)).toBe(true);
        for (const st of g.strokes) for (const p of st.pts) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
      }
      expect(spellWord(s, ["k", "a", "t"]).length).toBeGreaterThan(0);
    }
  });

  it("creates scripts within the performance budget", () => {
    for (let i = 0; i < 5; i++) createScript(INV.germanic, new Rng(`warm${i}`));
    const t0 = performance.now();
    const n = 40;
    for (let i = 0; i < n; i++) createScript(Object.values(INV)[i % 8], new Rng(`perf${i}`));
    const mean = (performance.now() - t0) / n;
    expect(mean).toBeLessThan(50);
  });
});
