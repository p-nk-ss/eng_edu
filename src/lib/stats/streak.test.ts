// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { computeStreak, getStreak } from "./streak";

const now = new Date(2026, 8, 25, 9, 0); // local
const d = (day: number, h = 12) => new Date(2026, 8, day, h, 0);

describe("computeStreak", () => {
  it("is 0 with no answers", () => expect(computeStreak([], now)).toEqual({ days: 0, atRisk: false }));
  it("counts consecutive days ending today", () => {
    expect(computeStreak([d(25), d(24), d(23), d(21)], now)).toEqual({ days: 3, atRisk: false });
  });
  it("counts from yesterday and marks it at risk when today has no answer yet", () => {
    expect(computeStreak([d(24), d(23)], now)).toEqual({ days: 2, atRisk: true });
  });
  it("is 0 when the last answer was before yesterday", () => {
    expect(computeStreak([d(22), d(21)], now)).toEqual({ days: 0, atRisk: false });
  });
  it("uses local day boundaries and ignores duplicates", () => {
    expect(computeStreak([new Date(2026, 8, 25, 0, 0), new Date(2026, 8, 24, 23, 59), d(24, 8), d(24, 9)], now)).toEqual({ days: 2, atRisk: false });
  });
});

describe("getStreak", () => {
  it("reads answeredAt of the last 400 days", async () => {
    const findMany = vi.fn().mockResolvedValue([{ answeredAt: d(25) }]);
    expect(await getStreak({ exercise: { findMany } } as never, now)).toEqual({ days: 1, atRisk: false });
    expect(findMany).toHaveBeenCalledWith({
      where: { answeredAt: { gte: new Date(2026, 8, 25 - 400) } },
      select: { answeredAt: true },
    });
  });
  it("getStreak returns null when the DB fails", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("connection refused"));
    expect(await getStreak({ exercise: { findMany } } as never, now)).toBeNull();
  });
});
