/**
 * Elevation from plate tectonics plus multi-scale noise.
 *
 * 1. A "continentalness" field (crust type) starts from plate types. Continental
 *    plates are cut back near divergent and transform boundaries (passive
 *    margins: the continent sits inside its plate with an oceanic fringe that
 *    widens with the maturity of the spreading ridge), but reach right up to
 *    convergent boundaries (active margins). Rare continental fragments float
 *    on oceanic plates.
 * 2. The whole tectonic framework is sampled through a smooth domain warp so
 *    that plate outlines, coasts and mountain belts curve and swirl together
 *    instead of looking like Voronoi polygons.
 * 3. A hypsometric mapping turns crust into elevation: abyssal plains whose
 *    depth follows the age–depth relation away from mid-ocean ridges, a steep
 *    continental slope, a shelf, low coastal plains rising to interior
 *    plateaus.
 * 4. Boundary-driven relief, each with its own cross-section profile:
 *    ocean–continent subduction (trench + coastal cordillera + volcanic arc +
 *    back-arc plateau), continent–continent collision (high range + broad
 *    plateau on the overriding side), ocean–ocean subduction (trench + island
 *    arc), continental rifts (graben + shoulders), transform ridges.
 * 5. Hotspot chains carried along by plate motion, old eroded orogens and
 *    basins in continental interiors, and high-frequency coast noise that is
 *    stronger at high latitudes (ragged, fjord-like coasts and skerries).
 */
