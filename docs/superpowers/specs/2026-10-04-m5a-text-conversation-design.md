# M5a — Warm-up conversation (text) with post-conversation review

**Date:** 2026-10-04 · **Status:** approved design · **Parent:** `SPEC.md` §Lesson flow (warm-up),
§Conversation Review, §API (`/api/conversation/turn`, `/api/conversation/analyze`), §Prompts.
M5 is split (owner, 2026-10-04): **M5a** text conversation + analysis (this spec), **M5b** voice
(push-to-talk STT with editable transcript, Kokoro sentence-chunked TTS with browser fallback,
service health indicators, latency benchmark). Scenario + wrap-up stay in M6.

## Problem

The lesson has no speaking practice yet: the warm-up framing Claude writes at generation time
(`plan.sections.warmup = { intro, questions }`) is never used, and mistakes made in free production
never reach the review cycle.

## Decisions (owner, 2026-10-04)

1. **Order:** intro → review block → **warm-up conversation** → written exercises → results.
2. **Never blocks the lesson.** The warm-up can be skipped ("Skip conversation"). If LM Studio is
   down, the section is marked unavailable with a hint and the lesson continues. This **replaces**
   SPEC's rule "local services gate lesson start" (SPEC §Voice stack failure handling is updated).
3. **Length by learner turns:** target **8**, hard cap **12**. After the 8th learner turn the partner
   wraps up politely and "Finish & review" becomes primary. Finish allowed any time; fewer than **2**
   learner turns → no analysis, section counts as skipped, no errors.
4. **Only `major` findings become `ErrorRecord`s** (as SPEC), one per `(grammarTopicId ?? category)`
   per conversation, examples appended; all findings are shown in the review.
5. **Transport:** one streaming HTTP response per turn (plain text deltas via `fetch` reader).
6. The conversation never affects `writtenScore` or topic advancement.

## Data model (one additive migration)

```prisma
enum ConversationMode { WARMUP SCENARIO }                 // SCENARIO used from M6
enum ConversationStatus { ACTIVE ANALYZED SKIPPED UNAVAILABLE }

model ConversationSession {
  id         String             @id @default(cuid())
  lessonId   String
  lesson     Lesson             @relation(fields: [lessonId], references: [id])
  mode       ConversationMode
  status     ConversationStatus @default(ACTIVE)
  review     Json?              // { topIssues: string[]; counts: {minor,moderate,major}; errorsAdded: number }
  createdAt  DateTime           @default(now())
  endedAt    DateTime?
  turns      ConversationTurn[]
  @@unique([lessonId, mode])
}

model ConversationTurn {          // existing; gains:
  sessionId  String?              // null for legacy rows (none exist)
  session    ConversationSession? @relation(fields: [sessionId], references: [id])
  turnIndex  Int      @default(0) // 0 = partner opening; learner/partner alternate
  // role: "partner" | "learner"; corrections Json? (findings for learner turns, filled by analyze)
}
```

Design note: section state lives in its own row (not inside `Lesson.plan` JSON, as first sketched in
chat) so status changes are single-row updates, `@@unique` makes session creation idempotent, and M6
reuses it for the scenario. No session row = warm-up not started (`pending`).

## Components

### 1. Rules — `src/lib/conversation/rules.ts` (pure)

Constants `TARGET_TURNS = 8`, `MAX_TURNS = 12`, `MIN_TURNS_FOR_REVIEW = 2`, `MAX_TURN_CHARS = 600`.
`learnerTurnCount(turns)`, `shouldWrapUp(count)` (count + 1 === TARGET_TURNS, i.e. the reply to the
8th learner turn), `canSend(session, count)` → `"ok" | "closed" | "limit"`,
`finishOutcome(count)` → `"analyze" | "skip"`.

### 2. Prompts

