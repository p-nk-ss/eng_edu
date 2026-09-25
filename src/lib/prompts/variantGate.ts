import type { VariantCandidate } from "../grading/types";
import { noul, type Json, type NoulQuestion } from "../typesafe/client";

/** A typed mismatch counts as correct only on a confident "equally correct". */
export const VARIANT_ACCEPT = 0.8;

const GAP = noul(
  "`sentence_with_gap` has one gap (___). `keyed_answers` are the answers the key accepts for it. First check the spelling of EVERY word of `learner_answer` letter by letter: a single misspelled word (e.g. \"recieve\", \"definately\", \"responsable\") makes the answer wrong, even if the intended word is obvious or it is a synonym of a keyed answer (e.g. \"dependible\" is a misspelling of \"dependable\"). Then put `learner_answer` into the gap and judge the resulting sentence: is it correct, natural standard English with the same meaning as with a keyed answer? Be generous with alternatives - knowing them is a plus. A word given in brackets in the sentence and the construction used by the keyed answers are only hints, not requirements. Accept: another standard spelling (British or American), a contraction or its full form, a synonym, a different word, or an alternative correct construction (for example \"better organised\" instead of \"more organised\"), even if it does not use the word in brackets.",
  {
    true: "Every word of `learner_answer` is spelled exactly as in a standard British or American dictionary, AND the sentence with it in the gap is correct, natural standard English and means the same as with a keyed answer. A synonym, an alternative correct construction or not using the word in brackets (a hint only) is fine.",
    false: "Any word of `learner_answer` is misspelled (even by one letter), or it is the wrong form of a word (tense, ending, number, e.g. \"reliabler\", \"more organise\"), makes the sentence ungrammatical (e.g. the wrong part of speech for the gap), changes the meaning, or leaves the original error in place.",
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
