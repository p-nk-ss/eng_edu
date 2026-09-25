import { z } from "zod";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { Answer } from "./types";

const index = z.number().int().min(0);
const typed = z.string().max(2000);
const freeText = typed.min(1);

const SHAPES = {
  mcq: z.object({ selected: index }),
  dialogue_gap: z.object({ selected: index }),
  cloze_mc: z.object({ selected: z.array(index) }),
  open_cloze: z.object({ text: z.array(typed) }),
  word_bank: z.object({ tokens: z.array(z.string().max(100)).max(40) }),
  match: z.object({ pairs: z.array(index) }),
  dictation: z.object({ text: freeText }),
  translation: z.object({ text: freeText }),
  open_writing: z.object({ text: freeText }),
  error_correct: z.object({ index, fix: z.string().max(200) }),
} as const;

export type ParsedAnswer = { ok: true; answer: Answer } | { ok: false; reason: string };

/** Validate a learner answer against its exercise. A malformed answer is never a learner mistake. */
export function parseAnswer(content: ExerciseContent, raw: unknown): ParsedAnswer {
  const res = SHAPES[content.type].safeParse(raw);
  if (!res.success) {
    return { ok: false, reason: res.error.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`).join("; ") };
  }
  const answer = { type: content.type, ...res.data } as Answer;
  const problem = fitProblem(content, answer);
  return problem ? { ok: false, reason: problem } : { ok: true, answer };
}

const within = (i: number, n: number) => i < n;

function fitProblem(c: ExerciseContent, a: Answer): string | null {
  if ((c.type === "mcq" || c.type === "dialogue_gap") && "selected" in a && typeof a.selected === "number") {
    return within(a.selected, c.options.length) ? null : `selected: ${a.selected} is not one of ${c.options.length} options`;
  }
  if (c.type === "cloze_mc" && a.type === "cloze_mc") {
    if (a.selected.length !== c.gaps.length) return `selected: expected ${c.gaps.length} answers, got ${a.selected.length}`;
    const bad = a.selected.findIndex((s, i) => !within(s, c.gaps[i].options.length));
    return bad === -1 ? null : `selected.${bad}: out of range`;
  }
  if (c.type === "open_cloze" && a.type === "open_cloze") {
    return a.text.length === c.gaps.length ? null : `text: expected ${c.gaps.length} answers, got ${a.text.length}`;
  }
  if (c.type === "match" && a.type === "match") {
    if (a.pairs.length !== c.left.length) return `pairs: expected ${c.left.length} pairs, got ${a.pairs.length}`;
    const bad = a.pairs.findIndex((p) => !within(p, c.right.length));
    return bad === -1 ? null : `pairs.${bad}: out of range`;
  }
  if (c.type === "error_correct" && a.type === "error_correct") {
    return within(a.index, c.tokens.length) ? null : `index: ${a.index} is not one of ${c.tokens.length} tokens`;
  }
  return null;
}
