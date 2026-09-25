import type { VariantCandidate } from "../grading/types";
import { noul, type Json, type NoulQuestion } from "../typesafe/client";

/** A typed mismatch counts as correct only on a confident "equally correct". */
export const VARIANT_ACCEPT = 0.8;

const GAP = noul(
  "`sentence_with_gap` has one gap (___). `keyed_answers` are the answers the key accepts for it. Would `learner_answer` in that gap be EQUALLY correct - the same word or phrase in another standard spelling (British or American), a contraction or its full form, or a different word or phrase that keeps both the meaning and the grammar of the sentence?",
  {
    true: "Filling the gap with `learner_answer` gives correct, natural standard English with the same meaning as a keyed answer.",
    false: "`learner_answer` is misspelled, the wrong form of the word (tense, ending, number), ungrammatical in this gap, or changes the meaning.",
  },
);

const SENTENCE = noul(
  "A learner heard `spoken_sentence` and typed `learner_answer`. `keyed_answers` are accepted transcriptions. Is `learner_answer` the same sentence, differing only in punctuation, capitalisation, standard British or American spelling, or a contraction versus its full form?",
  {
    true: "Same words in the same order; only punctuation, capitalisation, British/American spelling or contractions differ.",
    false: "A word is missing, added, misspelled or different, or the word order differs.",
  },
);

/** One variant candidate per request (never batch). */
export function variantRequest(v: VariantCandidate): { state: Json; questions: { equivalent: NoulQuestion } } {
  return v.kind === "gap"
    ? { state: { sentence_with_gap: v.context, keyed_answers: v.expected, learner_answer: v.given }, questions: { equivalent: GAP } }
    : { state: { spoken_sentence: v.context, keyed_answers: v.expected, learner_answer: v.given }, questions: { equivalent: SENTENCE } };
}
