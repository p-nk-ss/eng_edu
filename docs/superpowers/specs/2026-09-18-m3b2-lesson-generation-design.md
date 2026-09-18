# M3b-2 — Lesson generation: exercise schemas, prompt, quality gate, lesson creation

**Date:** 2026-09-18 · **Status:** approved design · **Parent:** `SPEC.md` §Lesson Loop / §Exercise Types / §API Routes, milestone M3
**Predecessors:** M3a (`2026-09-18-m3a-curriculum-selection-design.md`), M3b-1 (`2026-09-18-m3b1-grammar-enrichment-design.md`) — both ✅

| Part | Scope | Status |
|---|---|---|
| M3a | themes, vocab topics, deterministic selection | ✅ |
| M3b-1 | grammar topic enrichment | ✅ |
| **M3b-2 (this doc)** | exercise schemas, generation prompt, local checks + Jev quality gate, lesson creation, `POST /api/lesson/start` | — |
| M3c | graders, `judge` role, `POST /api/exercise/check`, `ErrorRecord` logging | not started |
| M3d | `/lesson/[id]` player, exercise cards, "Start today's lesson" button | not started |

## Goal

`POST /api/lesson/start` turns the deterministic lesson inputs (theme, grammar focus, vocab) into a
persisted `Lesson` with 5–8 validated written exercises and ready-made framing for the future
conversation sections — in one Claude call, with wrong answer keys filtered out before the learner
ever sees them.

## Decisions

1. **Core of the level below comes first.** Before topics at the learner's band, `pickGrammarFocus`
   serves unfinished **teachable `importance = 1`** topics of the band directly below (B1 learner →
   A2 core: Present Perfect, Past Progressive, passive …). It is review-as-diagnosis.
   *Recorded for M4 (not implemented here):* a below-level topic is fast-tracked to `MASTERED` after
   **one** lesson with ≥ 80 % on the written block (instead of three).
2. **Code decides the exercise mix; Claude writes the content** (`planExerciseMix`).
3. **One Claude call per lesson** returns all exercises plus warm-up and scenario framing. Exercises
   are validated **individually**; bad ones are dropped, not the whole lesson.
4. **Quality gate = deterministic checks + TypeSafe Jev on answer keys**, one exercise per request
   (M3a finding: shared state contaminates answers). Jev unavailable → lesson is still created,
   `plan.qualityGate = "skipped"`.
5. **One regeneration** if fewer than 5 exercises survive; then a typed error, nothing written.
6. **Abandoned lessons do not burn a theme:** rotation history counts only `IN_PROGRESS` and
   `COMPLETED` lessons. Today's `PLANNED`/`IN_PROGRESS` lesson is reused (idempotent per day).
7. Voice-service health checks (SPEC §API Routes) are **not** part of this milestone — M5.
8. Prompts follow the project convention (CLAUDE.md): module under `src/lib/prompts/` exports the
   zod response schema with its limit constants and a function returning `CompleteArgs`.

## Flow — `startLesson()`

1. **Reuse:** if a lesson dated today (local day) with status `PLANNED` or `IN_PROGRESS` exists →
   return it.
2. **Select:** `selectLessonInputs()` → profile, theme, grammar topic (may be `null` when the whole
   syllabus is mastered), 6–10 vocab items, due errors (unused here — M4).
3. **Mix:** `planExerciseMix(lessonNumber, { hasGrammar })` where `lessonNumber` = count of existing
   lessons + 1.
4. **Generate:** `completeJson("lesson_generation", lessonGenerationPrompt(input), lessonEnvelopeSchema)`.
5. **Validate each exercise:** per-type zod schema → deterministic checks. Invalid → dropped with a
   reason.
6. **Quality gate (Jev):** objective types only; confident failures are dropped.
7. **Enough?** ≥ 5 exercises → continue. Otherwise regenerate once (steps 4–6). Still < 5 →
   `LessonGenerationError` listing every drop reason.
8. **Persist** in one `prisma.$transaction` (sequential awaited queries only): `Lesson`
   (`PLANNED`, `theme`, `plan`), `Exercise` rows, grammar topic `NOT_STARTED → INTRODUCED` +
   `timesUsed++` + `lastUsedAt`, vocab `NEW → SEEN` + `lastSeenAt`.
