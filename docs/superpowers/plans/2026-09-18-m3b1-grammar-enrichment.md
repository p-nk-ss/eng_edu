# M3b-1 — Grammar Topic Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 266 corpus-labelled CEFR-J grammar topics into teachable ones — learner-facing title, description, example, `teachable` flag and `importance` — once, offline, with Claude; make lesson selection skip non-teachable topics and order by importance.

**Architecture:** A resumable `tsx` script sends same-level batches of ~15 topics (with all their AFF/NEG/INT CSV variants) to Claude through the existing `completeJson` facade and commits the zod-validated result as `data/grammar-topics.json`; the seed applies it with one bulk UPDATE. Selection stays a pure function of DB state: `pickGrammarFocus` filters `teachable` and sorts status-group → importance → sortOrder → name.

**Tech Stack:** TypeScript, Prisma 7 (`@prisma/adapter-pg`, local portable PostgreSQL), zod 4, Vitest, `tsx`, Claude via `@anthropic-ai/claude-agent-sdk` (role `lesson_generation`, subscription auth).

**Spec:** `docs/superpowers/specs/2026-09-18-m3b1-grammar-enrichment-design.md` (read it first).

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean (Vitest does NOT type-check).
- **Commit messages — do NOT use PowerShell here-strings** (they leak stray `@` lines and break on apostrophes). Use two `-m` flags, no apostrophes in the text:
  `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
  then check `git log -1 --format=%B`: subject, blank line, trailer as the last line.
- Branch: `feature/m1-skeleton`. Shell: Windows PowerShell 5.1 (no `&&`; chain with `;`).
- **No new npm dependencies.** Never `git add` `skills-lock.json` or `AGENTS.md`; stage files by path.
- `ANTHROPIC_API_KEY` must stay **unset** (else the Agent SDK bills pay-per-token). `CLAUDE_CODE_OAUTH_TOKEN` lives in `.env.local` — never print, log or commit it; never display `.env.local`.
- Pure-logic test files start with `// @vitest-environment node`.
- The pg adapter uses one connection: run Prisma queries **sequentially**, never `Promise.all`.
- String ordering in selection code uses plain code-unit comparison (`a < b ? -1 : a > b ? 1 : 0`), never `localeCompare`.
- The join key between CSV, JSON and DB is the grammar topic **`name`** — the trimmed "Grammatical Item" cell (`GrammarTopic.name` is `@unique`).
- The DB holds real data (266 grammar topics, 9780 classified vocab items, one Profile). Migrations must be additive; if any command proposes to reset or drop the database, STOP and report.
- Selection performs no DB writes.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/curriculum/parse.ts` (modify) | + `GrammarVariant`, `collectGrammarVariants` |
| `src/lib/curriculum/load.ts` (modify) | + `loadGrammarVariants` |
| `src/lib/curriculum/grammarEnrichment.ts` (new) | `enrichmentSchema`, batching/resume/validation/file helpers, `enrichBatch` |
| `src/lib/prompts/grammarEnrichment.ts` (new) | typed prompt template |
| `scripts/enrich-grammar.ts` (new) | CLI: pilot / full run → `data/grammar-topics*.json` |
| `prisma/schema.prisma` (modify) | `GrammarTopic.title/description/example/teachable/importance` |
| `src/lib/curriculum/select.ts` (modify) | `pickGrammarFocus`: teachable filter + importance order |
| `src/lib/curriculum/seedExtras.ts`, `prisma/seed.ts` (modify) | validate + apply the JSON |
| `src/lib/curriculum/progress.ts` (modify) | count only teachable topics |
| `scripts/curriculum-preview.ts` (modify) | print `title ?? name` |

---

### Task 1: Collect CSV variants per grammar topic

**Files:**
- Modify: `src/lib/curriculum/parse.ts`, `src/lib/curriculum/load.ts`
- Test: `src/lib/curriculum/parse.test.ts` (append), `src/lib/curriculum/load.test.ts` (create)

**Interfaces:**
- Produces: `interface GrammarVariant { shorthand: string; sentenceType: string; note: string }`; `collectGrammarVariants(rows: string[][]): Map<string, GrammarVariant[]>`; `loadGrammarVariants(dataDir?: string): Map<string, GrammarVariant[]>`.

Grammar CSV columns: 0=ID 1=Shorthand Code 2=Grammatical Item 3=Sentence Type 4=CEFR-J Level … 9=Notes. `rows[0]` is the header. The seed de-duplicates topics by name, so rows sharing a name (AFF / NEG / INT variants) collapse into one topic; this function keeps them all.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/curriculum/parse.test.ts` (add `collectGrammarVariants` to its existing import from `./parse`):

```ts
describe("collectGrammarVariants", () => {
  const header = ["ID", "Shorthand Code", "Grammatical Item", "Sentence Type", "CEFR-J Level", "F", "CI", "EGP", "GSELO", "Notes"];
  const rows = [
    header,
    ["62", "TA.PRPF.AFF", "TENSE/ASPECT: PRESENT PERFECT", "AFF. DEC.", "A2.2", "", "", "", "", ""],
    ["62-1", "TA.PRPF.NEG", " TENSE/ASPECT: PRESENT PERFECT ", "NEG. DEC.", "B1.1", "", "", "", "", "note-neg"],
    ["2", "PP.you_are", "You are", "AFF. DEC.", "B1.1", "", "", "", "", "note-you"],
    ["x", "NO.NAME", "  ", "AFF. DEC.", "A1", "", "", "", "", ""],
    ["short"],
  ];

  it("groups every row by trimmed name, in file order", () => {
    const v = collectGrammarVariants(rows);
    expect([...v.keys()]).toEqual(["TENSE/ASPECT: PRESENT PERFECT", "You are"]);
    expect(v.get("TENSE/ASPECT: PRESENT PERFECT")).toEqual([
      { shorthand: "TA.PRPF.AFF", sentenceType: "AFF. DEC.", note: "" },
      { shorthand: "TA.PRPF.NEG", sentenceType: "NEG. DEC.", note: "note-neg" },
    ]);
    expect(v.get("You are")).toEqual([{ shorthand: "PP.you_are", sentenceType: "AFF. DEC.", note: "note-you" }]);
  });

  it("skips the header, blank names and short rows", () => {
    expect(collectGrammarVariants([header]).size).toBe(0);
    expect(collectGrammarVariants(rows).has("")).toBe(false);
  });
});
```

