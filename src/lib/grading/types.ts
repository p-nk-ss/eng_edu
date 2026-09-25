import type { ExerciseContent } from "../lesson/exerciseSchemas";

export type ExerciseTag = ExerciseContent["type"];
export type ContentOf<T extends ExerciseTag> = Extract<ExerciseContent, { type: T }>;

/** A parsed learner answer, tagged with its exercise type. */
export type Answer =
  | { type: "mcq"; selected: number }
  | { type: "dialogue_gap"; selected: number }
  | { type: "cloze_mc"; selected: number[] }
  | { type: "open_cloze"; text: string[] }
  | { type: "word_bank"; tokens: string[] }
  | { type: "match"; pairs: number[] }
  | { type: "dictation"; text: string }
  | { type: "translation"; text: string }
  | { type: "open_writing"; text: string }
  | { type: "error_correct"; index: number; fix: string };
export type AnswerOf<T extends ExerciseTag> = Extract<Answer, { type: T }>;

/** One gradable part: a gap, a pair, or the whole exercise. */
export interface GradePart {
  correct: boolean;
  given: string;
  expected: string;
}

/** A typed part that failed normalization but may be an equally correct variant (asked to Jev). */
export interface VariantCandidate {
  part: number;
  kind: "gap" | "sentence";
  given: string;
  expected: string[];
  /** "gap": the sentence with this part as ___ ; "sentence": the spoken sentence (dictation). */
  context: string;
}

export interface LocalGrade {
  isCorrect: boolean;
  parts: GradePart[];
  correctAnswer: string;
  variantCandidates: VariantCandidate[];
  needsJudge: "translation" | "writing" | null;
}

export type TranslationCategory = "none" | "grammar" | "vocabulary" | "word_order" | "spelling" | "meaning";
export interface TranslationFeedback {
  isCorrect: boolean;
  corrected: string;
  explanation: string;
  category: TranslationCategory;
  relatesToFocus: boolean;
}

export type WritingCategory = "grammar" | "vocabulary" | "word_order" | "spelling" | "punctuation" | "style";
export interface WritingCorrection {
  original: string;
  corrected: string;
  explanation: string;
  category: WritingCategory;
  severity: "minor" | "moderate" | "major";
  relatesToFocus: boolean;
}
export interface WritingFeedback {
  summary: string;
  corrections: WritingCorrection[];
}

export type GradedBy = "local" | "jev" | "claude";

export interface JudgeOutcome {
  isCorrect: boolean;
  parts: GradePart[];
  gradedBy: GradedBy;
  translation?: TranslationFeedback;
  writing?: WritingFeedback & { wordCount: number };
  jevScores?: Record<string, number>;
}

export interface VocabOutcome {
  id: string;
  correct: boolean;
}

export interface ErrorEntry {
  grammarTopicId: string | null;
  category: string;
  source: "EXERCISE" | "WRITING";
  example: string;
}

export interface GradeFeedback {
  corrected?: string;
  explanation?: string;
  category?: string;
  summary?: string;
  corrections?: WritingCorrection[];
  wordCount?: number;
}

/** Stored in Exercise.result and returned by the route. */
export interface GradeResult {
  version: 1;
  exerciseId: string;
  isCorrect: boolean;
  parts: GradePart[];
  correctAnswer: string;
  explain: string;
  feedback: GradeFeedback | null;
  gradedBy: GradedBy;
  vocabCredit: VocabOutcome[];
  jevScores?: Record<string, number>;
  /** MCQ only: per-option rationales, revealed after grading (never part of the pre-answer view). */
  rationales?: string[];
}

export interface LessonGrammar {
  id: string;
  title: string;
  description: string;
}
