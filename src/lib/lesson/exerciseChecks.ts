import type { ExerciseContent } from "./exerciseSchemas";

/**
 * SPEC normalization contract for typed answers: straighten quotes -> trim -> collapse
 * whitespace -> lowercase -> strip leading/trailing punctuation. Reused by the M3c graders.
 */
export function normalizeAnswer(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/** normalizeAnswer + every punctuation mark except the apostrophe removed (dictation comparison). */
export function normalizeLoose(s: string): string {
  return normalizeAnswer(s)
    .replace(/[^\p{L}\p{N}'\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const stem = (w: string): string => (w.length >= 4 && /[ey]$/.test(w) ? w.slice(0, -1) : w); // make -> mak(ing), study -> stud(ied)
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];

/** Does `headword` (possibly "a/b" alternatives or several words) occur in `text`, inflection-tolerantly? */
export function headwordOccurs(headword: string, text: string): boolean {
  const words = wordsOf(text);
  return headword.split("/").some((alt) => {
    const stems = wordsOf(alt).map(stem);
    if (stems.length === 0) return false;
    for (let i = 0; i + stems.length <= words.length; i++) {
      if (stems.every((s, k) => words[i + k].startsWith(s))) return true;
    }
    return false;
  });
}

export interface CheckContext {
  vocab: { id: string; headword: string }[];
}

const gapCount = (s: string): number => (s.match(/___/g) ?? []).length;

/** English text a learner sees or produces — where a target headword must appear. */
function englishText(c: ExerciseContent): string {
  switch (c.type) {
    case "mcq": return [c.prompt, ...c.options].join(" ");
    case "cloze_mc": return [c.text, ...c.gaps.flatMap((g) => g.options)].join(" ");
    case "open_cloze": return [c.text, ...c.gaps.flatMap((g) => [g.root ?? "", ...g.accept])].join(" ");
    case "word_bank": return c.tokens.join(" ");
    case "match": return [...c.left, ...c.right].join(" ");
    case "dialogue_gap": return [...c.turns, ...c.options].join(" ");
    case "dictation": return c.tts;
    case "error_correct": return [...c.tokens, ...c.accept].join(" ");
    case "translation": return [c.reference, c.hint ?? ""].join(" ");
    case "open_writing": return [c.prompt, c.hint ?? ""].join(" ");
  }
}

function isSubMultiset(part: string[], whole: string[]): string | null {
  const left = new Map<string, number>();
  for (const t of whole) left.set(t, (left.get(t) ?? 0) + 1);
  for (const t of part) {
    const n = left.get(t) ?? 0;
    if (n === 0) return t;
    left.set(t, n - 1);
  }
  return null;
}

/** Cross-field rules zod cannot express. Returns human-readable problems; [] means the exercise is fine. */
export function checkExercise(c: ExerciseContent, _ctx: CheckContext): string[] {
  const problems: string[] = [];
  const inRange = (answer: number, options: unknown[], label: string) => {
    if (answer >= options.length) problems.push(`${label}: answer index ${answer} is outside ${options.length} options`);
  };
  const nonEmptyAccept = (accept: string[], label: string) => {
    if (accept.some((a) => normalizeAnswer(a) === "")) problems.push(`${label}: an accept entry is empty after normalization`);
  };
  /** Options identical after normalizeAnswer are a defect: index-based grading would mark the twin wrong. */
  const noDuplicateOptions = (options: string[], label: string) => {
    const seen = new Set<string>();
    for (const o of options) {
      const norm = normalizeAnswer(o);
      if (seen.has(norm)) {
        problems.push(`${label}: duplicate option "${o}"`);
        return;
      }
      seen.add(norm);
    }
  };

  switch (c.type) {
    case "mcq":
      inRange(c.answer, c.options, "mcq");
      if (c.rationales.length !== c.options.length) problems.push("mcq: rationales must have one entry per option");
      noDuplicateOptions(c.options, "mcq");
      break;
    case "cloze_mc":
      if (gapCount(c.text) !== c.gaps.length) problems.push(`cloze_mc: text has ${gapCount(c.text)} ___ markers for ${c.gaps.length} gaps`);
      c.gaps.forEach((g, i) => {
        inRange(g.answer, g.options, `cloze_mc gap ${i + 1}`);
        noDuplicateOptions(g.options, `cloze_mc gap ${i + 1}`);
      });
      break;
    case "open_cloze":
      if (gapCount(c.text) !== c.gaps.length) problems.push(`open_cloze: text has ${gapCount(c.text)} ___ markers for ${c.gaps.length} gaps`);
      c.gaps.forEach((g, i) => nonEmptyAccept(g.accept, `open_cloze gap ${i + 1}`));
      break;
    case "word_bank": {
      const missing = isSubMultiset(c.answer, c.tokens);
      if (missing !== null) problems.push(`word_bank: answer token "${missing}" is not available in tokens`);
      c.accept_alt.forEach((alt, i) => {
        const m = isSubMultiset(alt, c.tokens);
        if (m !== null) problems.push(`word_bank: accept_alt ${i + 1} uses "${m}" more often than tokens allow`);
      });
      break;
    }
    case "match": {
      if (c.left.length !== c.right.length || c.answer.length !== c.left.length) {
        problems.push("match: left, right and answer must have the same length");
      } else if ([...c.answer].sort((a, b) => a - b).some((v, i) => v !== i)) {
        problems.push("match: answer must be a permutation of the right column indexes");
      }
      noDuplicateOptions(c.right, "match");
      break;
    }
    case "dialogue_gap":
      inRange(c.answer, c.options, "dialogue_gap");
      if (c.turns.filter((t) => t.includes("___")).length !== 1) problems.push("dialogue_gap: exactly one turn must contain ___");
      noDuplicateOptions(c.options, "dialogue_gap");
      break;
    case "dictation":
      nonEmptyAccept(c.accept, "dictation");
      if (!c.accept.some((a) => normalizeLoose(a) === normalizeLoose(c.tts))) problems.push("dictation: the tts sentence itself is not in accept");
      break;
    case "error_correct":
      if (c.answer >= c.tokens.length) {
        problems.push(`error_correct: answer index ${c.answer} is outside ${c.tokens.length} tokens`);
      } else if (c.accept.some((a) => normalizeAnswer(a) === normalizeAnswer(c.tokens[c.answer]))) {
        problems.push("error_correct: an accepted fix is the same as the wrong token");
      }
      nonEmptyAccept(c.accept, "error_correct");
      break;
    case "translation":
    case "open_writing":
      break;
  }

  return problems;
}

/**
 * Vocab attribution is a heuristic, not a gate: ids that are unknown or whose headword
 * is not found in the exercise's English text (stem-prefix match; irregular forms such
 * as go/went are NOT recognised) are removed from `vocab` with a note. The exercise itself
 * is never dropped for this. Returns a new content object (never mutates the input).
 */
export function pruneVocab<T extends ExerciseContent>(content: T, ctx: CheckContext): { content: T; removed: string[] } {
  const byId = new Map(ctx.vocab.map((v) => [v.id, v.headword]));
  const text = englishText(content);
  const kept: string[] = [];
  const removed: string[] = [];

  for (const id of content.vocab) {
    const headword = byId.get(id);
    if (headword === undefined) {
      removed.push(`vocab: id "${id}" is not one of this lesson's target words`);
    } else if (!headwordOccurs(headword, text)) {
      removed.push(`vocab: target word "${headword}" does not appear in the exercise - removed from vocab`);
    } else {
      kept.push(id);
    }
  }

  if (removed.length === 0) {
    return { content, removed: [] };
  }
  return { content: { ...content, vocab: kept } as T, removed };
}
