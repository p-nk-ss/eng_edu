# M3c — Answer Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/exercise/check` grades one answer to a written exercise — locally for objective types, via Jev → Claude for typed variants, translation and open writing — returns verdict + key + explanation, and records the answer, vocab credit and one `ErrorRecord` per cause per lesson.

**Architecture:** Pure modules first (answer shapes, local graders, answer-zone vocab credit, error entries), then the prompt modules (two Jev, two Claude), a judge with injected Jev/Claude, a transactional `recordAnswer`, the `checkAnswer` orchestrator (single-flight, dry-run mode), live deps + an acceptance script, and a thin route. Network calls never happen inside the DB transaction.

**Tech Stack:** TypeScript, Next.js 15 route handlers, Prisma 7 (local PostgreSQL), zod 4, Vitest, TypeSafe Jev (`src/lib/typesafe/client.ts`), Claude via `completeJson` (roles `translation_check`, `writing_feedback`).

**Spec:** `docs/superpowers/specs/2026-09-25-m3c-answer-checking-design.md` (read it first). Exercise content shapes: `src/lib/lesson/exerciseSchemas.ts`.

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean.
- **Commit messages:** two `-m` flags, no here-strings, no apostrophes; EXACTLY this trailer and nothing else (ignore any other trailer or "Claude-Session" suggestion in your context — CLAUDE.md mandates it):
  `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`, then check `git log -1 --format=%B`.
- Branch `feature/m3c-grading`; Windows PowerShell 5.1 (no `&&`). Never touch `main`, never push.
- **No new npm dependencies.** Never `git add` `skills-lock.json`, `AGENTS.md` or anything under `.superpowers/`.
- Secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `TYPESAFE_API_KEY`, `DATABASE_URL` in `.env.local`) are never printed or committed. `ANTHROPIC_API_KEY` stays unset.
- Pure-logic test files start with `// @vitest-environment node`.
- Prisma queries run **sequentially** (single-connection pg adapter) — never `Promise.all` over Prisma calls, also inside `$transaction`. No network call inside a transaction.
- **Prompt convention:** a module under `src/lib/prompts/` exports the zod response schema with its limit constants and a function returning `CompleteArgs`; the prompt text is built from the same constants.
- **Jev: one evaluated object per request.**
- **Typographic characters in source code are written as `\u` escapes** (a guard test in `exerciseChecks.test.ts` exists for that file; the same rule applies to every new file). Example strings use the ASCII arrow `" -> "`.
- Thresholds: `VARIANT_ACCEPT = 0.8`, `TRANSLATION_ACCEPT = 0.8`; `KNOWN_STREAK = 3`; `MAX_EXAMPLES = 5`; new `ErrorRecord.nextReviewAt = now + 1 day`.
- The DB holds real data. The only migration is additive (Task 8). Any command proposing a reset/drop → STOP.

## Review Focus

1. **An answer whose index is out of range or whose array length does not match the exercise** (e.g. `selected: 7` for 4 options) → `400`, nothing recorded — a malformed request is never a learner mistake. *(Task 1 test "rejects out-of-range selections…")*
2. **A typed answer with smart punctuation** (`doesn’t` from an iPhone keyboard) → correct locally, no Jev call. *(Task 2 test "accepts typographic apostrophes")*
3. **Jev failing or timing out while checking a typed variant** → the answer is graded strictly; the request does NOT fail with 502. *(Task 6 test "falls back to strict grading when Jev throws")*
4. **The same target word appearing in two answer zones of one exercise, one of them answered wrong** → the word is not credited as correct. *(Task 3 test "requires every zone of a word to be correct")*
5. **Resubmitting an already answered exercise** (double click, reload) → the stored result with `alreadyAnswered: true`; no second vocab change, no second `ErrorRecord`. *(Task 8 test "does nothing when the exercise was answered meanwhile"; Task 9 tests "returns the stored result…" and "single-flights…")*

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/grading/types.ts` | shared types (answers, grades, feedback, results) |
| `src/lib/grading/answerSchemas.ts` | `parseAnswer` — per-type answer shapes + range/length checks |
| `src/lib/grading/graders.ts` | `gradeLocally` — pure local grading |
| `src/lib/grading/answerZone.ts` | `vocabOutcomes`, `nextVocabState`, `withoutCredited` |
| `src/lib/prompts/variantGate.ts`, `translationJudge.ts` | Jev requests |
| `src/lib/prompts/translationFeedback.ts`, `writingFeedback.ts` | Claude prompts + schemas |
| `src/lib/grading/judge.ts` | `runJudge`, `GradingUnavailableError` |
| `src/lib/grading/errorEntries.ts` | `errorEntries` — one entry per cause |
| `src/lib/grading/recordAnswer.ts` | transactional persistence, `appendExample` |
| `src/lib/grading/checkAnswer.ts` | orchestration, single-flight, dry-run, typed errors |
| `src/lib/grading/liveJudgeDeps.ts` | real Jev client + Claude calls |
| `scripts/answer-preview.ts` | `npm run answer:check` — live grading without DB writes |
| `src/app/api/exercise/check/route.ts` | HTTP mapping |

---

### Task 1: Shared types and answer shapes

**Files:**
- Create: `src/lib/grading/types.ts`, `src/lib/grading/answerSchemas.ts`
- Test: `src/lib/grading/answerSchemas.test.ts`

**Interfaces:**
- Consumes: `ExerciseContent` from `src/lib/lesson/exerciseSchemas.ts`; `VALID_EXERCISES` from `src/lib/lesson/fixtures.ts`.
- Produces: everything in `types.ts` below; `parseAnswer(content: ExerciseContent, raw: unknown): ParsedAnswer` with `ParsedAnswer = { ok: true; answer: Answer } | { ok: false; reason: string }`.

- [ ] **Step 1: Write `src/lib/grading/types.ts`** (types only — validated by `tsc`)

```ts
import type { ExerciseContent } from "../lesson/exerciseSchemas";

export type ExerciseTag = ExerciseContent["type"];
export type ContentOf<T extends ExerciseTag> = Extract<ExerciseContent, { type: T }>;

/** A parsed learner answer, tagged with its exercise type. */
export type Answer =
  | { type: "mcq"; selected: number }
  | { type: "dialogue_gap"; selected: number }
  | { type: "cloze_mc"; selected: number[] }
  | { type: "open_cloze"; text: string[] }
  | { type: "word_bank"; tokens: string[] }
  | { type: "match"; pairs: number[] }
  | { type: "dictation"; text: string }
  | { type: "translation"; text: string }
  | { type: "open_writing"; text: string }
  | { type: "error_correct"; index: number; fix: string };
export type AnswerOf<T extends ExerciseTag> = Extract<Answer, { type: T }>;

/** One gradable part: a gap, a pair, or the whole exercise. */
export interface GradePart {
  correct: boolean;
  given: string;
  expected: string;
}

/** A typed part that failed normalization but may be an equally correct variant (asked to Jev). */
export interface VariantCandidate {
  part: number;
  kind: "gap" | "sentence";
  given: string;
  expected: string[];
  /** "gap": the sentence with this part as ___ ; "sentence": the spoken sentence (dictation). */
  context: string;
}

export interface LocalGrade {
  isCorrect: boolean;
  parts: GradePart[];
  correctAnswer: string;
  variantCandidates: VariantCandidate[];
  needsJudge: "translation" | "writing" | null;
}

export type TranslationCategory = "none" | "grammar" | "vocabulary" | "word_order" | "spelling" | "meaning";
export interface TranslationFeedback {
  isCorrect: boolean;
  corrected: string;
  explanation: string;
  category: TranslationCategory;
  relatesToFocus: boolean;
}

export type WritingCategory = "grammar" | "vocabulary" | "word_order" | "spelling" | "punctuation" | "style";
export interface WritingCorrection {
  original: string;
  corrected: string;
  explanation: string;
  category: WritingCategory;
  severity: "minor" | "moderate" | "major";
  relatesToFocus: boolean;
}
export interface WritingFeedback {
  summary: string;
  corrections: WritingCorrection[];
}

export type GradedBy = "local" | "jev" | "claude";

export interface JudgeOutcome {
  isCorrect: boolean;
  parts: GradePart[];
  gradedBy: GradedBy;
  translation?: TranslationFeedback;
  writing?: WritingFeedback & { wordCount: number };
  jevScores?: Record<string, number>;
}

export interface VocabOutcome {
  id: string;
  correct: boolean;
}

export interface ErrorEntry {
  grammarTopicId: string | null;
  category: string;
  source: "EXERCISE" | "WRITING";
  example: string;
}

export interface GradeFeedback {
  corrected?: string;
  explanation?: string;
  category?: string;
  summary?: string;
  corrections?: WritingCorrection[];
  wordCount?: number;
}

/** Stored in Exercise.result and returned by the route. */
export interface GradeResult {
  version: 1;
  exerciseId: string;
  isCorrect: boolean;
  parts: GradePart[];
  correctAnswer: string;
  explain: string;
  feedback: GradeFeedback | null;
  gradedBy: GradedBy;
  vocabCredit: VocabOutcome[];
  jevScores?: Record<string, number>;
}

export interface LessonGrammar {
  id: string;
  title: string;
  description: string;
}
```

- [ ] **Step 2: Write the failing test** (`src/lib/grading/answerSchemas.test.ts`)

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { parseAnswer } from "./answerSchemas";

describe("parseAnswer", () => {
  it("accepts one valid answer per exercise type and tags it with the exercise type", () => {
    const cases: [keyof typeof E, unknown][] = [
      ["MULTIPLE_CHOICE", { selected: 1 }],
      ["CLOZE_DROPDOWN", { selected: [0, 1] }],
      ["FILL_BLANK", { text: ["beautiful"] }],
      ["WORD_BANK", { tokens: ["I", "go", "to", "work"] }],
      ["MATCH", { pairs: [2, 0, 1] }],
      ["DIALOGUE_GAP", { selected: 0 }],
      ["DICTATION", { text: "I'd like a coffee" }],
      ["ERROR_CORRECTION", { index: 1, fix: "doesn't" }],
      ["TRANSLATION", { text: "I finished the report." }],
      ["OPEN_WRITING", { text: "Once I missed a deadline." }],
    ];
    for (const [t, raw] of cases) {
      const res = parseAnswer(E[t], raw);
      expect(res.ok, t).toBe(true);
      expect(res.ok && res.answer.type, t).toBe(E[t].type);
    }
  });

  it("rejects a wrong shape, naming the field", () => {
    const res = parseAnswer(E.MULTIPLE_CHOICE, { selected: "1" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toMatch(/selected/);
    expect(parseAnswer(E.ERROR_CORRECTION, { index: 1 }).ok).toBe(false);
  });

  it("rejects answers whose length does not match the exercise", () => {
    expect(parseAnswer(E.CLOZE_DROPDOWN, { selected: [0] }).ok).toBe(false);
    expect(parseAnswer(E.FILL_BLANK, { text: ["a", "b"] }).ok).toBe(false);
    expect(parseAnswer(E.MATCH, { pairs: [2, 0] }).ok).toBe(false);
  });

  it("rejects out-of-range selections and indexes (malformed, not a mistake)", () => {
    expect(parseAnswer(E.MULTIPLE_CHOICE, { selected: 4 }).ok).toBe(false);
    expect(parseAnswer(E.DIALOGUE_GAP, { selected: 2 }).ok).toBe(false);
    expect(parseAnswer(E.CLOZE_DROPDOWN, { selected: [0, 5] }).ok).toBe(false);
    expect(parseAnswer(E.MATCH, { pairs: [2, 0, 7] }).ok).toBe(false);
    expect(parseAnswer(E.ERROR_CORRECTION, { index: 9, fix: "x" }).ok).toBe(false);
    expect(parseAnswer(E.MULTIPLE_CHOICE, { selected: -1 }).ok).toBe(false);
  });

  it("rejects empty free text for dictation, translation and writing", () => {
    expect(parseAnswer(E.DICTATION, { text: "" }).ok).toBe(false);
    expect(parseAnswer(E.TRANSLATION, { text: "" }).ok).toBe(false);
    expect(parseAnswer(E.OPEN_WRITING, { text: "" }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(parseAnswer(E.MULTIPLE_CHOICE, null).ok).toBe(false);
    expect(parseAnswer(E.MULTIPLE_CHOICE, "1").ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/lib/grading/answerSchemas.test.ts` → FAIL, cannot resolve `./answerSchemas`.

- [ ] **Step 4: Implement** (`src/lib/grading/answerSchemas.ts`)

```ts
import { z } from "zod";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { Answer } from "./types";

const index = z.number().int().min(0);
const typed = z.string().max(2000);
const freeText = typed.min(1);

const SHAPES = {
  mcq: z.object({ selected: index }),
  dialogue_gap: z.object({ selected: index }),
  cloze_mc: z.object({ selected: z.array(index) }),
  open_cloze: z.object({ text: z.array(typed) }),
  word_bank: z.object({ tokens: z.array(z.string().max(100)).max(40) }),
  match: z.object({ pairs: z.array(index) }),
  dictation: z.object({ text: freeText }),
  translation: z.object({ text: freeText }),
  open_writing: z.object({ text: freeText }),
  error_correct: z.object({ index, fix: z.string().max(200) }),
} as const;

export type ParsedAnswer = { ok: true; answer: Answer } | { ok: false; reason: string };

/** Validate a learner answer against its exercise. A malformed answer is never a learner mistake. */
export function parseAnswer(content: ExerciseContent, raw: unknown): ParsedAnswer {
  const res = SHAPES[content.type].safeParse(raw);
  if (!res.success) {
    return { ok: false, reason: res.error.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`).join("; ") };
  }
  const answer = { type: content.type, ...res.data } as Answer;
  const problem = fitProblem(content, answer);
  return problem ? { ok: false, reason: problem } : { ok: true, answer };
}

const within = (i: number, n: number) => i < n;

