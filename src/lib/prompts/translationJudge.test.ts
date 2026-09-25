// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import type { ContentOf } from "../grading/types";
import { TRANSLATION_ACCEPT, translationRequest } from "./translationJudge";

describe("translationRequest", () => {
  it("sends the Russian source, the reference and the learner answer", () => {
    const r = translationRequest(E.TRANSLATION as ContentOf<"translation">, "I finished the report before the deadline.");
    expect(r.state).toEqual({
      source_ru: (E.TRANSLATION as ContentOf<"translation">).source,
      reference_en: "I finished the report before the deadline.",
      learner_answer: "I finished the report before the deadline.",
    });
  });

  it("asks the two validated questions", () => {
    const r = translationRequest(E.TRANSLATION as ContentOf<"translation">, "x");
    expect(r.questions.acceptable.type).toBe("noul");
    expect(r.questions.error_type.type).toBe("choice");
    expect(Object.keys(r.questions.error_type.criteria)).toEqual(["none", "grammar", "vocabulary", "word_order", "spelling", "meaning"]);
    expect(TRANSLATION_ACCEPT).toBe(0.8);
  });
});
