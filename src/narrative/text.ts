/**
 * Small English text utilities: articles, plurals, ordinals, roman numerals,
 * number words, list joining, the rounding a historian would use, date
 * ranges and durations. Pure string functions (no Rich).
 */

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD_SMALL: Record<string, string> = {
  one: "first", two: "second", three: "third", four: "fourth", five: "fifth", six: "sixth", seven: "seventh", eight: "eighth", nine: "ninth", ten: "tenth",
  eleven: "eleventh", twelve: "twelfth", thirteen: "thirteenth", fourteen: "fourteenth", fifteen: "fifteenth", sixteen: "sixteenth", seventeen: "seventeenth",
  eighteen: "eighteenth", nineteen: "nineteenth", twenty: "twentieth", thirty: "thirtieth", forty: "fortieth", fifty: "fiftieth", sixty: "sixtieth",
  seventy: "seventieth", eighty: "eightieth", ninety: "ninetieth", hundred: "hundredth", thousand: "thousandth",
};

/** Number in words for 0..9999 ("forty-two", "one hundred and five"); digits beyond. */
export function numberWord(n: number): string {
  n = Math.round(n);
  if (n < 0) return "minus " + numberWord(-n);
  if (n < 20) return SMALL[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + SMALL[n % 10] : "");
  if (n < 1000) return SMALL[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + numberWord(n % 100) : "");
  if (n < 10000) return numberWord(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? (n % 1000 < 100 ? " and " : " ") + numberWord(n % 1000) : "");
  return formatInt(n);
}

/** Small counts in words (≤ 12, or round tens to 100), larger ones in digits — the usual editorial rule. */
export function count(n: number): string {
  n = Math.round(n);
  if (n <= 12 || (n <= 100 && n % 10 === 0)) return numberWord(n);
  return formatInt(n);
}

/** "first", "second", "twenty-first", … (words up to 99, then "101st"). */
export function ordinal(n: number): string {
  if (n >= 1 && n < 100) {
    const w = numberWord(n);
    const parts = w.split("-");
    const last = parts.pop()!;
    return [...parts, ORD_SMALL[last] ?? last + "th"].join("-");
  }
  return ordinalNum(n);
}

/** "1st", "22nd", "113th". */
export function ordinalNum(n: number): string {
  const m100 = n % 100, m10 = n % 10;
  const suf = m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th";
  return `${n}${suf}`;
}

export function roman(n: number): string {
  const vals: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, t] of vals) while (n >= v) {
    s += t;
    n -= v;
  }
  return s;
}

/** "12,345". */
export function formatInt(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? "-" + out : out;
}

/** Round to `sig` significant figures. */
export function roundSig(n: number, sig = 2): number {
  if (n === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - sig + 1);
  return Math.round(n / p) * p;
}

/**
 * A quantity as a historian would give it: exact when small ("212"), rounded
 * to two significant figures with a hedge when large ("some 40,000"),
 * millions in words ("1.2 million"). `hedge` = false drops "some/about".
 */
export function approx(n: number, hedge = true): string {
  n = Math.max(0, Math.round(n));
  if (n < 100) return count(n);
  const r = roundSig(n, n < 1000 ? 1 : 2);
  let body: string;
  if (r >= 1e6) {
    const m = roundSig(n / 1e6, 2);
    body = `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, "")} million`;
  } else body = formatInt(r);
  if (!hedge) return body;
  const diff = Math.abs(r - n) / Math.max(1, n);
  if (diff < 0.005 && n < 1000) return body;
  return (r > n ? (diff > 0.03 ? "nearly " : "about ") : diff > 0.03 ? "over " : "some ") + body;
}

/** Population phrase: "some 40,000 souls" / "a few hundred people". */
export function souls(n: number): string {
  if (n < 60) return "a handful of families";
  if (n < 400) return "a few hundred people";
  if (n < 1000) return "several hundred people";
  return `${approx(n)} ${n >= 20000 ? "souls" : "people"}`;
}

/** Area in km² as a rounded phrase. */
export function area(km2: number): string {
  return `${approx(km2, false)} km²`;
}

/** "a"/"an" + word (handles vowels, silent h, "one", "uni-", "eu-"). */
export function aAn(word: string): string {
  return `${anOrA(word)} ${word}`;
}

export function anOrA(word: string): string {
  const w = word.replace(/^[^A-Za-zÀ-ÿ0-9]+/, "").toLowerCase();
  if (/^(one|uni[^nmd]|use|usu|eu|ewe|ur[aeiou])/.test(w)) return "a";
  if (/^(hour|honest|honou?r|heir)/.test(w)) return "an";
  if (/^[aeiou]/.test(w)) return "an";
  if (/^(8|11|18)/.test(w)) return "an";
  return "a";
}

const IRREGULAR: Record<string, string> = {
  man: "men", woman: "women", child: "children", person: "people", foot: "feet", tooth: "teeth", mouse: "mice", ox: "oxen",
  wife: "wives", life: "lives", knife: "knives", wolf: "wolves", half: "halves", thief: "thieves", leaf: "leaves", sheaf: "sheaves",
  city: "cities", deity: "deities", dynasty: "dynasties", treaty: "treaties", century: "centuries", army: "armies", colony: "colonies",
  "great city": "great cities", "city-state": "city-states", crisis: "crises", genus: "genera", staff: "staves", hero: "heroes",
};

