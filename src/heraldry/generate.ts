/**
 * Arms generation.
 *
 * Builds a coat from a weighted grammar that mirrors the make-up of medieval
 * rolls of arms: most coats are a plain field with one ordinary or a few
 * charges; divided fields, variations, chiefs, bordures and cantons are less
 * common; complexity grows with the style's `complexity`. Every element is
 * tinctured so that it contrasts with what it lies on (the rule of tincture);
 * a small, flagged fraction deliberately breaks the rule as real "arms of
 * enquiry" do. Canting is supported via `motifs` (charges keyed to the
 * bearer's name).
 */
import type { Rng } from "../core/rng";
import type { Tincture } from "../world/concepts";
import type {
  Arrangement, Attitude, ChargeGroup, ChargeId, Field, Fur, Line, Ordinary, OrdinaryKind, Partition, SimpleArms, Tint, Arms,
} from "./types";
import { CHARGES, ALL_CHARGE_IDS } from "./charges/index";
import type { ChargeDef } from "./charges/art";
import { isFur, isMetal, readable, tinctureOk, FUR_PARTS } from "./tinctures";
import { resolveStyle, type HeraldryStyle, type StyleName } from "./styles";

export interface GenerateOptions {
  /** A style preset name or a full style. Default "anglo". */
  style?: HeraldryStyle | StyleName;
  /** Charges that cant on the bearer's name; one becomes the principal charge (see `motifChance`). */
  motifs?: ChargeId[];
  /** Probability of using a motif when given. Default 0.85. */
  motifChance?: number;
  /** Tinctures to favour (a liege's or a city's colours). */
  colours?: Tint[];
  /** Override the style's complexity (0..1). */
  complexity?: number;
}

const BASE_TINT: Record<Tincture, number> = { gules: 30, argent: 24, or: 21, azure: 17, sable: 15, vert: 5, purpure: 1.4, tenne: 0.7, sanguine: 0.8 };
const BASE_FUR: Record<Fur, number> = { ermine: 3.4, vair: 1.8, ermines: 0.4, erminois: 0.5, pean: 0.3, countervair: 0.5, potent: 0.4 };
const TINCTURE_LIST = Object.keys(BASE_TINT) as Tincture[];
const FUR_LIST = Object.keys(BASE_FUR) as Fur[];

const PARTITION_BASE: Partial<Record<Partition, number>> = {
  perPale: 6, perFess: 5, quarterly: 6, perBend: 4, perChevron: 3, perSaltire: 2, gyronny: 1.6, perBendSinister: 1,
  perPall: 0.5, tiercedInPale: 0.4, tiercedInFess: 0.4,
};
const VARIATION_BASE: Partial<Record<Partition, number>> = { barry: 5, paly: 4, bendy: 3, chequy: 4, lozengy: 2, chevronny: 1, bendySinister: 0.5 };
const ORDINARY_BASE: Record<OrdinaryKind, number> = {
  chevron: 10, fess: 8, bend: 8, cross: 7, saltire: 5, pale: 4, bendSinister: 1.2, pile: 1.2, pall: 0.8, orle: 1, fret: 1,
  chevronReversed: 0.3, pallReversed: 0.2, base: 0.6,
};
const LINE_BASE: Record<Exclude<Line, "straight">, number> = {
  wavy: 6, engrailed: 5, indented: 4, embattled: 2.5, dancetty: 2, invected: 1.5, nebuly: 1.5, raguly: 1, dovetailed: 0.6,
};

type Ctx = "principal" | "minor" | "onOrdinary" | "chief" | "bordure" | "semy" | "canton";

