import { describe, it, expect } from "vitest";
import { summarizeSyllabus } from "./progress";

describe("summarizeSyllabus", () => {
  it("folds grammar/vocab rows into per-level counts, ordered A1..C2", () => {
    const grammar = [
      { cefrLevel: "A1", status: "MASTERED" },
      { cefrLevel: "A1", status: "NOT_STARTED" },
      { cefrLevel: "B1", status: "PRACTICING" },
    ];
    const vocab = [
      { cefrLevel: "A1", status: "KNOWN" },
      { cefrLevel: "A1", status: "NEW" },
      { cefrLevel: "B1", status: "KNOWN" },
    ];
    expect(summarizeSyllabus(grammar, vocab)).toEqual([
      { level: "A1", grammarTotal: 2, grammarMastered: 1, vocabTotal: 2, vocabKnown: 1 },
      { level: "B1", grammarTotal: 1, grammarMastered: 0, vocabTotal: 1, vocabKnown: 1 },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(summarizeSyllabus([], [])).toEqual([]);
  });
});
