// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dueLabel, formatDay, startOfTomorrow } from "./due";

const now = new Date(2026, 9, 4, 10, 0); // 4 Oct, local

describe("dueLabel", () => {
  it("covers overdue, today, tomorrow, later and mastered", () => {
    expect(dueLabel(new Date(2026, 8, 27, 6, 15), "NEW", now)).toEqual({ label: "Overdue since 27 Sep", isDue: true });
    expect(dueLabel(new Date(2026, 9, 4, 23, 30), "REVIEWING", now)).toEqual({ label: "Due today", isDue: true });
    expect(dueLabel(new Date(2026, 9, 5, 0, 10), "REVIEWING", now)).toEqual({ label: "Due tomorrow", isDue: false });
    expect(dueLabel(new Date(2026, 9, 11, 9, 0), "REVIEWING", now)).toEqual({ label: "In 7 days", isDue: false });
    expect(dueLabel(new Date(2026, 9, 1), "MASTERED", now)).toEqual({ label: "Mastered", isDue: false });
  });
  it("formats days with a fixed month table", () => {
    expect(formatDay(new Date(2026, 8, 27))).toBe("27 Sep");
  });
  it("startOfTomorrow is local midnight", () => {
    expect(startOfTomorrow(now)).toEqual(new Date(2026, 9, 5));
  });
});
