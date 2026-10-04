import { NextResponse } from "next/server";
import { getWarmup } from "@/lib/conversation/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current warm-up state for a lesson (empty state before it is started). */
export async function GET(req: Request): Promise<NextResponse> {
  const lessonId = new URL(req.url).searchParams.get("lessonId");
  if (!lessonId) return NextResponse.json({ error: "lessonId is required" }, { status: 400 });
  try {
    return NextResponse.json(await getWarmup(lessonId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
