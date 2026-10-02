/**
 * FALLBACK narrative engine: plain, sober articles and chronicle lines built
 * directly from History entities, so the reading pane is fully testable before
 * src/narrative exists. Deliberately simple prose; structure (links, years,
 * native names, figures) is what matters here.
 */
import type { PhysicalWorld } from "../../world/types";
import { BIOME_NAMES } from "../../world/types";
import type * as H from "../../history/types";
import type { Article, Block, ChronicleEntry, EntityKind, InfoRow, Inline, Ref, Rich, SearchEntry } from "../../narrative/types";
import type { Narrative } from "../engine/narrative";
import {
  alive, capitalAt, cultureAdj, entryAt, formatNumber, formatPop, GOV_NOUN, govAt, langAt, nameAt, ownerAt, personName,
  polityName, polityTitle, popAt, rulerAt, scriptAt, settlementName,
} from "../engine/query";
import * as LG from "../../lang";

type R = Ref;
const ref = (kind: EntityKind, id: number): R => ({ kind, id });
const link = (kind: EntityKind, id: number, text: string): Inline => ({ t: "link", ref: ref(kind, id), text });
const yr = (year: number, text?: string): Inline => ({ t: "year", year, text });
const em = (text: string): Inline => ({ t: "em", text });
const p = (...content: Rich): Block => ({ t: "p", content });
const h2 = (text: string): Block => ({ t: "h", level: 2, text });
const h3 = (text: string): Block => ({ t: "h", level: 3, text });

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, w: string, pl = w + "s"): string => `${formatNumber(n)} ${n === 1 ? w : pl}`;
const ordinalWord = (n: number): string => ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n - 1] ?? `${n}th`;

const SIZE_WORD = (pop: number): string => (pop >= 60000 ? "great city" : pop >= 20000 ? "city" : pop >= 5000 ? "town" : pop >= 800 ? "small town" : "village");

const TECH = ["Neolithic", "Bronze", "Writing", "Iron", "Classical", "Medieval", "Early modern"];