function fitProblem(c: ExerciseContent, a: Answer): string | null {
  if ((c.type === "mcq" || c.type === "dialogue_gap") && "selected" in a && typeof a.selected === "number") {
    return within(a.selected, c.options.length) ? null : `selected: ${a.selected} is not one of ${c.options.length} options`;
  }
  if (c.type === "cloze_mc" && a.type === "cloze_mc") {
    if (a.selected.length !== c.gaps.length) return `selected: expected ${c.gaps.length} answers, got ${a.selected.length}`;
    const bad = a.selected.findIndex((s, i) => !within(s, c.gaps[i].options.length));
    return bad === -1 ? null : `selected.${bad}: out of range`;
  }
  if (c.type === "open_cloze" && a.type === "open_cloze") {
    return a.text.length === c.gaps.length ? null : `text: expected ${c.gaps.length} answers, got ${a.text.length}`;
  }
  if (c.type === "match" && a.type === "match") {
    if (a.pairs.length !== c.left.length) return `pairs: expected ${c.left.length} pairs, got ${a.pairs.length}`;
    const bad = a.pairs.findIndex((p) => !within(p, c.right.length));
    return bad === -1 ? null : `pairs.${bad}: out of range`;
  }
  if (c.type === "error_correct" && a.type === "error_correct") {
    return within(a.index, c.tokens.length) ? null : `index: ${a.index} is not one of ${c.tokens.length} tokens`;
  }
  return null;
}
```

- [ ] **Step 5: Run to verify it passes** — PASS (6 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/types.ts src/lib/grading/answerSchemas.ts src/lib/grading/answerSchemas.test.ts
git commit -m "feat(m3c): grading types and per-type answer shapes with range checks" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: Local graders

**Files:**
- Create: `src/lib/grading/graders.ts`
- Test: `src/lib/grading/graders.test.ts`

**Interfaces:**
- Consumes: `normalizeAnswer`, `normalizeLoose` from `src/lib/lesson/exerciseChecks.ts`; types from Task 1.
- Produces: `gradeLocally(content: ExerciseContent, answer: Answer): LocalGrade`.

Fixture facts used below: MCQ key 1 ("had finished"; option 2 = "finishing"); CLOZE text "I have worked here ___ 2019, ___ five years." keys since/for; FILL_BLANK "It was a ___ (BEAUTY) day." accept ["beautiful"]; WORD_BANK answer ["I","go","to","work"]; MATCH answer [2,0,1]; DIALOGUE key 0 ("No worries."); DICTATION tts "I'd like a coffee, please."; ERROR_CORRECTION tokens ["She","don't","like","tea"] key 1, accept ["doesn't","does not"]; TRANSLATION reference "I finished the report before the deadline.".

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { gradeLocally } from "./graders";
import type { Answer } from "./types";

const a = (x: Answer) => x;

describe("gradeLocally", () => {
  it("grades choice exercises by index and shows the keyed option", () => {
    expect(gradeLocally(E.MULTIPLE_CHOICE, a({ type: "mcq", selected: 1 }))).toMatchObject({ isCorrect: true, correctAnswer: "had finished", needsJudge: null });
    const wrong = gradeLocally(E.MULTIPLE_CHOICE, a({ type: "mcq", selected: 2 }));
    expect(wrong.isCorrect).toBe(false);
    expect(wrong.parts).toEqual([{ correct: false, given: "finishing", expected: "had finished" }]);
    expect(gradeLocally(E.DIALOGUE_GAP, a({ type: "dialogue_gap", selected: 0 })).isCorrect).toBe(true);
  });

  it("grades cloze gaps separately; the exercise is correct only if all gaps are", () => {
    const g = gradeLocally(E.CLOZE_DROPDOWN, a({ type: "cloze_mc", selected: [0, 0] }));
    expect(g.isCorrect).toBe(false);
    expect(g.parts.map((p) => p.correct)).toEqual([true, false]);
    expect(g.correctAnswer).toBe("I have worked here since 2019, for five years.");
  });

  it("accepts typed answers after normalization, including typographic apostrophes", () => {
    expect(gradeLocally(E.FILL_BLANK, a({ type: "open_cloze", text: ["  Beautiful "] })).isCorrect).toBe(true);
    expect(gradeLocally(E.ERROR_CORRECTION, a({ type: "error_correct", index: 1, fix: "doesn’t" })).isCorrect).toBe(true);
    const d = gradeLocally(E.DICTATION, a({ type: "dictation", text: "I would like a coffee please!" }));
    expect(d).toMatchObject({ isCorrect: true, variantCandidates: [] });
  });

  it("turns a failed non-empty typed part into a variant candidate with its context", () => {
    const g = gradeLocally(E.FILL_BLANK, a({ type: "open_cloze", text: ["beautifull"] }));
    expect(g.isCorrect).toBe(false);
    expect(g.variantCandidates).toEqual([
      { part: 0, kind: "gap", given: "beautifull", expected: ["beautiful"], context: "It was a ___ (BEAUTY) day." },
    ]);
    const d = gradeLocally(E.DICTATION, a({ type: "dictation", text: "I'd like a cofee" }));
    expect(d.variantCandidates).toEqual([
      { part: 0, kind: "sentence", given: "I'd like a cofee", expected: E.DICTATION.type === "dictation" ? E.DICTATION.accept : [], context: "I'd like a coffee, please." },
    ]);
  });

  it("never escalates an empty typed answer", () => {
    const g = gradeLocally(E.FILL_BLANK, a({ type: "open_cloze", text: [""] }));
    expect(g).toMatchObject({ isCorrect: false, variantCandidates: [] });
  });

  it("requires the right token for error correction before a fix is even considered", () => {
    const wrongIndex = gradeLocally(E.ERROR_CORRECTION, a({ type: "error_correct", index: 2, fix: "doesn't" }));
    expect(wrongIndex).toMatchObject({ isCorrect: false, variantCandidates: [] });
    const typo = gradeLocally(E.ERROR_CORRECTION, a({ type: "error_correct", index: 1, fix: "dosn't" }));
    expect(typo.variantCandidates).toEqual([{ part: 0, kind: "gap", given: "dosn't", expected: ["doesn't", "does not"], context: "She ___ like tea" }]);
    expect(typo.correctAnswer).toBe("She doesn't like tea");
  });

  it("assembles word-bank tokens and compares loosely", () => {
    expect(gradeLocally(E.WORD_BANK, a({ type: "word_bank", tokens: ["I", "go", "to", "work"] })).isCorrect).toBe(true);
    const w = gradeLocally(E.WORD_BANK, a({ type: "word_bank", tokens: ["go", "I", "to", "work"] }));
    expect(w).toMatchObject({ isCorrect: false, correctAnswer: "I go to work" });
  });

  it("grades match pairs one by one", () => {
    const m = gradeLocally(E.MATCH, a({ type: "match", pairs: [2, 1, 0] }));
    expect(m.parts.map((p) => p.correct)).toEqual([true, false, false]);
    expect(m.parts[0]).toEqual({ correct: true, given: "frankly = to be honest", expected: "frankly = to be honest" });
  });

  it("hands translation and open writing to the judge", () => {
    expect(gradeLocally(E.TRANSLATION, a({ type: "translation", text: "x" }))).toMatchObject({ needsJudge: "translation", correctAnswer: "I finished the report before the deadline." });
    expect(gradeLocally(E.OPEN_WRITING, a({ type: "open_writing", text: "x" })).needsJudge).toBe("writing");
  });

  it("refuses an answer of another exercise type", () => {
    expect(() => gradeLocally(E.MULTIPLE_CHOICE, a({ type: "dialogue_gap", selected: 0 }))).toThrow(/does not match/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** (`src/lib/grading/graders.ts`)

```ts
import { normalizeAnswer, normalizeLoose } from "../lesson/exerciseChecks";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { Answer, AnswerOf, GradePart, LocalGrade, VariantCandidate } from "./types";

const fill = (text: string, values: string[]): string => {
  let i = 0;
  return text.replace(/___/g, () => values[i++] ?? "___");
};

const matches = (given: string, accept: string[], norm: (s: string) => string): boolean => {
  const g = norm(given);
  return g !== "" && accept.some((x) => norm(x) === g);
};

const done = (parts: GradePart[], correctAnswer: string, variantCandidates: VariantCandidate[] = []): LocalGrade => ({
  isCorrect: parts.every((p) => p.correct),
  parts,
  correctAnswer,
  variantCandidates,
  needsJudge: null,
});

