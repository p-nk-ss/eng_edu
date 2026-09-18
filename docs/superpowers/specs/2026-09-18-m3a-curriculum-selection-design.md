# M3a — Curriculum selection: themes, vocab topics, deterministic lesson inputs

**Date:** 2026-09-18 · **Status:** approved design · **Parent:** `SPEC.md` §Curriculum, milestone M3

M3 is split into four sub-projects, each with its own spec → plan → implementation cycle:

| Part | Scope | Depends on |
|---|---|---|
| **M3a (this doc)** | theme source, vocab topic classification, `Profile`, deterministic selection | — |
| M3b | exercise zod schemas, `lesson_generation` prompt, quality gate, `POST /api/lesson/start` | M3a |
| M3c | local graders, `judge` role (TypeSafe/Jev → Claude escalation), `POST /api/exercise/check` | M3b schemas |
| M3d | `/lesson/[id]` player + gamified exercise cards | M3b, M3c |

## Problem

`SPEC.md` selects the lesson theme from `Profile.interests` × CEFR-J thematic categories and draws
new vocab from the theme's category. CEFR-J Vocabulary Profile v1.5 has **no** thematic categories,
so `VocabItem.topic` is `null` for all 9780 rows (`data/README.md`). Also, no `Profile` row is ever
created. Without both, the deterministic selection step of lesson generation cannot run.

## Decisions

1. **Themes are a curated, fixed list in code** — not derived from `Profile.interests`.
2. **One theme per word**, stored in the existing `VocabItem.topic` column. Low-confidence and
   non-thematic words get `general`.
3. **Words are classified once, offline, by TypeSafe Jev**; the result is committed as
   `data/vocab-topics.csv` and applied by the seed. No TypeSafe call at runtime in M3a.
4. **`Profile` is seeded from `data/profile.json`** (create-if-missing). No settings UI.
5. **Interest → theme mapping is manual** (`preferredThemes` keys in the profile file) — no LLM in
   the selection path, preserving "code decides what to teach".

Background: a spike on 2026-09-18 showed Jev grading 40 learner translations at 40/40
accept/reject with ~300 ms p50 latency and ~$0.001 per 40 calls. Classification of single words
into a closed set is a simpler task, but is still calibrated on a pilot before the full run (below).

## Components

### 1. Theme list — `src/lib/curriculum/themes.ts`

```ts
export interface Theme { key: string; label: string; description: string }
export const THEMES: readonly Theme[];        // 21 lesson themes, order is significant (tie-break)
export const GENERAL_TOPIC = "general";       // not a lesson theme; never rotated
```

`description` states what belongs in the theme and what does not. It is used verbatim as the Jev
`Choice` criterion and later (M3b) as prompt input for Claude.

Themes: Work & careers · Business & money · Technology & internet · Science & research ·
Education & learning · Health & medicine · Body & appearance · Food & drink · Home & daily life ·
Family & relationships · Feelings & personality · Travel & transport · City & places ·
Nature & environment · Animals & plants · Sports & fitness · Entertainment & media ·
Arts & culture · Shopping & clothes · Society, law & politics · Communication & language.

Keys are short kebab-case slugs fixed in `themes.ts` (e.g. `technology`, `work`, `entertainment`,
`health`); they are what `VocabItem.topic`, `Lesson.theme` and `preferredThemes` store.

`general` covers function words, general-purpose verbs/adjectives/adverbs, numbers, time and
measurement.

### 2. TypeSafe client — `src/lib/typesafe/client.ts`

Minimal `fetch`-based client for `POST https://api.typesafe.ai/v1/systemone` (no SDK dependency).

- `systemOne({ state, questions, model? })` → typed answers; question builders `choice()`,
  `noul()`, `score()` with answer types inferred from the question map.
- Auth: `TYPESAFE_API_KEY` (already in `.env.local`); throws a clear error when unset.
- Retries 429 / 529 with exponential backoff (max 4); other non-2xx → `TypeSafeError` with status
  and body.
- `fetch` is injectable for tests. Model defaults to `jev-latest`.

Used only by the classification script in M3a; becomes the base of the `judge` role in M3b/M3c.

### 3. Classification script — `scripts/classify-vocab.ts`

Run directly with `tsx`; loads `.env.local` **before** any import that touches env (project gotcha).
It reads the vocab from the curriculum CSV loaders (`src/lib/curriculum/load.ts`), **not** the DB,
so it works without a running database.

- One `Choice` question per word; criteria = every theme description + `general`. **One word per
  request** (state `{ words: [w] }`, question `w0`), `CONCURRENCY = 8` requests in flight. The
  pilot originally batched ~50 words into a shared `state`, but neighbouring words contaminated
  each other's answers (`general` share 71.6% → 41.7% after switching to one word per request; 4 of
  5 confident errors fixed); tokens per word are dominated by the ~22 criteria, so per-word cost is
  unchanged.
- Output row: `headword,pos,topic,confidence`. If `confidence < THRESHOLD` → `topic=general`
  (the raw top choice is kept in a fifth column `rawTopic` for review).
- **Resumable:** rows already present in the CSV are skipped; output is appended per batch.
- Flags: `--pilot` (stratified ~200-word sample across CEFR levels → `data/vocab-topics.pilot.csv`),
  `--limit N`, `--threshold X`.
- Final CSV is sorted by `headword,pos` for stable diffs.

**Calibration gate.** Run `--pilot` first. The owner reviews the pilot CSV; theme descriptions and
`THRESHOLD` are tuned (Jev reads criteria literally — see its jaggedness notes). The full run starts
only after the pilot is accepted. Expected full-run cost: well under $1.

