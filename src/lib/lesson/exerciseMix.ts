import type { ExerciseTypeName } from "./exerciseSchemas";

/**
 * Code decides WHICH exercise types a lesson has (recognition -> scaffolded production -> free
 * production); Claude only writes their content. Pure and deterministic.
 */
export function planExerciseMix(lessonNumber: number, opts: { hasGrammar: boolean }): ExerciseTypeName[] {
  const odd = lessonNumber % 2 === 1;
  const vocabType: ExerciseTypeName = odd ? "MATCH" : "WORD_BANK";
  const otherVocabType: ExerciseTypeName = odd ? "WORD_BANK" : "MATCH";
  const mix: ExerciseTypeName[] = [
    "MULTIPLE_CHOICE",
    "CLOZE_DROPDOWN",
    "FILL_BLANK",
    opts.hasGrammar ? "ERROR_CORRECTION" : otherVocabType,
    vocabType,
    odd ? "DIALOGUE_GAP" : "DICTATION",
    "TRANSLATION",
  ];
  if (lessonNumber % 3 === 0) mix.push("OPEN_WRITING");
  return mix;
}
