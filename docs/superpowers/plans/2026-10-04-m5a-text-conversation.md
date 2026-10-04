# M5a — Warm-up Text Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A warm-up text conversation between the review block and the written exercises: a local-LLM partner streams replies (no corrections), and on finish Claude analyses the transcript into a Conversation Review; `major` findings become `ErrorRecord`s.

**Architecture:** One additive migration (`ConversationSession`, `ConversationTurn.sessionId/turnIndex`). Pure rules + two prompt modules; a service layer in `src/lib/conversation/` (session, streaming turn, analysis) with injectable deps; four thin routes; client components for the conversation and the review, wired into `LessonPlayer` as a phase between review and written items.

**Tech Stack:** Next.js 15 route handlers (streaming `Response` with a `ReadableStream`), Prisma 7, zod 4, existing LLM layer (`stream("conversation")` -> LocalProvider, `completeJson("conversation_analysis")` -> Claude), React 19 client components, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-m5a-text-conversation-design.md` (read it first).

## Global Constraints

- **TDD:** failing test -> run red -> implement -> run green -> commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test` clean; UI/route tasks also `npm run build`.
- **Commit:** `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"` - exactly this trailer; check `git log -1 --format=%B`.
- Branch `feature/m5a-conversation`; never touch `main`, never push. No new npm deps. Never `git add` `skills-lock.json`, `AGENTS.md`, `.superpowers/`, `.env*`.
- Limits (verbatim from spec): `TARGET_TURNS = 8`, `MAX_TURNS = 12`, `MIN_TURNS_FOR_REVIEW = 2`, `MAX_TURN_CHARS = 600`; review `topIssues` 0-3; only `major` findings become `ErrorRecord`s (`source: CONVERSATION`, first review in 1 day), deduped per lesson by `(grammarTopicId, category)` with examples appended like written errors.
- The conversation never touches `writtenScore`, topic advancement or vocab status.
- Prisma calls sequential; no network inside a DB transaction (LLM calls happen before/after transactions).
- Prompt convention: `src/lib/prompts/<name>.ts` exports the zod schema with its limit constants and a function returning `CompleteArgs`; prompt text built from the same constants.
- UI: semantic tokens only, lucide icons (decorative ones `aria-hidden`), severity/state never colour alone (text label too), touch targets >= 44px, English copy, ASCII or `\u` escapes; no live LLM in tests.
- The real DB holds owner data: tasks do not write to it except the additive migration.

## Review Focus

1. **LM Studio down before the first token** -> 503, the learner turn is removed so "Try again" does not duplicate it; the typed text stays in the box. *(Task 3 test "early failure removes the learner turn"; Task 6 test "offline keeps the text")*
2. **Double submit / turn while a reply streams** -> 409, no second learner row. *(Task 3 test "single-flight")*
3. **Finish with fewer than 2 learner turns** -> SKIPPED, no Claude call, no errors. *(Task 4 test)*
4. **Analysis returns ids that do not exist** (turnId not a learner turn, unknown grammarTopicId) -> finding dropped / topic nulled, no crash. *(Task 4 test)*
5. **Reload mid-conversation or after review** -> transcript restored and the player opens the right phase (conversation vs written). *(Task 7 tests)*

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration | `ConversationSession`, enums, `ConversationTurn.sessionId/turnIndex` |
| `src/lib/conversation/rules.ts` | limits and pure decisions |
| `src/lib/prompts/conversationPartner.ts`, `conversationAnalysis.ts` | prompts + analysis schema |
| `src/lib/conversation/session.ts`, `turn.ts`, `analyze.ts` | service layer |
| `src/app/api/conversation/{route.ts,start,turn,finish}` | HTTP |
| `src/lib/lesson/loadLesson.ts` | `PlayerLesson.warmup` |
| `src/components/lesson/conversation/{ConversationPanel,ConversationReview}.tsx` | UI |
| `src/components/lesson/{LessonPlayer,LessonIntro,LessonResults}.tsx` | phase wiring and lines |
| `scripts/conversation-try.ts` | live terminal check |

