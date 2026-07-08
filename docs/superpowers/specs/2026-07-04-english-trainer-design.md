# Design: English Trainer — Adaptive Daily Lessons

**Date:** 2026-07-04
**Base spec:** [`SPEC.md`](../../../SPEC.md) — this document layers decisions and gap-fixes on top of it.
**Status:** Approved decisions, pending user review before implementation planning.

## 1. Purpose

Personal single-user web app for improving spoken/written English toward conversational
fluency. Runs a daily lesson loop (speaking + writing), tracks every mistake, schedules
reinforcement via spaced repetition, and generates the next lesson from a CEFR-grounded
syllabus. Full behaviour is defined in `SPEC.md`; this doc records the decisions that
`SPEC.md` left open and closes the gaps found during grilling.

## 2. Decisions taken (resolving `SPEC.md` open choices)

| Topic | Decision | Rationale |
|---|---|---|
| **Auth** | **None.** No login, no `ACCESS_PASSWORD`, no Auth.js. | Single user (owner). Removes a whole subsystem. The app runs locally on the owner's desktop (localhost, optional home-LAN); if it ever needs gating, add a single access-password middleware then — not now. |
| **Vocabulary source** | **CEFR-J Vocabulary Profile CSV** (headword, pos, CEFR level, thematic category). | Thematic categories enable topic-based vocab selection tied to conversation topic. |
| **Plan scope** | **All six milestones M1–M6.** | User wants the full picture up front. |
| **Error ↔ Topic link** | **Variant 3:** add `ErrorRecord.grammarTopicId` (nullable FK) for exact grammar matching **and** keep free-text `category` for human-readable description and vocab errors (which have no topic). | String matching of free-text categories against topic names is unreliable and breaks mastery logic. FK gives deterministic matching; `category` keeps the log readable. |
| **CEFR level advancement** | **Automatic by progress.** When ≥ `LEVEL_UP_THRESHOLD` (default 80%) of a level's `GrammarTopic`s are `MASTERED`, code advances `Profile.level` to the next CEFR band. | User wants an autonomous loop; no manual gate. |
| **Vocab mastery tracking** | **Exercises only.** `VocabItem.correctStreak` advances solely from exercise answers (translation / multiple-choice). Conversation usage does **not** affect vocab status in MVP. | Keeps the conversation prompt/return schema simple; avoids per-turn vocab-usage detection. |
| **Target browser** | **Chrome on desktop.** `webkitSpeechRecognition` STT (behind `lib/stt.ts`) first-class. TTS is local **Kokoro-82M** (streaming) with `speechSynthesis` fallback — see §5 Voice Stack. | Web Speech STT is reliable in desktop Chrome; local Kokoro gives better/streaming tutor voice. |
| **Exercise-type set** | **All 8 MVP objective types** (MULTIPLE_CHOICE, CLOZE_DROPDOWN, FILL_BLANK, WORD_BANK, MATCH, DIALOGUE_GAP, DICTATION, ERROR_CORRECTION) + LLM-graded TRANSLATION/OPEN_WRITING; drag/STT types are post-MVP. Full menu + JSON shapes in `SPEC.md` §"Exercise Types". | Variety across all five skills; 8/10 graded locally with no LLM at answer time. |
| **TTS pipeline** | **Server, sentence-chunked.** Server takes local-LLM token stream, splits into sentences, synthesises each via Kokoro, streams audio chunks to the client; client just plays. | Meets the ≤1.5 s budget; keeps TTS/fallback logic server-side. |
| **Local services down at start** | **Block the whole lesson.** `lesson/start` health-checks LM Studio + Kokoro; if either is down, the lesson does not start. Browser `speechSynthesis` fallback covers only mid-lesson Kokoro drop after a healthy start. | Simple, predictable; conversation + review are core to a lesson. |
| **Finding severity → ErrorRecord** | Findings carry `severity ∈ minor\|moderate\|major`. **Only `major`** become ErrorRecords (deduped by `grammarTopicId ?? category`); all are shown in the review. | Keeps spaced-repetition from flooding with minor slips. |
| **Conversation theme** | **Code picks it first** (interests × CEFR-J categories, LRU) before vocab selection, then passes it to Claude. | Removes the chicken-and-egg where vocab depended on an LLM-chosen topic. |
| **Visual direction** | **Gamified but adult**, indigo `#4F46E5` + green `#16A34A` progress, light **+** dark, Nunito + Inter. Full system in `docs/DESIGN.md`. | User values clear, motivating visuals; wants gamified feel without childishness. |

## 3. Gaps closed (decided by implementer, recorded here)

1. **Lesson resume — current-section pointer.** Add `Lesson.currentSection Int @default(0)`.
   The player advances it as the user completes each of the 5 sections; `POST /api/lesson/start`
   resumes an `IN_PROGRESS` lesson at `currentSection`. Section order is fixed (Review → Warm-up
   → Written → Scenario → Wrap-up).
2. **"One lesson per day" timezone.** Idempotency keyed on the user's **local calendar day**
   (server local time; single user). A helper `startOfLocalDay()` defines the boundary; `start`
   returns the existing lesson if one exists for today.
3. **Conversation correction → ErrorRecord dedup.** The real-time loop leaves
   `ConversationTurn.corrections` NULL. When a conversation section ends,
   `POST /api/conversation/analyze` sends the transcript to Claude (`conversation_analysis` role),
   writes **all** findings back to each turn's `corrections` (for the review UI), and converts
   **only `major`-severity findings** into `ErrorRecord`s: **one per (grammarTopicId ?? category)**
   for the session, `description` concatenating the distinct offending sentences. Prevents
   duplicate rows and keeps spaced-repetition from flooding with minor slips.
   `POST /api/lesson/complete` no longer materialises corrections.
