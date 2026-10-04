# M4c — Errors Page and Dashboard Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/errors` log (filters, progress, due dates, review history) and two real dashboard cards ("Errors", "Recently mastered"), with mastered dates recorded from now on.

**Architecture:** One additive migration adds `masteredAt` to GrammarTopic, VocabItem and ErrorRecord; the existing transition points (M4a recompute, M3c vocab update, M4b review update) set/clear it. Pure helpers map categories and due labels; injectable query functions read the DB sequentially; server pages render with filters in the URL.

**Tech Stack:** Next.js 15 server components, Prisma 7 (local PostgreSQL), Tailwind 3 (semantic tokens), lucide-react, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-m4c-errors-page-design.md` (read it first).

## Global Constraints

- **TDD:** failing test → run it red → implement → run it green → commit. One logical commit per task.
- **Before every commit:** `npx tsc --noEmit` and `npm test`, both clean (and `npm run build` for UI tasks).
- **Commit messages:** `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"` — exactly this trailer and nothing else; check `git log -1 --format=%B`.
- Branch `feature/m4c-errors`; never touch `main`, never push. No new npm dependencies (no chart library — bars are plain divs). Never `git add` `skills-lock.json`, `AGENTS.md`, `.superpowers/`.
- Pure-logic tests start with `// @vitest-environment node`. Prisma queries sequential (no `Promise.all`).
- The only migration is additive (three nullable `masteredAt` columns). Drift/reset prompt → STOP. The real DB is read only by tasks (no writes).
- UI: semantic tokens only, lucide icons only (`aria-hidden` when decorative), state never colour alone (icon + text), touch targets ≥ 44px, plain ASCII or `\u` escapes for typographic characters. UI copy in English.
- `streakTarget` = 3 (the M4b `REVIEW_MASTERED_STREAK`; import it, do not hard-code).

## Review Focus

1. **Unknown or tampered filter values in the URL** (`/errors?status=foo&category=bar`) → fall back to `open` / `all`, no crash. *(Task 4 test "unknown filters fall back")*
2. **An error whose grammar topic no longer exists** → the title falls back to the humanised category. *(Task 3 test "title falls back to the category")*
3. **A word demoted from KNOWN** → its `masteredAt` is cleared and it disappears from "Recently mastered". *(Task 1 test "demotion clears masteredAt"; Task 3 test "only currently mastered items")*
4. **Local-midnight boundaries** — an error due at 23:30 today is "Due today", one due at 00:10 tomorrow is "Due tomorrow". *(Task 2 tests)*
5. **Dashboard with the DB down** → both new cards show "-", the page renders. *(Task 3 tests "null on failure"; Task 5 test "renders '-' when stats are null")*

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration | `masteredAt` on GrammarTopic, VocabItem, ErrorRecord |
| `src/lib/curriculum/completeLesson.ts`, `src/lib/grading/recordAnswer.ts` | set/clear `masteredAt` on transitions |
| `src/lib/errors/categories.ts`, `src/lib/errors/due.ts` | pure: group of an error, title, due label |
| `src/lib/errors/queries.ts` | `listErrors`, `getErrorStats`, `getRecentlyMastered` |
| `src/app/errors/page.tsx` | the `/errors` page |
| `src/components/ErrorStats.tsx`, `src/components/RecentlyMastered.tsx`, `src/app/page.tsx` | dashboard cards |

---

### Task 1: `masteredAt` migration and writers

**Files:** Modify `prisma/schema.prisma` (+ migration), `src/lib/curriculum/completeLesson.ts` (+ test), `src/lib/grading/recordAnswer.ts` (+ test)

**Interfaces:** Produces `GrammarTopic.masteredAt`, `VocabItem.masteredAt`, `ErrorRecord.masteredAt` (`DateTime?`); `recomputeTopic(tx, topicId, now: Date)`.

