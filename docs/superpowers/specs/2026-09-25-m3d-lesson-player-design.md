# M3d — Lesson player: written block, exercise cards, streak

**Date:** 2026-09-25 · **Status:** approved design · **Parent:** `SPEC.md` §Pages / UI, `docs/DESIGN.md` §5,
milestone M3 (last part). Builds on M3b-2 (`POST /api/lesson/start`) and M3c (`POST /api/exercise/check`).

## Goal

The learner presses **Start today's lesson**, lands on `/lesson/[id]`, works through the lesson's
written exercises one card at a time with instant feedback, and ends on a results screen. The
dashboard shows a real day streak. This makes the app usable end to end for the written block.

## Decisions (owner, 2026-09-25)

1. **Scope = written block only.** No section stepper; warm-up/scenario (M5/M6) are not shown.
   No "Finish lesson" (M6): the lesson stays `IN_PROGRESS` after all exercises are answered.
2. **An unfinished lesson is resumed, whatever its date.** `POST /api/lesson/start` returns an
   existing lesson instead of generating a new one while any `PLANNED`/`IN_PROGRESS` lesson has an
   unanswered written exercise. "Finished" (for this rule) = every written exercise has `answeredAt`.
3. **Gamification = progress bar + correct-answer micro-animation + results screen + a real day
   streak on the dashboard.** No XP.
4. **Architecture A:** server page + client player over the existing API routes (no new GET route,
   no Server Actions).
5. **Dictation audio = browser `speechSynthesis`** (Kokoro arrives in M5).
6. **MCQ rationales are revealed only after grading** — `GradeResult` gains an optional
   `rationales` field (small M3c extension).

## Components

### 1. Player view of an exercise — `src/lib/lesson/lessonView.ts` (pure)

`toExerciseView(id, content): ExerciseView` — what the browser may see **before** answering.
Keys never leave the server before the answer is recorded (M3c rule).

| type | view fields (everything else is dropped) |
|---|---|
| `mcq` | `prompt`, `options` |
| `cloze_mc` | `text`, `gaps[].options` |
| `open_cloze` | `text`, `gaps[].root?` |
| `word_bank` | `tiles` = `tokens` in a deterministic shuffle |
| `match` | `left`, `right` in a deterministic shuffle + `rightOrder` (indices into the original `right`, so the card can send original indices) |
| `dialogue_gap` | `turns`, `options` |
| `dictation` | `tts` (spoken, never rendered as text) |
| `error_correct` | `tokens` |
| `translation` | `source`, `hint?` |
| `open_writing` | `prompt`, `minWords`, `hint?` |

Dropped everywhere: `answer`, `accept`, `accept_alt`, `rationales`, `explain`, `reference`, `vocab`.
Every view carries `{ id, type }` (`type` = content tag). Shuffle = seeded by the exercise id
(e.g. a small string hash → mulberry32), stable across reloads, never the identity permutation
when avoidable. `match` answers are always sent in **original `right` indices** (`pairs[i]` =
original index matched to `left[i]`), so M3c's grader is unchanged.

A guard test asserts that, for every fixture exercise, no key value (`answer`, accept strings,
`reference`, `rationales`, `explain`) appears anywhere in `JSON.stringify(view)` except where
the value is legitimately part of the visible prompt (dictation `tts`, options/tokens that
include the correct one).

### 2. Loading a lesson — `src/lib/lesson/loadLesson.ts`

`loadLessonForPlayer(id, db?) → { lessonId, date, theme, grammarTitle, items: PlayerItem[] } | null`
where `PlayerItem = { view: ExerciseView; result: GradeResult | null }`, ordered by
`plan.sections.written.exerciseIds` (exercises missing from the plan are appended in id order;
ids in the plan without a row are skipped). `result` = stored `Exercise.result` when `answeredAt`
is set. Unknown id → `null`. Injectable `db` (pattern of `startLesson.ts`); sequential queries.

`findResumableLessonId(db, now)` (shared with `startLesson`): the newest (`date desc, id desc`)
`PLANNED`/`IN_PROGRESS` lesson that is dated today **or** has at least one exercise with
`answeredAt = null`; `null` if none.

### 3. Resume rule — `src/lib/lesson/startLesson.ts`

