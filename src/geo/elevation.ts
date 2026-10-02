/**
 * Elevation from plate tectonics plus multi-scale noise.
 *
 * 1. Crust. A "continentalness" field starts from plate types. Continental
 *    plates are cut back near divergent boundaries and ocean-facing transforms
 *    (passive margins: the continent sits inside its plate with an oceanic
 *    fringe that widens with the maturity of the spreading ridge), but reach
 *    right up to convergent boundaries (active margins) and continue across
 *    boundaries with other continental plates (sutures). Rifted slivers,
 *    microcontinents and interior basins add variety.
 * 2. The tectonic framework is sampled through a smooth domain warp so that
 *    plate outlines, coasts and mountain belts curve together instead of
 *    looking like Voronoi polygons.
 * 3. Coastlines. The signed distance to the continental edge is displaced by
 *    multi-octave noise measured in km, whose amplitude varies regionally
 *    (smooth Africa-like coasts next to ragged Aegean-like ones), is damped
 *    along active margins (straight Andean coasts), and gains narrow ridged
 *    components at high latitudes (fjords and skerry chains). This makes
 *    peninsulas, bays, gulfs and offshore islands at the 150–1500 km scale
 *    without single-cell speckle.
 * 4. A hypsometric mapping turns crust into elevation: abyssal plains whose
 *    depth follows the age–depth relation away from mid-ocean ridges, a steep
 *    continental slope, a shelf, coastal plains rising to the interior.
 * 5. Interior relief: broad basins and swells, a few sharp-edged plateaus,
 *    great escarpments behind passive margins (Drakensberg, Western Ghats,
 *    Serra do Mar), and old orogens along the sutures of a vanished plate
 *    configuration (Urals, Appalachians, Caledonides).
 * 6. Active boundaries, each with its own cross-section: ocean–continent
 *    subduction (trench, coastal cordillera, volcanic arc, back-arc plateau),
 *    continent–continent collision (high range plus a broad plateau on the
 *    overriding side and a foreland basin in front), ocean–ocean subduction
 *    (trench and island arc), continental rifts (graben with shoulders),
 *    transpressional ranges along continental transforms, mid-ocean ridges.
 * 7. Hotspot chains carried along by plate motion.
 */
import type { SphereMesh } from "../core/sphere";
import { CellLocator } from "../core/sphere";
import { Rng } from "../core/rng";
import { Noise3 } from "../core/noise";
import { BoundaryKind } from "../world/types";
import type { Tectonics } from "./plates";
import type { WorldStyle } from "./style";
import { clamp, distanceField, quantileBisect, smoothField, smoothstep } from "./util";

export interface Hotspot {
  /** Cell currently above the hotspot (the young, active end of the chain). */
  cell: number;
  /** Cells of the chain, young to old. */
  chain: number[];
  oceanic: boolean;
}

export interface ElevationResult {
  /** Elevation (km) relative to a nominal datum; sea level is chosen later. */
  elevation: Float32Array;
  /** Crust continentalness 0..1 after warping and coast displacement (≥0.5 = continental crust). */
  crust: Float32Array;
  volcanism: Float32Array;
  seismicity: Float32Array;
  /** Plate id per cell after warping (consistent with relief). */
  plate: Uint8Array;
  /** BoundaryKind per cell after warping. */
  boundary: Uint8Array;
  /** Tectonic uplift (km) contributed by active boundaries; marks orogens. */
  orogeny: Float32Array;
  /** Old (interior) orogen strength 0..1. */
  oldOrogen: Float32Array;
  /** 1 inside continental rift valleys. */
  rift: Float32Array;
  /** Distance (km) to the nearest plate boundary (warped). */
  boundaryDist: Float32Array;
  hotspots: Hotspot[];
}

