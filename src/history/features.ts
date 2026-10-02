/**
 * Naming of geographic features. The first people to settle beside a river,
 * range, sea or landmass names it from its attributes ("the Great River",
 * "the White Mountains", "the Salt Sea"); later peoples add their own names.
 * When a language evolves, its feature names evolve with it.
 */
import { featureKindToNameKind } from "../lang/index";
import type { Name as LName } from "../lang/index";
import { featureDescriptors } from "./names";
import type { Sim } from "./sim";
import type { FeatureNaming, WName } from "./types";

const volcanoAtKey = new WeakMap<Sim, Map<number, number>>();
function volcanoAt(sim: Sim): Map<number, number> {
  let m = volcanoAtKey.get(sim);
  if (!m) {
    m = new Map();
    for (const f of sim.w.features) if (f.kind === "volcano") for (const c of f.cells) m.set(c, f.id);
    volcanoAtKey.set(sim, m);
  }
  return m;
}

const NAMEABLE = new Set(["continent", "island", "ocean", "sea", "bay", "strait", "lake", "river", "mountains", "hills", "volcano", "desert", "forest", "jungle", "steppe", "tundra", "marsh", "plain", "peninsula", "archipelago", "glacier"]);
const MAJOR = new Set(["continent", "ocean", "sea", "river", "mountains", "desert", "lake"]);

/** Features visible from a cell. */
export function featuresAround(sim: Sim, cell: number): number[] {
  const w = sim.w;
  const out: number[] = [];
  const add = (f: number) => {
    if (f >= 0 && !out.includes(f) && NAMEABLE.has(w.features[f].kind)) out.push(f);
  };
  const va = volcanoAt(sim);
  const look = (c: number) => {
    add(sim.g.riverOf[c]);
    add(w.regionOf[c]);
    if (!sim.g.land[c]) add(w.waterBodyOf[c]);
    const v = va.get(c);
    if (v !== undefined) add(v);
  };
  look(cell);
  add(w.landmassOf[cell]);
  for (let k = w.mesh.adjStart[cell]; k < w.mesh.adjStart[cell + 1]; k++) look(w.mesh.adj[k]);
  // Containing archipelago / parent features of islands.
  const lm = w.landmassOf[cell];
  if (lm >= 0) {
    const par = w.features[lm].parent;
    if (par >= 0 && w.features[par].kind === "archipelago") add(par);
  }
  return out;
}

export function nameFeaturesAround(sim: Sim, cell: number, culture: number): void {
  for (const f of featuresAround(sim, cell)) nameFeature(sim, f, culture);
}

export function featureEntry(sim: Sim, f: number): FeatureNaming {
  let e = sim.featureIdx.get(f);
  if (!e) {
    e = { feature: f, names: [] };
    sim.featureIdx.set(f, e);
    sim.h.featureNames.push(e);
  }
  return e;
}

export function nameFeature(sim: Sim, f: number, culture: number): void {
  const key = f * 4096 + culture;
  if (sim.featureNamed.has(key)) return;
  sim.featureNamed.add(key);
  const feat = sim.w.features[f];
  const C = sim.C[culture];
  const rng = sim.rng.features;
  const e = featureEntry(sim, f);
  const first = e.names.length === 0;
  // A people meeting a feature already named by neighbours often borrows the name.
  let name: LName;
  if (!first && rng.chance(0.3)) {
    const prev = e.names[rng.int(0, e.names.length - 1)].name as unknown as LName;
    name = sim.names.adapt(prev, C.lang, sim.year);
  } else {
    name = sim.names.feature(C.lang, rng, featureKindToNameKind(feat.kind), featureDescriptors(sim, feat, C.core, rng));
  }
  e.names.push({ year: sim.year, culture, name: name as unknown as WName });
  if (first) {
    const imp = MAJOR.has(feat.kind) && (feat.size > 400000 || feat.kind === "river") ? 2 : 1;
    sim.emit("featureNamed", imp, feat.anchor, { features: [f], cultures: [culture] }, { feature: f, culture, name: name.roman, gloss: name.gloss, first });
  }
}

/** Current name a culture uses for a feature (rich Name), or undefined. */
export function cultureFeatureName(sim: Sim, f: number, culture: number): LName | undefined {
  const e = sim.featureIdx.get(f);
  if (!e) return undefined;
  for (let i = e.names.length - 1; i >= 0; i--) if (e.names[i].culture === culture) return e.names[i].name as unknown as LName;
  return undefined;
}

/** The name of a feature as known to a culture (its own, else the first name borrowed), rich Name. */
export function featureNameFor(sim: Sim, f: number, culture: number): LName | undefined {
  const own = cultureFeatureName(sim, f, culture);
  if (own) return own;
  const e = sim.featureIdx.get(f);
  if (!e || !e.names.length) return undefined;
  return e.names[e.names.length - 1].name as unknown as LName;
}

/** Re-record a culture's feature names after its language evolved. */
export function evolveFeatureNames(sim: Sim, culture: number, toCulture = culture): number {
  let n = 0;
  const C = sim.C[toCulture];
  for (const e of sim.h.featureNames) {
    const cur = cultureFeatureName(sim, e.feature, culture);
    if (!cur) continue;
    if (toCulture !== culture && sim.featureNamed.has(e.feature * 4096 + toCulture)) continue;
    const nn = sim.names.adapt(cur, C.lang, sim.year);
    if (nn === cur && toCulture === culture) continue;
    e.names.push({ year: sim.year, culture: toCulture, name: nn as unknown as WName });
    sim.featureNamed.add(e.feature * 4096 + toCulture);
    n++;
  }
  return n;
}