- [ ] **Step 1: Migration.** Add `masteredAt DateTime? // M4c: when it became MASTERED/KNOWN; null otherwise` to `model GrammarTopic`, `model VocabItem` and `model ErrorRecord`. `npx prisma format`, DB up, `npx prisma migrate dev --name m4c_mastered_at` → exactly three `ADD COLUMN`. `npx prisma generate`.

- [ ] **Step 2: Failing tests.**
  - `completeLesson.test.ts`: the fake `grammarTopic.findUnique` now returns `masteredAt` too. "sets masteredAt when the topic becomes MASTERED": topic `{ status: "INTRODUCED", cefrLevel: "A2", importance: 1, masteredAt: null }`, history `[{ writtenScore: 0.86 }]`, `recomputeTopic(tx, "g1", now)` → update data contains `status: "MASTERED", masteredAt: now`. "keeps masteredAt when already MASTERED": topic `{ status: "MASTERED", ..., masteredAt: earlier }` → update data has no `masteredAt` key. "no masteredAt while PRACTICING": data has no `masteredAt`. `completeWrittenBlockIfDone` passes its `completedAt` through (assert via the update data in the existing "completes ..." test).
  - `recordAnswer.test.ts`: vocab `findUnique` fake returns `{ status, correctStreak }`. "KNOWN transition sets masteredAt": row `{ status: "LEARNING", correctStreak: 2 }`, correct → update data `{ status: "KNOWN", correctStreak: 3, lastSeenAt: now, masteredAt: now }`. "staying KNOWN keeps masteredAt": row `{ status: "KNOWN", correctStreak: 3 }`, correct → data has no `masteredAt`. "demotion clears masteredAt": row KNOWN, wrong → data includes `masteredAt: null`. Review update: reviewed `{ correctStreak: 2, description: "", status: "REVIEWING" }`, correct → data includes `status: "MASTERED", masteredAt: now`; wrong on a REVIEWING error → `masteredAt: null`; correct on an already MASTERED error → no `masteredAt` key.

- [ ] **Step 3: Run to verify they fail.**

- [ ] **Step 4: Implement.**
  - `completeLesson.ts`: `recomputeTopic(tx, topicId, now)`; select `masteredAt` too; after `nextTopicState`, `data = { ...next, ...(next.status === "MASTERED" && topic.status !== "MASTERED" ? { masteredAt: now } : {}) }`. `completeWrittenBlockIfDone` calls `recomputeTopic(tx, topicId, completedAt)`.
  - `recordAnswer.ts` vocab loop: `const masteredAt = next.status === "KNOWN" ? (row.status === "KNOWN" ? undefined : input.now) : null;` and spread `...(masteredAt !== undefined ? { masteredAt } : {})` into the update data.
  - review block: select `status` too; `const masteredAt = next.status === "MASTERED" ? (reviewed.status === "MASTERED" ? undefined : input.now) : null;` spread the same way.

- [ ] **Step 5: Run to verify they pass; commit.**

