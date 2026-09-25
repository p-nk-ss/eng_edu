import { normalizeAnswer, normalizeLoose } from "../lesson/exerciseChecks";
import type { ExerciseContent } from "../lesson/exerciseSchemas";
import type { Answer, AnswerOf, GradePart, LocalGrade, VariantCandidate } from "./types";

const fill = (text: string, values: string[]): string => {
  let i = 0;
  return text.replace(/___/g, () => values[i++] ?? "___");
};

const matches = (given: string, accept: string[], norm: (s: string) => string): boolean => {
  const g = norm(given);
  return g !== "" && accept.some((x) => norm(x) === g);
};

const done = (parts: GradePart[], correctAnswer: string, variantCandidates: VariantCandidate[] = []): LocalGrade => ({
  isCorrect: parts.every((p) => p.correct),
  parts,
  correctAnswer,
  variantCandidates,
  needsJudge: null,
});

/** Pure local grading against the keys generated with the lesson. */
export function gradeLocally(c: ExerciseContent, answer: Answer): LocalGrade {
  if (c.type !== answer.type) throw new Error(`answer type ${answer.type} does not match exercise type ${c.type}`);

  switch (c.type) {
    case "mcq":
    case "dialogue_gap": {
      const { selected } = answer as AnswerOf<"mcq">;
      return done([{ correct: selected === c.answer, given: c.options[selected], expected: c.options[c.answer] }], c.options[c.answer]);
    }
    case "cloze_mc": {
      const { selected } = answer as AnswerOf<"cloze_mc">;
      const parts = c.gaps.map((g, i) => ({ correct: selected[i] === g.answer, given: g.options[selected[i]], expected: g.options[g.answer] }));
      return done(parts, fill(c.text, c.gaps.map((g) => g.options[g.answer])));
    }
    case "open_cloze": {
      const { text } = answer as AnswerOf<"open_cloze">;
      const keys = c.gaps.map((g) => g.accept[0]);
      const candidates: VariantCandidate[] = [];
      const parts = c.gaps.map((g, i) => {
        const correct = matches(text[i], g.accept, normalizeAnswer);
        if (!correct && normalizeAnswer(text[i]) !== "") {
          candidates.push({ part: i, kind: "gap", given: text[i], expected: g.accept, context: fill(c.text, keys.map((k, j) => (j === i ? "___" : k))) });
        }
        return { correct, given: text[i], expected: keys[i] };
      });
      return done(parts, fill(c.text, keys), candidates);
    }
    case "error_correct": {
      const { index, fix } = answer as AnswerOf<"error_correct">;
      const indexOk = index === c.answer;
      const correct = indexOk && matches(fix, c.accept, normalizeAnswer);
      const candidates: VariantCandidate[] =
        indexOk && !correct && normalizeAnswer(fix) !== ""
          ? [{ part: 0, kind: "gap", given: fix, expected: c.accept, context: c.tokens.map((t, i) => (i === c.answer ? "___" : t)).join(" ") }]
          : [];
      const fixed = c.tokens.map((t, i) => (i === c.answer ? c.accept[0] : t)).join(" ");
      return done([{ correct, given: `${c.tokens[index]} -> ${fix}`, expected: `${c.tokens[c.answer]} -> ${c.accept[0]}` }], fixed, candidates);
    }
    case "dictation": {
      const { text } = answer as AnswerOf<"dictation">;
      const correct = matches(text, c.accept, normalizeLoose);
      const candidates: VariantCandidate[] =
        !correct && normalizeLoose(text) !== "" ? [{ part: 0, kind: "sentence", given: text, expected: c.accept, context: c.tts }] : [];
      return done([{ correct, given: text, expected: c.tts }], c.tts, candidates);
    }
    case "word_bank": {
      const given = (answer as AnswerOf<"word_bank">).tokens.join(" ");
      const correct = [c.answer, ...c.accept_alt].some((k) => normalizeLoose(k.join(" ")) === normalizeLoose(given));
      return done([{ correct, given, expected: c.answer.join(" ") }], c.answer.join(" "));
    }
    case "match": {
      const { pairs } = answer as AnswerOf<"match">;
      const parts = c.left.map((l, i) => ({
        correct: pairs[i] === c.answer[i],
        given: `${l} = ${c.right[pairs[i]]}`,
        expected: `${l} = ${c.right[c.answer[i]]}`,
      }));
      return done(parts, parts.map((p) => p.expected).join("; "));
    }
    case "translation": {
      const { text } = answer as AnswerOf<"translation">;
      return { isCorrect: false, parts: [{ correct: false, given: text, expected: c.reference }], correctAnswer: c.reference, variantCandidates: [], needsJudge: "translation" };
    }
    case "open_writing": {
      const { text } = answer as AnswerOf<"open_writing">;
      return { isCorrect: false, parts: [{ correct: false, given: text, expected: "" }], correctAnswer: "", variantCandidates: [], needsJudge: "writing" };
    }
  }
}
