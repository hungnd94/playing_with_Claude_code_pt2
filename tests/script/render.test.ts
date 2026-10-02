import { describe, it, expect } from "vitest";
import { Rng } from "../../src/core/rng";
import {
  createScript,
  deriveScript,
  layoutWord,
  layoutText,
  renderWordSVG,
  renderTextSVG,
  renderGlyphSVG,
  scriptChartSVG,
  evolutionTableSVG,
  familyTreeSVG,
  FAMILIES,
} from "../../src/script";
import type { Family, ScriptKind } from "../../src/script";
import { INV, wellFormed } from "./fixtures";

const words = [["k", "a", "t"], ["m", "aː", "n", "u"], ["a"], ["s", "t", "r", "i", "k"], ["ŋ", "o", "ɬ"], ["t", "ʃ", "ã"]];

function kindFor(f: Family): ScriptKind {
  return f === "featural" ? "featural" : f === "syllabic" ? "abugida" : f === "wedge" ? "syllabary" : f === "hanging" ? "abugida" : "alphabet";
}

describe("layout and SVG", () => {
  it("lays out words with finite coordinates in every direction", () => {
    for (const family of FAMILIES) {
      for (const direction of ["ltr", "rtl", "ttb"] as const) {
        const s = createScript(INV.indic, new Rng(`l/${family}/${direction}`), { kind: kindFor(family), family, direction });
        for (const w of words) {
          const l = layoutWord(s, w);
          for (const v of [l.x0, l.y0, l.x1, l.y1]) expect(Number.isFinite(v)).toBe(true);
          expect(l.x1).toBeGreaterThan(l.x0);
          expect(l.y1).toBeGreaterThan(l.y0);
          for (const it of l.items) {
            for (const v of it.m) expect(Number.isFinite(v)).toBe(true);
            expect(it.d).not.toMatch(/NaN|Infinity/);
          }
        }
        if (direction === "ttb") {
          const l = layoutWord(s, ["k", "a", "t", "a", "m", "a"]);
          expect(l.y1 - l.y0).toBeGreaterThan(l.x1 - l.x0);
        }
      }
    }
  });

  it("produces well-formed SVG", () => {
    const s = createScript(INV.semitic, new Rng("svg"), { kind: "abjad", family: "cursive" });
    const child = deriveScript(s, new Rng("svg2"), { inventory: INV.germanic });
    const outs = [
      renderWordSVG(s, words[0], { size: 24, color: "#222", title: "K<a>t & co" }),
      renderTextSVG(s, [words[0], words[1]], { ink: true }),
      renderGlyphSVG(s, s.glyphs[0].id),
      scriptChartSVG(s),
      scriptChartSVG(child),
      evolutionTableSVG([s, child]),
      evolutionTableSVG([s, child], { layout: "columns" }),
      familyTreeSVG([s, child]),
    ];
    for (const o of outs) {
      expect(o.startsWith("<svg")).toBe(true);
      expect(wellFormed(o)).toBe(true);
      expect(o).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("charts every kind", () => {
    for (const kind of ["alphabet", "abjad", "abugida", "syllabary", "featural"] as ScriptKind[]) {
      const s = createScript(INV.polynesian, new Rng(`chart/${kind}`), { kind });
      const svg = scriptChartSVG(s);
      expect(wellFormed(svg)).toBe(true);
      expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(5);
    }
  });

  it("uses unique ids when defs are emitted", () => {
    const s = createScript(INV.tiny, new Rng("ids"));
    const a = renderWordSVG(s, ["k", "a"], { ink: true });
    const b = renderWordSVG(s, ["k", "a"], { ink: true });
    const id = (x: string): string => /id="([^"]+)"/.exec(x)![1];
    expect(id(a)).not.toBe(id(b));
  });

  it("text layout adds word dividers", () => {
    const s = createScript(INV.tiny, new Rng("sep"), { kind: "alphabet" });
    const one = layoutWord(s, ["k", "a"]);
    const two = layoutText(s, [["k", "a"], ["k", "a"]]);
    expect(two.x1 - two.x0).toBeGreaterThan((one.x1 - one.x0) * 2);
  });
});
