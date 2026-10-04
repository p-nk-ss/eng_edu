"use client";

import { ArrowRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { WarmupState } from "@/lib/conversation/session";
import type { ConversationFinding, Severity } from "@/lib/prompts/conversationAnalysis";

const SEVERITY_TEXT: Record<Severity, string> = {
  major: "text-danger",
  moderate: "text-warning",
  minor: "text-muted-foreground",
};

const isSeverity = (v: unknown): v is Severity => v === "minor" || v === "moderate" || v === "major";

/** The findings stored on a learner turn (`corrections`), defensively narrowed. */
export function findingsOf(corrections: unknown): ConversationFinding[] {
  if (!Array.isArray(corrections)) return [];
  return corrections.filter(
    (f): f is ConversationFinding =>
      typeof f === "object" && f !== null &&
      typeof (f as ConversationFinding).original === "string" &&
      typeof (f as ConversationFinding).corrected === "string" &&
      typeof (f as ConversationFinding).explanation === "string" &&
      isSeverity((f as ConversationFinding).severity),
  );
}

function SeverityLabel({ severity }: { severity: Severity }) {
  return <span className={`text-xs font-bold uppercase tracking-wide ${SEVERITY_TEXT[severity]}`}>{severity}</span>;
}

/** The turn text with each finding's `original` (first non-overlapping occurrence) wrapped in <mark>. */
function highlight(text: string, findings: ConversationFinding[]): ReactNode[] {
  const ranges: { start: number; end: number; f: ConversationFinding }[] = [];
  for (const f of findings) {
    if (!f.original) continue;
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(f.original, from);
      if (start === -1) break;
      const end = start + f.original.length;
      if (ranges.every((r) => end <= r.start || start >= r.end)) {
        ranges.push({ start, end, f });
        break;
      }
      from = start + 1;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start > pos) out.push(text.slice(pos, r.start));
    out.push(
      <mark key={`m${i}`} className={`rounded bg-surface-2 px-0.5 font-semibold underline decoration-2 underline-offset-2 ${SEVERITY_TEXT[r.f.severity]}`}>
        {text.slice(r.start, r.end)}
      </mark>,
      <sup key={`s${i}`} className="ml-0.5">
        <SeverityLabel severity={r.f.severity} />
      </sup>,
    );
    pos = r.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function addedLine(errorsAdded: number, anyFindings: boolean): string {
  if (errorsAdded > 0) return `${errorsAdded} ${errorsAdded === 1 ? "mistake" : "mistakes"} added to your review list`;
  return anyFindings ? "No mistakes added to your review list" : "No mistakes found - nice work.";
}

export function ConversationReview({ state, onContinue }: { state: WarmupState; onContinue: () => void }) {
  const review = state.review;
  const issuesId = useId();
  const findingsByTurn = new Map(state.turns.map((t) => [t.id, t.role === "learner" ? findingsOf(t.corrections) : []]));
  const anyFindings = Array.from(findingsByTurn.values()).some((f) => f.length > 0);

  return (
    <section className="flex flex-col gap-5 rounded-card border border-border bg-surface p-5 shadow-sm">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Warm-up conversation</p>
        <h2 className="font-display text-xl font-bold">Conversation review</h2>
      </header>

      {review && review.topIssues.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 id={issuesId} className="font-display font-bold">Top issues</h3>
          <ul aria-labelledby={issuesId} className="list-disc pl-5">
            {review.topIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <ol aria-label="Your conversation" className="flex flex-col gap-3">
        {state.turns.map((t) => {
          if (t.role === "partner") {
            return (
              <li key={t.id} className="text-sm text-muted-foreground">
                <span className="font-semibold">Partner: </span>
                {t.text}
              </li>
            );
          }
          const findings = findingsByTurn.get(t.id) ?? [];
          return (
            <li key={t.id} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
              <p>
                <span className="text-sm font-semibold text-muted-foreground">You: </span>
                {findings.length > 0 ? highlight(t.text, findings) : t.text}
              </p>
              {findings.length > 0 && (
                <ul className="flex flex-col gap-2 border-t border-border pt-2 text-sm">
                  {findings.map((f, i) => (
                    <li key={i} className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <SeverityLabel severity={f.severity} />
                        <s className="text-muted-foreground">{f.original}</s>
                        <ArrowRight size={14} className="shrink-0 text-muted-foreground" role="img" aria-label="corrected to" />
                        <span className="font-semibold">{f.corrected}</span>
                      </span>
                      <span className="text-muted-foreground">{f.explanation}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {review && <p className="font-semibold">{addedLine(review.errorsAdded, anyFindings)}</p>}

      <button type="button" autoFocus onClick={onContinue}
        className="min-h-11 self-end rounded-xl bg-primary px-6 py-3 font-display font-bold text-on-primary hover:opacity-90">
        Continue to exercises
      </button>
    </section>
  );
}
