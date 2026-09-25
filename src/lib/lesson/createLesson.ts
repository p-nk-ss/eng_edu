import type { Prisma, PrismaClient } from "@prisma/client";
import type { LessonInputs } from "../curriculum/lessonInputs";
import type { ExerciseTypeName } from "./exerciseSchemas";
import { formatDrop, type GateScoreEntry, type LessonDraft } from "./generateLesson";

export type CreateLessonDb = Pick<PrismaClient, "$transaction">;

/** `Lesson.plan` — the final SPEC shape. Review stays empty until M4; the player skips empty sections. */
export interface LessonPlan {
  version: 1;
  sections: {
    review: { exerciseIds: string[] };
    warmup: LessonDraft["warmup"];
    written: { exerciseIds: string[] };
    scenario: LessonDraft["scenario"];
  };
  meta: {
    grammarTopicId: string | null;
    vocabIds: string[];
    exerciseMix: string[];
    qualityGate: LessonDraft["qualityGate"];
    drops: number;
    /** "attempt N #i TYPE: reason" - human-readable, for diagnostics only. */
    dropReasons: string[];
    /** Jev gate scores for the kept, gated exercises - indexes into sections.written.exerciseIds. */
    gateScores: GateScoreEntry[];
    attempts: 1 | 2;
  };
}

export function buildPlan(
  draft: LessonDraft,
  exerciseIds: string[],
  meta: { grammarTopicId: string | null; vocabIds: string[]; exerciseMix: string[] },
): LessonPlan {
  return {
    version: 1,
    sections: {
      review: { exerciseIds: [] },
      warmup: draft.warmup,
      written: { exerciseIds },
      scenario: draft.scenario,
    },
    meta: {
      ...meta,
      qualityGate: draft.qualityGate,
      drops: draft.drops.length,
      dropReasons: draft.drops.map(formatDrop),
      gateScores: draft.gateScores,
      attempts: draft.attempts,
    },
  };
}

/**
 * Persist a generated lesson atomically. Queries are awaited one by one - the pg adapter
 * holds a single connection, also inside a transaction.
 */
export async function createLesson(
  db: CreateLessonDb,
  draft: LessonDraft,
  inputs: LessonInputs,
  mix: ExerciseTypeName[],
  now: Date,
): Promise<string> {
  const vocabIds = inputs.vocab.map((v) => v.id);
  const topic = inputs.grammarTopic;

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const lesson = await tx.lesson.create({
      data: { status: "PLANNED", theme: inputs.theme.key, date: now, plan: {} },
    });

    const exerciseIds: string[] = [];
    for (const e of draft.exercises) {
      const row = await tx.exercise.create({
        data: { lessonId: lesson.id, type: e.type, content: e.content as unknown as Prisma.InputJsonValue },
      });
      exerciseIds.push(row.id);
    }

    const plan = buildPlan(draft, exerciseIds, { grammarTopicId: topic?.id ?? null, vocabIds, exerciseMix: mix });
    await tx.lesson.update({ where: { id: lesson.id }, data: { plan: plan as unknown as Prisma.InputJsonValue } });

    if (topic) {
      await tx.grammarTopic.update({
        where: { id: topic.id },
        data: {
          ...(topic.status === "NOT_STARTED" ? { status: "INTRODUCED" as const } : {}),
          timesUsed: { increment: 1 },
          lastUsedAt: now,
        },
      });
    }
    await tx.vocabItem.updateMany({ where: { id: { in: vocabIds }, status: "NEW" }, data: { status: "SEEN" } });
    await tx.vocabItem.updateMany({ where: { id: { in: vocabIds } }, data: { lastSeenAt: now } });

    return lesson.id;
  });
}
