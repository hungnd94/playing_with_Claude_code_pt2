import { describe, it, expect, vi } from "vitest";
import { classify, phonDistance, phoneticOrderKey } from "../../src/script/ipa";

// Generation is CPU-heavy and the test box is shared: generous per-test timeouts.
vi.setConfig({ testTimeout: 60000 });

describe("IPA classifier", () => {
  it("recognises vowels with length and nasality", () => {
    const a = classify("aː");
    expect(a.vowel).toBe(true);
    expect(a.base).toBe("a");
    expect(a.secondary).toContain("long");
    const n = classify("ã");
    expect(n.vowel).toBe(true);
    expect(n.secondary).toContain("nasal");
    expect(classify("u").round).toBe(true);
    expect(classify("i").back).toBe(0);
  });

  it("recognises consonant features, affricates and secondary articulations", () => {
    const p = classify("pʰ");
    expect(p.vowel).toBe(false);
    expect(p.place).toBe("bilabial");
    expect(p.manner).toBe("stop");
    expect(p.secondary).toContain("aspirated");
    expect(classify("tʃ").manner).toBe("affricate");
    expect(classify("t͡ʃ").base).toBe("tʃ");
    expect(classify("dʒ").voiced).toBe(true);
    expect(classify("kʼ").secondary).toContain("ejective");
    expect(classify("ⁿd").secondary).toContain("prenasalized");
    expect(classify("s").group).toBe("sibilant");
    expect(classify("ʔ").group).toBe("laryngeal");
    expect(classify("l").group).toBe("liquid");
  });

  it("gives sensible distances", () => {
    expect(phonDistance("p", "p")).toBe(0);
    expect(phonDistance("p", "b")).toBeLessThan(phonDistance("p", "s"));
    expect(phonDistance("t", "d")).toBeLessThan(1);
    expect(phonDistance("a", "k")).toBeGreaterThan(4);
    // glides are close to their vowels (Greek-style repurposing)
    expect(phonDistance("i", "j")).toBeLessThan(phonDistance("i", "t"));
    expect(phonDistance("e", "eː")).toBeLessThan(0.6);
  });

  it("orders vowels before consonants and velars before labials", () => {
    expect(phoneticOrderKey("a")).toBeLessThan(phoneticOrderKey("k"));
    expect(phoneticOrderKey("k")).toBeLessThan(phoneticOrderKey("p"));
  });
});
