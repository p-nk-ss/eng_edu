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
  (Choice/Score/Noul). M3a: offline vocab topic classification only.

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
npm run curriculum:preview # print the deterministic selection for the next 5 lessons
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
- **Env loading**: `.env.local` holds `DATABASE_URL` (create it in **UTF-8** — PowerShell defaults to
  UTF-16, which dotenv can't parse). `prisma.config.ts` loads `.env` then `.env.local`. Scripts run
  **directly** via `tsx` (not `prisma db seed`) must load `.env.local` **before** importing
  `src/lib/db.ts`, or PrismaClient is built with an empty URL (`role "..." does not exist`). Prefer
  `prisma db seed` / `prisma migrate`, which inject env themselves.

## Milestone status (source of truth: git log)

- **M1 Skeleton** ✅ — scaffold, schema, LLM layer, design tokens, dashboard.
- **M2 Curriculum seed** ✅ (code) — datasets + idempotent seed (266 grammar topics, 9780 vocab) +
  syllabus progress widget. Seed run is pending a live local DB.
- **M3 Written exercises** — split into M3a–M3d (see
  `docs/superpowers/specs/2026-09-18-m3a-curriculum-selection-design.md`):
  - **M3a** (theme source, vocab topic classification, `Profile`, deterministic selection)
    code-complete except the full `npm run vocab:classify` run, which awaits the owner's review
    of the pilot.
  - M3b lesson generation · M3c graders/`judge` role · M3d exercise player — not started.
- M4 Spaced repetition · M5 Conversation · M6 Scenarios + wrap-up.

## Dev guidelines

- **TDD** (write failing test → implement → pass). Frequent, logically-scoped commits.
- **Run `npx tsc --noEmit` before committing** — Vitest transpiles without type-checking, and
  `next build` only type-checks app files (not tests). Type bugs hide otherwise.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work happens on branch `feature/m1-skeleton` (not `main`).
- `ANTHROPIC_API_KEY` must stay **unset** (or Agent SDK bills pay-per-token instead of the Max credit).
