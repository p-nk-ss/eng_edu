# M4a — Topic Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the last written exercise of a lesson is answered, store the written-block score and advance the lesson's grammar topic (`INTRODUCED → PRACTICING → MASTERED`), park topics that do not stick, and show topic progress on the lesson intro.

**Architecture:** Per-lesson results live on `Lesson` (`writtenScore`, `writtenCompletedAt`); a pure function derives the topic's status and cached counters from the history of completed lessons. Completion runs inside the existing answer transaction (`recordAnswer`). Selection reads the cached counters to park stuck topics. A one-off backfill script scores lessons completed before M4a.

**Tech Stack:** TypeScript, Prisma 7 (local PostgreSQL, JSON path filters), Vitest, Next.js 15 (intro component).

**Spec:** `docs/superpowers/specs/2026-09-26-m4a-topic-advancement-design.md` (read it first).

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean (vitest does not type-check).
- **Commit messages:** `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"` — exactly this trailer and nothing else; check with `git log -1 --format=%B`.
- Branch `feature/m4-spaced-repetition`; Windows PowerShell 5.1 (no `&&`) or Git Bash. Never touch `main`, never push.
- **No new npm dependencies.** Never `git add` `skills-lock.json`, `AGENTS.md` or anything under `.superpowers/`.
- Pure-logic test files start with `// @vitest-environment node`.
- Prisma queries **sequential** (no `Promise.all`), also inside `$transaction`; no network inside a transaction.
- Thresholds (verbatim from the spec): `GOOD_LESSON_SCORE = 0.8`, `LESSONS_TO_MASTER = 3`, `LESSONS_TO_MASTER_BELOW_LEVEL = 1`, `PARK_AFTER_LESSONS = 5`.
- `MASTERED` is never reverted. `Lesson.status` is not changed by completion.
- The DB holds real data (the owner's answered lesson). The only migration is additive. **No task writes to the real DB except the Task 6 backfill, and that run waits for the owner (⛔ gate).**
- UI (Task 5): semantic tokens only, ASCII or `\u` escapes for typographic characters, state never colour alone.

## Review Focus

1. **The last answer is wrong** → the block still completes and the score counts the wrong answer (e.g. 6/7). *(Task 2 test "completes on a wrong last answer")*
2. **A repeated or lost-race submit of the last exercise** → completion runs at most once; `writtenCompletedAt` is written by a conditional update. *(Task 2 tests "never completes twice" and "not reached when the answer was not recorded")*
3. **A planned exercise id missing from the DB, or an exercise whose content does not parse** → it neither blocks completion nor counts in the score. *(Task 2 test "ignores missing and unparsable exercises")*
4. **A hard below-level core topic that got parked** → it no longer blocks the learner's own level. *(Task 3 test "below-level shortcut skips parked topics")*
5. **A completed lesson that still has unanswered exercises** (review exercises arrive in M4b) → Start does not reopen it. *(Task 4 test "a completed written block is not resumable")*

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration | `Lesson.writtenScore/writtenCompletedAt`, `GrammarTopic.lessonsCompleted/goodLessons` |
| `src/lib/curriculum/advancement.ts` | pure rules: `writtenBlockScore`, `nextTopicState`, constants |
| `src/lib/curriculum/completeLesson.ts` | `completeWrittenBlockIfDone`, `recomputeTopic` (transaction helpers) |
| `src/lib/grading/recordAnswer.ts` | calls completion after the answer write |
| `src/lib/curriculum/select.ts` | parked topics ranked last; below-level shortcut skips them |
| `src/lib/lesson/resumable.ts` | resume only lessons whose written block is not complete |
| `src/lib/lesson/loadLesson.ts`, `src/components/lesson/LessonIntro.tsx` | topic progress on the intro |
| `scripts/backfill-lessons.ts` | `npm run lessons:backfill` |

---

### Task 1: Migration + pure advancement rules

**Files:**
- Modify: `prisma/schema.prisma` (`model Lesson`, `model GrammarTopic`); generated migration
- Create: `src/lib/curriculum/advancement.ts`, `src/lib/curriculum/advancement.test.ts`

**Interfaces:**
- Produces: `GOOD_LESSON_SCORE`, `LESSONS_TO_MASTER`, `LESSONS_TO_MASTER_BELOW_LEVEL`, `PARK_AFTER_LESSONS`; `type TopicStatusName = "NOT_STARTED" | "INTRODUCED" | "PRACTICING" | "MASTERED"`; `writtenBlockScore(items: { answered: boolean; correct: boolean | null }[]): { complete: boolean; score: number | null }`; `lessonsToMaster(belowLevelCore: boolean): number`; `nextTopicState(current: TopicStatusName, scores: number[], opts: { belowLevelCore: boolean }): { status: TopicStatusName; lessonsCompleted: number; goodLessons: number }`; `isParked(t: { status: string; lessonsCompleted: number }): boolean`.

- [ ] **Step 1: Migration.** In `model Lesson` after `nextPlan`:

```prisma
  writtenScore       Float? // share of correct written answers 0..1 (M4a); null until the written block is complete
  writtenCompletedAt DateTime? // set once, when the last written exercise is answered
```

In `model GrammarTopic` after `importance`:

```prisma
  lessonsCompleted Int @default(0) // cache (M4a): completed lessons with this focus, derived from Lesson history
  goodLessons      Int @default(0) // cache (M4a): of those, writtenScore >= 0.8
```

`npx prisma format`, `npm run db:start`, `npx prisma migrate dev --name m4a_topic_advancement`. Expected: four `ADD COLUMN` statements only. Drift or a reset prompt → STOP and report BLOCKED.

- [ ] **Step 2: Write the failing test** (`src/lib/curriculum/advancement.test.ts`)

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isParked, lessonsToMaster, nextTopicState, writtenBlockScore } from "./advancement";

