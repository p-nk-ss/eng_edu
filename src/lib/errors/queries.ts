import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { REVIEW_MASTERED_STREAK } from "../review/schedule";
import { ERROR_GROUPS, type ErrorGroup, GROUP_LABELS, categoryGroup, errorTitle } from "./categories";
import { dueLabel, startOfTomorrow } from "./due";

export type StatusFilter = "open" | "mastered" | "all";
export type GroupFilter = ErrorGroup | "all";

export interface ErrorView {
  id: string;
  title: string;
  group: ErrorGroup;
  examples: string[];
  status: string;
  correctStreak: number;
  streakTarget: number;
  due: { label: string; isDue: boolean };
  createdAt: Date;
  attempts: { at: Date; correct: boolean }[];
}

export type ErrorsDb = Pick<PrismaClient, "errorRecord" | "grammarTopic" | "exercise" | "vocabItem">;

const defaultDb = () => prisma as unknown as ErrorsDb;

type ErrorRow = {
  id: string;
  category: string;
  grammarTopicId: string | null;
  description: string;
  status: string;
  correctStreak: number;
  nextReviewAt: Date;
  createdAt: Date;
};

/** Prisma `where` for the items query; `undefined` ("all") means no status filter. */
function statusWhere(filter: StatusFilter): { status: "MASTERED" | { not: "MASTERED" } } | undefined {
  if (filter === "open") return { status: { not: "MASTERED" } };
  if (filter === "mastered") return { status: "MASTERED" };
  return undefined;
}

/** Last up-to-5 "given -> expected" lines of `description`, stripped of the leading "- ". */
function examplesOf(description: string): string[] {
  return description
    .split("\n")
    .map((line) => line.replace(/^- /, ""))
    .slice(-5);
}

/**
 * The errors log: items for the given status/group filter plus counts for every filter value, so
 * the page can render filter links without a second round trip. `counts.status` is over ALL errors
 * (independent of the requested filter); `counts.group` is over errors matching the status filter
 * only (the group filter is applied afterwards, in code).
 */
export async function listErrors(
  filter: { status: StatusFilter; group: GroupFilter },
  now: Date,
  db: ErrorsDb = defaultDb(),
): Promise<{ items: ErrorView[]; counts: { status: Record<StatusFilter, number>; group: Record<GroupFilter, number> } }> {
  const statusRows = (await db.errorRecord.findMany({ select: { status: true } })) as { status: string }[];
  const counts: { status: Record<StatusFilter, number>; group: Record<GroupFilter, number> } = {
    status: {
      open: statusRows.filter((r) => r.status !== "MASTERED").length,
      mastered: statusRows.filter((r) => r.status === "MASTERED").length,
      all: statusRows.length,
    },
    group: { all: 0, grammar: 0, translation: 0, vocab: 0, listening: 0, writing: 0, general: 0 },
  };

  const rows = (await db.errorRecord.findMany({
    where: statusWhere(filter.status),
    select: {
      id: true,
      category: true,
      grammarTopicId: true,
      description: true,
      status: true,
      correctStreak: true,
      nextReviewAt: true,
      createdAt: true,
    },
    orderBy: [{ nextReviewAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  })) as ErrorRow[];

  const topicIds = Array.from(new Set(rows.flatMap((r) => (r.grammarTopicId ? [r.grammarTopicId] : []))));
  const topics = topicIds.length
    ? ((await db.grammarTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, name: true } })) as {
        id: string;
        title: string | null;
        name: string;
      }[])
    : [];
  const topicTitleById = new Map(topics.map((t) => [t.id, t.title ?? t.name]));

  const ids = rows.map((r) => r.id);
  const exerciseRows = ids.length
    ? ((await db.exercise.findMany({
        where: { errorRecordId: { in: ids }, answeredAt: { not: null } },
        select: { errorRecordId: true, answeredAt: true, isCorrect: true },
        orderBy: { answeredAt: "asc" },
      })) as { errorRecordId: string | null; answeredAt: Date | null; isCorrect: boolean | null }[])
    : [];

  const attemptsById = new Map<string, { at: Date; correct: boolean }[]>();
  for (const ex of exerciseRows) {
    if (!ex.errorRecordId || !ex.answeredAt) continue;
    const list = attemptsById.get(ex.errorRecordId) ?? [];
    list.push({ at: ex.answeredAt, correct: ex.isCorrect ?? false });
    attemptsById.set(ex.errorRecordId, list);
  }

  const views: ErrorView[] = rows.map((r) => {
    const topicTitle = r.grammarTopicId ? topicTitleById.get(r.grammarTopicId) ?? null : null;
    return {
      id: r.id,
      title: errorTitle(r, topicTitle),
      group: categoryGroup(r),
      examples: examplesOf(r.description),
      status: r.status,
      correctStreak: r.correctStreak,
      streakTarget: REVIEW_MASTERED_STREAK,
      due: dueLabel(r.nextReviewAt, r.status, now),
      createdAt: r.createdAt,
      attempts: attemptsById.get(r.id) ?? [],
    };
  });

  // Due items first; ties keep the DB order (nextReviewAt, createdAt, id asc) - Array#sort is stable.
  views.sort((a, b) => Number(b.due.isDue) - Number(a.due.isDue));

  counts.group.all = views.length;
  for (const v of views) counts.group[v.group]++;

  const items = filter.group === "all" ? views : views.filter((v) => v.group === filter.group);

  return { items, counts };
}

