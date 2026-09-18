// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EXERCISE_TYPES, EXERCISE_TYPE_TAGS, parseExercise, typeForTag } from "./exerciseSchemas";
import { VALID_EXERCISES } from "./fixtures";

describe("exercise schemas", () => {
  it("maps all 10 exercise types to unique tags and back", () => {
    expect(EXERCISE_TYPES).toHaveLength(10);
    expect(new Set(Object.values(EXERCISE_TYPE_TAGS)).size).toBe(10);
    for (const t of EXERCISE_TYPES) expect(typeForTag(EXERCISE_TYPE_TAGS[t])).toBe(t);
    expect(typeForTag("nope")).toBeUndefined();
  });

  it.each(EXERCISE_TYPES)("accepts the valid %s fixture and reports its type", (t) => {
    const res = parseExercise(VALID_EXERCISES[t]);
    expect(res).toMatchObject({ ok: true, type: t });
  });

  it("defaults vocab to an empty array", () => {
    const { vocab, ...noVocab } = VALID_EXERCISES.MULTIPLE_CHOICE;
    const res = parseExercise(noVocab);
    expect(res.ok && res.content.vocab).toEqual([]);
  });

  it("rejects an unknown tag, naming it", () => {
    const res = parseExercise({ ...VALID_EXERCISES.MATCH, type: "crossword" });
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.reason).toMatch(/type/);
  });

  it("rejects non-objects", () => {
    expect(parseExercise("mcq").ok).toBe(false);
    expect(parseExercise(null).ok).toBe(false);
  });

  it("rejects structurally broken content with the offending field in the reason", () => {
    const cases: [string, unknown][] = [
      ["options", { ...VALID_EXERCISES.MULTIPLE_CHOICE, options: ["only", "two"] }],
      ["answer", { ...VALID_EXERCISES.MULTIPLE_CHOICE, answer: "1" }],
      ["explain", { ...VALID_EXERCISES.FILL_BLANK, explain: "short" }],
      ["accept", { ...VALID_EXERCISES.FILL_BLANK, gaps: [{ accept: [] }] }],
      ["accept", { ...VALID_EXERCISES.DICTATION, accept: [] }],
      ["left", { ...VALID_EXERCISES.MATCH, left: ["a", "b"] }],
      ["reference", { ...VALID_EXERCISES.TRANSLATION, reference: "" }],
      ["minWords", { ...VALID_EXERCISES.OPEN_WRITING, minWords: 5 }],
    ];
    for (const [field, raw] of cases) {
      const res = parseExercise(raw);
      expect(res.ok, field).toBe(false);
      expect(!res.ok && res.reason, field).toContain(field);
    }
  });
});
