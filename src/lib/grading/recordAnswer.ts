import type { Prisma, PrismaClient } from "@prisma/client";
import { nextVocabState, withoutCredited, type VocabStatusName } from "./answerZone";
import type { Answer, ErrorEntry, GradeResult, VocabOutcome } from "./types";

export type RecordAnswerDb = Pick<PrismaClient, "$transaction">;
export const MAX_EXAMPLES = 5;
const DAY_MS = 86_400_000;

export function appendExample(description: string, example: string): string {
  const lines = description.split("\n").filter(Boolean);
  lines.push(`- ${example}`);
  return lines.slice(-MAX_EXAMPLES).join("\n");
}

export function feedbackText(r: GradeResult): string {
  return r.feedback?.explanation ?? r.feedback?.summary ?? r.explain;
}

export interface RecordInput {
  exerciseId: string;
  lessonId: string;
  answer: Answer;
  result: GradeResult;
  vocab: VocabOutcome[];
  errors: ErrorEntry[];
  now: Date;
}

export type RecordOutcome = { recorded: true; result: GradeResult } | { recorded: false };

/** One transaction, sequential queries, no network. Writes the exercise only if it is still unanswered. */
export async function recordAnswer(db: RecordAnswerDb, input: RecordInput): Promise<RecordOutcome> {
  return db.$transaction(async (tx) => {
    const others = await tx.exercise.findMany({
      where: { lessonId: input.lessonId, answeredAt: { not: null }, NOT: { id: input.exerciseId } },
      select: { result: true },
    });
    const credited = new Set<string>();
    for (const o of others) {
      for (const v of (o.result as { vocabCredit?: VocabOutcome[] } | null)?.vocabCredit ?? []) credited.add(v.id);
    }
    const result: GradeResult = { ...input.result, vocabCredit: withoutCredited(input.vocab, credited) };
    const { type: _type, ...raw } = input.answer;

    const updated = await tx.exercise.updateMany({
      where: { id: input.exerciseId, answeredAt: null },
      data: {
        userAnswer: JSON.stringify(raw),
        isCorrect: result.isCorrect,
        feedback: feedbackText(result),
        result: result as unknown as Prisma.InputJsonValue,
        answeredAt: input.now,
      },
    });
    if (updated.count === 0) return { recorded: false } as const;

    await tx.lesson.updateMany({ where: { id: input.lessonId, status: "PLANNED" }, data: { status: "IN_PROGRESS" } });

    for (const v of result.vocabCredit) {
      const row = await tx.vocabItem.findUnique({ where: { id: v.id }, select: { status: true, correctStreak: true } });
      if (!row) continue;
      const next = nextVocabState({ status: row.status as VocabStatusName, correctStreak: row.correctStreak }, v.correct);
      await tx.vocabItem.update({ where: { id: v.id }, data: { ...next, lastSeenAt: input.now } });
    }

    for (const e of input.errors) {
      const existing = await tx.errorRecord.findFirst({
        where: { lessonId: input.lessonId, grammarTopicId: e.grammarTopicId, category: e.category },
        select: { id: true, description: true },
      });
      if (existing) {
        await tx.errorRecord.update({ where: { id: existing.id }, data: { description: appendExample(existing.description, e.example) } });
      } else {
        await tx.errorRecord.create({
          data: {
            lessonId: input.lessonId, grammarTopicId: e.grammarTopicId, category: e.category,
            description: appendExample("", e.example), source: e.source, status: "NEW",
            nextReviewAt: new Date(input.now.getTime() + DAY_MS),
          },
        });
      }
    }
    return { recorded: true, result } as const;
  });
}
