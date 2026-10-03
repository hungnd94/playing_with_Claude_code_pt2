/**
 * Builders for structured rich text (src/narrative/types.ts): links, years,
 * native names, sentences and paragraphs, plus a tidy pass (merge strings,
 * fix spacing and punctuation) and plain-text rendering.
 */
import type { WName } from "../history/types";
import type { Block, EntityKind, Inline, Ref, Rich } from "./types";
import { capitalize } from "./text";

/** Anything that can be spliced into rich text; falsy parts are dropped. */
export type Part = Inline | Rich | null | undefined | false | "";

export const ref = (kind: EntityKind, id: number): Ref => ({ kind, id });
export const link = (kind: EntityKind, id: number, text: string): Inline => ({ t: "link", ref: { kind, id }, text });
export const yr = (year: number, text?: string): Inline => (text === undefined ? { t: "year", year } : { t: "year", year, text });
export const em = (text: string): Inline => ({ t: "em", text });
export const strong = (text: string): Inline => ({ t: "strong", text });
export const nat = (name: WName): Inline => ({ t: "native", name });

/** Flatten parts into a Rich (no capitalisation, no punctuation). */
export function R(...parts: Part[]): Rich {
  const out: Inline[] = [];
  const push = (p: Part): void => {
    if (!p) return;
    if (Array.isArray(p)) {
      for (const q of p) push(q);
      return;
    }
    out.push(p as Inline);
  };
  for (const p of parts) push(p);
  return out;
}

/** Text shown for an inline. */
export function inlineText(i: Inline): string {
  if (typeof i === "string") return i;
  switch (i.t) {
    case "link":
    case "em":
    case "strong":
      return i.text;
    case "native":
      return i.name.roman;
    case "year":
      return i.text ?? String(i.year);
  }
}

/** Plain text of rich content. */
export function plain(r: Rich): string {
  return r.map(inlineText).join("");
}

/** Capitalise the first visible letter. */
export function capFirst(r: Rich): Rich {
  if (!r.length) return r;
  const out = r.slice();
  for (let k = 0; k < out.length; k++) {
    const i = out[k];
    if (typeof i === "string") {
      if (!i.trim()) continue;
      const m = /^(\s*)(.)/.exec(i);
      if (!m) continue;
      out[k] = m[1] + m[2].toUpperCase() + i.slice(m[0].length);
      return out;
    }
    if (i.t === "link" || i.t === "em" || i.t === "strong") {
      out[k] = { ...i, text: capitalize(i.text) };
      return out;
    }
    return out;
  }
  return out;
}

/** Merge adjacent strings and repair spacing/punctuation. */
export function tidy(r: Rich): Rich {
  const out: Inline[] = [];
  for (const i of r) {
    if (typeof i === "string") {
      if (!i) continue;
      const last = out[out.length - 1];
      if (typeof last === "string") out[out.length - 1] = last + i;
      else out.push(i);
    } else out.push(i);
  }
  for (let k = 0; k < out.length; k++) {
    const i = out[k];
    if (typeof i !== "string") continue;
    let s = i.replace(/ {2,}/g, " ").replace(/ ([,.;:!?])/g, "$1").replace(/\.\.+/g, ".").replace(/,\./g, ".").replace(/,,/g, ",").replace(/\( /g, "(").replace(/ \)/g, ")");
    // A string following a link that ends a sentence etc. needs no fix; a leading space after "(" is handled above.
    if (k === 0) s = s.replace(/^\s+/, "");
    if (k === out.length - 1) s = s.replace(/\s+$/, "");
    out[k] = s;
  }
  // Punctuation right after a non-string inline: drop a space between them (", ." cases).
  for (let k = 1; k < out.length; k++) {
    const i = out[k];
    if (typeof i === "string" && /^ [,.;:]/.test(i)) out[k] = i.slice(1);
  }
  return out.filter((i) => i !== "");
}

