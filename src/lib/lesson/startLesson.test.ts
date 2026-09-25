// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../curriculum/lessonInputs", async (orig) => ({
  ...(await orig<typeof import("../curriculum/lessonInputs")>()),
  selectLessonInputs: vi.fn(),
}));
vi.mock("./generateLesson", async (orig) => ({ ...(await orig<typeof import("./generateLesson")>()), generateLesson: vi.fn() }));
vi.mock("./createLesson", async (orig) => ({ ...(await orig<typeof import("./createLesson")>()), createLesson: vi.fn() }));
vi.mock("../db", () => ({ prisma: {} }));

import { selectLessonInputs } from "../curriculum/lessonInputs";
import { createLesson } from "./createLesson";
import { generateLesson } from "./generateLesson";
import { startLesson, toGenerationInputs, type StartLessonDb } from "./startLesson";

const now = new Date(2026, 8, 18, 15, 30); // local time
const inputs = {
  profile: { level: "B1+", goals: "fluency", interests: "IT", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs." },
  grammarTopic: { id: "g1", name: "TENSE/ASPECT: PAST PERFECT", title: "Past Perfect (had done)", description: "had + pp", example: "She had left." },
  vocab: [{ id: "v1", headword: "deadline", pos: "noun", cefrLevel: "B1" }],
  dueErrors: [],
};

function fakeDb(existing: unknown) {
  const findFirst = vi.fn().mockResolvedValue(existing);
  const count = vi.fn().mockResolvedValue(2);
  const findMany = vi.fn().mockResolvedValue([{ summary: "s2" }, { summary: "s1" }]);
  return { db: { lesson: { findFirst, count, findMany } } as unknown as StartLessonDb, findFirst, count, findMany };
}
const generation = { ask: vi.fn(), gate: vi.fn() };

beforeEach(() => {
  vi.mocked(selectLessonInputs).mockReset().mockResolvedValue(inputs as never);
  vi.mocked(generateLesson).mockReset().mockResolvedValue({ exercises: [], attempts: 1, drops: [] } as never);
  vi.mocked(createLesson).mockReset().mockResolvedValue("L9");
});

describe("toGenerationInputs", () => {
  it("falls back to the raw topic name and empty strings when the topic is not enriched", () => {
    const g = toGenerationInputs({ ...inputs, grammarTopic: { id: "g1", name: "RAW NAME", title: null, description: null, example: null } } as never, ["TRANSLATION"], []);
    expect(g.grammar).toEqual({ id: "g1", title: "RAW NAME", description: "", example: "" });
    expect(toGenerationInputs({ ...inputs, grammarTopic: null } as never, ["TRANSLATION"], []).grammar).toBeNull();
  });
});

describe("startLesson", () => {
  it("reuses a resumable lesson (today's, or an older one with unanswered exercises) without generating", async () => {
    const f = fakeDb({ id: "L1" });
    expect(await startLesson({ db: f.db, generation, now })).toEqual({ lessonId: "L1", reused: true });
    expect(generateLesson).not.toHaveBeenCalled();
    const where = f.findFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["PLANNED", "IN_PROGRESS"] });
    expect(where.OR).toEqual([
      { date: { gte: new Date(2026, 8, 18), lt: new Date(2026, 8, 19) } },
      { exercises: { some: { answeredAt: null } } },
    ]);
  });

  it("selects, plans the mix from the lesson number, generates and persists", async () => {
    const f = fakeDb(null);
    expect(await startLesson({ db: f.db, generation, now })).toEqual({ lessonId: "L9", reused: false, attempts: 1, drops: 0 });

    const genInputs = vi.mocked(generateLesson).mock.calls[0][0];
    expect(genInputs.mix).toContain("OPEN_WRITING"); // 2 existing lessons -> lesson 3
    expect(genInputs.grammar).toMatchObject({ id: "g1", title: "Past Perfect (had done)" });
    expect(genInputs.summaries).toEqual(["s2", "s1"]);
    expect(vi.mocked(generateLesson).mock.calls[0][1]).toBe(generation);

    expect(f.findMany.mock.calls[0][0]).toMatchObject({ where: { status: "COMPLETED", summary: { not: null } }, take: 3 });
    const createArgs = vi.mocked(createLesson).mock.calls[0];
    expect(createArgs[2]).toBe(inputs);
    expect(createArgs[3]).toEqual(genInputs.mix);
    expect(createArgs[4]).toBe(now);
  });

  it("plans a vocab-only mix when the syllabus is mastered", async () => {
    vi.mocked(selectLessonInputs).mockResolvedValue({ ...inputs, grammarTopic: null } as never);
    await startLesson({ db: fakeDb(null).db, generation, now });
    expect(vi.mocked(generateLesson).mock.calls[0][0].mix).not.toContain("ERROR_CORRECTION");
  });

  it("single-flights concurrent calls: one generation, the same result for both callers", async () => {
    const f = fakeDb(null);
    let resolveGen!: (v: unknown) => void;
    vi.mocked(generateLesson).mockReturnValue(new Promise((r) => (resolveGen = r)) as never);

    const p1 = startLesson({ db: f.db, generation, now });
    const p2 = startLesson({ db: f.db, generation, now });
    resolveGen({ exercises: [], attempts: 1, drops: [] });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(generateLesson).toHaveBeenCalledTimes(1);
    expect(f.findFirst).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ lessonId: "L9", reused: false, attempts: 1, drops: 0 });
  });

  it("starts fresh after the in-flight call settles - success then a new call", async () => {
    const f = fakeDb(null);
    await startLesson({ db: f.db, generation, now });
    await startLesson({ db: f.db, generation, now });
    expect(generateLesson).toHaveBeenCalledTimes(2);
    expect(f.findFirst).toHaveBeenCalledTimes(2);
  });

  it("starts fresh after the in-flight call settles - failure then a new call also clears it", async () => {
    const f = fakeDb(null);
    vi.mocked(generateLesson).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ exercises: [], attempts: 1, drops: [] } as never);
    await expect(startLesson({ db: f.db, generation, now })).rejects.toThrow("boom");
    await expect(startLesson({ db: f.db, generation, now })).resolves.toEqual({ lessonId: "L9", reused: false, attempts: 1, drops: 0 });
  });

  it("when generateLesson rejects, createLesson is never called and the error propagates", async () => {
    const f = fakeDb(null);
    vi.mocked(generateLesson).mockRejectedValue(new Error("generation blew up"));
    await expect(startLesson({ db: f.db, generation, now })).rejects.toThrow("generation blew up");
    expect(createLesson).not.toHaveBeenCalled();
  });
});
