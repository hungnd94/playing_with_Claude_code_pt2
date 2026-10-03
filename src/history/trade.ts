/**
 * Trade routes connect large towns with complementary goods, by land
 * (caravan roads), river and sea. They carry wealth (towns at either end and
 * along the way prosper), ideas (technology diffuses between trading
 * peoples), faith and plague. Routes close when an end decays or war cuts
 * them. Each is named after its signature good ("the Amber Road") or its ends.
 */
import { MinHeap } from "../core/heap";
import { Resource, RESOURCE_KEYS } from "../world/types";
import type { Sim } from "./sim";
import type { TradeRoute } from "./types";

const GOOD: Record<string, string> = {
  Copper: "copper", Tin: "tin", Iron: "iron", Gold: "gold", Silver: "silver", Gems: "gems", Salt: "salt", Marble: "marble", Timber: "timber", Horses: "horses",
  Fish: "salt fish", Furs: "furs", Spices: "spices", Incense: "incense", Dyes: "purple dye", Wine: "wine", Ivory: "ivory", Obsidian: "obsidian", Amber: "amber", Pearls: "pearls",
};
/** Goods that give their names to roads, most evocative first. */
const NAMING = ["Incense", "Amber", "Spices", "Silver", "Gold", "Salt", "Tin", "Ivory", "Pearls", "Furs", "Wine", "Dyes", "Horses", "Copper", "Gems", "Obsidian", "Iron", "Marble", "Timber", "Fish"];
const ROAD_WORD: Record<TradeRoute["kind"], string[]> = { land: ["Road", "Way", "Road", "Trail"], river: ["River Road", "Way"], sea: ["Route", "Sea Road", "Route"] };
const NAME_GOOD: Record<string, string> = {
  Incense: "Incense", Amber: "Amber", Spices: "Spice", Silver: "Silver", Gold: "Gold", Salt: "Salt", Tin: "Tin", Ivory: "Ivory", Pearls: "Pearl", Furs: "Fur", Wine: "Wine",
  Dyes: "Purple", Horses: "Horse", Copper: "Copper", Gems: "Jewel", Obsidian: "Obsidian", Iron: "Iron", Marble: "Marble", Timber: "Timber", Fish: "Fish",
};

interface RouteS {
  rec: TradeRoute;
  along: number[];
}

const routesOf = new WeakMap<Sim, RouteS[]>();
function R(sim: Sim): RouteS[] {
  let r = routesOf.get(sim);
  if (!r) routesOf.set(sim, (r = []));
  return r;
}

/** Resource bits in a town's catchment. */
function goodsOf(sim: Sim, sid: number): number {
  const s = sim.S[sid];
  let m = sim.w.resources[s.cell];
  for (let i = s.catchStart; i < s.catchStart + s.catchLen; i++) m |= sim.w.resources[sim.catchCells[i]];
  return m;
}

let dist: Float64Array | null = null;
let par: Int32Array | null = null;
let stampA: Int32Array | null = null;
let gen = 0;
const heap = new MinHeap(4096);

/** Cheapest path between two cells over land and (if allowed) water; null if beyond maxCost. */
function findPath(sim: Sim, from: number, to: number, maxCost: number, sea: boolean): { path: number[]; cost: number; seaShare: number; riverShare: number } | null {
  const n = sim.n;
  if (!dist || dist.length !== n) {
    dist = new Float64Array(n);
    par = new Int32Array(n);
    stampA = new Int32Array(n);
  }
  const g = sim.g;
  const { adjStart, adj } = sim.w.mesh;
  gen++;
  heap.clear();
  dist[from] = 0;
  par![from] = -1;
  stampA![from] = gen;
  heap.push(0, from);
  let found = false;
  while (heap.size) {
    const c = heap.pop();
    const d = heap.lastKey;
    if (d > dist[c]) continue;
    if (c === to) {
      found = true;
      break;
    }
    for (let e = adjStart[c]; e < adjStart[c + 1]; e++) {
      const j = adj[e];
      let cost = g.landCost[e];
      if (sea) cost = Math.min(cost, g.seaCost[e]);
      if (cost === Infinity) continue;
      const nd = d + cost;
      if (nd > maxCost) continue;
      if (stampA![j] !== gen || nd < dist[j]) {
        stampA![j] = gen;
        dist[j] = nd;
        par![j] = c;
        heap.push(nd, j);
      }
    }
  }
  if (!found) return null;
  const path: number[] = [];
  for (let c = to; c >= 0; c = par![c]) path.push(c);
  path.reverse();
  let water = 0, river = 0;
  for (const c of path) {
    if (g.water[c]) water++;
    else if (sim.w.riverOrder[c] >= 2) river++;
  }
  return { path, cost: dist[to], seaShare: water / path.length, riverShare: river / path.length };
}

