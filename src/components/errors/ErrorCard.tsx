import { CircleDot, RotateCcw, CheckCircle2, Check, X } from "lucide-react";
import type { ComponentType } from "react";
import type { ErrorView } from "@/lib/errors/queries";
import { GROUP_LABELS } from "@/lib/errors/categories";
import { formatDay } from "@/lib/errors/due";

const STATUS: Record<string, { Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>; label: string }> = {
  NEW: { Icon: CircleDot, label: "New" },
  REVIEWING: { Icon: RotateCcw, label: "Reviewing" },
  MASTERED: { Icon: CheckCircle2, label: "Mastered" },
};

/** Read-only card for one mistake: identity, progress, due date, examples and review history. */
export function ErrorCard({ error }: { error: ErrorView }) {
  const info = STATUS[error.status] ?? STATUS.NEW;
  const StatusIcon = info.Icon;

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">{error.title}</h2>
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-muted-foreground">
          {GROUP_LABELS[error.group]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-1 font-semibold">
          <StatusIcon size={16} aria-hidden />
          {info.label}
        </span>
        <span className="text-muted-foreground">
          {error.correctStreak} of {error.streakTarget} correct in a row
        </span>
        <span className="text-muted-foreground">{error.due.label}</span>
        <span className="text-muted-foreground">First seen {formatDay(error.createdAt)}</span>
      </div>

      {error.examples.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {error.examples.map((example, i) => (
            <li key={i}>{example}</li>
          ))}
        </ul>
      )}

      <div className="text-sm">
        <p className="font-semibold">Review history</p>
        {error.attempts.length === 0 ? (
          <p className="text-muted-foreground">No reviews yet</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {error.attempts.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-muted-foreground">{formatDay(a.at)}</span>
                {a.correct ? (
                  <Check size={14} className="text-success" aria-hidden />
                ) : (
                  <X size={14} className="text-danger" aria-hidden />
                )}
                <span>{a.correct ? "correct" : "wrong"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
