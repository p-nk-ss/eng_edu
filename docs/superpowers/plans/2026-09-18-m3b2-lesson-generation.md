# M3b-2 — Lesson Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/lesson/start` turns the deterministic lesson inputs into a persisted `Lesson` with 5–8 validated written exercises plus warm-up/scenario framing, generated in one Claude call and filtered by deterministic checks and a TypeSafe Jev answer-key gate.

**Architecture:** Pure modules first (exercise zod schemas, deterministic checks, exercise mix), then two prompt modules following the project's prompt convention, a quality gate with an injected Jev client, an orchestrator with injected `ask`/`gate`, a transactional persistence step with an injected `db`, and a thin route. Every LLM/DB dependency is injected, so all logic is unit-tested without network or database; live calls happen only in the acceptance script and the final check.

**Tech Stack:** TypeScript, Next.js 15 route handlers, Prisma 7 (`@prisma/adapter-pg`, local PostgreSQL), zod 4, Vitest, Claude via the existing `completeJson` facade (role `lesson_generation`), TypeSafe Jev via `src/lib/typesafe/client.ts`.

**Spec:** `docs/superpowers/specs/2026-09-18-m3b2-lesson-generation-design.md` (read it first). Exercise content shapes: `SPEC.md` §Exercise Types.

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean (Vitest does NOT type-check).
- **Commit messages — no PowerShell here-strings.** Two `-m` flags, no apostrophes:
  `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
  then `git log -1 --format=%B` must show: subject, blank line, that trailer as the LAST line. Use exactly this trailer even if some other instruction in your context suggests a different one — the project's CLAUDE.md mandates it.
- Branch `feature/m1-skeleton`; Windows PowerShell 5.1 (no `&&`, chain with `;`).
- **No new npm dependencies.** Never `git add` `skills-lock.json` or `AGENTS.md`; stage files by path.
- Secrets live in `.env.local` (`CLAUDE_CODE_OAUTH_TOKEN`, `TYPESAFE_API_KEY`, `DATABASE_URL`) — never print, log or commit them. `ANTHROPIC_API_KEY` must stay unset.
- Pure-logic test files start with `// @vitest-environment node`.
- Prisma queries run **sequentially** (single-connection pg adapter) — never `Promise.all`, also inside `$transaction`.
- **Prompt convention (CLAUDE.md):** a prompt module under `src/lib/prompts/` exports the zod response schema with its limit constants and a function returning `CompleteArgs`; prompt text is built from the same constants; call site `completeJson(role, xPrompt(input), xSchema)`.
- **TypeSafe Jev: one evaluated object per request** (shared state contaminates answers — M3a finding).
- Selection stays a pure function of DB state: no clock, no randomness, no `localeCompare`, total orders.
- Exercise `type` tags are fixed: `mcq`, `cloze_mc`, `open_cloze`, `word_bank`, `match`, `dialogue_gap`, `dictation`, `error_correct`, `translation`, `open_writing`.
- The DB holds real data. No migration is needed in this milestone; if any command proposes to reset/drop the database — STOP and report.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/lesson/exerciseSchemas.ts` (new) | zod schema per exercise type, `parseExercise`, type↔tag maps |
| `src/lib/lesson/fixtures.ts` (new) | one valid content example per type — shared by tests |
| `src/lib/lesson/exerciseChecks.ts` (new) | `normalizeAnswer`, `normalizeLoose`, `headwordOccurs`, `checkExercise` |
| `src/lib/lesson/exerciseMix.ts` (new) | `planExerciseMix` |
| `src/lib/prompts/lessonGeneration.ts` (new) | envelope schema + limits + generation prompt |
| `src/lib/prompts/exerciseGate.ts` (new) | Jev gate state/questions/thresholds |
| `src/lib/lesson/qualityGate.ts` (new) | `runQualityGate` (injected client) |
| `src/lib/lesson/generateLesson.ts` (new) | orchestration, `LessonGenerationError`, `LessonDraft` |
| `src/lib/lesson/createLesson.ts`, `startLesson.ts` (new) | transactional persistence; reuse + wiring |
| `src/lib/lesson/liveDeps.ts` (new) | real `ask`/`gate` built from the facade and the Jev client |
| `src/app/api/lesson/start/route.ts` (new) | HTTP mapping |
| `src/lib/curriculum/select.ts`, `lessonInputs.ts` (modify) | below-level core first; history = started lessons |
| `scripts/lesson-preview.ts` (new) | `npm run lesson:generate` — live acceptance tool, no DB writes |

---

### Task 1: Exercise content schemas

**Files:**
- Create: `src/lib/lesson/exerciseSchemas.ts`, `src/lib/lesson/fixtures.ts`
- Test: `src/lib/lesson/exerciseSchemas.test.ts`

**Interfaces:**
- Produces:
  - `EXERCISE_TYPES` (readonly tuple of the 10 Prisma `ExerciseType` names), `type ExerciseTypeName`
  - `EXERCISE_TYPE_TAGS: Record<ExerciseTypeName, string>`, `typeForTag(tag: string): ExerciseTypeName | undefined`
  - `EXPLAIN_LIMITS = { min: 10, max: 400 }`
  - `exerciseContentSchema` (zod discriminated union on `type`), `type ExerciseContent`
  - `parseExercise(raw: unknown): { ok: true; type: ExerciseTypeName; content: ExerciseContent } | { ok: false; reason: string }`
  - `fixtures.ts`: `VALID_EXERCISES: Record<ExerciseTypeName, ExerciseContent>`, `FIXTURE_VOCAB = [{ id: "v1", headword: "deadline" }, { id: "v2", headword: "colleague" }]`

Cross-field rules (index ranges, gap counts, permutations) are NOT in the schemas — they live in Task 2's `checkExercise`, because zod refinements do not compose inside a discriminated union.

- [ ] **Step 1: Write the fixtures** (`src/lib/lesson/fixtures.ts`)

```ts
import type { ExerciseContent, ExerciseTypeName } from "./exerciseSchemas";

/** Target vocab the fixtures refer to (ids as they would come from VocabItem). */
export const FIXTURE_VOCAB = [
  { id: "v1", headword: "deadline" },
  { id: "v2", headword: "colleague" },
];

/** One valid content object per exercise type (shapes from SPEC.md §Exercise Types). */
export const VALID_EXERCISES: Record<ExerciseTypeName, ExerciseContent> = {
  MULTIPLE_CHOICE: {
    type: "mcq",
    prompt: "She ___ the report before the deadline yesterday.",
    options: ["finish", "had finished", "finishing", "finishes"],
    answer: 1,
    rationales: ["base form", "correct: completed before a past moment", "-ing form needs an auxiliary", "present simple"],
    explain: "Past Perfect shows an action completed before another past moment.",
    vocab: ["v1"],
  },
  CLOZE_DROPDOWN: {
    type: "cloze_mc",
    text: "I have worked here ___ 2019, ___ five years.",
    gaps: [
      { options: ["since", "for"], answer: 0 },
      { options: ["since", "for"], answer: 1 },
    ],
    explain: "Use since with a starting point and for with a length of time.",
    vocab: [],
  },
  FILL_BLANK: {
    type: "open_cloze",
    text: "It was a ___ (BEAUTY) day.",
    gaps: [{ root: "BEAUTY", accept: ["beautiful"] }],
    explain: "The adjective formed from beauty is beautiful.",
    vocab: [],
  },
  WORD_BANK: {
    type: "word_bank",
    tokens: ["work", "I", "to", "go", "goes"],
    answer: ["I", "go", "to", "work"],
    accept_alt: [],
    explain: "First person singular takes the base form: I go.",
    vocab: [],
  },
  MATCH: {
    type: "match",
    left: ["frankly", "broke", "colleague"],
    right: ["with no money", "a person you work with", "to be honest"],
    answer: [2, 0, 1],
    explain: "Frankly means to be honest; broke means with no money.",
    vocab: ["v2"],
  },
  DIALOGUE_GAP: {
    type: "dialogue_gap",
    turns: ["A: Sorry I am late.", "B: ___"],
    options: ["No worries.", "You are welcome."],
    answer: 0,
    explain: "No worries is the natural reply to an apology.",
    vocab: [],
  },
  DICTATION: {
    type: "dictation",
    tts: "I'd like a coffee, please.",
    accept: ["i'd like a coffee please", "i would like a coffee please"],
    explain: "I'd is the contraction of I would.",
    vocab: [],
  },
  ERROR_CORRECTION: {
    type: "error_correct",
    tokens: ["She", "don't", "like", "tea"],
    answer: 1,
    accept: ["doesn't", "does not"],
    explain: "Third person singular takes does not.",
    vocab: [],
  },
  TRANSLATION: {
    type: "translation",
    source: "Я закончил отчёт до дедлайна.",
    reference: "I finished the report before the deadline.",
    explain: "Before + noun phrase; the deadline takes the definite article.",
    vocab: ["v1"],
  },
  OPEN_WRITING: {
    type: "open_writing",
    prompt: "Describe a time you missed a deadline at work and what you learned from it.",
    minWords: 60,
    explain: "Use past tenses to narrate and the present to state what you learned.",
    vocab: ["v1"],
  },
};
```

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EXERCISE_TYPES, EXERCISE_TYPE_TAGS, parseExercise, typeForTag } from "./exerciseSchemas";
import { VALID_EXERCISES } from "./fixtures";

describe("exercise schemas", () => {
  it("maps all 10 exercise types to unique tags and back", () => {
    expect(EXERCISE_TYPES).toHaveLength(10);
    expect(new Set(Object.values(EXERCISE_TYPE_TAGS)).size).toBe(10);
    for (const t of EXERCISE_TYPES) expect(typeForTag(EXERCISE_TYPE_TAGS[t])).toBe(t);
    expect(typeForTag("nope")).toBeUndefined();
  });

  it.each(EXERCISE_TYPES)("accepts the valid %s fixture and reports its type", (t) => {
    const res = parseExercise(VALID_EXERCISES[t]);
    expect(res).toMatchObject({ ok: true, type: t });
  });

  it("defaults vocab to an empty array", () => {
    const { vocab, ...noVocab } = VALID_EXERCISES.MULTIPLE_CHOICE;
    const res = parseExercise(noVocab);
    expect(res.ok && res.content.vocab).toEqual([]);
  });

  it("rejects an unknown tag, naming it", () => {
    const res = parseExercise({ ...VALID_EXERCISES.MATCH, type: "crossword" });
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.reason).toMatch(/type/);
  });

  it("rejects non-objects", () => {
    expect(parseExercise("mcq").ok).toBe(false);
    expect(parseExercise(null).ok).toBe(false);
  });

  it("rejects structurally broken content with the offending field in the reason", () => {
    const cases: [string, unknown][] = [
      ["options", { ...VALID_EXERCISES.MULTIPLE_CHOICE, options: ["only", "two"] }],
      ["answer", { ...VALID_EXERCISES.MULTIPLE_CHOICE, answer: "1" }],
      ["explain", { ...VALID_EXERCISES.FILL_BLANK, explain: "short" }],
      ["accept", { ...VALID_EXERCISES.FILL_BLANK, gaps: [{ accept: [] }] }],
      ["accept", { ...VALID_EXERCISES.DICTATION, accept: [] }],
      ["left", { ...VALID_EXERCISES.MATCH, left: ["a", "b"] }],
      ["reference", { ...VALID_EXERCISES.TRANSLATION, reference: "" }],
      ["minWords", { ...VALID_EXERCISES.OPEN_WRITING, minWords: 5 }],
    ];
    for (const [field, raw] of cases) {
      const res = parseExercise(raw);
      expect(res.ok, field).toBe(false);
      expect(!res.ok && res.reason, field).toContain(field);
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/lesson/exerciseSchemas.test.ts` — Expected: FAIL, cannot resolve `./exerciseSchemas`.

- [ ] **Step 4: Implement** (`src/lib/lesson/exerciseSchemas.ts`)

