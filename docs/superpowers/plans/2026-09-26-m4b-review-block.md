# M4b — Review Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each new lesson starts with up to 3 review exercises (written by Claude in the same generation call) for the learner's due mistakes; answering one moves that mistake along the 1/3/7/14-day schedule; the translation check files focus-related mistakes under the lesson topic.

**Architecture:** Pure helpers plan the review (which errors, which exercise type) and schedule an error after an answer. The generation prompt/envelope gains a `review` array validated like written exercises (drops never regenerate). Review exercises are persisted with the existing `Exercise.errorRecordId` and listed in `plan.sections.review.exerciseIds`; grading updates that ErrorRecord instead of creating new ones; the player shows the review block first.

**Tech Stack:** TypeScript, Prisma 7 (local PostgreSQL), zod 4, Vitest + Testing Library, Next.js 15.

**Spec:** `docs/superpowers/specs/2026-09-26-m4b-review-block-design.md` (read it first).

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean.
- **Commit messages:** `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"` — exactly this trailer and nothing else; check `git log -1 --format=%B`.
- Branch `feature/m4b-review`; never touch `main`, never push. No new npm dependencies. Never `git add` `skills-lock.json`, `AGENTS.md`, `.superpowers/`.
- Pure-logic tests start with `// @vitest-environment node`. Prisma queries sequential (no `Promise.all`), also inside `$transaction`; no network inside a transaction.
- Values (verbatim from the spec): `MAX_REVIEW = 3`; `REVIEW_INTERVAL_DAYS = [1, 3, 7, 14]`; `REVIEW_MASTERED_STREAK = 3`.
- **No migration** (`Exercise.errorRecordId` and `plan.sections.review.exerciseIds` already exist).
- Review answers never count towards `writtenScore`/topic mastery (M4a) and never create new ErrorRecords.
- The real DB is never written by tests or tasks. Live Claude/Jev calls happen only in Task 6 (read-only scripts, owner looks at the output).
- UI: semantic tokens, state never colour alone, ASCII or `\u` escapes for typographic characters.

## Review Focus

