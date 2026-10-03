/**
 * Hand-drawn map glyphs: mountains, volcanoes, hills, trees, marsh tufts,
 * grass, dunes, ice. Shape geometry is a pure function of the glyph record
 * (tested in Node); drawing uses only the standard 2D API.
 */
import type { Pt } from "./contour";
import { makeCanvas, type Ctx2D } from "./paper";
import type { TerrainGlyph } from "./relief";
import { rgba, type Palette } from "./style";

/** Tiny deterministic PRNG from a [0,1) seed. */
export function prng(v: number): () => number {
  let s = Math.floor(v * 4294967296) >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MountainShape {
  /** Outline from the left foot over the summit(s) to the right foot. */
  outline: Pt[];
  /** Shadow face polygon (right side). */
  shadow: Pt[];
  /** Spur line from the summit down to the foot. */
  spur: Pt[];
  /** Hatching strokes on the shadow face. */
  hatch: [Pt, Pt][];
  /** Snow line (zigzag) or empty. */
  snowLine: Pt[];
  /** Small strokes on the lit face. */
  texture: [Pt, Pt][];
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Point at parameter t (0..1, by index) along a polyline. */
function along(pts: Pt[], t: number): Pt {
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  return lerp(pts[i], pts[i + 1], f - i);
}

/** Point at height fraction (0 = summit, 1 = base) along a flank that descends monotonically. */
function atHeight(pts: Pt[], y: number): Pt {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((y >= a[1] && y <= b[1]) || (y <= a[1] && y >= b[1])) {
      const t = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1]);
      return lerp(a, b, t);
    }
  }
  return y < pts[0][1] ? pts[0] : pts[pts.length - 1];
}

export function mountainShape(g: { x: number; y: number; w: number; h: number; v: number; snow?: number }, k: number, volcano = false): MountainShape {
  const r = prng(g.v);
  const { x, y, w, h } = g;
  const sx = x + (r() - 0.5) * 0.22 * w;
  const sy = y - h;
  const BL: Pt = [x - w / 2, y];
  const BR: Pt = [x + w / 2, y];
  const topHalf = volcano ? w * 0.09 : 0;
  const SL: Pt = [sx - topHalf, sy + (volcano ? h * 0.02 : 0)];
  const SR: Pt = [sx + topHalf, sy];
  // Left (lit) flank: convex-ish with an optional shoulder.
  const left: Pt[] = [BL];
  const nL = 3;
  const shoulder = !volcano && r() < 0.55;
  for (let q = 1; q <= nL; q++) {
    const t = q / (nL + 1);
    const p = lerp(BL, SL, t);
    const bulge = (r() - 0.35) * 0.07 * w;
    let px = p[0] - bulge * 0.6, py = p[1] - bulge;
    if (shoulder && q === 2) py -= 0.06 * h;
    left.push([px, py]);
  }
  left.push(SL);
  // Right (shadow) flank: steeper, a little concave.
  const right: Pt[] = [SR];
  const nR = 3;
  for (let q = 1; q <= nR; q++) {
    const t = q / (nR + 1);
    const p = lerp(SR, BR, t);
    const bulge = (r() - 0.6) * 0.06 * w;
    right.push([p[0] + bulge * 0.5, p[1] + bulge]);
  }
  right.push(BR);
  const outline = left.concat(right);
  // Spur line: from the summit down towards the foot, a little right of centre, with a kink.
  const footX = sx + (0.06 + 0.14 * r()) * w;
  const spur: Pt[] = [SR, [sx + (0.04 + 0.08 * r()) * w, sy + h * (0.42 + 0.1 * r())], [footX, y]];
  if (volcano) spur[0] = SR;
  const shadow: Pt[] = [...spur, BR, ...right.slice(0, -1).reverse()];
  // Hatching: strokes from the spur to the right flank, slanting downwards.
  const hatch: [Pt, Pt][] = [];
  const gap = 2.1 * k * (0.9 + 0.2 * r());
  const n = Math.max(2, Math.floor((h * 0.92) / gap));
  const snowTop = g.snow && g.snow > 0 ? sy + h * (0.18 + 0.2 * g.snow) : sy;
  for (let q = 1; q < n; q++) {
    const yy = sy + (q / n) * h * 0.97;
    if (yy < snowTop) continue;
    const a = atHeight(spur, yy);
    const b = atHeight(right, Math.min(y, yy + h * 0.16));
    const end = lerp(a, b, 0.86 + 0.1 * r());
    if (end[0] - a[0] < 0.8 * k) continue;
    hatch.push([a, end]);
  }
  // Snow line.
  const snowLine: Pt[] = [];
  if (g.snow && g.snow > 0 && !volcano) {
    const a = atHeight(left, snowTop), b = atHeight(right, snowTop + h * 0.04);
    const seg = 5;
    for (let q = 0; q <= seg; q++) {
      const p = lerp(a, b, q / seg);
      snowLine.push([p[0], p[1] + (q % 2 === 1 ? h * 0.07 : -h * 0.01)]);
    }
  }
  // Lit-face texture: one or two short strokes near the foot on big mountains.
  const texture: [Pt, Pt][] = [];
  if (w > 18 * k) {
    const cnt = 1 + (r() < 0.5 ? 1 : 0);
    for (let q = 0; q < cnt; q++) {
      const t = 0.35 + 0.35 * r();
      const p = along(left, t);
      const len = w * (0.08 + 0.06 * r());
      const ip: Pt = [p[0] + w * 0.05, p[1] + h * 0.02];
      texture.push([ip, [ip[0] + len * 0.7, ip[1] + len * 0.7]]);
    }
  }
  return { outline, shadow, spur, hatch, snowLine, texture };
}