const SEMY_OK: ChargeId[] = ["fleurDeLis", "crossCrosslet", "billet", "goutte", "mullet", "star", "roundel", "crescent", "escallop", "cinquefoil", "quatrefoil", "trefoil", "heart", "annulet", "lozenge", "crossPatty", "martlet", "rose", "feather"];
const BORDURE_OK: ChargeId[] = ["roundel", "mullet", "crossCrosslet", "crossPatty", "escallop", "fleurDeLis", "martlet", "billet", "annulet", "crescent", "cinquefoil", "castle", "star", "rose", "heart", "lozenge", "quatrefoil", "key", "crown", "wheat"];
const BIG_ONLY: ChargeId[] = ["tree", "oak", "pine", "mountain", "wave", "ship", "bridge", "castle", "dragon", "horse", "lightning"];

class Gen {
  rng: Rng;
  st: HeraldryStyle;
  cx: number;
  tw: Map<Tint, number> = new Map();
  constructor(rng: Rng, st: HeraldryStyle, public opts: GenerateOptions) {
    this.rng = rng;
    this.st = st;
    this.cx = opts.complexity ?? st.complexity;
    const fm = st.furs ?? 1;
    for (const t of TINCTURE_LIST) this.tw.set(t, BASE_TINT[t] * (st.tinctures?.[t] ?? 1) * (opts.colours?.includes(t) ? 3 : 1));
    for (const t of FUR_LIST) this.tw.set(t, BASE_FUR[t] * fm * (st.tinctures?.[t] ?? 1) * (opts.colours?.includes(t) ? 2 : 1));
  }

  chance(p: number): boolean {
    return this.rng.chance(Math.max(0, Math.min(1, p)));
  }

  pickTint(ok: (t: Tint) => boolean, furs: boolean): Tint {
    const pairs: [Tint, number][] = [];
    for (const [t, w] of this.tw) if ((furs || !isFur(t)) && ok(t)) pairs.push([t, w]);
    if (!pairs.length) return "or";
    return this.rng.weighted(pairs);
  }

  /** A tincture readable on all of `unders` (ideally) or at least on the first. */
  over(unders: Tint[], opts: { furs?: boolean; avoid?: Tint[] } = {}): Tint {
    const avoid = opts.avoid ?? [];
    const okAll = (t: Tint) => !avoid.includes(t) && unders.every((u) => readable(t, u) && tinctureOk(t, u));
    const pairs: [Tint, number][] = [];
    for (const [t, w] of this.tw) if ((opts.furs || !isFur(t)) && okAll(t)) pairs.push([t, w]);
    if (pairs.length) return this.rng.weighted(pairs);
    return this.pickTint((t) => !avoid.includes(t) && readable(t, unders[0]), !!opts.furs);
  }

  line(pNonStraight: number): Line {
    const sw = this.st.lines?.straight ?? 1;
    if (!this.chance(pNonStraight / sw)) return "straight";
    const pairs: [Line, number][] = (Object.keys(LINE_BASE) as Exclude<Line, "straight">[]).map((l) => [l, LINE_BASE[l] * (this.st.lines?.[l] ?? 1)]);
    return this.rng.weighted(pairs);
  }

  chargeWeight(id: ChargeId, def: ChargeDef, ctx: Ctx): number {
    let w = def.weight * (this.st.charges?.[id] ?? 1) * (this.st.categories?.[def.category] ?? 1);
    const cat = def.category;
    switch (ctx) {
      case "principal":
        if (id === "goutte") w *= 0.05;
        else if (id === "billet" || id === "escutcheon" || id === "annulet") w *= 0.4;
        else if (cat === "beast" || cat === "bird" || cat === "monster") w *= 1.3;
        else if (cat === "geometric") w *= 0.8;
        break;
      case "minor":
      case "onOrdinary":
      case "chief":
      case "canton":
        if (BIG_ONLY.includes(id)) w *= 0.08;
        else if (cat === "beast") w *= id === "lion" ? 0.5 : 0.18;
        else if (cat === "monster") w *= 0.1;
        else if (cat === "bird") w *= id === "martlet" ? 2.2 : 0.35;
        else if (cat === "geometric" || cat === "cross") w *= 1.6;
        else if (id === "escallop") w *= 2;
        else if (cat === "building") w *= 0.5;
        if (ctx === "onOrdinary" && (cat === "beast" || cat === "bird") && id !== "martlet") w *= 0.6;
        break;
      case "bordure":
        if (!BORDURE_OK.includes(id)) return 0;
        break;
      case "semy":
        if (!SEMY_OK.includes(id)) return 0;
        if (id === "fleurDeLis" || id === "crossCrosslet" || id === "billet") w *= 2.5;
        break;
    }
    return w;
  }

