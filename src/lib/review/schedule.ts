export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;
export const REVIEW_MASTERED_STREAK = 3;

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

/** SPEC: correct -> next interval (3, 7, 14 days), MASTERED at streak 3; wrong -> streak 0, back in 1 day. */
export function nextErrorState(
  cur: { correctStreak: number },
  correct: boolean,
  now: Date,
): { status: "REVIEWING" | "MASTERED"; correctStreak: number; nextReviewAt: Date } {
  if (!correct) return { status: "REVIEWING", correctStreak: 0, nextReviewAt: addDays(now, REVIEW_INTERVAL_DAYS[0]) };
  const correctStreak = cur.correctStreak + 1;
  const days = REVIEW_INTERVAL_DAYS[Math.min(correctStreak, REVIEW_INTERVAL_DAYS.length - 1)];
  return { status: correctStreak >= REVIEW_MASTERED_STREAK ? "MASTERED" : "REVIEWING", correctStreak, nextReviewAt: addDays(now, days) };
}
