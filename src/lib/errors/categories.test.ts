// @vitest-environment node
import { describe, it, expect } from "vitest";
import { categoryGroup, errorTitle, GROUP_LABELS } from "./categories";

const e = (category: string, grammarTopicId: string | null = null) => ({ category, grammarTopicId });

describe("categoryGroup", () => {
  it("maps every category family", () => {
    expect(categoryGroup(e("Comparative with more", "g1"))).toBe("grammar");
    expect(categoryGroup(e("translation: meaning"))).toBe("translation");
    expect(categoryGroup(e("vocab: deadline"))).toBe("vocab");
    expect(categoryGroup(e("listening/spelling"))).toBe("listening");
    expect(categoryGroup(e("writing: grammar"))).toBe("writing");
    expect(categoryGroup(e("general"))).toBe("general");
    expect(categoryGroup(e("something new"))).toBe("general");
    expect(GROUP_LABELS.vocab).toBe("Vocabulary");
  });
});

describe("errorTitle", () => {
  it("uses the topic title for grammar errors", () => {
    expect(errorTitle(e("Comparative with more", "g1"), "Comparative with more (more + adjective)")).toBe("Comparative with more (more + adjective)");
  });
  it("title falls back to the category when the topic is gone", () => {
    expect(errorTitle(e("Comparative with more", "g1"), null)).toBe("Comparative with more");
  });
  it("humanises prefixed categories", () => {
    expect(errorTitle(e("translation: meaning"), null)).toBe("Translation - meaning");
    expect(errorTitle(e("vocab: deadline"), null)).toBe("Word - deadline");
    expect(errorTitle(e("writing: word_order"), null)).toBe("Writing - word order");
    expect(errorTitle(e("listening/spelling"), null)).toBe("Listening and spelling");
    expect(errorTitle(e("general"), null)).toBe("General");
  });
});
