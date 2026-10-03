/**
 * Peoples: the founding cultures at the dawn of history (hearths in the best
 * river valleys and coasts of every landmass, plus pastoral peoples of the
 * steppe), their proto-languages, values and heraldic traditions.
 *
 * Later dynamics — splits into daughter peoples and languages, in-place
 * language stages, assimilation — live in ./divergence.ts.
 */
import * as L from "../lang/index";
import type { Flavour } from "../lang/index";
import { Biome } from "../world/types";
import { cultureStyle } from "./emblems";
import { archetypeConcept } from "./names";
import type { Sim, CulS } from "./sim";
import type { Archetype, Culture, CultureValues, RGB, SuccessionLaw, WName } from "./types";
import { clamp, hsl } from "./util";

const BASE_VALUES: Record<Archetype, CultureValues> = {
  riverine: { martial: 0.4, mercantile: 0.5, piety: 0.6, art: 0.6, expansion: 0.55, seafaring: 0.2 },
  coastal: { martial: 0.4, mercantile: 0.7, piety: 0.4, art: 0.5, expansion: 0.5, seafaring: 0.7 },
  steppe: { martial: 0.85, mercantile: 0.3, piety: 0.35, art: 0.3, expansion: 0.8, seafaring: 0.05 },
  forest: { martial: 0.55, mercantile: 0.3, piety: 0.5, art: 0.4, expansion: 0.5, seafaring: 0.2 },
  mountain: { martial: 0.6, mercantile: 0.35, piety: 0.6, art: 0.45, expansion: 0.35, seafaring: 0.1 },
  desert: { martial: 0.55, mercantile: 0.65, piety: 0.65, art: 0.4, expansion: 0.45, seafaring: 0.2 },
  jungle: { martial: 0.45, mercantile: 0.35, piety: 0.65, art: 0.6, expansion: 0.45, seafaring: 0.25 },
  tundra: { martial: 0.5, mercantile: 0.3, piety: 0.5, art: 0.35, expansion: 0.35, seafaring: 0.35 },
  island: { martial: 0.4, mercantile: 0.6, piety: 0.5, art: 0.5, expansion: 0.5, seafaring: 0.85 },
};

const FLAVOUR: Record<Archetype, Flavour> = {
  riverine: "river", coastal: "coast", steppe: "steppe", forest: "forest", mountain: "mountains", desert: "desert", jungle: "jungle", tundra: "tundra", island: "islands",
};

export function archetypeAt(sim: Sim, cell: number, pastoral: boolean): Archetype {
  const w = sim.w, g = sim.g;
  if (pastoral) return "steppe";
  const lm = w.landmassOf[cell];
  if (lm >= 0 && w.features[lm].kind === "island" && w.features[lm].size < 1.5e6) return "island";
  const b = w.biome[cell];
  if (w.riverOrder[cell] >= 3) return b === Biome.HotDesert ? "desert" : "riverine";
  if (b === Biome.Rainforest || b === Biome.TropicalDryForest) return "jungle";
  if (b === Biome.HotDesert || b === Biome.ColdDesert) return "desert";
  if (w.elevation[cell] > 1.2) return "mountain";
  if (b === Biome.Tundra || b === Biome.IceSheet) return "tundra";
  if (g.coastal[cell]) return "coastal";
  if (b === Biome.Taiga || b === Biome.TemperateForest || b === Biome.TemperateRainforest) return "forest";
  if (b === Biome.Steppe) return "steppe";
  return "riverine";
}

function lawFor(arch: Archetype, r: number): SuccessionLaw {
  if (arch === "steppe") return r < 0.75 ? "tanistry" : "seniority";
  if (arch === "forest" || arch === "tundra") return r < 0.35 ? "elective" : r < 0.55 ? "tanistry" : "primogeniture";
  if (arch === "desert") return r < 0.4 ? "seniority" : "primogeniture";
  return r < 0.65 ? "primogeniture" : r < 0.8 ? "seniority" : "elective";
}

/** Pick the hearths of the founding peoples. */
function chooseHearths(sim: Sim): { cell: number; pastoral: boolean }[] {
  const { w, g } = sim;
  const rng = sim.rng.cultures;
  let total = 0;
  for (const v of g.landmassFood.values()) total += v;
  const nFarm = rng.int(9, 13);
  // Allocate across landmasses ∝ food^0.8 (every sizeable landmass gets at least one people).
  const lms = [...g.landmassFood.entries()].filter(([, f]) => f > total * 0.025).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const weights = lms.map(([, f]) => Math.pow(f, 0.8));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const alloc = lms.map((_, i) => Math.max(1, Math.round((nFarm * weights[i]) / wsum)));
  const out: { cell: number; pastoral: boolean }[] = [];
  const far = (c: number, minKm: number) => out.every((h) => sim.distKm(h.cell, c) >= minKm);
  lms.forEach(([lm], li) => {
    const cells: number[] = [];
    for (const c of g.landCells) if (w.landmassOf[c] === lm && g.site[c] > 0.9) cells.push(c);
    const score = new Map<number, number>();
    for (const c of cells) score.set(c, g.site[c] + (w.riverOrder[c] >= 2 ? 0.5 : 0) + (w.riverOrder[c] >= 4 ? 0.3 : 0) + rng.range(0, 0.6));
    cells.sort((a, b) => score.get(b)! - score.get(a)! || a - b);
    const areaKm2 = w.features[lm].size;
    const minKm = clamp(Math.sqrt(areaKm2 / Math.max(1, alloc[li])) * 0.75, 900, 2600);
    let placed = 0;
    for (const c of cells) {
      if (placed >= alloc[li]) break;
      if (!far(c, minKm)) continue;
      out.push({ cell: c, pastoral: false });
      placed++;
    }
  });
  // Pastoral peoples on the steppes, away from the farmers.
  const steppeCells: number[] = [];
  for (const c of g.landCells) if (g.steppe[c] && w.fertility[c] > 0.15 && w.biome[c] !== Biome.HotDesert) steppeCells.push(c);
  if (steppeCells.length > 40) {
    const nPast = rng.int(1, 3);
    const sc = new Map<number, number>();
    for (const c of steppeCells) {
      let s = 0;
      for (let k = w.mesh.adjStart[c]; k < w.mesh.adjStart[c + 1]; k++) s += g.steppe[w.mesh.adj[k]];
      sc.set(c, s + rng.range(0, 3) + (w.resources[c] & 512 ? 2 : 0));
    }
    steppeCells.sort((a, b) => sc.get(b)! - sc.get(a)! || a - b);
    let placed = 0;
    for (const c of steppeCells) {
      if (placed >= nPast) break;
      if (!far(c, 1300)) continue;
      out.push({ cell: c, pastoral: true });
      placed++;
    }
  }
  return out;
}