export function buildElevation(
  mesh: SphereMesh,
  tect: Tectonics,
  radiusKm: number,
  edgeLen: Float32Array,
  oceanFraction: number,
  rng: Rng,
  style: WorldStyle,
): ElevationResult {
  const n = mesh.n;
  const { xyz, adjStart, adj } = mesh;
  const P = tect.plates.length;
  // Length scale relative to Earth, damped so features remain resolvable on small planets.
  const L = Math.pow(radiusKm / 6371, 0.6);
  const contPlate = (p: number) => !tect.plates[p].oceanic;

  // ---------------------------------------------------------------- crust
  const MMAX = 2500;
  const noiseC = new Noise3(rng.fork("crust-noise"));
  const crust0 = new Float32Array(n);
  const marginIn0 = new Float32Array(n).fill(1e4); // km inland of a passive margin (unwarped)
  const landTarget = 1 - oceanFraction;
  const nzWobble = new Float32Array(n), nzSliver = new Float32Array(n), nzMicro = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    if (contPlate(tect.plate[i])) {
      nzWobble[i] = noiseC.fbm(x * 3.1, y * 3.1, z * 3.1, 3);
      nzSliver[i] = noiseC.fbm(x * 2.0 + 21.1, y * 2.0 - 13.3, z * 2.0 + 4.4, 3);
    } else {
      nzMicro[i] = noiseC.fbm(x * 2.3 + 11.7, y * 2.3 - 3.1, z * 2.3 + 5.5, 4);
    }
  }
  const microLo = 0.6 - 0.14 * style.micro;
  const crustTarget = landTarget + style.shelf;
  let mScale = 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    const marginSrc: number[] = [];
    const marginOff: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!tect.isBoundary[i]) continue;
      const p = tect.plate[i];
      if (!contPlate(p)) continue;
      const o = tect.other[i];
      const k = tect.kind[i];
      const othC = contPlate(o);
      let M = -1;
      if (k === BoundaryKind.Divergent) {
        const mat = tect.pairMaturity[p * P + o];
        if (mat >= 0.25) M = (250 + 1250 * (mat - 0.25)) * L * (0.7 + 0.5 * clamp(-tect.conv[i] / 0.8, 0, 1));
      } else if (k === BoundaryKind.Transform) {
        // Ocean-facing transforms are sheared passive margins; between two continents the
        // fault runs on land (San Andreas, Alpine Fault, Dead Sea).
        if (!othC) M = 220 * L;
      } else if (!othC && tect.conv[i] < 0.12) {
        // Very slow convergence against an oceanic plate: behaves as a passive margin.
        M = 120 * L;
      }
      M *= mScale * Math.min(1, Math.sqrt(tect.plateArea[p] / 0.07));
      if (M > 0) {
        marginSrc.push(i);
        marginOff.push(MMAX - M);
      }
    }
    const mf = distanceField(mesh, edgeLen, marginSrc, MMAX + 3000, (a, b) => tect.plate[a] === tect.plate[b], marginOff);
    let contArea = 0;
    for (let i = 0; i < n; i++) {
      const p = tect.plate[i];
      if (contPlate(p)) {
        const signed = mf.dist[i] === Infinity ? 1e9 : mf.dist[i] - MMAX; // distance beyond the margin
        marginIn0[i] = Math.min(1e4, signed);
        const wobble = 160 * L * nzWobble[i];
        crust0[i] = smoothstep(-200 * L, 260 * L, signed + wobble);
        // Rifted slivers (Madagascar, Sri Lanka, Zealandia): crust left stranded offshore,
        // parallel to a passive margin, where a sparse noise mask allows.
        if (signed < -150 * L && signed > -1400 * L) {
          const band = Math.exp(-(((signed + 520 * L * mScale) / (200 * L)) ** 2));
          crust0[i] = Math.max(crust0[i], 0.95 * band * smoothstep(0.18, 0.34, nzSliver[i]));
        }
      } else {
        // Microcontinents / oceanic plateaus: rare fragments of continental crust in the oceans.
        crust0[i] = 0.9 * smoothstep(microLo, microLo + 0.13, nzMicro[i]);
      }
      if (crust0[i] >= 0.5) contArea += mesh.area[i] / (4 * Math.PI);
    }
    // Aim for continental crust ≈ 1.0–1.3 × (land + shelf).
    if (contArea < crustTarget * 1.0) mScale *= 0.6;
    else if (contArea > crustTarget * 1.3) mScale *= 1.6;
    else break;
  }
  // Inland seas / large interior basins on continents (Mediterranean, Hudson Bay, Black Sea…).
  for (let i = 0; i < n; i++) {
    if (crust0[i] < 0.5) continue;
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const s = noiseC.fbm(x * 2.6 - 7.3, y * 2.6 + 2.2, z * 2.6 + 9.9, 4);
    // Fragmented worlds have many more, larger drowned basins: their continents break up
    // into big islands and archipelagos around shelf seas (Sundaland, the Aegean).
    crust0[i] -= 0.75 * smoothstep(0.41 - 0.2 * style.fragment, 0.54 - 0.14 * style.fragment, s);
    if (style.fragment > 0.4) {
      const s2 = noiseC.fbm(x * 4.6 + 3.1, y * 4.6 - 8.2, z * 4.6 + 1.4, 3);
      const drop = 0.7 * smoothstep(0.4, 0.9, style.fragment) * smoothstep(0.12, 0.3, s2);
      crust0[i] = Math.max(crust0[i] - drop, Math.min(crust0[i], 0.45)); // shallow shelf seas, not abyssal holes
    }
  }
  smoothField(mesh, crust0, 2, 0.5);
  // Calibrate: shift crust so that the deep ocean (beyond the shelf break) covers
  // oceanFraction − shelf of the planet; the rest is continental shelf and land.
  {
    const q = quantileBisect(crust0, mesh.area, clamp(oceanFraction - style.shelf, 0.05, 0.95));
    const shift = clamp(0.47 - q, -0.3, 0.3);
    // Only continental-ish crust moves; the abyss stays abyssal (no speckle of shoals).
    for (let i = 0; i < n; i++) crust0[i] += shift * smoothstep(0.15, 0.45, crust0[i]);
  }

  // Distance to divergent boundaries (any plate) → age of oceanic crust.
  const divSrc: number[] = [];
  for (let i = 0; i < n; i++) if (tect.kind[i] === BoundaryKind.Divergent) divSrc.push(i);
  const dDiv0 = distanceField(mesh, edgeLen, divSrc, 1e9).dist;
  for (let i = 0; i < n; i++) if (dDiv0[i] === Infinity) dDiv0[i] = 5000;

  // ---------------------------------------------------------------- domain warp
  const warpNoise = new Noise3(rng.fork("warp"));
  const locator = new CellLocator(mesh);
  const bary = new Float64Array(3);
  const wNear = new Int32Array(n);
  const crust = new Float32Array(n);
  const dDiv = new Float32Array(n);
  const bd = new Float32Array(n);
  const marginIn = new Float32Array(n);
  const A1 = style.warp, F1 = 1.3, A2 = 0.045, F2 = 4.2;
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    let wx = A1 * warpNoise.fbm(x * F1 + 1.3, y * F1 + 7.7, z * F1 - 2.1, 3) + A2 * warpNoise.fbm(x * F2 + 4.4, y * F2 - 1.9, z * F2 + 8.2, 2);
    let wy = A1 * warpNoise.fbm(x * F1 - 5.1, y * F1 + 2.4, z * F1 + 6.6, 3) + A2 * warpNoise.fbm(x * F2 - 3.3, y * F2 + 5.5, z * F2 - 7.4, 2);
    let wz = A1 * warpNoise.fbm(x * F1 + 9.2, y * F1 - 6.3, z * F1 + 0.4, 3) + A2 * warpNoise.fbm(x * F2 + 2.8, y * F2 + 3.1, z * F2 + 1.6, 2);
    // Tangential part only.
    const dd = wx * x + wy * y + wz * z;
    wx -= dd * x; wy -= dd * y; wz -= dd * z;
    let qx = x + wx, qy = y + wy, qz = z + wz;
    const ql = Math.hypot(qx, qy, qz);
    qx /= ql; qy /= ql; qz /= ql;
    const t = locator.locateTriangle(qx, qy, qz, bary, i);
    const a = mesh.triangles[3 * t], b = mesh.triangles[3 * t + 1], c = mesh.triangles[3 * t + 2];
    wNear[i] = bary[0] >= bary[1] && bary[0] >= bary[2] ? a : bary[1] >= bary[2] ? b : c;
    crust[i] = bary[0] * crust0[a] + bary[1] * crust0[b] + bary[2] * crust0[c];
    dDiv[i] = bary[0] * dDiv0[a] + bary[1] * dDiv0[b] + bary[2] * dDiv0[c];
    const ba = Math.min(tect.bdist[a], 4000), bb = Math.min(tect.bdist[b], 4000), bc = Math.min(tect.bdist[c], 4000);
    bd[i] = bary[0] * ba + bary[1] * bb + bary[2] * bc;
    marginIn[i] = bary[0] * marginIn0[a] + bary[1] * marginIn0[b] + bary[2] * marginIn0[c];
  }
  const plate = new Uint8Array(n);
  for (let i = 0; i < n; i++) plate[i] = tect.plate[wNear[i]];

  // ---------------------------------------------------------------- coastline displacement
  // Signed distance (km) to the crust = 0.5 isoline, with sub-cell crossing positions.
  const nCoast = new Noise3(rng.fork("coast"));
  const ct = new Float32Array(n);
  {
    const src: number[] = [], off: number[] = [];
    for (let i = 0; i < n; i++) {
      const ci = crust[i];
      let best = Infinity;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const cj = crust[adj[k]];
        if ((ci >= 0.5) !== (cj >= 0.5)) {
          const t = (ci - 0.5) / (ci - cj);
          best = Math.min(best, t * edgeLen[k]);
        }
      }
      if (best < Infinity) { src.push(i); off.push(best); }
    }
    const MAXD = 1600 * L;
    const sdist = distanceField(mesh, edgeLen, src, MAXD, undefined, off).dist;
    const Wl = 330 * L, Ws = 230 * L;
    for (let i = 0; i < n; i++) {
      const d = sdist[i] === Infinity ? MAXD : sdist[i];
      const sd = crust[i] >= 0.5 ? d : -d;
      if (Math.abs(sd) >= 1300 * L) { ct[i] = crust[i]; continue; }
      const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
      const absLat = Math.abs(mesh.lat[i]) * 180 / Math.PI;
      // Regional roughness: smooth coasts in some regions, ragged ones in others.
      const region = smoothstep(-0.35, 0.45, nCoast.fbm(x * 1.1 + 3.3, y * 1.1 - 7.1, z * 1.1 + 1.9, 2));
      // Active margins have straight coasts (the trench is right offshore).
      const active = 0.3 + 0.7 * smoothstep(120 * L, 600 * L, bd[i]);
      const amp = 300 * L * style.coastRough * (0.3 + 0.95 * region) * active;
      // Domain-warped fbm: lobed peninsulas and curved gulfs rather than round blobs.
      const qx = 0.35 * nCoast.fbm(x * 3 + 1.1, y * 3 + 4.4, z * 3 - 2.2, 2);
      const qy = 0.35 * nCoast.fbm(x * 3 - 6.1, y * 3 - 1.4, z * 3 + 3.2, 2);
      let delta = amp * (nCoast.fbm((x + qx) * 4.2, (y + qy) * 4.2, (z - qx) * 4.2, 4, 2.1, 0.55) * 1.3);
      // (The ridged high-latitude term below is not damped on active margins: Chile,
      // Alaska and British Columbia are both active and fjorded.)
      // High latitudes: glacial coasts with narrow fjords cutting in and skerry chains offshore.
      const hl = smoothstep(46, 62, absLat) * (1 - smoothstep(80, 88, absLat));
      if (hl > 0 && Math.abs(sd) < 700 * L) {
        const f1 = nCoast.ridged(x * 9.5 + 2.2, y * 9.5 - 5.3, z * 9.5 + 8.8, 2);
        const f2 = nCoast.ridged(x * 8.1 - 4.4, y * 8.1 + 1.7, z * 8.1 - 3.3, 2);
        delta += hl * style.coastRough * 260 * L * (f2 * f2 * f2 - 1.1 * f1 * f1 * f1 * f1);
      }
      // Moving the coastline by `delta` ≈ adding the change of a typical coastal crust
      // profile; the original crust structure (shelf seas, slopes) is preserved, and
      // displacement never digs below shelf depth (bays are shallow; fjords come later).
      const prof = (v: number) => (v >= 0 ? 0.5 + 0.5 * Math.tanh(v / Wl) : 0.5 + 0.5 * Math.tanh(v / Ws));
      let dc = prof(sd + delta) - prof(sd);
      if (dc < 0) dc = Math.max(dc, Math.min(0, 0.43 - crust[i]));
      const w = 1 - smoothstep(500 * L, 1300 * L, Math.abs(sd));
      ct[i] = crust[i] + w * dc;
    }
  }

  // ---------------------------------------------------------------- paleo sutures
  // An older generation of plates whose boundaries survive inside today's continents
  // as long, eroded fold belts. Distance to the paleo-Voronoi edges, on warped positions.
  const paleo = new Float32Array(n);
  const paleoH = new Float32Array(n);
  {
    const pr = rng.fork("paleo");
    const K = Math.max(7, Math.round(P * 1.1));
    const seeds: number[][] = [];
    for (let k = 0; k < K; k++) seeds.push(pr.unitVector());
    const height = new Float32Array(K * K);
    for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
      // Most sutures are worn down to hill country; a few are still high and rugged.
      const r = pr.next();
      const h = r < 0.25 ? 0 : r < 0.75 ? 0.45 + 0.5 * pr.next() : 1.0 + 1.3 * pr.next();
      height[a * K + b] = h; height[b * K + a] = h;
    }
    const nP = new Noise3(pr.fork("paleo-warp"));
    const halfW = (150 * L) / radiusKm;
    for (let i = 0; i < n; i++) {
      if (ct[i] < 0.45) continue;
      let x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
      const ox = x, oy = y, oz = z;
      x += 0.16 * nP.fbm(ox * 1.4, oy * 1.4, oz * 1.4, 3); y += 0.16 * nP.fbm(ox * 1.4 + 5, oy * 1.4, oz * 1.4, 3); z += 0.16 * nP.fbm(ox * 1.4, oy * 1.4 - 5, oz * 1.4, 3);
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      let b1 = -2, b2 = -2, k1 = 0, k2 = 0;
      for (let k = 0; k < K; k++) {
        const d = x * seeds[k][0] + y * seeds[k][1] + z * seeds[k][2];
        if (d > b1) { b2 = b1; k2 = k1; b1 = d; k1 = k; } else if (d > b2) { b2 = d; k2 = k; }
      }
      const edge = 0.5 * (Math.acos(Math.min(1, b2)) - Math.acos(Math.min(1, b1)));
      const hgt = height[k1 * K + k2];
      const along = smoothstep(-0.4, 0.15, nP.fbm(ox * 2.2 + 3, oy * 2.2, oz * 2.2 + 7, 2));
      paleo[i] = hgt > 0 ? Math.exp(-((edge / halfW) ** 2)) * along : 0;
      paleoH[i] = hgt;
    }
  }

  // ---------------------------------------------------------------- noise fields
  const nRelief = new Noise3(rng.fork("relief"));
  const nRidge = new Noise3(rng.fork("ridge"));
  const nAlong = new Noise3(rng.fork("along"));

  // Crust on each side of each boundary cell, measured on the unwarped field.
  const crustAcross = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!tect.isBoundary[i]) continue;
    const o = tect.other[i];
    let s = 0, w = 0;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (tect.plate[j] === o) { s += crust0[j]; w++; }
    }
    crustAcross[i] = w ? s / w : 0;
  }

  const elevation = new Float32Array(n);
  const volcanism = new Float32Array(n);
  const seismicity = new Float32Array(n);
  const orogeny = new Float32Array(n);
  const oldOrogen = new Float32Array(n);
  const rift = new Float32Array(n);
  const bump = (d: number, c: number, w: number) => { const t = (d - c) / w; return Math.exp(-t * t); };

  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const c = ct[i];

    // Abyssal depth from crust age (distance to ridge), plus abyssal hills.
    let ocean = 0;
    if (c < 0.47) {
      const age = dDiv[i] / (900 * L);
      ocean = -(2.6 + 2.4 * (1 - Math.exp(-age))) + 0.22 * nRelief.fbm(x * 9, y * 9, z * 9, 2);
      const rd = Math.exp(-dDiv[i] / (60 * L));
      if (rd > 0.01) ocean += 0.35 * rd * (nRidge.ridged(x * 14, y * 14, z * 14, 2) - 0.5);
    }
    // Hypsometric mapping of crust → elevation.
    let e: number;
    if (c <= 0.3) e = ocean;
    else if (c <= 0.44) e = ocean + (-0.4 - ocean) * smoothstep(0.3, 0.44, c);
    else if (c <= 0.5) e = -0.4 + 0.36 * ((c - 0.44) / 0.06);
    else e = -0.04 + 0.6 * smoothstep(0.5, 0.9, c);
    const landness = smoothstep(0.5, 0.78, c);
    if (landness > 0) {
      // Broad basins and swells (Congo basin, East African swell): low amplitude, large scale.
      const swell = nRelief.fbm(x * 1.4 + 4.4, y * 1.4, z * 1.4 - 8.1, 3);
      let interior = style.plateau * 0.6 * swell;
      // A few highlands (Ethiopia, Anatolia, Iran, Mexico): raised blocks with rugged tops and
      // steep rims that erosion dissects.
      const pl = nRelief.fbm(x * 2.1 - 3.7, y * 2.1 + 9.1, z * 2.1 + 2.6, 3);
      const hiland = smoothstep(0.25, 0.34, pl + 0.06 * swell);
      if (hiland > 0) interior += style.plateau * hiland * (0.45 + 0.75 * nRidge.ridged(x * 5.5 - 2, y * 5.5 + 4, z * 5.5 + 1, 3));
      // Great escarpments behind passive margins: an uplifted rim 150–400 km inland.
      const mi = marginIn[i];
      if (mi < 900 * L) {
        const esc = smoothstep(-0.15, 0.35, nAlong.fbm(x * 2.4 - 1.1, y * 2.4 + 6.2, z * 2.4 + 3.3, 2));
        interior += esc * (0.6 + 0.9 * nRidge.ridged(x * 7.5 + 1, y * 7.5, z * 7.5 - 2, 3)) * bump(mi, 300 * L, 150 * L);
      }
      // Fine texture.
      interior += 0.08 * nRelief.fbm(x * 12, y * 12, z * 12, 2);
      e += landness * interior;
      // Old orogens: eroded fold belts along paleo-plate sutures (Urals, Appalachians, Caledonides).
      const old = paleo[i] * landness * smoothstep(200 * L, 550 * L, bd[i]);
      oldOrogen[i] = old;
      if (old > 0.002) e += old * paleoH[i] * (0.35 + 0.9 * nRidge.ridged(x * 7, y * 7, z * 7, 4));
    }

    // ---- Active boundary relief.
    const s = tect.bsrc[wNear[i]];
    let U = 0, volc = 0, seis = 0;
    if (s >= 0 && bd[i] < 1300 * L) {
      const d = bd[i] * (1 + 0.25 * nAlong.fbm(x * 5, y * 5, z * 5, 2)) + 40 * L * nAlong.fbm(x * 9 + 2, y * 9, z * 9, 2);
      const own = tect.plate[s];
      const o = tect.other[s];
      const k = tect.kind[s];
      const cv = tect.conv[s];
      const along = 0.5 + 0.5 * nAlong.fbm(x * 2.6 + 3.3, y * 2.6 - 1.1, z * 2.6 + 7.7, 3); // 0..1 variation along strike
      const ownC = crust0[s] >= 0.5;
      const othC = crustAcross[s] >= 0.5;
      const ridge = k === BoundaryKind.Divergent ? 1 : 0.45 + 0.9 * nRidge.ridged(x * 6.5, y * 6.5, z * 6.5, 4);
      if (ownC && othC && k !== BoundaryKind.Divergent) {
        // Continent meets continent. Convergence builds Himalaya + Tibet; even oblique or
        // slow motion leaves a suture range (Zagros, Alps, Caucasus).
        const sc = clamp(Math.max(cv, 0.3 * tect.shear[s]) / 0.7, 0.3, 1.3) * (0.55 + 0.75 * along);
        const over = tect.density[own] <= tect.density[o];
        U += sc * 4.4 * Math.exp(-((d / (240 * L)) ** 2)) * ridge;
        if (over) U += sc * sc * 2.4 * smoothstep(950 * L, 350 * L, d) * (0.75 + 0.25 * ridge);
        else U += sc * 0.5 * smoothstep(450 * L, 100 * L, d) - sc * 0.25 * bump(d, 380 * L, 110 * L); // foreland basin
        volc = Math.max(volc, 0.12 * clamp(sc, 0, 1) * bump(d, 250 * L, 150 * L));
        seis = Math.max(seis, clamp(sc, 0, 1) * Math.exp(-d / (300 * L)));
      } else if (k === BoundaryKind.Convergent) {
        const sc = clamp(cv / 0.7, 0, 1.3) * (0.55 + 0.75 * along);
        const ownDense = tect.density[own] > tect.density[o];
        if (ownC && !othC) {
          // Overriding continent above a subducting ocean: Andes.
          U += sc * 4.8 * bump(d, 160 * L, 150 * L) * ridge;
          U += sc * sc * 1.7 * smoothstep(700 * L, 220 * L, d) * smoothstep(60 * L, 200 * L, d) * (0.7 + 0.3 * ridge);
          volc = Math.max(volc, clamp(sc, 0, 1) * bump(d, 170 * L, 80 * L));
        } else if (!ownC && othC) {
          // Subducting oceanic plate: trench hugging the boundary, outer rise beyond.
          U -= sc * 2.4 * Math.exp(-d / (65 * L));
          U += sc * 0.3 * bump(d, 220 * L, 90 * L);
        } else {
          // Ocean–ocean: the denser plate subducts; the other carries an island arc.
          if (ownDense) {
            U -= sc * 2.6 * Math.exp(-d / (65 * L));
          } else {
            const isl = 0.75 + 0.9 * nAlong.fbm(x * 11 + 1, y * 11 - 4, z * 11 + 2, 3);
            U += sc * 4.6 * bump(d, 130 * L, 70 * L) * Math.max(0, isl);
            U += sc * 0.8 * bump(d, 300 * L, 160 * L); // back-arc swell
            volc = Math.max(volc, clamp(sc, 0, 1) * bump(d, 130 * L, 60 * L));
          }
        }
        seis = Math.max(seis, clamp(sc, 0, 1) * Math.exp(-d / (260 * L)));
      } else if (k === BoundaryKind.Divergent) {
        const sd = clamp(-cv / 0.7, 0, 1.3);
        const mat = tect.pairMaturity[own * P + o];
        if (ownC && mat < 0.25) {
          // Continental rift: graben with uplifted shoulders.
          const r = (0.6 + 0.6 * sd) * (0.5 + along);
          const g = smoothstep(80 * L, 25 * L, d);
          U += r * (-1.5 * g + 1.0 * bump(d, 140 * L, 70 * L));
          rift[i] = g;
          volc = Math.max(volc, 0.6 * r * bump(d, 50 * L, 70 * L));
        } else {
          volc = Math.max(volc, 0.35 * sd * Math.exp(-d / (50 * L)));
        }
        seis = Math.max(seis, 0.45 * sd * Math.exp(-d / (120 * L)));
      } else if (k === BoundaryKind.Transform) {
        const st = clamp(tect.shear[s] / 0.8, 0, 1.2);
        U += st * 0.6 * Math.exp(-d / (70 * L)) * (ridge - 0.6);
        seis = Math.max(seis, 0.8 * st * Math.exp(-d / (160 * L)));
      }
    }
    orogeny[i] = Math.max(0, U);
    e += U;
    elevation[i] = e;
    volcanism[i] = volc;
    seismicity[i] = clamp(seis, 0, 1);
  }

  // ---------------------------------------------------------------- hotspots
  const hRng = rng.fork("hotspots");
  const nHot = style.hotspots;
  const hotspots: Hotspot[] = [];
  const spacing = mesh.meanSpacing;
  for (let h = 0; h < nHot; h++) {
    const [hx, hy, hz] = hRng.unitVector();
    const start = locator.find(hx, hy, hz);
    const pl = tect.plates[plate[start]];
    const oceanic = ct[start] < 0.45;
    const steps = oceanic ? hRng.int(6, 16) : 2;
    const stepAngle = spacing * hRng.range(1.0, 1.5);
    const tau = hRng.range(3, 7);
    const amp0 = oceanic ? hRng.range(5.2, 7.0) : hRng.range(0.6, 1.2);
    const chain: number[] = [];
    // Rotate the hotspot position with the plate: older edifices lie downstream of plate motion.
    const [ax, ay, az] = pl.axis;
    for (let t = 0; t < steps; t++) {
      const th = t * stepAngle * Math.sign(pl.speed || 1);
      const c = Math.cos(th), sn = Math.sin(th);
      const kd = (ax * hx + ay * hy + az * hz) * (1 - c);
      const px = hx * c + (ay * hz - az * hy) * sn + ax * kd;
      const py = hy * c + (az * hx - ax * hz) * sn + ay * kd;
      const pz = hz * c + (ax * hy - ay * hx) * sn + az * kd;
      const cell = locator.find(px, py, pz, chain.length ? chain[chain.length - 1] : start);
      if (chain.length && chain[chain.length - 1] === cell) continue;
      chain.push(cell);
      const amp = amp0 * Math.exp(-t / tau) * (0.75 + 0.5 * hRng.next());
      const radius = (oceanic ? 0.9 : 2.5) * spacing;
      paintBump(mesh, cell, radius, (j, w) => {
        elevation[j] += amp * w;
        if (t < 2) volcanism[j] = Math.max(volcanism[j], (t === 0 ? 1 : 0.6) * w);
        else volcanism[j] = Math.max(volcanism[j], 0.15 * w);
      });
    }
    hotspots.push({ cell: start, chain, oceanic });
  }

  // ---------------------------------------------------------------- boundary field (warped)
  const boundary = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      if (plate[adj[k]] !== plate[i]) {
        const s = tect.bsrc[wNear[i]];
        boundary[i] = s >= 0 ? tect.kind[s] || BoundaryKind.Transform : BoundaryKind.Transform;
        break;
      }
    }
  }

  return { elevation, crust: ct, volcanism, seismicity, plate, boundary, orogeny, oldOrogen, rift, boundaryDist: bd, hotspots };
}

