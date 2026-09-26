# M4a — Topic advancement: written-block score, topic status, next topic

**Date:** 2026-09-26 · **Status:** approved design · **Parent:** `SPEC.md` §How the curriculum drives
lesson generation (status rules), milestone M4. M4 is split: **M4a** (this doc) topic advancement ·
M4b review block + error intervals · M4c errors page + dashboard stats.

## Problem

A grammar topic only ever moves `NOT_STARTED → INTRODUCED` (at lesson creation). Nothing records how
a lesson went, so a topic never advances and every new lesson picks the same focus again. The owner's
first live lesson (2026-09-26, "Comparative with more", A2, 5/7 correct) is the first data point.

## Decisions (owner, 2026-09-26)

1. **A lesson counts when its last written exercise is answered** — no "Finish" button (that is M6).
2. **A good lesson = written block >= 80% correct.** New `ErrorRecord`s on the topic do NOT block
   mastery (they go to review in M4b). This replaces the SPEC wording "and no new ErrorRecords".
3. **Good lessons accumulate** (need not be consecutive); a weak lesson takes nothing away.
4. **Mastery:** 3 good lessons; a **core topic below the learner's level** needs **1** good lesson
   (SPEC's "below-level review-as-diagnosis").
5. **No getting stuck:** a topic with **>= 5 completed lessons** and not mastered is **parked** — it
   stays `PRACTICING` but is chosen only after every not-yet-started topic of its band; it comes back
   later (and its errors are reviewed in M4b).
6. **History is the source of truth.** Per-lesson results live on `Lesson`; the topic's status and
   counters are derived from that history by a pure function and can always be recomputed.
7. `Lesson.status` stays `IN_PROGRESS` after the written block (completion/summary is M6). `MASTERED`
   is never reverted in M4a.

## Data model (one additive migration)

```prisma
model Lesson {
  // ...
  writtenScore       Float?    // share of correct written answers, 0..1; null until the block is complete
  writtenCompletedAt DateTime? // set once, when the last written exercise is answered
}
model GrammarTopic {
  // ...
  lessonsCompleted Int @default(0) // cache: completed lessons with this focus (derived, recomputable)
  goodLessons      Int @default(0) // cache: of those, writtenScore >= GOOD_LESSON_SCORE
}
```

The two `GrammarTopic` counters are a cache written only by the recompute below (selection and the
intro read them); they never diverge from the lesson history because nothing else writes them.

## Components

### 1. Pure rules — `src/lib/curriculum/advancement.ts`

```ts
export const GOOD_LESSON_SCORE = 0.8;
export const LESSONS_TO_MASTER = 3;
export const LESSONS_TO_MASTER_BELOW_LEVEL = 1;
export const PARK_AFTER_LESSONS = 5;

/** The written block is complete when every playable written exercise has an answer. */
export function writtenBlockScore(items: { answered: boolean; correct: boolean | null }[]):
  { complete: boolean; score: number | null };           // score = correct / total, null if incomplete or empty

export interface TopicHistory { scores: number[] }       // writtenScore of completed lessons with this focus
export function nextTopicState(
  current: "NOT_STARTED" | "INTRODUCED" | "PRACTICING" | "MASTERED",
  history: TopicHistory,
  opts: { belowLevelCore: boolean },
): { status: TopicStatusName; lessonsCompleted: number; goodLessons: number };
```

Rules of `nextTopicState`: `MASTERED` stays `MASTERED`; no completed lesson → status unchanged
(`NOT_STARTED`/`INTRODUCED`); at least one completed lesson → `PRACTICING`; `goodLessons >=`
(`belowLevelCore ? 1 : 3`) → `MASTERED`. Counters = `scores.length` and the count of scores `>= 0.8`.
`belowLevelCore` = topic `importance === 1` and its band is strictly below the learner's band
(`isBelowLevel` from `src/lib/lesson/levels.ts`).

"Playable" written exercises = rows in `plan.sections.written.exerciseIds` whose content parses (the
same set the player shows); unparsable rows neither block completion nor count in the score.

### 2. Completion in the answer transaction — `src/lib/grading/recordAnswer.ts`

After the answer is written (inside the existing `$transaction`, sequential queries, no network):
load the lesson's written exercises (id, content, answeredAt, isCorrect); compute
`writtenBlockScore`; if `complete` and `lesson.writtenCompletedAt` is null → set `writtenScore`,
`writtenCompletedAt = now`, then **recompute the focus topic** (if `plan.meta.grammarTopicId`):
read the topic and the learner's level, collect `writtenScore` of all lessons with
`writtenCompletedAt != null` and this focus (JSON path on `plan.meta.grammarTopicId`, ordered by
date), apply `nextTopicState`, write `status`, `lessonsCompleted`, `goodLessons`. The completion step
lives in a small module `src/lib/curriculum/completeLesson.ts` (`completeWrittenBlockIfDone(tx, lessonId, now)`
and `recomputeTopic(tx, topicId)`), called from `recordAnswer`. Idempotent: an already completed
lesson is never re-scored; a repeated submit (M3c returns the stored result) never reaches it.

### 3. Selection — `src/lib/curriculum/select.ts` + `lessonInputs.ts`

`GrammarCandidate` gains `lessonsCompleted`. `grammarRank`: a **parked** topic
(`PRACTICING` and `lessonsCompleted >= PARK_AFTER_LESSONS`) ranks after `NOT_STARTED` (rank 4). The
below-level core shortcut ignores parked topics (otherwise a hard below-level topic would block the
learner's own level forever). `lessonInputs` passes the new field through (already loads topics).

### 4. Resume rule — `src/lib/lesson/resumable.ts`

A lesson is resumable when it is dated today, or when `writtenCompletedAt` is null and it has at
least one written exercise without an answer. Replaces "any exercise without an answer" (review
exercises arrive in M4b and must not keep an old lesson open; unparsable rows are covered because a
completed block sets `writtenCompletedAt` regardless of them).

### 5. Intro progress — `src/lib/lesson/loadLesson.ts` + `LessonIntro.tsx`

`intro.grammar` gains `status`, `goodLessons`, `lessonsToMaster` (1 or 3), `lastScore` (the
`writtenScore` of the previous completed lesson on this topic, or null). The intro shows e.g.
"Lesson 2 on this topic · 0 of 3 good lessons (80%+) · last time 71%" and, for a below-level core
topic, "1 good lesson (80%+) marks it as mastered". Nothing here is an answer key.

### 6. Backfill — `npm run lessons:backfill`

`scripts/backfill-lessons.ts` (env loaded before `db` import): for every lesson whose written block is
complete but `writtenCompletedAt` is null, set `writtenScore`/`writtenCompletedAt` (= the latest
`answeredAt` of its written exercises), then recompute every topic that was a focus of any completed
lesson. Idempotent; prints a summary. Expected on the owner's DB: the 2026-09-26 lesson scores 5/7 =
0.714 → "Comparative with more" becomes `PRACTICING`, lessonsCompleted 1, goodLessons 0.

## Error handling

| Situation | Behaviour |
|---|---|
| lesson without grammar focus | score stored, no topic touched |
| focus topic deleted / missing | score stored, recompute skipped |
| profile missing | `belowLevelCore = false` (3 good lessons needed) |
| repeated submit / concurrent last answers | M3c single-flight (per exercise) + `completeWrittenBlockIfDone` takes a `SELECT ... FOR UPDATE` lock on the `Lesson` row before reading it, serialising two different last-exercise answers; the `writtenCompletedAt IS NULL` guard (conditional update) then keeps the block completed exactly once |

## Testing (TDD)

- `advancement.test.ts` — score (complete/incomplete/empty, unparsable excluded by the caller);
  `nextTopicState` table: no history, 1 weak, 3 good non-consecutive, below-level core 1 good,
  MASTERED sticky, counters.
- `completeLesson.test.ts` (fake tx) — not complete → no writes; complete → lesson fields + topic
  recompute with the right history query; already completed → no writes; no focus → lesson only.
- `recordAnswer.test.ts` — completion is invoked after the answer write, inside the transaction.
- `select.test.ts` — parked topic after NOT_STARTED; below-level shortcut skips parked.
- `resumable.test.ts`, `loadLesson.test.ts`, `LessonIntro.test.tsx` — updated for the new fields.
- `backfill` helpers as pure functions; live run on the owner's DB (owner gate) with the expected
  numbers above; `npm run curriculum:preview` then shows the next focus.

## Out of scope

Review block and error intervals (M4b) · errors page, dashboard charts (M4c) · reverting
`MASTERED` · Finish lesson / summary (M6) · vocab rules (already done in M3c).

## Documentation updates

`SPEC.md` §How the curriculum drives lesson generation (the status rules above replace the old
"no new ErrorRecords" wording; parking; below-level fast track now implemented), §Data model,
§Pages intro; `CLAUDE.md` (M4a status, `npm run lessons:backfill`, branch).
