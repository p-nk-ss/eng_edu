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
