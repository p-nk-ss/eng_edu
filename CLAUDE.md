# CLAUDE.md — English Trainer

Personal, single-user, **fully local** web app for practicing English (daily adaptive lessons:
speaking + writing, mistake tracking, spaced repetition). Full behavior spec: `SPEC.md`. Design
system: `docs/DESIGN.md`. Local setup: `docs/LOCAL_SETUP.md`. Milestone plan: `docs/superpowers/`.

> Communicate with the owner in **Russian**.

## Stack

- **Next.js 15** (App Router) + TypeScript, Tailwind 3.
- **Prisma 7** over **local PostgreSQL** (via `@prisma/adapter-pg`).
- **LLM layer** (`src/lib/llm/`): role → provider routing. `LocalProvider` (LM Studio/Qwen3-14B,
  OpenAI-compatible, streaming) for the `conversation` role; `AgentSDKProvider` (Claude via
  `@anthropic-ai/claude-agent-sdk`, subscription/`CLAUDE_CODE_OAUTH_TOKEN`) for teaching roles;
  `DirectAPIProvider` (`@anthropic-ai/sdk`) as fallback.
- Tests: **Vitest** + Testing Library. **zod 4** (required — Agent SDK peer).
- **TypeSafe Jev** (`src/lib/typesafe/`, plain fetch, `TYPESAFE_API_KEY`): structured judgments
  (Choice/Score/Noul). Used offline for vocab topic classification (M3a) and, at lesson start, as
  a best-effort answer-key quality gate on generated exercises (M3b-2).

## Commands

```powershell
npm test                 # vitest (all suites)
npx tsc --noEmit         # TYPE-CHECK — vitest does NOT check types; run this before committing
npm run build            # production build (also type-checks app files)

npm run db:setup         # one-time: download portable PG17, init cluster, create DB
npm run db:start|stop|status|psql
npm run dev              # predev auto-starts the DB; serves http://localhost:3000

npx prisma migrate dev --name <name>   # migrations (DB must be up)
npx prisma db seed                     # idempotent curriculum seed (prisma/seed.ts)
npx prisma generate                    # after schema changes (works without a DB)

npm run vocab:classify    # offline vocab topic classification via TypeSafe Jev
npm run grammar:enrich    # offline grammar topic enrichment via Claude (title/description/example/teachable/importance)
npm run curriculum:preview # print the deterministic selection for the next 5 lessons
npm run lesson:generate    # generate ONE lesson live (Claude + Jev), print it; no DB writes
npm run answer:check       # grade one answer live (Jev + Claude) against a real/synthetic exercise; no DB writes
```

## Database — portable, inside the project (no system install, no Docker)

