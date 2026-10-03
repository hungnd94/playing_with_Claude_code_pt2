/**
 * Style gallery: one proto-language per sound style (or the given styles),
 * with sample words, towns, persons and a river, to judge each style's look.
 *
 *   npx tsx tools/lang-styles.ts [seed] [style …]
 */
import { Rng } from "../src/core/rng";
import { createProtoLanguage, createRegistry, nameFeature, namePerson, nameSettlement, romanizeWord, SOUND_STYLES } from "../src/lang";

const args = process.argv.slice(2);
const seed = args[0] ?? "styles";
const only = new Set(args.slice(1));
const W = ["water", "fire", "stone", "sun", "moon", "wolf", "horse", "king", "mother", "night", "gold", "sea", "tree", "heart"];

for (const st of SOUND_STYLES) {
  if (only.size && !only.has(st.id)) continue;
  const rng = new Rng(`${seed}/${st.id}`);
  const l = createProtoLanguage(rng.fork("l"), { style: st.id });
  const reg = createRegistry();
  const r = rng.fork("n");
  const words = W.map((c) => romanizeWord(l.orthography, l.lexicon[c].form)).join(" ");
  const towns = Array.from({ length: 5 }, () => nameSettlement(l, r, {}, { registry: reg }).roman).join(", ");
  const people = Array.from({ length: 5 }, (_, i) => namePerson(l, r, { gender: i % 2 ? "f" : "m", registry: reg }).roman).join(", ");
  const river = nameFeature(l, r, "river", {}, { registry: reg }).roman;
  console.log(`${st.id.padEnd(12)} ${l.name} [${l.orthography.school}]`);
  console.log(`   ${words}`);
  console.log(`   towns: ${towns} · river ${river}`);
  console.log(`   people: ${people}`);
}
