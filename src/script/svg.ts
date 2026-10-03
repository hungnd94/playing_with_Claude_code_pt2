/**
 * SVG output: words, single glyphs, script charts, glyph-evolution tables and
 * family trees. Pure string building — usable in the worker, Node, or the UI.
 *
 * No <defs> are used unless `ink` texture is requested; then ids are made
 * unique with `idPrefix` (or an internal counter), so many SVGs can share a page.
 */
import type { Glyph, Script, Stroke } from "./types";
import { layoutWord, layoutText, outlineStrokes, transformPath, type LayoutOptions, type WordLayout } from "./layout";
import { formOf, glyphOf, vowelOpsOf } from "./spell";
import { classify, phoneticOrderKey } from "./ipa";
import { strokesBBox, transformStrokes, translate, circle, type Mat } from "./geom";

export interface SvgOptions extends LayoutOptions {
  /** Pixels per em (body height). Default 32. */
  size?: number;
  /** Ink colour. Default "currentColor". */
  color?: string;
  /** Padding around the ink in em. Default 0.15. */
  padding?: number;
  /** Optional background fill. */
  background?: string;
  /** Subtle ink-bleed texture filter (adds a <filter> with a unique id). */
  ink?: boolean;
  idPrefix?: string;
  /** Accessible title. */
  title?: string;
}

const FONT = "'Gentium Book Plus','Gentium Plus','Charis SIL','Noto Serif','DejaVu Serif',serif";

/**
 * Chart colours. Defaults are theme-neutral: ink in `currentColor`, labels
 * and rules in `currentColor` at reduced opacity, so charts sit on light and
 * dark pages alike; pass explicit colours to override.
 */
const fillAttr = (c: string | undefined, op: number): string => (c ? `fill="${c}"` : `fill="currentColor" fill-opacity="${op}"`);
const strokeAttr = (c: string | undefined, op: number): string => (c ? `stroke="${c}"` : `stroke="currentColor" stroke-opacity="${op}"`);
/** Accent for derived glyphs, changed sounds etc.: legible on vellum and on lapis-black. */
const ACCENT = "#b8692f";
const ACCENT2 = "#4f8c99";
let idCounter = 0;
const nextId = (p?: string): string => p ?? `scr${(++idCounter).toString(36)}`;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n1 = (v: number): string => String(Math.round(v * 10) / 10);
const n3 = (v: number): string => String(Math.round(v * 1000) / 1000);
const matStr = (m: Mat): string =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 ? (m[4] || m[5] ? `translate(${n1(m[4])} ${n1(m[5])})` : "") : `matrix(${m.map(n3).join(" ")})`;

function inkFilter(id: string): string {
  return `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter>`;
}

function layoutToSvg(l: WordLayout, opts: SvgOptions): string {
  const size = opts.size ?? 32;
  const pad = (opts.padding ?? 0.15) * 100;
  const color = opts.color ?? "currentColor";
  const x = l.x0 - pad;
  const y = l.y0 - pad;
  const w = l.x1 - l.x0 + 2 * pad;
  const h = l.y1 - l.y0 + 2 * pad;
  const sc = size / 100;
  const fid = opts.ink ? nextId(opts.idPrefix) + "-ink" : "";
  const paths = l.items
    .filter((it) => it.d)
    .map((it) => {
      const t = matStr(it.m);
      return `<path${t ? ` transform="${t}"` : ""} d="${it.d}"/>`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(x)} ${n1(y)} ${n1(w)} ${n1(h)}" width="${n1(w * sc)}" height="${n1(h * sc)}"` +
    ` role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ""}>` +
    (opts.title ? `<title>${esc(opts.title)}</title>` : "") +
    (fid ? `<defs>${inkFilter(fid)}</defs>` : "") +
    (opts.background ? `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="${opts.background}"/>` : "") +
    `<g fill="${color}" fill-rule="nonzero"${fid ? ` filter="url(#${fid})"` : ""}>${paths}</g></svg>`
  );
}

/** A word (IPA phoneme list) written in the script, as a standalone <svg>. */
export function renderWordSVG(script: Script, word: string[], opts: SvgOptions = {}): string {
  return layoutToSvg(layoutWord(script, word, opts), opts);
}

/** Several words with the script's word divider. */
export function renderTextSVG(script: Script, words: string[][], opts: SvgOptions = {}): string {
  return layoutToSvg(layoutText(script, words, opts), opts);
}

/** A written word or phrase as one outline in pixel space (for canvas `Path2D`, or an SVG `<path>`). */
export interface TextOutline {
  /** Absolute path data (M/L/Z), pixels, origin at the top-left of the ink box plus padding. */
  d: string;
  width: number;
  height: number;
  /** Baseline y in pixels (vertical scripts: the middle of the column). */
  baseline: number;
  /** How the outline reads: "ltr", "rtl" or "ttb". */
  direction: Script["direction"];
}

