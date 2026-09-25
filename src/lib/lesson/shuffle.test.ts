// @vitest-environment node
import { describe, it, expect } from "vitest";
import { seededPermutation } from "./shuffle";

const isPermutation = (p: number[], n: number) => p.length === n && [...p].sort((a, b) => a - b).every((v, i) => v === i);

describe("seededPermutation", () => {
  it("returns a permutation of 0..n-1", () => {
    for (const n of [0, 1, 2, 5, 9]) expect(isPermutation(seededPermutation("ex1", n), n)).toBe(true);
  });
  it("is deterministic for the same seed", () => {
    expect(seededPermutation("clx123", 6)).toEqual(seededPermutation("clx123", 6));
  });
  it("never returns the identity when n > 1", () => {
    for (let i = 0; i < 200; i++) {
      const p = seededPermutation(`seed-${i}`, 3);
      expect(p).not.toEqual([0, 1, 2]);
    }
  });
  it("differs between seeds for most inputs", () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => seededPermutation(`s${i}`, 6).join(",")));
    expect(seen.size).toBeGreaterThan(10);
  });
});
