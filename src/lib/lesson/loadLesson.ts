import type { PrismaClient } from "@prisma/client";
import { THEMES } from "../curriculum/themes";
import { prisma } from "../db";
import type { GradeResult } from "../grading/types";
import type { LessonPlan } from "./createLesson";
import { parseExercise } from "./exerciseSchemas";
import { toExerciseView, type ExerciseView } from "./lessonView";

export type PlayerLessonDb = Pick<PrismaClient, "lesson" | "exercise" | "grammarTopic">;

export interface PlayerItem {
  view: ExerciseView;
  result: GradeResult | null;
}

export interface PlayerLesson {
  lessonId: string;
  themeLabel: string | null;
  grammarTitle: string | null;
  items: PlayerItem[];
}

/** Everything the player page needs, with no answer keys (only stored results of answered items). */
export async function loadLessonForPlayer(id: string, db: PlayerLessonDb = prisma as unknown as PlayerLessonDb): Promise<PlayerLesson | null> {
  const lesson = await db.lesson.findUnique({ where: { id }, select: { id: true, theme: true, plan: true } });
  if (!lesson) return null;
  const plan = lesson.plan as unknown as Partial<LessonPlan> | null;

  const rows = await db.exercise.findMany({
    where: { lessonId: id },
    select: { id: true, content: true, result: true, answeredAt: true },
    orderBy: { id: "asc" },
  });
  const planned = plan?.sections?.written?.exerciseIds ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [
    ...planned.flatMap((pid) => (byId.has(pid) ? [byId.get(pid)!] : [])),
    ...rows.filter((r) => !planned.includes(r.id)),
  ];

  const items: PlayerItem[] = [];
  for (const r of ordered) {
    const parsed = parseExercise(r.content);
    if (!parsed.ok) continue;
    items.push({ view: toExerciseView(r.id, parsed.content), result: r.answeredAt ? (r.result as unknown as GradeResult) : null });
  }

  const topicId = plan?.meta?.grammarTopicId ?? null;
  const topic = topicId ? await db.grammarTopic.findUnique({ where: { id: topicId }, select: { title: true, name: true } }) : null;

  return {
    lessonId: lesson.id,
    themeLabel: THEMES.find((t) => t.key === lesson.theme)?.label ?? null,
    grammarTitle: topic ? (topic.title ?? topic.name) : null,
    items,
  };
}
