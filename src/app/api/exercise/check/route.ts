import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAnswer, ExerciseNotFoundError, InvalidAnswerError } from "@/lib/grading/checkAnswer";
import { GradingUnavailableError } from "@/lib/grading/judge";
import { liveJudgeDeps } from "@/lib/grading/liveJudgeDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ exerciseId: z.string().min(1), answer: z.unknown() });

/** Grade one answer. Keys and feedback are returned only after the answer is recorded. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body must be { exerciseId: string, answer: object }" }, { status: 400 });
  }
  try {
    return NextResponse.json(await checkAnswer(body.exerciseId, body.answer, { judge: liveJudgeDeps() }));
  } catch (e) {
    if (e instanceof InvalidAnswerError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof ExerciseNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof GradingUnavailableError) return NextResponse.json({ error: e.message }, { status: 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
