// Benchmark script creation / derivation / rendering.
//   npx tsx tools/script-bench.ts
import { Rng } from "../src/core/rng";
import * as S from "../src/script";
import { INVENTORIES, randomWords } from "./script-samples";
import type { ScriptKind } from "../src/script";
const kinds: ScriptKind[] = ["alphabet", "abjad", "abugida", "syllabary", "featural"];
const invs = Object.keys(INVENTORIES);
// warm-up
for (let i = 0; i < 20; i++) S.createScript(INVENTORIES[invs[i % invs.length]], new Rng(`warm${i}`));
const per: Record<string, number[]> = {};
let worst = 0;
let worstKey = "";
const t0 = performance.now();
const N = 200;
for (let i = 0; i < N; i++) {
  const inv = invs[i % invs.length];
  const kind = kinds[i % kinds.length];
  const a = performance.now();
  const s = S.createScript(INVENTORIES[inv], new Rng(`bench${i}`), { kind });
  const dt = performance.now() - a;
  const key = `${kind}/${s.morph.family}`;
  (per[key] ??= []).push(dt);
  if (dt > worst) {
    worst = dt;
    worstKey = `${key} ${inv} (${s.glyphs.length} glyphs)`;
  }
}
const total = performance.now() - t0;
console.log(`create: mean ${(total / N).toFixed(1)} ms, worst ${worst.toFixed(1)} ms (${worstKey})`);
for (const [k, v] of Object.entries(per).sort()) {
  v.sort((a, b) => a - b);
  console.log(`  ${k.padEnd(22)} n=${String(v.length).padStart(3)} median ${v[v.length >> 1].toFixed(1).padStart(6)} max ${v[v.length - 1].toFixed(1).padStart(6)}`);
}
// derive
const base = S.createScript(INVENTORIES.semitic, new Rng("b"), { kind: "abjad" });
let a = performance.now();
for (let i = 0; i < 50; i++) S.deriveScript(base, new Rng(`d${i}`), { inventory: INVENTORIES[invs[i % invs.length]], drift: 0.6 });
console.log(`derive: mean ${((performance.now() - a) / 50).toFixed(1)} ms`);
// render words
const s = S.createScript(INVENTORIES.indic, new Rng("r"), { kind: "abugida" });
const words = randomWords(INVENTORIES.indic, new Rng("w"), 500);
a = performance.now();
let bytes = 0;
for (const w of words) bytes += S.renderWordSVG(s, w, { size: 24 }).length;
console.log(`renderWordSVG: ${((performance.now() - a) / words.length).toFixed(2)} ms/word (cold-ish cache), avg ${(bytes / words.length / 1024).toFixed(1)} KB`);
a = performance.now();
for (const w of words) S.renderWordSVG(s, w, { size: 24 });
console.log(`renderWordSVG warm: ${((performance.now() - a) / words.length).toFixed(3)} ms/word`);
console.log(`script JSON size: ${(JSON.stringify(s).length / 1024).toFixed(1)} KB`);
