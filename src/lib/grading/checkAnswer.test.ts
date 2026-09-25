// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { checkAnswer, ExerciseNotFoundError, InvalidAnswerError, type CheckAnswerDb } from "./checkAnswer";
import { GradingUnavailableError, type JudgeDeps } from "./judge";

const now = new Date("2026-09-25T10:00:00Z");
const judge: JudgeDeps = { jev: () => null, askTranslation: vi.fn(), askWriting: vi.fn() };

function fakeDb(exerciseRows: unknown[], txCount = 1) {
  const tx = {
    exercise: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: txCount })) },
    lesson: { updateMany: vi.fn(async () => ({ count: 1 })) },
    vocabItem: { findUnique: vi.fn(async () => ({ status: "SEEN", correctStreak: 0 })), update: vi.fn(async () => ({})) },
    errorRecord: { findFirst: vi.fn(async () => null), create: vi.fn(async (_args: unknown) => ({})), update: vi.fn(async () => ({})) },
  };
  const findUnique = vi.fn();
  for (const r of exerciseRows) findUnique.mockResolvedValueOnce(r);
  const db = {
    exercise: { findUnique },
    grammarTopic: { findUnique: vi.fn(async () => ({ id: "g1", name: "RAW", title: "Past Perfect (had done)", description: "had + pp" })) },
    vocabItem: { findMany: vi.fn(async () => [{ id: "v1", headword: "deadline" }]) },
    profile: { findFirst: vi.fn(async () => ({ level: "B1" })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db: db as unknown as CheckAnswerDb, raw: db, tx };
}
const row = (id: string, content: unknown, over: Record<string, unknown> = {}) => ({
  id, lessonId: "L1", content, answeredAt: null, result: null, lesson: { plan: { meta: { grammarTopicId: "g1" } } }, ...over,
});

describe("checkAnswer", () => {
  it("throws ExerciseNotFoundError for an unknown id", async () => {
    const f = fakeDb([null]);
    await expect(checkAnswer("nope", { selected: 0 }, { db: f.db, judge, now })).rejects.toBeInstanceOf(ExerciseNotFoundError);
  });

  it("rejects a malformed answer without writing anything", async () => {
    const f = fakeDb([row("e-bad", E.MULTIPLE_CHOICE)]);
    await expect(checkAnswer("e-bad", { selected: 9 }, { db: f.db, judge, now })).rejects.toBeInstanceOf(InvalidAnswerError);
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("grades, records and returns a correct answer", async () => {
    const f = fakeDb([row("e-ok", E.MULTIPLE_CHOICE)]);
    const out = await checkAnswer("e-ok", { selected: 1 }, { db: f.db, judge, now });
    expect(out).toMatchObject({ exerciseId: "e-ok", isCorrect: true, gradedBy: "local", correctAnswer: "had finished", alreadyAnswered: false });
    expect(f.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.lesson.updateMany).toHaveBeenCalled();
    expect(f.tx.errorRecord.create).not.toHaveBeenCalled();
  });

  it("records a wrong answer under the lesson grammar focus", async () => {
    const f = fakeDb([row("e-wrong", E.MULTIPLE_CHOICE)]);
    await checkAnswer("e-wrong", { selected: 2 }, { db: f.db, judge, now });
    expect(f.tx.errorRecord.create.mock.calls[0][0]).toMatchObject({ data: { grammarTopicId: "g1", category: "Past Perfect (had done)" } });
  });

  it("returns the stored result for an answered exercise without grading again", async () => {
    const stored = { version: 1, exerciseId: "e-done", isCorrect: true };
    const f = fakeDb([row("e-done", E.MULTIPLE_CHOICE, { answeredAt: now, result: stored })]);
    expect(await checkAnswer("e-done", { selected: 0 }, { db: f.db, judge, now })).toEqual({ ...stored, alreadyAnswered: true });
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("returns the stored result when another request recorded the answer first", async () => {
    const stored = { version: 1, exerciseId: "e-race", isCorrect: false };
    const f = fakeDb([row("e-race", E.MULTIPLE_CHOICE), { result: stored }], 0);
    expect(await checkAnswer("e-race", { selected: 1 }, { db: f.db, judge, now })).toEqual({ ...stored, alreadyAnswered: true });
  });

  it("dry-run grades an answered exercise again and never writes", async () => {
    const f = fakeDb([row("e-dry", E.MULTIPLE_CHOICE, { answeredAt: now, result: {} })]);
    const out = await checkAnswer("e-dry", { selected: 1 }, { db: f.db, judge, now, dryRun: true });
    expect(out).toMatchObject({ isCorrect: true, alreadyAnswered: false });
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("rejects with GradingUnavailableError when Claude fails, without recording anything", async () => {
    const f = fakeDb([row("e-claude-fail", E.TRANSLATION)]);
    const badJudge: JudgeDeps = { jev: () => null, askTranslation: vi.fn().mockRejectedValue(new Error("LLM down")), askWriting: vi.fn() };
    await expect(
      checkAnswer("e-claude-fail", { text: "I finished the report before the deadline." }, { db: f.db, judge: badJudge, now }),
    ).rejects.toBeInstanceOf(GradingUnavailableError);
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("grades fresh on a second submit after a rejected run for the same exercise id", async () => {
    const f = fakeDb([row("e-retry", E.TRANSLATION), row("e-retry", E.TRANSLATION)]);
    const badJudge: JudgeDeps = { jev: () => null, askTranslation: vi.fn().mockRejectedValue(new Error("LLM down")), askWriting: vi.fn() };
    await expect(
      checkAnswer("e-retry", { text: "I finished the report before the deadline." }, { db: f.db, judge: badJudge, now }),
    ).rejects.toBeInstanceOf(GradingUnavailableError);

    const goodJudge: JudgeDeps = {
      jev: () => null,
      askTranslation: vi.fn().mockResolvedValue({ isCorrect: true, corrected: "I finished the report before the deadline.", explanation: "Good.", category: "none", relatesToFocus: false }),
      askWriting: vi.fn(),
    };
    const out = await checkAnswer("e-retry", { text: "I finished the report before the deadline." }, { db: f.db, judge: goodJudge, now });
    expect(out).toMatchObject({ isCorrect: true, alreadyAnswered: false });
    expect(f.raw.exercise.findUnique).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent submits of the same exercise", async () => {
    const f = fakeDb([row("e-twice", E.MULTIPLE_CHOICE)]);
    const [a, b] = await Promise.all([
      checkAnswer("e-twice", { selected: 1 }, { db: f.db, judge, now }),
      checkAnswer("e-twice", { selected: 1 }, { db: f.db, judge, now }),
    ]);
    expect(a).toEqual(b);
    expect(f.raw.exercise.findUnique).toHaveBeenCalledTimes(1);
  });
});
