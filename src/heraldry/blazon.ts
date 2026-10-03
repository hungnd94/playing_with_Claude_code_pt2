/**
 * Blazon: the formal English description of arms.
 *
 * Follows the usual conventions of English armory:
 *  - order: field, principal ordinary and/or charges, then chief, canton, bordure,
 *    then marks of difference;
 *  - a tincture shared by consecutive items is named once, after the last of them
 *    ("Gules, a chevron between three crosses patty Argent");
 *  - "on a …" for charged ordinaries, "as many" when a count repeats;
 *  - number words, attitudes after the noun, lines of partition after the ordinary;
 *  - roundels named by tincture (bezant, plate, torteau, hurt, pomme, pellet, golpe…);
 *  - semé terms (semy-de-lis, crusily, billetty, goutty);
 *  - marshalled coats as "Quarterly, 1 and 4 …; 2 and 3 …" and "… impaling …".
 */
import type { Arms, ChargeGroup, Difference, Field, Line, MarshalledArms, Ordinary, SimpleArms, Tint } from "./types";
import { chargeDef } from "./charges/index";
import { TINT_NAMES } from "./tinctures";
import { autoRows } from "./layout";
import { chargeArt } from "./charges/index";

export interface BlazonOptions {
  /** Use "of the field" for a charge on an ordinary or chief that matches a plain field. Default false. */
  ofTheField?: boolean;
  /** Use "of the first", "of the second" … for repeated tinctures. Default false. */
  ordinals?: boolean;
}

