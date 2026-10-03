/**
 * Peoples and tongues over time.
 *
 *  - Language stages: every ~450–800 years a people's language moves on in
 *    place (Old X → Middle X → X): all its place names, feature names, realm
 *    names and personal-name stock evolve through the new sound laws.
 *  - Splits: a group of a people's towns cut off by sea, by distance from the
 *    core, or by centuries under a separate realm becomes a daughter people
 *    with a daughter language (`deriveLanguage`); its place names evolve.
 *  - Assimilation: towns long under foreign rule, or swamped by neighbours,
 *    shift to the rulers' tongue; their names are borrowed (exonyms).
 *  - Conquest renames: a conqueror may impose a new name (or its own form of
 *    the old one); a town returning to its old people may get its old name back.
 */
import * as L from "../lang/index";
import type { LName, LLang } from "./names";
import { archetypeAt, cultureColor, jitterValues, makeCulture } from "./cultures";
import { evolveFeatureNames } from "./features";
import { deriveLocalScript } from "./tech";
import type { CulS, SetS, Sim } from "./sim";
import type { NameChangeReason, WName } from "./types";
import { rgbToHue } from "./util";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renameTown(sim: Sim, s: SetS, name: LName, reason: NameChangeReason, announce: number): void {
  const from = s.name.roman;
  if (from === name.roman && reason === "evolved") {
    s.name = name;
    return;
  }
  sim.renameSettlement(s, name, reason);
  if (announce > 0) {
    sim.emit("settlementRenamed", announce, s.cell, { settlements: [s.id], polities: [s.owner], cultures: [s.culture] }, { settlement: s.id, from, to: name.roman, reason, polity: s.owner, culture: s.culture });
  }
}

/** Seed a new language's personal-name pool with the evolved names of its parent. */
function inheritNamePool(sim: Sim, from: LLang, to: LLang): void {
  const reg = sim.names.reg;
  const src = reg.pools[from.id];
  if (!src) return;
  const ev = (n: LName) => {
    try {
      return L.evolveName(n, from, to);
    } catch {
      return n;
    }
  };
  reg.pools[to.id] = { m: src.m.slice(0, 24).map(ev), f: src.f.slice(0, 16).map(ev) };
}

/** Bring a name into a people's tongue: regular evolution where it descends, borrowing otherwise. */
function nativise(sim: Sim, n: LName, to: LLang): LName {
  return sim.names.adapt(n, to, sim.year);
}

// ---------------------------------------------------------------------------
// Language stages
// ---------------------------------------------------------------------------

function stage(sim: Sim, C: CulS): void {
  const rng = sim.rng.lang;
  const old = C.lang;
  const nl = L.deriveLanguage(old, rng.fork(`stage${sim.h.languages.length}`), sim.year, { stage: true });
  const id = sim.names.addLanguage(nl, C.id, C.langId, "stage", sim.year);
  const prev = C.langId;
  C.lang = nl;
  C.langId = id;
  sim.pushChange(C.rec.languages, { year: sim.year, lang: id }, (a, b) => a.lang === b.lang);
  inheritNamePool(sim, old, nl);
  let renamed = 0;
  for (const sid of sim.alive()) {
    const s = sim.S[sid];
    if (s.name.lang !== old.id) continue;
    const nn = L.evolveName(s.name, old, nl);
    if (nn.roman !== s.name.roman) renamed++;
    renameTown(sim, s, nn, "evolved", s.rank >= 3 ? 1 : 0);
  }
  for (const P of sim.P) {
    if (!P.alive || P.name.lang !== old.id) continue;
    const nn = L.evolveName(P.name, old, nl);
    if (nn.roman !== P.name.roman) {
      const from = P.name.roman;
      sim.renamePolity(P, nn, "evolved");
      if (P.sets.length >= 10) sim.emit("polityRenamed", 1, P.capital >= 0 ? sim.S[P.capital].cell : -1, { polities: [P.id] }, { polity: P.id, from, to: nn.roman, reason: "evolved" });
    } else P.name = nn;
  }
  C.rec.name = L.evolveName(C.rec.name as unknown as LName, old, nl) as unknown as WName;
  for (const role of ["ruler", "emperor", "chief", "priest", "noble", "general"] as const) C.rec.titles[role] = L.nameTitle(nl, role) as unknown as WName;
  evolveFeatureNames(sim, C.id);
  if (C.script >= 0 && rng.chance(0.12)) deriveLocalScript(sim, C, 0.3);
  sim.emit("languageEvolved", 3, C.core, { cultures: [C.id], languages: [id, prev] }, { language: id, previous: prev, culture: C.id, renamedPlaces: renamed });
  C.stageDue = sim.year + rng.int(700, 1100);
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

/** Connected groups of a people's towns (adjacent catchments). */
function groups(sim: Sim, c: number): number[][] {
  const S = sim.S;
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const sid of sim.alive()) {
    if (S[sid].culture !== c || seen.has(sid)) continue;
    const g: number[] = [];
    const q = [sid];
    seen.add(sid);
    while (q.length) {
      const x = q.pop()!;
      g.push(x);
      for (const n of S[x].nbrs) if (!seen.has(n) && S[n].alive && S[n].culture === c) {
        seen.add(n);
        q.push(n);
      }
    }
    out.push(g.sort((a, b) => a - b));
  }
  return out;
}

