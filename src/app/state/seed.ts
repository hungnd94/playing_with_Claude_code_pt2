/**
 * Seeds: `#seed-<word>` deep links, curated seeds and random seed words.
 * Only bare `#token` hashes are used (artifact hosting rule).
 */
export const CURATED_SEEDS: { seed: string; note: string }[] = [
  { seed: "velmarra", note: "river empires and a salt sea" },
  { seed: "ashkar", note: "steppe khaganates" },
  { seed: "oshen", note: "a scattered archipelago" },
  { seed: "tirnavel", note: "one great continent" },
  { seed: "kesh", note: "deserts and caravan cities" },
  { seed: "ulmenhold", note: "cold northern kingdoms" },
];

const SANITIZE = /[^a-z0-9-]+/g;

export function normalizeSeed(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-").replace(SANITIZE, "").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function seedFromHash(): string | null {
  try {
    const m = /^#seed-([a-z0-9-]{1,40})$/i.exec(location.hash);
    return m ? normalizeSeed(m[1]) : null;
  } catch {
    return null;
  }
}

export function writeSeedHash(seed: string): void {
  const h = `#seed-${seed}`;
  try {
    if (location.hash === h) return;
    history.replaceState(null, "", h);
  } catch {
    try {
      location.hash = h;
    } catch {
      /* sandboxed: ignore */
    }
  }
}

/** A pronounceable random seed word (UI only; the world itself is deterministic in the seed). */
export function randomSeed(): string {
  const on = ["v", "k", "t", "s", "m", "n", "r", "l", "d", "th", "sh", "br", "kr", "al", "or", "es", "y", "z", "h", "g"];
  const nu = ["a", "e", "i", "o", "u", "ae", "ai", "ei", "ou", "y"];
  const co = ["", "", "n", "r", "l", "s", "th", "m", "rr", "sk", "nd", "lv"];
  const rnd = (n: number): number => {
    try {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] % n;
    } catch {
      return Math.floor(Math.random() * n);
    }
  };
  const syl = 2 + rnd(2);
  let w = "";
  for (let i = 0; i < syl; i++) w += on[rnd(on.length)] + nu[rnd(nu.length)] + (i === syl - 1 ? co[rnd(co.length)] : "");
  return normalizeSeed(w);
}

/** "velmarra" → "Velmarra" (display name of a world). */
export function seedTitle(seed: string): string {
  return seed.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
