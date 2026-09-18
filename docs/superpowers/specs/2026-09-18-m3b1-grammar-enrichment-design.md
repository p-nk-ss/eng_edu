# M3b-1 — Grammar topic enrichment: teachable titles, descriptions, importance

**Date:** 2026-09-18 · **Status:** approved design · **Parent:** `SPEC.md` §Curriculum, milestone M3
**Predecessor:** `2026-09-18-m3a-curriculum-selection-design.md` (M3a ✅)

M3b is split in two, each with its own spec → plan → implementation cycle:

| Part | Scope | Depends on |
|---|---|---|
| **M3b-1 (this doc)** | one-off Claude enrichment of the 266 grammar topics; selection skips non-teachable topics and orders by importance | M3a |
| M3b-2 | exercise zod schemas, `lesson_generation` prompt, local checks + quality gate, lesson creation with status transitions, `POST /api/lesson/start` | M3b-1 |

## Problem

The grammar syllabus comes from the CEFR-J Grammar Profile — a **corpus profile of patterns**, not a
teaching syllabus. Consequences found on 2026-09-18:

- Topic names are corpus labels: `You are`, `These/Those N`, `-thing ADJ`,
  `TENSE/ASPECT: PAST PERFECT`. Claude cannot build a lesson around `You are`, and the learner cannot
  read such a title.
- Some items are trivially below their level or are corpus-position artefacts (`You are` is tagged
  B1 only because of a sentence-initial constraint). `pickGrammarFocus` currently picks exactly that
  one as the first B1 lesson.
- Within a level, `sortOrder` follows the dataset's sections (pronouns → adverbs → comparison →
  tenses → …), so a B1 learner would spend ~13 lessons on peripheral items before Past Perfect or the
  passive.
- The seed de-duplicates by name, so sentence-type variants (AFF / NEG / INT rows sharing one name —
  73 names have more than one row) collapse into one topic and the variant information is dropped.

## Decisions

1. **Enrich once, offline, with Claude**; commit the result as `data/grammar-topics.json`; the seed
   applies it. No LLM call in the selection path — selection stays a pure function of DB state.
2. **Keep the dataset's CEFR level.** Bad cases are handled by `teachable: false`, not by re-levelling.
3. **Order within a level by `importance` (1–3), then dataset `sortOrder`.**
4. **Batch ~15 topics of the same level per call**, so importance is judged relative to peers.
   (Unlike the Jev classifier in M3a, a generative model returning strict per-item JSON showed no
   cross-item contamination concern; the pilot gate below verifies quality anyway.)
