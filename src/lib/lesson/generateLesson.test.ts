// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { GenerationInputs, LessonEnvelope } from "../prompts/lessonGeneration";
import type { ExerciseContent, ExerciseTypeName } from "./exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "./fixtures";
import { generateLesson, LessonGenerationError, type GenerationDeps } from "./generateLesson";
import type { GateResult } from "./qualityGate";

const MIX: ExerciseTypeName[] = ["MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP", "TRANSLATION"];
const inputs: GenerationInputs = {
  profile: { level: "B1", goals: "fluency", interests: "IT", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs and workplaces." },
  grammar: { id: "g1", title: "Past Perfect (had done)", description: "had + past participle.", example: "She had left." },
  vocab: FIXTURE_VOCAB.map((v) => ({ ...v, pos: "noun", cefrLevel: "B1" })),
  mix: MIX,
  summaries: [],
};
const envelope = (exercises: unknown[]): LessonEnvelope => ({
  exercises,
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