const NUM = ["no", "a", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function numberWord(n: number): string {
  return n < NUMW.length ? NUMW[n] : String(n);
}

export function article(word: string): string {
  const w = word.toLowerCase();
  if (/^(one|uni|eu|ewe|use)/.test(w)) return "a";
  if (/^(hour|heir|honour)/.test(w)) return "an";
  return /^[aeiou]/.test(w) ? "an" : "a";
}

const LINE_WORD: Record<Line, string> = {
  straight: "",
  wavy: "wavy",
  indented: "indented",
  dancetty: "dancetty",
  embattled: "embattled",
  engrailed: "engrailed",
  invected: "invected",
  nebuly: "nebuly",
  raguly: "raguly",
  dovetailed: "dovetailed",
};

function lineWord(l?: Line): string {
  return l ? LINE_WORD[l] : "";
}

const ROUNDEL_NAMES: Partial<Record<Tint, [string, string]>> = {
  or: ["bezant", "bezants"],
  argent: ["plate", "plates"],
  gules: ["torteau", "torteaux"],
  azure: ["hurt", "hurts"],
  vert: ["pomme", "pommes"],
  sable: ["pellet", "pellets"],
  purpure: ["golpe", "golpes"],
  tenne: ["orange", "oranges"],
  sanguine: ["guze", "guzes"],
};

const ATTITUDE_WORD: Record<string, string> = { rising: "rousant" };

/** Tracks tinctures already named, for "of the first" / "of the field". */
class Namer {
  named: Tint[] = [];
  constructor(private opts: BlazonOptions, private plainField?: Tint) {}
  name(t: Tint, onOrdinary = false): string {
    if (this.opts.ofTheField && onOrdinary && this.plainField === t) return "of the field";
    if (this.opts.ordinals) {
      const i = this.named.indexOf(t);
      if (i >= 0 && i < 6) return `of the ${["first", "second", "third", "fourth", "fifth", "sixth"][i]}`;
    }
    if (!this.named.includes(t)) this.named.push(t);
    return TINT_NAMES[t];
  }
  /** Record a tincture as named without producing text. */
  note(t: Tint): void {
    if (!this.named.includes(t)) this.named.push(t);
  }
}

// ---------------------------------------------------------------------------
// Field

const PARTITION_WORD: Record<string, string> = {
  perPale: "Per pale",
  perFess: "Per fess",
  perBend: "Per bend",
  perBendSinister: "Per bend sinister",
  perChevron: "Per chevron",
  perSaltire: "Per saltire",
  quarterly: "Quarterly",
  gyronny: "Gyronny",
  perPall: "Per pall",
  tiercedInPale: "Tierced in pale",
  tiercedInFess: "Tierced in fess",
  paly: "Paly",
  barry: "Barry",
  bendy: "Bendy",
  bendySinister: "Bendy sinister",
  chequy: "Chequy",
  lozengy: "Lozengy",
  chevronny: "Chevronny",
};

function listAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function blazonField(f: Field, nm: Namer): string {
  if (f.partition === "plain") return nm.name(f.tinctures[0]);
  const word = PARTITION_WORD[f.partition];
  const line = lineWord(f.line);
  const tints = listAnd(f.tinctures.map((t) => nm.name(t)));
  if (f.partition === "paly" || f.partition === "barry" || f.partition === "bendy" || f.partition === "bendySinister" || f.partition === "chevronny") {
    const n = f.count ?? 6;
    return `${word}${line ? " " + line : ""} of ${numberWord(n)} ${tints}`;
  }
  if (f.partition === "gyronny") {
    const n = f.count ?? 8;
    return `${word}${n !== 8 ? ` of ${numberWord(n)}` : " of eight"} ${tints}`;
  }
  return `${word}${line ? " " + line : ""} ${tints}`;
}

const SEMY_TERMS: Partial<Record<string, string>> = {
  fleurDeLis: "semy-de-lis",
  crossCrosslet: "crusily",
  billet: "billetty",
  goutte: "goutty",
  roundel: "semy of roundels",
  mullet: "semy of mullets",
  star: "semy of estoiles",
};

// ---------------------------------------------------------------------------
// Charges

interface ChargeText {
  /** e.g. "three lions passant in pale" (no tincture). */
  noun: string;
  /** Tincture phrase to follow, e.g. "Or" (may be "" for roundels named by tincture). */
  tint: Tint | null;
  /** Things that must come after the tincture: "armed and langued Azure". */
  after: string;
  counter?: boolean;
}

export function resolvedRows(g: ChargeGroup): number[] {
  const { box } = chargeArt(g.charge, { attitude: g.attitude, points: g.points, pierced: g.pierced });
  return autoRows(g.count, (box.x1 - box.x0) / (box.y1 - box.y0));
}

function arrangementPhrase(g: ChargeGroup, onOrdinary: boolean): string {
  const def = chargeDef(g.charge);
  const arr = g.arrangement ?? "auto";
  const n = g.count;
  if (onOrdinary || n === 1) return "";
  switch (arr) {
    case "pale": return "in pale";
    case "fess": return "in fess";
    case "bend": return "in bend";
    case "bendSinister": return "in bend sinister";
    case "cross": return "in cross";
    case "saltire": return "in saltire";
    case "crossed": return "in saltire";
    case "orle": return "in orle";
    case "chief": return "in chief";
    case "oneTwo": return "one and two";
    case "twoTwo": return n === 4 ? "" : "two and two";
    case "threeTwoOne": return "three, two and one";
    case "twoOne": return "";
    default: break;
  }
  // auto
  if (n === 2) {
    if (def.long) return "in saltire";
    const rows = resolvedRows(g);
    return rows.length === 2 ? "in pale" : "in fess";
  }
  if (n === 5) return "in saltire";
  if (n === 6) return "three, two and one";
  if (n === 7) return "three, three and one";
  if (n >= 8 && n <= 9 && n !== 9) return "in orle";
  if (n === 9) return "three, three and three";
  if (n === 10) return "four, three, two and one";
  return "";
}

function chargeText(g: ChargeGroup, nm: Namer, onOrdinary: boolean, under?: Tint): ChargeText {
  const def = chargeDef(g.charge);
  const n = g.count;
  let noun: string;
  let tint: Tint | null = g.tincture;
  if (g.charge === "roundel" && !g.counterchanged && ROUNDEL_NAMES[g.tincture]) {
    const [one, many] = ROUNDEL_NAMES[g.tincture]!;
    noun = n === 1 ? `${article(one)} ${one}` : `${numberWord(n)} ${many}`;
    tint = null;
    nm.note(g.tincture);
  } else {
    let base = n === 1 ? def.name : def.plural;
    // attitude follows the noun ("lions passant"), unless implied by the name or customarily omitted
    if (def.attitudes) {
      const a = g.attitude && def.attitudes.includes(g.attitude) ? g.attitude : def.attitudes[0];
      const word = ATTITUDE_WORD[a] ?? a;
      const omit = def.name.endsWith(word) || (a === "close" && g.charge === "raven");
      if (!omit) base += " " + word;
    }
    if ((g.charge === "mullet" && g.points && g.points !== 5) || (g.charge === "star" && g.points && g.points !== 6)) {
      base += ` of ${numberWord(g.points)} points`;
    }
    if (g.pierced) base += " pierced";
    if (g.reversed && !def.symmetric) base += " contourné";
    if (g.inverted) base += g.charge === "crescent" ? " reversed" : def.long ? " inverted" : " reversed";
    noun = n === 1 ? `${article(base)} ${base}` : `${numberWord(n)} ${base}`;
  }
  const arr = arrangementPhrase(g, onOrdinary);
  if (arr) noun += " " + arr;
  let after = "";
  if (g.armed && def.armedTerm && g.armed !== g.tincture) after += ` ${def.armedTerm} ${nm.name(g.armed)}`;
  if (g.crowned) after += `${after ? " and" : ""} crowned ${nm.name(g.crowned)}`;
  void under;
  return { noun, tint, after, counter: g.counterchanged };
}

function tintOf(t: ChargeText, nm: Namer, onOrdinary = false): string {
  if (t.counter) return "counterchanged";
  if (t.tint === null) return "";
  return nm.name(t.tint, onOrdinary);
}

function join(...parts: string[]): string {
  return parts.filter((p) => p && p.trim()).join(" ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Ordinaries

const DIMINUTIVE: Partial<Record<string, [string, string]>> = {
  fess: ["bar", "bars"],
  pale: ["pallet", "pallets"],
  bend: ["bendlet", "bendlets"],
  bendSinister: ["bendlet sinister", "bendlets sinister"],
  chevron: ["chevronel", "chevronels"],
  chevronReversed: ["chevronel reversed", "chevronels reversed"],
  pile: ["pile", "piles"],
};

const ORD_NAME: Record<string, string> = {
  fess: "fess",
  pale: "pale",
  bend: "bend",
  bendSinister: "bend sinister",
  chevron: "chevron",
  chevronReversed: "chevron reversed",
  cross: "cross",
  saltire: "saltire",
  pall: "pall",
  pallReversed: "pall reversed",
  pile: "pile",
  orle: "orle",
  fret: "fret",
  base: "base",
};

function ordinaryNoun(o: Ordinary): string {
  const n = Math.max(1, o.count ?? 1);
  let base: string;
  if (n > 1 && DIMINUTIVE[o.kind]) {
    const [, many] = DIMINUTIVE[o.kind]!;
    base = `${numberWord(n)} ${many}`;
  } else {
    const nm = ORD_NAME[o.kind];
    base = `${article(nm)} ${nm}`;
  }
  // line goes after the noun; for "bend sinister" etc. after the whole noun
  const lw = lineWord(o.line);
  if (lw) base += " " + lw;
  if (o.cotised) base += " cotised";
  return base;
}

// ---------------------------------------------------------------------------

/**
 * One clause of a blazon: text, then (optionally) a trailing tincture, then
 * whatever must follow the tincture ("armed and langued Azure", "charged with…").
 * Consecutive pieces that share their trailing tincture are merged, as heralds
 * do: "Argent, a fess and a canton Gules"; "Sable, three piles within a bordure
 * Or"; "Azure crusily and a lion rampant Or".
 */
interface Piece {
  role: "semy" | "main" | "chief" | "canton" | "bordure" | "diff";
  text: string;
  tint: Tint | null;
  after: string;
  /** Can absorb a following piece of the same tincture with "and". */
  openAnd: boolean;
  /** Can absorb a following bordure of the same tincture with "within". */
  openWithin: boolean;
  /** Can itself be absorbed into the preceding piece. */
  mergeIn: boolean;
  /** Number of distinct groups of charges/ordinaries this piece names (for "all within"). */
  weight: number;
}

function piece(role: Piece["role"], text: string, tint: Tint | null, after = "", o: Partial<Piece> = {}): Piece {
  const simple = !after && tint !== null;
  return { role, text, tint, after, openAnd: simple, openWithin: simple, mergeIn: tint !== null, weight: 1, ...o };
}

function mainPieces(a: SimpleArms, nm: Namer): Piece[] {
  const o = a.ordinary;
  if (o) {
    const oNoun = ordinaryNoun(o);
    const counterO = !!o.counterchanged;
    if (a.charges) {
      // Charges set about an ordinary take their places from it: no "in pale", "three, two and one".
      const between = chargeText(a.charges, nm, true);
      const sameTint = !counterO && !between.counter && between.tint === o.tincture && !between.after;
      if (o.charges) {
        // "on a chevron Or between three mullets Argent three roundels Gules"
        const onT = chargeText(o.charges, nm, true);
        const onNoun = o.charges.count === a.charges.count && o.charges.count > 1 ? onT.noun.replace(/^\w+/, "as many") : onT.noun;
        const head = sameTint
          ? join(`on ${oNoun}`, "between", between.noun, nm.name(o.tincture))
          : join(`on ${oNoun}`, counterO ? "counterchanged" : nm.name(o.tincture), "between", between.noun, tintOf(between, nm), between.after);
        const t = onT.counter ? null : onT.tint;
        return [piece("main", join(head, onNoun, onT.counter ? "counterchanged" : ""), t, onT.after, { openAnd: false, openWithin: !onT.after && t !== null, mergeIn: false, weight: 3 })];
      }
      if (o.kind === "orle" && !counterO && !between.counter) {
        // A charge inside an orle: "a martlet Argent within an orle Or".
        const head = join(between.noun, sameTint ? "" : tintOf(between, nm), between.after, "within", oNoun);
        return [piece("main", head, o.tincture, "", { openAnd: false, weight: 2, mergeIn: sameTint })];
      }
      if (sameTint) return [piece("main", join(oNoun, "between", between.noun), o.tincture, "", { openAnd: false, weight: 2 })];
      const head = join(oNoun, counterO ? "counterchanged" : nm.name(o.tincture), "between", between.noun);
      if (between.counter) return [piece("main", join(head, "counterchanged"), null, "", { weight: 2, mergeIn: false })];
      return [piece("main", head, between.tint, between.after, { openAnd: false, openWithin: !between.after && between.tint !== null, mergeIn: false, weight: 2 })];
    }
    if (o.charges) {
      const onT = chargeText(o.charges, nm, true);
      const head = join(`on ${oNoun}`, counterO ? "counterchanged" : nm.name(o.tincture), onT.noun);
      if (onT.counter) return [piece("main", join(head, "counterchanged"), null, "", { mergeIn: false, weight: 2 })];
      return [piece("main", head, onT.tint, onT.after, { openAnd: false, openWithin: !onT.after && onT.tint !== null, mergeIn: false, weight: 2 })];
    }
    if (counterO) return [piece("main", join(oNoun, "counterchanged"), null)];
    return [piece("main", oNoun, o.tincture)];
  }
  if (a.charges) {
    const p = chargeText(a.charges, nm, false);
    if (a.secondary) {
      // Secondaries take their places from the principal charge: no arrangement words.
      const sx = chargeText(a.secondary, nm, true);
      const orle = a.secondary.arrangement === "orle" || a.secondary.count >= 6;
      const sNoun = orle ? `an orle of ${sx.noun.replace(/ in orle$/, "")}` : sx.noun;
      const link = orle ? "within" : "between";
      const same = !p.counter && !sx.counter && p.tint !== null && p.tint === sx.tint && !p.after;
      const head = same ? join(p.noun, link, sNoun) : join(p.noun, tintOf(p, nm), p.after, link, sNoun);
      if (sx.counter) return [piece("main", join(head, "counterchanged"), null, "", { weight: 2, mergeIn: false })];
      return [piece("main", head, sx.tint, sx.after, { openAnd: false, openWithin: !sx.after && sx.tint !== null, mergeIn: same, weight: 2 })];
    }
    if (p.counter) return [piece("main", join(p.noun, "counterchanged"), null)];
    // Roundels named by tincture ("three bezants") carry no tincture word.
    return [piece("main", p.noun, p.tint, p.after, p.tint === null ? { openAnd: false, openWithin: false, mergeIn: false } : {})];
  }
  return [];
}

function blazonSimple(a: SimpleArms, opts: BlazonOptions): string {
  const plain = a.field.partition === "plain" ? a.field.tinctures[0] : undefined;
  const nm = new Namer(opts, plain);
  const field = blazonField(a.field, nm);
  const pieces: Piece[] = [];
  if (a.semy) {
    const term = SEMY_TERMS[a.semy.charge] ?? `semy of ${chargeDef(a.semy.charge).plural}`;
    pieces.push(piece("semy", term, a.semy.tincture, "", { openWithin: false }));
  }
  pieces.push(...mainPieces(a, nm));
  if (a.chief) {
    const c = a.chief;
    const cn = join("a chief", lineWord(c.line));
    if (c.charges) {
      const t = chargeText(c.charges, nm, true);
      const head = join(`on ${cn}`, nm.name(c.tincture), t.noun);
      pieces.push(t.counter ? piece("chief", join(head, "counterchanged"), null) : piece("chief", head, t.tint, t.after, { openAnd: false, mergeIn: false }));
    } else pieces.push(piece("chief", cn, c.tincture));
  }
  if (a.canton) {
    const c = a.canton;
    const cn = c.sinister ? "a canton sinister" : "a canton";
    if (c.charge) {
      const t = chargeText(c.charge, nm, true);
      pieces.push(piece("canton", join(`on ${cn}`, nm.name(c.tincture), t.noun), t.tint, t.after, { openAnd: false, mergeIn: false }));
    } else pieces.push(piece("canton", cn, c.tincture));
  }
  if (a.bordure) {
    const b = a.bordure;
    const bn = join("a bordure", lineWord(b.line));
    if (b.compony) {
      pieces.push(piece("bordure", join(bn, "compony", nm.name(b.tincture), "and", nm.name(b.compony)), null, "", { mergeIn: false }));
    } else if (b.charges) {
      const t = chargeText(b.charges, nm, true);
      pieces.push(piece("bordure", bn, b.tincture, join("charged with", t.noun, tintOf(t, nm, true), t.after)));
    } else pieces.push(piece("bordure", bn, b.tincture));
  }
  for (const d of a.difference ?? []) pieces.push(piece("diff", differenceText(d, nm), null, "", { mergeIn: false, openAnd: false, openWithin: false }));
  return assemble(field, pieces, nm);
}

/** Merge pieces sharing a tincture and join everything into one blazon. */
function assemble(field: string, pieces: Piece[], nm: Namer): string {
  interface Group { text: string; tint: Tint | null; after: string; openAnd: boolean; openWithin: boolean; first: Piece }
  const groups: Group[] = [];
  let weightBefore = 0;
  for (const p of pieces) {
    const g = groups[groups.length - 1];
    const within = p.role === "bordure" && weightBefore > 0 ? (weightBefore > 1 ? "all within" : "within") : "";
    const canMerge =
      g && p.mergeIn && g.tint !== null && g.tint === p.tint && !g.after && p.role !== "diff" &&
      (p.role === "bordure" ? g.openWithin : g.openAnd && g.first.role !== "diff");
    if (canMerge) {
      g.text = join(g.text, p.role === "bordure" ? within : "and", p.text);
      g.after = p.after;
      g.openAnd = p.openAnd && g.first.role !== "semy" ? g.openAnd && p.openAnd : false;
      g.openWithin = p.openWithin;
    } else {
      groups.push({ text: within ? join(within, p.text) : p.text, tint: p.tint, after: p.after, openAnd: p.openAnd, openWithin: p.openWithin, first: p });
    }
    weightBefore += p.role === "semy" || p.role === "diff" ? 0 : p.weight;
  }
  let s = field;
  groups.forEach((g, i) => {
    const text = join(g.text, g.tint !== null ? nm.name(g.tint) : "", g.after);
    // The semé belongs to the field ("Azure semy-de-lis Or"); bordures attach with "within".
    const attach = g.first.role === "semy" || /^(all )?within\b/.test(g.text) ? " " : ", ";
    s += attach + text;
  });
  return s;
}

function differenceText(d: Difference, nm: Namer): string {
  if (d.mark === "label") return join(`a label of ${numberWord(d.points ?? 3)} points`, nm.name(d.tincture));
  if (d.mark === "bendlet") return join("over all a bendlet", nm.name(d.tincture));
  const names: Record<string, string> = {
    crescent: "crescent", mullet: "mullet", martlet: "martlet", annulet: "annulet", fleurDeLis: "fleur-de-lis",
    rose: "rose", crossMoline: "cross moline", quatrefoil: "quatrefoil",
  };
  const n = names[d.mark];
  return join(`${article(n)} ${n}`, nm.name(d.tincture), "for difference");
}

// ---------------------------------------------------------------------------

const ROMAN = ["", "i", "ii", "iii", "iv"];

function sameCoat(a: Arms, b: Arms): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function blazonMarshalled(m: MarshalledArms, opts: BlazonOptions, depth: number): string {
  const sub = (a: Arms) => blazonArms(a, opts, depth + 1);
  const num = (i: number) => (depth > 0 ? ROMAN[i] : String(i));
  let s: string;
  if (m.method === "quarterly") {
    const [q1, q2, q3, q4] = [m.coats[0], m.coats[1] ?? m.coats[0], m.coats[2] ?? m.coats[1] ?? m.coats[0], m.coats[3] ?? m.coats[0]];
    const groups: string[] = [];
    if (sameCoat(q1, q4) && sameCoat(q2, q3)) {
      groups.push(`${num(1)} and ${num(4)} ${sub(q1)}`, `${num(2)} and ${num(3)} ${sub(q2)}`);
    } else if (sameCoat(q1, q4)) {
      groups.push(`${num(1)} and ${num(4)} ${sub(q1)}`, `${num(2)} ${sub(q2)}`, `${num(3)} ${sub(q3)}`);
    } else if (sameCoat(q2, q3)) {
      groups.push(`${num(1)} ${sub(q1)}`, `${num(2)} and ${num(3)} ${sub(q2)}`, `${num(4)} ${sub(q4)}`);
    } else {
      groups.push(`${num(1)} ${sub(q1)}`, `${num(2)} ${sub(q2)}`, `${num(3)} ${sub(q3)}`, `${num(4)} ${sub(q4)}`);
    }
    s = `${depth > 0 ? "quarterly" : "Quarterly"}, ${groups.join("; ")}`;
  } else if (m.method === "single") {
    s = sub(m.coats[0]);
  } else if (m.method === "impaled") {
    s = `${sub(m.coats[0])}; impaling ${sub(m.coats[1] ?? m.coats[0])}`;
  } else {
    s = `${depth > 0 ? "per fess" : "Per fess"}, in chief ${sub(m.coats[0])}; in base ${sub(m.coats[1] ?? m.coats[0])}`;
  }
  if (m.escutcheon) {
    const e = m.escutcheon;
    const full = sub(e);
    const field = e.kind === "simple" ? blazonField(e.field, new Namer({})) : "";
    const rest = field && full.startsWith(field) ? full.slice(field.length).replace(/^,\s*/, "") : "";
    if (e.kind === "simple" && !rest) s += `; over all an escutcheon ${field}`;
    else if (e.kind === "simple" && e.field.partition === "plain" && !rest.includes(",") && !/^on /.test(rest)) {
      // "over all on an escutcheon Or three mullets Gules"
      s += `; over all on an escutcheon ${field} ${rest}`;
    } else s += `; over all an escutcheon of pretence bearing ${full}`;
  }
  if (m.difference?.length) {
    const nm = new Namer(opts);
    s += "; over all " + m.difference.map((d) => differenceText(d, nm)).join(", ");
  }
  return s;
}

function blazonArms(a: Arms, opts: BlazonOptions, depth: number): string {
  if (a.kind === "marshalled") return blazonMarshalled(a, opts, depth);
  return blazonSimple(a, opts);
}

/** The blazon of a coat of arms, in English. */
export function blazon(arms: Arms, opts: BlazonOptions = {}): string {
  const s = blazonArms(arms, opts, 0);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { NUM };
