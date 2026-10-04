// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import type { ConversationAnalysis } from "../prompts/conversationAnalysis";
import { makeFakeDb, type FakeState } from "./fakeConversationDb";
import { AnalysisUnavailableError, finishWarmup } from "./analyze";

const INTRO = "Hi! Let us talk about your working day and what you enjoy about it.";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const DAY_MS = 86_400_000;

const lessonWithTopic = {
  id: "L1",
  theme: "work",
  plan: { sections: { warmup: { intro: INTRO, questions: [] } }, meta: { grammarTopicId: "g1", vocabIds: [] } },
};

function setupActiveSession(extra: Partial<FakeState> = {}) {
  const fake = makeFakeDb({
    lessons: [lessonWithTopic],
    grammarTopics: [{ id: "g1", title: "Present Perfect", name: "RAW_PRESENT_PERFECT", description: null }],
    ...extra,
  });
  const sid = "s1";
  fake.state.sessions.push({ id: sid, lessonId: "L1", mode: "WARMUP", status: "ACTIVE", review: null, createdAt: NOW, endedAt: null });
  fake.state.turns.push(
    { id: "p0", lessonId: "L1", sessionId: sid, role: "partner", text: INTRO, turnIndex: 0, corrections: null, createdAt: NOW },
    { id: "l1", lessonId: "L1", sessionId: sid, role: "learner", text: "I are happy", turnIndex: 1, corrections: null, createdAt: NOW },
    { id: "p1", lessonId: "L1", sessionId: sid, role: "partner", text: "reply 1", turnIndex: 2, corrections: null, createdAt: NOW },
    { id: "l2", lessonId: "L1", sessionId: sid, role: "learner", text: "all good, no mistakes here", turnIndex: 3, corrections: null, createdAt: NOW },
    { id: "p2", lessonId: "L1", sessionId: sid, role: "partner", text: "reply 2", turnIndex: 4, corrections: null, createdAt: NOW },
    { id: "l3", lessonId: "L1", sessionId: sid, role: "learner", text: "I have a deadline tommorow", turnIndex: 5, corrections: null, createdAt: NOW },
  );
  return fake;
}

const happyAnalysis: ConversationAnalysis = {
  findings: [
    { turnId: "l1", original: "I are", corrected: "I am", explanation: "subject-verb agreement", category: "ignored", severity: "major", grammarTopicId: "g1" },
    { turnId: "l3", original: "tommorow", corrected: "tomorrow", explanation: "spelling", category: "spelling", severity: "moderate", grammarTopicId: null },
    { turnId: "l3", original: "deadline", corrected: "due date", explanation: "wrong word", category: "vocab: deadline", severity: "major", grammarTopicId: null },
  ],
  topIssues: ["subject-verb agreement", "spelling"],
};

describe("finishWarmup - skip paths", () => {
  it("skip -> SKIPPED, endedAt set, analyse not called", async () => {
    const fake = setupActiveSession();
    const analyse = vi.fn();
    const res = await finishWarmup("L1", "skip", { db: fake.db, analyse, now: NOW });
    expect(res.status).toBe("SKIPPED");
    expect(fake.state.sessions[0].endedAt).toBeInstanceOf(Date);
    expect(analyse).not.toHaveBeenCalled();
    expect(fake.state.errorRecords).toHaveLength(0);
  });

  it("review with 1 learner turn -> SKIPPED, analyse not called, no errors", async () => {
    const fake = makeFakeDb({ lessons: [lessonWithTopic] });
    fake.state.sessions.push({ id: "s1", lessonId: "L1", mode: "WARMUP", status: "ACTIVE", review: null, createdAt: NOW, endedAt: null });
    fake.state.turns.push(
      { id: "p0", lessonId: "L1", sessionId: "s1", role: "partner", text: INTRO, turnIndex: 0, corrections: null, createdAt: NOW },
      { id: "l1", lessonId: "L1", sessionId: "s1", role: "learner", text: "hi", turnIndex: 1, corrections: null, createdAt: NOW },
    );
    const analyse = vi.fn();
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });
    expect(res.status).toBe("SKIPPED");
    expect(analyse).not.toHaveBeenCalled();
    expect(fake.state.errorRecords).toHaveLength(0);
  });
});