const item = (answered: boolean, correct: boolean | null = answered ? true : null) => ({ answered, correct });

describe("writtenBlockScore", () => {
  it("is incomplete while any item is unanswered", () => {
    expect(writtenBlockScore([item(true), item(false)])).toEqual({ complete: false, score: null });
  });
  it("scores correct / total once every item is answered", () => {
    expect(writtenBlockScore([item(true, true), item(true, false), item(true, true), item(true, true)])).toEqual({ complete: true, score: 0.75 });
  });
  it("counts a missing verdict as not correct", () => {
    expect(writtenBlockScore([item(true, true), item(true, null)])).toEqual({ complete: true, score: 0.5 });
  });
  it("an empty block never completes", () => {
    expect(writtenBlockScore([])).toEqual({ complete: false, score: null });
  });
});

describe("nextTopicState", () => {
  const std = { belowLevelCore: false };
  it("leaves a topic without completed lessons as it is", () => {
    expect(nextTopicState("INTRODUCED", [], std)).toEqual({ status: "INTRODUCED", lessonsCompleted: 0, goodLessons: 0 });
    expect(nextTopicState("NOT_STARTED", [], std)).toEqual({ status: "NOT_STARTED", lessonsCompleted: 0, goodLessons: 0 });
  });
  it("moves to PRACTICING after the first completed lesson, even a weak one", () => {
    expect(nextTopicState("INTRODUCED", [0.71], std)).toEqual({ status: "PRACTICING", lessonsCompleted: 1, goodLessons: 0 });
  });
  it("masters after 3 good lessons, not necessarily consecutive", () => {
    expect(nextTopicState("PRACTICING", [0.85, 0.6, 0.9], std).status).toBe("PRACTICING");
    expect(nextTopicState("PRACTICING", [0.85, 0.6, 0.9, 0.8], std)).toEqual({ status: "MASTERED", lessonsCompleted: 4, goodLessons: 3 });
  });
  it("treats exactly 80% as good", () => {
    expect(nextTopicState("PRACTICING", [0.8, 0.8, 0.8], std).status).toBe("MASTERED");
    expect(nextTopicState("PRACTICING", [0.79, 0.8, 0.8], std).status).toBe("PRACTICING");
  });
  it("masters a below-level core topic after one good lesson", () => {
    expect(nextTopicState("INTRODUCED", [0.86], { belowLevelCore: true })).toEqual({ status: "MASTERED", lessonsCompleted: 1, goodLessons: 1 });
    expect(nextTopicState("INTRODUCED", [0.71], { belowLevelCore: true }).status).toBe("PRACTICING");
  });
  it("never reverts MASTERED", () => {
    expect(nextTopicState("MASTERED", [0.1], std)).toEqual({ status: "MASTERED", lessonsCompleted: 1, goodLessons: 0 });
  });
});

