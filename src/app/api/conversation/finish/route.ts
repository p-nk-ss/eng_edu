import { NextResponse } from "next/server";
import { z } from "zod";
import { AnalysisUnavailableError, finishWarmup } from "@/lib/conversation/analyze";
import { LessonNotFoundError } from "@/lib/conversation/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ lessonId: z.string().min(1), action: z.enum(["review", "skip"]) });

/** Finish the warm-up: "review" analyses it, "skip" closes it without analysis. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Body must be { lessonId: string, action: "review" | "skip" }' }, { status: 400 });
  }
  try {
    return NextResponse.json(await finishWarmup(body.lessonId, body.action));
  } catch (e) {
    if (e instanceof LessonNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof AnalysisUnavailableError) {
      console.warn("conversation/finish 502:", e.message);
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
