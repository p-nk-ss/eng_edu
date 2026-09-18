# M3a — Curriculum Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a deterministic "what to teach today" step: a curated theme list, every vocab item classified into a theme (once, offline, by TypeSafe Jev), a seeded `Profile`, and pure selection functions returning theme + grammar focus + vocab + due errors.

**Architecture:** Themes are a constant in code. A resumable `tsx` script classifies the vocab CSVs through a small `fetch`-based TypeSafe client and commits the result as `data/vocab-topics.csv`; the seed applies it (no TypeSafe call at runtime). Selection is pure functions in `select.ts`; a thin wrapper `lessonInputs.ts` with an injectable `db` does the queries and performs **no writes**.

**Tech Stack:** TypeScript, Next.js 15, Prisma 7 (`@prisma/adapter-pg`, local portable PostgreSQL), zod 4, Vitest, `tsx`, TypeSafe HTTP API (`POST https://api.typesafe.ai/v1/systemone`).

**Spec:** `docs/superpowers/specs/2026-09-18-m3a-curriculum-selection-design.md` (read it first).

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Type-check before every commit:** `npx tsc --noEmit` (Vitest does NOT type-check).
- Every commit message ends with the line: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Branch: `feature/m1-skeleton`. Shell: PowerShell (no `&&`; chain with `;`).
- **No new npm dependencies.** The TypeSafe client is plain `fetch`.
- `ANTHROPIC_API_KEY` must stay unset. `TYPESAFE_API_KEY` lives in `.env.local` (UTF-8, git-ignored) — never print or commit it.
- Pure-logic test files start with `// @vitest-environment node` (the project default is jsdom, which is slow and unnecessary here).
- `VocabItem.pos` is stored as `""` (empty string) when the dataset has no POS — match on that, never on `NULL`.
- The pg adapter uses one connection: run Prisma queries **sequentially**, not with `Promise.all`.
- Theme keys are the only values allowed in `VocabItem.topic`, `Lesson.theme`, `Profile.preferredThemes` (plus `"general"` for `VocabItem.topic`).
- Selection performs **no DB writes** — status transitions belong to M3b.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/curriculum/themes.ts` (new) | `THEMES`, `GENERAL_TOPIC`, `THEME_KEYS`, `isTopicKey` |
| `src/lib/typesafe/client.ts` (new) | typed `fetch` client for `/v1/systemone` + `choice/noul/score` builders |
| `src/lib/curriculum/classify.ts` (new) | pure helpers for the classification script (batching, threshold, sampling, CSV) |
| `scripts/classify-vocab.ts` (new) | CLI: pilot / full classification run → `data/vocab-topics*.csv` |
| `src/lib/curriculum/select.ts` (new) | pure `parseLevel`, `pickTheme`, `pickGrammarFocus`, `pickVocab` |
| `src/lib/curriculum/lessonInputs.ts` (new) | `selectLessonInputs(db, now)` + `ProfileMissingError` |
| `src/lib/curriculum/seedExtras.ts` (new) | pure `buildTopicMap`, `parseProfile` for the seed |
| `prisma/seed.ts` (modify) | apply topics, create profile |
| `prisma/schema.prisma` (modify) | `Profile.preferredThemes`, `Lesson.theme` |
| `scripts/curriculum-preview.ts` (new) | manual verification: next 5 lessons |
| `data/profile.json`, `data/vocab-topics.csv` (new) | committed data |

---

### Task 1: Theme list

**Files:**
- Create: `src/lib/curriculum/themes.ts`
- Test: `src/lib/curriculum/themes.test.ts`

**Interfaces:**
- Produces: `interface Theme { key: string; label: string; description: string }`, `THEMES: readonly Theme[]` (21 items, order significant), `GENERAL_TOPIC = "general"`, `GENERAL_DESCRIPTION: string`, `THEME_KEYS: ReadonlySet<string>`, `isTopicKey(k: string): boolean` (true for theme keys **and** `"general"`), `themeByKey(key: string): Theme | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { THEMES, GENERAL_TOPIC, THEME_KEYS, isTopicKey, themeByKey } from "./themes";

