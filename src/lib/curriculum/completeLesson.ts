import type { Prisma } from "@prisma/client";
import type { LessonPlan } from "../lesson/createLesson";
import { parseExercise } from "../lesson/exerciseSchemas";
import { isBelowLevel } from "../lesson/levels";
import { nextTopicState, writtenBlockScore, type TopicStatusName } from "./advancement";

export type CompletionTx = Pick<Prisma.TransactionClient, "lesson" | "exercise" | "grammarTopic" | "profile">;

const NOT_DONE = { completed: false, score: null } as const;

/**
 * Called inside the answer transaction after an answer is recorded. When every playable written
 * exercise is answered, stores the score once (conditional update) and recomputes the focus topic.
 */
export async function completeWrittenBlockIfDone(
  tx: CompletionTx,
  lessonId: string,
  completedAt: Date,
): Promise<{ completed: boolean; score: number | null }> {
  const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { plan: true, writtenCompletedAt: true } });
  if (!lesson || lesson.writtenCompletedAt) return NOT_DONE;
  const plan = lesson.plan as unknown as Partial<LessonPlan> | null;
  const ids = plan?.sections?.written?.exerciseIds ?? [];
  if (ids.length === 0) return NOT_DONE;

  const rows = await tx.exercise.findMany({
    where: { lessonId, id: { in: ids } },
    select: { content: true, answeredAt: true, isCorrect: true },
  });
  const items = rows
    .filter((r) => parseExercise(r.content).ok)
    .map((r) => ({ answered: r.answeredAt !== null, correct: r.isCorrect }));
  const { complete, score } = writtenBlockScore(items);
  if (!complete || score === null) return NOT_DONE;

  const updated = await tx.lesson.updateMany({
    where: { id: lessonId, writtenCompletedAt: null },
    data: { writtenScore: score, writtenCompletedAt: completedAt },
  });
  if (updated.count === 0) return NOT_DONE;

  const topicId = plan?.meta?.grammarTopicId ?? null;
  if (topicId) await recomputeTopic(tx, topicId);
  return { completed: true, score };
}

/** Re-derives the topic's status and cached counters from the history of completed lessons. */
export async function recomputeTopic(tx: CompletionTx, topicId: string): Promise<void> {
  const topic = await tx.grammarTopic.findUnique({ where: { id: topicId }, select: { status: true, cefrLevel: true, importance: true } });
  if (!topic) return;
  const profile = await tx.profile.findFirst({ orderBy: { updatedAt: "desc" }, select: { level: true } });
  const lessons = await tx.lesson.findMany({
    where: { writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: topicId } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { writtenScore: true },
  });
  const scores = lessons.flatMap((l) => (l.writtenScore === null ? [] : [l.writtenScore]));
  const belowLevelCore = topic.importance === 1 && profile !== null && isBelowLevel(topic.cefrLevel, profile.level);
  const next = nextTopicState(topic.status as TopicStatusName, scores, { belowLevelCore });
  await tx.grammarTopic.update({ where: { id: topicId }, data: next });
}