export function pluralize(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower]);
  const sp = word.lastIndexOf(" ");
  if (sp > 0 && !/ of /.test(word)) return word.slice(0, sp + 1) + pluralize(word.slice(sp + 1));
  if (/ of /.test(word)) {
    const i = word.indexOf(" of ");
    return pluralize(word.slice(0, i)) + word.slice(i);
  }
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

function matchCase(model: string, w: string): string {
  return model[0] === model[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
}

/** "3 cities", "one city", "twelve towns" (words via `count`). */
export function plural(n: number, word: string, pl?: string): string {
  return `${count(n)} ${n === 1 ? word : pl ?? pluralize(word)}`;
}

/** Join strings: "A", "A and B", "A, B and C". */
export function joinList(items: string[], conj = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function lowerFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Strip a leading English article. */
export function stripThe(s: string): string {
  return s.replace(/^the /i, "");
}

/** Duration in words: "a year", "two years", "a decade", "some forty years", "nearly three centuries". */
export function duration(years: number): string {
  years = Math.max(0, Math.round(years));
  if (years === 0) return "less than a year";
  if (years === 1) return "a year";
  if (years < 13) return `${numberWord(years)} years`;
  if (years < 100) return years % 10 === 0 ? `${numberWord(years)} years` : `${numberWord(years)} years`;
  const c = years / 100;
  if (Math.abs(c - Math.round(c)) < 0.08) {
    const k = Math.round(c);
    return k === 1 ? "a century" : `${numberWord(k)} centuries`;
  }
  if (years < 1000) return `${formatInt(years)} years`;
  return `${formatInt(years)} years`;
}

/** Rounded duration with hedging for long spans: "some 340 years", "nearly three centuries". */
export function roughDuration(years: number): string {
  years = Math.round(years);
  if (years < 20) return duration(years);
  if (years < 100) {
    const r = Math.round(years / 5) * 5;
    return r === years ? `${numberWord(years)} years` : `some ${numberWord(r)} years`;
  }
  const c = years / 100;
  const fr = c - Math.floor(c);
  if (fr < 0.1) return Math.floor(c) === 1 ? "a century" : `${numberWord(Math.floor(c))} centuries`;
  if (fr > 0.85) return Math.ceil(c) === 1 ? "nearly a century" : `nearly ${numberWord(Math.ceil(c))} centuries`;
  const r = Math.round(years / 10) * 10;
  return `some ${formatInt(r)} years`;
}

/** "1182–1201", "1182" if equal, "1182–" if open. */
export function yearRange(a: number, b: number): string {
  if (b < 0) return `${a}–`;
  if (a === b) return `${a}`;
  return `${a}–${b}`;
}

/** The century of a year, 0-based years: 0–99 → "the first century", 1182 → "the twelfth century". */
export function centuryOf(year: number): string {
  return `the ${ordinal(Math.floor(year / 100) + 1)} century`;
}

/** "early", "middle" or "late" part of a century. */
export function centuryPart(year: number): "early" | "middle" | "late" {
  const r = year % 100;
  return r < 34 ? "early" : r < 67 ? "middle" : "late";
}

/** "the early twelfth century". */
export function vagueDate(year: number): string {
  const part = centuryPart(year);
  return `the ${part === "middle" ? "mid-" : part + " "}${ordinal(Math.floor(year / 100) + 1)} century`.replace("mid- ", "mid-");
}

/** Percent phrase: 0.33 → "a third", 0.5 → "half", 0.07 → "7 per cent". */
export function fraction(f: number): string {
  if (f >= 0.97) return "nearly all";
  if (f >= 0.72 && f < 0.78) return "three quarters";
  if (f >= 0.62 && f < 0.72) return "two thirds";
  if (f >= 0.47 && f < 0.53) return "half";
  if (f >= 0.3 && f < 0.37) return "a third";
  if (f >= 0.23 && f < 0.27) return "a quarter";
  if (f >= 0.18 && f < 0.22) return "a fifth";
  if (f >= 0.09 && f < 0.11) return "a tenth";
  return `${Math.round(f * 100)} per cent`;
}

/** Deterministic hash of numbers/strings to [0, 2^32). */
export function hashOf(...xs: (number | string)[]): number {
  let h = 2166136261;
  for (const x of xs) {
    const s = typeof x === "number" ? String(x) : x;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x9e3779b9, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Deterministic choice among alternatives, keyed by any values. */
export function choose<T>(options: readonly T[], ...key: (number | string)[]): T {
  return options[hashOf(...key) % options.length];
}

/** Ages: "aged 61", "in infancy", "as a child of seven". */
export function agePhrase(age: number): string {
  if (age < 1) return "in infancy";
  if (age < 13) return `as a child of ${numberWord(age)}`;
  return `aged ${age}`;
}

/** Possessive: "Oshar's", "Velmis'". */
export function possessive(s: string): string {
  return /s$/.test(s) ? `${s}'` : `${s}'s`;
}
