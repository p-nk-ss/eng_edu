import { z } from "zod";
import type { TranslationFeedback } from "../grading/types";
import type { CompleteArgs } from "../llm/types";

export const TRANSLATION_FEEDBACK_LIMITS = {
  corrected: { min: 1, max: 300 },
  explanation: { min: 10, max: 400 },
} as const;
const L = TRANSLATION_FEEDBACK_LIMITS;

export const TRANSLATION_CATEGORIES = ["none", "grammar", "vocabulary", "word_order", "spelling", "meaning"] as const;

export const translationFeedbackSchema: z.ZodType<TranslationFeedback> = z.object({
  isCorrect: z.boolean(),
  corrected: z.string().min(L.corrected.min).max(L.corrected.max),
  explanation: z.string().min(L.explanation.min).max(L.explanation.max),
  category: z.enum(TRANSLATION_CATEGORIES),
  relatesToFocus: z.boolean(),
});

export interface TranslationFeedbackInput {
  source: string;
  reference: string;
  answer: string;
  jevCategory: string | null;
  grammar: { title: string; description: string } | null;
  level: string;
}

const SYSTEM = [
  "You are an experienced, encouraging English teacher checking one translation written by an adult Russian-speaking learner.",
  "Decide whether `learner_answer` is a fully correct, natural English translation of `source_ru`. `reference_en` is ONE correct translation - accept any other correct, natural wording (paraphrases, synonyms, contractions, British or American spelling).",
  "If it is correct: isCorrect true, corrected = the learner answer unchanged, category \"none\", explanation = one sentence on what was done well.",
  `If it is wrong: isCorrect false; corrected = the learner's own sentence with the MINIMAL edits that make it correct (not the reference; ${L.corrected.min}-${L.corrected.max} characters); explanation = what was wrong and why, in simple English for the learner's CEFR level (${L.explanation.min}-${L.explanation.max} characters); category = the most important problem.`,
  `Categories: ${TRANSLATION_CATEGORIES.map((c) => `"${c}"`).join(", ")}.`,
  "relatesToFocus: true only when the main problem is about `grammar_focus` (false when grammar_focus is null).",
  "`jev_category` is a hint from an automatic classifier and may be wrong.",
  'Return ONLY a JSON object: {"isCorrect":true|false,"corrected":"...","explanation":"...","category":"...","relatesToFocus":true|false}. No prose, no markdown fences.',
].join("\n");

/** Translation check (role `translation_check`). Response: translationFeedbackSchema. */
export function translationFeedbackPrompt(input: TranslationFeedbackInput): CompleteArgs {
  const payload = {
    source_ru: input.source,
    reference_en: input.reference,
    learner_answer: input.answer,
    jev_category: input.jevCategory,
    grammar_focus: input.grammar,
    level: input.level,
  };
  return { system: SYSTEM, messages: [{ role: "user", content: "Check this translation.\n" + JSON.stringify(payload, null, 2) }] };
}
