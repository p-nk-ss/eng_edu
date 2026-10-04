// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { listErrors, getErrorStats, getRecentlyMastered } from "./queries";
import { REVIEW_MASTERED_STREAK } from "../review/schedule";

const now = new Date(2026, 9, 4, 10, 0); // 4 Oct 2026, local - matches due.test.ts's "now"

// ---- listErrors ------------------------------------------------------------------------------

type Row = {
  id: string;
  category: string;
  grammarTopicId: string | null;
  description: string;
  status: string;
  correctStreak: number;
  nextReviewAt: Date;
  createdAt: Date;
};

const rowA: Row = {
  id: "A",
  category: "grammar",
  grammarTopicId: "g1",
  description: "- as -> than",
  status: "NEW",
  correctStreak: 0,
  nextReviewAt: new Date(2026, 8, 27, 6, 0), // 27 Sep - overdue
  createdAt: new Date(2026, 8, 20),
};
const rowB: Row = {
  id: "B",
  category: "translation: meaning",
  grammarTopicId: null,
  description: "- mean -> meaning",
  status: "REVIEWING",
  correctStreak: 1,
  nextReviewAt: new Date(2026, 9, 7), // 3 days after "now"
  createdAt: new Date(2026, 8, 25),
};

const topicsFixture = [{ id: "g1", title: "Comparative with more", name: "comparative_more" }];
const exercisesFixture = [
  { errorRecordId: "A", answeredAt: null, isCorrect: null }, // unanswered - excluded
  { errorRecordId: "B", answeredAt: new Date(2026, 9, 2), isCorrect: true },
];

/** A fake db: errorRecord/grammarTopic/exercise filter the given fixtures the way Prisma would. */
function makeDb(rows: Row[], topics = topicsFixture, exercises = exercisesFixture) {
  const errorRecordFindMany = vi.fn(async (args: { where?: { status?: unknown } }) => {
    const where = args.where;
    if (!where || where.status === undefined) return rows;
    if (where.status === "MASTERED") return rows.filter((r) => r.status === "MASTERED");
    if (typeof where.status === "object" && where.status !== null && "not" in where.status) {
      return rows.filter((r) => r.status !== "MASTERED");
    }
    return rows;
  });
  const grammarTopicFindMany = vi.fn(async (args: { where: { id: { in: string[] } } }) =>
    topics.filter((t) => args.where.id.in.includes(t.id)),
  );
  const exerciseFindMany = vi.fn(async (args: { where: { errorRecordId: { in: string[] }; answeredAt: { not: null } } }) =>
    exercises.filter((e) => args.where.errorRecordId.in.includes(e.errorRecordId as string) && e.answeredAt !== null),
  );
  const db = {
    errorRecord: { findMany: errorRecordFindMany },
    grammarTopic: { findMany: grammarTopicFindMany },
    exercise: { findMany: exerciseFindMany },
    vocabItem: { findMany: vi.fn() },
  } as never;
  return { db, errorRecordFindMany, grammarTopicFindMany, exerciseFindMany };
}

describe("listErrors", () => {
  it("builds items (due first), titles, examples, attempts and counts for status: open", async () => {
    const { db } = makeDb([rowA, rowB]);
    const result = await listErrors({ status: "open", group: "all" }, now, db);

    expect(result.items.map((i) => i.id)).toEqual(["A", "B"]);
    expect(result.items[0]).toMatchObject({
      title: "Comparative with more",
      group: "grammar",
      examples: ["as -> than"],
      due: { label: "Overdue since 27 Sep", isDue: true },
      attempts: [],
    });
    expect(result.items[1]).toMatchObject({
      title: "Translation - meaning",
      correctStreak: 1,
      streakTarget: REVIEW_MASTERED_STREAK,
      attempts: [{ at: new Date(2026, 9, 2), correct: true }],
    });
    expect(result.counts.status).toEqual({ open: 2, mastered: 0, all: 2 });
    expect(result.counts.group).toEqual({ all: 2, grammar: 1, translation: 1, vocab: 0, listening: 0, writing: 0, general: 0 });
  });

  it("filters by group after computing groups, but keeps counts over the whole status-filtered set", async () => {
    const { db } = makeDb([rowA, rowB]);
    const result = await listErrors({ status: "open", group: "translation" }, now, db);

    expect(result.items.map((i) => i.id)).toEqual(["B"]);
    expect(result.counts.group).toEqual({ all: 2, grammar: 1, translation: 1, vocab: 0, listening: 0, writing: 0, general: 0 });
  });

  it("title falls back to the category when the topic lookup returns nothing", async () => {
    const ghost: Row = { ...rowA, id: "C", grammarTopicId: "ghost", category: "grammar: deleted" };
    const { db } = makeDb([ghost], topicsFixture, []);
    const result = await listErrors({ status: "all", group: "all" }, now, db);
    expect(result.items[0].title).toBe("grammar: deleted");
  });

  it("uses the right errorRecord where clause per status filter", async () => {
    const mastered: Row = { ...rowB, id: "M", status: "MASTERED" };

    const { db: dbMastered, errorRecordFindMany: findManyMastered } = makeDb([rowA, mastered]);
    await listErrors({ status: "mastered", group: "all" }, now, dbMastered);
    expect(findManyMastered.mock.calls[1][0]).toMatchObject({ where: { status: "MASTERED" } });

    const { db: dbOpen, errorRecordFindMany: findManyOpen } = makeDb([rowA, mastered]);
    await listErrors({ status: "open", group: "all" }, now, dbOpen);
    expect(findManyOpen.mock.calls[1][0]).toMatchObject({ where: { status: { not: "MASTERED" } } });

    const { db: dbAll, errorRecordFindMany: findManyAll } = makeDb([rowA, mastered]);
    await listErrors({ status: "all", group: "all" }, now, dbAll);
    expect(findManyAll.mock.calls[1][0].where).toBeUndefined();
  });

  it("queries exercises by errorRecordId in the listed ids, answered only", async () => {
    const { db, exerciseFindMany } = makeDb([rowA, rowB]);
    await listErrors({ status: "open", group: "all" }, now, db);
    expect(exerciseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { errorRecordId: { in: ["A", "B"] }, answeredAt: { not: null } } }),
    );
  });
});

