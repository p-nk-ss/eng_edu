// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { findResumableLessonId } from "./resumable";

describe("findResumableLessonId", () => {
  const now = new Date(2026, 8, 25, 10, 0);

  it("asks for a PLANNED/IN_PROGRESS lesson dated today OR with an unanswered exercise, newest first", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "L1" });
    expect(await findResumableLessonId({ lesson: { findFirst } } as never, now)).toBe("L1");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        OR: [
          { date: { gte: new Date(2026, 8, 25), lt: new Date(2026, 8, 26) } },
          { writtenCompletedAt: null, exercises: { some: { answeredAt: null } } },
        ],
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { id: true },
    });
  });

  it("returns null when nothing is resumable", async () => {
    expect(await findResumableLessonId({ lesson: { findFirst: vi.fn().mockResolvedValue(null) } } as never, now)).toBeNull();
  });

  it("a completed written block is not resumable", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await findResumableLessonId({ lesson: { findFirst } } as never, now);
    const unfinished = findFirst.mock.calls[0][0].where.OR[1];
    expect(unfinished.writtenCompletedAt).toBeNull();
  });
});
