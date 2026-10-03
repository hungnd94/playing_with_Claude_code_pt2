/**
 * SVG rendering of emblems (arms, mon, seals, banners, flags) for the UI.
 * The single import site for src/heraldry's renderers. Cached by payload
 * identity + size, with unique id prefixes so many emblems can share a page.
 */
import type { Emblem } from "../../history/types";
import { renderArmsSVG } from "../../heraldry/render";
import { renderMonSVG, type Mon } from "../../heraldry/mon";
import { renderSealSVG, type Seal } from "../../heraldry/seal";
import { renderBannerSVG, type Banner } from "../../heraldry/banner";
import { renderFlagSVG, type Flag } from "../../heraldry/flag";
import type { Arms } from "../../heraldry/types";

const cache = new WeakMap<object, Map<string, string>>();
let counter = 0;

export type EmblemFinish = "rich" | "flat" | "hatched";

export function emblemSVG(e: Emblem, size: number, finish: EmblemFinish = "rich"): string {
  const data = e.data as object | null;
  if (!data || typeof data !== "object") return "";
  let m = cache.get(data);
  if (!m) cache.set(data, (m = new Map()));
  const key = `${size}:${finish}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  const idPrefix = `em${(++counter).toString(36)}-`;
  let svg = "";
  try {
    switch (e.kind) {
      case "arms":
        svg = renderArmsSVG(data as Arms, { size, idPrefix, finish, texture: finish === "rich" && size >= 120 });
        break;
      case "mon":
        svg = renderMonSVG(data as Mon, { size, idPrefix, background: "disc" });
        break;
      case "seal":
        svg = renderSealSVG(data as Seal, { size, idPrefix, font: '"IM Fell English SC", "IM Fell English", Georgia, serif' });
        break;
      case "banner":
        svg = renderBannerSVG(data as Banner, { size, idPrefix, finish: finish === "hatched" ? "flat" : finish });
        break;
    }
  } catch (err) {
    console.warn("emblem render failed", err);
    svg = "";
  }
  m.set(key, svg);
  return svg;
}

export function flagSVG(flag: unknown, size: number): string {
  if (!flag || typeof flag !== "object") return "";
  let m = cache.get(flag);
  if (!m) cache.set(flag, (m = new Map()));
  const key = `flag:${size}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  let svg = "";
  try {
    svg = renderFlagSVG(flag as Flag, { size, idPrefix: `fl${(++counter).toString(36)}-` });
  } catch {
    svg = "";
  }
  m.set(key, svg);
  return svg;
}