export function createMockNarrative(world: PhysicalWorld, h: H.History): Narrative {
  const END = h.endYear;
  const cache = new Map<string, Article>();
  // ------------------------------------------------------------- indexes
  const byEntity = new Map<string, number[]>();
  const add = (k: string, e: number): void => {
    let l = byEntity.get(k);
    if (!l) byEntity.set(k, (l = []));
    l.push(e);
  };
  for (const e of h.events) {
    for (const id of e.polities ?? []) add(`polity:${id}`, e.id);
    for (const id of e.settlements ?? []) add(`settlement:${id}`, e.id);
    for (const id of e.persons ?? []) add(`person:${id}`, e.id);
    for (const id of e.cultures ?? []) add(`culture:${id}`, e.id);
    for (const id of e.religions ?? []) add(`religion:${id}`, e.id);
    for (const id of e.wars ?? []) add(`war:${id}`, e.id);
    for (const id of e.dynasties ?? []) add(`dynasty:${id}`, e.id);
    for (const id of e.languages ?? []) add(`language:${id}`, e.id);
    for (const id of e.scripts ?? []) add(`script:${id}`, e.id);
    for (const id of e.features ?? []) add(`feature:${id}`, e.id);
    for (const id of e.disasters ?? []) add(`disaster:${id}`, e.id);
    for (const id of e.wonders ?? []) add(`wonder:${id}`, e.id);
    for (const id of e.works ?? []) add(`work:${id}`, e.id);
  }
  const eventsOf = (kind: string, id: number): H.HEvent[] => (byEntity.get(`${kind}:${id}`) ?? []).map((i) => h.events[i]);
  const literateAt = (culture: number, y: number): boolean => {
    const c = h.cultures[culture];
    return !!c && scriptAt(c, y) >= 0;
  };
  const featureName = (fid: number, y = END): string => {
    const fn = h.featureNames.find((f) => f.feature === fid);
    if (!fn) return world.features[fid] ? `the unnamed ${world.features[fid].kind}` : "?";
    return entryAt(fn.names, y)?.name.roman ?? fn.names[0].name.roman;
  };
  const featureNamesById = new Map(h.featureNames.map((f) => [f.feature, f]));

  // ------------------------------------------------------------- links
  const pl = (id: number, y: number): Inline => link("polity", id, polityName(h, id, y));
  const plT = (id: number, y: number): Rich => {
    const t = polityTitle(h, id, y);
    return t.startsWith("the ") ? ["the ", link("polity", id, t.slice(4))] : [link("polity", id, t)];
  };
  const sl = (id: number, y: number): Inline => (id >= 0 ? link("settlement", id, settlementName(h, id, y)) : "an unknown place");
  const pe = (id: number, epithet = true): Inline => (id >= 0 ? link("person", id, personName(h, id, { epithet })) : "an unknown hand");
  const cu = (id: number): Inline => (id >= 0 ? link("culture", id, cultureAdj(h, id)) : "unknown");
  const cuPeople = (id: number): Inline => (id >= 0 ? link("culture", id, `${cultureAdj(h, id)}`) : "unknown");
  const re = (id: number): Inline => (id >= 0 ? link("religion", id, h.religions[id] ? cap(h.religions[id].english.replace(/^the /, "")) : "?") : "no faith");
  const reThe = (id: number): Rich => {
    const r = h.religions[id];
    if (!r) return ["no faith"];
    return r.english.startsWith("the ") ? ["the ", link("religion", id, r.english.slice(4))] : [link("religion", id, r.english)];
  };
  const la = (id: number): Inline => (id >= 0 && h.languages[id] ? link("language", id, h.languages[id].name) : "an unknown tongue");
  const wa = (id: number): Rich => {
    const w = h.wars[id];
    if (!w) return ["a war"];
    return w.name.startsWith("the ") ? ["the ", link("war", id, w.name.slice(4))] : [link("war", id, w.name)];
  };
  const ba = (id: number): Inline => link("battle", id, h.battles[id]?.name ?? "a battle");
  const dy = (id: number): Inline => (id >= 0 && h.dynasties[id] ? link("dynasty", id, h.dynasties[id].name.roman) : "an unknown house");
  const sc = (id: number): Inline => (id >= 0 && h.scripts[id] ? link("script", id, h.scripts[id].name) : "no script");
  const fe = (id: number, y = END): Inline => link("feature", id, featureName(id, y));
  const native = (name: H.WName): Inline => ({ t: "native", name });

  // ------------------------------------------------------------- event lines
  const first = <T>(a: T[] | undefined, i = 0): T | -1 => (a && a.length > i ? a[i] : -1) as T | -1;
  function line(e: H.HEvent): Rich {
    const y = e.year;
    const P0 = first(e.polities) as number, P1 = first(e.polities, 1) as number;
    const S0 = first(e.settlements) as number, S1 = first(e.settlements, 1) as number;
    const X0 = first(e.persons) as number, X1 = first(e.persons, 1) as number;
    const C0 = first(e.cultures) as number, C1 = first(e.cultures, 1) as number;
    const R0 = first(e.religions) as number, R1 = first(e.religions, 1) as number;
    const W0 = first(e.wars) as number;
    switch (e.type) {
      case "settlementFounded":
        return C0 >= 0 ? [cap(cultureAdj(h, C0)), " settlers found ", sl(S0, y), S1 >= 0 ? [" from ", sl(S1, y)] : "", "."].flat() : [sl(S0, y), " is founded."];
      case "colonyFounded":
        return ["Colonists from ", sl(S1, y), " found ", sl(S0, y), "."];
      case "settlementAbandoned": {
        const why = (e.data?.reason as string) ?? "abandoned";
        return [sl(S0, y - 1), why === "sacked" ? " is sacked and left in ruins." : why === "plague" ? " is emptied by plague." : why === "disaster" ? " is destroyed by disaster." : " is abandoned."];
      }
      case "wallsBuilt":
        return ["Walls are raised around ", sl(S0, y), "."];
      case "settlementRenamed": {
        const s = h.settlements[S0];
        const prev = s ? nameAt(s.names, y - 1).roman : "?";
        return [link("settlement", S0, prev), " comes to be called ", s ? native(nameAt(s.names, y)) : "?", C0 >= 0 ? [" by the ", cu(C0)] : "", "."].flat();
      }
      case "polityFounded":
        return [...plT(P0, y).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " is founded", S0 >= 0 ? [" at ", sl(S0, y)] : "", X0 >= 0 ? [" by ", pe(X0)] : "", "."].flat();
      case "governmentChanged":
        return [pl(P0, y), " becomes ", (e.data?.gov === "empire" ? "an empire" : `a ${GOV_NOUN[(e.data?.gov as H.Government) ?? "kingdom"]}`), "."];
      case "polityCollapsed":
        return [...plT(P0, y - 1).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " collapses."];
      case "polityAnnexed":
        return [...plT(P0, y - 1).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " is conquered and comes to an end."];
      case "accession": {
        const P = h.persons[X0];
        const role = P?.sex === "f" ? "queen" : "king";
        return [pe(X0, false), " becomes ", govAt(h.polities[P0], y) === "republic" ? "first magistrate" : role, " of ", pl(P0, y), "."];
      }
      case "death": {
        const P = h.persons[X0];
        const cause = P?.deathCause ?? "natural";
        const how = cause === "battle" ? " falls in battle" : cause === "plague" ? " dies of plague" : cause === "illness" ? " dies of a fever" : cause === "executed" ? " is executed" : cause === "accident" ? " dies in an accident" : " dies";
        return [pe(X0), how, P && P.born >= 0 ? `, aged ${y - P.born}` : "", "."];
      }
      case "assassination":
        return [pe(X0), " is murdered", P0 >= 0 ? [" in ", pl(P0, y)] : "", "."].flat();
      case "marriage":
        return [pe(X0, false), " marries ", pe(X1, false), "."];
      case "dynastyFounded":
        return [dy(first(e.dynasties) as number), " comes to power in ", pl(P0, y), "."];
      case "usurpation":
        return [pe(X0, false), " seizes the throne of ", pl(P0, y), X1 >= 0 ? [" from the heirs of ", pe(X1, false)] : "", "."].flat();
      case "warDeclared": {
        const w = h.wars[W0];
        return [pl(P0, y), " and ", pl(P1, y), " go to war: ", ...wa(W0), w?.casusBelli === "holyWar" ? " (a holy war)" : "", "."];
      }
      case "battle":
      case "siege": {
        const b = h.battles[first(e.battles) as number];
        if (!b) return ["A battle is fought."];
        const v = b.victor === "attacker" ? b.attacker.polity : b.victor === "defender" ? b.defender.polity : -1;
        return [ba(b.id), ": ", v >= 0 ? [pl(v, y), " prevails"] : "neither side prevails", b.attacker.losses + b.defender.losses > 0 ? `; some ${formatNumber(Math.round((b.attacker.losses + b.defender.losses) / 100) * 100)} fall` : "", "."].flat();
      }
      case "peace": {
        const w = h.wars[W0];
        const out = w?.outcome === "attackerVictory" ? [pl(w.attackers[0], y), " victorious"] : w?.outcome === "defenderVictory" ? [pl(w.defenders[0], y), " victorious"] : ["neither side the winner"];
        return [...(w?.treaty ? [cap(w.treaty)] : ["A peace"]), " ends ", ...wa(W0), ", with ", ...out, "."];
      }
      case "conquest":
        return [pl(P0, y), " takes ", sl(S0, y), P1 >= 0 ? [" from ", pl(P1, y - 1)] : "", "."].flat();
      case "religionFounded":
        return [pe(X0), " begins to preach ", ...reThe(R0), S0 >= 0 ? [" at ", sl(S0, y)] : "", "."].flat();
      case "prophetBorn":
        return [pe(X0), ", who will found ", ...reThe(R0), ", is born."];
      case "schism":
        return [...reThe(R1).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " breaks away from ", ...reThe(R0), "."];
      case "stateReligion":
        return [pl(P0, y), " adopts ", ...reThe(R0), " as its faith."];
      case "cultureSplit":
        return ["The ", cuPeople(C1), " people grow apart from the ", cuPeople(C0), "."];
      case "languageSplit":
        return [la(first(e.languages, 1) as number), " becomes a tongue of its own, apart from ", la(first(e.languages) as number), "."];
      case "scriptInvented":
        return ["The ", cu(C0), " invent writing: the ", sc(first(e.scripts) as number), "."];
      case "scriptAdopted":
        return ["The ", cu(C0), " adopt letters from the ", cu(C1), ": the ", sc(first(e.scripts) as number), "."];
      case "wonderBuilt": {
        const w = h.wonders[first(e.wonders) as number];
        return w ? [cap(w.english.startsWith("the ") ? "the " : ""), link("wonder", w.id, w.english.replace(/^the /, "")), " is completed at ", sl(w.settlement, y), "."] : ["A wonder is built."];
      }
      case "wonderDestroyed": {
        const w = h.wonders[first(e.wonders) as number];
        return w ? [cap(w.english.startsWith("the ") ? "the " : ""), link("wonder", w.id, w.english.replace(/^the /, "")), " is destroyed", w.destroyCause ? ` by ${w.destroyCause === "war" ? "war" : w.destroyCause === "decay" ? "neglect" : `an ${w.destroyCause === "earthquake" ? "earthquake" : w.destroyCause}`}` : "", "."] : ["A wonder falls."];
      }
      case "workWritten": {
        const w = h.works[first(e.works) as number];
        return w ? [pe(w.author), " writes ", link("work", w.id, w.english), "."] : ["A book is written."];
      }
      case "plague": {
        const d = h.disasters[first(e.disasters) as number];
        return d?.name ? [cap(d.name.startsWith("the ") ? "the " : ""), link("disaster", d.id, d.name.replace(/^the /, "")), " breaks out", S0 >= 0 ? [" in ", sl(S0, y)] : "", "."].flat() : ["Plague breaks out", S0 >= 0 ? [" in ", sl(S0, y)] : "", "."].flat();
      }
      case "eruption":
        return ["A volcano erupts", e.features?.length ? [": ", fe(e.features[0], y)] : "", S0 >= 0 ? [", burying ", sl(S0, y)] : "", "."].flat();
      case "earthquake":
        return ["An earthquake shakes ", S0 >= 0 ? sl(S0, y) : "the land", "."];
      case "flood":
        return ["Floods drown ", S0 >= 0 ? sl(S0, y) : "the lowlands", "."];
      case "famine":
      case "drought":
        return [e.type === "famine" ? "Famine" : "Drought", " strikes", S0 >= 0 ? [" the country around ", sl(S0, y)] : "", "."].flat();
      case "goldenAge":
        return ["A golden age begins in ", pl(P0, y), "."];
      case "featureNamed": {
        const f = first(e.features) as number;
        return ["The ", cu(C0), " name ", fe(f, y), " ", em(`(‘${featureNamesById.get(f)?.names[0]?.name.gloss || "of old meaning"}’)`), "."];
      }
      case "tradeRouteOpened":
        return ["Merchants open a road between ", sl(S0, y), " and ", sl(S1, y), "."];
      default:
        return [cap(e.type.replace(/([A-Z])/g, " $1").toLowerCase()), "."];
    }
  }

  // ------------------------------------------------------------- chronicle
  let chron: ChronicleEntry[] | null = null;
  const legendary = (e: H.HEvent): boolean => {
    const c = e.cultures?.[0] ?? (e.polities?.[0] !== undefined ? h.polities[e.polities[0]]?.culture : undefined) ?? (e.settlements?.[0] !== undefined ? h.settlements[e.settlements[0]]?.founderCulture : undefined);
    return c === undefined || c < 0 ? e.year < END * 0.3 : !literateAt(c, e.year);
  };
  function chronicle(): ChronicleEntry[] {
    if (chron) return chron;
    chron = h.events
      .filter((e) => e.importance >= 2 || e.type === "settlementFounded" && (e.settlements?.[0] ?? 99) < 40)
      .map((e) => ({ event: e.id, year: e.year, importance: e.importance, text: line(e), legendary: legendary(e), cell: e.cell }));
    return chron;
  }

  // ------------------------------------------------------------- shared bits
  const eventList = (evs: H.HEvent[], max = 40, minImp = 2): Block[] => {
    const sel = evs.filter((e) => e.importance >= minImp);
    const pick = sel.length > max ? [...sel].sort((a, b) => b.importance - a.importance || a.year - b.year).slice(0, max).sort((a, b) => a.year - b.year || a.id - b.id) : sel;
    if (!pick.length) return [];
    return [{ t: "list", items: pick.map((e) => [yr(e.year), " — ", ...line(e)]) }];
  };
  const popChart = (label: string, start: number, series: number[], step: number): Block | null => {
    if (series.length < 3) return null;
    const years = series.map((_, i) => (start + i) * step);
    return { t: "figure", figure: { kind: "chart", yLabel: label, series: [{ label, years, values: series }] } };
  };
  const nameRows = (names: H.NameRecord[]): Block | null => {
    if (names.length < 2) return null;
    return {
      t: "table", head: ["From", "Name", "Tongue", "How"],
      rows: names.map((n) => [[yr(n.year)], [native(n.name)], [la(n.name.lang)], [n.reason]]),
      caption: [`Names through the ages`] as unknown as string,
    };
  };
  const landOf = (cell: number): string => {
    if (cell < 0) return "";
    const lm = world.landmassOf[cell];
    const f = lm >= 0 ? world.features[lm] : null;
    return f ? featureName(f.id) : "";
  };
  const riverOf = (cell: number): number => {
    for (const f of world.features) if (f.kind === "river") for (let i = 0; i < f.cells.length; i++) if (f.cells[i] === cell) return f.id;
    return -1;
  };

  // ------------------------------------------------------------- articles
  function settlementArticle(id: number): Article {
    const s = h.settlements[id];
    const y = s.ended >= 0 ? s.ended - 1 : END;
    const name = nameAt(s.names, y);
    const pop = popAt(s, y, h.sampleStep);
    let peak = 0, peakY = s.founded;
    s.pop.forEach((v, i) => { if (v > peak) { peak = v; peakY = (s.popStart + i) * h.sampleStep; } });
    const owner = ownerAt(s, y);
    const capitalOf = h.polities.filter((P) => P.capitals.some((c) => c.settlement === id));
    const river = riverOf(s.cell);
    const kind = SIZE_WORD(s.ended >= 0 ? peak : pop);
    const founderC = s.founderCulture;
    const lead: Rich = [
      native(name), " is ", s.ended >= 0 ? "a ruined " + kind.replace("great ", "") : `a ${kind}`,
      river >= 0 ? [" on the ", fe(river)] : world.coastDist[s.cell] === 1 ? " on the coast" : "",
      landOf(s.cell) ? ` of ${landOf(s.cell)}` : "", ". ",
      "It was founded in ", yr(s.founded), " by the ", cu(founderC), s.mother >= 0 ? [", settlers from ", sl(s.mother, s.founded)] : "", ".",
      capitalOf.length ? [" It was the capital of ", ...capitalOf.slice(0, 3).flatMap((P, i) => [i ? (i === capitalOf.length - 1 || i === 2 ? " and " : ", ") : "", ...plT(P.id, P.founded)]), "."] : "",
      s.ended >= 0 ? [` It was ${s.endReason === "sacked" ? "sacked and abandoned" : s.endReason === "plague" ? "emptied by plague" : s.endReason === "disaster" ? "destroyed by disaster" : "abandoned"} in `, yr(s.ended), "."] : owner >= 0 ? [" Today it belongs to ", ...plT(owner, y), "."] : "",
    ].flat() as Rich;
    const blocks: Block[] = [{ t: "p", content: lead, dropCap: true }];
    if (name.etym || name.gloss) blocks.push(p(...(["The name ", native(name), name.gloss ? [" means ", em(`‘${name.gloss.toLowerCase()}’`)] : "", name.etym ? `; ${name.etym}.` : "."].flat() as Rich)));
    const nr = nameRows(s.names);
    if (nr) blocks.push(h2("Names"), nr);
    blocks.push({ t: "figure", figure: { kind: "map", focus: ref("settlement", id), year: y }, caption: [native(name), " and its surroundings in ", yr(y)] });
    const pc = popChart("Population", s.popStart, s.pop, h.sampleStep);
    if (pc) blocks.push(h2("Population"), pc);
    const evs = eventsOf("settlement", id);
    if (evs.length) blocks.push(h2("History"), ...eventList(evs, 30, 1));
    const wonders = s.wonders.map((w) => h.wonders[w]).filter(Boolean);
    if (wonders.length) blocks.push(h2("Monuments"), { t: "list", items: wonders.map((w) => [link("wonder", w.id, cap(w.english)), ", completed ", yr(w.completed), w.destroyed >= 0 ? [", destroyed ", yr(w.destroyed)] : ""].flat() as Rich) });
    const info: InfoRow[] = [
      { label: "Founded", value: [yr(s.founded), " by the ", cu(founderC)] },
      s.ended >= 0 ? { label: "Abandoned", value: [yr(s.ended)] } : { label: "Population", value: [formatPop(pop)] },
      { label: "Peak", value: [formatPop(peak), " in ", yr(peakY)] },
      owner >= 0 ? { label: "Realm", value: [pl(owner, y)] } : null,
      { label: "People", value: [cu(entryAt(s.cultures, y)?.culture ?? founderC)] },
      (entryAt(s.religions, y)?.religion ?? -1) >= 0 ? { label: "Faith", value: [re(entryAt(s.religions, y)!.religion)] } : null,
      { label: "Land", value: [BIOME_NAMES[world.biome[s.cell]] ?? "land", world.elevation[s.cell] > 0.5 ? `, ${Math.round(world.elevation[s.cell] * 1000)} m` : ""] },
      s.walled >= 0 ? { label: "Walls", value: [yr(s.walled)] } : null,
      s.tags.length ? { label: "Known as", value: [s.tags.join(", ")] } : null,
    ].filter(Boolean) as InfoRow[];
    return { ref: ref("settlement", id), title: name.roman, native: name, subtitle: `${cap(kind)}${owner >= 0 ? ` of ${polityTitle(h, owner, y).replace(/^the /, "the ")}` : ""}`, infobox: info, blocks, seeAlso: [s.mother >= 0 ? ref("settlement", s.mother) : null, ...capitalOf.map((P) => ref("polity", P.id))].filter(Boolean) as Ref[] };
  }

  function polityArticle(id: number): Article {
    const P = h.polities[id];
    const end = P.ended >= 0 ? P.ended - 1 : END;
    const name = nameAt(P.names, end);
    const title = cap(polityTitle(h, id, end).replace(/^the /, ""));
    const capital = capitalAt(P, end);
    const gov = govAt(P, end);
    const blocks: Block[] = [];
    const peak = P.peak?.areaKm2 ? P.peak : { areaKm2: Math.max(0, ...P.stats.areaKm2), year: P.founded };
    blocks.push({
      t: "p", dropCap: true,
      content: [
        ...plT(id, end).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " (", native(name), ") ", P.ended >= 0 ? "was" : "is", ` a ${GOV_NOUN[gov]} of the `, cu(P.culture), " people",
        capital >= 0 ? [", ruled from ", sl(capital, end)] : "", ". ",
        "It was founded in ", yr(P.founded), P.founder >= 0 ? [" by ", pe(P.founder)] : "",
        P.predecessors.length ? [" as a successor of ", ...plT(P.predecessors[0], P.founded)] : "", ". ",
        peak.areaKm2 > 0 ? [`At its height, around `, yr(peak.year), `, it held some ${formatNumber(Math.round(peak.areaKm2 / 1000) * 1000)} km².`] : "",
        P.ended >= 0 ? [" It ", P.endReason === "conquered" ? "was conquered" : P.endReason === "absorbed" ? "was absorbed by its neighbours" : P.endReason === "dissolved" ? "dissolved" : "collapsed", " in ", yr(P.ended), P.successors.length ? [", and was followed by ", ...P.successors.slice(0, 3).flatMap((s, i) => [i ? " and " : "", pl(s, P.ended)])] : "", "."] : "",
      ].flat(3) as Rich,
    });
    if (P.motto) blocks.push(h3("Motto"), { t: "utterance", utterance: P.motto, attribution: ["Motto of ", ...plT(id, end)] });
    blocks.push({ t: "figure", figure: { kind: "map", focus: ref("polity", id), year: peak.year }, caption: [cap(polityTitle(h, id, peak.year)), " at its height, ", yr(peak.year)] });
    if (P.rulers.length) {
      blocks.push(h2("Rulers"));
      blocks.push({
        t: "table", head: ["Reign", "Ruler", "House"],
        rows: P.rulers.slice(0, 60).map((r) => [[yr(r.from), "–", yr(r.to)], [pe(r.person)], [h.persons[r.person]?.dynasty >= 0 ? dy(h.persons[r.person].dynasty) : "—"]]),
      });
      if (P.rulers.length > 60) blocks.push(p(`…and ${P.rulers.length - 60} more.`));
    }
    const ar = popChart("Area (km²)", P.statStart, P.stats.areaKm2, h.sampleStep);
    if (ar) {
      blocks.push(h2("Extent and people"));
      blocks.push({ t: "figure", figure: { kind: "chart", yLabel: "", series: [{ label: "Area, km²", years: P.stats.areaKm2.map((_, i) => (P.statStart + i) * h.sampleStep), values: P.stats.areaKm2 }, { label: "Population", years: P.stats.pop.map((_, i) => (P.statStart + i) * h.sampleStep), values: P.stats.pop }] } });
    }
    if (P.wars.length) {
      blocks.push(h2("Wars"));
      blocks.push({ t: "list", items: P.wars.slice(0, 40).map((w) => { const W = h.wars[w]; return [yr(W.start), "–", W.end >= 0 ? yr(W.end) : "", " ", ...wa(w), W.attackers.includes(id) ? " against " : " defending against ", ...(W.attackers.includes(id) ? W.defenders : W.attackers).slice(0, 2).map((o) => pl(o, W.start))] as Rich; }) });
    }
    const evs = eventsOf("polity", id).filter((e) => e.type !== "accession" && e.type !== "death" && e.type !== "marriage" && e.type !== "battle" && e.type !== "siege");
    if (evs.length) blocks.push(h2("History"), ...eventList(evs, 30, 2));
    const relNow = entryAt(P.religions, end)?.religion ?? -1;
    const info: InfoRow[] = [
      { label: "Government", value: [cap(GOV_NOUN[gov])] },
      capital >= 0 ? { label: "Capital", value: [sl(capital, end)] } : null,
      { label: "Founded", value: [yr(P.founded)] },
      P.ended >= 0 ? { label: "Ended", value: [yr(P.ended), P.endReason ? ` (${P.endReason})` : ""] } : null,
      { label: "People", value: [cu(P.culture)] },
      relNow >= 0 ? { label: "Faith", value: [re(relNow)] } : null,
      P.founder >= 0 ? { label: "Founder", value: [pe(P.founder)] } : null,
      { label: "Rulers", value: [String(P.rulers.length)] },
      peak.areaKm2 ? { label: "Greatest extent", value: [`${formatNumber(Math.round(peak.areaKm2 / 1000) * 1000)} km², `, yr(peak.year)] } : null,
      P.predecessors.length ? { label: "Preceded by", value: P.predecessors.flatMap((x, i) => [i ? ", " : "", pl(x, P.founded - 1)]) } : null,
      P.successors.length ? { label: "Succeeded by", value: P.successors.flatMap((x, i) => [i ? ", " : "", pl(x, P.ended)]) } : null,
      { label: "Arms", value: [em(P.emblem.blazon)] },
    ].filter(Boolean) as InfoRow[];
    return { ref: ref("polity", id), title, native: name, subtitle: `${cap(GOV_NOUN[gov])}, ${P.founded}–${P.ended >= 0 ? P.ended : "present"}`, emblem: P.emblem, infobox: info, blocks, seeAlso: [...P.predecessors, ...P.successors].map((x) => ref("polity", x)) };
  }

  function personArticle(id: number): Article {
    const X = h.persons[id];
    const ruler = X.roles.find((r) => r.kind === "ruler");
    const roleWord = ruler ? (X.sex === "f" ? "queen" : "king") : X.roles[0]?.kind === "prophet" ? "prophet" : X.roles[0]?.kind === "general" ? "general" : X.roles[0]?.kind === "consort" ? "consort" : X.roles[0]?.kind ?? "person";
    const blocks: Block[] = [];
    const life: Rich = [X.born >= 0 ? ["born ", yr(X.born)] : "", X.died >= 0 ? [X.born >= 0 ? ", " : "", "died ", yr(X.died)] : ""].flat() as Rich;
    blocks.push({
      t: "p", dropCap: true,
      content: [
        native(X.name), X.epithet ? ` ${X.epithet}` : "", " (", ...life, ") was a ", cu(X.culture), " ", roleWord,
        ruler ? [" of ", pl(ruler.polity, ruler.from), ", reigning from ", yr(ruler.from), " to ", yr(ruler.to)] : "",
        X.dynasty >= 0 ? [", of ", dy(X.dynasty)] : "", ". ",
        X.father >= 0 ? ["The child of ", pe(X.father), ", "] : "", X.traits.length ? `${X.sex === "f" ? "she" : "he"} was remembered as ${X.traits.join(" and ")}.` : "",
        X.died >= 0 ? [" ", X.sex === "f" ? "She" : "He", " ", X.deathCause === "battle" ? "fell in battle" : X.deathCause === "assassinated" ? "was murdered" : X.deathCause === "executed" ? "was executed" : X.deathCause === "plague" ? "died of plague" : "died", X.deathPlace >= 0 ? [" at ", sl(X.deathPlace, X.died)] : "", " in ", yr(X.died), "."] : "",
      ].flat(3) as Rich,
    });
    if (X.name.etym || X.name.gloss) blocks.push(p(...(["The name ", native(X.name), X.name.gloss ? [" means ", em(`‘${X.name.gloss}’`)] : "", "."].flat() as Rich)));
    const fam: Block[] = [];
    if (X.spouses.length) fam.push(p("Married ", ...X.spouses.flatMap((s, i) => [i ? ", " : "", pe(s)]), "."));
    if (X.children.length) fam.push(p("Children: ", ...X.children.flatMap((s, i) => [i ? ", " : "", pe(s)]), "."));
    if (fam.length) blocks.push(h2("Family"), ...fam);
    if (X.dynasty >= 0) blocks.push({ t: "figure", figure: { kind: "tree", root: ref("person", id), relation: "family" }, caption: ["Family of ", pe(id)] });
    const evs = eventsOf("person", id);
    if (evs.length) blocks.push(h2("Life"), ...eventList(evs, 30, 1));
    const info: InfoRow[] = [
      X.born >= 0 ? { label: "Born", value: [yr(X.born)] } : null,
      X.died >= 0 ? { label: "Died", value: [yr(X.died), ` (${X.deathCause})`] } : null,
      ruler ? { label: "Reign", value: [yr(ruler.from), "–", yr(ruler.to)] } : null,
      X.dynasty >= 0 ? { label: "House", value: [dy(X.dynasty)] } : null,
      { label: "People", value: [cu(X.culture)] },
      X.religion >= 0 ? { label: "Faith", value: [re(X.religion)] } : null,
      X.father >= 0 ? { label: "Father", value: [pe(X.father)] } : null,
      X.roles.length ? { label: "Roles", value: [[...new Set(X.roles.map((r) => r.kind))].join(", ")] } : null,
    ].filter(Boolean) as InfoRow[];
    return { ref: ref("person", id), title: personName(h, id), native: X.name, subtitle: cap(roleWord), emblem: X.dynasty >= 0 ? h.dynasties[X.dynasty]?.emblem : undefined, infobox: info, blocks };
  }

  function dynastyArticle(id: number): Article {
    const D = h.dynasties[id];
    const members = h.persons.filter((x) => x.dynasty === id && x.roles.some((r) => r.kind === "ruler"));
    const blocks: Block[] = [
      { t: "p", dropCap: true, content: [native(D.name), " was a ", cu(D.culture), " house founded by ", pe(D.founder), " in ", yr(D.founded), ". It ruled ", ...D.polities.flatMap((x, i) => [i ? " and " : "", pl(x, D.founded)]), D.extinct >= 0 ? [", and died out in ", yr(D.extinct)] : "", "."].flat() as Rich },
    ];
    if (D.motto) blocks.push(h3("Motto"), { t: "utterance", utterance: D.motto, attribution: ["Motto of ", dy(id)] });
    if (members.length) blocks.push(h2("Rulers of the house"), { t: "list", ordered: true, items: members.slice(0, 40).map((m) => { const r = m.roles.find((x) => x.kind === "ruler")!; return [pe(m.id), ", ", pl(r.polity, r.from), " ", yr(r.from), "–", yr(r.to)]; }) });
    blocks.push({ t: "figure", figure: { kind: "tree", root: ref("dynasty", id), relation: "dynasty" }, caption: ["Descent of ", dy(id)] });
    return {
      ref: ref("dynasty", id), title: D.name.roman, native: D.name, subtitle: `Royal house, ${D.founded}–${D.extinct >= 0 ? D.extinct : "present"}`, emblem: D.emblem,
      infobox: [
        { label: "Founder", value: [pe(D.founder)] }, { label: "Founded", value: [yr(D.founded)] },
        D.extinct >= 0 ? { label: "Extinct", value: [yr(D.extinct)] } : null,
        D.seat >= 0 ? { label: "Seat", value: [sl(D.seat, D.founded)] } : null,
        { label: "Arms", value: [em(D.emblem.blazon)] },
      ].filter(Boolean) as InfoRow[],
      blocks,
    };
  }

  function cultureArticle(id: number): Article {
    const C = h.cultures[id];
    const langNow = langAt(C, END);
    const scNow = scriptAt(C, END);
    const values = Object.entries(C.values).filter(([, v]) => v > 0.62).map(([k]) => ({ martial: "warlike", mercantile: "given to trade", piety: "devout", art: "fond of song and craft", expansion: "restless", seafaring: "at home on the sea" }[k]));
    const realms = h.polities.filter((P) => P.culture === id);
    const blocks: Block[] = [{
      t: "p", dropCap: true,
      content: [
        "The ", cu(id), " (", native(C.name), ") are a people of the ", C.archetype === "riverine" ? "river valleys" : C.archetype === "coastal" ? "coasts" : C.archetype === "steppe" ? "steppe" : C.archetype === "mountain" ? "mountains" : C.archetype === "desert" ? "desert" : C.archetype === "jungle" ? "jungle" : C.archetype === "island" ? "islands" : C.archetype === "tundra" ? "far north" : "forests",
        landOf(C.homeCell) ? ` of ${landOf(C.homeCell)}` : "", ". ",
        C.parent >= 0 ? ["They grew apart from the ", cu(C.parent), " in ", yr(C.born), ". "] : ["They are among the first peoples of the world. "],
        values.length ? `They are remembered as ${values.join(", ")}. ` : "",
        "They speak ", la(langNow), scNow >= 0 ? [" and write in the ", sc(scNow)] : ", and have no writing", ".",
      ].flat(2) as Rich,
    }];
    if (C.titles.ruler) blocks.push(p(...(["Their word for a king is ", native(C.titles.ruler), C.titles.priest ? [", for a priest ", native(C.titles.priest)] : "", "."].flat() as Rich)));
    blocks.push({ t: "figure", figure: { kind: "map", focus: ref("culture", id), year: END }, caption: ["Lands of the ", cu(id), " in ", yr(END)] });
    if (C.children.length || C.parent >= 0) blocks.push({ t: "figure", figure: { kind: "tree", root: ref("culture", C.family ?? id), relation: "culture" }, caption: ["The family of peoples"] });
    if (realms.length) blocks.push(h2("Realms"), { t: "list", items: realms.slice(0, 30).map((P) => [pl(P.id, P.founded), ` (${P.founded}–${P.ended >= 0 ? P.ended : "present"})`]) });
    const tongues = C.languages.map((l) => l.lang);
    blocks.push(h2("Tongues"), { t: "list", items: tongues.map((l) => [la(l), ", from ", yr(h.languages[l].born)]) });
    const tech = C.tech.filter((t) => t.level > 0);
    if (tech.length) blocks.push(h2("Arts and crafts"), { t: "list", items: tech.map((t) => [yr(t.year), ` — the ${TECH[Math.min(6, Math.floor(t.level))]} age begins`]) });
    return {
      ref: ref("culture", id), title: `The ${C.adjective}`, native: C.name, subtitle: `A people, from ${C.born}`,
      infobox: [
        { label: "Emerged", value: [yr(C.born)] },
        C.parent >= 0 ? { label: "From", value: [cu(C.parent)] } : null,
        { label: "Tongue", value: [la(langNow)] },
        { label: "Script", value: [scNow >= 0 ? sc(scNow) : "none"] },
        { label: "Faith", value: [re(C.folkReligion ?? -1)] },
        { label: "Homeland", value: [BIOME_NAMES[world.biome[C.homeCell]] ?? "", landOf(C.homeCell) ? `, ${landOf(C.homeCell)}` : ""] },
        C.ended >= 0 ? { label: "Ended", value: [yr(C.ended)] } : null,
      ].filter(Boolean) as InfoRow[],
      blocks,
    };
  }

  function languageArticle(id: number): Article {
    const Lg = h.languages[id];
    const data = Lg.data as LG.Language | undefined;
    const blocks: Block[] = [];
    const fam = h.languages[Lg.family ?? id];
    blocks.push({
      t: "p", dropCap: true,
      content: [
        Lg.name, " (", native(Lg.endonym), ") ", Lg.ended >= 0 ? "was" : "is", " the tongue of the ", cu(Lg.culture), ", ",
        Lg.origin === "stage" && Lg.parent >= 0 ? ["the later form of ", la(Lg.parent)] : Lg.parent >= 0 ? ["a daughter of ", la(Lg.parent)] : ["the ancestor of its family"],
        ", spoken from ", yr(Lg.born), Lg.ended >= 0 ? [" until ", yr(Lg.ended)] : "", ".",
        fam && fam.id !== id ? [" It belongs to the family of ", la(fam.id), "."] : "",
      ].flat(2) as Rich,
    });
    if (data) {
      blocks.push(h2("Grammar"), { t: "list", items: LG.describeLanguage(data).map((s) => [s]) });
      blocks.push(h2("Sounds"), { t: "figure", figure: { kind: "phonemes", language: id } });
      const step = data.lineage[data.lineage.length - 1];
      if (step && Lg.parent >= 0) {
        blocks.push(h2("Sound laws"), p("Changes from ", la(Lg.parent), " to ", Lg.name, ":"));
        blocks.push({ t: "list", ordered: true, items: step.changes.map((c) => [{ t: "strong", text: c.name }, " ", em(c.notation), " — ", c.description]) });
      }
      const words = ["water", "fire", "sun", "moon", "mountain", "river", "king", "god", "mother", "father", "horse", "wolf", "stone", "sea", "tree", "iron", "gold", "star"].filter((c) => data.lexicon[c]);
      blocks.push(h2("Words"), {
        t: "table", head: ["English", "Word", "Pronounced"],
        rows: words.map((c) => [[LG.CONCEPT_BY_ID[c]?.en ?? c], [{ t: "native", name: { roman: LG.romanizeWord(data.orthography, data.lexicon[c].form), gloss: LG.CONCEPT_BY_ID[c]?.en ?? c, lang: id, ipa: LG.ipaWord(data.lexicon[c].form, data.phonology.stress, data.phonology), phonemes: data.lexicon[c].form } }], [`/${LG.ipaWord(data.lexicon[c].form, data.phonology.stress, data.phonology)}/`]]),
      });
    }
    const familyMembers = h.languages.filter((x) => (x.family ?? x.id) === (Lg.family ?? id) && x.ended < 0).map((x) => x.id);
    if (familyMembers.length > 1) blocks.push(h2("Kindred tongues"), { t: "figure", figure: { kind: "cognates", languages: familyMembers.slice(0, 6), concepts: ["water", "fire", "stone", "mother", "king", "river", "sun", "two"] } });
    blocks.push({ t: "figure", figure: { kind: "tree", root: ref("language", Lg.family ?? id), relation: "language" }, caption: ["The family of ", la(Lg.family ?? id)] });
    const scNow = scriptAt(h.cultures[Lg.culture], Lg.ended >= 0 ? Lg.ended - 1 : END);
    if (scNow >= 0) blocks.push(h2("Writing"), { t: "figure", figure: { kind: "script", script: scNow, word: Lg.endonym.phonemes, caption: Lg.endonym.roman }, caption: [Lg.endonym.roman, " written in the ", sc(scNow)] });
    return {
      ref: ref("language", id), title: Lg.name, native: Lg.endonym, subtitle: `Language, ${Lg.born}–${Lg.ended >= 0 ? Lg.ended : "present"}`,
      infobox: [
        { label: "Speakers", value: [cu(Lg.culture)] },
        { label: "Emerged", value: [yr(Lg.born)] },
        Lg.parent >= 0 ? { label: "From", value: [la(Lg.parent)] } : null,
        Lg.children.length ? { label: "Became", value: Lg.children.flatMap((c, i) => [i ? ", " : "", la(c)]) } : null,
        { label: "Family", value: [la(Lg.family ?? id)] },
        data ? { label: "Order", value: [data.morphology.wordOrder] } : null,
      ].filter(Boolean) as InfoRow[],
      blocks,
    };
  }

  function scriptArticle(id: number): Article {
    const S = h.scripts[id];
    const data = S.data as { history?: string[]; direction?: string; glyphs?: unknown[] } | undefined;
    const blocks: Block[] = [{
      t: "p", dropCap: true,
      content: [
        "The ", S.name, " is ", S.kind === "abjad" ? "an abjad" : S.kind === "abugida" ? "an abugida" : S.kind === "alphabet" ? "an alphabet" : `a ${S.kind} script`,
        S.parent >= 0 ? [S.how === "derived" ? ", a later form of the " : ", adapted from the ", sc(S.parent)] : ", invented",
        " by the ", cu(S.culture), " in ", yr(S.born), ".", data?.direction ? ` It is written ${data.direction === "rtl" ? "from right to left" : data.direction === "ttb" ? "from top to bottom" : "from left to right"}.` : "",
      ].flat(2) as Rich,
    }];
    blocks.push(h2("Letters"), { t: "figure", figure: { kind: "script", script: id }, caption: ["The letters of the ", sc(id)] });
    if (data?.history?.length) blocks.push(h2("History"), { t: "list", items: data.history.map((x) => [x]) });
    blocks.push({ t: "figure", figure: { kind: "tree", root: ref("script", rootScript(id)), relation: "script" }, caption: ["The family of scripts"] });
    return {
      ref: ref("script", id), title: S.name.replace(/^./, (c) => c.toUpperCase()), subtitle: `${cap(S.kind)}, from ${S.born}`,
      infobox: [
        { label: "Kind", value: [cap(S.kind)] }, { label: "Since", value: [yr(S.born)] },
        { label: "People", value: [cu(S.culture)] },
        S.parent >= 0 ? { label: "From", value: [sc(S.parent)] } : null,
        S.children.length ? { label: "Became", value: S.children.flatMap((c, i) => [i ? ", " : "", sc(c)]) } : null,
      ].filter(Boolean) as InfoRow[],
      blocks,
    };
  }
  const rootScript = (id: number): number => {
    let s = id;
    while (h.scripts[s]?.parent >= 0) s = h.scripts[s].parent;
    return s;
  };

  function religionArticle(id: number): Article {
    const Rl = h.religions[id];
    const blocks: Block[] = [];
    const folk = Rl.kind === "folk" || Rl.kind === "pantheon" || Rl.kind === "ancestor";
    blocks.push({
      t: "p", dropCap: true,
      content: [
        ...reThe(id).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " (", native(Rl.name), ") ",
        folk ? ["is the old faith of the ", cu(Rl.culture), ", the worship of ", plural(Rl.deities.length, "god"), " of their land."] : ["is ", Rl.kind === "monotheism" ? "the faith in one god" : Rl.kind === "dualism" ? "a faith of light and darkness" : Rl.kind === "philosophy" ? "a teaching" : "a mystery cult", ", founded ", Rl.founder >= 0 ? ["by ", pe(Rl.founder), " "] : "", "in ", yr(Rl.founded), Rl.holyCity >= 0 ? [" at ", sl(Rl.holyCity, Rl.founded)] : "", "."],
        Rl.parent >= 0 ? [" It broke away from ", ...reThe(Rl.parent), "."] : "",
      ].flat(3) as Rich,
    });
    if (Rl.tenets.length) blocks.push(h2("Teachings"), { t: "list", items: Rl.tenets.map((t) => [cap(t) + "."]) });
    if (Rl.deities.length) blocks.push(h2(folk ? "The gods" : "God"), { t: "list", items: Rl.deities.map((d) => { const D = h.deities[d]; return [link("deity", d, D.name.roman), ", ", D.epithets[0] ?? "", D.domains.length ? `, god${D.sex === "f" ? "dess" : ""} of ${D.domains.join(" and ")}` : ""]; }) });
    const myths = h.myths.filter((m) => m.religion === id);
    for (const m of myths.slice(0, 3)) blocks.push(h3(m.kind === "creation" ? "The making of the world" : m.kind === "flood" ? "The flood" : m.kind === "originOfPeople" ? "The first people" : cap(m.kind)), { t: "quote", content: mythText(m), attribution: ["as told among the ", cu(Rl.culture)] });
    blocks.push({ t: "figure", figure: { kind: "map", focus: ref("religion", id), year: END }, caption: ["Spread of ", ...reThe(id), " in ", yr(END)] });
    if (Rl.children.length || Rl.parent >= 0) blocks.push({ t: "figure", figure: { kind: "tree", root: ref("religion", Rl.parent >= 0 ? Rl.parent : id), relation: "religion" } });
    const evs = eventsOf("religion", id);
    if (evs.length) blocks.push(h2("History"), ...eventList(evs, 25, 2));
    return {
      ref: ref("religion", id), title: cap(Rl.english.replace(/^the /, "")), native: Rl.name, subtitle: cap(Rl.kind === "folk" ? "folk religion" : Rl.kind), emblem: Rl.emblem,
      infobox: [
        { label: "Kind", value: [cap(Rl.kind)] }, { label: "Founded", value: [yr(Rl.founded)] },
        Rl.founder >= 0 ? { label: "Founder", value: [pe(Rl.founder)] } : null,
        Rl.holyCity >= 0 ? { label: "Holy city", value: [sl(Rl.holyCity, END)] } : null,
        Rl.scripture >= 0 ? { label: "Scripture", value: [link("work", Rl.scripture, h.works[Rl.scripture]?.english ?? "?")] } : null,
        { label: "Symbol", value: [Rl.symbol] },
      ].filter(Boolean) as InfoRow[],
      blocks,
    };
  }
  function mythText(m: H.Myth): Rich[] {
    const d = m.actors.map((a) => h.deities[a]).filter(Boolean);
    const n = (i: number): Inline => (d[i] ? link("deity", d[i].id, d[i].name.roman) : "the first god");
    if (m.kind === "creation") return [[`In the beginning there was only the dark water. `, n(0), ` ${d[0]?.epithets[0] ?? ""} rose from it and lay with `, n(1), `, and from them came the sky and the land.`], [`What `, n(0), ` touched became stone; what `, n(1), ` breathed on became green.`]];
    if (m.kind === "flood") return [[`The people forgot the offerings, and `, n(0), ` let the waters rise until only the high places were dry. Those who remembered the old songs were spared.`]];
    if (m.kind === "originOfPeople") return [[n(0), ` shaped the first people from river clay and gave them fire, so that they would remember who had made them.`]];
    return [[`A tale of `, n(0), `.`]];
  }

  function deityArticle(id: number): Article {
    const D = h.deities[id];
    return {
      ref: ref("deity", id), title: D.name.roman, native: D.name, subtitle: `${D.sex === "f" ? "Goddess" : "God"} of ${D.domains.join(" and ")}`,
      infobox: [
        { label: "Faith", value: [re(D.religion)] }, { label: "Domains", value: [D.domains.join(", ")] }, { label: "Symbol", value: [D.symbol] },
        D.consort >= 0 ? { label: "Consort", value: [link("deity", D.consort, h.deities[D.consort].name.roman)] } : null,
        D.parents.length ? { label: "Parents", value: D.parents.flatMap((x, i) => [i ? " and " : "", link("deity", x, h.deities[x].name.roman)]) } : null,
        D.children.length ? { label: "Children", value: D.children.flatMap((x, i) => [i ? ", " : "", link("deity", x, h.deities[x].name.roman)]) } : null,
        D.feature >= 0 ? { label: "Embodies", value: [fe(D.feature)] } : null,
      ].filter(Boolean) as InfoRow[],
      blocks: [{ t: "p", dropCap: true, content: [native(D.name), `, ${D.epithets.join(", ")}, is ${D.sex === "f" ? "a goddess" : "a god"} of ${D.domains.join(" and ")} worshipped in `, ...reThe(D.religion), ".", D.feature >= 0 ? [" The ", fe(D.feature), " is held to be ", D.sex === "f" ? "her" : "his", " body."] : ""].flat() as Rich }],
    };
  }

  function warArticle(id: number): Article {
    const W = h.wars[id];
    const bs = W.battles.map((b) => h.battles[b]);
    const blocks: Block[] = [{
      t: "p", dropCap: true,
      content: [
        ...wa(id).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), " was fought between ", ...W.attackers.flatMap((a, i) => [i ? " and " : "", pl(a, W.start)]), " and ", ...W.defenders.flatMap((a, i) => [i ? " and " : "", pl(a, W.start)]),
        " from ", yr(W.start), W.end >= 0 ? [" to ", yr(W.end)] : " and is not yet over", `. The cause was ${W.casusBelli.replace(/([A-Z])/g, " $1").toLowerCase()}. `,
        bs.length ? `${plural(bs.length, "battle")} were fought, and some ${formatNumber(Math.round(W.casualties / 100) * 100)} died. ` : "",
        W.end >= 0 ? [W.outcome === "attackerVictory" ? "It ended in victory for the attackers" : W.outcome === "defenderVictory" ? "The defenders held" : "It ended without a victor", W.treaty ? [" with ", W.treaty] : "", "."] : "",
      ].flat(3) as Rich,
    }];
    if (bs.length) blocks.push(h2("Battles"), { t: "table", head: ["Year", "Battle", "Victor", "Losses"], rows: bs.map((b) => [[yr(b.year)], [ba(b.id)], [b.victor === "draw" ? "drawn" : pl(b.victor === "attacker" ? b.attacker.polity : b.defender.polity, b.year)], [formatNumber(b.attacker.losses + b.defender.losses)]]) });
    blocks.push({ t: "figure", figure: { kind: "map", focus: ref("war", id), year: W.start }, caption: ["The theatre of ", ...wa(id)] });
    return {
      ref: ref("war", id), title: cap(W.name.replace(/^the /, "")), subtitle: `War, ${W.start}–${W.end >= 0 ? W.end : "ongoing"}`,
      infobox: [
        { label: "Dates", value: [yr(W.start), "–", W.end >= 0 ? yr(W.end) : "ongoing"] },
        { label: "Attackers", value: W.attackers.flatMap((a, i) => [i ? ", " : "", pl(a, W.start)]) },
        { label: "Defenders", value: W.defenders.flatMap((a, i) => [i ? ", " : "", pl(a, W.start)]) },
        { label: "Cause", value: [W.casusBelli] },
        { label: "Outcome", value: [W.outcome.replace(/([A-Z])/g, " $1").toLowerCase()] },
        { label: "Dead", value: [formatNumber(W.casualties)] },
        W.treaty ? { label: "Treaty", value: [W.treaty] } : null,
      ].filter(Boolean) as InfoRow[],
      blocks,
    };
  }

  function battleArticle(id: number): Article {
    const B = h.battles[id];
    const v = B.victor === "attacker" ? B.attacker.polity : B.victor === "defender" ? B.defender.polity : -1;
    return {
      ref: ref("battle", id), title: B.name, subtitle: `${cap(B.kind)} battle, ${B.year}`,
      infobox: [
        { label: "War", value: wa(B.war) }, { label: "Year", value: [yr(B.year)] },
        B.site >= 0 ? { label: "Place", value: [sl(B.site, B.year)] } : null,
        { label: "Attacker", value: [pl(B.attacker.polity, B.year), B.attacker.commander >= 0 ? [" under ", pe(B.attacker.commander)] : ""].flat() as Rich },
        { label: "Defender", value: [pl(B.defender.polity, B.year), B.defender.commander >= 0 ? [" under ", pe(B.defender.commander)] : ""].flat() as Rich },
        { label: "Strength", value: [`${formatNumber(B.attacker.strength)} against ${formatNumber(B.defender.strength)}`] },
        { label: "Losses", value: [`${formatNumber(B.attacker.losses)} and ${formatNumber(B.defender.losses)}`] },
        { label: "Victor", value: [v >= 0 ? pl(v, B.year) : "none"] },
      ].filter(Boolean) as InfoRow[],
      blocks: [
        { t: "p", dropCap: true, content: [`The ${B.name} was fought in `, yr(B.year), " during ", ...wa(B.war), ". ", v >= 0 ? [pl(v, B.year), " won the day."] : "Neither side could claim the field.", B.slain.length ? [" Among the dead was ", ...B.slain.flatMap((x, i) => [i ? ", " : "", pe(x)]), "."] : ""].flat(2) as Rich },
        { t: "figure", figure: { kind: "map", focus: ref("battle", id), year: B.year } },
      ],
    };
  }

  function simpleArticle(r: Ref): Article {
    switch (r.kind) {
      case "wonder": {
        const W = h.wonders[r.id];
        return {
          ref: r, title: cap(W.english.replace(/^the /, "")), subtitle: cap(W.kind), infobox: [
            { label: "Place", value: [sl(W.settlement, W.completed)] }, { label: "Completed", value: [yr(W.completed)] },
            W.builder >= 0 ? { label: "Builder", value: [pe(W.builder)] } : null,
            W.destroyed >= 0 ? { label: "Destroyed", value: [yr(W.destroyed), W.destroyCause ? ` (${W.destroyCause})` : ""] } : null,
          ].filter(Boolean) as InfoRow[],
          blocks: [{ t: "p", dropCap: true, content: [cap(W.english), ` was a ${W.kind} raised at `, sl(W.settlement, W.completed), " by ", pl(W.polity, W.completed), ", completed in ", yr(W.completed), ".", W.destroyed >= 0 ? [" It was destroyed in ", yr(W.destroyed), "."] : " It still stands."].flat() as Rich }],
        };
      }
      case "work": {
        const W = h.works[r.id];
        const blocks: Block[] = [{ t: "p", dropCap: true, content: [em(W.english), ` (`, native(W.title), `) is ${W.kind === "epic" ? "an epic" : `a ${W.kind}`} written by `, pe(W.author), " in ", la(W.lang), " around ", yr(W.year), ".", W.lost ? " It is lost; only its name survives." : ""] }];
        if (W.incipit && !W.lost) blocks.push(h3("It begins"), { t: "utterance", utterance: W.incipit });
        return { ref: r, title: W.english.replace(/^“|”$/g, ""), native: W.title, subtitle: cap(W.kind), infobox: [{ label: "Author", value: [pe(W.author)] }, { label: "Written", value: [yr(W.year)] }, { label: "Tongue", value: [la(W.lang)] }], blocks };
      }
      case "disaster": {
        const D = h.disasters[r.id];
        return {
          ref: r, title: D.name ? cap(D.name.replace(/^the /, "")) : `The ${D.kind} of ${D.start}`, subtitle: cap(D.kind),
          infobox: [{ label: "Years", value: [yr(D.start), "–", yr(D.end)] }, { label: "Dead", value: [formatNumber(D.deaths)] }],
          blocks: [
            { t: "p", dropCap: true, content: [D.name ? cap(D.name) : `The ${D.kind}`, ` struck in `, yr(D.start), `, touching ${plural(D.settlements.length, "town")} and killing perhaps ${formatNumber(Math.round(D.deaths / 1000) * 1000)}.`] },
            D.settlements.length ? { t: "list", items: D.settlements.slice(0, 20).map((s) => [sl(s, D.start)]) } : p(""),
          ],
        };
      }
      case "tradeRoute": {
        const T = h.tradeRoutes[r.id];
        return { ref: r, title: cap(T.name.replace(/^the /, "")), subtitle: `${cap(T.kind)} route`, infobox: [{ label: "From", value: [sl(T.from, T.founded)] }, { label: "To", value: [sl(T.to, T.founded)] }, { label: "Opened", value: [yr(T.founded)] }, { label: "Goods", value: [T.goods.join(", ")] }], blocks: [{ t: "p", dropCap: true, content: [cap(T.name), ` ran by ${T.kind} from `, sl(T.from, T.founded), " to ", sl(T.to, T.founded), ", carrying ", T.goods.join(", ") || "goods", "."] }] };
      }
      case "feature": {
        const F = world.features[r.id];
        const fn = featureNamesById.get(r.id);
        const n0 = fn?.names[0]?.name;
        const blocks: Block[] = [{ t: "p", dropCap: true, content: [n0 ? native(n0) : `This ${F.kind}`, ` is a ${F.kind}`, F.kind === "river" ? ` some ${formatNumber(Math.round(F.size / 10) * 10)} km long.` : F.size > 0 ? ` of some ${formatNumber(Math.round(F.size / 1000) * 1000)} km².` : ".", fn ? [" It was first named by the ", cu(fn.names[0].culture), " in ", yr(fn.names[0].year), n0?.gloss ? [", meaning ", em(`‘${n0.gloss.toLowerCase()}’`)] : "", "."] : ""].flat(2) as Rich }];
        if (fn && fn.names.length > 1) blocks.push(h2("Names"), { t: "table", head: ["People", "Name", "Meaning"], rows: fn.names.map((x) => [[cu(x.culture)], [native(x.name)], [x.name.gloss || "—"]]) });
        blocks.push({ t: "figure", figure: { kind: "map", focus: r, year: END } });
        return { ref: r, title: n0?.roman ?? cap(F.kind), native: n0, subtitle: cap(F.kind), infobox: [{ label: "Kind", value: [F.kind] }, { label: F.kind === "river" ? "Length" : "Area", value: [F.kind === "river" ? `${formatNumber(F.size)} km` : `${formatNumber(F.size)} km²`] }], blocks };
      }
      case "age": {
        const A = h.ages[r.id];
        const evs = h.events.filter((e) => e.year >= A.start && e.year < A.end && e.importance >= 4);
        return { ref: r, title: cap(A.name.replace(/^the /, "")), subtitle: `${A.start}–${A.end}`, infobox: [{ label: "Years", value: [yr(A.start), "–", yr(A.end)] }], blocks: [{ t: "p", dropCap: true, content: [A.summary] }, h2("Great events"), ...eventList(evs, 40, 4)] };
      }
      case "event": {
        const E = h.events[r.id];
        return { ref: r, title: `${E.year}`, subtitle: cap(E.type.replace(/([A-Z])/g, " $1").toLowerCase()), infobox: [{ label: "Year", value: [yr(E.year)] }], blocks: [p(...line(E))] };
      }
      case "myth": {
        const M = h.myths[r.id];
        return { ref: r, title: cap(M.kind), infobox: [{ label: "Faith", value: [re(M.religion)] }], blocks: [{ t: "quote", content: mythText(M) }] };
      }
      case "year": {
        const evs = h.events.filter((e) => e.year === r.id);
        return { ref: r, title: `Year ${r.id}`, infobox: [], blocks: eventList(evs, 60, 1) };
      }
      default:
        return { ref: r, title: "Unknown", infobox: [], blocks: [p("Nothing is recorded.")] };
    }
  }

  // ------------------------------------------------------------- overview
  function overview(): Article {
    const alivePol = h.polities.filter((P) => P.ended < 0).sort((a, b) => (b.stats.areaKm2.at(-1) ?? 0) - (a.stats.areaKm2.at(-1) ?? 0));
    const continents = world.features.filter((f) => f.kind === "continent" || (f.kind === "island" && f.size > 3e5)).sort((a, b) => b.size - a.size);
    const oceans = world.features.filter((f) => f.kind === "ocean").sort((a, b) => b.size - a.size);
    const pop = h.worldStats?.pop.at(-1) ?? 0;
    const greatCities = h.settlements.filter((s) => s.ended < 0).sort((a, b) => popAt(b, END, h.sampleStep) - popAt(a, END, h.sampleStep)).slice(0, 8);
    const famous = h.persons.filter((x) => x.epithet && x.roles.some((r) => r.kind === "ruler")).sort((a, b) => b.deeds.length - a.deeds.length).slice(0, 8);
    const blocks: Block[] = [];
    blocks.push({
      t: "p", dropCap: true,
      content: [
        `This is a world of ${plural(continents.length, "great landmass", "great landmasses")}`, oceans.length ? [" and ", plural(oceans.length, "ocean")] : "", `, its history reckoned over ${formatNumber(END)} years. `,
        `${plural(h.cultures.length, "people")} have lived here, speaking ${plural(h.languages.length, "tongue")}; ${plural(h.polities.length, "realm")} have risen and fallen, and ${plural(h.wars.length, "war")} have been fought. `,
        pop ? `Some ${formatPop(pop)} souls live in it now.` : "",
      ].flat() as Rich,
    });
    if (continents.length) blocks.push(h2("Lands and seas"), { t: "list", items: [...continents.slice(0, 6), ...oceans.slice(0, 4)].map((f) => [fe(f.id), `, ${f.kind}, ${formatNumber(Math.round(f.size / 1e4) * 1e4)} km²`]) });
    blocks.push(h2("The great realms of the present"), { t: "list", items: alivePol.slice(0, 8).map((P) => [...plT(P.id, END).map((x, i) => (i === 0 && typeof x === "string" ? cap(x) : x)), ", ", cu(P.culture), `, since `, yr(P.founded)]) });
    blocks.push(h2("The ages of the world"), { t: "list", ordered: true, items: h.ages.map((a, i) => [link("age", i, cap(a.name.replace(/^the /, ""))), " (", yr(a.start), "–", yr(a.end), "). ", a.summary]) });
    if (greatCities.length) blocks.push(h2("Great cities"), { t: "table", head: ["City", "Realm", "People"], rows: greatCities.map((s) => { const o = ownerAt(s, END); return [[sl(s.id, END)], [o >= 0 ? pl(o, END) : "—"], [formatPop(popAt(s, END, h.sampleStep))]]; }) });
    if (famous.length) blocks.push(h2("Remembered names"), { t: "list", items: famous.map((x) => { const r = x.roles.find((q) => q.kind === "ruler")!; return [pe(x.id), ", ", pl(r.polity, r.from), ", ", yr(r.from), "–", yr(r.to)]; }) });
    blocks.push(h2("Curious facts"), { t: "list", items: curiousFacts() });
    if (h.worldStats?.pop.length) blocks.push({ t: "figure", figure: { kind: "chart", yLabel: "", series: [{ label: "People in the world", years: h.worldStats.pop.map((_, i) => i * h.sampleStep), values: h.worldStats.pop }] }, caption: ["The peopling of the world"] });
    return { ref: ref("world", 0), title: "The World", subtitle: `Seed “${world.params.seed}” · ${formatNumber(END)} years`, infobox: [], blocks };
  }
  function curiousFacts(): Rich[] {
    const out: Rich[] = [];
    const longest = [...h.polities].sort((a, b) => ((b.ended < 0 ? END : b.ended) - b.founded) - ((a.ended < 0 ? END : a.ended) - a.founded))[0];
    if (longest) out.push(["The longest-lived realm was ", pl(longest.id, longest.founded), `, which lasted ${formatNumber((longest.ended < 0 ? END : longest.ended) - longest.founded)} years.`]);
    const reign = [...h.persons].filter((x) => x.roles.some((r) => r.kind === "ruler")).map((x) => ({ x, r: x.roles.find((r) => r.kind === "ruler")! })).sort((a, b) => (b.r.to - b.r.from) - (a.r.to - a.r.from))[0];
    if (reign) out.push([pe(reign.x.id), ` reigned for ${reign.r.to - reign.r.from} years, longer than any other ruler.`]);
    const renamed = [...h.settlements].sort((a, b) => b.names.length - a.names.length)[0];
    if (renamed && renamed.names.length > 2) out.push([sl(renamed.id, END), ` has borne ${renamed.names.length} names: `, ...renamed.names.flatMap((n, i) => [i ? ", " : "", native(n.name)]), "."]);
    const war = [...h.wars].sort((a, b) => ((b.end < 0 ? END : b.end) - b.start) - ((a.end < 0 ? END : a.end) - a.start))[0];
    if (war) out.push(["The longest war was ", ...wa(war.id), `, which dragged on for ${(war.end < 0 ? END : war.end) - war.start} years.`]);
    const plague = [...h.disasters].filter((d) => d.kind === "plague").sort((a, b) => b.deaths - a.deaths)[0];
    if (plague) out.push(["The deadliest plague, ", link("disaster", plague.id, plague.name || `the plague of ${plague.start}`), `, killed some ${formatNumber(Math.round(plague.deaths / 1000) * 1000)}.`]);
    const counts = new Map<string, number>();
    for (const x of h.persons) if (x.roles.some((r) => r.kind === "ruler")) { const g = x.name.roman.split(" ")[0]; counts.set(g, (counts.get(g) ?? 0) + 1); }
    const fav = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (fav && fav[1] > 2) out.push([`The most common royal name was `, em(fav[0]), `, borne by ${fav[1]} rulers.`]);
    return out;
  }

  function atYear(y: number): Block[] {
    const age = h.ages.find((a) => y >= a.start && y < a.end) ?? h.ages[h.ages.length - 1];
    const realms = h.polities.filter((P) => alive(P.founded, P.ended, y)).sort((a, b) => (b.stats.areaKm2[Math.floor(y / h.sampleStep) - b.statStart] ?? 0) - (a.stats.areaKm2[Math.floor(y / h.sampleStep) - a.statStart] ?? 0));
    const wars = h.wars.filter((w) => w.start <= y && (w.end < 0 || w.end >= y));
    const out: Block[] = [];
    if (age) out.push(p(link("age", h.ages.indexOf(age), cap(age.name.replace(/^the /, ""))), " — ", age.summary));
    if (realms.length) out.push(p(`${plural(realms.length, "realm")}; the greatest are `, ...realms.slice(0, 4).flatMap((P, i) => [i ? (i === Math.min(4, realms.length) - 1 ? " and " : ", ") : "", pl(P.id, y)]), ".", wars.length ? ` ${plural(wars.length, "war")} ${wars.length === 1 ? "is" : "are"} being fought.` : " The world is at peace."));
    return out;
  }

  // ------------------------------------------------------------- search
  let index: SearchEntry[] | null = null;
  function searchIndex(): SearchEntry[] {
    if (index) return index;
    const out: SearchEntry[] = [];
    const alts = (names: H.NameRecord[]): string[] => [...new Set(names.map((n) => n.name.roman))];
    h.settlements.forEach((s) => {
      const peak = Math.max(0, ...s.pop);
      const n = alts(s.names);
      out.push({ ref: ref("settlement", s.id), label: n[n.length - 1], alt: n.slice(0, -1), type: s.ended >= 0 ? "ruin" : SIZE_WORD(peak), weight: Math.log10(peak + 10) });
    });
    h.polities.forEach((P) => {
      const n = alts(P.names);
      out.push({ ref: ref("polity", P.id), label: polityTitle(h, P.id, P.ended >= 0 ? P.ended - 1 : END).replace(/^the /, ""), alt: n, type: GOV_NOUN[govAt(P, P.ended >= 0 ? P.ended - 1 : END)], weight: 3 + Math.log10(1 + (P.peak?.areaKm2 ?? 0)) });
    });
    h.persons.forEach((x) => {
      if (!x.roles.length) return;
      const r = x.roles[0].kind;
      out.push({ ref: ref("person", x.id), label: personName(h, x.id), alt: [x.name.roman], type: r === "ruler" ? (x.sex === "f" ? "queen" : "king") : r, weight: 1 + x.deeds.length * 0.2 });
    });
    h.cultures.forEach((c) => out.push({ ref: ref("culture", c.id), label: c.adjective, alt: [c.name.roman], type: "people", weight: 5 }));
    h.languages.forEach((l) => out.push({ ref: ref("language", l.id), label: l.name, alt: [l.endonym.roman], type: "language", weight: 4 }));
    h.scripts.forEach((s) => out.push({ ref: ref("script", s.id), label: s.name, alt: [], type: "script", weight: 3 }));
    h.religions.forEach((r) => out.push({ ref: ref("religion", r.id), label: cap(r.english.replace(/^the /, "")), alt: [r.name.roman], type: "faith", weight: 5 }));
    h.deities.forEach((d) => out.push({ ref: ref("deity", d.id), label: d.name.roman, alt: d.epithets, type: d.sex === "f" ? "goddess" : "god", weight: 2 }));
    h.dynasties.forEach((d) => out.push({ ref: ref("dynasty", d.id), label: d.name.roman, alt: [], type: "house", weight: 2 }));
    h.wars.forEach((w) => out.push({ ref: ref("war", w.id), label: cap(w.name.replace(/^the /, "")), alt: [], type: "war", weight: 2 + Math.log10(1 + w.casualties) * 0.3 }));
    h.battles.forEach((b) => out.push({ ref: ref("battle", b.id), label: b.name, alt: [], type: "battle", weight: 1 }));
    h.wonders.forEach((w) => out.push({ ref: ref("wonder", w.id), label: cap(w.english.replace(/^the /, "")), alt: [], type: w.kind, weight: 3 }));
    h.works.forEach((w) => out.push({ ref: ref("work", w.id), label: w.english.replace(/^“|”$/g, ""), alt: [w.title.roman], type: w.kind, weight: 2 }));
    h.disasters.forEach((d) => d.name && out.push({ ref: ref("disaster", d.id), label: cap(d.name.replace(/^the /, "")), alt: [], type: d.kind, weight: 3 }));
    h.featureNames.forEach((f) => {
      const F = world.features[f.feature];
      const names = [...new Set(f.names.map((x) => x.name.roman))];
      out.push({ ref: ref("feature", f.feature), label: names[0], alt: names.slice(1), type: F?.kind ?? "place", weight: 2 + Math.log10(1 + (F?.size ?? 0)) * 0.3 });
    });
    h.ages.forEach((a, i) => out.push({ ref: ref("age", i), label: cap(a.name.replace(/^the /, "")), alt: [], type: "age", weight: 5 }));
    index = out;
    return out;
  }

  function label(r: Ref, y = END): string {
    switch (r.kind) {
      case "settlement": return settlementName(h, r.id, y);
      case "polity": return polityName(h, r.id, y);
      case "person": return personName(h, r.id);
      case "culture": return h.cultures[r.id]?.adjective ?? "?";
      case "language": return h.languages[r.id]?.name ?? "?";
      case "script": return h.scripts[r.id]?.name ?? "?";
      case "religion": return cap(h.religions[r.id]?.english.replace(/^the /, "") ?? "?");
      case "deity": return h.deities[r.id]?.name.roman ?? "?";
      case "dynasty": return h.dynasties[r.id]?.name.roman ?? "?";
      case "war": return cap(h.wars[r.id]?.name.replace(/^the /, "") ?? "?");
      case "battle": return h.battles[r.id]?.name ?? "?";
      case "wonder": return cap(h.wonders[r.id]?.english.replace(/^the /, "") ?? "?");
      case "work": return h.works[r.id]?.english ?? "?";
      case "feature": return featureName(r.id, y);
      case "age": return cap(h.ages[r.id]?.name.replace(/^the /, "") ?? "?");
      case "disaster": return h.disasters[r.id]?.name || "disaster";
      case "tradeRoute": return h.tradeRoutes[r.id]?.name ?? "?";
      case "year": return String(r.id);
      case "world": return "The World";
      default: return "?";
    }
  }

  function article(r: Ref): Article {
    const key = `${r.kind}:${r.id}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let a: Article;
    try {
      switch (r.kind) {
        case "world": a = overview(); break;
        case "settlement": a = settlementArticle(r.id); break;
        case "polity": a = polityArticle(r.id); break;
        case "person": a = personArticle(r.id); break;
        case "dynasty": a = dynastyArticle(r.id); break;
        case "culture": a = cultureArticle(r.id); break;
        case "language": a = languageArticle(r.id); break;
        case "script": a = scriptArticle(r.id); break;
        case "religion": a = religionArticle(r.id); break;
        case "deity": a = deityArticle(r.id); break;
        case "war": a = warArticle(r.id); break;
        case "battle": a = battleArticle(r.id); break;
        default: a = simpleArticle(r);
      }
    } catch (e) {
      console.error(e);
      a = { ref: r, title: label(r), infobox: [], blocks: [p("This article could not be written.")] };
    }
    cache.set(key, a);
    return a;
  }

  return {
    source: "fallback",
    overview: () => article(ref("world", 0)),
    article,
    chronicle,
    searchIndex,
    label,
    headline: (id) => (h.events[id] ? line(h.events[id]) : []),
    atYear,
  };
  void rulerAt;
  void ordinalWord;
}
