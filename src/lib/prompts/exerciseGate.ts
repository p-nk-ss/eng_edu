import type { ExerciseContent } from "../lesson/exerciseSchemas";
import { noul, type Json, type NoulQuestion } from "../typesafe/client";

/** Drop only on a CONFIDENT failure; anything in between keeps the exercise. */
export const GATE_THRESHOLDS = { keyCorrectMax: 0.2, otherCorrectMin: 0.8, onFocusMax: 0.2 } as const;

export interface GateGrammar {
  title: string;
  description: string;
}

const GATED = new Set(["mcq", "cloze_mc", "dialogue_gap", "error_correct", "open_cloze"]);
export const isGated = (c: ExerciseContent): boolean => GATED.has(c.type);

const fill = (text: string, values: string[]): string => {
  let i = 0;
  return text.replace(/___/g, () => values[i++] ?? "___");
};

/** One exercise as plain facts for Jev (one evaluated object per request - never batch). */
export function gateState(c: ExerciseContent, grammar: GateGrammar | null): Json {
  const grammar_focus = grammar ? { title: grammar.title, description: grammar.description } : null;
  switch (c.type) {
    case "mcq":
      return {
        sentence: c.prompt.includes("___") ? fill(c.prompt, [c.options[c.answer]]) : `${c.prompt} -> ${c.options[c.answer]}`,
        keyed_answer: c.options[c.answer],
        other_options: c.options.filter((_, i) => i !== c.answer),
        grammar_focus,
      };
    case "cloze_mc":
      return {
        sentence: fill(c.text, c.gaps.map((g) => g.options[g.answer])),
        keyed_answer: c.gaps.map((g) => g.options[g.answer]),
        other_options: c.gaps.map((g) => g.options.filter((_, i) => i !== g.answer)),
        grammar_focus,
      };
    case "dialogue_gap":
      return {
        sentence: c.turns.map((t) => fill(t, [c.options[c.answer]])).join(" / "),
        keyed_answer: c.options[c.answer],
        other_options: c.options.filter((_, i) => i !== c.answer),
        grammar_focus,
      };
    case "error_correct":
      return {
        sentence: c.tokens.map((t, i) => (i === c.answer ? c.accept[0] : t)).join(" "),
        original: c.tokens.join(" "),
        keyed_answer: c.accept[0],
        grammar_focus,
      };
    case "open_cloze":
      return { sentence: fill(c.text, c.gaps.map((g) => g.accept[0])), keyed_answer: c.gaps.map((g) => g.accept[0]), grammar_focus };
    default:
      return { grammar_focus };
  }
}

const KEY_CORRECT = noul(
  "An English exercise for a learner has an answer key. `sentence` shows the exercise with the keyed answer filled in. Is `sentence` correct, natural standard English?",
  { true: "`sentence` is grammatically correct and natural; a teacher would accept it.", false: "`sentence` contains a grammar, word-choice or word-form error, or sounds clearly unnatural." },
);
const OTHER_CORRECT = noul(
  "`other_options` lists the options the answer key marks as WRONG (per gap, in order). Would at least one of them ALSO produce fully correct, natural English if it replaced the keyed answer in `sentence`?",
  { true: "At least one supposedly wrong option is also fully correct in its gap - the exercise has two right answers.", false: "Every other option makes the sentence wrong or clearly unnatural." },
);
const ORIGINAL_CORRECT = noul(
  "This is an error-correction exercise. `original` is the sentence the learner is told contains one error. Is `original` already fully correct standard English?",
  { true: "`original` is already correct - there is no real error to find.", false: "`original` contains a genuine error." },
);
const ON_FOCUS = noul(
  "`grammar_focus` names the grammar point this lesson teaches. Does `sentence` use or test that grammar point?",
  { true: "The sentence clearly uses or tests the grammar point in `grammar_focus`.", false: "The sentence has nothing to do with the grammar point in `grammar_focus`." },
);

export function gateQuestions(c: ExerciseContent, grammar: GateGrammar | null): Record<string, NoulQuestion> {
  const q: Record<string, NoulQuestion> = { key_correct: KEY_CORRECT };
  if (c.type === "error_correct") q.other_correct = ORIGINAL_CORRECT;
  else if (c.type !== "open_cloze") q.other_correct = OTHER_CORRECT;
  if (grammar) q.on_focus = ON_FOCUS;
  return q;
}

/** A drop reason, or null to keep the exercise. Missing scores never cause a drop. */
export function gateVerdict(scores: Record<string, number>): string | null {
  if (scores.key_correct !== undefined && scores.key_correct <= GATE_THRESHOLDS.keyCorrectMax) {
    return `gate: the keyed answer looks wrong (key_correct ${scores.key_correct.toFixed(2)})`;
  }
  if (scores.other_correct !== undefined && scores.other_correct >= GATE_THRESHOLDS.otherCorrectMin) {
    return `gate: another option also looks correct (other_correct ${scores.other_correct.toFixed(2)})`;
  }
  if (scores.on_focus !== undefined && scores.on_focus <= GATE_THRESHOLDS.onFocusMax) {
    return `gate: does not practise the grammar focus (on_focus ${scores.on_focus.toFixed(2)})`;
  }
  return null;
}
