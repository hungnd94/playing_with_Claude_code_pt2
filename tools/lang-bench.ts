/**
 * Language engine benchmark.
 *
 *   npx tsx tools/lang-bench.ts [n=30]
 *
 * Times proto-language creation, daughter derivation (splits and stages),
 * and the naming calls the history simulation makes thousands of times.
 * Budgets (brief): proto < 20 ms, derive < 10 ms, name < 0.1 ms.
 */
import { Rng } from "../src/core/rng";
import {
  createProtoLanguage,
  createRegistry,
  deriveLanguage,
  FLAVOURS,
  nameFeature,
  namePerson,
  nameSettlement,
  nameDeity,
  nameRealm,
  borrowName,
  evolveName,
  motto,
  type Language,
} from "../src/lang";

const n = Number(process.argv[2] ?? 30);
// CPU time (user + system) rather than wall time: the dev container is shared and loaded.
const cpuMs = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const fmt = (ms: number) => (ms < 0.1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`);
const time = (label: string, count: number, f: () => void): number => {
  const t = cpuMs();
  const w = performance.now();
  f();
  const ms = (cpuMs() - t) / count;
  const wall = (performance.now() - w) / count;
  console.log(`${label.padEnd(28)} cpu ${fmt(ms).padStart(9)}   wall ${fmt(wall).padStart(9)}`);
  return ms;
};

// warm-up (JIT): every code path once or twice
{
  const wr = createRegistry();
  for (let i = 0; i < 8; i++) {
    const p = createProtoLanguage(new Rng("warm" + i), { flavour: FLAVOURS[i % FLAVOURS.length] });
    const d = deriveLanguage(p, new Rng("w" + i), 500);
    deriveLanguage(d, new Rng("ws" + i), 800, { stage: true });
    const wn = new Rng("wn" + i);
    for (let k = 0; k < 30; k++) {
      nameSettlement(d, wn, {}, { registry: wr });
      namePerson(d, wn, { registry: wr });
      nameFeature(d, wn, "river", {}, { registry: wr });
    }
  }
}

const protos: Language[] = [];
time("proto-language", n, () => {
  for (let i = 0; i < n; i++) protos.push(createProtoLanguage(new Rng("bench-p" + i), { flavour: FLAVOURS[i % FLAVOURS.length] }));
});
const kids: Language[] = [];
time("derive (split)", n, () => {
  for (let i = 0; i < n; i++) kids.push(deriveLanguage(protos[i], new Rng("bench-d" + i), 500));
});
const grand: Language[] = [];
time("derive (split, depth 2)", n, () => {
  for (let i = 0; i < n; i++) grand.push(deriveLanguage(kids[i], new Rng("bench-g" + i), 1000));
});
time("derive (stage)", n, () => {
  for (let i = 0; i < n; i++) deriveLanguage(kids[i], new Rng("bench-s" + i), 900, { stage: true });
});
const all = [...protos, ...kids, ...grand];
const reg = createRegistry();
const r = new Rng("bench-names");
const N = 3000;
time("nameSettlement", N, () => {
  for (let i = 0; i < N; i++) nameSettlement(all[i % all.length], r, { features: ["river", "oak"] }, { registry: reg });
});
time("namePerson", N, () => {
  for (let i = 0; i < N; i++) namePerson(all[i % all.length], r, { gender: i % 2 ? "f" : "m", registry: reg });
});
time("nameFeature", N, () => {
  for (let i = 0; i < N; i++) nameFeature(all[i % all.length], r, "river", { color: "white" }, { registry: reg });
});
time("nameDeity", 1000, () => {
  for (let i = 0; i < 1000; i++) nameDeity(all[i % all.length], r, { domain: "sun", registry: reg });
});
time("nameRealm", 1000, () => {
  for (let i = 0; i < 1000; i++) nameRealm(all[i % all.length], r, { registry: reg });
});
const towns = protos.map((l) => nameSettlement(l, r, {}, { registry: reg }));
time("evolveName (2 steps)", N, () => {
  for (let i = 0; i < N; i++) evolveName(towns[i % n], protos[i % n], grand[i % n]);
});
time("borrowName", N, () => {
  for (let i = 0; i < N; i++) borrowName(towns[i % n], protos[(i + 1) % n], { from: protos[i % n] });
});
time("motto", 1000, () => {
  for (let i = 0; i < 1000; i++) motto(all[i % all.length], r);
});