---

### Task 1: Migration and rules

**Files:** Modify `prisma/schema.prisma` (+ migration); Create `src/lib/conversation/rules.ts`, `rules.test.ts`

**Interfaces:** Produces the Prisma models below; `TARGET_TURNS`, `MAX_TURNS`, `MIN_TURNS_FOR_REVIEW`, `MAX_TURN_CHARS`, `learnerTurnCount(turns: { role: string }[]): number`, `shouldWrapUp(learnerTurnsIncludingThis: number): boolean`, `canSend(status: ConversationStatusName | null, learnerTurns: number): "ok" | "closed" | "limit"`, `finishOutcome(learnerTurns: number): "analyze" | "skip"`, `type ConversationStatusName = "ACTIVE" | "ANALYZED" | "SKIPPED" | "UNAVAILABLE"`.

- [ ] **Step 1: Migration.** Add to `schema.prisma` (enums one value per line - Prisma 7 rule):

```prisma
enum ConversationMode {
  WARMUP
  SCENARIO
}

enum ConversationStatus {
  ACTIVE
  ANALYZED
  SKIPPED
  UNAVAILABLE
}

model ConversationSession {
  id        String             @id @default(cuid())
  lessonId  String
  lesson    Lesson             @relation(fields: [lessonId], references: [id])
  mode      ConversationMode
  status    ConversationStatus @default(ACTIVE)
  review    Json?
  createdAt DateTime           @default(now())
  endedAt   DateTime?
  turns     ConversationTurn[]

  @@unique([lessonId, mode])
}
```

`ConversationTurn` gains `sessionId String?`, `session ConversationSession? @relation(fields: [sessionId], references: [id])`, `turnIndex Int @default(0)`; `Lesson` gains `conversations ConversationSession[]`. `npx prisma format`; DB up; `npx prisma migrate dev --name m5a_conversation_session` -> only CREATE TYPE x2, CREATE TABLE, ADD COLUMN x2, index/FK statements (no DROP). `npx prisma generate`. Drift/reset prompt -> STOP.

- [ ] **Step 2: Failing tests** (`rules.test.ts`, node env):

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { canSend, finishOutcome, learnerTurnCount, shouldWrapUp, MAX_TURNS, TARGET_TURNS } from "./rules";

describe("conversation rules", () => {
  it("counts learner turns only", () => {
    expect(learnerTurnCount([{ role: "partner" }, { role: "learner" }, { role: "partner" }, { role: "learner" }])).toBe(2);
  });
  it("wraps up on the reply to the 8th learner turn only", () => {
    expect(TARGET_TURNS).toBe(8);
    expect(shouldWrapUp(7)).toBe(false);
    expect(shouldWrapUp(8)).toBe(true);
    expect(shouldWrapUp(9)).toBe(false);
  });
  it("allows sending only while active and under the cap", () => {
    expect(MAX_TURNS).toBe(12);
    expect(canSend("ACTIVE", 11)).toBe("ok");
    expect(canSend("ACTIVE", 12)).toBe("limit");
    expect(canSend("ANALYZED", 3)).toBe("closed");
    expect(canSend("SKIPPED", 0)).toBe("closed");
    expect(canSend(null, 0)).toBe("closed");
    expect(canSend("UNAVAILABLE", 0)).toBe("ok"); // a retry after an outage reopens the conversation
  });
  it("analyses from 2 learner turns", () => {
    expect(finishOutcome(1)).toBe("skip");
    expect(finishOutcome(2)).toBe("analyze");
  });
});
```

- [ ] **Step 3: Run red.**
- [ ] **Step 4: Implement** `rules.ts`:

```ts
export const TARGET_TURNS = 8;
export const MAX_TURNS = 12;
export const MIN_TURNS_FOR_REVIEW = 2;
export const MAX_TURN_CHARS = 600;