```powershell
npx tsc --noEmit; npm test
git add prisma/schema.prisma prisma/migrations src/lib/curriculum/completeLesson.ts src/lib/curriculum/completeLesson.test.ts src/lib/grading/recordAnswer.ts src/lib/grading/recordAnswer.test.ts
git commit -m "feat(m4c): record when topics, words and mistakes become mastered" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 2: Pure helpers — groups, titles, due labels

**Files:** Create `src/lib/errors/categories.ts`, `src/lib/errors/due.ts` (+ node tests)

**Interfaces:** Produces `ErrorGroup`, `ERROR_GROUPS` (order: grammar, translation, vocab, listening, writing, general), `GROUP_LABELS`, `categoryGroup(e: { category: string; grammarTopicId: string | null }): ErrorGroup`, `errorTitle(e: { category: string; grammarTopicId: string | null }, topicTitle: string | null): string`; `dueLabel(nextReviewAt: Date, status: string, now: Date): { label: string; isDue: boolean }`, `startOfTomorrow(now: Date): Date`, `formatDay(d: Date): string` ("27 Sep").

- [ ] **Step 1: Failing tests** (`categories.test.ts`):

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { categoryGroup, errorTitle, GROUP_LABELS } from "./categories";

const e = (category: string, grammarTopicId: string | null = null) => ({ category, grammarTopicId });

describe("categoryGroup", () => {
  it("maps every category family", () => {
    expect(categoryGroup(e("Comparative with more", "g1"))).toBe("grammar");
    expect(categoryGroup(e("translation: meaning"))).toBe("translation");
    expect(categoryGroup(e("vocab: deadline"))).toBe("vocab");
    expect(categoryGroup(e("listening/spelling"))).toBe("listening");
    expect(categoryGroup(e("writing: grammar"))).toBe("writing");
    expect(categoryGroup(e("general"))).toBe("general");
    expect(categoryGroup(e("something new"))).toBe("general");
    expect(GROUP_LABELS.vocab).toBe("Vocabulary");
  });
});

describe("errorTitle", () => {
  it("uses the topic title for grammar errors", () => {
    expect(errorTitle(e("Comparative with more", "g1"), "Comparative with more (more + adjective)")).toBe("Comparative with more (more + adjective)");
  });
  it("title falls back to the category when the topic is gone", () => {
    expect(errorTitle(e("Comparative with more", "g1"), null)).toBe("Comparative with more");
  });
  it("humanises prefixed categories", () => {
    expect(errorTitle(e("translation: meaning"), null)).toBe("Translation - meaning");
    expect(errorTitle(e("vocab: deadline"), null)).toBe("Word - deadline");
    expect(errorTitle(e("writing: word_order"), null)).toBe("Writing - word order");
    expect(errorTitle(e("listening/spelling"), null)).toBe("Listening and spelling");
    expect(errorTitle(e("general"), null)).toBe("General");
  });
});
```

`due.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dueLabel, formatDay, startOfTomorrow } from "./due";

const now = new Date(2026, 9, 4, 10, 0); // 4 Oct, local

describe("dueLabel", () => {
  it("covers overdue, today, tomorrow, later and mastered", () => {
    expect(dueLabel(new Date(2026, 8, 27, 6, 15), "NEW", now)).toEqual({ label: "Overdue since 27 Sep", isDue: true });
    expect(dueLabel(new Date(2026, 9, 4, 23, 30), "REVIEWING", now)).toEqual({ label: "Due today", isDue: true });
    expect(dueLabel(new Date(2026, 9, 5, 0, 10), "REVIEWING", now)).toEqual({ label: "Due tomorrow", isDue: false });
    expect(dueLabel(new Date(2026, 9, 11, 9, 0), "REVIEWING", now)).toEqual({ label: "In 7 days", isDue: false });
    expect(dueLabel(new Date(2026, 9, 1), "MASTERED", now)).toEqual({ label: "Mastered", isDue: false });
  });
  it("formats days with a fixed month table", () => {
    expect(formatDay(new Date(2026, 8, 27))).toBe("27 Sep");
  });
  it("startOfTomorrow is local midnight", () => {
    expect(startOfTomorrow(now)).toEqual(new Date(2026, 9, 5));
  });
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.**

`src/lib/errors/categories.ts`:

```ts
export const ERROR_GROUPS = ["grammar", "translation", "vocab", "listening", "writing", "general"] as const;
export type ErrorGroup = (typeof ERROR_GROUPS)[number];

export const GROUP_LABELS: Record<ErrorGroup, string> = {
  grammar: "Grammar",
  translation: "Translation",
  vocab: "Vocabulary",
  listening: "Listening",
  writing: "Writing",
  general: "General",
};

type ErrorKey = { category: string; grammarTopicId: string | null };

export function categoryGroup(e: ErrorKey): ErrorGroup {
  if (e.grammarTopicId) return "grammar";
  if (e.category.startsWith("translation:")) return "translation";
  if (e.category.startsWith("vocab:")) return "vocab";
  if (e.category === "listening/spelling") return "listening";
  if (e.category.startsWith("writing:")) return "writing";
  return "general";
}

