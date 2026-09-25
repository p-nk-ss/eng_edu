// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { gradeLocally } from "./graders";
import type { Answer } from "./types";

const a = (x: Answer) => x;

describe("gradeLocally", () => {
  it("grades choice exercises by index and shows the keyed option", () => {
    expect(gradeLocally(E.MULTIPLE_CHOICE, a({ type: "mcq", selected: 1 }))).toMatchObject({ isCorrect: true, correctAnswer: "had finished", needsJudge: null });
    const wrong = gradeLocally(E.MULTIPLE_CHOICE, a({ type: "mcq", selected: 2 }));
    expect(wrong.isCorrect).toBe(false);
    expect(wrong.parts).toEqual([{ correct: false, given: "finishing", expected: "had finished" }]);
    expect(gradeLocally(E.DIALOGUE_GAP, a({ type: "dialogue_gap", selected: 0 })).isCorrect).toBe(true);
  });

  it("grades cloze gaps separately; the exercise is correct only if all gaps are", () => {
    const g = gradeLocally(E.CLOZE_DROPDOWN, a({ type: "cloze_mc", selected: [0, 0] }));
    expect(g.isCorrect).toBe(false);
    expect(g.parts.map((p) => p.correct)).toEqual([true, false]);
    expect(g.correctAnswer).toBe("I have worked here since 2019, for five years.");
  });

  it("accepts typed answers after normalization, including typographic apostrophes", () => {
    expect(gradeLocally(E.FILL_BLANK, a({ type: "open_cloze", text: ["  Beautiful "] })).isCorrect).toBe(true);
    expect(gradeLocally(E.ERROR_CORRECTION, a({ type: "error_correct", index: 1, fix: "doesn\u2019t" })).isCorrect).toBe(true);
    const d = gradeLocally(E.DICTATION, a({ type: "dictation", text: "I would like a coffee please!" }));
    expect(d).toMatchObject({ isCorrect: true, variantCandidates: [] });
  });

  it("turns a failed non-empty typed part into a variant candidate with its context", () => {
    const g = gradeLocally(E.FILL_BLANK, a({ type: "open_cloze", text: ["beautifull"] }));
    expect(g.isCorrect).toBe(false);
    expect(g.variantCandidates).toEqual([
      { part: 0, kind: "gap", given: "beautifull", expected: ["beautiful"], context: "It was a ___ (BEAUTY) day." },
    ]);
    const d = gradeLocally(E.DICTATION, a({ type: "dictation", text: "I'd like a cofee" }));
    expect(d.variantCandidates).toEqual([
      { part: 0, kind: "sentence", given: "I'd like a cofee", expected: E.DICTATION.type === "dictation" ? E.DICTATION.accept : [], context: "I'd like a coffee, please." },
    ]);
  });

  it("never escalates an empty typed answer", () => {
    const g = gradeLocally(E.FILL_BLANK, a({ type: "open_cloze", text: [""] }));
    expect(g).toMatchObject({ isCorrect: false, variantCandidates: [] });
  });

  it("requires the right token for error correction before a fix is even considered", () => {
    const wrongIndex = gradeLocally(E.ERROR_CORRECTION, a({ type: "error_correct", index: 2, fix: "doesn't" }));
    expect(wrongIndex).toMatchObject({ isCorrect: false, variantCandidates: [] });
    const typo = gradeLocally(E.ERROR_CORRECTION, a({ type: "error_correct", index: 1, fix: "dosn't" }));
    expect(typo.variantCandidates).toEqual([{ part: 0, kind: "gap", given: "dosn't", expected: ["doesn't", "does not"], context: "She ___ like tea" }]);
    expect(typo.correctAnswer).toBe("She doesn't like tea");
  });

  it("assembles word-bank tokens and compares loosely", () => {
    expect(gradeLocally(E.WORD_BANK, a({ type: "word_bank", tokens: ["I", "go", "to", "work"] })).isCorrect).toBe(true);
    const w = gradeLocally(E.WORD_BANK, a({ type: "word_bank", tokens: ["go", "I", "to", "work"] }));
    expect(w).toMatchObject({ isCorrect: false, correctAnswer: "I go to work" });
  });

  it("grades match pairs one by one", () => {
    const m = gradeLocally(E.MATCH, a({ type: "match", pairs: [2, 1, 0] }));
    expect(m.parts.map((p) => p.correct)).toEqual([true, false, false]);
    expect(m.parts[0]).toEqual({ correct: true, given: "frankly = to be honest", expected: "frankly = to be honest" });
  });

  it("hands translation and open writing to the judge", () => {
    expect(gradeLocally(E.TRANSLATION, a({ type: "translation", text: "x" }))).toMatchObject({ needsJudge: "translation", correctAnswer: "I finished the report before the deadline." });
    expect(gradeLocally(E.OPEN_WRITING, a({ type: "open_writing", text: "x" })).needsJudge).toBe("writing");
  });

  it("refuses an answer of another exercise type", () => {
    expect(() => gradeLocally(E.MULTIPLE_CHOICE, a({ type: "dialogue_gap", selected: 0 }))).toThrow(/does not match/);
  });
});