export type ConversationStatusName = "ACTIVE" | "ANALYZED" | "SKIPPED" | "UNAVAILABLE";

export const learnerTurnCount = (turns: { role: string }[]): number => turns.filter((t) => t.role === "learner").length;
/** True for the partner reply that answers the TARGET_TURNS-th learner turn. */
export const shouldWrapUp = (learnerTurnsIncludingThis: number): boolean => learnerTurnsIncludingThis === TARGET_TURNS;

export function canSend(status: ConversationStatusName | null, learnerTurns: number): "ok" | "closed" | "limit" {
  if (status !== "ACTIVE" && status !== "UNAVAILABLE") return "closed";
  return learnerTurns >= MAX_TURNS ? "limit" : "ok";
}

export const finishOutcome = (learnerTurns: number): "analyze" | "skip" => (learnerTurns >= MIN_TURNS_FOR_REVIEW ? "analyze" : "skip");
```

- [ ] **Step 5: Green; tsc; npm test; commit** `feat(m5a): conversation session schema and turn rules` (stage schema, migration dir, rules files).

---

### Task 2: Prompts

**Files:** Create `src/lib/prompts/conversationPartner.ts`, `conversationPartner.test.ts`, `conversationAnalysis.ts`, `conversationAnalysis.test.ts`

**Interfaces:**
- `conversationPartnerPrompt(input: PartnerInput): CompleteArgs` with `interface PartnerInput { level: string; interests: string; theme: string | null; intro: string; questions: string[]; grammar: { title: string; description: string | null } | null; vocab: string[]; wrapUp: boolean; history: { role: "partner" | "learner"; text: string }[] }`. Export `PARTNER_MAX_TOKENS = 220`.
- `conversationAnalysisSchema`, `ANALYSIS_LIMITS = { topIssues: 3, findings: 30, text: 300 }`, `type Severity = "minor" | "moderate" | "major"`, `type ConversationFinding = { turnId: string; original: string; corrected: string; explanation: string; category: string; severity: Severity; grammarTopicId: string | null }`, `conversationAnalysisPrompt(input: { level: string; turns: { id: string; role: "partner" | "learner"; text: string }[]; grammarTopics: { id: string; title: string }[] }): CompleteArgs`.

- [ ] **Step 1: Failing tests.**
  - Partner: system text contains "Never correct", "no grammar explanations", "2-4 sentences", the theme, the grammar title, every vocab word, the level; `history` maps partner -> `assistant`, learner -> `user` in order; the last message is the latest learner turn; `maxTokens === PARTNER_MAX_TOKENS`; `wrapUp: true` adds "wrap up" instructions and "Do not ask a new question"; `wrapUp: false` does not; null grammar/theme produce no "null"/"undefined" in the text.
  - Analysis: schema accepts a valid payload; rejects severity "critical", more than 3 `topIssues`, a `corrected` longer than 300; `findings` defaults to `[]` when missing; the prompt lists each learner turn as `[id] text` and partner turns as context lines, lists grammar topics `[id] title`, states that only learner turns are judged, that `grammarTopicId` must be one of the listed ids or null, the category rules (grammar topic title when a topic applies; else `vocab: <word>` for a wrong word choice; else `general`), and the severity definitions (major = blocks understanding or a core error at the learner's level; moderate = noticeable error; minor = slip/naturalness).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** Partner system text (build from constants; ASCII):

```
You are a friendly English conversation partner for a {level} learner. Theme: {theme}. Learner interests: {interests}.
Opening context: {intro}. Ideas you may ask about: {questions joined by "; "}.
Gently create chances for the learner to use {grammar.title} ({grammar.description}) and these words: {vocab}. Use them yourself naturally.
Rules: reply in 2-4 short sentences in a natural spoken register and end with one follow-up question. Plain text only - no markdown, emojis, lists or stage directions.
Never correct the learner, no grammar explanations, no teaching - even if asked; say "We'll review everything at the end" and keep talking.
```
Wrap-up line when `wrapUp`: `This is the last reply: thank the learner warmly, briefly wrap up the conversation. Do not ask a new question.` Omit the theme/grammar/vocab sentences when absent.
Analysis: zod schema per interfaces (`findings: z.array(finding).max(ANALYSIS_LIMITS.findings).default([])`, `topIssues: z.array(z.string().min(1).max(ANALYSIS_LIMITS.text)).max(ANALYSIS_LIMITS.topIssues).default([])`); system text asks for strict JSON `{ "findings": [...], "topIssues": [...] }`, empty arrays when the learner made no mistakes.
- [ ] **Step 4: Green; commit** `feat(m5a): conversation partner and analysis prompts`.

---

### Task 3: Session and streaming turn service

**Files:** Create `src/lib/conversation/session.ts`, `session.test.ts`, `turn.ts`, `turn.test.ts`

**Interfaces:**
- `type ConversationDb = Pick<PrismaClient, "lesson" | "conversationSession" | "conversationTurn" | "profile" | "grammarTopic" | "vocabItem">`.
- `class LessonNotFoundError`, `class TurnRejectedError { reason: "closed" | "limit" | "busy" | "invalid" }`, `class PartnerUnavailableError`.
- `getWarmup(lessonId, db?) -> Promise<{ status: ConversationStatusName | null; turns: { id: string; role: "partner" | "learner"; text: string; turnIndex: number; corrections: unknown }[]; review: WarmupReview | null }>` (turns ordered by `turnIndex`); `interface WarmupReview { topIssues: string[]; counts: { minor: number; moderate: number; major: number }; errorsAdded: number }`.
- `startWarmup(lessonId, db?)` -> same shape; creates the WARMUP session (status ACTIVE) and the partner opening turn `turnIndex 0` with `plan.sections.warmup.intro`, idempotent (existing session returned untouched; a unique-violation race is caught and re-read). Lesson missing -> `LessonNotFoundError`.
- `setWarmupStatus(lessonId, status: "SKIPPED" | "UNAVAILABLE", db?)` (creates the session if missing; SKIPPED also sets `endedAt`; never overwrites ANALYZED).
- `runTurn(lessonId: string, text: string, deps?: { db?: ConversationDb; stream?: (args: CompleteArgs) => AsyncIterable<string> }): Promise<ReadableStream<Uint8Array>>`.

- [ ] **Step 1: Failing tests** with a fake db (in-memory arrays; implement only the methods used) and a fake stream generator:
  - session: start creates session + opening turn from the plan intro; second start returns the same turns (no duplicate); `getWarmup` on a lesson without a session -> `{ status: null, turns: [], review: null }`; `setWarmupStatus("SKIPPED")` on ANALYZED leaves it ANALYZED.
  - turn: rejects "" / whitespace and > 600 chars (`invalid`); lesson missing -> `LessonNotFoundError`; status SKIPPED -> `closed`; 12 learner turns -> `limit`; happy path: persists the learner turn (`turnIndex` = last + 1) BEFORE calling the provider, streams the deltas through unchanged (read the stream to a string), then persists the partner turn with the joined text; the prompt passed to the provider has `wrapUp: true` exactly when this is the 8th learner turn (assert via a spy on the args' system text); "early failure removes the learner turn": provider throws before yielding -> `PartnerUnavailableError`, learner row deleted, session status UNAVAILABLE; failure after one delta -> stream ends with the partial text plus the marker `\n[connection lost]` NOT persisted; the partial text (without the marker) is saved as the partner turn; "single-flight": a second `runTurn` for the same lesson while the first stream is unread -> `busy`, and after the first completes a new turn is accepted; an UNAVAILABLE session becomes ACTIVE again on a successful turn.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** `runTurn`: validate -> load lesson (plan, theme) and session (`canSend` with `learnerTurnCount`) -> in-flight `Set<string>` guard (`busy`) -> create learner turn -> build `conversationPartnerPrompt` (profile level/interests; theme label via `THEMES`; `plan.sections.warmup.intro/questions`; grammar title/description from `plan.meta.grammarTopicId`; vocab headwords from `plan.meta.vocabIds`; history = all turns incl. the new one; `wrapUp = shouldWrapUp(count)`) -> pull the FIRST chunk from the provider iterator before returning (so an early failure throws `PartnerUnavailableError` after deleting the learner turn and marking UNAVAILABLE) -> return a `ReadableStream` that enqueues the first chunk and the rest (TextEncoder), and in its final step persists the partner turn and sets status ACTIVE; the in-flight guard is released in a `finally` of the stream's pull loop (and on cancel). Default `stream` = `(args) => stream("conversation", args)` from `@/lib/llm`.
- [ ] **Step 4: Green; commit** `feat(m5a): warm-up session and streaming turn service`.

---

### Task 4: Analysis service

**Files:** Create `src/lib/conversation/analyze.ts`, `analyze.test.ts`

**Interfaces:** Consumes Task 2 schema/prompt, Task 3 `getWarmup`/types. Produces `class AnalysisUnavailableError`, `finishWarmup(lessonId, action: "review" | "skip", deps?: { db?: ConversationDb & Pick<PrismaClient, "errorRecord" | "$transaction">; analyse?: (args: CompleteArgs) => Promise<ConversationAnalysis>; now?: Date }) -> Promise<{ status: ConversationStatusName; review: WarmupReview | null; turns: ... }>` (same turn shape as `getWarmup`, corrections filled).

- [ ] **Step 1: Failing tests** (fake db + fake analyse):
  - `skip` -> SKIPPED, `endedAt` set, analyse not called.
  - `review` with 1 learner turn -> SKIPPED, analyse not called, no errors.
  - happy path: 3 learner turns; findings for turns 1 and 3 (one major grammar with a valid topic id, one moderate, one major `vocab: deadline`) -> each learner turn's `corrections` = its findings array (turns without findings get `[]`); 2 `ErrorRecord`s created with `source: "CONVERSATION"`, `status: "NEW"`, `nextReviewAt = now + 1 day`, `description = "- original -> corrected"`, the grammar one with `grammarTopicId` and `category` = the topic's title (from the lesson's topic, not the model's category text); review `{ topIssues, counts: { minor: 0, moderate: 1, major: 2 }, errorsAdded: 2 }`; status ANALYZED.
  - two major findings with the same key -> one record with both examples; an existing record for this lesson + key (e.g. from the written block) -> example appended, no new record, `errorsAdded` counts only created records.
  - "unknown ids": a finding with a partner turn id or an unknown id is dropped; an unknown `grammarTopicId` is nulled (category falls back to the finding's category, `general` if empty).
  - analyse throws -> `AnalysisUnavailableError`, nothing written, status unchanged (ACTIVE).
  - already ANALYZED -> returns the stored review, analyse not called.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** Analyse call outside the transaction (`completeJson("conversation_analysis", conversationAnalysisPrompt(...), conversationAnalysisSchema)` by default; grammar topics = the lesson's focus topic only, `[{ id, title ?? name }]` or `[]`); then one `$transaction` (sequential calls inside): update each learner turn's `corrections`, upsert errors with the same find-then-update/create logic and example format as `recordAnswer.ts` (reuse `appendExample` - export it from `recordAnswer.ts` if it is not exported; clip examples with the same 200-char rule via `EXAMPLE_MAX`), update the session (ANALYZED, review, endedAt).
- [ ] **Step 4: Green; commit** `feat(m5a): conversation analysis into review and errors`.

---

### Task 5: Routes

**Files:** Create `src/app/api/conversation/route.ts` (GET), `src/app/api/conversation/start/route.ts`, `turn/route.ts`, `finish/route.ts` + one `route.test.ts` per folder (mock the service module).

- [ ] **Step 1: Failing tests.** GET `?lessonId=` missing -> 400; ok -> 200 JSON of `getWarmup`. start: bad body -> 400; `LessonNotFoundError` -> 404; ok -> 200. turn: bad body -> 400; `TurnRejectedError` invalid -> 400, closed/limit/busy -> 409 `{ error: reason }`; `PartnerUnavailableError` -> 503 `{ error: "partner_unavailable" }`; ok -> 200 with `Content-Type: text/plain; charset=utf-8`, `Cache-Control: no-store`, body = the streamed text. finish: body `{ lessonId, action }` with action not in review|skip -> 400; `AnalysisUnavailableError` -> 502; ok -> 200 JSON.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** in the style of `src/app/api/exercise/check/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, zod body, error mapping, 500 fallback; `console.warn` on 502/503 without secrets).
- [ ] **Step 4: Green; build; commit** `feat(m5a): conversation API routes`.