1. **No due errors** → the prompt has no review section, the envelope may omit `review`, the lesson is exactly as before. *(Task 2 test "no review section without review items"; Task 3 test "no review rows without due errors")*
2. **Claude returns a review exercise of the wrong type, broken, or too few** → that item is dropped and logged; the lesson is still created and never regenerated because of review. *(Task 2 test "review drops never trigger regeneration")*
3. **The reviewed ErrorRecord was deleted before grading** → the answer is still recorded; no crash. *(Task 4 test "missing reviewed error")*
4. **A review exercise is the last unanswered exercise of an already completed written block** → completion is not re-run and `writtenScore` is unchanged. *(Task 4 test "review answer does not touch completion")*
5. **Reload in the middle of the review block** → the player resumes at the first unanswered item, review first. *(Task 5 test "review first, resume at the first unanswered")*

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/review/planReview.ts` | which due errors are reviewed and with which exercise type |
| `src/lib/review/schedule.ts` | next status/streak/date of an error after a review answer |
| `src/lib/prompts/lessonGeneration.ts` | review section in the prompt and envelope |
| `src/lib/lesson/generateLesson.ts` | validation of review exercises, `LessonDraft.review` |
| `src/lib/lesson/startLesson.ts`, `createLesson.ts`, `scripts/lesson-preview.ts` | review inputs, persistence |
| `src/lib/grading/checkAnswer.ts`, `recordAnswer.ts`, `errorEntries.ts` | review answer updates its ErrorRecord |
| `src/lib/lesson/loadLesson.ts`, `src/components/lesson/*` | review block first in the player |
| `src/lib/prompts/translationFeedback.ts` | relatesToFocus rule |

---

### Task 1: Review planning and error scheduling (pure)

**Files:** Create `src/lib/review/planReview.ts`, `src/lib/review/schedule.ts`, `src/lib/review/planReview.test.ts`, `src/lib/review/schedule.test.ts`

**Interfaces:**
- Produces: `MAX_REVIEW`; `interface DueError { id: string; category: string; grammarTopicId: string | null; description: string; nextReviewAt: Date; createdAt: Date }`; `interface ReviewItem { errorId: string; type: ExerciseTypeName; category: string; grammarTitle: string | null; examples: string[] }`; `planReview(due: DueError[], grammarTitles: Map<string, string>): ReviewItem[]`; `REVIEW_INTERVAL_DAYS`, `REVIEW_MASTERED_STREAK`; `nextErrorState(cur: { correctStreak: number }, correct: boolean, now: Date): { status: "REVIEWING" | "MASTERED"; correctStreak: number; nextReviewAt: Date }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/review/planReview.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MAX_REVIEW, planReview, type DueError } from "./planReview";

const d = (id: string, category: string, over: Partial<DueError> = {}): DueError => ({
  id, category, grammarTopicId: null, description: "- a -> b", nextReviewAt: new Date("2026-09-27T06:00:00Z"), createdAt: new Date("2026-09-26T06:00:00Z"), ...over,
});
const titles = new Map([["g1", "Comparative with more"]]);

describe("planReview", () => {
  it("takes at most MAX_REVIEW, most overdue first, with total tie-breaks", () => {
    const due = [
      d("e3", "general", { nextReviewAt: new Date("2026-09-28T00:00:00Z") }),
      d("e2", "general", { createdAt: new Date("2026-09-25T00:00:00Z") }),
      d("e1", "general"),
      d("e0", "general"),
      d("e9", "general", { nextReviewAt: new Date("2026-09-20T00:00:00Z") }),
    ];
    expect(MAX_REVIEW).toBe(3);
    expect(planReview(due, titles).map((r) => r.errorId)).toEqual(["e9", "e2", "e0"]);
  });

  it("chooses the exercise type from the error", () => {
    const due = [
      d("a", "Comparative with more", { grammarTopicId: "g1", nextReviewAt: new Date("2026-09-20T00:00:00Z") }),
      d("b", "Comparative with more", { grammarTopicId: "g1", nextReviewAt: new Date("2026-09-21T00:00:00Z") }),
      d("c", "translation: meaning", { nextReviewAt: new Date("2026-09-22T00:00:00Z") }),
    ];
    expect(planReview(due, titles).map((r) => [r.type, r.grammarTitle])).toEqual([
      ["FILL_BLANK", "Comparative with more"],
      ["ERROR_CORRECTION", "Comparative with more"],
      ["TRANSLATION", null],
    ]);
    const more = [d("v", "vocab: deadline"), d("g", "general"), d("l", "listening/spelling"), d("w", "writing: grammar"), d("x", "something else")];
    expect(more.map((e) => planReview([e], titles)[0].type)).toEqual(["MULTIPLE_CHOICE", "MULTIPLE_CHOICE", "DICTATION", "ERROR_CORRECTION", "MULTIPLE_CHOICE"]);
  });

  it("keeps the last three examples without the list marker", () => {
    const e = d("a", "general", { description: "- one -> 1\n- two -> 2\n- three -> 3\n- four -> 4" });
    expect(planReview([e], titles)[0].examples).toEqual(["two -> 2", "three -> 3", "four -> 4"]);
  });

  it("returns nothing for no due errors", () => {
    expect(planReview([], titles)).toEqual([]);
  });
});
```

`src/lib/review/schedule.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextErrorState, REVIEW_INTERVAL_DAYS, REVIEW_MASTERED_STREAK } from "./schedule";

const now = new Date(2026, 8, 27, 10, 0);
const plusDays = (n: number) => new Date(2026, 8, 27 + n, 10, 0);

describe("nextErrorState", () => {
  it("uses the documented intervals", () => {
    expect(REVIEW_INTERVAL_DAYS).toEqual([1, 3, 7, 14]);
    expect(REVIEW_MASTERED_STREAK).toBe(3);
  });
  it("moves along 3, 7, 14 days on correct answers and masters at streak 3", () => {
    expect(nextErrorState({ correctStreak: 0 }, true, now)).toEqual({ status: "REVIEWING", correctStreak: 1, nextReviewAt: plusDays(3) });
    expect(nextErrorState({ correctStreak: 1 }, true, now)).toEqual({ status: "REVIEWING", correctStreak: 2, nextReviewAt: plusDays(7) });
    expect(nextErrorState({ correctStreak: 2 }, true, now)).toEqual({ status: "MASTERED", correctStreak: 3, nextReviewAt: plusDays(14) });
    expect(nextErrorState({ correctStreak: 5 }, true, now)).toEqual({ status: "MASTERED", correctStreak: 6, nextReviewAt: plusDays(14) });
  });
  it("resets to one day on a wrong answer", () => {
    expect(nextErrorState({ correctStreak: 2 }, false, now)).toEqual({ status: "REVIEWING", correctStreak: 0, nextReviewAt: plusDays(1) });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/review` → FAIL, modules missing.

- [ ] **Step 3: Implement**

`src/lib/review/planReview.ts`:

```ts
import type { ExerciseTypeName } from "../lesson/exerciseSchemas";

export const MAX_REVIEW = 3;
const EXAMPLES = 3;

export interface DueError {
  id: string;
  category: string;
  grammarTopicId: string | null;
  description: string;
  nextReviewAt: Date;
  createdAt: Date;
}

export interface ReviewItem {
  errorId: string;
  type: ExerciseTypeName;
  category: string;
  grammarTitle: string | null;
  examples: string[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function typeFor(e: DueError, grammarIndex: number): ExerciseTypeName {
  if (e.grammarTopicId) return grammarIndex % 2 === 0 ? "FILL_BLANK" : "ERROR_CORRECTION";
  if (e.category.startsWith("translation:")) return "TRANSLATION";
  if (e.category === "listening/spelling") return "DICTATION";
  if (e.category.startsWith("writing:")) return "ERROR_CORRECTION";
  return "MULTIPLE_CHOICE";
}

/** Which due errors the next lesson reviews (most overdue first) and with which exercise type. */
export function planReview(due: DueError[], grammarTitles: Map<string, string>): ReviewItem[] {
  const picked = [...due]
    .sort(
      (a, b) =>
        a.nextReviewAt.getTime() - b.nextReviewAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        cmp(a.id, b.id),
    )
    .slice(0, MAX_REVIEW);
  let grammarIndex = 0;
  return picked.map((e) => {
    const type = typeFor(e, grammarIndex);
    if (e.grammarTopicId) grammarIndex++;
    return {
      errorId: e.id,
      type,
      category: e.category,
      grammarTitle: e.grammarTopicId ? (grammarTitles.get(e.grammarTopicId) ?? null) : null,
      examples: e.description
        .split("\n")
        .map((l) => l.replace(/^- /, "").trim())
        .filter(Boolean)
        .slice(-EXAMPLES),
    };
  });
}
```

`src/lib/review/schedule.ts`:

```ts
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;
export const REVIEW_MASTERED_STREAK = 3;

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

