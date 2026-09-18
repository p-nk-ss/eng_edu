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
    where: { theme: { not: null }, status: { in: ["IN_PROGRESS", "COMPLETED"] } }, // an unstarted lesson must not burn its theme
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: ROTATION_HISTORY,
    select: { theme: true },
  });
  const recentThemes = lessons.map((l) => l.theme).filter((t): t is string => t !== null);
  const preferred = profile.preferredThemes.filter((k) => THEME_KEYS.has(k));
  const theme = pickTheme(THEMES, preferred, recentThemes);

  const topics = await db.grammarTopic.findMany({
    where: { status: { not: "MASTERED" } },
    orderBy: { id: "asc" },
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
    orderBy: { id: "asc" },
  });
  const vocab = pickVocab(vocabPool, theme.key, level);

  const dueErrors = await db.errorRecord.findMany({
    where: { nextReviewAt: { lte: now }, status: { not: "MASTERED" } },
    orderBy: { nextReviewAt: "asc" },
  });

  return { profile, theme, grammarTopic, vocab, dueErrors };
}