Create `src/lib/curriculum/load.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { loadGrammarVariants, loadSeedData } from "./load";

describe("loadGrammarVariants (committed CEFR-J CSV)", () => {
  it("has variants for every seeded grammar topic", () => {
    const variants = loadGrammarVariants();
    const { grammar } = loadSeedData();
    expect(grammar).toHaveLength(266);
    for (const g of grammar) expect(variants.get(g.name)?.length ?? 0).toBeGreaterThan(0);
  });

  it("keeps the dataset's shorthand and sentence type", () => {
    expect(loadGrammarVariants().get("I am")?.[0]).toMatchObject({ shorthand: "PP.I_am", sentenceType: "AFF. DEC." });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/curriculum/parse.test.ts src/lib/curriculum/load.test.ts`
Expected: FAIL — `collectGrammarVariants` / `loadGrammarVariants` are not exported.

- [ ] **Step 3: Implement**

In `src/lib/curriculum/parse.ts`, directly after `parseGrammarRows`:

```ts
export interface GrammarVariant {
  shorthand: string;
  sentenceType: string;
  /** Dataset note (Japanese) describing the corpus extraction constraint; "" when absent. */
  note: string;
}

/**
 * All CSV rows sharing a Grammatical Item name, in file order. The seed collapses these
 * AFF/NEG/INT variants into one GrammarTopic (dedup by name); enrichment needs them all.
 * Key = the same trimmed name parseGrammarRows uses.
 */
export function collectGrammarVariants(rows: string[][]): Map<string, GrammarVariant[]> {
  const out = new Map<string, GrammarVariant[]>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[2] ?? "").trim();
    if (!name) continue;
    const list = out.get(name) ?? [];
    list.push({
      shorthand: (r[1] ?? "").trim(),
      sentenceType: (r[3] ?? "").trim(),
      note: (r[9] ?? "").trim(),
    });
    out.set(name, list);
  }
  return out;
}
```

In `src/lib/curriculum/load.ts`: add `collectGrammarVariants` and `type GrammarVariant` to the import from `./parse`, and append:

```ts
/** Every CSV variant row per grammar topic name (no DB) — input for the enrichment script. */
export function loadGrammarVariants(dataDir = DATA_DIR): Map<string, GrammarVariant[]> {
  return collectGrammarVariants(parseCsv(readFileSync(path.join(dataDir, GRAMMAR_FILE), "utf8")));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/curriculum/parse.test.ts src/lib/curriculum/load.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/curriculum/parse.ts src/lib/curriculum/parse.test.ts src/lib/curriculum/load.ts src/lib/curriculum/load.test.ts
git commit -m "feat(m3b-1): collect all CSV variants per grammar topic" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: Enrichment record schema + pure helpers

**Files:**
- Create: `src/lib/curriculum/grammarEnrichment.ts`
- Test: `src/lib/curriculum/grammarEnrichment.test.ts`

**Interfaces:**
- Consumes: `CEFR_BANDS`, `type CefrBand`, `type GrammarSeed` (`{ name; cefrLevel; category; sortOrder }`) from `./parse`.
- Produces:
  - `enrichmentSchema` (zod), `type GrammarEnrichment = { name: string; title: string; description: string; example: string; teachable: boolean; importance: 1 | 2 | 3; note: string }`
  - `interface GrammarBatch { level: CefrBand; topics: GrammarSeed[] }`
  - `batchByLevel(topics: GrammarSeed[], size?: number): GrammarBatch[]`
  - `pendingTopics(topics: GrammarSeed[], done: { name: string }[]): GrammarSeed[]`
  - `validateBatch(requested: string[], returned: { name: string }[]): void` (throws)
  - `parseEnrichmentFile(jsonText: string): GrammarEnrichment[]`, `serializeEnrichmentFile(records: GrammarEnrichment[]): string`
  - `pilotSample(topics: GrammarSeed[]): GrammarSeed[]`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { GrammarSeed } from "./parse";
import {
  enrichmentSchema, batchByLevel, pendingTopics, validateBatch,
  parseEnrichmentFile, serializeEnrichmentFile, pilotSample, type GrammarEnrichment,
} from "./grammarEnrichment";

const T = (name: string, cefrLevel: GrammarSeed["cefrLevel"], sortOrder: number): GrammarSeed =>
  ({ name, cefrLevel, category: null, sortOrder });

const rec = (over: Partial<GrammarEnrichment> = {}): GrammarEnrichment => ({
  name: "TENSE/ASPECT: PAST PERFECT",
  title: "Past Perfect (had done)",
  description: "Use had + past participle for an action completed before another past moment.",
  example: "When I arrived, the meeting had already started.",
  teachable: true,
  importance: 1,
  note: "",
  ...over,
});

describe("enrichmentSchema", () => {
  it("accepts a full record and defaults note", () => {
    const { note, ...noNote } = rec();
    expect(enrichmentSchema.parse(noNote)).toEqual(rec());
  });

  it("requires a note when the topic is not teachable", () => {
    expect(enrichmentSchema.safeParse(rec({ teachable: false, note: "  " })).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ teachable: false, note: "trivial at B1" })).success).toBe(true);
  });

  it("restricts importance to 1, 2 or 3 and enforces length limits", () => {
    expect(enrichmentSchema.safeParse({ ...rec(), importance: 4 }).success).toBe(false);
    expect(enrichmentSchema.safeParse({ ...rec(), importance: "1" }).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ title: "ab" })).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ description: "too short" })).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ title: "x".repeat(81) })).success).toBe(false);
  });
});

describe("batchByLevel", () => {
  it("never mixes levels, keeps sortOrder inside a level, walks A1 to C2", () => {
    const topics = [T("b1-2", "B1", 2), T("a2-1", "A2", 1), T("b1-1", "B1", 1), T("b1-3", "B1", 3)];
    expect(batchByLevel(topics, 2).map((b) => [b.level, b.topics.map((t) => t.name)])).toEqual([
      ["A2", ["a2-1"]],
      ["B1", ["b1-1", "b1-2"]],
      ["B1", ["b1-3"]],
    ]);
  });

  it("defaults to 15 per batch", () => {
    const topics = Array.from({ length: 31 }, (_, i) => T(`t${i}`, "A1", i));
    expect(batchByLevel(topics).map((b) => b.topics.length)).toEqual([15, 15, 1]);
  });
});

describe("pendingTopics", () => {
  it("drops topics that are already enriched", () => {
    expect(pendingTopics([T("a", "A1", 1), T("b", "A1", 2)], [{ name: "a" }]).map((t) => t.name)).toEqual(["b"]);
  });
});

describe("validateBatch", () => {
  it("passes when every requested name is returned exactly once", () => {
    expect(() => validateBatch(["a", "b"], [{ name: "b" }, { name: "a" }])).not.toThrow();
  });
  it("names missing, unexpected and duplicated topics", () => {
    expect(() => validateBatch(["a", "b"], [{ name: "a" }])).toThrow(/missing.*"b"/);
    expect(() => validateBatch(["a"], [{ name: "a" }, { name: "zzz" }])).toThrow(/unexpected.*"zzz"/);
    expect(() => validateBatch(["a"], [{ name: "a" }, { name: "a" }])).toThrow(/duplicate.*"a"/);
  });
});

describe("enrichment file", () => {
  it("round-trips, sorted by name, pretty-printed with a trailing newline", () => {
    const text = serializeEnrichmentFile([rec({ name: "b" }), rec({ name: "a" })]);
    expect(text.endsWith("]\n")).toBe(true);
    expect(text).toContain('\n  {\n    "name": "a"');
    expect(parseEnrichmentFile(text).map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("treats an empty file as no records and rejects invalid content with the file name", () => {
    expect(parseEnrichmentFile("  \n")).toEqual([]);
    expect(() => parseEnrichmentFile("{ nope")).toThrow(/grammar-topics/);
    expect(() => parseEnrichmentFile(JSON.stringify([{ name: "x" }]))).toThrow(/grammar-topics/);
  });
});

describe("pilotSample", () => {
  it("takes the first 15 A2 and first 15 B1 topics by sortOrder", () => {
    const topics = [
      ...Array.from({ length: 20 }, (_, i) => T(`a2-${i}`, "A2", 20 - i)),
      ...Array.from({ length: 3 }, (_, i) => T(`b1-${i}`, "B1", i)),
      T("a1", "A1", 1),
    ];
    const sample = pilotSample(topics);
    expect(sample).toHaveLength(18);
    expect(sample[0].name).toBe("a2-19"); // sortOrder 1
    expect(sample.some((t) => t.cefrLevel === "A1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/curriculum/grammarEnrichment.test.ts`