describe("finishWarmup - happy path", () => {
  it("analyses, writes corrections, creates major ErrorRecords, stores review", async () => {
    const fake = setupActiveSession();
    const analyse = vi.fn().mockResolvedValue(happyAnalysis);
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });

    expect(analyse).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("ANALYZED");
    expect(res.review).toEqual({ topIssues: happyAnalysis.topIssues, counts: { minor: 0, moderate: 1, major: 2 }, errorsAdded: 2 });

    const l1 = res.turns.find((t) => t.id === "l1")!;
    const l2 = res.turns.find((t) => t.id === "l2")!;
    const l3 = res.turns.find((t) => t.id === "l3")!;
    expect(l1.corrections).toEqual([
      { turnId: "l1", original: "I are", corrected: "I am", explanation: "subject-verb agreement", category: "Present Perfect", severity: "major", grammarTopicId: "g1" },
    ]);
    expect(l2.corrections).toEqual([]);
    expect(l3.corrections).toEqual([
      { turnId: "l3", original: "tommorow", corrected: "tomorrow", explanation: "spelling", category: "spelling", severity: "moderate", grammarTopicId: null },
      { turnId: "l3", original: "deadline", corrected: "due date", explanation: "wrong word", category: "vocab: deadline", severity: "major", grammarTopicId: null },
    ]);

    expect(fake.state.errorRecords).toHaveLength(2);
    const grammarErr = fake.state.errorRecords.find((e) => e.grammarTopicId === "g1")!;
    expect(grammarErr).toMatchObject({ lessonId: "L1", category: "Present Perfect", source: "CONVERSATION", status: "NEW", correctStreak: 0, description: "- I are -> I am" });
    expect(grammarErr.nextReviewAt).toEqual(new Date(NOW.getTime() + DAY_MS));

    const vocabErr = fake.state.errorRecords.find((e) => e.grammarTopicId === null)!;
    expect(vocabErr).toMatchObject({ lessonId: "L1", category: "vocab: deadline", source: "CONVERSATION", status: "NEW", description: "- deadline -> due date" });

    expect(fake.state.sessions[0].status).toBe("ANALYZED");
    expect(fake.state.sessions[0].review).toEqual(res.review);
    expect(fake.state.sessions[0].endedAt).toEqual(NOW);
  });
});

describe("finishWarmup - error dedup", () => {
  it("two major findings with the same key -> one record with both examples", async () => {
    const fake = setupActiveSession();
    const analysis: ConversationAnalysis = {
      findings: [
        { turnId: "l1", original: "I are", corrected: "I am", explanation: "e1", category: "x", severity: "major", grammarTopicId: "g1" },
        { turnId: "l3", original: "I has", corrected: "I have", explanation: "e2", category: "x", severity: "major", grammarTopicId: "g1" },
      ],
      topIssues: [],
    };
    const analyse = vi.fn().mockResolvedValue(analysis);
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });

    expect(fake.state.errorRecords).toHaveLength(1);
    expect(fake.state.errorRecords[0].description).toBe("- I are -> I am\n- I has -> I have");
    expect(res.review?.errorsAdded).toBe(1);
  });

  it("an existing record for this lesson + key is appended to, not duplicated", async () => {
    const fake = setupActiveSession();
    fake.state.errorRecords.push({
      id: "e0", lessonId: "L1", grammarTopicId: "g1", category: "Present Perfect",
      description: "- from the written block -> fixed", source: "EXERCISE", status: "NEW",
      correctStreak: 0, nextReviewAt: NOW, createdAt: NOW, masteredAt: null,
    });
    const analysis: ConversationAnalysis = {
      findings: [{ turnId: "l1", original: "I are", corrected: "I am", explanation: "e1", category: "x", severity: "major", grammarTopicId: "g1" }],
      topIssues: [],
    };
    const analyse = vi.fn().mockResolvedValue(analysis);
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });

    expect(fake.state.errorRecords).toHaveLength(1);
    expect(fake.state.errorRecords[0].description).toBe("- from the written block -> fixed\n- I are -> I am");
    expect(res.review?.errorsAdded).toBe(0);
  });
});