function layoutToOutline(l: WordLayout, opts: SvgOptions): TextOutline {
  const size = opts.size ?? 32;
  const sc = size / 100;
  const pad = (opts.padding ?? 0.1) * 100;
  const ox = l.x0 - pad;
  const oy = l.y0 - pad;
  const d = l.items
    .filter((it) => it.d)
    .map((it) => {
      const m = it.m;
      // pixel = (word - origin) * sc
      const pm: Mat = [m[0] * sc, m[1] * sc, m[2] * sc, m[3] * sc, (m[4] - ox) * sc, (m[5] - oy) * sc];
      return transformPath(it.d, pm);
    })
    .join("");
  return {
    d,
    width: Math.round((l.x1 - l.x0 + 2 * pad) * sc * 10) / 10,
    height: Math.round((l.y1 - l.y0 + 2 * pad) * sc * 10) / 10,
    baseline: Math.round((l.direction === "ttb" ? (l.y0 + l.y1) / 2 - oy : 100 - oy) * sc * 10) / 10,
    direction: l.direction,
  };
}

/**
 * A word as a single pixel-space outline: map labels draw it with
 * `ctx.fill(new Path2D(o.d))` beneath the romanised name. Pass
 * `horizontal: true` to set a vertical script on the label's line.
 */
export function wordOutline(script: Script, word: string[], opts: SvgOptions = {}): TextOutline {
  return layoutToOutline(layoutWord(script, word, opts), opts);
}

/** Several words (a multi-word name) as one outline, with the script's word divider. */
export function textOutline(script: Script, words: string[][], opts: SvgOptions = {}): TextOutline {
  return layoutToOutline(layoutText(script, words, opts), opts);
}

// ---------------------------------------------------------------------------
// Single glyphs and chart cells
// ---------------------------------------------------------------------------

const DOTTED: Stroke[] = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  DOTTED.push({ pts: [[0.25 + Math.cos(a) * 0.22, 0.55 + Math.sin(a) * 0.22]], dot: 0.022 });
}

/** Strokes for displaying a glyph on its own (marks shown on a dotted circle). */
function displayStrokes(script: Script, g: Glyph): { strokes: Stroke[]; base: Stroke[] } {
  if (g.role === "mark") {
    const pos = g.mark ?? "above";
    let st: Stroke[];
    if (pos === "above") st = transformStrokes(g.strokes, translate(0.25, 0.22));
    else if (pos === "below") st = transformStrokes(g.strokes, translate(0.25, 0.86));
    else if (pos === "before") st = transformStrokes(g.strokes, translate(-0.05 - g.w, 0));
    else st = transformStrokes(g.strokes, translate(0.55, 0));
    return { strokes: st, base: DOTTED };
  }
  if (script.style.stemline && g.role !== "final") {
    // Ogham-like letters only make sense on their stem line.
    return { strokes: [{ pts: [[-0.12, 0.5], [g.w + 0.12, 0.5]] }, ...g.strokes], base: [] };
  }
  return { strokes: g.strokes, base: [] };
}

/** Render strokes centred at (cx, cy) px with `em` px per em. */
/** Display scale per family (cursive letters have a small body; show them larger). */
function familyScale(script: Script): number {
  return script.morph.family === "cursive" ? 1.3 : 1;
}

/** Shrink `s` (px per unit) so an ink box fits in fit = [maxW, maxH] px. */
function fitScale(s: number, w: number, h: number, fit?: [number, number]): number {
  if (!fit) return s;
  return Math.min(s, fit[0] / Math.max(1, w), fit[1] / Math.max(1, h));
}

function strokesAt(script: Script, strokes: Stroke[], key: string, cx: number, cy: number, em: number, rotate = false, extra = "", fit?: [number, number]): string {
  if (!strokes.length) return "";
  const o = outlineStrokes(script.style, strokes, key ? `${script.id}|${key}` : "", 3);
  const s = fitScale((em * familyScale(script)) / 100, rotate ? o.y1 - o.y0 : o.x1 - o.x0, rotate ? o.x1 - o.x0 : o.y1 - o.y0, fit);
  const mx = (o.x0 + o.x1) / 2;
  // vertical anchor: centre of the body (0..1 em) rather than ink, so glyphs share a baseline
  const my = rotate ? (o.y0 + o.y1) / 2 : 50 + Math.min(0, (o.y0 + o.y1) / 2 - 50) * 0.6 + Math.max(0, (o.y0 + o.y1) / 2 - 50) * 0.6;
  const t = rotate
    ? `matrix(0 ${n3(-s)} ${n3(s)} 0 ${n1(cx - my * s)} ${n1(cy + mx * s)})`
    : `matrix(${n3(s)} 0 0 ${n3(s)} ${n1(cx - mx * s)} ${n1(cy - my * s)})`;
  return `<path transform="${t}" d="${o.d}"${extra}/>`;
}

