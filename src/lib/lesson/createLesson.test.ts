// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { LessonInputs } from "../curriculum/lessonInputs";
import { buildPlan, createLesson, type CreateLessonDb } from "./createLesson";
import { VALID_EXERCISES as E } from "./fixtures";
import type { LessonDraft } from "./generateLesson";

const now = new Date("2026-09-18T10:00:00Z");
const draft: LessonDraft = {
  exercises: [{ type: "MULTIPLE_CHOICE", content: E.MULTIPLE_CHOICE }, { type: "TRANSLATION", content: E.TRANSLATION }],
  warmup: { intro: "Let us talk about work.", questions: ["q1?", "q2?", "q3?"] },
  scenario: { title: "A missed deadline", role: "You are a QA engineer.", goal: "Agree on a new date.", opening: "Got a minute?" },
  qualityGate: "partial",
  drops: [{ attempt: 1, index: 3, type: "MATCH", reason: "x" }],
  attempts: 1,
  gateScores: [{ exerciseIndex: 0, scores: { key_correct: 0.95 } }],
};
const inputs = {
  profile: { id: "p1" },
  theme: { key: "work", label: "Work & careers", description: "d" },
  grammarTopic: { id: "g1", name: "PAST PERFECT", status: "NOT_STARTED" },
  vocab: [{ id: "v1" }, { id: "v2" }],
  dueErrors: [],
} as unknown as LessonInputs;
const mix = ["MULTIPLE_CHOICE", "TRANSLATION"] as const;

function fakeDb() {
  const log: string[] = [];
  let n = 0;
  const rec = (name: string, result: unknown) => vi.fn(async (args: unknown) => (log.push(name), (calls[name] ??= []).push(args), result));
  const calls: Record<string, unknown[]> = {};
  const tx = {
    lesson: { create: rec("lesson.create", { id: "L1" }), update: rec("lesson.update", {}) },
    exercise: { create: vi.fn(async (args: unknown) => (log.push("exercise.create"), (calls["exercise.create"] ??= []).push(args), { id: `E${++n}` })) },
    grammarTopic: { update: rec("grammarTopic.update", {}) },
    vocabItem: { updateMany: rec("vocabItem.updateMany", { count: 2 }) },
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as unknown as CreateLessonDb;
  return { db, log, calls };
}

describe("buildPlan", () => {
  it("has the final SPEC shape with an empty review section", () => {
    const plan = buildPlan(draft, ["E1", "E2"], { grammarTopicId: "g1", vocabIds: ["v1", "v2"], exerciseMix: [...mix] });
    expect(plan).toEqual({
      version: 1,
      sections: {
        review: { exerciseIds: [] },
        warmup: draft.warmup,
        written: { exerciseIds: ["E1", "E2"] },
        scenario: draft.scenario,
      },
      meta: {
        grammarTopicId: "g1",
        vocabIds: ["v1", "v2"],
        exerciseMix: ["MULTIPLE_CHOICE", "TRANSLATION"],
        qualityGate: "partial",
        drops: 1,
        dropReasons: ["attempt 1 #3 MATCH: x"],
        gateScores: [{ exerciseIndex: 0, scores: { key_correct: 0.95 } }],
        attempts: 1,
      },
    });
  });
});

describe("createLesson", () => {
  it("writes everything in one transaction, sequentially, and returns the lesson id", async () => {
    const { db, log, calls } = fakeDb();
    expect(await createLesson(db, draft, inputs, [...mix], now)).toBe("L1");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(log).toEqual([
      "lesson.create", "exercise.create", "exercise.create", "lesson.update",
      "grammarTopic.update", "vocabItem.updateMany", "vocabItem.updateMany",
    ]);
    expect(calls["lesson.create"][0]).toMatchObject({ data: { status: "PLANNED", theme: "work", date: now } });
    expect(calls["exercise.create"][0]).toMatchObject({ data: { lessonId: "L1", type: "MULTIPLE_CHOICE", content: E.MULTIPLE_CHOICE } });
    expect(calls["lesson.update"][0]).toMatchObject({ where: { id: "L1" }, data: { plan: { sections: { written: { exerciseIds: ["E1", "E2"] } } } } });
  });

  it("introduces a NOT_STARTED grammar topic and marks NEW vocab as SEEN", async () => {
    const { db, calls } = fakeDb();
    await createLesson(db, draft, inputs, [...mix], now);
    expect(calls["grammarTopic.update"][0]).toEqual({
      where: { id: "g1" },
      data: { status: "INTRODUCED", timesUsed: { increment: 1 }, lastUsedAt: now },
    });
    expect(calls["vocabItem.updateMany"]).toEqual([
      { where: { id: { in: ["v1", "v2"] }, status: "NEW" }, data: { status: "SEEN" } },
      { where: { id: { in: ["v1", "v2"] } }, data: { lastSeenAt: now } },
    ]);
  });

  it("does not downgrade a topic that is already beyond NOT_STARTED, and copes with no grammar", async () => {
    const a = fakeDb();
    await createLesson(a.db, draft, { ...inputs, grammarTopic: { id: "g1", status: "PRACTICING" } } as unknown as LessonInputs, [...mix], now);
    expect(a.calls["grammarTopic.update"][0]).toEqual({ where: { id: "g1" }, data: { timesUsed: { increment: 1 }, lastUsedAt: now } });

    const b = fakeDb();
    await createLesson(b.db, draft, { ...inputs, grammarTopic: null } as unknown as LessonInputs, [...mix], now);
    expect(b.calls["grammarTopic.update"]).toBeUndefined();
    expect(b.calls["lesson.update"][0]).toMatchObject({ data: { plan: { meta: { grammarTopicId: null } } } });
  });
});
