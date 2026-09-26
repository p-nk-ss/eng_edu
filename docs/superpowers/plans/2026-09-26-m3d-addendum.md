# M3d Addendum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Lesson intro screen with level/topic context, more varied generated exercises, a syllabus widget that shows progress in motion, and a logged 502 reason.

**Spec:** `docs/superpowers/specs/2026-09-25-m3d-lesson-player-design.md`, section "Addendum (2026-09-26 ...)". Parent plan: `docs/superpowers/plans/2026-09-25-m3d-lesson-player.md` — its Global Constraints apply verbatim: TDD; `npx tsc --noEmit` + `npm test` before every commit; exact trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and nothing else; no new deps; sequential Prisma queries; no answer keys in the browser before answering; semantic tokens only; state never colour alone; touch targets >= 44px; `\u` escapes or ASCII for typographic characters; never stage skills-lock.json / AGENTS.md / .superpowers/.

Style polish is out of scope (owner decision): reuse existing card and typography patterns, no new visual language.

---

### Task A: Lesson intro screen

**Files:** Modify `src/lib/lesson/loadLesson.ts` (+ test), `src/components/lesson/LessonPlayer.tsx` (+ test). Create `src/lib/lesson/levels.ts` (+ node test), `src/components/lesson/LessonIntro.tsx` (+ test). Update `src/app/lesson/[id]/page.test.tsx` fixture if needed.

**Interfaces:** `PlayerLesson` gains

```ts
intro: {
  learnerLevel: string | null;   // Profile.level, e.g. "B1"
  grammar: { title: string; level: string; description: string | null; example: string | null } | null;
  topicLessonNumber: number | null; // lessons with the same plan.meta.grammarTopicId dated <= this lesson; null without grammar
  vocab: string[];               // headwords of plan.meta.vocabIds in plan order; unknown ids skipped
}
```

`themeLabel` and `grammarTitle` stay. `isBelowLevel(topicLevel: string, learnerLevel: string): boolean` in `levels.ts` (CEFR order A1 < A2 < B1 < B2 < C1 < C2; "B1+" counts as B1; unknown values -> false).

- [ ] `loadLessonForPlayer` loads sequentially: the grammar topic (`title, name, cefrLevel, description, example`); `Profile.level` (`profile.findFirst`, `orderBy updatedAt desc`); vocab headwords (`vocabItem.findMany where id in plan.meta.vocabIds`, re-ordered to plan order); the topic lesson number via `lesson.count({ where: { plan: { path: ["meta", "grammarTopicId"], equals: <id> }, date: { lte: <this lesson's date> } } })` (select the lesson's `date` too). `PlayerLessonDb` gains `profile` and `vocabItem`. Tests: fields for a grammar lesson; `grammar: null` and `topicLessonNumber: null` for a vocab-only lesson; missing profile -> `learnerLevel: null`; vocab order follows the plan and unknown ids are skipped; the count query's where clause.
- [ ] `levels.ts` + node tests (A2 < B1 true; B1 vs B1+ false; C1 vs B2 false; unknown false).
- [ ] `LessonIntro({ lesson, onStart })`: heading "Today's lesson"; grammar block with the title and a level badge (text); when `isBelowLevel(grammar.level, learnerLevel)` a line "Review of A2 basics - closing gaps below your B1 level"; description; example in a quote block; "First lesson on this topic" / "Lesson N on this topic"; theme label; target words as a plain list; "N exercises"; primary **Start** button (min-h-11, autoFocus). Vocab-only: no grammar block. Tests for these texts, the below-level line present/absent, vocab-only rendering, Start calls onStart.
- [ ] `LessonPlayer`: when items exist and none has a result, show `LessonIntro` first; Start -> exercise 1 (its heading focused). Any answered item -> no intro. Tests: fresh lesson shows the intro and Start leads to "Exercise 1 of N"; an answered lesson goes straight to the next card; the existing player tests keep passing (update them to click Start where they use fresh lessons).
- [ ] Commit: `feat(m3d): lesson intro with level, topic and target words`.

### Task B: Varied exercises in generation

**Files:** Modify `src/lib/prompts/lessonGeneration.ts` (+ its test).

- [ ] Add one rule line to `systemPrompt`, right after the "Wrong options must be plausible..." line: exercises must be varied around the one focus - mix statements, questions and negatives; use different subjects, people and situations within the theme; practise the focus's related forms where they exist (e.g. for comparatives: much/far + comparative, less + adjective, not as ... as); never reuse the same sentence frame in two exercises. Test: the system prompt contains "same sentence frame" and "questions".
- [ ] Live check (paid Claude call, 1-3 min, no DB writes): DB up, `ANTHROPIC_API_KEY` unset, `npm run lesson:generate` once with a generous timeout. Save the output to the workspace file given in the dispatch; in the report judge variety exercise by exercise (frames, sentence types, forms). If variety is clearly still poor, adjust the wording once and re-run once.
- [ ] Commit: `feat(m3d): ask for varied exercises around the grammar focus`.

### Task C: Syllabus progress in motion + logged 502 reason

**Files:** Modify `src/lib/curriculum/progress.ts` (+ test), `src/components/syllabus-progress.tsx`, `src/app/page.test.tsx`, `src/app/api/exercise/check/route.ts` (+ test).

- [ ] `SyllabusLevel` gains `grammarInProgress` (INTRODUCED or PRACTICING) and `vocabLearning` (SEEN or LEARNING). Tests in the summarizeSyllabus suite.
- [ ] Widget text: `grammar 0/84 (1 in progress) · vocab 0/1164 (8 learning)` - the parenthesised parts only when > 0 (keep the existing separator character as it is written in the file). The bar shows mastered (success) plus in-progress as a lighter second segment using tokens; numbers stay in text so colour is not the only carrier. Update the dashboard test fixture and assertion.
- [ ] Route: on `GradingUnavailableError` call `console.warn("exercise/check 502:", e.message)` before returning 502 (message only, nothing else). Test with a silenced `console.warn` spy asserting the call.
- [ ] Commit: `feat(m3d): syllabus shows topics and words in progress; log check 502 reason`.