5. Descriptions are in **English** (they feed Claude's lesson prompt and the lesson UI).

## Components

### 1. Variant collection — `src/lib/curriculum/parse.ts`

New pure function next to `parseGrammarRows`:

```ts
export interface GrammarVariant { shorthand: string; sentenceType: string; note: string }
/** All CSV rows sharing a Grammatical Item name, in file order. Key = the same trimmed name parseGrammarRows uses. */
export function collectGrammarVariants(rows: string[][]): Map<string, GrammarVariant[]>
```

Columns: 1 = Shorthand Code, 3 = Sentence Type, 9 = Notes (Japanese; passed to Claude verbatim).
`loadSeedData()` is unchanged; a sibling `loadGrammarVariants()` in `load.ts` reads the same CSV.

### 2. Enrichment record — `src/lib/curriculum/grammarEnrichment.ts`

```ts
export const enrichmentSchema = z.object({
  name: z.string().min(1),                 // dataset name — the join key (GrammarTopic.name is @unique)
  title: z.string().min(3).max(80),        // learner-facing, e.g. "Past Perfect (had done)"
  description: z.string().min(20).max(400),// 1–2 sentences: form + when to use
  example: z.string().min(5).max(200),     // one natural example sentence
  teachable: z.boolean(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  note: z.string().max(200).default(""),   // required non-empty when teachable is false (why)
}).refine((e) => e.teachable || e.note.trim().length > 0, { message: "note is required when teachable is false" });
export type GrammarEnrichment = z.infer<typeof enrichmentSchema>;
```

Pure helpers in the same file (all unit-tested):

- `batchByLevel(topics, size = 15)` — groups `GrammarSeed[]` by `cefrLevel` (A1→C2), chunks each
  level in `sortOrder`; never mixes levels in a batch.
- `pendingTopics(topics, done)` — resume: drops topics whose `name` is already enriched.
- `validateBatch(requested, returned)` — every requested name present exactly once, no extra names;
  throws naming the offenders (the script retries the batch once, then fails).
- `parseEnrichmentFile(jsonText)` / `serializeEnrichmentFile(records)` — array sorted by `name`,
  2-space JSON, trailing newline (stable diffs).
- `pilotSample(topics)` — first 15 topics of A2 and first 15 of B1 (deterministic).

### 3. Prompt — `src/lib/prompts/grammarEnrichment.ts`

Typed template function (SPEC §Prompting: no inline prompt strings):

```ts
export function grammarEnrichmentPrompt(input: {
  level: CefrBand;
  topics: { name: string; variants: GrammarVariant[] }[];
}): { system: string; user: string }
```

System prompt states: the audience (adult Russian-speaking learner, goal = conversational fluency);
that names are corpus pattern labels from the CEFR-J Grammar Profile and the Japanese notes describe
extraction constraints; the output contract — **strict JSON array only**, one object per input topic,
`name` copied verbatim; the meaning of `importance` (1 = core for conversational fluency at this
level: tenses, modals, conditionals, passive, questions; 2 = useful; 3 = peripheral); and when
`teachable` is false (trivially below the level, a pure corpus-position artefact, or not a learnable
point on its own) with the reason in `note`. `title` must be recognisable to a learner who knows
textbook terminology; `example` must be natural spoken English at the given level.

Called through the existing facade: `completeJson("lesson_generation", …, z.array(enrichmentSchema))`
(fence-stripping, zod validation, one retry — already implemented). No new role.

### 4. Script — `scripts/enrich-grammar.ts` (`npm run grammar:enrich`)

Loads `.env` then `.env.local` before importing anything that reads env (`CLAUDE_CODE_OAUTH_TOKEN`);
`ANTHROPIC_API_KEY` must stay unset. Reads topics from the CSV loaders — no DB.

- Full mode → `data/grammar-topics.json`, resumable (already-enriched names skipped; file rewritten
  after every batch, so a crash keeps progress). `--pilot` → `data/grammar-topics.pilot.json`, always
  fresh, ~30 topics.
- Sequential batches (the Agent SDK spins up a runtime per call; ~20 calls, a few minutes).
- On `validateBatch` failure: retry that batch once, then exit non-zero naming the batch.
- Prints a summary: per level — count, non-teachable count, importance histogram.

**Calibration gate.** Run `--pilot` first; the owner reviews titles, `teachable` and `importance`.
The prompt is tuned if needed. The full run starts only after the pilot is accepted. The committed
JSON may be edited by hand afterwards — the seed re-applies it.

### 5. Schema migration

```prisma
model GrammarTopic {
  …
  title       String?
  description String?
  example     String?
  teachable   Boolean @default(true)
  importance  Int     @default(2)
}
```

Purely additive; existing rows get the defaults.

### 6. Seed — `prisma/seed.ts` + `src/lib/curriculum/seedExtras.ts`

`buildGrammarEnrichment(jsonText, knownNames)` (pure, tested): parses with `enrichmentSchema`,
rejects a `name` that is not a seeded topic or appears twice, naming it. The seed applies the records
with one bulk `UPDATE … FROM unnest(…)` guarded by `IS DISTINCT FROM` (same pattern as vocab topics):
idempotent, progress fields untouched. Missing file → warning, defaults stay.

### 7. Selection — `src/lib/curriculum/select.ts`, `lessonInputs.ts`

- `GrammarCandidate` gains `teachable: boolean` and `importance: number`.
- `pickGrammarFocus`: candidates = topics at the band with `status != MASTERED` **and `teachable`**;
  order = status-rank group (unchanged) → `importance` asc → `sortOrder` → `name` (code-unit compare).
  A band whose remaining topics are all non-teachable counts as exhausted → next band.
- `selectLessonInputs` needs no query change (`findMany` already returns all columns); the returned
  `grammarTopic` now carries `title`/`description`/`example` for M3b-2's prompt.
- `scripts/curriculum-preview.ts` prints `title ?? name`.

### 8. Progress widget — `src/lib/curriculum/progress.ts`

`getSyllabusProgress` counts only `teachable` grammar topics (otherwise a level can never reach
100%). `summarizeSyllabus` stays pure; the filter is in the query.

## Error handling

| Situation | Behaviour |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` missing / SDK error | script exits non-zero with the provider's error; progress kept |
| Claude returns invalid JSON twice | `completeJson` throws → script exits non-zero naming the batch |
| batch misses / adds / duplicates a name | one retry, then exit non-zero naming the names |
| `grammar-topics.json` missing | seed warns; all topics stay `teachable=true, importance=2`, titles NULL (selection and preview still work) |
| unknown or duplicate `name` in JSON | seed fails naming it |
| every remaining topic in a band is non-teachable | `pickGrammarFocus` moves to the next band |

## Testing (TDD)

- `parse.test.ts` — `collectGrammarVariants`: grouping by name, file order, blank names skipped.
- `grammarEnrichment.test.ts` — schema (note required when not teachable; importance ∈ {1,2,3};
  length limits), `batchByLevel` (no mixed levels, size, order), `pendingTopics`, `validateBatch`
  (missing / extra / duplicate), file round-trip sorted by name, `pilotSample`.
- `prompts/grammarEnrichment.test.ts` — output contains each topic name verbatim, its shorthand codes
  and sentence types, the level, and the JSON-only contract.
- `seedExtras.test.ts` — `buildGrammarEnrichment` happy path, unknown name, duplicate name.
- `select.test.ts` — non-teachable skipped; importance beats sortOrder inside a status group but not
  across groups; all-non-teachable band → next band.
- `progress` — query filter covered by a fake-db test.
- Live Claude calls happen only in the pilot and the full run (manual gate). `npx tsc --noEmit`
  before every commit.

## Out of scope

Lesson generation (M3b-2) · re-levelling topics · Russian translations of descriptions · splitting
collapsed AFF/NEG/INT variants into separate topics (the enrichment describes the pattern family as
one topic) · any UI beyond the preview script and the progress-count filter.

## Documentation updates (part of this work)

`SPEC.md` (GrammarTopic model fields; §Curriculum — grammar focus rule now "teachable, by importance
then sortOrder"), `data/README.md` (`grammar-topics.json`, how to regenerate / hand-edit), `CLAUDE.md`
(commands, milestone status: M3b-1).