describe("finishWarmup - unknown ids", () => {
  it("drops findings on a partner turn id or an unknown id; nulls an unknown grammarTopicId", async () => {
    const fake = setupActiveSession();
    const analysis: ConversationAnalysis = {
      findings: [
        { turnId: "p0", original: "x", corrected: "y", explanation: "e", category: "general", severity: "major", grammarTopicId: null },
        { turnId: "nope", original: "x", corrected: "y", explanation: "e", category: "general", severity: "major", grammarTopicId: null },
        { turnId: "l1", original: "a", corrected: "b", explanation: "e", category: "Articles", severity: "major", grammarTopicId: "unknown-topic" },
        { turnId: "l2", original: "c", corrected: "d", explanation: "e", category: "", severity: "minor", grammarTopicId: "unknown-topic" },
      ],
      topIssues: [],
    };
    const analyse = vi.fn().mockResolvedValue(analysis);
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });

    expect(res.review?.counts).toEqual({ minor: 1, moderate: 0, major: 1 });
    const l1 = res.turns.find((t) => t.id === "l1")!;
    const l2 = res.turns.find((t) => t.id === "l2")!;
    // the review keeps the model's label; the ErrorRecord of a non-topic, non-vocab finding is "general"
    expect(l1.corrections).toEqual([{ turnId: "l1", original: "a", corrected: "b", explanation: "e", category: "Articles", severity: "major", grammarTopicId: null }]);
    expect(l2.corrections).toEqual([{ turnId: "l2", original: "c", corrected: "d", explanation: "e", category: "general", severity: "minor", grammarTopicId: null }]);
    expect(fake.state.errorRecords).toHaveLength(1);
    expect(fake.state.errorRecords[0]).toMatchObject({ grammarTopicId: null, category: "general", description: "- a -> b" });
  });
});

describe("finishWarmup - ErrorRecord categories", () => {
  it('"Articles" and "article usage" with null topics collapse into ONE general record with two examples', async () => {
    const fake = setupActiveSession();
    const analysis: ConversationAnalysis = {
      findings: [
        { turnId: "l1", original: "a apple", corrected: "an apple", explanation: "e1", category: "Articles", severity: "major", grammarTopicId: null },
        { turnId: "l3", original: "the work", corrected: "work", explanation: "e2", category: "article usage", severity: "major", grammarTopicId: null },
      ],
      topIssues: [],
    };
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse: vi.fn().mockResolvedValue(analysis), now: NOW });

    expect(fake.state.errorRecords).toHaveLength(1);
    expect(fake.state.errorRecords[0]).toMatchObject({ grammarTopicId: null, category: "general", description: "- a apple -> an apple\n- the work -> work" });
    expect(res.review?.errorsAdded).toBe(1);
    expect((res.turns.find((t) => t.id === "l1")!.corrections as { category: string }[])[0].category).toBe("Articles");
    expect((res.turns.find((t) => t.id === "l3")!.corrections as { category: string }[])[0].category).toBe("article usage");
  });

  it("normalises a vocab category to a lower-case 'vocab: ' prefix and the trimmed word", async () => {
    const fake = setupActiveSession();
    const analysis: ConversationAnalysis = {
      findings: [
        { turnId: "l1", original: "x", corrected: "y", explanation: "e", category: "  Vocab:   deadline ", severity: "major", grammarTopicId: null },
        { turnId: "l3", original: "z", corrected: "w", explanation: "e", category: "VOCAB:deadline", severity: "major", grammarTopicId: "unknown" },
      ],
      topIssues: [],
    };
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse: vi.fn().mockResolvedValue(analysis), now: NOW });

    expect(fake.state.errorRecords).toHaveLength(1);
    expect(fake.state.errorRecords[0]).toMatchObject({ grammarTopicId: null, category: "vocab: deadline", description: "- x -> y\n- z -> w" });
    expect((res.turns.find((t) => t.id === "l1")!.corrections as { category: string }[])[0].category).toBe("  Vocab:   deadline ");
  });
});

