import type { CompleteArgs, LlmMessage } from "../llm/types";

/** Max tokens for a single partner reply (short, spoken-register turns). */
export const PARTNER_MAX_TOKENS = 220;

export interface PartnerInput {
  level: string;
  interests: string;
  theme: string | null;
  intro: string;
  questions: string[];
  grammar: { title: string; description: string | null } | null;
  vocab: string[];
  wrapUp: boolean;
  history: { role: "partner" | "learner"; text: string }[];
}

function buildSystem(input: PartnerInput): string {
  const themeSentence = input.theme ? ` Theme: ${input.theme}.` : "";
  const line1 = `You are a friendly English conversation partner for a ${input.level} learner.${themeSentence} Learner interests: ${input.interests}.`;
  const line2 = `Opening context: ${input.intro}. Ideas you may ask about: ${input.questions.join("; ")}.`;

  const grammarPart = input.grammar
    ? input.grammar.description
      ? `${input.grammar.title} (${input.grammar.description})`
      : input.grammar.title
    : null;
  const vocabPart = input.vocab.length ? input.vocab.join(", ") : null;

  const lines = [line1, line2];

  if (grammarPart && vocabPart) {
    lines.push(`Gently create chances for the learner to use ${grammarPart} and these words: ${vocabPart}. Use them yourself naturally.`);
  } else if (grammarPart) {
    lines.push(`Gently create chances for the learner to use ${grammarPart}. Use it yourself naturally.`);
  } else if (vocabPart) {
    lines.push(`Gently create chances for the learner to use these words: ${vocabPart}. Use them yourself naturally.`);
  }

  lines.push(
    "Rules: reply in 2-4 short sentences in a natural spoken register and end with one follow-up question. Plain text only - no markdown, emojis, lists or stage directions.",
  );
  lines.push(
    'Never correct the learner, no grammar explanations, no teaching - even if asked; say "We\'ll review everything at the end" and keep talking.',
  );

  if (input.wrapUp) {
    lines.push("This is the last reply: thank the learner warmly, briefly wrap up the conversation. Do not ask a new question.");
  }

  // Qwen3 soft switch: skip reasoning (the provider also strips any <think> block that still appears).
  lines.push("/no_think");

  return lines.join("\n");
}

/** Conversation partner reply (role `conversation`, streamed). No response schema - plain text. */
export function conversationPartnerPrompt(input: PartnerInput): CompleteArgs {
  const messages: LlmMessage[] = input.history.map((t) => ({
    role: t.role === "partner" ? "assistant" : "user",
    content: t.text,
  }));
  return { system: buildSystem(input), messages, maxTokens: PARTNER_MAX_TOKENS };
}
