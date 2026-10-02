/**
 * Climate: temperature, seasonality, prevailing winds and precipitation.
 *
 * Temperature
 *   - Annual-mean and seasonal insolation are integrated numerically for the
 *     planet's axial tilt; a mildly non-linear transfer (calibrated to Earth's
 *     zonal mean) turns insolation into sea-level temperature.
 *   - Ocean currents are inferred from basin geometry: on the western side of
 *     each ocean basin warm boundary currents in the subtropics and cold ones
 *     at high latitudes; on the eastern side cold upwelling currents in the
 *     subtropics (fog-desert coasts) and warm drifts at high latitudes
 *     (mild, wet west coasts like north-west Europe).
 *   - Maritime influence is advected inland along the winds; it moderates the
 *     seasonal range and replaces the continental anomaly (hot subtropical
 *     interiors, frigid high-latitude interiors). Lapse rate 6.5 °C/km.
 *
 * Wind
 *   Three-cell circulation (trades, westerlies, polar easterlies) around an
 *   ITCZ whose latitude follows the land distribution (a crude monsoon),
 *   with flow deflected along mountain ranges and slowed over land.
 *
 * Precipitation
 *   Specific humidity is evaporated from the sea (Clausius–Clapeyron: warm seas
 *   evaporate much more), advected downwind by a semi-Lagrangian operator on
 *   the cell graph, and rained out according to large-scale ascent (ITCZ,
 *   storm tracks) or subsidence (subtropical highs, cold currents), forced
 *   ascent on windward slopes (orographic rain; leeward rain shadows emerge
 *   because the air has already been wrung out), and saturation when air
 *   cools. Land recycles part of its rain (evapotranspiration), which lets
 *   moisture penetrate continental interiors. The result is calibrated to an
 *   Earth-like global mean of ~1000 mm/yr.
 */
import type { SphereMesh } from "../core/sphere";
import { CellLocator } from "../core/sphere";
import { Noise3 } from "../core/noise";
import { Rng } from "../core/rng";
import { clamp, gradientField, smoothField, smoothstep } from "./util";

export interface ClimateResult {
  temperature: Float32Array;
  tempRange: Float32Array;
  precipitation: Float32Array;
  wind: Float32Array;
  /** Potential evapotranspiration, mm/yr. */
  pet: Float32Array;
  /** Mean of monthly temperatures clamped to 0..30 °C (Holdridge biotemperature). */
  biotemp: Float32Array;
  /** 0..1: strength of a summer-dry (Mediterranean) regime. */
  summerDry: Float32Array;
  /** 0..1: strength of a tropical dry season (savanna regime). */
  drySeason: Float32Array;
  /** 0..1: maritime influence (1 = ocean). */
  maritime: Float32Array;
  /** Sea surface / advected current temperature anomaly, °C. */
  currentAnom: Float32Array;
  /** Latitude relative to the local ITCZ, degrees. */
  climLat: Float32Array;
}

const DEG = Math.PI / 180;

/** Annual-mean insolation and the amplitude of its annual cycle, W/m², per integer latitude −90..90. */
export function insolationTable(tiltDeg: number): { mean: Float64Array; amp: Float64Array } {
  const S0 = 1361;
  const mean = new Float64Array(181);
  const amp = new Float64Array(181);
  const eps = tiltDeg * DEG;
  const N = 72;
  for (let li = 0; li <= 180; li++) {
    const phi = (li - 90) * DEG;
    let sum = 0, re = 0, im = 0;
    for (let d = 0; d < N; d++) {
      const L = (2 * Math.PI * d) / N;
      const dec = Math.asin(Math.sin(eps) * Math.sin(L));
      const x = -Math.tan(phi) * Math.tan(dec);
      const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
      const Q = (S0 / Math.PI) * (h0 * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(h0));
      sum += Q;
      re += Q * Math.cos(L);
      im += Q * Math.sin(L);
    }
    mean[li] = sum / N;
    amp[li] = (2 * Math.hypot(re, im)) / N;
  }
  return { mean, amp };
}

const tableAt = (t: Float64Array, latDeg: number): number => {
  const x = clamp(latDeg + 90, 0, 180);
  const i = Math.min(179, Math.floor(x));
  const f = x - i;
  return t[i] * (1 - f) + t[i + 1] * f;
};

