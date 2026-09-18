// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EXERCISE_TYPES, type ExerciseContent } from "./exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES } from "./fixtures";
import { checkExercise, headwordOccurs, normalizeAnswer, normalizeLoose } from "./exerciseChecks";

const ctx = { vocab: FIXTURE_VOCAB };
const broken = (base: ExerciseContent, patch: Record<string, unknown>) => ({ ...base, ...patch }) as ExerciseContent;

describe("normalizeAnswer", () => {
  it("trims, collapses whitespace, lowercases, strips edge punctuation, straightens quotes", () => {
    expect(normalizeAnswer("  Doesn't   LIKE  ")).toBe("doesn't like");
    expect(normalizeAnswer("“Hello, world!”")).toBe("hello, world");
    expect(normalizeAnswer("...")).toBe("");
  });
  it("loose form also drops inner punctuation but keeps apostrophes", () => {
    expect(normalizeLoose("I'd like a coffee, please.")).toBe("i'd like a coffee please");
  });
});

describe("headwordOccurs", () => {
  it("tolerates inflection via a stem prefix", () => {
    expect(headwordOccurs("make", "She is making tea")).toBe(true);
    expect(headwordOccurs("study", "He studied hard")).toBe(true);
    expect(headwordOccurs("deadline", "Two deadlines passed")).toBe(true);
    expect(headwordOccurs("deadline", "We were on time")).toBe(false);
  });
  it("handles multi-word headwords, slash alternatives and hyphens", () => {
    expect(headwordOccurs("bank account", "I opened two bank accounts")).toBe(true);
    expect(headwordOccurs("bank account", "The account at the bank")).toBe(false);
    expect(headwordOccurs("adviser/advisor", "My advisor agreed")).toBe(true);
    expect(headwordOccurs("CD-ROM", "an old cd-rom drive")).toBe(true);
  });
});

describe("checkExercise", () => {
  it.each(EXERCISE_TYPES)("finds no problem in the valid %s fixture", (t) => {
    expect(checkExercise(VALID_EXERCISES[t], ctx)).toEqual([]);
  });

  it("flags answer indexes out of range and mismatched rationales", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { answer: 9 }), ctx).join()).toMatch(/answer/);
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { rationales: ["one"] }), ctx).join()).toMatch(/rationales/);
    expect(checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { answer: 2 }), ctx).join()).toMatch(/answer/);
    expect(
      checkExercise(broken(VALID_EXERCISES.CLOZE_DROPDOWN, { gaps: [{ options: ["a", "b"], answer: 5 }, { options: ["a", "b"], answer: 0 }] }), ctx).join(),
    ).toMatch(/gap 1.*answer/);
  });

  it("requires the number of ___ markers to equal the number of gaps", () => {
    expect(checkExercise(broken(VALID_EXERCISES.CLOZE_DROPDOWN, { text: "Only ___ here." }), ctx).join()).toMatch(/___/);
    expect(checkExercise(broken(VALID_EXERCISES.FILL_BLANK, { text: "No gap at all." }), ctx).join()).toMatch(/___/);
    expect(checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { turns: ["A: Hi.", "B: Hello."] }), ctx).join()).toMatch(/___/);
  });

  it("checks that word-bank answers can be built from the tokens", () => {
    expect(checkExercise(broken(VALID_EXERCISES.WORD_BANK, { answer: ["I", "went", "to", "work"] }), ctx).join()).toMatch(/went/);
    expect(checkExercise(broken(VALID_EXERCISES.WORD_BANK, { accept_alt: [["to", "to", "I", "go"]] }), ctx).join()).toMatch(/accept_alt/);
  });

  it("requires match answers to be a permutation of the right column", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MATCH, { answer: [0, 0, 1] }), ctx).join()).toMatch(/permutation/);
    expect(checkExercise(broken(VALID_EXERCISES.MATCH, { right: ["a", "b"] }), ctx).join()).toMatch(/length/);
  });

  it("rejects an error-correction fix that equals the wrong token, and a bad index", () => {
    expect(checkExercise(broken(VALID_EXERCISES.ERROR_CORRECTION, { accept: ["Don't"] }), ctx).join()).toMatch(/same as the wrong token/);
    expect(checkExercise(broken(VALID_EXERCISES.ERROR_CORRECTION, { answer: 7 }), ctx).join()).toMatch(/answer/);
  });

  it("requires the dictation sentence to be accepted under loose normalization", () => {
    expect(checkExercise(broken(VALID_EXERCISES.DICTATION, { accept: ["i want a coffee"] }), ctx).join()).toMatch(/tts/);
  });

  it("rejects accept entries that normalize to nothing", () => {
    expect(checkExercise(broken(VALID_EXERCISES.FILL_BLANK, { gaps: [{ accept: ["..."] }] }), ctx).join()).toMatch(/empty/);
  });

  it("validates vocab ids and that the headword really appears", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["ghost"] }), ctx).join()).toMatch(/ghost/);
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["v2"] }), ctx).join()).toMatch(/colleague/);
  });
});
