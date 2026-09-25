// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { parseAnswer } from "./answerSchemas";

describe("parseAnswer", () => {
  it("accepts one valid answer per exercise type and tags it with the exercise type", () => {
    const cases: [keyof typeof E, unknown][] = [
      ["MULTIPLE_CHOICE", { selected: 1 }],
      ["CLOZE_DROPDOWN", { selected: [0, 1] }],
      ["FILL_BLANK", { text: ["beautiful"] }],
      ["WORD_BANK", { tokens: ["I", "go", "to", "work"] }],
      ["MATCH", { pairs: [2, 0, 1] }],
      ["DIALOGUE_GAP", { selected: 0 }],
      ["DICTATION", { text: "I'd like a coffee" }],
      ["ERROR_CORRECTION", { index: 1, fix: "doesn't" }],
      ["TRANSLATION", { text: "I finished the report." }],
      ["OPEN_WRITING", { text: "Once I missed a deadline." }],
    ];
    for (const [t, raw] of cases) {
      const res = parseAnswer(E[t], raw);
      expect(res.ok, t).toBe(true);
      expect(res.ok && res.answer.type, t).toBe(E[t].type);
    }
  });

  it("rejects a wrong shape, naming the field", () => {
    const res = parseAnswer(E.MULTIPLE_CHOICE, { selected: "1" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toMatch(/selected/);
    expect(parseAnswer(E.ERROR_CORRECTION, { index: 1 }).ok).toBe(false);
  });

  it("rejects answers whose length does not match the exercise", () => {
    expect(parseAnswer(E.CLOZE_DROPDOWN, { selected: [0] }).ok).toBe(false);
    expect(parseAnswer(E.FILL_BLANK, { text: ["a", "b"] }).ok).toBe(false);
    expect(parseAnswer(E.MATCH, { pairs: [2, 0] }).ok).toBe(false);
  });

  it("rejects out-of-range selections and indexes (malformed, not a mistake)", () => {
    expect(parseAnswer(E.MULTIPLE_CHOICE, { selected: 4 }).ok).toBe(false);
    expect(parseAnswer(E.DIALOGUE_GAP, { selected: 2 }).ok).toBe(false);
    expect(parseAnswer(E.CLOZE_DROPDOWN, { selected: [0, 5] }).ok).toBe(false);
    expect(parseAnswer(E.MATCH, { pairs: [2, 0, 7] }).ok).toBe(false);
    expect(parseAnswer(E.ERROR_CORRECTION, { index: 9, fix: "x" }).ok).toBe(false);
    expect(parseAnswer(E.MULTIPLE_CHOICE, { selected: -1 }).ok).toBe(false);
  });

  it("rejects empty free text for dictation, translation and writing", () => {
    expect(parseAnswer(E.DICTATION, { text: "" }).ok).toBe(false);
    expect(parseAnswer(E.TRANSLATION, { text: "" }).ok).toBe(false);
    expect(parseAnswer(E.OPEN_WRITING, { text: "" }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(parseAnswer(E.MULTIPLE_CHOICE, null).ok).toBe(false);
    expect(parseAnswer(E.MULTIPLE_CHOICE, "1").ok).toBe(false);
  });
});