function path(ctx: Ctx2D, pts: Pt[], close = false): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

/** Smooth path through points using quadratic midpoints. */
function smoothPath(ctx: Ctx2D, pts: Pt[]): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l[0], l[1]);
}

export interface GlyphEnv {
  pal: Palette;
  k: number;
  /** Colourful styles tint shadows and trees. */
  colour: boolean;
  /** Device scale for tree sprites (0 = draw trees as vectors). */
  sprites?: number;
}

export function drawMountain(ctx: Ctx2D, g: Extract<TerrainGlyph, { t: "mtn" }>, env: GlyphEnv): void {
  const { pal, k } = env;
  const s = mountainShape(g, k);
  // Body (occludes what is behind).
  ctx.beginPath();
  path(ctx, s.outline);
  ctx.closePath();
  ctx.fillStyle = pal.paper;
  ctx.fill();
  // Shadow face.
  ctx.beginPath();
  path(ctx, s.shadow, true);
  ctx.fillStyle = rgba(pal.shadow, env.colour ? 0.42 : 0.3);
  ctx.fill();
  // Hatching.
  ctx.beginPath();
  for (const [a, b] of s.hatch) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.strokeStyle = rgba(pal.ink, 0.62);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  // Texture & spur.
  ctx.beginPath();
  for (const [a, b] of s.texture) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  smoothPath(ctx, s.spur);
  ctx.strokeStyle = rgba(pal.ink, 0.75);
  ctx.lineWidth = 0.7 * k;
  ctx.stroke();
  if (s.snowLine.length) {
    ctx.beginPath();
    path(ctx, s.snowLine);
    ctx.strokeStyle = rgba(pal.ink, 0.45);
    ctx.lineWidth = 0.5 * k;
    ctx.stroke();
  }
  // Outline.
  ctx.beginPath();
  path(ctx, s.outline);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = (0.85 + g.w / (60 * k)) * k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

export function drawVolcano(ctx: Ctx2D, g: Extract<TerrainGlyph, { t: "volc" }>, env: GlyphEnv): void {
  const { pal, k } = env;
  const s = mountainShape({ ...g, snow: 0 }, k, true);
  ctx.beginPath();
  path(ctx, s.outline);
  ctx.closePath();
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.beginPath();
  path(ctx, s.shadow, true);
  ctx.fillStyle = rgba(pal.shadow, env.colour ? 0.45 : 0.32);
  ctx.fill();
  ctx.beginPath();
  for (const [a, b] of s.hatch) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.strokeStyle = rgba(pal.ink, 0.62);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  ctx.beginPath();
  path(ctx, s.outline);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1.1 * k;
  ctx.lineJoin = "round";
  ctx.stroke();
  // Crater.
  const top = s.outline[Math.floor(s.outline.length / 2)];
  const cx = (s.outline[Math.floor(s.outline.length / 2) - 1][0] + top[0]) / 2;
  const cy = top[1];
  const cw = g.w * 0.1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, cw, cw * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = g.active && env.colour ? rgba(pal.red, 0.8) : rgba(pal.ink, 0.7);
  ctx.fill();
  // Smoke wisp: a curling ribbon of strokes rising and drifting.
  const r = prng(g.v + 0.37);
  const drift = (r() < 0.5 ? -1 : 1) * g.w * 0.5;
  ctx.lineCap = "round";
  for (let q = 0; q < (g.active ? 3 : 1); q++) {
    const off = (q - 1) * g.w * 0.05;
    const pts: Pt[] = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const yy = cy - t * g.h * 1.25;
      const xx = cx + off + drift * t * t + Math.sin(t * 7 + q + r() * 0.3) * g.w * 0.07 * (0.3 + t);
      pts.push([xx, yy]);
    }
    ctx.beginPath();
    smoothPath(ctx, pts);
    ctx.strokeStyle = rgba(pal.inkSoft, 0.55 - q * 0.12);
    ctx.lineWidth = (0.9 - q * 0.15) * k;
    ctx.stroke();
  }
}

