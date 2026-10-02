/**
 * A plausible mock `History` for developing the atlas before (or without) the
 * real simulation: peoples with real generated languages (src/lang), named
 * settlements that grow and sometimes fall to ruin, realms whose territory
 * waxes and wanes through time (owner timeline with keyframes + diffs),
 * vassals, feature names in native tongues, trade routes and battles.
 *
 * Only the fields the atlas reads are filled meaningfully; the result is cast
 * to `History`. Deterministic in (world, seed).
 */
import { Rng } from "../src/core/rng";
import { MinHeap } from "../src/core/heap";
import type { PhysicalWorld } from "../src/world/types";
import type { History, WName } from "../src/history/types";
import * as lang from "../src/lang/index";

type LangObj = ReturnType<typeof lang.createProtoLanguage>;

export function makeMockHistory(world: PhysicalWorld, seed: string, endYear = 1500): History {
  const rng = new Rng(seed).fork("atlas-mock-history");
  const { mesh } = world;
  const n = mesh.n;
  const xyz = mesh.xyz;
  const land = (i: number) => world.isLand[i] === 1 && world.lakeId[i] < 0;
  const ang = (a: number, b: number) => Math.acos(Math.max(-1, Math.min(1, xyz[3 * a] * xyz[3 * b] + xyz[3 * a + 1] * xyz[3 * b + 1] + xyz[3 * a + 2] * xyz[3 * b + 2])));
  const sp = mesh.meanSpacing;

  // --- Cultures & languages -----------------------------------------------------
  const landCells: number[] = [];
  for (let i = 0; i < n; i++) if (land(i)) landCells.push(i);
  const byFert = landCells.slice().sort((a, b) => world.fertility[b] - world.fertility[a] || a - b);
  const homes: number[] = [];
  for (const c of byFert) {
    if (homes.length >= 9) break;
    if (homes.every((h) => ang(h, c) > 14 * sp)) homes.push(c);
  }
  const langs: (LangObj | null)[] = homes.map((_, i) => {
    try {
      return lang.createProtoLanguage(rng.fork(`lang${i}`));
    } catch {
      return null;
    }
  });
  const syll = (r: Rng) => {
    const C = "bdfgklmnprstvzšh", V = "aeiouay";
    let s = "";
    const nn = r.int(2, 3);
    for (let q = 0; q < nn; q++) s += C[r.int(0, C.length - 1)] + V[r.int(0, V.length - 1)] + (r.chance(0.3) ? C[r.int(0, C.length - 1)] : "");
    return s[0].toUpperCase() + s.slice(1);
  };
  const toW = (nm: { roman: string; gloss?: string; ipa?: string } | null, li: number, r: Rng): WName => nm ? { roman: nm.roman, gloss: nm.gloss ?? "", lang: li, ipa: nm.ipa } : { roman: syll(r), gloss: "", lang: li };

  // Culture of every land cell: nearest home by hops over land.
  const cultureOf = new Int32Array(n).fill(-1);
  {
    const q: number[] = [];
    homes.forEach((h, i) => { cultureOf[h] = i; q.push(h); });
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (cultureOf[u] >= 0) continue;
        if (!world.isLand[u]) continue;
        cultureOf[u] = cultureOf[c];
        q.push(u);
      }
    }
  }
  const nearestCulture = (c: number) => {
    let best = 0, bd = Infinity;
    homes.forEach((h, i) => {
      const d = ang(h, c);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const cultures = homes.map((h, i) => {
    const L = langs[i];
    const r = rng.fork(`people${i}`);
    let nm: WName;
    try { nm = toW(L ? lang.namePeople(L, r) : null, i, r); } catch { nm = toW(null, i, r); }
    return {
      id: i, name: nm, adjective: nm.roman, parent: -1, children: [], born: 0, ended: -1, homeCell: h, archetype: "riverine",
      values: { martial: 0.5, mercantile: 0.5, piety: 0.5, art: 0.5, expansion: 0.5, seafaring: 0.5 },
      languages: [{ year: 0, lang: i }], scripts: [], tech: [{ year: 0, level: 1 }], heraldicStyle: "arms", color: [120, 100, 80],
      titles: {}, folkReligion: -1, family: i, namedAfter: -1,
    };
  });
  const languages = homes.map((_, i) => ({
    id: i, name: cultures[i].name.roman, endonym: cultures[i].name, parent: -1, children: [], born: 0, ended: -1,
    culture: i, family: i, origin: "proto", data: langs[i],
  }));

  // --- Settlements -------------------------------------------------------------------
  const sr = rng.fork("settlements");
  const score = new Float64Array(n);
  for (const c of landCells) {
    score[c] = world.fertility[c] + (world.riverOrder[c] > 0 ? 0.25 + 0.08 * world.riverOrder[c] : 0) + (world.coastDist[c] === 1 ? 0.2 : 0) + sr.next() * 0.35 - (world.elevation[c] > 2 ? 0.4 : 0);
  }
  const cand = landCells.filter((c) => world.biome[c] !== 5).sort((a, b) => score[b] - score[a] || a - b);
  const taken = new Uint8Array(n);
  const sites: number[] = [];
  for (const c of cand) {
    if (sites.length >= 520) break;
    if (taken[c]) continue;
    let ok = true;
    for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) if (taken[mesh.adj[k]] === 2) ok = false;
    if (!ok) continue;
    taken[c] = 2;
    for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) if (!taken[mesh.adj[k]]) taken[mesh.adj[k]] = 1;
    sites.push(c);
  }
  const sampleStep = 10;
  const settlements = sites.map((c, id) => {
    const r = sr.fork(id);
    const cu = cultureOf[c] >= 0 ? cultureOf[c] : nearestCulture(c);
    const L = langs[cu];
    const feats: string[] = [];
    if (world.riverOrder[c] > 0) feats.push(r.chance(0.5) ? "river" : "ford");
    if (world.coastDist[c] === 1) feats.push(r.chance(0.5) ? "coast" : "harbor");
    if (world.elevation[c] > 0.6) feats.push("hill");
    let nm: WName;
    try { nm = toW(L ? lang.nameSettlement(L, r, { features: feats }) : null, cu, r); } catch { nm = toW(null, cu, r); }
    const rank = id / sites.length;
    const founded = Math.round(Math.min(endYear * 0.8, rank * endYear * 0.55 + r.next() * 250));
    const ended = r.chance(0.07) ? Math.round(founded + 150 + r.next() * (endYear - founded)) : -1;
    const cap = 400 + Math.pow(r.next(), 3) * 60000 * (1.2 - rank) + world.fertility[c] * 4000;
    const popStart = Math.floor(founded / sampleStep);
    const pop: number[] = [];
    for (let y = popStart * sampleStep; y <= endYear; y += sampleStep) {
      const t = (y - founded) / 400;
      let p = cap / (1 + Math.exp(-4 * (t - 0.6)));
      if (ended >= 0 && y >= ended) p = 0;
      pop.push(Math.round(Math.max(20, p)));
    }
    const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * 0.3 * sp;
    const ex = -xyz[3 * c + 1], ey = xyz[3 * c];
    const el = Math.hypot(ex, ey) || 1;
    const e: [number, number, number] = [ex / el, ey / el, 0];
    const nn: [number, number, number] = [
      xyz[3 * c + 1] * e[2] - xyz[3 * c + 2] * e[1],
      xyz[3 * c + 2] * e[0] - xyz[3 * c] * e[2],
      xyz[3 * c] * e[1] - xyz[3 * c + 1] * e[0],
    ];
    let px = xyz[3 * c] + d * (Math.cos(a) * e[0] + Math.sin(a) * nn[0]);
    let py = xyz[3 * c + 1] + d * (Math.cos(a) * e[1] + Math.sin(a) * nn[1]);
    let pz = xyz[3 * c + 2] + d * (Math.cos(a) * e[2] + Math.sin(a) * nn[2]);
    const pl = Math.hypot(px, py, pz);
    px /= pl; py /= pl; pz /= pl;
    return {
      id, cell: c, ruinsOf: -1, pos: [px, py, pz] as [number, number, number],
      names: [{ year: founded, name: nm, reason: "founded" as const }],
      founded, ended, endReason: ended >= 0 ? ("sacked" as const) : undefined,
      founderCulture: cu, mother: -1, founder: -1, popStart, pop,
      cultures: [{ year: founded, culture: cu }], religions: [], owners: [] as { year: number; polity: number }[],
      port: world.coastDist[c] === 1, walled: cap > 15000 ? founded + 200 : -1, wonders: [], tags: [], occupations: [],
    };
  });

  // --- Polities & territory over time ------------------------------------------------------
  const pr = rng.fork("polities");
  const bySize = settlements.slice().sort((a, b) => Math.max(...b.pop) - Math.max(...a.pop) || a.id - b.id);
  const capitals: typeof settlements = [];
  for (const s of bySize) {
    if (capitals.length >= 26) break;
    if (capitals.every((c) => ang(c.cell, s.cell) > 7 * sp)) capitals.push(s);
  }
  const PAL: [number, number, number][] = [[176, 64, 52], [62, 102, 160], [86, 140, 74], [196, 150, 52], [128, 74, 150], [52, 140, 140], [190, 100, 60], [150, 60, 100], [100, 120, 60], [70, 80, 150], [170, 120, 90], [60, 120, 100]];
  const polities = capitals.map((cap, id) => {
    const r = pr.fork(id);
    const cu = cap.founderCulture;
    const L = langs[cu];
    let nm: WName;
    try { nm = toW(L ? lang.nameRealm(L, r, {}) : null, cu, r); } catch { nm = toW(null, cu, r); }
    const founded = Math.max(cap.founded + 50, Math.round(r.next() * endYear * 0.5));
    const ended = r.chance(0.35) ? Math.round(founded + 300 + r.next() * (endYear - founded - 300)) : -1;
    const govs = ["kingdom", "empire", "principality", "republic", "theocracy", "chiefdom", "cityState", "horde"] as const;
    return {
      id, names: [{ year: founded, name: nm, reason: "founded" as const }],
      governments: [{ year: founded, gov: govs[r.int(0, govs.length - 1)] }], succession: [],
      founded, ended: ended > endYear ? -1 : ended, founder: -1, predecessors: [], successors: [],
      capitals: [{ year: founded, settlement: cap.id }], culture: cu, religions: [], rulers: [],
      overlords: [{ year: founded, overlord: -1 }] as { year: number; overlord: number }[],
      emblem: { kind: "arms" as const, data: null, blazon: "" }, color: PAL[id % PAL.length], wars: [],
      statStart: 0, stats: { pop: [], areaKm2: [], settlements: [], strength: [] }, peak: { areaKm2: 0, year: 0 },
      base: 0.6 + r.next() * 1.4, phase: r.next() * 6.28, period: 300 + r.next() * 500,
    };
  });
  // A few vassals.
  for (let v = 0; v < 4 && v < polities.length; v++) {
    const p = polities[pr.int(0, polities.length - 1)];
    let best = -1, bd = Infinity;
    for (const q of polities) {
      if (q.id === p.id) continue;
      const d = ang(capitals[p.id].cell, capitals[q.id].cell);
      if (d < bd) { bd = d; best = q.id; }
    }
    if (best >= 0 && bd < 14 * sp) {
      const from = Math.max(p.founded, polities[best].founded) + 100;
      p.overlords.push({ year: from, overlord: best });
      p.overlords.push({ year: from + 300, overlord: -1 });
    }
  }
  const step = 25, keyEvery = 8;
  const snapshots = Math.floor(endYear / step) + 1;
  const keyframes: Int32Array[] = [];
  const diffCells: Int32Array[] = [];
  const diffValues: Int32Array[] = [];
  let prev: Int32Array | null = null;
  const heap = new MinHeap(n);
  const cost = new Float64Array(n);
  const owner = new Int32Array(n);
  const settlementOwner = new Int32Array(settlements.length).fill(-2);
  for (let s = 0; s < snapshots; s++) {
    const y = s * step;
    cost.fill(Infinity);
    owner.fill(-1);
    heap.clear();
    const strength = new Float64Array(polities.length);
    for (const p of polities) {
      if (!(p.founded <= y && (p.ended < 0 || p.ended > y))) continue;
      const age = (y - p.founded) / 200;
      strength[p.id] = p.base * Math.min(1, 0.3 + age) * (0.75 + 0.35 * Math.sin(p.phase + (y / p.period) * 6.28));
      const c = capitals[p.id].cell;
      cost[c] = 0;
      owner[c] = p.id;
      heap.push(0, c);
    }
    while (heap.size > 0) {
      const c = heap.pop()!;
      const pid = owner[c];
      const cc = cost[c];
      const reach = 5.5 * sp * strength[pid];
      if (cc > reach) continue;
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (!world.isLand[u] || world.lakeId[u] >= 0) continue;
        const terrain = 1 + Math.max(0, world.elevation[u] - 0.8) * 1.3 + (world.riverOrder[u] >= 3 ? 0.6 : 0);
        const nc = cc + (ang(c, u) * terrain) / Math.max(0.2, strength[pid]);
        if (nc < cost[u]) {
          cost[u] = nc;
          owner[u] = pid;
          heap.push(nc, u);
        }
      }
    }
    for (const st of settlements) {
      const o = st.founded <= y && (st.ended < 0 || st.ended > y) ? owner[st.cell] : -1;
      if (o !== settlementOwner[st.id]) {
        st.owners.push({ year: y, polity: o });
        settlementOwner[st.id] = o;
      }
    }
    if (s % keyEvery === 0) {
      keyframes.push(Int32Array.from(owner));
      diffCells.push(new Int32Array(0));
      diffValues.push(new Int32Array(0));
    } else {
      const dc: number[] = [], dv: number[] = [];
      for (let i = 0; i < n; i++) if (owner[i] !== prev![i]) { dc.push(i); dv.push(owner[i]); }
      diffCells.push(Int32Array.from(dc));
      diffValues.push(Int32Array.from(dv));
    }
    prev = Int32Array.from(owner);
  }

  // --- Feature names --------------------------------------------------------------------
  const fr = rng.fork("features");
  const featureNames: { feature: number; names: { year: number; culture: number; name: WName }[] }[] = [];
  for (const f of world.features) {
    if (f.kind === "continent" || f.kind === "strait" || f.kind === "plain") continue;
    const r = fr.fork(f.id);
    const cu = cultureOf[f.anchor] >= 0 ? cultureOf[f.anchor] : nearestCulture(f.anchor);
    const L = langs[cu];
    const d: Record<string, unknown> = {};
    if (f.attrs.glaciated) d.color = "white";
    if (f.attrs.salty) d.salt = true;
    if (typeof f.attrs.latitudeBand === "string" && /polar|subpolar/.test(f.attrs.latitudeBand)) d.temp = "cold";
    if (f.size > 2e6) d.size = "great";
    let nm: WName;
    try { nm = toW(L ? lang.nameFeature(L, r, lang.featureKindToNameKind(f.kind), d) : null, cu, r); } catch { nm = toW(null, cu, r); }
    const names = [{ year: 0, culture: cu, name: nm }];
    featureNames.push({ feature: f.id, names });
  }

  // --- Trade routes -------------------------------------------------------------------------
  const tr = rng.fork("trade");
  const big = bySize.slice(0, 40);
  const tradeRoutes: History["tradeRoutes"] = [];
  const bfs = (a: number, b: number, sea: boolean): number[] | null => {
    const prevC = new Int32Array(n).fill(-2);
    const q = [a];
    prevC[a] = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (c === b) break;
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const u = mesh.adj[k];
        if (prevC[u] !== -2) continue;
        const ok = sea ? !world.isLand[u] || u === b : land(u);
        if (!ok) continue;
        prevC[u] = c;
        q.push(u);
      }
      if (q.length > 20000) break;
    }
    if (prevC[b] === -2) return null;
    const path: number[] = [];
    for (let c = b; c !== -1; c = prevC[c]) path.push(c);
    return path.reverse();
  };
  for (let i = 0; i < big.length && tradeRoutes.length < 14; i++) {
    for (let j = i + 1; j < big.length && tradeRoutes.length < 14; j++) {
      const a = big[i], b = big[j];
      const d = ang(a.cell, b.cell);
      if (d > 12 * sp || d < 4 * sp || tr.chance(0.55)) continue;
      const sea = a.port && b.port && tr.chance(0.5);
      let path = sea ? bfs(a.cell, b.cell, true) : bfs(a.cell, b.cell, false);
      let kind: "land" | "sea" = sea ? "sea" : "land";
      if (!path && sea) { path = bfs(a.cell, b.cell, false); kind = "land"; }
      if (!path || path.length > 40) continue;
      const founded = Math.max(a.founded, b.founded) + 100;
      tradeRoutes.push({ id: tradeRoutes.length, kind, name: `${a.names[0].name.roman}–${b.names[0].name.roman} road`, from: a.id, to: b.id, path, goods: [], founded, ended: -1 });
    }
  }

  // --- Battles ----------------------------------------------------------------------------------
  const br = rng.fork("battles");
  const battles: History["battles"] = [];
  const wars: History["wars"] = [];
  for (let b = 0; b < 30; b++) {
    const st = settlements[br.int(0, Math.min(settlements.length - 1, 200))];
    const year = br.int(Math.max(st.founded, 100), endYear);
    const own = st.owners.filter((o) => o.year <= year).pop()?.polity ?? -1;
    if (own < 0) continue;
    const id = battles.length;
    wars.push({ id, name: `the War of ${st.names[0].name.roman}`, casusBelli: "conquest", attackers: [], defenders: [own], joined: [], start: year - 2, end: year + 3, outcome: "attackerVictory", battles: [id], transfers: [], treaty: "", treatySite: -1, casualties: 1000, claimant: -1 } as unknown as History["wars"][number]);
    battles.push({ id, war: id, year, kind: br.chance(0.3) ? "siege" : "field", name: `Battle of ${st.names[0].name.roman}`, cell: st.cell, site: st.id, feature: -1, attacker: { polity: -1, commander: -1, strength: 5000, losses: 1000 }, defender: { polity: own, commander: -1, strength: 4000, losses: 1500 }, victor: br.chance(0.5) ? "attacker" : "defender", slain: [] } as unknown as History["battles"][number]);
  }

  const h = {
    endYear, sampleStep, cultures, languages, scripts: [], settlements, polities, persons: [], dynasties: [], religions: [], deities: [], myths: [],
    wars, battles, wonders: [], works: [], tradeRoutes, disasters: [], featureNames, events: [],
    timeline: {
      step, keyEvery, snapshots,
      owner: { keyframes, diffCells, diffValues },
      culture: { keyframes: [], diffCells: [], diffValues: [] },
      religion: { keyframes: [], diffCells: [], diffValues: [] },
    },
    ages: [], worldStats: { pop: [], settlements: [], polities: [], wars: [], climate: [], tech: [] },
  };
  return h as unknown as History;
}
