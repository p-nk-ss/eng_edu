// @vitest-environment node
import { describe, it, expect } from "vitest";
import { WRITING_FEEDBACK_LIMITS as L, writingFeedbackPrompt, writingFeedbackSchema } from "./writingFeedback";

const input = { prompt: "Describe a missed deadline.", text: "Last year I miss a deadline.", minWords: 60, grammar: null, level: "B1" };

describe("writingFeedbackPrompt", () => {
  it("sends the task, the text and the word minimum", () => {
    const args = writingFeedbackPrompt(input);
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload).toMatchObject({ task: input.prompt, learner_text: input.text, min_words: 60, grammar_focus: null, level: "B1" });
  });

  it("defines severity and states the limits from the constants", () => {
    const system = writingFeedbackPrompt(input).system ?? "";
    expect(system).toMatch(/"major"/);
    expect(system).toMatch(/verbatim/i);
    expect(system).toContain(`at most ${L.corrections.max} corrections`);
    expect(system).toContain(`${L.summary.min}-${L.summary.max}`);
  });
});

describe("writingFeedbackSchema", () => {
  const correction = { original: "I miss", corrected: "I missed", explanation: "Past simple for a finished event.", category: "grammar", severity: "major", relatesToFocus: false };
  it("accepts a valid answer with and without corrections", () => {
    expect(writingFeedbackSchema.parse({ summary: "Good story, one tense error.", corrections: [correction] }).corrections).toHaveLength(1);
    expect(writingFeedbackSchema.parse({ summary: "Clear and correct, well done.", corrections: [] }).corrections).toEqual([]);
  });
  it("rejects an unknown severity and too many corrections", () => {
    expect(writingFeedbackSchema.safeParse({ summary: "Good story, one tense error.", corrections: [{ ...correction, severity: "fatal" }] }).success).toBe(false);
    expect(writingFeedbackSchema.safeParse({ summary: "Good story, one tense error.", corrections: Array(L.corrections.max + 1).fill(correction) }).success).toBe(false);
  });
});
