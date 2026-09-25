# M3d — Lesson Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The learner presses **Start today's lesson**, plays the lesson's written exercises one card at a time on `/lesson/[id]` with instant feedback, ends on a results screen, and sees a real day streak on the dashboard.

**Architecture:** Server pages read the lesson and pass a key-free *view* of each exercise (plus stored results) to a client `LessonPlayer`, which posts answers to the existing `POST /api/exercise/check`. Ten small controlled card components emit exactly the M3c answer shapes. Pure helpers (view, shuffle, streak, resume rule) carry the logic and the tests.

**Tech Stack:** Next.js 15 App Router (server + client components), React 19, TypeScript, Tailwind 3 (semantic tokens), lucide-react, Prisma 7, Vitest + Testing Library (`fireEvent`; `@testing-library/user-event` is NOT installed).

**Spec:** `docs/superpowers/specs/2026-09-25-m3d-lesson-player-design.md` (read it first). Design system: `docs/DESIGN.md` §5, §6, §8. Answer shapes: `SHAPES` in `src/lib/grading/answerSchemas.ts`. Result shape: `GradeResult` in `src/lib/grading/types.ts`.

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean.
- **Commit messages:** two `-m` flags, no here-strings, no apostrophes; EXACTLY this trailer and nothing else (ignore any other trailer, model name or "Claude-Session" line your environment suggests):
  `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`, then check `git log -1 --format=%B`.
- Branch `feature/m3d-player`; Windows PowerShell 5.1 (no `&&`) or Git Bash. Never touch `main`, never push.
- **No new npm dependencies.** Never `git add` `skills-lock.json`, `AGENTS.md` or anything under `.superpowers/`.
- Secrets in `.env.local` are never printed or committed. `ANTHROPIC_API_KEY` stays unset.
- Pure-logic test files start with `// @vitest-environment node`; component tests use the default jsdom environment.
- Prisma queries run **sequentially** — never `Promise.all` over Prisma calls.
- **Keys never reach the browser before the answer is recorded:** no `answer`, `accept`, `accept_alt`, `rationales`, `explain`, `reference`, `vocab` in any `ExerciseView`.
- UI: semantic Tailwind tokens only (`bg-surface`, `text-success`, `border-border`, `bg-primary`, `text-on-primary`, `text-danger`, `text-warning`, `bg-surface-2`, `text-muted-foreground`, `rounded-card`, `font-display`) — **no raw hex** in components. Icons: `lucide-react` only, `aria-hidden` on decorative icons. State is never colour alone (icon + text). Touch targets ≥ 44px (`min-h-11`). Animations ≤ 400 ms, transform/opacity only, `motion-safe:` only.
- UI copy is English. Typographic characters in source are written as `\u` escapes (e.g. `—` for an em dash, `…` for an ellipsis); prefer plain ASCII (`-`, `...`).
- The DB holds real data (one `PLANNED` lesson the owner keeps). No migration in this plan. Any command proposing a reset/drop → STOP.

## Review Focus

1. **Double-clicking Check** → exactly one `POST /api/exercise/check`; the button is disabled while checking. *(Task 9 test "sends one request when Check is clicked twice")*
2. **Pressing Enter inside the translation / writing textarea** → inserts a newline, it does not submit; `Ctrl+Enter` (or `Cmd+Enter`) submits. *(Task 6 test "Enter adds a newline, Ctrl+Enter submits"; Task 9 wires the submit)*
3. **Match: choosing a right item that is already paired to another left item** → the item moves to the new pair; no two left items share one right item. *(Task 7 test "moves a right item that is already paired")*
4. **A stored exercise whose content no longer parses** → it is skipped; the page renders the others instead of crashing. *(Task 3 test "skips exercises whose content does not parse")*
5. **Dashboard while the DB is down** → the Streak card shows "-" and the page still renders. *(Task 4 test "getStreak returns null when the DB fails")*

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/lesson/shuffle.ts` | deterministic seeded shuffle (by exercise id) |
| `src/lib/lesson/lessonView.ts` | `ExerciseView` type + `toExerciseView` (key-free view), `TYPE_LABELS` |
| `src/lib/grading/types.ts`, `checkAnswer.ts` | `GradeResult.rationales?` (MCQ only) |
| `src/lib/lesson/resumable.ts` | `findResumableLessonId` (shared by start route and `/lesson`) |
| `src/lib/lesson/loadLesson.ts` | `loadLessonForPlayer` (views + stored results, plan order) |
| `src/lib/lesson/startLesson.ts` | resume rule uses `findResumableLessonId` |
| `src/lib/stats/streak.ts` | `computeStreak` (pure) + `getStreak` |
| `src/components/StartLessonButton.tsx` | dashboard start button (client) |
| `src/lib/speech.ts` | `speechAvailable`, `speak` (browser TTS) |
| `src/components/lesson/cards/*.tsx` | one controlled component per exercise type + `ExerciseBody` dispatcher |
| `src/components/lesson/ResultPanel.tsx` | verdict, parts, key, explanation, translation/writing feedback |
| `src/components/lesson/LessonPlayer.tsx` | state machine, progress, check/retry/next |
| `src/components/lesson/LessonResults.tsx` | results screen |
| `src/app/lesson/[id]/page.tsx`, `src/app/lesson/page.tsx` | pages |

---

### Task 1: Key-free exercise view + deterministic shuffle

**Files:**
- Create: `src/lib/lesson/shuffle.ts`, `src/lib/lesson/lessonView.ts`
- Test: `src/lib/lesson/shuffle.test.ts`, `src/lib/lesson/lessonView.test.ts`

**Interfaces:**
- Consumes: `ExerciseContent` (`src/lib/lesson/exerciseSchemas.ts`); `VALID_EXERCISES` (`src/lib/lesson/fixtures.ts`).
- Produces: `seededPermutation(seed: string, n: number): number[]`; `ExerciseView` union (below); `ViewOf<T extends ExerciseView["type"]>`; `toExerciseView(id: string, content: ExerciseContent): ExerciseView`; `TYPE_LABELS: Record<ExerciseView["type"], string>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/lesson/shuffle.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { seededPermutation } from "./shuffle";

const isPermutation = (p: number[], n: number) => p.length === n && [...p].sort((a, b) => a - b).every((v, i) => v === i);

describe("seededPermutation", () => {
  it("returns a permutation of 0..n-1", () => {
    for (const n of [0, 1, 2, 5, 9]) expect(isPermutation(seededPermutation("ex1", n), n)).toBe(true);
  });
  it("is deterministic for the same seed", () => {
    expect(seededPermutation("clx123", 6)).toEqual(seededPermutation("clx123", 6));
  });
  it("never returns the identity when n > 1", () => {
    for (let i = 0; i < 200; i++) {
      const p = seededPermutation(`seed-${i}`, 3);
      expect(p).not.toEqual([0, 1, 2]);
    }
  });
  it("differs between seeds for most inputs", () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => seededPermutation(`s${i}`, 6).join(",")));
    expect(seen.size).toBeGreaterThan(10);
  });
});
```

`src/lib/lesson/lessonView.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "./fixtures";
import { TYPE_LABELS, toExerciseView } from "./lessonView";

describe("toExerciseView", () => {
  it("keeps exactly the fields the player needs, per type", () => {
    const keys = (t: keyof typeof E) => Object.keys(toExerciseView("ex1", E[t])).sort();
    expect(keys("MULTIPLE_CHOICE")).toEqual(["id", "options", "prompt", "type"]);
    expect(keys("CLOZE_DROPDOWN")).toEqual(["gaps", "id", "text", "type"]);
    expect(keys("FILL_BLANK")).toEqual(["gaps", "id", "text", "type"]);
    expect(keys("WORD_BANK")).toEqual(["id", "tiles", "type"]);
    expect(keys("MATCH")).toEqual(["id", "left", "right", "rightOrder", "type"]);
    expect(keys("DIALOGUE_GAP")).toEqual(["id", "options", "turns", "type"]);
    expect(keys("DICTATION")).toEqual(["id", "tts", "type"]);
    expect(keys("ERROR_CORRECTION")).toEqual(["id", "tokens", "type"]);
    expect(keys("TRANSLATION")).toEqual(["hint", "id", "source", "type"]);
    expect(keys("OPEN_WRITING")).toEqual(["hint", "id", "minWords", "prompt", "type"]);
  });

  it("strips nested keys (gap answers, gap accept sets)", () => {
    expect(toExerciseView("ex1", E.CLOZE_DROPDOWN)).toMatchObject({ gaps: [{ options: ["since", "for"] }, { options: ["since", "for"] }] });
    expect(Object.keys((toExerciseView("ex1", E.CLOZE_DROPDOWN) as { gaps: object[] }).gaps[0])).toEqual(["options"]);
    expect(toExerciseView("ex1", E.FILL_BLANK)).toMatchObject({ gaps: [{ root: "BEAUTY" }] });
    expect(Object.keys((toExerciseView("ex1", E.FILL_BLANK) as { gaps: object[] }).gaps[0])).toEqual(["root"]);
  });

  it("never leaks explanations, references, rationales or accept strings", () => {
    for (const [name, content] of Object.entries(E)) {
      const json = JSON.stringify(toExerciseView("ex1", content));
      const c = content as Record<string, unknown>;
      expect(json, name).not.toContain(String(c.explain));
      if (typeof c.reference === "string") expect(json, name).not.toContain(c.reference);
      for (const r of (c.rationales as string[] | undefined) ?? []) expect(json, name).not.toContain(r);
      expect(json, name).not.toMatch(/"(answer|accept|accept_alt|rationales|explain|reference|vocab)"/);
    }
    expect(JSON.stringify(toExerciseView("ex1", E.FILL_BLANK))).not.toContain("beautiful");
    expect(JSON.stringify(toExerciseView("ex1", E.ERROR_CORRECTION))).not.toContain("doesn't");
  });

  it("uses null (not undefined) for absent optional fields so the view is serializable", () => {
    expect(toExerciseView("ex1", E.TRANSLATION)).toMatchObject({ hint: null });
    expect(toExerciseView("ex1", E.OPEN_WRITING)).toMatchObject({ hint: null, minWords: 60 });
    expect(toExerciseView("ex1", { ...E.FILL_BLANK, gaps: [{ accept: ["x"] }] } as never)).toMatchObject({ gaps: [{ root: null }] });
  });

  it("shuffles word-bank tiles and match rights deterministically, keeping an index map", () => {
    const a = toExerciseView("ex-A", E.WORD_BANK);
    expect(a).toEqual(toExerciseView("ex-A", E.WORD_BANK));
    expect(a.type === "word_bank" && [...a.tiles].sort()).toEqual(["I", "go", "goes", "to", "work"]);
    const m = toExerciseView("ex-A", E.MATCH);
    if (m.type !== "match") throw new Error("type");
    const original = ["with no money", "a person you work with", "to be honest"];
    expect(m.right).toEqual(m.rightOrder.map((k) => original[k]));
    expect(m.right).not.toEqual(original);
  });

  it("has a label for every type", () => {
    for (const content of Object.values(E)) expect(TYPE_LABELS[toExerciseView("x", content).type]).toMatch(/\w/);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/lesson/shuffle.test.ts src/lib/lesson/lessonView.test.ts` → FAIL, modules missing.

- [ ] **Step 3: Implement `src/lib/lesson/shuffle.ts`**

```ts
/** FNV-1a 32-bit hash of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG - small, fast, deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A permutation of 0..n-1 derived from `seed` (the exercise id), stable across reloads and
 * identical on server and client. Never the identity when n > 1, so the order is never the key's.
 */
