import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { selectLessonInputs, type LessonInputs, type LessonInputsDb } from "../curriculum/lessonInputs";
import type { GenerationInputs } from "../prompts/lessonGeneration";
import { createLesson, type CreateLessonDb } from "./createLesson";
import { planExerciseMix } from "./exerciseMix";
import type { ExerciseTypeName } from "./exerciseSchemas";
import { generateLesson, type GenerationDeps } from "./generateLesson";
import { findResumableLessonId } from "./resumable";

export type StartLessonDb = LessonInputsDb & CreateLessonDb & Pick<PrismaClient, "lesson">;

const SUMMARY_HISTORY = 3;

export function toGenerationInputs(inputs: LessonInputs, mix: ExerciseTypeName[], summaries: string[]): GenerationInputs {
  const t = inputs.grammarTopic;
  return {
    profile: {
      level: inputs.profile.level,
      goals: inputs.profile.goals,
      interests: inputs.profile.interests,
      nativeLang: inputs.profile.nativeLang,
    },
    theme: { key: inputs.theme.key, label: inputs.theme.label, description: inputs.theme.description },
    // Not-yet-enriched DB: fall back to the dataset name rather than sending "null" to Claude.
    grammar: t ? { id: t.id, title: t.title ?? t.name, description: t.description ?? "", example: t.example ?? "" } : null,
    vocab: inputs.vocab.map((v) => ({ id: v.id, headword: v.headword, pos: v.pos, cefrLevel: v.cefrLevel })),
    mix,
    summaries,
  };
}

export interface StartLessonResult {
  lessonId: string;
  reused: boolean;
  /** Present only when a lesson was freshly generated (reused: false) - for the route's log line. */
  attempts?: 1 | 2;
  drops?: number;
}

// A double click, a page reload or React StrictMode's double effect must not start a second
// 1-3 minute paid generation. While a call is running, further calls join the SAME promise;
// cleared in `finally` so the next call (after success OR failure) starts fresh.
let inFlight: Promise<StartLessonResult> | null = null;

/** POST /api/lesson/start. Resumes an unfinished lesson (any date) or today's; otherwise generates one. Single-flighted. Sequential queries only. */
export function startLesson(deps: { db?: StartLessonDb; generation: GenerationDeps; now?: Date }): Promise<StartLessonResult> {
  if (inFlight) return inFlight;
  const p = runStartLesson(deps).finally(() => {
    inFlight = null;
  });
  inFlight = p;
  return p;
}

async function runStartLesson(deps: { db?: StartLessonDb; generation: GenerationDeps; now?: Date }): Promise<StartLessonResult> {
  const db = deps.db ?? (prisma as unknown as StartLessonDb);
  const now = deps.now ?? new Date();

  const existingId = await findResumableLessonId(db, now);
  if (existingId) return { lessonId: existingId, reused: true };

  const inputs = await selectLessonInputs(db, now);
  const lessonNumber = (await db.lesson.count()) + 1;
  const mix = planExerciseMix(lessonNumber, { hasGrammar: inputs.grammarTopic !== null });

  const recent = await db.lesson.findMany({
    where: { status: "COMPLETED", summary: { not: null } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: SUMMARY_HISTORY,
    select: { summary: true },
  });
  const summaries = recent.map((l) => l.summary).filter((s): s is string => s !== null);

  const draft = await generateLesson(toGenerationInputs(inputs, mix, summaries), deps.generation);
  const lessonId = await createLesson(db, draft, inputs, mix, now);
  return { lessonId, reused: false, attempts: draft.attempts, drops: draft.drops.length };
}
