// @vitest-environment node
import { describe, it, expect } from "vitest";
import { LESSON_LIMITS, lessonEnvelopeSchema, lessonGenerationPrompt, type GenerationInputs } from "./lessonGeneration";

const input: GenerationInputs = {
  profile: { level: "B1", goals: "conversational fluency", interests: "IT, QA", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs, professions, workplaces." },
  grammar: { id: "g1", title: "Past Perfect (had done)", description: "had + past participle for an earlier past action.", example: "She had left when I arrived." },
  vocab: [
    { id: "v1", headword: "deadline", pos: "noun", cefrLevel: "B1" },
    { id: "v2", headword: "colleague", pos: "noun", cefrLevel: "B1" },
  ],
  mix: ["MULTIPLE_CHOICE", "MATCH", "TRANSLATION"],
  summaries: ["Lesson 1: struggled with articles."],
};

describe("lessonGenerationPrompt", () => {
  it("returns CompleteArgs with one user message carrying the inputs as JSON", () => {
    const args = lessonGenerationPrompt(input);
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0].role).toBe("user");
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload.grammar.title).toBe("Past Perfect (had done)");
    expect(payload.vocab.map((v: { id: string }) => v.id)).toEqual(["v1", "v2"]);
    expect(payload.exercises).toEqual(["mcq", "match", "translation"]);
    expect(payload.theme.label).toBe("Work & careers");
    expect(payload.recentSummaries).toEqual(["Lesson 1: struggled with articles."]);
  });

  it("describes ONLY the requested exercise shapes, in the system prompt", () => {
    const { system } = lessonGenerationPrompt(input);
    expect(system).toContain('"type":"mcq"');
    expect(system).toContain('"type":"match"');
    expect(system).toContain('"type":"translation"');
    expect(system).not.toContain('"type":"dictation"');
    expect(system).not.toContain('"type":"word_bank"');
  });

  it("states the contract: JSON only, order, single correct option, vocab ids, Russian only in translation source", () => {
    const { system } = lessonGenerationPrompt(input) as { system: string };
    expect(system).toMatch(/ONLY.*JSON/i);
    expect(system).toMatch(/exactly one correct/i);
    expect(system).toMatch(/"vocab"/);
    expect(system).toMatch(/Russian/);
    expect(system).toMatch(/no other grammar/i);
  });

  it("builds the stated limits from LESSON_LIMITS", () => {
    const { system } = lessonGenerationPrompt(input) as { system: string };
    expect(system).toContain(`${LESSON_LIMITS.warmupIntro.min}-${LESSON_LIMITS.warmupIntro.max}`);
    expect(system).toContain(`${LESSON_LIMITS.questions.min}-${LESSON_LIMITS.questions.max}`);
    expect(system).toContain(`${LESSON_LIMITS.scenarioText.min}-${LESSON_LIMITS.scenarioText.max}`);
    expect(system).toContain(`${LESSON_LIMITS.explain.min}-${LESSON_LIMITS.explain.max}`);
  });

  it("handles a lesson without a grammar focus", () => {
    const args = lessonGenerationPrompt({ ...input, grammar: null });
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload.grammar).toBeNull();
    expect(args.system).toMatch(/vocabulary/i);
  });
});

describe("lessonEnvelopeSchema", () => {
  const ok = {
    exercises: [{ anything: true }],
    warmup: { intro: "Let us talk about your working day and the people around you.", questions: ["What do you do at work?", "Who do you work with?", "What is hard about it?"] },
    scenario: { title: "A missed deadline", role: "You are a QA engineer talking to your manager.", goal: "Explain why the release slipped and agree on a new date.", opening: "Hi, do you have a minute to talk about the release?" },
  };
  it("accepts a valid envelope and keeps exercises untyped", () => {
    expect(lessonEnvelopeSchema.parse(ok).exercises).toEqual([{ anything: true }]);
  });
  it("rejects too few warm-up questions and an empty exercise list", () => {
    expect(lessonEnvelopeSchema.safeParse({ ...ok, warmup: { ...ok.warmup, questions: ["Only one question here?"] } }).success).toBe(false);
    expect(lessonEnvelopeSchema.safeParse({ ...ok, exercises: [] }).success).toBe(false);
  });
});
