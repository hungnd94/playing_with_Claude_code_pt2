/**
 * Rendering entry point (main thread). Workers should import the DOM-free
 * bakers from "./bake" directly to keep their bundle small.
 */
export {
  GlobeView,
  type GlobeOptions, type OverlayOptions, type GlobeMarker, type MarkerShape, type PickHandler, type ColorLike,
  type GlobeLabel, type LabelStyleName, type LabelTheme, type ViewState, type ProjectionMode,
} from "./globe/GlobeView";
export * from "./bake/index";
