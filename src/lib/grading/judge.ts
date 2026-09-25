import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { CompleteArgs } from "../llm/types";
import { translationFeedbackPrompt } from "../prompts/translationFeedback";
import { TRANSLATION_ACCEPT, translationRequest } from "../prompts/translationJudge";
import { VARIANT_ACCEPT, variantRequest } from "../prompts/variantGate";
import { writingFeedbackPrompt } from "../prompts/writingFeedback";
import type { TypeSafeClient } from "../typesafe/client";
import type {
  Answer, AnswerOf, ContentOf, JudgeOutcome, LessonGrammar, LocalGrade, TranslationFeedback, WritingFeedback,
} from "./types";

export class GradingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingUnavailableError";
  }
}

export interface JudgeDeps {
  /** Lazily created; null when TypeSafe is not configured. */
  jev: () => TypeSafeClient | null;
  askTranslation: (args: CompleteArgs) => Promise<TranslationFeedback>;
  askWriting: (args: CompleteArgs) => Promise<WritingFeedback>;
}

export interface JudgeContext {
  grammar: LessonGrammar | null;
  level: string;
}

export const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

const focusOf = (g: LessonGrammar | null) => (g ? { title: g.title, description: g.description } : null);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Final verdict. Jev problems never fail grading; Claude problems raise GradingUnavailableError. */
export async function runJudge(
  content: ExerciseContent,
  answer: Answer,
  local: LocalGrade,
  ctx: JudgeContext,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  if (local.needsJudge === "translation") return judgeTranslation(content as ContentOf<"translation">, answer as AnswerOf<"translation">, ctx, deps);
  if (local.needsJudge === "writing") return judgeWriting(content as ContentOf<"open_writing">, answer as AnswerOf<"open_writing">, ctx, deps);

  const base: JudgeOutcome = { isCorrect: local.isCorrect, parts: local.parts, gradedBy: "local" };
  if (local.variantCandidates.length === 0) return base;
  const jev = deps.jev();
  if (!jev) return base;

  const parts = local.parts.map((p) => ({ ...p }));
  const jevScores: Record<string, number> = {};
  for (const v of local.variantCandidates) {
    try {
      const res = await jev.systemOne(variantRequest(v));
      const score = res.answers.equivalent?.noul;
      if (typeof score !== "number") continue;
      jevScores[`variant_${v.part}`] = score;
      if (score >= VARIANT_ACCEPT) parts[v.part] = { ...parts[v.part], correct: true };
    } catch {
      // Jev is best effort: keep the strict local verdict for this part.
    }
  }
  if (Object.keys(jevScores).length === 0) return base;
  return { isCorrect: parts.every((p) => p.correct), parts, gradedBy: "jev", jevScores };
}

async function judgeTranslation(
  c: ContentOf<"translation">,
  a: AnswerOf<"translation">,
  ctx: JudgeContext,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  let jevCategory: string | null = null;
  let jevScores: Record<string, number> | undefined;
  const jev = deps.jev();
  if (jev) {
    try {
      const res = await jev.systemOne(translationRequest(c, a.text));
      const acceptable = res.answers.acceptable?.noul;
      const errorType = res.answers.error_type;
      if (typeof acceptable === "number") {
        jevScores = { acceptable, ...(errorType ? { error_type_confidence: errorType.confidence } : {}) };
        jevCategory = errorType?.choice ?? null;
        if (acceptable >= TRANSLATION_ACCEPT) {
          return { isCorrect: true, parts: [{ correct: true, given: a.text, expected: c.reference }], gradedBy: "jev", jevScores };
        }
      }
    } catch {
      // fall through to Claude
    }
  }

  let fb: TranslationFeedback;
  try {
    fb = await deps.askTranslation(
      translationFeedbackPrompt({ source: c.source, reference: c.reference, answer: a.text, jevCategory, grammar: focusOf(ctx.grammar), level: ctx.level }),
    );
  } catch (e) {
    throw new GradingUnavailableError(`Translation feedback failed: ${messageOf(e)}`);
  }
  return {
    isCorrect: fb.isCorrect,
    parts: [{ correct: fb.isCorrect, given: a.text, expected: c.reference }],
    gradedBy: "claude",
    translation: fb,
    ...(jevScores ? { jevScores } : {}),
  };
}

async function judgeWriting(
  c: ContentOf<"open_writing">,
  a: AnswerOf<"open_writing">,
  ctx: JudgeContext,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  let fb: WritingFeedback;
  try {
    fb = await deps.askWriting(writingFeedbackPrompt({ prompt: c.prompt, text: a.text, minWords: c.minWords, grammar: focusOf(ctx.grammar), level: ctx.level }));
  } catch (e) {
    throw new GradingUnavailableError(`Writing feedback failed: ${messageOf(e)}`);
  }
  const wordCount = countWords(a.text);
  const isCorrect = wordCount >= c.minWords && !fb.corrections.some((k) => k.severity === "major");
  return { isCorrect, parts: [{ correct: isCorrect, given: a.text, expected: "" }], gradedBy: "claude", writing: { ...fb, wordCount } };
}