Replace the "today's PLANNED/IN_PROGRESS" lookup with `findResumableLessonId`. Result stays
`{ lessonId, reused: true }`. A lesson dated earlier whose exercises are all answered no longer
blocks a new lesson. Single-flight is unchanged. `SPEC.md` §API `POST /api/lesson/start` updated.

### 4. Pages

- `src/app/lesson/[id]/page.tsx` — server component, `force-dynamic`. `loadLessonForPlayer` →
  `notFound()` on null → renders `<LessonPlayer lesson={…} />` inside the app shell (SideNav),
  single column `max-w-2xl`.
- `src/app/lesson/page.tsx` — nav target "Lesson": `findResumableLessonId` → `redirect` to
  `/lesson/<id>`; none → a small page "No lesson in progress" with the start button.
- Dashboard `src/app/page.tsx`: the start button becomes `<StartLessonButton />` (client):
  `POST /api/lesson/start` → `router.push('/lesson/' + lessonId)`. While generating (1–3 min):
  disabled, spinner, text "Preparing your lesson… this can take a couple of minutes". Errors:
  409 (no profile) / 502 / 500 → inline message under the button + "Try again".

### 5. `LessonPlayer` — `src/components/lesson/LessonPlayer.tsx` (client)

State: `items` (from the server), `index`, per-card `phase` =
`answering | checking | graded | error`. Start index = first item with `result === null`; if all
answered → results screen.

- Header: "Exercise 3 of 7" + progress bar (share of answered items), lesson theme/grammar title.
- Check: `POST /api/exercise/check {exerciseId, answer}` →
  - 200 → store result in `items[index]`, phase `graded` (also when `alreadyAnswered: true`);
  - 502 / network error → phase `error`: "Couldn't check right now — your answer is kept." +
    "Try again" (the answer state is preserved; the attempt was not consumed server-side);
  - 400 / 404 / 500 → phase `error` with the server message (a player bug, not a learner
    mistake); "Try again" allowed.
- Next → next unanswered item, or the results screen after the last one.
- Keyboard: `Enter` = Check when the answer is complete, `Enter` = Next when graded; number keys
  1–5 pick options in choice cards. Focus moves to the card heading on each new card.
- `aria-live="polite"` region announces the verdict.

### 6. Cards — `src/components/lesson/cards/*`

Common frame `ExerciseCard`: type label, prompt area, answer area (per type), primary **Check**
button (disabled until the answer is complete; spinner + disabled while checking), then the
result panel and **Next**. Each type component is controlled: props `{ view, disabled,
onChange(answer | null) }`, where `answer` is exactly the M3c shape (`SHAPES` in
`src/lib/grading/answerSchemas.ts`) and `null` means incomplete.

| type | interaction | complete when |
|---|---|---|
| `mcq`, `dialogue_gap` | option buttons (radio group); dialogue turns shown as chat bubbles, the gap turn highlighted | one selected |
| `cloze_mc` | inline `<select>` per gap inside the sentence | every gap chosen |
| `open_cloze` | inline text input per gap, root shown as "(BEAUTY)" | at least one gap non-blank |
| `word_bank` | tap a tile → appended to the answer tray; tap a tray tile → back; keyboard: tiles are buttons | tray non-empty |
| `match` | click left, then right → pair locks (shows connector/label); click a locked pair to undo | every left item paired |
| `dictation` | Play / Play again button (`speechSynthesis`, `en-GB` voice if present else `en-US`, rate 0.9) + text input; if `speechSynthesis` is unavailable, a notice "Audio isn't available in this browser" | text non-blank |
| `error_correct` | tokens as buttons → pick one → inline input prefilled with the token for the fix | a token picked and fix non-blank |
| `translation` | Russian source + textarea, counter "n / 500" | text non-blank |
| `open_writing` | task + textarea, word counter "42 / 60 words" (turns success-coloured at `minWords`) | text non-blank |

### 7. Result panel — `src/components/lesson/ResultPanel.tsx`

From `GradeResult`:
- Verdict: `CheckCircle2` + "Correct" (`--success`) or `XCircle` + "Not quite" (`--danger`);
  never colour alone.