9. Return `{ lessonId, reused }`.

## Components

### 1. Exercise schemas — `src/lib/lesson/exerciseSchemas.ts`

Pure module, reused by the M3c graders. One zod schema per `ExerciseType`, shapes exactly as in
`SPEC.md` §Exercise Types, each with `explain: string (10–400)` and `vocab: string[]` (default `[]`).

| Type | `type` tag | Shape (beyond `explain`, `vocab`) |
|---|---|---|
| `MULTIPLE_CHOICE` | `mcq` | `prompt`, `options` (3–5 strings), `answer: number`, `rationales: string[]` (same length as options) |
| `CLOZE_DROPDOWN` | `cloze_mc` | `text` with `___` gaps, `gaps: { options (2–4), answer }[]` (1–4) |
| `FILL_BLANK` | `open_cloze` | `text` with `___`, `gaps: { root?: string, accept: string[] (≥1) }[]` (1–3) |
| `WORD_BANK` | `word_bank` | `tokens: string[]`, `answer: string[]`, `accept_alt: string[][]` |
| `MATCH` | `match` | `left`, `right` (3–6 each, equal length), `answer: number[]` |
| `DIALOGUE_GAP` | `dialogue_gap` | `turns: string[]` (one contains `___`), `options` (2–4), `answer: number` |
| `DICTATION` | `dictation` | `tts: string`, `accept: string[]` (≥1) |
| `ERROR_CORRECTION` | `error_correct` | `tokens: string[]`, `answer: number`, `accept: string[]` (≥1) |
| `TRANSLATION` | `translation` | `source: string` (Russian), `reference: string` (English), `hint?: string` |
| `OPEN_WRITING` | `open_writing` | `prompt: string`, `minWords: number` (30–120), `hint?: string` |

Exports: `EXERCISE_TYPE_TAGS`, `exerciseSchemaFor(type)`, discriminated union `ExerciseContent`,
`parseExercise(raw): { ok: true; type; content } | { ok: false; reason }`. `TRANSLATION` direction in
M3b-2 is always L1 → English.

### 2. Deterministic checks — `src/lib/lesson/exerciseChecks.ts`

