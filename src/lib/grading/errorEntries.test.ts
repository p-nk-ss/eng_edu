// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "../lesson/fixtures";
import { errorEntries } from "./errorEntries";
import type { JudgeOutcome, WritingCorrection } from "./types";

const grammar = { id: "g1", title: "Past Perfect (had done)", description: "had + past participle" };
const wrong = (given: string, expected: string): JudgeOutcome => ({ isCorrect: false, parts: [{ correct: false, given, expected }], gradedBy: "local" });

describe("errorEntries", () => {
  it("returns nothing for a correct answer", () => {
    expect(errorEntries(E.MULTIPLE_CHOICE, { isCorrect: true, parts: [], gradedBy: "local" }, grammar, FIXTURE_VOCAB)).toEqual([]);
  });

  it("attributes a wrong grammar exercise to the lesson focus", () => {
    expect(errorEntries(E.MULTIPLE_CHOICE, wrong("finishing", "had finished"), grammar, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: "g1", category: "Past Perfect (had done)", source: "EXERCISE", example: "finishing -> had finished" },
    ]);
  });

  it("uses answer-zone words, then 'general', in a lesson without grammar", () => {
    const cloze = {
      type: "cloze_mc", text: "The ___ is on Friday.", gaps: [{ options: ["deadline", "dead"], answer: 0 }],
      explain: "Deadline is the noun.", vocab: ["v1"],
    } as ExerciseContent;
    expect(errorEntries(cloze, wrong("dead", "deadline"), null, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: null, category: "vocab: deadline", source: "EXERCISE", example: "dead -> deadline" },
    ]);
    expect(errorEntries(E.MULTIPLE_CHOICE, wrong("finishing", "had finished"), null, FIXTURE_VOCAB)[0].category).toBe("general");
  });

  it("gives each wrong match pair its own vocab cause", () => {
    const judged: JudgeOutcome = {
      isCorrect: false, gradedBy: "local",
      parts: [
        { correct: true, given: "frankly = to be honest", expected: "frankly = to be honest" },
        { correct: false, given: "broke = a person you work with", expected: "broke = with no money" },
        { correct: false, given: "colleague = with no money", expected: "colleague = a person you work with" },
      ],
    };
    expect(errorEntries(E.MATCH, judged, grammar, FIXTURE_VOCAB).map((e) => e.category)).toEqual(["vocab: broke", "vocab: colleague"]);
  });

  it("files dictation under listening/spelling", () => {
    expect(errorEntries(E.DICTATION, wrong("I'd like a cofee", "I'd like a coffee, please."), grammar, FIXTURE_VOCAB)[0].category).toBe("listening/spelling");
  });

  it("uses the Claude category for a translation, or the focus when it relates to it", () => {
    const tr = (relatesToFocus: boolean): JudgeOutcome => ({
      ...wrong("I finished report", "I finished the report before the deadline."), gradedBy: "claude",
      translation: { isCorrect: false, corrected: "I finished the report", explanation: "Use the article.", category: "word_order", relatesToFocus },
    });
    expect(errorEntries(E.TRANSLATION, tr(false), grammar, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: null, category: "translation: word order", source: "EXERCISE", example: "I finished report -> I finished the report" },
    ]);
    expect(errorEntries(E.TRANSLATION, tr(true), grammar, FIXTURE_VOCAB)[0].grammarTopicId).toBe("g1");
  });

  it("records only major writing corrections, one entry per cause", () => {
    const k = (over: Partial<WritingCorrection>): WritingCorrection => ({ original: "I miss", corrected: "I missed", explanation: "Past simple here.", category: "grammar", severity: "major", relatesToFocus: false, ...over });
    const judged: JudgeOutcome = {
      isCorrect: false, parts: [{ correct: false, given: "text", expected: "" }], gradedBy: "claude",
      writing: { summary: "Some tense errors.", wordCount: 70, corrections: [k({}), k({ original: "he go", corrected: "he went" }), k({ severity: "minor", category: "style" })] },
    };
    expect(errorEntries(E.OPEN_WRITING, judged, grammar, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: null, category: "writing: grammar", source: "WRITING", example: "I miss -> I missed" },
    ]);
  });

  it("clips long examples", () => {
    const e = errorEntries(E.MULTIPLE_CHOICE, wrong("x".repeat(300), "y"), grammar, FIXTURE_VOCAB)[0];
    expect(e.example.length).toBeLessThanOrEqual(200);
  });
});
