import { prisma } from "@/lib/db";
import { CEFR_BANDS } from "./parse";

export interface SyllabusLevel {
  level: string;
  grammarTotal: number;
  grammarMastered: number;
  vocabTotal: number;
  vocabKnown: number;
}

interface LevelStatus {
  cefrLevel: string;
  status: string;
}

/** Pure aggregation: fold grammar/vocab rows into per-CEFR-level progress. */
export function summarizeSyllabus(
  grammar: LevelStatus[],
  vocab: LevelStatus[],
): SyllabusLevel[] {
  const map = new Map<string, SyllabusLevel>();
  const at = (level: string): SyllabusLevel => {
    let e = map.get(level);
    if (!e) {
      e = { level, grammarTotal: 0, grammarMastered: 0, vocabTotal: 0, vocabKnown: 0 };
      map.set(level, e);
    }
    return e;
  };

  for (const g of grammar) {
    const e = at(g.cefrLevel);
    e.grammarTotal++;
    if (g.status === "MASTERED") e.grammarMastered++;
  }
  for (const v of vocab) {
    const e = at(v.cefrLevel);
    e.vocabTotal++;
    if (v.status === "KNOWN") e.vocabKnown++;
  }

  return CEFR_BANDS.filter((l) => map.has(l)).map((l) => map.get(l)!);
}

/** Load per-level syllabus progress from the DB. Returns null if the DB is unreachable/unseeded. */
export async function getSyllabusProgress(): Promise<SyllabusLevel[] | null> {
  try {
    const [grammar, vocab] = await Promise.all([
      prisma.grammarTopic.findMany({ select: { cefrLevel: true, status: true } }),
      prisma.vocabItem.findMany({ select: { cefrLevel: true, status: true } }),
    ]);
    if (grammar.length === 0 && vocab.length === 0) return null;
    return summarizeSyllabus(grammar, vocab);
  } catch {
    return null; // DB not set up yet / unreachable — dashboard shows an empty state
  }
}
