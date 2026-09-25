# M3c — Answer checking: local graders, judge (Jev → Claude), `POST /api/exercise/check`

**Date:** 2026-09-25 · **Status:** approved design · **Branch:** `feature/m3c-grading`
**Parent:** `SPEC.md` §API Routes (`POST /api/exercise/check`), §Exercise Types, §Spaced repetition
**Predecessor:** M3b-2 (`2026-09-18-m3b2-lesson-generation-design.md`) ✅

| Part | Scope | Status |
|---|---|---|
| M3a · M3b-1 · M3b-2 | selection, grammar enrichment, lesson generation | ✅ |
| **M3c (this doc)** | answer checking, judge role, vocab credit, `ErrorRecord` logging | — |
| M3d | `/lesson/[id]` player + cards | not started |
| M4 | review block, SRS and topic status advancement | not started |

## Goal

The learner answers a written exercise of the current lesson and immediately gets a verdict, the
correct answer and an explanation. Mistakes are recorded (one `ErrorRecord` per cause per lesson)
for M4's review block, and target words move toward `KNOWN`.

## Decisions (owner-approved 2026-09-25)

1. **One attempt per exercise.** The first answer counts; a repeated submit returns the stored
   result (`alreadyAnswered: true`).
2. **Objective types are graded locally** from the keys generated with the lesson.
3. **Typed-answer mismatches are escalated to Jev before they count as wrong** (`open_cloze`, the fix
   of `error_correct`, `dictation`): a confident "equally correct" (BrE/AmE spelling, contraction,
   same-meaning variant) accepts the answer. Without Jev: strict.
4. **Translation: Jev decides, Claude explains.** Jev confidently correct → accepted, no Claude call.
   Otherwise (wrong, uncertain, or Jev unavailable) Claude (`translation_check`) gives the final
   verdict, a corrected version, an explanation and a category.
5. **Open writing: always Claude** (`writing_feedback`) — corrections with severity; accepted when the
   word count reaches `minWords` and there is no `major` correction.
6. **One `ErrorRecord` per cause per lesson** — repeated mistakes of the same cause append an example.
7. **Vocab credit only for words in the answer zone, once per word per lesson** (M3b-2 final-review
   finding: a word merely present in the exercise text must not earn credit).
8. **Synchronous single route** — the verdict and the explanation come back in one response.
   Explanations are in English (SPEC: lesson content is English).
9. The first answered exercise moves the lesson `PLANNED → IN_PROGRESS` (so theme rotation counts it).

## Flow — `checkAnswer(exerciseId, rawAnswer)`

1. Load the exercise and its lesson. Unknown id → `ExerciseNotFoundError` (404). Already answered →
   return `{ ...storedResult, alreadyAnswered: true }`.
2. `parseAnswer(content.type, rawAnswer)` — per-type zod shape; invalid → `InvalidAnswerError` (400).
   A malformed answer is never a learner mistake.
3. `gradeLocally(content, answer)` → verdict, per-gap results, display answer, and the list of typed
   mismatches that may still be acceptable variants.
4. Judge (injected deps, all network calls happen here — never inside the DB transaction):
   - typed mismatches → one Jev variant question per mismatch (one object per request);
   - `translation` → Jev judge; not confidently correct → Claude feedback;
   - `open_writing` → Claude feedback.
   Claude failure → `GradingUnavailableError` (502); nothing is written; the attempt is not consumed.
5. Build `GradeResult`, vocab outcomes (`answerZone.ts`) and error entries (`errorEntries.ts`).
6. `recordAnswer()` — one `$transaction`, sequential queries (see Persistence).
7. Return `GradeResult`.

Concurrent submits of the same exercise are single-flighted per `exerciseId` (module-level map of
in-flight promises, cleared in `finally`); the transaction additionally writes the exercise only
`WHERE answeredAt IS NULL` and, if nothing was updated, returns the stored result.

## Components

### 1. Answer shapes — `src/lib/grading/answerSchemas.ts`

| `type` tag | answer |
|---|---|
| `mcq`, `dialogue_gap` | `{ selected: number }` |
| `cloze_mc` | `{ selected: number[] }` (one per gap) |
| `open_cloze` | `{ text: string[] }` (one per gap) |
| `word_bank` | `{ tokens: string[] }` |
| `match` | `{ pairs: number[] }` (`pairs[i]` = right index chosen for `left[i]`) |
| `dictation`, `translation`, `open_writing` | `{ text: string }` (1–2000 chars) |
| `error_correct` | `{ index: number; fix: string }` |

`parseAnswer(tag, raw)` returns `{ ok: true; answer } | { ok: false; reason }`; array lengths must
match the exercise (gaps, left items) — checked against the content.

### 2. Local graders — `src/lib/grading/graders.ts` (pure)

