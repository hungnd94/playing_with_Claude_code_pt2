/**
 * End of the run: give languages their final English names ("Proto-Keshi",
 * "Old Keshi", "Middle Keshi", "Keshi"), close open records, derive the ages
 * of world history, and convert every rich language-engine name into a
 * plain `WName` (with etymologies rendered using the final language names).
 */
import type { Language as LLang } from "../lang/index";
import { deriveAges } from "./ages";
import { finishPersons } from "./people";
import type { Sim } from "./sim";
import type { History } from "./types";

export function nameLanguages(sim: Sim): void {
  const h = sim.h;
  const L = h.languages;
  const base = (id: number) => (sim.names.langs[id] as LLang).name;
  // Chains of in-place stages: follow children with origin "stage".
  const visited = new Set<number>();
  for (const l of L) {
    if (visited.has(l.id)) continue;
    // Find chain head: walk up while origin is "stage".
    let head = l.id;
    while (L[head].origin === "stage" && L[head].parent >= 0) head = L[head].parent;
    const chain: number[] = [head];
    let cur = head;
    for (;;) {
      const next = L[cur].children.find((c) => L[c].origin === "stage");
      if (next === undefined) break;
      chain.push(next);
      cur = next;
    }
    for (const id of chain) visited.add(id);
    const k = chain.length - 1;
    chain.forEach((id, i) => {
      const fromEnd = k - i;
      const b = base(id);
      let name: string;
      if (fromEnd === 0) name = b;
      else if (fromEnd === 1) name = k === 1 ? `Old ${b}` : `Middle ${b}`;
      else if (fromEnd === 2) name = `Old ${b}`;
      else name = `Archaic ${b}`;
      if (i === 0 && k > 0 && L[id].origin === "proto" && L[id].children.some((c) => L[c].origin === "split")) name = `Proto-${b}`;
      if (i === 0 && k === 0 && L[id].origin === "proto" && L[id].children.length > 0) name = `Proto-${b}`;
      L[id].name = name;
      if (i < k) L[id].ended = L[chain[i + 1]].born;
    });
  }
  // Languages of extinct peoples end with them.
  for (const C of sim.C) {
    if (C.alive) continue;
    const last = C.rec.languages[C.rec.languages.length - 1];
    if (last && L[last.lang].ended < 0) L[last.lang].ended = C.rec.ended;
  }
}

export function finalize(sim: Sim): History {
  const h = sim.h;
  finishPersons(sim);
  nameLanguages(sim);
  h.ages = deriveAges(sim);
  convertNames(sim);
  return h;
}

function convertNames(sim: Sim): void {
  const N = sim.names;
  N.setLabels();
  const h = sim.h;
  for (const l of h.languages) l.endonym = N.toW(l.endonym);
  for (const c of h.cultures) {
    c.name = N.toW(c.name);
    for (const k of Object.keys(c.titles) as (keyof typeof c.titles)[]) c.titles[k] = N.toW(c.titles[k]);
  }
  for (const s of h.settlements) for (const r of s.names) r.name = N.toW(r.name);
  for (const p of h.polities) for (const r of p.names) r.name = N.toW(r.name);
  for (const p of h.persons) p.name = N.toW(p.name);
  for (const d of h.dynasties) d.name = N.toW(d.name);
  for (const r of h.religions) {
    r.name = N.toW(r.name);
    if (r.clergy) r.clergy = N.toW(r.clergy);
  }
  for (const d of h.deities) d.name = N.toW(d.name);
  for (const w of h.wonders) w.name = N.toW(w.name);
  for (const w of h.works) w.title = N.toW(w.title);
  for (const s of h.scripts) if (s.nativeName) s.nativeName = N.toW(s.nativeName);
  for (const f of h.featureNames) for (const r of f.names) r.name = N.toW(r.name);
}
