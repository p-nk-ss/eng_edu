import { NextResponse } from "next/server";
import { ProfileMissingError } from "@/lib/curriculum/lessonInputs";
import { formatDrop, LessonGenerationError } from "@/lib/lesson/generateLesson";
import { liveGenerationDeps } from "@/lib/lesson/liveDeps";
import { startLesson } from "@/lib/lesson/startLesson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // one Agent SDK generation can take 1-3 minutes

/** Start (or resume) today's lesson. Voice-service health checks join in M5. */
export async function POST(): Promise<NextResponse> {
  try {
    const result = await startLesson({ generation: liveGenerationDeps() });
    // Counts only - never exercise content, never secrets.
    console.info(
      `lesson/start: lessonId=${result.lessonId} reused=${result.reused}` +
        (result.reused ? "" : ` attempts=${result.attempts} drops=${result.drops}`),
    );
    return NextResponse.json({ lessonId: result.lessonId, reused: result.reused });
  } catch (e) {
    if (e instanceof ProfileMissingError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof LessonGenerationError) {
      const drops = e.drops.map(formatDrop);
      return NextResponse.json({ error: e.message, drops }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