  pickCharge(ctx: Ctx, allowMotif: boolean): ChargeId {
    const motifs = this.opts.motifs?.filter((m) => CHARGES[m] && this.chargeWeight(m, CHARGES[m], ctx) > 0) ?? [];
    if (allowMotif && motifs.length && this.chance(this.opts.motifChance ?? 0.85)) return this.rng.pick(motifs);
    const pairs: [ChargeId, number][] = [];
    for (const id of ALL_CHARGE_IDS) {
      const def = CHARGES[id];
      if (!def) continue;
      const w = this.chargeWeight(id, def, ctx);
      if (w > 0) pairs.push([id, w]);
    }
    return this.rng.weighted(pairs);
  }

  pickCount(id: ChargeId, ctx: Ctx): number {
    const def = CHARGES[id];
    const cat = def.category;
    const big = cat === "beast" || cat === "monster" || BIG_ONLY.includes(id);
    if (ctx === "principal") {
      if (big) return this.rng.weighted([[1, 66], [3, 24], [2, 8], [6, id === "lion" ? 2 : 0]] as [number, number][]);
      if (cat === "bird") return this.rng.weighted([[1, 42], [3, 42], [2, 6], [6, 8], [5, 2]] as [number, number][]);
      if (def.long) return this.rng.weighted([[1, 50], [2, 30], [3, 20]] as [number, number][]);
      return this.rng.weighted([[1, 30], [3, 44], [2, 6], [4, 3], [5, 3], [6, 10], [8, 2], [10, 1]] as [number, number][]);
    }
    return 3;
  }

  attitude(id: ChargeId, count: number): Attitude | undefined {
    const def = CHARGES[id];
    if (!def.attitudes || def.attitudes.length < 2) return undefined;
    if (id === "lion") return count > 1 && this.chance(0.55) ? "passant" : this.chance(0.18) ? "passant" : "rampant";
    if (id === "wolf") return this.chance(0.45) ? "passant" : "rampant";
    if (id === "fish") return this.chance(count > 1 ? 0.45 : 0.3) ? "hauriant" : "naiant";
    return this.rng.pick(def.attitudes);
  }

  /** Build a charge group, filling in conventional details. */
  group(id: ChargeId, count: number, tincture: Tint, under: Tint[], arrangement?: Arrangement, ctx: Ctx = "principal"): ChargeGroup {
    const def = CHARGES[id];
    const g: ChargeGroup = { charge: id, count, tincture };
    const att = this.attitude(id, count);
    if (att) g.attitude = att;
    if (arrangement) g.arrangement = arrangement;
    else if (ctx === "principal") {
      const passantish = g.attitude === "passant" || g.attitude === "naiant" || id === "bear" || id === "boar" || id === "bull" || id === "stag";
      if (count === 3 && passantish && this.chance(0.75)) g.arrangement = "pale";
      else if (count === 2 && passantish) g.arrangement = "pale";
      else if (count === 3 && !def.attitudes && this.chance(0.08)) g.arrangement = "bend";
      else if (count === 3 && def.long && this.chance(0.4)) g.arrangement = "fess";
    }
    if (id === "mullet") {
      if (this.chance(0.25)) g.points = 6;
      if (this.chance(0.08)) g.pierced = true;
    }
    if (id === "star" && this.chance(0.15)) g.points = 8;
    if (def.armedTerm && def.accentDefault && def.accentDefault !== "same" && this.chance(0.35)) {
      const a = this.over([...under], { avoid: [tincture] });
      if (a !== tincture) g.armed = a;
    } else if (def.armedTerm && def.accentDefault === "same" && this.chance(0.3)) {
      const metal: Tint = tincture === "or" ? "argent" : "or";
      g.armed = isMetal(tincture) ? (under.includes("gules") ? "azure" : "gules") : metal;
    }
    if ((id === "lion" || id === "eagle") && count === 1 && this.chance(0.14)) {
      g.crowned = tincture === "or" ? (under[0] === "gules" ? "azure" : "gules") : "or";
    }
    if (count > 1 && ctx === "principal" && def.category !== "beast" && !def.symmetric && this.chance(0.03)) g.reversed = true;
    if (id === "crescent" && this.chance(0.06)) g.inverted = true;
    return g;
  }