`gradeLocally(content, answer): LocalGrade`

```ts
interface LocalGrade {
  isCorrect: boolean;               // all parts correct
  parts?: { correct: boolean; given: string; expected: string }[]; // per gap / pair
  correctAnswer: string;            // human-readable key for display
  variantCandidates: { part: number; given: string; expected: string[]; context: string }[];
  needsJudge: "translation" | "writing" | null;
}
```

- choice types: index equality (per gap for `cloze_mc`);
- `open_cloze`: `normalizeAnswer(given) ∈ accept.map(normalizeAnswer)` per gap;
- `error_correct`: `index === answer` AND normalized fix ∈ normalized `accept`; a wrong index is
  wrong without escalation;
- `dictation`: `normalizeLoose` on both sides;
- `word_bank`: `normalizeLoose(tokens.join(" "))` equals the key or any `accept_alt`;
- `match`: per pair;
- `translation` / `open_writing`: `needsJudge`.
Every typed part that failed normalization becomes a `variantCandidate` (with its sentence context).

### 3. Jev prompts — `src/lib/prompts/variantGate.ts`, `translationJudge.ts`

- **Variant gate** (`Noul`, one mismatch per request): state `{ sentence_with_gap, keyed_answer,
  learner_answer }`; "Is `learner_answer` an equally correct way to fill the gap — the same word or
  phrase in another standard spelling (British/American), a contraction or full form, or a synonym
  that keeps the meaning and grammar?". Accept when `noul ≥ VARIANT_ACCEPT` (0.8).
- **Translation judge** — the two questions validated in the 2026-09-18 spike: `acceptable`
  (`Noul`: error-free standard English with the same meaning as the reference; paraphrases fine) and
  `error_type` (`Choice`: none | grammar | vocabulary | word_order | spelling | meaning). State:
  `{ source_ru, reference_en, learner_answer }`. `acceptable ≥ TRANSLATION_ACCEPT` (0.8) → correct,
  no Claude call. Thresholds are constants in the prompt module.

### 4. Claude prompts — `src/lib/prompts/translationFeedback.ts`, `writingFeedback.ts`

Project prompt convention (schema + limit constants + function returning `CompleteArgs`).

- `translationFeedbackSchema`: `{ isCorrect: boolean, corrected: string (1–300),
  explanation: string (10–400), category: "none"|"grammar"|"vocabulary"|"word_order"|"spelling"|"meaning",
  relatesToFocus: boolean }`. Input: source, reference, learner answer, Jev's category hint (if any),
  grammar focus title + description (or null), CEFR level. Instruction: accept any correct, natural
  translation (the reference is one of many); when wrong, `corrected` is the learner's sentence with
  minimal edits.
- `writingFeedbackSchema`: `{ summary: string (20–400), corrections: { original (1–200),
  corrected (1–200), explanation (10–300), category: "grammar"|"vocabulary"|"word_order"|"spelling"|
  "punctuation"|"style", severity: "minor"|"moderate"|"major", relatesToFocus: boolean }[] (≤ 15) }`.
  `isCorrect = wordCount(text) ≥ minWords && no major correction` (computed in code, not by Claude).

### 5. Judge — `src/lib/grading/judge.ts`

`runJudge(content, local, answer, grammar, level, deps): Promise<JudgeOutcome>` with injected
`deps = { jev: TypeSafeClient | null, ask: (args, schema) => Promise<T> }`. Resolves variant
candidates (accepted parts flip to correct; the exercise is correct only if every part is), runs the
translation/writing path, and returns the final verdict, feedback, `gradedBy`
(`"local" | "jev" | "claude"`) and the Jev scores used. Jev errors never fail grading (strict /
straight-to-Claude fallback); Claude errors throw `GradingUnavailableError`.

### 6. Vocab credit — `src/lib/grading/answerZone.ts` (pure)

`vocabOutcomes(content, verdict, vocab: { id, headword }[]): { id: string; correct: boolean }[]` —
only ids from `content.vocab` whose headword (`headwordOccurs`) is in the answer zone:

| type | answer zone | credit |
|---|---|---|
| `mcq`, `dialogue_gap` | keyed option | exercise verdict |
| `cloze_mc` | keyed option of each gap | that gap's verdict |
| `open_cloze` | `accept[0]` (+ `root`) of each gap | that gap's verdict |
| `error_correct` | `accept[0]` | exercise verdict |
| `word_bank` | key tokens | exercise verdict |
| `match` | `left[i]` and `right[answer[i]]` | pair `i`'s verdict |
| `dictation` | `tts` | exercise verdict |
| `translation` | `reference` | exercise verdict |
| `open_writing` | — (no credit) | — |