/** Dashboard "Errors" card data; `null` when the DB is unreachable (the dashboard still renders). */
export async function getErrorStats(
  now: Date,
  db: ErrorsDb = defaultDb(),
): Promise<{ dueToday: number; openByGroup: { group: ErrorGroup; label: string; count: number }[] } | null> {
  try {
    const rows = (await db.errorRecord.findMany({
      where: { status: { not: "MASTERED" } },
      select: { category: true, grammarTopicId: true, nextReviewAt: true },
    })) as { category: string; grammarTopicId: string | null; nextReviewAt: Date }[];

    const tomorrow = startOfTomorrow(now).getTime();
    const dueToday = rows.filter((r) => r.nextReviewAt.getTime() < tomorrow).length;

    const countByGroup = new Map<ErrorGroup, number>();
    for (const r of rows) {
      const group = categoryGroup(r);
      countByGroup.set(group, (countByGroup.get(group) ?? 0) + 1);
    }
    const openByGroup = ERROR_GROUPS.filter((g) => (countByGroup.get(g) ?? 0) > 0)
      .map((group) => ({ group, label: GROUP_LABELS[group], count: countByGroup.get(group) as number }))
      .sort((a, b) => b.count - a.count || ERROR_GROUPS.indexOf(a.group) - ERROR_GROUPS.indexOf(b.group));

    return { dueToday, openByGroup };
  } catch {
    return null;
  }
}

/** Dashboard "Recently mastered" card data; `null` when the DB is unreachable. */
export async function getRecentlyMastered(
  db: ErrorsDb = defaultDb(),
  limit = 5,
): Promise<{ kind: "grammar" | "word" | "mistake"; label: string; at: Date }[] | null> {
  try {
    const topics = (await db.grammarTopic.findMany({
      where: { status: "MASTERED", masteredAt: { not: null } },
      select: { title: true, name: true, masteredAt: true },
      orderBy: { masteredAt: "desc" },
      take: limit,
    })) as { title: string | null; name: string; masteredAt: Date | null }[];

    const words = (await db.vocabItem.findMany({
      where: { status: "KNOWN", masteredAt: { not: null } },
      select: { headword: true, masteredAt: true },
      orderBy: { masteredAt: "desc" },
      take: limit,
    })) as { headword: string; masteredAt: Date | null }[];

    const errors = (await db.errorRecord.findMany({
      where: { status: "MASTERED", masteredAt: { not: null } },
      select: { category: true, grammarTopicId: true, masteredAt: true },
      orderBy: { masteredAt: "desc" },
      take: limit,
    })) as { category: string; grammarTopicId: string | null; masteredAt: Date | null }[];

    const merged = [
      ...topics.flatMap((t) => (t.masteredAt ? [{ kind: "grammar" as const, label: t.title ?? t.name, at: t.masteredAt }] : [])),
      ...words.flatMap((w) => (w.masteredAt ? [{ kind: "word" as const, label: w.headword, at: w.masteredAt }] : [])),
      ...errors.flatMap((e) => (e.masteredAt ? [{ kind: "mistake" as const, label: errorTitle(e, null), at: e.masteredAt }] : [])),
    ];

    merged.sort((a, b) => b.at.getTime() - a.at.getTime() || a.label.localeCompare(b.label));
    return merged.slice(0, limit);
  } catch {
    return null;
  }
}
