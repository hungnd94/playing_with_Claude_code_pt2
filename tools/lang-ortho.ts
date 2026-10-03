/**
 * Orthography inspector: for each seed, a proto-language and two generations
 * of daughters, with the spelling school, the non-ASCII letters actually used
 * (weighted by frequency in the lexicon), and sample words.
 *
 *   npx tsx tools/lang-ortho.ts seed1 seed2 …   (default: 16 seeds)
 */
import { Rng } from "../src/core/rng";
import { CONCEPTS, createProtoLanguage, deriveLanguage, FLAVOURS, romanizeWord, type Language } from "../src/lang";

const seeds = process.argv.slice(2).length ? process.argv.slice(2) : Array.from({ length: 16 }, (_, i) => `o${i}`);
const W = ["water", "fire", "stone", "river", "mountain", "sun", "moon", "wolf", "horse", "king", "god", "mother", "iron", "gold", "sea", "night", "heart", "sword", "eagle", "ford"];

function letters(l: Language): string {
  const counts = new Map<string, number>();
  for (const c of CONCEPTS) {
    const s = romanizeWord(l.orthography, l.lexicon[c.id].form);
    for (const ch of s.normalize("NFC")) if (!/[a-z]/.test(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([ch, n]) => `${ch}${n}`)
    .join(" ");
}

function show(l: Language, tag: string): void {
  const words = W.map((c) => romanizeWord(l.orthography, l.lexicon[c].form)).join(" ");
  console.log(`  ${tag} ${l.name.padEnd(12)} [${l.orthography.school}${l.phonology.style ? "/" + l.phonology.style : ""}] marks: ${letters(l) || "-"}`);
  console.log(`      ${words}`);
}

for (const s of seeds) {
  const rng = new Rng(s);
  const fl = FLAVOURS[rng.int(0, FLAVOURS.length - 1)];
  const p = createProtoLanguage(rng.fork("p"), { flavour: fl });
  console.log(`## ${s} (${fl})`);
  show(p, "P ");
  for (let i = 0; i < 2; i++) {
    const d = deriveLanguage(p, rng.fork("d" + i), 500);
    show(d, " D");
    const dd = deriveLanguage(d, rng.fork("dd" + i), 1000);
    show(dd, "  G");
  }
}