**Once per word per lesson:** ids already present in the `vocabCredit` of another answered exercise
of the same lesson are skipped. Update rule: correct → `correctStreak + 1`, `NEW|SEEN → LEARNING`,
`correctStreak ≥ 3 → KNOWN`; wrong → `correctStreak = 0`, `KNOWN → LEARNING` (others → `LEARNING`);
always `lastSeenAt = now`.

### 7. Error entries — `src/lib/grading/errorEntries.ts` (pure)

`errorEntries(content, judged, lesson): ErrorEntry[]` where
`ErrorEntry = { grammarTopicId: string | null; category: string; source: "EXERCISE" | "WRITING"; example: string }`.

| exercise | cause |
|---|---|
| `mcq`, `cloze_mc`, `open_cloze`, `error_correct`, `dialogue_gap`, `word_bank` wrong | lesson grammar focus (`grammarTopicId`, category = topic title); vocab-only lesson → `vocab: <headword>` per answer-zone word, else `general` |
| `match` wrong pair | `vocab: <left item>` per wrong pair |
| `dictation` wrong | `listening/spelling` |
| `translation` wrong | `relatesToFocus` → grammar focus; else `translation: <category>` |
| `open_writing` | each `major` correction: `relatesToFocus` → focus; else `writing: <category>` (source `WRITING`) |

`example` = `"<given> → <expected>"` (≤ 200 chars).

### 8. Persistence — `src/lib/grading/recordAnswer.ts`

Migration (additive): `Exercise.result Json?`, `Exercise.answeredAt DateTime?`.
`result` = `GradeResult` (`version: 1`, verdict, parts, correctAnswer, explain, feedback, gradedBy,
`vocabCredit`, Jev scores). `userAnswer` = JSON of the parsed answer; `isCorrect`; `feedback` = the
explanation text shown to the learner.

One `$transaction`, sequential awaits:
1. `exercise.updateMany({ where: { id, answeredAt: null }, data })` — 0 rows → return the stored result.
2. lesson `PLANNED → IN_PROGRESS` (only if `PLANNED`).
3. read `vocabCredit` of the lesson's other answered exercises → drop already-credited ids → update
   each remaining `VocabItem`.
4. for each error entry: `errorRecord.findFirst({ lessonId, grammarTopicId, category })` → append the
   example to `description` (keep the last 5) or `create` (`status NEW`, `nextReviewAt = now + 1 day`).

### 9. Route — `src/app/api/exercise/check/route.ts`

`POST { exerciseId: string, answer: unknown }` → `200 GradeResult & { alreadyAnswered: boolean }` ·
`400` invalid body / `InvalidAnswerError` · `404` `ExerciseNotFoundError` · `502`
`GradingUnavailableError` · `500` message only. `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
Answer keys are only ever sent AFTER the answer is recorded.

### 10. Acceptance tool — `scripts/answer-preview.ts` (`npm run answer:check`)

Grades an answer against an exercise of the latest lesson with the LIVE judge and prints the full
`GradeResult`, **without writing to the DB**. `--exercise <n>` (1-based position in the lesson's
written block) `--answer '<json>'`, or `--cases <file.json>` to run a batch.

**Calibration gate.** Before the route task: ~12 live cases on the persisted lesson — typed variants
(BrE spelling, contraction, synonym, a real error), three translations (correct paraphrase, clearly
wrong, borderline), one open writing (if the lesson has none, a synthetic `open_writing` content in
the cases file). The owner reviews verdicts and explanations; prompts are tuned if needed.

## Error handling

| Situation | Behaviour |
|---|---|
| unknown exercise | 404 |
| malformed answer | 400, nothing written |
| already answered | 200 stored result, `alreadyAnswered: true` |
| Jev unavailable / error | typed: strict; translation: straight to Claude |
| Claude unavailable / invalid twice | 502, nothing written, attempt not consumed |
| double submit | single-flight per exercise + conditional update |

## Testing (TDD)

Answer shapes (valid/invalid per type, length vs content) · graders (table per type incl. curly
quotes, loose normalization, per-gap/pair) · answer zone (table per type, once-per-lesson skip) ·
error entries (table per exercise type, vocab-only lesson, relatesToFocus) · prompts (content,
limits from constants) · judge with fake Jev/Claude (accept/reject variants, translation fast path,
escalation, fallbacks) · checkAnswer + recordAnswer with fake db (write order, conditional update,
aggregation append, lesson status) · route (status mapping). Live calls only in
`npm run answer:check` and the final check.

## Out of scope

Player and cards (M3d) · review block, SRS scheduling after the first `nextReviewAt`, grammar topic
advancement incl. the below-level fast-track (M4) · Russian explanations · partial credit · retries.

## Documentation (part of this work)

`SPEC.md` (§API Routes check route, §Spaced repetition vocab credit rule, §Exercise Types answer
shapes pointer), `CLAUDE.md` (commands, milestone status).