Expected: FAIL — cannot resolve `./grammarEnrichment`.

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";
import { CEFR_BANDS, type CefrBand, type GrammarSeed } from "./parse";

/** One enriched grammar topic, as stored in data/grammar-topics.json. Join key: `name`. */
export const enrichmentSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(3).max(80),
    description: z.string().min(20).max(400),
    example: z.string().min(5).max(200),
    teachable: z.boolean(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    note: z.string().max(200).default(""),
  })
  .refine((e) => e.teachable || e.note.trim().length > 0, {
    message: "note is required when teachable is false",
    path: ["note"],
  });

export type GrammarEnrichment = z.infer<typeof enrichmentSchema>;

export interface GrammarBatch {
  level: CefrBand;
  topics: GrammarSeed[];
}

/** Same-level batches (importance is judged relative to peers), A1 -> C2, sortOrder inside a level. */
export function batchByLevel(topics: GrammarSeed[], size = 15): GrammarBatch[] {
  const out: GrammarBatch[] = [];
  for (const level of CEFR_BANDS) {
    const atLevel = topics.filter((t) => t.cefrLevel === level).sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < atLevel.length; i += size) out.push({ level, topics: atLevel.slice(i, i + size) });
  }
  return out;
}

export function pendingTopics(topics: GrammarSeed[], done: { name: string }[]): GrammarSeed[] {
  const seen = new Set(done.map((d) => d.name));
  return topics.filter((t) => !seen.has(t.name));
}

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

/** Every requested name must come back exactly once, and nothing else. Throws naming offenders. */
export function validateBatch(requested: string[], returned: { name: string }[]): void {
  const want = new Set(requested);
  const counts = new Map<string, number>();
  for (const r of returned) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const missing = requested.filter((n) => !counts.has(n));
  const unexpected = [...counts.keys()].filter((n) => !want.has(n));
  const duplicate = [...counts].filter(([, c]) => c > 1).map(([n]) => n);
  const problems = [
    missing.length ? `missing ${quote(missing)}` : "",
    unexpected.length ? `unexpected ${quote(unexpected)}` : "",
    duplicate.length ? `duplicate ${quote(duplicate)}` : "",
  ].filter(Boolean);
  if (problems.length) throw new Error(`Enrichment batch mismatch: ${problems.join("; ")}`);
}