PostgreSQL runs **portable** from the project: binaries in `.pgsql/`, data cluster in `.pgdata/`
(both git-ignored, on the D: drive; nothing written to `C:\`, no Windows service). Managed by
`scripts/db.ps1` (`npm run db:*`). Connection: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/english_trainer`
in `.env.local` (local trust auth; the password is accepted as-is). This was a deliberate choice
over cloud Neon (single-user, offline) and over Docker (needless WSL2 overhead here).

## Local services (needed from M5 only — voice)

- **LM Studio** + **Qwen3-14B** (Q6_K, ~12 GB — fits 16 GB VRAM; 30B does NOT) on `:1234`, Vulkan
  backend (works on RX 9070 XT / RDNA4). `conversation` role is **local-only** (Claude providers
  can't stream — no cloud fallback).
- **Kokoro-82M** TTS on `:8880`. STT is browser Web Speech (⚠ not local, needs internet).

## Key decisions & gotchas

- **Prisma 7**: connection URL lives in `prisma.config.ts` (NOT `schema.prisma`); config needs
  `import "dotenv/config"`; enums must be one-value-per-line. Driver adapters are GA (no preview flag).
- **Mastery/SRS attribution is lesson-grained** — no `Exercise→GrammarTopic/VocabItem` FK. Topic
  accuracy = the lesson's written-block accuracy (one focus per lesson); vocab streaks update from
  `Exercise.content.vocab` ids. See `SPEC.md` §Spaced repetition.
- **`AgentSDKProvider`**: `query()` reads the final `result` (NOT `text`) and throws on error
  subtypes; tool lockdown is via `canUseTool` deny + `maxTurns:1` (not `allowedTools:[]`).
- **Curriculum data has NO thematic categories** (CEFR-J vocab v1.5) → `VocabItem.topic=null`.
  Resolved in M3a: curated theme list + Jev classification. See
  `docs/superpowers/specs/2026-09-18-m3a-curriculum-selection-design.md` and `data/README.md`.
- **Grammar topics are CEFR-J corpus labels, not teaching topics** — enriched once into
  `data/grammar-topics.json` via Claude (M3b-1); selection skips `teachable=false` and orders by
  `importance`. See `docs/superpowers/specs/2026-09-18-m3b1-grammar-enrichment-design.md`.
- **Prompt convention**: every prompt lives in `src/lib/prompts/<name>.ts` and exports (a) the zod
  response schema with its limit constants and (b) a function returning `CompleteArgs`; the prompt
  text is built from those same constants so it cannot drift from the schema. Call sites are
  `completeJson(role, xPrompt(input), xSchema)`.
- **Env loading**: `.env.local` holds `DATABASE_URL` (create it in **UTF-8** — PowerShell defaults to
  UTF-16, which dotenv can't parse). `prisma.config.ts` loads `.env` then `.env.local`. Scripts run
  **directly** via `tsx` (not `prisma db seed`) must load `.env.local` **before** importing
  `src/lib/db.ts`, or PrismaClient is built with an empty URL (`role "..." does not exist`). Prefer
  `prisma db seed` / `prisma migrate`, which inject env themselves.

## Milestone status (source of truth: git log)

- **M1 Skeleton** ✅ — scaffold, schema, LLM layer, design tokens, dashboard.
- **M2 Curriculum seed** ✅ — datasets + idempotent seed (266 grammar topics, 9780 vocab, run live
  against the local DB) + syllabus progress widget.
- **M3 Written exercises** — split into M3a–M3d (see
  `docs/superpowers/specs/2026-09-18-m3a-curriculum-selection-design.md`):
  - **M3a** ✅ — curated theme list (`src/lib/curriculum/themes.ts`); all 9780 vocab items
    classified into themes via TypeSafe Jev (`data/vocab-topics.csv`) and applied by the seed;
    `Profile` seeded from `data/profile.json`; deterministic selection (`selectLessonInputs`);
    `npm run curriculum:preview`.
  - **M3b-1** ✅ — all 266 `GrammarTopic`s enriched via Claude into `data/grammar-topics.json`
    (title, description, example, `teachable`, `importance`); grammar-focus selection skips
    non-teachable topics and orders by `importance`; syllabus progress widget counts teachable
    topics only; `npm run grammar:enrich`. See
    `docs/superpowers/specs/2026-09-18-m3b1-grammar-enrichment-design.md`.
  - **M3b-2** ✅ — one Claude call per lesson → 5–8 written exercises + warm-up/scenario framing;
    each exercise validated individually (zod → `checkExercise` → TypeSafe Jev answer-key gate,
    best effort) with one regeneration if fewer than 5 survive; transactional persistence with
    grammar/vocab status transitions; idempotent `POST /api/lesson/start`; `npm run
    lesson:generate`. See `docs/superpowers/specs/2026-09-18-m3b2-lesson-generation-design.md`.
  - **M3c** ✅ — `POST /api/exercise/check`: local graders for objective types, TypeSafe Jev as a
    best-effort second chance on typed mismatches (accept ≥ 0.8), `translation_check`/`writing_feedback`
    (Claude) for `TRANSLATION`/`OPEN_WRITING`; one attempt per exercise, transactional vocab-streak
    and `ErrorRecord` updates; `npm run answer:check`. See
    `docs/superpowers/specs/2026-09-25-m3c-answer-checking-design.md`.
  - M3d exercise player — not started.
- M4 Spaced repetition · M5 Conversation · M6 Scenarios + wrap-up.

## Dev guidelines

- **TDD** (write failing test → implement → pass). Frequent, logically-scoped commits.
- **Run `npx tsc --noEmit` before committing** — Vitest transpiles without type-checking, and
  `next build` only type-checks app files (not tests). Type bugs hide otherwise.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on a feature branch per milestone, never on `main` — currently `feature/m3c-grading`.
  `main` holds finished milestones (M1–M3b-2 merged 2026-09-25).
- `ANTHROPIC_API_KEY` must stay **unset** (or Agent SDK bills pay-per-token instead of the Max credit).
