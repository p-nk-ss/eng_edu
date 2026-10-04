import { NextResponse } from "next/server";
import { z } from "zod";
import { LessonNotFoundError, PartnerUnavailableError, TurnRejectedError } from "@/lib/conversation/session";
import { runTurn } from "@/lib/conversation/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ lessonId: z.string().min(1), text: z.string() });

/** One learner turn; streams the partner's reply as text/plain deltas. */
export async function POST(req: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body must be { lessonId: string, text: string }" }, { status: 400 });
  }
  try {
    const stream = await runTurn(body.lessonId, body.text);
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TurnRejectedError) {
      return NextResponse.json({ error: e.reason }, { status: e.reason === "invalid" ? 400 : 409 });
    }
    if (e instanceof LessonNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof PartnerUnavailableError) {
      console.warn("conversation/turn 503:", e.message);
      return NextResponse.json({ error: "partner_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
