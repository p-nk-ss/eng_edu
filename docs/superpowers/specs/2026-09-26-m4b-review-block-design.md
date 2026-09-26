# M4b — Review block: reinforcement exercises for due errors, error intervals

**Date:** 2026-09-26 · **Status:** approved design · **Parent:** `SPEC.md` §Lesson Structure (review
block), §Spaced repetition rules; milestone M4 (M4a done; M4c errors page next).

## Problem

Mistakes are recorded as `ErrorRecord`s (M3c) with `nextReviewAt = +1 day`, and lesson selection
already returns the due ones (`selectLessonInputs().dueErrors`), but nothing uses them: every lesson's
`plan.sections.review.exerciseIds` is empty and no error ever moves along its schedule. The owner has
two errors from the first live lesson, due on 2026-09-27.

## Decisions (owner, 2026-09-26)

1. **Review exercises are written by Claude in the same lesson-generation call** (no extra call),
   validated like written exercises.
2. **At most 3 review exercises**, added on top of the written block; one per due error, the most
   overdue first (`nextReviewAt` asc, then `createdAt`, then `id`); the rest wait.
3. **The review block comes first** in the player, labelled as review of past mistakes.
4. **A review answer updates its own error** (no new ErrorRecord): correct → `correctStreak + 1`,
   next review after 1 → 3 → 7 → 14 days, `MASTERED` at streak 3; wrong → streak 0, `REVIEWING`,
   next review in 1 day, the wrong example appended to the error's description (last 5 kept).
5. Review answers do not count towards `writtenScore` or topic mastery (M4a), and do not keep a lesson
   resumable once its written block is complete.
6. **Translation check prompt:** `relatesToFocus = true` whenever any mistake concerns the lesson's
   grammar focus (e.g. then/than in a comparatives lesson) - so such mistakes are filed under the topic.

## Data model

No migration. `Exercise.errorRecordId String?` (exists since M1, unused) marks a review exercise and
names its error. `Lesson.plan.sections.review.exerciseIds` (exists, empty) holds the review order.

## Components

### 1. Review planning — `src/lib/review/planReview.ts` (pure)

```ts
export const MAX_REVIEW = 3;
export interface DueError { id: string; category: string; grammarTopicId: string | null; description: string; nextReviewAt: Date; createdAt: Date }
export interface ReviewItem { errorId: string; type: ExerciseTypeName; category: string; grammarTitle: string | null; examples: string[] }
export function planReview(due: DueError[], grammarTitles: Map<string, string>): ReviewItem[];
```

Sorts by `nextReviewAt`, `createdAt`, `id`; takes `MAX_REVIEW`; `examples` = the description's lines
without the "- " prefix, last 3. Type by category (code decides, not Claude):

| Error | Review type |
|---|---|
| `grammarTopicId` set | `FILL_BLANK` and `ERROR_CORRECTION`, alternating in review order |
| category starts `vocab:` or equals `general` | `MULTIPLE_CHOICE` |
| category starts `translation:` | `TRANSLATION` |
| `listening/spelling` | `DICTATION` |
| category starts `writing:` | `ERROR_CORRECTION` |
| anything else | `MULTIPLE_CHOICE` |

### 2. Scheduling — `src/lib/review/schedule.ts` (pure)

```ts
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;
export const REVIEW_MASTERED_STREAK = 3;
export function nextErrorState(cur: { correctStreak: number }, correct: boolean, now: Date):
  { status: "REVIEWING" | "MASTERED"; correctStreak: number; nextReviewAt: Date };
```

Correct: `streak = cur + 1`; `nextReviewAt = now + REVIEW_INTERVAL_DAYS[min(streak, 3)]` days
(streak 1 → 3 d, 2 → 7 d, 3 → 14 d); status `MASTERED` if `streak >= 3`, else `REVIEWING`.
Wrong: streak 0, `REVIEWING`, `now + 1 day`. (The first interval, 1 day, is the one set when the
error is created in M3c.)

### 3. Generation — `lessonGeneration.ts` prompt + `generateLesson.ts` + `startLesson.ts`

- `GenerationInputs` gains `review: ReviewItem[]`. The payload lists them (index, category, grammar
  title, examples, requested type). The system prompt adds: "`review`: exactly one exercise per review
  item, in order, of the requested type, practising the mistake shown in its examples with NEW
  sentences (never repeat the example sentences); a review item may use its own grammar, it is the one
  exception to 'introduce no other grammar focus'; review exercises have `vocab: []`." Shapes for the
  review types are included (union with the written mix).
