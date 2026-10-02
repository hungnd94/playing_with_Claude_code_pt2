/**
 * Procedural writing systems — public API. See README.md.
 */
export * from "./types";
export { createScript, type CreateOptions } from "./create";
export { layoutWord, layoutText, type WordLayout, type PlacedItem, type LayoutOptions } from "./layout";
export {
  renderWordSVG,
  renderTextSVG,
  renderGlyphSVG,
  scriptChartSVG,
  evolutionTableSVG,
  familyTreeSVG,
  type SvgOptions,
  type ChartOptions,
  type EvolutionOptions,
  type TreeOptions,
} from "./svg";
export { spellWord, unwritable, type Cluster } from "./spell";
export { classify, phonDistance, type PhonInfo } from "./ipa";
export { deriveScript, adaptScript, type DeriveOptions, type AdaptOptions } from "./evolve";
