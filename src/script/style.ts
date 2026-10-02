/**
 * Script styles: how the writing tool and the scribe's habits shape strokes.
 */
import type { Rng } from "../core/rng";
import type { Direction, Family, ScriptKind, ScriptStyle, Tool } from "./types";

const deg = Math.PI / 180;

/** Which tools plausibly write which design family (weights). */
export const FAMILY_TOOLS: Record<Family, [Tool, number][]> = {
  stave: [["knife", 0.65], ["chisel", 0.35]],
  geometric: [["chisel", 0.35], ["pen", 0.2], ["brush", 0.15], ["needle", 0.15], ["reed", 0.15]],
  hanging: [["pen", 0.5], ["reed", 0.2], ["brush", 0.3]],
  round: [["needle", 0.4], ["pen", 0.3], ["brush", 0.3]],
  square: [["pen", 0.55], ["reed", 0.35], ["brush", 0.1]],
  cursive: [["reed", 0.5], ["pen", 0.3], ["brush", 0.2]],
  wedge: [["stylus", 1]],
  linear: [["needle", 0.35], ["pen", 0.2], ["brush", 0.2], ["chisel", 0.25]],
  tally: [["knife", 0.6], ["chisel", 0.4]],
  featural: [["brush", 0.5], ["pen", 0.25], ["chisel", 0.25]],
  syllabic: [["pen", 0.35], ["brush", 0.35], ["needle", 0.3]],
};

/** Design families suited to each script kind (weights). */
export const KIND_FAMILIES: Record<ScriptKind, [Family, number][]> = {
  alphabet: [
    ["stave", 0.15],
    ["geometric", 0.2],
    ["square", 0.1],
    ["round", 0.18],
    ["linear", 0.12],
    ["cursive", 0.1],
    ["tally", 0.05],
    ["hanging", 0.05],
    ["wedge", 0.05],
  ],
  abjad: [
    ["square", 0.3],
    ["cursive", 0.3],
    ["geometric", 0.15],
    ["wedge", 0.1],
    ["stave", 0.08],
    ["round", 0.07],
  ],
  abugida: [
    ["hanging", 0.38],
    ["round", 0.3],
    ["geometric", 0.12],
    ["syllabic", 0.12],
    ["linear", 0.08],
  ],
  syllabary: [
    ["linear", 0.35],
    ["geometric", 0.2],
    ["round", 0.2],
    ["wedge", 0.15],
    ["hanging", 0.1],
  ],
  featural: [["featural", 1]],
};