  pickPartition(variation: boolean): Partition {
    const base = variation ? VARIATION_BASE : PARTITION_BASE;
    const pairs: [Partition, number][] = (Object.keys(base) as Partition[]).map((p) => [p, base[p]! * (this.st.partitions?.[p] ?? 1)]);
    return this.rng.weighted(pairs);
  }

  pickOrdinary(): OrdinaryKind {
    const pairs: [OrdinaryKind, number][] = (Object.keys(ORDINARY_BASE) as OrdinaryKind[]).map((o) => [o, ORDINARY_BASE[o] * (this.st.ordinaries?.[o] ?? 1)]);
    return this.rng.weighted(pairs);
  }
}

// ---------------------------------------------------------------------------

function fieldTinctures(field: Field): Tint[] {
  return field.tinctures;
}

/** How many charges conventionally go "between" an ordinary. */
function betweenCount(g: Gen, kind: OrdinaryKind): number {
  switch (kind) {
    case "fess": return g.rng.weighted([[3, 55], [6, 12], [2, 25]] as [number, number][]);
    case "bend": case "bendSinister": return g.rng.weighted([[2, 62], [6, 38]] as [number, number][]);
    case "chevron": case "chevronReversed": return 3;
    case "cross": case "saltire": return 4;
    case "pale": return g.rng.weighted([[2, 50], [4, 30], [6, 20]] as [number, number][]);
    case "pall": case "pallReversed": return 3;
    case "pile": return 2;
    case "orle": return g.rng.weighted([[1, 70], [3, 30]] as [number, number][]);
    case "base": return g.rng.weighted([[1, 40], [3, 60]] as [number, number][]);
    default: return 0;
  }
}

function onOrdinaryCount(g: Gen, kind: OrdinaryKind): number {
  switch (kind) {
    case "fess": case "pale": case "bend": case "bendSinister": return g.rng.weighted([[3, 72], [1, 18], [2, 6], [5, 4]] as [number, number][]);
    case "chevron": case "chevronReversed": return g.rng.weighted([[3, 62], [1, 38]] as [number, number][]);
    case "cross": case "saltire": return g.rng.weighted([[1, 50], [5, 50]] as [number, number][]);
    case "pall": case "pallReversed": return 1;
    case "pile": return g.rng.weighted([[1, 40], [3, 60]] as [number, number][]);
    default: return 0;
  }
}