/** Hill: a rounded hump, lit on the left, hatched on the right, with a heavier shadow flank. */
export function drawHill(ctx: Ctx2D, g: Extract<TerrainGlyph, { t: "hill" }>, env: GlyphEnv): void {
  const { pal, k } = env;
  const r = prng(g.v);
  const { x, y, w, h } = g;
  const peakX = x - w * (0.04 + 0.12 * r());
  const lx = x - w / 2, rx = x + w / 2;
  const c1x = lx + w * 0.12, c1y = y - h * 1.18;
  const c2x = peakX + w * 0.28, c2y = y - h * 1.3;
  const curve = () => {
    ctx.moveTo(lx, y);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, rx, y);
  };
  ctx.beginPath();
  curve();
  ctx.closePath();
  ctx.fillStyle = pal.paper;
  ctx.fill();
  const bez = (t: number): Pt => {
    const u = 1 - t;
    return [u * u * u * lx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * rx, u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y];
  };
  // Shadow wash on the right flank (a polygon inside the hump: no clipping needed).
  ctx.beginPath();
  const s0 = bez(0.52);
  ctx.moveTo(s0[0], s0[1]);
  for (let t = 0.58; t <= 1.0001; t += 0.06) {
    const p = bez(t);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.lineTo(x + w * 0.12, y);
  ctx.quadraticCurveTo(x + w * 0.16, y - h * 0.5, s0[0], s0[1]);
  ctx.fillStyle = rgba(pal.shadow, env.colour ? 0.3 : 0.22);
  ctx.fill();
  // Hatching: short strokes following the right flank.
  ctx.beginPath();
  const n = 3 + Math.floor(r() * 2);
  for (let q = 0; q < n; q++) {
    const t = 0.6 + (q / n) * 0.32;
    const p = bez(t);
    const len = h * (0.55 - q * 0.08);
    ctx.moveTo(p[0] - 0.4 * k, p[1] + 0.9 * k);
    ctx.quadraticCurveTo(p[0] - w * 0.06, p[1] + len * 0.5, p[0] - w * 0.04, p[1] + len);
  }
  ctx.strokeStyle = rgba(pal.ink, 0.5);
  ctx.lineWidth = 0.5 * k;
  ctx.lineCap = "round";
  ctx.stroke();
  // Outline: light on the lit side, heavier on the shadow side.
  ctx.beginPath();
  curve();
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 0.75 * k;
  ctx.stroke();
  ctx.beginPath();
  const p0 = bez(0.55);
  ctx.moveTo(p0[0], p0[1]);
  for (let t = 0.6; t <= 1.0001; t += 0.05) {
    const p = bez(t);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.lineWidth = 1.15 * k;
  ctx.stroke();
}

// --- Vegetation -------------------------------------------------------------

/** Unit cloud-crown outlines (union of three or four circles), cached per variant. */
const crownCache = new Map<number, Pt[]>();
function crownShape(variant: number, lobes: number): Pt[] {
  const key = variant * 8 + lobes;
  const hit = crownCache.get(key);
  if (hit) return hit;
  const r = prng((variant + 0.5) / 17 + lobes * 0.013);
  // Circles in unit space: the crown sits in [-0.5, 0.5] × [-1, 0].
  const circles: [number, number, number][] = [[0, -0.62, 0.3 + 0.04 * r()]];
  if (lobes >= 3) {
    circles.push([-0.2 - 0.04 * r(), -0.42, 0.25 + 0.04 * r()]);
    circles.push([0.2 + 0.04 * r(), -0.42, 0.26 + 0.04 * r()]);
  }
  if (lobes >= 4) circles.push([0.04 * (r() - 0.5), -0.3, 0.24]);
  const cx = 0, cy = -0.5;
  const N = 36;
  const pts: Pt[] = [];
  for (let q = 0; q < N; q++) {
    const a = (q / N) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (const [ox, oy, rr] of circles) {
      // Farthest intersection of the ray (cx,cy)+t(dx,dy) with the circle.
      const fx = cx - ox, fy = cy - oy;
      const b = fx * dx + fy * dy;
      const c = fx * fx + fy * fy - rr * rr;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b + Math.sqrt(disc);
      if (t > best) best = t;
    }
    pts.push([cx + dx * best, cy + dy * best]);
  }
  crownCache.set(key, pts);
  return pts;
}

function tracePoly(ctx: Ctx2D, pts: Pt[], x: number, y: number, sx: number, sy: number): void {
  ctx.moveTo(x + pts[0][0] * sx, y + pts[0][1] * sy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x + pts[i][0] * sx, y + pts[i][1] * sy);
  ctx.closePath();
}

function drawTreeVector(ctx: Ctx2D, g: Extract<TerrainGlyph, { t: "tree" }>, env: GlyphEnv): void {
  const { pal, k } = env;
  const r = prng(g.v);
  const { x, y, s } = g;
  const ink = pal.ink;
  const lw = 0.7 * k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (g.kind) {
    case "decid":
    case "shrub": {
      const shrub = g.kind === "shrub";
      const crown = crownShape(Math.floor(g.v * 16), shrub ? 3 : g.v > 0.5 ? 4 : 3);
      const cw = s * (shrub ? 0.95 : 1.05) * (0.92 + 0.16 * r());
      const ch = s * (shrub ? 0.75 : 1.08);
      const top = y - (shrub ? 0 : s * 0.22);
      if (!shrub && g.edge) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.2 * k, top - ch * 0.2);
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      ctx.beginPath();
      tracePoly(ctx, crown, x, top, cw, ch);
      ctx.fillStyle = env.colour ? mixFill(pal.paper, pal.forestTint, g.edge ? 0.32 : 0.22) : pal.paper;
      ctx.fill();
      // Shade: the crown shape, smaller, towards the lower right (stays inside the crown).
      ctx.beginPath();
      tracePoly(ctx, crown, x + cw * 0.17, top - ch * 0.08, cw * 0.62, ch * 0.62);
      ctx.fillStyle = rgba(pal.shadow, (env.colour ? 0.36 : 0.26) * (g.edge ? 1 : 0.75));
      ctx.fill();
      ctx.beginPath();
      tracePoly(ctx, crown, x, top, cw, ch);
      ctx.strokeStyle = g.edge ? ink : rgba(pal.ink, 0.62);
      ctx.lineWidth = g.edge ? lw : lw * 0.8;
      ctx.stroke();
      break;
    }
    case "conif":
    case "snowconif": {
      const hgt = s * (1.25 + 0.25 * r());
      const half = s * (0.3 + 0.06 * r());
      const top: Pt = [x, y - hgt];
      const baseY = y - s * 0.18;
      // two-tier spire
      const pts: Pt[] = [
        [x - half, baseY],
        [x - half * 0.45, baseY - hgt * 0.36],
        [x - half * 0.75, baseY - hgt * 0.34],
        top,
        [x + half * 0.75, baseY - hgt * 0.34],
        [x + half * 0.45, baseY - hgt * 0.36],
        [x + half, baseY],
      ];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, baseY);
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.beginPath();
      path(ctx, pts, true);
      ctx.fillStyle = env.colour ? mixFill(pal.paper, pal.forestTint, g.kind === "snowconif" ? 0.15 : 0.45) : pal.paper;
      ctx.fill();
      // shadow half
      ctx.beginPath();
      path(ctx, [top, [x + half * 0.75, baseY - hgt * 0.34], [x + half * 0.45, baseY - hgt * 0.36], [x + half, baseY], [x + half * 0.1, baseY]], true);
      ctx.fillStyle = rgba(pal.shadow, env.colour ? 0.45 : 0.32);
      ctx.fill();
      ctx.beginPath();
      path(ctx, pts, true);
      ctx.strokeStyle = g.edge ? ink : rgba(pal.ink, 0.62);
      ctx.lineWidth = g.edge ? lw : lw * 0.8;
      ctx.stroke();
      break;
    }
    case "jungle": {
      const rx = s * 0.55 * (0.9 + 0.25 * r());
      const ry = rx * 0.8;
      const cy = y - ry - s * 0.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, cy + ry * 0.5);
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.stroke();
      // three-lobed cloud crown
      ctx.beginPath();
      ctx.arc(x - rx * 0.45, cy + ry * 0.15, rx * 0.55, Math.PI * 0.55, Math.PI * 1.5);
      ctx.arc(x, cy - ry * 0.3, rx * 0.6, Math.PI * 1.05, Math.PI * 1.95);
      ctx.arc(x + rx * 0.45, cy + ry * 0.15, rx * 0.55, Math.PI * 1.5, Math.PI * 0.45);
      ctx.closePath();
      ctx.fillStyle = env.colour ? mixFill(pal.paper, pal.forestTint, 0.55) : pal.paper;
      ctx.fill();
      const outline = () => {
        ctx.beginPath();
        ctx.arc(x - rx * 0.45, cy + ry * 0.15, rx * 0.55, Math.PI * 0.55, Math.PI * 1.5);
        ctx.arc(x, cy - ry * 0.3, rx * 0.6, Math.PI * 1.05, Math.PI * 1.95);
        ctx.arc(x + rx * 0.45, cy + ry * 0.15, rx * 0.55, Math.PI * 1.5, Math.PI * 0.45);
        ctx.closePath();
      };
      // Shade: a smaller cloud to the lower right.
      ctx.beginPath();
      {
        const sx = x + rx * 0.22, sy = cy + ry * 0.22, f = 0.6;
        ctx.arc(sx - rx * 0.45 * f, sy + ry * 0.15 * f, rx * 0.55 * f, Math.PI * 0.55, Math.PI * 1.5);
        ctx.arc(sx, sy - ry * 0.3 * f, rx * 0.6 * f, Math.PI * 1.05, Math.PI * 1.95);
        ctx.arc(sx + rx * 0.45 * f, sy + ry * 0.15 * f, rx * 0.55 * f, Math.PI * 1.5, Math.PI * 0.45);
        ctx.closePath();
      }
      ctx.fillStyle = rgba(pal.shadow, env.colour ? 0.42 : 0.3);
      ctx.fill();
      outline();
      ctx.strokeStyle = g.edge ? ink : rgba(pal.ink, 0.62);
      ctx.lineWidth = g.edge ? lw : lw * 0.8;
      ctx.stroke();
      break;
    }
    case "palm": {
      const hgt = s * 1.2;
      const lean = (r() - 0.5) * s * 0.5;
      const tx = x + lean, ty = y - hgt;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.2, y - hgt * 0.5, tx, ty);
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw * 1.1;
      ctx.stroke();
      ctx.beginPath();
      for (let q = 0; q < 5; q++) {
        const a = -Math.PI / 2 + (q - 2) * 0.62 + (r() - 0.5) * 0.2;
        const L = s * (0.55 + 0.15 * r());
        const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.6 + L * 0.35;
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + Math.cos(a) * L * 0.6, ty + Math.sin(a) * L * 0.9, ex, ey);
      }
      ctx.lineWidth = lw;
      ctx.stroke();
      break;
    }
    case "acacia": {
      const hgt = s * 0.95;
      const ty = y - hgt;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, ty + s * 0.12);
      ctx.moveTo(x, y - hgt * 0.45);
      ctx.lineTo(x + s * 0.22, ty + s * 0.1);
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + s * 0.05, ty, s * 0.55, s * 0.17, 0, 0, Math.PI * 2);
      ctx.fillStyle = env.colour ? mixFill(pal.paper, pal.forestTint, 0.35) : pal.paper;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.stroke();
      break;
    }
  }
}