4. **`NOT_STARTED → INTRODUCED`.** A `GrammarTopic` moves to `INTRODUCED` the first time it is
   selected into a lesson plan (in the deterministic selection step, at lesson generation).
5. **Cold start (day 1).** No errors, no history, no `nextPlan`: Review block is skipped/empty,
   curriculum picks the first `NOT_STARTED` topic at the user's level and `NEW` vocab from a
   default thematic category; conversation topic drawn from `Profile.interests`.
6. **Migrations.** Use `prisma migrate dev` locally (committed migration files), not `db push`.
   `prisma db seed` runs the idempotent curriculum seed.
7. **Testing strategy.** TDD on the deterministic core — `lib/curriculum.ts` (selection),
   spaced-repetition scheduling, status-advancement rules, and strict-JSON parsing/zod
   validation. The `lib/llm.ts` provider is mocked in route/integration tests (no live LLM calls in the test suite).
   Web Speech is behind a thin adapter so UI logic is testable without the browser API.

## 4. Data model deltas vs `SPEC.md`

- `ErrorRecord`: **+ `grammarTopicId String?`** and relation to `GrammarTopic`; `category` kept.
- `GrammarTopic`: **+ `errors ErrorRecord[]`** back-relation.
- `Lesson`: **+ `currentSection Int @default(0)`**.
- `ExerciseType` enum **expanded** to the MVP set + post-MVP placeholders (see `SPEC.md` §"Exercise Types").
- `ConversationTurn.corrections` JSON now `{turnId, grammarTopicId?, original, corrected, explanation, category, severity}`, filled post-hoc.
- These are now folded directly into the `SPEC.md` Prisma block (no longer SPEC-vs-design divergence).

## 5. Architecture (unchanged from `SPEC.md`, summarised)

- **Next.js 15 App Router + TypeScript**, Tailwind. Server-only LLM calls.
- **Postgres (Neon) + Prisma 7** (`@prisma/adapter-pg`, `prisma.config.ts`, pooled `DATABASE_URL`).
- **Runs locally** on the owner's Windows desktop (Ryzen 5700X3D, RX 9070 XT 16GB); Neon stays cloud.
  No Docker/VPS/serverless.
- **LLM access** via `lib/llm.ts` with **per-role routing** (`config/llm-roles.ts`, env-overridable),
  each provider exposing `complete()` and `stream()`. `AgentSDKProvider` (Claude `sonnet`, subscription)
  handles teaching roles; `DirectAPIProvider` (`claude-sonnet-4-6`, `ANTHROPIC_API_KEY`) is the fallback;
  **`LocalProvider`** (LM Studio, Qwen3-14B, `LOCAL_LLM_URL`) handles the streaming `conversation`
  role. See `SPEC.md` §"LLM Access Layer". Objective exercises are checked by **local code** against
  pre-generated answers — no LLM call.
- **Conversation** is split: real-time local-LLM loop (`/api/conversation/turn`, streaming, no
  corrections) + post-hoc Claude analysis (`/api/conversation/analyze` → Conversation Review). Applies
  to both warm-up and scenario.
- **Voice** (`SPEC.md` §"Voice Stack"): server-side **sentence-chunked** Kokoro-82M streaming TTS
  (`KOKORO_URL`) with `speechSynthesis` fallback; STT behind swappable `lib/stt.ts`.
- **Exercise types** (`SPEC.md` §"Exercise Types"): 10 MVP types, per-type zod schemas + local
  graders (normalization contract); only TRANSLATION/OPEN_WRITING are LLM-graded.
- **Design system** (`docs/DESIGN.md`): gamified-adult, indigo+green, light+dark, Nunito+Inter,
  semantic tokens; run `frontend-design` / `ui-ux-pro-max` / `emil-design-eng` on UI milestones.
- **Prompts** (Claude **and** local) as typed template functions in `lib/prompts/`.
- **Curriculum engine** `lib/curriculum.ts` — deterministic selection (theme → grammar → vocab → due errors) feeding the lesson-generation prompt.
- **Spaced repetition** `lib/srs.ts` — intervals 1d → 3d → 7d → 14d, streak/status rules per `SPEC.md`.
- Routes per `SPEC.md` §"API Routes"; pages per §"Pages / UI".

## 6. Milestones (scope = all six, per `SPEC.md` §Milestones)

M1 Skeleton (3 providers + role routing + design-system foundation) · M2 Curriculum seed ·
M3 Written exercises (MVP exercise-type set + local graders + gamified cards) · M4 Spaced
repetition · M5 Conversation (LocalProvider real-time loop + streaming STT/TTS + post-hoc Claude
analysis/review) · M6 Scenarios + wrap-up. Each ends with a manual verification checkpoint.
UI-bearing milestones run through the design skills (`docs/DESIGN.md`). No auth.

## 7. Non-goals (per `SPEC.md`)

No pronunciation scoring, no multi-user, no native app, no audio storage. **Added:** no auth.
**Deployment is local-first** on the owner's Windows desktop (local LLM + Kokoro TTS on the GPU;
Neon in the cloud; no Docker/VPS/serverless) — see `SPEC.md` §"Deployment" and `docs/LOCAL_SETUP.md`.
Local faster-whisper STT is a planned post-MVP upgrade behind `lib/stt.ts`.