/** Pure local grading against the keys generated with the lesson. */
export function gradeLocally(c: ExerciseContent, answer: Answer): LocalGrade {
  if (c.type !== answer.type) throw new Error(`answer type ${answer.type} does not match exercise type ${c.type}`);

  switch (c.type) {
    case "mcq":
    case "dialogue_gap": {
      const { selected } = answer as AnswerOf<"mcq">;
      return done([{ correct: selected === c.answer, given: c.options[selected], expected: c.options[c.answer] }], c.options[c.answer]);
    }
    case "cloze_mc": {
      const { selected } = answer as AnswerOf<"cloze_mc">;
      const parts = c.gaps.map((g, i) => ({ correct: selected[i] === g.answer, given: g.options[selected[i]], expected: g.options[g.answer] }));
      return done(parts, fill(c.text, c.gaps.map((g) => g.options[g.answer])));
    }
    case "open_cloze": {
      const { text } = answer as AnswerOf<"open_cloze">;
      const keys = c.gaps.map((g) => g.accept[0]);
      const candidates: VariantCandidate[] = [];
      const parts = c.gaps.map((g, i) => {
        const correct = matches(text[i], g.accept, normalizeAnswer);
        if (!correct && normalizeAnswer(text[i]) !== "") {
          candidates.push({ part: i, kind: "gap", given: text[i], expected: g.accept, context: fill(c.text, keys.map((k, j) => (j === i ? "___" : k))) });
        }
        return { correct, given: text[i], expected: keys[i] };
      });
      return done(parts, fill(c.text, keys), candidates);
    }
    case "error_correct": {
      const { index, fix } = answer as AnswerOf<"error_correct">;
      const indexOk = index === c.answer;
      const correct = indexOk && matches(fix, c.accept, normalizeAnswer);
      const candidates: VariantCandidate[] =
        indexOk && !correct && normalizeAnswer(fix) !== ""
          ? [{ part: 0, kind: "gap", given: fix, expected: c.accept, context: c.tokens.map((t, i) => (i === c.answer ? "___" : t)).join(" ") }]
          : [];
      const fixed = c.tokens.map((t, i) => (i === c.answer ? c.accept[0] : t)).join(" ");
      return done([{ correct, given: `${c.tokens[index]} -> ${fix}`, expected: `${c.tokens[c.answer]} -> ${c.accept[0]}` }], fixed, candidates);
    }
    case "dictation": {
      const { text } = answer as AnswerOf<"dictation">;
      const correct = matches(text, c.accept, normalizeLoose);
      const candidates: VariantCandidate[] =
        !correct && normalizeLoose(text) !== "" ? [{ part: 0, kind: "sentence", given: text, expected: c.accept, context: c.tts }] : [];
      return done([{ correct, given: text, expected: c.tts }], c.tts, candidates);
    }
    case "word_bank": {
      const given = (answer as AnswerOf<"word_bank">).tokens.join(" ");
      const correct = [c.answer, ...c.accept_alt].some((k) => normalizeLoose(k.join(" ")) === normalizeLoose(given));
      return done([{ correct, given, expected: c.answer.join(" ") }], c.answer.join(" "));
    }
    case "match": {
      const { pairs } = answer as AnswerOf<"match">;
      const parts = c.left.map((l, i) => ({
        correct: pairs[i] === c.answer[i],
        given: `${l} = ${c.right[pairs[i]]}`,
        expected: `${l} = ${c.right[c.answer[i]]}`,
      }));
      return done(parts, parts.map((p) => p.expected).join("; "));
    }
    case "translation": {
      const { text } = answer as AnswerOf<"translation">;
      return { isCorrect: false, parts: [{ correct: false, given: text, expected: c.reference }], correctAnswer: c.reference, variantCandidates: [], needsJudge: "translation" };
    }
    case "open_writing": {
      const { text } = answer as AnswerOf<"open_writing">;
      return { isCorrect: false, parts: [{ correct: false, given: text, expected: "" }], correctAnswer: "", variantCandidates: [], needsJudge: "writing" };
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (10 tests).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/graders.ts src/lib/grading/graders.test.ts
git commit -m "feat(m3c): pure local graders with variant candidates for typed answers" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Answer-zone vocab credit

**Files:**
- Create: `src/lib/grading/answerZone.ts`
- Test: `src/lib/grading/answerZone.test.ts`

**Interfaces:**
- Consumes: `headwordOccurs` (`src/lib/lesson/exerciseChecks.ts`); `ExerciseContent`; `GradePart`, `VocabOutcome` (Task 1).
- Produces: `vocabOutcomes(content, judged: { isCorrect: boolean; parts: GradePart[] }, vocab: { id: string; headword: string }[]): VocabOutcome[]`; `type VocabStatusName = "NEW" | "SEEN" | "LEARNING" | "KNOWN"`; `KNOWN_STREAK = 3`; `nextVocabState(cur: { status: VocabStatusName; correctStreak: number }, correct: boolean): { status: VocabStatusName; correctStreak: number }`; `withoutCredited(outcomes: VocabOutcome[], credited: ReadonlySet<string>): VocabOutcome[]`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "../lesson/fixtures";
import { nextVocabState, vocabOutcomes, withoutCredited } from "./answerZone";

const ok = { isCorrect: true, parts: [{ correct: true, given: "", expected: "" }] };
const bad = { isCorrect: false, parts: [{ correct: false, given: "", expected: "" }] };

describe("vocabOutcomes", () => {
  it("gives no credit to a word that is only in the prompt, not in the answer", () => {
    // MCQ fixture lists v1 (deadline) but the keyed option is "had finished"
    expect(vocabOutcomes(E.MULTIPLE_CHOICE, ok, FIXTURE_VOCAB)).toEqual([]);
  });

  it("credits a word in the reference of a translation with the exercise verdict", () => {
    expect(vocabOutcomes(E.TRANSLATION, ok, FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: true }]);
    expect(vocabOutcomes(E.TRANSLATION, bad, FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: false }]);
  });

  it("credits a match word with the verdict of its own pair", () => {
    const parts = (c: boolean[]) => ({ isCorrect: c.every(Boolean), parts: c.map((correct) => ({ correct, given: "", expected: "" })) });
    expect(vocabOutcomes(E.MATCH, parts([false, false, true]), FIXTURE_VOCAB)).toEqual([{ id: "v2", correct: true }]);
    expect(vocabOutcomes(E.MATCH, parts([true, true, false]), FIXTURE_VOCAB)).toEqual([{ id: "v2", correct: false }]);
  });

  it("requires every zone of a word to be correct", () => {
    const cloze = {
      type: "cloze_mc",
      text: "The ___ is Friday and the second ___ is Monday.",
      gaps: [
        { options: ["deadline", "dead"], answer: 0 },
        { options: ["deadlines", "deadline"], answer: 1 },
      ],
      explain: "Deadline is a countable noun.",
      vocab: ["v1"],
    } as ExerciseContent;
    const judged = { isCorrect: false, parts: [{ correct: true, given: "", expected: "" }, { correct: false, given: "", expected: "" }] };
    expect(vocabOutcomes(cloze, judged, FIXTURE_VOCAB)).toEqual([{ id: "v1", correct: false }]);
  });

  it("gives no credit for open writing and ignores unknown ids", () => {
    expect(vocabOutcomes(E.OPEN_WRITING, ok, FIXTURE_VOCAB)).toEqual([]);
    expect(vocabOutcomes({ ...E.TRANSLATION, vocab: ["ghost"] } as ExerciseContent, ok, FIXTURE_VOCAB)).toEqual([]);
  });
});

describe("nextVocabState", () => {
  it("moves toward KNOWN on correct answers", () => {
    expect(nextVocabState({ status: "NEW", correctStreak: 0 }, true)).toEqual({ status: "LEARNING", correctStreak: 1 });
    expect(nextVocabState({ status: "LEARNING", correctStreak: 2 }, true)).toEqual({ status: "KNOWN", correctStreak: 3 });
    expect(nextVocabState({ status: "KNOWN", correctStreak: 3 }, true)).toEqual({ status: "KNOWN", correctStreak: 4 });
  });
  it("resets the streak and demotes KNOWN on a wrong answer", () => {
    expect(nextVocabState({ status: "KNOWN", correctStreak: 4 }, false)).toEqual({ status: "LEARNING", correctStreak: 0 });
    expect(nextVocabState({ status: "SEEN", correctStreak: 0 }, false)).toEqual({ status: "LEARNING", correctStreak: 0 });
  });
});

describe("withoutCredited", () => {
  it("drops words already credited in this lesson", () => {
    expect(withoutCredited([{ id: "v1", correct: true }, { id: "v2", correct: false }], new Set(["v1"]))).toEqual([{ id: "v2", correct: false }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** (`src/lib/grading/answerZone.ts`)

```ts
import { headwordOccurs } from "../lesson/exerciseChecks";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { GradePart, VocabOutcome } from "./types";

export type VocabStatusName = "NEW" | "SEEN" | "LEARNING" | "KNOWN";
export const KNOWN_STREAK = 3;

/** Where the answer lives. part null = the whole exercise's verdict decides. */
function zones(c: ExerciseContent): { text: string; part: number | null }[] {
  switch (c.type) {
    case "mcq":
    case "dialogue_gap":
      return [{ text: c.options[c.answer], part: null }];
    case "cloze_mc":
      return c.gaps.map((g, i) => ({ text: g.options[g.answer], part: i }));
    case "open_cloze":
      return c.gaps.map((g, i) => ({ text: [g.accept[0], g.root ?? ""].join(" "), part: i }));
    case "error_correct":
      return [{ text: c.accept[0], part: null }];
    case "word_bank":
      return [{ text: c.answer.join(" "), part: null }];
    case "match":
      return c.left.map((l, i) => ({ text: `${l} ${c.right[c.answer[i]]}`, part: i }));
    case "dictation":
      return [{ text: c.tts, part: null }];
    case "translation":
      return [{ text: c.reference, part: null }];
    case "open_writing":
      return [];
  }
}

/**
 * Credit only words that are part of the answer (M3b-2 final review: presence in the prompt is
 * not practice). A word is correct only if every zone it appears in was answered correctly.
 */
export function vocabOutcomes(
  c: ExerciseContent,
  judged: { isCorrect: boolean; parts: GradePart[] },
  vocab: { id: string; headword: string }[],
): VocabOutcome[] {
  const headwords = new Map(vocab.map((v) => [v.id, v.headword]));
  const all = zones(c);
  const out: VocabOutcome[] = [];
  for (const id of c.vocab) {
    const headword = headwords.get(id);
    if (!headword) continue;
    const hits = all.filter((z) => headwordOccurs(headword, z.text));
    if (hits.length === 0) continue;
    const correct = hits.every((z) => (z.part === null ? judged.isCorrect : judged.parts[z.part]?.correct === true));
    out.push({ id, correct });
  }
  return out;
}

export function nextVocabState(
  cur: { status: VocabStatusName; correctStreak: number },
  correct: boolean,
): { status: VocabStatusName; correctStreak: number } {
  if (!correct) return { status: "LEARNING", correctStreak: 0 };
  const correctStreak = cur.correctStreak + 1;
  return { status: correctStreak >= KNOWN_STREAK ? "KNOWN" : "LEARNING", correctStreak };
}

/** Once per word per lesson: the first graded exercise decides. */
export function withoutCredited(outcomes: VocabOutcome[], credited: ReadonlySet<string>): VocabOutcome[] {
  return outcomes.filter((o) => !credited.has(o.id));
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (9 tests).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/answerZone.ts src/lib/grading/answerZone.test.ts
git commit -m "feat(m3c): answer-zone vocab credit and vocab status transitions" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: Jev requests — typed variants and translation

**Files:**
- Create: `src/lib/prompts/variantGate.ts`, `src/lib/prompts/translationJudge.ts`
- Test: `src/lib/prompts/variantGate.test.ts`, `src/lib/prompts/translationJudge.test.ts`

**Interfaces:**
- Consumes: `noul`, `choice`, `type Json` from `src/lib/typesafe/client.ts`; `VariantCandidate`, `ContentOf` (Task 1).
- Produces: `VARIANT_ACCEPT = 0.8`; `variantRequest(v: VariantCandidate): { state: Json; questions: { equivalent: NoulQuestion } }`; `TRANSLATION_ACCEPT = 0.8`; `translationRequest(c: ContentOf<"translation">, text: string): { state: Json; questions: { acceptable: NoulQuestion; error_type: ChoiceQuestion<TranslationCategory> } }`.

The translation questions are the ones validated live on 2026-09-18 (40/40 accept/reject).

- [ ] **Step 1: Write the failing tests**

`src/lib/prompts/variantGate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VARIANT_ACCEPT, variantRequest } from "./variantGate";

describe("variantRequest", () => {
  it("asks about ONE gap with the keyed answers and the learner answer", () => {
    const r = variantRequest({ part: 0, kind: "gap", given: "colour", expected: ["color"], context: "What ___ is it?" });
    expect(r.state).toEqual({ sentence_with_gap: "What ___ is it?", keyed_answers: ["color"], learner_answer: "colour" });
    expect(r.questions.equivalent.type).toBe("noul");
    expect(String(r.questions.equivalent.instructions)).toMatch(/British or American/);
  });

  it("uses the spoken sentence for a dictation candidate", () => {
    const r = variantRequest({ part: 0, kind: "sentence", given: "I'd like a coffee", expected: ["i'd like a coffee please"], context: "I'd like a coffee, please." });
    expect(r.state).toEqual({ spoken_sentence: "I'd like a coffee, please.", keyed_answers: ["i'd like a coffee please"], learner_answer: "I'd like a coffee" });
    expect(String(r.questions.equivalent.instructions)).toMatch(/spoken_sentence/);
  });

  it("accepts only confident equivalence", () => {
    expect(VARIANT_ACCEPT).toBe(0.8);
  });
});
```

`src/lib/prompts/translationJudge.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import type { ContentOf } from "../grading/types";
import { TRANSLATION_ACCEPT, translationRequest } from "./translationJudge";

describe("translationRequest", () => {
  it("sends the Russian source, the reference and the learner answer", () => {
    const r = translationRequest(E.TRANSLATION as ContentOf<"translation">, "I finished the report before the deadline.");
    expect(r.state).toEqual({
      source_ru: (E.TRANSLATION as ContentOf<"translation">).source,
      reference_en: "I finished the report before the deadline.",
      learner_answer: "I finished the report before the deadline.",
    });
  });

  it("asks the two validated questions", () => {
    const r = translationRequest(E.TRANSLATION as ContentOf<"translation">, "x");
    expect(r.questions.acceptable.type).toBe("noul");
    expect(r.questions.error_type.type).toBe("choice");
    expect(Object.keys(r.questions.error_type.criteria)).toEqual(["none", "grammar", "vocabulary", "word_order", "spelling", "meaning"]);
    expect(TRANSLATION_ACCEPT).toBe(0.8);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — modules missing.

- [ ] **Step 3: Implement `src/lib/prompts/variantGate.ts`**

```ts
import type { VariantCandidate } from "../grading/types";
import { noul, type Json, type NoulQuestion } from "../typesafe/client";

/** A typed mismatch counts as correct only on a confident "equally correct". */
export const VARIANT_ACCEPT = 0.8;

const GAP = noul(
  "`sentence_with_gap` has one gap (___). `keyed_answers` are the answers the key accepts for it. Would `learner_answer` in that gap be EQUALLY correct - the same word or phrase in another standard spelling (British or American), a contraction or its full form, or a different word or phrase that keeps both the meaning and the grammar of the sentence?",
  {
    true: "Filling the gap with `learner_answer` gives correct, natural standard English with the same meaning as a keyed answer.",
    false: "`learner_answer` is misspelled, the wrong form of the word (tense, ending, number), ungrammatical in this gap, or changes the meaning.",
  },
);

const SENTENCE = noul(
  "A learner heard `spoken_sentence` and typed `learner_answer`. `keyed_answers` are accepted transcriptions. Is `learner_answer` the same sentence, differing only in punctuation, capitalisation, standard British or American spelling, or a contraction versus its full form?",
  {
    true: "Same words in the same order; only punctuation, capitalisation, British/American spelling or contractions differ.",
    false: "A word is missing, added, misspelled or different, or the word order differs.",
  },
);

/** One variant candidate per request (never batch). */
export function variantRequest(v: VariantCandidate): { state: Json; questions: { equivalent: NoulQuestion } } {
  return v.kind === "gap"
    ? { state: { sentence_with_gap: v.context, keyed_answers: v.expected, learner_answer: v.given }, questions: { equivalent: GAP } }
    : { state: { spoken_sentence: v.context, keyed_answers: v.expected, learner_answer: v.given }, questions: { equivalent: SENTENCE } };
}
```

- [ ] **Step 4: Implement `src/lib/prompts/translationJudge.ts`**

```ts
import type { ContentOf, TranslationCategory } from "../grading/types";
import { choice, noul, type ChoiceQuestion, type Json, type NoulQuestion } from "../typesafe/client";

/** Jev-accepted translations skip Claude entirely. */
export const TRANSLATION_ACCEPT = 0.8;

const ACCEPTABLE = noul(
  "A learner of English translated a sentence. `reference_en` is one correct translation; other wordings can be equally correct. Should a strict English teacher accept `learner_answer` as fully correct?",
  {
    true: "learner_answer is error-free standard English (grammar, word choice, word order, spelling) AND has the same meaning as reference_en. Paraphrases, synonyms, contractions and British/American variants are fine.",
    false: "learner_answer contains any grammar, vocabulary, word-order or spelling error, OR its meaning differs from reference_en.",
  },
);

const ERROR_TYPE = choice<TranslationCategory>(
  "Which single category best describes the most important problem in `learner_answer`, compared with `reference_en`?",
  {
    none: "No problem: correct English with the same meaning as the reference.",
    grammar: "Wrong tense, verb form, agreement, article, preposition, plural, or clause structure.",
    vocabulary: "A wrong word was chosen: false friend, wrong collocation, confused word pair. Grammar is otherwise fine.",
    word_order: "The right words in the right forms, but placed in the wrong order.",
    spelling: "A misspelled word; the intended word is obvious and otherwise correct.",
    meaning: "Correct, natural English that states something different from the reference.",
  },
);

export function translationRequest(
  c: ContentOf<"translation">,
  text: string,
): { state: Json; questions: { acceptable: NoulQuestion; error_type: ChoiceQuestion<TranslationCategory> } } {
  return {
    state: { source_ru: c.source, reference_en: c.reference, learner_answer: text },
    questions: { acceptable: ACCEPTABLE, error_type: ERROR_TYPE },
  };
}
```

- [ ] **Step 5: Run to verify they pass** — PASS (5 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/prompts/variantGate.ts src/lib/prompts/variantGate.test.ts src/lib/prompts/translationJudge.ts src/lib/prompts/translationJudge.test.ts
git commit -m "feat(m3c): Jev requests for typed variants and translation verdicts" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 5: Claude feedback prompts — translation and open writing

**Files:**
- Create: `src/lib/prompts/translationFeedback.ts`, `src/lib/prompts/writingFeedback.ts`
- Test: `src/lib/prompts/translationFeedback.test.ts`, `src/lib/prompts/writingFeedback.test.ts`

**Interfaces:**
- Consumes: `type CompleteArgs` (`src/lib/llm/types.ts`); `TranslationFeedback`, `WritingFeedback` (Task 1).
- Produces: `TRANSLATION_FEEDBACK_LIMITS`, `translationFeedbackSchema: z.ZodType<TranslationFeedback>`, `translationFeedbackPrompt(input: TranslationFeedbackInput): CompleteArgs` with `TranslationFeedbackInput = { source: string; reference: string; answer: string; jevCategory: string | null; grammar: { title: string; description: string } | null; level: string }`; `WRITING_FEEDBACK_LIMITS`, `writingFeedbackSchema: z.ZodType<WritingFeedback>`, `writingFeedbackPrompt(input: WritingFeedbackInput): CompleteArgs` with `WritingFeedbackInput = { prompt: string; text: string; minWords: number; grammar: { title: string; description: string } | null; level: string }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/prompts/translationFeedback.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { TRANSLATION_FEEDBACK_LIMITS as L, translationFeedbackPrompt, translationFeedbackSchema } from "./translationFeedback";

const input = {
  source: "Я закончил отчёт.",
  reference: "I finished the report.",
  answer: "I have finished report.",
  jevCategory: "grammar",
  grammar: { title: "Past Simple", description: "Finished actions in the past." },
  level: "B1",
};

describe("translationFeedbackPrompt", () => {
  it("sends every input as JSON in one user message", () => {
    const args = translationFeedbackPrompt(input);
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload).toMatchObject({ source_ru: input.source, reference_en: input.reference, learner_answer: input.answer, jev_category: "grammar", level: "B1" });
    expect(payload.grammar_focus).toEqual(input.grammar);
  });

  it("states the contract and the limits from the constants", () => {
    const system = translationFeedbackPrompt(input).system ?? "";
    expect(system).toMatch(/ONLY a JSON object/);
    expect(system).toMatch(/MINIMAL edits/);
    expect(system).toContain(`${L.explanation.min}-${L.explanation.max}`);
    expect(system).toContain(`${L.corrected.min}-${L.corrected.max}`);
    for (const c of ["none", "grammar", "vocabulary", "word_order", "spelling", "meaning"]) expect(system).toContain(`"${c}"`);
  });
});

describe("translationFeedbackSchema", () => {
  const ok = { isCorrect: false, corrected: "I finished the report.", explanation: "Use the past simple for a finished action.", category: "grammar", relatesToFocus: true };
  it("accepts a valid answer", () => expect(translationFeedbackSchema.parse(ok)).toEqual(ok));
  it("rejects an unknown category and a too-short explanation", () => {
    expect(translationFeedbackSchema.safeParse({ ...ok, category: "tone" }).success).toBe(false);
    expect(translationFeedbackSchema.safeParse({ ...ok, explanation: "bad" }).success).toBe(false);
  });
});
```

`src/lib/prompts/writingFeedback.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { WRITING_FEEDBACK_LIMITS as L, writingFeedbackPrompt, writingFeedbackSchema } from "./writingFeedback";

const input = { prompt: "Describe a missed deadline.", text: "Last year I miss a deadline.", minWords: 60, grammar: null, level: "B1" };

describe("writingFeedbackPrompt", () => {
  it("sends the task, the text and the word minimum", () => {
    const args = writingFeedbackPrompt(input);
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload).toMatchObject({ task: input.prompt, learner_text: input.text, min_words: 60, grammar_focus: null, level: "B1" });
  });

  it("defines severity and states the limits from the constants", () => {
    const system = writingFeedbackPrompt(input).system ?? "";
    expect(system).toMatch(/"major"/);
    expect(system).toMatch(/verbatim/i);
    expect(system).toContain(`at most ${L.corrections.max} corrections`);
    expect(system).toContain(`${L.summary.min}-${L.summary.max}`);
  });
});

describe("writingFeedbackSchema", () => {
  const correction = { original: "I miss", corrected: "I missed", explanation: "Past simple for a finished event.", category: "grammar", severity: "major", relatesToFocus: false };
  it("accepts a valid answer with and without corrections", () => {
    expect(writingFeedbackSchema.parse({ summary: "Good story, one tense error.", corrections: [correction] }).corrections).toHaveLength(1);
    expect(writingFeedbackSchema.parse({ summary: "Clear and correct, well done.", corrections: [] }).corrections).toEqual([]);
  });
  it("rejects an unknown severity and too many corrections", () => {
    expect(writingFeedbackSchema.safeParse({ summary: "Good story, one tense error.", corrections: [{ ...correction, severity: "fatal" }] }).success).toBe(false);
    expect(writingFeedbackSchema.safeParse({ summary: "Good story, one tense error.", corrections: Array(L.corrections.max + 1).fill(correction) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — modules missing.

- [ ] **Step 3: Implement `src/lib/prompts/translationFeedback.ts`**

```ts
import { z } from "zod";
import type { TranslationFeedback } from "../grading/types";
import type { CompleteArgs } from "../llm/types";

export const TRANSLATION_FEEDBACK_LIMITS = {
  corrected: { min: 1, max: 300 },
  explanation: { min: 10, max: 400 },
} as const;
const L = TRANSLATION_FEEDBACK_LIMITS;

export const TRANSLATION_CATEGORIES = ["none", "grammar", "vocabulary", "word_order", "spelling", "meaning"] as const;

export const translationFeedbackSchema: z.ZodType<TranslationFeedback> = z.object({
  isCorrect: z.boolean(),
  corrected: z.string().min(L.corrected.min).max(L.corrected.max),
  explanation: z.string().min(L.explanation.min).max(L.explanation.max),
  category: z.enum(TRANSLATION_CATEGORIES),
  relatesToFocus: z.boolean(),
});

export interface TranslationFeedbackInput {
  source: string;
  reference: string;
  answer: string;
  jevCategory: string | null;
  grammar: { title: string; description: string } | null;
  level: string;
}

const SYSTEM = [
  "You are an experienced, encouraging English teacher checking one translation written by an adult Russian-speaking learner.",
  "Decide whether `learner_answer` is a fully correct, natural English translation of `source_ru`. `reference_en` is ONE correct translation - accept any other correct, natural wording (paraphrases, synonyms, contractions, British or American spelling).",
  "If it is correct: isCorrect true, corrected = the learner answer unchanged, category \"none\", explanation = one sentence on what was done well.",
  `If it is wrong: isCorrect false; corrected = the learner's own sentence with the MINIMAL edits that make it correct (not the reference; ${L.corrected.min}-${L.corrected.max} characters); explanation = what was wrong and why, in simple English for the learner's CEFR level (${L.explanation.min}-${L.explanation.max} characters); category = the most important problem.`,
  `Categories: ${TRANSLATION_CATEGORIES.map((c) => `"${c}"`).join(", ")}.`,
  "relatesToFocus: true only when the main problem is about `grammar_focus` (false when grammar_focus is null).",
  "`jev_category` is a hint from an automatic classifier and may be wrong.",
  'Return ONLY a JSON object: {"isCorrect":true|false,"corrected":"...","explanation":"...","category":"...","relatesToFocus":true|false}. No prose, no markdown fences.',
].join("\n");

/** Translation check (role `translation_check`). Response: translationFeedbackSchema. */
export function translationFeedbackPrompt(input: TranslationFeedbackInput): CompleteArgs {
  const payload = {
    source_ru: input.source,
    reference_en: input.reference,
    learner_answer: input.answer,
    jev_category: input.jevCategory,
    grammar_focus: input.grammar,
    level: input.level,
  };
  return { system: SYSTEM, messages: [{ role: "user", content: "Check this translation.\n" + JSON.stringify(payload, null, 2) }] };
}
```

- [ ] **Step 4: Implement `src/lib/prompts/writingFeedback.ts`**

```ts
import { z } from "zod";
import type { WritingFeedback } from "../grading/types";
import type { CompleteArgs } from "../llm/types";

export const WRITING_FEEDBACK_LIMITS = {
  summary: { min: 20, max: 400 },
  original: { min: 1, max: 200 },
  corrected: { min: 1, max: 200 },
  explanation: { min: 10, max: 300 },
  corrections: { max: 15 },
} as const;
const L = WRITING_FEEDBACK_LIMITS;

export const WRITING_CATEGORIES = ["grammar", "vocabulary", "word_order", "spelling", "punctuation", "style"] as const;
export const SEVERITIES = ["minor", "moderate", "major"] as const;

export const writingFeedbackSchema: z.ZodType<WritingFeedback> = z.object({
  summary: z.string().min(L.summary.min).max(L.summary.max),
  corrections: z
    .array(
      z.object({
        original: z.string().min(L.original.min).max(L.original.max),
        corrected: z.string().min(L.corrected.min).max(L.corrected.max),
        explanation: z.string().min(L.explanation.min).max(L.explanation.max),
        category: z.enum(WRITING_CATEGORIES),
        severity: z.enum(SEVERITIES),
        relatesToFocus: z.boolean(),
      }),
    )
    .max(L.corrections.max),
});

export interface WritingFeedbackInput {
  prompt: string;
  text: string;
  minWords: number;
  grammar: { title: string; description: string } | null;
  level: string;
}

const SYSTEM = [
  "You are an experienced, encouraging English teacher giving feedback on a short text written by an adult Russian-speaking learner.",
  `List the errors in \`learner_text\` as corrections, most important first, at most ${L.corrections.max} corrections. For each: "original" = the wrong words copied verbatim from the text (${L.original.min}-${L.original.max} characters), "corrected" = the fixed words (${L.corrected.min}-${L.corrected.max} characters), "explanation" = why, in simple English for the learner's CEFR level (${L.explanation.min}-${L.explanation.max} characters), "category" (${WRITING_CATEGORIES.map((c) => `"${c}"`).join(", ")}), "severity" and "relatesToFocus".`,
  'Severity: "major" = an error that changes or blocks the meaning, or a basic grammar error for this CEFR level; "moderate" = a clear error that does not block understanding; "minor" = a small slip or an unnatural but understandable choice. Do not list mere style preferences.',
  "relatesToFocus: true only when the error is about `grammar_focus` (false when grammar_focus is null).",
  `"summary": 1-3 sentences of overall feedback on content and language (${L.summary.min}-${L.summary.max} characters). Do not judge the length - the app counts words itself.`,
  'Return ONLY a JSON object: {"summary":"...","corrections":[...]} (an empty array when there are no errors). No prose, no markdown fences.',
].join("\n");

/** Open-writing feedback (role `writing_feedback`). Response: writingFeedbackSchema. */
export function writingFeedbackPrompt(input: WritingFeedbackInput): CompleteArgs {
  const payload = { task: input.prompt, learner_text: input.text, min_words: input.minWords, grammar_focus: input.grammar, level: input.level };
  return { system: SYSTEM, messages: [{ role: "user", content: "Give feedback on this text.\n" + JSON.stringify(payload, null, 2) }] };
}
```

- [ ] **Step 5: Run to verify they pass** — PASS (8 tests). If `tsc` rejects assigning `z.object(...)` to `z.ZodType<TranslationFeedback>` / `z.ZodType<WritingFeedback>`, fix the typing minimally (e.g. `satisfies`-style assertion or an explicit cast through the inferred type) without changing the rules; report it.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/prompts/translationFeedback.ts src/lib/prompts/translationFeedback.test.ts src/lib/prompts/writingFeedback.ts src/lib/prompts/writingFeedback.test.ts
git commit -m "feat(m3c): Claude feedback prompts for translation and open writing" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 6: Judge — Jev first, Claude when needed

**Files:**
- Create: `src/lib/grading/judge.ts`
- Test: `src/lib/grading/judge.test.ts`

**Interfaces:**
- Consumes: Task 4 (`variantRequest`, `VARIANT_ACCEPT`, `translationRequest`, `TRANSLATION_ACCEPT`), Task 5 (`translationFeedbackPrompt`, `writingFeedbackPrompt`), Task 1 types, `TypeSafeClient`, `CompleteArgs`.
- Produces: `class GradingUnavailableError extends Error`; `interface JudgeDeps { jev: () => TypeSafeClient | null; askTranslation: (args: CompleteArgs) => Promise<TranslationFeedback>; askWriting: (args: CompleteArgs) => Promise<WritingFeedback> }`; `interface JudgeContext { grammar: LessonGrammar | null; level: string }`; `countWords(s: string): number`; `runJudge(content: ExerciseContent, answer: Answer, local: LocalGrade, ctx: JudgeContext, deps: JudgeDeps): Promise<JudgeOutcome>`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import type { TypeSafeClient } from "../typesafe/client";
import { gradeLocally } from "./graders";
import { countWords, GradingUnavailableError, runJudge, type JudgeDeps } from "./judge";
import type { Answer, TranslationFeedback, WritingFeedback } from "./types";

const ctx = { grammar: { id: "g1", title: "Past Simple", description: "Finished past actions." }, level: "B1" };

function jevReturning(answers: Record<string, unknown>) {
  const systemOne = vi.fn(async () => ({ answers, usage: { input_tokens: 1, output_tokens: 1 } }));
  return { client: { systemOne } as unknown as TypeSafeClient, systemOne };
}
const deps = (over: Partial<JudgeDeps> = {}): JudgeDeps => ({
  jev: () => null,
  askTranslation: vi.fn(),
  askWriting: vi.fn(),
  ...over,
});
const judge = (content: (typeof E)[keyof typeof E], answer: Answer, d: JudgeDeps) => runJudge(content, answer, gradeLocally(content, answer), ctx, d);

describe("runJudge - typed variants", () => {
  const typo: Answer = { type: "open_cloze", text: ["beautifull"] };

  it("returns the local verdict without calling Jev when nothing needs checking", async () => {
    const jev = jevReturning({});
    const out = await judge(E.MULTIPLE_CHOICE, { type: "mcq", selected: 1 }, deps({ jev: () => jev.client }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "local" });
    expect(jev.systemOne).not.toHaveBeenCalled();
  });

  it("accepts a confidently equivalent variant", async () => {
    const jev = jevReturning({ equivalent: { type: "noul", noul: 0.93 } });
    const out = await judge(E.FILL_BLANK, typo, deps({ jev: () => jev.client }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "jev", jevScores: { variant_0: 0.93 } });
    expect(jev.systemOne).toHaveBeenCalledTimes(1);
  });

  it("keeps the answer wrong when Jev is not confident", async () => {
    const jev = jevReturning({ equivalent: { type: "noul", noul: 0.5 } });
    expect((await judge(E.FILL_BLANK, typo, deps({ jev: () => jev.client }))).isCorrect).toBe(false);
  });

  it("grades strictly without Jev", async () => {
    expect(await judge(E.FILL_BLANK, typo, deps())).toMatchObject({ isCorrect: false, gradedBy: "local" });
  });

  it("falls back to strict grading when Jev throws", async () => {
    const client = { systemOne: vi.fn().mockRejectedValue(new Error("HTTP 504")) } as unknown as TypeSafeClient;
    await expect(judge(E.FILL_BLANK, typo, deps({ jev: () => client }))).resolves.toMatchObject({ isCorrect: false, gradedBy: "local" });
  });
});

describe("runJudge - translation", () => {
  const answer: Answer = { type: "translation", text: "I finished the report before the deadline." };
  const fb: TranslationFeedback = { isCorrect: false, corrected: "I finished the report before the deadline.", explanation: "Use the definite article.", category: "grammar", relatesToFocus: false };

  it("accepts a Jev-confident translation without calling Claude", async () => {
    const jev = jevReturning({ acceptable: { type: "noul", noul: 0.95 }, error_type: { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 } });
    const askTranslation = vi.fn();
    const out = await judge(E.TRANSLATION, answer, deps({ jev: () => jev.client, askTranslation }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "jev" });
    expect(askTranslation).not.toHaveBeenCalled();
  });

  it("asks Claude with the Jev category hint when Jev is not confident", async () => {
    const jev = jevReturning({ acceptable: { type: "noul", noul: 0.3 }, error_type: { type: "choice", choice: "grammar", probabilities: {}, confidence: 0.7 } });
    const askTranslation = vi.fn().mockResolvedValue(fb);
    const out = await judge(E.TRANSLATION, answer, deps({ jev: () => jev.client, askTranslation }));
    expect(out).toMatchObject({ isCorrect: false, gradedBy: "claude", translation: fb });
    expect(askTranslation.mock.calls[0][0].messages[0].content).toContain('"jev_category": "grammar"');
  });

  it("goes straight to Claude without Jev", async () => {
    const askTranslation = vi.fn().mockResolvedValue({ ...fb, isCorrect: true, category: "none" });
    expect(await judge(E.TRANSLATION, answer, deps({ askTranslation }))).toMatchObject({ isCorrect: true, gradedBy: "claude" });
  });

  it("raises GradingUnavailableError when Claude fails", async () => {
    const askTranslation = vi.fn().mockRejectedValue(new Error("LLM JSON validation failed"));
    await expect(judge(E.TRANSLATION, answer, deps({ askTranslation }))).rejects.toBeInstanceOf(GradingUnavailableError);
  });
});

describe("runJudge - open writing", () => {
  const long = Array.from({ length: 65 }, (_, i) => `word${i}`).join(" ");
  const fb = (severities: ("minor" | "moderate" | "major")[]): WritingFeedback => ({
    summary: "A clear text with a few slips.",
    corrections: severities.map((severity) => ({ original: "a", corrected: "b", explanation: "Because of a reason.", category: "grammar", severity, relatesToFocus: false })),
  });

  it("is correct with enough words and no major error", async () => {
    const out = await judge(E.OPEN_WRITING, { type: "open_writing", text: long }, deps({ askWriting: vi.fn().mockResolvedValue(fb(["minor", "moderate"])) }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "claude" });
    expect(out.writing?.wordCount).toBe(65);
  });

  it("is wrong with a major error or too few words", async () => {
    expect((await judge(E.OPEN_WRITING, { type: "open_writing", text: long }, deps({ askWriting: vi.fn().mockResolvedValue(fb(["major"])) }))).isCorrect).toBe(false);
    expect((await judge(E.OPEN_WRITING, { type: "open_writing", text: "Too short." }, deps({ askWriting: vi.fn().mockResolvedValue(fb([])) }))).isCorrect).toBe(false);
  });

  it("counts words on whitespace", () => {
    expect(countWords("  one two\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** (`src/lib/grading/judge.ts`)

```ts
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { CompleteArgs } from "../llm/types";
import { translationFeedbackPrompt } from "../prompts/translationFeedback";
import { TRANSLATION_ACCEPT, translationRequest } from "../prompts/translationJudge";
import { VARIANT_ACCEPT, variantRequest } from "../prompts/variantGate";
import { writingFeedbackPrompt } from "../prompts/writingFeedback";
import type { TypeSafeClient } from "../typesafe/client";
import type {
  Answer, AnswerOf, ContentOf, JudgeOutcome, LessonGrammar, LocalGrade, TranslationFeedback, WritingFeedback,
} from "./types";

export class GradingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradingUnavailableError";
  }
}

export interface JudgeDeps {
  /** Lazily created; null when TypeSafe is not configured. */
  jev: () => TypeSafeClient | null;
  askTranslation: (args: CompleteArgs) => Promise<TranslationFeedback>;
  askWriting: (args: CompleteArgs) => Promise<WritingFeedback>;
}

export interface JudgeContext {
  grammar: LessonGrammar | null;
  level: string;
}

export const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

const focusOf = (g: LessonGrammar | null) => (g ? { title: g.title, description: g.description } : null);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Final verdict. Jev problems never fail grading; Claude problems raise GradingUnavailableError. */
export async function runJudge(
  content: ExerciseContent,
  answer: Answer,
  local: LocalGrade,
  ctx: JudgeContext,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  if (local.needsJudge === "translation") return judgeTranslation(content as ContentOf<"translation">, answer as AnswerOf<"translation">, ctx, deps);
  if (local.needsJudge === "writing") return judgeWriting(content as ContentOf<"open_writing">, answer as AnswerOf<"open_writing">, ctx, deps);

  const base: JudgeOutcome = { isCorrect: local.isCorrect, parts: local.parts, gradedBy: "local" };
  if (local.variantCandidates.length === 0) return base;
  const jev = deps.jev();
  if (!jev) return base;

  const parts = local.parts.map((p) => ({ ...p }));
  const jevScores: Record<string, number> = {};
  for (const v of local.variantCandidates) {
    try {
      const res = await jev.systemOne(variantRequest(v));
      const score = res.answers.equivalent?.noul;
      if (typeof score !== "number") continue;
      jevScores[`variant_${v.part}`] = score;
      if (score >= VARIANT_ACCEPT) parts[v.part] = { ...parts[v.part], correct: true };
    } catch {
      // Jev is best effort: keep the strict local verdict for this part.
    }
  }
  if (Object.keys(jevScores).length === 0) return base;
  return { isCorrect: parts.every((p) => p.correct), parts, gradedBy: "jev", jevScores };
}

async function judgeTranslation(
  c: ContentOf<"translation">,
  a: AnswerOf<"translation">,
  ctx: JudgeContext,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  let jevCategory: string | null = null;
  let jevScores: Record<string, number> | undefined;
  const jev = deps.jev();
  if (jev) {
    try {
      const res = await jev.systemOne(translationRequest(c, a.text));
      const acceptable = res.answers.acceptable?.noul;
      const errorType = res.answers.error_type;
      if (typeof acceptable === "number") {
        jevScores = { acceptable, ...(errorType ? { error_type_confidence: errorType.confidence } : {}) };
        jevCategory = errorType?.choice ?? null;
        if (acceptable >= TRANSLATION_ACCEPT) {
          return { isCorrect: true, parts: [{ correct: true, given: a.text, expected: c.reference }], gradedBy: "jev", jevScores };
        }
      }
    } catch {
      // fall through to Claude
    }
  }

  let fb: TranslationFeedback;
  try {
    fb = await deps.askTranslation(
      translationFeedbackPrompt({ source: c.source, reference: c.reference, answer: a.text, jevCategory, grammar: focusOf(ctx.grammar), level: ctx.level }),
    );
  } catch (e) {
    throw new GradingUnavailableError(`Translation feedback failed: ${messageOf(e)}`);
  }
  return {
    isCorrect: fb.isCorrect,
    parts: [{ correct: fb.isCorrect, given: a.text, expected: c.reference }],
    gradedBy: "claude",
    translation: fb,
    ...(jevScores ? { jevScores } : {}),
  };
}

async function judgeWriting(
  c: ContentOf<"open_writing">,
  a: AnswerOf<"open_writing">,
  ctx: JudgeContext,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  let fb: WritingFeedback;
  try {
    fb = await deps.askWriting(writingFeedbackPrompt({ prompt: c.prompt, text: a.text, minWords: c.minWords, grammar: focusOf(ctx.grammar), level: ctx.level }));
  } catch (e) {
    throw new GradingUnavailableError(`Writing feedback failed: ${messageOf(e)}`);
  }
  const wordCount = countWords(a.text);
  const isCorrect = wordCount >= c.minWords && !fb.corrections.some((k) => k.severity === "major");
  return { isCorrect, parts: [{ correct: isCorrect, given: a.text, expected: "" }], gradedBy: "claude", writing: { ...fb, wordCount } };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (12 tests). If `tsc` objects to `res.answers.equivalent?.noul` / `error_type?.choice` optional chaining on non-optional types, drop the `?.` and keep the `typeof … === "number"` guard (a malformed answer must never be treated as 0 — M3b-2 finding).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/judge.ts src/lib/grading/judge.test.ts
git commit -m "feat(m3c): judge - Jev for variants and translations, Claude for feedback" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 7: Error entries — one per cause

**Files:**
- Create: `src/lib/grading/errorEntries.ts`
- Test: `src/lib/grading/errorEntries.test.ts`

**Interfaces:**
- Consumes: `vocabOutcomes` (Task 3); `ErrorEntry`, `JudgeOutcome`, `LessonGrammar` (Task 1).
- Produces: `errorEntries(content: ExerciseContent, judged: JudgeOutcome, grammar: LessonGrammar | null, vocab: { id: string; headword: string }[]): ErrorEntry[]`; `EXAMPLE_MAX = 200`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "../lesson/fixtures";
import { errorEntries } from "./errorEntries";
import type { JudgeOutcome, WritingCorrection } from "./types";

const grammar = { id: "g1", title: "Past Perfect (had done)", description: "had + past participle" };
const wrong = (given: string, expected: string): JudgeOutcome => ({ isCorrect: false, parts: [{ correct: false, given, expected }], gradedBy: "local" });

describe("errorEntries", () => {
  it("returns nothing for a correct answer", () => {
    expect(errorEntries(E.MULTIPLE_CHOICE, { isCorrect: true, parts: [], gradedBy: "local" }, grammar, FIXTURE_VOCAB)).toEqual([]);
  });

  it("attributes a wrong grammar exercise to the lesson focus", () => {
    expect(errorEntries(E.MULTIPLE_CHOICE, wrong("finishing", "had finished"), grammar, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: "g1", category: "Past Perfect (had done)", source: "EXERCISE", example: "finishing -> had finished" },
    ]);
  });

  it("uses answer-zone words, then 'general', in a lesson without grammar", () => {
    const cloze = {
      type: "cloze_mc", text: "The ___ is on Friday.", gaps: [{ options: ["deadline", "dead"], answer: 0 }],
      explain: "Deadline is the noun.", vocab: ["v1"],
    } as ExerciseContent;
    expect(errorEntries(cloze, wrong("dead", "deadline"), null, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: null, category: "vocab: deadline", source: "EXERCISE", example: "dead -> deadline" },
    ]);
    expect(errorEntries(E.MULTIPLE_CHOICE, wrong("finishing", "had finished"), null, FIXTURE_VOCAB)[0].category).toBe("general");
  });

  it("gives each wrong match pair its own vocab cause", () => {
    const judged: JudgeOutcome = {
      isCorrect: false, gradedBy: "local",
      parts: [
        { correct: true, given: "frankly = to be honest", expected: "frankly = to be honest" },
        { correct: false, given: "broke = a person you work with", expected: "broke = with no money" },
        { correct: false, given: "colleague = with no money", expected: "colleague = a person you work with" },
      ],
    };
    expect(errorEntries(E.MATCH, judged, grammar, FIXTURE_VOCAB).map((e) => e.category)).toEqual(["vocab: broke", "vocab: colleague"]);
  });

  it("files dictation under listening/spelling", () => {
    expect(errorEntries(E.DICTATION, wrong("I'd like a cofee", "I'd like a coffee, please."), grammar, FIXTURE_VOCAB)[0].category).toBe("listening/spelling");
  });

  it("uses the Claude category for a translation, or the focus when it relates to it", () => {
    const tr = (relatesToFocus: boolean): JudgeOutcome => ({
      ...wrong("I finished report", "I finished the report before the deadline."), gradedBy: "claude",
      translation: { isCorrect: false, corrected: "I finished the report", explanation: "Use the article.", category: "word_order", relatesToFocus },
    });
    expect(errorEntries(E.TRANSLATION, tr(false), grammar, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: null, category: "translation: word order", source: "EXERCISE", example: "I finished report -> I finished the report" },
    ]);
    expect(errorEntries(E.TRANSLATION, tr(true), grammar, FIXTURE_VOCAB)[0].grammarTopicId).toBe("g1");
  });

  it("records only major writing corrections, one entry per cause", () => {
    const k = (over: Partial<WritingCorrection>): WritingCorrection => ({ original: "I miss", corrected: "I missed", explanation: "Past simple here.", category: "grammar", severity: "major", relatesToFocus: false, ...over });
    const judged: JudgeOutcome = {
      isCorrect: false, parts: [{ correct: false, given: "text", expected: "" }], gradedBy: "claude",
      writing: { summary: "Some tense errors.", wordCount: 70, corrections: [k({}), k({ original: "he go", corrected: "he went" }), k({ severity: "minor", category: "style" })] },
    };
    expect(errorEntries(E.OPEN_WRITING, judged, grammar, FIXTURE_VOCAB)).toEqual([
      { grammarTopicId: null, category: "writing: grammar", source: "WRITING", example: "I miss -> I missed" },
    ]);
  });

  it("clips long examples", () => {
    const e = errorEntries(E.MULTIPLE_CHOICE, wrong("x".repeat(300), "y"), grammar, FIXTURE_VOCAB)[0];
    expect(e.example.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** (`src/lib/grading/errorEntries.ts`)

```ts
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { vocabOutcomes } from "./answerZone";
import type { ErrorEntry, JudgeOutcome, LessonGrammar } from "./types";

export const EXAMPLE_MAX = 200;
const clip = (s: string): string => (s.length > EXAMPLE_MAX ? s.slice(0, EXAMPLE_MAX - 3) + "..." : s);
const pretty = (category: string): string => category.replace(/_/g, " ");

/** Types whose mistakes are attributed to the lesson's grammar focus (SPEC: lesson-grained attribution). */
const FOCUS_TYPES = new Set(["mcq", "cloze_mc", "open_cloze", "error_correct", "dialogue_gap", "word_bank"]);

/** Causes of a wrong answer, one entry per cause (ErrorRecords are aggregated per lesson and cause). */
export function errorEntries(
  c: ExerciseContent,
  judged: JudgeOutcome,
  grammar: LessonGrammar | null,
  vocab: { id: string; headword: string }[],
): ErrorEntry[] {
  if (judged.isCorrect) return [];
  const firstWrong = judged.parts.find((p) => !p.correct);
  const example = firstWrong ? clip(`${firstWrong.given} -> ${firstWrong.expected}`) : "";
  const focus = (ex: string, source: ErrorEntry["source"] = "EXERCISE"): ErrorEntry => ({
    grammarTopicId: grammar!.id,
    category: grammar!.title,
    source,
    example: ex,
  });
  const other = (category: string, ex: string, source: ErrorEntry["source"] = "EXERCISE"): ErrorEntry => ({ grammarTopicId: null, category, source, example: ex });

  let entries: ErrorEntry[] = [];
  if (FOCUS_TYPES.has(c.type)) {
    if (grammar) entries = [focus(example)];
    else {
      const headwords = new Map(vocab.map((v) => [v.id, v.headword]));
      const missed = vocabOutcomes(c, judged, vocab).filter((o) => !o.correct);
      entries = missed.length ? missed.map((o) => other(`vocab: ${headwords.get(o.id)}`, example)) : [other("general", example)];
    }
  } else if (c.type === "match") {
    entries = judged.parts.flatMap((p, i) => (p.correct ? [] : [other(`vocab: ${c.left[i]}`, clip(`${p.given} -> ${p.expected}`))]));
  } else if (c.type === "dictation") {
    entries = [other("listening/spelling", example)];
  } else if (c.type === "translation") {
    const fb = judged.translation;
    const ex = clip(`${judged.parts[0]?.given ?? ""} -> ${fb?.corrected ?? c.reference}`);
    entries = [fb?.relatesToFocus && grammar ? focus(ex) : other(`translation: ${pretty(fb && fb.category !== "none" ? fb.category : "meaning")}`, ex)];
  } else if (c.type === "open_writing") {
    entries = (judged.writing?.corrections ?? [])
      .filter((k) => k.severity === "major")
      .map((k) => {
        const ex = clip(`${k.original} -> ${k.corrected}`);
        return k.relatesToFocus && grammar ? focus(ex, "WRITING") : other(`writing: ${pretty(k.category)}`, ex, "WRITING");
      });
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.grammarTopicId ?? ""}|${e.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (8 tests).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/errorEntries.ts src/lib/grading/errorEntries.test.ts
git commit -m "feat(m3c): error entries - one cause per mistake, lesson-grained grammar attribution" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 8: Migration and `recordAnswer`

**Files:**
- Modify: `prisma/schema.prisma` (`model Exercise`)
- Create: `prisma/migrations/<timestamp>_m3c_answer_result/migration.sql` (generated), `src/lib/grading/recordAnswer.ts`
- Test: `src/lib/grading/recordAnswer.test.ts`

**Interfaces:**
- Consumes: `nextVocabState`, `withoutCredited`, `VocabStatusName` (Task 3); Task 1 types.
- Produces: `Exercise.result: Json | null`, `Exercise.answeredAt: Date | null`; `type RecordAnswerDb = Pick<PrismaClient, "$transaction">`; `MAX_EXAMPLES = 5`; `appendExample(description: string, example: string): string`; `feedbackText(r: GradeResult): string`; `interface RecordInput { exerciseId: string; lessonId: string; answer: Answer; result: GradeResult; vocab: VocabOutcome[]; errors: ErrorEntry[]; now: Date }`; `type RecordOutcome = { recorded: true; result: GradeResult } | { recorded: false }`; `recordAnswer(db: RecordAnswerDb, input: RecordInput): Promise<RecordOutcome>`.

- [ ] **Step 1: Migration**

In `model Exercise`, after `errorRecordId`:

```prisma
  result        Json? // GradeResult (M3c) - verdict, key, feedback, vocab credit; null until answered
  answeredAt    DateTime? // set once; a second submit returns the stored result
```

Then `npx prisma format`, `npm run db:start`, `npx prisma migrate dev --name m3c_answer_result`. Expected: two `ALTER TABLE "Exercise" ADD COLUMN` statements only. Drift or reset prompt → STOP and report.

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { appendExample, feedbackText, recordAnswer, type RecordAnswerDb, type RecordInput } from "./recordAnswer";
import type { GradeResult } from "./types";

const now = new Date("2026-09-25T10:00:00Z");
const result: GradeResult = {
  version: 1, exerciseId: "e1", isCorrect: false, parts: [{ correct: false, given: "finishing", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Past perfect for an earlier past action.", feedback: null, gradedBy: "local", vocabCredit: [],
};
const input = (over: Partial<RecordInput> = {}): RecordInput => ({
  exerciseId: "e1", lessonId: "L1", answer: { type: "mcq", selected: 2 }, result,
  vocab: [{ id: "v1", correct: false }],
  errors: [{ grammarTopicId: "g1", category: "Past Perfect (had done)", source: "EXERCISE", example: "finishing -> had finished" }],
  now, ...over,
});

function fakeDb(over: { others?: unknown[]; count?: number; vocabRow?: unknown; existingError?: unknown } = {}) {
  const log: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, value: unknown) =>
    vi.fn(async (args: unknown) => {
      log.push(name);
      (calls[name] ??= []).push(args);
      return value;
    });
  const tx = {
    exercise: { findMany: rec("exercise.findMany", over.others ?? []), updateMany: rec("exercise.updateMany", { count: over.count ?? 1 }) },
    lesson: { updateMany: rec("lesson.updateMany", { count: 1 }) },
    vocabItem: { findUnique: rec("vocabItem.findUnique", over.vocabRow ?? { status: "KNOWN", correctStreak: 4 }), update: rec("vocabItem.update", {}) },
    errorRecord: { findFirst: rec("errorRecord.findFirst", over.existingError ?? null), create: rec("errorRecord.create", {}), update: rec("errorRecord.update", {}) },
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as unknown as RecordAnswerDb;
  return { db, log, calls };
}

describe("recordAnswer", () => {
  it("writes answer, lesson status, vocab and error in one transaction, in order", async () => {
    const f = fakeDb();
    const out = await recordAnswer(f.db, input());
    expect(out).toMatchObject({ recorded: true });
    expect(f.log).toEqual([
      "exercise.findMany", "exercise.updateMany", "lesson.updateMany",
      "vocabItem.findUnique", "vocabItem.update", "errorRecord.findFirst", "errorRecord.create",
    ]);
    expect(f.calls["exercise.updateMany"][0]).toMatchObject({
      where: { id: "e1", answeredAt: null },
      data: { userAnswer: JSON.stringify({ selected: 2 }), isCorrect: false, feedback: "Past perfect for an earlier past action.", answeredAt: now },
    });
    expect(f.calls["lesson.updateMany"][0]).toEqual({ where: { id: "L1", status: "PLANNED" }, data: { status: "IN_PROGRESS" } });
    expect(f.calls["vocabItem.update"][0]).toEqual({ where: { id: "v1" }, data: { status: "LEARNING", correctStreak: 0, lastSeenAt: now } });
    expect(f.calls["errorRecord.create"][0]).toEqual({
      data: {
        lessonId: "L1", grammarTopicId: "g1", category: "Past Perfect (had done)", description: "- finishing -> had finished",
        source: "EXERCISE", status: "NEW", nextReviewAt: new Date("2026-09-26T10:00:00Z"),
      },
    });
  });

  it("does not credit a word already credited in this lesson", async () => {
    const f = fakeDb({ others: [{ result: { vocabCredit: [{ id: "v1", correct: true }] } }] });
    const out = await recordAnswer(f.db, input());
    expect(f.calls["vocabItem.update"]).toBeUndefined();
    expect(out.recorded && out.result.vocabCredit).toEqual([]);
  });

  it("appends to an existing error record of the same cause", async () => {
    const f = fakeDb({ existingError: { id: "r1", description: "- a -> b" } });
    await recordAnswer(f.db, input());
    expect(f.calls["errorRecord.update"][0]).toEqual({ where: { id: "r1" }, data: { description: "- a -> b\n- finishing -> had finished" } });
    expect(f.calls["errorRecord.create"]).toBeUndefined();
  });

  it("does nothing when the exercise was answered meanwhile", async () => {
    const f = fakeDb({ count: 0 });
    expect(await recordAnswer(f.db, input())).toEqual({ recorded: false });
    expect(f.log).toEqual(["exercise.findMany", "exercise.updateMany"]);
  });
});

describe("appendExample / feedbackText", () => {
  it("keeps the last five examples", () => {
    let d = "";
    for (let i = 1; i <= 7; i++) d = appendExample(d, `e${i}`);
    expect(d.split("\n")).toEqual(["- e3", "- e4", "- e5", "- e6", "- e7"]);
  });
  it("prefers the judge explanation, then the writing summary, then the exercise explain", () => {
    expect(feedbackText(result)).toBe(result.explain);
    expect(feedbackText({ ...result, feedback: { explanation: "Use the article." } })).toBe("Use the article.");
    expect(feedbackText({ ...result, feedback: { summary: "Nice text overall." } })).toBe("Nice text overall.");
  });
});
```

- [ ] **Step 3: Run to verify it fails** — module missing.

- [ ] **Step 4: Implement** (`src/lib/grading/recordAnswer.ts`)

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { nextVocabState, withoutCredited, type VocabStatusName } from "./answerZone";
import type { Answer, ErrorEntry, GradeResult, VocabOutcome } from "./types";

export type RecordAnswerDb = Pick<PrismaClient, "$transaction">;
export const MAX_EXAMPLES = 5;
const DAY_MS = 86_400_000;

export function appendExample(description: string, example: string): string {
  const lines = description.split("\n").filter(Boolean);
  lines.push(`- ${example}`);
  return lines.slice(-MAX_EXAMPLES).join("\n");
}

export function feedbackText(r: GradeResult): string {
  return r.feedback?.explanation ?? r.feedback?.summary ?? r.explain;
}

export interface RecordInput {
  exerciseId: string;
  lessonId: string;
  answer: Answer;
  result: GradeResult;
  vocab: VocabOutcome[];
  errors: ErrorEntry[];
  now: Date;
}

export type RecordOutcome = { recorded: true; result: GradeResult } | { recorded: false };

/** One transaction, sequential queries, no network. Writes the exercise only if it is still unanswered. */
export async function recordAnswer(db: RecordAnswerDb, input: RecordInput): Promise<RecordOutcome> {
  return db.$transaction(async (tx) => {
    const others = await tx.exercise.findMany({
      where: { lessonId: input.lessonId, answeredAt: { not: null }, NOT: { id: input.exerciseId } },
      select: { result: true },
    });
    const credited = new Set<string>();
    for (const o of others) {
      for (const v of (o.result as { vocabCredit?: VocabOutcome[] } | null)?.vocabCredit ?? []) credited.add(v.id);
    }
    const result: GradeResult = { ...input.result, vocabCredit: withoutCredited(input.vocab, credited) };
    const { type: _type, ...raw } = input.answer;

    const updated = await tx.exercise.updateMany({
      where: { id: input.exerciseId, answeredAt: null },
      data: {
        userAnswer: JSON.stringify(raw),
        isCorrect: result.isCorrect,
        feedback: feedbackText(result),
        result: result as unknown as Prisma.InputJsonValue,
        answeredAt: input.now,
      },
    });
    if (updated.count === 0) return { recorded: false } as const;

    await tx.lesson.updateMany({ where: { id: input.lessonId, status: "PLANNED" }, data: { status: "IN_PROGRESS" } });

    for (const v of result.vocabCredit) {
      const row = await tx.vocabItem.findUnique({ where: { id: v.id }, select: { status: true, correctStreak: true } });
      if (!row) continue;
      const next = nextVocabState({ status: row.status as VocabStatusName, correctStreak: row.correctStreak }, v.correct);
      await tx.vocabItem.update({ where: { id: v.id }, data: { ...next, lastSeenAt: input.now } });
    }

    for (const e of input.errors) {
      const existing = await tx.errorRecord.findFirst({
        where: { lessonId: input.lessonId, grammarTopicId: e.grammarTopicId, category: e.category },
        select: { id: true, description: true },
      });
      if (existing) {
        await tx.errorRecord.update({ where: { id: existing.id }, data: { description: appendExample(existing.description, e.example) } });
      } else {
        await tx.errorRecord.create({
          data: {
            lessonId: input.lessonId, grammarTopicId: e.grammarTopicId, category: e.category,
            description: appendExample("", e.example), source: e.source, status: "NEW",
            nextReviewAt: new Date(input.now.getTime() + DAY_MS),
          },
        });
      }
    }
    return { recorded: true, result } as const;
  });
}
```

- [ ] **Step 5: Run to verify it passes** — PASS (6 tests); `npx tsc --noEmit` (run `npx prisma generate` if the new columns are unknown to the client).

- [ ] **Step 6: Commit**

```powershell
npm test
git add prisma/schema.prisma prisma/migrations src/lib/grading/recordAnswer.ts src/lib/grading/recordAnswer.test.ts
git commit -m "feat(m3c): Exercise.result/answeredAt and transactional recordAnswer" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 9: `checkAnswer` orchestration

**Files:**
- Create: `src/lib/grading/checkAnswer.ts`
- Test: `src/lib/grading/checkAnswer.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8; `parseExercise` (`src/lib/lesson/exerciseSchemas.ts`); `type LessonPlan` (`src/lib/lesson/createLesson.ts`, `meta.grammarTopicId`); `prisma` (`src/lib/db.ts`).
- Produces: `class ExerciseNotFoundError`, `class InvalidAnswerError`; `type CheckAnswerDb = Pick<PrismaClient, "exercise" | "grammarTopic" | "vocabItem" | "profile" | "$transaction">`; `interface CheckDeps { db?: CheckAnswerDb; judge: JudgeDeps; now?: Date; dryRun?: boolean }`; `type CheckResult = GradeResult & { alreadyAnswered: boolean }`; `checkAnswer(exerciseId: string, raw: unknown, deps: CheckDeps): Promise<CheckResult>`; `buildResult(exerciseId, explain, correctAnswer, judged, vocabCredit): GradeResult`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { VALID_EXERCISES as E } from "../lesson/fixtures";
import { checkAnswer, ExerciseNotFoundError, InvalidAnswerError, type CheckAnswerDb } from "./checkAnswer";
import type { JudgeDeps } from "./judge";

const now = new Date("2026-09-25T10:00:00Z");
const judge: JudgeDeps = { jev: () => null, askTranslation: vi.fn(), askWriting: vi.fn() };

function fakeDb(exerciseRows: unknown[], txCount = 1) {
  const tx = {
    exercise: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: txCount })) },
    lesson: { updateMany: vi.fn(async () => ({ count: 1 })) },
    vocabItem: { findUnique: vi.fn(async () => ({ status: "SEEN", correctStreak: 0 })), update: vi.fn(async () => ({})) },
    errorRecord: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  };
  const findUnique = vi.fn();
  for (const r of exerciseRows) findUnique.mockResolvedValueOnce(r);
  const db = {
    exercise: { findUnique },
    grammarTopic: { findUnique: vi.fn(async () => ({ id: "g1", name: "RAW", title: "Past Perfect (had done)", description: "had + pp" })) },
    vocabItem: { findMany: vi.fn(async () => [{ id: "v1", headword: "deadline" }]) },
    profile: { findFirst: vi.fn(async () => ({ level: "B1" })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db: db as unknown as CheckAnswerDb, raw: db, tx };
}
const row = (id: string, content: unknown, over: Record<string, unknown> = {}) => ({
  id, lessonId: "L1", content, answeredAt: null, result: null, lesson: { plan: { meta: { grammarTopicId: "g1" } } }, ...over,
});

describe("checkAnswer", () => {
  it("throws ExerciseNotFoundError for an unknown id", async () => {
    const f = fakeDb([null]);
    await expect(checkAnswer("nope", { selected: 0 }, { db: f.db, judge, now })).rejects.toBeInstanceOf(ExerciseNotFoundError);
  });

  it("rejects a malformed answer without writing anything", async () => {
    const f = fakeDb([row("e-bad", E.MULTIPLE_CHOICE)]);
    await expect(checkAnswer("e-bad", { selected: 9 }, { db: f.db, judge, now })).rejects.toBeInstanceOf(InvalidAnswerError);
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("grades, records and returns a correct answer", async () => {
    const f = fakeDb([row("e-ok", E.MULTIPLE_CHOICE)]);
    const out = await checkAnswer("e-ok", { selected: 1 }, { db: f.db, judge, now });
    expect(out).toMatchObject({ exerciseId: "e-ok", isCorrect: true, gradedBy: "local", correctAnswer: "had finished", alreadyAnswered: false });
    expect(f.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.lesson.updateMany).toHaveBeenCalled();
    expect(f.tx.errorRecord.create).not.toHaveBeenCalled();
  });

  it("records a wrong answer under the lesson grammar focus", async () => {
    const f = fakeDb([row("e-wrong", E.MULTIPLE_CHOICE)]);
    await checkAnswer("e-wrong", { selected: 2 }, { db: f.db, judge, now });
    expect(f.tx.errorRecord.create.mock.calls[0][0]).toMatchObject({ data: { grammarTopicId: "g1", category: "Past Perfect (had done)" } });
  });

  it("returns the stored result for an answered exercise without grading again", async () => {
    const stored = { version: 1, exerciseId: "e-done", isCorrect: true };
    const f = fakeDb([row("e-done", E.MULTIPLE_CHOICE, { answeredAt: now, result: stored })]);
    expect(await checkAnswer("e-done", { selected: 0 }, { db: f.db, judge, now })).toEqual({ ...stored, alreadyAnswered: true });
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("returns the stored result when another request recorded the answer first", async () => {
    const stored = { version: 1, exerciseId: "e-race", isCorrect: false };
    const f = fakeDb([row("e-race", E.MULTIPLE_CHOICE), { result: stored }], 0);
    expect(await checkAnswer("e-race", { selected: 1 }, { db: f.db, judge, now })).toEqual({ ...stored, alreadyAnswered: true });
  });

  it("dry-run grades an answered exercise again and never writes", async () => {
    const f = fakeDb([row("e-dry", E.MULTIPLE_CHOICE, { answeredAt: now, result: {} })]);
    const out = await checkAnswer("e-dry", { selected: 1 }, { db: f.db, judge, now, dryRun: true });
    expect(out).toMatchObject({ isCorrect: true, alreadyAnswered: false });
    expect(f.raw.$transaction).not.toHaveBeenCalled();
  });

  it("single-flights concurrent submits of the same exercise", async () => {
    const f = fakeDb([row("e-twice", E.MULTIPLE_CHOICE)]);
    const [a, b] = await Promise.all([
      checkAnswer("e-twice", { selected: 1 }, { db: f.db, judge, now }),
      checkAnswer("e-twice", { selected: 1 }, { db: f.db, judge, now }),
    ]);
    expect(a).toEqual(b);
    expect(f.raw.exercise.findUnique).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** (`src/lib/grading/checkAnswer.ts`)

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import type { LessonPlan } from "../lesson/createLesson";
import { parseExercise } from "../lesson/exerciseSchemas";
import { parseAnswer } from "./answerSchemas";
import { vocabOutcomes } from "./answerZone";
import { errorEntries } from "./errorEntries";
import { gradeLocally } from "./graders";
import { runJudge, type JudgeDeps } from "./judge";
import { recordAnswer } from "./recordAnswer";
import type { GradeFeedback, GradeResult, JudgeOutcome, LessonGrammar, VocabOutcome } from "./types";

export class ExerciseNotFoundError extends Error {
  constructor(id: string) {
    super(`Exercise ${id} not found`);
    this.name = "ExerciseNotFoundError";
  }
}

export class InvalidAnswerError extends Error {
  constructor(reason: string) {
    super(`Invalid answer: ${reason}`);
    this.name = "InvalidAnswerError";
  }
}

export type CheckAnswerDb = Pick<PrismaClient, "exercise" | "grammarTopic" | "vocabItem" | "profile" | "$transaction">;

export interface CheckDeps {
  db?: CheckAnswerDb;
  judge: JudgeDeps;
  now?: Date;
  /** Grade without reading answeredAt and without writing (acceptance tool). */
  dryRun?: boolean;
}

export type CheckResult = GradeResult & { alreadyAnswered: boolean };

const inFlight = new Map<string, Promise<CheckResult>>();

/** POST /api/exercise/check. One attempt per exercise; concurrent submits share one grading. */
export function checkAnswer(exerciseId: string, raw: unknown, deps: CheckDeps): Promise<CheckResult> {
  if (deps.dryRun) return runCheck(exerciseId, raw, deps);
  const running = inFlight.get(exerciseId);
  if (running) return running;
  const p = runCheck(exerciseId, raw, deps).finally(() => inFlight.delete(exerciseId));
  inFlight.set(exerciseId, p);
  return p;
}

export function buildResult(
  exerciseId: string,
  explain: string,
  correctAnswer: string,
  judged: JudgeOutcome,
  vocabCredit: VocabOutcome[],
): GradeResult {
  let feedback: GradeFeedback | null = null;
  if (judged.translation) {
    feedback = { corrected: judged.translation.corrected, explanation: judged.translation.explanation, category: judged.translation.category };
  }
  if (judged.writing) {
    feedback = { summary: judged.writing.summary, corrections: judged.writing.corrections, wordCount: judged.writing.wordCount };
  }
  return {
    version: 1, exerciseId, isCorrect: judged.isCorrect, parts: judged.parts, correctAnswer, explain, feedback,
    gradedBy: judged.gradedBy, vocabCredit, ...(judged.jevScores ? { jevScores: judged.jevScores } : {}),
  };
}

async function runCheck(exerciseId: string, raw: unknown, deps: CheckDeps): Promise<CheckResult> {
  const db = deps.db ?? (prisma as unknown as CheckAnswerDb);
  const now = deps.now ?? new Date();

  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { id: true, lessonId: true, content: true, answeredAt: true, result: true, lesson: { select: { plan: true } } },
  });
  if (!ex) throw new ExerciseNotFoundError(exerciseId);
  if (ex.answeredAt && !deps.dryRun) return { ...(ex.result as unknown as GradeResult), alreadyAnswered: true };

  const parsed = parseExercise(ex.content);
  if (!parsed.ok) throw new Error(`Stored exercise ${exerciseId} is invalid: ${parsed.reason}`);
  const content = parsed.content;
  const ans = parseAnswer(content, raw);
  if (!ans.ok) throw new InvalidAnswerError(ans.reason);

  const grammarTopicId = (ex.lesson.plan as unknown as LessonPlan | null)?.meta?.grammarTopicId ?? null;
  const grammar = await loadGrammar(db, grammarTopicId);
  const profile = await db.profile.findFirst({ orderBy: { updatedAt: "desc" }, select: { level: true } });
  const vocab = content.vocab.length
    ? await db.vocabItem.findMany({ where: { id: { in: content.vocab } }, select: { id: true, headword: true } })
    : [];

  const local = gradeLocally(content, ans.answer);
  const judged = await runJudge(content, ans.answer, local, { grammar, level: profile?.level ?? "B1" }, deps.judge);
  const result = buildResult(exerciseId, content.explain, local.correctAnswer, judged, vocabOutcomes(content, judged, vocab));
  if (deps.dryRun) return { ...result, alreadyAnswered: false };

  const outcome = await recordAnswer(db, {
    exerciseId, lessonId: ex.lessonId, answer: ans.answer, result, vocab: result.vocabCredit,
    errors: errorEntries(content, judged, grammar, vocab), now,
  });
  if (!outcome.recorded) {
    const stored = await db.exercise.findUnique({ where: { id: exerciseId }, select: { result: true } });
    return { ...(stored?.result as unknown as GradeResult), alreadyAnswered: true };
  }
  return { ...outcome.result, alreadyAnswered: false };
}

async function loadGrammar(db: CheckAnswerDb, id: string | null): Promise<LessonGrammar | null> {
  if (!id) return null;
  const t = await db.grammarTopic.findUnique({ where: { id }, select: { id: true, name: true, title: true, description: true } });
  return t ? { id: t.id, title: t.title ?? t.name, description: t.description ?? "" } : null;
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (8 tests). Test ids are unique per test on purpose (the in-flight map is module state).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/checkAnswer.ts src/lib/grading/checkAnswer.test.ts
git commit -m "feat(m3c): checkAnswer - parse, grade, judge, record; single-flight and dry-run" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 10: Live judge deps + acceptance script (⛔ owner review gate)

**Files:**
- Create: `src/lib/grading/liveJudgeDeps.ts`, `src/lib/grading/liveJudgeDeps.test.ts`, `scripts/answer-preview.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `completeJson` (`src/lib/llm/index.ts`), Task 5 schemas, `createTypeSafeClient`, Task 6 `JudgeDeps`/`runJudge`, Task 9 `checkAnswer`/`buildResult`, Tasks 1–3.
- Produces: `liveJudgeDeps(): JudgeDeps`; `npm run answer:check`.

- [ ] **Step 1: Write the failing test** (`src/lib/grading/liveJudgeDeps.test.ts`)

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm/index", () => ({ completeJson: vi.fn().mockResolvedValue({}) }));
vi.mock("../typesafe/client", () => ({ createTypeSafeClient: vi.fn() }));

import { completeJson } from "../llm/index";
import { translationFeedbackSchema } from "../prompts/translationFeedback";
import { writingFeedbackSchema } from "../prompts/writingFeedback";
import { createTypeSafeClient } from "../typesafe/client";
import { liveJudgeDeps } from "./liveJudgeDeps";

beforeEach(() => vi.clearAllMocks());
const args = { system: "s", messages: [{ role: "user" as const, content: "u" }] };

describe("liveJudgeDeps", () => {
  it("routes translation and writing feedback through the facade with their roles and schemas", async () => {
    const d = liveJudgeDeps();
    await d.askTranslation(args);
    await d.askWriting(args);
    expect(completeJson).toHaveBeenNthCalledWith(1, "translation_check", args, translationFeedbackSchema);
    expect(completeJson).toHaveBeenNthCalledWith(2, "writing_feedback", args, writingFeedbackSchema);
  });

  it("creates the Jev client once, lazily", () => {
    const client = { systemOne: vi.fn() };
    vi.mocked(createTypeSafeClient).mockReturnValue(client as never);
    const d = liveJudgeDeps();
    expect(createTypeSafeClient).not.toHaveBeenCalled();
    expect(d.jev()).toBe(client);
    expect(d.jev()).toBe(client);
    expect(createTypeSafeClient).toHaveBeenCalledTimes(1);
  });

  it("returns null when the key is missing", () => {
    vi.mocked(createTypeSafeClient).mockImplementation(() => {
      throw new Error("TYPESAFE_API_KEY is not set");
    });
    expect(liveJudgeDeps().jev()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement `src/lib/grading/liveJudgeDeps.ts`:

```ts
import { completeJson } from "../llm/index";
import { translationFeedbackSchema } from "../prompts/translationFeedback";
import { writingFeedbackSchema } from "../prompts/writingFeedback";
import { createTypeSafeClient, type TypeSafeClient } from "../typesafe/client";
import type { JudgeDeps } from "./judge";

/** Real Jev + Claude for the route and the acceptance script. Jev is optional by design. */
export function liveJudgeDeps(): JudgeDeps {
  let client: TypeSafeClient | null | undefined;
  return {
    jev: () => {
      if (client === undefined) {
        try {
          client = createTypeSafeClient();
        } catch {
          client = null;
        }
      }
      return client;
    },
    askTranslation: (args) => completeJson("translation_check", args, translationFeedbackSchema),
    askWriting: (args) => completeJson("writing_feedback", args, writingFeedbackSchema),
  };
}
```

Run: `npx vitest run src/lib/grading/liveJudgeDeps.test.ts` — PASS (3).

- [ ] **Step 3: Write the acceptance script** (`scripts/answer-preview.ts`)

```ts
/**
 * Acceptance tool for M3c: grade answers LIVE (Jev + Claude). NO DB WRITES.
 *   npm run answer:check                                         # list the latest lesson's exercises
 *   npm run answer:check -- --exercise 3 --answer "{\"text\":[\"colour\"]}"
 *   npm run answer:check -- --cases <file.json>
 * A cases file is an array of { "label": string, "exercise": number, "answer": object }
 * or { "label": string, "content": <exercise content>, "answer": object } (synthetic exercise).
 */
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

interface Case {
  label: string;
  exercise?: number;
  content?: unknown;
  answer: unknown;
}

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  if (process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is set - unset it (pay-per-token billing).");
  const { prisma } = await import("../src/lib/db");
  try {
    const { parseExercise } = await import("../src/lib/lesson/exerciseSchemas");
    const { parseAnswer } = await import("../src/lib/grading/answerSchemas");
    const { gradeLocally } = await import("../src/lib/grading/graders");
    const { runJudge } = await import("../src/lib/grading/judge");
    const { vocabOutcomes } = await import("../src/lib/grading/answerZone");
    const { checkAnswer, buildResult } = await import("../src/lib/grading/checkAnswer");
    const { liveJudgeDeps } = await import("../src/lib/grading/liveJudgeDeps");
    type Plan = { sections?: { written?: { exerciseIds?: string[] } }; meta?: { grammarTopicId?: string | null } };

    const lesson = await prisma.lesson.findFirst({ orderBy: [{ date: "desc" }, { id: "desc" }], select: { id: true, plan: true } });
    if (!lesson) throw new Error("No lesson in the DB - start one first.");
    const plan = lesson.plan as Plan;
    const ids = plan.sections?.written?.exerciseIds ?? [];
    const judge = liveJudgeDeps();

    const casesFile = argOf("--cases");
    const single = argOf("--exercise");
    if (!casesFile && !single) {
      for (const [n, id] of ids.entries()) {
        const ex = await prisma.exercise.findUnique({ where: { id }, select: { type: true, content: true } });
        console.log(`${n + 1}. ${ex?.type}  ${JSON.stringify(ex?.content).slice(0, 160)}`);
      }
      return;
    }
    const cases: Case[] = casesFile
      ? (JSON.parse(readFileSync(casesFile, "utf8")) as Case[])
      : [{ label: `exercise ${single}`, exercise: Number(single), answer: JSON.parse(argOf("--answer") ?? "{}") }];

    const topicId = plan.meta?.grammarTopicId ?? null;
    const topic = topicId ? await prisma.grammarTopic.findUnique({ where: { id: topicId } }) : null;
    const grammar = topic ? { id: topic.id, title: topic.title ?? topic.name, description: topic.description ?? "" } : null;
    const profile = await prisma.profile.findFirst({ select: { level: true } });

    for (const c of cases) {
      const started = Date.now();
      try {
        let result: unknown;
        if (c.exercise !== undefined) {
          result = await checkAnswer(ids[c.exercise - 1], c.answer, { judge, dryRun: true });
        } else {
          const parsed = parseExercise(c.content);
          if (!parsed.ok) throw new Error(`invalid synthetic content: ${parsed.reason}`);
          const ans = parseAnswer(parsed.content, c.answer);
          if (!ans.ok) throw new Error(`invalid answer: ${ans.reason}`);
          const local = gradeLocally(parsed.content, ans.answer);
          const judged = await runJudge(parsed.content, ans.answer, local, { grammar, level: profile?.level ?? "B1" }, judge);
          result = buildResult("synthetic", parsed.content.explain, local.correctAnswer, judged, vocabOutcomes(parsed.content, judged, []));
        }
        console.log(`\n=== ${c.label} (${Date.now() - started} ms)\n${JSON.stringify(result, null, 2)}`);
      } catch (e) {
        console.log(`\n=== ${c.label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

Add to `package.json` scripts: `"answer:check": "tsx scripts/answer-preview.ts"`.

- [ ] **Step 4: Type-check and test** — `npx tsc --noEmit; npm test` clean.

- [ ] **Step 5: Live calibration (paid calls; no DB writes)**

`npm run db:start`, then `npm run answer:check` to list the latest lesson's exercises. Write a cases file in the workspace (path in your dispatch) with ~12 cases matched to that lesson's actual exercises:
- typed variants on the lesson's `open_cloze` / `error_correct` / `dictation` (whichever exist): a British spelling (e.g. `organise` vs `organize`), a contraction vs full form, a same-meaning synonym, and a genuine error (wrong form) — expected: first three accepted by Jev, the last rejected;
- three translations of the lesson's `translation`: a correct paraphrase (expected: Jev-accepted, no Claude), a clearly wrong one (tense or article error), a borderline one (natural but with a small slip);
- one open writing: if the lesson has no `open_writing`, a synthetic `content` case (`{"type":"open_writing","prompt":"Describe your working day.","minWords":30,"explain":"Use the present simple for routines.","vocab":[]}`) with a ~40-word text containing one tense error.
Run `npm run answer:check -- --cases <file>` with the maximum command timeout. Save the full output next to the cases file.

- [ ] **Step 6: Judge the results yourself** — for each case: is the verdict right? is the corrected sentence minimal and correct? is the explanation right and understandable for B1? is the category sensible? were Jev scores confident where they should be? If a class of results is systematically off, tune the WORDING in `src/lib/prompts/variantGate.ts`, `translationJudge.ts`, `translationFeedback.ts` or `writingFeedback.ts` (keep their tests green) and re-run; at most 2 rounds. Do not change `VARIANT_ACCEPT` / `TRANSLATION_ACCEPT` without reporting why.

- [ ] **Step 7: Commit and STOP for owner review**

```powershell
npx tsc --noEmit; npm test
git add src/lib/grading/liveJudgeDeps.ts src/lib/grading/liveJudgeDeps.test.ts scripts/answer-preview.ts package.json
git commit -m "feat(m3c): live judge deps and answer:check acceptance script" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

(Add the prompt modules to the commit only if you tuned them.)

**⛔ GATE:** the controller presents the calibration results to the owner. **Task 11 starts only after the owner accepts them.**

---

### Task 11: Route, live end-to-end check, docs

**Precondition:** the owner accepted the calibration (Task 10 gate).

**Files:**
- Create: `src/app/api/exercise/check/route.ts`, `src/app/api/exercise/check/route.test.ts`
- Modify: `SPEC.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `checkAnswer`, `ExerciseNotFoundError`, `InvalidAnswerError` (Task 9); `GradingUnavailableError` (Task 6); `liveJudgeDeps` (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/grading/checkAnswer", async (orig) => ({
  ...(await orig<typeof import("@/lib/grading/checkAnswer")>()),
  checkAnswer: vi.fn(),
}));
vi.mock("@/lib/grading/liveJudgeDeps", () => ({ liveJudgeDeps: vi.fn(() => ({})) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { checkAnswer, ExerciseNotFoundError, InvalidAnswerError } from "@/lib/grading/checkAnswer";
import { GradingUnavailableError } from "@/lib/grading/judge";
import { POST } from "./route";

const req = (body: unknown) => new Request("http://localhost/api/exercise/check", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => vi.mocked(checkAnswer).mockReset());

describe("POST /api/exercise/check", () => {
  it("returns the grade", async () => {
    vi.mocked(checkAnswer).mockResolvedValue({ exerciseId: "e1", isCorrect: true, alreadyAnswered: false } as never);
    const res = await POST(req({ exerciseId: "e1", answer: { selected: 1 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isCorrect: true });
    expect(vi.mocked(checkAnswer).mock.calls[0].slice(0, 2)).toEqual(["e1", { selected: 1 }]);
  });

  it("maps a bad body and a malformed answer to 400", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({ answer: {} }))).status).toBe(400);
    vi.mocked(checkAnswer).mockRejectedValue(new InvalidAnswerError("selected: out of range"));
    expect((await POST(req({ exerciseId: "e1", answer: { selected: 9 } }))).status).toBe(400);
  });

  it("maps a missing exercise to 404 and an unavailable judge to 502", async () => {
    vi.mocked(checkAnswer).mockRejectedValueOnce(new ExerciseNotFoundError("e9"));
    expect((await POST(req({ exerciseId: "e9", answer: {} }))).status).toBe(404);
    vi.mocked(checkAnswer).mockRejectedValueOnce(new GradingUnavailableError("Translation feedback failed"));
    expect((await POST(req({ exerciseId: "e1", answer: { text: "x" } }))).status).toBe(502);
  });

  it("maps anything else to 500 without a stack", async () => {
    vi.mocked(checkAnswer).mockRejectedValue(new Error("connection refused"));
    const res = await POST(req({ exerciseId: "e1", answer: {} }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "connection refused" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement `src/app/api/exercise/check/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAnswer, ExerciseNotFoundError, InvalidAnswerError } from "@/lib/grading/checkAnswer";
import { GradingUnavailableError } from "@/lib/grading/judge";
import { liveJudgeDeps } from "@/lib/grading/liveJudgeDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ exerciseId: z.string().min(1), answer: z.unknown() });

/** Grade one answer. Keys and feedback are returned only after the answer is recorded. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body must be { exerciseId: string, answer: object }" }, { status: 400 });
  }
  try {
    return NextResponse.json(await checkAnswer(body.exerciseId, body.answer, { judge: liveJudgeDeps() }));
  } catch (e) {
    if (e instanceof InvalidAnswerError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof ExerciseNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof GradingUnavailableError) return NextResponse.json({ error: e.message }, { status: 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
```

Run the test — PASS (4).

- [ ] **Step 3: Live end-to-end check on the persisted lesson, then RESTORE it**

The owner keeps the `PLANNED` lesson for the future player, so this check must leave it exactly as it was. Use a non-interactive `psql` (see `scripts/db.ps1`). Let `L` = the latest lesson id.
1. **Before:** `SELECT count(*) FROM "ErrorRecord" WHERE "lessonId"='L';` (expect 0) and snapshot the lesson's vocab: `CREATE TABLE _m3c_vocab_snapshot AS SELECT id, status, "correctStreak", "lastSeenAt" FROM "VocabItem" WHERE id IN (SELECT jsonb_array_elements_text(plan->'meta'->'vocabIds') FROM "Lesson" WHERE id='L');`
2. `npm run build` (must pass); start `npm run dev` in the background (capture the PID into a variable NOT named `$pid` — that is PowerShell's read-only `$PID`); wait until `http://localhost:3000` answers.
3. POST to `/api/exercise/check`: (a) a CORRECT answer to the lesson's `MULTIPLE_CHOICE`; (b) a WRONG answer to its `TRANSLATION`; (c) the same request as (a) again → `alreadyAnswered: true`. Record status codes, bodies and timings.
4. **Verify in the DB:** the two exercises have `answeredAt`, `isCorrect`, `result`; the lesson is `IN_PROGRESS`; the vocab rows changed as the `vocabCredit` in the results says; `ErrorRecord` rows for the lesson (expect 1 for the wrong translation).
5. **Restore:** `UPDATE "Exercise" SET "userAnswer"=NULL, "isCorrect"=NULL, feedback=NULL, result=NULL, "answeredAt"=NULL WHERE "lessonId"='L'; DELETE FROM "ErrorRecord" WHERE "lessonId"='L'; UPDATE "Lesson" SET status='PLANNED' WHERE id='L'; UPDATE "VocabItem" v SET status=s.status, "correctStreak"=s."correctStreak", "lastSeenAt"=s."lastSeenAt" FROM _m3c_vocab_snapshot s WHERE v.id=s.id; DROP TABLE _m3c_vocab_snapshot;` — then show that the lesson is `PLANNED`, 0 answered exercises, 0 ErrorRecords, vocab equal to the snapshot values you printed in step 1.
6. Stop ONLY the dev-server process tree you started.

- [ ] **Step 4: Docs**

- `SPEC.md` §API Routes `POST /api/exercise/check`: replace the description with the M3c contract — body `{ exerciseId, answer }` (answer shapes per type, pointer to `src/lib/grading/answerSchemas.ts`); local grading for objective types; typed mismatches → Jev "equally correct?" (accept ≥ 0.8); translation → Jev (accept ≥ 0.8) else Claude `translation_check`; open writing → Claude `writing_feedback` (correct = enough words and no major correction); one attempt, repeated submit returns the stored result; 400/404/502 mapping; nothing recorded on 502.
- `SPEC.md` §Spaced repetition / vocab: vocab credit only for words in the answer zone, once per word per lesson; the status rule (`LEARNING`, `KNOWN` at streak 3, wrong → streak 0 and `KNOWN → LEARNING`). §Data model: `Exercise.result`, `Exercise.answeredAt`. ErrorRecords: one per cause per lesson, examples appended (last 5).
- `CLAUDE.md`: Commands — `npm run answer:check`; Milestone status — M3c ✅ (one line + spec pointer), M3d next.
Minimal, factual edits.

- [ ] **Step 5: Verify and commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/app/api/exercise/check SPEC.md CLAUDE.md
git commit -m "feat(m3c): POST /api/exercise/check; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```