function mixFill(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

export function drawMarsh(ctx: Ctx2D, g: { x: number; y: number; s: number; v: number }, env: GlyphEnv): void {
  const { pal, k } = env;
  const r = prng(g.v);
  const { x, y, s } = g;
  ctx.beginPath();
  // tuft
  const n = 3 + Math.floor(r() * 3);
  for (let q = 0; q < n; q++) {
    const dx = (q - (n - 1) / 2) * s * 0.18;
    const hgt = s * (0.45 + 0.35 * r()) * (1 - Math.abs(dx) / (s * 0.8));
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x + dx * 1.35, y - hgt);
  }
  // water lines
  ctx.moveTo(x - s * 0.55, y + 0.3 * k);
  ctx.lineTo(x + s * 0.55, y + 0.3 * k);
  ctx.moveTo(x - s * 0.3 + s * 0.4 * (r() - 0.5), y + s * 0.22);
  ctx.lineTo(x + s * 0.25, y + s * 0.22);
  ctx.strokeStyle = rgba(pal.waterInk, 0.75);
  ctx.lineWidth = 0.6 * k;
  ctx.lineCap = "round";
  ctx.stroke();
}

export function drawGrass(ctx: Ctx2D, g: { x: number; y: number; s: number; v: number }, env: GlyphEnv): void {
  const { pal, k } = env;
  const r = prng(g.v);
  const { x, y, s } = g;
  ctx.beginPath();
  const n = 2 + Math.floor(r() * 2);
  for (let q = 0; q < n; q++) {
    const dx = (q - (n - 1) / 2) * s * 0.22;
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x + dx * 1.6 + (r() - 0.5) * s * 0.1, y - s * (0.35 + 0.25 * r()));
  }
  ctx.strokeStyle = rgba(pal.ink, 0.5);
  ctx.lineWidth = 0.5 * k;
  ctx.lineCap = "round";
  ctx.stroke();
}