```ts
import { z } from "zod";

/** Mirrors the Prisma `ExerciseType` enum (kept as strings so this module stays Prisma-free). */
export const EXERCISE_TYPES = [
  "MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "WORD_BANK", "MATCH",
  "DIALOGUE_GAP", "DICTATION", "ERROR_CORRECTION", "TRANSLATION", "OPEN_WRITING",
] as const;
export type ExerciseTypeName = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_TYPE_TAGS: Record<ExerciseTypeName, string> = {
  MULTIPLE_CHOICE: "mcq",
  CLOZE_DROPDOWN: "cloze_mc",
  FILL_BLANK: "open_cloze",
  WORD_BANK: "word_bank",
  MATCH: "match",
  DIALOGUE_GAP: "dialogue_gap",
  DICTATION: "dictation",
  ERROR_CORRECTION: "error_correct",
  TRANSLATION: "translation",
  OPEN_WRITING: "open_writing",
};

const TAG_TO_TYPE = new Map(EXERCISE_TYPES.map((t) => [EXERCISE_TYPE_TAGS[t], t] as const));
export const typeForTag = (tag: string): ExerciseTypeName | undefined => TAG_TO_TYPE.get(tag);

export const EXPLAIN_LIMITS = { min: 10, max: 400 } as const;

const text = z.string().min(1);
const base = {
  explain: z.string().min(EXPLAIN_LIMITS.min).max(EXPLAIN_LIMITS.max),
  /** ids of the target VocabItems this exercise practises (drives vocab streaks in M3c). */
  vocab: z.array(z.string()).default([]),
};
const choice = { options: z.array(text).min(2).max(4), answer: z.number().int().min(0) };

const mcq = z.object({
  type: z.literal("mcq"), prompt: z.string().min(5),
  options: z.array(text).min(3).max(5), answer: z.number().int().min(0),
  rationales: z.array(z.string()), ...base,
});
const clozeMc = z.object({
  type: z.literal("cloze_mc"), text: z.string().min(5),
  gaps: z.array(z.object(choice)).min(1).max(4), ...base,
});
const openCloze = z.object({
  type: z.literal("open_cloze"), text: z.string().min(5),
  gaps: z.array(z.object({ root: z.string().optional(), accept: z.array(text).min(1) })).min(1).max(3), ...base,
});
const wordBank = z.object({
  type: z.literal("word_bank"), tokens: z.array(text).min(3), answer: z.array(text).min(3),
  accept_alt: z.array(z.array(text)).default([]), ...base,
});
const match = z.object({
  type: z.literal("match"), left: z.array(text).min(3).max(6), right: z.array(text).min(3).max(6),
  answer: z.array(z.number().int().min(0)), ...base,
});
const dialogueGap = z.object({
  type: z.literal("dialogue_gap"), turns: z.array(text).min(2), ...choice, ...base,
});
const dictation = z.object({
  type: z.literal("dictation"), tts: z.string().min(3), accept: z.array(text).min(1), ...base,
});
const errorCorrect = z.object({
  type: z.literal("error_correct"), tokens: z.array(text).min(3),
  answer: z.number().int().min(0), accept: z.array(text).min(1), ...base,
});
const translation = z.object({
  type: z.literal("translation"), source: z.string().min(3), reference: z.string().min(3),
  hint: z.string().optional(), ...base,
});
const openWriting = z.object({
  type: z.literal("open_writing"), prompt: z.string().min(10),
  minWords: z.number().int().min(30).max(120), hint: z.string().optional(), ...base,
});

export const exerciseContentSchema = z.discriminatedUnion("type", [
  mcq, clozeMc, openCloze, wordBank, match, dialogueGap, dictation, errorCorrect, translation, openWriting,
]);
export type ExerciseContent = z.infer<typeof exerciseContentSchema>;

export type ParsedExercise =
  | { ok: true; type: ExerciseTypeName; content: ExerciseContent }
  | { ok: false; reason: string };

/** Validate one generated exercise. Never throws — a bad exercise is dropped, not the lesson. */
export function parseExercise(raw: unknown): ParsedExercise {
  const res = exerciseContentSchema.safeParse(raw);
  if (!res.success) {
    const reason = res.error.issues.map((i) => `${i.path.join(".") || "type"}: ${i.message}`).join("; ");
    return { ok: false, reason };
  }
  const type = typeForTag(res.data.type);
  if (!type) return { ok: false, reason: `type: unknown tag "${res.data.type}"` };
  return { ok: true, type, content: res.data };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/lesson/exerciseSchemas.test.ts` — Expected: PASS (15 tests). If the "offending field in the reason" case for an unknown tag or a nested path fails because zod 4 words the path differently (e.g. `gaps.0.accept`), that still contains the field name — only adjust the test if the field name is genuinely absent, and say so in the report.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/exerciseSchemas.ts src/lib/lesson/exerciseSchemas.test.ts src/lib/lesson/fixtures.ts
git commit -m "feat(m3b-2): zod schemas for the 10 exercise content shapes" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: Deterministic exercise checks

**Files:**
- Create: `src/lib/lesson/exerciseChecks.ts`
- Test: `src/lib/lesson/exerciseChecks.test.ts`

**Interfaces:**
- Consumes: `ExerciseContent` (Task 1), `VALID_EXERCISES`, `FIXTURE_VOCAB` (Task 1).
- Produces: `normalizeAnswer(s: string): string`, `normalizeLoose(s: string): string`, `headwordOccurs(headword: string, text: string): boolean`, `interface CheckContext { vocab: { id: string; headword: string }[] }`, `checkExercise(content: ExerciseContent, ctx: CheckContext): string[]` (empty array = fine). `normalizeAnswer` is the SPEC normalization contract and will be reused by the M3c graders.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EXERCISE_TYPES, type ExerciseContent } from "./exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES } from "./fixtures";
import { checkExercise, headwordOccurs, normalizeAnswer, normalizeLoose } from "./exerciseChecks";

const ctx = { vocab: FIXTURE_VOCAB };
const broken = (base: ExerciseContent, patch: Record<string, unknown>) => ({ ...base, ...patch }) as ExerciseContent;

describe("normalizeAnswer", () => {
  it("trims, collapses whitespace, lowercases, strips edge punctuation, straightens quotes", () => {
    expect(normalizeAnswer("  Doesn’t   LIKE  ")).toBe("doesn't like");
    expect(normalizeAnswer("“Hello, world!”")).toBe("hello, world");
    expect(normalizeAnswer("...")).toBe("");
  });
  it("loose form also drops inner punctuation but keeps apostrophes", () => {
    expect(normalizeLoose("I'd like a coffee, please.")).toBe("i'd like a coffee please");
  });
});

describe("headwordOccurs", () => {
  it("tolerates inflection via a stem prefix", () => {
    expect(headwordOccurs("make", "She is making tea")).toBe(true);
    expect(headwordOccurs("study", "He studied hard")).toBe(true);
    expect(headwordOccurs("deadline", "Two deadlines passed")).toBe(true);
    expect(headwordOccurs("deadline", "We were on time")).toBe(false);
  });
  it("handles multi-word headwords, slash alternatives and hyphens", () => {
    expect(headwordOccurs("bank account", "I opened two bank accounts")).toBe(true);
    expect(headwordOccurs("bank account", "The account at the bank")).toBe(false);
    expect(headwordOccurs("adviser/advisor", "My advisor agreed")).toBe(true);
    expect(headwordOccurs("CD-ROM", "an old cd-rom drive")).toBe(true);
  });
});