- `lessonEnvelopeSchema` gains `review: z.array(z.unknown()).max(MAX_REVIEW).default([])`.
- `generateLesson` validates review exercises one by one with the same pipeline (parseExercise →
  requested type check → checkExercise; they go through the Jev gate together with the written ones).
  A dropped review exercise is logged in `drops` (`section: "review"`) and simply omitted: review
  drops never cause regeneration and never count towards `MIN_EXERCISES`. `LessonDraft` gains
  `review: { errorId: string; type; content }[]`.
- `startLesson` builds `review` from `inputs.dueErrors` (+ topic titles) with `planReview`.

### 4. Persistence — `createLesson.ts`

Creates review `Exercise` rows with `errorRecordId` set, in the same transaction, and fills
`plan.sections.review.exerciseIds` (review ids first in the lesson's exercise order). Written ids and
everything M4a reads stay unchanged.

### 5. Grading — `checkAnswer.ts` / `recordAnswer.ts`

`checkAnswer` loads `errorRecordId` with the exercise. For a review exercise, `errorEntries` are not
created; instead `recordAnswer` (same transaction, after the answer write) applies
`nextErrorState` to that ErrorRecord and, when wrong, appends the example via the existing
`appendExample`. Vocab credit unchanged. A missing ErrorRecord (deleted) → the answer is still recorded,
no error update. Grammar attribution: the review exercise's explanation and correct answer are shown
as usual; M4a completion ignores it (it is not in `written.exerciseIds`).

### 6. Player — `loadLesson.ts`, `LessonPlayer`, `LessonIntro`

`PlayerItem` gains `section: "review" | "written"`; items are ordered review first, then written (plan
order), then unplanned rows. The player shows a small section label above the card ("Review - a
mistake from an earlier lesson" / "New material"). The intro shows "N review exercises" when N > 0.
Results screen lists both sections. Resume: unchanged rule (written block not complete + an unanswered
exercise) - the review block comes first, so it is always answered before the written block completes.

### 7. Translation prompt — `src/lib/prompts/translationFeedback.ts`

Rewrite the `relatesToFocus` rule: true when ANY mistake in the learner's answer concerns
`grammar_focus` (the target structure, its form or its signal words - e.g. then/than or a missing
"more" in a comparatives lesson), even if other mistakes exist; false only when none does or
`grammar_focus` is null. Live check with `npm run answer:check` on the owner's real translation
(expected `relatesToFocus: true`), plus two controls.

## Error handling

| Situation | Behaviour |
|---|---|
| no due errors | no review items, prompt has no review section, lesson as before |
| Claude returns fewer/invalid review exercises | those are dropped (logged), lesson still created |
| review item's error deleted before grading | answer recorded, no ErrorRecord update |
| a due error already MASTERED | not selected (selection filters `status != MASTERED`) |
| same error due again tomorrow while today's lesson exists | today's lesson keeps its review; tomorrow's lesson picks what is due then |

## Testing (TDD)

- `planReview.test.ts`, `schedule.test.ts` — the tables above, ordering, cap, examples trimming, dates.
- `lessonGeneration.test.ts` — review section present only with items; exception rule text; shapes.
- `generateLesson.test.ts` — review validated, dropped review does not trigger regeneration, draft carries errorId.
- `createLesson.test.ts` — review rows with errorRecordId, plan review ids.
- `recordAnswer.test.ts` / `checkAnswer.test.ts` — review answer updates its ErrorRecord (correct/wrong), no new ErrorRecord, completion unaffected.
- `loadLesson.test.ts`, `LessonPlayer.test.tsx`, `LessonIntro.test.tsx` — order, labels, count.
- `translationFeedback.test.ts` — the rule text; live `answer:check` (owner gate).
- Live: `npm run lesson:generate` with the owner's two due errors (tomorrow) or with a dry-run input,
  and the owner plays the next lesson.

## Out of scope

Occasional review of MASTERED errors · errors from conversation (M5) · errors page and charts (M4c) ·
changing M3c attribution of written-block mistakes.

## Documentation updates

`SPEC.md` (§Lesson Structure review block: max 3, same call, types table; §Spaced repetition rules:
intervals as implemented; §API check: review answers update their error; §Pages: review label),
`CLAUDE.md` (M4b status, branch `feature/m4b-review`).
