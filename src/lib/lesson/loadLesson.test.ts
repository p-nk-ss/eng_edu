// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { VALID_EXERCISES as E } from "./fixtures";
import { loadLessonForPlayer, type PlayerLessonDb } from "./loadLesson";

const stored = { version: 1, exerciseId: "e2", isCorrect: true };

function fakeDb(lesson: unknown, exercises: unknown[], topic: unknown = { title: "Past Perfect (had done)", name: "RAW" }) {
  return {
    lesson: { findUnique: vi.fn().mockResolvedValue(lesson) },
    exercise: { findMany: vi.fn().mockResolvedValue(exercises) },
    grammarTopic: { findUnique: vi.fn().mockResolvedValue(topic) },
  } as unknown as PlayerLessonDb;
}
const plan = (ids: string[], grammarTopicId: string | null = "g1") => ({ sections: { written: { exerciseIds: ids } }, meta: { grammarTopicId } });

describe("loadLessonForPlayer", () => {
  it("returns null for an unknown lesson", async () => {
    expect(await loadLessonForPlayer("nope", fakeDb(null, []))).toBeNull();
  });

  it("orders items by the plan, attaches stored results, appends unplanned rows and skips missing ones", async () => {
    const db = fakeDb({ id: "L1", theme: "work", plan: plan(["e2", "ghost", "e1"]) }, [
      { id: "e1", content: E.MULTIPLE_CHOICE, result: null, answeredAt: null },
      { id: "e2", content: E.TRANSLATION, result: stored, answeredAt: new Date() },
      { id: "e3", content: E.DICTATION, result: null, answeredAt: null },
    ]);
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.items.map((i) => i.view.id)).toEqual(["e2", "e1", "e3"]);
    expect(out?.items.map((i) => i.result)).toEqual([stored, null, null]);
    expect(out).toMatchObject({ lessonId: "L1", themeLabel: "Work & careers", grammarTitle: "Past Perfect (had done)" });
  });

  it("skips exercises whose content does not parse", async () => {
    const db = fakeDb({ id: "L1", theme: null, plan: plan(["e1", "bad"], null) }, [
      { id: "e1", content: E.MULTIPLE_CHOICE, result: null, answeredAt: null },
      { id: "bad", content: { type: "mcq", prompt: "?" }, result: null, answeredAt: null },
    ]);
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.items.map((i) => i.view.id)).toEqual(["e1"]);
    expect(out).toMatchObject({ themeLabel: null, grammarTitle: null });
  });

  it("ignores a stored result when answeredAt is not set", async () => {
    const db = fakeDb({ id: "L1", theme: null, plan: plan(["e1"]) }, [{ id: "e1", content: E.MULTIPLE_CHOICE, result: stored, answeredAt: null }]);
    expect((await loadLessonForPlayer("L1", db))?.items[0].result).toBeNull();
  });

  it("falls back to the raw topic name when the topic is not enriched", async () => {
    const db = fakeDb({ id: "L1", theme: null, plan: plan([]) }, [], { title: null, name: "RAW NAME" });
    expect((await loadLessonForPlayer("L1", db))?.grammarTitle).toBe("RAW NAME");
  });
});