import type { SphereMesh } from "../core/sphere";
import { CellLocator } from "../core/sphere";
import { Rng } from "../core/rng";
import { Noise3 } from "../core/noise";
import { BoundaryKind } from "../world/types";
import type { Tectonics } from "./plates";
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
  /** Crust continentalness 0..1 after warping (≥0.5 = continental crust). */
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
): ElevationResult {
  const n = mesh.n;
  const { xyz, adjStart, adj } = mesh;
  const P = tect.plates.length;
  // Length scale relative to Earth, damped so features remain resolvable on small planets.
  const L = Math.pow(radiusKm / 6371, 0.6);

  // ---------------------------------------------------------------- crust
  // Margin sources: divergent and transform boundary cells of continental plates.
  // Margin widths shrink on small plates (a small continent would otherwise drown in
  // its own passive margins), and the whole set is relaxed until continental crust
  // comfortably exceeds the land target.
  const MMAX = 2500;
  const noiseC = new Noise3(rng.fork("crust-noise"));
  const crust0 = new Float32Array(n);
  const landTarget = 1 - oceanFraction;
  // Noise fields used by the crust model, evaluated once (the margin loop may run several times).
  const nzWobble = new Float32Array(n), nzSliver = new Float32Array(n), nzMicro = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    if (!tect.plates[tect.plate[i]].oceanic) {
      nzWobble[i] = noiseC.fbm(x * 3.1, y * 3.1, z * 3.1, 3);
      nzSliver[i] = noiseC.fbm(x * 2.0 + 21.1, y * 2.0 - 13.3, z * 2.0 + 4.4, 3);
    } else {
      nzMicro[i] = noiseC.fbm(x * 2.3 + 11.7, y * 2.3 - 3.1, z * 2.3 + 5.5, 4);
    }
  }
  let mScale = 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const marginSrc: number[] = [];
    const marginOff: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!tect.isBoundary[i]) continue;
      const p = tect.plate[i];
      if (tect.plates[p].oceanic) continue;
      const o = tect.other[i];
      const k = tect.kind[i];
      let M = -1;
      if (k === BoundaryKind.Divergent) {
        const mat = tect.pairMaturity[p * P + o];
        if (mat >= 0.25) M = (250 + 1250 * (mat - 0.25)) * L * (0.7 + 0.5 * clamp(-tect.conv[i] / 0.8, 0, 1));
      } else if (k === BoundaryKind.Transform) {
        M = 220 * L;
      } else if (tect.plates[o].oceanic && tect.conv[i] < 0.12) {
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
      if (!tect.plates[p].oceanic) {
        const signed = mf.dist[i] === Infinity ? 1e9 : mf.dist[i] - MMAX; // distance beyond the margin
        const wobble = 160 * L * nzWobble[i];
        crust0[i] = smoothstep(-200 * L, 260 * L, signed + wobble);
        // Rifted slivers (Madagascar, Sri Lanka, Zealandia): crust left stranded offshore,
        // parallel to a passive margin, where a sparse noise mask allows.
        if (signed < -150 * L && signed > -1400 * L) {
          const mask = nzSliver[i];
          const band = Math.exp(-(((signed + 520 * L * mScale) / (200 * L)) ** 2));
          crust0[i] = Math.max(crust0[i], 0.95 * band * smoothstep(0.18, 0.34, mask));
        }
      } else {
        // Microcontinents / oceanic plateaus: very rare fragments of continental crust in the oceans.
        crust0[i] = 0.9 * smoothstep(0.47, 0.6, nzMicro[i]);
      }
      if (crust0[i] >= 0.5) contArea += mesh.area[i] / (4 * Math.PI);
    }
    // Aim for continental crust ≈ 1.12–1.4 × the land target (the rest is shelf).
    if (contArea < landTarget * 1.12) mScale *= 0.6;
    else if (contArea > landTarget * 1.4) mScale *= 1.7;
    else break;
  }
  // Inland seas / large interior basins on continents (Mediterranean, Hudson Bay, Black Sea…).
  for (let i = 0; i < n; i++) {
    if (crust0[i] < 0.5) continue;
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const s = noiseC.fbm(x * 2.6 - 7.3, y * 2.6 + 2.2, z * 2.6 + 9.9, 4);
    crust0[i] -= 0.75 * smoothstep(0.41, 0.54, s);
  }
  smoothField(mesh, crust0, 2, 0.5);
  // Calibrate: shift crust so that the deep ocean (beyond the shelf break) covers
  // oceanFraction − shelfFraction of the planet; the rest is continental shelf and land.
  {
    const q = quantileBisect(crust0, mesh.area, clamp(oceanFraction - 0.045, 0.05, 0.95));
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
  const A1 = 0.17, F1 = 1.3, A2 = 0.045, F2 = 4.2;
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    let wx = A1 * warpNoise.fbm(x * F1 + 1.3, y * F1 + 7.7, z * F1 - 2.1, 3) + A2 * warpNoise.fbm(x * F2 + 4.4, y * F2 - 1.9, z * F2 + 8.2, 3);
    let wy = A1 * warpNoise.fbm(x * F1 - 5.1, y * F1 + 2.4, z * F1 + 6.6, 3) + A2 * warpNoise.fbm(x * F2 - 3.3, y * F2 + 5.5, z * F2 - 7.4, 3);
    let wz = A1 * warpNoise.fbm(x * F1 + 9.2, y * F1 - 6.3, z * F1 + 0.4, 3) + A2 * warpNoise.fbm(x * F2 + 2.8, y * F2 + 3.1, z * F2 + 1.6, 3);
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
  }
  const plate = new Uint8Array(n);
  for (let i = 0; i < n; i++) plate[i] = tect.plate[wNear[i]];

  // ---------------------------------------------------------------- paleo sutures
  // An older generation of plates whose boundaries survive inside today's continents
  // as long, eroded fold belts. Distance to the paleo-Voronoi edges, on warped positions.
  const paleo = new Float32Array(n);
  const paleoH = new Float32Array(n);
  {
    const pr = rng.fork("paleo");
    const K = Math.max(6, Math.round(P * 0.9));
    const seeds: number[][] = [];
    for (let k = 0; k < K; k++) seeds.push(pr.unitVector());
    const height: number[] = [];
    for (let k = 0; k < K * K; k++) height.push(0);
    for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
      // Some sutures are old and worn down to hills, a few are still high and rugged.
      const h = pr.next() < 0.3 ? 0 : 0.5 + 1.6 * Math.pow(pr.next(), 1.5);
      height[a * K + b] = h; height[b * K + a] = h;
    }
    const nP = new Noise3(pr.fork("paleo-warp"));
    const halfW = (130 * L) / radiusKm;
    for (let i = 0; i < n; i++) {
      let x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
      x += 0.16 * nP.fbm(x * 1.4, y * 1.4, z * 1.4, 3); y += 0.16 * nP.fbm(x * 1.4 + 5, y * 1.4, z * 1.4, 3); z += 0.16 * nP.fbm(x * 1.4, y * 1.4 - 5, z * 1.4, 3);
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      let b1 = -2, b2 = -2, k1 = 0, k2 = 0;
      for (let k = 0; k < K; k++) {
        const d = x * seeds[k][0] + y * seeds[k][1] + z * seeds[k][2];
        if (d > b1) { b2 = b1; k2 = k1; b1 = d; k1 = k; } else if (d > b2) { b2 = d; k2 = k; }
      }
      const edge = 0.5 * (Math.acos(Math.min(1, b2)) - Math.acos(Math.min(1, b1)));
      const hgt = height[k1 * K + k2];
      const along = smoothstep(-0.25, 0.25, nP.fbm(x * 2.2 + 3, y * 2.2, z * 2.2 + 7, 2));
      paleo[i] = hgt > 0 ? Math.exp(-((edge / halfW) ** 2)) * along : 0;
      paleoH[i] = hgt;
    }
  }

  // ---------------------------------------------------------------- noise fields
  const nCoast = new Noise3(rng.fork("coast"));
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
    const absLat = Math.abs(mesh.lat[i]) * 180 / Math.PI;
    // Coastline noise: more ragged at high latitudes (glacial coasts).
    const hl = smoothstep(42, 68, absLat);
    const transition = 1 - Math.abs(2 * crust[i] - 1); // 1 where crust ≈ 0.5
    const coastAmp = 0.13 + 0.22 * transition;
    let cn = coastAmp * (nCoast.fbm(x * 3.3, y * 3.3, z * 3.3, 4) + 0.4 * nCoast.fbm(x * 8 + 3, y * 8 - 1, z * 8 + 2, 3));
    if (hl > 0) cn += hl * (0.12 + 0.12 * transition) * (nCoast.ridged(x * 13, y * 13, z * 13, 3) - 0.35);
    const ct = crust[i] + cn;

    // Abyssal depth from crust age (distance to ridge), plus abyssal hills.
    let ocean = 0;
    if (ct < 0.47) {
      const age = dDiv[i] / (900 * L);
      ocean = -(2.6 + 2.4 * (1 - Math.exp(-age))) + 0.22 * nRelief.fbm(x * 9, y * 9, z * 9, 3);
      const rd = Math.exp(-dDiv[i] / (60 * L));
      if (rd > 0.01) ocean += 0.35 * rd * (nRidge.ridged(x * 14, y * 14, z * 14, 2) - 0.5);
    }
    // Hypsometric mapping of crust → elevation.
    let e: number;
    if (ct <= 0.3) e = ocean;
    else if (ct <= 0.47) e = ocean + (-0.35 - ocean) * smoothstep(0.3, 0.47, ct);
    else if (ct <= 0.55) e = -0.35 + 0.3 * ((ct - 0.47) / 0.08);
    else e = 0.08 + 0.48 * smoothstep(0.55, 0.82, ct);
    const landness = smoothstep(0.5, 0.75, ct);
    if (landness > 0) {
      // Continental interior relief: broad plateaus and sedimentary basins (low frequency,
      // so interiors read as a few large provinces rather than blotches).
      const plateau = nRelief.fbm(x * 1.6 + 4.4, y * 1.6, z * 1.6 - 8.1, 3);
      e += landness * (1.15 * smoothstep(0.08, 0.5, plateau) + 0.3 * Math.min(0, plateau) + 0.07 * nRelief.fbm(x * 11, y * 11, z * 11, 3));
      // Old orogens: eroded fold belts along paleo-plate sutures (Urals, Appalachians, Caledonides).
      const old = paleo[i] * landness * smoothstep(250 * L, 650 * L, bd[i]);
      oldOrogen[i] = old;
      if (old > 0.002) e += old * paleoH[i] * (0.45 + 0.85 * nRidge.ridged(x * 7, y * 7, z * 7, 4));
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
      const ridge = k === BoundaryKind.Divergent ? 1 : 0.45 + 0.9 * nRidge.ridged(x * 6.5, y * 6.5, z * 6.5, 5);
      if (k === BoundaryKind.Convergent) {
        const sc = clamp(cv / 0.7, 0, 1.3) * (0.55 + 0.75 * along);
        const ownDense = tect.density[own] > tect.density[o];
        if (ownC && !othC) {
          // Overriding continent above a subducting ocean: Andes.
          U += sc * 4.3 * bump(d, 150 * L, 130 * L) * ridge;
          U += sc * sc * 1.5 * smoothstep(650 * L, 220 * L, d) * smoothstep(60 * L, 200 * L, d) * (0.7 + 0.3 * ridge);
          volc = Math.max(volc, clamp(sc, 0, 1) * bump(d, 170 * L, 80 * L));
        } else if (!ownC && othC) {
          // Subducting oceanic plate: trench hugging the boundary, outer rise beyond.
          U -= sc * 2.4 * Math.exp(-d / (65 * L));
          U += sc * 0.3 * bump(d, 220 * L, 90 * L);
        } else if (ownC && othC) {
          // Continental collision: Himalaya + Tibet on the overriding side.
          const over = !ownDense;
          U += sc * 3.6 * Math.exp(-((d / (210 * L)) ** 2)) * ridge;
          if (over) U += sc * 2.4 * smoothstep(900 * L, 350 * L, d) * (0.75 + 0.25 * ridge);
          else U += sc * 0.6 * smoothstep(450 * L, 100 * L, d);
          volc = Math.max(volc, 0.12 * clamp(sc, 0, 1) * bump(d, 250 * L, 150 * L));
        } else {
          // Ocean–ocean: the denser plate subducts; the other carries an island arc.
          if (ownDense) {
            U -= sc * 2.6 * Math.exp(-d / (65 * L));
          } else {
            const isl = 0.35 + 0.9 * nAlong.fbm(x * 11 + 1, y * 11 - 4, z * 11 + 2, 3) + 0.4;
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
  const nHot = hRng.int(3, 7);
  const hotspots: Hotspot[] = [];
  const spacing = mesh.meanSpacing;
  for (let h = 0; h < nHot; h++) {
    const [hx, hy, hz] = hRng.unitVector();
    const start = locator.find(hx, hy, hz);
    const pl = tect.plates[plate[start]];
    const oceanic = crust[start] < 0.45;
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
      // Paint a bump around `cell`, BFS-limited.
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

  return { elevation, crust, volcanism, seismicity, plate, boundary, orogeny, oldOrogen, rift, boundaryDist: bd, hotspots };
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