- Parts (when more than one): each gap/pair with ✓/✗ icon, "you: … · answer: …".
- "Correct answer: …" (`correctAnswer`) — omitted for open writing (empty).
- Accepted variant: if correct and `gradedBy === "jev"` → note "Accepted — the key was: …".
- Choice cards tint the chosen and the correct option; `mcq` shows per-option `rationales`.
- Explanation (`explain`) in an expandable section, open by default when wrong.
- Translation: `feedback.corrected` + `feedback.explanation`.
- Writing: `feedback.summary` + list of `corrections` (original → corrected, explanation, severity
  chip minor/moderate/major with text) + "n words".
- Correct answer micro-animation: scale/opacity pop ≤ 400 ms on the verdict icon; none under
  `prefers-reduced-motion`.

### 8. Results screen — `src/components/lesson/LessonResults.tsx`

"5 of 7 correct" + progress ring, list of all exercises (type label, prompt excerpt, verdict icon),
wrong ones expandable to their `ResultPanel`. Button "Back to dashboard". Shown after the last
Next, or directly when the lesson is fully answered.

### 9. MCQ rationales in the grade — M3c extension

`GradeResult.rationales?: string[]` — `buildResult` copies `content.rationales` for `mcq` only.
Old stored results without it render fine (field optional). `SPEC.md` §API updated.

### 10. Day streak — `src/lib/stats/streak.ts`

`computeStreak(answeredDates: Date[], now: Date): { days: number; atRisk: boolean }` (pure).
A day counts if it has ≥ 1 `answeredAt` in **local** time. `days` = consecutive counted days
ending today; if today is not counted, ending yesterday with `atRisk: true`; otherwise `0`.
`getStreak(db?)` reads `Exercise.answeredAt` (non-null, distinct local days via a query over the
last 400 days) and calls it. Dashboard "Streak" card: count + `Flame` icon; `atRisk` → amber
(`--warning`) + text "Answer one exercise today to keep it".

## Error handling

| Situation | Behaviour |
|---|---|
| unknown lesson id | 404 page |
| lesson has no written exercises | player shows "This lesson has no exercises" + back link |
| check 502 / network | card error state, answer kept, Try again |
| check 400/404/500 | card error with message, Try again |
| start 409 / 502 / 500 | inline error under the start button + Try again |
| `speechSynthesis` missing | notice on the dictation card; the card still accepts typing |
| page reload mid-lesson | resumes at the first unanswered exercise; graded ones keep their results |

## Testing (TDD)

- `lessonView.test.ts` — per type: exact view fields; **key-leak guard** over all fixtures;
  deterministic shuffle (same id → same order, different ids → usually different); match index
  mapping round-trip.
- `loadLesson.test.ts` — order by plan, results attached, missing rows skipped, null for unknown;
  `findResumableLessonId` cases (today, older unfinished, older finished, none).
- `startLesson.test.ts` — resume rule added to the existing suite.
- `streak.test.ts` — today, yesterday-only (atRisk), gap, local-midnight boundaries, duplicates.
- Card tests (Testing Library, `fireEvent`) — each card emits the right M3c answer shape and
  `null` until complete; keyboard operation; disabled while checking.
- `ResultPanel.test.tsx` — verdict text + icon, parts, accepted-variant note, rationales,
  translation/writing feedback.
- `LessonPlayer.test.tsx` (mocked `fetch`) — start at first unanswered; check → graded → next;
  502 → error → retry succeeds with the same answer; all answered → results screen.
- `StartLessonButton.test.tsx` — pending state, navigation, error message.
- Page smoke tests where cheap (the dashboard test already exists).
- `npx tsc --noEmit`, `npm run build`.
- **Live check (owner gate):** `npm run dev`, play the persisted lesson in the browser end to end
  (every card type present), check light/dark, 375 px width, keyboard-only; then restore the
  lesson to `PLANNED` (same snapshot/restore procedure as M3c Task 11).
- **Design pass:** run `frontend-design` (installed) on the player + cards; `ui-ux-pro-max` and
  `emil-design-eng` are not installed — use `docs/DESIGN.md` §8 checklist as the final gate.

## Out of scope

Warm-up/scenario/section stepper (M5/M6) · lesson completion, summary, next plan (M6) · XP ·
review block (M4) · Kokoro TTS (M5) · errors and history pages (M4/M6) · drag-and-drop.

## Documentation updates (part of this work)

`SPEC.md` (§API lesson/start resume rule, §API check `rationales`, §Pages player behaviour,
streak rule), `CLAUDE.md` (M3d status, current branch `feature/m3d-player`).
