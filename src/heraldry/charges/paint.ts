/**
 * Turns charge artwork into SVG markup in the charge's local frame.
 */
import type { ArtLayer, ChargeArt } from "./art";
import { f } from "../path";

export interface ChargePaint {
  /** Fill for body layers (a colour or `url(#…)`). */
  body: string;
  /** Fill for accent layers (claws, tongue, beak, antlers…). */
  accent: string;
  /** Fill for crown layers. */
  crown: string;
  /** Outline colour. */
  contour: string;
  /** Interior lines / ink colour. */
  detail: string;
  /** Outline width in local units (the underlay is stroked at twice this). */
  outlineW: number;
  /** Multiplier for detail line widths. */
  lineK: number;
  /** Draw interior detail (lines, ink, shine). Off for very small renderings. */
  detailOn: boolean;
}

function attrs(l: ArtLayer): string {
  return l.evenodd ? ` fill-rule="evenodd"` : "";
}

/**
 * Split a path into its subpaths (at absolute M commands) so that each is filled
 * on its own: overlapping primitives then always union, whatever their winding.
 * Evenodd layers are kept whole because their subpaths are deliberate holes.
 */
export function subpaths(d: string): string[] {
  return d.split(/(?=M)/).filter((x) => x.trim().length > 0);
}

function multi(d: string, attr: string, evenodd: boolean): string {
  if (evenodd) return `<path d="${d}"${attr} fill-rule="evenodd"/>`;
  const parts = subpaths(d);
  if (parts.length === 1) return `<path d="${d}"${attr}/>`;
  let s = `<g${attr}>`;
  for (const p of parts) s += `<path d="${p}"/>`;
  return s + "</g>";
}

export function paintCharge(art: ChargeArt, p: ChargePaint): string {
  let s = "";
  const ow = f(p.outlineW * 2);
  for (const l of art.layers) {
    switch (l.role) {
      case "body":
      case "accent":
      case "crown": {
        if (l.role === "crown" && !p.crown) break;
        const fill = l.role === "body" ? p.body : l.role === "accent" ? p.accent : p.crown;
        if (!l.noOutline) {
          s += multi(l.d, ` fill="${p.contour}" stroke="${p.contour}" stroke-width="${ow}" stroke-linejoin="round"`, !!l.evenodd);
        }
        s += multi(l.d, ` fill="${fill}"`, !!l.evenodd);
        break;
      }
      case "line":
        if (p.detailOn) {
          s += `<path d="${l.d}" fill="none" stroke="${p.detail}" stroke-width="${f((l.w ?? 1.5) * p.lineK)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        break;
      case "ink":
        s += `<path d="${l.d}" fill="${p.detail}"${attrs(l)}/>`;
        break;
      case "shine":
        if (p.detailOn) s += `<path d="${l.d}" fill="#fff" fill-opacity=".32"${attrs(l)}/>`;
        break;
      case "shade":
        if (p.detailOn) s += `<path d="${l.d}" fill="#000" fill-opacity=".22"${attrs(l)}/>`;
        break;
    }
  }
  return s;
}
