import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PlayerItem } from "@/lib/lesson/loadLesson";
import { TYPE_LABELS, viewExcerpt } from "@/lib/lesson/lessonView";
import { ResultPanel } from "./ResultPanel";

function Ring({ value, total }: { value: number; total: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const share = total ? value / total : 0;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      <circle cx="48" cy="48" r={r} fill="none" strokeWidth="10" className="stroke-surface-2" />
      <circle cx="48" cy="48" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-success"
        strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 48 48)" />
    </svg>
  );
}

export function LessonResults({ items }: { items: PlayerItem[] }) {
  const correct = items.filter((i) => i.result?.isCorrect).length;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="results-title">
      <div className="flex items-center gap-4">
        <Ring value={correct} total={items.length} />
        <div>
          <h2 id="results-title" ref={headingRef} tabIndex={-1} className="font-display text-2xl font-extrabold outline-none">Written block done</h2>
          <p className="text-lg tabular-nums">{correct} of {items.length} correct</p>
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {items.map(({ view, result }) => (
          <li key={view.id} className="rounded-card border border-border bg-surface p-3">
            <details>
              <summary className="flex cursor-pointer items-start gap-2">
                {result?.isCorrect ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" aria-hidden /> : <XCircle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
                <span className="sr-only">{result?.isCorrect ? "Correct:" : "Wrong:"}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{TYPE_LABELS[view.type]}</span>
                  <span className="truncate text-sm font-normal text-muted-foreground">{viewExcerpt(view)}</span>
                </span>
              </summary>
              {result && <div className="mt-3"><ResultPanel result={result} type={view.type} /></div>}
            </details>
          </li>
        ))}
      </ol>
      <Link href="/" className="flex min-h-11 items-center justify-center self-start rounded-xl bg-primary px-5 py-3 font-display font-bold text-on-primary">
        Back to dashboard
      </Link>
    </section>
  );
}
