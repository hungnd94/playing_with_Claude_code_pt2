/**
 * Deterministic, forkable pseudo-random number generation.
 *
 * Every subsystem receives its own stream via `rng.fork("label")`, so adding a
 * random call in one module never perturbs the output of another. Given the
 * same world seed, the whole world is reproduced bit-for-bit.
 */

/** 32-bit string hash (cyrb53-style mixing, truncated). */
export function hashString(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Integer hash for combining numeric keys (e.g. cell index + salt). */
export function hashInt(x: number, salt = 0): number {
  let h = (x | 0) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash to a float in [0,1). */
export function hash01(x: number, salt = 0): number {
  return hashInt(x, salt) / 4294967296;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  /** The textual key this stream was derived from (for debugging / forking). */
  readonly key: string;

  constructor(seed: string | number, key?: string) {
    const s = typeof seed === "number" ? `#${seed}` : seed;
    this.key = key ?? s;
    this.a = hashString(s, 1);
    this.b = hashString(s, 2);
    this.c = hashString(s, 3);
    this.d = hashString(s, 4);
    // Warm up.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Derive an independent child stream. Same parent key + label → same child. */
  fork(label: string | number): Rng {
    const k = `${this.key}/${label}`;
    return new Rng(k, k);
  }

  /** sfc32 */
  nextU32(): number {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }

  /** Uniform float in [0,1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform float in [lo,hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [lo,hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick on empty array");
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick by weight. `weights[i]` ≥ 0. Returns index. */
  weightedIndex(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return Math.floor(this.next() * weights.length);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Pick from [item, weight] pairs. */
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    const idx = this.weightedIndex(pairs.map((p) => p[1]));
    return pairs[idx][0];
  }

  /** Fisher–Yates in place; returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** k distinct items sampled without replacement. */
  sample<T>(arr: readonly T[], k: number): T[] {
    const copy = arr.slice();
    this.shuffle(copy);
    return copy.slice(0, Math.min(k, copy.length));
  }

  /** Standard normal via Box–Muller. */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Exponential with given mean. */
  exponential(mean: number): number {
    let u = 0;
    while (u === 0) u = this.next();
    return -Math.log(u) * mean;
  }

  /** Poisson-distributed integer (Knuth for small λ, normal approx for large). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 40) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  /** Random unit vector on the sphere. */
  unitVector(): [number, number, number] {
    const z = this.range(-1, 1);
    const t = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), r * Math.sin(t), z];
  }
}
