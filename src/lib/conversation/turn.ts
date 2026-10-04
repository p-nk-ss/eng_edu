import { THEMES } from "../curriculum/themes";
import type { LessonPlan } from "../lesson/createLesson";
import { stream as llmStream } from "@/lib/llm";
import type { CompleteArgs } from "../llm/types";
import { conversationPartnerPrompt } from "../prompts/conversationPartner";
import { canSend, CONNECTION_LOST_MARKER, learnerTurnCount, MAX_TURN_CHARS, shouldWrapUp, type ConversationStatusName } from "./rules";
import {
  defaultDb,
  LessonNotFoundError,
  loadTurns,
  loadWarmupSession,
  PartnerUnavailableError,
  TurnRejectedError,
  type ConversationDb,
} from "./session";

export interface TurnDeps {
  db?: ConversationDb;
  stream?: (args: CompleteArgs) => AsyncIterable<string>;
}

/** Single-flight guard: lessons with a turn in progress (from validation until the stream finishes). */
const inFlight = new Set<string>();

/** Test seam: clear the single-flight guard. */
export function __resetInFlight(): void {
  inFlight.clear();
}

/**
 * One learner turn of the warm-up conversation. Persists the learner turn, then streams the partner
 * reply (UTF-8 text deltas) and persists it when the stream ends.
 * Throws TurnRejectedError (invalid/busy/closed/limit), LessonNotFoundError, or PartnerUnavailableError
 * when the provider fails before its first delta (the learner turn is then removed).
 */
export async function runTurn(lessonId: string, text: string, deps: TurnDeps = {}): Promise<ReadableStream<Uint8Array>> {
  const db = deps.db ?? defaultDb();
  const provider = deps.stream ?? ((args: CompleteArgs) => llmStream("conversation", args));

  const learnerText = text.trim();
  if (!learnerText || learnerText.length > MAX_TURN_CHARS) throw new TurnRejectedError("invalid");
  // Taken synchronously, before any await, so concurrent requests cannot both pass.
  if (inFlight.has(lessonId)) throw new TurnRejectedError("busy");
  inFlight.add(lessonId);

  let handedOff = false;
  try {
    const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true, theme: true, plan: true } });
    if (!lesson) throw new LessonNotFoundError(lessonId);
    const session = await loadWarmupSession(lessonId, db);
    const status = (session?.status as ConversationStatusName | undefined) ?? null;
    const turns = session ? await loadTurns(session.id, db) : [];
    const verdict = canSend(status, learnerTurnCount(turns));
    if (verdict !== "ok" || !session) throw new TurnRejectedError(verdict === "ok" ? "closed" : verdict);

    const nextIndex = (turns.length ? turns[turns.length - 1].turnIndex : -1) + 1;
    const learner = await db.conversationTurn.create({
      data: { lessonId, sessionId: session.id, role: "learner", text: learnerText, turnIndex: nextIndex },
      select: { id: true },
    });

    const history = [...turns.map((t) => ({ role: t.role, text: t.text })), { role: "learner" as const, text: learnerText }];
    const args = conversationPartnerPrompt({
      ...(await promptContext(lesson.theme, lesson.plan, db)),
      wrapUp: shouldWrapUp(learnerTurnCount(history)),
      history,
    });

    // Pull the first delta before answering, so an unreachable partner is a clean error.
    let iterator: AsyncIterator<string>;
    let first: IteratorResult<string>;
    try {
      iterator = provider(args)[Symbol.asyncIterator]();
      first = await iterator.next();
      if (first.done) throw new Error("Partner returned an empty reply");
    } catch (e) {
      await db.conversationTurn.delete({ where: { id: learner.id } });
      await db.conversationSession.update({ where: { id: session.id }, data: { status: "UNAVAILABLE" } });
      throw new PartnerUnavailableError(e);
    }

    const encoder = new TextEncoder();
    let pending: string | null = first.value;
    let reply = "";
    let finished = false;

    const persistReply = async () => {
      if (!reply) return;
      await db.conversationTurn.create({ data: { lessonId, sessionId: session.id, role: "partner", text: reply, turnIndex: nextIndex + 1 } });
      if (status !== "ACTIVE") await db.conversationSession.update({ where: { id: session.id }, data: { status: "ACTIVE" } });
    };

    const result = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (finished) return;
        try {
          let chunk: string;
          if (pending !== null) {
            chunk = pending;
            pending = null;
          } else {
            let next: IteratorResult<string>;
            try {
              next = await iterator.next();
            } catch {
              if (finished) return;
              finished = true;
              controller.enqueue(encoder.encode(CONNECTION_LOST_MARKER));
              await persistReply();
              controller.close();
              return;
            }
            if (finished) return;
            if (next.done) {
              finished = true;
              await persistReply();
              controller.close();
              return;
            }
            chunk = next.value;
          }
          reply += chunk;
          controller.enqueue(encoder.encode(chunk));
        } catch (e) {
          finished = true;
          controller.error(e);
        } finally {
          if (finished) inFlight.delete(lessonId);
        }
      },
      async cancel() {
        if (finished) return;
        finished = true;
        try {
          await iterator.return?.();
          await persistReply();
        } finally {
          inFlight.delete(lessonId);
        }
      },
    });
    handedOff = true;
    return result;
  } finally {
    if (!handedOff) inFlight.delete(lessonId);
  }
}

async function promptContext(theme: string | null, rawPlan: unknown, db: ConversationDb) {
  const plan = rawPlan as Partial<LessonPlan> | null;
  const warmup = plan?.sections?.warmup;

  const profile = await db.profile.findFirst({ orderBy: { updatedAt: "desc" }, select: { level: true, interests: true } });

  const topicId = plan?.meta?.grammarTopicId ?? null;
  const topic = topicId
    ? await db.grammarTopic.findUnique({ where: { id: topicId }, select: { title: true, name: true, description: true } })
    : null;

  const vocabIds = plan?.meta?.vocabIds ?? [];
  const vocabRows = vocabIds.length ? await db.vocabItem.findMany({ where: { id: { in: vocabIds } }, select: { id: true, headword: true } }) : [];
  const headwordById = new Map(vocabRows.map((v) => [v.id, v.headword]));

  return {
    level: profile?.level ?? "B1",
    interests: profile?.interests ?? "",
    theme: THEMES.find((t) => t.key === theme)?.label ?? null,
    intro: warmup?.intro ?? "",
    questions: warmup?.questions ?? [],
    grammar: topic ? { title: topic.title ?? topic.name, description: topic.description ?? null } : null,
    vocab: vocabIds.flatMap((id) => (headwordById.has(id) ? [headwordById.get(id)!] : [])),
  };
}