const PREFIX: Record<string, string> = { "translation:": "Translation", "vocab:": "Word", "writing:": "Writing" };

/** Learner-facing title: the grammar topic's title, else the humanised category. */
export function errorTitle(e: ErrorKey, topicTitle: string | null): string {
  if (e.grammarTopicId && topicTitle) return topicTitle;
  for (const [prefix, label] of Object.entries(PREFIX)) {
    if (e.category.startsWith(prefix)) return `${label} - ${e.category.slice(prefix.length).trim().replace(/_/g, " ")}`;
  }
  if (e.category === "listening/spelling") return "Listening and spelling";
  if (e.category === "general") return "General";
  return e.category;
}
```

`src/lib/errors/due.ts`:

```ts
const DAY = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const startOfTomorrow = (now: Date): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "27 Sep" - fixed table, not toLocaleDateString (ICU renders en-GB September as "Sept"). */
export const formatDay = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmt = formatDay;

/** "Due today" means before the start of tomorrow (local), matching the M4b selection rule. */
export function dueLabel(nextReviewAt: Date, status: string, now: Date): { label: string; isDue: boolean } {
  if (status === "MASTERED") return { label: "Mastered", isDue: false };
  const today = DAY(now).getTime();
  const day = DAY(nextReviewAt).getTime();
  if (day < today) return { label: `Overdue since ${fmt(nextReviewAt)}`, isDue: true };
  if (day === today) return { label: "Due today", isDue: true };
  const days = Math.round((day - today) / 86_400_000);
  return { label: days === 1 ? "Due tomorrow" : `In ${days} days`, isDue: false };
}
```

- [ ] **Step 4: Run to verify they pass; commit.**

```powershell
npx tsc --noEmit; npm test
git add src/lib/errors
git commit -m "feat(m4c): error groups, titles and due labels" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 3: Queries

