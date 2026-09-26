// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { appendExample, feedbackText, recordAnswer, type RecordAnswerDb, type RecordInput } from "./recordAnswer";
import type { GradeResult } from "./types";

const now = new Date("2026-09-25T10:00:00Z");
const result: GradeResult = {
  version: 1, exerciseId: "e1", isCorrect: false, parts: [{ correct: false, given: "finishing", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Past perfect for an earlier past action.", feedback: null, gradedBy: "local", vocabCredit: [],
};
const input = (over: Partial<RecordInput> = {}): RecordInput => ({
  exerciseId: "e1", lessonId: "L1", answer: { type: "mcq", selected: 2 }, result,
  vocab: [{ id: "v1", correct: false }],
  errors: [{ grammarTopicId: "g1", category: "Past Perfect (had done)", source: "EXERCISE", example: "finishing -> had finished" }],
  now, ...over,
});

function fakeDb(over: { others?: unknown[]; count?: number; vocabRow?: unknown; existingError?: unknown } = {}) {
  const log: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, value: unknown) =>
    vi.fn(async (args: unknown) => {
      log.push(name);
      (calls[name] ??= []).push(args);
      return value;
    });
  const tx = {
    exercise: { findMany: rec("exercise.findMany", over.others ?? []), updateMany: rec("exercise.updateMany", { count: over.count ?? 1 }) },
    lesson: { updateMany: rec("lesson.updateMany", { count: 1 }), findUnique: rec("lesson.findUnique", null) },
    vocabItem: { findUnique: rec("vocabItem.findUnique", over.vocabRow ?? { status: "KNOWN", correctStreak: 4 }), update: rec("vocabItem.update", {}) },
    errorRecord: { findFirst: rec("errorRecord.findFirst", over.existingError ?? null), create: rec("errorRecord.create", {}), update: rec("errorRecord.update", {}) },
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as unknown as RecordAnswerDb;
  return { db, log, calls };
}

describe("recordAnswer", () => {
  it("writes answer, lesson status, vocab and error in one transaction, in order", async () => {
    const f = fakeDb();
    const out = await recordAnswer(f.db, input());
    expect(out).toMatchObject({ recorded: true });
    expect(f.log).toEqual([
      "exercise.findMany", "exercise.updateMany", "lesson.updateMany",
      "vocabItem.findUnique", "vocabItem.update", "errorRecord.findFirst", "errorRecord.create",
      "lesson.findUnique",
    ]);
    expect(f.calls["exercise.updateMany"][0]).toMatchObject({
      where: { id: "e1", answeredAt: null },
      data: { userAnswer: JSON.stringify({ selected: 2 }), isCorrect: false, feedback: "Past perfect for an earlier past action.", answeredAt: now },
    });
    expect(f.calls["lesson.updateMany"][0]).toEqual({ where: { id: "L1", status: "PLANNED" }, data: { status: "IN_PROGRESS" } });
    expect(f.calls["vocabItem.update"][0]).toEqual({ where: { id: "v1" }, data: { status: "LEARNING", correctStreak: 0, lastSeenAt: now } });
    expect(f.calls["errorRecord.create"][0]).toEqual({
      data: {
        lessonId: "L1", grammarTopicId: "g1", category: "Past Perfect (had done)", description: "- finishing -> had finished",
        source: "EXERCISE", status: "NEW", nextReviewAt: new Date("2026-09-26T10:00:00Z"),
      },
    });
  });

  it("does not credit a word already credited in this lesson", async () => {
    const f = fakeDb({ others: [{ result: { vocabCredit: [{ id: "v1", correct: true }] } }] });
    const out = await recordAnswer(f.db, input());
    expect(f.calls["vocabItem.update"]).toBeUndefined();
    expect(out.recorded && out.result.vocabCredit).toEqual([]);
  });

  it("appends to an existing error record of the same cause", async () => {
    const f = fakeDb({ existingError: { id: "r1", description: "- a -> b" } });
    await recordAnswer(f.db, input());
    expect(f.calls["errorRecord.update"][0]).toEqual({ where: { id: "r1" }, data: { description: "- a -> b\n- finishing -> had finished" } });
    expect(f.calls["errorRecord.create"]).toBeUndefined();
  });

  it("does nothing when the exercise was answered meanwhile", async () => {
    const f = fakeDb({ count: 0 });
    expect(await recordAnswer(f.db, input())).toEqual({ recorded: false });
    expect(f.log).toEqual(["exercise.findMany", "exercise.updateMany"]);
  });

  it("checks the written block after recording, inside the transaction", async () => {
    const f = fakeDb();
    await recordAnswer(f.db, input());
    expect(f.log[f.log.length - 1]).toBe("lesson.findUnique");
    expect(f.calls["lesson.findUnique"][0]).toMatchObject({ where: { id: "L1" } });
  });

  it("does not check the written block when the answer was not recorded", async () => {
    const f = fakeDb({ count: 0 });
    await recordAnswer(f.db, input());
    expect(f.log).not.toContain("lesson.findUnique");
  });
});

describe("appendExample / feedbackText", () => {
  it("keeps the last five examples", () => {
    let d = "";
    for (let i = 1; i <= 7; i++) d = appendExample(d, `e${i}`);
    expect(d.split("\n")).toEqual(["- e3", "- e4", "- e5", "- e6", "- e7"]);
  });
  it("prefers the judge explanation, then the writing summary, then the exercise explain", () => {
    expect(feedbackText(result)).toBe(result.explain);
    expect(feedbackText({ ...result, feedback: { explanation: "Use the article." } })).toBe("Use the article.");
    expect(feedbackText({ ...result, feedback: { summary: "Nice text overall." } })).toBe("Nice text overall.");
  });
});