/** SPEC: correct -> next interval (3, 7, 14 days), MASTERED at streak 3; wrong -> streak 0, back in 1 day. */
export function nextErrorState(
  cur: { correctStreak: number },
  correct: boolean,
  now: Date,
): { status: "REVIEWING" | "MASTERED"; correctStreak: number; nextReviewAt: Date } {
  if (!correct) return { status: "REVIEWING", correctStreak: 0, nextReviewAt: addDays(now, REVIEW_INTERVAL_DAYS[0]) };
  const correctStreak = cur.correctStreak + 1;
  const days = REVIEW_INTERVAL_DAYS[Math.min(correctStreak, REVIEW_INTERVAL_DAYS.length - 1)];
  return { status: correctStreak >= REVIEW_MASTERED_STREAK ? "MASTERED" : "REVIEWING", correctStreak, nextReviewAt: addDays(now, days) };
}
```

- [ ] **Step 4: Run to verify they pass** — PASS (7 tests).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/review
git commit -m "feat(m4b): pure review planning and error scheduling" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: Review in the generation prompt and validation

**Files:** Modify `src/lib/prompts/lessonGeneration.ts` (+ its test), `src/lib/lesson/generateLesson.ts` (+ its test)

**Interfaces:**
- Consumes: `ReviewItem` (Task 1).
- Produces: `GenerationInputs.review: ReviewItem[]`; `lessonEnvelopeSchema.review` (`z.array(z.unknown()).max(MAX_REVIEW).default([])`); `LessonDrop.section?: "review"`; `LessonDraft.review: { errorId: string; type: ExerciseTypeName; content: ExerciseContent }[]`.

- [ ] **Step 1: Write the failing tests.**
  - `lessonGeneration.test.ts`:
    - "no review section without review items": with `review: []` the user payload has no `review` key and the system prompt does not contain `"review"`.
    - with two review items (`{ errorId: "r1", type: "FILL_BLANK", category: "Comparative with more", grammarTitle: "Comparative with more", examples: ["as -> than"] }`, `{ errorId: "r2", type: "TRANSLATION", category: "translation: meaning", grammarTitle: null, examples: ["then -> than"] }`): payload `review` equals `[{ index: 0, type: "open_cloze", category: "Comparative with more", grammar: "Comparative with more", examples: ["as -> than"] }, { index: 1, type: "translation", category: "translation: meaning", grammar: null, examples: ["then -> than"] }]` (no errorId sent); the system prompt contains `"review"`, `never repeat the example sentences`, `the one exception`, and the FILL_BLANK and TRANSLATION shapes even if the written mix lacks them.
    - envelope schema: parses without `review` (defaults to `[]`), rejects 4 review items.
  - `generateLesson.test.ts` (existing `inputs` gain `review: []`; add a `withReview` variant with the two items above):
    - "keeps valid review exercises in order with their errorId": envelope `review: [E.FILL_BLANK, E.TRANSLATION]` → `draft.review` equals `[{ errorId: "r1", type: "FILL_BLANK", content: <E.FILL_BLANK with vocab []> }, { errorId: "r2", type: "TRANSLATION", content: <E.TRANSLATION with vocab []> }]`.
    - "review drops never trigger regeneration": review `[E.MULTIPLE_CHOICE /* wrong type */, { junk: 1 }]` with 7 valid written exercises → `ask` called once, `draft.review` is `[]`, two drops with `section: "review"`; missing review entries (`review: []` while 2 items requested) → drops "review item 0 missing" style, lesson returned.
    - "gates review exercises separately": the gate mock is called twice (written, then review) and a review verdict `drop: true` removes that review exercise only.
    - `formatDrop` of a review drop starts with `review `.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.**
  - `lessonGeneration.ts`: import `MAX_REVIEW`, `ReviewItem`; `GenerationInputs` gains `review: ReviewItem[]`; envelope `review: z.array(z.unknown()).max(MAX_REVIEW).default([])`. In `systemPrompt`, when `input.review.length > 0`, append after the variety line:

```ts
      "Review: the learner made the mistakes listed in \"review\". For each review item write exactly one exercise of its requested type that practises that mistake with NEW sentences on the lesson theme - never repeat the example sentences. A review item may practise its own grammar: it is the one exception to \"introduce no other grammar focus\". Review exercises have \"vocab\": [].",
