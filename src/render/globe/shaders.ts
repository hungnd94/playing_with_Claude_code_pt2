/**
 * GLSL ES 3.00 sources for the globe.
 *
 * The globe is drawn by one full-screen triangle: each fragment intersects
 * its orthographic ray with the unit sphere analytically (so the planet is
 * perfectly round and crisp at any zoom), derives exact texture-coordinate
 * gradients from the hit point (no seam at the antimeridian, graceful poles),
 * and shades terrain, political overlay, ocean glint, atmosphere and stars.
 */

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

uniform vec2 uRes;            // drawing buffer size, device px
uniform vec2 uCenterPx;       // globe centre, device px (GL origin bottom-left)
uniform float uRadiusPx;      // globe radius, device px
uniform float uDpr;
uniform vec3 uEast, uNorth, uCenter;
uniform int uMode;            // 0 globe, 1 flat map
uniform vec2 uFlatCenter;     // (lon, lat) radians
uniform float uFlatScale;     // radians per device px
uniform vec3 uSun;            // world-space unit vector towards the sun
uniform float uLighting;      // 0 = flat lighting, 1 = full day/night
uniform float uNight;         // ambient level on the night side
uniform float uAtmos;         // atmosphere strength
uniform float uExposure;
uniform float uGlint;         // glint strength (damped when zoomed in)
uniform float uClouds;        // cloud opacity (0 = none; already faded by zoom/overlay)
uniform int uTransparentBg;
uniform vec2 uStarOffset;

uniform sampler2D uTerrain;
uniform vec2 uTerrainSize;
uniform int uHasTerrain;

uniform usampler2D uIds;
uniform ivec2 uIdSize;
uniform sampler2D uWarp;
uniform float uWarpAmp;
uniform int uHasWarp;

uniform sampler2D uSites;      // xyz + wet flag per cell
uniform usampler2D uAdjStart;  // CSR offsets
uniform usampler2D uAdj;       // CSR neighbours
uniform int uDataW;
uniform float uSpacing;        // mean cell spacing, radians

uniform int uOvOn;
uniform sampler2D uOvColor;    // RGBA8 per cell
uniform usampler2D uOvGroup;   // per cell: (group id, hops to the nearest foreign border)
uniform float uOvOpacity;
uniform vec4 uBorderColor;     // linear rgb + alpha
uniform float uBorderWidth;    // CSS px
uniform vec4 uCoastColor;      // linear rgb + alpha
uniform float uTerrainFade;    // wash out terrain under fills
uniform float uWash;           // 1 = watercolour edge darkening
uniform int uHasHighlight;
uniform uint uHighlight;       // highlighted group id
uniform int uHlOn;             // a highlighted set of cells is shown
uniform sampler2D uHlCells;    // R8 per cell: highlight strength
uniform vec4 uHlColor;         // linear rgb + strength

out vec4 outColor;

const float PI = 3.14159265358979;

// ---------------------------------------------------------------- helpers
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
// Smooth 3D value noise in [0,1].
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 3D simplex noise (after Ashima Arts / Stefan Gustavson, MIT), range ≈ [-1, 1].
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute4(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289v3(i);
  vec4 p = permute4(permute4(permute4(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec3 ns = 0.142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 nrm = 1.79284291400159 - 0.85373472095314 * vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
  p0 *= nrm.x; p1 *= nrm.y; p2 *= nrm.z; p3 *= nrm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
// Tone map on luminance (keeps the palette's chroma, unlike per-channel ACES),
// rolling very bright, saturated values off towards white.
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float lm = aces(vec3(l)).x;
  vec3 m = c * (lm / max(l, 1e-5));
  float over = max(max(m.r, m.g), m.b);
  if (over > 1.0) m = mix(m / over, vec3(1.0), clamp((over - 1.0) * 0.5, 0.0, 1.0));
  return clamp(m, 0.0, 1.0);
}
ivec2 dc(uint i) { return ivec2(int(i % uint(uDataW)), int(i / uint(uDataW))); }
vec4 siteOf(uint i) { return texelFetch(uSites, dc(i), 0); }
uint groupOf(uint i) { return texelFetch(uOvGroup, dc(i), 0).r; }
uvec2 groupHops(uint i) { return texelFetch(uOvGroup, dc(i), 0).rg; }
vec4 colorOf(uint i) { return texelFetch(uOvColor, dc(i), 0); }
float hlOf(uint i) { return texelFetch(uHlCells, dc(i), 0).r; }

vec2 dirToUV(vec3 p) {
  return vec2(atan(p.y, p.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(p.z, -1.0, 1.0)) / PI);
}
vec2 duvOf(vec3 p, vec3 dp) {
  float r2 = max(p.x * p.x + p.y * p.y, 1e-8);
  vec2 d = vec2((p.x * dp.y - p.y * dp.x) / (2.0 * PI * r2), -dp.z / (PI * sqrt(r2)));
  return clamp(d, vec2(-1.0), vec2(1.0));
}

// Fast B-spline bicubic magnification from 4 bilinear taps (no blocky texels).
vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
vec4 textureBicubic(sampler2D tex, vec2 uv, vec2 size) {
  vec2 t = uv * size - 0.5;
  vec2 f = fract(t);
  t -= f;
  vec4 xc = cubicW(f.x), yc = cubicW(f.y);
  vec4 c = t.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 sw = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw) / sw) / size.xxyy;
  vec4 s0 = textureLod(tex, off.xz, 0.0);
  vec4 s1 = textureLod(tex, off.yz, 0.0);
  vec4 s2 = textureLod(tex, off.xw, 0.0);
  vec4 s3 = textureLod(tex, off.yw, 0.0);
  float sx = sw.x / (sw.x + sw.y);
  float sy = sw.z / (sw.z + sw.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

// ---------------------------------------------------------------- background
vec3 starLayer(vec2 c, float cell, float prob, float size, float bright) {
  vec2 id = floor(c / cell);
  vec2 h = hash22(id + 17.0);
  if (hash12(id * 1.37 + 3.1) > prob) return vec3(0.0);
  vec2 pos = (id + 0.15 + 0.7 * h) * cell;
  float d = length(c - pos);
  float b = bright * pow(hash12(id + 91.7), 3.0);
  float core = exp(-d * d / (size * size));
  vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash12(id + 5.3));
  return tint * core * b;
}

vec3 background(vec2 fragCss, vec2 sNorm) {
  vec2 uvs = fragCss / max(uRes.x, uRes.y) * uDpr;
  vec3 col = mix(vec3(0.010, 0.014, 0.028), vec3(0.002, 0.003, 0.008), clamp(length(sNorm) * 0.22, 0.0, 1.0));
  // Faint nebular dust.
  vec2 nc = (fragCss + uStarOffset * 0.6) * 0.003;
  float neb = vnoise(vec3(nc, 1.7)) * 0.6 + vnoise(vec3(nc * 2.3, 4.1)) * 0.4;
  col += vec3(0.010, 0.010, 0.022) * smoothstep(0.5, 0.95, neb);
  vec2 sc = fragCss + uStarOffset;
  col += starLayer(sc, 29.0, 0.35, 0.8, 0.9);
  col += starLayer(sc + 400.0, 11.0, 0.10, 0.55, 0.45);
  col += starLayer(sc * 0.7 + 1000.0, 83.0, 0.45, 1.2, 1.6);
  return col;
}

// ---------------------------------------------------------------- clouds
// Procedural cloud cover. A large-scale "weather" field (plus latitude bands:
// the equatorial convergence zone, mid-latitude storm tracks, clear
// subtropics) sets the local coverage; billowy fbm thresholded at that
// coverage gives connected cloud masses with fractal edges, scattered puffs
// where coverage is low. A few cyclones twist the domain into comma-shaped
// spirals.
uniform vec4 uCyclones[8];   // xyz = centre (unit), w = twist (radians, signed)
uniform int uCycloneCount;

vec3 swirl(vec3 p, out float storm) {
  vec3 q = p;
  storm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uCycloneCount) break;
    vec3 c = uCyclones[i].xyz;
    float d2 = 2.0 * max(1.0 - dot(q, c), 0.0);          // ≈ squared angular distance
    float a = uCyclones[i].w * exp(-d2 / 0.045);
    float ca = cos(a), sa = sin(a);
    q = q * ca + cross(c, q) * sa + c * dot(c, q) * (1.0 - ca);
    // Cloudier around the storm, with a small clear eye.
    storm += exp(-d2 / 0.035) * (1.0 - exp(-d2 / 0.0012));
  }
  return q;
}