// ---- getErrorStats ----------------------------------------------------------------------------

describe("getErrorStats", () => {
  it("counts due-today/overdue and groups open errors", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { category: "grammar", grammarTopicId: "g1", nextReviewAt: new Date(2026, 9, 3) }, // overdue
      { category: "grammar", grammarTopicId: "g2", nextReviewAt: new Date(2026, 9, 4) }, // today
      { category: "vocab: agenda", grammarTopicId: null, nextReviewAt: new Date(2026, 9, 10) }, // later
    ]);
    const db = { errorRecord: { findMany } } as never;
    expect(await getErrorStats(now, db)).toEqual({
      dueToday: 2,
      openByGroup: [
        { group: "grammar", label: "Grammar", count: 2 },
        { group: "vocab", label: "Vocabulary", count: 1 },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { status: { not: "MASTERED" } },
      select: { category: true, grammarTopicId: true, nextReviewAt: true },
    });
  });

  it("returns null on failure", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("connection refused"));
    const db = { errorRecord: { findMany } } as never;
    expect(await getErrorStats(now, db)).toBeNull();
  });
});

// ---- getRecentlyMastered -----------------------------------------------------------------------

describe("getRecentlyMastered", () => {
  it("merges topics, words and mistakes, newest first", async () => {
    const grammarTopicFindMany = vi.fn().mockResolvedValue([{ title: "Past Simple", name: "X", masteredAt: new Date(2026, 9, 3) }]);
    const vocabItemFindMany = vi.fn().mockResolvedValue([{ headword: "deadline", masteredAt: new Date(2026, 9, 4) }]);
    const errorRecordFindMany = vi.fn().mockResolvedValue([{ category: "vocab: agenda", grammarTopicId: null, masteredAt: new Date(2026, 9, 1) }]);
    const db = {
      grammarTopic: { findMany: grammarTopicFindMany },
      vocabItem: { findMany: vocabItemFindMany },
      errorRecord: { findMany: errorRecordFindMany },
    } as never;

    expect(await getRecentlyMastered(db)).toEqual([
      { kind: "word", label: "deadline", at: new Date(2026, 9, 4) },
      { kind: "grammar", label: "Past Simple", at: new Date(2026, 9, 3) },
      { kind: "mistake", label: "Word - agenda", at: new Date(2026, 9, 1) },
    ]);

    expect(grammarTopicFindMany).toHaveBeenCalledWith({
      where: { status: "MASTERED", masteredAt: { not: null } },
      select: { title: true, name: true, masteredAt: true },
      orderBy: { masteredAt: "desc" },
      take: 5,
    });
    expect(vocabItemFindMany).toHaveBeenCalledWith({
      where: { status: "KNOWN", masteredAt: { not: null } },
      select: { headword: true, masteredAt: true },
      orderBy: { masteredAt: "desc" },
      take: 5,
    });
    expect(errorRecordFindMany).toHaveBeenCalledWith({
      where: { status: "MASTERED", masteredAt: { not: null } },
      select: { category: true, grammarTopicId: true, masteredAt: true },
      orderBy: { masteredAt: "desc" },
      take: 5,
    });
  });

  it("applies the limit after merging, not per source", async () => {
    const db = {
      grammarTopic: {
        findMany: vi.fn().mockResolvedValue([
          { title: "A", name: "a", masteredAt: new Date(2026, 9, 5) },
          { title: "B", name: "b", masteredAt: new Date(2026, 9, 4) },
        ]),
      },
      vocabItem: {
        findMany: vi.fn().mockResolvedValue([
          { headword: "w1", masteredAt: new Date(2026, 9, 3) },
          { headword: "w2", masteredAt: new Date(2026, 9, 2) },
        ]),
      },
      errorRecord: {
        findMany: vi.fn().mockResolvedValue([
          { category: "general", grammarTopicId: null, masteredAt: new Date(2026, 9, 1) },
        ]),
      },
    } as never;

    expect(await getRecentlyMastered(db, 2)).toEqual([
      { kind: "grammar", label: "A", at: new Date(2026, 9, 5) },
      { kind: "grammar", label: "B", at: new Date(2026, 9, 4) },
    ]);
  });

  it("returns null on failure", async () => {
    const db = {
      grammarTopic: { findMany: vi.fn().mockRejectedValue(new Error("down")) },
      vocabItem: { findMany: vi.fn() },
      errorRecord: { findMany: vi.fn() },
    } as never;
    expect(await getRecentlyMastered(db)).toBeNull();
  });
});