/** Sea-level zonal-mean temperature from annual insolation (fit to Earth). */
function zonalTemp(Q: number): number {
  // Fit to Earth's zonal-mean surface air temperature vs annual insolation:
  // (418 W/m², 26.5 °C) (366, 20.5) (286, 6) (241, −1) (205, −10) (173, −22).
  const d = 418 - Q;
  return d >= 0 ? 26.5 - 0.031 * Math.pow(d, 1.33) : 26.5 + 0.016 * Math.pow(-d, 1.33);
}

/** Open-ocean anomaly vs the zonal mean (oceans are mild at high latitudes). */
function oceanAnom(absLat: number): number {
  return 4 * smoothstep(38, 58, absLat) * (1 - smoothstep(72, 88, absLat));
}

/** Continental-interior anomaly vs the zonal mean, by latitude (°C). */
function continentalAnom(absLat: number): number {
  if (absLat < 30) return 1.5;
  if (absLat < 45) return 1.5 - (absLat - 30) * 0.2;
  if (absLat < 62) return -1.5 - (absLat - 45) * 0.1;
  return -3.2 + (absLat - 62) * 0.04;
}

/** Relative saturation humidity (Clausius–Clapeyron, 1 at 0 °C). */
const qsat = (T: number): number => Math.exp(0.05 * T);

function table(stops: number[][], x: number): number {
  if (x <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (x <= stops[k][0]) {
      const t = (x - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]);
      return stops[k - 1][1] + t * (stops[k][1] - stops[k - 1][1]);
    }
  }
  return stops[stops.length - 1][1];
}

// Zonal wind (m/s, + = from the west) and meridional (+ = poleward) vs |latitude from ITCZ|.
const U_TAB = [[0, -5], [8, -6.5], [18, -5], [27, -1.5], [32, 1], [40, 6], [50, 8.5], [58, 7], [65, 3], [70, 0], [77, -2.5], [90, -1]];
const V_TAB = [[0, 0], [5, -2], [14, -3], [24, -1.5], [30, 0], [36, 1.5], [50, 1.8], [64, 0.6], [70, 0], [80, -1], [90, 0]];
// Large-scale rain-out efficiency (ascent vs subsidence) vs |latitude from ITCZ|.
const Z_TAB = [[0, 0.07], [5, 0.062], [10, 0.042], [15, 0.022], [20, 0.011], [26, 0.008], [31, 0.011], [37, 0.02], [44, 0.03], [52, 0.034], [62, 0.032], [72, 0.026], [82, 0.02], [90, 0.018]];

