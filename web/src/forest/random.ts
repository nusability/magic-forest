import type { Random } from '../plants';

const UINT32 = 2 ** 32;

/**
 * Mulberry32: a tiny, fast, well-distributed 32-bit generator. The forest keeps only each
 * plant's seed and regenerates its full detail from it whenever the camera comes close.
 */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/** A fresh seed for a new plant. Which plant grows is ambient chance; only its regeneration must repeat. */
export function newSeed(): number {
  return Math.floor(Math.random() * UINT32);
}