const FILE_LABEL = "grammar-topics JSON";
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function parseEnrichmentFile(jsonText: string): GrammarEnrichment[] {
  if (jsonText.trim() === "") return [];
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`${FILE_LABEL} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const res = z.array(enrichmentSchema).safeParse(raw);
  if (!res.success) {
    throw new Error(
      `${FILE_LABEL} is invalid: ` + res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return res.data;
}

/** Sorted by name, 2-space JSON, trailing newline — stable diffs for a hand-editable file. */
export function serializeEnrichmentFile(records: GrammarEnrichment[]): string {
  return JSON.stringify([...records].sort((a, b) => cmp(a.name, b.name)), null, 2) + "\n";
}

const PILOT_LEVELS: CefrBand[] = ["A2", "B1"];
const PILOT_PER_LEVEL = 15;

/** Deterministic pilot: the first 15 A2 and first 15 B1 topics by sortOrder. */
export function pilotSample(topics: GrammarSeed[]): GrammarSeed[] {
  return PILOT_LEVELS.flatMap((level) =>
    topics
      .filter((t) => t.cefrLevel === level)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, PILOT_PER_LEVEL),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/curriculum/grammarEnrichment.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/curriculum/grammarEnrichment.ts src/lib/curriculum/grammarEnrichment.test.ts
git commit -m "feat(m3b-1): grammar enrichment schema and pure helpers (batching, resume, validation, file)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Prompt template + `enrichBatch`

**Files:**
- Create: `src/lib/prompts/grammarEnrichment.ts`
- Modify: `src/lib/curriculum/grammarEnrichment.ts` (append `enrichBatch`)
- Test: `src/lib/prompts/grammarEnrichment.test.ts` (create), `src/lib/curriculum/grammarEnrichment.test.ts` (append)

**Interfaces:**
- Consumes: `type CefrBand`, `type GrammarVariant` from `src/lib/curriculum/parse.ts`; `GrammarBatch`, `GrammarEnrichment`, `validateBatch` (Task 2).
- Produces:
  - `grammarEnrichmentPrompt(input: { level: CefrBand; topics: { name: string; variants: GrammarVariant[] }[] }): { system: string; user: string }`
  - `type AskEnrichment = (prompt: { system: string; user: string }) => Promise<GrammarEnrichment[]>`
  - `enrichBatch(batch: GrammarBatch, variants: Map<string, GrammarVariant[]>, ask: AskEnrichment): Promise<GrammarEnrichment[]>` — calls `ask`, validates names with `validateBatch`; on a mismatch retries ONCE, then throws naming the batch. Errors thrown by `ask` itself propagate immediately.

`SPEC.md` §Prompting requires every prompt to be a typed template function under `src/lib/prompts/` — this is the project's first one.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prompts/grammarEnrichment.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { grammarEnrichmentPrompt } from "./grammarEnrichment";

const input = {
  level: "B1" as const,
  topics: [
    { name: "You are", variants: [{ shorthand: "PP.you_are", sentenceType: "AFF. DEC.", note: "文頭位置に限定" }] },
    {
      name: "TENSE/ASPECT: PRESENT PERFECT",
      variants: [
        { shorthand: "TA.PRPF.AFF", sentenceType: "AFF. DEC.", note: "" },
        { shorthand: "TA.PRPF.NEG", sentenceType: "NEG. DEC.", note: "" },
      ],
    },
  ],
};

describe("grammarEnrichmentPrompt", () => {
  it("puts the level and every topic with its variants into the user message as JSON", () => {
    const { user } = grammarEnrichmentPrompt(input);
    const payload = JSON.parse(user.slice(user.indexOf("{")));
    expect(payload.level).toBe("B1");
    expect(payload.topics.map((t: { name: string }) => t.name)).toEqual(["You are", "TENSE/ASPECT: PRESENT PERFECT"]);
    expect(user).toContain("TA.PRPF.NEG");
    expect(user).toContain("NEG. DEC.");
    expect(user).toContain("文頭位置に限定");
  });

  it("states the output contract in the system prompt", () => {
    const { system } = grammarEnrichmentPrompt(input);
    expect(system).toMatch(/ONLY.*JSON array/i);
    for (const field of ["name", "title", "description", "example", "teachable", "importance", "note"]) {
      expect(system).toContain(`"${field}"`);
    }
    expect(system).toMatch(/verbatim/i);
    expect(system).toMatch(/conversational fluency/i);
    expect(system).toMatch(/1\s*=\s*core/i);
  });
});
```

Append to `src/lib/curriculum/grammarEnrichment.test.ts` (extend the imports: `enrichBatch` from `./grammarEnrichment`, `vi` from `vitest`):

```ts
describe("enrichBatch", () => {
  const batch = { level: "B1" as const, topics: [T("a", "B1", 1), T("b", "B1", 2)] };
  const variants = new Map([["a", [{ shorthand: "X.a", sentenceType: "AFF. DEC.", note: "" }]]]);

  it("builds the prompt from the batch and returns validated records", async () => {
    const ask = vi.fn().mockResolvedValue([rec({ name: "a" }), rec({ name: "b" })]);
    const out = await enrichBatch(batch, variants, ask);
    expect(out.map((r) => r.name)).toEqual(["a", "b"]);
    const prompt = ask.mock.calls[0][0] as { system: string; user: string };
    expect(prompt.user).toContain("X.a");
    expect(JSON.parse(prompt.user.slice(prompt.user.indexOf("{"))).topics[1]).toEqual({ name: "b", variants: [] });
  });

  it("retries once when names do not match, then succeeds", async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce([rec({ name: "a" })])
      .mockResolvedValueOnce([rec({ name: "a" }), rec({ name: "b" })]);
    expect((await enrichBatch(batch, variants, ask)).length).toBe(2);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("throws naming the level and the mismatch after the second bad answer", async () => {
    const ask = vi.fn().mockResolvedValue([rec({ name: "a" })]);
    await expect(enrichBatch(batch, variants, ask)).rejects.toThrow(/B1.*missing "b"/);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("does not swallow errors thrown by ask", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("LLM JSON validation failed"));
    await expect(enrichBatch(batch, variants, ask)).rejects.toThrow("LLM JSON validation failed");
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/prompts/grammarEnrichment.test.ts src/lib/curriculum/grammarEnrichment.test.ts`
Expected: FAIL — prompt module missing; `enrichBatch` not exported.

- [ ] **Step 3: Implement the prompt**

`src/lib/prompts/grammarEnrichment.ts`:

```ts
import type { CefrBand, GrammarVariant } from "../curriculum/parse";

export interface GrammarEnrichmentInput {
  level: CefrBand;
  topics: { name: string; variants: GrammarVariant[] }[];
}

const SYSTEM = [
  "You are an experienced EFL curriculum designer preparing a grammar syllabus for one adult Russian-speaking learner whose goal is conversational fluency.",
  "",
  "You receive grammar items from the CEFR-J Grammar Profile. They are CORPUS PATTERN LABELS, not teaching topics: each has a raw name, one or more variants (a shorthand code plus a sentence type such as AFF. DEC., NEG. DEC., AFF. INT.) and sometimes a note in Japanese describing a corpus extraction constraint (for example: sentence-initial position only). Treat all variants of an item as ONE teaching topic covering that pattern family.",
  "",
  "For every item return an object with exactly these fields:",
  '- "name": the raw item name copied VERBATIM (it is a join key - do not fix, shorten or translate it).',
  '- "title": a learner-facing title in standard textbook terminology, 3-80 characters, e.g. "Past Perfect (had done)".',
  '- "description": 1-2 plain-English sentences (20-400 characters): how the structure is formed and when it is used.',
  '- "example": one natural spoken-English sentence at the given CEFR level that uses the structure (5-200 characters).',
  '- "teachable": false when the item is not worth a lesson of its own at this level - it is trivially below the level, exists only as a corpus-position artefact, or is not a learnable point on its own. Otherwise true.',
  '- "importance": 1, 2 or 3, judged RELATIVE to the other items of the same level in this request. 1 = core for conversational fluency at this level (tenses and aspect, modals, conditionals, passive, question forms, reported speech, relative clauses). 2 = useful. 3 = peripheral or mostly written/formal.',
  '- "note": empty string when teachable is true; when teachable is false, a short reason (max 200 characters).',
  "",
  "Return ONLY a JSON array with one object per input item, in the input order. No prose, no markdown fences, no extra fields.",
].join("\n");

/** One-off grammar topic enrichment (M3b-1). Output is validated with enrichmentSchema. */
export function grammarEnrichmentPrompt(input: GrammarEnrichmentInput): { system: string; user: string } {
  const user =
    `Enrich these ${input.topics.length} CEFR ${input.level} grammar items.\n` +
    JSON.stringify({ level: input.level, topics: input.topics }, null, 2);
  return { system: SYSTEM, user };
}
```

- [ ] **Step 4: Implement `enrichBatch`**

Append to `src/lib/curriculum/grammarEnrichment.ts` (add `type GrammarVariant` to the `./parse` import and `import { grammarEnrichmentPrompt } from "../prompts/grammarEnrichment";`):

```ts
export type AskEnrichment = (prompt: { system: string; user: string }) => Promise<GrammarEnrichment[]>;

/**
 * Enrich one same-level batch. `ask` is the LLM call (injected so this stays testable);
 * its own failures propagate. A name mismatch in the answer gets exactly one retry.
 */
export async function enrichBatch(
  batch: GrammarBatch,
  variants: Map<string, GrammarVariant[]>,
  ask: AskEnrichment,
): Promise<GrammarEnrichment[]> {
  const names = batch.topics.map((t) => t.name);
  const prompt = grammarEnrichmentPrompt({
    level: batch.level,
    topics: names.map((name) => ({ name, variants: variants.get(name) ?? [] })),
  });
  let mismatch = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const records = await ask(prompt);
    try {
      validateBatch(names, records);
      return records;
    } catch (e) {
      mismatch = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Grammar enrichment failed twice for the ${batch.level} batch starting at "${names[0]}": ${mismatch}`);
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/lib/prompts/grammarEnrichment.test.ts src/lib/curriculum/grammarEnrichment.test.ts`
Expected: PASS (2 + 15 tests).

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/prompts src/lib/curriculum/grammarEnrichment.ts src/lib/curriculum/grammarEnrichment.test.ts
git commit -m "feat(m3b-1): grammar enrichment prompt template and enrichBatch with name validation" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: Enrichment script + pilot run (⛔ owner review gate)

**Files:**
- Create: `scripts/enrich-grammar.ts`
- Modify: `package.json` (scripts)
- Output (pilot, committed for review): `data/grammar-topics.pilot.json`

**Interfaces:**
- Consumes: `loadSeedData`, `loadGrammarVariants` (Task 1); `batchByLevel`, `pendingTopics`, `pilotSample`, `parseEnrichmentFile`, `serializeEnrichmentFile`, `enrichmentSchema`, `enrichBatch`, `type GrammarEnrichment` (Tasks 2–3); `completeJson(role, { system, messages }, schema)` from `src/lib/llm/index.ts` (fence-stripping + zod validation + one retry; tsx resolves its `@/` imports — verified).
- Produces: `npm run grammar:enrich [-- --pilot]`; files `data/grammar-topics.pilot.json` / `data/grammar-topics.json`.

No unit test for the CLI shell — its logic lives in Tasks 2–3. Verification is the live pilot.

- [ ] **Step 1: Write the script**

```ts
/**
 * One-off grammar topic enrichment via Claude (Agent SDK, subscription auth).
 *   npm run grammar:enrich -- --pilot   # 15 A2 + 15 B1 topics -> data/grammar-topics.pilot.json (always fresh)
 *   npm run grammar:enrich              # all 266 topics, resumable -> data/grammar-topics.json
 * Reads topics from the committed CSV (no DB). Needs CLAUDE_CODE_OAUTH_TOKEN in .env.local.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { loadGrammarVariants, loadSeedData } from "../src/lib/curriculum/load";
import {
  batchByLevel, enrichBatch, enrichmentSchema, parseEnrichmentFile, pendingTopics, pilotSample,
  serializeEnrichmentFile, type GrammarEnrichment,
} from "../src/lib/curriculum/grammarEnrichment";
import { completeJson } from "../src/lib/llm/index";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const pilot = process.argv.includes("--pilot");
const outFile = path.join("data", pilot ? "grammar-topics.pilot.json" : "grammar-topics.json");

async function main() {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is set - unset it, or this run is billed pay-per-token instead of the subscription.");
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN is not set (.env.local) - generate it with `claude setup-token`.");
  }

  const { grammar } = loadSeedData();
  const variants = loadGrammarVariants();
  const levelOf = new Map(grammar.map((g) => [g.name, g.cefrLevel]));

  const all: GrammarEnrichment[] = pilot || !existsSync(outFile) ? [] : parseEnrichmentFile(readFileSync(outFile, "utf8"));
  const scope = pilot ? pilotSample(grammar) : grammar;
  const batches = batchByLevel(pendingTopics(scope, all));
  console.log(`${scope.length} topics in scope, ${all.length} already enriched, ${batches.length} batches to run`);

  const ask = (p: { system: string; user: string }) =>
    completeJson("lesson_generation", { system: p.system, messages: [{ role: "user", content: p.user }] }, z.array(enrichmentSchema));

  for (const [i, batch] of batches.entries()) {
    const started = Date.now();
    all.push(...(await enrichBatch(batch, variants, ask)));
    writeFileSync(outFile, serializeEnrichmentFile(all), "utf8"); // progress survives a crash
    console.log(`  batch ${i + 1}/${batches.length} (${batch.level}, ${batch.topics.length} topics) ${Math.round((Date.now() - started) / 1000)}s`);
  }

  console.log(`\n${all.length} records in ${outFile}`);
  const levels = [...new Set(all.map((r) => levelOf.get(r.name) ?? "?"))].sort();
  for (const level of levels) {
    const rows = all.filter((r) => (levelOf.get(r.name) ?? "?") === level);
    const imp = [1, 2, 3].map((n) => rows.filter((r) => r.teachable && r.importance === n).length);
    console.log(`  ${level}: ${rows.length} topics, ${rows.filter((r) => !r.teachable).length} not teachable, importance 1/2/3 = ${imp.join("/")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, after `"vocab:classify"`, add: `"grammar:enrich": "tsx scripts/enrich-grammar.ts"`

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit; npm test` — both clean. If `tsc` rejects `z.array(enrichmentSchema)` as the `completeJson` schema argument (the schema's input and output types differ because `note` has a default), annotate the call's type parameter — `completeJson<GrammarEnrichment[]>(…)` — and, only if that is still rejected, cast the schema: `z.array(enrichmentSchema) as z.ZodType<GrammarEnrichment[]>`. Do not change `src/lib/llm/index.ts`.

- [ ] **Step 4: Run the pilot (live Claude calls, 2 batches, a few minutes)**

Run: `npm run grammar:enrich -- --pilot` (use the maximum command timeout — each Agent SDK call can take 30–90 s).
Expected: `30 topics in scope, 0 already enriched, 2 batches to run`, two batch lines, then a per-level summary for A2 and B1, and `data/grammar-topics.pilot.json` with 30 records. If it exits with an `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` message, STOP and report BLOCKED (never print the token).

- [ ] **Step 5: Inspect the pilot yourself before showing the owner**

Read `data/grammar-topics.pilot.json`. Check: `You are` (B1) is `teachable: false` with a sensible `note`; titles use textbook terminology a learner would recognise; descriptions say form + use; examples are natural and at level; `importance: 1` went to tenses/modals/passive-type items rather than pronoun trivia; every `name` is byte-identical to the dataset name. If a class of answers is systematically off, adjust the SYSTEM text in `src/lib/prompts/grammarEnrichment.ts` (keep its test green) and re-run the pilot. At most 2 tuning rounds — then report what is still off.

- [ ] **Step 6: Commit and STOP for owner review**

```powershell
npx tsc --noEmit; npm test
git add scripts/enrich-grammar.ts package.json data/grammar-topics.pilot.json src/lib/prompts/grammarEnrichment.ts
git commit -m "feat(m3b-1): grammar enrichment script and pilot sample" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

**⛔ GATE:** the controller presents the pilot to the owner (all 30 titles with teachable/importance, every record you consider wrong, tuning rounds). **Do not start the full run (Task 8) until the owner accepts the pilot.** Tasks 5–7 do not depend on the gate and may proceed.

---

### Task 5: Schema migration

**Files:**
- Modify: `prisma/schema.prisma` (`model GrammarTopic`)
- Create: `prisma/migrations/<timestamp>_m3b1_grammar_enrichment/migration.sql` (generated)

**Interfaces:**
- Produces on the Prisma client: `GrammarTopic.title: string | null`, `description: string | null`, `example: string | null`, `teachable: boolean` (default `true`), `importance: number` (default `2`).

- [ ] **Step 1: Edit the schema**

In `model GrammarTopic`, after `sortOrder`:

```prisma
  title       String?  // learner-facing title from data/grammar-topics.json (M3b-1); NULL until enriched
  description String?
  example     String?
  teachable   Boolean  @default(true) // false = never selected as a lesson focus, not counted in progress
  importance  Int      @default(2) // 1 core .. 3 peripheral; orders topics inside a level
```

Then run `npx prisma format` so the columns align with the rest of the file.

- [ ] **Step 2: Create the migration**

```powershell
npm run db:start
npx prisma migrate dev --name m3b1_grammar_enrichment
```

Expected: `Your database is now in sync with your schema.` The generated SQL must contain only `ALTER TABLE "GrammarTopic" ADD COLUMN …` statements (`"teachable" BOOLEAN NOT NULL DEFAULT true`, `"importance" INTEGER NOT NULL DEFAULT 2`, three nullable TEXT columns). If Prisma reports drift or asks to reset — STOP and report; do not reset.

- [ ] **Step 3: Verify and commit**

```powershell
npx tsc --noEmit; npm test
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(m3b-1): schema - GrammarTopic title, description, example, teachable, importance" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 6: Selection skips non-teachable topics and orders by importance

**Files:**
- Modify: `src/lib/curriculum/select.ts`, `scripts/curriculum-preview.ts`
- Test: `src/lib/curriculum/select.test.ts`, `src/lib/curriculum/lessonInputs.test.ts`

**Interfaces:**
- Consumes: Prisma `GrammarTopic` with `teachable`/`importance`/`title` (Task 5).
- Produces: `GrammarCandidate` gains `teachable: boolean; importance: number`. `pickGrammarFocus` signature unchanged. `src/lib/curriculum/lessonInputs.ts` needs **no code change** — it spreads the full Prisma row, which now carries both fields.

- [ ] **Step 1: Update the test helper and add failing tests**

In `src/lib/curriculum/select.test.ts` replace the `G` helper with:

```ts
const G = (
  name: string, cefrLevel: string, status: string, sortOrder: number, openErrors = 0,
  extra: Partial<Pick<GrammarCandidate, "teachable" | "importance">> = {},
): GrammarCandidate => ({ name, cefrLevel, status, sortOrder, openErrors, teachable: true, importance: 2, ...extra });
```

and add inside `describe("pickGrammarFocus", …)`:

```ts
  it("never picks a non-teachable topic", () => {
    const topics = [G("trivial", "B1", "NOT_STARTED", 1, 0, { teachable: false }), G("real", "B1", "NOT_STARTED", 2)];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("real");
  });

  it("orders by importance before sortOrder inside a status group", () => {
    const topics = [
      G("peripheral", "B1", "NOT_STARTED", 1, 0, { importance: 3 }),
      G("useful", "B1", "NOT_STARTED", 2, 0, { importance: 2 }),
      G("core", "B1", "NOT_STARTED", 9, 0, { importance: 1 }),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("core");
  });

  it("keeps the status group above importance", () => {
    const topics = [
      G("core-new", "B1", "NOT_STARTED", 1, 0, { importance: 1 }),
      G("practising-peripheral", "B1", "PRACTICING", 9, 0, { importance: 3 }),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("practising-peripheral");
  });

  it("treats a band with only non-teachable topics as exhausted", () => {
    const topics = [G("trivial", "B1", "NOT_STARTED", 1, 0, { teachable: false }), G("b2", "B2", "NOT_STARTED", 1)];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("b2");
    expect(pickGrammarFocus([topics[0]], "B1")).toBeNull();
  });
```

In `src/lib/curriculum/lessonInputs.test.ts` add `teachable: true, importance: 2` to each of the four fake grammar rows (`g1`, `g2`, `gA`, `gB`), and add:

```ts
  it("skips non-teachable grammar topics and prefers higher importance", async () => {
    const { db } = fakeDb({
      grammar: [
        { id: "g0", name: "You are", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 1, teachable: false, importance: 1, _count: { errors: 0 } },
        { id: "g1", name: "-thing ADJ", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 2, teachable: true, importance: 3, _count: { errors: 0 } },
        { id: "g2", name: "PAST PERFECT", cefrLevel: "B1", status: "NOT_STARTED", sortOrder: 14, teachable: true, importance: 1, _count: { errors: 0 } },
      ],
    });
    expect((await selectLessonInputs(db, now)).grammarTopic?.id).toBe("g2");
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/lib/curriculum/select.test.ts src/lib/curriculum/lessonInputs.test.ts`
Expected: the 4 new `pickGrammarFocus` tests and the new wrapper test FAIL (`trivial` / `peripheral` / `g0` picked); `tsc` would also complain that `GrammarCandidate` has no `teachable`.

- [ ] **Step 3: Implement**

In `src/lib/curriculum/select.ts`, extend the interface:

```ts
export interface GrammarCandidate {
  name: string;
  cefrLevel: string;
  status: string;
  sortOrder: number;
  /** Count of this topic's ErrorRecords whose status is not MASTERED. */
  openErrors: number;
  /** false = never a lesson focus (trivial at its level / corpus artefact). From data/grammar-topics.json. */
  teachable: boolean;
  /** 1 core .. 3 peripheral, relative to the topic's own level. */
  importance: number;
}
```

and replace the body of `pickGrammarFocus`:

```ts
export function pickGrammarFocus<T extends GrammarCandidate>(topics: T[], level: CefrBand): T | null {
  for (const band of CEFR_BANDS.slice(CEFR_BANDS.indexOf(level))) {
    const pool = topics.filter((t) => t.cefrLevel === band && t.status !== "MASTERED" && t.teachable);
    if (pool.length === 0) continue; // nothing teachable left here -> next band
    return [...pool].sort(
      (a, b) =>
        grammarRank(a) - grammarRank(b) ||
        a.importance - b.importance ||
        a.sortOrder - b.sortOrder ||
        cmp(a.name, b.name),
    )[0];
  }
  return null;
}
```

In `scripts/curriculum-preview.ts`, in the `grammar :` line, print the enriched title when present: replace `${s.grammarTopic.name}` with `${s.grammarTopic.title ?? s.grammarTopic.name}`.

- [ ] **Step 4: Run to verify everything passes**

Run: `npx vitest run src/lib/curriculum/select.test.ts src/lib/curriculum/lessonInputs.test.ts; npx tsc --noEmit`
Expected: PASS; no type errors (if `tsc` says `teachable` does not exist on the Prisma type, run `npx prisma generate`).

- [ ] **Step 5: Commit**

```powershell
npm test
git add src/lib/curriculum/select.ts src/lib/curriculum/select.test.ts src/lib/curriculum/lessonInputs.test.ts scripts/curriculum-preview.ts
git commit -m "feat(m3b-1): grammar focus skips non-teachable topics and orders by importance" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 7: Seed applies the enrichment; progress counts only teachable topics

