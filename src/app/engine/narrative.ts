/**
 * The app's SINGLE import site for prose (src/narrative).
 *
 * src/narrative is being written by another engineer; until it lands the
 * fallback in ../dev/mockNarrative builds plain articles from raw entities.
 * When it lands, implement `createNarrative` here as a thin adapter over it —
 * the rest of the UI only knows this interface.
 */
import type { PhysicalWorld } from "../../world/types";
import type { History } from "../../history/types";
import type { Article, Block, ChronicleEntry, Ref, Rich, SearchEntry } from "../../narrative/types";
import { createMockNarrative } from "../dev/mockNarrative";

export interface Narrative {
  readonly source: "narrative" | "fallback";
  /** The World overview article. */
  overview(): Article;
  /** Article for any entity (generated on demand, cached). */
  article(ref: Ref): Article;
  /** All chronicle entries, sorted by year then event id. */
  chronicle(): ChronicleEntry[];
  /** Search index over every named entity. */
  searchIndex(): SearchEntry[];
  /** Short display label for a reference (as link text), at a year where names change. */
  label(ref: Ref, year?: number): string;
  /** One-line headline for an event (ticker, hover cards). */
  headline(eventId: number): Rich;
  /** "This age" — a few blocks describing the world at a year. */
  atYear(year: number): Block[];
}

export function createNarrative(world: PhysicalWorld, history: History): Narrative {
  return createMockNarrative(world, history);
}
