/**
 * Test-only in-memory stand-in for the Prisma methods the conversation service uses.
 * Not imported by app code.
 */
import type { ConversationDb } from "./session";

export interface FakeSession {
  id: string;
  lessonId: string;
  mode: "WARMUP" | "SCENARIO";
  status: "ACTIVE" | "ANALYZED" | "SKIPPED" | "UNAVAILABLE";
  review: unknown;
  createdAt: Date;
  endedAt: Date | null;
}
export interface FakeTurn {
  id: string;
  lessonId: string;
  sessionId: string | null;
  role: string;
  text: string;
  turnIndex: number;
  corrections: unknown;
  createdAt: Date;
}
export interface FakeLesson {
  id: string;
  theme: string | null;
  plan: unknown;
}

export interface FakeState {
  lessons: FakeLesson[];
  sessions: FakeSession[];
  turns: FakeTurn[];
  profile: { level: string; interests: string } | null;
  grammarTopics: { id: string; title: string | null; name: string; description: string | null }[];
  vocab: { id: string; headword: string }[];
  /** Records the order of write calls ("turn.create:learner", "turn.delete", "session.update:STATUS", ...). */
  log: string[];
}

function pick<T extends object>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...row };
  const out: Partial<T> = {};
  for (const k of Object.keys(select)) if (select[k]) (out as Record<string, unknown>)[k] = (row as Record<string, unknown>)[k];
  return out;
}

function uniqueViolation(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

export function makeFakeDb(init: Partial<FakeState> = {}): { db: ConversationDb; state: FakeState } {
  const state: FakeState = {
    lessons: [],
    sessions: [],
    turns: [],
    profile: { level: "B1", interests: "hiking, films" },
    grammarTopics: [],
    vocab: [],
    log: [],
    ...init,
  };
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;

  const findSession = (where: { id?: string; lessonId_mode?: { lessonId: string; mode: string } }) =>
    where.id
      ? state.sessions.find((s) => s.id === where.id)
      : state.sessions.find((s) => s.lessonId === where.lessonId_mode?.lessonId && s.mode === where.lessonId_mode?.mode);

  const createTurn = (data: Omit<Partial<FakeTurn>, "id">): FakeTurn => {
    const row: FakeTurn = {
      id: nextId("t"),
      lessonId: data.lessonId!,
      sessionId: data.sessionId ?? null,
      role: data.role!,
      text: data.text!,
      turnIndex: data.turnIndex ?? 0,
      corrections: data.corrections ?? null,
      createdAt: new Date(),
    };
    state.turns.push(row);
    state.log.push(`turn.create:${row.role}`);
    return row;
  };

  const db = {
    lesson: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = state.lessons.find((l) => l.id === where.id);
        return row ? pick(row, select) : null;
      },
    },
    conversationSession: {
      findUnique: async ({ where, select }: { where: Parameters<typeof findSession>[0]; select?: Record<string, boolean> }) => {
        const row = findSession(where);
        return row ? pick(row, select) : null;
      },
      create: async ({ data }: { data: Partial<FakeSession> & { turns?: { create: Omit<Partial<FakeTurn>, "id"> } } }) => {
        if (state.sessions.some((s) => s.lessonId === data.lessonId && s.mode === data.mode)) throw uniqueViolation();
        const row: FakeSession = {
          id: nextId("s"),
          lessonId: data.lessonId!,
          mode: data.mode!,
          status: data.status ?? "ACTIVE",
          review: data.review ?? null,
          createdAt: new Date(),
          endedAt: data.endedAt ?? null,
        };
        state.sessions.push(row);
        state.log.push(`session.create:${row.status}`);
        if (data.turns?.create) createTurn({ ...data.turns.create, sessionId: row.id });
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeSession> }) => {
        const row = state.sessions.find((s) => s.id === where.id);
        if (!row) throw new Error("Record to update not found");
        Object.assign(row, data);
        state.log.push(`session.update:${row.status}`);
        return { ...row };
      },
    },
    conversationTurn: {
      findMany: async ({ where, select }: { where: { sessionId: string }; select?: Record<string, boolean> }) =>
        state.turns
          .filter((t) => t.sessionId === where.sessionId)
          .sort((a, b) => a.turnIndex - b.turnIndex)
          .map((t) => pick(t, select)),
      create: async ({ data }: { data: Omit<Partial<FakeTurn>, "id"> }) => ({ ...createTurn(data) }),
      delete: async ({ where }: { where: { id: string } }) => {
        const i = state.turns.findIndex((t) => t.id === where.id);
        if (i < 0) throw new Error("Record to delete does not exist");
        const [row] = state.turns.splice(i, 1);
        state.log.push("turn.delete");
        return row;
      },
    },
    profile: {
      findFirst: async () => (state.profile ? { ...state.profile } : null),
    },
    grammarTopic: {
      findUnique: async ({ where }: { where: { id: string } }) => state.grammarTopics.find((g) => g.id === where.id) ?? null,
    },
    vocabItem: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => state.vocab.filter((v) => where.id.in.includes(v.id)),
    },
  };

  return { db: db as unknown as ConversationDb, state };
}