- `src/lib/prompts/conversationPartner.ts` → `conversationPartnerPrompt({ level, interests, theme,
  intro, questions, grammar: { title, description } | null, vocab: string[], wrapUp: boolean,
  history })` → `CompleteArgs` for the `conversation` role. Rules in the system text: partner only;
  2-4 sentences, spoken register, one follow-up question; steer toward the theme, the grammar focus
  and target words naturally; **never correct, explain grammar or teach**, even if asked ("we'll
  review at the end"); plain text (no markdown, no emojis, no stage directions); `wrapUp` → thank the
  learner, close the conversation, no new question. History = previous turns mapped to
  assistant/user messages. Qwen thinking stays disabled (LocalProvider already does this).
- `src/lib/prompts/conversationAnalysis.ts` → `conversationAnalysisSchema` + limits and
  `conversationAnalysisPrompt({ level, turns: {id, text}[] (learner only, with partner context),
  grammarTopics: {id, title}[] })`. Response: `{ findings: { turnId, original, corrected,
  explanation, category, severity: "minor"|"moderate"|"major", grammarTopicId: string|null }[],
  topIssues: string[] (0-3) }`. `turnId` must be one of the supplied learner turn ids and
  `grammarTopicId` one of the supplied ids or null — unknown ids are dropped (finding) / nulled (topic)
  by code after parsing. Category vocabulary matches existing error categories so the M4b review
  block can generate exercises: grammar finding with a topic → category = topic title; otherwise
  `vocab: <word>`, `general`, or `word order`/`tense`-style plain labels mapped to `general`.
  Called with `completeJson("conversation_analysis", ...)` (Claude, existing retry/fence handling).

### 3. Service — `src/lib/conversation/`

- `session.ts`: `getWarmup(lessonId, db?)` → `{ session | null, turns }`; `startWarmup(lessonId)`
  creates the session (idempotent via unique) and the partner opening turn (`turnIndex 0`, text =
  `plan.sections.warmup.intro`) — no LLM call; `skipWarmup`, `markUnavailable`.
- `turn.ts`: `runTurn(lessonId, text, deps)` → `ReadableStream<string>`. Validates (400 empty/too
  long, 404 lesson, 409 `closed`/`limit`); persists the learner turn; streams `stream("conversation",
  conversationPartnerPrompt(...))`; on completion persists the partner turn. If the provider fails
  before the first delta → `PartnerUnavailableError` (route 503) and the learner turn is **removed**
  (so a retry does not duplicate it); a failure after partial output ends the stream with an error
  marker and keeps the partial partner text as the turn (learner can continue). Single-flight per
  lesson: a second turn while one streams → 409.
- `analyze.ts`: `analyzeWarmup(lessonId, deps)`. Fewer than 2 learner turns → status SKIPPED, no
  call. Otherwise one Claude call; in one transaction: write `corrections` per learner turn, create
  or append `ErrorRecord`s for major findings (`source: CONVERSATION`, `nextReviewAt` = now + 1 day,
  `grammarTopicId` when given; existing open record with the same key → append example, like
  written errors), set session `ANALYZED`, `review`, `endedAt`. Claude failure → `AnalysisUnavailableError`
  (502), nothing written, retry allowed. Already analyzed → returns the stored review (idempotent).

### 4. Routes

- `GET /api/conversation?lessonId=` → session state + turns (+ review when analyzed).
- `POST /api/conversation/start` `{lessonId}` → creates the session/opening (idempotent).
- `POST /api/conversation/turn` `{lessonId, text}` → `text/plain` stream of partner deltas;
  400 / 404 / 409 / 503 as above.
- `POST /api/conversation/finish` `{lessonId, action: "review" | "skip"}` → `review` runs
  `analyzeWarmup` (200 review payload / 502); `skip` sets SKIPPED.
- LM Studio unreachable on start/turn → 503 `{ error: "partner_unavailable" }`; the client then
  calls finish with `skip` only if the learner chooses Skip; a session stuck in ACTIVE simply resumes.

### 5. Player — `src/components/lesson/conversation/*`

- `LessonPlayer` gains a `warmup` phase between the review items and the written items (lessons
  without a warmup in the plan skip it). Resume rule: if the session is ACTIVE or not started and no
  written exercise is answered → open the warm-up; ANALYZED/SKIPPED/UNAVAILABLE → continue.
- `ConversationPanel`: label "Warm-up conversation", counter "3 of 8", transcript (partner left,
  learner right, `aria-live="polite"` for the streaming partner turn), typing indicator, textarea
  (Enter sends, Shift+Enter newline, disabled while streaming), buttons "Finish & review" (enabled
  from 2 learner turns, primary from 8) and "Skip conversation". Offline → "Conversation partner is
  offline" with "Try again" and "Skip" (typed text kept).
- `ConversationReview`: "Top issues", transcript with learner fragments highlighted by severity
  (colour + text label minor/moderate/major), corrected version + explanation under each turn,
  "N mistakes added to your review list", "Continue to exercises". Analysing state and analysis
  failure ("Couldn't analyse - Try again" / "Continue without review").
- Intro screen line "Conversation: 8 turns on <theme>"; results screen line
  "Conversation: N turns, M corrections" (or "skipped").

### 6. Script

`npm run conversation:try` — a terminal conversation against LM Studio for a synthetic lesson input
(no DB writes), then one analysis call; prints findings. Loads `.env.local` first.

## Error handling

| Situation | Behaviour |
|---|---|
| LM Studio down at start/turn | 503; panel shows offline state; learner text kept; Skip available |
| LM Studio drops mid-reply | partial partner text kept, error shown, learner can continue or finish |
| Claude analysis fails | 502, nothing written, retry or continue without review |
| 13th learner turn / turn after finish | 409 |
| double submit while streaming | 409 (single-flight) |
| finish with < 2 learner turns | SKIPPED, no analysis, no errors |
| finding with unknown turnId / topicId | finding dropped / topic nulled |
| reload mid-conversation | transcript restored, continue |

## Testing (TDD, no live model)

Rules (pure); both prompts (system text contains the no-correction rule, wrap-up switch, limits;
schema accepts/rejects); session/turn/analyze with fake provider + fake db (streaming, persistence
order, removal on early failure, 409/503/502, dedup and append of errors, idempotent analyze);
routes; `ConversationPanel` and `ConversationReview` (streaming render, counters, buttons, offline,
severity labels); player phase order and resume. `npx tsc --noEmit`, `npm run build`. Live check
when LM Studio is installed (`npm run conversation:try`, then one real lesson).

## Out of scope (M5b / M6)

Voice (STT/TTS), service health indicators, latency benchmark (M5b); scenario conversation,
lesson completion summary, next-lesson plan (M6).

## Documentation updates

`SPEC.md`: lesson flow order, warm-up never blocks the lesson (replaces the start gate), turn limits,
data model (`ConversationSession`, `ConversationTurn.sessionId/turnIndex`), routes as built.
`CLAUDE.md`: M5a status, `npm run conversation:try`.
