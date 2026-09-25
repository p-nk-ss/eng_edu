import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import type { LessonPlan } from "../lesson/createLesson";
import { parseExercise } from "../lesson/exerciseSchemas";
import { parseAnswer } from "./answerSchemas";
import { vocabOutcomes } from "./answerZone";
import { errorEntries } from "./errorEntries";
import { gradeLocally } from "./graders";
import { runJudge, type JudgeDeps } from "./judge";
import { recordAnswer } from "./recordAnswer";
import type { GradeFeedback, GradeResult, JudgeOutcome, LessonGrammar, VocabOutcome } from "./types";

export class ExerciseNotFoundError extends Error {
  constructor(id: string) {
    super(`Exercise ${id} not found`);
    this.name = "ExerciseNotFoundError";
  }
}

export class InvalidAnswerError extends Error {
  constructor(reason: string) {
    super(`Invalid answer: ${reason}`);
    this.name = "InvalidAnswerError";
  }
}

export type CheckAnswerDb = Pick<PrismaClient, "exercise" | "grammarTopic" | "vocabItem" | "profile" | "$transaction">;

export interface CheckDeps {
  db?: CheckAnswerDb;
  judge: JudgeDeps;
  now?: Date;
  /** Grade without reading answeredAt and without writing (acceptance tool). */
  dryRun?: boolean;
}

export type CheckResult = GradeResult & { alreadyAnswered: boolean };

const inFlight = new Map<string, Promise<CheckResult>>();

/** POST /api/exercise/check. One attempt per exercise; concurrent submits share one grading. */
export function checkAnswer(exerciseId: string, raw: unknown, deps: CheckDeps): Promise<CheckResult> {
  if (deps.dryRun) return runCheck(exerciseId, raw, deps);
  const running = inFlight.get(exerciseId);
  if (running) return running;
  const p = runCheck(exerciseId, raw, deps).finally(() => inFlight.delete(exerciseId));
  inFlight.set(exerciseId, p);
  return p;
}

export function buildResult(
  exerciseId: string,
  explain: string,
  correctAnswer: string,
  judged: JudgeOutcome,
  vocabCredit: VocabOutcome[],
  rationales?: string[],
): GradeResult {
  let feedback: GradeFeedback | null = null;
  if (judged.translation) {
    feedback = { corrected: judged.translation.corrected, explanation: judged.translation.explanation, category: judged.translation.category };
  }
  if (judged.writing) {
    feedback = { summary: judged.writing.summary, corrections: judged.writing.corrections, wordCount: judged.writing.wordCount };
  }
  return {
    version: 1, exerciseId, isCorrect: judged.isCorrect, parts: judged.parts, correctAnswer, explain, feedback,
    gradedBy: judged.gradedBy, vocabCredit, ...(judged.jevScores ? { jevScores: judged.jevScores } : {}),
    ...(rationales ? { rationales } : {}),
  };
}

async function runCheck(exerciseId: string, raw: unknown, deps: CheckDeps): Promise<CheckResult> {
  const db = deps.db ?? (prisma as unknown as CheckAnswerDb);
  const now = deps.now ?? new Date();

  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { id: true, lessonId: true, content: true, answeredAt: true, result: true, lesson: { select: { plan: true } } },
  });
  if (!ex) throw new ExerciseNotFoundError(exerciseId);
  if (ex.answeredAt && !deps.dryRun) return { ...(ex.result as unknown as GradeResult), alreadyAnswered: true };

  const parsed = parseExercise(ex.content);
  if (!parsed.ok) throw new Error(`Stored exercise ${exerciseId} is invalid: ${parsed.reason}`);
  const content = parsed.content;
  const ans = parseAnswer(content, raw);
  if (!ans.ok) throw new InvalidAnswerError(ans.reason);

  const grammarTopicId = (ex.lesson.plan as unknown as LessonPlan | null)?.meta?.grammarTopicId ?? null;
  const grammar = await loadGrammar(db, grammarTopicId);
  const profile = await db.profile.findFirst({ orderBy: { updatedAt: "desc" }, select: { level: true } });
  const vocab = content.vocab.length
    ? await db.vocabItem.findMany({ where: { id: { in: content.vocab } }, select: { id: true, headword: true } })
    : [];

  const local = gradeLocally(content, ans.answer);
  const judged = await runJudge(content, ans.answer, local, { grammar, level: profile?.level ?? "B1" }, deps.judge);
  const result = buildResult(
    exerciseId, content.explain, local.correctAnswer, judged, vocabOutcomes(content, judged, vocab),
    content.type === "mcq" ? content.rationales : undefined,
  );
  if (deps.dryRun) return { ...result, alreadyAnswered: false };

  const outcome = await recordAnswer(db, {
    exerciseId, lessonId: ex.lessonId, answer: ans.answer, result, vocab: result.vocabCredit,
    errors: errorEntries(content, judged, grammar, vocab), now,
  });
  if (!outcome.recorded) {
    const stored = await db.exercise.findUnique({ where: { id: exerciseId }, select: { result: true } });
    return { ...(stored?.result as unknown as GradeResult), alreadyAnswered: true };
  }
  return { ...outcome.result, alreadyAnswered: false };
}

async function loadGrammar(db: CheckAnswerDb, id: string | null): Promise<LessonGrammar | null> {
  if (!id) return null;
  const t = await db.grammarTopic.findUnique({ where: { id }, select: { id: true, name: true, title: true, description: true } });
  return t ? { id: t.id, title: t.title ?? t.name, description: t.description ?? "" } : null;
}
