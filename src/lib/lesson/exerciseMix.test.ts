// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planExerciseMix } from "./exerciseMix";

describe("planExerciseMix", () => {
  it("goes from recognition to free production; odd lessons use MATCH and DIALOGUE_GAP", () => {
    expect(planExerciseMix(1, { hasGrammar: true })).toEqual([
      "MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP", "TRANSLATION",
    ]);
  });

  it("even lessons use WORD_BANK and DICTATION", () => {
    expect(planExerciseMix(2, { hasGrammar: true })).toEqual([
      "MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "WORD_BANK", "DICTATION", "TRANSLATION",
    ]);
  });

  it("adds OPEN_WRITING last on every third lesson", () => {
    expect(planExerciseMix(3, { hasGrammar: true }).at(-1)).toBe("OPEN_WRITING");
    expect(planExerciseMix(3, { hasGrammar: true })).toHaveLength(8);
    expect(planExerciseMix(6, { hasGrammar: true }).at(-1)).toBe("OPEN_WRITING");
    expect(planExerciseMix(4, { hasGrammar: true })).toHaveLength(7);
  });

  it("without a grammar focus swaps ERROR_CORRECTION for the other vocab type", () => {
    const odd = planExerciseMix(1, { hasGrammar: false });
    expect(odd).not.toContain("ERROR_CORRECTION");
    expect(odd).toContain("MATCH");
    expect(odd).toContain("WORD_BANK");
    expect(odd).toHaveLength(7);
  });

  it("is deterministic and never repeats a type", () => {
    for (let n = 1; n <= 12; n++) {
      const mix = planExerciseMix(n, { hasGrammar: true });
      expect(planExerciseMix(n, { hasGrammar: true })).toEqual(mix);
      expect(new Set(mix).size).toBe(mix.length);
    }
  });
});
