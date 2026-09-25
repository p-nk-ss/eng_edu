import type { ExerciseContent } from "./exerciseSchemas";
import { seededPermutation } from "./shuffle";

/** What the browser may see BEFORE answering: no keys, rationales, explanations or references. */
export type ExerciseView =
  | { id: string; type: "mcq"; prompt: string; options: string[] }
  | { id: string; type: "dialogue_gap"; turns: string[]; options: string[] }
  | { id: string; type: "cloze_mc"; text: string; gaps: { options: string[] }[] }
  | { id: string; type: "open_cloze"; text: string; gaps: { root: string | null }[] }
  | { id: string; type: "word_bank"; tiles: string[] }
  | { id: string; type: "match"; left: string[]; right: string[]; rightOrder: number[] }
  | { id: string; type: "dictation"; tts: string }
  | { id: string; type: "error_correct"; tokens: string[] }
  | { id: string; type: "translation"; source: string; hint: string | null }
  | { id: string; type: "open_writing"; prompt: string; minWords: number; hint: string | null };

export type ViewOf<T extends ExerciseView["type"]> = Extract<ExerciseView, { type: T }>;

export const TYPE_LABELS: Record<ExerciseView["type"], string> = {
  mcq: "Choose the answer",
  dialogue_gap: "Complete the dialogue",
  cloze_mc: "Choose the words",
  open_cloze: "Fill in the gaps",
  word_bank: "Build the sentence",
  match: "Match the pairs",
  dictation: "Listen and type",
  error_correct: "Find and fix the mistake",
  translation: "Translate",
  open_writing: "Write",
};

/** A short, secret-free description of an exercise for the results list (never a dictation's spoken sentence). */
export function viewExcerpt(view: ExerciseView, max = 80): string {
  const raw = ((): string => {
    switch (view.type) {
      case "mcq":
        return view.prompt;
      case "dialogue_gap":
        return view.turns.find((t) => t.includes("___")) ?? view.turns[view.turns.length - 1] ?? "";
      case "cloze_mc":
      case "open_cloze":
        return view.text;
      case "word_bank":
        return `${view.tiles.length} words`;
      case "match":
        return view.left.join(", ");
      case "dictation":
        return "Listening";
      case "error_correct":
        return view.tokens.join(" ");
      case "translation":
        return view.source;
      case "open_writing":
        return view.prompt;
    }
  })();
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function toExerciseView(id: string, c: ExerciseContent): ExerciseView {
  switch (c.type) {
    case "mcq":
      return { id, type: "mcq", prompt: c.prompt, options: c.options };
    case "dialogue_gap":
      return { id, type: "dialogue_gap", turns: c.turns, options: c.options };
    case "cloze_mc":
      return { id, type: "cloze_mc", text: c.text, gaps: c.gaps.map((g) => ({ options: g.options })) };
    case "open_cloze":
      return { id, type: "open_cloze", text: c.text, gaps: c.gaps.map((g) => ({ root: g.root ?? null })) };
    case "word_bank":
      return { id, type: "word_bank", tiles: seededPermutation(id, c.tokens.length).map((k) => c.tokens[k]) };
    case "match": {
      const rightOrder = seededPermutation(id, c.right.length);
      return { id, type: "match", left: c.left, right: rightOrder.map((k) => c.right[k]), rightOrder };
    }
    case "dictation":
      return { id, type: "dictation", tts: c.tts };
    case "error_correct":
      return { id, type: "error_correct", tokens: c.tokens };
    case "translation":
      return { id, type: "translation", source: c.source, hint: c.hint ?? null };
    case "open_writing":
      return { id, type: "open_writing", prompt: c.prompt, minWords: c.minWords, hint: c.hint ?? null };
  }
}