function routeName(sim: Sim, kind: TradeRoute["kind"], key: string | undefined, a: number, b: number): string {
  const rng = sim.rng.trade;
  const word = rng.pick(ROAD_WORD[kind]);
  let base = key ? `the ${NAME_GOOD[key]} ${word}` : rng.chance(0.5) ? `the ${sim.S[a].name.roman} Road` : `the Road of ${sim.S[b].name.roman}`;
  if (kind === "sea" && !key) base = `the ${sim.S[a].name.roman}–${sim.S[b].name.roman} Route`;
  const k = `route:${base}`;
  const n = (sim.counters[k] ?? 0) + 1;
  sim.counters[k] = n;
  if (n === 1) return base;
  return n === 2 ? base.replace(/^the /, "the Southern ").replace("Southern Southern", "Southern") : `${base.replace(/^the /, "the ")} (${sim.S[a].name.roman})`;
}

function openRoutes(sim: Sim): void {
  const rng = sim.rng.trade;
  const S = sim.S;
  const cities = sim.alive().filter((sid) => S[sid].urban >= 3000 && sim.C[S[sid].culture].tech >= 1).sort((a, b) => S[b].urban - S[a].urban || a - b).slice(0, 60);
  if (cities.length < 2) return;
  const goods = new Map<number, number>();
  for (const c of cities) goods.set(c, goodsOf(sim, c));
  for (const a of cities) {
    const sa = S[a];
    if (sa.routes.filter((r) => sim.h.tradeRoutes[r].ended < 0).length >= 2 || !rng.chance(0.07)) continue;
    const C = sim.C[sa.culture];
    const rangeKm = 900 + 350 * C.tech;
    let best = -1, bs = 0;
    for (const b of cities) {
      if (b === a) continue;
      const sb = S[b];
      if (sb.routes.some((r) => sim.h.tradeRoutes[r].ended < 0 && (sim.h.tradeRoutes[r].from === a || sim.h.tradeRoutes[r].to === a))) continue;
      const dk = sim.distKm(sa.cell, sb.cell);
      if (dk > rangeKm || dk < 250) continue;
      if (sa.owner >= 0 && sb.owner >= 0 && sa.owner !== sb.owner && atWar(sim, sa.owner, sb.owner)) continue;
      const ga = goods.get(a)!, gb = goods.get(b)!;
      const comp = popcount(ga & ~gb) + popcount(gb & ~ga);
      const sc = (comp + 1) * Math.log(sa.urban * sb.urban) / 10 - dk / 1500 + rng.range(0, 0.6);
      if (sc > bs) {
        bs = sc;
        best = b;
      }
    }
    if (best < 0) continue;
    const sb = S[best];
    const seaOk = !!(sim.g.coastal[sa.cell] || sim.g.lakeside[sa.cell]) && !!(sim.g.coastal[sb.cell] || sim.g.lakeside[sb.cell]) && C.tech >= 1.4;
    const res = findPath(sim, sa.cell, sb.cell, 1800 + 500 * C.tech, seaOk);
    if (!res || res.path.length < 3) continue;
    const kind: TradeRoute["kind"] = res.seaShare > 0.45 ? "sea" : res.riverShare > 0.4 ? "river" : "land";
    const ga = goods.get(a)!, gb = goods.get(best)!;
    const traded = ga ^ gb;
    const list: string[] = [];
    for (const k of RESOURCE_KEYS) if (traded & Resource[k]) list.push(GOOD[k]);
    if (!list.length) list.push(rng.pick(["grain", "cloth", "pottery", "oil", "wool", "linen"]));
    let key: string | undefined;
    for (const k of NAMING) if (traded & Resource[k as keyof typeof Resource]) {
      key = k;
      break;
    }
    if (rng.chance(0.3)) key = undefined;
    const id = sim.h.tradeRoutes.length;
    const rec: TradeRoute = { id, kind, name: routeName(sim, kind, key, a, best), from: a, to: best, path: res.path, goods: list.slice(0, 6), founded: sim.year, ended: -1 };
    sim.h.tradeRoutes.push(rec);
    const along = new Set<number>();
    for (const c of res.path) {
      const t = sim.cellSet[c];
      if (t >= 0 && t !== a && t !== best && S[t].alive) along.add(t);
    }
    R(sim).push({ rec, along: [...along].sort((x, y) => x - y) });
    sa.routes.push(id);
    sb.routes.push(id);
    const long = sim.distKm(sa.cell, sb.cell) > 1800;
    sim.emit("tradeRouteOpened", long ? 4 : 3, sa.cell, { settlements: [a, best], polities: [sa.owner, sb.owner], cultures: [sa.culture, sb.culture] }, {
      route: id, from: a, to: best, goods: rec.goods, kind,
    });
    if (!sa.rec.tags.includes("trade hub") && sa.routes.length >= 3) sa.rec.tags.push("trade hub");
    if (!sb.rec.tags.includes("trade hub") && sb.routes.length >= 3) sb.rec.tags.push("trade hub");
  }
}