export function drawDune(ctx: Ctx2D, g: { x: number; y: number; s: number; v: number }, env: GlyphEnv): void {
  const { pal, k } = env;
  const r = prng(g.v);
  const { x, y, s } = g;
  const w = s * (1 + 0.5 * r());
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.05, y - s * 0.42, x + w / 2, y - s * 0.02);
  ctx.strokeStyle = rgba(pal.ink, 0.55);
  ctx.lineWidth = 0.6 * k;
  ctx.stroke();
  // shadow stipple under the crest
  ctx.fillStyle = rgba(pal.ink, 0.45);
  for (let q = 0; q < 4; q++) {
    const t = 0.45 + 0.45 * r();
    const px = x - w / 2 + w * t, py = y - s * 0.2 * Math.sin(Math.PI * t) + s * 0.12 + r() * s * 0.15;
    ctx.fillRect(px, py, 0.7 * k, 0.7 * k);
  }
}

export function drawIce(ctx: Ctx2D, g: { x: number; y: number; s: number; v: number }, env: GlyphEnv): void {
  const { pal, k } = env;
  const r = prng(g.v);
  const { x, y, s } = g;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.6, y);
  ctx.lineTo(x - s * 0.1, y - s * 0.12 * r());
  ctx.lineTo(x + s * 0.6, y + s * 0.05);
  ctx.strokeStyle = rgba(pal.waterInk, 0.45);
  ctx.lineWidth = 0.5 * k;
  ctx.stroke();
}