describe("finishWarmup - failures and idempotency", () => {
  it("analyse throws -> AnalysisUnavailableError, nothing written, status stays ACTIVE", async () => {
    const fake = setupActiveSession();
    const analyse = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW })).rejects.toBeInstanceOf(AnalysisUnavailableError);
    expect(fake.state.sessions[0].status).toBe("ACTIVE");
    expect(fake.state.errorRecords).toHaveLength(0);
    expect(fake.state.turns.find((t) => t.id === "l1")!.corrections).toBeNull();
  });

  it("already ANALYZED -> returns the stored review, analyse not called", async () => {
    const fake = setupActiveSession();
    const storedReview = { topIssues: ["x"], counts: { minor: 1, moderate: 0, major: 0 }, errorsAdded: 0 };
    fake.state.sessions[0].status = "ANALYZED";
    fake.state.sessions[0].review = storedReview;
    const analyse = vi.fn();
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });
    expect(res.status).toBe("ANALYZED");
    expect(res.review).toEqual(storedReview);
    expect(analyse).not.toHaveBeenCalled();
  });

  it("a second review that finds the session already ANALYZED inside the transaction writes nothing and keeps the first review", async () => {
    const fake = setupActiveSession();
    const first: ConversationAnalysis = {
      findings: [{ turnId: "l1", original: "I are", corrected: "I am", explanation: "e", category: "x", severity: "major", grammarTopicId: "g1" }],
      topIssues: ["first"],
    };
    const second: ConversationAnalysis = {
      findings: [
        { turnId: "l1", original: "I are", corrected: "I am", explanation: "e", category: "x", severity: "major", grammarTopicId: "g1" },
        { turnId: "l3", original: "deadline", corrected: "due date", explanation: "e", category: "vocab: deadline", severity: "major", grammarTopicId: null },
      ],
      topIssues: ["second"],
    };
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const a = finishWarmup("L1", "review", { db: fake.db, analyse: () => new Promise((r) => (releaseFirst = () => r(first))), now: NOW });
    const b = finishWarmup("L1", "review", { db: fake.db, analyse: () => new Promise((r) => (releaseSecond = () => r(second))), now: NOW });
    await vi.waitFor(() => expect(releaseFirst && releaseSecond).toBeTruthy());
    releaseFirst!();
    const resA = await a;
    releaseSecond!();
    const resB = await b;

    expect(resA.review?.topIssues).toEqual(["first"]);
    expect(resB.status).toBe("ANALYZED");
    expect(resB.review).toEqual(resA.review);
    expect(fake.state.sessions[0].review).toEqual(resA.review);
    expect(fake.state.errorRecords).toHaveLength(1);
    expect(fake.state.errorRecords[0].description).toBe("- I are -> I am");
    expect(fake.state.turns.find((t) => t.id === "l3")!.corrections).toEqual([]);
  });

  it("already SKIPPED stays terminal -> returns the stored state, analyse not called", async () => {
    const fake = setupActiveSession();
    fake.state.sessions[0].status = "SKIPPED";
    fake.state.sessions[0].endedAt = NOW;
    const analyse = vi.fn();
    const res = await finishWarmup("L1", "review", { db: fake.db, analyse, now: NOW });
    expect(res.status).toBe("SKIPPED");
    expect(analyse).not.toHaveBeenCalled();
    expect(fake.state.sessions[0].status).toBe("SKIPPED");
    expect(fake.state.errorRecords).toHaveLength(0);
  });
});
