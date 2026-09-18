import { z } from "zod";
import type { CompleteArgs } from "../llm/types";
import { EXERCISE_TYPE_TAGS, EXPLAIN_LIMITS, type ExerciseTypeName } from "../lesson/exerciseSchemas";

/** Limits are stated in the prompt AND enforced by the schema from these same constants. */
export const LESSON_LIMITS = {
  warmupIntro: { min: 20, max: 400 },
  question: { min: 10, max: 200 },
  questions: { min: 3, max: 4 },
  scenarioTitle: { min: 5, max: 80 },
  scenarioText: { min: 10, max: 300 },
  explain: EXPLAIN_LIMITS,
  exercises: { min: 1, max: 12 },
} as const;

const L = LESSON_LIMITS;
const scenarioText = z.string().min(L.scenarioText.min).max(L.scenarioText.max);

export const lessonEnvelopeSchema = z.object({
  /** Validated one by one afterwards (parseExercise) so a single bad exercise is dropped, not the lesson. */
  exercises: z.array(z.unknown()).min(L.exercises.min).max(L.exercises.max),
  warmup: z.object({
    intro: z.string().min(L.warmupIntro.min).max(L.warmupIntro.max),
    questions: z.array(z.string().min(L.question.min).max(L.question.max)).min(L.questions.min).max(L.questions.max),
  }),
  scenario: z.object({
    title: z.string().min(L.scenarioTitle.min).max(L.scenarioTitle.max),
    role: scenarioText,
    goal: scenarioText,
    opening: scenarioText,
  }),
});
export type LessonEnvelope = z.infer<typeof lessonEnvelopeSchema>;

export interface GenerationInputs {
  profile: { level: string; goals: string; interests: string; nativeLang: string };
  theme: { key: string; label: string; description: string };
  grammar: { id: string; title: string; description: string; example: string } | null;
  vocab: { id: string; headword: string; pos: string | null; cefrLevel: string }[];
  mix: ExerciseTypeName[];
  summaries: string[];
}

/** Literal JSON shape per exercise type (SPEC.md §Exercise Types). Only requested shapes are sent. */
const SHAPES: Record<ExerciseTypeName, string> = {
  MULTIPLE_CHOICE: '{"type":"mcq","prompt":"She ___ to work every day.","options":["go","goes","going","gone"],"answer":1,"rationales":["one short reason per option"],"explain":"...","vocab":[]} - 3-5 options, answer = index of the single correct option, rationales has one entry per option.',
  CLOZE_DROPDOWN: '{"type":"cloze_mc","text":"I have lived here ___ 2019, ___ five years.","gaps":[{"options":["since","for"],"answer":0},{"options":["since","for"],"answer":1}],"explain":"...","vocab":[]} - 1-4 gaps, one ___ per gap in reading order, 2-4 options each.',
  FILL_BLANK: '{"type":"open_cloze","text":"It was a ___ (BEAUTY) day.","gaps":[{"root":"BEAUTY","accept":["beautiful"]}],"explain":"...","vocab":[]} - the learner TYPES the word; root is optional (word formation); accept lists every correct variant.',
  WORD_BANK: '{"type":"word_bank","tokens":["work","I","to","go","goes"],"answer":["I","go","to","work"],"accept_alt":[],"explain":"...","vocab":[]} - tokens = the answer words shuffled plus 1-2 distractors; accept_alt lists other correct orders.',
  MATCH: '{"type":"match","left":["frankly","broke","deadline"],"right":["with no money","the latest time to finish something","to be honest"],"answer":[2,0,1],"explain":"...","vocab":[]} - 3-6 pairs; answer[i] = index in right that matches left[i]; right must be shuffled.',
  DIALOGUE_GAP: '{"type":"dialogue_gap","turns":["A: Sorry I am late.","B: ___"],"options":["No worries.","You are welcome."],"answer":0,"explain":"...","vocab":[]} - exactly one turn contains ___; 2-4 options.',
  DICTATION: '{"type":"dictation","tts":"I\'d like a coffee, please.","accept":["i\'d like a coffee please","i would like a coffee please"],"explain":"...","vocab":[]} - tts is spoken aloud to the learner; accept lists lowercase variants without commas or final punctuation and MUST include the tts sentence itself.',
  ERROR_CORRECTION: '{"type":"error_correct","tokens":["She","don\'t","like","tea"],"answer":1,"accept":["doesn\'t","does not"],"explain":"...","vocab":[]} - the sentence split into tokens with exactly ONE wrong token; answer = its index; accept = every correct replacement.',
  TRANSLATION: '{"type":"translation","source":"<one Russian sentence>","reference":"<its natural English translation>","hint":"optional","explain":"...","vocab":[]} - the learner translates source into English.',
  OPEN_WRITING: '{"type":"open_writing","prompt":"<a concrete writing task>","minWords":60,"hint":"optional","explain":"...","vocab":[]} - minWords between 30 and 120.',
};

function systemPrompt(input: GenerationInputs): string {
  const focus = input.grammar
    ? "Build EVERY section around the given grammar focus and the given theme. Introduce no other grammar focus."
    : "There is no grammar focus in this lesson: make it a vocabulary lesson built around the given theme and target words.";
  return [
    "You write one English lesson for a single adult learner. Code has already decided WHAT the lesson teaches (theme, grammar focus, target vocabulary, exercise types); you write only the content.",
    "",
    focus,
    "Use natural, level-appropriate English for the learner's CEFR level. Use the target words where they fit naturally; every exercise that practises a target word must list that word's id in \"vocab\" and must contain the word itself. Use only the given vocab ids.",
    "Choice exercises must have exactly one correct option - no second option may be acceptable English in the gap. Typed exercises must list every reasonable variant in \"accept\" (contractions and full forms, both spellings).",
    `Every exercise has "explain": a short English explanation (${L.explain.min}-${L.explain.max} characters) shown after grading.`,
    "Write everything in English. Russian is allowed ONLY in the \"source\" field of a translation exercise.",
    "",
    "Return ONLY a JSON object, no prose, no markdown fences:",
    '{"exercises":[...],"warmup":{"intro":"...","questions":["..."]},"scenario":{"title":"...","role":"...","goal":"...","opening":"..."}}',
    '- "exercises": exactly one exercise per requested type, in the requested order, each in the exact shape below.',
    `- "warmup": a friendly spoken-style intro (${L.warmupIntro.min}-${L.warmupIntro.max} characters) and ${L.questions.min}-${L.questions.max} open questions (${L.question.min}-${L.question.max} characters each) on the theme that invite the grammar focus.`,
    `- "scenario": a role-play for a later speaking section: "title" (${L.scenarioTitle.min}-${L.scenarioTitle.max} characters); "role" (who the learner is and who they talk to), "goal" (what the learner must achieve) and "opening" (the partner's first line) - ${L.scenarioText.min}-${L.scenarioText.max} characters each.`,
    "",
    "Exercise shapes:",
    ...input.mix.map((t) => `- ${SHAPES[t]}`),
  ].join("\n");
}

/** Lesson generation (role `lesson_generation`). Response: lessonEnvelopeSchema. */
export function lessonGenerationPrompt(input: GenerationInputs): CompleteArgs {
  const payload = {
    learner: input.profile,
    theme: input.theme,
    grammar: input.grammar,
    vocab: input.vocab,
    exercises: input.mix.map((t) => EXERCISE_TYPE_TAGS[t]),
    recentSummaries: input.summaries,
  };
  return {
    system: systemPrompt(input),
    messages: [{ role: "user", content: "Write the lesson for these inputs.\n" + JSON.stringify(payload, null, 2) }],
  };
}