export function seededPermutation(seed: string, n: number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(hash(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  if (n > 1 && p.every((v, i) => v === i)) p.push(p.shift()!);
  return p;
}
```

- [ ] **Step 4: Implement `src/lib/lesson/lessonView.ts`**

```ts
import type { ExerciseContent } from "./exerciseSchemas";
import { seededPermutation } from "./shuffle";

/** What the browser may see BEFORE answering: no keys, rationales, explanations or references. */
export type ExerciseView =
  | { id: string; type: "mcq"; prompt: string; options: string[] }
  | { id: string; type: "dialogue_gap"; turns: string[]; options: string[] }
  | { id: string; type: "cloze_mc"; text: string; gaps: { options: string[] }[] }
  | { id: string; type: "open_cloze"; text: string; gaps: { root: string | null }[] }
  | { id: string; type: "word_bank"; tiles: string[] }
  | { id: string; type: "match"; left: string[]; right: string[]; rightOrder: number[] }
  | { id: string; type: "dictation"; tts: string }
  | { id: string; type: "error_correct"; tokens: string[] }
  | { id: string; type: "translation"; source: string; hint: string | null }
  | { id: string; type: "open_writing"; prompt: string; minWords: number; hint: string | null };

export type ViewOf<T extends ExerciseView["type"]> = Extract<ExerciseView, { type: T }>;

export const TYPE_LABELS: Record<ExerciseView["type"], string> = {
  mcq: "Choose the answer",
  dialogue_gap: "Complete the dialogue",
  cloze_mc: "Choose the words",
  open_cloze: "Fill in the gaps",
  word_bank: "Build the sentence",
  match: "Match the pairs",
  dictation: "Listen and type",
  error_correct: "Find and fix the mistake",
  translation: "Translate",
  open_writing: "Write",
};

export function toExerciseView(id: string, c: ExerciseContent): ExerciseView {
  switch (c.type) {
    case "mcq":
      return { id, type: "mcq", prompt: c.prompt, options: c.options };
    case "dialogue_gap":
      return { id, type: "dialogue_gap", turns: c.turns, options: c.options };
    case "cloze_mc":
      return { id, type: "cloze_mc", text: c.text, gaps: c.gaps.map((g) => ({ options: g.options })) };
    case "open_cloze":
      return { id, type: "open_cloze", text: c.text, gaps: c.gaps.map((g) => ({ root: g.root ?? null })) };
    case "word_bank":
      return { id, type: "word_bank", tiles: seededPermutation(id, c.tokens.length).map((k) => c.tokens[k]) };
    case "match": {
      const rightOrder = seededPermutation(id, c.right.length);
      return { id, type: "match", left: c.left, right: rightOrder.map((k) => c.right[k]), rightOrder };
    }
    case "dictation":
      return { id, type: "dictation", tts: c.tts };
    case "error_correct":
      return { id, type: "error_correct", tokens: c.tokens };
    case "translation":
      return { id, type: "translation", source: c.source, hint: c.hint ?? null };
    case "open_writing":
      return { id, type: "open_writing", prompt: c.prompt, minWords: c.minWords, hint: c.hint ?? null };
  }
}
```

- [ ] **Step 5: Run to verify they pass** — PASS (10 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/shuffle.ts src/lib/lesson/shuffle.test.ts src/lib/lesson/lessonView.ts src/lib/lesson/lessonView.test.ts
git commit -m "feat(m3d): key-free exercise view with deterministic shuffle" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: MCQ rationales in the grade result

**Files:**
- Modify: `src/lib/grading/types.ts` (`GradeResult`), `src/lib/grading/checkAnswer.ts` (`buildResult`, its call in `runCheck`)
- Test: `src/lib/grading/checkAnswer.test.ts` (add one test)

**Interfaces:**
- Produces: `GradeResult.rationales?: string[]` (present only for `mcq`); `buildResult(exerciseId, explain, correctAnswer, judged, vocabCredit, rationales?: string[])`.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe("checkAnswer", ...)` in `src/lib/grading/checkAnswer.test.ts` (it reuses that file's `fakeDb`, `row`, `judge`, `now`):

```ts
  it("returns the MCQ rationales with the grade, and none for other types", async () => {
    const f = fakeDb([row("e-rat", E.MULTIPLE_CHOICE)]);
    const out = await checkAnswer("e-rat", { selected: 1 }, { db: f.db, judge, now });
    expect(out.rationales).toEqual((E.MULTIPLE_CHOICE as { rationales: string[] }).rationales);
    const g = fakeDb([row("e-norat", E.DIALOGUE_GAP)]);
    expect((await checkAnswer("e-norat", { selected: 0 }, { db: g.db, judge, now })).rationales).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/grading/checkAnswer.test.ts` → the new test FAILS (`rationales` undefined).

- [ ] **Step 3: Implement**

In `src/lib/grading/types.ts`, inside `interface GradeResult`, after `jevScores?`:

```ts
  /** MCQ only: per-option rationales, revealed after grading (never part of the pre-answer view). */
  rationales?: string[];
```

In `src/lib/grading/checkAnswer.ts`, change `buildResult`'s signature and return:

```ts
export function buildResult(
  exerciseId: string,
  explain: string,
  correctAnswer: string,
  judged: JudgeOutcome,
  vocabCredit: VocabOutcome[],
  rationales?: string[],
): GradeResult {
```

and in its returned object, after the `jevScores` spread, add `...(rationales ? { rationales } : {}),`.

In `runCheck`, pass the rationales:

```ts
  const result = buildResult(
    exerciseId, content.explain, local.correctAnswer, judged, vocabOutcomes(content, judged, vocab),
    content.type === "mcq" ? content.rationales : undefined,
  );
```

- [ ] **Step 4: Run to verify it passes** — the file's tests all PASS.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/types.ts src/lib/grading/checkAnswer.ts src/lib/grading/checkAnswer.test.ts
git commit -m "feat(m3d): return MCQ rationales with the grade" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Resume rule + loading a lesson for the player

**Files:**
- Create: `src/lib/lesson/resumable.ts`, `src/lib/lesson/loadLesson.ts`
- Modify: `src/lib/lesson/startLesson.ts` (the `existing` lookup in `runStartLesson`)
- Test: `src/lib/lesson/resumable.test.ts`, `src/lib/lesson/loadLesson.test.ts`, `src/lib/lesson/startLesson.test.ts` (update the reuse test)

**Interfaces:**
- Consumes: `toExerciseView`, `ExerciseView` (Task 1); `parseExercise` (`exerciseSchemas.ts`); `GradeResult` (`grading/types.ts`); `LessonPlan` (`createLesson.ts`); `THEMES` (`src/lib/curriculum/themes.ts`, `{key,label}`).
- Produces: `findResumableLessonId(db: Pick<PrismaClient, "lesson">, now: Date): Promise<string | null>`; `PlayerItem = { view: ExerciseView; result: GradeResult | null }`; `PlayerLesson = { lessonId: string; themeLabel: string | null; grammarTitle: string | null; items: PlayerItem[] }`; `PlayerLessonDb = Pick<PrismaClient, "lesson" | "exercise" | "grammarTopic">`; `loadLessonForPlayer(id: string, db?: PlayerLessonDb): Promise<PlayerLesson | null>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/lesson/resumable.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { findResumableLessonId } from "./resumable";

describe("findResumableLessonId", () => {
  const now = new Date(2026, 8, 25, 10, 0);

  it("asks for a PLANNED/IN_PROGRESS lesson dated today OR with an unanswered exercise, newest first", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "L1" });
    expect(await findResumableLessonId({ lesson: { findFirst } } as never, now)).toBe("L1");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        OR: [
          { date: { gte: new Date(2026, 8, 25), lt: new Date(2026, 8, 26) } },
          { exercises: { some: { answeredAt: null } } },
        ],
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { id: true },
    });
  });

  it("returns null when nothing is resumable", async () => {
    expect(await findResumableLessonId({ lesson: { findFirst: vi.fn().mockResolvedValue(null) } } as never, now)).toBeNull();
  });
});
```

`src/lib/lesson/loadLesson.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { VALID_EXERCISES as E } from "./fixtures";
import { loadLessonForPlayer, type PlayerLessonDb } from "./loadLesson";

const stored = { version: 1, exerciseId: "e2", isCorrect: true };

function fakeDb(lesson: unknown, exercises: unknown[], topic: unknown = { title: "Past Perfect (had done)", name: "RAW" }) {
  return {
    lesson: { findUnique: vi.fn().mockResolvedValue(lesson) },
    exercise: { findMany: vi.fn().mockResolvedValue(exercises) },
    grammarTopic: { findUnique: vi.fn().mockResolvedValue(topic) },
  } as unknown as PlayerLessonDb;
}
const plan = (ids: string[], grammarTopicId: string | null = "g1") => ({ sections: { written: { exerciseIds: ids } }, meta: { grammarTopicId } });

describe("loadLessonForPlayer", () => {
  it("returns null for an unknown lesson", async () => {
    expect(await loadLessonForPlayer("nope", fakeDb(null, []))).toBeNull();
  });

  it("orders items by the plan, attaches stored results, appends unplanned rows and skips missing ones", async () => {
    const db = fakeDb({ id: "L1", theme: "work", plan: plan(["e2", "ghost", "e1"]) }, [
      { id: "e1", content: E.MULTIPLE_CHOICE, result: null, answeredAt: null },
      { id: "e2", content: E.TRANSLATION, result: stored, answeredAt: new Date() },
      { id: "e3", content: E.DICTATION, result: null, answeredAt: null },
    ]);
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.items.map((i) => i.view.id)).toEqual(["e2", "e1", "e3"]);
    expect(out?.items.map((i) => i.result)).toEqual([stored, null, null]);
    expect(out).toMatchObject({ lessonId: "L1", themeLabel: "Work & careers", grammarTitle: "Past Perfect (had done)" });
  });

  it("skips exercises whose content does not parse", async () => {
    const db = fakeDb({ id: "L1", theme: null, plan: plan(["e1", "bad"], null) }, [
      { id: "e1", content: E.MULTIPLE_CHOICE, result: null, answeredAt: null },
      { id: "bad", content: { type: "mcq", prompt: "?" }, result: null, answeredAt: null },
    ]);
    const out = await loadLessonForPlayer("L1", db);
    expect(out?.items.map((i) => i.view.id)).toEqual(["e1"]);
    expect(out).toMatchObject({ themeLabel: null, grammarTitle: null });
  });

  it("ignores a stored result when answeredAt is not set", async () => {
    const db = fakeDb({ id: "L1", theme: null, plan: plan(["e1"]) }, [{ id: "e1", content: E.MULTIPLE_CHOICE, result: stored, answeredAt: null }]);
    expect((await loadLessonForPlayer("L1", db))?.items[0].result).toBeNull();
  });

  it("falls back to the raw topic name when the topic is not enriched", async () => {
    const db = fakeDb({ id: "L1", theme: null, plan: plan([]) }, [], { title: null, name: "RAW NAME" });
    expect((await loadLessonForPlayer("L1", db))?.grammarTitle).toBe("RAW NAME");
  });
});
```

In `src/lib/lesson/startLesson.test.ts`, replace the whole test `it("reuses today's PLANNED/IN_PROGRESS lesson without generating", ...)` with:

```ts
  it("reuses a resumable lesson (today's, or an older one with unanswered exercises) without generating", async () => {
    const f = fakeDb({ id: "L1" });
    expect(await startLesson({ db: f.db, generation, now })).toEqual({ lessonId: "L1", reused: true });
    expect(generateLesson).not.toHaveBeenCalled();
    const where = f.findFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["PLANNED", "IN_PROGRESS"] });
    expect(where.OR).toEqual([
      { date: { gte: new Date(2026, 8, 18), lt: new Date(2026, 8, 19) } },
      { exercises: { some: { answeredAt: null } } },
    ]);
  });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/lesson/resumable.test.ts src/lib/lesson/loadLesson.test.ts src/lib/lesson/startLesson.test.ts` → the two new files fail (modules missing), the updated startLesson test fails (`where.OR` undefined).

- [ ] **Step 3: Implement `src/lib/lesson/resumable.ts`**

```ts
import type { PrismaClient } from "@prisma/client";

/**
 * The lesson "Start" should open instead of generating a new one (owner decision, M3d): the newest
 * PLANNED/IN_PROGRESS lesson dated today, or of any date while it still has an unanswered exercise.
 */
export async function findResumableLessonId(db: Pick<PrismaClient, "lesson">, now: Date): Promise<string | null> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const found = await db.lesson.findFirst({
    where: {
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      OR: [{ date: { gte: dayStart, lt: dayEnd } }, { exercises: { some: { answeredAt: null } } }],
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return found?.id ?? null;
}
```

- [ ] **Step 4: Use it in `src/lib/lesson/startLesson.ts`**

Add `import { findResumableLessonId } from "./resumable";` and, in `runStartLesson`, replace the `dayStart`/`dayEnd` constants and the `const existing = await db.lesson.findFirst({...}); if (existing) return ...;` block with:

```ts
  const existingId = await findResumableLessonId(db, now);
  if (existingId) return { lessonId: existingId, reused: true };
```

Update the doc comment of `startLesson` from "Idempotent per local calendar day." to "Resumes an unfinished lesson (any date) or today's; otherwise generates one."

- [ ] **Step 5: Implement `src/lib/lesson/loadLesson.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { THEMES } from "../curriculum/themes";
import { prisma } from "../db";
import type { GradeResult } from "../grading/types";
import type { LessonPlan } from "./createLesson";
import { parseExercise } from "./exerciseSchemas";
import { toExerciseView, type ExerciseView } from "./lessonView";

export type PlayerLessonDb = Pick<PrismaClient, "lesson" | "exercise" | "grammarTopic">;

export interface PlayerItem {
  view: ExerciseView;
  result: GradeResult | null;
}

export interface PlayerLesson {
  lessonId: string;
  themeLabel: string | null;
  grammarTitle: string | null;
  items: PlayerItem[];
}

/** Everything the player page needs, with no answer keys (only stored results of answered items). */
export async function loadLessonForPlayer(id: string, db: PlayerLessonDb = prisma as unknown as PlayerLessonDb): Promise<PlayerLesson | null> {
  const lesson = await db.lesson.findUnique({ where: { id }, select: { id: true, theme: true, plan: true } });
  if (!lesson) return null;
  const plan = lesson.plan as unknown as Partial<LessonPlan> | null;

  const rows = await db.exercise.findMany({
    where: { lessonId: id },
    select: { id: true, content: true, result: true, answeredAt: true },
    orderBy: { id: "asc" },
  });
  const planned = plan?.sections?.written?.exerciseIds ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [
    ...planned.flatMap((pid) => (byId.has(pid) ? [byId.get(pid)!] : [])),
    ...rows.filter((r) => !planned.includes(r.id)),
  ];

  const items: PlayerItem[] = [];
  for (const r of ordered) {
    const parsed = parseExercise(r.content);
    if (!parsed.ok) continue;
    items.push({ view: toExerciseView(r.id, parsed.content), result: r.answeredAt ? (r.result as unknown as GradeResult) : null });
  }

  const topicId = plan?.meta?.grammarTopicId ?? null;
  const topic = topicId ? await db.grammarTopic.findUnique({ where: { id: topicId }, select: { title: true, name: true } }) : null;

  return {
    lessonId: lesson.id,
    themeLabel: THEMES.find((t) => t.key === lesson.theme)?.label ?? null,
    grammarTitle: topic ? (topic.title ?? topic.name) : null,
    items,
  };
}
```

- [ ] **Step 6: Run to verify they pass** — all three files PASS (and the rest of `startLesson.test.ts` still passes).

- [ ] **Step 7: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/resumable.ts src/lib/lesson/resumable.test.ts src/lib/lesson/loadLesson.ts src/lib/lesson/loadLesson.test.ts src/lib/lesson/startLesson.ts src/lib/lesson/startLesson.test.ts
git commit -m "feat(m3d): resume unfinished lessons and load a lesson for the player" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: Day streak + dashboard start button

**Files:**
- Create: `src/lib/stats/streak.ts`, `src/components/StartLessonButton.tsx`
- Modify: `src/app/page.tsx`, `src/app/page.test.tsx`
- Test: `src/lib/stats/streak.test.ts`, `src/components/StartLessonButton.test.tsx`

**Interfaces:**
- Produces: `computeStreak(dates: Date[], now: Date): { days: number; atRisk: boolean }`; `STREAK_WINDOW_DAYS = 400`; `getStreak(db?: Pick<PrismaClient, "exercise">, now?: Date): Promise<{ days: number; atRisk: boolean } | null>`; `<StartLessonButton />`.

- [ ] **Step 1: Write the failing tests**

`src/lib/stats/streak.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { computeStreak, getStreak } from "./streak";

const now = new Date(2026, 8, 25, 9, 0); // local
const d = (day: number, h = 12) => new Date(2026, 8, day, h, 0);

describe("computeStreak", () => {
  it("is 0 with no answers", () => expect(computeStreak([], now)).toEqual({ days: 0, atRisk: false }));
  it("counts consecutive days ending today", () => {
    expect(computeStreak([d(25), d(24), d(23), d(21)], now)).toEqual({ days: 3, atRisk: false });
  });
  it("counts from yesterday and marks it at risk when today has no answer yet", () => {
    expect(computeStreak([d(24), d(23)], now)).toEqual({ days: 2, atRisk: true });
  });
  it("is 0 when the last answer was before yesterday", () => {
    expect(computeStreak([d(22), d(21)], now)).toEqual({ days: 0, atRisk: false });
  });
  it("uses local day boundaries and ignores duplicates", () => {
    expect(computeStreak([new Date(2026, 8, 25, 0, 0), new Date(2026, 8, 24, 23, 59), d(24, 8), d(24, 9)], now)).toEqual({ days: 2, atRisk: false });
  });
});

describe("getStreak", () => {
  it("reads answeredAt of the last 400 days", async () => {
    const findMany = vi.fn().mockResolvedValue([{ answeredAt: d(25) }]);
    expect(await getStreak({ exercise: { findMany } } as never, now)).toEqual({ days: 1, atRisk: false });
    expect(findMany).toHaveBeenCalledWith({
      where: { answeredAt: { gte: new Date(2026, 8, 25 - 400) } },
      select: { answeredAt: true },
    });
  });
  it("getStreak returns null when the DB fails", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("connection refused"));
    expect(await getStreak({ exercise: { findMany } } as never, now)).toBeNull();
  });
});
```

`src/components/StartLessonButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { StartLessonButton } from "./StartLessonButton";

beforeEach(() => push.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("StartLessonButton", () => {
  it("starts the lesson and navigates to it", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    render(<StartLessonButton />);
    fireEvent.click(screen.getByRole("button", { name: /start today's lesson/i }));
    expect(screen.getByRole("button", { name: /preparing your lesson/i })).toBeDisabled();
    expect(fetch).toHaveBeenCalledWith("/api/lesson/start", { method: "POST" });
    resolve(new Response(JSON.stringify({ lessonId: "L7", reused: false }), { status: 200 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/lesson/L7"));
  });

  it("shows the server error and lets the learner try again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Lesson generation failed" }), { status: 502 })));
    render(<StartLessonButton />);
    fireEvent.click(screen.getByRole("button", { name: /start today's lesson/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lesson generation failed");
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});
```

In `src/app/page.test.tsx`, add these mocks next to the existing `vi.mock("@/lib/curriculum/progress", ...)`:

```tsx
vi.mock("@/lib/stats/streak", () => ({ getStreak: vi.fn().mockResolvedValue({ days: 4, atRisk: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
```

and add to the existing test's assertions:

```tsx
    expect(screen.getByText(/4 days/i)).toBeInTheDocument();
    expect(screen.getByText(/answer one exercise today to keep it/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/stats/streak.test.ts src/components/StartLessonButton.test.tsx src/app/page.test.tsx` → FAIL.

- [ ] **Step 3: Implement `src/lib/stats/streak.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";

export const STREAK_WINDOW_DAYS = 400;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * A day counts if it has at least one answer (local time). The streak is the run of counted days
 * ending today; if today has no answer yet, the run ending yesterday - still alive, but at risk.
 */
export function computeStreak(dates: Date[], now: Date): { days: number; atRisk: boolean } {
  const counted = new Set(dates.map(dayKey));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let atRisk = false;
  if (!counted.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!counted.has(dayKey(cursor))) return { days: 0, atRisk: false };
    atRisk = true;
  }
  let days = 0;
  while (counted.has(dayKey(cursor))) {
    days++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days, atRisk };
}

/** Streak for the dashboard; null if the DB is unreachable (the page still renders). */
export async function getStreak(
  db: Pick<PrismaClient, "exercise"> = prisma as unknown as Pick<PrismaClient, "exercise">,
  now: Date = new Date(),
): Promise<{ days: number; atRisk: boolean } | null> {
  try {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - STREAK_WINDOW_DAYS);
    const rows = await db.exercise.findMany({ where: { answeredAt: { gte: since } }, select: { answeredAt: true } });
    return computeStreak(rows.flatMap((r) => (r.answeredAt ? [r.answeredAt] : [])), now);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement `src/components/StartLessonButton.tsx`**

```tsx
"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Starts (or resumes) the lesson. Generation can take 1-3 minutes; the route single-flights it. */
export function StartLessonButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson/start", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { lessonId?: string; error?: string };
      if (!res.ok || !body.lessonId) throw new Error(body.error ?? `Request failed (${res.status})`);
      router.push(`/lesson/${body.lessonId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 font-display font-bold text-on-primary disabled:opacity-40"
      >
        {pending && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden />}
        {pending ? "Preparing your lesson..." : error ? "Try again" : "Start today's lesson"}
      </button>
      {pending && <p className="text-sm text-muted-foreground">This can take a couple of minutes.</p>}
      {error && (
        <p role="alert" className="max-w-sm text-right text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update `src/app/page.tsx`**

Replace the static `<button ...>Start today&apos;s lesson</button>` with `<StartLessonButton />`, change the header to `className="mb-6 flex items-start justify-between gap-4"`, load the streak and render it:

```tsx
import { StartLessonButton } from "@/components/StartLessonButton";
import { getStreak } from "@/lib/stats/streak";
// ...
export default async function DashboardPage() {
  const progress = await getSyllabusProgress();
  const streak = await getStreak();
  // ... header with <StartLessonButton />, then:
          <Card title="Streak">
            <p className={`flex items-center gap-2 text-2xl font-bold tabular-nums ${streak?.atRisk ? "text-warning" : "text-success"}`}>
              <Flame size={24} aria-hidden /> {streak ? `${streak.days} ${streak.days === 1 ? "day" : "days"}` : "-"}
            </p>
            {streak?.atRisk && <p className="mt-1 text-sm text-muted-foreground">Answer one exercise today to keep it.</p>}
          </Card>
```

(Sequential awaits — do not wrap the two loaders in `Promise.all`.) Note the existing page test asserts `getByRole("button", { name: /start today's lesson/i })` — it still matches.

- [ ] **Step 6: Run to verify they pass** — the three files PASS.

- [ ] **Step 7: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/stats/streak.ts src/lib/stats/streak.test.ts src/components/StartLessonButton.tsx src/components/StartLessonButton.test.tsx src/app/page.tsx src/app/page.test.tsx
git commit -m "feat(m3d): day streak on the dashboard and a working start button" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 5: Card contract + choice cards (mcq, dialogue_gap, cloze_mc)

**Files:**
- Create: `src/components/lesson/cards/types.ts`, `src/components/lesson/cards/OptionList.tsx`, `src/components/lesson/cards/ChoiceCard.tsx`, `src/components/lesson/cards/DialogueCard.tsx`, `src/components/lesson/cards/ClozeSelectCard.tsx`, `src/lib/lesson/clozeParts.ts`
- Test: `src/components/lesson/cards/choiceCards.test.tsx`, `src/lib/lesson/clozeParts.test.ts`

**Interfaces:**
- Consumes: `ViewOf` (Task 1); `Answer` (`src/lib/grading/types.ts`); `GradeResult`.
- Produces:
  - `AnswerPayload` = an M3c answer without its `type` tag (`{selected}`, `{selected: number[]}`, `{text: string[]}`, `{tokens}`, `{pairs}`, `{text}`, `{index, fix}`), `PayloadOf<T>`;
  - `CardProps<T> = { view: ViewOf<T>; disabled: boolean; result: GradeResult | null; onChange: (answer: PayloadOf<T> | null) => void }` — `null` = incomplete; cards keep their own input state (the player remounts a card per exercise with `key={view.id}`);
  - `splitGaps(text: string): string[]` (text split at `___`; `n` gaps → `n + 1` segments);
  - components `ChoiceCard` (mcq), `DialogueCard` (dialogue_gap), `ClozeSelectCard` (cloze_mc).

- [ ] **Step 1: Write the failing tests**

`src/lib/lesson/clozeParts.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitGaps } from "./clozeParts";

describe("splitGaps", () => {
  it("splits at every gap", () => {
    expect(splitGaps("I have worked here ___ 2019, ___ five years.")).toEqual(["I have worked here ", " 2019, ", " five years."]);
    expect(splitGaps("___ starts")).toEqual(["", " starts"]);
    expect(splitGaps("no gap")).toEqual(["no gap"]);
  });
});
```

`src/components/lesson/cards/choiceCards.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { toExerciseView, type ViewOf } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import type { GradeResult } from "@/lib/grading/types";
import { ChoiceCard } from "./ChoiceCard";
import { DialogueCard } from "./DialogueCard";
import { ClozeSelectCard } from "./ClozeSelectCard";

const mcq = toExerciseView("e1", E.MULTIPLE_CHOICE) as ViewOf<"mcq">;
const dialogue = toExerciseView("e2", E.DIALOGUE_GAP) as ViewOf<"dialogue_gap">;
const cloze = toExerciseView("e3", E.CLOZE_DROPDOWN) as ViewOf<"cloze_mc">;
const graded = (given: string, expected: string, isCorrect = false) =>
  ({ isCorrect, parts: [{ correct: isCorrect, given, expected }] }) as unknown as GradeResult;

describe("ChoiceCard", () => {
  it("emits {selected} for the clicked option and shows the prompt", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText(mcq.prompt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: 1 });
    expect(screen.getByRole("radio", { name: /had finished/ })).toBeChecked();
  });

  it("selects with number keys 1-5", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled={false} result={null} onChange={onChange} />);
    fireEvent.keyDown(window, { key: "3" });
    expect(onChange).toHaveBeenLastCalledWith({ selected: 2 });
  });

  it("ignores clicks and keys when disabled, and marks the chosen and the correct option after grading", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled result={graded("finishing", "had finished")} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /finish$/ }));
    fireEvent.keyDown(window, { key: "1" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /had finished/ })).toHaveAccessibleDescription(/correct answer/i);
  });
});

describe("DialogueCard", () => {
  it("shows the turns and emits {selected}", () => {
    const onChange = vi.fn();
    render(<DialogueCard view={dialogue} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText("A: Sorry I am late.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /no worries/i }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: 0 });
  });
});

describe("ClozeSelectCard", () => {
  it("emits null until every gap is chosen, then {selected: [...]}", () => {
    const onChange = vi.fn();
    render(<ClozeSelectCard view={cloze} disabled={false} result={null} onChange={onChange} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(selects[1], { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith({ selected: [0, 1] });
    expect(selects[0]).toHaveAccessibleName("Gap 1");
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/lesson/clozeParts.test.ts src/components/lesson/cards/choiceCards.test.tsx` → FAIL, modules missing.

- [ ] **Step 3: Implement the contract and helpers**

`src/components/lesson/cards/types.ts`:

```ts
import type { Answer, GradeResult } from "@/lib/grading/types";
import type { ExerciseView, ViewOf } from "@/lib/lesson/lessonView";

type Tag = ExerciseView["type"];

/** The request body `answer` of POST /api/exercise/check for type T (an M3c Answer without its tag). */
export type PayloadOf<T extends Tag> = Omit<Extract<Answer, { type: T }>, "type">;
export type AnswerPayload = { [K in Tag]: PayloadOf<K> }[Tag];

export interface CardProps<T extends Tag> {
  view: ViewOf<T>;
  /** true while checking and after grading */
  disabled: boolean;
  result: GradeResult | null;
  /** null = the answer is not complete yet */
  onChange: (answer: PayloadOf<T> | null) => void;
}
```

`src/lib/lesson/clozeParts.ts`:

```ts
/** Split a gapped text at every "___"; n gaps give n + 1 segments. */
export function splitGaps(text: string): string[] {
  return text.split("___");
}
```

`src/components/lesson/cards/OptionList.tsx`:

```tsx
"use client";

import { Check } from "lucide-react";
import { useEffect, useId } from "react";

interface Props {
  options: string[];
  selected: number | null;
  disabled: boolean;
  /** option text marked as the key after grading (from GradeResult.parts[0].expected) */
  correctText: string | null;
  onSelect: (index: number) => void;
  label: string;
}

/** Radio-group of big option buttons; number keys 1-5 pick an option when focus is not in a field. */
export function OptionList({ options, selected, disabled, correctText, onSelect, label }: Props) {
  const hintId = useId();

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) onSelect(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, options.length, onSelect]);

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      <span id={hintId} className="sr-only">
        Correct answer
      </span>
      {options.map((opt, i) => {
        const isKey = correctText !== null && opt === correctText;
        const isChosen = selected === i;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={isChosen}
            aria-describedby={isKey ? hintId : undefined}
            disabled={disabled}
            onClick={() => onSelect(i)}
            className={[
              "flex min-h-11 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
              isKey ? "border-success bg-surface-2" : isChosen ? "border-primary bg-surface-2" : "border-border bg-surface hover:bg-surface-2",
              disabled ? "cursor-default" : "",
            ].join(" ")}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm tabular-nums">{i + 1}</span>
            <span className="flex-1">{opt}</span>
            {isKey && <Check size={18} className="text-success" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
```

`src/components/lesson/cards/ChoiceCard.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { OptionList } from "./OptionList";
import type { CardProps } from "./types";

export function ChoiceCard({ view, disabled, result, onChange }: CardProps<"mcq">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = useCallback(
    (i: number) => {
      setSelected(i);
      onChange({ selected: i });
    },
    [onChange],
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg">{view.prompt}</p>
      <OptionList
        label="Options"
        options={view.options}
        selected={selected}
        disabled={disabled}
        correctText={result?.parts[0]?.expected ?? null}
        onSelect={select}
      />
    </div>
  );
}
```

`src/components/lesson/cards/DialogueCard.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { OptionList } from "./OptionList";
import type { CardProps } from "./types";

export function DialogueCard({ view, disabled, result, onChange }: CardProps<"dialogue_gap">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = useCallback(
    (i: number) => {
      setSelected(i);
      onChange({ selected: i });
    },
    [onChange],
  );
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2" aria-label="Dialogue">
        {view.turns.map((t, i) => {
          const isGap = t.includes("___");
          return (
            <li
              key={i}
              className={`max-w-[85%] rounded-2xl px-4 py-2 ${i % 2 === 0 ? "self-start bg-surface-2" : "self-end border border-primary bg-surface"} ${isGap ? "font-semibold" : ""}`}
            >
              {t}
            </li>
          );
        })}
      </ol>
      <OptionList
        label="Replies"
        options={view.options}
        selected={selected}
        disabled={disabled}
        correctText={result?.parts[0]?.expected ?? null}
        onSelect={select}
      />
    </div>
  );
}
```

`src/components/lesson/cards/ClozeSelectCard.tsx`:

```tsx
"use client";

import { Fragment, useState } from "react";
import { splitGaps } from "@/lib/lesson/clozeParts";
import type { CardProps } from "./types";

export function ClozeSelectCard({ view, disabled, onChange }: CardProps<"cloze_mc">) {
  const [values, setValues] = useState<(number | null)[]>(() => view.gaps.map(() => null));
  const segments = splitGaps(view.text);

  function set(i: number, raw: string) {
    const next = values.map((v, j) => (j === i ? (raw === "" ? null : Number(raw)) : v));
    setValues(next);
    onChange(next.every((v) => v !== null) ? { selected: next as number[] } : null);
  }

  return (
    <p className="text-lg leading-loose">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg}
          {i < view.gaps.length && (
            <select
              aria-label={`Gap ${i + 1}`}
              value={values[i] ?? ""}
              disabled={disabled}
              onChange={(e) => set(i, e.target.value)}
              className="mx-1 min-h-11 rounded-xl border border-border bg-surface px-3 py-1 font-semibold"
            >
              <option value="">...</option>
              {view.gaps[i].options.map((o, k) => (
                <option key={k} value={k}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </Fragment>
      ))}
    </p>
  );
}
```

- [ ] **Step 4: Run to verify they pass** — PASS (6 tests). If `toHaveAccessibleDescription` does not pick up the `aria-describedby` in jsdom, assert `toHaveAttribute("aria-describedby")` on the key option instead and report it.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/components/lesson/cards src/lib/lesson/clozeParts.ts src/lib/lesson/clozeParts.test.ts
git commit -m "feat(m3d): card contract and choice cards (mcq, dialogue, cloze dropdown)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 6: Typed cards (open_cloze, dictation, error_correct, translation, open_writing)

**Files:**
- Create: `src/lib/speech.ts`, `src/components/lesson/cards/FillBlankCard.tsx`, `src/components/lesson/cards/DictationCard.tsx`, `src/components/lesson/cards/ErrorCorrectCard.tsx`, `src/components/lesson/cards/FreeTextCard.tsx`
- Test: `src/components/lesson/cards/typedCards.test.tsx`

**Interfaces:**
- Consumes: `CardProps`, `splitGaps` (Task 5); `ViewOf` (Task 1).
- Produces: `speechAvailable(): boolean`, `speak(text: string): boolean`; `FillBlankCard` (open_cloze), `DictationCard`, `ErrorCorrectCard`, `TranslationCard` and `WritingCard` (both exported from `FreeTextCard.tsx`); `TRANSLATION_MAX = 500`; free-text cards accept an optional `onSubmit?: () => void` prop that `Ctrl/Cmd+Enter` calls.

- [ ] **Step 1: Write the failing test** (`src/components/lesson/cards/typedCards.test.tsx`)

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { toExerciseView, type ViewOf } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import { FillBlankCard } from "./FillBlankCard";
import { DictationCard } from "./DictationCard";
import { ErrorCorrectCard } from "./ErrorCorrectCard";
import { TranslationCard, WritingCard } from "./FreeTextCard";

afterEach(() => vi.unstubAllGlobals());
const v = <T,>(id: string, c: unknown) => toExerciseView(id, c as never) as T;

describe("FillBlankCard", () => {
  it("shows the root word and emits {text: [...]} once a gap is filled", () => {
    const onChange = vi.fn();
    render(<FillBlankCard view={v<ViewOf<"open_cloze">>("e1", E.FILL_BLANK)} disabled={false} result={null} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: /gap 1/i });
    expect(screen.getByText(/\(BEAUTY\)/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "   " } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: "beautiful" } });
    expect(onChange).toHaveBeenLastCalledWith({ text: ["beautiful"] });
  });
});

describe("DictationCard", () => {
  it("speaks the sentence on Play and emits {text}", () => {
    const speakSpy = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak: speakSpy, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; lang = ""; rate = 1; voice = null; constructor(t: string) { this.text = t; } });
    const onChange = vi.fn();
    render(<DictationCard view={v<ViewOf<"dictation">>("e1", E.DICTATION)} disabled={false} result={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy.mock.calls[0][0].text).toBe("I'd like a coffee, please.");
    expect(speakSpy.mock.calls[0][0].rate).toBe(0.9);
    expect(screen.queryByText("I'd like a coffee, please.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "I'd like a coffee" } });
    expect(onChange).toHaveBeenLastCalledWith({ text: "I'd like a coffee" });
  });

  it("says when audio is unavailable but still accepts typing", () => {
    const onChange = vi.fn();
    render(<DictationCard view={v<ViewOf<"dictation">>("e1", E.DICTATION)} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText(/audio isn't available/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    expect(onChange).toHaveBeenLastCalledWith({ text: "x" });
  });
});

describe("ErrorCorrectCard", () => {
  it("needs a picked token and a fix; the fix field starts with the token", () => {
    const onChange = vi.fn();
    render(<ErrorCorrectCard view={v<ViewOf<"error_correct">>("e1", E.ERROR_CORRECTION)} disabled={false} result={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "don't" }));
    const fix = screen.getByRole("textbox", { name: /correction/i });
    expect(fix).toHaveValue("don't");
    expect(onChange).toHaveBeenLastCalledWith({ index: 1, fix: "don't" });
    fireEvent.change(fix, { target: { value: "doesn't" } });
    expect(onChange).toHaveBeenLastCalledWith({ index: 1, fix: "doesn't" });
    fireEvent.change(fix, { target: { value: " " } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "don't" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("TranslationCard / WritingCard", () => {
  it("translation: shows the Russian source, caps at 500 characters and emits {text}", () => {
    const onChange = vi.fn();
    render(<TranslationCard view={v<ViewOf<"translation">>("e1", E.TRANSLATION)} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText((E.TRANSLATION as { source: string }).source)).toBeInTheDocument();
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("maxLength", "500");
    fireEvent.change(box, { target: { value: "I finished it." } });
    expect(onChange).toHaveBeenLastCalledWith({ text: "I finished it." });
    expect(screen.getByText("14 / 500")).toBeInTheDocument();
  });

  it("writing: counts words against the minimum", () => {
    const onChange = vi.fn();
    render(<WritingCard view={v<ViewOf<"open_writing">>("e1", E.OPEN_WRITING)} disabled={false} result={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "one two  three" } });
    expect(screen.getByText("3 / 60 words")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ text: "one two  three" });
  });

  it("Enter adds a newline, Ctrl+Enter submits", () => {
    const onSubmit = vi.fn();
    render(<WritingCard view={v<ViewOf<"open_writing">>("e1", E.OPEN_WRITING)} disabled={false} result={null} onChange={vi.fn()} onSubmit={onSubmit} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/lesson/cards/typedCards.test.tsx` → FAIL.

- [ ] **Step 3: Implement `src/lib/speech.ts`**

```ts
/** Browser text-to-speech for dictation (Kokoro replaces it in M5). */
export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

export function speak(text: string): boolean {
  if (!speechAvailable()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new window.SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang === "en-GB") ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-GB";
  u.rate = 0.9;
  synth.speak(u);
  return true;
}
```

- [ ] **Step 4: Implement the cards**

`src/components/lesson/cards/FillBlankCard.tsx`:

```tsx
"use client";

import { Fragment, useState } from "react";
import { splitGaps } from "@/lib/lesson/clozeParts";
import type { CardProps } from "./types";

export function FillBlankCard({ view, disabled, onChange }: CardProps<"open_cloze">) {
  const [values, setValues] = useState<string[]>(() => view.gaps.map(() => ""));
  const segments = splitGaps(view.text);

  function set(i: number, value: string) {
    const next = values.map((v, j) => (j === i ? value : v));
    setValues(next);
    onChange(next.some((v) => v.trim() !== "") ? { text: next } : null);
  }

  return (
    <p className="text-lg leading-loose">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg}
          {i < view.gaps.length && (
            <input
              type="text"
              aria-label={`Gap ${i + 1}`}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={values[i]}
              disabled={disabled}
              onChange={(e) => set(i, e.target.value)}
              className="mx-1 min-h-11 w-40 border-b-2 border-primary bg-transparent px-1 text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </Fragment>
      ))}
    </p>
  );
}
```

(The root word is already part of `view.text`, e.g. "It was a ___ (BEAUTY) day.", so it renders next to the gap.)

`src/components/lesson/cards/DictationCard.tsx`:

```tsx
"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { speak, speechAvailable } from "@/lib/speech";
import type { CardProps } from "./types";

export function DictationCard({ view, disabled, onChange }: CardProps<"dictation">) {
  const [text, setText] = useState("");
  const [played, setPlayed] = useState(false);
  const [canSpeak, setCanSpeak] = useState(true);
  useEffect(() => setCanSpeak(speechAvailable()), []);

  return (
    <div className="flex flex-col gap-4">
      {canSpeak ? (
        <button
          type="button"
          onClick={() => setPlayed(speak(view.tts) || played)}
          className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-primary px-4 py-2 font-semibold text-primary"
        >
          <Volume2 size={20} aria-hidden /> {played ? "Play again" : "Play"}
        </button>
      ) : (
        <p className="text-sm text-warning">Audio isn&apos;t available in this browser.</p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Type what you hear</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() ? { text: e.target.value } : null);
          }}
          className="min-h-11 rounded-xl border border-border bg-surface px-3 py-2"
        />
      </label>
    </div>
  );
}
```

`src/components/lesson/cards/ErrorCorrectCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { CardProps } from "./types";

export function ErrorCorrectCard({ view, disabled, onChange }: CardProps<"error_correct">) {
  const [index, setIndex] = useState<number | null>(null);
  const [fix, setFix] = useState("");

  function emit(i: number | null, f: string) {
    onChange(i !== null && f.trim() ? { index: i, fix: f } : null);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Tap the wrong word, then type the correction.</p>
      <p className="flex flex-wrap gap-2 text-lg">
        {view.tokens.map((t, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={index === i}
            disabled={disabled}
            onClick={() => {
              setIndex(i);
              setFix(t);
              emit(i, t);
            }}
            className={`min-h-11 rounded-xl border px-3 py-1 ${index === i ? "border-danger bg-surface-2 line-through" : "border-border bg-surface hover:bg-surface-2"}`}
          >
            {t}
          </button>
        ))}
      </p>
      {index !== null && (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Correction</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={fix}
            disabled={disabled}
            onChange={(e) => {
              setFix(e.target.value);
              emit(index, e.target.value);
            }}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 py-2"
          />
        </label>
      )}
    </div>
  );
}
```

`src/components/lesson/cards/FreeTextCard.tsx`:

```tsx
"use client";

import { useState, type KeyboardEvent } from "react";
import type { CardProps } from "./types";

export const TRANSLATION_MAX = 500;
const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface SubmitProp {
  /** Ctrl/Cmd+Enter; plain Enter inserts a newline */
  onSubmit?: () => void;
}

function useFreeText(onChange: (a: { text: string } | null) => void, onSubmit?: () => void) {
  const [text, setText] = useState("");
  return {
    text,
    onTextChange: (value: string) => {
      setText(value);
      onChange(value.trim() ? { text: value } : null);
    },
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSubmit?.();
      }
    },
  };
}

const boxClass = "min-h-32 w-full rounded-xl border border-border bg-surface px-3 py-2 leading-relaxed";

export function TranslationCard({ view, disabled, onChange, onSubmit }: CardProps<"translation"> & SubmitProp) {
  const t = useFreeText(onChange, onSubmit);
  return (
    <div className="flex flex-col gap-3">
      <p lang="ru" className="text-lg">{view.source}</p>
      {view.hint && <p className="text-sm text-muted-foreground">Hint: {view.hint}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Your translation</span>
        <textarea value={t.text} maxLength={TRANSLATION_MAX} disabled={disabled} onChange={(e) => t.onTextChange(e.target.value)} onKeyDown={t.onKeyDown} className={boxClass} />
      </label>
      <p className="self-end text-sm tabular-nums text-muted-foreground">{t.text.length} / {TRANSLATION_MAX}</p>
    </div>
  );
}

export function WritingCard({ view, disabled, onChange, onSubmit }: CardProps<"open_writing"> & SubmitProp) {
  const t = useFreeText(onChange, onSubmit);
  const words = countWords(t.text);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg">{view.prompt}</p>
      {view.hint && <p className="text-sm text-muted-foreground">Hint: {view.hint}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Your text</span>
        <textarea value={t.text} disabled={disabled} onChange={(e) => t.onTextChange(e.target.value)} onKeyDown={t.onKeyDown} className={`${boxClass} min-h-48`} />
      </label>
      <p className={`self-end text-sm tabular-nums ${words >= view.minWords ? "text-success" : "text-muted-foreground"}`}>
        {words} / {view.minWords} words
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes** — PASS (7 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/speech.ts src/components/lesson/cards/FillBlankCard.tsx src/components/lesson/cards/DictationCard.tsx src/components/lesson/cards/ErrorCorrectCard.tsx src/components/lesson/cards/FreeTextCard.tsx src/components/lesson/cards/typedCards.test.tsx
git commit -m "feat(m3d): typed cards - fill blank, dictation, error correction, translation, writing" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 7: Tile cards (word_bank, match) + card dispatcher

**Files:**
- Create: `src/components/lesson/cards/WordBankCard.tsx`, `src/components/lesson/cards/MatchCard.tsx`, `src/components/lesson/cards/ExerciseBody.tsx`
- Test: `src/components/lesson/cards/tileCards.test.tsx`

**Interfaces:**
- Consumes: `CardProps`, `AnswerPayload` (Task 5); all card components (Tasks 5–6); `ExerciseView` (Task 1).
- Produces: `WordBankCard`, `MatchCard`; `ExerciseBody({ view, disabled, result, onChange, onSubmit }: { view: ExerciseView; disabled: boolean; result: GradeResult | null; onChange: (a: AnswerPayload | null) => void; onSubmit: () => void })` — renders the right card for `view.type`.

- [ ] **Step 1: Write the failing test** (`src/components/lesson/cards/tileCards.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { toExerciseView, type ViewOf } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import { WordBankCard } from "./WordBankCard";
import { MatchCard } from "./MatchCard";
import { ExerciseBody } from "./ExerciseBody";

const bank = toExerciseView("wb1", E.WORD_BANK) as ViewOf<"word_bank">;
const match = toExerciseView("m1", E.MATCH) as ViewOf<"match">;

describe("WordBankCard", () => {
  it("moves tiles into the answer tray and back, emitting {tokens}", () => {
    const onChange = vi.fn();
    render(<WordBankCard view={bank} disabled={false} result={null} onChange={onChange} />);
    const pool = screen.getByRole("group", { name: /word tiles/i });
    const tray = screen.getByRole("group", { name: /your sentence/i });
    for (const w of ["I", "go", "to", "work"]) fireEvent.click(within(pool).getByRole("button", { name: w }));
    expect(onChange).toHaveBeenLastCalledWith({ tokens: ["I", "go", "to", "work"] });
    fireEvent.click(within(tray).getByRole("button", { name: "go" }));
    expect(onChange).toHaveBeenLastCalledWith({ tokens: ["I", "to", "work"] });
    expect(within(pool).getByRole("button", { name: "go" })).toBeInTheDocument();
    for (const w of ["I", "to", "work"]) fireEvent.click(within(tray).getByRole("button", { name: w }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("MatchCard", () => {
  const rightIdx = (text: string) => match.right.indexOf(text);
  const pickPair = (l: string, r: string) => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${l}`) }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${r}`) }));
  };

  it("pairs left and right, sending ORIGINAL right indices once every left is paired", () => {
    const onChange = vi.fn();
    render(<MatchCard view={match} disabled={false} result={null} onChange={onChange} />);
    pickPair("frankly", "to be honest");
    pickPair("broke", "with no money");
    expect(onChange).toHaveBeenLastCalledWith(null);
    pickPair("colleague", "a person you work with");
    expect(onChange).toHaveBeenLastCalledWith({ pairs: [2, 0, 1] });
    expect(match.rightOrder[rightIdx("to be honest")]).toBe(2);
  });

  it("moves a right item that is already paired", () => {
    const onChange = vi.fn();
    render(<MatchCard view={match} disabled={false} result={null} onChange={onChange} />);
    pickPair("frankly", "with no money");
    pickPair("broke", "with no money");
    pickPair("frankly", "to be honest");
    pickPair("colleague", "a person you work with");
    expect(onChange).toHaveBeenLastCalledWith({ pairs: [2, 0, 1] });
  });

  it("undoes a pair when its left item is clicked again", () => {
    const onChange = vi.fn();
    render(<MatchCard view={match} disabled={false} result={null} onChange={onChange} />);
    pickPair("frankly", "to be honest");
    pickPair("broke", "with no money");
    pickPair("colleague", "a person you work with");
    fireEvent.click(screen.getByRole("button", { name: /^frankly/ }));
    fireEvent.click(screen.getByRole("button", { name: /^frankly/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("ExerciseBody", () => {
  it("renders the card for every exercise type", () => {
    for (const [name, content] of Object.entries(E)) {
      const { unmount, container } = render(
        <ExerciseBody view={toExerciseView("x-" + name, content)} disabled={false} result={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
      );
      expect(container.firstChild, name).not.toBeNull();
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, modules missing.

- [ ] **Step 3: Implement `src/components/lesson/cards/WordBankCard.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { CardProps } from "./types";

const tile = "min-h-11 rounded-xl border px-3 py-1 font-semibold motion-safe:transition-transform motion-safe:active:scale-95";

/** Tiles are tracked by index into view.tiles so duplicate words stay distinct. */
export function WordBankCard({ view, disabled, onChange }: CardProps<"word_bank">) {
  const [tray, setTray] = useState<number[]>([]);

  function update(next: number[]) {
    setTray(next);
    onChange(next.length ? { tokens: next.map((k) => view.tiles[k]) } : null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Your sentence" className="flex min-h-16 flex-wrap gap-2 rounded-xl border-2 border-dashed border-border p-3">
        {tray.length === 0 && <span className="text-muted-foreground">Tap the words in order</span>}
        {tray.map((k, pos) => (
          <button key={k} type="button" disabled={disabled} onClick={() => update(tray.filter((_, p) => p !== pos))} className={`${tile} border-primary bg-surface-2`}>
            {view.tiles[k]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Word tiles" className="flex flex-wrap gap-2">
        {view.tiles.map((w, k) =>
          tray.includes(k) ? null : (
            <button key={k} type="button" disabled={disabled} onClick={() => update([...tray, k])} className={`${tile} border-border bg-surface hover:bg-surface-2`}>
              {w}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/components/lesson/cards/MatchCard.tsx`**

```tsx
"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import type { CardProps } from "./types";

/** pairs[i] = displayed right index for left i; sent as ORIGINAL right indices via view.rightOrder. */
export function MatchCard({ view, disabled, onChange }: CardProps<"match">) {
  const [pairs, setPairs] = useState<(number | null)[]>(() => view.left.map(() => null));
  const [active, setActive] = useState<number | null>(null);

  function update(next: (number | null)[]) {
    setPairs(next);
    onChange(next.every((p) => p !== null) ? { pairs: next.map((k) => view.rightOrder[k as number]) } : null);
  }

  function clickLeft(i: number) {
    if (pairs[i] !== null && active === i) {
      update(pairs.map((p, j) => (j === i ? null : p)));
      setActive(null);
      return;
    }
    setActive(i);
  }

  function clickRight(k: number) {
    if (active === null) return;
    update(pairs.map((p, j) => (j === active ? k : p === k ? null : p)));
    setActive(null);
  }

  const btn = "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left";
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2" aria-label="Words">
        {view.left.map((l, i) => (
          <button key={i} type="button" disabled={disabled} aria-pressed={active === i} onClick={() => clickLeft(i)}
            className={`${btn} ${active === i ? "border-primary bg-surface-2" : pairs[i] !== null ? "border-primary bg-surface" : "border-border bg-surface"}`}>
            <span>{l}</span>
            {pairs[i] !== null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Link2 size={14} aria-hidden /> {pairs[i]! + 1}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2" aria-label="Meanings">
        {view.right.map((r, k) => {
          const owner = pairs.indexOf(k);
          return (
            <button key={k} type="button" disabled={disabled || active === null} onClick={() => clickRight(k)}
              className={`${btn} ${owner >= 0 ? "border-primary bg-surface" : "border-border bg-surface"} disabled:opacity-100`}>
              <span>{r}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{k + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Note: a right button's accessible name is `"<text> <number>"`, hence the tests match right items with `^text`. Right buttons are disabled until a left item is active (so clicks without a selected left do nothing); `disabled:opacity-100` keeps them readable.

- [ ] **Step 5: Implement `src/components/lesson/cards/ExerciseBody.tsx`**

```tsx
"use client";

import type { GradeResult } from "@/lib/grading/types";
import type { ExerciseView } from "@/lib/lesson/lessonView";
import { ChoiceCard } from "./ChoiceCard";
import { ClozeSelectCard } from "./ClozeSelectCard";
import { DialogueCard } from "./DialogueCard";
import { DictationCard } from "./DictationCard";
import { ErrorCorrectCard } from "./ErrorCorrectCard";
import { FillBlankCard } from "./FillBlankCard";
import { TranslationCard, WritingCard } from "./FreeTextCard";
import { MatchCard } from "./MatchCard";
import type { AnswerPayload } from "./types";
import { WordBankCard } from "./WordBankCard";

interface Props {
  view: ExerciseView;
  disabled: boolean;
  result: GradeResult | null;
  onChange: (answer: AnswerPayload | null) => void;
  onSubmit: () => void;
}

export function ExerciseBody({ view, disabled, result, onChange, onSubmit }: Props) {
  const common = { disabled, result, onChange: onChange as never };
  switch (view.type) {
    case "mcq":
      return <ChoiceCard view={view} {...common} />;
    case "dialogue_gap":
      return <DialogueCard view={view} {...common} />;
    case "cloze_mc":
      return <ClozeSelectCard view={view} {...common} />;
    case "open_cloze":
      return <FillBlankCard view={view} {...common} />;
    case "word_bank":
      return <WordBankCard view={view} {...common} />;
    case "match":
      return <MatchCard view={view} {...common} />;
    case "dictation":
      return <DictationCard view={view} {...common} />;
    case "error_correct":
      return <ErrorCorrectCard view={view} {...common} />;
    case "translation":
      return <TranslationCard view={view} {...common} onSubmit={onSubmit} />;
    case "open_writing":
      return <WritingCard view={view} {...common} onSubmit={onSubmit} />;
  }
}
```

- [ ] **Step 6: Run to verify it passes** — PASS (5 tests).

- [ ] **Step 7: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/components/lesson/cards/WordBankCard.tsx src/components/lesson/cards/MatchCard.tsx src/components/lesson/cards/ExerciseBody.tsx src/components/lesson/cards/tileCards.test.tsx
git commit -m "feat(m3d): word bank and match cards, card dispatcher" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 8: Result panel

**Files:**
- Create: `src/components/lesson/ResultPanel.tsx`
- Modify: `tailwind.config.ts` (a `pop` keyframe/animation)
- Test: `src/components/lesson/ResultPanel.test.tsx`

**Interfaces:**
- Consumes: `GradeResult`, `WritingCorrection` (`src/lib/grading/types.ts`); `ExerciseView["type"]`.
- Produces: `ResultPanel({ result, type }: { result: GradeResult; type: ExerciseView["type"] })`.

- [ ] **Step 1: Write the failing test** (`src/components/lesson/ResultPanel.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GradeResult } from "@/lib/grading/types";
import { ResultPanel } from "./ResultPanel";

const base: GradeResult = {
  version: 1, exerciseId: "e1", isCorrect: false, parts: [{ correct: false, given: "finishing", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Past Perfect shows an earlier past action.", feedback: null, gradedBy: "local", vocabCredit: [],
};

describe("ResultPanel", () => {
  it("shows a wrong verdict with icon text, the key and the explanation open", () => {
    render(<ResultPanel result={base} type="mcq" />);
    expect(screen.getByRole("status")).toHaveTextContent(/not quite/i);
    expect(screen.getByText(/correct answer:/i).parentElement).toHaveTextContent("had finished");
    expect(screen.getByText(base.explain)).toBeVisible();
  });

  it("shows a correct verdict with the explanation collapsed", () => {
    render(<ResultPanel result={{ ...base, isCorrect: true, parts: [{ correct: true, given: "had finished", expected: "had finished" }] }} type="mcq" />);
    expect(screen.getByRole("status")).toHaveTextContent(/correct/i);
    expect(screen.getByText("Why?").closest("details")).not.toHaveAttribute("open");
  });

  it("notes an accepted variant", () => {
    render(<ResultPanel result={{ ...base, isCorrect: true, gradedBy: "jev", correctAnswer: "It was a beautiful day.", parts: [{ correct: true, given: "lovely", expected: "beautiful" }] }} type="open_cloze" />);
    expect(screen.getByText(/accepted - the key was: it was a beautiful day\./i)).toBeInTheDocument();
  });

  it("lists parts when there is more than one", () => {
    render(<ResultPanel result={{ ...base, parts: [{ correct: true, given: "since", expected: "since" }, { correct: false, given: "since", expected: "for" }] }} type="cloze_mc" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent(/you: since/i);
    expect(items[1]).toHaveTextContent(/answer: for/i);
  });

  it("shows MCQ rationales", () => {
    render(<ResultPanel result={{ ...base, rationales: ["base form", "correct: completed before a past moment"] }} type="mcq" />);
    expect(screen.getByText("base form")).toBeInTheDocument();
  });

  it("shows translation feedback", () => {
    render(<ResultPanel result={{ ...base, feedback: { corrected: "I finished the report.", explanation: "Use the article.", category: "grammar" } }} type="translation" />);
    expect(screen.getByText(/better:/i).parentElement).toHaveTextContent("I finished the report.");
    expect(screen.getByText("Use the article.")).toBeInTheDocument();
  });

  it("shows writing feedback with severity as text and hides the empty key", () => {
    render(
      <ResultPanel
        result={{ ...base, correctAnswer: "", parts: [{ correct: false, given: "t", expected: "" }], feedback: {
          summary: "Clear text with one tense slip.", wordCount: 64,
          corrections: [{ original: "I have a meeting yesterday", corrected: "I had a meeting yesterday", explanation: "Past simple for yesterday.", category: "grammar", severity: "major", relatesToFocus: false }],
        } }}
        type="open_writing"
      />,
    );
    expect(screen.getByText("Clear text with one tense slip.")).toBeInTheDocument();
    expect(screen.getByText("major")).toBeInTheDocument();
    expect(screen.getByText(/64 words/)).toBeInTheDocument();
    expect(screen.queryByText(/correct answer:/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module missing.

- [ ] **Step 3: Add the animation to `tailwind.config.ts`** — inside `theme.extend`:

```ts
      keyframes: {
        pop: { "0%": { transform: "scale(0.6)", opacity: "0" }, "70%": { transform: "scale(1.15)", opacity: "1" }, "100%": { transform: "scale(1)" } },
      },
      animation: { pop: "pop 300ms ease-out" },
```

- [ ] **Step 4: Implement `src/components/lesson/ResultPanel.tsx`**

```tsx
import { CheckCircle2, XCircle } from "lucide-react";
import type { GradeResult, WritingCorrection } from "@/lib/grading/types";
import type { ExerciseView } from "@/lib/lesson/lessonView";

const SEVERITY_CLASS: Record<WritingCorrection["severity"], string> = {
  minor: "border-border text-muted-foreground",
  moderate: "border-warning text-warning",
  major: "border-danger text-danger",
};

export function ResultPanel({ result, type }: { result: GradeResult; type: ExerciseView["type"] }) {
  const ok = result.isCorrect;
  const fb = result.feedback;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-2 p-4">
      <p role="status" className={`flex items-center gap-2 font-display text-lg font-bold ${ok ? "text-success" : "text-danger"}`}>
        {ok ? <CheckCircle2 size={24} className="motion-safe:animate-pop" aria-hidden /> : <XCircle size={24} aria-hidden />}
        {ok ? "Correct" : "Not quite"}
      </p>

      {result.parts.length > 1 && (
        <ul className="flex flex-col gap-1 text-sm">
          {result.parts.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              {p.correct ? <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden /> : <XCircle size={16} className="shrink-0 text-danger" aria-hidden />}
              <span className="sr-only">{p.correct ? "Correct:" : "Wrong:"}</span>
              <span>you: {p.given || "-"}</span>
              {!p.correct && <span className="text-muted-foreground">· answer: {p.expected}</span>}
            </li>
          ))}
        </ul>
      )}

      {ok && result.gradedBy === "jev" && result.correctAnswer && (
        <p className="text-sm text-muted-foreground">Accepted - the key was: {result.correctAnswer}</p>
      )}
      {!ok && result.correctAnswer && type !== "open_writing" && (
        <p>
          <span className="font-semibold">Correct answer:</span> {result.correctAnswer}
        </p>
      )}

      {type === "translation" && fb?.corrected && (
        <div className="flex flex-col gap-1">
          <p><span className="font-semibold">Better:</span> {fb.corrected}</p>
          {fb.explanation && <p className="text-sm">{fb.explanation}</p>}
        </div>
      )}

      {type === "open_writing" && fb && (
        <div className="flex flex-col gap-2">
          {fb.summary && <p>{fb.summary}</p>}
          {typeof fb.wordCount === "number" && <p className="text-sm tabular-nums text-muted-foreground">{fb.wordCount} words</p>}
          {fb.corrections && fb.corrections.length > 0 && (
            <ol className="flex flex-col gap-2">
              {fb.corrections.map((k, i) => (
                <li key={i} className="rounded-xl border border-border bg-surface p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="line-through">{k.original}</span>
                    <span aria-hidden>-&gt;</span>
                    <span className="font-semibold">{k.corrected}</span>
                    <span className={`rounded-full border px-2 text-xs ${SEVERITY_CLASS[k.severity]}`}>{k.severity}</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">{k.explanation}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {result.rationales && result.rationales.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {result.rationales.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {result.explain && (
        <details open={!ok} className="text-sm">
          <summary className="cursor-pointer font-semibold">Why?</summary>
          <p className="mt-1">{result.explain}</p>
        </details>
      )}
    </div>
  );
}
```

Note: the parts list and the rationales list both render `listitem`s; the test "lists parts" uses a result without rationales, so it sees exactly 2.

- [ ] **Step 5: Run to verify it passes** — PASS (7 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/components/lesson/ResultPanel.tsx src/components/lesson/ResultPanel.test.tsx tailwind.config.ts
git commit -m "feat(m3d): result panel with verdict, key, explanation and feedback" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 9: Lesson player + results screen

**Files:**
- Create: `src/components/lesson/LessonPlayer.tsx`, `src/components/lesson/LessonResults.tsx`
- Test: `src/components/lesson/LessonPlayer.test.tsx`

**Interfaces:**
- Consumes: `PlayerLesson`, `PlayerItem` (Task 3); `ExerciseBody`, `AnswerPayload` (Tasks 5–7); `ResultPanel` (Task 8); `TYPE_LABELS` (Task 1).
- Produces: `LessonPlayer({ lesson }: { lesson: PlayerLesson })`; `LessonResults({ items }: { items: PlayerItem[] })`.

- [ ] **Step 1: Write the failing test** (`src/components/lesson/LessonPlayer.test.tsx`)

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toExerciseView } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import type { PlayerLesson } from "@/lib/lesson/loadLesson";
import type { GradeResult } from "@/lib/grading/types";
import { LessonPlayer } from "./LessonPlayer";

afterEach(() => vi.unstubAllGlobals());

const grade = (exerciseId: string, isCorrect: boolean): GradeResult => ({
  version: 1, exerciseId, isCorrect, parts: [{ correct: isCorrect, given: "x", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Because.", feedback: null, gradedBy: "local", vocabCredit: [],
});
const lesson = (results: (GradeResult | null)[]): PlayerLesson => ({
  lessonId: "L1", themeLabel: "Work & careers", grammarTitle: "Past Perfect (had done)",
  items: [
    { view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: results[0] },
    { view: toExerciseView("e2", E.DIALOGUE_GAP), result: results[1] },
  ],
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("LessonPlayer", () => {
  it("starts at the first unanswered exercise and shows progress", () => {
    render(<LessonPlayer lesson={lesson([grade("e1", true), null])} />);
    expect(screen.getByText("Exercise 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("A: Sorry I am late.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("checks, shows the result, then moves on and ends on the results screen", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ ...grade("e1", false), alreadyAnswered: false }))
      .mockResolvedValueOnce(ok({ ...grade("e2", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    const check = screen.getByRole("button", { name: "Check" });
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /finishing/ }));
    fireEvent.click(check);
    expect(fetchMock).toHaveBeenCalledWith("/api/exercise/check", expect.objectContaining({ method: "POST", body: JSON.stringify({ exerciseId: "e1", answer: { selected: 2 } }) }));
    expect(await screen.findByText(/not quite/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: /no worries/i }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
    expect(screen.getByText("1 of 2 correct")).toBeInTheDocument();
  });

  it("sends one request when Check is clicked twice", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(screen.getByRole("button", { name: /checking/i }));
    fireEvent.submit(screen.getByRole("button", { name: /checking/i }).closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(ok({ ...grade("e1", true), alreadyAnswered: false }));
    await screen.findByText("Correct");
  });

  it("keeps the answer after a 502 and succeeds on Try again", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Translation feedback failed" }), { status: 502 }))
      .mockResolvedValueOnce(ok({ ...grade("e1", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't check right now/i);
    expect(screen.getByRole("radio", { name: /had finished/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByText("Correct");
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ exerciseId: "e1", answer: { selected: 1 } }));
  });

  it("shows the results screen directly when every exercise is answered", () => {
    render(<LessonPlayer lesson={lesson([grade("e1", true), grade("e2", true)])} />);
    expect(screen.getByText("2 of 2 correct")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
  });

  it("says so when the lesson has no exercises", () => {
    render(<LessonPlayer lesson={{ ...lesson([]), items: [] }} />);
    expect(screen.getByText(/this lesson has no exercises/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, modules missing.

- [ ] **Step 3: Implement `src/components/lesson/LessonResults.tsx`**

```tsx
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import type { PlayerItem } from "@/lib/lesson/loadLesson";
import { TYPE_LABELS } from "@/lib/lesson/lessonView";
import { ResultPanel } from "./ResultPanel";

function Ring({ value, total }: { value: number; total: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const share = total ? value / total : 0;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      <circle cx="48" cy="48" r={r} fill="none" strokeWidth="10" className="stroke-surface-2" />
      <circle cx="48" cy="48" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-success"
        strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 48 48)" />
    </svg>
  );
}

export function LessonResults({ items }: { items: PlayerItem[] }) {
  const correct = items.filter((i) => i.result?.isCorrect).length;
  return (
    <section className="flex flex-col gap-6" aria-labelledby="results-title">
      <div className="flex items-center gap-4">
        <Ring value={correct} total={items.length} />
        <div>
          <h2 id="results-title" className="font-display text-2xl font-extrabold">Written block done</h2>
          <p className="text-lg tabular-nums">{correct} of {items.length} correct</p>
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {items.map(({ view, result }) => (
          <li key={view.id} className="rounded-card border border-border bg-surface p-3">
            <details>
              <summary className="flex cursor-pointer items-center gap-2">
                {result?.isCorrect ? <CheckCircle2 size={18} className="text-success" aria-hidden /> : <XCircle size={18} className="text-danger" aria-hidden />}
                <span className="sr-only">{result?.isCorrect ? "Correct:" : "Wrong:"}</span>
                <span className="font-semibold">{TYPE_LABELS[view.type]}</span>
              </summary>
              {result && <div className="mt-3"><ResultPanel result={result} type={view.type} /></div>}
            </details>
          </li>
        ))}
      </ol>
      <Link href="/" className="flex min-h-11 items-center justify-center self-start rounded-xl bg-primary px-5 py-3 font-display font-bold text-on-primary">
        Back to dashboard
      </Link>
    </section>
  );
}
```

- [ ] **Step 4: Implement `src/components/lesson/LessonPlayer.tsx`**

```tsx
"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { GradeResult } from "@/lib/grading/types";
import type { PlayerItem, PlayerLesson } from "@/lib/lesson/loadLesson";
import { TYPE_LABELS } from "@/lib/lesson/lessonView";
import { ExerciseBody } from "./cards/ExerciseBody";
import type { AnswerPayload } from "./cards/types";
import { LessonResults } from "./LessonResults";
import { ResultPanel } from "./ResultPanel";

type Phase = "answering" | "checking" | "graded" | "error";

const firstOpen = (items: PlayerItem[]) => {
  const i = items.findIndex((it) => it.result === null);
  return i === -1 ? items.length : i;
};

export function LessonPlayer({ lesson }: { lesson: PlayerLesson }) {
  const [items, setItems] = useState(lesson.items);
  const [index, setIndex] = useState(() => firstOpen(lesson.items));
  const [phase, setPhase] = useState<Phase>("answering");
  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), [index]);

  const current = items[index];
  const answered = items.filter((i) => i.result !== null).length;

  const check = useCallback(async () => {
    if (!current || !answer || checking.current || phase === "graded") return;
    checking.current = true;
    setPhase("checking");
    setError(null);
    try {
      const res = await fetch("/api/exercise/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: current.view.id, answer }),
      });
      const body = (await res.json().catch(() => ({}))) as GradeResult & { error?: string };
      if (!res.ok) {
        setError(res.status === 502 ? "Couldn't check right now - your answer is kept." : body.error ?? `Request failed (${res.status})`);
        setPhase("error");
        return;
      }
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, result: body } : it)));
      setPhase("graded");
    } catch {
      setError("Couldn't check right now - your answer is kept.");
      setPhase("error");
    } finally {
      checking.current = false;
    }
  }, [answer, current, index, phase]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void check();
  }

  function next() {
    const after = items.findIndex((it, i) => i > index && it.result === null);
    setIndex(after === -1 ? items.length : after);
    setAnswer(null);
    setPhase("answering");
    setError(null);
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground">This lesson has no exercises.</p>;
  }

  const header = (
    <header className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{[lesson.themeLabel, lesson.grammarTitle].filter(Boolean).join(" · ")}</p>
      <div role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={answered}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-success motion-safe:transition-transform" style={{ width: `${(answered / items.length) * 100}%` }} />
      </div>
    </header>
  );

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <LessonResults items={items} />
      </div>
    );
  }

  const graded = phase === "graded" && current.result;
  const isLast = items.findIndex((it, i) => i > index && it.result === null) === -1;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm">
        <p className="text-sm tabular-nums text-muted-foreground">Exercise {index + 1} of {items.length}</p>
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold outline-none">{TYPE_LABELS[current.view.type]}</h2>
        <ExerciseBody
          key={current.view.id}
          view={current.view}
          disabled={phase === "checking" || phase === "graded"}
          result={graded ? current.result : null}
          onChange={setAnswer}
          onSubmit={() => void check()}
        />
        <div aria-live="polite">{graded && <ResultPanel result={current.result!} type={current.view.type} />}</div>
        {phase === "error" && error && (
          <p role="alert" className="text-danger">{error}</p>
        )}
        {graded ? (
          <button type="button" autoFocus onClick={next}
            className="min-h-11 self-end rounded-xl bg-primary px-6 py-3 font-display font-bold text-on-primary">
            {isLast ? "See results" : "Next"}
          </button>
        ) : (
          <button type="submit" disabled={!answer || phase === "checking"}
            className="flex min-h-11 items-center gap-2 self-end rounded-xl bg-primary px-6 py-3 font-display font-bold text-on-primary disabled:opacity-40">
            {phase === "checking" && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden />}
            {phase === "checking" ? "Checking..." : phase === "error" ? "Try again" : "Check"}
          </button>
        )}
      </form>
    </div>
  );
}
```

Notes for the implementer:
- `checking` (a ref) blocks a second request even before React re-renders — that is what the "clicked twice" test pins; do not rely on the disabled attribute alone.
- `ExerciseBody` is keyed by exercise id, so a new card starts empty; after a 502 the same card stays mounted and keeps its input (`Try again` re-submits the kept `answer`).
- `onChange={setAnswer}` is stable, so `OptionList`'s key listener does not re-subscribe on each render.

- [ ] **Step 5: Run to verify it passes** — PASS (6 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/components/lesson/LessonPlayer.tsx src/components/lesson/LessonResults.tsx src/components/lesson/LessonPlayer.test.tsx
git commit -m "feat(m3d): lesson player state machine and results screen" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 10: Pages + docs

**Files:**
- Create: `src/app/lesson/[id]/page.tsx`, `src/app/lesson/page.tsx`, `src/app/lesson/[id]/page.test.tsx`
- Modify: `SPEC.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `loadLessonForPlayer` (Task 3), `findResumableLessonId` (Task 3), `LessonPlayer` (Task 9), `SideNav` (`src/components/nav.tsx`), `StartLessonButton` (Task 4), `prisma` (`src/lib/db.ts`).

- [ ] **Step 1: Write the failing test** (`src/app/lesson/[id]/page.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/lesson/loadLesson", () => ({ loadLessonForPlayer: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }), useRouter: () => ({ push: vi.fn() }) }));

import { loadLessonForPlayer } from "@/lib/lesson/loadLesson";
import { toExerciseView } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import LessonPage from "./page";

describe("/lesson/[id]", () => {
  it("renders the player for a known lesson", async () => {
    vi.mocked(loadLessonForPlayer).mockResolvedValue({
      lessonId: "L1", themeLabel: "Work & careers", grammarTitle: null,
      items: [{ view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: null }],
    });
    render(await LessonPage({ params: Promise.resolve({ id: "L1" }) }));
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("Exercise 1 of 1")).toBeInTheDocument();
    expect(loadLessonForPlayer).toHaveBeenCalledWith("L1");
  });

  it("404s for an unknown lesson", async () => {
    vi.mocked(loadLessonForPlayer).mockResolvedValue(null);
    await expect(LessonPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL, module missing.

- [ ] **Step 3: Implement `src/app/lesson/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { SideNav } from "@/components/nav";
import { LessonPlayer } from "@/components/lesson/LessonPlayer";
import { loadLessonForPlayer } from "@/lib/lesson/loadLesson";

export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lesson = await loadLessonForPlayer(id);
  if (!lesson) notFound();
  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto w-full max-w-2xl p-4 md:p-6">
        <LessonPlayer lesson={lesson} />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/lesson/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { SideNav } from "@/components/nav";
import { StartLessonButton } from "@/components/StartLessonButton";
import { prisma } from "@/lib/db";
import { findResumableLessonId } from "@/lib/lesson/resumable";

export const dynamic = "force-dynamic";

/** Nav target "Lesson": open the lesson in progress, or offer to start one. */
export default async function LessonIndexPage() {
  const id = await findResumableLessonId(prisma, new Date());
  if (id) redirect(`/lesson/${id}`);
  return (
    <div className="md:flex">
      <SideNav />
      <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 p-6">
        <h1 className="font-display text-2xl font-extrabold">No lesson in progress</h1>
        <StartLessonButton />
      </main>
    </div>
  );
}
```

(`redirect` must stay outside any try/catch — it works by throwing.)

- [ ] **Step 5: Run to verify it passes** — PASS (2 tests); `npm run build` passes (the new pages are dynamic and never touch the DB at build time).

- [ ] **Step 6: Docs**

- `SPEC.md` §API `POST /api/lesson/start`: replace "idempotent per local calendar day: reuses today's `PLANNED`/`IN_PROGRESS` lesson" with: resumes a lesson instead of generating one while a `PLANNED`/`IN_PROGRESS` lesson is dated today **or has an unanswered exercise (any date)** — the newest such lesson; returns `{lessonId, reused: true}`.
- `SPEC.md` §API `POST /api/exercise/check`: add that the result carries `rationales` (MCQ only), revealed after grading.
- `SPEC.md` §Pages `/lesson/[id]`: M3d scope — written block only (no section stepper yet), one card at a time, progress bar, Check → result panel → Next, results screen; keys never sent before an answer is recorded (key-free `ExerciseView`); reload resumes at the first unanswered exercise; dictation uses browser `speechSynthesis` until Kokoro (M5). `/lesson` redirects to the resumable lesson. Dashboard streak rule: a day counts with ≥ 1 answer (local time); streak ends today, or yesterday marked "at risk".
- `CLAUDE.md`: Milestone status — `M3d ✅` line (player, cards, streak; spec pointer `docs/superpowers/specs/2026-09-25-m3d-lesson-player-design.md`), remove "M3d exercise player - not started"; Dev guidelines current branch → `feature/m3d-player`.

- [ ] **Step 7: Verify and commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git add "src/app/lesson" SPEC.md CLAUDE.md
git commit -m "feat(m3d): lesson pages; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 11: Live play-through, design pass, restore (⛔ owner review gate)

**Files:**
- Modify (only if the design pass or the play-through finds defects): files under `src/components/lesson/`, `src/components/StartLessonButton.tsx`, `src/app/`
- No new tests unless a defect needs one (TDD for any behaviour fix).

- [ ] **Step 1: Snapshot the lesson** (non-interactive psql from `.pgsql/`, user `postgres`, db `english_trainer`). Let `L` = the resumable lesson id (`SELECT id FROM "Lesson" WHERE status IN ('PLANNED','IN_PROGRESS') ORDER BY date DESC, id DESC LIMIT 1;`). Record: its status, the count of answered exercises (expect 0), `SELECT count(*) FROM "ErrorRecord" WHERE "lessonId"='L';` (expect 0), and `CREATE TABLE _m3d_vocab_snapshot AS SELECT id, status, "correctStreak", "lastSeenAt" FROM "VocabItem" WHERE id IN (SELECT jsonb_array_elements_text(plan->'meta'->'vocabIds') FROM "Lesson" WHERE id='L');`.

- [ ] **Step 2: Play it in a real browser.** Start `npm run dev` in the background (store its PID in a variable NOT named `$pid`). Open `http://localhost:3000`. If a browser-automation tool is available to you, use it; otherwise ask the controller to have the owner play. Check:
  - dashboard → **Start today's lesson** opens `/lesson/L` immediately (resumed, no generation);
  - every card type present in the lesson can be answered with mouse **and** keyboard only (Tab / Space / Enter / number keys);
  - a wrong and a correct answer each show the right panel; **Next**; reload mid-lesson resumes at the first unanswered card; the results screen appears at the end;
  - light and dark theme (`<html class="dark">` via DevTools), width 375 px: no horizontal scroll, touch targets ≥ 44 px, focus rings visible;
  - dashboard streak shows `1 day` after answering.
  Record findings with screenshots or precise notes.

- [ ] **Step 3: Design pass.** Invoke the `frontend-design` skill (if it is available in your environment) on the player, cards, result panel and results screen, scoped to polish that respects `docs/DESIGN.md` (tokens, Nunito/Inter, gamified-but-adult). `ui-ux-pro-max` and `emil-design-eng` are not installed — walk `docs/DESIGN.md` §8 checklist item by item instead and record pass/fail per item. Fix defects with the smallest change; keep all tests green; add a test for any behaviour change.

- [ ] **Step 4: Restore the lesson.** Stop only the dev server you started (confirm port 3000 is free). Then:
  `UPDATE "Exercise" SET "userAnswer"=NULL, "isCorrect"=NULL, feedback=NULL, result=NULL, "answeredAt"=NULL WHERE "lessonId"='L'; DELETE FROM "ErrorRecord" WHERE "lessonId"='L'; UPDATE "Lesson" SET status='PLANNED' WHERE id='L'; UPDATE "VocabItem" v SET status=s.status, "correctStreak"=s."correctStreak", "lastSeenAt"=s."lastSeenAt" FROM _m3d_vocab_snapshot s WHERE v.id=s.id; DROP TABLE _m3d_vocab_snapshot;`
  Prove it: lesson `PLANNED`, 0 exercises with `answeredAt`/`feedback`/`result`, 0 ErrorRecords, vocab rows equal to the snapshot values printed in Step 1. Note: the streak goes back to 0 as a consequence (it is computed from `answeredAt`).

- [ ] **Step 5: Commit any fixes**

```powershell
npx tsc --noEmit; npm test; npm run build
git add <changed files>
git commit -m "fix(m3d): polish from the live play-through and design pass" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

**⛔ GATE:** the controller presents the play-through findings, the §8 checklist and screenshots to the owner; the owner plays the lesson themselves and accepts before the final branch review.