```

  and the JSON shape line becomes `{"exercises":[...],"review":[...],"warmup":...}` with a bullet `- "review": exactly one exercise per review item, in the given order, each in the exact shape below.`; the shapes list is the de-duplicated union of `input.mix` and the review types (mix order first). Without review items the prompt and the JSON shape line stay exactly as today. In `lessonGenerationPrompt`, add `review` to the payload only when non-empty: `input.review.map((r, index) => ({ index, type: EXERCISE_TYPE_TAGS[r.type], category: r.category, grammar: r.grammarTitle, examples: r.examples }))`.
  - `generateLesson.ts`: `LessonDrop` gains `section?: "review"`; `formatDrop` prefixes `review ` when set. `LessonDraft` gains `review`. After the written survivors pass `MIN_EXERCISES` in an attempt (and only then), validate the same envelope's review against `inputs.review`: for each item `i`, `raw = envelope.review[i]`; missing → drop `"review item missing"`; `parseExercise` failure → drop; `parsed.type !== item.type` → drop `"review type ... was not requested"`; content with `vocab: []`, then `checkExercise` → drop on problems. Then, if any valid, `await deps.gate(validReview.map(v => v.content), grammar)` and drop gate-dropped ones. Every review drop has `section: "review"` and `attempt` of that attempt; review drops never affect the survivor count or regeneration. `gateScores` stay written-only.

- [ ] **Step 4: Run to verify they pass**; existing generateLesson/lessonGeneration tests still pass (fixtures gain `review: []`; also `src/lib/lesson/startLesson.test.ts` and `scripts/lesson-preview.ts` compile — `toGenerationInputs` is updated in Task 3, so for now pass `review: []` there via a default parameter `review: ReviewItem[] = []`).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/prompts/lessonGeneration.ts src/lib/prompts/lessonGeneration.test.ts src/lib/lesson/generateLesson.ts src/lib/lesson/generateLesson.test.ts src/lib/lesson/startLesson.ts
git commit -m "feat(m4b): review exercises in the generation prompt and validation" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Review inputs and persistence

**Files:** Modify `src/lib/lesson/startLesson.ts` (+ test), `src/lib/lesson/createLesson.ts` (+ test), `scripts/lesson-preview.ts`

**Interfaces:**
- Consumes: `planReview`, `DueError` (Task 1); `LessonDraft.review` (Task 2).
- Produces: `reviewItemsFor(db: Pick<PrismaClient, "grammarTopic">, due: DueError[]): Promise<ReviewItem[]>` (exported from `startLesson.ts`); `toGenerationInputs(inputs, mix, summaries, review: ReviewItem[] = [])`; `buildPlan(draft, exerciseIds, reviewIds, meta)`.

- [ ] **Step 1: Write the failing tests.**
  - `startLesson.test.ts`: with `selectLessonInputs` mocked to return `dueErrors: [<an ErrorRecord-like object with grammarTopicId "g1", category "Comparative with more", description "- as -> than", nextReviewAt, createdAt>]` and the fake db gaining `grammarTopic.findMany` returning `[{ id: "g1", title: "Comparative with more", name: "RAW" }]`, the `generateLesson` mock receives inputs whose `review` equals `[{ errorId: <id>, type: "FILL_BLANK", category: "Comparative with more", grammarTitle: "Comparative with more", examples: ["as -> than"] }]`. With `dueErrors: []` → `review: []` and no `grammarTopic.findMany` call.
  - `createLesson.test.ts`: a draft with `review: [{ errorId: "r1", type: "FILL_BLANK", content: E.FILL_BLANK }]` creates an exercise row with `errorRecordId: "r1"`, and the stored plan has `sections.review.exerciseIds` = [that row's id] while `sections.written.exerciseIds` holds only the written rows. "no review rows without due errors": `review: []` → no row with `errorRecordId`, `review.exerciseIds: []`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.**
  - `startLesson.ts`:

```ts
export async function reviewItemsFor(db: Pick<PrismaClient, "grammarTopic">, due: DueError[]): Promise<ReviewItem[]> {
  if (due.length === 0) return [];
  const ids = [...new Set(due.flatMap((e) => (e.grammarTopicId ? [e.grammarTopicId] : [])))];
  const topics = ids.length ? await db.grammarTopic.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, name: true } }) : [];
  return planReview(due, new Map(topics.map((t) => [t.id, t.title ?? t.name])));
}
```

    `toGenerationInputs` gains the fourth parameter and returns `review`; `runStartLesson` calls `reviewItemsFor(db, inputs.dueErrors)` before generation and passes it on.
  - `createLesson.ts`: after creating the written rows, create one row per `draft.review` entry with `errorRecordId: r.errorId` (sequential), collect `reviewIds`, and `buildPlan(draft, exerciseIds, reviewIds, meta)` sets `review: { exerciseIds: reviewIds }`.
  - `scripts/lesson-preview.ts`: accept `--days-ahead N` (default 0) → `selectLessonInputs(prisma, new Date(Date.now() + N * 86_400_000))`; build `reviewItemsFor(prisma, inputs.dueErrors)` and pass it to `toGenerationInputs`; print the review exercises after the written ones (label `REVIEW <type> for <category>`). Still no DB writes.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/startLesson.ts src/lib/lesson/startLesson.test.ts src/lib/lesson/createLesson.ts src/lib/lesson/createLesson.test.ts scripts/lesson-preview.ts
git commit -m "feat(m4b): plan review items from due errors and persist review exercises" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: A review answer updates its error

**Files:** Modify `src/lib/grading/errorEntries.ts` (+ test), `src/lib/grading/checkAnswer.ts` (+ test), `src/lib/grading/recordAnswer.ts` (+ test)

**Interfaces:**
- Consumes: `nextErrorState` (Task 1); `appendExample` (existing, `recordAnswer.ts`).
- Produces: `answerExample(judged: { parts: GradePart[] }): string` exported from `errorEntries.ts` (the first wrong part as `"given -> expected"`, clipped like the existing examples; `""` when none); `RecordInput.review?: { errorId: string; correct: boolean; example: string }`.

- [ ] **Step 1: Write the failing tests.**
  - `errorEntries.test.ts`: `answerExample` returns `"finishing -> had finished"` for a wrong part and `""` when all parts are correct; long text is clipped to `EXAMPLE_MAX`.
  - `recordAnswer.test.ts` (fake tx gains `errorRecord.findUnique`):
    - "correct review answer schedules its error": `input({ errors: [], review: { errorId: "r1", correct: true, example: "" } })` with `errorRecord.findUnique` → `{ correctStreak: 0, description: "- as -> than" }` → `errorRecord.update` with `{ where: { id: "r1" }, data: { status: "REVIEWING", correctStreak: 1, nextReviewAt: <now + 3 days> } }` and no `errorRecord.create`.
    - "wrong review answer resets and appends the example": `correct: false, example: "as -> than"` → data `{ status: "REVIEWING", correctStreak: 0, nextReviewAt: <now + 1 day>, description: "- as -> than\n- as -> than" }`.
    - "missing reviewed error": `findUnique` → `null` → no update, the answer is still recorded (`recorded: true`).
    - "review answer does not touch completion": completion is still invoked (it decides itself; its fake returns null) - assert the order: answer write, review update, then `$queryRaw`/`lesson.findUnique` of completion.
  - `checkAnswer.test.ts`: the exercise row gains `errorRecordId`; for a review exercise answered wrongly, `recordAnswer` receives `errors: []` and `review: { errorId, correct: false, example }` (spy via the fake tx: no `errorRecord.create`, an `errorRecord.update` on the reviewed id); for a normal exercise nothing changes.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.**
  - `errorEntries.ts`: export `answerExample` built from the existing `clip` (reuse it inside `errorEntries` for the first-wrong-part example so the logic is not duplicated).
  - `checkAnswer.ts`: select `errorRecordId` with the exercise; pass to `recordAnswer`: `errors: ex.errorRecordId ? [] : errorEntries(content, judged, grammar, vocab)` and `review: ex.errorRecordId ? { errorId: ex.errorRecordId, correct: judged.isCorrect, example: answerExample(judged) } : undefined`.
  - `recordAnswer.ts`: after the vocab loop and before the error-entries loop:

```ts
    if (input.review) {
      const reviewed = await tx.errorRecord.findUnique({ where: { id: input.review.errorId }, select: { correctStreak: true, description: true } });
      if (reviewed) {
        const next = nextErrorState(reviewed, input.review.correct, input.now);
        await tx.errorRecord.update({
          where: { id: input.review.errorId },
          data: {
            ...next,
            ...(!input.review.correct && input.review.example ? { description: appendExample(reviewed.description, input.review.example) } : {}),
          },
        });
      }
    }
