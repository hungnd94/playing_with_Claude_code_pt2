import { describe, it, expect, vi } from "vitest";
import { Rng } from "../../src/core/rng";
import { createScript, deriveScript, adaptScript, spellWord, unwritable } from "../../src/script";
import type { ScriptKind } from "../../src/script";
import { confusables, DUP_LIMIT } from "../../src/script/distinct";
import { INV } from "./fixtures";

// Generation is CPU-heavy and the test box is shared: generous per-test timeouts.
vi.setConfig({ testTimeout: 60000 });

const KINDS: ScriptKind[] = ["alphabet", "abjad", "abugida", "syllabary", "featural"];

describe("legibility", () => {
  it("no two written units of a new script look alike", () => {
    const invs = Object.values(INV);
    for (let i = 0; i < 40; i++) {
      const s = createScript(invs[i % invs.length], new Rng(`leg${i}`), { kind: KINDS[i % KINDS.length] });
      const bad = confusables(s, DUP_LIMIT + 0.004);
      expect(bad, `${s.kind}/${s.morph.family}/${s.style.tool}: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
    }
  });

  it("descendants and borrowings stay legible", () => {
    const invs = Object.values(INV);
    for (let i = 0; i < 15; i++) {
      const root = createScript(invs[i % invs.length], new Rng(`legd${i}`), { kind: KINDS[i % KINDS.length] });
      const inv = invs[(i * 3 + 1) % invs.length];
      const child = deriveScript(root, new Rng(`legd${i}/c`), { inventory: inv, drift: 0.9 });
      const borrowed = adaptScript(child, invs[(i * 5 + 2) % invs.length], new Rng(`legd${i}/a`));
      for (const s of [child, borrowed]) {
        const bad = confusables(s, DUP_LIMIT + 0.004);
        expect(bad, `${s.kind}/${s.morph.family}: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
      }
    }
  });

  it("syllabics use at most four orientations, further vowels add a mark", () => {
    for (const inv of [INV.germanic, INV.polynesian, INV.nasal, INV.tiny]) {
      const s = createScript(inv, new Rng(`rot/${inv.vowels.length}`), { kind: "abugida", family: "syllabic" });
      const o = s.ortho;
      expect(o.vowelMode).toBe("rotate");
      const codes = new Set(Object.values(o.rotations));
      expect(codes.size).toBeLessThanOrEqual(4);
      for (const c of codes) expect(c).toBeLessThanOrEqual(3);
      // a vowel sharing an orientation with another must carry a distinguishing op
      const byCode = new Map<number, string[]>();
      for (const [v, c] of Object.entries(o.rotations)) byCode.set(c, [...(byCode.get(c) ?? []), v]);
      for (const vs of byCode.values()) {
        const plain = vs.filter((v) => !o.vowelOps[v]?.length);
        expect(plain.length).toBeLessThanOrEqual(1);
      }
      expect(unwritable(s, [...inv.consonants, ...inv.vowels])).toEqual([]);
    }
  });

  it("spelling uses a consonant's irregular fused forms", () => {
    let found = false;
    for (let i = 0; i < 30 && !found; i++) {
      const s = createScript(INV.germanic, new Rng(`irr${i}`), { kind: "abugida", family: "geometric" });
      const fix = s.ortho.vowelOpsFor;
      if (s.ortho.vowelMode !== "fused" || !fix || !Object.keys(fix).length) continue;
      const [key, ops] = Object.entries(fix)[0];
      const [gid, v] = key.split("|");
      const g = s.glyphs.find((x) => x.id === +gid)!;
      if (!v) continue;
      const cs = spellWord(s, [g.sound, v]);
      expect(cs[0].base?.ops).toEqual(ops);
      found = true;
    }
    expect(found).toBe(true);
  });
});