float cloudField(vec3 p, int octaves) {
  float storm;
  vec3 q = swirl(p, storm);
  vec3 sp = vec3(q.xy, q.z * 1.3);                         // gentle zonal stretch
  vec3 w = vec3(snoise(sp * 1.4 + vec3(1.7, 0.0, 3.1)), snoise(sp * 1.4 + vec3(9.2, 2.2, 0.0)), snoise(sp * 1.4 + vec3(0.0, 4.4, 7.7)));
  float weather = 0.5 + 0.5 * snoise(sp * 1.15 + w * 0.45 + vec3(5.3, 1.1, 2.9));
  float lat = asin(clamp(p.z, -1.0, 1.0));
  float al = abs(lat);
  float band = 0.22 * exp(-pow(lat / 0.13, 2.0)) + 0.16 * exp(-pow((al - 0.95) / 0.22, 2.0)) - 0.2 * exp(-pow((al - 0.42) / 0.14, 2.0));
  float cover = clamp(0.62 * weather + band - 0.03 + 0.3 * storm, 0.0, 0.95);
  vec3 c = sp * 4.2 + w * 0.35;
  float f = 0.0, a = 0.5, fr = 1.0;
  for (int o = 0; o < 7; o++) {
    if (o >= octaves) break;
    float n = snoise(c * fr + float(o) * 3.7);
    // Upper octaves turbulent (billows), lower ones smooth (masses).
    f += a * (o < 2 ? n : (0.75 - 1.5 * abs(n)));
    fr *= 2.07;
    a *= 0.52;
  }
  f = 0.5 + 0.55 * f;
  float d = smoothstep(1.0 - cover - 0.06, 1.0 - cover + 0.3, f);
  return d * d * (3.0 - 2.0 * d);
}

// ---------------------------------------------------------------- lighting
// Shared by the globe and the river ribbons. n = surface normal (= position).
vec3 shadeSurface(vec3 albedo, vec3 n, float water, vec3 q) {
  if (uMode != 0 || uLighting <= 0.0) return albedo * 1.05;
  vec3 V = uCenter;
  float ndl = dot(n, uSun);
  float wrapL = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);
  float day = smoothstep(-0.20, 0.45, ndl);
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.42), vec3(1.0, 0.98, 0.95), smoothstep(-0.05, 0.4, ndl));
  vec3 lightC = sunCol * (0.24 + 0.92 * pow(wrapL, 1.1)) * day;
  vec3 nightC = vec3(0.30, 0.38, 0.60) * uNight;
  vec3 col = albedo * (lightC + nightC);
  // Sun glint on water, broken up into glitter.
  vec3 H = normalize(uSun + V);
  float nh = max(dot(n, H), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float glit = 0.65 + 0.7 * vnoise(q / uSpacing * 7.0);
  float spec = (pow(nh, 900.0) * 0.55 * glit + pow(nh, 90.0) * 0.09 + pow(nh, 14.0) * 0.02) * uGlint;
  col += vec3(1.0, 0.93, 0.80) * spec * water * (0.45 + fres) * day;
  // Atmospheric scattering towards the limb, and a faint blue veil by day.
  float mu = max(dot(n, V), 0.0);
  float rim = pow(1.0 - mu, 3.0);
  vec3 atm = vec3(0.30, 0.55, 1.0);
  col = mix(col, atm * (0.55 * day + 0.06), clamp(rim * 0.85 * uAtmos, 0.0, 1.0) * (0.25 + 0.75 * day));
  col += atm * 0.018 * day * uAtmos;
  return mix(albedo * 1.05, col, uLighting);
}

