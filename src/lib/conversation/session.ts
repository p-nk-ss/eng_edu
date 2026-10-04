import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import type { LessonPlan } from "../lesson/createLesson";
import type { ConversationStatusName } from "./rules";

export type ConversationDb = Pick<PrismaClient, "lesson" | "conversationSession" | "conversationTurn" | "profile" | "grammarTopic" | "vocabItem">;

export const defaultDb = (): ConversationDb => prisma as unknown as ConversationDb;

export class LessonNotFoundError extends Error {
  constructor(lessonId: string, detail = "not found") {
    super(`Lesson ${lessonId}: ${detail}`);
    this.name = "LessonNotFoundError";
  }
}

export class TurnRejectedError extends Error {
  constructor(public readonly reason: "closed" | "limit" | "busy" | "invalid") {
    super(`Turn rejected: ${reason}`);
    this.name = "TurnRejectedError";
  }
}

export class PartnerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Conversation partner unavailable", { cause });
    this.name = "PartnerUnavailableError";
  }
}

export interface WarmupReview {
  topIssues: string[];
  counts: { minor: number; moderate: number; major: number };
  errorsAdded: number;
}

export interface WarmupTurn {
  id: string;
  role: "partner" | "learner";
  text: string;
  turnIndex: number;
  corrections: unknown;
}

export interface WarmupState {
  status: ConversationStatusName | null;
  turns: WarmupTurn[];
  review: WarmupReview | null;
}

export const warmupKey = (lessonId: string) => ({ lessonId_mode: { lessonId, mode: "WARMUP" as const } });

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

export async function loadWarmupSession(lessonId: string, db: ConversationDb) {
  return db.conversationSession.findUnique({ where: warmupKey(lessonId), select: { id: true, status: true, review: true } });
}

export async function loadTurns(sessionId: string, db: ConversationDb): Promise<WarmupTurn[]> {
  const rows = await db.conversationTurn.findMany({
    where: { sessionId },
    orderBy: { turnIndex: "asc" },
    select: { id: true, role: true, text: true, turnIndex: true, corrections: true },
  });
  return rows.map((r) => ({ id: r.id, role: r.role as WarmupTurn["role"], text: r.text, turnIndex: r.turnIndex, corrections: r.corrections ?? null }));
}

/** Current warm-up state of a lesson; `{ status: null, turns: [], review: null }` before it is started. */
export async function getWarmup(lessonId: string, db: ConversationDb = defaultDb()): Promise<WarmupState> {
  const session = await loadWarmupSession(lessonId, db);
  if (!session) return { status: null, turns: [], review: null };
  return {
    status: session.status as ConversationStatusName,
    turns: await loadTurns(session.id, db),
    review: (session.review as unknown as WarmupReview | null) ?? null,
  };
}

/**
 * Creates the WARMUP session with the partner opening turn (turnIndex 0, the plan's warm-up intro).
 * Idempotent: an existing session is returned untouched; a concurrent create is caught and re-read.
 * No LLM call.
 */
export async function startWarmup(lessonId: string, db: ConversationDb = defaultDb()): Promise<WarmupState> {
  const existing = await getWarmup(lessonId, db);
  if (existing.status) return existing;

  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true, plan: true } });
  if (!lesson) throw new LessonNotFoundError(lessonId);
  const intro = (lesson.plan as unknown as Partial<LessonPlan> | null)?.sections?.warmup?.intro;
  if (!intro) throw new LessonNotFoundError(lessonId, "no warm-up in the lesson plan");

  try {
    // One nested create - the session and its opening turn are written atomically.
    await db.conversationSession.create({
      data: { lessonId, mode: "WARMUP", status: "ACTIVE", turns: { create: { lessonId, role: "partner", text: intro, turnIndex: 0 } } },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  return getWarmup(lessonId, db);
}

/**
 * Sets SKIPPED (also endedAt) or UNAVAILABLE, creating the session if missing.
 * Never overwrites ANALYZED; UNAVAILABLE never reopens a SKIPPED session.
 */
export async function setWarmupStatus(lessonId: string, status: "SKIPPED" | "UNAVAILABLE", db: ConversationDb = defaultDb()): Promise<WarmupState> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw new LessonNotFoundError(lessonId);
  const endedAt = status === "SKIPPED" ? new Date() : undefined;

  let session = await loadWarmupSession(lessonId, db);
  if (!session) {
    try {
      await db.conversationSession.create({ data: { lessonId, mode: "WARMUP", status, ...(endedAt ? { endedAt } : {}) } });
      return getWarmup(lessonId, db);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      session = await loadWarmupSession(lessonId, db);
      if (!session) throw e;
    }
  }

  const current = session.status as ConversationStatusName;
  const keep = current === "ANALYZED" || (status === "UNAVAILABLE" && current === "SKIPPED");
  if (!keep && current !== status) {
    await db.conversationSession.update({ where: { id: session.id }, data: { status, ...(endedAt ? { endedAt } : {}) } });
  }
  return getWarmup(lessonId, db);
}