---

### Task 6: Conversation panel and review components

**Files:** Create `src/components/lesson/conversation/ConversationPanel.tsx`, `ConversationReview.tsx`, `useConversation.ts` (client hook), tests for each component.

**Interfaces:** `type WarmupState = Awaited<ReturnType<typeof getWarmup>>` (import the type only). `ConversationPanel({ lessonId, initial: WarmupState, onDone: () => void })` - owns the flow: start (if status null) -> chat -> finish -> review -> `onDone`. `ConversationReview({ state: WarmupState, onContinue: () => void })`.

- [ ] **Step 1: Failing tests** (mock `fetch`; a streaming body via `new Response(new ReadableStream(...))`):
  - mount with status null -> POSTs `/api/conversation/start`, renders the partner opening.
  - label "Warm-up conversation", counter "0 of 8"; typing a message and Enter -> POST `/api/conversation/turn`; the learner bubble appears immediately; partner text renders progressively (after the stream ends the full text is shown); counter "1 of 8"; textarea disabled while streaming; Shift+Enter inserts a newline (no send).
  - "Finish & review" disabled with 0-1 learner turns, enabled from 2, gets the primary style from 8; at 12 the textarea is replaced by "You've reached the turn limit".
  - "offline keeps the text": turn returns 503 -> "Conversation partner is offline" with "Try again" (resends the same text) and "Skip conversation"; the typed text is still in the textarea.
  - Finish -> "Analysing your conversation..." -> review renders: "Top issues" list, each learner turn with findings shows the original fragment marked with a text label ("major"/"moderate"/"minor") plus the corrected text and explanation, "2 mistakes added to your review list", "Continue to exercises" calls `onDone`. 502 -> "Couldn't analyse - Try again" and "Continue without review" (calls finish with `skip`, then `onDone`).
  - Skip -> POST finish `skip` -> `onDone`.
  - initial status ANALYZED -> renders the review directly; SKIPPED/UNAVAILABLE -> calls `onDone` immediately (player should not show it, but be safe).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** Stream reading: `res.body!.getReader()` + `TextDecoder`, append to the pending partner text in state; partner bubble region `aria-live="polite"` (only the final text announced: set `aria-busy` while streaming). Severity styles from tokens (`text-danger` major, `text-warning` moderate, `text-muted-foreground` minor) always with the text label; highlighting = the learner turn text with each finding's `original` wrapped in `<mark>` (first occurrence; if not found, show the finding below without highlighting). Bubbles: partner left (`bg-surface-2`), learner right (`bg-primary text-on-primary`). Buttons `min-h-11`.
