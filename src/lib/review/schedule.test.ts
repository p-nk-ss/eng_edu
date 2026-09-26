// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextErrorState, REVIEW_INTERVAL_DAYS, REVIEW_MASTERED_STREAK } from "./schedule";

const now = new Date(2026, 8, 27, 10, 0);
const plusDays = (n: number) => new Date(2026, 8, 27 + n, 10, 0);

describe("nextErrorState", () => {
  it("uses the documented intervals", () => {
    expect(REVIEW_INTERVAL_DAYS).toEqual([1, 3, 7, 14]);
    expect(REVIEW_MASTERED_STREAK).toBe(3);
  });
  it("moves along 3, 7, 14 days on correct answers and masters at streak 3", () => {
    expect(nextErrorState({ correctStreak: 0 }, true, now)).toEqual({ status: "REVIEWING", correctStreak: 1, nextReviewAt: plusDays(3) });
    expect(nextErrorState({ correctStreak: 1 }, true, now)).toEqual({ status: "REVIEWING", correctStreak: 2, nextReviewAt: plusDays(7) });
    expect(nextErrorState({ correctStreak: 2 }, true, now)).toEqual({ status: "MASTERED", correctStreak: 3, nextReviewAt: plusDays(14) });
    expect(nextErrorState({ correctStreak: 5 }, true, now)).toEqual({ status: "MASTERED", correctStreak: 6, nextReviewAt: plusDays(14) });
  });
  it("resets to one day on a wrong answer", () => {
    expect(nextErrorState({ correctStreak: 2 }, false, now)).toEqual({ status: "REVIEWING", correctStreak: 0, nextReviewAt: plusDays(1) });
  });
});
