// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { GenerationInputs, LessonEnvelope } from "../prompts/lessonGeneration";
import type { ReviewItem } from "../review/planReview";
import type { ExerciseContent, ExerciseTypeName } from "./exerciseSchemas";
import { formatDrop, generateLesson, LessonGenerationError, type GenerationDeps } from "./generateLesson";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "./fixtures";
import type { GateResult } from "./qualityGate";

const MIX: ExerciseTypeName[] = ["MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP", "TRANSLATION"];
const inputs: GenerationInputs = {
  profile: { level: "B1", goals: "fluency", interests: "IT", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs and workplaces." },
  grammar: { id: "g1", title: "Past Perfect (had done)", description: "had + past participle.", example: "She had left." },
  vocab: FIXTURE_VOCAB.map((v) => ({ ...v, pos: "noun", cefrLevel: "B1" })),
  mix: MIX,
  summaries: [],
  review: [],
};
const REVIEW_ITEMS: ReviewItem[] = [
  { errorId: "r1", type: "FILL_BLANK", category: "Comparative with more", grammarTitle: "Comparative with more", examples: ["as -> than"] },
  { errorId: "r2", type: "TRANSLATION", category: "translation: meaning", grammarTitle: null, examples: ["then -> than"] },
];
const withReview: GenerationInputs = { ...inputs, review: REVIEW_ITEMS };
const envelope = (exercises: unknown[], review: unknown[] = []): LessonEnvelope => ({
  exercises,
  review,
  warmup: { intro: "Let us talk about your working day.", questions: ["What do you do?", "Who with?", "What is hard?"] },
  scenario: { title: "A missed deadline", role: "You are a QA engineer.", goal: "Agree on a new date.", opening: "Do you have a minute?" },
});
const all = MIX.map((t) => E[t]);
const keepAll = (exs: ExerciseContent[]): GateResult => ({ status: "passed", verdicts: exs.map((_, index) => ({ index, gated: true, drop: false })) });
const deps = (ask: GenerationDeps["ask"], gate: GenerationDeps["gate"] = async (exs) => keepAll(exs)): GenerationDeps => ({ ask, gate });

describe("generateLesson", () => {
  it("returns every valid exercise in mix order with the framing", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope([...all].reverse()));
    const draft = await generateLesson(inputs, deps(ask));
    expect(draft.exercises.map((e) => e.type)).toEqual(MIX);
    expect(draft).toMatchObject({ attempts: 1, qualityGate: "passed", drops: [] });
    expect(draft.warmup.questions).toHaveLength(3);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].messages[0].content).toContain("Past Perfect");
  });

  it("drops invalid, failing-check, unrequested and duplicate exercises but keeps the lesson", async () => {
    const badCheck = { ...E.MULTIPLE_CHOICE, answer: 9 };
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope([badCheck, E.CLOZE_DROPDOWN, E.FILL_BLANK, E.ERROR_CORRECTION, E.MATCH, E.DIALOGUE_GAP, E.DICTATION, E.MATCH, { junk: 1 }]));
    const draft = await generateLesson(inputs, deps(ask));
    expect(draft.exercises.map((e) => e.type)).toEqual(["CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP"]);
    const reasons = draft.drops.map((d) => d.reason).join(" | ");
    expect(reasons).toMatch(/answer index/);
    expect(reasons).toMatch(/not requested/);
    expect(reasons).toMatch(/duplicate/);
    expect(draft.drops).toHaveLength(4);
    expect(draft.attempts).toBe(1);
  });

  it("prunes an unknown vocab id without dropping the exercise (drops stay empty)", async () => {
    const mcqWithGhost = { ...E.MULTIPLE_CHOICE, vocab: ["ghost", "v1"] };
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope([mcqWithGhost, ...all.slice(1)]));
    const draft = await generateLesson(inputs, deps(ask));
    expect(draft.exercises).toHaveLength(7);
    expect(draft.drops).toEqual([]);
    const mcq = draft.exercises.find((e) => e.type === "MULTIPLE_CHOICE");
    expect(mcq?.content.vocab).toEqual(["v1"]);
  });

  it("applies the gate verdicts to the surviving exercises only", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all));
    const gate = vi.fn<GenerationDeps["gate"]>(async (exs) => ({
      status: "partial",
      verdicts: exs.map((c, index) => ({ index, gated: true, drop: c.type === "mcq", ...(c.type === "mcq" ? { reason: "gate: the keyed answer looks wrong" } : {}) })),
    }));
    const draft = await generateLesson(inputs, deps(ask, gate));
    expect(draft.exercises.map((e) => e.type)).not.toContain("MULTIPLE_CHOICE");
    expect(draft.qualityGate).toBe("partial");
    expect(draft.drops[0]).toMatchObject({ type: "MULTIPLE_CHOICE", attempt: 1 });
    expect(gate.mock.calls[0][1]).toEqual({ title: "Past Perfect (had done)", description: "had + past participle." });
  });

  it("carries the gate scores of kept exercises only, indexed into the final (sorted) exercises array", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all));
    const gate = vi.fn<GenerationDeps["gate"]>(async (exs) => ({
      status: "passed",
      verdicts: exs.map((c, index) => ({
        index,
        gated: c.type === "mcq" || c.type === "cloze_mc",
        drop: false,
        ...(c.type === "mcq" || c.type === "cloze_mc" ? { scores: { key_correct: 0.9 } } : {}),
      })),
    }));
    const draft = await generateLesson(inputs, deps(ask, gate));
    const mcqIndex = draft.exercises.findIndex((e) => e.type === "MULTIPLE_CHOICE");
    const clozeIndex = draft.exercises.findIndex((e) => e.type === "CLOZE_DROPDOWN");
    expect(draft.gateScores).toHaveLength(2);
    expect(draft.gateScores).toEqual(
      expect.arrayContaining([
        { exerciseIndex: mcqIndex, scores: { key_correct: 0.9 } },
        { exerciseIndex: clozeIndex, scores: { key_correct: 0.9 } },
      ]),
    );
  });

  it("regenerates once when fewer than 5 survive, and the second attempt can rescue the lesson", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValueOnce(envelope(all.slice(0, 3))).mockResolvedValueOnce(envelope(all));
    const draft = await generateLesson(inputs, deps(ask));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(draft.attempts).toBe(2);
    expect(draft.exercises).toHaveLength(7);
  });

  it("throws LessonGenerationError with every drop reason after two failed attempts", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValueOnce(envelope([{ junk: 1 }])).mockRejectedValueOnce(new Error("LLM JSON validation failed"));
    const err = await generateLesson(inputs, deps(ask)).catch((e) => e);
    expect(err).toBeInstanceOf(LessonGenerationError);
    // attempt 1: the junk exercise + "only 0 survived"; attempt 2: the failed regeneration
    expect(err.drops.map((d: { attempt: number }) => d.attempt)).toEqual([1, 1, 2]);
    expect(err.message).toMatch(/LLM JSON validation failed/);
  });

  it("passes no grammar to the gate for a vocab-only lesson", async () => {
    const gate = vi.fn<GenerationDeps["gate"]>(async (exs) => keepAll(exs));
    await generateLesson({ ...inputs, grammar: null }, deps(vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all)), gate));
    expect(gate.mock.calls[0][1]).toBeNull();
  });
});

