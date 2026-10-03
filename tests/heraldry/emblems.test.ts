import { describe, it, expect } from "vitest";
import { Rng } from "../../src/core/rng";
import { EMBLEM_CONCEPTS } from "../../src/world/concepts";
import {
  EMBLEM_KINDS, generateEmblem, renderEmblemSVG, describeEmblem, differenceEmblem, marshalEmblems, emblemArms, emblemColours,
  generateArms, generateFlag, renderFlagSVG, describeFlag, FLAG_PATTERNS, generateBanner, renderBannerSVG, describeBanner,
  BANNER_SHAPES, generateMon, renderMonSVG, describeMon, MON_GEOMETRIC, generateSeal, renderSealSVG, describeSeal,
  SEAL_MATERIALS, STYLES, blazon, isArms, isMon, isSeal, isBanner, type StyleName, type Mon,
} from "../../src/heraldry";
import { checkSvg } from "./svgcheck";

const STYLE_NAMES = Object.keys(STYLES) as StyleName[];

function textOk(t: string): void {
  expect(t.length).toBeGreaterThan(3);
  for (const bad of ["undefined", "NaN", "null", "[object", "  "]) expect(t, t).not.toContain(bad);
}

describe("emblems", () => {
  it("generates every kind deterministically, with descriptions", () => {
    for (const kind of EMBLEM_KINDS) {
      for (let i = 0; i < 12; i++) {
        const o = { kind, style: STYLE_NAMES[i % STYLE_NAMES.length], gloss: ["Wolf", "spear"], legend: "Kešdavar" };
        const a = generateEmblem(new Rng("e").fork(kind + i), o);
        const b = generateEmblem(new Rng("e").fork(kind + i), o);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.kind).toBe(kind);
        textOk(a.blazon);
        expect(describeEmblem(a)).toBe(a.blazon);
        expect(JSON.parse(JSON.stringify(a.data))).toEqual(a.data);
      }
    }
  });

  it("recognises its data", () => {
    const rng = new Rng("rec");
    const arms = generateEmblem(rng.fork(1), { kind: "arms" }).data;
    const mon = generateEmblem(rng.fork(2), { kind: "mon" }).data;
    const seal = generateEmblem(rng.fork(3), { kind: "seal" }).data;
    const ban = generateEmblem(rng.fork(4), { kind: "banner" }).data;
    expect([isArms(arms), isMon(arms), isSeal(arms), isBanner(arms)]).toEqual([true, false, false, false]);
    expect([isArms(mon), isMon(mon), isSeal(mon), isBanner(mon)]).toEqual([false, true, false, false]);
    expect([isArms(seal), isMon(seal), isSeal(seal), isBanner(seal)]).toEqual([false, false, true, false]);
    expect([isArms(ban), isMon(ban), isSeal(ban), isBanner(ban)]).toEqual([false, false, false, true]);
  });

  it("renders every kind (and Arms under every kind) as valid SVG fitted to the box", () => {
    const rng = new Rng("render");
    const arms = generateArms(rng.fork("a"), { style: "anglo" });
    const items = [
      ...EMBLEM_KINDS.map((kind, i) => generateEmblem(rng.fork(i), { kind, legend: "Tor Oshen" })),
      ...EMBLEM_KINDS.map((kind) => ({ kind, data: arms, blazon: blazon(arms) })),
    ];
    items.forEach((e, i) => {
      for (const size of [24, 48, 96, 240]) {
        const svg = renderEmblemSVG(e, { size, idPrefix: `e${i}s${size}` });
        const r = checkSvg(svg);
        expect(r.errors, `${e.kind} ${size}`).toEqual([]);
        const w = +/width="([\d.]+)"/.exec(svg)![1], h = +/height="([\d.]+)"/.exec(svg)![1];
        expect(Math.max(w, h)).toBeLessThanOrEqual(size + 0.5);
        expect(Math.max(w, h)).toBeGreaterThan(size * 0.6);
      }
    });
    // Garbage in: no crash.
    expect(checkSvg(renderEmblemSVG({ kind: "arms", data: { nonsense: 1 } })).errors).toEqual([]);
  });

  it("keeps ids unique across many emblems on one page", () => {
    const rng = new Rng("page");
    let page = "";
    for (let i = 0; i < 24; i++) page += renderEmblemSVG(generateEmblem(rng.fork(i), { kind: EMBLEM_KINDS[i % 4], legend: "Velm" }), { size: 64 });
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("differences and marshals every kind", () => {
    const rng = new Rng("dm");
    for (const kind of EMBLEM_KINDS) {
      for (let i = 0; i < 8; i++) {
        const e = generateEmblem(rng.fork(kind + i), { kind, legend: "Ondrek" });
        const before = JSON.stringify(e);
        const d = differenceEmblem(e, rng.fork("d" + i), { son: 2 + (i % 8) });
        expect(JSON.stringify(e)).toBe(before);
        expect(JSON.stringify(d.data)).not.toBe(JSON.stringify(e.data));
        expect(d.kind).toBe(kind);
        textOk(d.blazon);
        const other = generateEmblem(rng.fork("o" + i), { kind: EMBLEM_KINDS[(i + 1) % 4] });
        const m = marshalEmblems([e, other]);
        textOk(m.blazon);
        expect(checkSvg(renderEmblemSVG(m, { idPrefix: "m" })).errors).toEqual([]);
      }
    }
  });

  it("reports arms and colours", () => {
    const rng = new Rng("col");
    const e = generateEmblem(rng, { kind: "banner" });
    expect(emblemArms(e)).toBeTruthy();
    expect(emblemColours(e).length).toBeGreaterThan(0);
    const m = generateEmblem(rng.fork(2), { kind: "mon", colours: ["gules", "or"] });
    expect(emblemColours(m)).toEqual(["or", "gules"]);
  });
});

describe("flags", () => {
  it("generates every pattern deterministically with valid SVG and plain-English descriptions", () => {
    const rng = new Rng("flags");
    FLAG_PATTERNS.forEach((pattern, i) => {
      const arms = generateArms(rng.fork("a" + i), { style: STYLE_NAMES[i % STYLE_NAMES.length] });
      const o = { arms, pattern, style: STYLE_NAMES[i % STYLE_NAMES.length] };
      const f1 = generateFlag(rng.fork(i), o), f2 = generateFlag(rng.fork(i), o);
      expect(JSON.stringify(f1)).toBe(JSON.stringify(f2));
      textOk(describeFlag(f1));
      expect(checkSvg(renderFlagSVG(f1, { idPrefix: "f" + i })).errors).toEqual([]);
    });
    for (let i = 0; i < 40; i++) {
      const f = generateFlag(rng.fork("r" + i), { style: STYLE_NAMES[i % STYLE_NAMES.length], device: i % 3 === 0 ? "arms" : undefined, arms: generateArms(rng.fork("x" + i)) });
      expect(checkSvg(renderFlagSVG(f, { idPrefix: "g" + i, finish: i % 2 ? "flat" : "rich" })).errors).toEqual([]);
    }
  });
});

describe("banners", () => {
  it("draws every cloth shape with and without staff", () => {
    const rng = new Rng("ban");
    BANNER_SHAPES.forEach((shape, i) => {
      const b = generateBanner(rng.fork(i), { shape, style: STYLE_NAMES[i % STYLE_NAMES.length] });
      textOk(describeBanner(b));
      for (const staff of [true, false]) expect(checkSvg(renderBannerSVG(b, { idPrefix: "b" + i, staff })).errors).toEqual([]);
    });
  });
});

describe("mon", () => {
  it("renders every geometric motif and a mon for every emblem concept", () => {
    MON_GEOMETRIC.forEach((shape, i) => {
      const m: Mon = { motif: { kind: "geometric", shape }, enclosure: "ring" };
      textOk(describeMon(m));
      expect(checkSvg(renderMonSVG(m, { idPrefix: "g" + i })).errors).toEqual([]);
    });
    const rng = new Rng("mon");
    let canted = 0;
    for (const c of EMBLEM_CONCEPTS) {
      const m = generateMon(rng.fork(c), { motifs: [c] });
      textOk(describeMon(m));
      expect(checkSvg(renderMonSVG(m, { idPrefix: c })).errors).toEqual([]);
      if (JSON.stringify(m).includes(`"${c}"`) || /geometric|leaves|flower|embrace/.test(m.motif.kind)) canted++;
    }
    expect(canted / EMBLEM_CONCEPTS.length).toBeGreaterThan(0.9);
  });
});

describe("seals", () => {
  it("renders every material and device kind", () => {
    const rng = new Rng("seal");
    SEAL_MATERIALS.forEach((material, i) => {
      for (const dev of ["charge", "arms", "mon"] as const) {
        const s = generateSeal(rng.fork(material + dev), {
          material, legend: i % 3 ? "Sigillum Kešdavar Regis" : "Ondrek",
          arms: dev === "arms" ? generateArms(rng.fork("a" + i)) : undefined,
          mon: dev === "mon" ? generateMon(rng.fork("m" + i)) : undefined,
          ecclesiastical: i === 3,
        });
        textOk(describeSeal(s));
        expect(checkSvg(renderSealSVG(s, { idPrefix: `s${i}${dev}` })).errors).toEqual([]);
      }
    });
  });
});
