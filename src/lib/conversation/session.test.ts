// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { makeFakeDb } from "./fakeConversationDb";
import { getWarmup, LessonNotFoundError, setWarmupStatus, startWarmup } from "./session";

const INTRO = "Hi! Let us talk about your working day and what you enjoy about it.";
const lesson = { id: "L1", theme: "work", plan: { sections: { warmup: { intro: INTRO, questions: ["What do you do?"] } }, meta: { grammarTopicId: null, vocabIds: [] } } };

describe("conversation session", () => {
  it("getWarmup on a lesson without a session -> empty state", async () => {
    const { db } = makeFakeDb({ lessons: [lesson] });
    expect(await getWarmup("L1", db)).toEqual({ status: null, turns: [], review: null });
  });

  it("start creates the session and the partner opening turn from the plan intro", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    const res = await startWarmup("L1", db);
    expect(res.status).toBe("ACTIVE");
    expect(res.review).toBeNull();
    expect(res.turns).toHaveLength(1);
    expect(res.turns[0]).toMatchObject({ role: "partner", text: INTRO, turnIndex: 0, corrections: null });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({ lessonId: "L1", mode: "WARMUP", status: "ACTIVE" });
    expect(state.turns[0].sessionId).toBe(state.sessions[0].id);
  });

  it("second start returns the same turns without duplicating", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    const first = await startWarmup("L1", db);
    const second = await startWarmup("L1", db);
    expect(second).toEqual(first);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
  });

  it("start on a session created concurrently (unique violation) re-reads it", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    const origFind = db.conversationSession.findUnique;
    let calls = 0;
    // first lookup misses (as if the other request had not committed yet)
    (db.conversationSession as unknown as { findUnique: unknown }).findUnique = async (args: unknown) => {
      calls++;
      if (calls === 1) {
        await startWarmup("L1", { ...db, conversationSession: { ...db.conversationSession, findUnique: origFind } } as typeof db);
        return null;
      }
      return (origFind as (a: unknown) => Promise<unknown>)(args);
    };
    const res = await startWarmup("L1", db);
    expect(res.turns).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
  });

  it("start on a missing lesson -> LessonNotFoundError", async () => {
    const { db } = makeFakeDb();
    await expect(startWarmup("nope", db)).rejects.toBeInstanceOf(LessonNotFoundError);
  });

  it("getWarmup returns turns ordered by turnIndex and the stored review", async () => {
    const review = { topIssues: ["tense"], counts: { minor: 1, moderate: 0, major: 0 }, errorsAdded: 0 };
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    await startWarmup("L1", db);
    const sid = state.sessions[0].id;
    state.turns.push(
      { id: "x2", lessonId: "L1", sessionId: sid, role: "partner", text: "b", turnIndex: 2, corrections: null, createdAt: new Date() },
      { id: "x1", lessonId: "L1", sessionId: sid, role: "learner", text: "a", turnIndex: 1, corrections: [{ c: 1 }], createdAt: new Date() },
    );
    state.sessions[0].status = "ANALYZED";
    state.sessions[0].review = review;
    const res = await getWarmup("L1", db);
    expect(res.status).toBe("ANALYZED");
    expect(res.review).toEqual(review);
    expect(res.turns.map((t) => t.turnIndex)).toEqual([0, 1, 2]);
    expect(res.turns[1]).toEqual({ id: "x1", role: "learner", text: "a", turnIndex: 1, corrections: [{ c: 1 }] });
  });

  it("setWarmupStatus SKIPPED creates the session if missing and sets endedAt", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    const res = await setWarmupStatus("L1", "SKIPPED", db);
    expect(res.status).toBe("SKIPPED");
    expect(state.sessions[0].endedAt).toBeInstanceOf(Date);
  });

  it("setWarmupStatus SKIPPED on an active session sets status and endedAt", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    await startWarmup("L1", db);
    await setWarmupStatus("L1", "SKIPPED", db);
    expect(state.sessions[0].status).toBe("SKIPPED");
    expect(state.sessions[0].endedAt).toBeInstanceOf(Date);
  });

  it("setWarmupStatus UNAVAILABLE marks an active session without ending it", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    await startWarmup("L1", db);
    await setWarmupStatus("L1", "UNAVAILABLE", db);
    expect(state.sessions[0].status).toBe("UNAVAILABLE");
    expect(state.sessions[0].endedAt).toBeNull();
  });

  it("setWarmupStatus never overwrites ANALYZED", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    await startWarmup("L1", db);
    state.sessions[0].status = "ANALYZED";
    await setWarmupStatus("L1", "SKIPPED", db);
    await setWarmupStatus("L1", "UNAVAILABLE", db);
    expect(state.sessions[0].status).toBe("ANALYZED");
    expect(state.sessions[0].endedAt).toBeNull();
  });

  it("UNAVAILABLE does not reopen a SKIPPED session", async () => {
    const { db, state } = makeFakeDb({ lessons: [lesson] });
    await setWarmupStatus("L1", "SKIPPED", db);
    await setWarmupStatus("L1", "UNAVAILABLE", db);
    expect(state.sessions[0].status).toBe("SKIPPED");
  });

  it("setWarmupStatus on a missing lesson -> LessonNotFoundError", async () => {
    const { db } = makeFakeDb();
    await expect(setWarmupStatus("nope", "SKIPPED", db)).rejects.toBeInstanceOf(LessonNotFoundError);
  });
});