function considerSplits(sim: Sim): void {
  const rng = sim.rng.lang;
  for (const C of sim.C.slice()) {
    if (!C.alive || C.sets < 20 || sim.year - C.lastSplit < 380) continue;
    // A world of a few dozen tongues, not hundreds.
    if (sim.C.filter((x) => x.alive).length >= 26) break;
    const gs = groups(sim, C.id);
    const core = C.bigCity >= 0 ? C.bigCity : -1;
    const coreGroup = gs.find((g) => g.includes(core)) ?? gs.slice().sort((a, b) => b.length - a.length)[0];
    if (!coreGroup) continue;
    const coreCell = core >= 0 ? sim.S[core].cell : sim.S[coreGroup[0]].cell;
    // 1. Separated groups (overseas or beyond a gap).
    let target: number[] | null = null;
    let cause: "distance" | "sea" | "realm" = "distance";
    let namedAfter = -1;
    for (const g of gs) {
      if (g === coreGroup || g.length < 10) continue;
      const age = g.reduce((a, sid) => a + (sim.year - sim.S[sid].cultureSince), 0) / g.length;
      if (age < 250) continue;
      const lmA = sim.w.landmassOf[sim.S[g[0]].cell], lmB = sim.w.landmassOf[coreCell];
      cause = lmA !== lmB ? "sea" : "distance";
      target = g;
      break;
    }
    // 2. Centuries under a separate realm of the same people.
    if (!target) {
      const byRealm = new Map<number, number[]>();
      for (const sid of coreGroup) {
        const o = sim.S[sid].owner;
        if (o < 0) continue;
        (byRealm.get(o) ?? byRealm.set(o, []).get(o)!).push(sid);
      }
      const mainRealm = core >= 0 ? sim.S[core].owner : -1;
      for (const [o, list] of [...byRealm.entries()].sort((a, b) => a[0] - b[0])) {
        if (o === mainRealm || list.length < 18) continue;
        const P = sim.P[o];
        if (P.culture !== C.id || sim.year - P.founded < 350 || P.rebel) continue;
        const held = list.filter((sid) => sim.year - sim.S[sid].ownerSince >= 250);
        if (held.length < 15) continue;
        target = held;
        cause = "realm";
        namedAfter = o;
        break;
      }
    }
    // 3. The far reaches of a sprawling people.
    if (!target) {
      const far = coreGroup.filter((sid) => sim.distKm(sim.S[sid].cell, coreCell) > 2600 && sim.year - sim.S[sid].cultureSince > 250);
      if (far.length >= 18) target = far;
      cause = "distance";
    }
    if (!target || !rng.chance(0.4)) continue;
    split(sim, C, target, cause, namedAfter);
  }
}