**Files:**
- Modify: `src/lib/curriculum/seedExtras.ts`, `prisma/seed.ts`, `src/lib/curriculum/progress.ts`
- Test: `src/lib/curriculum/seedExtras.test.ts` (append), `src/lib/curriculum/progress.test.ts` (append)

**Interfaces:**
- Consumes: `parseEnrichmentFile`, `type GrammarEnrichment` (Task 2); Prisma columns (Task 5).
- Produces: `buildGrammarEnrichment(jsonText: string, knownNames: ReadonlySet<string>): GrammarEnrichment[]` (throws naming an unknown or duplicated `name`); `getSyllabusProgress(db?: ProgressDb)` where `type ProgressDb = Pick<PrismaClient, "grammarTopic" | "vocabItem">`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/curriculum/seedExtras.test.ts` (import `buildGrammarEnrichment`):

```ts
describe("buildGrammarEnrichment", () => {
  const record = (name: string) => ({
    name, title: "Past Perfect (had done)",
    description: "Use had + past participle for an action completed before another past moment.",
    example: "When I arrived, the meeting had already started.", teachable: true, importance: 1, note: "",
  });
  const known = new Set(["A", "B"]);

  it("returns validated records for known topics", () => {
    expect(buildGrammarEnrichment(JSON.stringify([record("A"), record("B")]), known).map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("fails naming a topic that is not in the syllabus", () => {
    expect(() => buildGrammarEnrichment(JSON.stringify([record("Ghost")]), known)).toThrow(/Ghost/);
  });

  it("fails naming a duplicated topic", () => {
    expect(() => buildGrammarEnrichment(JSON.stringify([record("A"), record("A")]), known)).toThrow(/duplicate.*"A"/);
  });
});
```

Append to `src/lib/curriculum/progress.test.ts` — put the mock at the very top of the file, above the existing imports, and add `vi` + `getSyllabusProgress` to the imports:

```ts
vi.mock("@/lib/db", () => ({ prisma: {} })); // never build a real PrismaClient in unit tests
```

```ts
describe("getSyllabusProgress", () => {
  it("counts only teachable grammar topics", async () => {
    const grammarFindMany = vi.fn().mockResolvedValue([{ cefrLevel: "B1", status: "MASTERED" }]);
    const vocabFindMany = vi.fn().mockResolvedValue([{ cefrLevel: "B1", status: "NEW" }]);
    const db = { grammarTopic: { findMany: grammarFindMany }, vocabItem: { findMany: vocabFindMany } };

    const out = await getSyllabusProgress(db as unknown as Parameters<typeof getSyllabusProgress>[0]);

    expect(grammarFindMany).toHaveBeenCalledWith({ where: { teachable: true }, select: { cefrLevel: true, status: true } });
    expect(out).toEqual([{ level: "B1", grammarTotal: 1, grammarMastered: 1, vocabTotal: 1, vocabKnown: 0 }]);
  });

  it("returns null when the database is unreachable", async () => {
    const db = { grammarTopic: { findMany: vi.fn().mockRejectedValue(new Error("down")) }, vocabItem: { findMany: vi.fn() } };
    expect(await getSyllabusProgress(db as unknown as Parameters<typeof getSyllabusProgress>[0])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/curriculum/seedExtras.test.ts src/lib/curriculum/progress.test.ts`
Expected: FAIL — `buildGrammarEnrichment` missing; `getSyllabusProgress` ignores its argument / has no `where`.

- [ ] **Step 3: Implement the helper and the progress filter**

Append to `src/lib/curriculum/seedExtras.ts` (import `parseEnrichmentFile, type GrammarEnrichment` from `./grammarEnrichment`):

```ts
/** data/grammar-topics.json -> records for the seed's bulk UPDATE. Unknown/duplicate names abort the seed. */
export function buildGrammarEnrichment(jsonText: string, knownNames: ReadonlySet<string>): GrammarEnrichment[] {
  const records = parseEnrichmentFile(jsonText);
  const seen = new Set<string>();
  for (const r of records) {
    if (!knownNames.has(r.name)) {
      throw new Error(`grammar-topics.json: "${r.name}" is not a grammar topic in the syllabus (name must match the dataset verbatim)`);
    }
    if (seen.has(r.name)) throw new Error(`grammar-topics.json: duplicate "${r.name}"`);
    seen.add(r.name);
  }
  return records;
}
```

In `src/lib/curriculum/progress.ts`: add `import type { PrismaClient } from "@prisma/client";`, export `type ProgressDb = Pick<PrismaClient, "grammarTopic" | "vocabItem">;`, change the signature to `getSyllabusProgress(db: ProgressDb = prisma)`, use `db` instead of `prisma` inside, make the two queries **sequential** (two `await`s, not `Promise.all` — the pg adapter holds one connection), and give the grammar query `where: { teachable: true }`:

```ts
    const grammar = await db.grammarTopic.findMany({ where: { teachable: true }, select: { cefrLevel: true, status: true } });
    const vocab = await db.vocabItem.findMany({ select: { cefrLevel: true, status: true } });
```

Update the function's doc comment to say non-teachable topics are excluded so a level can reach 100%.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/curriculum/seedExtras.test.ts src/lib/curriculum/progress.test.ts src/app/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the seed**

In `prisma/seed.ts`: extend the `seedExtras` import with `buildGrammarEnrichment`, add this function next to `seedVocabTopics`, call `await seedGrammarEnrichment();` in `main()` right after the `grammarTopic.createMany` call, and add a header-comment line ` *  - applies data/grammar-topics.json (title, description, example, teachable, importance) to GrammarTopic.`

```ts
/** Apply data/grammar-topics.json to GrammarTopic. One bulk UPDATE; only changed rows are touched. */
async function seedGrammarEnrichment() {
  const file = path.join(DATA_DIR, "grammar-topics.json");
  if (!existsSync(file)) return console.warn("data/grammar-topics.json missing - grammar topics keep their raw names (teachable, importance 2).");
  const known = new Set((await prisma.grammarTopic.findMany({ select: { name: true } })).map((t) => t.name));
  const rows = buildGrammarEnrichment(readFileSync(file, "utf8"), known);
  const names = rows.map((r) => r.name);
  const titles = rows.map((r) => r.title);
  const descriptions = rows.map((r) => r.description);
  const examples = rows.map((r) => r.example);
  // booleans/ints travel as text[] and are cast in SQL - avoids driver-specific array typing
  const teachables = rows.map((r) => String(r.teachable));
  const importances = rows.map((r) => String(r.importance));
  const updated = await prisma.$executeRaw`
    UPDATE "GrammarTopic" AS g
    SET "title" = d.title, "description" = d.description, "example" = d.example,
        "teachable" = d.teachable::boolean, "importance" = d.importance::int
    FROM unnest(${names}::text[], ${titles}::text[], ${descriptions}::text[], ${examples}::text[],
                ${teachables}::text[], ${importances}::text[])
         AS d(name, title, description, example, teachable, importance)
    WHERE g."name" = d.name
      AND (g."title", g."description", g."example", g."teachable", g."importance")
          IS DISTINCT FROM (d.title, d.description, d.example, d.teachable::boolean, d.importance::int)`;
  console.log(`Grammar enrichment: ${rows.length} records in JSON, ${updated} rows updated.`);
}
```

- [ ] **Step 6: Exercise the UPDATE path against the live DB with the pilot file, then clean up**

`data/grammar-topics.json` does not exist yet (the full run is gated), so use the pilot as a temporary fixture:

```powershell
npm run db:start
npx prisma db seed                                   # expect: "data/grammar-topics.json missing - ..." and unchanged counts
Copy-Item data/grammar-topics.pilot.json data/grammar-topics.json
npx prisma db seed                                   # expect: "Grammar enrichment: 30 records in JSON, 30 rows updated."
npx prisma db seed                                   # expect: "... 30 records in JSON, 0 rows updated."  (idempotent)
npm run curriculum:preview                           # grammar line now shows an enriched B1 title, not "You are"
Remove-Item data/grammar-topics.json
```

Then reset the touched rows so the DB is back to its pre-enrichment state (read `scripts/db.ps1` for the non-interactive psql form — your shell has no interactive stdin):

```sql
UPDATE "GrammarTopic" SET "title" = NULL, "description" = NULL, "example" = NULL, "teachable" = true, "importance" = 2;
SELECT count(*) FROM "GrammarTopic" WHERE "title" IS NOT NULL OR NOT "teachable" OR "importance" <> 2;  -- expect 0
```

Confirm `git status` does not show `data/grammar-topics.json`. If `$executeRaw` rejects the statement, report the exact error instead of improvising a different strategy.

- [ ] **Step 7: Commit**

```powershell
npx tsc --noEmit; npm test
git add src/lib/curriculum/seedExtras.ts src/lib/curriculum/seedExtras.test.ts src/lib/curriculum/progress.ts src/lib/curriculum/progress.test.ts prisma/seed.ts
git commit -m "feat(m3b-1): seed applies grammar enrichment; syllabus progress counts only teachable topics" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 8: Full enrichment run, docs, M3b-1 verification checkpoint

**Precondition:** the owner accepted the pilot (Task 4 gate).

**Files:**
- Create: `data/grammar-topics.json` (generated) · Delete: `data/grammar-topics.pilot.json`
- Modify: `SPEC.md`, `data/README.md`, `CLAUDE.md`

- [ ] **Step 1: Full run**

Run: `npm run grammar:enrich` (maximum command timeout). Expected: `266 topics in scope, 0 already enriched, ~21 batches to run`; several minutes. If the command times out or a batch fails, run the same command again — it resumes from the file. If the same batch fails 3 times in a row, STOP and report the error text.

- [ ] **Step 2: Sanity-check the result**

The summary must show 266 records. Report per level: topics, non-teachable count, importance histogram. Red flags to report (do not "fix" by editing the JSON yourself): a level with more than ~25% non-teachable topics; a level with no `importance: 1` topic; any level where **every** topic is non-teachable.

- [ ] **Step 3: Seed and preview**

```powershell
npm run db:start
npx prisma db seed          # expect: "Grammar enrichment: 266 records in JSON, <N> rows updated."
npx prisma db seed          # expect: "... 0 rows updated."
npm run curriculum:preview  # the grammar line shows a core B1 topic with a textbook title
```

- [ ] **Step 4: Docs**

- `SPEC.md`: in the Prisma block add the five `GrammarTopic` fields; in §"How the curriculum drives lesson generation" change the grammar-focus bullet to: next **teachable** `GrammarTopic` with `status != MASTERED` at the user's level — `PRACTICING` with open errors → `PRACTICING` → `INTRODUCED` → `NOT_STARTED`, then by `importance` (1 core … 3 peripheral), then `sortOrder`; titles, descriptions, examples, `teachable` and `importance` come from `data/grammar-topics.json`, generated once offline by Claude (`npm run grammar:enrich`), because CEFR-J items are corpus pattern labels, not teaching topics.
- `data/README.md`: add a Files-table row for `grammar-topics.json` (266 records → `GrammarTopic` enrichment; generated by `npm run grammar:enrich`, reviewed by hand) and a maintainer note: regenerate with `npm run grammar:enrich` (resumable; `--pilot` for a 30-topic sample); hand edits are fine — the seed validates names and re-applies.
- `CLAUDE.md`: Commands — add `npm run grammar:enrich`; Milestone status — M3b split into M3b-1 ✅ (what it delivered) and M3b-2 (lesson generation, not started), pointing to `docs/superpowers/specs/2026-09-18-m3b1-grammar-enrichment-design.md`; Key decisions — one line: grammar topics are CEFR-J corpus labels, enriched once into `data/grammar-topics.json`; selection skips `teachable=false` and orders by `importance`.
Minimal, factual edits only.

- [ ] **Step 5: Verify and commit**

```powershell
npx tsc --noEmit; npm test; npm run build
git rm -q data/grammar-topics.pilot.json
git add data/grammar-topics.json SPEC.md data/README.md CLAUDE.md
git commit -m "feat(m3b-1): enrich all 266 grammar topics via Claude; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

- [ ] **Step 6: Report for the owner checkpoint**

Report the per-level table, the list of all non-teachable topics with their notes, the `importance: 1` titles for B1, and the `curriculum:preview` output. M3b-1 is done when the owner confirms the focus order makes sense.