### 4. Seed changes — `prisma/seed.ts`

- If `data/vocab-topics.csv` exists, set `VocabItem.topic` from it during the vocab upsert
  (matched on `headword+pos`). Rows without a match keep `topic = null`. Unknown topic keys fail the
  seed with a clear message. Missing file → current behaviour, with a warning.
- Create the `Profile` row from `data/profile.json` **only if no profile exists** (never
  overwrites). `preferredThemes` keys are validated against `THEMES` with zod.

`data/profile.json` initial content (owner edits later):

```json
{
  "level": "B1",
  "goals": "conversational fluency, work meetings",
  "interests": "IT, QA, gaming",
  "nativeLang": "ru",
  "preferredThemes": ["technology", "work", "entertainment"]
}
```

### 5. Schema migration

```prisma
model Profile { …  preferredThemes String[] @default([]) }
model Lesson  { …  theme           String? }   // theme key; enables LRU rotation without parsing plan JSON
```

### 6. Selection — `src/lib/curriculum/select.ts`

Pure functions over in-memory arrays (no DB, no clock). The DB wrapper lives in a separate file
(`lessonInputs.ts`) with an injectable `db`, so `select.ts` never imports Prisma:

- `parseLevel(level)` — `"B1+"` → `"B1"`; throws on an unrecognised value.
- `pickTheme(themes, preferred, recentThemes)` — weighted least-recently-used. For each theme,
  `age` = number of lessons since it was last used (`recentThemes` is newest-first; a never-used
  theme has `age = Infinity`). `score = age × 2` for preferred themes, `age` otherwise. Pick the
  highest score; ties (incl. several never-used themes) break by preferred first, then `THEMES`
  order. Effect: every theme is visited, preferred ones come back about twice as often.
- `pickGrammarFocus(topics, level)` — among topics at `level` with `status != MASTERED`:
  `PRACTICING` with open (non-`MASTERED`) errors → `PRACTICING` → `INTRODUCED` → `NOT_STARTED`;
  within a group by `sortOrder`. If the level is exhausted, continue at the next CEFR band.
  Returns `null` only when the whole syllabus is mastered.
- `pickVocab(items, theme, level, target = 8)` — 6–10 items:
  up to 3 `LEARNING` items (oldest `lastSeenAt` first), then `NEW` items with `topic === theme` at
  `level`, then one band above, then `general` at `level`, then any `NEW` item at `level` (covers
  an unclassified DB). Stable order within a pool: headword.
  Returns fewer than 6 only if the pools are genuinely exhausted.

Thin DB wrapper:

```ts
selectLessonInputs(now = new Date()): Promise<{
  profile: Profile; theme: Theme; grammarTopic: GrammarTopic | null;
  vocab: VocabItem[]; dueErrors: ErrorRecord[];
}>
```

- `dueErrors` = `nextReviewAt <= now`, `status != MASTERED` (query only; review-block logic is M4).
- Reads recent `Lesson.theme` values (newest first, non-null).
- **No writes.** Status transitions (`NOT_STARTED → INTRODUCED`, `NEW → SEEN`, `Lesson.theme`) happen
  when the lesson is created — M3b.
- Missing profile → `ProfileMissingError` telling the owner to run `npx prisma db seed`.

### 7. Preview command — `npm run curriculum:preview`

`scripts/curriculum-preview.ts` prints the selection for the next 5 lessons, simulating
`recentThemes` growing between iterations (vocab/grammar statuses are not simulated). This is the
manual verification checkpoint for M3a.

## Error handling

| Situation | Behaviour |
|---|---|
| `TYPESAFE_API_KEY` unset | client throws before any request |
| 429 / 529 | backoff retry ×4, then `TypeSafeError`; script exits non-zero, progress is kept (resumable) |
| `vocab-topics.csv` missing | seed warns, topics stay `null`; selection falls back to `general`/level pools |
| unknown theme key in CSV or profile | seed fails with the offending key |
| no `Profile` row | `ProfileMissingError` |
| theme pool exhausted at level | next band, then `general` — never an empty lesson while any `NEW` word exists |

## Testing (TDD)

- `themes.test.ts` — keys unique, `general` not in `THEMES`, every description non-empty.
- `client.test.ts` — request shape, auth header, answer typing, retry on 429/529, error mapping
  (injected `fetch`).
- `select.test.ts` — rotation order, preferred weighting, tie-breaks, LRU after history; grammar
  priority groups and band overflow; vocab mix, pool exhaustion fallbacks, determinism (same input
  → same output); `parseLevel`.
- `selectLessonInputs` — tested against a hand-written fake `db` object (injected), incl.
  `ProfileMissingError`.
- Seed helpers (CSV → topic map, profile validation) as pure functions with unit tests.
- The classification script's batching/threshold/resume logic lives in testable pure helpers; the
  live API run is manual (pilot gate).
- `npx tsc --noEmit` before every commit.

## Out of scope

Lesson generation and any write side-effects of selection (M3b) · graders and the `judge` role
(M3c) · UI (M3d) · review-block logic and SRS transitions (M4) · settings page for `Profile` ·
multi-theme words.

## Documentation updates (part of this work)

`SPEC.md` §Curriculum (theme source = curated list + Jev-classified topics; `preferredThemes`),
`data/README.md` (new `vocab-topics.csv`, `profile.json`, how to regenerate), project `CLAUDE.md`
(TypeSafe in the stack, `TYPESAFE_API_KEY`, M3 sub-milestones).
