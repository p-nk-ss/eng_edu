export type Role =
  | "conversation"
  | "lesson_generation"
  | "conversation_analysis"
  | "writing_feedback"
  | "translation_check";

export type ProviderName = "local" | "agent" | "api";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteArgs {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

export interface Provider {
  readonly name: ProviderName;
  complete(args: CompleteArgs): Promise<string>;
  stream(args: CompleteArgs): AsyncIterable<string>;
}