`checkExercise(content, ctx): string[]` (empty = fine; the type is the content's own `type` tag).
`ctx = { vocab: { id, headword }[] }`.

- every `answer` index within its options; `rationales.length === options.length`;
- number of `___` markers equals `gaps.length` (`cloze_mc`, `open_cloze`); exactly one `___` turn in
  `dialogue_gap`;
- `word_bank`: `answer` (and every `accept_alt`) is a sub-multiset of `tokens`; at least one
  distractor or reordering is possible (`tokens.length ≥ answer.length`, `answer.length ≥ 3`);
- `match`: `answer` is a permutation of `0..n-1`;
- `error_correct`: `answer` within `tokens`; no `accept` entry equals the wrong token (normalized);
- `dictation`: `tts` matches an `accept` entry under **loose** normalization (`normalizeLoose` =
  `normalizeAnswer` + all punctuation except apostrophes removed) — SPEC's own example keys
  `"I'd like a coffee, please."` with `"i'd like a coffee please"`, which the strict contract alone
  would reject;
- all typed `accept` entries are non-empty after normalization (SPEC normalization contract: trim →
  collapse whitespace → lowercase → strip edge punctuation → straighten quotes) — the normalizer is
  implemented here as `normalizeAnswer()` and later reused by the graders;
- `vocab` ids ⊆ `ctx.vocab` ids; for each listed id, its headword occurs somewhere in the exercise's
  English text (all string fields except `explain`/`rationales`), case-insensitively and
  inflection-tolerantly: a word of the text must start with the headword's stem, where stem = the
  headword minus a trailing `e`/`y` when it has 4 or more letters, else the whole headword; for a
  multi-word headword every word must match in order. (`make` ↔ `making`, `study` ↔ `studied`.)

### 3. Exercise mix — `src/lib/lesson/exerciseMix.ts`

```ts
planExerciseMix(lessonNumber: number, opts: { hasGrammar: boolean }): ExerciseType[]
```

Recognition → scaffolded production → free production:
`MULTIPLE_CHOICE`, `CLOZE_DROPDOWN`, `FILL_BLANK`, `ERROR_CORRECTION`,
(`MATCH` if `lessonNumber` is odd else `WORD_BANK`),
(`DIALOGUE_GAP` if `lessonNumber` is odd else `DICTATION`), `TRANSLATION`,
plus `OPEN_WRITING` when `lessonNumber % 3 === 0`.
With `hasGrammar = false` the grammar-only `ERROR_CORRECTION` is replaced by the other vocab type
(so both `MATCH` and `WORD_BANK` appear). Pure, deterministic.

### 4. Generation prompt — `src/lib/prompts/lessonGeneration.ts`

Exports `LESSON_LIMITS`, `lessonEnvelopeSchema`, `type LessonEnvelope`, `lessonGenerationPrompt(input)`
→ `CompleteArgs`.

```ts
lessonEnvelopeSchema = z.object({
  exercises: z.array(z.unknown()).min(1).max(12),      // each parsed individually afterwards
  warmup:   z.object({ intro: string(20–400), questions: string[] (3–4, each 10–200) }),
  scenario: z.object({ title (5–80), role (10–300), goal (10–300), opening (10–300) }),
})
```

Input: profile (level, goals, interests, nativeLang), theme (label + description), grammar
(`title ?? name`, `description`, `example`) or `null`, vocab `{ id, headword, pos, cefrLevel }[]`,
the exercise mix, last ≤ 3 lesson summaries. The system prompt: strict JSON only; exactly one
exercise per requested type, in the given order, each with its `type` tag; **the literal JSON shape
of every requested type** (only the requested ones are included); build everything around the given
grammar focus and theme, introduce no other grammar focus; every exercise that practises a target
word lists its id in `vocab` and uses the headword; level-appropriate natural English; `explain` in
English, short; exactly one correct option in choice exercises; `accept` lists every reasonable
variant (contractions, both spellings); Russian only in `TRANSLATION.source`; limits stated from
`LESSON_LIMITS`.

### 5. Jev gate prompt — `src/lib/prompts/exerciseGate.ts`

Three `Noul` questions per objective exercise, state = the single exercise rendered as plain facts
(prompt/text with the keyed answer filled in, the other options, the grammar focus title+description):

| id | question | drop when |
|---|---|---|
| `key_correct` | the sentence with the keyed answer filled in is correct, natural English | noul ≤ 0.2 |
| `other_correct` | at least one of the OTHER options would also be fully correct in the gap | noul ≥ 0.8 |
| `on_focus` | the exercise practises the given grammar focus (skipped when there is no grammar) | noul ≤ 0.2 |

Gated types: `mcq`, `cloze_mc`, `dialogue_gap`, `error_correct`, `open_cloze` (`key_correct` with
`accept[0]`, no `other_correct`). Not gated: `word_bank`, `match`, `dictation`, `translation`,
`open_writing`. Thresholds live in `GATE_THRESHOLDS`. Exports the criteria text and
`gateQuestions(exercise, grammar)` / `gateState(exercise, grammar)`.

### 6. Quality gate — `src/lib/lesson/qualityGate.ts`

`runQualityGate(exercises, grammar, client): Promise<{ status: "passed" | "partial" | "skipped"; verdicts }>`
— one request per exercise, at most 4 in flight, injected TypeSafe client. Any client error (incl.
missing key) → `status: "skipped"`, nothing dropped. `partial` = at least one exercise dropped.

### 7. Orchestration — `src/lib/lesson/generateLesson.ts`

`generateLesson(inputs, deps): Promise<LessonDraft>` with `deps = { ask, gate }` injected.
`LessonDraft = { exercises: { type; content }[]; warmup; scenario; qualityGate; drops: { index; type?; reason }[]; attempts: 1 | 2 }`.
Keeps surviving exercises in mix order. Regeneration resends the same prompt (fresh sample).

### 8. Persistence — `src/lib/lesson/createLesson.ts`, `startLesson.ts`

`Lesson.plan` (final SPEC shape):

```jsonc
{ "version": 1,
  "sections": {
    "review":   { "exerciseIds": [] },
    "warmup":   { "intro": "…", "questions": ["…"] },
    "written":  { "exerciseIds": ["…"] },
    "scenario": { "title": "…", "role": "…", "goal": "…", "opening": "…" } },
  "meta": { "grammarTopicId": "…" | null, "vocabIds": ["…"], "exerciseMix": ["MULTIPLE_CHOICE", …],
            "qualityGate": "passed" | "partial" | "skipped", "drops": 0, "attempts": 1 } }
```

`createLesson(draft, inputs, db)` runs the writes of Flow step 8 inside `db.$transaction`,
sequentially. `startLesson(deps)` implements Flow steps 1–3 and 9. "Today" = same local calendar
day as `now` (injected).

### 9. Route — `src/app/api/lesson/start/route.ts`

`POST` only; `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`.
`200 { lessonId, reused }` · `409` `ProfileMissingError` · `502` `LessonGenerationError` (message +
drop reasons) · `500` anything else (message only, no stack).

### 10. Selection changes — `src/lib/curriculum/select.ts`, `lessonInputs.ts`

- `pickGrammarFocus(topics, level)`: first, if a band below exists, the pool of that band filtered to
  `teachable && importance === 1 && status !== "MASTERED"` — same ordering rule; if non-empty, pick
  from it. Then the existing walk from `level` upward.
- `selectLessonInputs`: lesson history query filters `status in (IN_PROGRESS, COMPLETED)`.

### 11. Acceptance tool — `scripts/lesson-preview.ts` (`npm run lesson:generate`)

Runs selection + `generateLesson` live (Claude + Jev), prints the whole lesson readably (every
exercise with its key, gate verdicts, drops, warm-up, scenario, timing). Writes nothing to the DB.

**Calibration gate.** After `generateLesson` works, the owner reviews 2–3 generated lessons
(quality, level, theme/grammar fit, gate behaviour); the prompt is tuned if needed. The route task
proceeds only after acceptance.

## Error handling

| Situation | Behaviour |
|---|---|
| no `Profile` | `ProfileMissingError` → 409 |
| syllabus mastered (`grammarTopic = null`) | vocab-only lesson (`hasGrammar = false`) — not an error |
| envelope invalid twice | `completeJson` throws → `LessonGenerationError` → 502; nothing written |
| < 5 exercises after the regeneration | `LessonGenerationError` with all drop reasons → 502 |
| Jev error / key missing | gate `skipped`; lesson created |
| failure during persistence | transaction rolls back; nothing written |
| two `start` calls the same day | the second reuses the first's lesson (single-user; no unique index — accepted simplification) |

## Testing (TDD)

Schemas (SPEC example valid + 2–3 invalid per type) · checks (each rule, incl. `normalizeAnswer`) ·
mix (order, parity, every third lesson, `hasGrammar = false`, determinism) · generation prompt (only
requested shapes, vocab ids, limits equal constants, `title ?? name` fallback) · gate prompt (state
for each gated type, skipped types) · `runQualityGate` with a fake client (drop on confident no,
keep on uncertain, skipped on error, ≤ 4 concurrent) · `generateLesson` (all good; some dropped but
≥ 5; regeneration rescues; two failures throw; order preserved) · `createLesson` / `startLesson`
with a fake db (write order, status transitions, plan shape, same-day reuse, history filter) · route
(status mapping) · `pickGrammarFocus` below-level cases. Live Claude/Jev only in
`npm run lesson:generate` and the final manual check. `npx tsc --noEmit` before every commit.

## Out of scope

Answer checking, `ErrorRecord`s, graders (M3c) · player, cards, dashboard button (M3d) · review
block and all status advancement incl. the below-level fast-track (M4) · voice health checks (M5) ·
L2 → L1 translation exercises · regenerating a single dropped exercise.

## Documentation updates (part of this work)

`SPEC.md` (grammar-focus rule with the below-level core; plan JSON shape; exercise mix decided by
code; quality gate; theme rotation counts only started lessons; health checks deferred to M5),
`CLAUDE.md` (commands, milestone status, LLM layer: Jev quality gate at lesson start).
