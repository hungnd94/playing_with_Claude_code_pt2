import { Rng } from "../src/core/rng";
import { createScript } from "../src/script";
import { rasterize, similarity } from "../src/script/raster";
import { INV } from "../tests/script/fixtures";
for (const family of ["stave", "geometric", "round", "square", "hanging"] as const) {
  const kind = family === "hanging" ? "abugida" : "alphabet";
  const s = createScript(INV.germanic, new Rng(`dist/${family}`), { kind, family });
  const gl = s.glyphs.filter((g) => g.role === "consonant" || g.role === "vowel");
  for (let i = 0; i < gl.length; i++) for (let j = 0; j < i; j++) { const v = similarity(rasterize(gl[i].strokes, gl[i].w), rasterize(gl[j].strokes, gl[j].w)); if (v > 0.985) console.log(family, gl[i].sound, gl[i].origin, gl[i].note, "|", gl[j].sound, gl[j].origin, v.toFixed(3)); }
}
