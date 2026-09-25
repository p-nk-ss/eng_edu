// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "../lesson/fixtures";
import { nextVocabState, vocabOutcomes, withoutCredited } from "./answerZone";

const ok = { isCorrect: true, parts: [{ correct: true, given: "", expected: "" }] };
const bad = { isCorrect: false, parts: [{ correct: false, given: "", expected: "" }] };
const TRANSLATION = E.TRANSLATION as Extract<ExerciseContent, { type: "translation" }>;

describe("vocabOutcomes", () => {
  it("gives no credit to a word that is only in the prompt, not in the answer", () => {
    // MCQ fixture lists v1 (deadline) but the keyed option is "had finished"
    expect(vocabOutcomes(E.MULTIPLE_CHOICE, ok, FIXTURE_VOCAB)).toEqual([]);
  });

  it("credits a word in the reference of a translation with the exercise verdict", () => {
    // given carries the headword (F3: credit needs the learner's own text to contain it).
    const withVerdict = (isCorrect: boolean) => ({ isCorrect, parts: [{ correct: isCorrect, given: TRANSLATION.reference, expected: TRANSLATION.reference }] });
    expect(vocabOutcomes(E.TRANSLATION, withVerdict(true), FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: true }]);
    expect(vocabOutcomes(E.TRANSLATION, withVerdict(false), FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: false }]);
  });

  it("credits a match word with the verdict of its own pair", () => {
    const parts = (c: boolean[]) => ({ isCorrect: c.every(Boolean), parts: c.map((correct) => ({ correct, given: "", expected: "" })) });
    expect(vocabOutcomes(E.MATCH, parts([false, false, true]), FIXTURE_VOCAB)).toEqual([{ id: "v2", correct: true }]);
    expect(vocabOutcomes(E.MATCH, parts([true, true, false]), FIXTURE_VOCAB)).toEqual([{ id: "v2", correct: false }]);
  });

  it("requires every zone of a word to be correct", () => {
    const cloze = {
      type: "cloze_mc",
      text: "The ___ is Friday and the second ___ is Monday.",
      gaps: [
        { options: ["deadline", "dead"], answer: 0 },
        { options: ["deadlines", "deadline"], answer: 1 },
      ],
      explain: "Deadline is a countable noun.",
      vocab: ["v1"],
    } as ExerciseContent;
    const judged = { isCorrect: false, parts: [{ correct: true, given: "", expected: "" }, { correct: false, given: "", expected: "" }] };
    expect(vocabOutcomes(cloze, judged, FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: false }]);
  });

  it("gives no credit for open writing and ignores unknown ids", () => {
    expect(vocabOutcomes(E.OPEN_WRITING, ok, FIXTURE_VOCAB)).toEqual([]);
    expect(vocabOutcomes({ ...E.TRANSLATION, vocab: ["ghost"] } as ExerciseContent, ok, FIXTURE_VOCAB)).toEqual([]);
  });

  it("credits only words the learner actually produced in a typed/free-text zone", () => {
    const cloze = {
      type: "open_cloze",
      text: "It was a ___ situation.",
      gaps: [{ accept: ["deadline"] }],
      explain: "x",
      vocab: ["v1"],
    } as ExerciseContent;
    const correctGap = (given: string) => ({ isCorrect: true, parts: [{ correct: true, given, expected: "deadline" }] });

    // Jev accepted a synonym: the zone is correct, but the learner never typed "deadline".
    expect(vocabOutcomes(cloze, correctGap("due date"), FIXTURE_VOCAB)).toEqual([]);
    // The learner typed the keyed word itself: credited correct.
    expect(vocabOutcomes(cloze, correctGap("deadline"), FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: true }]);
    // A wrong verdict is unchanged regardless of the learner's text.
    const wrongGap = { isCorrect: false, parts: [{ correct: false, given: "due date", expected: "deadline" }] };
    expect(vocabOutcomes(cloze, wrongGap, FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: false }]);
  });

  it("credits a translation only when the learner's own answer contains the headword", () => {
    const correct = (given: string) => ({ isCorrect: true, parts: [{ correct: true, given, expected: TRANSLATION.reference }] });
    // Accepted paraphrase without the headword: no credit either way.
    expect(vocabOutcomes(E.TRANSLATION, correct("I finished the report before the due date."), FIXTURE_VOCAB)).toEqual([]);
    // The headword is present: credited correct.
    expect(vocabOutcomes(E.TRANSLATION, correct("I finished the report before the deadline."), FIXTURE_VOCAB)).toEqual([
      { id: "v1", correct: true },
    ]);
  });

  it("dedupes repeated vocab ids into one outcome", () => {
    const judged = { isCorrect: true, parts: [{ correct: true, given: TRANSLATION.reference, expected: TRANSLATION.reference }] };
    expect(vocabOutcomes({ ...E.TRANSLATION, vocab: ["v1", "v1"] } as ExerciseContent, judged, FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: true }]);
  });
});

describe("nextVocabState", () => {
  it("moves toward KNOWN on correct answers", () => {
    expect(nextVocabState({ status: "NEW", correctStreak: 0 }, true)).toEqual({ status: "LEARNING", correctStreak: 1 });
    expect(nextVocabState({ status: "LEARNING", correctStreak: 2 }, true)).toEqual({ status: "KNOWN", correctStreak: 3 });
    expect(nextVocabState({ status: "KNOWN", correctStreak: 3 }, true)).toEqual({ status: "KNOWN", correctStreak: 4 });
  });
  it("resets the streak and demotes KNOWN on a wrong answer", () => {
    expect(nextVocabState({ status: "KNOWN", correctStreak: 4 }, false)).toEqual({ status: "LEARNING", correctStreak: 0 });
    expect(nextVocabState({ status: "SEEN", correctStreak: 0 }, false)).toEqual({ status: "LEARNING", correctStreak: 0 });
  });
});

describe("withoutCredited", () => {
  it("drops words already credited in this lesson", () => {
    expect(withoutCredited([{ id: "v1", correct: true }, { id: "v2", correct: false }], new Set(["v1"]))).toEqual([{ id: "v2", correct: false }]);
  });
});