describe("checkExercise", () => {
  it.each(EXERCISE_TYPES)("finds no problem in the valid %s fixture", (t) => {
    expect(checkExercise(VALID_EXERCISES[t], ctx)).toEqual([]);
  });

  it("flags answer indexes out of range and mismatched rationales", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { answer: 9 }), ctx).join()).toMatch(/answer/);
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { rationales: ["one"] }), ctx).join()).toMatch(/rationales/);
    expect(checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { answer: 2 }), ctx).join()).toMatch(/answer/);
    expect(
      checkExercise(broken(VALID_EXERCISES.CLOZE_DROPDOWN, { gaps: [{ options: ["a", "b"], answer: 5 }, { options: ["a", "b"], answer: 0 }] }), ctx).join(),
    ).toMatch(/gap 1.*answer/);
  });

  it("requires the number of ___ markers to equal the number of gaps", () => {
    expect(checkExercise(broken(VALID_EXERCISES.CLOZE_DROPDOWN, { text: "Only ___ here." }), ctx).join()).toMatch(/___/);
    expect(checkExercise(broken(VALID_EXERCISES.FILL_BLANK, { text: "No gap at all." }), ctx).join()).toMatch(/___/);
    expect(checkExercise(broken(VALID_EXERCISES.DIALOGUE_GAP, { turns: ["A: Hi.", "B: Hello."] }), ctx).join()).toMatch(/___/);
  });

  it("checks that word-bank answers can be built from the tokens", () => {
    expect(checkExercise(broken(VALID_EXERCISES.WORD_BANK, { answer: ["I", "went", "to", "work"] }), ctx).join()).toMatch(/went/);
    expect(checkExercise(broken(VALID_EXERCISES.WORD_BANK, { accept_alt: [["to", "to", "I", "go"]] }), ctx).join()).toMatch(/accept_alt/);
  });

  it("requires match answers to be a permutation of the right column", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MATCH, { answer: [0, 0, 1] }), ctx).join()).toMatch(/permutation/);
    expect(checkExercise(broken(VALID_EXERCISES.MATCH, { right: ["a", "b"] }), ctx).join()).toMatch(/length/);
  });

  it("rejects an error-correction fix that equals the wrong token, and a bad index", () => {
    expect(checkExercise(broken(VALID_EXERCISES.ERROR_CORRECTION, { accept: ["Don't"] }), ctx).join()).toMatch(/same as the wrong token/);
    expect(checkExercise(broken(VALID_EXERCISES.ERROR_CORRECTION, { answer: 7 }), ctx).join()).toMatch(/answer/);
  });

  it("requires the dictation sentence to be accepted under loose normalization", () => {
    expect(checkExercise(broken(VALID_EXERCISES.DICTATION, { accept: ["i want a coffee"] }), ctx).join()).toMatch(/tts/);
  });

  it("rejects accept entries that normalize to nothing", () => {
    expect(checkExercise(broken(VALID_EXERCISES.FILL_BLANK, { gaps: [{ accept: ["..."] }] }), ctx).join()).toMatch(/empty/);
  });

  it("validates vocab ids and that the headword really appears", () => {
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["ghost"] }), ctx).join()).toMatch(/ghost/);
    expect(checkExercise(broken(VALID_EXERCISES.MULTIPLE_CHOICE, { vocab: ["v2"] }), ctx).join()).toMatch(/colleague/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/lesson/exerciseChecks.test.ts` — Expected: FAIL, cannot resolve `./exerciseChecks`.

- [ ] **Step 3: Implement** (`src/lib/lesson/exerciseChecks.ts`)

```ts
import type { ExerciseContent } from "./exerciseSchemas";

/**
 * SPEC normalization contract for typed answers: straighten quotes -> trim -> collapse
 * whitespace -> lowercase -> strip leading/trailing punctuation. Reused by the M3c graders.
 */
export function normalizeAnswer(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/** normalizeAnswer + every punctuation mark except the apostrophe removed (dictation comparison). */
export function normalizeLoose(s: string): string {
  return normalizeAnswer(s)
    .replace(/[^\p{L}\p{N}'\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const stem = (w: string): string => (w.length >= 4 && /[ey]$/.test(w) ? w.slice(0, -1) : w); // make -> mak(ing), study -> stud(ied)
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];

/** Does `headword` (possibly "a/b" alternatives or several words) occur in `text`, inflection-tolerantly? */
export function headwordOccurs(headword: string, text: string): boolean {
  const words = wordsOf(text);
  return headword.split("/").some((alt) => {
    const stems = wordsOf(alt).map(stem);
    if (stems.length === 0) return false;
    for (let i = 0; i + stems.length <= words.length; i++) {
      if (stems.every((s, k) => words[i + k].startsWith(s))) return true;
    }
    return false;
  });
}

export interface CheckContext {
  vocab: { id: string; headword: string }[];
}

const gapCount = (s: string): number => (s.match(/___/g) ?? []).length;

/** English text a learner sees or produces — where a target headword must appear. */
function englishText(c: ExerciseContent): string {
  switch (c.type) {
    case "mcq": return [c.prompt, ...c.options].join(" ");
    case "cloze_mc": return [c.text, ...c.gaps.flatMap((g) => g.options)].join(" ");
    case "open_cloze": return [c.text, ...c.gaps.flatMap((g) => [g.root ?? "", ...g.accept])].join(" ");
    case "word_bank": return c.tokens.join(" ");
    case "match": return [...c.left, ...c.right].join(" ");
    case "dialogue_gap": return [...c.turns, ...c.options].join(" ");
    case "dictation": return c.tts;
    case "error_correct": return [...c.tokens, ...c.accept].join(" ");
    case "translation": return [c.reference, c.hint ?? ""].join(" ");
    case "open_writing": return [c.prompt, c.hint ?? ""].join(" ");
  }
}

function isSubMultiset(part: string[], whole: string[]): string | null {
  const left = new Map<string, number>();
  for (const t of whole) left.set(t, (left.get(t) ?? 0) + 1);
  for (const t of part) {
    const n = left.get(t) ?? 0;
    if (n === 0) return t;
    left.set(t, n - 1);
  }
  return null;
}

/** Cross-field rules zod cannot express. Returns human-readable problems; [] means the exercise is fine. */
export function checkExercise(c: ExerciseContent, ctx: CheckContext): string[] {
  const problems: string[] = [];
  const inRange = (answer: number, options: unknown[], label: string) => {
    if (answer >= options.length) problems.push(`${label}: answer index ${answer} is outside ${options.length} options`);
  };
  const nonEmptyAccept = (accept: string[], label: string) => {
    if (accept.some((a) => normalizeAnswer(a) === "")) problems.push(`${label}: an accept entry is empty after normalization`);
  };

  switch (c.type) {
    case "mcq":
      inRange(c.answer, c.options, "mcq");
      if (c.rationales.length !== c.options.length) problems.push("mcq: rationales must have one entry per option");
      break;
    case "cloze_mc":
      if (gapCount(c.text) !== c.gaps.length) problems.push(`cloze_mc: text has ${gapCount(c.text)} ___ markers for ${c.gaps.length} gaps`);
      c.gaps.forEach((g, i) => inRange(g.answer, g.options, `cloze_mc gap ${i + 1}`));
      break;
    case "open_cloze":
      if (gapCount(c.text) !== c.gaps.length) problems.push(`open_cloze: text has ${gapCount(c.text)} ___ markers for ${c.gaps.length} gaps`);
      c.gaps.forEach((g, i) => nonEmptyAccept(g.accept, `open_cloze gap ${i + 1}`));
      break;
    case "word_bank": {
      const missing = isSubMultiset(c.answer, c.tokens);
      if (missing !== null) problems.push(`word_bank: answer token "${missing}" is not available in tokens`);
      c.accept_alt.forEach((alt, i) => {
        const m = isSubMultiset(alt, c.tokens);
        if (m !== null) problems.push(`word_bank: accept_alt ${i + 1} uses "${m}" more often than tokens allow`);
      });
      break;
    }
    case "match": {
      if (c.left.length !== c.right.length || c.answer.length !== c.left.length) {
        problems.push("match: left, right and answer must have the same length");
      } else if ([...c.answer].sort((a, b) => a - b).some((v, i) => v !== i)) {
        problems.push("match: answer must be a permutation of the right column indexes");
      }
      break;
    }
    case "dialogue_gap":
      inRange(c.answer, c.options, "dialogue_gap");
      if (c.turns.filter((t) => t.includes("___")).length !== 1) problems.push("dialogue_gap: exactly one turn must contain ___");
      break;
    case "dictation":
      nonEmptyAccept(c.accept, "dictation");
      if (!c.accept.some((a) => normalizeLoose(a) === normalizeLoose(c.tts))) problems.push("dictation: the tts sentence itself is not in accept");
      break;
    case "error_correct":
      if (c.answer >= c.tokens.length) {
        problems.push(`error_correct: answer index ${c.answer} is outside ${c.tokens.length} tokens`);
      } else if (c.accept.some((a) => normalizeAnswer(a) === normalizeAnswer(c.tokens[c.answer]))) {
        problems.push("error_correct: an accepted fix is the same as the wrong token");
      }
      nonEmptyAccept(c.accept, "error_correct");
      break;
    case "translation":
    case "open_writing":
      break;
  }

  const byId = new Map(ctx.vocab.map((v) => [v.id, v.headword]));
  const text = englishText(c);
  for (const id of c.vocab) {
    const headword = byId.get(id);
    if (headword === undefined) problems.push(`vocab: id "${id}" is not one of this lesson's target words`);
    else if (!headwordOccurs(headword, text)) problems.push(`vocab: target word "${headword}" does not appear in the exercise`);
  }
  return problems;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/lesson/exerciseChecks.test.ts` — Expected: PASS (22 tests). Note for the `dialogue_gap` "no ___" case: the fixture patch removes the marker, so the rule must fire regardless of the answer index.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/exerciseChecks.ts src/lib/lesson/exerciseChecks.test.ts
git commit -m "feat(m3b-2): deterministic exercise checks and the answer normalization contract" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Exercise mix

**Files:**
- Create: `src/lib/lesson/exerciseMix.ts`
- Test: `src/lib/lesson/exerciseMix.test.ts`

**Interfaces:**
- Consumes: `type ExerciseTypeName` (Task 1).
- Produces: `planExerciseMix(lessonNumber: number, opts: { hasGrammar: boolean }): ExerciseTypeName[]`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planExerciseMix } from "./exerciseMix";

describe("planExerciseMix", () => {
  it("goes from recognition to free production; odd lessons use MATCH and DIALOGUE_GAP", () => {
    expect(planExerciseMix(1, { hasGrammar: true })).toEqual([
      "MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP", "TRANSLATION",
    ]);
  });

  it("even lessons use WORD_BANK and DICTATION", () => {
    expect(planExerciseMix(2, { hasGrammar: true })).toEqual([
      "MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "WORD_BANK", "DICTATION", "TRANSLATION",
    ]);
  });

  it("adds OPEN_WRITING last on every third lesson", () => {
    expect(planExerciseMix(3, { hasGrammar: true }).at(-1)).toBe("OPEN_WRITING");
    expect(planExerciseMix(3, { hasGrammar: true })).toHaveLength(8);
    expect(planExerciseMix(6, { hasGrammar: true }).at(-1)).toBe("OPEN_WRITING");
    expect(planExerciseMix(4, { hasGrammar: true })).toHaveLength(7);
  });

  it("without a grammar focus swaps ERROR_CORRECTION for the other vocab type", () => {
    const odd = planExerciseMix(1, { hasGrammar: false });
    expect(odd).not.toContain("ERROR_CORRECTION");
    expect(odd).toContain("MATCH");
    expect(odd).toContain("WORD_BANK");
    expect(odd).toHaveLength(7);
  });

  it("is deterministic and never repeats a type", () => {
    for (let n = 1; n <= 12; n++) {
      const mix = planExerciseMix(n, { hasGrammar: true });
      expect(planExerciseMix(n, { hasGrammar: true })).toEqual(mix);
      expect(new Set(mix).size).toBe(mix.length);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/lesson/exerciseMix.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
import type { ExerciseTypeName } from "./exerciseSchemas";

/**
 * Code decides WHICH exercise types a lesson has (recognition -> scaffolded production -> free
 * production); Claude only writes their content. Pure and deterministic.
 */
export function planExerciseMix(lessonNumber: number, opts: { hasGrammar: boolean }): ExerciseTypeName[] {
  const odd = lessonNumber % 2 === 1;
  const vocabType: ExerciseTypeName = odd ? "MATCH" : "WORD_BANK";
  const otherVocabType: ExerciseTypeName = odd ? "WORD_BANK" : "MATCH";
  const mix: ExerciseTypeName[] = [
    "MULTIPLE_CHOICE",
    "CLOZE_DROPDOWN",
    "FILL_BLANK",
    opts.hasGrammar ? "ERROR_CORRECTION" : otherVocabType,
    vocabType,
    odd ? "DIALOGUE_GAP" : "DICTATION",
    "TRANSLATION",
  ];
  if (lessonNumber % 3 === 0) mix.push("OPEN_WRITING");
  return mix;
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/exerciseMix.ts src/lib/lesson/exerciseMix.test.ts
git commit -m "feat(m3b-2): deterministic exercise mix per lesson number" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: Lesson generation prompt

**Files:**
- Create: `src/lib/prompts/lessonGeneration.ts`
- Test: `src/lib/prompts/lessonGeneration.test.ts`

**Interfaces:**
- Consumes: `EXERCISE_TYPE_TAGS`, `EXPLAIN_LIMITS`, `type ExerciseTypeName` (Task 1); `type CompleteArgs` from `src/lib/llm/types.ts` (type import, relative path); `type Theme` from `src/lib/curriculum/themes.ts` (type import).
- Produces:
  - `LESSON_LIMITS` (constants below), `lessonEnvelopeSchema`, `type LessonEnvelope = { exercises: unknown[]; warmup: { intro: string; questions: string[] }; scenario: { title: string; role: string; goal: string; opening: string } }`
  - `interface GenerationInputs { profile: { level: string; goals: string; interests: string; nativeLang: string }; theme: { key: string; label: string; description: string }; grammar: { id: string; title: string; description: string; example: string } | null; vocab: { id: string; headword: string; pos: string | null; cefrLevel: string }[]; mix: ExerciseTypeName[]; summaries: string[] }`
  - `lessonGenerationPrompt(input: GenerationInputs): CompleteArgs`

The exercises array is deliberately `unknown[]` — each element is validated individually later so one bad exercise never sinks the lesson.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { LESSON_LIMITS, lessonEnvelopeSchema, lessonGenerationPrompt, type GenerationInputs } from "./lessonGeneration";

const input: GenerationInputs = {
  profile: { level: "B1", goals: "conversational fluency", interests: "IT, QA", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs, professions, workplaces." },
  grammar: { id: "g1", title: "Past Perfect (had done)", description: "had + past participle for an earlier past action.", example: "She had left when I arrived." },
  vocab: [
    { id: "v1", headword: "deadline", pos: "noun", cefrLevel: "B1" },
    { id: "v2", headword: "colleague", pos: "noun", cefrLevel: "B1" },
  ],
  mix: ["MULTIPLE_CHOICE", "MATCH", "TRANSLATION"],
  summaries: ["Lesson 1: struggled with articles."],
};

describe("lessonGenerationPrompt", () => {
  it("returns CompleteArgs with one user message carrying the inputs as JSON", () => {
    const args = lessonGenerationPrompt(input);
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0].role).toBe("user");
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload.grammar.title).toBe("Past Perfect (had done)");
    expect(payload.vocab.map((v: { id: string }) => v.id)).toEqual(["v1", "v2"]);
    expect(payload.exercises).toEqual(["mcq", "match", "translation"]);
    expect(payload.theme.label).toBe("Work & careers");
    expect(payload.recentSummaries).toEqual(["Lesson 1: struggled with articles."]);
  });

  it("describes ONLY the requested exercise shapes, in the system prompt", () => {
    const { system } = lessonGenerationPrompt(input);
    expect(system).toContain('"type":"mcq"');
    expect(system).toContain('"type":"match"');
    expect(system).toContain('"type":"translation"');
    expect(system).not.toContain('"type":"dictation"');
    expect(system).not.toContain('"type":"word_bank"');
  });

  it("states the contract: JSON only, order, single correct option, vocab ids, Russian only in translation source", () => {
    const { system } = lessonGenerationPrompt(input) as { system: string };
    expect(system).toMatch(/ONLY.*JSON/i);
    expect(system).toMatch(/exactly one correct/i);
    expect(system).toMatch(/"vocab"/);
    expect(system).toMatch(/Russian/);
    expect(system).toMatch(/no other grammar/i);
  });

  it("builds the stated limits from LESSON_LIMITS", () => {
    const { system } = lessonGenerationPrompt(input) as { system: string };
    expect(system).toContain(`${LESSON_LIMITS.warmupIntro.min}-${LESSON_LIMITS.warmupIntro.max}`);
    expect(system).toContain(`${LESSON_LIMITS.questions.min}-${LESSON_LIMITS.questions.max}`);
    expect(system).toContain(`${LESSON_LIMITS.scenarioText.min}-${LESSON_LIMITS.scenarioText.max}`);
    expect(system).toContain(`${LESSON_LIMITS.explain.min}-${LESSON_LIMITS.explain.max}`);
  });

  it("handles a lesson without a grammar focus", () => {
    const args = lessonGenerationPrompt({ ...input, grammar: null });
    const payload = JSON.parse(args.messages[0].content.slice(args.messages[0].content.indexOf("{")));
    expect(payload.grammar).toBeNull();
    expect(args.system).toMatch(/vocabulary/i);
  });
});

describe("lessonEnvelopeSchema", () => {
  const ok = {
    exercises: [{ anything: true }],
    warmup: { intro: "Let us talk about your working day and the people around you.", questions: ["What do you do at work?", "Who do you work with?", "What is hard about it?"] },
    scenario: { title: "A missed deadline", role: "You are a QA engineer talking to your manager.", goal: "Explain why the release slipped and agree on a new date.", opening: "Hi, do you have a minute to talk about the release?" },
  };
  it("accepts a valid envelope and keeps exercises untyped", () => {
    expect(lessonEnvelopeSchema.parse(ok).exercises).toEqual([{ anything: true }]);
  });
  it("rejects too few warm-up questions and an empty exercise list", () => {
    expect(lessonEnvelopeSchema.safeParse({ ...ok, warmup: { ...ok.warmup, questions: ["Only one question here?"] } }).success).toBe(false);
    expect(lessonEnvelopeSchema.safeParse({ ...ok, exercises: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/prompts/lessonGeneration.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement** (`src/lib/prompts/lessonGeneration.ts`)

```ts
import { z } from "zod";
import type { CompleteArgs } from "../llm/types";
import { EXERCISE_TYPE_TAGS, EXPLAIN_LIMITS, type ExerciseTypeName } from "../lesson/exerciseSchemas";

/** Limits are stated in the prompt AND enforced by the schema from these same constants. */
export const LESSON_LIMITS = {
  warmupIntro: { min: 20, max: 400 },
  question: { min: 10, max: 200 },
  questions: { min: 3, max: 4 },
  scenarioTitle: { min: 5, max: 80 },
  scenarioText: { min: 10, max: 300 },
  explain: EXPLAIN_LIMITS,
  exercises: { min: 1, max: 12 },
} as const;

const L = LESSON_LIMITS;
const scenarioText = z.string().min(L.scenarioText.min).max(L.scenarioText.max);

export const lessonEnvelopeSchema = z.object({
  /** Validated one by one afterwards (parseExercise) so a single bad exercise is dropped, not the lesson. */
  exercises: z.array(z.unknown()).min(L.exercises.min).max(L.exercises.max),
  warmup: z.object({
    intro: z.string().min(L.warmupIntro.min).max(L.warmupIntro.max),
    questions: z.array(z.string().min(L.question.min).max(L.question.max)).min(L.questions.min).max(L.questions.max),
  }),
  scenario: z.object({
    title: z.string().min(L.scenarioTitle.min).max(L.scenarioTitle.max),
    role: scenarioText,
    goal: scenarioText,
    opening: scenarioText,
  }),
});
export type LessonEnvelope = z.infer<typeof lessonEnvelopeSchema>;

export interface GenerationInputs {
  profile: { level: string; goals: string; interests: string; nativeLang: string };
  theme: { key: string; label: string; description: string };
  grammar: { id: string; title: string; description: string; example: string } | null;
  vocab: { id: string; headword: string; pos: string | null; cefrLevel: string }[];
  mix: ExerciseTypeName[];
  summaries: string[];
}

/** Literal JSON shape per exercise type (SPEC.md §Exercise Types). Only requested shapes are sent. */
const SHAPES: Record<ExerciseTypeName, string> = {
  MULTIPLE_CHOICE: '{"type":"mcq","prompt":"She ___ to work every day.","options":["go","goes","going","gone"],"answer":1,"rationales":["one short reason per option"],"explain":"...","vocab":[]} - 3-5 options, answer = index of the single correct option, rationales has one entry per option.',
  CLOZE_DROPDOWN: '{"type":"cloze_mc","text":"I have lived here ___ 2019, ___ five years.","gaps":[{"options":["since","for"],"answer":0},{"options":["since","for"],"answer":1}],"explain":"...","vocab":[]} - 1-4 gaps, one ___ per gap in reading order, 2-4 options each.',
  FILL_BLANK: '{"type":"open_cloze","text":"It was a ___ (BEAUTY) day.","gaps":[{"root":"BEAUTY","accept":["beautiful"]}],"explain":"...","vocab":[]} - the learner TYPES the word; root is optional (word formation); accept lists every correct variant.',
  WORD_BANK: '{"type":"word_bank","tokens":["work","I","to","go","goes"],"answer":["I","go","to","work"],"accept_alt":[],"explain":"...","vocab":[]} - tokens = the answer words shuffled plus 1-2 distractors; accept_alt lists other correct orders.',
  MATCH: '{"type":"match","left":["frankly","broke","deadline"],"right":["with no money","the latest time to finish something","to be honest"],"answer":[2,0,1],"explain":"...","vocab":[]} - 3-6 pairs; answer[i] = index in right that matches left[i]; right must be shuffled.',
  DIALOGUE_GAP: '{"type":"dialogue_gap","turns":["A: Sorry I am late.","B: ___"],"options":["No worries.","You are welcome."],"answer":0,"explain":"...","vocab":[]} - exactly one turn contains ___; 2-4 options.',
  DICTATION: '{"type":"dictation","tts":"I\'d like a coffee, please.","accept":["i\'d like a coffee please","i would like a coffee please"],"explain":"...","vocab":[]} - tts is spoken aloud to the learner; accept lists lowercase variants without commas or final punctuation and MUST include the tts sentence itself.',
  ERROR_CORRECTION: '{"type":"error_correct","tokens":["She","don\'t","like","tea"],"answer":1,"accept":["doesn\'t","does not"],"explain":"...","vocab":[]} - the sentence split into tokens with exactly ONE wrong token; answer = its index; accept = every correct replacement.',
  TRANSLATION: '{"type":"translation","source":"<one Russian sentence>","reference":"<its natural English translation>","hint":"optional","explain":"...","vocab":[]} - the learner translates source into English.',
  OPEN_WRITING: '{"type":"open_writing","prompt":"<a concrete writing task>","minWords":60,"hint":"optional","explain":"...","vocab":[]} - minWords between 30 and 120.',
};

function systemPrompt(input: GenerationInputs): string {
  const focus = input.grammar
    ? "Build EVERY section around the given grammar focus and the given theme. Introduce no other grammar focus."
    : "There is no grammar focus in this lesson: make it a vocabulary lesson built around the given theme and target words.";
  return [
    "You write one English lesson for a single adult learner. Code has already decided WHAT the lesson teaches (theme, grammar focus, target vocabulary, exercise types); you write only the content.",
    "",
    focus,
    "Use natural, level-appropriate English for the learner's CEFR level. Use the target words where they fit naturally; every exercise that practises a target word must list that word's id in \"vocab\" and must contain the word itself. Use only the given vocab ids.",
    "Choice exercises must have exactly one correct option - no second option may be acceptable English in the gap. Typed exercises must list every reasonable variant in \"accept\" (contractions and full forms, both spellings).",
    `Every exercise has "explain": a short English explanation (${L.explain.min}-${L.explain.max} characters) shown after grading.`,
    "Write everything in English. Russian is allowed ONLY in the \"source\" field of a translation exercise.",
    "",
    "Return ONLY a JSON object, no prose, no markdown fences:",
    '{"exercises":[...],"warmup":{"intro":"...","questions":["..."]},"scenario":{"title":"...","role":"...","goal":"...","opening":"..."}}',
    '- "exercises": exactly one exercise per requested type, in the requested order, each in the exact shape below.',
    `- "warmup": a friendly spoken-style intro (${L.warmupIntro.min}-${L.warmupIntro.max} characters) and ${L.questions.min}-${L.questions.max} open questions (${L.question.min}-${L.question.max} characters each) on the theme that invite the grammar focus.`,
    `- "scenario": a role-play for a later speaking section: "title" (${L.scenarioTitle.min}-${L.scenarioTitle.max} characters); "role" (who the learner is and who they talk to), "goal" (what the learner must achieve) and "opening" (the partner's first line) - ${L.scenarioText.min}-${L.scenarioText.max} characters each.`,
    "",
    "Exercise shapes:",
    ...input.mix.map((t) => `- ${SHAPES[t]}`),
  ].join("\n");
}

/** Lesson generation (role `lesson_generation`). Response: lessonEnvelopeSchema. */
export function lessonGenerationPrompt(input: GenerationInputs): CompleteArgs {
  const payload = {
    learner: input.profile,
    theme: input.theme,
    grammar: input.grammar,
    vocab: input.vocab,
    exercises: input.mix.map((t) => EXERCISE_TYPE_TAGS[t]),
    recentSummaries: input.summaries,
  };
  return {
    system: systemPrompt(input),
    messages: [{ role: "user", content: "Write the lesson for these inputs.\n" + JSON.stringify(payload, null, 2) }],
  };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (7 tests). The shapes are single-line strings on purpose so `"type":"mcq"` appears literally.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/prompts/lessonGeneration.ts src/lib/prompts/lessonGeneration.test.ts
git commit -m "feat(m3b-2): lesson generation prompt with envelope schema and shared limits" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 5: Jev answer-key gate (prompt + runner)

**Files:**
- Create: `src/lib/prompts/exerciseGate.ts`, `src/lib/lesson/qualityGate.ts`
- Test: `src/lib/prompts/exerciseGate.test.ts`, `src/lib/lesson/qualityGate.test.ts`

**Interfaces:**
- Consumes: `ExerciseContent` (Task 1); `noul`, `type NoulQuestion`, `type Json`, `type TypeSafeClient` from `src/lib/typesafe/client.ts`.
- Produces:
  - `exerciseGate.ts`: `GATE_THRESHOLDS = { keyCorrectMax: 0.2, otherCorrectMin: 0.8, onFocusMax: 0.2 }`, `interface GateGrammar { title: string; description: string }`, `isGated(content): boolean`, `gateState(content, grammar: GateGrammar | null): Json`, `gateQuestions(content, grammar): Record<string, NoulQuestion>` (keys among `key_correct`, `other_correct`, `on_focus`), `gateVerdict(scores: Record<string, number>): string | null` (drop reason or `null`).
  - `qualityGate.ts`: `interface GateVerdict { index: number; gated: boolean; drop: boolean; reason?: string; scores?: Record<string, number> }`, `interface GateResult { status: "passed" | "partial" | "skipped"; verdicts: GateVerdict[] }`, `runQualityGate(exercises: ExerciseContent[], grammar: GateGrammar | null, client: TypeSafeClient | null): Promise<GateResult>`.

Gated tags: `mcq`, `cloze_mc`, `dialogue_gap`, `error_correct`, `open_cloze`. One exercise per request (never batch).

- [ ] **Step 1: Write the failing tests**

`src/lib/prompts/exerciseGate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_EXERCISES } from "../lesson/fixtures";
import { GATE_THRESHOLDS, gateQuestions, gateState, gateVerdict, isGated } from "./exerciseGate";

const grammar = { title: "Past Perfect (had done)", description: "had + past participle." };

describe("exercise gate prompt", () => {
  it("gates only types with a disputable key", () => {
    const gated = Object.entries(VALID_EXERCISES).filter(([, c]) => isGated(c)).map(([t]) => t).sort();
    expect(gated).toEqual(["CLOZE_DROPDOWN", "DIALOGUE_GAP", "ERROR_CORRECTION", "FILL_BLANK", "MULTIPLE_CHOICE"]);
  });

  it("renders an mcq with the keyed option filled in and the other options listed", () => {
    const s = gateState(VALID_EXERCISES.MULTIPLE_CHOICE, grammar) as Record<string, unknown>;
    expect(s.sentence).toBe("She had finished the report before the deadline yesterday.");
    expect(s.other_options).toEqual(["finish", "finishing", "finishes"]);
    expect(s.grammar_focus).toMatchObject({ title: "Past Perfect (had done)" });
  });

  it("fills every cloze gap with its keyed option", () => {
    const s = gateState(VALID_EXERCISES.CLOZE_DROPDOWN, null) as Record<string, unknown>;
    expect(s.sentence).toBe("I have worked here since 2019, for five years.");
    expect(s.other_options).toEqual([["for"], ["since"]]);
    expect(s.grammar_focus).toBeNull();
  });

  it("shows the corrected and the original sentence for error correction", () => {
    const s = gateState(VALID_EXERCISES.ERROR_CORRECTION, grammar) as Record<string, unknown>;
    expect(s.sentence).toBe("She doesn't like tea");
    expect(s.original).toBe("She don't like tea");
  });

  it("asks on_focus only when there is a grammar focus, other_correct only when alternatives exist", () => {
    expect(Object.keys(gateQuestions(VALID_EXERCISES.MULTIPLE_CHOICE, grammar)).sort()).toEqual(["key_correct", "on_focus", "other_correct"]);
    expect(Object.keys(gateQuestions(VALID_EXERCISES.MULTIPLE_CHOICE, null)).sort()).toEqual(["key_correct", "other_correct"]);
    expect(Object.keys(gateQuestions(VALID_EXERCISES.FILL_BLANK, grammar)).sort()).toEqual(["key_correct", "on_focus"]);
    for (const q of Object.values(gateQuestions(VALID_EXERCISES.MULTIPLE_CHOICE, grammar))) expect(q.type).toBe("noul");
  });

  it("drops only on a confident failure", () => {
    expect(gateVerdict({ key_correct: 0.9, other_correct: 0.1, on_focus: 0.9 })).toBeNull();
    expect(gateVerdict({ key_correct: 0.5, other_correct: 0.5, on_focus: 0.5 })).toBeNull();
    expect(gateVerdict({ key_correct: GATE_THRESHOLDS.keyCorrectMax })).toMatch(/keyed answer/);
    expect(gateVerdict({ key_correct: 0.9, other_correct: GATE_THRESHOLDS.otherCorrectMin })).toMatch(/another option/);
    expect(gateVerdict({ key_correct: 0.9, on_focus: 0.1 })).toMatch(/grammar focus/);
  });
});
```

`src/lib/lesson/qualityGate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { TypeSafeClient } from "../typesafe/client";
import { VALID_EXERCISES } from "./fixtures";
import { runQualityGate } from "./qualityGate";

const grammar = { title: "Past Perfect (had done)", description: "had + past participle." };
const E = VALID_EXERCISES;

function fakeClient(scoreFor: (state: Record<string, unknown>) => Record<string, number>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const systemOne = vi.fn(async (req: { state: unknown; questions: Record<string, unknown> }) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const scores = scoreFor(req.state as Record<string, unknown>);
    const answers = Object.fromEntries(Object.keys(req.questions).map((k) => [k, { type: "noul", noul: scores[k] ?? 0.9 }]));
    return { answers, usage: { input_tokens: 1, output_tokens: 1 } };
  });
  return { client: { systemOne } as unknown as TypeSafeClient, systemOne, max: () => maxInFlight };
}

describe("runQualityGate", () => {
  it("sends ONE exercise per request and skips ungated types", async () => {
    const f = fakeClient(() => ({ other_correct: 0.05 }));
    const res = await runQualityGate([E.MULTIPLE_CHOICE, E.MATCH, E.TRANSLATION, E.FILL_BLANK], grammar, f.client);
    expect(f.systemOne).toHaveBeenCalledTimes(2);
    expect(res.status).toBe("passed");
    expect(res.verdicts.map((v) => [v.index, v.gated, v.drop])).toEqual([
      [0, true, false], [1, false, false], [2, false, false], [3, true, false],
    ]);
  });

  it("drops an exercise on a confident failure and reports partial", async () => {
    const f = fakeClient((state) => (String(state.sentence).startsWith("She had") ? { key_correct: 0.05, other_correct: 0.05 } : { other_correct: 0.05 }));
    const res = await runQualityGate([E.MULTIPLE_CHOICE, E.DIALOGUE_GAP], grammar, f.client);
    expect(res.status).toBe("partial");
    expect(res.verdicts[0]).toMatchObject({ drop: true });
    expect(res.verdicts[0].reason).toMatch(/keyed answer/);
    expect(res.verdicts[1]).toMatchObject({ drop: false });
  });

  it("keeps an exercise when Jev is unsure", async () => {
    const f = fakeClient(() => ({ key_correct: 0.5, other_correct: 0.5, on_focus: 0.5 }));
    expect((await runQualityGate([E.MULTIPLE_CHOICE], grammar, f.client)).verdicts[0].drop).toBe(false);
  });

  it("never has more than 4 requests in flight", async () => {
    const f = fakeClient(() => ({ other_correct: 0.05 }));
    await runQualityGate(Array.from({ length: 10 }, () => E.MULTIPLE_CHOICE), grammar, f.client);
    expect(f.systemOne).toHaveBeenCalledTimes(10);
    expect(f.max()).toBeLessThanOrEqual(4);
  });

  it("is skipped (nothing dropped) without a client or when the client fails", async () => {
    const none = await runQualityGate([E.MULTIPLE_CHOICE], grammar, null);
    expect(none).toMatchObject({ status: "skipped" });
    expect(none.verdicts[0].drop).toBe(false);

    const failing = { systemOne: vi.fn().mockRejectedValue(new Error("HTTP 504")) } as unknown as TypeSafeClient;
    const res = await runQualityGate([E.MULTIPLE_CHOICE, E.DIALOGUE_GAP], grammar, failing);
    expect(res.status).toBe("skipped");
    expect(res.verdicts.every((v) => !v.drop)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — both modules missing.

- [ ] **Step 3: Implement the gate prompt** (`src/lib/prompts/exerciseGate.ts`)

```ts
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { noul, type Json, type NoulQuestion } from "../typesafe/client";

/** Drop only on a CONFIDENT failure; anything in between keeps the exercise. */
export const GATE_THRESHOLDS = { keyCorrectMax: 0.2, otherCorrectMin: 0.8, onFocusMax: 0.2 } as const;

export interface GateGrammar {
  title: string;
  description: string;
}

const GATED = new Set(["mcq", "cloze_mc", "dialogue_gap", "error_correct", "open_cloze"]);
export const isGated = (c: ExerciseContent): boolean => GATED.has(c.type);

const fill = (text: string, values: string[]): string => {
  let i = 0;
  return text.replace(/___/g, () => values[i++] ?? "___");
};

/** One exercise as plain facts for Jev (one evaluated object per request - never batch). */
export function gateState(c: ExerciseContent, grammar: GateGrammar | null): Json {
  const grammar_focus = grammar ? { title: grammar.title, description: grammar.description } : null;
  switch (c.type) {
    case "mcq":
      return {
        sentence: c.prompt.includes("___") ? fill(c.prompt, [c.options[c.answer]]) : `${c.prompt} -> ${c.options[c.answer]}`,
        keyed_answer: c.options[c.answer],
        other_options: c.options.filter((_, i) => i !== c.answer),
        grammar_focus,
      };
    case "cloze_mc":
      return {
        sentence: fill(c.text, c.gaps.map((g) => g.options[g.answer])),
        keyed_answer: c.gaps.map((g) => g.options[g.answer]),
        other_options: c.gaps.map((g) => g.options.filter((_, i) => i !== g.answer)),
        grammar_focus,
      };
    case "dialogue_gap":
      return {
        sentence: c.turns.map((t) => fill(t, [c.options[c.answer]])).join(" / "),
        keyed_answer: c.options[c.answer],
        other_options: c.options.filter((_, i) => i !== c.answer),
        grammar_focus,
      };
    case "error_correct":
      return {
        sentence: c.tokens.map((t, i) => (i === c.answer ? c.accept[0] : t)).join(" "),
        original: c.tokens.join(" "),
        keyed_answer: c.accept[0],
        grammar_focus,
      };
    case "open_cloze":
      return { sentence: fill(c.text, c.gaps.map((g) => g.accept[0])), keyed_answer: c.gaps.map((g) => g.accept[0]), grammar_focus };
    default:
      return { grammar_focus };
  }
}

const KEY_CORRECT = noul(
  "An English exercise for a learner has an answer key. `sentence` shows the exercise with the keyed answer filled in. Is `sentence` correct, natural standard English?",
  { true: "`sentence` is grammatically correct and natural; a teacher would accept it.", false: "`sentence` contains a grammar, word-choice or word-form error, or sounds clearly unnatural." },
);
const OTHER_CORRECT = noul(
  "`other_options` lists the options the answer key marks as WRONG (per gap, in order). Would at least one of them ALSO produce fully correct, natural English if it replaced the keyed answer in `sentence`?",
  { true: "At least one supposedly wrong option is also fully correct in its gap - the exercise has two right answers.", false: "Every other option makes the sentence wrong or clearly unnatural." },
);
const ORIGINAL_CORRECT = noul(
  "This is an error-correction exercise. `original` is the sentence the learner is told contains one error. Is `original` already fully correct standard English?",
  { true: "`original` is already correct - there is no real error to find.", false: "`original` contains a genuine error." },
);
const ON_FOCUS = noul(
  "`grammar_focus` names the grammar point this lesson teaches. Does `sentence` use or test that grammar point?",
  { true: "The sentence clearly uses or tests the grammar point in `grammar_focus`.", false: "The sentence has nothing to do with the grammar point in `grammar_focus`." },
);

export function gateQuestions(c: ExerciseContent, grammar: GateGrammar | null): Record<string, NoulQuestion> {
  const q: Record<string, NoulQuestion> = { key_correct: KEY_CORRECT };
  if (c.type === "error_correct") q.other_correct = ORIGINAL_CORRECT;
  else if (c.type !== "open_cloze") q.other_correct = OTHER_CORRECT;
  if (grammar) q.on_focus = ON_FOCUS;
  return q;
}

/** A drop reason, or null to keep the exercise. Missing scores never cause a drop. */
export function gateVerdict(scores: Record<string, number>): string | null {
  if (scores.key_correct !== undefined && scores.key_correct <= GATE_THRESHOLDS.keyCorrectMax) {
    return `gate: the keyed answer looks wrong (key_correct ${scores.key_correct.toFixed(2)})`;
  }
  if (scores.other_correct !== undefined && scores.other_correct >= GATE_THRESHOLDS.otherCorrectMin) {
    return `gate: another option also looks correct (other_correct ${scores.other_correct.toFixed(2)})`;
  }
  if (scores.on_focus !== undefined && scores.on_focus <= GATE_THRESHOLDS.onFocusMax) {
    return `gate: does not practise the grammar focus (on_focus ${scores.on_focus.toFixed(2)})`;
  }
  return null;
}
```

- [ ] **Step 4: Implement the runner** (`src/lib/lesson/qualityGate.ts`)

```ts
import type { ExerciseContent } from "./exerciseSchemas";
import { gateQuestions, gateState, gateVerdict, isGated, type GateGrammar } from "../prompts/exerciseGate";
import type { TypeSafeClient } from "../typesafe/client";

export interface GateVerdict {
  index: number;
  gated: boolean;
  drop: boolean;
  reason?: string;
  scores?: Record<string, number>;
}
export interface GateResult {
  status: "passed" | "partial" | "skipped";
  verdicts: GateVerdict[];
}

const CONCURRENCY = 4;

/**
 * Jev answer-key gate. One exercise per request (shared state contaminates answers), at most
 * 4 in flight. Best effort: no client or ANY client error -> "skipped", nothing dropped.
 */
export async function runQualityGate(
  exercises: ExerciseContent[],
  grammar: GateGrammar | null,
  client: TypeSafeClient | null,
): Promise<GateResult> {
  const keepAll = (): GateVerdict[] => exercises.map((c, index) => ({ index, gated: isGated(c), drop: false }));
  if (!client) return { status: "skipped", verdicts: keepAll() };

  const verdicts = keepAll();
  const queue = verdicts.filter((v) => v.gated).map((v) => v.index);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < queue.length) {
      const index = queue[next++];
      const c = exercises[index];
      const res = await client!.systemOne({ state: gateState(c, grammar), questions: gateQuestions(c, grammar) });
      const scores = Object.fromEntries(Object.entries(res.answers).map(([k, a]) => [k, a.noul]));
      const reason = gateVerdict(scores);
      verdicts[index] = { index, gated: true, drop: reason !== null, scores, ...(reason ? { reason } : {}) };
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } catch {
    return { status: "skipped", verdicts: keepAll() };
  }
  return { status: verdicts.some((v) => v.drop) ? "partial" : "passed", verdicts };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/lib/prompts/exerciseGate.test.ts src/lib/lesson/qualityGate.test.ts` — PASS (6 + 5). If `tsc` rejects `a.noul` because the answer map type is a union, narrow with `("noul" in a ? a.noul : undefined)` and filter undefined — do not use `any`.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/prompts/exerciseGate.ts src/lib/prompts/exerciseGate.test.ts src/lib/lesson/qualityGate.ts src/lib/lesson/qualityGate.test.ts
git commit -m "feat(m3b-2): Jev answer-key gate - one exercise per request, drop on confident failure" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 6: `generateLesson` orchestration

**Files:**
- Create: `src/lib/lesson/generateLesson.ts`
- Test: `src/lib/lesson/generateLesson.test.ts`

**Interfaces:**
- Consumes: `parseExercise`, `EXERCISE_TYPE_TAGS`, `ExerciseContent`, `ExerciseTypeName` (Task 1); `checkExercise` (Task 2); `lessonGenerationPrompt`, `GenerationInputs`, `LessonEnvelope` (Task 4); `GateResult` (Task 5); `CompleteArgs`.
- Produces:
  - `MIN_EXERCISES = 5`
  - `interface LessonDrop { attempt: 1 | 2; index: number; type?: ExerciseTypeName; reason: string }`
  - `interface LessonDraft { exercises: { type: ExerciseTypeName; content: ExerciseContent }[]; warmup: LessonEnvelope["warmup"]; scenario: LessonEnvelope["scenario"]; qualityGate: GateResult["status"]; drops: LessonDrop[]; attempts: 1 | 2 }`
  - `interface GenerationDeps { ask: (args: CompleteArgs) => Promise<LessonEnvelope>; gate: (exercises: ExerciseContent[], grammar: { title: string; description: string } | null) => Promise<GateResult> }`
  - `class LessonGenerationError extends Error { drops: LessonDrop[] }`
  - `generateLesson(inputs: GenerationInputs, deps: GenerationDeps): Promise<LessonDraft>`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { GenerationInputs, LessonEnvelope } from "../prompts/lessonGeneration";
import type { ExerciseContent, ExerciseTypeName } from "./exerciseSchemas";
import { FIXTURE_VOCAB, VALID_EXERCISES as E } from "./fixtures";
import { generateLesson, LessonGenerationError, type GenerationDeps } from "./generateLesson";
import type { GateResult } from "./qualityGate";

const MIX: ExerciseTypeName[] = ["MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP", "TRANSLATION"];
const inputs: GenerationInputs = {
  profile: { level: "B1", goals: "fluency", interests: "IT", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs and workplaces." },
  grammar: { id: "g1", title: "Past Perfect (had done)", description: "had + past participle.", example: "She had left." },
  vocab: FIXTURE_VOCAB.map((v) => ({ ...v, pos: "noun", cefrLevel: "B1" })),
  mix: MIX,
  summaries: [],
};
const envelope = (exercises: unknown[]): LessonEnvelope => ({
  exercises,
  warmup: { intro: "Let us talk about your working day.", questions: ["What do you do?", "Who with?", "What is hard?"] },
  scenario: { title: "A missed deadline", role: "You are a QA engineer.", goal: "Agree on a new date.", opening: "Do you have a minute?" },
});
const all = MIX.map((t) => E[t]);
const keepAll = (exs: ExerciseContent[]): GateResult => ({ status: "passed", verdicts: exs.map((_, index) => ({ index, gated: true, drop: false })) });
const deps = (ask: GenerationDeps["ask"], gate: GenerationDeps["gate"] = async (exs) => keepAll(exs)): GenerationDeps => ({ ask, gate });

describe("generateLesson", () => {
  it("returns every valid exercise in mix order with the framing", async () => {
    const ask = vi.fn().mockResolvedValue(envelope([...all].reverse()));
    const draft = await generateLesson(inputs, deps(ask));
    expect(draft.exercises.map((e) => e.type)).toEqual(MIX);
    expect(draft).toMatchObject({ attempts: 1, qualityGate: "passed", drops: [] });
    expect(draft.warmup.questions).toHaveLength(3);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].messages[0].content).toContain("Past Perfect");
  });

  it("drops invalid, failing-check, unrequested and duplicate exercises but keeps the lesson", async () => {
    const badCheck = { ...E.MULTIPLE_CHOICE, answer: 9 };
    const ask = vi.fn().mockResolvedValue(envelope([badCheck, E.CLOZE_DROPDOWN, E.FILL_BLANK, E.ERROR_CORRECTION, E.MATCH, E.DIALOGUE_GAP, E.DICTATION, E.MATCH, { junk: 1 }]));
    const draft = await generateLesson(inputs, deps(ask));
    expect(draft.exercises.map((e) => e.type)).toEqual(["CLOZE_DROPDOWN", "FILL_BLANK", "ERROR_CORRECTION", "MATCH", "DIALOGUE_GAP"]);
    const reasons = draft.drops.map((d) => d.reason).join(" | ");
    expect(reasons).toMatch(/answer index/);
    expect(reasons).toMatch(/not requested/);
    expect(reasons).toMatch(/duplicate/);
    expect(draft.drops).toHaveLength(4);
    expect(draft.attempts).toBe(1);
  });

  it("applies the gate verdicts to the surviving exercises only", async () => {
    const ask = vi.fn().mockResolvedValue(envelope(all));
    const gate = vi.fn(async (exs: ExerciseContent[]): Promise<GateResult> => ({
      status: "partial",
      verdicts: exs.map((c, index) => ({ index, gated: true, drop: c.type === "mcq", ...(c.type === "mcq" ? { reason: "gate: the keyed answer looks wrong" } : {}) })),
    }));
    const draft = await generateLesson(inputs, deps(ask, gate));
    expect(draft.exercises.map((e) => e.type)).not.toContain("MULTIPLE_CHOICE");
    expect(draft.qualityGate).toBe("partial");
    expect(draft.drops[0]).toMatchObject({ type: "MULTIPLE_CHOICE", attempt: 1 });
    expect(gate.mock.calls[0][1]).toEqual({ title: "Past Perfect (had done)", description: "had + past participle." });
  });

  it("regenerates once when fewer than 5 survive, and the second attempt can rescue the lesson", async () => {
    const ask = vi.fn().mockResolvedValueOnce(envelope(all.slice(0, 3))).mockResolvedValueOnce(envelope(all));
    const draft = await generateLesson(inputs, deps(ask));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(draft.attempts).toBe(2);
    expect(draft.exercises).toHaveLength(7);
  });

  it("throws LessonGenerationError with every drop reason after two failed attempts", async () => {
    const ask = vi.fn().mockResolvedValueOnce(envelope([{ junk: 1 }])).mockRejectedValueOnce(new Error("LLM JSON validation failed"));
    const err = await generateLesson(inputs, deps(ask)).catch((e) => e);
    expect(err).toBeInstanceOf(LessonGenerationError);
    // attempt 1: the junk exercise + "only 0 survived"; attempt 2: the failed regeneration
    expect(err.drops.map((d: { attempt: number }) => d.attempt)).toEqual([1, 1, 2]);
    expect(err.message).toMatch(/LLM JSON validation failed/);
  });

  it("passes no grammar to the gate for a vocab-only lesson", async () => {
    const gate = vi.fn(async (exs: ExerciseContent[]) => keepAll(exs));
    await generateLesson({ ...inputs, grammar: null }, deps(vi.fn().mockResolvedValue(envelope(all)), gate));
    expect(gate.mock.calls[0][1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement** (`src/lib/lesson/generateLesson.ts`)

```ts
import type { CompleteArgs } from "../llm/types";
import { lessonGenerationPrompt, type GenerationInputs, type LessonEnvelope } from "../prompts/lessonGeneration";
import { checkExercise } from "./exerciseChecks";
import { parseExercise, type ExerciseContent, type ExerciseTypeName } from "./exerciseSchemas";
import type { GateResult } from "./qualityGate";

export const MIN_EXERCISES = 5;

export interface LessonDrop {
  attempt: 1 | 2;
  index: number;
  type?: ExerciseTypeName;
  reason: string;
}

export interface LessonDraft {
  exercises: { type: ExerciseTypeName; content: ExerciseContent }[];
  warmup: LessonEnvelope["warmup"];
  scenario: LessonEnvelope["scenario"];
  qualityGate: GateResult["status"];
  drops: LessonDrop[];
  attempts: 1 | 2;
}

export interface GenerationDeps {
  ask: (args: CompleteArgs) => Promise<LessonEnvelope>;
  gate: (exercises: ExerciseContent[], grammar: { title: string; description: string } | null) => Promise<GateResult>;
}

export class LessonGenerationError extends Error {
  constructor(message: string, readonly drops: LessonDrop[]) {
    super(message);
    this.name = "LessonGenerationError";
  }
}

/**
 * One Claude call per attempt; every exercise is validated on its own (schema -> deterministic
 * checks -> Jev gate) so a bad exercise is dropped, not the lesson. Fewer than MIN_EXERCISES
 * survivors -> one regeneration; then LessonGenerationError. Writes nothing.
 */
export async function generateLesson(inputs: GenerationInputs, deps: GenerationDeps): Promise<LessonDraft> {
  const prompt = lessonGenerationPrompt(inputs);
  const grammar = inputs.grammar ? { title: inputs.grammar.title, description: inputs.grammar.description } : null;
  const ctx = { vocab: inputs.vocab.map((v) => ({ id: v.id, headword: v.headword })) };
  const drops: LessonDrop[] = [];

  for (const attempt of [1, 2] as const) {
    let envelope: LessonEnvelope;
    try {
      envelope = await deps.ask(prompt);
    } catch (e) {
      drops.push({ attempt, index: -1, reason: `generation failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }

    const valid: { index: number; type: ExerciseTypeName; content: ExerciseContent }[] = [];
    const seen = new Set<ExerciseTypeName>();
    envelope.exercises.forEach((raw, index) => {
      const parsed = parseExercise(raw);
      if (!parsed.ok) return void drops.push({ attempt, index, reason: parsed.reason });
      const { type, content } = parsed;
      if (!inputs.mix.includes(type)) return void drops.push({ attempt, index, type, reason: "type was not requested for this lesson" });
      if (seen.has(type)) return void drops.push({ attempt, index, type, reason: "duplicate of an exercise type already present" });
      const problems = checkExercise(content, ctx);
      if (problems.length > 0) return void drops.push({ attempt, index, type, reason: problems.join("; ") });
      seen.add(type);
      valid.push({ index, type, content });
    });

    const gate = await deps.gate(valid.map((v) => v.content), grammar);
    const survivors = valid.filter((v, i) => {
      const verdict = gate.verdicts[i];
      if (verdict?.drop) drops.push({ attempt, index: v.index, type: v.type, reason: verdict.reason ?? "gate: dropped" });
      return !verdict?.drop;
    });

    if (survivors.length >= MIN_EXERCISES) {
      const order = (t: ExerciseTypeName) => inputs.mix.indexOf(t);
      return {
        exercises: survivors.sort((a, b) => order(a.type) - order(b.type)).map(({ type, content }) => ({ type, content })),
        warmup: envelope.warmup,
        scenario: envelope.scenario,
        qualityGate: gate.status,
        drops,
        attempts: attempt,
      };
    }
    drops.push({ attempt, index: -1, reason: `only ${survivors.length} of ${inputs.mix.length} exercises survived (need ${MIN_EXERCISES})` });
  }

  throw new LessonGenerationError(
    "Lesson generation failed twice: " + drops.filter((d) => d.index === -1).map((d) => d.reason).join(" | "),
    drops,
  );
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (6 tests). In the second test the expected drop count is 4: bad-check mcq, unrequested DICTATION, duplicate MATCH, junk object.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/generateLesson.ts src/lib/lesson/generateLesson.test.ts
git commit -m "feat(m3b-2): generateLesson - per-exercise validation, gate, one regeneration" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 7: Selection — core of the level below first; history counts only started lessons

**Files:**
- Modify: `src/lib/curriculum/select.ts`, `src/lib/curriculum/lessonInputs.ts`
- Test: `src/lib/curriculum/select.test.ts`, `src/lib/curriculum/lessonInputs.test.ts`

**Interfaces:**
- Produces: same signatures. `pickGrammarFocus` gains one step before the existing band walk; `selectLessonInputs` filters lesson history by status.

- [ ] **Step 1: Add the failing tests**

In `select.test.ts`, inside `describe("pickGrammarFocus", …)` (the `G` helper takes `(name, level, status, sortOrder, openErrors = 0, { teachable?, importance? })`):

```ts
  it("serves unfinished core (importance 1) topics of the band below before the learner's own band", () => {
    const topics = [
      G("b1-core", "B1", "NOT_STARTED", 1, 0, { importance: 1 }),
      G("a2-core", "A2", "NOT_STARTED", 9, 0, { importance: 1 }),
      G("a2-useful", "A2", "NOT_STARTED", 1, 0, { importance: 2 }),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("a2-core");
  });

  it("ignores below-level topics that are mastered, non-teachable or not core", () => {
    const topics = [
      G("a2-done", "A2", "MASTERED", 1, 0, { importance: 1 }),
      G("a2-trivial", "A2", "NOT_STARTED", 1, 0, { importance: 1, teachable: false }),
      G("a2-useful", "A2", "NOT_STARTED", 1, 0, { importance: 2 }),
      G("b1", "B1", "NOT_STARTED", 5),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("b1");
  });

  it("looks only ONE band below and applies the same ordering inside the below-level core", () => {
    const topics = [
      G("a1-core", "A1", "NOT_STARTED", 1, 0, { importance: 1 }),
      G("a2-new", "A2", "NOT_STARTED", 1, 0, { importance: 1 }),
      G("a2-practising", "A2", "PRACTICING", 9, 1, { importance: 1 }),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("a2-practising");
    expect(pickGrammarFocus([topics[0]], "B1")).toBeNull();
  });

  it("has no band below A1", () => {
    expect(pickGrammarFocus([G("a1", "A1", "NOT_STARTED", 1, 0, { importance: 1 })], "A1")?.name).toBe("a1");
  });
```

In `lessonInputs.test.ts`, in the test "combines profile, rotation history, …" extend the lesson-query assertion to:

```ts
    expect(calls.lesson).toMatchObject({
      where: { theme: { not: null }, status: { in: ["IN_PROGRESS", "COMPLETED"] } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/curriculum/select.test.ts src/lib/curriculum/lessonInputs.test.ts` — the first and third new `pickGrammarFocus` tests and the query assertion FAIL.

- [ ] **Step 3: Implement**

In `select.ts`, extract the sort into a helper and add the below-level step:

```ts
const byFocusPriority = <T extends GrammarCandidate>(pool: T[]): T[] =>
  [...pool].sort(
    (a, b) =>
      grammarRank(a) - grammarRank(b) ||
      a.importance - b.importance ||
      a.sortOrder - b.sortOrder ||
      cmp(a.name, b.name),
  );

export function pickGrammarFocus<T extends GrammarCandidate>(topics: T[], level: CefrBand): T | null {
  const open = topics.filter((t) => t.status !== "MASTERED" && t.teachable);
  const at = CEFR_BANDS.indexOf(level);

  // Review-as-diagnosis: unfinished CORE topics of the band directly below come first
  // (a B1 learner is checked on A2 Present Perfect before B1 Past Perfect).
  if (at > 0) {
    const below = CEFR_BANDS[at - 1];
    const core = open.filter((t) => t.cefrLevel === below && t.importance === 1);
    if (core.length > 0) return byFocusPriority(core)[0];
  }

  for (const band of CEFR_BANDS.slice(at)) {
    const pool = open.filter((t) => t.cefrLevel === band);
    if (pool.length === 0) continue; // nothing teachable left here -> next band
    return byFocusPriority(pool)[0];
  }
  return null;
}
```

In `lessonInputs.ts`, change the lesson history `where` to:

```ts
    where: { theme: { not: null }, status: { in: ["IN_PROGRESS", "COMPLETED"] } }, // an unstarted lesson must not burn its theme
```

- [ ] **Step 4: Run to verify everything passes**

Run: `npx vitest run src/lib/curriculum; npx tsc --noEmit` — all green, including every pre-existing `pickGrammarFocus` test (their below-level topics have the default importance 2, so they are unaffected).

- [ ] **Step 5: Live sanity check (read-only)**

```powershell
npm run db:start
npm run curriculum:preview
```

Expected: the grammar line now shows an **A2 core** topic (e.g. a Present Perfect / Past Progressive / Future / Passive title) instead of "Past Perfect (had done)". Paste the output into your report.

- [ ] **Step 6: Commit**

```powershell
npm test
git add src/lib/curriculum/select.ts src/lib/curriculum/select.test.ts src/lib/curriculum/lessonInputs.ts src/lib/curriculum/lessonInputs.test.ts
git commit -m "feat(m3b-2): grammar focus serves the core of the band below first; theme history counts only started lessons" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 8: Persistence — `createLesson` and `startLesson`

**Files:**
- Create: `src/lib/lesson/createLesson.ts`, `src/lib/lesson/startLesson.ts`
- Test: `src/lib/lesson/createLesson.test.ts`, `src/lib/lesson/startLesson.test.ts`

**Interfaces:**
- Consumes: `LessonDraft` (Task 6); `LessonInputs`, `selectLessonInputs`, `LessonInputsDb` from `src/lib/curriculum/lessonInputs.ts`; `planExerciseMix` (Task 3); `GenerationInputs` (Task 4); `generateLesson`, `GenerationDeps` (Task 6); Prisma types.
- Produces:
  - `type CreateLessonDb = Pick<PrismaClient, "$transaction">`
  - `buildPlan(draft: LessonDraft, exerciseIds: string[], meta: { grammarTopicId: string | null; vocabIds: string[]; exerciseMix: string[] }): LessonPlan` (pure) and `interface LessonPlan` (shape in the spec)
  - `createLesson(db: CreateLessonDb, draft: LessonDraft, inputs: LessonInputs, mix: ExerciseTypeName[], now: Date): Promise<string>` (lesson id)
  - `toGenerationInputs(inputs: LessonInputs, mix: ExerciseTypeName[], summaries: string[]): GenerationInputs` (pure)
  - `type StartLessonDb = LessonInputsDb & CreateLessonDb & Pick<PrismaClient, "lesson">`
  - `startLesson(deps: { db: StartLessonDb; generation: GenerationDeps; now?: Date }): Promise<{ lessonId: string; reused: boolean }>`

- [ ] **Step 1: Write the failing tests**

`src/lib/lesson/createLesson.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { LessonInputs } from "../curriculum/lessonInputs";
import { buildPlan, createLesson, type CreateLessonDb } from "./createLesson";
import { VALID_EXERCISES as E } from "./fixtures";
import type { LessonDraft } from "./generateLesson";

const now = new Date("2026-09-18T10:00:00Z");
const draft: LessonDraft = {
  exercises: [{ type: "MULTIPLE_CHOICE", content: E.MULTIPLE_CHOICE }, { type: "TRANSLATION", content: E.TRANSLATION }],
  warmup: { intro: "Let us talk about work.", questions: ["q1?", "q2?", "q3?"] },
  scenario: { title: "A missed deadline", role: "You are a QA engineer.", goal: "Agree on a new date.", opening: "Got a minute?" },
  qualityGate: "partial",
  drops: [{ attempt: 1, index: 3, reason: "x" }],
  attempts: 1,
};
const inputs = {
  profile: { id: "p1" },
  theme: { key: "work", label: "Work & careers", description: "d" },
  grammarTopic: { id: "g1", name: "PAST PERFECT", status: "NOT_STARTED" },
  vocab: [{ id: "v1" }, { id: "v2" }],
  dueErrors: [],
} as unknown as LessonInputs;
const mix = ["MULTIPLE_CHOICE", "TRANSLATION"] as const;

function fakeDb() {
  const log: string[] = [];
  let n = 0;
  const rec = (name: string, result: unknown) => vi.fn(async (args: unknown) => (log.push(name), (calls[name] ??= []).push(args), result));
  const calls: Record<string, unknown[]> = {};
  const tx = {
    lesson: { create: rec("lesson.create", { id: "L1" }), update: rec("lesson.update", {}) },
    exercise: { create: vi.fn(async (args: unknown) => (log.push("exercise.create"), (calls["exercise.create"] ??= []).push(args), { id: `E${++n}` })) },
    grammarTopic: { update: rec("grammarTopic.update", {}) },
    vocabItem: { updateMany: rec("vocabItem.updateMany", { count: 2 }) },
  };
  const db = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as unknown as CreateLessonDb;
  return { db, log, calls };
}

describe("buildPlan", () => {
  it("has the final SPEC shape with an empty review section", () => {
    const plan = buildPlan(draft, ["E1", "E2"], { grammarTopicId: "g1", vocabIds: ["v1", "v2"], exerciseMix: [...mix] });
    expect(plan).toEqual({
      version: 1,
      sections: {
        review: { exerciseIds: [] },
        warmup: draft.warmup,
        written: { exerciseIds: ["E1", "E2"] },
        scenario: draft.scenario,
      },
      meta: { grammarTopicId: "g1", vocabIds: ["v1", "v2"], exerciseMix: ["MULTIPLE_CHOICE", "TRANSLATION"], qualityGate: "partial", drops: 1, attempts: 1 },
    });
  });
});

describe("createLesson", () => {
  it("writes everything in one transaction, sequentially, and returns the lesson id", async () => {
    const { db, log, calls } = fakeDb();
    expect(await createLesson(db, draft, inputs, [...mix], now)).toBe("L1");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(log).toEqual([
      "lesson.create", "exercise.create", "exercise.create", "lesson.update",
      "grammarTopic.update", "vocabItem.updateMany", "vocabItem.updateMany",
    ]);
    expect(calls["lesson.create"][0]).toMatchObject({ data: { status: "PLANNED", theme: "work", date: now } });
    expect(calls["exercise.create"][0]).toMatchObject({ data: { lessonId: "L1", type: "MULTIPLE_CHOICE", content: E.MULTIPLE_CHOICE } });
    expect(calls["lesson.update"][0]).toMatchObject({ where: { id: "L1" }, data: { plan: { sections: { written: { exerciseIds: ["E1", "E2"] } } } } });
  });

  it("introduces a NOT_STARTED grammar topic and marks NEW vocab as SEEN", async () => {
    const { db, calls } = fakeDb();
    await createLesson(db, draft, inputs, [...mix], now);
    expect(calls["grammarTopic.update"][0]).toEqual({
      where: { id: "g1" },
      data: { status: "INTRODUCED", timesUsed: { increment: 1 }, lastUsedAt: now },
    });
    expect(calls["vocabItem.updateMany"]).toEqual([
      { where: { id: { in: ["v1", "v2"] }, status: "NEW" }, data: { status: "SEEN" } },
      { where: { id: { in: ["v1", "v2"] } }, data: { lastSeenAt: now } },
    ]);
  });

  it("does not downgrade a topic that is already beyond NOT_STARTED, and copes with no grammar", async () => {
    const a = fakeDb();
    await createLesson(a.db, draft, { ...inputs, grammarTopic: { id: "g1", status: "PRACTICING" } } as unknown as LessonInputs, [...mix], now);
    expect(a.calls["grammarTopic.update"][0]).toEqual({ where: { id: "g1" }, data: { timesUsed: { increment: 1 }, lastUsedAt: now } });

    const b = fakeDb();
    await createLesson(b.db, draft, { ...inputs, grammarTopic: null } as unknown as LessonInputs, [...mix], now);
    expect(b.calls["grammarTopic.update"]).toBeUndefined();
    expect(b.calls["lesson.update"][0]).toMatchObject({ data: { plan: { meta: { grammarTopicId: null } } } });
  });
});
```

`src/lib/lesson/startLesson.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../curriculum/lessonInputs", async (orig) => ({
  ...(await orig<typeof import("../curriculum/lessonInputs")>()),
  selectLessonInputs: vi.fn(),
}));
vi.mock("./generateLesson", async (orig) => ({ ...(await orig<typeof import("./generateLesson")>()), generateLesson: vi.fn() }));
vi.mock("./createLesson", async (orig) => ({ ...(await orig<typeof import("./createLesson")>()), createLesson: vi.fn() }));
vi.mock("../db", () => ({ prisma: {} }));

import { selectLessonInputs } from "../curriculum/lessonInputs";
import { createLesson } from "./createLesson";
import { generateLesson } from "./generateLesson";
import { startLesson, toGenerationInputs, type StartLessonDb } from "./startLesson";

const now = new Date(2026, 8, 18, 15, 30); // local time
const inputs = {
  profile: { level: "B1+", goals: "fluency", interests: "IT", nativeLang: "ru" },
  theme: { key: "work", label: "Work & careers", description: "Jobs." },
  grammarTopic: { id: "g1", name: "TENSE/ASPECT: PAST PERFECT", title: "Past Perfect (had done)", description: "had + pp", example: "She had left." },
  vocab: [{ id: "v1", headword: "deadline", pos: "noun", cefrLevel: "B1" }],
  dueErrors: [],
};

function fakeDb(existing: unknown) {
  const findFirst = vi.fn().mockResolvedValue(existing);
  const count = vi.fn().mockResolvedValue(2);
  const findMany = vi.fn().mockResolvedValue([{ summary: "s2" }, { summary: "s1" }]);
  return { db: { lesson: { findFirst, count, findMany } } as unknown as StartLessonDb, findFirst, count, findMany };
}
const generation = { ask: vi.fn(), gate: vi.fn() };

beforeEach(() => {
  vi.mocked(selectLessonInputs).mockReset().mockResolvedValue(inputs as never);
  vi.mocked(generateLesson).mockReset().mockResolvedValue({ exercises: [] } as never);
  vi.mocked(createLesson).mockReset().mockResolvedValue("L9");
});

describe("toGenerationInputs", () => {
  it("falls back to the raw topic name and empty strings when the topic is not enriched", () => {
    const g = toGenerationInputs({ ...inputs, grammarTopic: { id: "g1", name: "RAW NAME", title: null, description: null, example: null } } as never, ["TRANSLATION"], []);
    expect(g.grammar).toEqual({ id: "g1", title: "RAW NAME", description: "", example: "" });
    expect(toGenerationInputs({ ...inputs, grammarTopic: null } as never, ["TRANSLATION"], []).grammar).toBeNull();
  });
});

describe("startLesson", () => {
  it("reuses today's PLANNED/IN_PROGRESS lesson without generating", async () => {
    const f = fakeDb({ id: "L1" });
    expect(await startLesson({ db: f.db, generation, now })).toEqual({ lessonId: "L1", reused: true });
    expect(generateLesson).not.toHaveBeenCalled();
    const where = f.findFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["PLANNED", "IN_PROGRESS"] });
    expect(where.date.gte).toEqual(new Date(2026, 8, 18));
    expect(where.date.lt).toEqual(new Date(2026, 8, 19));
  });

  it("selects, plans the mix from the lesson number, generates and persists", async () => {
    const f = fakeDb(null);
    expect(await startLesson({ db: f.db, generation, now })).toEqual({ lessonId: "L9", reused: false });

    const genInputs = vi.mocked(generateLesson).mock.calls[0][0];
    expect(genInputs.mix).toContain("OPEN_WRITING"); // 2 existing lessons -> lesson 3
    expect(genInputs.grammar).toMatchObject({ id: "g1", title: "Past Perfect (had done)" });
    expect(genInputs.summaries).toEqual(["s2", "s1"]);
    expect(vi.mocked(generateLesson).mock.calls[0][1]).toBe(generation);

    expect(f.findMany.mock.calls[0][0]).toMatchObject({ where: { status: "COMPLETED", summary: { not: null } }, take: 3 });
    const createArgs = vi.mocked(createLesson).mock.calls[0];
    expect(createArgs[2]).toBe(inputs);
    expect(createArgs[3]).toEqual(genInputs.mix);
    expect(createArgs[4]).toBe(now);
  });

  it("plans a vocab-only mix when the syllabus is mastered", async () => {
    vi.mocked(selectLessonInputs).mockResolvedValue({ ...inputs, grammarTopic: null } as never);
    await startLesson({ db: fakeDb(null).db, generation, now });
    expect(vi.mocked(generateLesson).mock.calls[0][0].mix).not.toContain("ERROR_CORRECTION");
  });
});
```

- [ ] **Step 2: Run to verify they fail** — modules missing.

- [ ] **Step 3: Implement `createLesson.ts`**

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
import type { LessonInputs } from "../curriculum/lessonInputs";
import type { ExerciseTypeName } from "./exerciseSchemas";
import type { LessonDraft } from "./generateLesson";

export type CreateLessonDb = Pick<PrismaClient, "$transaction">;

/** `Lesson.plan` — the final SPEC shape. Review stays empty until M4; the player skips empty sections. */
export interface LessonPlan {
  version: 1;
  sections: {
    review: { exerciseIds: string[] };
    warmup: LessonDraft["warmup"];
    written: { exerciseIds: string[] };
    scenario: LessonDraft["scenario"];
  };
  meta: {
    grammarTopicId: string | null;
    vocabIds: string[];
    exerciseMix: string[];
    qualityGate: LessonDraft["qualityGate"];
    drops: number;
    attempts: 1 | 2;
  };
}

export function buildPlan(
  draft: LessonDraft,
  exerciseIds: string[],
  meta: { grammarTopicId: string | null; vocabIds: string[]; exerciseMix: string[] },
): LessonPlan {
  return {
    version: 1,
    sections: {
      review: { exerciseIds: [] },
      warmup: draft.warmup,
      written: { exerciseIds },
      scenario: draft.scenario,
    },
    meta: { ...meta, qualityGate: draft.qualityGate, drops: draft.drops.length, attempts: draft.attempts },
  };
}

/**
 * Persist a generated lesson atomically. Queries are awaited one by one - the pg adapter
 * holds a single connection, also inside a transaction.
 */
export async function createLesson(
  db: CreateLessonDb,
  draft: LessonDraft,
  inputs: LessonInputs,
  mix: ExerciseTypeName[],
  now: Date,
): Promise<string> {
  const vocabIds = inputs.vocab.map((v) => v.id);
  const topic = inputs.grammarTopic;

  return db.$transaction(async (tx) => {
    const lesson = await tx.lesson.create({
      data: { status: "PLANNED", theme: inputs.theme.key, date: now, plan: {} },
    });

    const exerciseIds: string[] = [];
    for (const e of draft.exercises) {
      const row = await tx.exercise.create({
        data: { lessonId: lesson.id, type: e.type, content: e.content as unknown as Prisma.InputJsonValue },
      });
      exerciseIds.push(row.id);
    }

    const plan = buildPlan(draft, exerciseIds, { grammarTopicId: topic?.id ?? null, vocabIds, exerciseMix: mix });
    await tx.lesson.update({ where: { id: lesson.id }, data: { plan: plan as unknown as Prisma.InputJsonValue } });

    if (topic) {
      await tx.grammarTopic.update({
        where: { id: topic.id },
        data: {
          ...(topic.status === "NOT_STARTED" ? { status: "INTRODUCED" as const } : {}),
          timesUsed: { increment: 1 },
          lastUsedAt: now,
        },
      });
    }
    await tx.vocabItem.updateMany({ where: { id: { in: vocabIds }, status: "NEW" }, data: { status: "SEEN" } });
    await tx.vocabItem.updateMany({ where: { id: { in: vocabIds } }, data: { lastSeenAt: now } });

    return lesson.id;
  });
}
```

- [ ] **Step 4: Implement `startLesson.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { selectLessonInputs, type LessonInputs, type LessonInputsDb } from "../curriculum/lessonInputs";
import type { GenerationInputs } from "../prompts/lessonGeneration";
import { createLesson, type CreateLessonDb } from "./createLesson";
import { planExerciseMix } from "./exerciseMix";
import type { ExerciseTypeName } from "./exerciseSchemas";
import { generateLesson, type GenerationDeps } from "./generateLesson";

export type StartLessonDb = LessonInputsDb & CreateLessonDb & Pick<PrismaClient, "lesson">;

const SUMMARY_HISTORY = 3;

export function toGenerationInputs(inputs: LessonInputs, mix: ExerciseTypeName[], summaries: string[]): GenerationInputs {
  const t = inputs.grammarTopic;
  return {
    profile: {
      level: inputs.profile.level,
      goals: inputs.profile.goals,
      interests: inputs.profile.interests,
      nativeLang: inputs.profile.nativeLang,
    },
    theme: { key: inputs.theme.key, label: inputs.theme.label, description: inputs.theme.description },
    // Not-yet-enriched DB: fall back to the dataset name rather than sending "null" to Claude.
    grammar: t ? { id: t.id, title: t.title ?? t.name, description: t.description ?? "", example: t.example ?? "" } : null,
    vocab: inputs.vocab.map((v) => ({ id: v.id, headword: v.headword, pos: v.pos, cefrLevel: v.cefrLevel })),
    mix,
    summaries,
  };
}

/** POST /api/lesson/start. Idempotent per local calendar day. Sequential queries only. */
export async function startLesson(deps: {
  db?: StartLessonDb;
  generation: GenerationDeps;
  now?: Date;
}): Promise<{ lessonId: string; reused: boolean }> {
  const db = deps.db ?? (prisma as unknown as StartLessonDb);
  const now = deps.now ?? new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const existing = await db.lesson.findFirst({
    where: { status: { in: ["PLANNED", "IN_PROGRESS"] }, date: { gte: dayStart, lt: dayEnd } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (existing) return { lessonId: existing.id, reused: true };

  const inputs = await selectLessonInputs(db, now);
  const lessonNumber = (await db.lesson.count()) + 1;
  const mix = planExerciseMix(lessonNumber, { hasGrammar: inputs.grammarTopic !== null });

  const recent = await db.lesson.findMany({
    where: { status: "COMPLETED", summary: { not: null } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: SUMMARY_HISTORY,
    select: { summary: true },
  });
  const summaries = recent.map((l) => l.summary).filter((s): s is string => s !== null);

  const draft = await generateLesson(toGenerationInputs(inputs, mix, summaries), deps.generation);
  const lessonId = await createLesson(db, draft, inputs, mix, now);
  return { lessonId, reused: false };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/lib/lesson/createLesson.test.ts src/lib/lesson/startLesson.test.ts; npx tsc --noEmit` — PASS (4 + 4). Typing note: Prisma's interactive-transaction callback type is `(tx: Prisma.TransactionClient) => Promise<R>`; if `tsc` rejects the `"INTRODUCED" as const` spread or the JSON casts, keep the runtime identical and fix only the types (report the change).

- [ ] **Step 6: Commit**

```powershell
npm test
git add src/lib/lesson/createLesson.ts src/lib/lesson/createLesson.test.ts src/lib/lesson/startLesson.ts src/lib/lesson/startLesson.test.ts
git commit -m "feat(m3b-2): transactional lesson persistence and idempotent startLesson" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 9: Live dependencies + acceptance script (⛔ owner review gate)

**Files:**
- Create: `src/lib/lesson/liveDeps.ts`, `scripts/lesson-preview.ts`
- Modify: `package.json` (scripts)
- Test: `src/lib/lesson/liveDeps.test.ts`

**Interfaces:**
- Consumes: `completeJson` from `src/lib/llm/index.ts`; `lessonEnvelopeSchema` (Task 4); `runQualityGate` (Task 5); `createTypeSafeClient`; `GenerationDeps` (Task 6); `selectLessonInputs`; `planExerciseMix`; `toGenerationInputs` (Task 8); `generateLesson`.
- Produces: `liveGenerationDeps(): GenerationDeps` — `ask` = `completeJson("lesson_generation", args, lessonEnvelopeSchema)`; `gate` uses a TypeSafe client created lazily, or `null` when `TYPESAFE_API_KEY` is missing (gate → `skipped`). `npm run lesson:generate`.

- [ ] **Step 1: Write the failing test** (`src/lib/lesson/liveDeps.test.ts`)

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm/index", () => ({ completeJson: vi.fn().mockResolvedValue({ exercises: [] }) }));
vi.mock("./qualityGate", () => ({ runQualityGate: vi.fn().mockResolvedValue({ status: "skipped", verdicts: [] }) }));
vi.mock("../typesafe/client", () => ({ createTypeSafeClient: vi.fn() }));

import { completeJson } from "../llm/index";
import { lessonEnvelopeSchema } from "../prompts/lessonGeneration";
import { createTypeSafeClient } from "../typesafe/client";
import { liveGenerationDeps } from "./liveDeps";
import { runQualityGate } from "./qualityGate";

beforeEach(() => vi.clearAllMocks());

describe("liveGenerationDeps", () => {
  it("asks Claude through the facade with the lesson_generation role and the envelope schema", async () => {
    const args = { system: "s", messages: [{ role: "user" as const, content: "u" }] };
    await liveGenerationDeps().ask(args);
    expect(completeJson).toHaveBeenCalledWith("lesson_generation", args, lessonEnvelopeSchema);
  });

  it("creates the Jev client once and passes it to the gate", async () => {
    const client = { systemOne: vi.fn() };
    vi.mocked(createTypeSafeClient).mockReturnValue(client as never);
    const deps = liveGenerationDeps();
    await deps.gate([], null);
    await deps.gate([], null);
    expect(createTypeSafeClient).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runQualityGate).mock.calls[0][2]).toBe(client);
  });

  it("runs the gate without a client when the key is missing", async () => {
    vi.mocked(createTypeSafeClient).mockImplementation(() => {
      throw new Error("TYPESAFE_API_KEY is not set");
    });
    await liveGenerationDeps().gate([], null);
    expect(vi.mocked(runQualityGate).mock.calls[0][2]).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement `src/lib/lesson/liveDeps.ts`:

```ts
import { completeJson } from "../llm/index";
import { lessonEnvelopeSchema, type LessonEnvelope } from "../prompts/lessonGeneration";
import { createTypeSafeClient, type TypeSafeClient } from "../typesafe/client";
import type { GenerationDeps } from "./generateLesson";
import { runQualityGate } from "./qualityGate";

/** Real ask/gate for the route and the preview script. The Jev gate is best effort by design. */
export function liveGenerationDeps(): GenerationDeps {
  let client: TypeSafeClient | null | undefined;
  const jev = (): TypeSafeClient | null => {
    if (client === undefined) {
      try {
        client = createTypeSafeClient();
      } catch {
        client = null; // no key -> gate reports "skipped"
      }
    }
    return client;
  };
  return {
    ask: (args) => completeJson<LessonEnvelope>("lesson_generation", args, lessonEnvelopeSchema),
    gate: (exercises, grammar) => runQualityGate(exercises, grammar, jev()),
  };
}
```

Run: `npx vitest run src/lib/lesson/liveDeps.test.ts` — PASS (3).

- [ ] **Step 3: Write the acceptance script** (`scripts/lesson-preview.ts`)

```ts
/**
 * Acceptance tool for M3b-2: generate ONE lesson live (Claude + Jev) and print it. NO DB WRITES.
 *   npm run lesson:generate            # the lesson the app would generate next
 *   npm run lesson:generate -- --n 3   # pretend it is lesson number 3 (adds OPEN_WRITING)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

async function main() {
  if (process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is set - unset it (pay-per-token billing).");
  const { prisma } = await import("../src/lib/db");
  const { selectLessonInputs } = await import("../src/lib/curriculum/lessonInputs");
  const { planExerciseMix } = await import("../src/lib/lesson/exerciseMix");
  const { toGenerationInputs } = await import("../src/lib/lesson/startLesson");
  const { generateLesson, LessonGenerationError } = await import("../src/lib/lesson/generateLesson");
  const { liveGenerationDeps } = await import("../src/lib/lesson/liveDeps");

  const i = process.argv.indexOf("--n");
  const inputs = await selectLessonInputs();
  const lessonNumber = i >= 0 ? Number(process.argv[i + 1]) : (await prisma.lesson.count()) + 1;
  const mix = planExerciseMix(lessonNumber, { hasGrammar: inputs.grammarTopic !== null });

  console.log(`Lesson #${lessonNumber}  theme: ${inputs.theme.label}`);
  console.log(`grammar: ${inputs.grammarTopic ? `${inputs.grammarTopic.title ?? inputs.grammarTopic.name} (${inputs.grammarTopic.cefrLevel})` : "- none -"}`);
  console.log(`vocab  : ${inputs.vocab.map((v) => `${v.headword}[${v.id.slice(-4)}]`).join(", ")}`);
  console.log(`mix    : ${mix.join(", ")}\n`);

  const started = Date.now();
  try {
    const draft = await generateLesson(toGenerationInputs(inputs, mix, []), liveGenerationDeps());
    console.log(`generated in ${Math.round((Date.now() - started) / 1000)}s, attempts ${draft.attempts}, gate ${draft.qualityGate}, drops ${draft.drops.length}\n`);
    draft.exercises.forEach((e, n) => console.log(`--- ${n + 1}. ${e.type}\n${JSON.stringify(e.content, null, 2)}\n`));
    console.log("--- WARM-UP\n" + JSON.stringify(draft.warmup, null, 2));
    console.log("--- SCENARIO\n" + JSON.stringify(draft.scenario, null, 2));
    if (draft.drops.length) console.log("--- DROPS\n" + draft.drops.map((d) => `  attempt ${d.attempt} #${d.index} ${d.type ?? ""}: ${d.reason}`).join("\n"));
  } catch (e) {
    if (e instanceof LessonGenerationError) {
      console.error(e.message + "\n" + e.drops.map((d) => `  attempt ${d.attempt} #${d.index} ${d.type ?? ""}: ${d.reason}`).join("\n"));
      process.exitCode = 1;
    } else throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

Add to `package.json` scripts: `"lesson:generate": "tsx scripts/lesson-preview.ts"`.

- [ ] **Step 4: Type-check, test, then run it live THREE times**

```powershell
npx tsc --noEmit; npm test
npm run db:start
npm run lesson:generate
npm run lesson:generate -- --n 2
npm run lesson:generate -- --n 3
```

Use the maximum command timeout (each run is one Agent SDK call of roughly 60–150 s plus the Jev gate). Save each full output to `<workspace>/lesson-sample-<n>.txt` (the path is in your dispatch). If a run fails with `LessonGenerationError`, that is data, not a blocker — keep the output.

- [ ] **Step 5: Judge the samples yourself before the owner does**

For every exercise: is the keyed answer right? could another option also be right? does it practise the grammar focus? is the level right for B1? are target words used naturally and listed in `vocab`? is `explain` helpful? Are drops justified (read each reason)? If a class of problems is systematic, adjust the SYSTEM text or a `SHAPES` entry in `src/lib/prompts/lessonGeneration.ts` (keep its tests green) and re-run. At most 2 tuning rounds — then report what is still off. Do not loosen `checkExercise` or the schemas to make drops disappear without saying so.

- [ ] **Step 6: Commit and STOP for owner review**

```powershell
npx tsc --noEmit; npm test
git add src/lib/lesson/liveDeps.ts src/lib/lesson/liveDeps.test.ts scripts/lesson-preview.ts package.json src/lib/prompts/lessonGeneration.ts
git commit -m "feat(m3b-2): live generation deps and lesson:generate acceptance script" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

**⛔ GATE:** the controller shows the owner the sample lessons. **Task 10 starts only after the owner accepts them.**

---

### Task 10: Route, docs, M3b-2 verification

**Precondition:** the owner accepted the sample lessons (Task 9 gate).

**Files:**
- Create: `src/app/api/lesson/start/route.ts`
- Test: `src/app/api/lesson/start/route.test.ts`
- Modify: `SPEC.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `startLesson` (Task 8), `liveGenerationDeps` (Task 9), `ProfileMissingError`, `LessonGenerationError`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/lesson/startLesson", () => ({ startLesson: vi.fn() }));
vi.mock("@/lib/lesson/liveDeps", () => ({ liveGenerationDeps: vi.fn(() => ({ ask: vi.fn(), gate: vi.fn() })) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { ProfileMissingError } from "@/lib/curriculum/lessonInputs";
import { LessonGenerationError } from "@/lib/lesson/generateLesson";
import { startLesson } from "@/lib/lesson/startLesson";
import { POST } from "./route";

beforeEach(() => vi.mocked(startLesson).mockReset());

describe("POST /api/lesson/start", () => {
  it("returns the lesson id", async () => {
    vi.mocked(startLesson).mockResolvedValue({ lessonId: "L1", reused: false });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lessonId: "L1", reused: false });
  });

  it("maps a missing profile to 409", async () => {
    vi.mocked(startLesson).mockRejectedValue(new ProfileMissingError());
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/prisma db seed/);
  });

  it("maps a generation failure to 502 with the drop reasons", async () => {
    vi.mocked(startLesson).mockRejectedValue(new LessonGenerationError("failed twice", [{ attempt: 1, index: 0, reason: "mcq: answer index 9" }]));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "failed twice", drops: ["attempt 1 #0: mcq: answer index 9"] });
  });

  it("maps anything else to 500 without leaking a stack", async () => {
    vi.mocked(startLesson).mockRejectedValue(new Error("connection refused"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "connection refused" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement `src/app/api/lesson/start/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ProfileMissingError } from "@/lib/curriculum/lessonInputs";
import { LessonGenerationError } from "@/lib/lesson/generateLesson";
import { liveGenerationDeps } from "@/lib/lesson/liveDeps";
import { startLesson } from "@/lib/lesson/startLesson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // one Agent SDK generation can take 1-3 minutes

/** Start (or resume) today's lesson. Voice-service health checks join in M5. */
export async function POST(): Promise<NextResponse> {
  try {
    return NextResponse.json(await startLesson({ generation: liveGenerationDeps() }));
  } catch (e) {
    if (e instanceof ProfileMissingError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof LessonGenerationError) {
      const drops = e.drops.map((d) => `attempt ${d.attempt} #${d.index}: ${d.reason}`);
      return NextResponse.json({ error: e.message, drops }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
```

Run: `npx vitest run src/app/api/lesson/start/route.test.ts` — PASS (4).

- [ ] **Step 3: Live end-to-end check (this DOES write one lesson to the local DB — intended)**

```powershell
npm run db:start
npm run build
npm run dev   # in the background; wait for "Ready"
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/lesson/start -TimeoutSec 300
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/lesson/start -TimeoutSec 300   # expect reused = true, same id
```

Then verify in the DB (non-interactive psql — see `scripts/db.ps1`): one new `Lesson` with `status = PLANNED`, a non-null `theme`, `plan->'sections'->'written'->'exerciseIds'` of length 5–8; that many `Exercise` rows; the focus `GrammarTopic` now `INTRODUCED` with `timesUsed = 1`; the lesson's vocab rows `SEEN` with `lastSeenAt` set. Stop the dev server. Put the queries and results in your report. Do NOT delete the lesson — the owner will use it when M3d's player arrives (it is `PLANNED`, so it does not affect theme rotation).

- [ ] **Step 4: Docs**

- `SPEC.md`: §"How the curriculum drives lesson generation" — grammar focus rule now begins with "unfinished **core** (`importance = 1`) teachable topics of the band directly below the user's level, then…"; theme rotation counts only `IN_PROGRESS`/`COMPLETED` lessons; add "the exercise **mix is decided by code** (`planExerciseMix`)". §Lesson Structure/§API Routes `POST /api/lesson/start`: one Claude call returns written exercises + warm-up + scenario framing; each exercise validated individually (zod → deterministic checks → TypeSafe Jev answer-key gate, best effort); fewer than 5 survivors → one regeneration → 502; `Lesson.plan` JSON shape (copy from the design spec); voice health checks deferred to M5. Record the M4 decision: a below-level core topic is fast-tracked to `MASTERED` after one lesson ≥ 80 %.
- `CLAUDE.md`: Commands — `npm run lesson:generate`; LLM layer — Jev quality gate at lesson start (best effort); Milestone status — M3b-2 ✅ with what it delivered; M3c next. Point to `docs/superpowers/specs/2026-09-18-m3b2-lesson-generation-design.md`.
Minimal, factual edits only.

- [ ] **Step 5: Verify and commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/app/api/lesson/start SPEC.md CLAUDE.md
git commit -m "feat(m3b-2): POST /api/lesson/start; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```
