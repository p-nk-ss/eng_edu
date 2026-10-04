// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("@/lib/llm", () => ({ stream: vi.fn() }));

import type { CompleteArgs } from "../llm/types";
import { makeFakeDb, type FakeState } from "./fakeConversationDb";
import { MAX_TURN_CHARS } from "./rules";
import { LessonNotFoundError, PartnerUnavailableError, startWarmup, TurnRejectedError } from "./session";
import { __resetInFlight, runTurn } from "./turn";

const INTRO = "Hi! Let us talk about your working day and what you enjoy about it.";
const WRAP = "This is the last reply";
const lesson = {
  id: "L1",
  theme: "work",
  plan: {
    sections: { warmup: { intro: INTRO, questions: ["What do you do at work?", "Who do you work with?"] } },
    meta: { grammarTopicId: "g1", vocabIds: ["v1", "v2"] },
  },
};

async function readAll(s: ReadableStream<Uint8Array>): Promise<string> {
  const reader = s.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

function gen(chunks: string[], failAfter?: number) {
  return async function* (): AsyncGenerator<string> {
    for (let i = 0; i < chunks.length; i++) {
      if (failAfter !== undefined && i === failAfter) throw new Error("socket closed");
      yield chunks[i];
    }
    if (failAfter !== undefined && failAfter >= chunks.length) throw new Error("socket closed");
  };
}

async function setup(extra: Partial<FakeState> = {}) {
  const fake = makeFakeDb({
    lessons: [lesson],
    grammarTopics: [{ id: "g1", title: "Present Perfect", name: "RAW", description: "Past with present result." }],
    vocab: [
      { id: "v1", headword: "deadline" },
      { id: "v2", headword: "colleague" },
    ],
    ...extra,
  });
  await startWarmup("L1", fake.db);
  fake.state.log.length = 0;
  return fake;
}

function addLearnerTurns(state: FakeState, n: number) {
  const sid = state.sessions[0].id;
  let idx = Math.max(...state.turns.map((t) => t.turnIndex));
  for (let i = 0; i < n; i++) {
    state.turns.push({ id: `l${i}`, lessonId: "L1", sessionId: sid, role: "learner", text: `answer ${i}`, turnIndex: ++idx, corrections: null, createdAt: new Date() });
    state.turns.push({ id: `p${i}`, lessonId: "L1", sessionId: sid, role: "partner", text: `reply ${i}`, turnIndex: ++idx, corrections: null, createdAt: new Date() });
  }
}

beforeEach(() => __resetInFlight());

describe("runTurn - validation", () => {
  it("rejects empty and whitespace-only text as invalid", async () => {
    const { db } = await setup();
    for (const text of ["", "   \n "]) {
      const err = await runTurn("L1", text, { db, stream: gen(["x"]) }).catch((e) => e);
      expect(err).toBeInstanceOf(TurnRejectedError);
      expect(err.reason).toBe("invalid");
    }
  });

  it(`rejects text longer than ${MAX_TURN_CHARS} chars as invalid`, async () => {
    const { db } = await setup();
    const err = await runTurn("L1", "a".repeat(MAX_TURN_CHARS + 1), { db, stream: gen(["x"]) }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnRejectedError);
    expect(err.reason).toBe("invalid");
  });

  it("missing lesson -> LessonNotFoundError", async () => {
    const { db } = await setup();
    await expect(runTurn("nope", "hello", { db, stream: gen(["x"]) })).rejects.toBeInstanceOf(LessonNotFoundError);
  });

  it("SKIPPED session -> closed", async () => {
    const { db, state } = await setup();
    state.sessions[0].status = "SKIPPED";
    const err = await runTurn("L1", "hello", { db, stream: gen(["x"]) }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnRejectedError);
    expect(err.reason).toBe("closed");
  });

  it("no session yet -> closed", async () => {
    const { db } = makeFakeDb({ lessons: [lesson] });
    const err = await runTurn("L1", "hello", { db, stream: gen(["x"]) }).catch((e) => e);
    expect(err.reason).toBe("closed");
  });

  it("12 learner turns -> limit", async () => {
    const { db, state } = await setup();
    addLearnerTurns(state, 12);
    const err = await runTurn("L1", "hello", { db, stream: gen(["x"]) }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnRejectedError);
    expect(err.reason).toBe("limit");
  });
});

describe("runTurn - streaming", () => {
  it("persists the learner turn before calling the provider, streams deltas unchanged, then persists the partner turn", async () => {
    const { db, state } = await setup();
    let seenAtCall: { role: string; text: string; turnIndex: number }[] = [];
    let args: CompleteArgs | null = null;
    const stream = (a: CompleteArgs) => {
      args = a;
      seenAtCall = state.turns.map((t) => ({ role: t.role, text: t.text, turnIndex: t.turnIndex }));
      return gen(["Oh nice", ", tell me", " more!"])();
    };
    const s = await runTurn("L1", "  I work as a nurse.  ", { db, stream });
    expect(seenAtCall).toEqual([
      { role: "partner", text: INTRO, turnIndex: 0 },
      { role: "learner", text: "I work as a nurse.", turnIndex: 1 },
    ]);
    expect(await readAll(s)).toBe("Oh nice, tell me more!");
    const turns = state.turns.sort((a, b) => a.turnIndex - b.turnIndex);
    expect(turns.map((t) => [t.role, t.text, t.turnIndex])).toEqual([
      ["partner", INTRO, 0],
      ["learner", "I work as a nurse.", 1],
      ["partner", "Oh nice, tell me more!", 2],
    ]);
    expect(turns.every((t) => t.sessionId === state.sessions[0].id && t.lessonId === "L1")).toBe(true);
    // prompt built from lesson data and full history
    const a = args as unknown as CompleteArgs;
    expect(a.messages).toEqual([
      { role: "assistant", content: INTRO },
      { role: "user", content: "I work as a nurse." },
    ]);
    expect(a.system).toContain("Work & careers");
    expect(a.system).toContain("B1");
    expect(a.system).toContain("hiking, films");
    expect(a.system).toContain("Present Perfect (Past with present result.)");
    expect(a.system).toContain("deadline, colleague");
    expect(a.system).toContain("Who do you work with?");
    expect(a.system).not.toContain(WRAP);
  });

  it("asks the partner to wrap up exactly on the 8th learner turn", async () => {
    for (const [prior, expected] of [[6, false], [7, true], [8, false]] as const) {
      __resetInFlight();
      const { db, state } = await setup();
      addLearnerTurns(state, prior);
      const spy = vi.fn((a: CompleteArgs) => gen(["ok"])());
      await readAll(await runTurn("L1", "hello", { db, stream: spy }));
      expect(spy.mock.calls[0][0].system?.includes(WRAP)).toBe(expected);
    }
  });

  it("early failure removes the learner turn and marks the session UNAVAILABLE", async () => {
    const { db, state } = await setup();
    const err = await runTurn("L1", "hello", { db, stream: gen(["never"], 0) }).catch((e) => e);
    expect(err).toBeInstanceOf(PartnerUnavailableError);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].role).toBe("partner");
    expect(state.sessions[0].status).toBe("UNAVAILABLE");
    expect(state.log).toEqual(["turn.create:learner", "turn.delete", "session.update:UNAVAILABLE"]);
  });

  it("early failure when the provider throws synchronously is also PartnerUnavailableError", async () => {
    const { db, state } = await setup();
    const stream = () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(runTurn("L1", "hello", { db, stream })).rejects.toBeInstanceOf(PartnerUnavailableError);
    expect(state.turns).toHaveLength(1);
  });

  it("failure after one delta ends the stream with the marker and keeps the partial text (no marker) as the partner turn", async () => {
    const { db, state } = await setup();
    const s = await runTurn("L1", "hello", { db, stream: gen(["Partial reply", " more"], 1) });
    expect(await readAll(s)).toBe("Partial reply\n[connection lost]");
    const partner = state.turns.filter((t) => t.role === "partner" && t.turnIndex === 2);
    expect(partner).toHaveLength(1);
    expect(partner[0].text).toBe("Partial reply");
    expect(state.turns.find((t) => t.role === "learner")?.text).toBe("hello");
  });

  it("single-flight: a second turn while the first is unread is busy; after it completes a new turn is accepted", async () => {
    const { db, state } = await setup();
    const first = await runTurn("L1", "one", { db, stream: gen(["a", "b"]) });
    const err = await runTurn("L1", "two", { db, stream: gen(["x"]) }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnRejectedError);
    expect(err.reason).toBe("busy");
    expect(state.turns.filter((t) => t.role === "learner")).toHaveLength(1);
    expect(await readAll(first)).toBe("ab");
    const second = await runTurn("L1", "two", { db, stream: gen(["c"]) });
    expect(await readAll(second)).toBe("c");
    expect(state.turns.sort((a, b) => a.turnIndex - b.turnIndex).map((t) => t.text)).toEqual([INTRO, "one", "ab", "two", "c"]);
  });

  it("releases the guard after an early failure and after a consumer cancel", async () => {
    const { db } = await setup();
    await runTurn("L1", "one", { db, stream: gen([], 0) }).catch(() => undefined);
    const s = await runTurn("L1", "two", { db, stream: gen(["a", "b", "c"]) });
    await s.cancel();
    const again = await runTurn("L1", "three", { db, stream: gen(["ok"]) });
    expect(await readAll(again)).toBe("ok");
  });

  it("releases the guard when the turn is rejected", async () => {
    const { db, state } = await setup();
    state.sessions[0].status = "SKIPPED";
    await runTurn("L1", "one", { db, stream: gen(["a"]) }).catch(() => undefined);
    state.sessions[0].status = "ACTIVE";
    expect(await readAll(await runTurn("L1", "two", { db, stream: gen(["a"]) }))).toBe("a");
  });

  it("an UNAVAILABLE session becomes ACTIVE again on a successful turn", async () => {
    const { db, state } = await setup();
    state.sessions[0].status = "UNAVAILABLE";
    await readAll(await runTurn("L1", "hello", { db, stream: gen(["hi"]) }));
    expect(state.sessions[0].status).toBe("ACTIVE");
  });
});