function makeOrdinary(g: Gen, kind: OrdinaryKind, under: Tint[], allowCharged: boolean): Ordinary {
  const o: Ordinary = { kind, tincture: g.over(under, { furs: g.chance(0.08) }) };
  const ln = kind === "orle" || kind === "fret" ? "straight" : g.line(0.24 + g.cx * 0.1);
  if (ln !== "straight") o.line = ln;
  if ((kind === "fess" || kind === "bend" || kind === "chevron" || kind === "pale") && g.chance(0.09)) {
    o.count = kind === "chevron" ? g.rng.pick([2, 3]) : g.rng.pick([2, 3]);
    if (kind === "fess" || kind === "pale") delete o.line;
  }
  if (kind === "pile" && g.chance(0.25)) o.count = 3;
  if ((kind === "bend" || kind === "fess") && !o.count && o.line === undefined && g.chance(0.07 + g.cx * 0.06)) o.cotised = true;
  if (allowCharged && !o.count && kind !== "orle" && kind !== "fret" && kind !== "base" && g.chance(0.12 + g.cx * 0.22)) {
    const n = onOrdinaryCount(g, kind);
    if (n > 0) {
      const id = g.pickCharge("onOrdinary", false);
      o.charges = g.group(id, n, g.over([o.tincture]), [o.tincture], undefined, "onOrdinary");
    }
  }
  return o;
}

/** Apply additions: chief, bordure, canton. */
function additions(g: Gen, a: SimpleArms, busy: boolean): void {
  const under = fieldTinctures(a.field);
  const k = 0.55 + g.cx;
  const pChief = (busy ? 0.07 : 0.12) * k * (g.st.chief ?? 1);
  const pBord = 0.085 * k * (g.st.bordure ?? 1);
  const pCanton = (busy ? 0.015 : 0.035) * k * (g.st.canton ?? 1);
  const canChief = !a.ordinary || ["fess", "bend", "bendSinister", "chevron", "saltire", "pale", "pile", "cross", "orle", "base"].includes(a.ordinary.kind);
  if (canChief && !(a.charges?.arrangement === "chief") && g.chance(pChief)) {
    const t = g.over(under);
    a.chief = { tincture: t };
    const ln = g.line(0.2);
    if (ln !== "straight") a.chief.line = ln;
    if (g.chance(0.42 + g.cx * 0.2)) {
      const id = g.pickCharge("chief", true);
      const n = g.rng.weighted([[3, 58], [1, 30], [2, 12]] as [number, number][]);
      a.chief.charges = g.group(id, n, g.over([t]), [t], undefined, "chief");
    }
  }
  if (g.chance(pBord)) {
    const t = g.over(under, { furs: g.chance(0.1) });
    a.bordure = { tincture: t };
    const r = g.rng.next();
    if (r < 0.28) a.bordure.line = g.rng.pick(["engrailed", "engrailed", "indented", "wavy", "invected"] as Line[]);
    else if (r < 0.38) a.bordure.compony = g.over([t], { avoid: under });
    if (!a.bordure.compony && g.chance(0.16 + g.cx * 0.12)) {
      const id = g.pickCharge("bordure", false);
      a.bordure.charges = g.group(id, g.rng.weighted([[8, 75], [10, 10], [6, 15]] as [number, number][]), g.over([t]), [t], undefined, "minor");
      delete a.bordure.line;
    }
  }
  const dexChiefFree = !a.charges || (a.ordinary && a.ordinary.kind !== "cross") || (a.charges.count === 1 && !a.secondary);
  if (!a.chief && dexChiefFree && g.chance(pCanton)) {
    const t = g.over(under, { furs: g.chance(0.3) });
    a.canton = { tincture: t };
    if (g.chance(0.4)) {
      const id = g.pickCharge("canton", true);
      a.canton.charge = g.group(id, 1, g.over([t]), [t], undefined, "canton");
    }
  }
}

function planWeights(g: Gen, motif: boolean): [string, number][] {
  const p = g.st.plans ?? {};
  return [
    ["ordinary", 34 * (p.ordinary ?? 1)],
    ["charges", (motif ? 50 : 32) * (p.charges ?? 1)],
    ["divided", 17 * (p.divided ?? 1) * (0.7 + g.cx * 0.6)],
    ["variation", (motif ? 1 : 7) * (p.variation ?? 1)],
    ["semy", 3 * (p.semy ?? 1) * (0.5 + g.cx)],
  ];
}