function glyphArt(script: Script, g: Glyph, cx: number, cy: number, em: number, color: string, fit?: [number, number]): string {
  const { strokes, base } = displayStrokes(script, g);
  const rot = script.direction === "ttb" && script.style.joins;
  if (base.length) {
    const all = [...base, ...strokes];
    const o = outlineStrokes(script.style, all, `${script.id}|disp${g.id}`, 3);
    const s = fitScale(em / 100, o.x1 - o.x0, o.y1 - o.y0, fit);
    const mx = (o.x0 + o.x1) / 2;
    const my = (o.y0 + o.y1) / 2;
    // draw the dotted circle faint, the mark solid: two paths with the same transform
    const ob = outlineStrokes(script.style, base, `dotted`, 3, 0.6);
    const om = outlineStrokes(script.style, strokes, `${script.id}|dispm${g.id}`, 3);
    const t = `matrix(${n3(s)} 0 0 ${n3(s)} ${n1(cx - mx * s)} ${n1(cy - my * s)})`;
    return `<path transform="${t}" d="${ob.d}" fill="${color}" opacity="0.28"/><path transform="${t}" d="${om.d}" fill="${color}"/>`;
  }
  return strokesAt(script, strokes, `g${g.id}`, cx, cy, em, rot, ` fill="${color}"`, fit);
}

/** One glyph as a standalone <svg>. */
export function renderGlyphSVG(script: Script, glyph: Glyph | number, opts: SvgOptions = {}): string {
  const g = typeof glyph === "number" ? glyphOf(script, glyph) : glyph;
  if (!g) return "";
  const size = opts.size ?? 48;
  const color = opts.color ?? "currentColor";
  const { strokes, base } = displayStrokes(script, g);
  const all = [...base, ...strokes];
  const o = outlineStrokes(script.style, all, `${script.id}|disp${g.id}`, 3);
  const pad = (opts.padding ?? 0.15) * 100;
  const x = Math.min(o.x0, 0) - pad;
  const y = Math.min(o.y0, -10) - pad;
  const w = Math.max(o.x1, g.w * 100) - x + pad;
  const h = Math.max(o.y1, 110) - y + pad;
  const sc = size / 100;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(x)} ${n1(y)} ${n1(w)} ${n1(h)}" width="${n1(w * sc)}" height="${n1(h * sc)}" role="img">` +
    (opts.title ? `<title>${esc(opts.title)}</title>` : "") +
    `<path d="${o.d}" fill="${color}"/></svg>`
  );
}

// ---------------------------------------------------------------------------
// Script chart
// ---------------------------------------------------------------------------

export interface ChartOptions {
  /** Glyph size in px (em). Default 40. */
  size?: number;
  color?: string;
  /** Label colour. */
  labelColor?: string;
  /** Rule / grid colour. */
  ruleColor?: string;
  /** Cells per row for list sections. Default 10. */
  columns?: number;
  /** Section headings (default true). */
  headings?: boolean;
  background?: string;
  /** Grid sections (syllabaries, fused abugidas): cells across before splitting into side-by-side panels. Default 14. */
  gridCells?: number;
  /** Grid sections: rows per panel before splitting. Default 12. */
  gridRows?: number;
  /** Marker colours for derived and repurposed glyphs. */
  accentColors?: [string, string];
}

interface Cell {
  art: (cx: number, cy: number, em: number, color: string, fit?: [number, number]) => string;
  label: string;
  sub?: string;
}

interface Section {
  title: string;
  cells: Cell[];
  /** grid sections: fixed column count with header labels */
  colHeads?: string[];
  rowHeads?: string[];
}

function glyphCell(s: Script, g: Glyph): Cell {
  return {
    art: (cx, cy, em, color, fit) => glyphArt(s, g, cx, cy, em, color, fit),
    label: g.sound,
    sub: g.origin === "derived" ? "derived" : g.origin === "repurposed" ? "repurposed" : undefined,
  };
}

function formCell(s: Script, strokes: Stroke[], key: string, label: string): Cell {
  const rot = s.direction === "ttb" && s.style.joins;
  return { art: (cx, cy, em, color, fit) => strokesAt(s, strokes, key, cx, cy, em, rot, ` fill="${color}"`, fit), label };
}

