import type { Prisma, PrismaClient } from "@prisma/client";
import { completeJson } from "@/lib/llm";
import type { CompleteArgs } from "../llm/types";
import { appendExample } from "../grading/recordAnswer";
import { EXAMPLE_MAX } from "../grading/errorEntries";
import type { LessonPlan } from "../lesson/createLesson";
import {
  conversationAnalysisPrompt,
  conversationAnalysisSchema,
  type ConversationAnalysis,
  type ConversationFinding,
} from "../prompts/conversationAnalysis";
import { finishOutcome, learnerTurnCount } from "./rules";
import {
  defaultDb,
  getWarmup,
  LessonNotFoundError,
  loadWarmupSession,
  setWarmupStatus,
  type ConversationDb,
  type WarmupReview,
  type WarmupState,
  type WarmupTurn,
} from "./session";

const DAY_MS = 86_400_000;

export type AnalyzeDb = ConversationDb & Pick<PrismaClient, "errorRecord" | "$transaction">;

const defaultAnalyzeDb = (): AnalyzeDb => defaultDb() as AnalyzeDb;

export class AnalysisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Conversation analysis unavailable", { cause });
    this.name = "AnalysisUnavailableError";
  }
}

export interface FinishWarmupDeps {
  db?: AnalyzeDb;
  analyse?: (args: CompleteArgs) => Promise<ConversationAnalysis>;
  now?: Date;
}

/** Collapse whitespace and clip to EXAMPLE_MAX, like answerExample/clip in errorEntries.ts. */
function clip(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > EXAMPLE_MAX ? oneLine.slice(0, EXAMPLE_MAX - 3) + "..." : oneLine;
}

/**
 * Skip or analyse a finished warm-up conversation.
 * - `skip`, or `review` with fewer than MIN_TURNS_FOR_REVIEW learner turns -> SKIPPED, no LLM call.
 * - Already ANALYZED -> returns the stored state (idempotent), no LLM call.
 * - Otherwise: one LLM call outside any transaction; on failure throws AnalysisUnavailableError and
 *   writes nothing. On success, one transaction writes each learner turn's `corrections` and upserts
 *   an ErrorRecord per `major` finding (find-then-update/create, same as recordAnswer.ts), then marks
 *   the session ANALYZED with the review and endedAt.
 */
export async function finishWarmup(lessonId: string, action: "review" | "skip", deps: FinishWarmupDeps = {}): Promise<WarmupState> {
  const db = deps.db ?? defaultAnalyzeDb();
  const analyse = deps.analyse ?? ((args: CompleteArgs) => completeJson("conversation_analysis", args, conversationAnalysisSchema));
  const now = deps.now ?? new Date();

  const state = await getWarmup(lessonId, db);
  if (state.status === "ANALYZED") return state;

  if (action === "skip" || finishOutcome(learnerTurnCount(state.turns)) === "skip") {
    return setWarmupStatus(lessonId, "SKIPPED", db);
  }

  const session = await loadWarmupSession(lessonId, db);
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true, plan: true } });
  if (!session || !lesson) throw new LessonNotFoundError(lessonId);

  const plan = lesson.plan as unknown as Partial<LessonPlan> | null;
  const topicId = plan?.meta?.grammarTopicId ?? null;
  const topic = topicId
    ? await db.grammarTopic.findUnique({ where: { id: topicId }, select: { id: true, title: true, name: true } })
    : null;
  const profile = await db.profile.findFirst({ select: { level: true } });

  const args = conversationAnalysisPrompt({
    level: profile?.level ?? "B1",
    turns: state.turns.map((t) => ({ id: t.id, role: t.role, text: t.text })),
    grammarTopics: topic ? [{ id: topic.id, title: topic.title ?? topic.name }] : [],
  });

  let analysis: ConversationAnalysis;
  try {
    analysis = await analyse(args);
  } catch (e) {
    throw new AnalysisUnavailableError(e);
  }

  const learnerTurns = state.turns.filter((t) => t.role === "learner");
  const learnerIds = new Set(learnerTurns.map((t) => t.id));

  const normalized: ConversationFinding[] = analysis.findings
    .filter((f) => learnerIds.has(f.turnId))
    .map((f) => {
      const validTopic = topic !== null && f.grammarTopicId === topic.id;
      return {
        ...f,
        grammarTopicId: validTopic ? topic!.id : null,
        category: validTopic ? topic!.title ?? topic!.name : f.category || "general",
      };
    });

  const counts = { minor: 0, moderate: 0, major: 0 };
  for (const f of normalized) counts[f.severity]++;

  const byTurn = new Map<string, ConversationFinding[]>();
  for (const f of normalized) {
    const arr = byTurn.get(f.turnId) ?? [];
    arr.push(f);
    byTurn.set(f.turnId, arr);
  }

  const majors = normalized.filter((f) => f.severity === "major");

  const reviewWithoutCount: Omit<WarmupReview, "errorsAdded"> = { topIssues: analysis.topIssues, counts };

  const review = await db.$transaction(async (tx) => {
    const errorDb = tx as unknown as AnalyzeDb;
    for (const t of learnerTurns) {
      await errorDb.conversationTurn.update({
        where: { id: t.id },
        data: { corrections: (byTurn.get(t.id) ?? []) as unknown as Prisma.InputJsonValue },
      });
    }

    let errorsAdded = 0;
    for (const f of majors) {
      const example = clip(`${f.original} -> ${f.corrected}`);
      const existing = await errorDb.errorRecord.findFirst({
        where: { lessonId, grammarTopicId: f.grammarTopicId, category: f.category },
        select: { id: true, description: true },
      });
      if (existing) {
        await errorDb.errorRecord.update({ where: { id: existing.id }, data: { description: appendExample(existing.description, example) } });
      } else {
        await errorDb.errorRecord.create({
          data: {
            lessonId,
            grammarTopicId: f.grammarTopicId,
            category: f.category,
            description: appendExample("", example),
            source: "CONVERSATION",
            status: "NEW",
            nextReviewAt: new Date(now.getTime() + DAY_MS),
          },
        });
        errorsAdded++;
      }
    }

    const finalReview: WarmupReview = { ...reviewWithoutCount, errorsAdded };
    await errorDb.conversationSession.update({
      where: { id: session.id },
      data: { status: "ANALYZED", review: finalReview as unknown as Prisma.InputJsonValue, endedAt: now },
    });
    return finalReview;
  });

  const turns: WarmupTurn[] = state.turns.map((t) => (t.role === "learner" ? { ...t, corrections: byTurn.get(t.id) ?? [] } : t));
  return { status: "ANALYZED", review, turns };
}
