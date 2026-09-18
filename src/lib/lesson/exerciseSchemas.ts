import { z } from "zod";

/** Mirrors the Prisma `ExerciseType` enum (kept as strings so this module stays Prisma-free). */
export const EXERCISE_TYPES = [
  "MULTIPLE_CHOICE", "CLOZE_DROPDOWN", "FILL_BLANK", "WORD_BANK", "MATCH",
  "DIALOGUE_GAP", "DICTATION", "ERROR_CORRECTION", "TRANSLATION", "OPEN_WRITING",
] as const;
export type ExerciseTypeName = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_TYPE_TAGS: Record<ExerciseTypeName, string> = {
  MULTIPLE_CHOICE: "mcq",
  CLOZE_DROPDOWN: "cloze_mc",
  FILL_BLANK: "open_cloze",
  WORD_BANK: "word_bank",
  MATCH: "match",
  DIALOGUE_GAP: "dialogue_gap",
  DICTATION: "dictation",
  ERROR_CORRECTION: "error_correct",
  TRANSLATION: "translation",
  OPEN_WRITING: "open_writing",
};

const TAG_TO_TYPE = new Map(EXERCISE_TYPES.map((t) => [EXERCISE_TYPE_TAGS[t], t] as const));
export const typeForTag = (tag: string): ExerciseTypeName | undefined => TAG_TO_TYPE.get(tag);

export const EXPLAIN_LIMITS = { min: 10, max: 400 } as const;

const text = z.string().min(1);
const base = {
  explain: z.string().min(EXPLAIN_LIMITS.min).max(EXPLAIN_LIMITS.max),
  /** ids of the target VocabItems this exercise practises (drives vocab streaks in M3c). */
  vocab: z.array(z.string()).default([]),
};
const choice = { options: z.array(text).min(2).max(4), answer: z.number().int().min(0) };

const mcq = z.object({
  type: z.literal("mcq"), prompt: z.string().min(5),
  options: z.array(text).min(3).max(5), answer: z.number().int().min(0),
  rationales: z.array(z.string()), ...base,
});
const clozeMc = z.object({
  type: z.literal("cloze_mc"), text: z.string().min(5),
  gaps: z.array(z.object(choice)).min(1).max(4), ...base,
});
const openCloze = z.object({
  type: z.literal("open_cloze"), text: z.string().min(5),
  gaps: z.array(z.object({ root: z.string().optional(), accept: z.array(text).min(1) })).min(1).max(3), ...base,
});
const wordBank = z.object({
  type: z.literal("word_bank"), tokens: z.array(text).min(3), answer: z.array(text).min(3),
  accept_alt: z.array(z.array(text)).default([]), ...base,
});
const match = z.object({
  type: z.literal("match"), left: z.array(text).min(3).max(6), right: z.array(text).min(3).max(6),
  answer: z.array(z.number().int().min(0)), ...base,
});
const dialogueGap = z.object({
  type: z.literal("dialogue_gap"), turns: z.array(text).min(2), ...choice, ...base,
});
const dictation = z.object({
  type: z.literal("dictation"), tts: z.string().min(3), accept: z.array(text).min(1), ...base,
});
const errorCorrect = z.object({
  type: z.literal("error_correct"), tokens: z.array(text).min(3),
  answer: z.number().int().min(0), accept: z.array(text).min(1), ...base,
});
const translation = z.object({
  type: z.literal("translation"), source: z.string().min(3), reference: z.string().min(3),
  hint: z.string().optional(), ...base,
});
const openWriting = z.object({
  type: z.literal("open_writing"), prompt: z.string().min(10),
  minWords: z.number().int().min(30).max(120), hint: z.string().optional(), ...base,
});

export const exerciseContentSchema = z.discriminatedUnion("type", [
  mcq, clozeMc, openCloze, wordBank, match, dialogueGap, dictation, errorCorrect, translation, openWriting,
]);
export type ExerciseContent = z.infer<typeof exerciseContentSchema>;

export type ParsedExercise =
  | { ok: true; type: ExerciseTypeName; content: ExerciseContent }
  | { ok: false; reason: string };

/** Validate one generated exercise. Never throws — a bad exercise is dropped, not the lesson. */
export function parseExercise(raw: unknown): ParsedExercise {
  const res = exerciseContentSchema.safeParse(raw);
  if (!res.success) {
    const reason = res.error.issues.map((i) => `${i.path.join(".") || "type"}: ${i.message}`).join("; ");
    return { ok: false, reason };
  }
  const type = typeForTag(res.data.type);
  if (!type) return { ok: false, reason: `type: unknown tag "${res.data.type}"` };
  return { ok: true, type, content: res.data };
}
