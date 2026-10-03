import { Rng } from "../src/core/rng";
import { createProtoLanguage, createRegistry, nameSettlement, namePerson, hyphenated, romanizeWord } from "../src/lang";
const rng = new Rng("styles/norse");
const l = createProtoLanguage(rng.fork("l"), { style: "norse" });
const reg = createRegistry(); const r = rng.fork("n");
console.log("heads", l.naming.settlementHeads.map(([h]) => `${h}=${romanizeWord(l.orthography, l.lexicon[h].form)}`).join(" "));
console.log("headForms", JSON.stringify(l.naming.headForms), "pFinalCoda", l.phonology.pFinalCoda, "patterns", JSON.stringify(l.naming.patterns));
for (let i = 0; i < 8; i++) { const n = nameSettlement(l, r, {}, { registry: reg }); console.log(n.roman, hyphenated(n), n.gloss); }
for (let i = 0; i < 6; i++) { const n = namePerson(l, r, { gender: i % 2 ? "f" : "m", registry: reg }); console.log("P", n.roman, hyphenated(n), n.gloss, l.naming.personStyle); }
