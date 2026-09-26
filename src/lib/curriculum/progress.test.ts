vi.mock("@/lib/db", () => ({ prisma: {} })); // never build a real PrismaClient in unit tests

import { describe, it, expect, vi } from "vitest";
import { getSyllabusProgress, summarizeSyllabus } from "./progress";

describe("summarizeSyllabus", () => {
  it("folds grammar/vocab rows into per-level counts, ordered A1..C2", () => {
    const grammar = [
      { cefrLevel: "A1", status: "MASTERED" },
      { cefrLevel: "A1", status: "NOT_STARTED" },
      { cefrLevel: "A1", status: "INTRODUCED" },
      { cefrLevel: "B1", status: "PRACTICING" },
    ];
    const vocab = [
      { cefrLevel: "A1", status: "KNOWN" },
      { cefrLevel: "A1", status: "NEW" },
      { cefrLevel: "A1", status: "SEEN" },
      { cefrLevel: "B1", status: "KNOWN" },
      { cefrLevel: "B1", status: "LEARNING" },
    ];
    expect(summarizeSyllabus(grammar, vocab)).toEqual([
      {
        level: "A1",
        grammarTotal: 3,
        grammarMastered: 1,
        grammarInProgress: 1,
        vocabTotal: 3,
        vocabKnown: 1,
        vocabLearning: 1,
      },
      {
        level: "B1",
        grammarTotal: 1,
        grammarMastered: 0,
        grammarInProgress: 1,
        vocabTotal: 2,
        vocabKnown: 1,
        vocabLearning: 1,
      },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(summarizeSyllabus([], [])).toEqual([]);
  });
});

describe("getSyllabusProgress", () => {
  it("counts only teachable grammar topics", async () => {
    const grammarFindMany = vi.fn().mockResolvedValue([{ cefrLevel: "B1", status: "MASTERED" }]);
    const vocabFindMany = vi.fn().mockResolvedValue([{ cefrLevel: "B1", status: "NEW" }]);
    const db = { grammarTopic: { findMany: grammarFindMany }, vocabItem: { findMany: vocabFindMany } };

    const out = await getSyllabusProgress(db as unknown as Parameters<typeof getSyllabusProgress>[0]);

    expect(grammarFindMany).toHaveBeenCalledWith({ where: { teachable: true }, select: { cefrLevel: true, status: true } });
    expect(out).toEqual([
      { level: "B1", grammarTotal: 1, grammarMastered: 1, grammarInProgress: 0, vocabTotal: 1, vocabKnown: 0, vocabLearning: 0 },
    ]);
  });

  it("returns null when the database is unreachable", async () => {
    const db = { grammarTopic: { findMany: vi.fn().mockRejectedValue(new Error("down")) }, vocabItem: { findMany: vi.fn() } };
    expect(await getSyllabusProgress(db as unknown as Parameters<typeof getSyllabusProgress>[0])).toBeNull();
  });
});
