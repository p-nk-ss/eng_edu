// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { VALID_EXERCISES as E } from "./fixtures";
import { loadLessonForPlayer, type PlayerLessonDb } from "./loadLesson";

const stored = { version: 1, exerciseId: "e2", isCorrect: true };
const lessonDate = new Date("2026-09-20T00:00:00.000Z");
const grammarTopic = {
  title: "Past Perfect (had done)",
  name: "RAW",
  cefrLevel: "B2",
  description: "An earlier past action.",
  example: "She had finished.",
  status: "PRACTICING",
  goodLessons: 1,
  importance: 2,
};

function fakeDb(opts: {
  lesson?: unknown;
  exercises?: unknown[];
  topic?: unknown;
  profile?: unknown;
  vocab?: unknown[];
  count?: number;
  previous?: unknown;
} = {}) {
  const { lesson = null, exercises = [], topic = grammarTopic, profile = { level: "B1" }, vocab = [], count = 1, previous = null } = opts;
  return {
    lesson: {
      findUnique: vi.fn().mockResolvedValue(lesson),
      count: vi.fn().mockResolvedValue(count),
      findFirst: vi.fn().mockResolvedValue(previous),
    },
    exercise: { findMany: vi.fn().mockResolvedValue(exercises) },
    grammarTopic: { findUnique: vi.fn().mockResolvedValue(topic) },
    profile: { findFirst: vi.fn().mockResolvedValue(profile) },
    vocabItem: { findMany: vi.fn().mockResolvedValue(vocab) },
  } as unknown as PlayerLessonDb;
}
const plan = (ids: string[], grammarTopicId: string | null = "g1", vocabIds: string[] = []) => ({
  sections: { written: { exerciseIds: ids } },
  meta: { grammarTopicId, vocabIds },
});