// ---------------------------------------------------------------- overlay
// Analytic cell ownership & border distances around the cell named by the id
// texture. The nearest site of the pixel's land/water class (to the warped
// position q) is re-derived among that cell and its neighbours; then every
// group present in the neighbourhood is scored with a soft-min of distances,
//   S_g = Σ_{s ∈ g} exp(−|q − s|² / τ),
// and the pixel belongs to the best-scoring group. With τ ≈ 0.15·spacing²
// the boundaries follow the Voronoi edges but round off the cell corners, so
// borders flow instead of zig-zagging. The distance to the border is
// (log S_best − log S_second) over its analytic screen-space gradient: crisp
// lines of constant pixel width at any zoom.
//   owner       a cell of the winning group (for its fill colour)
//   group       the winning group id
//   borderPx    to the nearest border with another group (device px)
//   edgeAng     smooth angular distance to the group's edge (watercolour band)
//   hl          highlight strength of the pixel (soft membership of the set)
//   hlBorderPx  to the boundary of the highlighted cell set (device px)
const float SOFT_TAU = 0.15;
void cellQuery(vec3 q, vec3 dqx, vec3 dqy, vec2 uv, bool wantWet,
               out uint owner, out uint group, out float borderPx, out float edgeAng,
               out float hl, out float hlBorderPx) {
  ivec2 tc = ivec2(floor(uv * vec2(uIdSize)));
  tc.x = ((tc.x % uIdSize.x) + uIdSize.x) % uIdSize.x;
  tc.y = clamp(tc.y, 0, uIdSize.y - 1);
  uvec4 iv = texelFetch(uIds, tc, 0);
  uint c = iv.r | (iv.g << 8) | (iv.b << 16);
  uint near = c;
  float best = -2.0;
  vec4 sc = siteOf(c);
  if ((sc.w > 0.5) == wantWet) best = dot(q, sc.xyz);
  uint a0 = texelFetch(uAdjStart, dc(c), 0).r;
  uint a1 = min(texelFetch(uAdjStart, dc(c + 1u), 0).r, a0 + 24u);
  for (uint k = a0; k < a1; k++) {
    uint j = texelFetch(uAdj, dc(k), 0).r;
    vec4 sj = siteOf(j);
    if ((sj.w > 0.5) != wantWet) continue;
    float d = dot(q, sj.xyz);
    if (d > best) { best = d; near = j; }
  }
  vec4 sn = siteOf(near);
  // Candidates: the nearest site and its same-class neighbours.
  float invT = 2.0 / (SOFT_TAU * uSpacing * uSpacing);   // |q−s|² = 2(1 − q·s)
  uint gid[8];
  float gS[8];
  vec3 gG[8];
  float gBest[8];
  uint gCell[8];
  float gHW[8];
  float gW[8];
  int ng = 0;
  hl = 0.0;
  float sIn = 0.0, sOut = 0.0, hlBestIn = 0.0;
  vec3 gIn = vec3(0.0), gOut = vec3(0.0);
  a0 = texelFetch(uAdjStart, dc(near), 0).r;
  a1 = min(texelFetch(uAdjStart, dc(near + 1u), 0).r, a0 + 24u);
  for (uint k = a0; k <= a1; k++) {
    uint j = k == a1 ? near : texelFetch(uAdj, dc(k), 0).r;
    vec4 sj = k == a1 ? sn : siteOf(j);
    if ((sj.w > 0.5) != wantWet) continue;
    float e = exp(-(dot(q, sn.xyz) - dot(q, sj.xyz)) * invT);   // relative to the nearest: ≤ 1
    if (uOvOn == 1) {
      uvec2 gh = groupHops(j);
      int slot = -1;
      for (int t = 0; t < 8; t++) { if (t < ng && gid[t] == gh.x) { slot = t; break; } }
      if (slot < 0 && ng < 8) { slot = ng; gid[ng] = gh.x; gS[ng] = 0.0; gG[ng] = vec3(0.0); gBest[ng] = 0.0; gCell[ng] = j; gHW[ng] = 0.0; gW[ng] = 0.0; ng++; }
      if (slot >= 0) {
        gS[slot] += e;
        gG[slot] += e * sj.xyz;
        if (e > gBest[slot]) { gBest[slot] = e; gCell[slot] = j; }
        // Interior depth: hop counts to the group edge, smoothly interpolated
        // with broad Gaussian weights (continuous across cell boundaries).
        float w2 = exp(-(dot(q, sn.xyz) - dot(q, sj.xyz)) * invT * (SOFT_TAU / 0.35));
        gHW[slot] += w2 * (float(gh.y) + 0.5);
        gW[slot] += w2;
      }
    }
    if (uHlOn == 1) {
      float h = hlOf(j);
      if (h > 0.0) { sIn += e; gIn += e * sj.xyz; if (e > hlBestIn) { hlBestIn = e; hl = h; } }
      else { sOut += e; gOut += e * sj.xyz; }
    }
  }
  owner = near;
  group = 0u;
  borderPx = 1e6;
  edgeAng = 1e6;
  float pxAng = max(length(dqx), 1e-9);   // radians per device px
  if (uOvOn == 1 && ng > 0) {
    int b0 = 0;
    for (int t = 1; t < 8; t++) { if (t < ng && gS[t] > gS[b0]) b0 = t; }
    owner = gCell[b0];
    group = gid[b0];
    int b1 = -1;
    for (int t = 0; t < 8; t++) { if (t < ng && t != b0 && (b1 < 0 || gS[t] > gS[b1])) b1 = t; }
    edgeAng = gHW[b0] / max(gW[b0], 1e-9) * uSpacing;
    if (b1 >= 0) {
      float f = log(gS[b0]) - log(gS[b1]);
      vec3 grad = invT * (gG[b0] / gS[b0] - gG[b1] / gS[b1]);
      grad -= q * dot(grad, q);
      vec2 g = vec2(dot(dqx, grad), dot(dqy, grad));
      borderPx = f / max(length(g), 1e-9);
      edgeAng = min(edgeAng, f / max(length(grad), 1e-9));
    }
  }
  hlBorderPx = 1e6;
  if (uHlOn == 1) {
    if (sIn <= 0.0) hl = 0.0;
    if (sIn > 0.0 && sOut > 0.0) {
      float f = log(sIn) - log(sOut);
      vec3 grad = invT * (gIn / sIn - gOut / sOut);
      grad -= q * dot(grad, q);
      vec2 g = vec2(dot(dqx, grad), dot(dqy, grad));
      hlBorderPx = abs(f) / max(length(g), 1e-9);
      if (f < 0.0) hl = 0.0;
    }
  }
}

