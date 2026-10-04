import type { PrismaClient } from "@prisma/client";
import { getWarmup, type WarmupState } from "../conversation/session";
import { isBelowLevelCore, lessonsToMaster } from "../curriculum/advancement";
import { THEMES } from "../curriculum/themes";
import { prisma } from "../db";
import type { GradeResult } from "../grading/types";
import type { LessonPlan } from "./createLesson";
import { parseExercise } from "./exerciseSchemas";
import { toExerciseView, type ExerciseView } from "./lessonView";

export type PlayerLessonDb = Pick<
  PrismaClient,
  "lesson" | "exercise" | "grammarTopic" | "profile" | "vocabItem" | "conversationSession" | "conversationTurn"
>;

export interface PlayerItem {
  view: ExerciseView;
  result: GradeResult | null;
  section: "review" | "written";
}

export interface PlayerLessonIntro {
  learnerLevel: string | null;
  grammar: {
    title: string;
    level: string;
    description: string | null;
    example: string | null;
    status: string;
    goodLessons: number;
    lessonsToMaster: number;
    lastScore: number | null;
  } | null;
  /** Lessons with the same plan.meta.grammarTopicId, dated up to and including this lesson. null without a grammar focus. */
  topicLessonNumber: number | null;
  /** Headwords of plan.meta.vocabIds, in plan order; unknown ids are skipped. */
  vocab: string[];
}

export interface PlayerLesson {
  lessonId: string;
  themeLabel: string | null;
  grammarTitle: string | null;
  items: PlayerItem[];
  intro: PlayerLessonIntro;
  /** `available` = the plan has a warm-up intro (older lessons may not); `state` is the WARMUP session (empty before it starts). */
  warmup: { available: boolean; theme: string | null; state: WarmupState };
}

/** Everything the player page needs, with no answer keys (only stored results of answered items). */
export async function loadLessonForPlayer(id: string, db: PlayerLessonDb = prisma as unknown as PlayerLessonDb): Promise<PlayerLesson | null> {
  const lesson = await db.lesson.findUnique({ where: { id }, select: { id: true, theme: true, plan: true, date: true } });
  if (!lesson) return null;
  const plan = lesson.plan as unknown as Partial<LessonPlan> | null;

  const rows = await db.exercise.findMany({
    where: { lessonId: id },
    select: { id: true, content: true, result: true, answeredAt: true },
    orderBy: { id: "asc" },
  });
  const review = plan?.sections?.review?.exerciseIds ?? [];
  const planned = plan?.sections?.written?.exerciseIds ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: { row: (typeof rows)[number]; section: "review" | "written" }[] = [
    ...review.flatMap((rid) => (byId.has(rid) ? [{ row: byId.get(rid)!, section: "review" as const }] : [])),
    ...planned.flatMap((pid) => (byId.has(pid) ? [{ row: byId.get(pid)!, section: "written" as const }] : [])),
    ...rows.filter((r) => !review.includes(r.id) && !planned.includes(r.id)).map((row) => ({ row, section: "written" as const })),
  ];

  const items: PlayerItem[] = [];
  for (const { row: r, section } of ordered) {
    const parsed = parseExercise(r.content);
    if (!parsed.ok) continue;
    items.push({ view: toExerciseView(r.id, parsed.content), result: r.answeredAt ? (r.result as unknown as GradeResult) : null, section });
  }

  const topicId = plan?.meta?.grammarTopicId ?? null;
  const topic = topicId
    ? await db.grammarTopic.findUnique({
        where: { id: topicId },
        select: { title: true, name: true, cefrLevel: true, description: true, example: true, status: true, goodLessons: true, importance: true },
      })
    : null;

  const profile = await db.profile.findFirst({ orderBy: { updatedAt: "desc" }, select: { level: true } });

  const vocabIds = plan?.meta?.vocabIds ?? [];
  const vocabRows = vocabIds.length ? await db.vocabItem.findMany({ where: { id: { in: vocabIds } }, select: { id: true, headword: true } }) : [];
  const headwordById = new Map(vocabRows.map((v) => [v.id, v.headword]));
  const vocab = vocabIds.flatMap((vid) => (headwordById.has(vid) ? [headwordById.get(vid)!] : []));

  const topicLessonNumber = topicId
    ? await db.lesson.count({ where: { plan: { path: ["meta", "grammarTopicId"], equals: topicId }, date: { lte: lesson.date } } })
    : null;

  const previous = topicId
    ? await db.lesson.findFirst({
        where: {
          id: { not: lesson.id }, writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: topicId },
          date: { lte: lesson.date },
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { writtenScore: true },
      })
    : null;

  const grammarTitle = topic ? (topic.title ?? topic.name) : null;
  const themeLabel = THEMES.find((t) => t.key === lesson.theme)?.label ?? null;

  const warmupAvailable = Boolean(plan?.sections?.warmup?.intro);
  // getWarmup only touches conversationSession / conversationTurn, both in PlayerLessonDb.
  const warmupState: WarmupState = warmupAvailable ? await getWarmup(lesson.id, db) : { status: null, turns: [], review: null };

  return {
    lessonId: lesson.id,
    themeLabel,
    warmup: { available: warmupAvailable, theme: themeLabel, state: warmupState },
    grammarTitle,
    items,
    intro: {
      learnerLevel: profile?.level ?? null,
      grammar: topic
        ? {
            title: grammarTitle!,
            level: topic.cefrLevel,
            description: topic.description ?? null,
            example: topic.example ?? null,
            status: topic.status,
            goodLessons: topic.goodLessons,
            lessonsToMaster: lessonsToMaster(isBelowLevelCore(topic, profile?.level ?? null)),
            lastScore: previous?.writtenScore ?? null,
          }
        : null,
      topicLessonNumber,
      vocab,
    },
  };
}