/** Generate one coat of arms. */
export function generateArms(rng: Rng, opts: GenerateOptions = {}): SimpleArms {
  const st = resolveStyle(opts.style);
  const g = new Gen(rng, st, opts);
  const hasMotif = !!opts.motifs?.some((m) => CHARGES[m]);
  const plan = g.rng.weighted(planWeights(g, hasMotif) as [string, number][]);
  let a: SimpleArms;
  switch (plan) {
    case "ordinary": {
      const t0 = g.pickTint(() => true, g.chance(0.6));
      a = { kind: "simple", field: { partition: "plain", tinctures: [t0] } };
      const kind = g.pickOrdinary();
      a.ordinary = makeOrdinary(g, kind, [t0], true);
      const pBetween = (kind === "cross" || kind === "saltire" ? 0.22 : kind === "fret" ? 0 : 0.48) * (0.6 + g.cx * 0.8);
      if (!a.ordinary.count && g.chance(hasMotif ? 0.85 : pBetween)) {
        const n = betweenCount(g, kind);
        if (n > 0) {
          const id = g.pickCharge(n === 1 ? "principal" : "minor", true);
          const same = g.chance(0.5) && readable(a.ordinary.tincture, t0) && !isFur(a.ordinary.tincture);
          const t = same ? a.ordinary.tincture : g.over([t0]);
          a.charges = g.group(id, n, t, [t0], undefined, "minor");
        }
      }
      additions(g, a, !!a.charges || !!a.ordinary.charges);
      break;
    }
    case "divided": {
      const part = g.pickPartition(false);
      const t0 = g.pickTint(() => true, g.chance(0.15));
      const three = part === "perPall" || part === "tiercedInPale" || part === "tiercedInFess";
      const colourColour = !three && g.chance(0.12);
      const t1 = colourColour
        ? g.pickTint((t) => t !== t0 && !isMetal(t) && !isMetal(t0) && !isFur(t0), false)
        : g.over([t0], { avoid: [t0] });
      const tints: Tint[] = [t0, t1];
      if (three) tints.push(g.pickTint((t) => !tints.includes(t) && readable(t, t1), false));
      const field: Field = { partition: part, tinctures: tints };
      const ln = part === "quarterly" || part === "gyronny" || three ? g.line(0.08) : g.line(0.3);
      if (ln !== "straight") field.line = ln;
      if (part === "gyronny" && g.chance(0.2)) field.count = 12;
      a = { kind: "simple", field };
      const r = g.rng.next();
      const counterOk = !three;
      if (r < 0.38 - g.cx * 0.15) {
        // the division alone
      } else if (r < 0.78) {
        const id = g.pickCharge("principal", true);
        const n = g.pickCount(id, "principal");
        const counter = counterOk && g.chance(0.42);
        const t = counter ? t0 : pickOverDivision(g, tints);
        const grp = g.group(id, n, t, tints);
        if (counter) grp.counterchanged = true;
        a.charges = grp;
      } else {
        const kind = g.rng.weighted([["chevron", 4], ["fess", 3], ["bend", 3], ["cross", 2], ["saltire", 2], ["pale", 1.5]] as [OrdinaryKind, number][]);
        const counter = counterOk && part !== "quarterly" && g.chance(0.45);
        const o: Ordinary = { kind, tincture: counter ? t0 : pickOverDivision(g, tints) };
        if (counter) o.counterchanged = true;
        a.ordinary = o;
      }
      additions(g, a, !!a.charges || !!a.ordinary);
      break;
    }
    case "variation": {
      const part = g.pickPartition(true);
      const t0 = g.pickTint(() => true, false);
      const t1 = g.over([t0], { avoid: [t0] });
      const field: Field = { partition: part, tinctures: [t0, t1] };
      if (part === "paly" || part === "barry" || part === "bendy" || part === "bendySinister") field.count = g.rng.weighted([[6, 6], [8, 3], [10, 1], [4, 1]] as [number, number][]);
      if (part === "barry" && g.chance(0.2)) field.line = g.rng.pick(["wavy", "nebuly", "indented"] as Line[]);
      if (part === "chevronny") field.count = 6;
      if (part === "chequy" && g.chance(0.3)) field.count = g.rng.pick([5, 7, 8]);
      a = { kind: "simple", field };
      const r = g.rng.next();
      if (r < 0.32) {
        a.chief = { tincture: g.over([t0, t1]) };
        if (g.chance(0.4)) a.chief.charges = g.group(g.pickCharge("chief", true), g.rng.pick([1, 3]), g.over([a.chief.tincture]), [a.chief.tincture], undefined, "chief");
      } else if (r < 0.45) {
        a.canton = { tincture: g.over([t0, t1], { furs: g.chance(0.4) }) };
      } else if (r < 0.6) {
        a.ordinary = { kind: g.rng.pick(["bend", "fess", "chevron"] as OrdinaryKind[]), tincture: g.over([t0, t1], { furs: g.chance(0.2) }) };
      } else if (r < 0.72) {
        a.bordure = { tincture: g.over([t0, t1]) };
      }
      break;
    }
    case "semy": {
      const t0 = g.pickTint(() => true, false);
      const st0 = g.over([t0]);
      a = { kind: "simple", field: { partition: "plain", tinctures: [t0] }, semy: { charge: g.pickCharge("semy", false), tincture: st0 } };
      if (g.chance(0.65)) {
        const id = g.pickCharge("principal", true);
        a.charges = g.group(id, 1, st0, [t0]);
        if (id === a.semy!.charge) a.semy!.charge = "fleurDeLis" === id ? "crossCrosslet" : "fleurDeLis";
      }
      additions(g, a, true);
      break;
    }
    default: {
      // charges on a plain field
      const id = g.pickCharge("principal", true);
      const n = g.pickCount(id, "principal");
      const t0 = g.pickTint((t) => !(isFur(t) && CHARGES[id].category === "beast" && n > 1 && t === "vair"), g.chance(0.5));
      a = { kind: "simple", field: { partition: "plain", tinctures: [t0] } };
      a.charges = g.group(id, n, g.over([t0]), [t0]);
      if (n === 1 && g.chance(0.1 + g.cx * 0.22)) {
        const sid = g.pickCharge("minor", false);
        const sn = g.rng.weighted([[3, 40], [8, 30], [4, 12], [2, 10], [6, 8]] as [number, number][]);
        const same = g.chance(0.55);
        a.secondary = g.group(sid, sn, same ? a.charges.tincture : g.over([t0]), [t0], sn >= 6 ? "orle" : undefined, "minor");
        if (sid === id) a.secondary.charge = "crossCrosslet";
      }
      additions(g, a, !!a.secondary);
      break;
    }
  }
  // A rare, deliberate breach of the rule of tincture (flagged).
  if (g.chance(st.exceptions ?? 0.012)) breakRule(g, a);
  if (!a.exception) repairTincture(g, a);
  return a;
}

