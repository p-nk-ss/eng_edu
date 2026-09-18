// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} })); // never build a real PrismaClient in unit tests

import { selectLessonInputs, ProfileMissingError, type LessonInputsDb } from "./lessonInputs";

const now = new Date("2026-09-18T10:00:00Z");

function fakeDb(over: Partial<Record<string, unknown>> = {}) {
  const calls: Record<string, unknown> = {};
  const table = (name: string, rows: unknown) => ({
    findFirst: vi.fn(async (args: unknown) => ((calls[name] = args), rows)),
    findMany: vi.fn(async (args: unknown) => ((calls[name] = args), rows)),
  });
  const db = {
    profile: table("profile", "profile" in over ? over.profile : {
      id: "p1", level: "B1+", goals: "g", interests: "IT", nativeLang: "ru", preferredThemes: ["technology"],
    }),
    lesson: table("lesson", over.lessons ?? [{ theme: "technology" }]),
    grammarTopic: table("grammarTopic", over.grammar ?? [
      { id: "g1", name: "Past Simple", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 2, teachable: true, importance: 2, _count: { errors: 0 } },
      { id: "g2", name: "Present Perfect", cefrLevel: "B1", status: "PRACTICING", sortOrder: 5, teachable: true, importance: 2, _count: { errors: 1 } },
    ]),
    vocabItem: table("vocabItem", over.vocab ?? [
      { id: "v1", headword: "colleague", cefrLevel: "B1", topic: "work", status: "NEW", lastSeenAt: null },
      { id: "v2", headword: "deadline", cefrLevel: "B1", topic: "work", status: "NEW", lastSeenAt: null },
    ]),
    errorRecord: table("errorRecord", over.errors ?? [{ id: "e1" }]),
  };
  return { db: db as unknown as LessonInputsDb, calls };
}

describe("selectLessonInputs", () => {
  it("throws ProfileMissingError with a seed hint when there is no profile", async () => {
    const { db } = fakeDb({ profile: null });
    await expect(selectLessonInputs(db, now)).rejects.toBeInstanceOf(ProfileMissingError);
    await expect(selectLessonInputs(db, now)).rejects.toThrow(/prisma db seed/);
  });

  it("combines profile, rotation history, grammar, vocab and due errors", async () => {
    const { db, calls } = fakeDb();
    const out = await selectLessonInputs(db, now);

    expect(out.profile.id).toBe("p1");
    expect(out.theme.key).toBe("work"); // 'technology' was just used; first never-used theme in THEMES order
    expect(out.grammarTopic?.id).toBe("g2"); // PRACTICING with open errors wins
    expect(out.vocab.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(out.dueErrors).toEqual([{ id: "e1" }]);

    expect(calls.lesson).toMatchObject({
      where: { theme: { not: null } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
    expect(calls.errorRecord).toMatchObject({
      where: { nextReviewAt: { lte: now }, status: { not: "MASTERED" } },
    });
    expect(calls.vocabItem).toMatchObject({
      where: { OR: [{ status: "LEARNING" }, { status: "NEW", cefrLevel: { in: ["B1", "B2"] } }] },
      orderBy: { id: "asc" },
    });
    expect(calls.grammarTopic).toMatchObject({
      where: { status: { not: "MASTERED" } },
      orderBy: { id: "asc" },
    });
  });

  it("prefers a PRACTICING topic with open errors over one with a better sortOrder", async () => {
    const { db } = fakeDb({
      grammar: [
        { id: "gA", name: "A", cefrLevel: "B1", status: "PRACTICING", sortOrder: 1, teachable: true, importance: 2, _count: { errors: 0 } },
        { id: "gB", name: "B", cefrLevel: "B1", status: "PRACTICING", sortOrder: 9, teachable: true, importance: 2, _count: { errors: 2 } },
      ],
    });
    const out = await selectLessonInputs(db, now);
    expect(out.grammarTopic?.id).toBe("gB");
  });

  it("ignores preferred theme keys that no longer exist", async () => {
    const { db } = fakeDb({
      profile: { id: "p1", level: "B1", goals: "", interests: "", nativeLang: "ru", preferredThemes: ["ghost"] },
      lessons: [],
    });
    expect((await selectLessonInputs(db, now)).theme.key).toBe("work"); // plain THEMES order
  });

  it("skips non-teachable grammar topics and prefers higher importance", async () => {
    const { db } = fakeDb({
      grammar: [
        { id: "g0", name: "You are", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 1, teachable: false, importance: 1, _count: { errors: 0 } },
        { id: "g1", name: "-thing ADJ", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 2, teachable: true, importance: 3, _count: { errors: 0 } },
        { id: "g2", name: "PAST PERFECT", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 14, teachable: true, importance: 1, _count: { errors: 0 } },
      ],
    });
    expect((await selectLessonInputs(db, now)).grammarTopic?.id).toBe("g2");
  });
});
