/** FNV-1a 32-bit hash of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG - small, fast, deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A permutation of 0..n-1 derived from `seed` (the exercise id), stable across reloads and
 * identical on server and client. Never the identity when n > 1, so the order is never the key's.
 */
export function seededPermutation(seed: string, n: number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(hash(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  if (n > 1 && p.every((v, i) => v === i)) p.push(p.shift()!);
  return p;
}
