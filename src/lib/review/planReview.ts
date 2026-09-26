import type { ExerciseTypeName } from "../lesson/exerciseSchemas";

export const MAX_REVIEW = 3;
const EXAMPLES = 3;

export interface DueError {
  id: string;
  category: string;
  grammarTopicId: string | null;
  description: string;
  nextReviewAt: Date;
  createdAt: Date;
}

export interface ReviewItem {
  errorId: string;
  type: ExerciseTypeName;
  category: string;
  grammarTitle: string | null;
  examples: string[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function typeFor(e: DueError, grammarIndex: number): ExerciseTypeName {
  if (e.grammarTopicId) return grammarIndex % 2 === 0 ? "FILL_BLANK" : "ERROR_CORRECTION";
  if (e.category.startsWith("translation:")) return "TRANSLATION";
  if (e.category === "listening/spelling") return "DICTATION";
  if (e.category.startsWith("writing:")) return "ERROR_CORRECTION";
  return "MULTIPLE_CHOICE";
}

/** Which due errors the next lesson reviews (most overdue first) and with which exercise type. */
export function planReview(due: DueError[], grammarTitles: Map<string, string>): ReviewItem[] {
  const picked = [...due]
    .sort(
      (a, b) =>
        a.nextReviewAt.getTime() - b.nextReviewAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        cmp(a.id, b.id),
    )
    .slice(0, MAX_REVIEW);
  let grammarIndex = 0;
  return picked.map((e) => {
    const type = typeFor(e, grammarIndex);
    if (e.grammarTopicId) grammarIndex++;
    return {
      errorId: e.id,
      type,
      category: e.category,
      grammarTitle: e.grammarTopicId ? (grammarTitles.get(e.grammarTopicId) ?? null) : null,
      examples: e.description
        .split("\n")
        .map((l) => l.replace(/^- /, "").trim())
        .filter(Boolean)
        .slice(-EXAMPLES),
    };
  });
}
