import type { PrismaClient } from "@prisma/client";

/**
 * The lesson "Start" should open instead of generating a new one (owner decision, M3d): the newest
 * PLANNED/IN_PROGRESS lesson dated today, or of any date while it still has an unanswered exercise.
 */
export async function findResumableLessonId(db: Pick<PrismaClient, "lesson">, now: Date): Promise<string | null> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const found = await db.lesson.findFirst({
    where: {
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      OR: [{ date: { gte: dayStart, lt: dayEnd } }, { exercises: { some: { answeredAt: null } } }],
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return found?.id ?? null;
}