describe("loadLessonForPlayer", () => {
  it("returns null for an unknown lesson", async () => {
    expect(await loadLessonForPlayer("nope", fakeDb())).toBeNull();
  });

  it("orders items by the plan, attaches stored results, appends unplanned rows and skips missing ones", async () => {
    const db = fakeDb({
      lesson: { id: "L1", theme: "work", plan: plan(["e2", "ghost", "e1"]), date: lessonDate },
      exercises: [
        { id: "e1", content: E.MULTIPLE_CHOICE, result: null, answeredAt: null },
        { id: "e2", content: E.TRANSLATION, result: stored, answeredAt: new Date() },
        { id: "e3", content: E.DICTATION, result: null, answeredAt: null },
      ],
    });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.items.map((i) => i.view.id)).toEqual(["e2", "e1", "e3"]);
    expect(out?.items.map((i) => i.result)).toEqual([stored, null, null]);
    expect(out).toMatchObject({ lessonId: "L1", themeLabel: "Work & careers", grammarTitle: "Past Perfect (had done)" });
  });

  it("skips exercises whose content does not parse", async () => {
    const db = fakeDb({
      lesson: { id: "L1", theme: null, plan: plan(["e1", "bad"], null), date: lessonDate },
      exercises: [
        { id: "e1", content: E.MULTIPLE_CHOICE, result: null, answeredAt: null },
        { id: "bad", content: { type: "mcq", prompt: "?" }, result: null, answeredAt: null },
      ],
    });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.items.map((i) => i.view.id)).toEqual(["e1"]);
    expect(out).toMatchObject({ themeLabel: null, grammarTitle: null });
  });

  it("ignores a stored result when answeredAt is not set", async () => {
    const db = fakeDb({ lesson: { id: "L1", theme: null, plan: plan(["e1"]), date: lessonDate }, exercises: [{ id: "e1", content: E.MULTIPLE_CHOICE, result: stored, answeredAt: null }] });
    expect((await loadLessonForPlayer("L1", db))?.items[0].result).toBeNull();
  });

  it("falls back to the raw topic name when the topic is not enriched", async () => {
    const db = fakeDb({ lesson: { id: "L1", theme: null, plan: plan([]), date: lessonDate }, topic: { title: null, name: "RAW NAME", cefrLevel: "B2" } });
    expect((await loadLessonForPlayer("L1", db))?.grammarTitle).toBe("RAW NAME");
  });

  it("returns intro fields for a grammar lesson: level, grammar block, topic lesson number and vocab in plan order (unknown ids skipped)", async () => {
    const db = fakeDb({
      lesson: { id: "L1", theme: "work", plan: plan([], "g1", ["v2", "v1", "v3"]), date: lessonDate },
      profile: { level: "B1" },
      vocab: [{ id: "v1", headword: "apple" }, { id: "v3", headword: "cherry" }],
      count: 3,
    });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.intro).toEqual({
      learnerLevel: "B1",
      grammar: {
        title: "Past Perfect (had done)",
        level: "B2",
        description: "An earlier past action.",
        example: "She had finished.",
        status: "PRACTICING",
        goodLessons: 1,
        lessonsToMaster: 3,
        lastScore: null,
      },
      topicLessonNumber: 3,
      vocab: ["apple", "cherry"],
    });
  });

  it("returns grammar: null and topicLessonNumber: null for a vocab-only lesson, still resolving vocab", async () => {
    const db = fakeDb({
      lesson: { id: "L1", theme: "work", plan: plan([], null, ["v1"]), date: lessonDate },
      vocab: [{ id: "v1", headword: "apple" }],
    });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.intro).toMatchObject({ grammar: null, topicLessonNumber: null, vocab: ["apple"] });
  });

  it("returns learnerLevel: null when there is no profile", async () => {
    const db = fakeDb({ lesson: { id: "L1", theme: null, plan: plan([]), date: lessonDate }, profile: null });
    expect((await loadLessonForPlayer("L1", db))?.intro.learnerLevel).toBeNull();
  });

  it("counts topic lessons with a JSON path filter on plan.meta.grammarTopicId, up to this lesson's date", async () => {
    const db = fakeDb({ lesson: { id: "L1", theme: null, plan: plan([], "g1"), date: lessonDate } });
    await loadLessonForPlayer("L1", db);
    expect(db.lesson.count).toHaveBeenCalledWith({
      where: { plan: { path: ["meta", "grammarTopicId"], equals: "g1" }, date: { lte: lessonDate } },
    });
  });

  it("computes status, goodLessons, lessonsToMaster (below-level core: 1) and lastScore from the previous completed lesson", async () => {
    const db = fakeDb({
      lesson: { id: "L1", theme: null, plan: plan([], "g1"), date: lessonDate },
      topic: { title: "Present Simple", name: "RAW", cefrLevel: "A2", description: null, example: null, status: "PRACTICING", goodLessons: 0, importance: 1 },
      profile: { level: "B1" },
      previous: { writtenScore: 0.714 },
    });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.intro.grammar).toMatchObject({ status: "PRACTICING", goodLessons: 0, lessonsToMaster: 1, lastScore: 0.714 });
    expect(db.lesson.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: "L1" }, writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: "g1" },
        date: { lte: lessonDate },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { writtenScore: true },
    });
  });

  it("gives lessonsToMaster: 3 for a B1 topic with importance 2 (not a below-level core topic)", async () => {
    const db = fakeDb({
      lesson: { id: "L1", theme: null, plan: plan([], "g1"), date: lessonDate },
      topic: { title: "Present Perfect", name: "RAW", cefrLevel: "B1", description: null, example: null, status: "INTRODUCED", goodLessons: 0, importance: 2 },
      profile: { level: "B1" },
    });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.intro.grammar).toMatchObject({ lessonsToMaster: 3 });
  });

  it("gives lastScore: null when there is no previous completed lesson for this topic", async () => {
    const db = fakeDb({ lesson: { id: "L1", theme: null, plan: plan([], "g1"), date: lessonDate } });
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.intro.grammar?.lastScore).toBeNull();
  });
});