export function randomStyle(rng: Rng, family: Family, tool: Tool, direction: Direction): ScriptStyle {
  const r = rng;
  let weight = 0.11;
  let contrast = 0.5;
  let nibAngle = 35 * deg;
  let cornering = 0.4;
  let slant = 0;
  let width = 0.75;
  let serif = 0;
  let taper = 0.5;
  let jitter = r.range(0.15, 0.6);
  switch (tool) {
    case "pen":
      weight = r.range(0.1, 0.15);
      contrast = r.range(0.62, 0.9);
      nibAngle = r.range(25, 55) * deg;
      break;
    case "reed":
      weight = r.range(0.11, 0.16);
      contrast = r.range(0.42, 0.7);
      nibAngle = r.range(55, 78) * deg;
      break;
    case "brush":
      weight = r.range(0.1, 0.16);
      contrast = r.range(0.15, 0.5);
      nibAngle = r.range(20, 60) * deg;
      taper = r.range(0.35, 0.9);
      break;
    case "needle":
      weight = r.range(0.055, 0.085);
      contrast = 0;
      break;
    case "chisel":
      weight = r.range(0.075, 0.11);
      contrast = 0.2;
      serif = r.chance(0.6) ? r.range(0.3, 1) : 0;
      break;
    case "knife":
      weight = r.range(0.075, 0.105);
      contrast = 0.3;
      break;
    case "stylus":
      weight = r.range(0.24, 0.3);
      contrast = r.range(0.2, 0.8);
      jitter = r.range(0.25, 0.7);
      break;
  }
  switch (family) {
    case "stave":
      width = r.range(0.48, 0.6);
      cornering = 0;
      break;
    case "tally":
      width = r.range(0.5, 0.7);
      cornering = 0;
      break;
    case "geometric":
      width = r.range(0.68, 0.9);
      cornering = r.range(0, 0.35);
      break;
    case "hanging":
      width = r.range(0.66, 0.85);
      cornering = r.range(0.45, 0.95);
      if (tool === "pen") nibAngle = r.range(35, 62) * deg;
      weight *= 0.9;
      break;
    case "round":
      width = r.range(0.7, 0.92);
      cornering = r.range(0.75, 1);
      weight *= tool === "needle" ? 1 : 0.72;
      break;
    case "square":
      width = r.range(0.66, 0.82);
      cornering = r.range(0.05, 0.4);
      if (tool === "pen" || tool === "reed") nibAngle = r.range(68, 92) * deg; // heavy horizontals
      break;
    case "cursive":
      width = r.range(0.5, 0.75);
      cornering = r.range(0.6, 1);
      slant = r.chance(0.3) ? r.range(-0.12, 0.18) : 0;
      break;
    case "wedge":
      width = r.range(0.75, 1.0);
      cornering = 0;
      break;
    case "linear":
      width = r.range(0.62, 0.82);
      cornering = r.range(0.1, 0.55);
      break;
    case "featural":
      width = r.range(0.85, 1.0);
      cornering = r.range(0, 0.35);
      break;
    case "syllabic":
      width = r.range(0.72, 0.9);
      cornering = r.range(0.2, 0.7);
      break;
  }
  if (tool === "knife" || tool === "stylus") cornering = 0;
  if ((tool === "pen" || tool === "brush") && family !== "square" && family !== "featural" && r.chance(0.18))
    slant = r.range(0.06, 0.2) * (direction === "rtl" ? -1 : 1);
  const headline = family === "hanging";
  const joins = family === "cursive";
  const stemline = family === "tally";
  const separator = r.weighted<ScriptStyle["separator"]>([
    ["space", 0.55],
    ["dot", 0.2],
    ["colon", 0.15],
    ["bar", 0.1],
  ]);
  return {
    tool,
    weight: round3(weight),
    contrast: round3(contrast),
    nibAngle: round3(nibAngle),
    cornering: round3(cornering),
    slant: round3(slant),
    width: round3(width),
    serif: round3(serif),
    taper: round3(taper),
    jitter: round3(jitter),
    spacing: round3(tool === "stylus" ? 0.14 : headline ? 0.02 : joins ? 0 : 0.12 + weight * 0.4),
    headline,
    joins,
    stemline,
    separator,
  };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Plausible tool changes (e.g. a scribal hand replacing monumental carving). */
export const TOOL_SUCCESSORS: Record<Tool, [Tool, number][]> = {
  chisel: [["pen", 0.4], ["reed", 0.2], ["brush", 0.15], ["knife", 0.15], ["needle", 0.1]],
  knife: [["chisel", 0.35], ["pen", 0.35], ["brush", 0.15], ["needle", 0.15]],
  stylus: [["reed", 0.35], ["pen", 0.25], ["chisel", 0.25], ["needle", 0.15]],
  pen: [["brush", 0.3], ["reed", 0.25], ["chisel", 0.2], ["needle", 0.15], ["knife", 0.1]],
  reed: [["pen", 0.45], ["brush", 0.3], ["chisel", 0.15], ["needle", 0.1]],
  brush: [["pen", 0.4], ["needle", 0.25], ["reed", 0.2], ["chisel", 0.15]],
  needle: [["pen", 0.35], ["brush", 0.35], ["chisel", 0.2], ["reed", 0.1]],
};

/** A descendant's style: small drift, or a new tool with its typical parameters blended in. */
export function driftStyle(rng: Rng, s: ScriptStyle, tool: Tool, amount: number): ScriptStyle {
  const d = (v: number, sd: number, lo: number, hi: number): number =>
    round3(Math.max(lo, Math.min(hi, v + rng.normal(0, sd * amount))));
  const out: ScriptStyle = { ...s };
  out.tool = tool;
  if (tool !== s.tool) {
    // Re-derive tool-typical parameters, keep proportions.
    const fresh = randomStyle(rng, "linear", tool, "ltr");
    out.weight = fresh.weight;
    out.contrast = fresh.contrast;
    out.nibAngle = s.tool === "pen" || s.tool === "reed" ? round3((s.nibAngle + fresh.nibAngle) / 2) : fresh.nibAngle;
    out.taper = fresh.taper;
    out.serif = tool === "chisel" ? fresh.serif : 0;
    // Soft tools round things off; hard tools square them.
    if (tool === "knife" || tool === "stylus") out.cornering = 0;
    else if (s.tool === "knife" || s.tool === "stylus" || s.tool === "chisel")
      out.cornering = round3(Math.min(1, s.cornering + rng.range(0.3, 0.6)));
    else if (tool === "chisel") out.cornering = round3(Math.max(0, s.cornering - rng.range(0.2, 0.4)));
    if (tool === "stylus") out.spacing = 0.14;
  } else {
    out.weight = d(s.weight, 0.012, tool === "needle" ? 0.045 : 0.06, tool === "stylus" ? 0.25 : 0.17);
    out.contrast = tool === "needle" ? 0 : d(s.contrast, 0.08, 0.05, 0.92);
    out.nibAngle = d(s.nibAngle, 0.12, -0.3, 1.65);
    if (tool !== "knife" && tool !== "stylus") out.cornering = d(s.cornering, 0.12, 0, 1);
  }
  out.slant = d(s.slant, 0.05, -0.22, 0.25);
  out.width = d(s.width, 0.05, 0.45, 1.05);
  out.jitter = d(s.jitter, 0.1, 0.05, 0.8);
  if (rng.chance(0.15 * amount)) out.separator = rng.pick(["space", "dot", "colon", "bar"] as const);
  return out;
}
