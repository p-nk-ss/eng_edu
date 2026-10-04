import Link from "next/link";
import type { ErrorGroup } from "@/lib/errors/categories";

export interface ErrorStatsData {
  dueToday: number;
  openByGroup: { group: ErrorGroup; label: string; count: number }[];
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right tabular-nums">{count}</span>
    </div>
  );
}

export function ErrorStats({ stats }: { stats: ErrorStatsData | null }) {
  if (!stats) return <p className="text-muted-foreground">-</p>;

  const max = Math.max(1, ...stats.openByGroup.map((g) => g.count));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-2xl font-bold tabular-nums">
        {stats.dueToday > 0 ? `${stats.dueToday} due today` : "Nothing due today"}
      </p>
      {stats.openByGroup.length === 0 ? (
        <p className="text-muted-foreground">No open mistakes</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stats.openByGroup.map((g) => (
            <li key={g.group}>
              <Bar label={g.label} count={g.count} max={max} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/errors" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
        See all mistakes
      </Link>
    </div>
  );
}