- [ ] **Step 4: Green; build; commit** `feat(m5a): conversation panel and review UI`.

---

### Task 7: Player integration, intro and results lines

**Files:** Modify `src/lib/lesson/loadLesson.ts` (+ test), `src/components/lesson/LessonPlayer.tsx` (+ test), `LessonIntro.tsx` (+ test), `LessonResults.tsx` (+ test).

**Interfaces:** `PlayerLesson.warmup: { available: boolean; theme: string | null; state: WarmupState } ` - `available` = the plan has `sections.warmup.intro`; `state` from `getWarmup` (loadLesson's db Pick gains `conversationSession`, `conversationTurn`).

- [ ] **Step 1: Failing tests.**
  - loadLesson: returns `warmup.available` false for a plan without warmup; true with state from the session.
  - player order: with review items + warmup + written: after Start -> review items; after the last review item's Next -> the conversation panel; `onDone` -> the first written item. No review items -> conversation right after Start. `warmup.available` false -> straight to written.
  - "resume": state ACTIVE and no written answered -> after Start the player opens the conversation (review items already answered); state ANALYZED/SKIPPED/UNAVAILABLE or any written item answered -> the conversation is not shown; state null and a written item already answered -> not shown (old lessons).
  - intro shows "Conversation: 8 turns on <theme>" when available (theme falls back to "Conversation: 8 turns" without a theme); results show "Conversation: N turns, M corrections" (ANALYZED; M = total findings), "Conversation: skipped" (SKIPPED/UNAVAILABLE), nothing when not available.
  - the progress bar keeps counting exercises only.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.** In `LessonPlayer`, a `stage` derived state: `"exercises-review" | "warmup" | "exercises-written"`; the warm-up is entered when the next open item is a written one (or there are no review items) and `showWarmup` is true (`available && state.status in [null, ACTIVE] && no written item answered`); keep the existing exercise flow untouched otherwise. Track conversation results for the results screen in player state (update from `onDone` with a fresh `GET /api/conversation`).
- [ ] **Step 4: Green; build; commit** `feat(m5a): warm-up conversation in the lesson player`.

---

### Task 8: Live script, docs

**Files:** Create `scripts/conversation-try.ts`; Modify `package.json` (script `conversation:try`), `SPEC.md`, `CLAUDE.md`, `docs/LOCAL_SETUP.md` (pointer to the script in smoke tests).

- [ ] **Step 1: Script.** Loads `.env.local` (dotenv) before any `src/lib/db` import (it never imports the DB). Synthetic input (B1, interests "IT, QA, gaming", theme "work", a short intro, grammar "Past Perfect (had done)"). Reads learner lines from stdin (readline) up to 3 turns or "/end", streams each partner reply to stdout via `stream("conversation", conversationPartnerPrompt(...))`, then runs one `completeJson("conversation_analysis", ...)` over the transcript (fake ids `t1..`) and prints findings and top issues. A clear message and exit code 1 when LM Studio is unreachable (`LOCAL_LLM_URL`). No DB writes. Add `"conversation:try": "tsx scripts/conversation-try.ts"`.
- [ ] **Step 2: Docs.** SPEC.md: lesson flow order (review -> warm-up -> written -> results; scenario M6); warm-up never blocks the lesson (replace "local services gate lesson start" with the M5a rule: unavailable partner -> section marked unavailable, lesson continues; health indicators come in M5b); turn limits; data model (`ConversationSession`, enums, `ConversationTurn.sessionId/turnIndex`); routes as built (`GET /api/conversation`, `start`, `turn`, `finish` - replacing `/api/conversation/analyze`). CLAUDE.md: M5 split line, M5a ✅ with spec pointer, `npm run conversation:try` in Commands, branch `feature/m5a-conversation`.
- [ ] **Step 3: Verify** `npx tsc --noEmit`, `npm test`, `npm run build`; `npm run conversation:try` without LM Studio prints the unreachable message and exits 1 (record the output). Commit `feat(m5a): conversation try script; docs`.
