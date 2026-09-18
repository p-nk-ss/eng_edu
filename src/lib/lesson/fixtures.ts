import type { ExerciseContent, ExerciseTypeName } from "./exerciseSchemas";

/** Target vocab the fixtures refer to (ids as they would come from VocabItem). */
export const FIXTURE_VOCAB = [
  { id: "v1", headword: "deadline" },
  { id: "v2", headword: "colleague" },
];

/** One valid content object per exercise type (shapes from SPEC.md §Exercise Types). */
export const VALID_EXERCISES: Record<ExerciseTypeName, ExerciseContent> = {
  MULTIPLE_CHOICE: {
    type: "mcq",
    prompt: "She ___ the report before the deadline yesterday.",
    options: ["finish", "had finished", "finishing", "finishes"],
    answer: 1,
    rationales: ["base form", "correct: completed before a past moment", "-ing form needs an auxiliary", "present simple"],
    explain: "Past Perfect shows an action completed before another past moment.",
    vocab: ["v1"],
  },
  CLOZE_DROPDOWN: {
    type: "cloze_mc",
    text: "I have worked here ___ 2019, ___ five years.",
    gaps: [
      { options: ["since", "for"], answer: 0 },
      { options: ["since", "for"], answer: 1 },
    ],
    explain: "Use since with a starting point and for with a length of time.",
    vocab: [],
  },
  FILL_BLANK: {
    type: "open_cloze",
    text: "It was a ___ (BEAUTY) day.",
    gaps: [{ root: "BEAUTY", accept: ["beautiful"] }],
    explain: "The adjective formed from beauty is beautiful.",
    vocab: [],
  },
  WORD_BANK: {
    type: "word_bank",
    tokens: ["work", "I", "to", "go", "goes"],
    answer: ["I", "go", "to", "work"],
    accept_alt: [],
    explain: "First person singular takes the base form: I go.",
    vocab: [],
  },
  MATCH: {
    type: "match",
    left: ["frankly", "broke", "colleague"],
    right: ["with no money", "a person you work with", "to be honest"],
    answer: [2, 0, 1],
    explain: "Frankly means to be honest; broke means with no money.",
    vocab: ["v2"],
  },
  DIALOGUE_GAP: {
    type: "dialogue_gap",
    turns: ["A: Sorry I am late.", "B: ___"],
    options: ["No worries.", "You are welcome."],
    answer: 0,
    explain: "No worries is the natural reply to an apology.",
    vocab: [],
  },
  DICTATION: {
    type: "dictation",
    tts: "I'd like a coffee, please.",
    accept: ["i'd like a coffee please", "i would like a coffee please"],
    explain: "I'd is the contraction of I would.",
    vocab: [],
  },
  ERROR_CORRECTION: {
    type: "error_correct",
    tokens: ["She", "don't", "like", "tea"],
    answer: 1,
    accept: ["doesn't", "does not"],
    explain: "Third person singular takes does not.",
    vocab: [],
  },
  TRANSLATION: {
    type: "translation",
    source: "Я закончил отчёт до дедлайна.",
    reference: "I finished the report before the deadline.",
    explain: "Before + noun phrase; the deadline takes the definite article.",
    vocab: ["v1"],
  },
  OPEN_WRITING: {
    type: "open_writing",
    prompt: "Describe a time you missed a deadline at work and what you learned from it.",
    minWords: 60,
    explain: "Use past tenses to narrate and the present to state what you learned.",
    vocab: ["v1"],
  },
};
