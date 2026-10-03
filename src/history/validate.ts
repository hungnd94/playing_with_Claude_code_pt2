/**
 * Consistency checks over a finished History: referential integrity, sorted
 * change lists, plausible lives and families, reigns within lifetimes, and
 * timeline layers that agree with entity lifetimes. Returns a list of
 * problems (empty = valid). Used by tests and by tools/history-run.ts.
 */
import { layerAt } from "./query";
import type { History, HEvent, Id } from "./types";

export function validateHistory(h: History, maxProblems = 50): string[] {
  const out: string[] = [];
  const bad = (msg: string) => {
    if (out.length < maxProblems) out.push(msg);
  };
  const N = {
    polities: h.polities.length, persons: h.persons.length, settlements: h.settlements.length, cultures: h.cultures.length, religions: h.religions.length,
    wars: h.wars.length, battles: h.battles.length, dynasties: h.dynasties.length, wonders: h.wonders.length, works: h.works.length, disasters: h.disasters.length,
    languages: h.languages.length, scripts: h.scripts.length, features: Infinity,
  } as const;
  const ok = (kind: keyof typeof N, id: Id) => id === -1 || (Number.isInteger(id) && id >= 0 && id < N[kind]);
  const sorted = <T extends { year: number }>(list: T[], what: string) => {
    for (let i = 1; i < list.length; i++) if (list[i].year < list[i - 1].year) {
      bad(`${what}: change list not sorted at ${i}`);
      return;
    }
  };

  // Ids are dense.
  const dense = (arr: { id: number }[], what: string) => arr.forEach((x, i) => x.id !== i && bad(`${what}[${i}].id = ${x.id}`));
  dense(h.polities, "polities");
  dense(h.persons, "persons");
  dense(h.settlements, "settlements");
  dense(h.cultures, "cultures");
  dense(h.religions, "religions");
  dense(h.wars, "wars");
  dense(h.battles, "battles");
  dense(h.events, "events");

  // Events: sorted, references valid.
  for (let i = 0; i < h.events.length; i++) {
    const e: HEvent = h.events[i];
    if (i > 0 && e.year < h.events[i - 1].year) bad(`event ${i} out of order`);
    if (e.importance < 1 || e.importance > 5) bad(`event ${i} importance ${e.importance}`);
    for (const k of Object.keys(N) as (keyof typeof N)[]) {
      const ids = (e as unknown as Record<string, Id[] | undefined>)[k];
      if (ids) for (const id of ids) if (!ok(k, id) || id < 0) bad(`event ${i} (${e.type}) bad ${k} ref ${id}`);
    }
  }

  // Persons.
  for (const p of h.persons) {
    if (p.died >= 0 && p.died < p.born) bad(`person ${p.id} dies before birth`);
    for (const par of [p.father, p.mother]) {
      if (!ok("persons", par)) {
        bad(`person ${p.id} bad parent ${par}`);
        continue;
      }
      if (par < 0) continue;
      const q = h.persons[par];
      if (q.born >= p.born) bad(`person ${p.id} born ${p.born} not after parent ${par} born ${q.born}`);
      if (par === p.mother && q.died >= 0 && q.died < p.born) bad(`person ${p.id} born after mother's death`);
      if (par === p.father && q.died >= 0 && q.died < p.born - 1) bad(`person ${p.id} born >1y after father's death`);
      if (!q.children.includes(p.id)) bad(`person ${p.id} missing from parent ${par}'s children`);
    }
    if (!ok("dynasties", p.dynasty) || !ok("cultures", p.culture)) bad(`person ${p.id} bad dynasty/culture`);
    for (const r of p.roles) {
      if (r.to >= 0 && r.to < r.from) bad(`person ${p.id} role ${r.kind} ends before it starts`);
      if (r.from < p.born) bad(`person ${p.id} role ${r.kind} before birth`);
      if (p.died >= 0 && r.from > p.died) bad(`person ${p.id} role ${r.kind} after death`);
    }
    for (const s of p.spouses) if (!ok("persons", s) || !h.persons[s].spouses.includes(p.id)) bad(`person ${p.id} spouse ${s} not reciprocal`);
  }

  // Polities and reigns.
  for (const P of h.polities) {
    sorted(P.names, `polity ${P.id} names`);
    sorted(P.governments, `polity ${P.id} governments`);
    sorted(P.capitals, `polity ${P.id} capitals`);
    sorted(P.religions, `polity ${P.id} religions`);
    sorted(P.overlords, `polity ${P.id} overlords`);
    sorted(P.cultures, `polity ${P.id} cultures`);
    if (P.ended >= 0 && P.ended < P.founded) bad(`polity ${P.id} ends before founding`);
    for (const c of P.capitals) if (!ok("settlements", c.settlement) || c.settlement < 0) bad(`polity ${P.id} bad capital ${c.settlement}`);
    for (const r of P.rulers) {
      if (!ok("persons", r.person) || r.person < 0) {
        bad(`polity ${P.id} bad ruler ${r.person}`);
        continue;
      }
      const p = h.persons[r.person];
      if (r.from < P.founded) bad(`polity ${P.id} ruler ${r.person} before founding`);
      if (r.to >= 0 && r.to < r.from) bad(`polity ${P.id} reign ends before it starts`);
      if (p.born > r.from) bad(`polity ${P.id} ruler ${r.person} reigns before birth`);
      if (p.died >= 0 && p.died < r.from) bad(`polity ${P.id} ruler ${r.person} reigns after death`);
      if (r.to < 0 && p.died >= 0) bad(`polity ${P.id} ruler ${r.person} still reigning but dead`);
      if (p.regnal < 1) bad(`ruler ${r.person} has no regnal number`);
    }
    for (const q of [...P.predecessors, ...P.successors]) if (!ok("polities", q)) bad(`polity ${P.id} bad predecessor/successor ${q}`);
    for (const w of P.wars) if (!ok("wars", w)) bad(`polity ${P.id} bad war ${w}`);
    const st = P.stats;
    if (st.pop.length !== st.areaKm2.length || st.pop.length !== st.settlements.length || st.pop.length !== st.strength.length) bad(`polity ${P.id} stat series lengths differ`);
  }

  // Settlements.
  for (const s of h.settlements) {
    sorted(s.names, `settlement ${s.id} names`);
    sorted(s.owners, `settlement ${s.id} owners`);
    sorted(s.cultures, `settlement ${s.id} cultures`);
    sorted(s.religions, `settlement ${s.id} religions`);
    if (s.ended >= 0 && s.ended < s.founded) bad(`settlement ${s.id} ends before founding`);
    for (const o of s.owners) {
      if (!ok("polities", o.polity)) bad(`settlement ${s.id} bad owner ${o.polity}`);
      else if (o.polity >= 0) {
        const P = h.polities[o.polity];
        if (o.year < P.founded || (P.ended >= 0 && o.year > P.ended)) bad(`settlement ${s.id} owned by ${o.polity} outside its life (${o.year}; ${P.founded}–${P.ended})`);
      }
    }
    for (const c of s.cultures) if (!ok("cultures", c.culture) || c.culture < 0) bad(`settlement ${s.id} bad culture`);
    for (const r of s.religions) if (!ok("religions", r.religion) || r.religion < 0) bad(`settlement ${s.id} bad religion`);
    if (s.popStart * h.sampleStep < s.founded) bad(`settlement ${s.id} popStart before founding`);
  }

  // Cultures, languages, religions, wars.
  for (const c of h.cultures) {
    if (!ok("cultures", c.parent)) bad(`culture ${c.id} bad parent`);
    sorted(c.languages, `culture ${c.id} languages`);
    sorted(c.scripts, `culture ${c.id} scripts`);
    sorted(c.tech, `culture ${c.id} tech`);
    for (const l of c.languages) if (!ok("languages", l.lang) || l.lang < 0) bad(`culture ${c.id} bad language`);
    for (const s of c.scripts) if (!ok("scripts", s.script)) bad(`culture ${c.id} bad script`);
  }
  for (const l of h.languages) if (!ok("languages", l.parent) || !ok("cultures", l.culture)) bad(`language ${l.id} bad parent/culture`);
  for (const r of h.religions) if (!ok("religions", r.parent) || !ok("settlements", r.holyCity) || !ok("persons", r.founder)) bad(`religion ${r.id} bad refs`);
  for (const w of h.wars) {
    if (w.end >= 0 && w.end < w.start) bad(`war ${w.id} ends before start`);
    for (const b of w.battles) if (!ok("battles", b) || h.battles[b].war !== w.id) bad(`war ${w.id} bad battle ${b}`);
    for (const t of w.transfers) if (!ok("settlements", t.settlement)) bad(`war ${w.id} bad transfer`);
    if (!w.name) bad(`war ${w.id} has no name`);
  }
  for (const b of h.battles) {
    const w = h.wars[b.war];
    if (b.year < w.start || (w.end >= 0 && b.year > w.end)) bad(`battle ${b.id} outside its war`);
  }

  // Timeline: owners in the layer exist at that time.
  const t = h.timeline;
  if (t.owner.keyframes.length !== Math.ceil(t.snapshots / t.keyEvery)) bad(`timeline keyframe count ${t.owner.keyframes.length} vs ${t.snapshots}/${t.keyEvery}`);
  for (let s = 0; s < t.snapshots; s += 7) {
    const year = s * t.step;
    const layer = layerAt(t.owner, t, year);
    const seen = new Set<number>();
    for (let i = 0; i < layer.length; i++) {
      const v = layer[i];
      if (v < 0 || seen.has(v)) continue;
      seen.add(v);
      if (v >= h.polities.length) {
        bad(`timeline ${year}: owner ${v} out of range`);
        continue;
      }
      const P = h.polities[v];
      if (P.founded > year || (P.ended >= 0 && P.ended <= year)) bad(`timeline ${year}: polity ${v} (${P.founded}–${P.ended}) owns cells`);
    }
  }
  return out;
}