export function cultureColor(i: number, parentHue = -1, rngShift = 0): RGB {
  if (parentHue >= 0) return hsl(parentHue + rngShift, 0.5, 0.5 + (rngShift % 7) * 0.01);
  return hsl(i * 137.508 + 20, 0.55, 0.52);
}

/** Create a culture record + state. */
export function makeCulture(
  sim: Sim,
  o: { name: L.Name; lang: L.Language; langId: number; homeCell: number; archetype: Archetype; values: CultureValues; parent: number; color: RGB; tech: number; script: number; family: number; namedAfter: number; styleFrom?: CulS },
): CulS {
  const id = sim.C.length;
  const rng = sim.rng.cultures;
  const lat = sim.g.latDeg[o.homeCell];
  const st = o.styleFrom ? { style: o.styleFrom.style, kind: o.styleFrom.rec.heraldicStyle } : cultureStyle(o.archetype, lat, rng.fork(`style${id}`), o.lang.name);
  const titles: Culture["titles"] = {};
  for (const role of ["ruler", "emperor", "chief", "priest", "noble", "general"] as const) titles[role] = L.nameTitle(o.lang, role) as unknown as WName;
  const rec: Culture = {
    id, name: o.name as unknown as WName, adjective: o.lang.name, parent: o.parent, children: [], born: sim.year, ended: -1, homeCell: o.homeCell,
    archetype: o.archetype, values: o.values, languages: [{ year: sim.year, lang: o.langId }], scripts: [{ year: sim.year, script: o.script }],
    tech: [{ year: sim.year, level: Math.round(o.tech * 100) / 100 }], heraldicStyle: st.kind, color: o.color, titles, folkReligion: -1, family: o.family < 0 ? id : o.family,
    namedAfter: o.namedAfter,
  };
  sim.h.cultures.push(rec);
  if (o.parent >= 0) sim.h.cultures[o.parent].children.push(id);
  const parentState = o.parent >= 0 ? sim.C[o.parent] : undefined;
  const c: CulS = {
    id, rec, alive: true, lang: o.lang, langId: o.langId, stageDue: sim.year + rng.int(450, 800), tech: o.tech, script: o.script, techAnnounced: Math.floor(o.tech),
    values: o.values, archetype: o.archetype, style: st.style, core: o.homeCell, folk: parentState ? parentState.folk : -1, sets: 0, pop: 0,
    contacts: new Set(), cognatic: parentState ? parentState.cognatic : rng.chance(0.3), law: parentState ? parentState.law : lawFor(o.archetype, rng.next()),
    raiders: false, nextTech: 0, bigCity: -1, bigUrban: 0, wealth: 0, lastSplit: sim.year,
  };
  if (parentState) rec.folkReligion = parentState.folk;
  sim.C.push(c);
  sim.h.languages[o.langId].culture = sim.h.languages[o.langId].culture < 0 ? id : sim.h.languages[o.langId].culture;
  return c;
}

export function jitterValues(base: CultureValues, rng: { range(a: number, b: number): number }, amt = 0.15): CultureValues {
  const v = { ...base };
  for (const k of Object.keys(v) as (keyof CultureValues)[]) v[k] = clamp(v[k] + rng.range(-amt, amt), 0.02, 0.98);
  return v;
}

/** Create the founding peoples and their hearth settlements' cultures. Returns hearth cells per culture. */
export function initCultures(sim: Sim): { culture: number; cell: number }[] {
  const rng = sim.rng.cultures;
  const hearths = chooseHearths(sim);
  const langs: L.Language[] = [];
  const out: { culture: number; cell: number }[] = [];
  hearths.forEach((h, i) => {
    const arch = archetypeAt(sim, h.cell, h.pastoral);
    const lang = L.createProtoLanguage(rng.fork(`proto${i}`), { flavour: FLAVOUR[arch], avoid: langs, year: 0 });
    langs.push(lang);
    const langId = sim.names.addLanguage(lang, -1, -1, "proto", 0);
    const name = sim.names.people(lang, rng, { feature: archetypeConcept(arch) });
    const values = jitterValues(BASE_VALUES[arch], rng);
    const tech = arch === "riverine" ? rng.range(0.1, 0.3) : rng.range(0, 0.15);
    const c = makeCulture(sim, { name, lang, langId, homeCell: h.cell, archetype: arch, values, parent: -1, color: cultureColor(i), tech, script: -1, family: -1, namedAfter: -1 });
    c.raiders = (arch === "coastal" || arch === "island") && Math.abs(sim.g.latDeg[h.cell]) > 42 && values.martial > 0.4;
    out.push({ culture: c.id, cell: h.cell });
  });
  return out;
}

export { BASE_VALUES, FLAVOUR };