/** Tincture for an uncounterchanged charge over a divided field: a colour against the metal half, or a fur. */
function pickOverDivision(g: Gen, tints: Tint[]): Tint {
  const metals = tints.filter((t) => isMetal(t));
  const colours = tints.filter((t) => !isMetal(t) && !isFur(t));
  if (metals.length && colours.length) {
    if (g.chance(0.12)) return g.pickTint((t) => isFur(t) && !tints.includes(t) && readable(t, colours[0]), true);
    return g.pickTint((t) => !isMetal(t) && !isFur(t) && !tints.includes(t), false);
  }
  if (!metals.length) return g.pickTint((t) => isMetal(t) && !tints.includes(t), false);
  return g.pickTint((t) => !isMetal(t) && !isFur(t), false);
}

function breakRule(g: Gen, a: SimpleArms): void {
  if (a.field.partition !== "plain" || isFur(a.field.tinctures[0])) return;
  const t0 = a.field.tinctures[0];
  const same = (t: Tint) => !isFur(t) && isMetal(t) === isMetal(t0) && t !== t0;
  const target = a.ordinary ?? a.charges;
  if (!target || ("counterchanged" in target && target.counterchanged)) return;
  const nt = g.pickTint(same, false);
  if (!same(nt)) return;
  if (a.ordinary && target === a.ordinary) {
    a.ordinary.tincture = nt;
    if (a.charges && a.charges.tincture === nt) a.charges.tincture = nt;
  } else if (a.charges) a.charges.tincture = nt;
  a.exception = isMetal(t0) ? "metal on metal (arms of enquiry)" : "colour on colour";
}