**Files:** Create `src/lib/errors/queries.ts`, `src/lib/errors/queries.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers; `REVIEW_MASTERED_STREAK` (`src/lib/review/schedule.ts`).
- Produces:
  - `type StatusFilter = "open" | "mastered" | "all"`; `type GroupFilter = ErrorGroup | "all"`.
  - `interface ErrorView { id: string; title: string; group: ErrorGroup; examples: string[]; status: string; correctStreak: number; streakTarget: number; due: { label: string; isDue: boolean }; createdAt: Date; attempts: { at: Date; correct: boolean }[] }`.
  - `listErrors(filter: { status: StatusFilter; group: GroupFilter }, now: Date, db?: ErrorsDb): Promise<{ items: ErrorView[]; counts: { status: Record<StatusFilter, number>; group: Record<GroupFilter, number> } }>` — counts: status counts over all errors; group counts over errors matching the status filter.
  - `getErrorStats(now: Date, db?): Promise<{ dueToday: number; openByGroup: { group: ErrorGroup; label: string; count: number }[] } | null>`.
  - `getRecentlyMastered(db?, limit = 5): Promise<{ kind: "grammar" | "word" | "mistake"; label: string; at: Date }[] | null>`.
  - `type ErrorsDb = Pick<PrismaClient, "errorRecord" | "grammarTopic" | "exercise" | "vocabItem">`.

- [ ] **Step 1: Failing tests** (`queries.test.ts`, node env, a fake db whose `findMany`s return fixtures):
  - `listErrors` with two errors (A: grammar g1, NEW, due 27 Sep, description "- as -> than"; B: "translation: meaning", REVIEWING, streak 1, due in 3 days) and topic g1 titled "Comparative with more", plus one answered review exercise for B `{ errorRecordId: "B", answeredAt: 2 Oct, isCorrect: true }` and one unanswered review exercise for A:
    - `status: "open"` → items `[A, B]` (due first), A `{ title: "Comparative with more", group: "grammar", examples: ["as -> than"], due: { label: "Overdue since 27 Sep", isDue: true }, attempts: [] }`, B `{ title: "Translation - meaning", correctStreak: 1, streakTarget: 3, attempts: [{ at: 2 Oct, correct: true }] }`; counts.status `{ open: 2, mastered: 0, all: 2 }`; counts.group grammar 1, translation 1, all 2.
    - `group: "translation"` → only B.
    - "title falls back to the category" when the topic lookup returns nothing.
    - the errorRecord query for `mastered` uses `where: { status: "MASTERED" }`, for `open` `where: { status: { not: "MASTERED" } }`, for `all` no status filter; the exercise query is `where: { errorRecordId: { in: [ids] }, answeredAt: { not: null } }`.
  - `getErrorStats`: open errors (2 due today/overdue, 1 later, groups grammar×2, vocab×1) → `{ dueToday: 2, openByGroup: [{ group: "grammar", label: "Grammar", count: 2 }, { group: "vocab", label: "Vocabulary", count: 1 }] }`; "null on failure" when the query throws.
  - `getRecentlyMastered`: topics `[{ title: "Past Simple", name: "X", masteredAt: 3 Oct }]`, words `[{ headword: "deadline", masteredAt: 4 Oct }]`, errors `[{ category: "vocab: agenda", grammarTopicId: null, masteredAt: 1 Oct }]` → `[word deadline 4 Oct, grammar Past Simple 3 Oct, mistake "Word - agenda" 1 Oct]`; "only currently mastered items": the queries filter `status: "MASTERED"`/`"KNOWN"` and `masteredAt: { not: null }`, `orderBy: { masteredAt: "desc" }`, `take: limit`; limit applied after the merge; "null on failure".

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** with sequential queries: errors (`select: { id, category, grammarTopicId, description, status, correctStreak, nextReviewAt, createdAt }`, ordered `nextReviewAt asc, createdAt asc, id asc`), then topic titles for the distinct grammar ids (`title ?? name`), then answered review exercises for the listed ids (`select: { errorRecordId, answeredAt, isCorrect }`, `orderBy: { answeredAt: "asc" }`). Build views with Task 2 helpers; sort by `due.isDue` desc, then `nextReviewAt`, `createdAt`, `id`; apply the group filter after computing groups; examples = description lines without "- ", last 5. `getErrorStats` queries open errors only (`select: { category, grammarTopicId, nextReviewAt }`), counts `nextReviewAt < startOfTomorrow(now)`, groups sorted by count desc then `ERROR_GROUPS` order; wrap in try/catch → null. `getRecentlyMastered`: three queries (topics MASTERED with masteredAt, words KNOWN with masteredAt, errors MASTERED with masteredAt), each `take: limit`, merged, sorted by `at` desc then label, sliced to `limit`; try/catch → null.

- [ ] **Step 4: Run to verify they pass; commit.**

```powershell
npx tsc --noEmit; npm test
git add src/lib/errors/queries.ts src/lib/errors/queries.test.ts
git commit -m "feat(m4c): queries for the errors log, error stats and recently mastered" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 4: `/errors` page

**Files:** Create `src/app/errors/page.tsx`, `src/app/errors/page.test.tsx`, `src/components/errors/ErrorCard.tsx`

**Interfaces:** Consumes `listErrors`, `ErrorView`, `ERROR_GROUPS`, `GROUP_LABELS`.