function chartSections(s: Script): Section[] {
  const o = s.ortho;
  const sections: Section[] = [];
  const byId = (id: number): Glyph | undefined => glyphOf(s, id);
  const ordered = s.order.map(byId).filter((g): g is Glyph => !!g);
  const marks = s.glyphs.filter((g) => g.role === "mark");
  const finals = s.glyphs.filter((g) => g.role === "final");
  if (s.kind === "alphabet" || s.kind === "abjad") {
    sections.push({ title: s.kind === "abjad" ? "Letters" : "Letters", cells: ordered.map((g) => glyphCell(s, g)) });
    if (marks.length) sections.push({ title: s.kind === "abjad" ? "Vowel points and marks" : "Marks", cells: marks.map((g) => glyphCell(s, g)) });
    return sections;
  }
  if (s.kind === "abugida" && o.vowelMode === "sign") {
    const cons = ordered.filter((g) => g.role === "consonant");
    const vows = ordered.filter((g) => g.role === "vowel");
    sections.push({ title: "Consonants (inherent " + (o.inherent ?? "") + ")", cells: cons.map((g) => glyphCell(s, g)) });
    if (vows.length) sections.push({ title: "Independent vowels", cells: vows.map((g) => glyphCell(s, g)) });
    // Vowel signs demonstrated on the first consonant.
    const host = cons[0];
    if (host) {
      const vowels = Object.keys(o.vowelSigns).sort((a, b) => phoneticOrderKey(a) - phoneticOrderKey(b));
      const cells: Cell[] = vowels.map((v) => {
        const word = [host.sound, v];
        return {
          art: (cx: number, cy: number, em: number, color: string, fit?: [number, number]) => wordArt(s, word, cx, cy, em, color, fit),
          label: host.sound + v,
        };
      });
      cells.push({ art: (cx, cy, em, color, fit) => wordArt(s, [host.sound], cx, cy, em, color, fit), label: host.sound + "̸" });
      sections.push({ title: "Vowel signs", cells });
    }
    const other = marks.filter((g) => !Object.values(o.vowelSigns).includes(g.id) && g.id !== o.virama);
    if (other.length) sections.push({ title: "Marks", cells: other.map((g) => glyphCell(s, g)) });
    return sections;
  }
  if (s.kind === "abugida") {
    // Grid: consonants × vowels (Ethiopic / syllabics charts).
    const table = o.vowelMode === "fused" ? o.vowelOps : o.rotations;
    const vowels = Object.keys(table)
      .filter((v) => v !== "")
      .sort((a, b) => phoneticOrderKey(a) - phoneticOrderKey(b));
    if (o.vowelMode === "fused" && o.vowelOps[""]) vowels.push("");
    const rows = ordered.filter((g) => g.role === "consonant" || g.id === o.carrier);
    if (o.carrier >= 0 && !rows.some((g) => g.id === o.carrier)) {
      const c = byId(o.carrier);
      if (c) rows.unshift(c);
    }
    const cells: Cell[] = [];
    for (const g of rows) {
      for (const v of vowels) {
        const ops = vowelOpsOf(s, g.id, v);
        const ref = o.vowelMode === "fused" ? { g: g.id, ops } : { g: g.id, rot: o.rotations[v], ops };
        const f = formOf(s, ref);
        const c = g.id === o.carrier ? "" : g.sound;
        cells.push(formCell(s, f?.strokes ?? [], `f${g.id}:${v}`, v === "" ? c + "̸" : c + v));
      }
    }
    sections.push({
      title: "Syllables",
      cells,
      colHeads: vowels.map((v) => (v === "" ? "∅" : v)),
      rowHeads: rows.map((g) => (g.id === o.carrier ? "–" : g.sound)),
    });
    if (finals.length) sections.push({ title: "Finals", cells: finals.map((g) => glyphCell(s, g)) });
    if (marks.length) sections.push({ title: "Marks", cells: marks.map((g) => glyphCell(s, g)) });
    return sections;
  }
  if (s.kind === "syllabary") {
    const keys = Object.keys(o.syllables);
    const vowels = [...new Set(keys.map((k) => k.split("|")[1]))].sort((a, b) => phoneticOrderKey(a) - phoneticOrderKey(b));
    const consAll = [...new Set(keys.map((k) => k.split("|")[0]))];
    // only series that own distinct glyphs
    const seen = new Set<number>();
    const cons = consAll
      .filter((c) => {
        const id = o.syllables[`${c}|${vowels[0]}`];
        if (id === undefined || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : phoneticOrderKey(a) - phoneticOrderKey(b)));
    const cells: Cell[] = [];
    for (const c of cons)
      for (const v of vowels) {
        const id = o.syllables[`${c}|${v}`];
        const g = id !== undefined ? byId(id) : undefined;
        cells.push(g ? glyphCell(s, g) : { art: () => "", label: "" });
      }
    sections.push({ title: "Syllables", cells, colHeads: vowels, rowHeads: cons.map((c) => (c === "" ? "–" : c)) });
    if (finals.length) sections.push({ title: "Codas", cells: finals.map((g) => glyphCell(s, g)) });
    if (marks.length) sections.push({ title: "Marks", cells: marks.map((g) => glyphCell(s, g)) });
    return sections;
  }
  // featural
  const cons = ordered.filter((g) => g.role === "consonant");
  const vows = ordered.filter((g) => g.role === "vowel");
  sections.push({ title: "Consonants", cells: cons.map((g) => glyphCell(s, g)) });
  sections.push({ title: "Vowels", cells: vows.map((g) => glyphCell(s, g)) });
  // sample blocks
  const cs = cons.filter((g) => g.sound !== "∅").slice(0, 4);
  const vs = vows.slice(0, 5);
  const blocks: Cell[] = [];
  for (let i = 0; i < Math.min(8, cs.length * vs.length); i++) {
    const c = cs[i % cs.length];
    const v = vs[(i * 3) % vs.length];
    const coda = i % 3 === 2 ? cs[(i + 1) % cs.length].sound : null;
    const word = coda ? [c.sound, v.sound, coda] : [c.sound, v.sound];
    blocks.push({ art: (cx, cy, em, color, fit) => wordArt(s, word, cx, cy, em, color, fit), label: word.join("") });
  }
  sections.push({ title: "Syllable blocks", cells: blocks });
  return sections;
}

function wordArt(s: Script, word: string[], cx: number, cy: number, em: number, color: string, fit?: [number, number]): string {
  const l = layoutWord(s, word, { jitter: false, pointed: true });
  const sc = fitScale((em * familyScale(s)) / 100, l.x1 - l.x0, l.y1 - l.y0, fit);
  const mx = (l.x0 + l.x1) / 2;
  // Centre on the ink: vowel signs below or above must not run into the cell's label.
  const my = (l.y0 + l.y1) / 2;
  const g = l.items
    .filter((it) => it.d)
    .map((it) => {
      const t = matStr(it.m);
      return `<path${t ? ` transform="${t}"` : ""} d="${it.d}"/>`;
    })
    .join("");
  return `<g transform="matrix(${n3(sc)} 0 0 ${n3(sc)} ${n1(cx - mx * sc)} ${n1(cy - my * sc)})" fill="${color}">${g}</g>`;
}

/** A chart of the script's glyphs with their sound values. */
export function scriptChartSVG(script: Script, opts: ChartOptions = {}): string {
  const em = opts.size ?? 40;
  const color = opts.color ?? "currentColor";
  const LF = fillAttr(opts.labelColor, 0.62);
  const RS = strokeAttr(opts.ruleColor, 0.22);
  const cols = opts.columns ?? 10;
  const headings = opts.headings !== false;
  const accent = opts.accentColors ?? [ACCENT, ACCENT2];
  const cw = em * 1.75;
  const ch = em * 2.45;
  const rtl = script.direction === "rtl";
  const sections = chartSections(script);
  const parts: string[] = [];
  let y = 0;
  let maxW = 0;
  for (const sec of sections) {
    if (headings) {
      parts.push(`<text x="0" y="${n1(y + em * 0.42)}" font-family="${FONT}" font-size="${n1(em * 0.32)}" font-style="italic" ${LF}>${esc(sec.title)}</text>`);
      y += em * 0.7;
    }
    const grid = !!sec.colHeads;
    const ncol = grid ? sec.colHeads!.length : Math.min(cols, sec.cells.length);
    const nrow = Math.ceil(sec.cells.length / Math.max(1, ncol));
    // Tall grids (Ethiopic-style charts, syllabaries) are set in side-by-side panels.
    const rowHeadW = grid ? em * 0.9 : 0;
    const panelGap = em * 0.5;
    const panels = grid ? Math.max(1, Math.min(Math.floor((opts.gridCells ?? 14) / ncol), Math.ceil(nrow / (opts.gridRows ?? 12)))) : 1;
    const perPanel = Math.ceil(nrow / panels);
    const panelW = rowHeadW + ncol * cw;
    const y0 = y;
    let yEnd = y;
    for (let p = 0; p < panels; p++) {
      const ox = p * (panelW + panelGap) + rowHeadW;
      y = y0;
      if (grid) {
        sec.colHeads!.forEach((h, i) => {
          const cx = ox + (rtl ? ncol - 1 - i : i) * cw + cw / 2;
          parts.push(`<text x="${n1(cx)}" y="${n1(y + em * 0.35)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.3)}" ${LF}>${esc(h)}</text>`);
        });
        y += em * 0.55;
      }
      for (let r = p * perPanel; r < Math.min(nrow, (p + 1) * perPanel); r++) {
        if (grid && sec.rowHeads) {
          parts.push(`<text x="${n1(ox - rowHeadW / 2)}" y="${n1(y + ch * 0.42)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.3)}" ${LF}>${esc(sec.rowHeads[r] ?? "")}</text>`);
        }
        for (let c = 0; c < ncol; c++) {
          const k = r * ncol + c;
          if (k >= sec.cells.length) break;
          const cell = sec.cells[k];
          const col = rtl ? ncol - 1 - c : c;
          const x0 = ox + col * cw;
          parts.push(`<rect x="${n1(x0 + 1)}" y="${n1(y + 1)}" width="${n1(cw - 2)}" height="${n1(ch - 2)}" rx="${n1(em * 0.08)}" fill="none" ${RS} stroke-width="1"/>`);
          parts.push(cell.art(x0 + cw / 2, y + ch * 0.4, em, color, [cw * 0.9, ch * 0.66]));
          if (cell.label)
            parts.push(`<text x="${n1(x0 + cw / 2)}" y="${n1(y + ch - em * 0.2)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.3)}" ${LF}>${esc(cell.label)}</text>`);
          if (cell.sub) parts.push(`<circle cx="${n1(x0 + cw - em * 0.18)}" cy="${n1(y + em * 0.18)}" r="${n1(em * 0.05)}" fill="${cell.sub === "derived" ? accent[0] : accent[1]}"/>`);
        }
        y += ch;
      }
      yEnd = Math.max(yEnd, y);
      maxW = Math.max(maxW, ox + ncol * cw);
    }
    y = yEnd + em * 0.35;
  }
  const W = Math.ceil(maxW + 2);
  const H = Math.ceil(y + 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    (opts.background ? `<rect x="-1" y="-1" width="${W}" height="${H}" fill="${opts.background}"/>` : "") +
    parts.join("") +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Evolution table
// ---------------------------------------------------------------------------

export interface EvolutionOptions {
  size?: number;
  color?: string;
  labelColor?: string;
  ruleColor?: string;
  /** Colour of sound values that changed from the previous script. */
  accentColor?: string;
  /** Maximum number of lineage rows. Default 40. */
  maxRows?: number;
  /** Column headings; default `${id} (${bornYear})`. */
  headings?: string[];
  background?: string;
  /** "rows": one row per glyph lineage (tall); "columns": one row per script, lineages across (wide). */
  layout?: "rows" | "columns";
  /** For "columns": lineages per block before wrapping. Default 16. */
  wrap?: number;
}

const LETTERISH = (g: Glyph): boolean => g.role === "consonant" || g.role === "vowel" || g.role === "syllable";

/**
 * Rows: glyph lineages (by `root`), columns: scripts (ancestor → descendants).
 * Each cell shows the lineage's glyph in that script's own hand and its sound.
 */
export function evolutionTableSVG(scripts: Script[], opts: EvolutionOptions = {}): string {
  const em = opts.size ?? 34;
  const color = opts.color ?? "currentColor";
  const LF = fillAttr(opts.labelColor, 0.62);
  const RS = strokeAttr(opts.ruleColor, 0.22);
  const accent = opts.accentColor ?? ACCENT;
  const maxRows = opts.maxRows ?? 40;
  const roots: string[] = [];
  const rootKey = new Map<string, number>();
  scripts.forEach((s, si) => {
    const ord = new Map(s.order.map((id, i) => [id, i]));
    s.glyphs
      .filter(LETTERISH)
      .slice()
      .sort((a, b) => (ord.get(a.id) ?? 999) - (ord.get(b.id) ?? 999))
      .forEach((g) => {
        if (!rootKey.has(g.root)) {
          rootKey.set(g.root, si * 10000 + (ord.get(g.id) ?? 999));
          roots.push(g.root);
        }
      });
  });
  // Prefer lineages that persist across many scripts.
  const persistence = (r: string): number => scripts.filter((s) => s.glyphs.some((g) => g.root === r && LETTERISH(g))).length;
  const chosen = roots
    .slice()
    .sort((a, b) => persistence(b) - persistence(a) || rootKey.get(a)! - rootKey.get(b)!)
    .slice(0, maxRows)
    .sort((a, b) => rootKey.get(a)! - rootKey.get(b)!);
  const cw = em * 1.9;
  const ch = em * 2.1;
  const headH = em * 1.0;
  const parts: string[] = [];
  if (opts.layout === "columns") {
    const wrap = opts.wrap ?? 16;
    const labelW = em * 3.2;
    let y = 0;
    for (let start = 0; start < chosen.length; start += wrap) {
      const block = chosen.slice(start, start + wrap);
      scripts.forEach((s, si) => {
        const yy = y + si * ch;
        const h = opts.headings?.[si] ?? `${s.id} · ${s.bornYear}`;
        parts.push(`<text x="${n1(labelW - em * 0.2)}" y="${n1(yy + ch * 0.45)}" text-anchor="end" font-family="${FONT}" font-size="${n1(em * 0.3)}" ${LF}>${esc(h)}</text>`);
        parts.push(`<text x="${n1(labelW - em * 0.2)}" y="${n1(yy + ch * 0.45 + em * 0.34)}" text-anchor="end" font-family="${FONT}" font-size="${n1(em * 0.24)}" font-style="italic" ${LF}>${esc(s.style.tool)}</text>`);
        block.forEach((root, ci) => {
          const x0 = labelW + ci * cw;
          parts.push(`<rect x="${n1(x0 + 1)}" y="${n1(yy + 1)}" width="${n1(cw - 2)}" height="${n1(ch - 2)}" fill="none" ${RS} stroke-width="1"/>`);
          const g = s.glyphs.find((x) => x.root === root && LETTERISH(x));
          if (!g) return;
          parts.push(glyphArt(s, g, x0 + cw / 2, yy + ch * 0.42, em, color, [cw * 0.9, ch * 0.7]));
          const prev = si > 0 ? scripts.slice(0, si).reverse().map((p) => p.glyphs.find((x) => x.root === root && LETTERISH(x))).find((x) => !!x) : undefined;
          const changed = !!prev && prev.sound !== g.sound;
          parts.push(
            `<text x="${n1(x0 + cw / 2)}" y="${n1(yy + ch - em * 0.18)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.3)}" ${changed ? `fill="${accent}"` : LF}${changed ? ' font-weight="bold"' : ""}>${esc(g.sound)}</text>`,
          );
        });
      });
      y += scripts.length * ch + em * 0.6;
    }
    const W = Math.ceil(labelW + Math.min(wrap, chosen.length) * cw + 2);
    const H = Math.ceil(y + 2);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W} ${H}" width="${W}" height="${H}" role="img">` +
      (opts.background ? `<rect x="-1" y="-1" width="${W}" height="${H}" fill="${opts.background}"/>` : "") +
      parts.join("") +
      `</svg>`
    );
  }
  scripts.forEach((s, i) => {
    const h = opts.headings?.[i] ?? `${s.id} · ${s.bornYear}`;
    parts.push(`<text x="${n1(i * cw + cw / 2)}" y="${n1(headH * 0.45)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.28)}" ${LF}>${esc(h)}</text>`);
    parts.push(`<text x="${n1(i * cw + cw / 2)}" y="${n1(headH * 0.85)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.22)}" font-style="italic" ${LF}>${esc(s.style.tool)}</text>`);
  });
  chosen.forEach((root, r) => {
    const y = headH + r * ch;
    let prevSound: string | null = null;
    scripts.forEach((s, i) => {
      const g = s.glyphs.find((x) => x.root === root && LETTERISH(x));
      const x0 = i * cw;
      parts.push(`<rect x="${n1(x0 + 1)}" y="${n1(y + 1)}" width="${n1(cw - 2)}" height="${n1(ch - 2)}" fill="none" ${RS} stroke-width="1"/>`);
      if (!g) {
        prevSound = null;
        return;
      }
      parts.push(glyphArt(s, g, x0 + cw / 2, y + ch * 0.42, em, color, [cw * 0.9, ch * 0.7]));
      const changed = prevSound !== null && prevSound !== g.sound;
      parts.push(
        `<text x="${n1(x0 + cw / 2)}" y="${n1(y + ch - em * 0.18)}" text-anchor="middle" font-family="${FONT}" font-size="${n1(em * 0.3)}" ${changed ? `fill="${accent}"` : LF}${changed ? ' font-weight="bold"' : ""}>${esc(g.sound)}</text>`,
      );
      prevSound = g.sound;
    });
  });
  const W = Math.ceil(scripts.length * cw + 2);
  const H = Math.ceil(headH + chosen.length * ch + 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    (opts.background ? `<rect x="-1" y="-1" width="${W}" height="${H}" fill="${opts.background}"/>` : "") +
    parts.join("") +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Family tree
// ---------------------------------------------------------------------------

export interface TreeOptions {
  size?: number;
  color?: string;
  labelColor?: string;
  lineColor?: string;
  /** Node box fill (default none). */
  nodeFill?: string;
  /** Node captions; default `${id} (${bornYear})`. */
  labels?: Record<string, string>;
  /** Glyphs shown per node. Default 6. */
  sample?: number;
  background?: string;
}

/**
 * Lineages to show in every node of a tree: the letters most of the family
 * still shares (so a reader can follow one letter from node to node), in the
 * founding script's order.
 */
function sharedLineages(scripts: Script[], n: number): string[] {
  const count = new Map<string, number>();
  const rank = new Map<string, number>();
  // How telling a letter is: drawn strokes count, bare dot clusters little.
  const interest = new Map<string, number>();
  scripts.forEach((s, si) => {
    const ord = new Map(s.order.map((id, i) => [id, i]));
    for (const g of s.glyphs) {
      if (!LETTERISH(g)) continue;
      count.set(g.root, (count.get(g.root) ?? 0) + 1);
      const r = si * 1000 + (ord.get(g.id) ?? 999);
      if (!rank.has(g.root) || r < rank.get(g.root)!) rank.set(g.root, r);
      if (!interest.has(g.root)) {
        const lines = g.strokes.filter((st) => st.dot === undefined);
        interest.set(g.root, Math.min(4, lines.reduce((a, st) => a + st.pts.length - 1 + (st.closed ? 1 : 0), 0)));
      }
    }
  });
  const max = Math.max(0, ...count.values());
  return [...count.keys()]
    .sort((a, b) => {
      const ca = count.get(a)! >= max * 0.8 ? 1 : 0;
      const cb = count.get(b)! >= max * 0.8 ? 1 : 0;
      return cb - ca || interest.get(b)! - interest.get(a)! || count.get(b)! - count.get(a)! || rank.get(a)! - rank.get(b)!;
    })
    .slice(0, n)
    .sort((a, b) => rank.get(a)! - rank.get(b)!);
}

/** A family tree of scripts (by `parent`), each node showing a few glyphs in its hand. */
export function familyTreeSVG(scripts: Script[], opts: TreeOptions = {}): string {
  const em = opts.size ?? 26;
  const color = opts.color ?? "currentColor";
  const LF = fillAttr(opts.labelColor, 0.62);
  const LS = strokeAttr(opts.lineColor, 0.35);
  const nodeFill = opts.nodeFill ?? "none";
  const nSample = opts.sample ?? 6;
  const ids = new Set(scripts.map((s) => s.id));
  const kids = new Map<string, Script[]>();
  const rootsList: Script[] = [];
  for (const s of scripts) {
    if (s.parent && ids.has(s.parent)) {
      if (!kids.has(s.parent)) kids.set(s.parent, []);
      kids.get(s.parent)!.push(s);
    } else rootsList.push(s);
  }
  const nodeW = em * (nSample * 1.05 + 1);
  const nodeH = em * 2.6;
  const gapX = em * 0.8;
  const gapY = em * 1.6;
  const shared = sharedLineages(scripts, nSample);
  const pos = new Map<string, [number, number]>();
  let leafX = 0;
  const place = (s: Script, depth: number): number => {
    const ch = (kids.get(s.id) ?? []).slice().sort((a, b) => a.bornYear - b.bornYear);
    let x: number;
    if (!ch.length) {
      x = leafX;
      leafX += nodeW + gapX;
    } else {
      const xs = ch.map((c) => place(c, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(s.id, [x, depth * (nodeH + gapY)]);
    return x;
  };
  for (const r of rootsList) place(r, 0);
  const parts: string[] = [];
  for (const s of scripts) {
    const p = pos.get(s.id)!;
    for (const c of kids.get(s.id) ?? []) {
      const q = pos.get(c.id)!;
      const x1 = p[0] + nodeW / 2;
      const y1 = p[1] + nodeH;
      const x2 = q[0] + nodeW / 2;
      const y2 = q[1];
      const my = (y1 + y2) / 2;
      parts.push(`<path d="M${n1(x1)} ${n1(y1)}C${n1(x1)} ${n1(my)} ${n1(x2)} ${n1(my)} ${n1(x2)} ${n1(y2)}" fill="none" ${LS} stroke-width="1.5"/>`);
    }
  }
  for (const s of scripts) {
    const [x, y] = pos.get(s.id)!;
    parts.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(nodeW)}" height="${n1(nodeH)}" rx="${n1(em * 0.18)}" fill="${nodeFill}" ${LS}/>`);
    const label = opts.labels?.[s.id] ?? `${s.id} · ${s.bornYear}`;
    parts.push(`<text x="${n1(x + em * 0.35)}" y="${n1(y + em * 0.5)}" font-family="${FONT}" font-size="${n1(em * 0.34)}" ${LF}>${esc(label)}</text>`);
    parts.push(`<text x="${n1(x + nodeW - em * 0.35)}" y="${n1(y + em * 0.5)}" text-anchor="end" font-family="${FONT}" font-size="${n1(em * 0.28)}" font-style="italic" ${LF}>${esc(`${s.kind}, ${s.style.tool}`)}</text>`);
    // One slot per shared lineage, so a letter can be followed from node to
    // node; a lost letter leaves a faint dash, spare slots take the node's own.
    const own = s.order.map((id) => glyphOf(s, id)).filter((g): g is Glyph => !!g && LETTERISH(g));
    const slots: (Glyph | null)[] = shared.map((r) => own.find((x) => x.root === r) ?? null);
    const spare = own.filter((g) => !slots.includes(g));
    while (slots.length < nSample && spare.length) slots.push(spare.shift()!);
    slots.forEach((g, i) => {
      const cx = x + em * 0.5 + i * em * 1.05 + em * 0.5;
      const cy = y + nodeH * 0.62;
      if (g) parts.push(glyphArt(s, g, cx, cy, em * 0.95, color, [em, nodeH * 0.62]));
      else parts.push(`<line x1="${n1(cx - em * 0.15)}" y1="${n1(cy)}" x2="${n1(cx + em * 0.15)}" y2="${n1(cy)}" ${LS}/>`);
    });
  }
  let W = 0;
  let H = 0;
  for (const [x, y] of pos.values()) {
    W = Math.max(W, x + nodeW);
    H = Math.max(H, y + nodeH);
  }
  W = Math.ceil(W + 2);
  H = Math.ceil(H + 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    (opts.background ? `<rect x="-1" y="-1" width="${W}" height="${H}" fill="${opts.background}"/>` : "") +
    parts.join("") +
    `</svg>`
  );
}

export { classify, strokesBBox, circle };