/**
 * Continental interiors stand higher than their coasts (Africa's plateau, the
 * Brazilian and Deccan highlands): once a provisional sea level is known, land
 * is lifted by an amount that grows with distance from the coast and varies
 * between regions. Monotone in elevation for land, so coastlines are kept;
 * small islands stay low.
 */
export function liftInteriors(mesh: SphereMesh, elevation: Float32Array, seaLevel: number, edgeLen: Float32Array, radiusKm: number, rng: Rng, style: WorldStyle): void {
  const n = mesh.n;
  const L = Math.pow(radiusKm / 6371, 0.6);
  const src: number[] = [];
  for (let i = 0; i < n; i++) {
    if (elevation[i] < seaLevel) continue;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (elevation[mesh.adj[k]] < seaLevel) { src.push(i); break; }
  }
  const d = distanceField(mesh, edgeLen, src, 1500 * L, (_a, b) => elevation[b] >= seaLevel).dist;
  const noise = new Noise3(rng.fork("lift"));
  for (let i = 0; i < n; i++) {
    if (elevation[i] < seaLevel) continue;
    const di = d[i] === Infinity ? 1500 * L : d[i];
    const x = mesh.xyz[3 * i], y = mesh.xyz[3 * i + 1], z = mesh.xyz[3 * i + 2];
    const A = 0.2 + 0.5 * smoothstep(-0.35, 0.35, noise.fbm(x * 1.2, y * 1.2, z * 1.2, 2));
    elevation[i] += style.plateau * A * smoothstep(60 * L, 1000 * L, di);
  }
}

/** Visit cells within angular `radius` of `center` (BFS on the mesh) with a gaussian weight. */
function paintBump(mesh: SphereMesh, center: number, radius: number, fn: (cell: number, w: number) => void): void {
  const { xyz, adjStart, adj } = mesh;
  const cx = xyz[3 * center], cy = xyz[3 * center + 1], cz = xyz[3 * center + 2];
  const seen = new Set<number>([center]);
  const queue = [center];
  const lim = Math.cos(radius * 2.2);
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const dot = xyz[3 * c] * cx + xyz[3 * c + 1] * cy + xyz[3 * c + 2] * cz;
    const ang = Math.acos(Math.min(1, dot));
    fn(c, Math.exp(-((ang / radius) ** 2)));
    for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
      const u = adj[k];
      if (seen.has(u)) continue;
      const du = xyz[3 * u] * cx + xyz[3 * u + 1] * cy + xyz[3 * u + 2] * cz;
      if (du < lim) continue;
      seen.add(u);
      queue.push(u);
    }
  }
}