// ---------------------------------------------------------------------------
// The rule of tincture

export interface TinctureViolation {
  /** What lies on what, e.g. "ordinary on field". */
  where: string;
  over: Tint;
  under: Tint;
}

/** List breaches of the rule of tincture (charges over divided fields and counterchanged items are exempt). */
export function checkTincture(arms: Arms): TinctureViolation[] {
  const out: TinctureViolation[] = [];
  const walk = (a: Arms) => {
    if (a.kind === "marshalled") {
      a.coats.forEach(walk);
      if (a.escutcheon) walk(a.escutcheon);
      return;
    }
    const plain = a.field.partition === "plain" ? a.field.tinctures[0] : undefined;
    const chk = (where: string, over: Tint | undefined, under: Tint | undefined, exempt = false) => {
      if (!over || !under || exempt) return;
      if (!tinctureOk(over, under)) out.push({ where, over, under });
    };
    chk("semy on field", a.semy?.tincture, plain);
    chk("ordinary on field", a.ordinary?.tincture, plain, a.ordinary?.counterchanged);
    chk("charges on field", a.charges?.tincture, plain, a.charges?.counterchanged);
    chk("secondary charges on field", a.secondary?.tincture, plain, a.secondary?.counterchanged);
    chk("charges on ordinary", a.ordinary?.charges?.tincture, a.ordinary?.counterchanged ? undefined : a.ordinary?.tincture);
    chk("chief on field", a.chief?.tincture, plain);
    chk("charges on chief", a.chief?.charges?.tincture, a.chief?.tincture);
    chk("bordure on field", a.bordure?.tincture, plain);
    chk("charges on bordure", a.bordure?.charges?.tincture, a.bordure?.tincture);
    chk("canton on field", a.canton?.tincture, plain);
    chk("charge on canton", a.canton?.charge?.tincture, a.canton?.tincture);
    if (a.semy && a.charges) chk("charges on semy field", a.charges.tincture, plain);
  };
  walk(arms);
  return out;
}

/** Fix any accidental breaches by re-tincturing the offending element. */
function repairTincture(g: Gen, a: SimpleArms): void {
  for (let pass = 0; pass < 3; pass++) {
    const v = checkTincture(a);
    if (!v.length) return;
    for (const x of v) {
      const fix = g.over([x.under]);
      switch (x.where) {
        case "semy on field": a.semy!.tincture = fix; break;
        case "ordinary on field": a.ordinary!.tincture = fix; break;
        case "charges on field": case "charges on semy field": a.charges!.tincture = fix; break;
        case "secondary charges on field": a.secondary!.tincture = fix; break;
        case "charges on ordinary": a.ordinary!.charges!.tincture = fix; break;
        case "chief on field": a.chief!.tincture = fix; break;
        case "charges on chief": a.chief!.charges!.tincture = fix; break;
        case "bordure on field": a.bordure!.tincture = fix; break;
        case "charges on bordure": a.bordure!.charges!.tincture = fix; break;
        case "canton on field": a.canton!.tincture = fix; break;
        case "charge on canton": a.canton!.charge!.tincture = fix; break;
      }
    }
  }
}

export { FUR_PARTS };
