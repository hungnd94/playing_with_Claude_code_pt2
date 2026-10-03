import { describe, it, expect, vi } from "vitest";
import { Rng } from "../../src/core/rng";
import { createScript, deriveScript, adaptScript, describeScript, wordOutline, textOutline, unwritable, layoutWord } from "../../src/script";
import type { ScriptKind } from "../../src/script";
import { INV } from "./fixtures";

// Generation is CPU-heavy and the test box is shared: generous per-test timeouts.
vi.setConfig({ testTimeout: 60000 });

describe("kind changes", () => {
  it("a borrowed syllabary can become an abugida", () => {
    const syl = createScript(INV.tiny, new Rng("syl"), { kind: "syllabary" });
    const abu = adaptScript(syl, INV.caucasian, new Rng("syl2"), { kind: "abugida" });
    expect(abu.kind).toBe("abugida");
    expect(abu.ortho.vowelMode).toBe("sign");
    expect(abu.glyphs.some((g) => g.role === "syllable")).toBe(false);
    // consonant letters descend from the old syllable signs
    expect(abu.glyphs.some((g) => g.role === "consonant" && g.origin === "repurposed")).toBe(true);
    expect(unwritable(abu, [...INV.caucasian.consonants, ...INV.caucasian.vowels])).toEqual([]);
  });

  it("a borrowed abjad can become an alphabet", () => {
    const abj = createScript(INV.semitic, new Rng("abj"), { kind: "abjad" });
    const alpha = adaptScript(abj, INV.germanic, new Rng("abj2"), { kind: "alphabet" });
    expect(alpha.kind).toBe("alphabet");
    for (const v of ["a", "e", "i", "o", "u"]) expect(alpha.ortho.letters[v]).toBeDefined();
    expect(alpha.glyphs.some((g) => g.role === "vowel" && g.origin === "repurposed")).toBe(true);
  });

  it("vowel-poor languages favour abjads, small syllable sets favour syllabaries", () => {
    const count = (inv: (typeof INV)[string], kind: ScriptKind): number => {
      let n = 0;
      for (let i = 0; i < 80; i++) if (createScript(inv, new Rng(`kw${i}`)).kind === kind) n++;
      return n;
    };
    expect(count(INV.semitic, "abjad")).toBeGreaterThan(count(INV.germanic, "abjad"));
    expect(count(INV.tiny, "syllabary")).toBeGreaterThan(count(INV.caucasian, "syllabary"));
  });
});

describe("describeScript", () => {
  it("writes plain sentences for every kind and for descendants", () => {
    for (const kind of ["alphabet", "abjad", "abugida", "syllabary", "featural"] as ScriptKind[]) {
      const s = createScript(INV.polynesian, new Rng(`desc/${kind}`), { kind });
      const f = describeScript(s, { name: "Keshi" });
      expect(f.kind).toBe(kind);
      expect(f.sentences.length).toBeGreaterThanOrEqual(2);
      expect(f.sentences[0].startsWith("Keshi is ")).toBe(true);
      const d = deriveScript(s, new Rng(`desc/${kind}/d`), { inventory: INV.germanic, drift: 0.9 });
      const fd = describeScript(d, { name: "Later Keshi", parentName: "Keshi" });
      const text = [...f.sentences, ...fd.sentences].join(" ");
      expect(text).not.toMatch(/undefined|NaN|scr-|S\d|#|\.\./);
      for (const x of fd.sentences) expect(x).toMatch(/^[A-Z].*\.$/);
      expect(fd.sentences.some((x) => x.includes("Keshi"))).toBe(true);
    }
  });
});

describe("outlines", () => {
  it("flatten a word into one finite path matching its layout", () => {
    for (const direction of ["ltr", "rtl", "ttb"] as const) {
      const s = createScript(INV.indic, new Rng(`ol/${direction}`), { kind: "abugida", direction });
      const o = wordOutline(s, ["k", "a", "m", "a", "l"], { size: 40 });
      expect(o.d).toMatch(/^M[-\d.]+ [-\d.]+L/);
      expect(o.d).not.toMatch(/NaN|Infinity/);
      const nums = (o.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(-0.5);
        expect(nums[i]).toBeLessThanOrEqual(o.width + 0.5);
        expect(nums[i + 1]).toBeGreaterThanOrEqual(-0.5);
        expect(nums[i + 1]).toBeLessThanOrEqual(o.height + 0.5);
      }
      expect(o.direction).toBe(direction);
      const t = textOutline(s, [["k", "a"], ["m", "a"]], { size: 40, horizontal: true });
      expect(t.direction).not.toBe("ttb");
      expect(t.width).toBeGreaterThan(t.height * 0.8);
    }
  });

  it("horizontal option lays vertical scripts on a line", () => {
    const s = createScript(INV.semitic, new Rng("hz"), { kind: "abjad", family: "cursive", direction: "ttb" });
    const w = ["k", "a", "t", "a", "b", "a", "l", "a", "m", "a", "s", "a", "r", "a", "d"];
    const v = layoutWord(s, w);
    const h = layoutWord(s, w, { horizontal: true });
    expect(v.y1 - v.y0).toBeGreaterThan(v.x1 - v.x0);
    expect(h.x1 - h.x0).toBeGreaterThan(h.y1 - h.y0);
  });
});
