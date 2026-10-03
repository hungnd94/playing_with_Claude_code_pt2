import { describe, it, expect } from "vitest";
import { Rng } from "../../src/core/rng";
import { EMBLEM_CONCEPTS } from "../../src/world/concepts";
import {
  generateArms, blazon, checkTincture, differenceArms, marshalArms, cantingCharge, cantingCharges, renderArmsSVG,
  STYLES, randomStyle, CHARGES, ALL_CHARGE_IDS, SHIELD_SHAPES, DIFFERENCE_KINDS, chargeDef, renderChargeSVG,
  type Arms, type SimpleArms, type StyleName, type HeraldryStyle,
} from "../../src/heraldry";
import { checkSvg } from "./svgcheck";

const STYLE_NAMES = Object.keys(STYLES) as StyleName[];

/** A corpus of arms across every preset and some invented styles. */
function corpus(n: number, seed = "corpus"): { arms: SimpleArms; style: HeraldryStyle | StyleName }[] {
  const rng = new Rng(seed);
  const out: { arms: SimpleArms; style: HeraldryStyle | StyleName }[] = [];
  for (let i = 0; i < n; i++) {
    const style: HeraldryStyle | StyleName = i % 5 === 4 ? randomStyle(rng.fork("st" + i), "inv" + i) : STYLE_NAMES[i % STYLE_NAMES.length];
    out.push({ arms: generateArms(rng.fork(i), { style }), style });
  }
  return out;
}

function blazonOk(text: string): string[] {
  const errs: string[] = [];
  if (!text) errs.push("empty");
  for (const bad of ["undefined", "NaN", "null", "[object", "  ", " ,", ",,", " ;", "..", " .", "of the ."]) if (text.includes(bad)) errs.push(`contains "${bad}"`);
  if (!/^[A-Z]/.test(text)) errs.push("does not start with a capital");
  if (/\b(a|an) (a|an)\b/i.test(text)) errs.push("double article");
  if (/\b(\w+) \1\b/i.test(text.replace(/\b(Or|or) (Or|or)\b/g, ""))) {
    const m = /\b(\w+) \1\b/i.exec(text)!;
    if (!["that", "had"].includes(m[1].toLowerCase())) errs.push(`repeated word "${m[0]}"`);
  }
  return errs;
}