export function buildClimate(
  mesh: SphereMesh,
  elevation: Float32Array,
  isOcean: Uint8Array,
  radiusKm: number,
  tiltDeg: number,
  tempOffset: number,
  rng: Rng,
): ClimateResult {
  const n = mesh.n;
  const { xyz, adjStart, adj, lat, lon } = mesh;
  const ins = insolationTable(tiltDeg);
  const noise = new Noise3(rng.fork("climate-noise"));
  const spacingKm = mesh.meanSpacing * radiusKm;

  // ------------------------------------------------------------ land mask raster (for basin geometry)
  const GW = 360, GH = 180;
  const locator = new CellLocator(mesh);
  const gridOcean = new Uint8Array(GW * GH);
  {
    let hint = -1;
    for (let gy = 0; gy < GH; gy++) {
      const la = (90 - (gy + 0.5)) * DEG;
      for (let gx = 0; gx < GW; gx++) {
        const lo = (-180 + gx + 0.5) * DEG;
        const c = locator.find(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la), hint);
        hint = c;
        gridOcean[gy * GW + gx] = isOcean[c];
      }
    }
  }
  // Distance (degrees of longitude) to land eastward and westward along each row.
  const dEast = new Float32Array(GW * GH).fill(360);
  const dWest = new Float32Array(GW * GH).fill(360);
  for (let gy = 0; gy < GH; gy++) {
    const row = gy * GW;
    // Two passes around the circle handle wrap-around.
    let d = 360;
    for (let pass = 0; pass < 2; pass++) {
      for (let gx = GW - 1; gx >= 0; gx--) {
        if (!gridOcean[row + gx]) d = 0; else d = Math.min(360, d + 1);
        if (pass === 1) dEast[row + gx] = d;
      }
    }
    d = 360;
    for (let pass = 0; pass < 2; pass++) {
      for (let gx = 0; gx < GW; gx++) {
        if (!gridOcean[row + gx]) d = 0; else d = Math.min(360, d + 1);
        if (pass === 1) dWest[row + gx] = d;
      }
    }
  }

  // ------------------------------------------------------------ ITCZ latitude by longitude (follows land heating)
  const LB = 72;
  const landN = new Float64Array(LB), landS = new Float64Array(LB);
  let totN = 0, totS = 0;
  for (let i = 0; i < n; i++) {
    if (isOcean[i]) continue;
    const la = lat[i] / DEG;
    if (Math.abs(la) > 35) continue;
    const b = Math.min(LB - 1, Math.floor(((lon[i] / DEG + 180) / 360) * LB));
    const w = mesh.area[i] * (1 - Math.abs(la) / 40);
    if (la >= 0) { landN[b] += w; totN += w; } else { landS[b] += w; totS += w; }
  }
  const itczRaw = new Float64Array(LB);
  for (let b = 0; b < LB; b++) {
    let sn = 0, ss = 0;
    for (let k = -4; k <= 4; k++) {
      const bb = (b + k + LB) % LB;
      const w = 1 - Math.abs(k) / 5;
      sn += landN[bb] * w; ss += landS[bb] * w;
    }
    itczRaw[b] = 11 * (sn - ss) / (sn + ss + 1e-4);
  }
  const globalShift = 4 * (totN - totS) / (totN + totS + 1e-9);
  const itcz = (lonRad: number): number => {
    const x = ((lonRad / DEG + 180) / 360) * LB - 0.5;
    const b0 = Math.floor(x), f = x - b0;
    const a = itczRaw[(b0 + LB) % LB], b = itczRaw[(b0 + 1 + LB) % LB];
    return clamp(globalShift + a * (1 - f) + b * f, -14, 14);
  };

  // ------------------------------------------------------------ sea-level pressure anomaly → gyre winds
  // Subtropical highs over the oceans (strongest on the eastern side of each basin),
  // subpolar lows over the oceans, weak thermal lows over subtropical land and cold
  // highs over high-latitude interiors. Smoothed heavily, then turned into a
  // geostrophic wind with frictional inflow towards low pressure.
  const slp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const la = lat[i] / DEG, lo = lon[i] / DEG;
    const a = Math.abs(la);
    if (isOcean[i]) {
      const gx = Math.min(GW - 1, Math.floor(lo + 180)), gy = Math.min(GH - 1, Math.floor(90 - la));
      const de = dEast[gy * GW + gx], dw = dWest[gy * GW + gx];
      const widthDeg = de + dw;
      const basinW = smoothstep(15, 60, widthDeg * Math.cos(lat[i]));
      const eastness = widthDeg >= 359 ? 0.5 : dw / Math.max(1, widthDeg);
      slp[i] = basinW * (Math.exp(-(((a - 31) / 9) ** 2)) * (0.55 + 0.6 * eastness) - 0.8 * Math.exp(-(((a - 60) / 8) ** 2)));
    } else {
      slp[i] = -0.35 * Math.exp(-(((a - 24) / 9) ** 2)) + 0.45 * Math.exp(-(((a - 62) / 9) ** 2));
    }
  }
  {
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 14; pass++) {
      for (let i = 0; i < n; i++) {
        let s2 = 0;
        const a0 = adjStart[i], b0 = adjStart[i + 1];
        for (let k = a0; k < b0; k++) s2 += slp[adj[k]];
        tmp[i] = 0.4 * slp[i] + 0.6 * (s2 / (b0 - a0));
      }
      slp.set(tmp);
    }
  }
  const slpGrad = gradientField(mesh, slp, radiusKm);

  // ------------------------------------------------------------ wind
  const elevLand = new Float32Array(n);
  for (let i = 0; i < n; i++) elevLand[i] = isOcean[i] ? 0 : Math.max(0, elevation[i]);
  const grad = gradientField(mesh, elevLand, radiusKm);
  const wind = new Float32Array(3 * n);
  const climLat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const la = lat[i] / DEG;
    const shift = itcz(lon[i]) * Math.max(0, 1 - Math.abs(la) / 60);
    const ls = la - shift;
    climLat[i] = ls;
    const a = Math.abs(ls), hemi = ls >= 0 ? 1 : -1;
    let u = table(U_TAB, a);
    let v = table(V_TAB, a) * hemi;
    if (!isOcean[i]) { u *= 0.65; v *= 0.65; }
    // Small eddies.
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    u += 1.2 * noise.fbm(x * 3, y * 3, z * 3, 2);
    v += 1.2 * noise.fbm(x * 3 + 7, y * 3, z * 3 - 3, 2);
    // East / north basis.
    let ex = -y, ey = x;
    const el = Math.hypot(ex, ey) || 1;
    ex /= el; ey /= el;
    const nx = -z * ey, ny = z * ex, nz = x * ey - y * ex;
    let wx = u * ex + v * nx, wy = u * ey + v * ny, wz = v * nz;
    // Gyre (geostrophic + friction) component from the pressure anomaly.
    {
      const f = Math.sin(lat[i]);
      const fa = Math.max(Math.abs(f), Math.sin(14 * DEG)) * (f >= 0 ? 1 : -1);
      const fade = smoothstep(6, 16, Math.abs(la));
      const gpx = slpGrad[3 * i], gpy = slpGrad[3 * i + 1], gpz = slpGrad[3 * i + 2];
      // r × ∇p / f  (high pressure on the right in the north)
      let gx2 = (y * gpz - z * gpy) / fa, gy2 = (z * gpx - x * gpz) / fa, gz2 = (x * gpy - y * gpx) / fa;
      const K = 3200 * fade; // scale: smoothed anomaly gradient ~1e-3 /km → ~3 m/s
      const ca = Math.cos(28 * DEG), sa = Math.sin(28 * DEG);
      const gl = Math.hypot(gpx, gpy, gpz) || 1;
      const vg = Math.hypot(gx2, gy2, gz2);
      gx2 = ca * gx2 - sa * (gpx / gl) * vg;
      gy2 = ca * gy2 - sa * (gpy / gl) * vg;
      gz2 = ca * gz2 - sa * (gpz / gl) * vg;
      wx += K * gx2; wy += K * gy2; wz += K * gz2;
    }
    // Deflection: mountains turn the flow along their contours.
    const gx = grad[3 * i], gy = grad[3 * i + 1], gz = grad[3 * i + 2];
    const gl = Math.hypot(gx, gy, gz);
    if (gl > 1e-6 && elevLand[i] > 0.4) {
      const up = (wx * gx + wy * gy + wz * gz) / gl;
      const k = 0.75 * smoothstep(0.4, 2.5, elevLand[i]);
      if (up > 0) { wx -= k * up * gx / gl; wy -= k * up * gy / gl; wz -= k * up * gz / gl; }
      const slow = 1 / (1 + 0.25 * elevLand[i]);
      wx *= slow; wy *= slow; wz *= slow;
    }
    wind[3 * i] = wx; wind[3 * i + 1] = wy; wind[3 * i + 2] = wz;
  }
  // Smooth the wind so it flows coherently around obstacles.
  {
    const tmp = new Float32Array(3 * n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        let sx = wind[3 * i] * 2, sy = wind[3 * i + 1] * 2, sz = wind[3 * i + 2] * 2, c = 2;
        for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
          const j = adj[k];
          sx += wind[3 * j]; sy += wind[3 * j + 1]; sz += wind[3 * j + 2]; c++;
        }
        // Re-project to tangent plane.
        const px = xyz[3 * i], py = xyz[3 * i + 1], pz = xyz[3 * i + 2];
        sx /= c; sy /= c; sz /= c;
        const d = sx * px + sy * py + sz * pz;
        tmp[3 * i] = sx - d * px; tmp[3 * i + 1] = sy - d * py; tmp[3 * i + 2] = sz - d * pz;
      }
      wind.set(tmp);
    }
  }

  // ------------------------------------------------------------ advection operator (semi-Lagrangian pull)
  const pullW = new Float32Array(adj.length);
  const selfW = new Float32Array(n);
  const courant = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wx = wind[3 * i], wy = wind[3 * i + 1], wz = wind[3 * i + 2];
    const s = Math.hypot(wx, wy, wz);
    const px = xyz[3 * i], py = xyz[3 * i + 1], pz = xyz[3 * i + 2];
    const a = adjStart[i], b = adjStart[i + 1];
    let tot = 0;
    for (let k = a; k < b; k++) {
      const j = adj[k];
      let dx = xyz[3 * j] - px, dy = xyz[3 * j + 1] - py, dz = xyz[3 * j + 2] - pz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      // Upwind neighbours lie against the wind.
      const c = s > 1e-6 ? -(wx * dx + wy * dy + wz * dz) / s : 0;
      const w = c > 0 ? c * c * c : 0;
      pullW[k] = w;
      tot += w;
    }
    const C = clamp(0.2 + s / 11, 0.2, 0.75);
    courant[i] = C;
    // Eddy diffusion: strongest in the mid-latitude storm tracks (cyclones carry moisture poleward).
    const zl = Math.abs(climLat[i]);
    const diff = 0.1 + 0.18 * Math.exp(-(((zl - 57) / 15) ** 2));
    const deg = b - a;
    for (let k = a; k < b; k++) pullW[k] = (tot > 0 ? (C * pullW[k]) / tot : C / deg) + diff / deg;
    selfW[i] = 1 - C - diff;
  }

  // ------------------------------------------------------------ ocean currents (SST anomaly)
  const currentAnom = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!isOcean[i]) continue;
    const la = lat[i] / DEG, lo = lon[i] / DEG;
    const gx = Math.min(GW - 1, Math.floor(lo + 180)), gy = Math.min(GH - 1, Math.floor(90 - la));
    const cosl = Math.max(0.1, Math.cos(lat[i]));
    const kmPerDeg = radiusKm * DEG * cosl;
    const de = dEast[gy * GW + gx] * kmPerDeg; // ocean extends this far east before land
    const dw = dWest[gy * GW + gx] * kmPerDeg;
    const width = de + dw;
    if (width > 2 * Math.PI * radiusKm * cosl * 0.95) continue; // open circumpolar ocean: no gyre
    const a = Math.abs(la);
    const basin = smoothstep(800, 3500, width); // narrow seas have weak currents
    const westSide = Math.exp(-dw / 1400); // near the eastern coast of a continent
    const eastSide = Math.exp(-de / 1600); // near the western coast of a continent
    // Subtropical gyre: warm western boundary current, cold eastern boundary current.
    const sub = Math.exp(-(((a - 27) / 11) ** 2));
    // Subpolar: warm drift on the east side of the basin, cold current on the west.
    const pol = Math.exp(-(((a - 57) / 10) ** 2));
    let anom = sub * (3.0 * westSide - 5.0 * eastSide) + pol * (5.5 * Math.exp(-de / 3000) - 4.0 * westSide);
    // Equatorial cold tongue on the eastern side.
    anom -= 2.0 * Math.exp(-((la / 6) ** 2)) * Math.exp(-de / 2500);
    currentAnom[i] = anom * basin;
  }

  // ------------------------------------------------------------ maritime influence + advected current anomaly
  const maritime = new Float32Array(n);
  const advAnom = new Float32Array(n);
  {
    const decay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (isOcean[i]) continue;
      const block = Math.max(0, elevLand[i] - 0.3);
      decay[i] = Math.exp(-courant[i] * spacingKm / 1300 - 0.5 * block * courant[i]);
    }
    const m = new Float32Array(n), a2 = new Float32Array(n);
    const tm = new Float32Array(n), ta = new Float32Array(n);
    for (let i = 0; i < n; i++) if (isOcean[i]) { m[i] = 1; a2[i] = currentAnom[i]; }
    for (let i = 0; i < n; i++) if (isOcean[i]) decay[i] = -1; // marker: fixed boundary value
    let mA = m, aA = a2, mB = tm, aB = ta;
    for (let it = 0; it < 45; it++) {
      advectDecay2(n, adjStart, adj, pullW, selfW, decay, mA, aA, mB, aB);
      const t1 = mA; mA = mB; mB = t1;
      const t2 = aA; aA = aB; aB = t2;
    }
    m.set(mA); a2.set(aA);
    for (let i = 0; i < n; i++) { maritime[i] = clamp(m[i], 0, 1); advAnom[i] = isOcean[i] ? currentAnom[i] : a2[i]; }
  }

  // ------------------------------------------------------------ temperature & seasonality
  const temperature = new Float32Array(n);
  const tempRange = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const la = lat[i] / DEG;
    const a = Math.abs(la);
    const Q = tableAt(ins.mean, la);
    const dQ = tableAt(ins.amp, la);
    const m = maritime[i];
    let T = zonalTemp(Q) + tempOffset;
    if (isOcean[i]) {
      T += currentAnom[i] + oceanAnom(a);
      tempRange[i] = 0.022 * dQ + 0.5;
    } else {
      T += (1 - m) * continentalAnom(a) + m * oceanAnom(a) + advAnom[i];
      T -= 6.5 * elevLand[i];
      tempRange[i] = (0.03 + 0.075 * (1 - m)) * dQ + 0.6 + 0.4 * elevLand[i];
    }
    temperature[i] = T;
  }

  // ------------------------------------------------------------ precipitation
  const up = new Float32Array(n);
  const down = new Float32Array(n);
  // Orographic lift from the large-scale terrain (individual hills do not make rain belts).
  const elevSmooth = elevLand.slice();
  smoothField(mesh, elevSmooth, 3, 0.6);
  const gradS = gradientField(mesh, elevSmooth, radiusKm);
  for (let i = 0; i < n; i++) {
    if (isOcean[i]) continue;
    const w = wind[3 * i] * gradS[3 * i] + wind[3 * i + 1] * gradS[3 * i + 1] + wind[3 * i + 2] * gradS[3 * i + 2];
    // m/s × (km/km) → scaled; typical windward slope 0.01–0.03 at 6–10 m/s.
    if (w > 0) up[i] = w; else down[i] = -w;
  }
  const rate = new Float32Array(n);
  const qs = new Float32Array(n);
  const evapK = new Float32Array(n);
  const recycle = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const T = temperature[i];
    // Over land most rain falls in the warm season: saturation follows summer temperatures.
    qs[i] = isOcean[i] ? qsat(T) : qsat(T + 0.6 * tempRange[i]);
    const zl = Math.abs(climLat[i]);
    let r = table(Z_TAB, zl);
    // Cold currents stabilise the air (fog deserts); warm currents feed convection.
    r *= clamp(1 + 0.12 * advAnom[i], 0.35, 1.7);
    if (!isOcean[i]) {
      // Subsiding air of the subtropical highs is even more hostile to rain over hot land.
      r *= 0.75 * (1 - 0.5 * Math.exp(-(((zl - 24) / 7) ** 2)));
      r += 2.2 * up[i];
      r *= Math.exp(-16 * down[i]);
      r *= 0.85 + 0.3 * smoothstep(0, 1, 1 - maritime[i]) * (zl < 15 ? 1 : 0); // tropical land convection
    }
    rate[i] = clamp(r, 0.002, 0.6);
    const s = Math.hypot(wind[3 * i], wind[3 * i + 1], wind[3 * i + 2]);
    evapK[i] = isOcean[i] ? 0.22 * (0.5 + 0.5 * clamp(s / 7, 0, 2)) * (0.08 + 0.92 * smoothstep(-9, -3, T)) : 0;
    recycle[i] = isOcean[i] ? 0 : 0.2 + 0.4 * clamp((T + 0.6 * tempRange[i] + 5) / 30, 0, 1);
  }
  const q = new Float32Array(n);
  const tq = new Float32Array(n);
  const P = new Float64Array(n);
  // Start near the expected state (ocean air saturated to 80%, decaying inland) to converge fast.
  for (let i = 0; i < n; i++) q[i] = 0.8 * qs[i] * (isOcean[i] ? 1 : 0.3 + 0.7 * maritime[i]);
  const ITER = 90, ACC = 25;
  const satF = new Float32Array(n);
  for (let i = 0; i < n; i++) satF[i] = qs[i] * (isOcean[i] ? 1.0 : 0.95);
  const evapT = new Float32Array(n);
  for (let i = 0; i < n; i++) evapT[i] = 0.8 * qs[i];
  let qA = q, qB = tq;
  for (let it = 0; it < ITER; it++) {
    moistureStep(n, adjStart, adj, pullW, selfW, qA, qB, evapK, evapT, satF, rate, recycle, P, it >= ITER - ACC);
    const t = qA; qA = qB; qB = t;
  }
  q.set(qA);
  if ((globalThis as { __CLIMDBG?: boolean }).__CLIMDBG) {
    const B = 9;
    const acc = Array.from({ length: B }, () => [0, 0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      if (isOcean[i]) continue;
      const b = Math.min(B - 1, Math.floor((lat[i] / DEG + 90) / 20));
      const sp = Math.hypot(wind[3 * i], wind[3 * i + 1], wind[3 * i + 2]);
      const a = acc[b];
      a[0]++; a[1] += q[i]; a[2] += qs[i]; a[3] += rate[i]; a[4] += maritime[i]; a[5] += sp; a[6] += recycle[i];
    }
    for (let b = B - 1; b >= 0; b--) {
      const a = acc[b];
      if (a[0]) console.log(`lat ${b * 20 - 90}: q ${(a[1] / a[0]).toFixed(3)} qs ${(a[2] / a[0]).toFixed(2)} rate ${(a[3] / a[0]).toFixed(3)} mar ${(a[4] / a[0]).toFixed(2)} wind ${(a[5] / a[0]).toFixed(1)} rec ${(a[6] / a[0]).toFixed(2)}`);
    }
  }
  // Calibrate to an Earth-like global mean (~1000 mm/yr).
  let tot = 0, area = 0;
  for (let i = 0; i < n; i++) { tot += P[i] * mesh.area[i]; area += mesh.area[i]; }
  const scale = tot > 0 ? (1000 * area) / tot : 0;
  const precipitation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    const jitter = 1 + 0.12 * noise.fbm(x * 6, y * 6, z * 6, 3);
    let pv = Math.max(0, P[i] * scale * jitter);
    // Cell averages over thousands of km²: compress the extreme orographic tail.
    if (pv > 3500) pv = 3500 + (pv - 3500) / (1 + (pv - 3500) / 6000);
    precipitation[i] = pv;
  }

  // ------------------------------------------------------------ PET, biotemperature, seasonal regimes
  const pet = new Float32Array(n);
  const biotemp = new Float32Array(n);
  const summerDry = new Float32Array(n);
  const drySeason = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const T = temperature[i], A = tempRange[i];
    let bt = 0;
    for (let mth = 0; mth < 12; mth++) {
      const t = T + A * Math.sin(((mth + 0.5) / 12) * 2 * Math.PI);
      bt += clamp(t, 0, 30);
    }
    bt /= 12;
    biotemp[i] = bt;
    pet[i] = 58.93 * bt;
    const zl = Math.abs(climLat[i]);
    // Mediterranean: poleward edge of the subtropical high, with maritime westerlies in winter.
    summerDry[i] = Math.exp(-(((zl - 36) / 6.5) ** 2)) * smoothstep(0.25, 0.7, maritime[i]) * clamp(1.2 - 0.1 * advAnom[i], 0.6, 1.4);
    // Tropical wet/dry: away from the ITCZ core but inside the tropics.
    drySeason[i] = smoothstep(4, 12, zl) * (1 - smoothstep(24, 32, zl));
  }

  return { temperature, tempRange, precipitation, wind, pet, biotemp, summerDry, drySeason, maritime, currentAnom: advAnom, climLat };
}