describe("generateLesson - review", () => {
  it("keeps valid review exercises in order with their errorId, vocab forced to []", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all, [E.FILL_BLANK, E.TRANSLATION]));
    const draft = await generateLesson(withReview, deps(ask));
    expect(draft.review).toEqual([
      { errorId: "r1", type: "FILL_BLANK", content: { ...E.FILL_BLANK, vocab: [] } },
      { errorId: "r2", type: "TRANSLATION", content: { ...E.TRANSLATION, vocab: [] } },
    ]);
  });

  it("drops a review exercise of the wrong type and an invalid raw review item, without triggering regeneration", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all, [E.MULTIPLE_CHOICE, { junk: 1 }]));
    const draft = await generateLesson(withReview, deps(ask));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(draft.review).toEqual([]);
    expect(draft.exercises).toHaveLength(7);
    expect(draft.attempts).toBe(1);
    const reviewDrops = draft.drops.filter((d) => d.section === "review");
    expect(reviewDrops).toHaveLength(2);
    expect(reviewDrops[0]).toMatchObject({ index: 0, type: "MULTIPLE_CHOICE" });
    expect(reviewDrops[0].reason).toMatch(/not requested/);
    expect(reviewDrops[1]).toMatchObject({ index: 1 });
  });

  it("drops missing review entries without failing the lesson", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all));
    const draft = await generateLesson(withReview, deps(ask));
    expect(draft.review).toEqual([]);
    expect(draft.exercises).toHaveLength(7);
    const reviewDrops = draft.drops.filter((d) => d.section === "review");
    expect(reviewDrops).toHaveLength(2);
    expect(reviewDrops.map((d) => d.reason)).toEqual(["review item missing", "review item missing"]);
    expect(reviewDrops.map((d) => d.index)).toEqual([0, 1]);
  });

  it("gates review exercises separately from the written gate call", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all, [E.FILL_BLANK, E.TRANSLATION]));
    const gate = vi
      .fn<GenerationDeps["gate"]>()
      .mockImplementationOnce(async (exs) => keepAll(exs))
      .mockImplementationOnce(async (exs) => ({
        status: "partial",
        verdicts: exs.map((_, index) => ({ index, gated: true, drop: index === 0, ...(index === 0 ? { reason: "gate: dropped" } : {}) })),
      }));
    const draft = await generateLesson(withReview, deps(ask, gate));
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate.mock.calls[0][0]).toHaveLength(7);
    expect(gate.mock.calls[1][0]).toHaveLength(2);
    expect(draft.exercises).toHaveLength(7);
    expect(draft.review).toEqual([{ errorId: "r2", type: "TRANSLATION", content: { ...E.TRANSLATION, vocab: [] } }]);
    expect(draft.drops.some((d) => d.section === "review" && /gate/.test(d.reason))).toBe(true);
  });

  it("gates the review exercises with no grammar focus, even when the lesson itself has one (a review item may be off today's focus)", async () => {
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all, [E.FILL_BLANK, E.TRANSLATION]));
    const gate = vi.fn<GenerationDeps["gate"]>(async (exs) => keepAll(exs));
    await generateLesson(withReview, deps(ask, gate));
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate.mock.calls[0][1]).toEqual({ title: "Past Perfect (had done)", description: "had + past participle." });
    expect(gate.mock.calls[1][1]).toBeNull();
  });

  it("strips a hint from a review exercise so the review never gives the answer away", async () => {
    const translationWithHint = { ...E.TRANSLATION, hint: "it mentions a deadline" };
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all, [E.FILL_BLANK, translationWithHint]));
    const draft = await generateLesson(withReview, deps(ask));
    const translationReview = draft.review.find((r) => r.type === "TRANSLATION");
    expect(translationReview).toBeDefined();
    expect(translationReview?.content).not.toHaveProperty("hint");
  });

  it("logs the review item's own index on a gate drop, not its position among valid review items", async () => {
    // item 0 is invalid (dropped before the gate ever runs); item 1 is valid and reaches the gate
    // as the ONLY entry (position 0 there) - the drop must still be logged against index 1.
    const ask = vi.fn<GenerationDeps["ask"]>().mockResolvedValue(envelope(all, [{ junk: 1 }, E.TRANSLATION]));
    const gate = vi
      .fn<GenerationDeps["gate"]>()
      .mockImplementationOnce(async (exs) => keepAll(exs))
      .mockImplementationOnce(async (exs) => ({
        status: "partial",
        verdicts: exs.map((_, index) => ({ index, gated: true, drop: true, reason: "gate: dropped" })),
      }));
    const draft = await generateLesson(withReview, deps(ask, gate));
    expect(draft.review).toEqual([]);
    const reviewDrops = draft.drops.filter((d) => d.section === "review");
    expect(reviewDrops).toHaveLength(2);
    expect(reviewDrops.find((d) => d.index === 0)).toBeDefined();
    const gateDrop = reviewDrops.find((d) => d.index === 1);
    expect(gateDrop).toBeDefined();
    expect(gateDrop?.reason).toMatch(/gate/);
  });

  it("prefixes a review drop's formatted line with 'review '", () => {
    expect(formatDrop({ attempt: 1, index: 0, section: "review", reason: "x" })).toMatch(/^review /);
  });
});
