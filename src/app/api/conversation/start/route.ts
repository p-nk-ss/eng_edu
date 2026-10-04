import { NextResponse } from "next/server";
import { z } from "zod";
import { LessonNotFoundError, startWarmup } from "@/lib/conversation/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ lessonId: z.string().min(1) });

/** Start (or resume) the warm-up session for a lesson. Idempotent. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body must be { lessonId: string }" }, { status: 400 });
  }
  try {
    return NextResponse.json(await startWarmup(body.lessonId));
  } catch (e) {
    if (e instanceof LessonNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