- [ ] **Step 1: Failing tests** (`page.test.tsx`; mock `@/lib/errors/queries` and `next/navigation` `usePathname` → "/errors"):
  - renders the heading "Mistakes", the SideNav, one card per item with title, group label, status text ("New" / "Reviewing" / "Mastered") next to an icon, "1 of 3 correct in a row", the due label, "First seen 26 Sep", the examples as "as -> than" lines, and "Review history" with "2 Oct" and "correct" (or "No reviews yet").
  - filter links: "Open (2)", "Mastered (0)", "All (2)" and group links with counts; the active ones have `aria-current="page"`; hrefs keep the other filter (`/errors?status=all&category=translation`).
  - "unknown filters fall back": `searchParams` `{ status: "foo", category: "bar" }` → `listErrors` called with `{ status: "open", group: "all" }`.
  - empty items → "No mistakes here yet."
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** `page.tsx`: `export const dynamic = "force-dynamic"`; `async function ErrorsPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string }> })`; validate values against the allowed sets; `const { items, counts } = await listErrors(filter, new Date())`; layout like `/lesson/[id]` (`md:flex`, SideNav, `<main className="mx-auto w-full max-w-3xl p-4 pb-24 md:p-6">`). Filters are `Link`s styled as pills (`min-h-11`, `rounded-full`, active: `bg-surface-2 font-bold` + `aria-current`). `ErrorCard` (server component): status icons from lucide (`CircleDot` New, `RotateCcw` Reviewing, `CheckCircle2` Mastered) + text; review history list with `Check`/`X` icons + "correct"/"wrong" text and `formatDay` dates (from `src/lib/errors/due.ts`).
- [ ] **Step 4: Run to verify they pass; `npm run build`; commit.**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/app/errors src/components/errors
git commit -m "feat(m4c): errors log page with filters, progress and review history" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

---

### Task 5: Dashboard cards, docs

**Files:** Create `src/components/ErrorStats.tsx`, `src/components/RecentlyMastered.tsx` (+ tests); Modify `src/app/page.tsx`, `src/app/page.test.tsx`, `SPEC.md`, `CLAUDE.md`

- [ ] **Step 1: Failing tests.**
  - `ErrorStats.test.tsx`: `{ dueToday: 2, openByGroup: [Grammar 2, Vocabulary 1] }` → "2 due today", bar rows "Grammar 2" and "Vocabulary 1" (text), link "See all mistakes" to `/errors`; `dueToday: 0` → "Nothing due today"; empty groups → "No open mistakes"; "renders '-' when stats are null".
  - `RecentlyMastered.test.tsx`: three items → rows with label, kind text ("Word", "Grammar", "Mistake") and date "4 Oct"; `[]` → "Nothing mastered yet."; `null` → "-".
  - `page.test.tsx`: mock `@/lib/errors/queries` (`getErrorStats`, `getRecentlyMastered`) and assert both cards render.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Dates via `formatDay`. Bars: a flex row per group — label, a track (`bg-surface-2`, `h-2`, `rounded-full`) with a fill (`bg-primary`) whose width is `count / max * 100%`, and the count in text (`tabular-nums`). `page.tsx`: after the existing loaders, `const errorStats = await getErrorStats(new Date()); const mastered = await getRecentlyMastered();` (sequential); the "Errors" card replaces nothing (add it), "Recently mastered" renders `<RecentlyMastered items={mastered} />`. Grid stays `md:grid-cols-3` (4 cards wrap).
- [ ] **Step 4: Docs.** `SPEC.md` §Pages: `/errors` as built (filters in URL, card contents, order, read-only); dashboard "Errors" and "Recently mastered" cards; §Data model: `masteredAt` on GrammarTopic, VocabItem, ErrorRecord (set on transition, cleared on vocab demotion / error back to REVIEWING). `CLAUDE.md`: M4c ✅ line (spec pointer), M4 complete; branch `feature/m4c-errors`.
- [ ] **Step 5: Verify and commit.**

```powershell
npx tsc --noEmit; npm test; npm run build
git add src/components/ErrorStats.tsx src/components/ErrorStats.test.tsx src/components/RecentlyMastered.tsx src/components/RecentlyMastered.test.tsx src/app/page.tsx src/app/page.test.tsx SPEC.md CLAUDE.md
git commit -m "feat(m4c): dashboard errors and recently mastered cards; docs" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log -1 --format=%B
```

- [ ] **Step 6: Live smoke check (read-only).** `npm run build` then a `next start` on a free port (or `npm run dev`), fetch `/errors` and `/` with curl, confirm the owner's two errors appear ("Comparative with more ...", "Translation - meaning", "Overdue since 27 Sep") and the dashboard shows "2 due today". Stop only the server you started.
