// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VARIANT_ACCEPT, variantRequest } from "./variantGate";

describe("variantRequest", () => {
  it("asks about ONE gap with the keyed answers and the learner answer", () => {
    const r = variantRequest({ part: 0, kind: "gap", given: "colour", expected: ["color"], context: "What ___ is it?" });
    expect(r.state).toEqual({ sentence_with_gap: "What ___ is it?", keyed_answers: ["color"], learner_answer: "colour" });
    expect(r.questions.equivalent.type).toBe("noul");
    expect(String(r.questions.equivalent.instructions)).toMatch(/British or American/);
  });

  it("gap policy: synonyms and alternative correct forms count; bracketed words and the drilled form are hints", () => {
    const q = variantRequest({ part: 0, kind: "gap", given: "more dependable", expected: ["more reliable"], context: "She is ___ (RELIABLE) now." }).questions.equivalent;
    const text = `${String(q.instructions)} ${q.criteria.true}`;
    expect(text).toMatch(/synonym/);
    expect(text).toMatch(/brackets/);
    expect(text).toMatch(/hint/);
    expect(q.criteria.false).toMatch(/misspelled/);
    expect(q.criteria.false).toMatch(/original error/);
  });

  it("dictation policy is unchanged: the same words, no synonyms", () => {
    const q = variantRequest({ part: 0, kind: "sentence", given: "x", expected: ["y"], context: "y" }).questions.equivalent;
    expect(String(q.instructions)).not.toMatch(/synonym/);
    expect(q.criteria.false).toMatch(/different/);
  });

  it("uses the spoken sentence for a dictation candidate", () => {
    const r = variantRequest({ part: 0, kind: "sentence", given: "I'd like a coffee", expected: ["i'd like a coffee please"], context: "I'd like a coffee, please." });
    expect(r.state).toEqual({ spoken_sentence: "I'd like a coffee, please.", keyed_answers: ["i'd like a coffee please"], learner_answer: "I'd like a coffee" });
    expect(String(r.questions.equivalent.instructions)).toMatch(/spoken_sentence/);
  });

  it("accepts only confident equivalence", () => {
    expect(VARIANT_ACCEPT).toBe(0.8);
  });
});