/** A sentence: flatten, capitalise, end with a full stop (unless it already ends with punctuation). */
export function sentence(...parts: Part[]): Rich {
  let r = tidy(R(...parts));
  if (!r.length) return r;
  r = capFirst(r);
  const last = r[r.length - 1];
  const lastText = inlineText(last);
  if (!/[.!?…]["')’]?$/.test(lastText)) {
    if (typeof last === "string") r[r.length - 1] = last.replace(/[,;:\s]+$/, "") + ".";
    else r.push(".");
  }
  return r;
}

/** Join several sentences (Rich) into one Rich with single spaces. */
export function sentences(list: (Rich | null | undefined | false)[]): Rich {
  const out: Inline[] = [];
  for (const s of list) {
    if (!s || !s.length) continue;
    if (out.length) out.push(" ");
    out.push(...s);
  }
  return tidy(out);
}

/** Join rich items: "A", "A and B", "A, B and C". */
export function joinR(items: Rich[], conj = "and"): Rich {
  const xs = items.filter((x) => x && x.length);
  if (!xs.length) return [];
  if (xs.length === 1) return xs[0];
  const out: Inline[] = [];
  xs.forEach((x, i) => {
    if (i > 0) out.push(i === xs.length - 1 ? ` ${conj} ` : ", ");
    out.push(...x);
  });
  return out;
}

/** A paragraph block from sentences; empty input → null. */
export function para(list: (Rich | null | undefined | false)[], dropCap = false): Block | null {
  const content = sentences(list);
  if (!content.length) return null;
  return dropCap ? { t: "p", content, dropCap: true } : { t: "p", content };
}

export const h2 = (text: string): Block => ({ t: "h", level: 2, text });
export const h3 = (text: string): Block => ({ t: "h", level: 3, text });

/** Drop nulls from a block list. */
export function blocks(list: (Block | null | undefined | false)[]): Block[] {
  return list.filter((b): b is Block => !!b);
}

/** Plain-text (Markdown-ish) rendering of blocks, for tools and tests. */
export function blocksToText(bs: Block[]): string {
  const out: string[] = [];
  for (const b of bs) {
    switch (b.t) {
      case "p":
        out.push(plain(b.content));
        break;
      case "h":
        out.push(`${"#".repeat(b.level)} ${b.text}`);
        break;
      case "utterance":
        out.push(`> ${b.utterance.text}\n> ${b.utterance.gloss}\n> '${b.utterance.translation}'${b.attribution ? `\n> — ${plain(b.attribution)}` : ""}`);
        break;
      case "quote":
        out.push(b.content.map((c) => "> " + plain(c)).join("\n>\n") + (b.attribution ? `\n> — ${plain(b.attribution)}` : ""));
        break;
      case "list":
        out.push(b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : "-"} ${plain(it)}`).join("\n"));
        break;
      case "table":
        out.push(
          (b.caption ? `Table: ${b.caption}\n` : "") +
            `| ${b.head.join(" | ")} |\n|${b.head.map(() => "---").join("|")}|\n` +
            b.rows.map((r) => `| ${r.map(plain).join(" | ")} |`).join("\n"),
        );
        break;
      case "figure": {
        const f = b.figure;
        const what =
          f.kind === "map" ? `map of ${f.focus.kind} ${f.focus.id} in ${f.year}` :
          f.kind === "chart" ? `chart: ${f.yLabel} (${f.series.map((s) => `${s.label}, ${s.years.length} points`).join("; ")})` :
          f.kind === "tree" ? `tree (${f.relation}) of ${f.root.kind} ${f.root.id}` :
          f.kind === "script" ? `script ${f.script}${f.word ? ` word /${f.word.join("")}/` : " chart"}` :
          f.kind === "phonemes" ? `phoneme chart of language ${f.language}` :
          f.kind === "cognates" ? `cognate table: ${f.concepts.length} concepts × ${f.languages.length} languages` :
          `emblem (${f.emblem.kind}): ${f.emblem.blazon}`;
        out.push(`[Figure: ${what}]${b.caption ? ` ${plain(b.caption)}` : ""}`);
        break;
      }
    }
  }
  return out.join("\n\n");
}
