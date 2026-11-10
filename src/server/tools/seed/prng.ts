/** Deterministic PRNG (mulberry32) so the seed is reproducible for a given `now`. */
export type Rand = {
  /** float in [0, 1) */
  next: () => number;
  /** integer in [min, max] inclusive */
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
  uuid: () => string;
};

export function createRand(seed: number): Rand {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const hex = (n: number) => Array.from({ length: n }, () => int(0, 15).toString(16)).join('');
  return {
    next,
    int,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[int(0, items.length - 1)] as (typeof items)[number];
    },
    chance: (p) => next() < p,
    // RFC 4122 v4 layout, deterministic bytes.
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[int(0, 3)]}${hex(3)}-${hex(12)}`,
  };
}