describe("generateArms", () => {
  it("is deterministic", () => {
    for (const style of STYLE_NAMES) {
      const a = generateArms(new Rng("det").fork(style), { style });
      const b = generateArms(new Rng("det").fork(style), { style });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    const s1 = randomStyle(new Rng("st"), "x"), s2 = randomStyle(new Rng("st"), "x");
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it("produces plain JSON (round-trips)", () => {
    for (const { arms } of corpus(60)) expect(JSON.parse(JSON.stringify(arms))).toEqual(arms);
  });

  it("follows the rule of tincture except for flagged arms of enquiry", () => {
    const all = corpus(900);
    let exceptions = 0;
    for (const { arms } of all) {
      const v = checkTincture(arms);
      if (arms.exception) exceptions++;
      else expect(v, blazon(arms)).toEqual([]);
    }
    expect(exceptions / all.length).toBeLessThan(0.04);
  });

  it("has a realistic complexity distribution", () => {
    const all = corpus(800, "cx");
    let simple = 0, busy = 0;
    for (const { arms: a } of all) {
      const parts = [a.ordinary, a.charges, a.secondary, a.chief, a.bordure, a.canton, a.semy, a.ordinary?.charges, a.chief?.charges].filter(Boolean).length;
      if (parts <= 1) simple++;
      if (parts >= 4) busy++;
    }
    // Most real coats are a field with one ordinary or one group of charges.
    expect(simple / all.length).toBeGreaterThan(0.4);
    expect(busy / all.length).toBeLessThan(0.12);
  });

  it("honours canting motifs most of the time", () => {
    const rng = new Rng("cant");
    let hits = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      const id = EMBLEM_CONCEPTS[i % EMBLEM_CONCEPTS.length];
      const a = generateArms(rng.fork(i), { style: STYLE_NAMES[i % STYLE_NAMES.length], motifs: [id] });
      const json = JSON.stringify(a);
      if (json.includes(`"charge":"${id}"`)) hits++;
    }
    expect(hits / n).toBeGreaterThan(0.85);
  });

  it("uses every charge somewhere", () => {
    const used = new Set<string>();
    for (const { arms } of corpus(2500, "all")) {
      const s = JSON.stringify(arms);
      for (const m of s.matchAll(/"charge":"(\w+)"/g)) used.add(m[1]);
    }
    const missing = ALL_CHARGE_IDS.filter((id) => !used.has(id));
    expect(missing.length, missing.join(",")).toBeLessThan(6);
  });
});

describe("blazon", () => {
  it("is well formed for generated, differenced and marshalled arms", () => {
    const all = corpus(500, "bl");
    const rng = new Rng("diff");
    for (let i = 0; i < all.length; i++) {
      const a = all[i].arms;
      const texts = [blazon(a), blazon(differenceArms(a, rng.fork(i))), blazon(marshalArms([a, all[(i + 1) % all.length].arms]))];
      if (i % 10 === 0) texts.push(blazon(marshalArms([a, all[(i + 2) % all.length].arms], { method: "impaled" })));
      for (const t of texts) expect(blazonOk(t), t).toEqual([]);
    }
  });

  it("names classic coats correctly", () => {
    const woodville: Arms = { kind: "simple", field: { partition: "plain", tinctures: ["argent"] }, ordinary: { kind: "fess", tincture: "gules" }, canton: { tincture: "gules" } };
    expect(blazon(woodville)).toBe("Argent, a fess and a canton Gules");
    const england: Arms = { kind: "simple", field: { partition: "plain", tinctures: ["gules"] }, charges: { charge: "lion", count: 3, tincture: "or", attitude: "passant", arrangement: "pale" } };
    expect(blazon(england)).toMatch(/^Gules, three lions passant in pale Or/);
    const beauchamp: Arms = {
      kind: "simple", field: { partition: "plain", tinctures: ["gules"] }, ordinary: { kind: "fess", tincture: "or" },
      charges: { charge: "crossCrosslet", count: 6, tincture: "or" },
    };
    expect(blazon(beauchamp)).toBe("Gules, a fess between six crosses crosslet Or");
    const plates: Arms = { kind: "simple", field: { partition: "plain", tinctures: ["azure"] }, charges: { charge: "roundel", count: 3, tincture: "argent" } };
    expect(blazon(plates)).toBe("Azure, three plates");
    const chevron: Arms = {
      kind: "simple", field: { partition: "plain", tinctures: ["or"] },
      ordinary: { kind: "chevron", tincture: "gules", charges: { charge: "mullet", count: 3, tincture: "argent" } },
      charges: { charge: "escallop", count: 3, tincture: "sable" },
    };
    expect(blazon(chevron)).toBe("Or, on a chevron Gules between three escallops Sable as many mullets Argent");
    const q = marshalArms([england, plates]);
    expect(blazon(q)).toMatch(/^Quarterly, 1 and 4 Gules, three lions passant in pale Or; 2 and 3 Azure, three plates/);
  });

  it("blazons every charge in every attitude", () => {
    for (const id of ALL_CHARGE_IDS) {
      const def = chargeDef(id);
      for (const att of def.attitudes ?? [undefined]) {
        for (const count of [1, 3]) {
          const a: Arms = { kind: "simple", field: { partition: "plain", tinctures: ["azure"] }, charges: { charge: id, count, tincture: "or", attitude: att } };
          const t = blazon(a);
          expect(blazonOk(t), t).toEqual([]);
          if (id !== "roundel") expect(t.toLowerCase()).toContain(count === 1 ? def.name.split(" ")[0].toLowerCase() : def.plural.split(" ")[0].toLowerCase());
        }
      }
    }
  });
});

describe("cadency, marshalling and canting", () => {
  it("differences without mutating the original, and visibly", () => {
    const rng = new Rng("cad");
    for (const { arms } of corpus(120, "cd")) {
      const before = JSON.stringify(arms);
      for (const k of DIFFERENCE_KINDS) {
        const d = differenceArms(arms, rng.fork(k), k, 3);
        expect(JSON.stringify(arms)).toBe(before);
        expect(JSON.stringify(d)).not.toBe(before);
        expect(blazon(d)).not.toBe(blazon(arms));
      }
    }
  });

  it("marshals 1–6 coats", () => {
    const cs = corpus(6, "m").map((x) => x.arms);
    for (let n = 1; n <= 6; n++) {
      const m = marshalArms(cs.slice(0, n));
      if (n === 1) expect(m).toEqual(cs[0]);
      else expect(m.kind).toBe("marshalled");
      const svg = renderArmsSVG(m, { idPrefix: "m" + n });
      expect(checkSvg(svg).errors).toEqual([]);
    }
    const imp = marshalArms(cs.slice(0, 2), { method: "impaled" });
    expect(blazon(imp)).toContain("impaling");
    const sur = marshalArms([cs[0]], { escutcheon: cs[1] });
    expect(sur.kind === "marshalled" && sur.method).toBe("single");
    expect(blazon(sur)).toMatch(/over all (on )?an escutcheon/);
  });

  it("finds canting charges in name glosses", () => {
    expect(cantingCharge(["Wolf-spear"])).toBe("wolf");
    expect(cantingCharges(["Wolf", "spear"])).toEqual(["wolf", "spear"]);
    expect(cantingCharge(["Stone", "Ford"])).toBe("mountain");
    expect(cantingCharge(["Red", "Tower"])).toBe("tower");
    expect(cantingCharge(["ravens"])).toBe("raven");
    expect(cantingCharge(["Quiet", "Valley"])).toBeUndefined();
    for (const c of EMBLEM_CONCEPTS) expect(cantingCharge([c])).toBe(c);
  });
});

describe("renderArmsSVG", () => {
  it("emits well-formed SVG with resolvable, prefixed ids for every shape and finish", () => {
    const all = corpus(90, "svg");
    all.forEach(({ arms }, i) => {
      const shape = SHIELD_SHAPES[i % SHIELD_SHAPES.length];
      const finish = (["rich", "flat", "hatched"] as const)[i % 3];
      const svg = renderArmsSVG(arms, { shape, finish, idPrefix: "t" + i, size: [24, 64, 200][i % 3], texture: i % 7 === 0 });
      const r = checkSvg(svg);
      expect(r.errors, blazon(arms)).toEqual([]);
      for (const id of r.ids) expect(id.startsWith(`t${i}-`)).toBe(true);
    });
  });

  it("is deterministic given an idPrefix, and unique without one", () => {
    const a = corpus(1, "u")[0].arms;
    expect(renderArmsSVG(a, { idPrefix: "x" })).toBe(renderArmsSVG(a, { idPrefix: "x" }));
    const page = [renderArmsSVG(a), renderArmsSVG(a), renderArmsSVG(a)].join("");
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws every charge, in every attitude, on a shield and as an icon", () => {
    for (const id of ALL_CHARGE_IDS) {
      expect(CHARGES[id], id).toBeTruthy();
      for (const att of chargeDef(id).attitudes ?? [undefined]) {
        const a: Arms = { kind: "simple", field: { partition: "plain", tinctures: ["gules"] }, charges: { charge: id, count: 1, tincture: "or", attitude: att } };
        const svg = renderArmsSVG(a, { idPrefix: "c" });
        expect(checkSvg(svg).errors, id).toEqual([]);
        expect(svg.length).toBeGreaterThan(600);
      }
      expect(checkSvg(renderChargeSVG({ charge: id, tincture: "azure", field: "argent", idPrefix: "i" })).errors).toEqual([]);
    }
  });
});
