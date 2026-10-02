import { describe, it, expect } from "vitest";
import { Rng } from "../../src/core/rng";
import { createScript, deriveScript, adaptScript, unwritable } from "../../src/script";
import type { Script, ScriptKind } from "../../src/script";
import { INV } from "./fixtures";

function checkLineage(parent: Script, child: Script): void {
  expect(child.parent).toBe(parent.id);
  expect(child.generation).toBe(parent.generation + 1);
  const parentIds = new Set(parent.glyphs.map((g) => g.id));
  const ids = new Set<number>();
  for (const g of child.glyphs) {
    expect(ids.has(g.id)).toBe(false);
    ids.add(g.id);
    if (g.origin === "inherited" || g.origin === "mutated" || g.origin === "repurposed") {
      expect(g.anc).toBeDefined();
      if (g.role !== "mark") expect(parentIds.has(g.anc!)).toBe(true);
      const pg = parent.glyphs.find((x) => x.id === g.anc);
      if (pg) expect(g.root).toBe(pg.root);
    }
  }
}

describe("deriveScript", () => {
  it("is deterministic and keeps lineage", () => {
    const root = createScript(INV.semitic, new Rng("root"), { kind: "abjad" });
    const a = deriveScript(root, new Rng("d"), { inventory: INV.germanic });
    const b = deriveScript(root, new Rng("d"), { inventory: INV.germanic });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    checkLineage(root, a);
  });

  it("descendants can write their language, across kinds and generations", () => {
    const kinds: ScriptKind[] = ["alphabet", "abjad", "abugida", "syllabary", "featural"];
    const invs = Object.values(INV);
    for (const kind of kinds) {
      let s = createScript(INV.semitic, new Rng(`g/${kind}`), { kind });
      for (let gen = 0; gen < 3; gen++) {
        const inv = invs[(gen * 3 + kind.length) % invs.length];
        const child = deriveScript(s, new Rng(`g/${kind}/${gen}`), { inventory: inv, drift: 0.8 });
        checkLineage(s, child);
        expect(unwritable(child, [...inv.consonants, ...inv.vowels])).toEqual([]);
        s = child;
      }
    }
  });

  it("turns an abjad into an alphabet by repurposing letters for vowels", () => {
    const root = createScript(INV.semitic, new Rng("greek"), { kind: "abjad" });
    const child = deriveScript(root, new Rng("greek2"), { kind: "alphabet", inventory: INV.germanic });
    expect(child.kind).toBe("alphabet");
    const vowelLetters = INV.germanic.vowels.map((v) => child.ortho.letters[v]).filter((x) => x !== undefined);
    expect(vowelLetters.length).toBeGreaterThan(3);
    // some vowels are written with letters that used to be consonants
    expect(child.glyphs.some((g) => g.origin === "repurposed" && g.role === "vowel")).toBe(true);
  });

  it("can change tool and direction, and mirror letters on a direction flip", () => {
    const root = createScript(INV.semitic, new Rng("flip"), { kind: "abjad", family: "square", direction: "rtl" });
    const child = deriveScript(root, new Rng("flip2"), { direction: "ltr", tool: "knife" });
    expect(child.direction).toBe("ltr");
    expect(child.style.tool).toBe("knife");
    expect(child.style.cornering).toBe(0);
    expect(child.glyphs.filter((g) => g.origin === "mutated").length).toBeGreaterThan(5);
  });
});

describe("adaptScript", () => {
  it("makes every phoneme of the borrowing language writable", () => {
    const kinds: ScriptKind[] = ["alphabet", "abjad", "abugida", "syllabary", "featural"];
    for (const kind of kinds) {
      for (const [name, inv] of Object.entries(INV)) {
        const src = createScript(INV.germanic, new Rng(`a/${kind}`), { kind });
        const s = adaptScript(src, inv, new Rng(`a/${kind}/${name}`));
        checkLineage(src, s);
        expect(unwritable(s, [...inv.consonants, ...inv.vowels])).toEqual([]);
        expect(s.sounds.sort()).toEqual([...new Set([...inv.consonants, ...inv.vowels])].sort());
      }
    }
  });

  it("derives new letters from old ones and drops unneeded letters", () => {
    const src = createScript(INV.tiny, new Rng("small"), { kind: "alphabet", family: "geometric" });
    const big = adaptScript(src, INV.caucasian, new Rng("big"));
    expect(big.glyphs.some((g) => g.origin === "derived")).toBe(true);
    const back = adaptScript(big, INV.tiny, new Rng("back"));
    const letters = back.glyphs.filter((g) => g.role === "consonant" || g.role === "vowel");
    expect(letters.length).toBeLessThanOrEqual(INV.tiny.consonants.length + INV.tiny.vowels.length + 1);
  });
});
