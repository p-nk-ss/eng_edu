# SPEC: English Trainer — Adaptive Daily Lessons

## Overview

A personal single-user web app for improving spoken and written English (target: conversational fluency). The app runs a **daily lesson loop**: each lesson combines a speaking session and written exercises, tracks every mistake, schedules reinforcement exercises via spaced repetition, and at the end of each session saves state and generates a plan for the next lesson.

Lessons are **curriculum-grounded**: the grammar syllabus and vocabulary pool are seeded from real open CEFR datasets (CEFR-J Grammar Profile, Oxford 3000/5000, OPAL spoken phrases). Claude generates only the *content* of exercises and conversations; *what* to teach next is selected deterministically from the seeded syllabus based on progress. This prevents the LLM from inventing an ad-hoc curriculum.

Single user (owner), no public registration. Runs **locally on the owner's Windows desktop** (see [Deployment](#deployment)) in a **hybrid setup**: a local LLM handles real-time voice conversation, while Claude (Agent SDK, Max subscription) handles all teaching-quality tasks.

## Tech Stack

- **Next.js 15 (App Router)**, TypeScript
- **Postgres (local)** + **Prisma 7** (`@prisma/adapter-pg`, `prisma.config.ts` for CLI, `DATABASE_URL` at runtime) — a PostgreSQL server on the owner's desktop; no cloud DB
- **LLM access** via a provider abstraction in `lib/llm.ts` with **per-role routing** (see [LLM Access Layer](#llm-access-layer)). **Claude** (Agent SDK, model `sonnet`, subscription auth) handles teaching-quality roles: lesson generation, conversation analysis, writing feedback, translation checking, session summaries. A **local LLM** (LM Studio, Qwen3-14B) handles the real-time conversation partner role. Direct-API Claude fallback remains. All calls server-side only (API routes / server actions)
- **Voice stack** (see [Voice Stack](#voice-stack)): local **Kokoro-82M** TTS (streaming) with browser `speechSynthesis` fallback; **Web Speech API** STT (Chrome) behind a swappable `lib/stt.ts` interface. Runs on the desktop GPU (RX 9070 XT 16GB)
- **No auth** — single local user on `localhost` (optional home-LAN). If the app is ever exposed beyond the LAN, add a single access-password middleware then; not in MVP.
- **Tailwind CSS** + a gamified design system (see [Design System & Visual Approach](#design-system--visual-approach); full tokens in [`docs/DESIGN.md`](docs/DESIGN.md))

## LLM Access Layer

All LLM calls go through a single provider abstraction in `lib/llm.ts`. Every provider exposes:

```ts
complete({ system, messages, maxTokens }): Promise<string>
stream({ system, messages, maxTokens }): AsyncIterable<string>   // token deltas
```

`stream()` is **required only for `LocalProvider`** (the streaming `conversation` role). The Claude providers serve only buffered roles — their `stream()` may be left unimplemented (throw).

Prompt code never picks a provider directly — it names a **role**, and `lib/llm.ts` resolves the role to a provider via the routing config. No provider-specific code lives in routes.

### Providers

- **`AgentSDKProvider` (default for teaching roles)** — calls Claude via the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, `query()`), authenticated with the owner's Claude subscription through `CLAUDE_CODE_OAUTH_TOKEN` (generated once with `claude setup-token`). Single-turn text completion: `model: "sonnet"`, no tools (`allowedTools: []`), no file access, no project settings (`settingSources: []`), permission mode fully restricted (a `canUseTool` callback denies every tool), `maxTurns: 1`. Consumes the Agent SDK credit, not pay-per-token. The `messages[]` array is flattened into the SDK's single `prompt` (role-prefixed for multi-turn; the app is stateless and sends full history each call) and `system` is passed as `systemPrompt`.
- **`DirectAPIProvider` (fallback)** — direct `api.anthropic.com` via `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`, model `claude-sonnet-4-6`. `messages[]` maps 1:1 to the Messages API.
- **`LocalProvider` (conversation)** — **NEW.** OpenAI-compatible chat-completions against a **local LM Studio** server: `LOCAL_LLM_URL` (default `http://localhost:1234/v1`), model from `LOCAL_LLM_MODEL` (target: **Qwen3-14B**). Must support **streaming** (`stream()` yields token deltas for the real-time voice loop). `{system, messages}` map to the OpenAI `messages` array. **Qwen3 thinking must be disabled** for the conversation role (`enable_thinking: false` / `/no_think`) — `<think>` blocks blow the latency budget and pollute the spoken reply.

### Role routing

Roles map to providers in `config/llm-roles.ts`, each **individually overridable** via env (`LLM_ROLE_<ROLE>=local|agent|api`) — **except `conversation`**, which is streaming-only and therefore served **only by `LocalProvider`**. The Claude providers do not implement `stream()`, so overriding `LLM_ROLE_CONVERSATION` to `agent`/`api` is unsupported (it would throw at runtime); there is **no cloud fallback for the real-time partner**.

| Role | Default provider | Mode |
|---|---|---|
| `conversation` | `LocalProvider` | streaming |
| `lesson_generation` | `AgentSDKProvider` | buffered |
| `conversation_analysis` | `AgentSDKProvider` | buffered |
| `writing_feedback` | `AgentSDKProvider` | buffered |
| `translation_check` | `AgentSDKProvider` | buffered |

All providers return plain text, so JSON-structured completions are handled identically: parse with fence-stripping fallback, validate with zod, retry once on failure with a "return ONLY valid JSON" reminder appended.

## Deployment

**Local-first.** The app runs on the owner's **Windows desktop** (Ryzen 5700X3D, RX 9070 XT 16GB) — Next.js via `npm run dev` or `next start` — accessed at `http://localhost:3000`. Optionally bind to the LAN (`next start -H 0.0.0.0`) to use it from a phone on the same home Wi-Fi. The desktop hosts **everything locally**: a **PostgreSQL** server, the local LLM (LM Studio), and the Kokoro TTS service. Nothing runs in the cloud except the Claude Agent SDK, which runs in-process against the Claude subscription. No Docker/VPS/serverless.

Environment requirements:
- `CLAUDE_CODE_OAUTH_TOKEN` — **set** (subscription auth for the Agent SDK; generated with `claude setup-token`).
- `ANTHROPIC_API_KEY` — **must NOT be set.** If present it overrides subscription auth and bills pay-per-token. Only set it (with `LLM_ROLE_*=api`) when deliberately using the direct-API fallback.
- `DATABASE_URL` — local PostgreSQL connection string (e.g. `postgresql://postgres:postgres@localhost:5432/english_trainer`); used both at runtime (pg adapter) and by `prisma migrate`.
- `LOCAL_LLM_URL` (default `http://localhost:1234/v1`), `LOCAL_LLM_MODEL` — LM Studio server + model id.
- `KOKORO_URL` (default `http://localhost:8880`) — local Kokoro TTS service.
- `LLM_ROLE_<ROLE>` — optional per-role provider override (`local|agent|api`).
- `TYPESAFE_API_KEY` — TypeSafe (Jev) key; used by `npm run vocab:classify` (and the `judge` role from M3c).

Step-by-step local setup is in [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md).

### Billing & auth notes
- The Agent SDK credit (Max 5x: $100/month, included since 2026-06-15 — see https://support.claude.com/en/articles/15036540) covers Claude Agent SDK and `claude -p` usage. It is **separate** from interactive subscription limits.
- The credit **resets monthly** and **does not roll over**.
- If the OAuth token is revoked, regenerate it with `claude setup-token` and update the env var.
- Keep `ANTHROPIC_API_KEY` unset so usage draws on the credit, not pay-per-token.

## Core Concept: The Lesson Loop

```
[Generate Lesson] → [Warm-up Conversation] → [Written Exercises] → [Speaking Scenario] → [Complete & Summarize] → [Plan Next Lesson]
```

1. **Generate**: On "Start today's lesson", the server builds a lesson plan by calling Claude with: user profile, active errors (due for review), summary of the last 3 sessions, and the previously saved "next lesson plan" draft.
2. **Run**: User goes through lesson sections in order. Objective exercises are checked locally (answers pre-generated) and translation/open-writing by Claude. Conversation turns are generated in real time by the **local LLM** (partner only, no corrections); after each conversation section, Claude analyses the full transcript and produces the corrections/findings. Mistakes are logged with a category.
3. **Complete**: Claude generates a session summary (what went well, recurring mistakes, new vocabulary) and a draft plan for the next lesson. Both saved to DB.

## Data Model (Prisma)

```prisma
model Profile {
  id            String   @id @default(cuid())
  level         String   // e.g. "B1+", updated over time
  goals         String   // free text: "conversational fluency, work meetings"
  interests     String   // topics for conversations: "IT, QA, gaming, medicine"
  nativeLang    String   @default("ru")
  preferredThemes String[] @default([])
  updatedAt     DateTime @updatedAt
}

model Lesson {
  id          String    @id @default(cuid())
  date        DateTime  @default(now())
  theme       String?   // curated theme key (src/lib/curriculum/themes.ts), for LRU rotation
  status      LessonStatus @default(PLANNED) // PLANNED | IN_PROGRESS | COMPLETED
  currentSection Int    @default(0) // section pointer for resume (0=Review … 4=Wrap-up). Always starts at 0; an empty section (e.g. day-1 Review with no due errors) is auto-skipped by the player, so the pointer semantics stay uniform.
  writtenScore       Float?    // share of correct written answers, 0..1 (M4a); null until the written block is complete
  writtenCompletedAt DateTime? // set once, when the last written exercise is answered (M4a)
  plan        Json      // structured lesson plan (sections, topics, exercise specs)
  summary     String?   // Claude-generated post-session summary
  nextPlan    String?   // Claude-generated draft plan for the NEXT lesson
  exercises   Exercise[]
  turns       ConversationTurn[]
  errors      ErrorRecord[]
}

model Exercise {
  id          String   @id @default(cuid())
  lessonId    String
  lesson      Lesson   @relation(fields: [lessonId], references: [id])
  type        ExerciseType // see "Exercise Types" section for the full enum + content shapes
  content     Json     // generated exercise: type-specific shape incl. correct answer(s) + explanations (pre-generated at lesson creation so objective types check locally)
  userAnswer  String?
  isCorrect   Boolean?
  feedback    String?  // Claude's explanation
  errorRecordId String? // if this exercise was generated to reinforce a specific error
  result      Json?    // GradeResult (M3c): verdict, correct answer, feedback, vocab credit, jevScores; null until answered
  answeredAt  DateTime? // set once by POST /api/exercise/check; a second submit returns the stored result instead of re-grading
  createdAt   DateTime @default(now())
}

model ErrorRecord {
  id           String   @id @default(cuid())
  lessonId     String
  lesson       Lesson   @relation(fields: [lessonId], references: [id])
  grammarTopicId String? // FK to GrammarTopic for exact mastery matching; NULL for vocab / non-grammar errors
  grammarTopic GrammarTopic? @relation(fields: [grammarTopicId], references: [id])
  category     String   // human-readable label, e.g. "Present Perfect vs Past Simple", "vocab: phrasal verbs"
  description  String   // what exactly went wrong; one `- example` line per mistake (M3c: one ErrorRecord per (lessonId, grammarTopicId, category) - a repeat cause appends a new example line instead of a new row - keeping only the last 5)
  source       ErrorSource // CONVERSATION | EXERCISE | WRITING
  status       ErrorStatus @default(NEW) // NEW | REVIEWING | MASTERED
  correctStreak Int     @default(0)  // consecutive correct reinforcement answers
  nextReviewAt DateTime // spaced repetition scheduling
  createdAt    DateTime @default(now())
}

model ConversationTurn {
  id          String   @id @default(cuid())
  lessonId    String
  lesson      Lesson   @relation(fields: [lessonId], references: [id])
  role        String   // "user" | "tutor"
  text        String
  corrections Json?    // NULL during the live conversation; filled POST-HOC by /api/conversation/analyze
                       // for user turns: [{original, corrected, explanation, category, severity}]
  createdAt   DateTime @default(now())
}

// ---- Curriculum (seeded from open datasets, see "Curriculum & Seed Data") ----

model GrammarTopic {
  id          String   @id @default(cuid())
  name        String   // e.g. "Present Perfect Continuous", "used to / would for past habits"
  cefrLevel   String   // A1..C2, from CEFR-J Grammar Profile
  category    String?  // e.g. "tenses", "modals", "conditionals"
  status      TopicStatus @default(NOT_STARTED) // NOT_STARTED | INTRODUCED | PRACTICING | MASTERED
  timesUsed   Int      @default(0)
  lastUsedAt  DateTime?
  sortOrder   Int      // syllabus ordering within a level
  title       String?  // learner-facing title from data/grammar-topics.json (M3b-1); NULL until enriched
  description String?  // one-paragraph explanation, from data/grammar-topics.json
  example     String?  // one example sentence, from data/grammar-topics.json
  teachable   Boolean  @default(true) // false = never selected as a lesson focus, not counted in progress
  importance  Int      @default(2) // 1 core .. 3 peripheral; orders topics inside a level
  lessonsCompleted Int @default(0) // cache (M4a): completed lessons with this focus, derived from Lesson history
  goodLessons      Int @default(0) // cache (M4a): of those, writtenScore >= 0.8
  errors      ErrorRecord[] // back-relation for mastery matching
}

model VocabItem {
  id          String   @id @default(cuid())
  headword    String
  pos         String?  // part of speech
  cefrLevel   String   // from Oxford 3000/5000 or CEFR-J Vocabulary Profile
  topic       String?  // theme key from src/lib/curriculum/themes.ts, or "general"; assigned offline by TypeSafe Jev (M3a)
  isPhrase    Boolean  @default(false) // true for OPAL spoken phrases / Oxford Phrase List
  status      VocabStatus @default(NEW) // NEW | SEEN | LEARNING | KNOWN
  correctStreak Int    @default(0)
  lastSeenAt  DateTime?

  @@unique([headword, pos])
}
```

### Spaced repetition rules

- New error → `status: NEW`, `nextReviewAt = now + 1 day`
- Correct reinforcement answer → `correctStreak++`, schedule next review at intervals: 1d → 3d → 7d → 14d
- `correctStreak >= 3` → `status: MASTERED` (still eligible for occasional review)
- Wrong answer on reinforcement → `correctStreak = 0`, `nextReviewAt = now + 1 day`, `status: REVIEWING`

## Curriculum & Seed Data

The syllabus is seeded once via `prisma db seed` from open datasets committed to `/data/` in the repo:

1. **Grammar syllabus** — CEFR-J Grammar Profile (grammatical items annotated with CEFR levels; free for use with attribution): https://github.com/openlanguageprofiles/olp-en-cefrj → `GrammarTopic` table. Assign `sortOrder` within each level following the dataset's ordering.
2. **Vocabulary** — pick one primary source:
   - Oxford 3000 grouped by CEFR level as ready JSON: https://github.com/Kolia951/The_Oxford_3000_CEFR (A1–B2)
   - CEFR-J Vocabulary Profile CSV (headword, pos, CEFR level): https://github.com/openlanguageprofiles/olp-en-cefrj/blob/master/cefrj-vocabulary-profile-1.5.csv — preferred, as the primary headword/pos/CEFR source; v1.5 has **no** thematic categories, so themes are assigned separately (see "How the curriculum drives lesson generation" below)
3. **Spoken phrases** — OPAL spoken phrases / Oxford Phrase List (see https://github.com/jnoodle/English-Vocabulary-Word-List) → `VocabItem` rows with `isPhrase: true`. High value for the conversational goal.

Seed script requirements: idempotent (upsert by `headword+pos` / topic name), filter vocabulary to levels at or one level above the user's current level, attribute datasets in README (CEFR-J requires citation).

### How the curriculum drives lesson generation

Lesson generation is a **two-step process**:

1. **Deterministic selection (code, not LLM)**: `lib/curriculum.ts` picks for today's lesson, **in this order**:
   - **Conversation theme** — chosen first, deterministically, from the **curated theme list** in `src/lib/curriculum/themes.ts` by weighted least-recently-used rotation (`Lesson.theme` history — only `IN_PROGRESS`/`COMPLETED` lessons count, so an abandoned `PLANNED` lesson does not burn a theme; themes listed in `Profile.preferredThemes` return about twice as often). CEFR-J v1.5 has no thematic categories, so every `VocabItem.topic` is assigned once, offline, by TypeSafe Jev (`npm run vocab:classify` → `data/vocab-topics.csv` → seed). This theme is an *input* to the next two steps and to Claude — it is **not** chosen by the LLM. Design: `docs/superpowers/specs/2026-09-18-m3a-curriculum-selection-design.md`.
   - 1 grammar focus: unfinished **core** (`importance = 1`) teachable topics of the band directly below the user's level (parked topics excluded from this shortcut), then the next **teachable** `GrammarTopic` with `status != MASTERED` at the user's level — `PRACTICING` with open errors → `PRACTICING` → `INTRODUCED` → `NOT_STARTED` → parked (see topic advancement below), then by `importance` (1 core … 3 peripheral), then `sortOrder`; titles, descriptions, examples, `teachable` and `importance` come from `data/grammar-topics.json`, generated once offline by Claude (`npm run grammar:enrich`), because CEFR-J items are corpus pattern labels, not teaching topics.
   - 6–10 `VocabItem`s: mix of `LEARNING` items due for reinforcement + `NEW` items whose `topic` equals the selected theme's key, with fallbacks (next band in theme → `general` at level → any `NEW` item at level).
   - Due `ErrorRecord`s for the review block.
2. **Content generation (Claude)**: the selected **theme + grammar topic + vocab list + errors** are passed into the lesson-generation prompt. Claude writes the exercises, conversation framing, and scenario *around* these inputs — it does **not** choose the theme or the grammar focus; the exercise **mix is decided by code** (`planExerciseMix`), not by Claude.

Topic/vocab statuses advance based on performance. **Attribution is lesson-grained** — there is no `Exercise → GrammarTopic` FK; instead, because each lesson has exactly **one** deterministically-selected grammar focus, "accuracy on the topic" is the accuracy of that lesson's **written block**:
- A grammar topic moves `NOT_STARTED → INTRODUCED` the first time it is selected into a lesson, `INTRODUCED → PRACTICING` after the first **completed** lesson (every written exercise in the block answered), then to `MASTERED` once it has accumulated (not necessarily consecutively) **3** lessons with a written-block score **>= 80%** - a **core topic below the learner's level** (`importance = 1`, CEFR band strictly below the learner's) needs only **1** such lesson (review-as-diagnosis). New `ErrorRecord`s on the topic do **not** block mastery (they go to review in M4b). A topic with **>= 5** completed lessons that is still not mastered is **parked**: it stays `PRACTICING`. A parked topic of the learner's **own band** is chosen only after every not-yet-started topic of that band (then round-robins with any other parked topic of the band, least-practised first), and can still come up again later. A parked **below-level core** topic (reachable only through the fast-track above, which skips parked topics) is **not** selected again as a focus at all once parked - the main selection never looks at a band below the learner's own; its `ErrorRecord`s are still revisited by review (M4b). `MASTERED` is never reverted. Per-lesson history is the source of truth (`Lesson.writtenScore`, `Lesson.writtenCompletedAt`); the cached counters `GrammarTopic.lessonsCompleted`/`goodLessons` are derived from that history and always recomputable - `npm run lessons:backfill` is the one-off that scores lessons completed before this rule existed. Design: `docs/superpowers/specs/2026-09-26-m4a-topic-advancement-design.md`.
- VocabItem (M3c): `status: NEW | SEEN | LEARNING | KNOWN`, updated **from exercise answers only** — conversation usage does not affect vocab status in MVP. `POST /api/exercise/check` reads the **target vocab id(s) recorded in `Exercise.content.vocab`** (see [Exercise Types](#exercise-types)) but credits a word only if it is actually **in the answer zone** — the part(s) of the exercise the learner had to get right for that word (e.g. the selected MCQ option, a specific cloze gap), not merely present elsewhere in the prompt. Credit is **once per word per lesson**: if the same word is targeted by a later exercise in the same lesson, that later credit is dropped (the first graded exercise decides). On a correct credit, `correctStreak++` and `status: LEARNING`, or `KNOWN` once `correctStreak >= 3`; on a wrong credit, `correctStreak = 0` and `status: LEARNING` (also demoting a `KNOWN` word back to `LEARNING`). `lastSeenAt` is set on every credited word. For typed/free-text zones (open-cloze gaps, error-correction fixes, translations), a word counts only if the learner's own answer contains it - an accepted synonym or paraphrase gives no credit either way; translation answers are limited to 500 characters.

## Lesson Structure

A generated lesson plan contains these sections (order fixed):

1. **Review block** (5 min): 3–5 reinforcement exercises targeting `ErrorRecord`s where `nextReviewAt <= today`. Exercise type chosen to match the error (grammar error → fill-blank or error-correction; vocab → translation or multiple choice).
2. **Warm-up conversation** (5–10 min): free chat on the lesson's selected theme (see Curriculum). Tutor speaks (streaming TTS), user answers by voice (STT). Tutor turns come from the **local LLM** (`conversation` role) — natural partner replies only, **no corrections mid-flow**. When the section ends, the transcript is analysed by Claude and a **Conversation Review** is shown (see below).
3. **Written exercises** (10 min): 5–8 new exercises, a **mix of types** (see [Exercise Types](#exercise-types)). They practice the lesson's **deterministically selected** grammar focus + target vocab (Curriculum step 1) — Claude writes only the exercise *content*, not the focus. Objective types are checked locally; only translation/open-writing hit the LLM.
4. **Speaking scenario** (5–10 min): role-play with a goal ("You're in a job interview for a QA position — convince the interviewer", "Call a hotel and change your booking"). Tutor (local LLM) stays in character, **no corrections mid-scenario**. On section end, the same Claude transcript analysis + Conversation Review runs.
5. **Wrap-up**: user clicks "Finish lesson" → summary + next lesson plan generated and saved.

**Conversation Review (both warm-up and scenario).** The real-time loop and the teaching feedback are split:
- **Real-time loop (local LLM, `conversation` role):** each user turn → one streaming tutor reply (2–4 sentences, spoken register). The local LLM is a conversation partner **only**: it asks follow-up questions and steers toward the lesson's grammar topic + target vocab (injected into its system prompt), but performs **no corrections, grammar explanations, or teaching** — even if the user asks (it says the review comes at the end and keeps the conversation going). Turns persist as `ConversationTurn` rows with `corrections` left NULL.
- **Post-conversation analysis (Claude, `conversation_analysis` role):** on section end the full transcript (turns with ids) **plus the lesson's grammar-topic list (with ids)** is sent in **one** call → strict-JSON findings array `{turnId, grammarTopicId?, original, corrected, explanation, category, severity}`, where `severity ∈ minor | moderate | major`. Findings are written back to `ConversationTurn.corrections` (all severities, for the review UI). **Only `major` findings** are converted to `ErrorRecord`s, deduplicated by `(grammarTopicId ?? category)` within the session, so spaced-repetition isn't flooded by minor slips. The UI shows a **Conversation Review** screen: transcript with inline highlights (colour-coded by severity) + a summary of the top issues.

## Exercise Types

The written part of a lesson mixes several exercise types so practice is varied. **All objective types are graded by local code** against answers pre-generated into `Exercise.content` (no LLM at answer time); only `TRANSLATION` and `OPEN_WRITING` are LLM-graded. Each exercise's `content` carries a type-specific shape plus an `explain` string shown after grading.

**Vocab attribution.** Since there is no `Exercise → VocabItem` FK, each objective exercise's `content` also carries a **`vocab`** field — the id(s) of the target `VocabItem`s it practices (e.g. `"vocab": ["clx…", "cly…"]`, omitted/empty for pure-grammar exercises). `POST /api/exercise/check` reads this to advance `VocabItem.correctStreak` (see [Spaced repetition](#spaced-repetition-rules)). The grammar focus is not stored per-exercise — it is the lesson's single selected focus. Vocab attribution is a **heuristic, not a gate**: at generation time `checkExercise` checks structure only (answer ranges, gap counts, permutations, non-empty accept sets); `pruneVocab` removes `vocab` ids that are unknown or whose headword does not occur in the exercise's text (irregular forms such as `go`/`went` are not recognised) — the exercise itself is never dropped for this.

`ExerciseType` enum:

```prisma
enum ExerciseType {
  MULTIPLE_CHOICE   // MCQ (grammar/vocab, reading/listening MCQ)
  CLOZE_DROPDOWN    // multi-gap cloze with per-gap dropdowns
  FILL_BLANK        // open cloze / word-formation — typed, accept-set
  WORD_BANK         // build a sentence from word tiles (+ distractors)
  MATCH             // match pairs (vocab / collocation / EN↔L1)
  DIALOGUE_GAP      // fill the missing turn in a chat (OPAL phrases)
  DICTATION         // "type what you hear" (TTS plays, accept-set)
  ERROR_CORRECTION  // spot the wrong token and type the fix
  TRANSLATION       // L1↔L2 free text — LLM-graded
  OPEN_WRITING      // extended paragraph — LLM-graded
  // post-MVP: REORDER, CATEGORIZE, KEY_WORD_TRANSFORM, READ_ALOUD, LISTENING_MCQ
}
```

**MVP set (10 above; 8 fully local + `TRANSLATION`/`OPEN_WRITING` LLM-graded)** spans grammar, vocab, reading, listening, and production, escalating recognition → scaffolded production → free production.

### Local grader — normalization contract
Every typed / accept-set field is compared after: trim → collapse internal whitespace → lowercase → strip leading/trailing punctuation → normalize curly quotes/apostrophes to straight. **Contraction and spelling variants are handled by listing them in the `accept` array, not by fuzzy matching.**

### `content` shapes (objective types)

```jsonc
// MULTIPLE_CHOICE — grade: selectedIndex === answer (use answer:[..] + set-equality for multi)
{"type":"mcq","prompt":"She ___ to work every day.","options":["go","goes","going","gone"],"answer":1,
 "rationales":["base form","✓ 3rd-person -s","after 'is' only","past participle"],"explain":"..."}

// CLOZE_DROPDOWN — grade: each gap pickedIndex === gap.answer
{"type":"cloze_mc","text":"I've lived here ___ 2019, ___ five years.",
 "gaps":[{"options":["since","for"],"answer":0},{"options":["since","for"],"answer":1}],"explain":"..."}

// FILL_BLANK (open cloze / word-formation) — grade: normalized input ∈ gap.accept
{"type":"open_cloze","text":"It was a ___ (BEAUTY) day.","gaps":[{"root":"BEAUTY","accept":["beautiful"]}],"explain":"..."}

// WORD_BANK — grade: assembled tokens (normalized) === answer (or any accept_alt); distractors ignored
{"type":"word_bank","tokens":["work","I","to","go","goes"],"answer":["I","go","to","work"],"accept_alt":[],"explain":"..."}

// MATCH — grade: for each i, learner pairs left[i] with right[answer[i]]
{"type":"match","left":["frankly","broke"],"right":["with no money","to be honest"],"answer":[1,0],"explain":"..."}

// DIALOGUE_GAP — MC or typed missing turn; grade like mcq (index) or accept-set
{"type":"dialogue_gap","turns":["A: Sorry I'm late.","B: ___"],"options":["No worries.","You are welcome."],"answer":0,"explain":"..."}

// DICTATION — TTS plays `tts`; grade: normalized transcript ∈ accept
{"type":"dictation","tts":"I'd like a coffee, please.","accept":["i'd like a coffee please","i would like a coffee please"],"explain":"..."}

// ERROR_CORRECTION — grade: tapped index === answer AND typed fix ∈ accept
{"type":"error_correct","tokens":["She","don't","like","tea"],"answer":1,"accept":["doesn't"],"explain":"..."}
```

`TRANSLATION` and `OPEN_WRITING` carry the source/prompt (+ optional target-grammar hint) and are graded by the `translation_check` / `writing_feedback` roles.

### Post-MVP types
`REORDER` (drag to reorder — needs DnD + keyboard a11y), `CATEGORIZE` (drag chips into buckets), `KEY_WORD_TRANSFORM` (free-text paraphrase — LLM-graded), `READ_ALOUD` (STT + fuzzy match, partial grading), `LISTENING_MCQ` / minimal pairs (TTS), and a spaced-repetition flashcard layer over the vocab pool.

## API Routes

- `POST /api/lesson/start` — resumes a lesson instead of generating one while a `PLANNED`/`IN_PROGRESS` lesson is **dated today, or its written block is not complete and it has an unanswered written exercise** (M4a; review exercises from M4b do not keep an old lesson open) — the newest such lesson (`{lessonId, reused: true}`). Otherwise runs the deterministic selection (see [How the curriculum drives lesson generation](#how-the-curriculum-drives-lesson-generation)) and makes **one Claude call** returning 5–8 written exercises plus warm-up and scenario framing. Each exercise is validated individually: per-type zod schema → deterministic checks (`checkExercise`) → TypeSafe Jev answer-key gate (best effort — `skipped` if Jev is unavailable, nothing dropped for that reason). Fewer than 5 exercises survive → one regeneration (fresh Claude call); still fewer than 5 → `502` with every drop reason and nothing written. On success, persists the `Lesson` (`PLANNED`) and its `Exercise` rows and advances the grammar topic + vocab statuses, all in one transaction; returns `{lessonId, reused: false}`. **Concurrent calls are single-flighted**: while a generation is in flight, further calls join the same in-progress promise instead of starting a second (paid) generation, so a double click or a page reload never creates two lessons. `Lesson.plan` shape:
  ```jsonc
  { "version": 1,
    "sections": {
      "review":   { "exerciseIds": [] },
      "warmup":   { "intro": "…", "questions": ["…"] },
      "written":  { "exerciseIds": ["…"] },
      "scenario": { "title": "…", "role": "…", "goal": "…", "opening": "…" } },
    "meta": { "grammarTopicId": "…" | null, "vocabIds": ["…"], "exerciseMix": ["MULTIPLE_CHOICE", …],
              "qualityGate": "passed" | "partial" | "skipped", "drops": 0,
              "dropReasons": ["attempt 1 #2 MULTIPLE_CHOICE: …", …],
              "gateScores": [{ "exerciseIndex": 0, "scores": { "key_correct": 0.95 } }, …],
              "attempts": 1 } }
  ```
  `dropReasons` and `gateScores` are diagnostics only (never surfaced to the learner). Voice-service health checks (LM Studio, Kokoro) are **deferred to M5** — not part of this route yet.
- `POST /api/exercise/check` (M3c) — `{exerciseId, answer}`; the answer shape depends on the exercise's type (`SHAPES` in `src/lib/grading/answerSchemas.ts` — e.g. `{selected: number}` for `mcq`/`dialogue_gap`, `{text: string[]}` for `open_cloze`, `{index, fix}` for `error_correct`, `{text: string}` for `dictation`/`translation`/`open_writing`); a shape mismatch or an answer that does not fit the exercise (out-of-range index, wrong gap count) is a **400**, never a learner mistake. All **objective** types are graded first by **local code** (`gradeLocally`) against the data pre-generated into `Exercise.content`, using the [normalization contract](#local-grader--normalization-contract). Typed gaps (`FILL_BLANK`), the typed fix in `ERROR_CORRECTION`, and `DICTATION` then get one more chance if the normalized input is not in the pre-generated `accept` set: TypeSafe Jev is asked one of two questions (never batched). For `FILL_BLANK`/`ERROR_CORRECTION`, "is this equally correct?" — a score **≥ 0.8** accepts a correct synonym or an alternative correct construction even if it ignores the bracketed word (`FILL_BLANK`'s `root`) or the specific drilled form; a misspelling or the wrong word form scores low and is rejected. For `DICTATION`, a stricter "same sentence?" question — it must be the **same words in the same order as the heard sentence** (`tts`); only punctuation, capitalisation, spelling variant or contraction differences are accepted, never a synonym. `TRANSLATION` is graded by Jev first ("is this an acceptable translation?", accept **≥ 0.8**); below that, one Claude call (`translation_check` role) writes `{isCorrect, corrected, explanation, category, relatesToFocus}`. `OPEN_WRITING` always calls Claude (`writing_feedback` role); **correct = at least `minWords` words and no correction with `severity: "major"`**. The pre-generated answer key (`correctAnswer` / `explain`) is always returned alongside the verdict, for every type, so the learner can compare their answer to it; for `mcq` the result also carries the pre-generated per-option `rationales`, revealed only after grading. **One attempt per exercise**: a second submit does not re-grade — it returns the `Exercise.result` already stored, with `alreadyAnswered: true`; concurrent submits for the same exercise share one in-flight grading (`checkAnswer`'s `inFlight` map). On success (first grading only) it writes `Exercise.userAnswer/isCorrect/feedback/result/answeredAt` and flips `Lesson.status` `PLANNED → IN_PROGRESS`, in one transaction with the vocab and `ErrorRecord` writes below (see [Spaced repetition](#spaced-repetition-rules)). Responses: **400** malformed body/answer (`InvalidAnswerError`), **404** unknown `exerciseId` (`ExerciseNotFoundError`), **502** the Claude leg failed (`GradingUnavailableError` — Jev problems never fail grading, only a failed Claude call does) — **nothing is recorded** on a 502, so the exercise stays open for retry; **500** anything else. Jev is best-effort everywhere it is used: if it is unavailable, `TRANSLATION` falls straight to Claude and a `FILL_BLANK`/`ERROR_CORRECTION`/`DICTATION` mismatch is simply rejected (no second chance), never a 502.
- `POST /api/conversation/turn` — `{lessonId, userText, mode: "warmup" | "scenario"}`. The server calls the `conversation` role (LocalProvider) and, as tokens arrive, **splits the reply into sentences and synthesises each via Kokoro, streaming audio chunks to the client** (client just plays them); the reply **text** is streamed in parallel for the transcript. This sentence-chunked pipeline is what meets the ≤1.5 s budget. Persists the user turn and the (completed) tutor turn as `ConversationTurn` rows with `corrections: null`. No corrections/teaching. Full section history is sent each call (stateless).
- `POST /api/conversation/analyze` — `{lessonId, mode}`, called once when a conversation section ends. Sends the full transcript **+ the lesson's grammar-topic list** in one call to the `conversation_analysis` role (Claude) → strict-JSON findings. Writes all findings to the matching `ConversationTurn.corrections`; creates `ErrorRecord`s **only from `major` findings**, deduped by `(grammarTopicId ?? category)` within the session. Returns the review payload (severity-coloured highlights + top-issue summary).
- `POST /api/lesson/complete` — generates summary + nextPlan, marks COMPLETED. (Conversation corrections are already committed by `/api/conversation/analyze`; this route no longer materialises them.)
- `GET /api/progress` — stats for dashboard.

## Prompting Requirements

All prompts (Claude **and** local-LLM) live in `/lib/prompts/` as typed template functions — no inline prompt strings in routes.

- **Exercise generation** (Claude): system prompt must demand **strict JSON only** (no markdown fences, no preamble) and, for every exercise, emit the **type-specific content shape** from [Exercise Types](#exercise-types) — including the correct answer(s) and explanations — so all objective types can be checked by local code without an LLM call. Parse with fence-stripping fallback; validate with a per-type zod schema; on parse failure retry once, with a compact summary of the validation issues added to the retry prompt. Only `TRANSLATION` and `OPEN_WRITING` are checked by Claude at answer time. The generation prompt states every validator bound from the same shared constants the zod schemas and `checkExercise` enforce — all defined in `src/lib/lesson/exerciseSchemas.ts` (`OPEN_WRITING_WORDS`, `MCQ_OPTIONS`, `CLOZE_GAPS`, `CHOICE_OPTIONS`, `OPEN_CLOZE_GAPS`, `MATCH_PAIRS`, `EXPLAIN_LIMITS`) — so the limits Claude is told and the limits validation applies cannot drift apart.
- **Conversation partner** (local LLM, `conversation` role): system prompt includes profile, current CEFR level, the lesson's grammar topic and target vocab (to steer toward), and instructs the model to reply as a **partner only** — 2–4 sentences, spoken register, ask follow-up questions, gently elicit the target structures/vocab. It must perform **no corrections, no grammar explanations, no teaching**, even if the user asks (deflect: "we'll review at the end" and continue the conversation).
- **Conversation analysis** (Claude, `conversation_analysis` role): input = full section transcript (turns with ids) + the lesson's grammar-topic list (with ids) + profile + CEFR level. Output = **strict-JSON** findings array `{turnId, grammarTopicId?, original, corrected, explanation, category, severity}` where `severity ∈ minor|moderate|major` and `grammarTopicId` is chosen from the supplied list or `null` (empty array if clean). Fence-stripping fallback, zod validation, retry once.
- **Lesson generation** (Claude): input = profile + **deterministically selected grammar topic, theme and vocab list (see Curriculum section)** + the exercise-type mix + last 3 lesson summaries + due ErrorRecords (from M4) + previous `nextPlan` (from M4). Output = structured JSON lesson plan. The prompt must instruct Claude to build all sections around the given topic/vocab, not introduce other grammar focuses, and must ask for plausible, real-word learner-error distractors (never invented forms) in choice exercises.

## Pages / UI

- `/` — dashboard: streak (a day counts with **≥ 1 answered exercise, local time**; the streak ends today, or yesterday is marked "at risk" if today has no answer yet), today's lesson button, error stats by category (chart), recently mastered items, **syllabus progress per CEFR level** (e.g. "B2 grammar: 14/52 topics mastered", vocab known/total; grammar totals count only `teachable` topics) - each level line also shows "(n in progress)" after the grammar count and "(n learning)" after the vocab count when either is > 0.
- `/lesson/[id]` — the lesson player. Opens on a **lesson intro screen** (learner level, a below-level note when the grammar focus is below the learner's level, the topic's description and example, the theme, target words for the lesson, a topic-progress line - e.g. "Lesson 2 on this topic - 0 of 3 good lessons (80%+) - last time 71%", or "One good lesson (80%+) masters this topic" for a below-level core topic (M4a) - and a Start button) - skipped and going straight to the first exercise once any exercise in the lesson has been answered (e.g. on reload). **M3d scope: written block only** (no section stepper yet) — one exercise card at a time, a progress bar, Check → result panel → Next, and a results screen at the end. Keys are never sent to the browser before an answer is recorded: the client only ever sees the key-free `ExerciseView` (see `src/lib/lesson/lessonView.ts`). Reloading the page resumes at the first unanswered exercise. `DICTATION` uses the browser's `speechSynthesis` until Kokoro lands (M5). 404s for an unknown lesson id. The results screen lists a short prompt excerpt per exercise (`viewExcerpt`, `src/lib/lesson/lessonView.ts`) — never the `DICTATION` sentence, which stays secret. **Enter** checks the current card's answer on every card (in the translation/writing textareas, **Ctrl/Cmd+Enter** submits, so plain Enter still inserts a newline); the verdict is announced through the result panel's status region; `mcq` per-option rationales are revealed only after grading, alongside the verdict. Later milestones add: stepper through sections; voice controls (push-to-talk button, waveform indicator, streaming auto-TTS of tutor replies with replay button); **Conversation Review** screen after each conversation section (transcript with inline correction highlights + top-issues summary); status indicators for local-LLM / TTS availability.
- `/lesson` — redirects to the resumable lesson (`findResumableLessonId`); otherwise offers a "Start today's lesson" button.
- `/errors` — error log: filterable by category/status, each error shows history of reinforcement attempts
- `/history` — past lessons with summaries

UI language: English for lesson content, interface chrome can be English. Mobile-friendly (lessons may happen from phone).

## Design System & Visual Approach

Visual clarity is a first-class goal. Full tokens, component patterns, and the a11y checklist live in [`docs/DESIGN.md`](docs/DESIGN.md); this is the summary.

- **Direction:** **gamified but adult** — motivating, not childish. Rounded cards, visible **streak / XP**, and *juicy* correct-answer feedback (light celebration, progress rings) without clutter. Calm base, energetic accents.
- **Palette (semantic tokens, light + dark):** primary **indigo `#4F46E5`**; **green `#16A34A` = correct / progress / mastered**; **amber = review-due**; **red = error / destructive**. Never signal state by colour alone — always colour **+ icon + text**.
- **Typography:** **Nunito** (headings, XP, rounded/friendly) + **Inter** (body, maximum readability); base 16px, 1.5 line-height, tabular figures for stats/timers.
- **Motion:** 150–300ms, transform/opacity only, `prefers-reduced-motion` respected; celebration animations are brief and skippable.
- **Exercise-card feedback:** instant on submit — correct/incorrect state, an expandable explanation, and a clear "next" action; one primary CTA per card.
- **Progress visualisation:** mastery **rings / waffle** (% of level), **streak calendar**, **line/area** error-trend, **gauge/bullet** "to next level".
- **Design skills** (run on UI-bearing milestones): `frontend-design` for aesthetic direction and font locking, `ui-ux-pro-max` for tokens/patterns and the pre-delivery checklist, `emil-design-eng` for interaction & animation polish.

## Voice Stack

The client voice layer is split behind swappable interfaces so services can be replaced without touching UI logic.

### STT (`lib/stt.ts`)
- **Default:** Web Speech API (`webkitSpeechRecognition`, Chrome), `lang: "en-US"`, interim results shown live, **final transcript editable before sending** (STT errors must not be logged as user errors).
- The STT layer is a **swappable interface** (`lib/stt.ts`) with a single implementation for MVP.
- **Planned upgrade (out of MVP scope):** a local **faster-whisper** (small/medium) FastAPI service on the GPU for better accent handling, dropped in behind the same interface.

### TTS
- **Primary:** local **Kokoro-82M** TTS as a small FastAPI service (`KOKORO_URL`, default `http://localhost:8880`), with **streaming audio playback** so speech starts before full generation completes.
- **Fallback:** browser `speechSynthesis` (`en-US`/`en-GB`, rate slightly below 1.0) if the Kokoro service is unreachable. A **health check on lesson start** decides; fallback is **silent** but surfaced with a small UI indicator.
- Every tutor message keeps a **replay** button regardless of engine.

### Latency budget
**Target (to be benchmarked, not guaranteed) ≤ 1.5 s** from end of user speech to start of tutor audio: STT finalize ~0.5 s → local LLM → first **sentence** ready → streaming TTS begins. Streaming at both the LLM and TTS stages is what keeps this budget.

**Caveats (validate empirically before committing to the number):**
- TTS is **sentence-chunked**, so tutor audio starts on the first *complete sentence*, **not** the first token — budget the sentence-generation time, not first-token time.
- The conversation is **stateless** (full transcript re-sent each turn), so LM Studio re-processes a **growing prompt** every turn; first-sentence latency rises as the section lengthens.
- On the RX 9070 XT, inference runs on **Vulkan** (not ROCm) and Kokoro may run on **CPU** — both add latency. If the model can't fully fit 16 GB VRAM (see `docs/LOCAL_SETUP.md`), partial CPU offload slows first-token further.

## Operational Notes

- **Local services gate lesson start.** LM Studio (model loaded, server enabled) and the Kokoro TTS service must both be up. `POST /api/lesson/start` health-checks both; **if either is down the lesson does not start** — the UI shows which service is missing and how to start it (see `docs/LOCAL_SETUP.md`). The real-time partner (`conversation` role) is **local-only** — there is no cloud fallback (the Claude providers can't stream). The health check does **not** cover browser STT (Web Speech), which is a separate online dependency (see `docs/LOCAL_SETUP.md` §2a).
- **Mid-lesson TTS failure:** if Kokoro drops *after* a healthy start, playback falls back to browser `speechSynthesis` **silently**, with a small UI indicator (the lesson is not aborted).
- **Qwen3 thinking:** the `conversation` role must disable Qwen3 reasoning (`enable_thinking: false` / `/no_think`).
- **Prompts:** local-LLM system prompts live in `/lib/prompts/` alongside the Claude prompts.
- **Schema note:** written-exercise flow and curriculum logic are unchanged in spirit; the Prisma schema gained `Lesson.currentSection`, `ErrorRecord.grammarTopicId`, a `GrammarTopic.errors[]` back-relation, an expanded `ExerciseType` enum, and `ConversationTurn.corrections` is now filled **post-hoc** by `/api/conversation/analyze`.

## Non-goals (MVP)

- No pronunciation scoring (STT quality is too noisy for it) — v2 idea
- No multi-user support
- No native mobile app
- No audio recording storage

## Milestones

1. **M1 — Skeleton**: Next.js + Prisma schema + `lib/llm.ts` provider abstraction (AgentSDK / DirectAPI / Local providers + `config/llm-roles.ts` routing), design-system foundation (tokens/fonts/theme per `docs/DESIGN.md`), dashboard shell
2. **M2 — Curriculum seed**: download datasets to `/data/`, write idempotent seed script, verify GrammarTopic/VocabItem counts and level distribution, dashboard syllabus progress widget
3. **M3 — Written exercises**: deterministic curriculum selection (incl. theme), lesson generation, the MVP exercise-type set + per-type local graders + gamified exercise cards, checking, ErrorRecord logging
4. **M4 — Spaced repetition**: review block, streak/interval logic, topic/vocab status advancement, errors page
5. **M5 — Conversation**: LocalProvider + role routing; real-time warm-up loop (streaming STT + Kokoro TTS, no mid-flow corrections); `/api/conversation/turn` + `/api/conversation/analyze`; post-hoc Claude analysis + Conversation Review screen
6. **M6 — Scenarios + wrap-up**: role-play mode (same real-time loop + analysis), session summary, next-lesson planning, history page

Each milestone ends with a manual verification checkpoint before proceeding. **UI-bearing milestones (M1 shell, M3 exercises, M5 conversation/review) run their surfaces through the design skills** — `frontend-design` (aesthetic direction), `ui-ux-pro-max` (tokens/patterns/pre-delivery checklist), `emil-design-eng` (interaction & animation polish) — per `docs/DESIGN.md`.