/** One step of maritime-influence advection for two fields; cells with decay < 0 keep their value. */
function advectDecay2(
  n: number, adjStart: Int32Array, adj: Int32Array, w: Float32Array, self: Float32Array, decay: Float32Array,
  a: Float32Array, b: Float32Array, da: Float32Array, db: Float32Array,
): void {
  for (let i = 0; i < n; i++) {
    const d = decay[i];
    if (d < 0) { da[i] = a[i]; db[i] = b[i]; continue; }
    const si = self[i];
    let sa = si * a[i], sb = si * b[i];
    const e = adjStart[i + 1];
    for (let k = adjStart[i]; k < e; k++) {
      const j = adj[k], wk = w[k];
      sa += wk * a[j];
      sb += wk * b[j];
    }
    da[i] = sa * d;
    db[i] = sb * d;
  }
}

/** Fused advection + evaporation + rain-out + recycling step of the moisture model. */
function moistureStep(
  n: number, adjStart: Int32Array, adj: Int32Array, w: Float32Array, self: Float32Array,
  src: Float32Array, dst: Float32Array, evapK: Float32Array, evapT: Float32Array, sat: Float32Array,
  rate: Float32Array, recycle: Float32Array, P: Float64Array, acc: boolean,
): void {
  for (let i = 0; i < n; i++) {
    let qi = self[i] * src[i];
    const e = adjStart[i + 1];
    for (let k = adjStart[i]; k < e; k++) qi += w[k] * src[adj[k]];
    const ek = evapK[i];
    if (ek > 0) { const def = evapT[i] - qi; if (def > 0) qi += ek * def; }
    let p = 0;
    const st = sat[i];
    if (qi > st) { const x = (qi - st) * 0.18; p += x; qi -= x; }
    const pr = rate[i] * qi;
    p += pr;
    qi -= pr;
    qi += recycle[i] * p;
    dst[i] = qi;
    if (acc) P[i] += p;
  }
}
