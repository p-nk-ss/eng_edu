"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Starts (or resumes) the lesson. Generation can take 1-3 minutes; the route single-flights it. */
export function StartLessonButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson/start", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { lessonId?: string; error?: string };
      if (!res.ok || !body.lessonId) throw new Error(body.error ?? `Request failed (${res.status})`);
      router.push(`/lesson/${body.lessonId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 font-display font-bold text-on-primary enabled:hover:opacity-90 disabled:opacity-40"
      >
        {pending && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden />}
        {pending ? "Preparing your lesson..." : error ? "Try again" : "Start today's lesson"}
      </button>
      {pending && <p className="text-sm text-muted-foreground">This can take a couple of minutes.</p>}
      {error && (
        <p role="alert" className="max-w-sm text-right text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
