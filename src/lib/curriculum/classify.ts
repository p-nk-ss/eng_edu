import { choice, type ChoiceAnswer, type ChoiceQuestion } from "../typesafe/client";
import { parseCsv } from "./csv";
import { CEFR_BANDS, wordKey, type VocabSeed } from "./parse";
import { GENERAL_DESCRIPTION, GENERAL_TOPIC, THEMES } from "./themes";

export interface TopicRow {
  headword: string;
  /** "" when the dataset has no POS — mirrors how the seed stores VocabItem.pos. */
  pos: string;
  topic: string;
  confidence: number;
  /** Jev's top choice before the confidence threshold was applied (for review). */
  rawTopic: string;
}

// Re-exported so existing `import { wordKey } from "./classify"` call sites keep working.
export { wordKey };

export const TOPIC_CRITERIA: Record<string, string> = {
  ...Object.fromEntries(THEMES.map((t) => [t.key, t.description])),
  [GENERAL_TOPIC]: GENERAL_DESCRIPTION,
};

export function buildBatch(words: VocabSeed[]) {
  const state = {
    words: words.map((v) => ({ headword: v.headword, pos: v.pos ?? "", cefr: v.cefrLevel })),
  };
  const questions: Record<string, ChoiceQuestion> = {};
  words.forEach((_, i) => {
    questions[`w${i}`] = choice(instruction(i), TOPIC_CRITERIA);
  });
  return { state, questions };
}

// String concatenation on purpose: the state path is wrapped in literal backticks (Jev's
// reference syntax), which would need escaping inside a template literal.
const instruction = (i: number): string =>
  "Consider only the English word at `words[" + i + "]`, in its most common meaning for its part of speech. " +
  "Which single theme would a vocabulary textbook file it under?";

export function resolveTopic(answer: ChoiceAnswer, threshold: number) {
  return {
    topic: answer.confidence >= threshold ? answer.choice : GENERAL_TOPIC,
    confidence: answer.confidence,
    rawTopic: answer.choice,
  };
}

/** Deterministic, evenly spaced sample of up to `perLevel` items from each CEFR band. */
export function stratifiedSample<T extends { cefrLevel: string }>(items: T[], perLevel: number): T[] {
  const out: T[] = [];
  for (const band of CEFR_BANDS) {
    const pool = items.filter((i) => i.cefrLevel === band);
    const step = Math.max(1, Math.floor(pool.length / perLevel));
    for (let i = 0, taken = 0; i < pool.length && taken < perLevel; i += step, taken++) out.push(pool[i]);
  }
  return out;
}

export function pendingWords(vocab: VocabSeed[], done: TopicRow[]): VocabSeed[] {
  const seen = new Set(done.map((r) => wordKey(r.headword, r.pos)));
  return vocab.filter((v) => !seen.has(wordKey(v.headword, v.pos)));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const TOPIC_CSV_HEADER = "headword,pos,topic,confidence,rawTopic";

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const toCsvLine = (r: TopicRow): string =>
  [esc(r.headword), esc(r.pos), r.topic, r.confidence.toFixed(3), r.rawTopic].join(",");

export function parseTopicRows(csvText: string): TopicRow[] {
  return parseCsv(csvText)
    .slice(1)
    .filter((r) => (r[0] ?? "") !== "")
    .map((r) => ({
      headword: r[0],
      pos: r[1] ?? "",
      topic: r[2],
      confidence: Number(r[3]),
      rawTopic: r[4] ?? r[2],
    }));
}

export function sortTopicRows(rows: TopicRow[]): TopicRow[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...rows].sort((a, b) => cmp(a.headword, b.headword) || cmp(a.pos, b.pos));
}

/**
 * Parse a `--name value` numeric flag out of argv. Returns `fallback` when the flag is absent;
 * throws a clear Error when the flag is present but its value is missing, not a finite number,
 * or fails the given constraints — never returns NaN.
 */
export function parseNumberFlag(
  args: readonly string[],
  name: string,
  fallback: number,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const raw = args[i + 1];
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value)) {
    throw new Error(`${name} expects a number, got ${JSON.stringify(raw ?? "")}`);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got ${raw}`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Error(`${name} must be >= ${opts.min}, got ${value}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Error(`${name} must be <= ${opts.max}, got ${value}`);
  }
  return value;
}
