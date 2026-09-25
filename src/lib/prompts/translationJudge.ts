import type { ContentOf, TranslationCategory } from "../grading/types";
import { choice, noul, type ChoiceQuestion, type Json, type NoulQuestion } from "../typesafe/client";

/** Jev-accepted translations skip Claude entirely. */
export const TRANSLATION_ACCEPT = 0.8;

const ACCEPTABLE = noul(
  "A learner of English translated a sentence. `reference_en` is one correct translation; other wordings can be equally correct. Should a strict English teacher accept `learner_answer` as fully correct?",
  {
    true: "learner_answer is error-free standard English (grammar, word choice, word order, spelling) AND has the same meaning as reference_en. Paraphrases, synonyms, contractions and British/American variants are fine.",
    false: "learner_answer contains any grammar, vocabulary, word-order or spelling error, OR its meaning differs from reference_en.",
  },
);

const ERROR_TYPE = choice<TranslationCategory>(
  "Which single category best describes the most important problem in `learner_answer`, compared with `reference_en`?",
  {
    none: "No problem: correct English with the same meaning as the reference.",
    grammar: "Wrong tense, verb form, agreement, article, preposition, plural, or clause structure.",
    vocabulary: "A wrong word was chosen: false friend, wrong collocation, confused word pair. Grammar is otherwise fine.",
    word_order: "The right words in the right forms, but placed in the wrong order.",
    spelling: "A misspelled word; the intended word is obvious and otherwise correct.",
    meaning: "Correct, natural English that states something different from the reference.",
  },
);

export function translationRequest(
  c: ContentOf<"translation">,
  text: string,
): { state: Json; questions: { acceptable: NoulQuestion; error_type: ChoiceQuestion<TranslationCategory> } } {
  return {
    state: { source_ru: c.source, reference_en: c.reference, learner_answer: text },
    questions: { acceptable: ACCEPTABLE, error_type: ERROR_TYPE },
  };
}