`;

export const GLOBE_FS = PRELUDE + /* glsl */ `
// ---------------------------------------------------------------- main
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 fragCss = vec2(frag.x, uRes.y - frag.y) / uDpr;
  vec2 s;
  vec3 p, dpx, dpy;
  bool onPlanet;
  float rr = 0.0;
  if (uMode == 0) {
    s = (frag - uCenterPx) / uRadiusPx;
    rr = dot(s, s);
    float w = sqrt(max(1.0 - rr, 0.0));
    onPlanet = rr <= 1.0;
    p = s.x * uEast + s.y * uNorth + w * uCenter;
    float wc = max(w, 2e-3);
    dpx = (uEast - (s.x / wc) * uCenter) / uRadiusPx;
    dpy = (uNorth - (s.y / wc) * uCenter) / uRadiusPx;
  } else {
    vec2 off = (frag - uCenterPx) * uFlatScale;
    float lat = uFlatCenter.y + off.y;
    float lon = uFlatCenter.x + off.x;
    onPlanet = abs(lat) <= 0.5 * PI;
    lat = clamp(lat, -0.5 * PI, 0.5 * PI);
    float cl = cos(lat), sl = sin(lat), co = cos(lon), so = sin(lon);
    p = vec3(cl * co, cl * so, sl);
    dpx = vec3(-cl * so, cl * co, 0.0) * uFlatScale;
    dpy = vec3(-sl * co, -sl * so, cl) * uFlatScale;
    s = (frag - uCenterPx) / (0.5 * min(uRes.x, uRes.y));
  }
  p = normalize(p);
  vec2 uv = dirToUV(p);
  vec2 duvx = duvOf(p, dpx);
  vec2 duvy = duvOf(p, dpy);
  if (uMode == 1) { duvx = vec2(uFlatScale / (2.0 * PI), 0.0); duvy = vec2(0.0, -uFlatScale / PI); }

  // Terrain sample (uniform control flow: derivatives are valid everywhere).
  vec4 tex = uHasTerrain == 1 ? textureGrad(uTerrain, uv, duvx, duvy) : vec4(0.08, 0.2, 0.35, 0.0);
  float A = tex.a;
  float aw = max(fwidth(A), 1e-5);
  vec3 q = p;
  if (uHasWarp == 1) {
    vec3 d = (texture(uWarp, uv).rgb * 255.0 - 127.5) / 127.5 * uWarpAmp;
    q = normalize(p + d);
  }
  vec3 dqx = dFdx(q), dqy = dFdy(q);
  if (uMode == 0 && rr > 0.98) { dqx = dpx; dqy = dpy; }

  if (!onPlanet) {
    vec3 col = uTransparentBg == 1 ? vec3(0.0) : background(fragCss, s);
    float alpha = uTransparentBg == 1 ? 0.0 : 1.0;
    if (uMode == 0 && uAtmos > 0.0) {
      // Atmospheric halo beyond the limb.
      float r = sqrt(rr);
      float h = r - 1.0;
      vec3 limbN = normalize(s.x * uEast + s.y * uNorth);
      float sunAt = dot(limbN, uSun);
      float dayF = mix(1.0, smoothstep(-0.45, 0.35, sunAt), uLighting);
      float glow = exp(-h / 0.022) * 0.85 + exp(-h / 0.075) * 0.22;
      vec3 gcol = mix(vec3(0.20, 0.42, 1.0), vec3(0.55, 0.78, 1.0), exp(-h / 0.02));
      float dusk = exp(-pow(sunAt / 0.22, 2.0)) * uLighting;
      gcol = mix(gcol, vec3(1.0, 0.55, 0.32), dusk * 0.45);
      vec3 g = gcol * glow * dayF * uAtmos * (0.25 + 0.75 * dayF);
      col += g;
      alpha = max(alpha, clamp(max(g.r, max(g.g, g.b)) * 1.5, 0.0, 1.0));
    }
    col = toSRGB(aces(col * uExposure));
    outColor = vec4(col * alpha, alpha);
    if (uTransparentBg == 0) outColor = vec4(col, 1.0);
    return;
  }

  // ------------------------------------------------------------ terrain
  vec3 albedo = tex.rgb;
  float texelsPerPx = max(length(duvx * uTerrainSize), length(duvy * uTerrainSize));
  float mag = clamp(1.0 - texelsPerPx, 0.0, 1.0);   // 0 at 1:1 or minified, → 1 when magnified
  if (uHasTerrain == 1 && mag > 0.0) {
    vec4 bc = textureBicubic(uTerrain, uv, uTerrainSize);
    float k = smoothstep(0.0, 0.3, mag);
    albedo = mix(albedo, bc.rgb, k);
    A = mix(A, bc.a, k);
  }
  float landMask = smoothstep(0.5 - aw, 0.5 + aw, A);
  if (uHasTerrain == 1 && texelsPerPx < 0.9 && abs(A - 0.5) < 0.3) {
    // Magnified coast: rebuild a crisp shoreline from the coast field and take
    // each side's colour from a texel safely on that side.
    vec2 ts = 1.0 / uTerrainSize;
    float ax = textureLod(uTerrain, uv + vec2(ts.x, 0.0), 0.0).a - textureLod(uTerrain, uv - vec2(ts.x, 0.0), 0.0).a;
    float ay = textureLod(uTerrain, uv + vec2(0.0, ts.y), 0.0).a - textureLod(uTerrain, uv - vec2(0.0, ts.y), 0.0).a;
    vec2 g = vec2(ax, ay);
    vec2 dir = length(g) > 1e-5 ? normalize(g) : vec2(0.0);
    vec3 landCol = textureLod(uTerrain, uv + dir * ts * 1.6, 0.0).rgb;
    vec3 seaCol = textureLod(uTerrain, uv - dir * ts * 1.6, 0.0).rgb;
    // Sub-texel fractal detail on the shoreline.
    vec3 nq = q / uSpacing;
    float n = (vnoise(nq * 9.0) - 0.5) * 0.6 + (vnoise(nq * 21.0) - 0.5) * 0.3 + (vnoise(nq * 47.0) - 0.5) * 0.15;
    float Ad = A + n * 0.09 * mag;
    landMask = smoothstep(0.5 - aw, 0.5 + aw, Ad);
    albedo = mix(seaCol, landCol, landMask);
    A = Ad;
  }

  // Procedural micro-detail when magnified: grain whose strength follows the
  // local contrast of the texture (rocky relief gets more, plains and sea less).
  if (uHasTerrain == 1 && mag > 0.0) {
    vec3 coarse = textureLod(uTerrain, uv, 2.5).rgb;
    float rough = clamp(length(albedo - coarse) * 5.0, 0.0, 1.0);
    vec3 dq = q * (uTerrainSize.y / PI) * 0.9;   // ≈ one cycle per texel
    float dn = vnoise(dq) * 0.5 + vnoise(dq * 2.13 + 7.1) * 0.3 + vnoise(dq * 4.37 + 3.3) * 0.2;
    float amp = mag * mix(0.03, 0.05 + 0.08 * rough, landMask);
    albedo *= 1.0 + amp * (dn - 0.5) * 2.0;
    // Micro-relief: ridged noise embossed towards the north-west light (the
    // same light as the baked hillshade), strongest where the texture already
    // shows relief, so magnified mountains keep crisp crests.
    if (landMask > 0.01) {
      vec3 E = normalize(vec3(-p.y, p.x, 0.0) + vec3(1e-6, 0.0, 0.0));
      vec3 Nn = cross(p, E);
      vec3 L = normalize(Nn - E);
      float f = uTerrainSize.y / PI * 0.7;
      float h0 = 0.0, h1 = 0.0, a = 1.0;
      for (int o = 0; o < 3; o++) {
        float d = 0.25 / f;
        vec3 off = vec3(float(o) * 17.3, float(o) * 5.1, 0.0);
        float n0 = 1.0 - abs(snoise(q * f + off));
        float n1 = 1.0 - abs(snoise((q + L * d) * f + off));
        h0 += a * n0 * n0;
        h1 += a * n1 * n1;
        f *= 2.17;
        a *= 0.5;
      }
      float emboss = clamp((h1 - h0) * 1.6, -1.0, 1.0);
      albedo *= 1.0 + mag * landMask * 0.32 * smoothstep(0.3, 0.9, rough) * emboss;
    }
  }

  // ------------------------------------------------------------ overlay
  bool wantWet = landMask < 0.5;
  float ownerMask = wantWet ? 1.0 - landMask : landMask;
  uint owner = 0u, group = 0u;
  float borderPx = 1e6, edgeAng = 1e6, hl = 0.0, hlBorderPx = 1e6;
  if (uOvOn == 1 || uHlOn == 1) cellQuery(q, dqx, dqy, uv, wantWet, owner, group, borderPx, edgeAng, hl, hlBorderPx);
  if (uOvOn == 1) {
    vec4 fc = colorOf(owner);
    vec3 fcl = toLinear(fc.rgb);
    float a = fc.a * uOvOpacity * ownerMask;
    // Paper grain & pigment granulation.
    vec3 gq = q / uSpacing;
    float grain = 0.86 + 0.14 * (vnoise(gq * 3.1) * 0.6 + vnoise(gq * 11.0) * 0.4);
    // Coastline distance (angle) from the coast field, exact near the shore.
    float coastAng = abs(A - 0.5) / aw * length(dqx);
    float edge = exp(-min(edgeAng, coastAng) / (1.1 * uSpacing));
    a *= mix(1.0, (0.34 + 0.66 * edge) * grain, uWash);
    // Watercolour tint: hue from the fill, light and shade from the terrain, so
    // relief, rivers and snow read through the wash.
    float lumT = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    float shadeT = clamp(pow(lumT / 0.16, 0.45), 0.45, 1.25);
    vec3 tinted = fcl * mix(1.0, shadeT, 0.75);
    if (fc.a > 0.0) {
      // Optionally wash the terrain colours out first (towards its own luminance).
      albedo = mix(albedo, vec3(lumT) * vec3(1.08, 1.02, 0.92), uTerrainFade * ownerMask * fc.a);
    }
    albedo = mix(albedo, tinted, a);
    // Border: coloured band inside + crisp ink line on the boundary.
    float bw = uBorderWidth * uDpr;
    float band = (1.0 - smoothstep(0.0, bw * 0.5 + 3.0 * uDpr, borderPx)) * fc.a * ownerMask * uWash;
    albedo = mix(albedo, tinted * 0.6, band * 0.4);
    float line = 1.0 - smoothstep(bw * 0.5 - 0.6, bw * 0.5 + 0.6, borderPx);
    // Highlighted group: richer wash, a luminous rim inside its border and a
    // heavier ink line; every other group recedes (desaturated, dimmer).
    if (uHasHighlight == 1 && fc.a > 0.0) {
      if (group == uHighlight) {
        float edgePx = min(borderPx, coastAng / max(length(dqx), 1e-9));
        float rim = exp(-edgePx / (5.0 * uDpr)) * ownerMask;
        albedo = mix(albedo, fcl * mix(1.0, shadeT, 0.6) * 1.12, 0.42 * ownerMask);
        albedo = mix(albedo, mix(fcl, vec3(1.0, 0.95, 0.82), 0.6) * 1.35, rim * 0.6);
        line = max(line, 1.0 - smoothstep(bw - 0.6, bw + 0.6, borderPx));
      } else {
        float lg = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
        float k = ownerMask * fc.a;
        albedo = mix(albedo, vec3(lg), 0.35 * k) * (1.0 - 0.16 * k);
      }
    }
    albedo = mix(albedo, uBorderColor.rgb, line * uBorderColor.a * ownerMask);
    // Coastline ink.
    if (uCoastColor.a > 0.0) {
      float coastPx = abs(A - 0.5) / aw;
      float cl = 1.0 - smoothstep(0.35 * uDpr, 1.1 * uDpr, coastPx);
      albedo = mix(albedo, uCoastColor.rgb, cl * uCoastColor.a);
    }
  }

  // Highlighted set of cells (selection, search hits, a basin…): a warm wash,
  // a luminous inner glow and a bright hairline along the set's boundary.
  if (uHlOn == 1) {
    hl *= uHlColor.a;
    float coastPx = abs(A - 0.5) / aw;
    float line = (1.0 - smoothstep(0.6 * uDpr, 1.5 * uDpr, hlBorderPx)) * ownerMask;
    if (hl > 0.0) {
      float rimPx = min(hlBorderPx, coastPx);
      float glow = exp(-rimPx / (7.0 * uDpr)) * ownerMask;
      float lumA = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = uHlColor.rgb * clamp(pow(lumA / 0.16, 0.45), 0.5, 1.3);
      albedo = mix(albedo, tint, 0.28 * hl * ownerMask);
      albedo = mix(albedo, uHlColor.rgb * 1.25, 0.5 * glow * hl);
    }
    albedo = mix(albedo, mix(uHlColor.rgb, vec3(1.0), 0.35) * 1.3, line * 0.9 * uHlColor.a);
  }

  // ------------------------------------------------------------ lighting
  float water = 1.0 - landMask;
  float cloud = 0.0;
  if (uClouds > 0.0 && uMode == 0) {
    cloud = cloudField(p, 7) * uClouds;
    // Soft shadow cast on the ground, offset away from the sun.
    vec3 sunT = normalize(uSun - p * dot(uSun, p) + 1e-6);
    float shadow = cloudField(normalize(p - sunT * 0.012), 3) * uClouds;
    // A cloud hides its own shadow, and at grazing angles shadows vanish behind the clouds.
    float muS = max(dot(p, uCenter), 0.0);
    albedo *= 1.0 - 0.32 * shadow * (1.0 - cloud) * smoothstep(0.05, 0.5, muS);
    water *= 1.0 - cloud;
  }
  vec3 col = shadeSurface(albedo, p, water, q);
  if (cloud > 0.0) {
    // Clouds: lit white tops with a cooler, darker underside towards the terminator.
    float ndl = dot(p, uSun);
    float day = smoothstep(-0.18, 0.4, ndl);
    vec3 sunCol = mix(vec3(1.0, 0.68, 0.48), vec3(1.0), smoothstep(-0.05, 0.35, ndl));
    vec3 cc = sunCol * (0.35 + 0.75 * clamp((ndl + 0.2) / 1.2, 0.0, 1.0)) * day + vec3(0.30, 0.38, 0.60) * uNight * 0.8;
    float mu = max(dot(p, uCenter), 0.0);
    col = mix(col, cc * 0.92, cloud * (0.55 + 0.45 * mu));
  }
  outColor = vec4(toSRGB(grade(col * uExposure)), 1.0);
}
`;

export const MARKER_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in float aSize;
in vec4 aColor;
in float aShape;
uniform vec2 uRes;
uniform vec2 uCenterPx;
uniform float uRadiusPx;
uniform float uDpr;
uniform vec3 uEast, uNorth, uCenter;
uniform int uMode;
uniform vec2 uFlatCenter;
uniform float uFlatScale;
out vec4 vColor;
out float vShape;
out float vSize;
const float PI = 3.14159265358979;
void main() {
  vec2 spx;
  float vis = 1.0;
  if (uMode == 0) {
    spx = uCenterPx + vec2(dot(aPos, uEast), dot(aPos, uNorth)) * uRadiusPx;
    vis = smoothstep(0.02, 0.16, dot(aPos, uCenter));
  } else {
    float lat = asin(clamp(aPos.z, -1.0, 1.0));
    float lon = atan(aPos.y, aPos.x);
    float dl = mod(lon - uFlatCenter.x + PI, 2.0 * PI) - PI;
    spx = uCenterPx + vec2(dl, lat - uFlatCenter.y) / uFlatScale;
  }
  float size = aSize * uDpr;
  gl_PointSize = size + 4.0 * uDpr;
  gl_Position = vis > 0.0 ? vec4(spx / uRes * 2.0 - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vColor = vec4(aColor.rgb, aColor.a * vis);
  vShape = aShape;
  vSize = size;
}
`;