```

- [ ] **Step 4: Run to verify they pass** (`npx vitest run src/lib/grading`).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading
git commit -m "feat(m4b): a review answer schedules its own error instead of logging a new one" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 5: Review block first in the player

**Files:** Modify `src/lib/lesson/loadLesson.ts` (+ test), `src/components/lesson/LessonPlayer.tsx` (+ test), `src/components/lesson/LessonIntro.tsx` (+ test), `src/components/lesson/LessonResults.tsx`; fixtures that build `PlayerItem` (e.g. `src/app/lesson/[id]/page.test.tsx`)

**Interfaces:**
- Produces: `PlayerItem.section: "review" | "written"`.

- [ ] **Step 1: Write the failing tests.**
  - `loadLesson.test.ts`: plan `{ sections: { review: { exerciseIds: ["r1"] }, written: { exerciseIds: ["e1", "e2"] } } }` with rows e1, e2, r1 → item ids `["r1", "e1", "e2"]`, sections `["review", "written", "written"]`; unplanned rows appended as `"written"`.
  - `LessonPlayer.test.tsx`: "review first, resume at the first unanswered": items `[review(answered), review(unanswered), written, written]` → the player opens at item 2 and shows the label "Review - a mistake from an earlier lesson"; after Next on the last review item the label becomes "New material". A lesson without review items shows no section label.
  - `LessonIntro.test.tsx`: with 2 review items the intro shows "2 review exercises" (and "1 review exercise" for one); none → no such line; the exercise count line counts only written items ("5 exercises").

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** `loadLessonForPlayer`: `const review = plan?.sections?.review?.exerciseIds ?? []`; ordered = review ids (existing rows) then written ids then the rest, each tagged; parsing/skipping unchanged. `LessonPlayer`: above the card, when `items.some(i => i.section === "review")`, render `<p className="text-sm font-semibold text-muted-foreground">` with the label for the current item's section. `LessonIntro`: `const reviewCount = items.filter(i => i.section === "review").length`; exercise count uses written items; the review line as above. `LessonResults`: append " (review)" to the type label of review items.

- [ ] **Step 4: Run to verify they pass**; `npm run build`.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/lib/lesson/loadLesson.ts src/lib/lesson/loadLesson.test.ts src/components/lesson src/app/lesson
git commit -m "feat(m4b): review block first in the lesson player" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 6: Translation focus rule, docs, live checks (⛔ owner looks at the results)

**Files:** Modify `src/lib/prompts/translationFeedback.ts` (+ test), `SPEC.md`, `CLAUDE.md`

- [ ] **Step 1: Failing test** in `translationFeedback.test.ts`: the system prompt contains `ANY mistake` and `then/than`.
- [ ] **Step 2: Implement** — replace the `relatesToFocus` line of the system prompt with: "relatesToFocus: true when ANY mistake in the learner's answer concerns `grammar_focus` - the target structure, its form or its signal words (e.g. then/than or a missing \"more\" in a comparatives lesson) - even if there are other mistakes; false only when none does or `grammar_focus` is null." Run the test green.
- [ ] **Step 3: Docs.** `SPEC.md`: §Lesson Structure review block (max 3 on top of the written block, written in the same Claude call, types table from the M4b spec, review drops never regenerate); §Spaced repetition rules (as implemented: 3/7/14 days after correct answers, MASTERED at streak 3, wrong → 1 day and REVIEWING, examples appended); §API check (a review answer updates its own ErrorRecord, creates none, never counts towards writtenScore); §Pages (review block first with its label; intro review count); translation relatesToFocus rule. `CLAUDE.md`: M4b status line, `npm run lesson:generate -- --days-ahead N`, branch `feature/m4b-review`.
- [ ] **Step 4: Commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/lib/prompts/translationFeedback.ts src/lib/prompts/translationFeedback.test.ts SPEC.md CLAUDE.md
git commit -m "feat(m4b): translation mistakes on the lesson focus are filed under the topic; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

- [ ] **Step 5: Live checks (paid, read-only), results to the workspace for the owner.**
  - `npm run answer:check -- --cases <file>` with three translation cases for the owner's real lesson translation (exercise index from `npm run answer:check`): the owner's original answer "We decided to appoint more experienced specialist then last time" (expected `relatesToFocus: true`), a control with only a missing article (expected false), and a correct answer.
  - `npm run lesson:generate -- --days-ahead 1` (the owner's two errors are due on 2026-09-27): print the review exercises; check they practise the recorded mistakes with new sentences and the requested types (FILL_BLANK for the comparative error, TRANSLATION for the translation error).

**⛔ GATE:** the controller shows the owner both outputs before the final branch review.