function split(sim: Sim, C: CulS, members: number[], cause: "distance" | "sea" | "realm", namedAfterPolity: number): void {
  const rng = sim.rng.lang;
  const S = sim.S;
  // Anchor: the largest town of the group.
  let anchor = members[0];
  for (const sid of members) if (S[sid].urban > S[anchor].urban) anchor = sid;
  const avoid = [...sim.names.usedLangNames];
  const nl = L.deriveLanguage(C.lang, rng.fork(`split${sim.h.languages.length}`), sim.year, { avoidNames: avoid });
  const langId = sim.names.addLanguage(nl, -1, C.langId, "split", sim.year);
  inheritNamePool(sim, C.lang, nl);
  const place = namedAfterPolity >= 0 ? nativise(sim, sim.P[namedAfterPolity].name, nl) : nativise(sim, S[anchor].name, nl);
  const name = sim.names.people(nl, rng, { place, feature: undefined });
  const hue = rgbToHue(C.rec.color);
  const D = makeCulture(sim, {
    name, lang: nl, langId, homeCell: S[anchor].cell, archetype: rng.chance(0.7) ? C.archetype : archetypeAt(sim, S[anchor].cell, C.archetype === "steppe"),
    values: jitterValues(C.values, rng, 0.12), parent: C.id, color: cultureColor(sim.C.length, hue, rng.int(-40, 40)), tech: C.tech, script: C.script, family: C.rec.family,
    namedAfter: namedAfterPolity >= 0 ? namedAfterPolity : anchor, styleFrom: C,
  });
  D.raiders = C.raiders;
  D.nextTech = C.nextTech;
  D.techAnnounced = C.techAnnounced;
  D.folk = C.folk;
  D.rec.folkReligion = C.folk;
  sim.h.languages[langId].culture = D.id;
  let renamed = 0;
  for (const sid of members) {
    const s = S[sid];
    sim.setCulture(s, D.id);
    if (s.name.lang === C.lang.id) {
      const nn = L.evolveName(s.name, C.lang, nl);
      if (nn.roman !== s.name.roman) renamed++;
      renameTown(sim, s, nn, "evolved", 0);
    }
  }
  // Realms of the group now belong to the new people.
  for (const P of sim.P) {
    if (!P.alive || P.culture !== C.id || P.capital < 0 || !members.includes(P.capital)) continue;
    P.culture = D.id;
    sim.pushChange(P.rec.cultures, { year: sim.year, culture: D.id }, (a, b) => a.culture === b.culture);
    if (P.name.lang === C.lang.id) {
      const nn = L.evolveName(P.name, C.lang, nl);
      if (nn.roman !== P.name.roman) sim.renamePolity(P, nn, "evolved");
      else P.name = nn;
    }
  }
  evolveFeatureNames(sim, C.id, D.id);
  if (D.script >= 0 && rng.chance(0.3)) deriveLocalScript(sim, D, 0.55);
  C.lastSplit = D.lastSplit = sim.year;
  const imp = members.length >= 25 ? 4 : 3;
  sim.emit("cultureSplit", imp, S[anchor].cell, { cultures: [D.id, C.id], languages: [langId, C.langId], settlements: [anchor], polities: [namedAfterPolity] }, { culture: D.id, parent: C.id, language: langId, cause });
  sim.emit("languageSplit", 2, S[anchor].cell, { languages: [langId, C.langId], cultures: [D.id] }, { language: langId, parent: C.langId, culture: D.id });
  void renamed;
}

// ---------------------------------------------------------------------------
// Assimilation
// ---------------------------------------------------------------------------

