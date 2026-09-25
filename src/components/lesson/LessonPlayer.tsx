"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { GradeResult } from "@/lib/grading/types";
import type { PlayerItem, PlayerLesson } from "@/lib/lesson/loadLesson";
import { TYPE_LABELS } from "@/lib/lesson/lessonView";
import { ExerciseBody } from "./cards/ExerciseBody";
import type { AnswerPayload } from "./cards/types";
import { LessonResults } from "./LessonResults";
import { ResultPanel } from "./ResultPanel";

type Phase = "answering" | "checking" | "graded" | "error";

const firstOpen = (items: PlayerItem[]) => {
  const i = items.findIndex((it) => it.result === null);
  return i === -1 ? items.length : i;
};

export function LessonPlayer({ lesson }: { lesson: PlayerLesson }) {
  const [items, setItems] = useState(lesson.items);
  const [index, setIndex] = useState(() => firstOpen(lesson.items));
  const [phase, setPhase] = useState<Phase>("answering");
  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), [index]);

  const current = items[index];
  const answered = items.filter((i) => i.result !== null).length;

  const check = useCallback(async () => {
    if (!current || !answer || checking.current || phase === "graded") return;
    checking.current = true;
    setPhase("checking");
    setError(null);
    try {
      const res = await fetch("/api/exercise/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: current.view.id, answer }),
      });
      const body = (await res.json().catch(() => ({}))) as GradeResult & { error?: string };
      if (!res.ok) {
        setError(res.status === 502 ? "Couldn't check right now - your answer is kept." : body.error ?? `Request failed (${res.status})`);
        setPhase("error");
        return;
      }
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, result: body } : it)));
      setPhase("graded");
    } catch {
      setError("Couldn't check right now - your answer is kept.");
      setPhase("error");
    } finally {
      checking.current = false;
    }
  }, [answer, current, index, phase]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void check();
  }

  function next() {
    const after = items.findIndex((it, i) => i > index && it.result === null);
    setIndex(after === -1 ? items.length : after);
    setAnswer(null);
    setPhase("answering");
    setError(null);
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground">This lesson has no exercises.</p>;
  }

  const header = (
    <header className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {[lesson.themeLabel, lesson.grammarTitle].filter(Boolean).join(` ${String.fromCharCode(0xb7)} `)}
      </p>
      <div role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={answered}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-success motion-safe:transition-transform" style={{ width: `${(answered / items.length) * 100}%` }} />
      </div>
    </header>
  );

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <LessonResults items={items} />
      </div>
    );
  }

  const graded = phase === "graded" && current.result;
  const isLast = items.findIndex((it, i) => i > index && it.result === null) === -1;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm">
        <p className="text-sm tabular-nums text-muted-foreground">Exercise {index + 1} of {items.length}</p>
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold outline-none">{TYPE_LABELS[current.view.type]}</h2>
        <ExerciseBody
          key={current.view.id}
          view={current.view}
          disabled={phase === "checking" || phase === "graded"}
          result={graded ? current.result : null}
          onChange={setAnswer}
          onSubmit={() => void check()}
        />
        {graded && <ResultPanel result={current.result!} type={current.view.type} />}
        {phase === "error" && error && (
          <p role="alert" className="text-danger">{error}</p>
        )}
        {graded ? (
          <button type="button" autoFocus onClick={next}
            className="min-h-11 self-end rounded-xl bg-primary px-6 py-3 font-display font-bold text-on-primary">
            {isLast ? "See results" : "Next"}
          </button>
        ) : (
          <button type="submit" disabled={!answer || phase === "checking"}
            className="flex min-h-11 items-center gap-2 self-end rounded-xl bg-primary px-6 py-3 font-display font-bold text-on-primary disabled:opacity-40">
            {phase === "checking" && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden />}
            {phase === "checking" ? "Checking..." : phase === "error" ? "Try again" : "Check"}
          </button>
        )}
      </form>
    </div>
  );
}
