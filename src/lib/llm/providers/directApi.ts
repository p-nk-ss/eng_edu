import Anthropic from "@anthropic-ai/sdk";
import type { CompleteArgs, Provider } from "@/lib/llm/types";

export class DirectAPIProvider implements Provider {
  readonly name = "api" as const;

  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async complete(args: CompleteArgs): Promise<string> {
    const res = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: args.maxTokens ?? 1024,
      system: args.system,
      messages: args.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });

    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  stream(_args: CompleteArgs): AsyncIterable<string> {
    throw new Error(
      "DirectAPIProvider does not implement stream(); use LocalProvider for streaming roles.",
    );
  }
}
