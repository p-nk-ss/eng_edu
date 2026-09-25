import { CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import type { GradeResult, WritingCorrection } from "@/lib/grading/types";
import type { ExerciseView } from "@/lib/lesson/lessonView";

const SEVERITY_CLASS: Record<WritingCorrection["severity"], string> = {
  minor: "border-border text-muted-foreground",
  moderate: "border-warning text-warning",
  major: "border-danger text-danger",
};

export function ResultPanel({ result, type }: { result: GradeResult; type: ExerciseView["type"] }) {
  const ok = result.isCorrect;
  const fb = result.feedback;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-2 p-4">
      <p role="status" className={`flex items-center gap-2 font-display text-lg font-bold ${ok ? "text-success" : "text-danger"}`}>
        {ok ? <CheckCircle2 size={24} className="motion-safe:animate-pop" aria-hidden /> : <XCircle size={24} aria-hidden />}
        {ok ? "Correct" : "Not quite"}
      </p>

      {result.parts.length > 1 && (
        <ul className="flex flex-col gap-1 text-sm">
          {result.parts.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              {p.correct ? <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden /> : <XCircle size={16} className="shrink-0 text-danger" aria-hidden />}
              <span className="sr-only">{p.correct ? "Correct:" : "Wrong:"}</span>
              <span>you: {p.given || "-"}</span>
              {!p.correct && <span className="text-muted-foreground">{String.fromCharCode(0xb7)} answer: {p.expected}</span>}
            </li>
          ))}
        </ul>
      )}

      {ok && result.gradedBy === "jev" && result.correctAnswer && (
        <p className="text-sm text-muted-foreground">Accepted - the key was: {result.correctAnswer}</p>
      )}
      {!ok && result.correctAnswer && type !== "open_writing" && (
        <p>
          <span className="font-semibold">Correct answer:</span> {result.correctAnswer}
        </p>
      )}

      {type === "translation" && fb?.corrected && (
        <div className="flex flex-col gap-1">
          <p><span className="font-semibold">Better:</span> {fb.corrected}</p>
          {fb.explanation && <p className="text-sm">{fb.explanation}</p>}
        </div>
      )}

      {type === "open_writing" && fb && (
        <div className="flex flex-col gap-2">
          {fb.summary && <p>{fb.summary}</p>}
          {typeof fb.wordCount === "number" && <p className="text-sm tabular-nums text-muted-foreground">{fb.wordCount} words</p>}
          {fb.corrections && fb.corrections.length > 0 && (
            <ol className="flex flex-col gap-2">
              {fb.corrections.map((k, i) => (
                <li key={i} className="rounded-xl border border-border bg-surface p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="line-through">{k.original}</span>
                    <span aria-hidden>-&gt;</span>
                    <span className="font-semibold">{k.corrected}</span>
                    <span className={`rounded-full border px-2 text-xs ${SEVERITY_CLASS[k.severity]}`}>{k.severity}</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">{k.explanation}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {result.rationales && result.rationales.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {result.rationales.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {result.explain && (
        <details open={!ok} className="group text-sm">
          <summary className="flex min-h-11 list-none items-center gap-1 cursor-pointer font-semibold">
            Why?
            <ChevronDown size={16} className="motion-safe:transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-1">{result.explain}</p>
        </details>
      )}
    </div>
  );
}