function popcount(x: number): number {
  let c = 0;
  for (let v = x >>> 0; v; v &= v - 1) c++;
  return c;
}

function atWar(sim: Sim, a: number, b: number): boolean {
  for (const wid of sim.P[a].wars) {
    const w = sim.W[wid];
    if (!w.active) continue;
    if ((w.attSide.includes(a) && w.defSide.includes(b)) || (w.defSide.includes(a) && w.attSide.includes(b))) return true;
  }
  return false;
}

function closeRoutes(sim: Sim): void {
  const rng = sim.rng.trade;
  for (const r of R(sim)) {
    const rec = r.rec;
    if (rec.ended >= 0) continue;
    const a = sim.S[rec.from], b = sim.S[rec.to];
    let reason = "";
    if (!a.alive || !b.alive) reason = `the ruin of ${!a.alive ? a.name.roman : b.name.roman}`;
    else if (a.urban < 1200 || b.urban < 1200) reason = "the decline of its markets";
    else if (a.owner >= 0 && b.owner >= 0 && a.owner !== b.owner && atWar(sim, a.owner, b.owner) && rng.chance(0.12)) reason = "war between the realms at its ends";
    else if (sim.year - rec.founded > 400 && rng.chance(0.01)) reason = rng.pick(["new roads drew its trade away", "the silting of its harbours", "brigands on the road", "the shifting of the caravan wells"]);
    if (!reason) continue;
    rec.ended = sim.year;
    sim.emit("tradeRouteClosed", 2, a.cell, { settlements: [rec.from, rec.to], polities: [a.owner, b.owner] }, { route: rec.id, reason });
  }
}

/** Yearly prosperity from trade. */
function prosper(sim: Sim): void {
  for (const r of R(sim)) {
    if (r.rec.ended >= 0) continue;
    const a = sim.S[r.rec.from], b = sim.S[r.rec.to];
    a.wealth = Math.min(2, a.wealth + 0.008);
    b.wealth = Math.min(2, b.wealth + 0.008);
    for (const t of r.along) if (sim.S[t].alive) sim.S[t].wealth = Math.min(2, sim.S[t].wealth + 0.003);
  }
}

export function tickTrade(sim: Sim): void {
  prosper(sim);
  if (sim.year % 10 === 7) {
    closeRoutes(sim);
    openRoutes(sim);
  }
}
