# M4c — Errors page and dashboard stats

**Date:** 2026-10-04 · **Status:** approved design · **Parent:** `SPEC.md` §Pages / UI (`/errors`,
dashboard error stats and recently mastered), milestone M4 (M4a, M4b done; this closes M4).

## Problem

Mistakes are tracked (M3c), reviewed and rescheduled (M4b), and topics/words advance (M4a, M3c), but
the learner cannot see any of it: the nav item "Errors" leads nowhere, the dashboard card "Recently
mastered" is a static placeholder, and nothing shows what is due or how a mistake is progressing.

## Decisions (owner, 2026-10-04)

1. **`/errors` is a read-only log** — no "practise now" button (practice happens in lessons).
2. **Dashboard:** an "Errors" card (due today, open errors by category as bars, link to `/errors`) and
   a "Recently mastered" card (last 5 mastered grammar topics, words and mistakes, with dates).
3. **Server-rendered pages, filters in the URL** (`/errors?status=open&category=translation`) — no new
   API route, no client state; same pattern as the dashboard and `/lesson`.
4. **"Mastered" dates are recorded from now on** via an additive `masteredAt` column; items mastered
   earlier have no date (none exist on the owner's DB).

## Data model (one additive migration)

```prisma
model GrammarTopic { /* ... */ masteredAt DateTime? } // set when status becomes MASTERED (M4a recompute)
model VocabItem    { /* ... */ masteredAt DateTime? } // set when status becomes KNOWN; cleared on demotion
model ErrorRecord  { /* ... */ masteredAt DateTime? } // set when a review answer makes it MASTERED (M4b)
```

Writers (only on the transition, never overwritten while the item stays mastered):
- `recomputeTopic` (`src/lib/curriculum/completeLesson.ts`): when the new status is `MASTERED` and the
  stored one is not → `masteredAt = completedAt` (passed in; `recomputeTopic(tx, topicId, now)`).
- vocab loop in `recordAnswer` (`src/lib/grading/recordAnswer.ts`): `KNOWN` from non-`KNOWN` → `now`;
  any non-`KNOWN` result → `null`.
- review update in `recordAnswer`: `MASTERED` from non-`MASTERED` → `now`; `REVIEWING` → `null`.

## Components

### 1. Error categories — `src/lib/errors/categories.ts` (pure)

`categoryGroup(e: { category: string; grammarTopicId: string | null }): ErrorGroup` with
`ErrorGroup = "grammar" | "translation" | "vocab" | "listening" | "writing" | "general"`:
`grammarTopicId` set → `grammar`; prefix `translation:` → `translation`; `vocab:` → `vocab`;
`listening/spelling` → `listening`; `writing:` → `writing`; otherwise `general`.
`GROUP_LABELS` (English UI labels: Grammar, Translation, Vocabulary, Listening, Writing, General).

### 2. Due label — `src/lib/errors/due.ts` (pure)

`dueLabel(nextReviewAt: Date, status, now: Date): { label: string; isDue: boolean }` - local calendar
days: `MASTERED` -> `{ "Mastered", false }`; before today -> `{ "Overdue since 27 Sep", true }`;
today -> `{ "Due today", true }`; tomorrow -> `{ "Due tomorrow", false }`; else `{ "In N days",
false }`. Dates are formatted by `formatDay` (also exported from this module), a fixed "27 Sep"
table, not `toLocaleDateString` (ICU renders en-GB September as "Sept").

### 3. Queries — `src/lib/errors/queries.ts` (injectable db, sequential)

- `listErrors(filter: { status: "open" | "mastered" | "all"; group: ErrorGroup | "all" }, now, db?)` →
  `ErrorView[]`: `{ id, title, group, examples: string[], status, correctStreak, streakTarget: 3,
  due: { label, isDue }, createdAt, attempts: { at: Date; correct: boolean }[] }`.
  `title` = grammar topic title (`title ?? name`) when `grammarTopicId`, else the category with its
  prefix humanised ("translation: meaning" → "Translation - meaning", "vocab: deadline" →
  "Word - deadline"). `examples` = description lines without "- " (up to 5). `attempts` = answered
  `Exercise` rows with this `errorRecordId`, oldest first. Order: due first, then `nextReviewAt` asc,
  then `createdAt` asc, then `id`. Group filtering is done in code after the status query (the group is
  derived), counts per group/status are returned too: `{ items, counts: { status: Record<..., number>, group: Record<..., number> } }`.
- `getErrorStats(now, db?)` → `{ dueToday: number; openByGroup: { group, count }[] }` (open = not
  `MASTERED`; due today = open with `nextReviewAt < start of tomorrow`, local; groups sorted by count
  desc, ties broken by `ERROR_GROUPS` order (not label); zero groups omitted). Returns `null` when the
  DB is unreachable (dashboard still renders, like `getStreak`).
- `getRecentlyMastered(db?, limit = 5)` → `{ kind: "grammar" | "word" | "mistake"; label: string; at: Date }[]`
  merged from the three tables (`masteredAt` not null, currently mastered), newest first, ties by
  label; `null` on DB failure.

### 4. `/errors` page — `src/app/errors/page.tsx` (server, `force-dynamic`)

Reads `searchParams` (`status`, `category`; unknown values fall back to `open` / `all`), renders the
app shell (SideNav), a heading "Mistakes", two filter rows as links (`aria-current="page"` on the
active one, counts in text), and the list. Each card: title, group label, status (icon + text:
New / Reviewing / Mastered), "2 of 3 correct in a row", due label, "First seen 26 Sep", examples
("given -> expected" lines), and "Review history" (date + Check/X icon + "correct"/"wrong" text;
"No reviews yet" when empty). Empty list → "No mistakes here yet." Semantic tokens only, ASCII text.

### 5. Dashboard — `src/app/page.tsx` + `src/components/ErrorStats.tsx`, `src/components/RecentlyMastered.tsx`

"Errors" card: "N due today" (or "Nothing due today"), bars per group with the count as text (bar
width relative to the largest group), link "See all mistakes" → `/errors`; "-" when stats are null.
"Recently mastered" card: list of up to 5 rows "label · kind · date"; empty → "Nothing mastered yet."
Loaders run sequentially after the existing ones.

## Error handling

| Situation | Behaviour |
|---|---|
| DB down on the dashboard | both new cards show "-" (no crash) |
| DB down on `/errors` | Next error boundary (same as other pages) |
| unknown filter values in the URL | fall back to `open` / `all` |
| error whose grammar topic was deleted | title falls back to the category |
| review exercise without an answer | not shown as an attempt |

## Testing (TDD)

- `categories.test.ts`, `due.test.ts` — every branch, local-day boundaries.
- `queries.test.ts` (fake db) — filters, ordering, counts, title/examples mapping, attempts, stats, recently mastered merge and order, null on failure.
- `completeLesson.test.ts`, `recordAnswer.test.ts` — `masteredAt` set on the transition only, cleared on demotion, untouched otherwise.
- `src/app/errors/page.test.tsx` — renders cards and filters from mocked queries; active filter has `aria-current`.
- `ErrorStats.test.tsx`, `RecentlyMastered.test.tsx`, dashboard test updated.
- `npx tsc --noEmit`, `npm run build`. Live: open `/errors` and the dashboard on the owner's DB (read-only).

## Out of scope

"Practise now" · charts over time · editing/deleting errors · conversation errors (M5).

## Documentation updates

`SPEC.md` §Pages (`/errors` as built, dashboard cards), §Data model (`masteredAt`); `CLAUDE.md`
(M4c ✅, M4 complete, branch `feature/m4c-errors`).
