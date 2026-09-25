// @vitest-environment node
import { describe, it, expect } from "vitest";
import { TRANSLATION_FEEDBACK_LIMITS as L, translationFeedbackPrompt, translationFeedbackSchema } from "./translationFeedback";

const input = {
  source: "Я закончил отчёт.",
  reference: "I finished the report.",
  answer: "I have finished report.",
  jevCategory: "grammar",
  grammar: { title: "Past Simple", description: "Finished actions in the past." },
  level: "B1",
};

describe("translationFeedbackPrompt", () => {
  it("sends every input as JSON in one user message", () => {
    const args = translationFeedbackPrompt(input);
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload).toMatchObject({ source_ru: input.source, reference_en: input.reference, learner_answer: input.answer, jev_category: "grammar", level: "B1" });
    expect(payload.grammar_focus).toEqual(input.grammar);
  });

  it("states the contract and the limits from the constants", () => {
    const system = translationFeedbackPrompt(input).system ?? "";
    expect(system).toMatch(/ONLY a JSON object/);
    expect(system).toMatch(/MINIMAL edits/);
    expect(system).toContain(`${L.explanation.min}-${L.explanation.max}`);
    expect(system).toContain(`${L.corrected.min}-${L.corrected.max}`);
    for (const c of ["none", "grammar", "vocabulary", "word_order", "spelling", "meaning"]) expect(system).toContain(`"${c}"`);
  });
});

describe("translationFeedbackSchema", () => {
  const ok = { isCorrect: false, corrected: "I finished the report.", explanation: "Use the past simple for a finished action.", category: "grammar", relatesToFocus: true };
  it("accepts a valid answer", () => expect(translationFeedbackSchema.parse(ok)).toEqual(ok));
  it("rejects an unknown category and a too-short explanation", () => {
    expect(translationFeedbackSchema.safeParse({ ...ok, category: "tone" }).success).toBe(false);
    expect(translationFeedbackSchema.safeParse({ ...ok, explanation: "bad" }).success).toBe(false);
  });
});