export const MARKER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in float vShape;
in float vSize;
uniform float uDpr;
out vec4 outColor;
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdTri(vec2 p, float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
void main() {
  float full = vSize + 4.0 * uDpr;
  vec2 pc = (gl_PointCoord - 0.5) * full;   // device px, y down
  pc.y = -pc.y;
  float r = vSize * 0.5;
  int shape = int(vShape + 0.5);
  float d;
  if (shape == 1) d = max(abs(pc.x), abs(pc.y)) - r * 0.85;
  else if (shape == 2) d = (abs(pc.x) + abs(pc.y)) * 0.7071 - r * 0.8;
  else if (shape == 3) d = sdStar5(pc, r * 1.05, 0.45);
  else if (shape == 4) d = sdTri(pc, r * 0.9);
  else if (shape == 5) d = abs(length(pc) - r * 0.75) - r * 0.25;
  else d = length(pc) - r;
  float ow = 1.0 * uDpr;                     // outline width
  float aa = 0.75;
  float fill = 1.0 - smoothstep(-ow - aa, -ow + aa, d);
  float shapeA = 1.0 - smoothstep(-aa, aa, d);
  float shadow = (1.0 - smoothstep(-1.0, 2.5 * uDpr, d)) * 0.35;
  vec3 ink = vec3(0.10, 0.08, 0.07);
  vec3 c = mix(ink, vColor.rgb, fill);
  float a = max(shapeA, shadow);
  vec3 outC = shapeA > 0.0 ? c : ink;
  outColor = vec4(outC * a, a) * vColor.a;
}
`;

/** River ribbons: vector rivers for close-ups, lit like the terrain, clipped by the coast field. */
export const RIVER_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aSideDir;
in float aSide;
in float aHw;
in float aAnchor;
uniform vec2 uRes;
uniform vec2 uCenterPx;
uniform float uRadiusPx;
uniform vec3 uEast, uNorth, uCenter;
uniform int uMode;
uniform vec2 uFlatCenter;
uniform float uFlatScale;
uniform float uRiverScale;   // device px per radian of (exaggerated) river half-width
uniform float uLonShift;     // flat map: horizontal copy offset (radians)
out vec3 vP;
out float vV;
out float vHwPx;
const float PI = 3.14159265358979;
void main() {
  float pxPerRad = uMode == 0 ? uRadiusPx : 1.0 / uFlatScale;
  // Cartographic width: grows gently with zoom rather than with the map scale.
  float hwPx = aHw * uRiverScale;
  float effPx = max(hwPx, 0.5) + 1.0;          // + 1 px for anti-aliasing
  vec3 p = normalize(aPos + aSideDir * aSide * (effPx / pxPerRad));
  vec2 spx;
  if (uMode == 0) {
    spx = uCenterPx + vec2(dot(p, uEast), dot(p, uNorth)) * uRadiusPx;
  } else {
    float lat = asin(clamp(p.z, -1.0, 1.0));
    float lon = atan(p.y, p.x);
    float base = mod(aAnchor - uFlatCenter.x + PI, 2.0 * PI) - PI;
    float rel = mod(lon - aAnchor + PI, 2.0 * PI) - PI;
    spx = uCenterPx + vec2(base + rel + uLonShift, lat - uFlatCenter.y) / uFlatScale;
  }
  // Far-side fragments are discarded in the fragment shader (moving vertices
  // off-screen here would stretch triangles across the view).
  gl_Position = vec4(spx / uRes * 2.0 - 1.0, 0.0, 1.0);
  vP = p;
  vV = aSide * effPx;
  vHwPx = hwPx;
}
`;

export const RIVER_FS = PRELUDE + /* glsl */ `
in vec3 vP;
in float vV;
in float vHwPx;
uniform float uRiverAlpha;
uniform vec3 uRiverColor;   // linear
void main() {
  vec3 p = normalize(vP);
  float hw = max(vHwPx, 0.5);
  float cov = clamp(hw + 0.5 - abs(vV), 0.0, 1.0) * min(1.0, vHwPx / 0.5);
  vec2 uv = dirToUV(p);
  float A = textureLod(uTerrain, uv, 0.0).a;
  float land = smoothstep(0.47, 0.56, A);
  float a = cov * land * uRiverAlpha;
  if (uMode == 0 && dot(p, uCenter) < 0.0) a = 0.0;
  if (a <= 0.002) discard;
  // Darker, deeper water mid-channel; banks a touch lighter.
  float mid = 1.0 - clamp(abs(vV) / hw, 0.0, 1.0);
  vec3 albedo = uRiverColor * (1.0 - 0.18 * mid);
  vec3 col = shadeSurface(albedo, p, 0.6, p);
  col = toSRGB(grade(col * uExposure));
  outColor = vec4(col * a, a);
}
`;

/**
 * Polylines (routes, fronts, arrows): expanded in screen space to a constant
 * pixel width with mitred joins; casing, dashes, dots and flow in the FS.
 */
export const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aPrev;
in vec3 aNext;
in float aSide;
in float aDist;
in vec4 aColor;
in float aWidth;
in float aCasing;
in float aStyle;
in float aKind;
in float aLonU;
in float aFlow;
in float aCaseA;
in float aAnchor;
uniform vec2 uRes;
uniform vec2 uCenterPx;
uniform float uRadiusPx;
uniform float uDpr;
uniform vec3 uEast, uNorth, uCenter, uSun;
uniform int uMode;
uniform vec2 uFlatCenter;
uniform float uFlatScale;
uniform float uLonShift;
uniform float uLighting;
out vec4 vColor;
out float vAcross;
out float vAlong;
out float vHalf;
out float vCase;
out float vCaseA;
out float vStyle;
out float vFlow;
out float vKind;
out vec3 vBary;
const float PI = 3.14159265358979;
float wrapPi(float a) { return mod(a + PI, 2.0 * PI) - PI; }
vec2 screenOf(vec3 p, float lonU) {
  if (uMode == 0) return uCenterPx + vec2(dot(p, uEast), dot(p, uNorth)) * uRadiusPx;
  float lat = asin(clamp(p.z, -1.0, 1.0));
  float x = wrapPi(aAnchor - uFlatCenter.x) + (lonU - aAnchor) + uLonShift;
  return uCenterPx + vec2(x, lat - uFlatCenter.y) / uFlatScale;
}
void main() {
  float lonP = aLonU + wrapPi(atan(aPrev.y, aPrev.x) - atan(aPos.y, aPos.x));
  float lonN = aLonU + wrapPi(atan(aNext.y, aNext.x) - atan(aPos.y, aPos.x));
  vec2 sc = screenOf(aPos, aLonU);
  vec2 sp = screenOf(aPrev, lonP);
  vec2 sn = screenOf(aNext, lonN);
  vec2 d0 = sc - sp, d1 = sn - sc;
  vec2 t1 = length(d1) > 1e-4 ? normalize(d1) : (length(d0) > 1e-4 ? normalize(d0) : vec2(1.0, 0.0));
  vec2 t0 = length(d0) > 1e-4 ? normalize(d0) : t1;
  vec2 pos;
  vBary = vec3(0.0);
  if (aKind < 0.5) {
    vec2 n0 = vec2(-t0.y, t0.x), n1 = vec2(-t1.y, t1.x);
    vec2 mt = n0 + n1;
    mt = length(mt) > 1e-3 ? normalize(mt) : n0;
    float halfW = (0.5 * aWidth + aCasing + 1.0) * uDpr;
    pos = sc + mt * (halfW / max(dot(mt, n0), 0.5)) * aSide;
    vAcross = aSide * halfW;
  } else {
    // Arrowhead: tip ahead of the last point, base corners behind it.
    vec2 n = vec2(-t0.y, t0.x);
    float L = (3.0 * aWidth + 7.0 + aCasing) * uDpr;
    float Wd = (1.9 * aWidth + 4.0 + aCasing) * uDpr;
    if (aSide > 0.5) { pos = sc - t0 * L * 0.45 + n * Wd; vBary = vec3(0.0, 0.0, 1.0); }
    else if (aSide < -0.5) { pos = sc - t0 * L * 0.45 - n * Wd; vBary = vec3(1.0, 0.0, 0.0); }
    else { pos = sc + t0 * L * 0.55; vBary = vec3(0.0, 1.0, 0.0); }
    vAcross = 0.0;
  }
  float vis = 1.0;
  float day = 1.0;
  if (uMode == 0) {
    vis = smoothstep(-0.005, 0.07, dot(aPos, uCenter));
    day = mix(1.0, 0.55 + 0.45 * smoothstep(-0.3, 0.25, dot(aPos, uSun)), uLighting);
  }
  float pxPerRad = uMode == 0 ? uRadiusPx : 1.0 / uFlatScale;
  vAlong = aDist * pxPerRad / uDpr;
  vColor = vec4(aColor.rgb * day, aColor.a * vis);
  vHalf = 0.5 * aWidth;
  vCase = aCasing;
  vCaseA = aCaseA * vis;
  vStyle = aStyle;
  vFlow = aFlow;
  vKind = aKind;
  gl_Position = vec4(pos / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in float vAcross;
in float vAlong;
in float vHalf;
in float vCase;
in float vCaseA;
in float vStyle;
in float vFlow;
in float vKind;
in vec3 vBary;
uniform float uDpr;
uniform float uTime;
out vec4 outColor;
void main() {
  float lineA, caseA;
  vec3 ink = vec3(0.07, 0.05, 0.04);
  if (vKind > 0.5) {
    // Distance (px) to the nearest edge of the arrowhead triangle.
    float b = min(vBary.x, min(vBary.y, vBary.z));
    float dpx = b / max(fwidth(b), 1e-5) / uDpr;
    caseA = clamp(dpx + 0.5, 0.0, 1.0) * vCaseA;
    lineA = clamp(dpx - vCase + 0.5, 0.0, 1.0);
  } else {
    float across = abs(vAcross) / uDpr;
    float s = vAlong - uTime * vFlow;
    if (vStyle > 1.5) {
      float P = 2.0 * vHalf * 2.4 + 2.5;
      float a = mod(s, P) - 0.5 * P;
      float dd = length(vec2(a, across));
      lineA = clamp(vHalf + 0.5 - dd, 0.0, 1.0);
      caseA = clamp(vHalf + vCase + 0.5 - dd, 0.0, 1.0) * vCaseA;
    } else {
      lineA = clamp(vHalf + 0.5 - across, 0.0, 1.0);
      caseA = clamp(vHalf + vCase + 0.5 - across, 0.0, 1.0) * vCaseA;
      if (vStyle > 0.5) {
        float dash = 6.0 * vHalf + 4.0, gap = 3.5 * vHalf + 3.0;
        float f = mod(s, dash + gap);
        float m = clamp(f + 0.5, 0.0, 1.0) * clamp(dash - f + 0.5, 0.0, 1.0);
        lineA *= m;
        caseA *= m;
      }
    }
  }
  float la = vColor.a * lineA;
  vec3 c = vColor.rgb * la + ink * caseA * (1.0 - la);
  float a = la + caseA * (1.0 - la);
  if (a <= 0.003) discard;
  outColor = vec4(c, a);
}
`;
