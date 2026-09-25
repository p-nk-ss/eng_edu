import { z } from "zod";
import type { WritingFeedback } from "../grading/types";
import type { CompleteArgs } from "../llm/types";

export const WRITING_FEEDBACK_LIMITS = {
  summary: { min: 20, max: 400 },
  original: { min: 1, max: 200 },
  corrected: { min: 1, max: 200 },
  explanation: { min: 10, max: 300 },
  corrections: { max: 15 },
} as const;
const L = WRITING_FEEDBACK_LIMITS;

export const WRITING_CATEGORIES = ["grammar", "vocabulary", "word_order", "spelling", "punctuation", "style"] as const;
export const SEVERITIES = ["minor", "moderate", "major"] as const;

export const writingFeedbackSchema: z.ZodType<WritingFeedback> = z.object({
  summary: z.string().min(L.summary.min).max(L.summary.max),
  corrections: z
    .array(
      z.object({
        original: z.string().min(L.original.min).max(L.original.max),
        corrected: z.string().min(L.corrected.min).max(L.corrected.max),
        explanation: z.string().min(L.explanation.min).max(L.explanation.max),
        category: z.enum(WRITING_CATEGORIES),
        severity: z.enum(SEVERITIES),
        relatesToFocus: z.boolean(),
      }),
    )
    .max(L.corrections.max),
});

export interface WritingFeedbackInput {
  prompt: string;
  text: string;
  minWords: number;
  grammar: { title: string; description: string } | null;
  level: string;
}

const SYSTEM = [
  "You are an experienced, encouraging English teacher giving feedback on a short text written by an adult Russian-speaking learner.",
  `List the errors in \`learner_text\` as corrections, most important first, at most ${L.corrections.max} corrections. For each: "original" = the wrong words copied verbatim from the text (${L.original.min}-${L.original.max} characters), "corrected" = the fixed words (${L.corrected.min}-${L.corrected.max} characters), "explanation" = why, in simple English for the learner's CEFR level (${L.explanation.min}-${L.explanation.max} characters), "category" (${WRITING_CATEGORIES.map((c) => `"${c}"`).join(", ")}), "severity" and "relatesToFocus".`,
  'Severity: "major" = an error that changes or blocks the meaning, or a basic grammar error for this CEFR level; "moderate" = a clear error that does not block understanding; "minor" = a small slip or an unnatural but understandable choice. Do not list mere style preferences.',
  "relatesToFocus: true only when the error is about `grammar_focus` (false when grammar_focus is null).",
  `"summary": 1-3 sentences of overall feedback on content and language (${L.summary.min}-${L.summary.max} characters). Do not judge the length - the app counts words itself.`,
  'Return ONLY a JSON object: {"summary":"...","corrections":[...]} (an empty array when there are no errors). No prose, no markdown fences.',
].join("\n");

/** Open-writing feedback (role `writing_feedback`). Response: writingFeedbackSchema. */
export function writingFeedbackPrompt(input: WritingFeedbackInput): CompleteArgs {
  const payload = { task: input.prompt, learner_text: input.text, min_words: input.minWords, grammar_focus: input.grammar, level: input.level };
  return { system: SYSTEM, messages: [{ role: "user", content: "Give feedback on this text.\n" + JSON.stringify(payload, null, 2) }] };
}