describe("themes", () => {
  it("has 21 lesson themes with unique kebab-case keys", () => {
    expect(THEMES).toHaveLength(21);
    expect(new Set(THEMES.map((t) => t.key)).size).toBe(21);
    for (const t of THEMES) expect(t.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("gives every theme a label and a substantive description", () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("keeps 'general' out of the lesson themes but accepts it as a topic key", () => {
    expect(THEME_KEYS.has(GENERAL_TOPIC)).toBe(false);
    expect(isTopicKey(GENERAL_TOPIC)).toBe(true);
    expect(isTopicKey("technology")).toBe(true);
    expect(isTopicKey("nope")).toBe(false);
  });

  it("looks a theme up by key", () => {
    expect(themeByKey("health")?.label).toBe("Health & medicine");
    expect(themeByKey("general")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curriculum/themes.test.ts`
Expected: FAIL — cannot resolve `./themes`.

- [ ] **Step 3: Write the implementation**

Descriptions are contrastive on purpose (what belongs / what does not): Jev reads criteria literally.

```ts
export interface Theme {
  key: string;
  label: string;
  /** Used verbatim as the Jev Choice criterion and (M3b) as Claude prompt input. */
  description: string;
}

/** Order is significant: it is the final tie-break in theme rotation. */
export const THEMES: readonly Theme[] = [
  { key: "work", label: "Work & careers", description: "Jobs, professions, workplaces, colleagues, hiring, meetings, tasks and office life. Not money or companies as such (business) and not school (education)." },
  { key: "business", label: "Business & money", description: "Money, prices, banking, trade, companies, economy, finance, marketing and ownership. Not the daily activity of doing a job (work) and not buying personal goods (shopping)." },
  { key: "technology", label: "Technology & internet", description: "Computers, software, devices, the internet, data, machines, engineering and digital tools. Not pure science or research (science)." },
  { key: "science", label: "Science & research", description: "Scientific fields, experiments, theories, mathematics, physics, chemistry, space and research methods. Not practical devices or software (technology) and not medicine (health)." },
  { key: "education", label: "Education & learning", description: "Schools, universities, studying, teaching, exams, subjects, classroom objects and academic skills." },
  { key: "health", label: "Health & medicine", description: "Illness, injuries, treatment, doctors, hospitals, medicines, mental health and healthy habits. Not plain body parts or looks (body)." },
  { key: "body", label: "Body & appearance", description: "Parts of the body, physical appearance, looks, physical actions and the senses. Not illness or treatment (health) and not clothes (shopping)." },
  { key: "food", label: "Food & drink", description: "Food, drinks, ingredients, cooking, meals, taste, restaurants and kitchen tools." },
  { key: "home", label: "Home & daily life", description: "Houses, rooms, furniture, household objects, chores and everyday routines at home. Not the city or public places (city)." },
  { key: "family", label: "Family & relationships", description: "Family members, friends, partners, marriage, social relationships and life stages such as birth and childhood." },
  { key: "feelings", label: "Feelings & personality", description: "Emotions, moods, character traits, attitudes, opinions and mental states of a person." },
  { key: "travel", label: "Travel & transport", description: "Journeys, holidays, tourism, hotels, vehicles, roads, airports, directions and ways of getting around." },
  { key: "city", label: "City & places", description: "Towns, buildings, streets, public places, countries, regions and geographical locations where people live. Not wild nature (nature) and not the act of travelling (travel)." },
  { key: "nature", label: "Nature & environment", description: "Weather, climate, landscapes, seas, mountains, natural materials, natural disasters and environmental issues. Not living creatures or plants (animals)." },
  { key: "animals", label: "Animals & plants", description: "Animals, birds, fish, insects, pets, farm animals, trees, flowers and other plants." },
  { key: "sports", label: "Sports & fitness", description: "Sports, games played physically, exercise, competitions, players, teams, scores and sports equipment." },
  { key: "entertainment", label: "Entertainment & media", description: "Films, television, music, video games, hobbies, parties, celebrities, news media and having fun. Not fine art or literature (arts)." },
  { key: "arts", label: "Arts & culture", description: "Painting, literature, theatre, museums, design, history, religion, traditions and cultural heritage. Not popular films, pop music or games (entertainment)." },
  { key: "shopping", label: "Shopping & clothes", description: "Shops, buying personal goods, clothes, shoes, accessories, fashion, sizes and colours of clothing." },
  { key: "society", label: "Society, law & politics", description: "Government, politics, law, crime, police, war, rights, social problems, institutions and public affairs." },
  { key: "communication", label: "Communication & language", description: "Speaking, writing, languages, grammar terms, messages, phone calls, letters, conversation and ways of expressing or reporting something." },
];

/** Not a lesson theme — the bucket for words with no clear theme. Never rotated. */
export const GENERAL_TOPIC = "general";

export const GENERAL_DESCRIPTION =
  "No specific theme: function words (articles, pronouns, prepositions, conjunctions), very general verbs, adjectives and adverbs usable in any context, numbers, quantities, time, dates and measurement.";

export const THEME_KEYS: ReadonlySet<string> = new Set(THEMES.map((t) => t.key));

export function isTopicKey(k: string): boolean {
  return k === GENERAL_TOPIC || THEME_KEYS.has(k);
}

export function themeByKey(key: string): Theme | undefined {
  return THEMES.find((t) => t.key === key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curriculum/themes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check and commit**

```powershell
npx tsc --noEmit
git add src/lib/curriculum/themes.ts src/lib/curriculum/themes.test.ts
git commit -m @'
feat(m3a): curated lesson theme list (21 themes + general bucket)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 2: TypeSafe client

**Files:**
- Create: `src/lib/typesafe/client.ts`
- Test: `src/lib/typesafe/client.test.ts`

**Interfaces:**
- Produces:
  - `choice<K extends string>(instructions: Json, criteria: Record<K, string | null>): ChoiceQuestion<K>`
  - `noul(instructions: Json, criteria: { true: string; false: string }): NoulQuestion`
  - `score(instructions: Json, criteria: string[]): ScoreQuestion`
  - `interface ChoiceAnswer<K> { type: "choice"; choice: K; probabilities: Record<K, number>; confidence: number }`, `NoulAnswer { type: "noul"; noul: number }`, `ScoreAnswer { type: "score"; score: number; legend: Record<string,string>; probabilities: Record<string,number>; confidence: number }`
  - `createTypeSafeClient(opts?: ClientOptions): TypeSafeClient` where `TypeSafeClient.systemOne<Q extends Record<string, Question>>(req: { state: Json; questions: Q; model?: string }): Promise<{ answers: { [P in keyof Q]: AnswerFor<Q[P]> }; usage: { input_tokens: number; output_tokens: number } }>`
  - `class TypeSafeError extends Error { status: number; body: string }`
  - `ClientOptions { apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number }`

API facts (verified live on 2026-09-18): request body `{ state, model, questions: { <id>: { type, instructions, criteria } } }`; header `Authorization: Bearer <key>`; 429 and 529 are retryable; 401/422 are not.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createTypeSafeClient, choice, noul, TypeSafeError } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => {};

const okBody = {
  model: "jev-latest",
  answers: {
    topic: { type: "choice", choice: "food", probabilities: { food: 0.9, general: 0.1 }, confidence: 0.8 },
    ok: { type: "noul", noul: 0.95 },
  },
  usage: { input_tokens: 100, output_tokens: 10 },
};

describe("createTypeSafeClient", () => {
  it("throws when no API key is available", () => {
    const prev = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => createTypeSafeClient()).toThrow(/TYPESAFE_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.TYPESAFE_API_KEY = prev;
    }
  });

  it("POSTs state + questions with bearer auth and returns typed answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(okBody));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep });

    const res = await client.systemOne({
      state: { word: "bread" },
      questions: {
        topic: choice("Which theme?", { food: "Food", general: "Other" }),
        ok: noul("Is it a word?", { true: "yes", false: "no" }),
      },
    });

    expect(res.answers.topic.choice).toBe("food");
    expect(res.answers.ok.noul).toBe(0.95);
    expect(res.usage.input_tokens).toBe(100);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer k");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("jev-latest");
    expect(sent.state).toEqual({ word: "bread" });
    expect(sent.questions.topic).toEqual({
      type: "choice",
      instructions: "Which theme?",
      criteria: { food: "Food", general: "Other" },
    });
  });

  it("retries 429 and 529 with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "slow down" }, 429))
      .mockResolvedValueOnce(json({ error: "overloaded" }, 529))
      .mockResolvedValueOnce(json(okBody));
    const sleep = vi.fn(noSleep);
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep });

    const res = await client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } });

    expect(res.answers.ok.noul).toBe(0.95);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after maxRetries and throws TypeSafeError with status and body", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ error: "slow down" }, 429));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep, maxRetries: 2 });

    const err = await client
      .systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } })
      .catch((e) => e);

    expect(err).toBeInstanceOf(TypeSafeError);
    expect(err.status).toBe(429);
    expect(err.body).toContain("slow down");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it("does not retry non-retryable errors (422)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "bad question" }, 422));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep });

    await expect(
      client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/typesafe/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Minimal typed client for the TypeSafe "System One" endpoint (model: Jev).
 * One endpoint, three question types — plain fetch, no SDK dependency.
 * Docs: https://docs.typesafe.ai/api
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ChoiceQuestion<K extends string = string> {
  type: "choice";
  instructions: Json;
  criteria: Record<K, string | null>;
}
export interface NoulQuestion {
  type: "noul";
  instructions: Json;
  criteria: { true: string; false: string };
}
export interface ScoreQuestion {
  type: "score";
  instructions: Json;
  criteria: string[];
}
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer<K extends string = string> {
  type: "choice";
  choice: K;
  probabilities: Record<K, number>;
  confidence: number;
}
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type AnswerFor<Q> =
  Q extends ChoiceQuestion<infer K> ? ChoiceAnswer<K>
  : Q extends NoulQuestion ? NoulAnswer
  : Q extends ScoreQuestion ? ScoreAnswer
  : never;

export const choice = <K extends string>(
  instructions: Json,
  criteria: Record<K, string | null>,
): ChoiceQuestion<K> => ({ type: "choice", instructions, criteria });

export const noul = (instructions: Json, criteria: { true: string; false: string }): NoulQuestion => ({
  type: "noul",
  instructions,
  criteria,
});

export const score = (instructions: Json, criteria: string[]): ScoreQuestion => ({
  type: "score",
  instructions,
  criteria,
});

export class TypeSafeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "TypeSafeError";
  }
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after the first attempt, for 429/529 only. */
  maxRetries?: number;
}

export interface SystemOneRequest<Q extends Record<string, Question>> {
  state: Json;
  questions: Q;
  model?: string;
}

export interface SystemOneResult<Q extends Record<string, Question>> {
  answers: { [P in keyof Q]: AnswerFor<Q[P]> };
  usage: { input_tokens: number; output_tokens: number };
}

export interface TypeSafeClient {
  systemOne<Q extends Record<string, Question>>(req: SystemOneRequest<Q>): Promise<SystemOneResult<Q>>;
}

const RETRYABLE = new Set([429, 529]);

export function createTypeSafeClient(opts: ClientOptions = {}): TypeSafeClient {
  const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new TypeSafeError("TYPESAFE_API_KEY is not set", 0, "");
  const baseUrl = opts.baseUrl ?? "https://api.typesafe.ai";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 4;

  return {
    async systemOne(req) {
      const body = JSON.stringify({
        state: req.state,
        model: req.model ?? "jev-latest",
        questions: req.questions,
      });
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(`${baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
        });
        if (res.ok) {
          const data = await res.json();
          return { answers: data.answers, usage: data.usage };
        }
        const text = await res.text();
        if (RETRYABLE.has(res.status) && attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new TypeSafeError(`TypeSafe request failed (HTTP ${res.status})`, res.status, text);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/typesafe/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check and commit**

```powershell
npx tsc --noEmit
git add src/lib/typesafe
git commit -m @'
feat(m3a): typed fetch client for TypeSafe System One (choice/noul/score, 429/529 backoff)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 3: Classification helpers (pure)

**Files:**
- Create: `src/lib/curriculum/classify.ts`
- Test: `src/lib/curriculum/classify.test.ts`

**Interfaces:**
- Consumes: `THEMES`, `GENERAL_TOPIC`, `GENERAL_DESCRIPTION` (Task 1); `choice`, `ChoiceQuestion`, `ChoiceAnswer` (Task 2); `VocabSeed`, `CEFR_BANDS` from `./parse`; `parseCsv` from `./csv`.
- Produces:
  - `interface TopicRow { headword: string; pos: string; topic: string; confidence: number; rawTopic: string }` (`pos` is `""` when absent)
  - `wordKey(headword: string, pos: string | null): string`
  - `TOPIC_CRITERIA: Record<string, string>` (21 themes + general)
  - `buildBatch(words: VocabSeed[]): { state: { words: { headword: string; pos: string; cefr: string }[] }; questions: Record<string, ChoiceQuestion> }` — question ids are `w0`, `w1`, …
  - `resolveTopic(answer: ChoiceAnswer, threshold: number): { topic: string; confidence: number; rawTopic: string }`
  - `stratifiedSample<T extends { cefrLevel: string }>(items: T[], perLevel: number): T[]`
  - `pendingWords(vocab: VocabSeed[], done: TopicRow[]): VocabSeed[]`
  - `chunk<T>(items: T[], size: number): T[][]`
  - `TOPIC_CSV_HEADER`, `toCsvLine(row: TopicRow): string`, `parseTopicRows(csvText: string): TopicRow[]`, `sortTopicRows(rows: TopicRow[]): TopicRow[]`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { VocabSeed } from "./parse";
import type { ChoiceAnswer } from "../typesafe/client";
import {
  wordKey, TOPIC_CRITERIA, buildBatch, resolveTopic, stratifiedSample, pendingWords, chunk,
  TOPIC_CSV_HEADER, toCsvLine, parseTopicRows, sortTopicRows,
} from "./classify";

const w = (headword: string, pos: string | null, cefrLevel: VocabSeed["cefrLevel"] = "A1"): VocabSeed => ({
  headword, pos, cefrLevel, isPhrase: false, topic: null,
});

describe("classify helpers", () => {
  it("builds one Choice question per word, referencing its state path", () => {
    const { state, questions } = buildBatch([w("bread", "noun"), w("the", null, "A1")]);
    expect(state.words).toEqual([
      { headword: "bread", pos: "noun", cefr: "A1" },
      { headword: "the", pos: "", cefr: "A1" },
    ]);
    expect(Object.keys(questions)).toEqual(["w0", "w1"]);
    expect(questions.w1.type).toBe("choice");
    expect(String(questions.w1.instructions)).toContain("`words[1]`");
    expect(questions.w0.criteria).toBe(TOPIC_CRITERIA);
  });

  it("offers all 21 themes plus general as criteria", () => {
    expect(Object.keys(TOPIC_CRITERIA)).toHaveLength(22);
    expect(TOPIC_CRITERIA.general).toMatch(/function words/);
  });

  it("keeps a confident choice and demotes an unsure one to general", () => {
    const ans = (choice: string, confidence: number): ChoiceAnswer =>
      ({ type: "choice", choice, probabilities: {}, confidence });
    expect(resolveTopic(ans("food", 0.91), 0.5)).toEqual({ topic: "food", confidence: 0.91, rawTopic: "food" });
    expect(resolveTopic(ans("food", 0.31), 0.5)).toEqual({ topic: "general", confidence: 0.31, rawTopic: "food" });
  });

  it("samples evenly and deterministically within each CEFR level", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => w(`a${i}`, "noun", "A1")),
      ...Array.from({ length: 3 }, (_, i) => w(`b${i}`, "noun", "B1")),
    ];
    const sample = stratifiedSample(items, 5);
    expect(sample.map((s) => s.headword)).toEqual(["a0", "a2", "a4", "a6", "a8", "b0", "b1", "b2"]);
    expect(stratifiedSample(items, 5)).toEqual(sample);
  });

  it("skips words that are already classified (resume)", () => {
    const vocab = [w("bread", "noun"), w("the", null)];
    const done = [{ headword: "the", pos: "", topic: "general", confidence: 0.9, rawTopic: "general" }];
    expect(pendingWords(vocab, done).map((v) => v.headword)).toEqual(["bread"]);
    expect(wordKey("the", null)).toBe(wordKey("the", ""));
  });

  it("chunks into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("round-trips CSV rows, quoting commas and quotes", () => {
    const rows = [
      { headword: 'well, "now"', pos: "adverb", topic: "general", confidence: 0.4213, rawTopic: "communication" },
      { headword: "bread", pos: "", topic: "food", confidence: 0.9, rawTopic: "food" },
    ];
    const text = [TOPIC_CSV_HEADER, ...rows.map(toCsvLine)].join("\n") + "\n";
    expect(text.split("\n")[0]).toBe("headword,pos,topic,confidence,rawTopic");
    expect(parseTopicRows(text)).toEqual([
      { ...rows[0], confidence: 0.421 },
      rows[1],
    ]);
  });

  it("sorts rows by headword then pos for stable diffs", () => {
    const r = (headword: string, pos: string) => ({ headword, pos, topic: "general", confidence: 1, rawTopic: "general" });
    expect(sortTopicRows([r("b", "noun"), r("a", "verb"), r("a", "noun")]).map((x) => `${x.headword}/${x.pos}`))
      .toEqual(["a/noun", "a/verb", "b/noun"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curriculum/classify.test.ts`
Expected: FAIL — cannot resolve `./classify`.

- [ ] **Step 3: Write the implementation**

```ts
import { choice, type ChoiceAnswer, type ChoiceQuestion } from "../typesafe/client";
import { parseCsv } from "./csv";
import { CEFR_BANDS, type VocabSeed } from "./parse";
import { GENERAL_DESCRIPTION, GENERAL_TOPIC, THEMES } from "./themes";

export interface TopicRow {
  headword: string;
  /** "" when the dataset has no POS — mirrors how the seed stores VocabItem.pos. */
  pos: string;
  topic: string;
  confidence: number;
  /** Jev's top choice before the confidence threshold was applied (for review). */
  rawTopic: string;
}

export const wordKey = (headword: string, pos: string | null): string => `${headword} ${pos ?? ""}`;

export const TOPIC_CRITERIA: Record<string, string> = {
  ...Object.fromEntries(THEMES.map((t) => [t.key, t.description])),
  [GENERAL_TOPIC]: GENERAL_DESCRIPTION,
};

export function buildBatch(words: VocabSeed[]) {
  const state = {
    words: words.map((v) => ({ headword: v.headword, pos: v.pos ?? "", cefr: v.cefrLevel })),
  };
  const questions: Record<string, ChoiceQuestion> = {};
  words.forEach((_, i) => {
    questions[`w${i}`] = choice(instruction(i), TOPIC_CRITERIA);
  });
  return { state, questions };
}

// String concatenation on purpose: the state path is wrapped in literal backticks (Jev's
// reference syntax), which would need escaping inside a template literal.
const instruction = (i: number): string =>
  "Consider only the English word at `words[" + i + "]`, in its most common meaning for its part of speech. " +
  "Which single theme would a vocabulary textbook file it under?";

export function resolveTopic(answer: ChoiceAnswer, threshold: number) {
  return {
    topic: answer.confidence >= threshold ? answer.choice : GENERAL_TOPIC,
    confidence: answer.confidence,
    rawTopic: answer.choice,
  };
}

/** Deterministic, evenly spaced sample of up to `perLevel` items from each CEFR band. */
export function stratifiedSample<T extends { cefrLevel: string }>(items: T[], perLevel: number): T[] {
  const out: T[] = [];
  for (const band of CEFR_BANDS) {
    const pool = items.filter((i) => i.cefrLevel === band);
    const step = Math.max(1, Math.floor(pool.length / perLevel));
    for (let i = 0, taken = 0; i < pool.length && taken < perLevel; i += step, taken++) out.push(pool[i]);
  }
  return out;
}

export function pendingWords(vocab: VocabSeed[], done: TopicRow[]): VocabSeed[] {
  const seen = new Set(done.map((r) => wordKey(r.headword, r.pos)));
  return vocab.filter((v) => !seen.has(wordKey(v.headword, v.pos)));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const TOPIC_CSV_HEADER = "headword,pos,topic,confidence,rawTopic";

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const toCsvLine = (r: TopicRow): string =>
  [esc(r.headword), esc(r.pos), r.topic, r.confidence.toFixed(3), r.rawTopic].join(",");

export function parseTopicRows(csvText: string): TopicRow[] {
  return parseCsv(csvText)
    .slice(1)
    .filter((r) => (r[0] ?? "") !== "")
    .map((r) => ({
      headword: r[0],
      pos: r[1] ?? "",
      topic: r[2],
      confidence: Number(r[3]),
      rawTopic: r[4] ?? r[2],
    }));
}

export function sortTopicRows(rows: TopicRow[]): TopicRow[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...rows].sort((a, b) => cmp(a.headword, b.headword) || cmp(a.pos, b.pos));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curriculum/classify.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Type-check and commit**

```powershell
npx tsc --noEmit
git add src/lib/curriculum/classify.ts src/lib/curriculum/classify.test.ts
git commit -m @'
feat(m3a): pure helpers for vocab topic classification (batching, threshold, sampling, CSV)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 4: Classification script + pilot run (⛔ owner review gate)

**Files:**
- Create: `scripts/classify-vocab.ts`
- Modify: `package.json` (scripts)
- Output (pilot, committed for review): `data/vocab-topics.pilot.csv`

**Interfaces:**
- Consumes: everything from Task 3; `createTypeSafeClient` (Task 2); `loadSeedData()` from `src/lib/curriculum/load.ts` (returns `{ grammar, vocab: VocabSeed[] }`, reads CSVs — **no DB needed**).
- Produces: CLI `npm run vocab:classify -- [--pilot] [--limit N] [--threshold X]`; files `data/vocab-topics.pilot.csv` (pilot) and `data/vocab-topics.csv` (full).

No unit test for the CLI shell itself — all logic is in Task 3's tested helpers. Verification is the live pilot run.

- [ ] **Step 1: Write the script**

```ts
/**
 * One-off vocab topic classification via TypeSafe Jev.
 *   npm run vocab:classify -- --pilot            # ~200-word stratified sample -> data/vocab-topics.pilot.csv
 *   npm run vocab:classify                       # full run, resumable      -> data/vocab-topics.csv
 *   flags: --limit N (cap words this run), --threshold X (default 0.5)
 * Reads vocab from the committed CSVs (no DB). Needs TYPESAFE_API_KEY in .env.local.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { loadSeedData } from "../src/lib/curriculum/load";
import {
  buildBatch, chunk, parseTopicRows, pendingWords, resolveTopic, sortTopicRows, stratifiedSample,
  toCsvLine, TOPIC_CSV_HEADER, type TopicRow,
} from "../src/lib/curriculum/classify";
import { createTypeSafeClient } from "../src/lib/typesafe/client";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const BATCH_SIZE = 40; // 40 questions x ~22 criteria stays far below the 64k-token request limit
const CONCURRENCY = 4;
const PILOT_PER_LEVEL = 34; // x6 CEFR bands ~= 200 words

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const pilot = flag("--pilot");
const threshold = opt("--threshold", 0.5);
const limit = opt("--limit", Infinity);
const outFile = path.join("data", pilot ? "vocab-topics.pilot.csv" : "vocab-topics.csv");

async function main() {
  const client = createTypeSafeClient();
  const { vocab } = loadSeedData();

  if (pilot || !existsSync(outFile)) writeFileSync(outFile, TOPIC_CSV_HEADER + "\n", "utf8");
  const done = parseTopicRows(readFileSync(outFile, "utf8"));
  const source = pilot ? stratifiedSample(vocab, PILOT_PER_LEVEL) : vocab;
  const todo = pendingWords(source, done).slice(0, limit);
  console.log(`${source.length} words in scope, ${done.length} already done, classifying ${todo.length} (threshold ${threshold})`);

  const batches = chunk(todo, BATCH_SIZE);
  let next = 0;
  let tokens = 0;
  const fresh: TopicRow[] = [];

  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const { state, questions } = buildBatch(batch);
      const res = await client.systemOne({ state, questions });
      tokens += res.usage.input_tokens;
      const rows = batch.map((v, i) => ({
        headword: v.headword,
        pos: v.pos ?? "",
        ...resolveTopic(res.answers[`w${i}`], threshold),
      }));
      appendFileSync(outFile, rows.map(toCsvLine).join("\n") + "\n", "utf8"); // progress survives a crash
      fresh.push(...rows);
      console.log(`  ${fresh.length}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const all = sortTopicRows(parseTopicRows(readFileSync(outFile, "utf8")));
  writeFileSync(outFile, [TOPIC_CSV_HEADER, ...all.map(toCsvLine)].join("\n") + "\n", "utf8");

  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.topic, (counts.get(r.topic) ?? 0) + 1);
  console.log(`\n${all.length} rows in ${outFile}; input tokens this run: ${tokens} (~$${((tokens * 0.042) / 1e6).toFixed(4)})`);
  for (const [topic, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${topic.padEnd(14)} ${n}`);
  const demoted = all.filter((r) => r.topic !== r.rawTopic).length;
  console.log(`  demoted to general by threshold: ${demoted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, after `"db:psql"`, add:

```json
"vocab:classify": "tsx scripts/classify-vocab.ts"
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the pilot (live API)**

Run: `npm run vocab:classify -- --pilot`
Expected: `~200 words in scope … classifying ~200`, 5–6 progress lines, a per-topic count table, cost ≈ `$0.004`, file `data/vocab-topics.pilot.csv` with ~200 data rows. If it fails with `TYPESAFE_API_KEY is not set`, the key is missing from `.env.local`.

- [ ] **Step 5: Inspect the pilot yourself before showing the owner**

Read `data/vocab-topics.pilot.csv`. Check: function words (`the`, `of`, `although`) → `general`; obvious nouns land in the expected theme; note the share of `general` and the rows where `topic != rawTopic`. If a theme attracts clearly wrong words, tighten that theme's `description` in `themes.ts` (keep Task 1's test green) and re-run the pilot. At most 3 tuning rounds — then report what is still off.

- [ ] **Step 6: Commit and STOP for owner review**

```powershell
git add scripts/classify-vocab.ts package.json data/vocab-topics.pilot.csv src/lib/curriculum/themes.ts
git commit -m @'
feat(m3a): vocab topic classification script + pilot sample

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**⛔ GATE:** present to the owner — the per-topic counts, the `general` share, 15–20 representative rows, every row you consider wrong, and the threshold you recommend. **Do not start the full run (Task 10) until the owner accepts the pilot.** Tasks 5–9 do not depend on the gate and may proceed.

---

### Task 5: Schema migration

**Files:**
- Modify: `prisma/schema.prisma` (`Profile`, `Lesson`)
- Create: `prisma/migrations/<timestamp>_m3a_themes/migration.sql` (generated)

**Interfaces:**
- Produces: `Profile.preferredThemes: string[]` (default `[]`), `Lesson.theme: string | null` on the generated Prisma client.

- [ ] **Step 1: Edit the schema**

In `model Profile`, after `nativeLang`:

```prisma
  preferredThemes String[] @default([]) // theme keys from src/lib/curriculum/themes.ts; visited ~2x as often
```

In `model Lesson`, after `currentSection`:

```prisma
  theme          String?      // theme key of this lesson; drives least-recently-used theme rotation
```

- [ ] **Step 2: Start the DB and create the migration**

```powershell
npm run db:start
npx prisma migrate dev --name m3a_themes
```

Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/` whose SQL contains `ADD COLUMN "preferredThemes" TEXT[] DEFAULT ARRAY[]::TEXT[]` and `ADD COLUMN "theme" TEXT`. `migrate dev` also regenerates the client.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit; npm test`
Expected: no type errors; all existing suites pass.

- [ ] **Step 4: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations
git commit -m @'
feat(m3a): schema — Profile.preferredThemes, Lesson.theme

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 6: Pure selection functions

**Files:**
- Create: `src/lib/curriculum/select.ts`
- Test: `src/lib/curriculum/select.test.ts`

**Interfaces:**
- Consumes: `Theme`, `GENERAL_TOPIC` (Task 1); `CEFR_BANDS`, `CefrBand` from `./parse`.
- Produces:
  - `parseLevel(level: string): CefrBand` — `"B1+"` → `"B1"`; throws `Error` on garbage.
  - `pickTheme(themes: readonly Theme[], preferred: readonly string[], recentThemes: readonly string[]): Theme` — `recentThemes` is newest-first.
  - `interface GrammarCandidate { cefrLevel: string; status: string; sortOrder: number; name: string; openErrors: number }`
  - `pickGrammarFocus<T extends GrammarCandidate>(topics: T[], level: CefrBand): T | null`
  - `interface VocabCandidate { id: string; headword: string; cefrLevel: string; topic: string | null; status: string; lastSeenAt: Date | null }`
  - `pickVocab<T extends VocabCandidate>(items: T[], themeKey: string, level: CefrBand, target?: number): T[]` — `target` clamped to 6..10, default 8.

This file must **not** import Prisma or `db.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Theme } from "./themes";
import { parseLevel, pickTheme, pickGrammarFocus, pickVocab, type GrammarCandidate, type VocabCandidate } from "./select";

const T = (key: string): Theme => ({ key, label: key, description: key });
const themes = [T("a"), T("b"), T("c"), T("d")];

describe("parseLevel", () => {
  it("normalizes profile levels to a CEFR band", () => {
    expect(parseLevel("B1+")).toBe("B1");
    expect(parseLevel(" b2 ")).toBe("B2");
    expect(parseLevel("A1.2")).toBe("A1");
  });
  it("throws on an unrecognised level", () => {
    expect(() => parseLevel("intermediate")).toThrow(/level/i);
  });
});

describe("pickTheme", () => {
  it("starts with preferred themes, in THEMES order, when nothing was used yet", () => {
    expect(pickTheme(themes, ["c", "b"], []).key).toBe("b");
    expect(pickTheme(themes, [], []).key).toBe("a");
  });

  it("visits every never-used theme before repeating one", () => {
    expect(pickTheme(themes, ["b"], ["b"]).key).toBe("a");
    expect(pickTheme(themes, ["b"], ["a", "b"]).key).toBe("c");
    expect(pickTheme(themes, ["b"], ["c", "a", "b"]).key).toBe("d");
  });

  it("brings a preferred theme back about twice as fast", () => {
    // ages: d=1, c=2, a=3, b=4 -> scores: d=1, c=2, a=3, b=8 (preferred x2)
    expect(pickTheme(themes, ["b"], ["d", "c", "a", "b"]).key).toBe("b");
    // ages: b=1, d=2, c=3, a=4 -> scores: b=2, d=2, c=3, a=4
    expect(pickTheme(themes, ["b"], ["b", "d", "c", "a"]).key).toBe("a");
    // ages: a=1, b=2, d=3, c=4 -> scores: a=1, b=4, d=3, c=4 -> tie b/c -> preferred wins
    expect(pickTheme(themes, ["b"], ["a", "b", "d", "c"]).key).toBe("b");
  });

  it("is deterministic", () => {
    const recent = ["d", "c", "a", "b"];
    expect(pickTheme(themes, ["b"], recent)).toBe(pickTheme(themes, ["b"], recent));
  });
});

const G = (name: string, cefrLevel: string, status: string, sortOrder: number, openErrors = 0): GrammarCandidate =>
  ({ name, cefrLevel, status, sortOrder, openErrors });

describe("pickGrammarFocus", () => {
  it("prioritises PRACTICING-with-errors > PRACTICING > INTRODUCED > NOT_STARTED, then sortOrder", () => {
    const topics = [
      G("new-1", "B1", "NOT_STARTED", 1),
      G("intro", "B1", "INTRODUCED", 9),
      G("practising", "B1", "PRACTICING", 8),
      G("practising-err", "B1", "PRACTICING", 7, 2),
      G("done", "B1", "MASTERED", 0),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("practising-err");
    expect(pickGrammarFocus(topics.filter((t) => t.openErrors === 0), "B1")?.name).toBe("practising");
    expect(pickGrammarFocus([topics[0], topics[1]], "B1")?.name).toBe("intro");
    expect(pickGrammarFocus([G("x", "B1", "NOT_STARTED", 5), G("y", "B1", "NOT_STARTED", 2)], "B1")?.name).toBe("y");
  });

  it("ignores other levels until the current one is exhausted, then moves up", () => {
    const topics = [G("a2", "A2", "NOT_STARTED", 1), G("b1-done", "B1", "MASTERED", 1), G("b2", "B2", "NOT_STARTED", 1)];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("b2");
  });

  it("returns null when everything from the level upward is mastered", () => {
    expect(pickGrammarFocus([G("x", "C2", "MASTERED", 1)], "C2")).toBeNull();
    expect(pickGrammarFocus([], "B1")).toBeNull();
  });
});

const V = (
  headword: string, cefrLevel: string, topic: string | null, status = "NEW", lastSeenAt: Date | null = null,
): VocabCandidate => ({ id: headword, headword, cefrLevel, topic, status, lastSeenAt });

describe("pickVocab", () => {
  it("mixes up to 3 LEARNING items (oldest first) with NEW theme words at the level", () => {
    const items = [
      V("learn-new", "A2", "food", "LEARNING", new Date("2026-09-10")),
      V("learn-old", "A2", "city", "LEARNING", new Date("2026-09-01")),
      V("learn-never", "B1", "city", "LEARNING", null),
      V("learn-4th", "B1", "city", "LEARNING", new Date("2026-09-15")),
      ...["f", "e", "d", "c", "b", "a"].map((h) => V(h, "B1", "food")),
      V("known", "B1", "food", "KNOWN"),
      V("other-theme", "B1", "city"),
    ];
    expect(pickVocab(items, "food", "B1").map((v) => v.headword)).toEqual([
      "learn-never", "learn-old", "learn-new", "a", "b", "c", "d", "e",
    ]);
  });

  it("falls back: next band in theme -> general at level -> any NEW at level", () => {
    const items = [
      V("theme-b1", "B1", "food"),
      V("theme-b2", "B2", "food"),
      V("general-b1", "B1", "general"),
      V("untagged-b1", "B1", null),
      V("other-b1", "B1", "city"),
      V("theme-c1", "C1", "food"),
    ];
    expect(pickVocab(items, "food", "B1").map((v) => v.headword)).toEqual([
      "theme-b1", "theme-b2", "general-b1", "other-b1", "untagged-b1",
    ]);
  });

  it("clamps the target to 6..10 and never repeats an item", () => {
    const items = Array.from({ length: 30 }, (_, i) => V(`w${String(i).padStart(2, "0")}`, "B1", "food"));
    expect(pickVocab(items, "food", "B1", 50)).toHaveLength(10);
    expect(pickVocab(items, "food", "B1", 1)).toHaveLength(6);
    const picked = pickVocab(items, "food", "B1");
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curriculum/select.test.ts`
Expected: FAIL — cannot resolve `./select`.

- [ ] **Step 3: Write the implementation**

```ts
import { CEFR_BANDS, normalizeCefrLevel, type CefrBand } from "./parse";
import { GENERAL_TOPIC, type Theme } from "./themes";

/** Deterministic "what to teach" selection. Pure: no DB, no clock, no randomness. */

export function parseLevel(level: string): CefrBand {
  const band = normalizeCefrLevel(level);
  if (!band) throw new Error(`Unrecognised CEFR level in profile: "${level}" (expected e.g. "B1" or "B1+")`);
  return band;
}

/**
 * Weighted least-recently-used. age = lessons since last use (never used = Infinity);
 * preferred themes score age x2. Highest score wins; ties -> preferred first, then `themes` order.
 */
export function pickTheme(
  themes: readonly Theme[],
  preferred: readonly string[],
  recentThemes: readonly string[],
): Theme {
  const pref = new Set(preferred);
  let best = themes[0];
  let bestScore = -1;
  let bestPref = false;
  for (const t of themes) {
    const idx = recentThemes.indexOf(t.key);
    const age = idx === -1 ? Infinity : idx + 1;
    const isPref = pref.has(t.key);
    const score = isPref ? age * 2 : age;
    if (score > bestScore || (score === bestScore && isPref && !bestPref)) {
      best = t;
      bestScore = score;
      bestPref = isPref;
    }
  }
  return best;
}

export interface GrammarCandidate {
  name: string;
  cefrLevel: string;
  status: string;
  sortOrder: number;
  /** Count of this topic's ErrorRecords whose status is not MASTERED. */
  openErrors: number;
}

const grammarRank = (t: GrammarCandidate): number =>
  t.status === "PRACTICING" ? (t.openErrors > 0 ? 0 : 1) : t.status === "INTRODUCED" ? 2 : 3;

export function pickGrammarFocus<T extends GrammarCandidate>(topics: T[], level: CefrBand): T | null {
  for (const band of CEFR_BANDS.slice(CEFR_BANDS.indexOf(level))) {
    const pool = topics.filter((t) => t.cefrLevel === band && t.status !== "MASTERED");
    if (pool.length === 0) continue;
    return [...pool].sort(
      (a, b) => grammarRank(a) - grammarRank(b) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    )[0];
  }
  return null;
}

export interface VocabCandidate {
  id: string;
  headword: string;
  cefrLevel: string;
  topic: string | null;
  status: string;
  lastSeenAt: Date | null;
}

const MAX_LEARNING = 3;

export function pickVocab<T extends VocabCandidate>(
  items: T[],
  themeKey: string,
  level: CefrBand,
  target = 8,
): T[] {
  const size = Math.min(10, Math.max(6, target));
  const nextBand: CefrBand | undefined = CEFR_BANDS[CEFR_BANDS.indexOf(level) + 1];
  const byHeadword = (a: T, b: T) => a.headword.localeCompare(b.headword);
  const seenAt = (v: T) => v.lastSeenAt?.getTime() ?? -Infinity; // never seen = oldest

  const learning = items
    .filter((v) => v.status === "LEARNING")
    .sort((a, b) => seenAt(a) - seenAt(b) || byHeadword(a, b))
    .slice(0, MAX_LEARNING);

  const fresh = items.filter((v) => v.status === "NEW");
  const pools: T[][] = [
    fresh.filter((v) => v.topic === themeKey && v.cefrLevel === level),
    fresh.filter((v) => v.topic === themeKey && v.cefrLevel === nextBand),
    fresh.filter((v) => v.topic === GENERAL_TOPIC && v.cefrLevel === level),
    fresh.filter((v) => v.cefrLevel === level),
  ];

  const picked = [...learning];
  const taken = new Set(picked.map((v) => v.id));
  for (const pool of pools) {
    for (const v of [...pool].sort(byHeadword)) {
      if (picked.length >= size) return picked;
      if (taken.has(v.id)) continue;
      taken.add(v.id);
      picked.push(v);
    }
  }
  return picked;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curriculum/select.test.ts`
Expected: PASS (12 tests). If the second `pickTheme` weighting assertion fails, re-read the age arithmetic in the test comments before touching the implementation — the rule is `age = index + 1`.

- [ ] **Step 5: Type-check and commit**

```powershell
npx tsc --noEmit
git add src/lib/curriculum/select.ts src/lib/curriculum/select.test.ts
git commit -m @'
feat(m3a): pure deterministic selection — theme rotation, grammar focus, vocab mix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 7: `selectLessonInputs` DB wrapper

**Files:**
- Create: `src/lib/curriculum/lessonInputs.ts`
- Test: `src/lib/curriculum/lessonInputs.test.ts`

**Interfaces:**
- Consumes: `parseLevel`, `pickTheme`, `pickGrammarFocus`, `pickVocab` (Task 6); `THEMES`, `Theme` (Task 1); Prisma client with `Profile.preferredThemes` and `Lesson.theme` (Task 5); `prisma` from `../db`.
- Produces:
  - `class ProfileMissingError extends Error`
  - `type LessonInputsDb = Pick<PrismaClient, "profile" | "lesson" | "grammarTopic" | "vocabItem" | "errorRecord">`
  - `interface LessonInputs { profile: Profile; theme: Theme; grammarTopic: GrammarTopic | null; vocab: VocabItem[]; dueErrors: ErrorRecord[] }`
  - `selectLessonInputs(db?: LessonInputsDb, now?: Date): Promise<LessonInputs>` — reads only.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} })); // never build a real PrismaClient in unit tests

import { selectLessonInputs, ProfileMissingError, type LessonInputsDb } from "./lessonInputs";

const now = new Date("2026-09-18T10:00:00Z");

function fakeDb(over: Partial<Record<string, unknown>> = {}) {
  const calls: Record<string, unknown> = {};
  const table = (name: string, rows: unknown) => ({
    findFirst: vi.fn(async (args: unknown) => ((calls[name] = args), rows)),
    findMany: vi.fn(async (args: unknown) => ((calls[name] = args), rows)),
  });
  const db = {
    profile: table("profile", "profile" in over ? over.profile : {
      id: "p1", level: "B1+", goals: "g", interests: "IT", nativeLang: "ru", preferredThemes: ["technology"],
    }),
    lesson: table("lesson", over.lessons ?? [{ theme: "technology" }]),
    grammarTopic: table("grammarTopic", over.grammar ?? [
      { id: "g1", name: "Past Simple", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 2, _count: { errors: 0 } },
      { id: "g2", name: "Present Perfect", cefrLevel: "B1", status: "PRACTICING", sortOrder: 5, _count: { errors: 1 } },
    ]),
    vocabItem: table("vocabItem", over.vocab ?? [
      { id: "v1", headword: "colleague", cefrLevel: "B1", topic: "work", status: "NEW", lastSeenAt: null },
      { id: "v2", headword: "deadline", cefrLevel: "B1", topic: "work", status: "NEW", lastSeenAt: null },
    ]),
    errorRecord: table("errorRecord", over.errors ?? [{ id: "e1" }]),
  };
  return { db: db as unknown as LessonInputsDb, calls };
}

describe("selectLessonInputs", () => {
  it("throws ProfileMissingError with a seed hint when there is no profile", async () => {
    const { db } = fakeDb({ profile: null });
    await expect(selectLessonInputs(db, now)).rejects.toBeInstanceOf(ProfileMissingError);
    await expect(selectLessonInputs(db, now)).rejects.toThrow(/prisma db seed/);
  });

  it("combines profile, rotation history, grammar, vocab and due errors", async () => {
    const { db, calls } = fakeDb();
    const out = await selectLessonInputs(db, now);

    expect(out.profile.id).toBe("p1");
    expect(out.theme.key).toBe("work"); // 'technology' was just used; first never-used theme in THEMES order
    expect(out.grammarTopic?.id).toBe("g2"); // PRACTICING with open errors wins
    expect(out.vocab.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(out.dueErrors).toEqual([{ id: "e1" }]);

    expect(calls.lesson).toMatchObject({ where: { theme: { not: null } }, orderBy: { date: "desc" } });
    expect(calls.errorRecord).toMatchObject({
      where: { nextReviewAt: { lte: now }, status: { not: "MASTERED" } },
    });
    expect(calls.vocabItem).toMatchObject({
      where: { OR: [{ status: "LEARNING" }, { status: "NEW", cefrLevel: { in: ["B1", "B2"] } }] },
    });
  });

  it("ignores preferred theme keys that no longer exist", async () => {
    const { db } = fakeDb({
      profile: { id: "p1", level: "B1", goals: "", interests: "", nativeLang: "ru", preferredThemes: ["ghost"] },
      lessons: [],
    });
    expect((await selectLessonInputs(db, now)).theme.key).toBe("work"); // plain THEMES order
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curriculum/lessonInputs.test.ts`
Expected: FAIL — cannot resolve `./lessonInputs`.

- [ ] **Step 3: Write the implementation**

```ts
import type { ErrorRecord, GrammarTopic, PrismaClient, Profile, VocabItem } from "@prisma/client";
import { prisma } from "../db";
import { CEFR_BANDS } from "./parse";
import { parseLevel, pickGrammarFocus, pickTheme, pickVocab } from "./select";
import { THEMES, THEME_KEYS, type Theme } from "./themes";

export class ProfileMissingError extends Error {
  constructor() {
    super("No Profile row found. Edit data/profile.json, then run `npx prisma db seed`.");
    this.name = "ProfileMissingError";
  }
}

export type LessonInputsDb = Pick<PrismaClient, "profile" | "lesson" | "grammarTopic" | "vocabItem" | "errorRecord">;

export interface LessonInputs {
  profile: Profile;
  theme: Theme;
  grammarTopic: GrammarTopic | null;
  vocab: VocabItem[];
  dueErrors: ErrorRecord[];
}

const ROTATION_HISTORY = 100; // lessons of theme history considered (> 2x the number of themes)

/**
 * Deterministic inputs for the next lesson (SPEC §Curriculum step 1). READ-ONLY: status
 * transitions and Lesson.theme are written when the lesson is created (M3b).
 * Queries run sequentially — the pg adapter holds a single connection.
 */
export async function selectLessonInputs(db: LessonInputsDb = prisma, now = new Date()): Promise<LessonInputs> {
  const profile = await db.profile.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!profile) throw new ProfileMissingError();
  const level = parseLevel(profile.level);
  const nextBand = CEFR_BANDS[CEFR_BANDS.indexOf(level) + 1];

  const lessons = await db.lesson.findMany({
    where: { theme: { not: null } },
    orderBy: { date: "desc" },
    take: ROTATION_HISTORY,
    select: { theme: true },
  });
  const recentThemes = lessons.map((l) => l.theme).filter((t): t is string => t !== null);
  const preferred = profile.preferredThemes.filter((k) => THEME_KEYS.has(k));
  const theme = pickTheme(THEMES, preferred, recentThemes);

  const topics = await db.grammarTopic.findMany({
    where: { status: { not: "MASTERED" } },
    include: { _count: { select: { errors: { where: { status: { not: "MASTERED" } } } } } },
  });
  const grammarTopic = pickGrammarFocus(
    topics.map((t) => ({ ...t, openErrors: t._count.errors })),
    level,
  );

  const vocabPool = await db.vocabItem.findMany({
    where: {
      OR: [
        { status: "LEARNING" },
        { status: "NEW", cefrLevel: { in: nextBand ? [level, nextBand] : [level] } },
      ],
    },
  });
  const vocab = pickVocab(vocabPool, theme.key, level);

  const dueErrors = await db.errorRecord.findMany({
    where: { nextReviewAt: { lte: now }, status: { not: "MASTERED" } },
    orderBy: { nextReviewAt: "asc" },
  });

  return { profile, theme, grammarTopic, vocab, dueErrors };
}
```

Note: `grammarTopic` in the result carries the extra `_count`/`openErrors` fields at runtime — harmless, and `GrammarTopic` is structurally satisfied.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curriculum/lessonInputs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check and commit**

```powershell
npx tsc --noEmit
git add src/lib/curriculum/lessonInputs.ts src/lib/curriculum/lessonInputs.test.ts
git commit -m @'
feat(m3a): selectLessonInputs — read-only DB wrapper over the selection functions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 8: Seed — profile + vocab topics

**Files:**
- Create: `src/lib/curriculum/seedExtras.ts`, `data/profile.json`
- Modify: `prisma/seed.ts`
- Test: `src/lib/curriculum/seedExtras.test.ts`

**Interfaces:**
- Consumes: `parseTopicRows`, `wordKey`, `TopicRow` (Task 3); `isTopicKey`, `THEME_KEYS` (Task 1); `parseLevel` (Task 6); zod 4.
- Produces:
  - `buildTopicAssignments(csvText: string): { headword: string; pos: string; topic: string }[]` — throws on an unknown topic key, naming it.
  - `parseProfile(jsonText: string): ProfileSeed` where `ProfileSeed = { level: string; goals: string; interests: string; nativeLang: string; preferredThemes: string[] }` — throws on a bad level or unknown theme key.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildTopicAssignments, parseProfile } from "./seedExtras";

const csv = (lines: string[]) => ["headword,pos,topic,confidence,rawTopic", ...lines].join("\n") + "\n";

describe("buildTopicAssignments", () => {
  it("maps CSV rows to (headword, pos, topic) with '' for a missing pos", () => {
    expect(buildTopicAssignments(csv(["bread,noun,food,0.910,food", "the,,general,0.300,communication"]))).toEqual([
      { headword: "bread", pos: "noun", topic: "food" },
      { headword: "the", pos: "", topic: "general" },
    ]);
  });

  it("fails loudly on an unknown topic key", () => {
    expect(() => buildTopicAssignments(csv(["bread,noun,bakery,0.9,bakery"]))).toThrow(/bakery/);
  });
});

describe("parseProfile", () => {
  const valid = {
    level: "B1", goals: "fluency", interests: "IT, QA", nativeLang: "ru", preferredThemes: ["technology", "work"],
  };

  it("accepts a valid profile", () => {
    expect(parseProfile(JSON.stringify(valid))).toEqual(valid);
  });

  it("defaults nativeLang and preferredThemes", () => {
    const { nativeLang, preferredThemes, ...rest } = valid;
    expect(parseProfile(JSON.stringify(rest))).toEqual({ ...rest, nativeLang: "ru", preferredThemes: [] });
  });

  it("rejects an unknown preferred theme, naming it", () => {
    expect(() => parseProfile(JSON.stringify({ ...valid, preferredThemes: ["gaming"] }))).toThrow(/gaming/);
  });

  it("rejects 'general' as a preferred theme and an unparseable level", () => {
    expect(() => parseProfile(JSON.stringify({ ...valid, preferredThemes: ["general"] }))).toThrow(/general/);
    expect(() => parseProfile(JSON.stringify({ ...valid, level: "intermediate" }))).toThrow(/level/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/curriculum/seedExtras.test.ts`
Expected: FAIL — cannot resolve `./seedExtras`.

- [ ] **Step 3: Write `seedExtras.ts`**

```ts
import { z } from "zod";
import { parseTopicRows } from "./classify";
import { parseLevel } from "./select";
import { isTopicKey, THEME_KEYS } from "./themes";

export interface TopicAssignment {
  headword: string;
  pos: string;
  topic: string;
}

/** data/vocab-topics.csv -> rows for the seed's bulk UPDATE. Unknown topic keys abort the seed. */
export function buildTopicAssignments(csvText: string): TopicAssignment[] {
  return parseTopicRows(csvText).map((r) => {
    if (!isTopicKey(r.topic)) {
      throw new Error(`vocab-topics.csv: unknown topic "${r.topic}" for "${r.headword}" — not a key in themes.ts`);
    }
    return { headword: r.headword, pos: r.pos, topic: r.topic };
  });
}

const profileSchema = z.object({
  level: z.string().refine(
    (v) => {
      try {
        parseLevel(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "level must contain a CEFR band, e.g. \"B1\" or \"B1+\"" },
  ),
  goals: z.string(),
  interests: z.string(),
  nativeLang: z.string().default("ru"),
  preferredThemes: z
    .array(z.string())
    .superRefine((keys, ctx) => {
      for (const k of keys) {
        if (!THEME_KEYS.has(k)) ctx.addIssue({ code: "custom", message: `unknown theme key "${k}" (see src/lib/curriculum/themes.ts)` });
      }
    })
    .default([]),
});

export type ProfileSeed = z.infer<typeof profileSchema>;

export function parseProfile(jsonText: string): ProfileSeed {
  const res = profileSchema.safeParse(JSON.parse(jsonText));
  if (!res.success) {
    throw new Error("data/profile.json is invalid: " + res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return res.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/curriculum/seedExtras.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Create `data/profile.json`**

```json
{
  "level": "B1",
  "goals": "conversational fluency, work meetings",
  "interests": "IT, QA, gaming",
  "nativeLang": "ru",
  "preferredThemes": ["technology", "work", "entertainment"]
}
```

- [ ] **Step 6: Wire both into `prisma/seed.ts`**

Add imports below the existing ones:

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildTopicAssignments, parseProfile } from "../src/lib/curriculum/seedExtras";
```

Add these two functions above `main()`:

```ts
const DATA_DIR = path.join(process.cwd(), "data");

/** Create the single Profile from data/profile.json — only if none exists (never overwrites edits). */
async function seedProfile() {
  if ((await prisma.profile.count()) > 0) return console.log("Profile exists — left untouched.");
  const file = path.join(DATA_DIR, "profile.json");
  if (!existsSync(file)) return console.warn("data/profile.json missing — no Profile created.");
  const p = parseProfile(readFileSync(file, "utf8"));
  await prisma.profile.create({ data: p });
  console.log(`Profile created (level ${p.level}, preferred themes: ${p.preferredThemes.join(", ") || "none"}).`);
}

/** Apply data/vocab-topics.csv to VocabItem.topic. One bulk UPDATE per chunk; only changed rows are touched. */
async function seedVocabTopics() {
  const file = path.join(DATA_DIR, "vocab-topics.csv");
  if (!existsSync(file)) return console.warn("data/vocab-topics.csv missing — VocabItem.topic stays NULL.");
  const rows = buildTopicAssignments(readFileSync(file, "utf8"));
  let updated = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const part = rows.slice(i, i + 2000);
    const headwords = part.map((r) => r.headword);
    const poses = part.map((r) => r.pos);
    const topics = part.map((r) => r.topic);
    updated += await prisma.$executeRaw`
      UPDATE "VocabItem" AS v SET "topic" = d.topic
      FROM unnest(${headwords}::text[], ${poses}::text[], ${topics}::text[]) AS d(headword, pos, topic)
      WHERE v."headword" = d.headword AND v."pos" = d.pos AND v."topic" IS DISTINCT FROM d.topic`;
  }
  console.log(`Vocab topics: ${rows.length} assignments in CSV, ${updated} rows updated.`);
}
```

In `main()`, after the `vocabItem.createMany` call and before the counts, add:

```ts
  await seedVocabTopics();
  await seedProfile();
```

Also extend the file's header comment with one line: ` *  - applies data/vocab-topics.csv to VocabItem.topic and creates the Profile if missing.`

- [ ] **Step 7: Run the seed against the live DB (twice — idempotency)**

```powershell
npm run db:start
npx prisma db seed
npx prisma db seed
```

Expected first run: `Profile created (level B1, …)` and either `data/vocab-topics.csv missing …` (full run not done yet — fine) or `… N rows updated`. Second run: `Profile exists — left untouched.` and `0 rows updated`. Counts stay `266 grammar topics and 9780 vocab items`.

If `$executeRaw` rejects the array parameters, fall back to a per-topic loop (22 topics): `prisma.vocabItem.updateMany({ where: { OR: part.map(r => ({ headword: r.headword, pos: r.pos })) }, data: { topic } })` in chunks of 500 — report this in the task summary.

- [ ] **Step 8: Type-check, full test run, commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/curriculum/seedExtras.ts src/lib/curriculum/seedExtras.test.ts prisma/seed.ts data/profile.json
git commit -m @'
feat(m3a): seed creates Profile from data/profile.json and applies vocab topics CSV

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 9: Preview command + documentation

**Files:**
- Create: `scripts/curriculum-preview.ts`
- Modify: `package.json`, `SPEC.md` (§Curriculum), `data/README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `selectLessonInputs`, `LessonInputsDb` (Task 7).
- Produces: `npm run curriculum:preview`.

- [ ] **Step 1: Write the script**

`src/lib/db.ts` builds its PrismaClient at import time from `process.env.DATABASE_URL`, so env **must** be loaded before it is imported — hence the dynamic imports.

```ts
/**
 * Manual check for M3a: print the deterministic selection for the next 5 lessons.
 * Theme history is simulated (each picked theme is pushed onto the history);
 * grammar/vocab statuses are NOT simulated, so those repeat unless the theme changes them.
 *   npm run curriculum:preview
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { selectLessonInputs } = await import("../src/lib/curriculum/lessonInputs");
  type Db = Parameters<typeof selectLessonInputs>[0];

  const real = await prisma.lesson.findMany({
    where: { theme: { not: null } }, orderBy: { date: "desc" }, take: 100, select: { theme: true },
  });
  const history = real.map((l) => l.theme as string); // newest first

  for (let n = 1; n <= 5; n++) {
    const db = {
      profile: prisma.profile,
      grammarTopic: prisma.grammarTopic,
      vocabItem: prisma.vocabItem,
      errorRecord: prisma.errorRecord,
      lesson: { findMany: async () => history.map((theme) => ({ theme })) },
    } as unknown as Db;

    const s = await selectLessonInputs(db);
    console.log(`\nLesson +${n}  theme: ${s.theme.label} [${s.theme.key}]`);
    console.log(`  grammar : ${s.grammarTopic ? `${s.grammarTopic.name} (${s.grammarTopic.cefrLevel}, ${s.grammarTopic.status})` : "— syllabus mastered —"}`);
    console.log(`  vocab   : ${s.vocab.map((v) => `${v.headword}${v.topic === s.theme.key ? "" : `{${v.topic ?? "?"}}`}`).join(", ")}`);
    console.log(`  due errs: ${s.dueErrors.length}`);
    history.unshift(s.theme.key);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"` add: `"curriculum:preview": "tsx scripts/curriculum-preview.ts"`

- [ ] **Step 3: Run it**

```powershell
npm run db:start
npm run curriculum:preview
```

Expected: 5 blocks. With the default profile the themes are `Work & careers`, `Technology & internet`, `Entertainment & media` (preferred + never used, in `THEMES` order), then `Business & money`, `Science & research` (never-used beats any finite score). Vocab shows 6–8 B1 words; before the full classification run every word is marked `{?}` (topic NULL fallback) — that is expected at this point.

- [ ] **Step 4: Update the docs**

`SPEC.md` — in §"How the curriculum drives lesson generation", replace the **Conversation theme** bullet with:

```markdown
   - **Conversation theme** — chosen first, deterministically, from the **curated theme list** in `src/lib/curriculum/themes.ts` by weighted least-recently-used rotation (`Lesson.theme` history; themes listed in `Profile.preferredThemes` return about twice as often). CEFR-J v1.5 has no thematic categories, so every `VocabItem.topic` is assigned once, offline, by TypeSafe Jev (`npm run vocab:classify` → `data/vocab-topics.csv` → seed). This theme is an *input* to the next two steps and to Claude — it is **not** chosen by the LLM. Design: `docs/superpowers/specs/2026-09-18-m3a-curriculum-selection-design.md`.
```

In the SPEC's Prisma block add `preferredThemes String[] @default([])` to `Profile` and `theme String?` to `Lesson`. In §Deployment env list add: `` - `TYPESAFE_API_KEY` — TypeSafe (Jev) key; used by `npm run vocab:classify` (and the `judge` role from M3c). ``

`data/README.md` — add two rows to the Files table and replace the "No thematic categories" note's last sentence:

```markdown
| `vocab-topics.csv` | one row per vocab item | `VocabItem.topic` | generated by `npm run vocab:classify` (TypeSafe Jev), reviewed by hand |
| `profile.json` | 1 | `Profile` (created only if missing) | hand-written |
```

```markdown
  Resolved in M3a: topics come from `vocab-topics.csv` (theme keys from `src/lib/curriculum/themes.ts`,
  `general` = no theme). Regenerate with `npm run vocab:classify` (resumable; `--pilot` for a 200-word sample);
  editing the CSV by hand is fine — the seed validates keys.
```

`CLAUDE.md` — Stack: add `- **TypeSafe Jev** (`src/lib/typesafe/`, plain fetch, `TYPESAFE_API_KEY`): structured judgments (Choice/Score/Noul). M3a: offline vocab topic classification only.` Commands: add `npm run vocab:classify` and `npm run curriculum:preview`. Milestone status: mark M3 as split into M3a–M3d with M3a's state. Remove the "Open question for M3" sentence under *Curriculum data has NO thematic categories* and point to the spec instead.

- [ ] **Step 5: Type-check and commit**

```powershell
npx tsc --noEmit
git add scripts/curriculum-preview.ts package.json SPEC.md data/README.md CLAUDE.md
git commit -m @'
feat(m3a): curriculum:preview command; docs for themes, vocab topics, TypeSafe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 10: Full classification run + M3a verification checkpoint

**Precondition:** the owner accepted the pilot (Task 4 gate) and agreed on a threshold.

**Files:**
- Create: `data/vocab-topics.csv` (generated)
- Delete: `data/vocab-topics.pilot.csv`

- [ ] **Step 1: Full run**

Run: `npm run vocab:classify -- --threshold <agreed value>`
Expected: `9780 words in scope, 0 already done, classifying 9780`, ~245 progress lines, cost roughly `$0.2`. If it dies midway (429/529 exhaustion, network), just re-run the same command — it resumes.

- [ ] **Step 2: Sanity-check the result**

```powershell
(Get-Content data/vocab-topics.csv | Measure-Object -Line).Lines   # expect 9781 (header + 9780)
```

Review the printed per-topic table: no theme should be empty; `general` is expected to be the largest bucket. Then check pool sizes that matter for selection — every theme needs at least 6 words at the owner's level + the next band:

```powershell
npx prisma db seed
npm run db:psql
```

```sql
SELECT topic, count(*) FILTER (WHERE "cefrLevel"='B1') AS b1, count(*) FILTER (WHERE "cefrLevel"='B2') AS b2
FROM "VocabItem" GROUP BY topic ORDER BY b1;
```

Expected: seed reports `9780 assignments in CSV, 9780 rows updated`; every theme row has `b1 + b2 >= 6`. Report any theme below that to the owner (the `general`/any-NEW fallbacks keep lessons non-empty, so it is a quality note, not a blocker).

- [ ] **Step 3: Preview with real topics**

Run: `npm run curriculum:preview`
Expected: vocab lists now show words that plausibly belong to each lesson's theme, with few or no `{…}` fallback markers.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit; npm test; npm run build`
Expected: no type errors; all suites pass; build succeeds.

- [ ] **Step 5: Commit**

```powershell
git rm -q data/vocab-topics.pilot.csv
git add data/vocab-topics.csv
git commit -m @'
feat(m3a): classify all 9780 vocab items into themes (TypeSafe Jev), seed verified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 6: Manual checkpoint with the owner**

Show the `curriculum:preview` output and the per-topic table. M3a is done when the owner confirms the themes rotate sensibly and the vocab fits the themes. Update the memory file `project-status.md` and the `CLAUDE.md` milestone line (M3a ✅).
