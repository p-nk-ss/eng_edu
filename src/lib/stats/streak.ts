import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";

export const STREAK_WINDOW_DAYS = 400;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * A day counts if it has at least one answer (local time). The streak is the run of counted days
 * ending today; if today has no answer yet, the run ending yesterday - still alive, but at risk.
 */
export function computeStreak(dates: Date[], now: Date): { days: number; atRisk: boolean } {
  const counted = new Set(dates.map(dayKey));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let atRisk = false;
  if (!counted.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!counted.has(dayKey(cursor))) return { days: 0, atRisk: false };
    atRisk = true;
  }
  let days = 0;
  while (counted.has(dayKey(cursor))) {
    days++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days, atRisk };
}

/** Streak for the dashboard; null if the DB is unreachable (the page still renders). */
export async function getStreak(
  db: Pick<PrismaClient, "exercise"> = prisma as unknown as Pick<PrismaClient, "exercise">,
  now: Date = new Date(),
): Promise<{ days: number; atRisk: boolean } | null> {
  try {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - STREAK_WINDOW_DAYS);
    const rows = await db.exercise.findMany({ where: { answeredAt: { gte: since } }, select: { answeredAt: true } });
    return computeStreak(rows.flatMap((r) => (r.answeredAt ? [r.answeredAt] : [])), now);
  } catch {
    return null;
  }
}
