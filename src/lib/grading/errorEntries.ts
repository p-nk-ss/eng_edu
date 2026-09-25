import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { vocabOutcomes } from "./answerZone";
import type { ErrorEntry, JudgeOutcome, LessonGrammar } from "./types";

export const EXAMPLE_MAX = 200;
/** Collapse whitespace runs (incl. newlines) to one space and trim BEFORE the length cut - ErrorRecord examples are single-line. */
const clip = (s: string): string => {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > EXAMPLE_MAX ? oneLine.slice(0, EXAMPLE_MAX - 3) + "..." : oneLine;
};
const pretty = (category: string): string => category.replace(/_/g, " ");

/** Types whose mistakes are attributed to the lesson's grammar focus (SPEC: lesson-grained attribution). */
const FOCUS_TYPES = new Set(["mcq", "cloze_mc", "open_cloze", "error_correct", "dialogue_gap", "word_bank"]);

/** Causes of a wrong answer, one entry per cause (ErrorRecords are aggregated per lesson and cause). */
export function errorEntries(
  c: ExerciseContent,
  judged: JudgeOutcome,
  grammar: LessonGrammar | null,
  vocab: { id: string; headword: string }[],
): ErrorEntry[] {
  if (judged.isCorrect) return [];
  const firstWrong = judged.parts.find((p) => !p.correct);
  const example = firstWrong ? clip(`${firstWrong.given} -> ${firstWrong.expected}`) : "";
  const focus = (ex: string, source: ErrorEntry["source"] = "EXERCISE"): ErrorEntry => ({
    grammarTopicId: grammar!.id,
    category: grammar!.title,
    source,
    example: ex,
  });
  const other = (category: string, ex: string, source: ErrorEntry["source"] = "EXERCISE"): ErrorEntry => ({ grammarTopicId: null, category, source, example: ex });

  let entries: ErrorEntry[] = [];
  if (FOCUS_TYPES.has(c.type)) {
    if (grammar) entries = [focus(example)];
    else {
      const headwords = new Map(vocab.map((v) => [v.id, v.headword]));
      const missed = vocabOutcomes(c, judged, vocab).filter((o) => !o.correct);
      entries = missed.length ? missed.map((o) => other(`vocab: ${headwords.get(o.id)}`, example)) : [other("general", example)];
    }
  } else if (c.type === "match") {
    entries = judged.parts.flatMap((p, i) => (p.correct ? [] : [other(`vocab: ${c.left[i]}`, clip(`${p.given} -> ${p.expected}`))]));
  } else if (c.type === "dictation") {
    entries = [other("listening/spelling", example)];
  } else if (c.type === "translation") {
    const fb = judged.translation;
    const ex = clip(`${judged.parts[0]?.given ?? ""} -> ${fb?.corrected ?? c.reference}`);
    entries = [fb?.relatesToFocus && grammar ? focus(ex) : other(`translation: ${pretty(fb && fb.category !== "none" ? fb.category : "meaning")}`, ex)];
  } else if (c.type === "open_writing") {
    entries = (judged.writing?.corrections ?? [])
      .filter((k) => k.severity === "major")
      .map((k) => {
        const ex = clip(`${k.original} -> ${k.corrected}`);
        return k.relatesToFocus && grammar ? focus(ex, "WRITING") : other(`writing: ${pretty(k.category)}`, ex, "WRITING");
      });
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.grammarTopicId ?? ""}|${e.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
