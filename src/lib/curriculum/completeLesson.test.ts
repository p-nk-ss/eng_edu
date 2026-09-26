// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { completeWrittenBlockIfDone, recomputeTopic, type CompletionTx } from "./completeLesson";

const now = new Date("2026-09-26T10:00:00Z");
const plan = (ids: string[], grammarTopicId: string | null = "g1") => ({ sections: { written: { exerciseIds: ids } }, meta: { grammarTopicId } });
const ex = (answered: boolean, isCorrect: boolean | null, content: unknown = E.MULTIPLE_CHOICE) => ({ content, answeredAt: answered ? now : null, isCorrect });

function fakeTx(o: {
  lesson?: unknown; exercises?: unknown[]; updated?: number; topic?: unknown; profile?: unknown; history?: unknown[];
} = {}) {
  const log: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, value: unknown) =>
    vi.fn(async (args: unknown) => {
      log.push(name);
      (calls[name] ??= []).push(args);
      return value;
    });
  const tx = {
    lesson: {
      findUnique: rec("lesson.findUnique", o.lesson === undefined ? { plan: plan(["e1", "e2"]), writtenCompletedAt: null } : o.lesson),
      updateMany: rec("lesson.updateMany", { count: o.updated ?? 1 }),
      findMany: rec("lesson.findMany", o.history ?? [{ writtenScore: 0.5 }]),
    },
    exercise: { findMany: rec("exercise.findMany", o.exercises ?? [ex(true, true), ex(true, false)]) },
    grammarTopic: {
      findUnique: rec("grammarTopic.findUnique", o.topic === undefined ? { status: "INTRODUCED", cefrLevel: "A2", importance: 1 } : o.topic),
      update: rec("grammarTopic.update", {}),
    },
    profile: { findFirst: rec("profile.findFirst", o.profile === undefined ? { level: "B1" } : o.profile) },
  };
  return { tx: tx as unknown as CompletionTx, log, calls };
}

describe("completeWrittenBlockIfDone", () => {
  it("does nothing while an exercise is unanswered", async () => {
    const f = fakeTx({ exercises: [ex(true, true), ex(false, null)] });
    expect(await completeWrittenBlockIfDone(f.tx, "L1", now)).toEqual({ completed: false, score: null });
    expect(f.calls["lesson.updateMany"]).toBeUndefined();
  });

  it("completes on a wrong last answer, stores the score once and recomputes the focus topic", async () => {
    const f = fakeTx();
    expect(await completeWrittenBlockIfDone(f.tx, "L1", now)).toEqual({ completed: true, score: 0.5 });
    expect(f.calls["exercise.findMany"][0]).toEqual({
      where: { lessonId: "L1", id: { in: ["e1", "e2"] } },
      select: { content: true, answeredAt: true, isCorrect: true },
    });
    expect(f.calls["lesson.updateMany"][0]).toEqual({ where: { id: "L1", writtenCompletedAt: null }, data: { writtenScore: 0.5, writtenCompletedAt: now } });
    expect(f.log).toContain("grammarTopic.update");
  });

  it("ignores missing and unparsable exercises", async () => {
    const f = fakeTx({ lesson: { plan: plan(["e1", "ghost", "bad"]), writtenCompletedAt: null }, exercises: [ex(true, true), ex(false, null, { type: "mcq" })] });
    expect(await completeWrittenBlockIfDone(f.tx, "L1", now)).toEqual({ completed: true, score: 1 });
  });

  it("never completes twice", async () => {
    const done = fakeTx({ lesson: { plan: plan(["e1"]), writtenCompletedAt: now } });
    expect(await completeWrittenBlockIfDone(done.tx, "L1", now)).toEqual({ completed: false, score: null });
    expect(done.calls["exercise.findMany"]).toBeUndefined();
    const raced = fakeTx({ updated: 0 });
    expect(await completeWrittenBlockIfDone(raced.tx, "L1", now)).toEqual({ completed: false, score: null });
    expect(raced.calls["grammarTopic.update"]).toBeUndefined();
  });

  it("stores the score of a lesson without a grammar focus and touches no topic", async () => {
    const f = fakeTx({ lesson: { plan: plan(["e1", "e2"], null), writtenCompletedAt: null } });
    expect((await completeWrittenBlockIfDone(f.tx, "L1", now)).completed).toBe(true);
    expect(f.calls["grammarTopic.findUnique"]).toBeUndefined();
  });

  it("does nothing for an unknown lesson or an empty written block", async () => {
    expect(await completeWrittenBlockIfDone(fakeTx({ lesson: null }).tx, "L1", now)).toEqual({ completed: false, score: null });
    const empty = fakeTx({ lesson: { plan: plan([]), writtenCompletedAt: null } });
    expect(await completeWrittenBlockIfDone(empty.tx, "L1", now)).toEqual({ completed: false, score: null });
  });
});

describe("recomputeTopic", () => {
  it("derives status and counters from completed lessons with this focus", async () => {
    const f = fakeTx({ topic: { status: "INTRODUCED", cefrLevel: "B1", importance: 2 }, history: [{ writtenScore: 0.71 }] });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["lesson.findMany"][0]).toEqual({
      where: { writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: "g1" } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { writtenScore: true },
    });
    expect(f.calls["grammarTopic.update"][0]).toEqual({ where: { id: "g1" }, data: { status: "PRACTICING", lessonsCompleted: 1, goodLessons: 0 } });
  });

  it("masters a below-level core topic after one good lesson", async () => {
    const f = fakeTx({ topic: { status: "INTRODUCED", cefrLevel: "A2", importance: 1 }, history: [{ writtenScore: 0.86 }] });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["grammarTopic.update"][0]).toMatchObject({ data: { status: "MASTERED", goodLessons: 1 } });
  });

  it("needs three good lessons when the profile is missing", async () => {
    const f = fakeTx({ topic: { status: "INTRODUCED", cefrLevel: "A2", importance: 1 }, profile: null, history: [{ writtenScore: 0.9 }] });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["grammarTopic.update"][0]).toMatchObject({ data: { status: "PRACTICING" } });
  });

  it("skips a missing topic", async () => {
    const f = fakeTx({ topic: null });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["grammarTopic.update"]).toBeUndefined();
  });
});