function assimilate(sim: Sim): void {
  const rng = sim.rng.lang;
  const S = sim.S;
  const shifts = new Map<string, { to: number; from: number; polity: number; sets: number[]; cause: "conquest" | "migration" | "prestige" }>();
  for (const sid of sim.alive()) {
    const s = S[sid];
    let to = -1;
    let cause: "conquest" | "migration" | "prestige" = "conquest";
    let p = 0;
    if (s.owner >= 0) {
      const P = sim.P[s.owner];
      if (P.culture !== s.culture && sim.C[P.culture].alive) {
        const years = sim.year - Math.max(s.ownerSince, s.cultureSince);
        if (years >= 70) {
          to = P.culture;
          p = 0.06 * Math.min(2.5, years / 150) * (sim.familyOf(P.culture) === sim.familyOf(s.culture) ? 1.6 : 1) * (s.rank >= 2 ? 0.5 : 1);
          if (P.gov === "horde") cause = "migration";
        }
      }
    }
    // Swamped by neighbours of one people.
    if (s.nbrs.length >= 3) {
      const cnt = new Map<number, number>();
      for (const n of s.nbrs) if (S[n].culture !== s.culture) cnt.set(S[n].culture, (cnt.get(S[n].culture) ?? 0) + 1);
      for (const [c, k] of cnt) if (k / s.nbrs.length >= 0.75 && sim.C[c].alive && (to < 0 || c === to)) {
        to = c;
        p += 0.04;
        if (cause !== "migration") cause = "prestige";
      }
    }
    if (to < 0 || !rng.chance(p)) continue;
    const from = s.culture;
    const D = sim.C[to];
    sim.setCulture(s, to);
    const nn = nativise(sim, s.name, D.lang);
    if (nn !== s.name) renameTown(sim, s, nn, L.pathBetween({ id: s.name.lang }, D.lang) ? "evolved" : "assimilated", s.rank >= 2 ? 2 : 0);
    const key = `${to}:${from}:${s.owner}`;
    const e = shifts.get(key) ?? { to, from, polity: s.owner, sets: [], cause };
    e.sets.push(sid);
    shifts.set(key, e);
  }
  for (const e of shifts.values()) {
    if (e.sets.length < 2 && !e.sets.some((x) => S[x].rank >= 2)) continue;
    sim.emit("languageShift", e.sets.length >= 10 ? 3 : 2, S[e.sets[0]].cell, { cultures: [e.to, e.from], settlements: e.sets.slice(0, 20), polities: [e.polity] }, { culture: e.to, from: e.from, settlements: e.sets, polity: e.polity, cause: e.cause });
  }
}

/** Peoples without towns fade away. */
function extinctions(sim: Sim): void {
  const count = new Int32Array(sim.C.length);
  for (const sid of sim.alive()) count[sim.S[sid].culture]++;
  for (const C of sim.C) {
    if (C.alive && count[C.id] === 0) {
      C.alive = false;
      C.rec.ended = sim.year;
    }
  }
}

// ---------------------------------------------------------------------------
// Conquest renames (called from polities.transfer)
// ---------------------------------------------------------------------------

export function conquestRename(sim: Sim, sid: number, to: number): void {
  const rng = sim.rng.names;
  const s = sim.S[sid];
  const P = sim.P[to];
  if (!P || P.culture === s.culture || s.rank < 1) {
    maybeRestore(sim, s, to);
    return;
  }
  if (!rng.chance(s.rank >= 3 ? 0.12 : 0.08)) {
    maybeRestore(sim, s, to);
    return;
  }
  const C = sim.C[P.culture];
  if (P.ruler >= 0 && rng.chance(0.35)) {
    const nn = sim.names.settlement(C.lang, rng, { founder: sim.Pe[P.ruler].rec.name as unknown as LName, pattern: "founder" });
    renameTown(sim, s, nn, "renamed", s.rank >= 3 ? 3 : 2);
  } else {
    const nn = nativise(sim, s.name, C.lang);
    if (nn.roman !== s.name.roman) renameTown(sim, s, nn, "conquest", s.rank >= 3 ? 3 : 2);
  }
}

function maybeRestore(sim: Sim, s: SetS, to: number): void {
  if (to < 0 || s.rec.names.length < 2) return;
  const P = sim.P[to];
  const lang = sim.C[P.culture].lang;
  // An earlier name in the conqueror's own tongue (or one it descends from).
  for (let i = s.rec.names.length - 2; i >= 0; i--) {
    const old = s.rec.names[i].name as unknown as LName;
    if (old.lang !== lang.id && !L.pathBetween({ id: old.lang }, lang)) continue;
    if (old.roman === s.name.roman) return;
    if (!sim.rng.names.chance(0.4)) return;
    renameTown(sim, s, nativise(sim, old, lang), "restored", s.rank >= 2 ? 2 : 1);
    return;
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tickDivergence(sim: Sim): void {
  const y = sim.year;
  if (y % 25 !== 12) return;
  for (const C of sim.C.slice()) if (C.alive && C.sets > 0 && y >= C.stageDue) stage(sim, C);
  considerSplits(sim);
  assimilate(sim);
  extinctions(sim);
}