// --- Tree sprites --------------------------------------------------------------

/**
 * Trees are by far the most numerous glyphs: each (kind, variant, size bucket,
 * edge, palette, device scale) is drawn once into a small offscreen canvas and
 * stamped with drawImage. Variants (16) and half-pixel size buckets keep the
 * hand-drawn variety.
 */
interface Sprite {
  cv: HTMLCanvasElement | OffscreenCanvas;
  /** Anchor (tree base) inside the sprite, CSS px. */
  ox: number;
  oy: number;
  w: number;
  h: number;
}
const spriteCache = new Map<string, Sprite | null>();

function treeSprite(g: Extract<TerrainGlyph, { t: "tree" }>, env: GlyphEnv, scale: number): Sprite | null {
  const variant = Math.floor(g.v * 16);
  const sq = Math.round(g.s * 2) / 2;
  const key = `${g.kind}|${variant}|${sq}|${g.edge ? 1 : 0}|${env.colour ? 1 : 0}|${env.pal.ink}|${env.pal.paper}|${env.pal.forestTint}|${env.k.toFixed(3)}|${scale.toFixed(2)}`;
  const hit = spriteCache.get(key);
  if (hit !== undefined) return hit;
  const pad = 2 * env.k;
  const w = Math.ceil(sq * 1.9 + 2 * pad), h = Math.ceil(sq * 2.1 + 2 * pad);
  let sp: Sprite | null = null;
  try {
    const cv = makeCanvas(w * scale, h * scale);
    const c2 = cv.getContext("2d") as Ctx2D | null;
    if (c2) {
      c2.scale(scale, scale);
      const ox = w / 2, oy = h - pad - sq * 0.25;
      drawTreeVector(c2, { ...g, x: ox, y: oy, s: sq, v: (variant + 0.5) / 16 }, env);
      sp = { cv, ox, oy, w, h };
    }
  } catch {
    sp = null;
  }
  if (spriteCache.size > 6000) spriteCache.clear();
  spriteCache.set(key, sp);
  return sp;
}

export function drawTree(ctx: Ctx2D, g: Extract<TerrainGlyph, { t: "tree" }>, env: GlyphEnv): void {
  const sp = env.sprites ? treeSprite(g, env, env.sprites) : null;
  if (sp) ctx.drawImage(sp.cv as CanvasImageSource, g.x - sp.ox, g.y - sp.oy, sp.w, sp.h);
  else drawTreeVector(ctx, g, env);
}

export function drawTerrainGlyph(ctx: Ctx2D, g: TerrainGlyph, env: GlyphEnv): void {
  switch (g.t) {
    case "mtn": drawMountain(ctx, g, env); break;
    case "volc": drawVolcano(ctx, g, env); break;
    case "hill": drawHill(ctx, g, env); break;
    case "tree": drawTree(ctx, g, env); break;
    case "marsh": drawMarsh(ctx, g, env); break;
    case "grass": drawGrass(ctx, g, env); break;
    case "dune": drawDune(ctx, g, env); break;
    case "ice": drawIce(ctx, g, env); break;
  }
}