describe("lessonsToMaster / isParked", () => {
  it("needs 1 or 3 good lessons", () => {
    expect(lessonsToMaster(true)).toBe(1);
    expect(lessonsToMaster(false)).toBe(3);
  });
  it("parks a PRACTICING topic after 5 completed lessons", () => {
    expect(isParked({ status: "PRACTICING", lessonsCompleted: 4 })).toBe(false);
    expect(isParked({ status: "PRACTICING", lessonsCompleted: 5 })).toBe(true);
    expect(isParked({ status: "INTRODUCED", lessonsCompleted: 9 })).toBe(false);
    expect(isParked({ status: "MASTERED", lessonsCompleted: 9 })).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/lib/curriculum/advancement.test.ts` → FAIL, module missing.

- [ ] **Step 4: Implement** (`src/lib/curriculum/advancement.ts`)

```ts
export const GOOD_LESSON_SCORE = 0.8;
export const LESSONS_TO_MASTER = 3;
export const LESSONS_TO_MASTER_BELOW_LEVEL = 1;
export const PARK_AFTER_LESSONS = 5;

export type TopicStatusName = "NOT_STARTED" | "INTRODUCED" | "PRACTICING" | "MASTERED";

/** The written block is complete when every playable written exercise has an answer. */
export function writtenBlockScore(items: { answered: boolean; correct: boolean | null }[]): { complete: boolean; score: number | null } {
  if (items.length === 0 || items.some((i) => !i.answered)) return { complete: false, score: null };
  return { complete: true, score: items.filter((i) => i.correct === true).length / items.length };
}

export const lessonsToMaster = (belowLevelCore: boolean): number => (belowLevelCore ? LESSONS_TO_MASTER_BELOW_LEVEL : LESSONS_TO_MASTER);

/** Status and cached counters derived from the writtenScore history of completed lessons with this focus. */
export function nextTopicState(
  current: TopicStatusName,
  scores: number[],
  opts: { belowLevelCore: boolean },
): { status: TopicStatusName; lessonsCompleted: number; goodLessons: number } {
  const lessonsCompleted = scores.length;
  const goodLessons = scores.filter((s) => s >= GOOD_LESSON_SCORE).length;
  let status = current;
  if (current !== "MASTERED" && lessonsCompleted > 0) {
    status = goodLessons >= lessonsToMaster(opts.belowLevelCore) ? "MASTERED" : "PRACTICING";
  }
  return { status, lessonsCompleted, goodLessons };
}

/** A topic that did not stick after PARK_AFTER_LESSONS lessons is chosen only after untouched topics. */
export const isParked = (t: { status: string; lessonsCompleted: number }): boolean =>
  t.status === "PRACTICING" && t.lessonsCompleted >= PARK_AFTER_LESSONS;
```

- [ ] **Step 5: Run to verify it passes** — PASS (11 tests); `npx prisma generate` if tsc does not know the new columns.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add prisma/schema.prisma prisma/migrations src/lib/curriculum/advancement.ts src/lib/curriculum/advancement.test.ts
git commit -m "feat(m4a): lesson score and topic counters columns, pure advancement rules" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: Completion inside the answer transaction

**Files:**
- Create: `src/lib/curriculum/completeLesson.ts`, `src/lib/curriculum/completeLesson.test.ts`
- Modify: `src/lib/grading/recordAnswer.ts`, `src/lib/grading/recordAnswer.test.ts`, `src/lib/grading/checkAnswer.test.ts` (its fake `tx` gains `lesson.findUnique` returning `null`)

**Interfaces:**
- Consumes: Task 1 (`writtenBlockScore`, `nextTopicState`, `TopicStatusName`); `parseExercise` (`src/lib/lesson/exerciseSchemas.ts`); `LessonPlan` (`src/lib/lesson/createLesson.ts`); `isBelowLevel` (`src/lib/lesson/levels.ts`).
- Produces: `type CompletionTx = Pick<Prisma.TransactionClient, "lesson" | "exercise" | "grammarTopic" | "profile">`; `completeWrittenBlockIfDone(tx: CompletionTx, lessonId: string, completedAt: Date): Promise<{ completed: boolean; score: number | null }>`; `recomputeTopic(tx: CompletionTx, topicId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** (`src/lib/curriculum/completeLesson.test.ts`)

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { completeWrittenBlockIfDone, recomputeTopic, type CompletionTx } from "./completeLesson";

const now = new Date("2026-09-26T10:00:00Z");
const plan = (ids: string[], grammarTopicId: string | null = "g1") => ({ sections: { written: { exerciseIds: ids } }, meta: { grammarTopicId } });
const ex = (answered: boolean, isCorrect: boolean | null, content: unknown = E.MULTIPLE_CHOICE) => ({ content, answeredAt: answered ? now : null, isCorrect });

function fakeTx(o: {
  lesson?: unknown; exercises?: unknown[]; updated?: number; topic?: unknown; profile?: unknown; history?: unknown[];
} = {}) {
  const log: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, value: unknown) =>
    vi.fn(async (args: unknown) => {
      log.push(name);
      (calls[name] ??= []).push(args);
      return value;
    });
  const tx = {
    lesson: {
      findUnique: rec("lesson.findUnique", o.lesson === undefined ? { plan: plan(["e1", "e2"]), writtenCompletedAt: null } : o.lesson),
      updateMany: rec("lesson.updateMany", { count: o.updated ?? 1 }),
      findMany: rec("lesson.findMany", o.history ?? [{ writtenScore: 0.5 }]),
    },
    exercise: { findMany: rec("exercise.findMany", o.exercises ?? [ex(true, true), ex(true, false)]) },
    grammarTopic: {
      findUnique: rec("grammarTopic.findUnique", o.topic === undefined ? { status: "INTRODUCED", cefrLevel: "A2", importance: 1 } : o.topic),
      update: rec("grammarTopic.update", {}),
    },
    profile: { findFirst: rec("profile.findFirst", o.profile === undefined ? { level: "B1" } : o.profile) },
  };
  return { tx: tx as unknown as CompletionTx, log, calls };
}

describe("completeWrittenBlockIfDone", () => {
  it("does nothing while an exercise is unanswered", async () => {
    const f = fakeTx({ exercises: [ex(true, true), ex(false, null)] });
    expect(await completeWrittenBlockIfDone(f.tx, "L1", now)).toEqual({ completed: false, score: null });
    expect(f.calls["lesson.updateMany"]).toBeUndefined();
  });

  it("completes on a wrong last answer, stores the score once and recomputes the focus topic", async () => {
    const f = fakeTx();
    expect(await completeWrittenBlockIfDone(f.tx, "L1", now)).toEqual({ completed: true, score: 0.5 });
    expect(f.calls["exercise.findMany"][0]).toEqual({
      where: { lessonId: "L1", id: { in: ["e1", "e2"] } },
      select: { content: true, answeredAt: true, isCorrect: true },
    });
    expect(f.calls["lesson.updateMany"][0]).toEqual({ where: { id: "L1", writtenCompletedAt: null }, data: { writtenScore: 0.5, writtenCompletedAt: now } });
    expect(f.log).toContain("grammarTopic.update");
  });

  it("ignores missing and unparsable exercises", async () => {
    const f = fakeTx({ lesson: { plan: plan(["e1", "ghost", "bad"]), writtenCompletedAt: null }, exercises: [ex(true, true), ex(false, null, { type: "mcq" })] });
    expect(await completeWrittenBlockIfDone(f.tx, "L1", now)).toEqual({ completed: true, score: 1 });
  });

  it("never completes twice", async () => {
    const done = fakeTx({ lesson: { plan: plan(["e1"]), writtenCompletedAt: now } });
    expect(await completeWrittenBlockIfDone(done.tx, "L1", now)).toEqual({ completed: false, score: null });
    expect(done.calls["exercise.findMany"]).toBeUndefined();
    const raced = fakeTx({ updated: 0 });
    expect(await completeWrittenBlockIfDone(raced.tx, "L1", now)).toEqual({ completed: false, score: null });
    expect(raced.calls["grammarTopic.update"]).toBeUndefined();
  });

  it("stores the score of a lesson without a grammar focus and touches no topic", async () => {
    const f = fakeTx({ lesson: { plan: plan(["e1", "e2"], null), writtenCompletedAt: null } });
    expect((await completeWrittenBlockIfDone(f.tx, "L1", now)).completed).toBe(true);
    expect(f.calls["grammarTopic.findUnique"]).toBeUndefined();
  });

  it("does nothing for an unknown lesson or an empty written block", async () => {
    expect(await completeWrittenBlockIfDone(fakeTx({ lesson: null }).tx, "L1", now)).toEqual({ completed: false, score: null });
    const empty = fakeTx({ lesson: { plan: plan([]), writtenCompletedAt: null } });
    expect(await completeWrittenBlockIfDone(empty.tx, "L1", now)).toEqual({ completed: false, score: null });
  });
});

describe("recomputeTopic", () => {
  it("derives status and counters from completed lessons with this focus", async () => {
    const f = fakeTx({ topic: { status: "INTRODUCED", cefrLevel: "B1", importance: 2 }, history: [{ writtenScore: 0.71 }] });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["lesson.findMany"][0]).toEqual({
      where: { writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: "g1" } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { writtenScore: true },
    });
    expect(f.calls["grammarTopic.update"][0]).toEqual({ where: { id: "g1" }, data: { status: "PRACTICING", lessonsCompleted: 1, goodLessons: 0 } });
  });

  it("masters a below-level core topic after one good lesson", async () => {
    const f = fakeTx({ topic: { status: "INTRODUCED", cefrLevel: "A2", importance: 1 }, history: [{ writtenScore: 0.86 }] });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["grammarTopic.update"][0]).toMatchObject({ data: { status: "MASTERED", goodLessons: 1 } });
  });

  it("needs three good lessons when the profile is missing", async () => {
    const f = fakeTx({ topic: { status: "INTRODUCED", cefrLevel: "A2", importance: 1 }, profile: null, history: [{ writtenScore: 0.9 }] });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["grammarTopic.update"][0]).toMatchObject({ data: { status: "PRACTICING" } });
  });

  it("skips a missing topic", async () => {
    const f = fakeTx({ topic: null });
    await recomputeTopic(f.tx, "g1");
    expect(f.calls["grammarTopic.update"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module missing.

- [ ] **Step 3: Implement** (`src/lib/curriculum/completeLesson.ts`)

```ts
import type { Prisma } from "@prisma/client";
import type { LessonPlan } from "../lesson/createLesson";
import { parseExercise } from "../lesson/exerciseSchemas";
import { isBelowLevel } from "../lesson/levels";
import { nextTopicState, writtenBlockScore, type TopicStatusName } from "./advancement";

export type CompletionTx = Pick<Prisma.TransactionClient, "lesson" | "exercise" | "grammarTopic" | "profile">;

const NOT_DONE = { completed: false, score: null } as const;

/**
 * Called inside the answer transaction after an answer is recorded. When every playable written
 * exercise is answered, stores the score once (conditional update) and recomputes the focus topic.
 */
export async function completeWrittenBlockIfDone(
  tx: CompletionTx,
  lessonId: string,
  completedAt: Date,
): Promise<{ completed: boolean; score: number | null }> {
  const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { plan: true, writtenCompletedAt: true } });
  if (!lesson || lesson.writtenCompletedAt) return NOT_DONE;
  const plan = lesson.plan as unknown as Partial<LessonPlan> | null;
  const ids = plan?.sections?.written?.exerciseIds ?? [];
  if (ids.length === 0) return NOT_DONE;

  const rows = await tx.exercise.findMany({
    where: { lessonId, id: { in: ids } },
    select: { content: true, answeredAt: true, isCorrect: true },
  });
  const items = rows
    .filter((r) => parseExercise(r.content).ok)
    .map((r) => ({ answered: r.answeredAt !== null, correct: r.isCorrect }));
  const { complete, score } = writtenBlockScore(items);
  if (!complete || score === null) return NOT_DONE;

  const updated = await tx.lesson.updateMany({
    where: { id: lessonId, writtenCompletedAt: null },
    data: { writtenScore: score, writtenCompletedAt: completedAt },
  });
  if (updated.count === 0) return NOT_DONE;

  const topicId = plan?.meta?.grammarTopicId ?? null;
  if (topicId) await recomputeTopic(tx, topicId);
  return { completed: true, score };
}

/** Re-derives the topic's status and cached counters from the history of completed lessons. */
export async function recomputeTopic(tx: CompletionTx, topicId: string): Promise<void> {
  const topic = await tx.grammarTopic.findUnique({ where: { id: topicId }, select: { status: true, cefrLevel: true, importance: true } });
  if (!topic) return;
  const profile = await tx.profile.findFirst({ orderBy: { updatedAt: "desc" }, select: { level: true } });
  const lessons = await tx.lesson.findMany({
    where: { writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: topicId } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { writtenScore: true },
  });
  const scores = lessons.flatMap((l) => (l.writtenScore === null ? [] : [l.writtenScore]));
  const belowLevelCore = topic.importance === 1 && profile !== null && isBelowLevel(topic.cefrLevel, profile.level);
  const next = nextTopicState(topic.status as TopicStatusName, scores, { belowLevelCore });
  await tx.grammarTopic.update({ where: { id: topicId }, data: next });
}
```

- [ ] **Step 4: Wire into `recordAnswer`.** Add `import { completeWrittenBlockIfDone } from "../curriculum/completeLesson";` and, in `recordAnswer`, right before `return { recorded: true, result } as const;`:

```ts
    await completeWrittenBlockIfDone(tx, input.lessonId, input.now);
```

(After `updated.count === 0` returns early, completion is never reached for a lost race — Review Focus 2.)

Update `src/lib/grading/recordAnswer.test.ts`: its fake `tx.lesson` gains `findUnique: rec("lesson.findUnique", null)`; the ordered log in the first test ends with `"lesson.findUnique"`; add:

```ts
  it("checks the written block after recording, inside the transaction", async () => {
    const f = fakeDb();
    await recordAnswer(f.db, input());
    expect(f.log[f.log.length - 1]).toBe("lesson.findUnique");
    expect(f.calls["lesson.findUnique"][0]).toMatchObject({ where: { id: "L1" } });
  });

  it("does not check the written block when the answer was not recorded", async () => {
    const f = fakeDb({ count: 0 });
    await recordAnswer(f.db, input());
    expect(f.log).not.toContain("lesson.findUnique");
  });
```

In `src/lib/grading/checkAnswer.test.ts` the fake `tx.lesson` gains `findUnique: vi.fn(async () => null)` so existing tests keep passing.

- [ ] **Step 5: Run to verify it passes** — `npx vitest run src/lib/curriculum/completeLesson.test.ts src/lib/grading` → PASS.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/curriculum/completeLesson.ts src/lib/curriculum/completeLesson.test.ts src/lib/grading/recordAnswer.ts src/lib/grading/recordAnswer.test.ts src/lib/grading/checkAnswer.test.ts
git commit -m "feat(m4a): complete the written block and advance the topic in the answer transaction" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Park topics that do not stick

**Files:**
- Modify: `src/lib/curriculum/select.ts`, `src/lib/curriculum/select.test.ts`, `src/lib/curriculum/lessonInputs.ts` (only if its mapping drops the field)

**Interfaces:**
- Consumes: `isParked` (Task 1).
- Produces: `GrammarCandidate.lessonsCompleted: number`.

- [ ] **Step 1: Write the failing tests.** In `select.test.ts` the helper `G(...)` gains `lessonsCompleted: 0` in its default object (extend its `extra` type to include `"lessonsCompleted"`). Add:

```ts
  it("ranks a parked topic after untouched topics", () => {
    const topics = [
      G("stuck", "B1", "PRACTICING", 1, 0, { lessonsCompleted: 5 }),
      G("fresh", "B1", "NOT_STARTED", 9, 0),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("fresh");
  });

  it("still picks a parked topic when nothing else is left in the band", () => {
    expect(pickGrammarFocus([G("stuck", "B1", "PRACTICING", 1, 0, { lessonsCompleted: 6 })], "B1")?.name).toBe("stuck");
  });

  it("below-level shortcut skips parked topics", () => {
    const topics = [
      G("hard-a2", "A2", "PRACTICING", 1, 0, { importance: 1, lessonsCompleted: 5 }),
      G("b1-topic", "B1", "NOT_STARTED", 1, 0),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("b1-topic");
  });
```

- [ ] **Step 2: Run to verify they fail** — FAIL (TS error on `lessonsCompleted` or wrong picks).

- [ ] **Step 3: Implement.** In `select.ts`: add `lessonsCompleted: number` to `GrammarCandidate` (doc: "completed lessons with this focus (M4a); a PRACTICING topic with >= PARK_AFTER_LESSONS is parked"); import `isParked` from `./advancement`; change

```ts
const grammarRank = (t: GrammarCandidate): number =>
  isParked(t) ? 4 : t.status === "PRACTICING" ? (t.openErrors > 0 ? 0 : 1) : t.status === "INTRODUCED" ? 2 : 3;
```

and in `pickGrammarFocus` the below-level pool:

```ts
    const core = open.filter((t) => t.cefrLevel === below && t.importance === 1 && !isParked(t));
```

`lessonInputs.ts` spreads the Prisma row (`{ ...t, openErrors }`), so `lessonsCompleted` passes through once the column exists; verify with `npx tsc --noEmit` and leave the file unchanged if it compiles.

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/lib/curriculum` → PASS.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/curriculum/select.ts src/lib/curriculum/select.test.ts
git commit -m "feat(m4a): park grammar topics that did not stick after five lessons" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: Resume only an unfinished written block

**Files:**
- Modify: `src/lib/lesson/resumable.ts`, `src/lib/lesson/resumable.test.ts`

- [ ] **Step 1: Write the failing test.** Update the existing where-clause assertion in `resumable.test.ts` to:

```ts
        OR: [
          { date: { gte: new Date(2026, 8, 25), lt: new Date(2026, 8, 26) } },
          { writtenCompletedAt: null, exercises: { some: { answeredAt: null } } },
        ],
```

and add:

```ts
  it("a completed written block is not resumable", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await findResumableLessonId({ lesson: { findFirst } } as never, now);
    const unfinished = findFirst.mock.calls[0][0].where.OR[1];
    expect(unfinished.writtenCompletedAt).toBeNull();
  });
```

Also update the matching assertion in `src/lib/lesson/startLesson.test.ts` (its reuse test checks the same `where.OR`).

- [ ] **Step 2: Run to verify they fail**, then **Step 3: implement** — in `resumable.ts` replace the second `OR` branch with `{ writtenCompletedAt: null, exercises: { some: { answeredAt: null } } }` and update the doc comment ("...or of any date while its written block is not complete (M4a)").

- [ ] **Step 4: Run to verify they pass**; **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/resumable.ts src/lib/lesson/resumable.test.ts src/lib/lesson/startLesson.test.ts
git commit -m "feat(m4a): resume a lesson only while its written block is unfinished" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 5: Topic progress on the lesson intro

**Files:**
- Modify: `src/lib/lesson/loadLesson.ts`, `src/lib/lesson/loadLesson.test.ts`, `src/components/lesson/LessonIntro.tsx`, `src/components/lesson/LessonIntro.test.tsx`; fixtures in `src/components/lesson/LessonPlayer.test.tsx` and `src/app/lesson/[id]/page.test.tsx` if they build `intro.grammar`

**Interfaces:**
- Consumes: `lessonsToMaster` (Task 1), `isBelowLevel` (`levels.ts`).
- Produces: `PlayerLessonIntro.grammar` gains `status: string; goodLessons: number; lessonsToMaster: number; lastScore: number | null`.

- [ ] **Step 1: Write the failing tests.**
  - `loadLesson.test.ts`: the fake `grammarTopic.findUnique` returns `{ title, name, cefrLevel: "A2", description, example, status: "PRACTICING", goodLessons: 0, importance: 1 }` with profile level `"B1"`, and the fake `lesson.findFirst` (new) returns `{ writtenScore: 0.714 }`. Assert `intro.grammar` toMatchObject `{ status: "PRACTICING", goodLessons: 0, lessonsToMaster: 1, lastScore: 0.714 }`; assert the `lesson.findFirst` call is `{ where: { id: { not: "L1" }, writtenCompletedAt: { not: null }, plan: { path: ["meta","grammarTopicId"], equals: "g1" } }, orderBy: [{ date: "desc" }, { id: "desc" }], select: { writtenScore: true } }`. A B1 topic with importance 2 gives `lessonsToMaster: 3`; no previous lesson gives `lastScore: null`.
  - `LessonIntro.test.tsx`: with `goodLessons: 0, lessonsToMaster: 3, lastScore: 0.714` the intro shows "0 of 3 good lessons (80%+)" and "Last time: 71%"; with `lessonsToMaster: 1` it shows "One good lesson (80%+) masters this topic"; with `lastScore: null` no "Last time" line.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** In `loadLessonForPlayer`: extend the topic `select` with `status: true, goodLessons: true, importance: true`; after the topic lesson number, when `topicId`:

```ts
  const previous = topicId
    ? await db.lesson.findFirst({
        where: { id: { not: lesson.id }, writtenCompletedAt: { not: null }, plan: { path: ["meta", "grammarTopicId"], equals: topicId } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { writtenScore: true },
      })
    : null;
```

and build `intro.grammar` with `status: topic.status`, `goodLessons: topic.goodLessons`, `lessonsToMaster: lessonsToMaster(topic.importance === 1 && profile !== null && isBelowLevel(topic.cefrLevel, profile.level))`, `lastScore: previous?.writtenScore ?? null`. In `LessonIntro.tsx`, under the "Lesson N on this topic" line, add (plain text lines, muted):

```tsx
          <p className="text-sm text-muted-foreground">
            {grammar.lessonsToMaster === 1
              ? "One good lesson (80%+) masters this topic"
              : `${grammar.goodLessons} of ${grammar.lessonsToMaster} good lessons (80%+)`}
          </p>
          {grammar.lastScore !== null && (
            <p className="text-sm text-muted-foreground">Last time: {Math.round(grammar.lastScore * 100)}%</p>
          )}
```

Update any test fixtures that construct `intro.grammar` with the four new fields.

- [ ] **Step 4: Run to verify they pass**; `npm run build` passes.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/lib/lesson/loadLesson.ts src/lib/lesson/loadLesson.test.ts src/components/lesson
git commit -m "feat(m4a): topic progress on the lesson intro" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 6: Backfill script, docs, live run (⛔ owner gate before the DB write)

**Files:**
- Create: `scripts/backfill-lessons.ts`
- Modify: `package.json` (`"lessons:backfill": "tsx scripts/backfill-lessons.ts"`), `SPEC.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `completeWrittenBlockIfDone` (Task 2), `prisma` (`src/lib/db.ts`).

- [ ] **Step 1: Write the script** (`scripts/backfill-lessons.ts`)

```ts
/**
 * M4a one-off: score lessons whose written block was completed before M4a and advance their topics.
 * Idempotent (completed lessons are skipped). Writes to the DB.  npm run lessons:backfill
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { completeWrittenBlockIfDone } = await import("../src/lib/curriculum/completeLesson");
  try {
    const lessons = await prisma.lesson.findMany({
      where: { writtenCompletedAt: null },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    let completed = 0;
    for (const { id } of lessons) {
      const last = await prisma.exercise.findFirst({
        where: { lessonId: id, answeredAt: { not: null } },
        orderBy: { answeredAt: "desc" },
        select: { answeredAt: true },
      });
      if (!last?.answeredAt) continue;
      const out = await prisma.$transaction((tx) => completeWrittenBlockIfDone(tx, id, last.answeredAt!));
      if (out.completed) {
        completed++;
        console.log(`lesson ${id}: written block ${Math.round((out.score ?? 0) * 100)}%`);
      }
    }
    const topics = await prisma.grammarTopic.findMany({
      where: { lessonsCompleted: { gt: 0 } },
      select: { title: true, name: true, status: true, lessonsCompleted: true, goodLessons: true },
    });
    for (const t of topics) console.log(`topic ${t.title ?? t.name}: ${t.status}, ${t.goodLessons}/${t.lessonsCompleted} good`);
    console.log(`done: ${completed} lesson(s) scored`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

Add the `package.json` script. `npx tsc --noEmit` must pass (scripts are type-checked by tsc).

- [ ] **Step 2: Docs.**
  - `SPEC.md` §How the curriculum drives lesson generation: replace the topic-advancement bullet with the M4a rules — `INTRODUCED → PRACTICING` after the first **completed** lesson (all written exercises answered); `→ MASTERED` after 3 lessons with a written block **>= 80%** (not necessarily consecutive; new ErrorRecords do not block mastery — they go to review); a core topic below the learner's level after **1** such lesson; a topic with >= 5 completed lessons and not mastered is **parked** (ranked after untouched topics, skipped by the below-level shortcut); `MASTERED` is never reverted; history on `Lesson.writtenScore/writtenCompletedAt`, cached counters `GrammarTopic.lessonsCompleted/goodLessons`. Remove "(Below-level review-as-diagnosis: recorded for M4, not yet implemented ...)". §Data model: the four new fields. §API `POST /api/lesson/start`: resumable = dated today, or written block not complete with an unanswered exercise. §Pages `/lesson/[id]` intro: topic progress lines.
  - `CLAUDE.md`: Commands — `npm run lessons:backfill`; Milestone status — `M4a ✅` line (spec pointer), M4b/M4c next; Dev guidelines — current branch `feature/m4-spaced-repetition`.

- [ ] **Step 3: Commit** (script + docs), then **STOP**:

```powershell
npx tsc --noEmit; npm test; npm run build
git add scripts/backfill-lessons.ts package.json SPEC.md CLAUDE.md
git commit -m "feat(m4a): lessons:backfill script; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

**⛔ GATE:** the controller asks the owner before running `npm run lessons:backfill` on the real DB. Expected output: the 2026-09-26 lesson "written block 71%", topic "Comparative with more (...)": `PRACTICING, 0/1 good`. Then `npm run curriculum:preview` shows the next focus (still this topic until it is mastered or parked).
