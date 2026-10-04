const DAY = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const startOfTomorrow = (now: Date): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "27 Sep" - fixed table, not toLocaleDateString (ICU renders en-GB September as "Sept"). */
export const formatDay = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmt = formatDay;

/** "Due today" means before the start of tomorrow (local), matching the M4b selection rule. */
export function dueLabel(nextReviewAt: Date, status: string, now: Date): { label: string; isDue: boolean } {
  if (status === "MASTERED") return { label: "Mastered", isDue: false };
  const today = DAY(now).getTime();
  const day = DAY(nextReviewAt).getTime();
  if (day < today) return { label: `Overdue since ${fmt(nextReviewAt)}`, isDue: true };
  if (day === today) return { label: "Due today", isDue: true };
  const days = Math.round((day - today) / 86_400_000);
  return { label: days === 1 ? "Due tomorrow" : `In ${days} days`, isDue: false };
}
