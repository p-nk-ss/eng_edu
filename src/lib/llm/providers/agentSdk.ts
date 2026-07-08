import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CompleteArgs, Provider } from "@/lib/llm/types";

function flattenPrompt(args: CompleteArgs): string {
  return args.messages
    .map((m) =>
      m.role === "user"
        ? `User: ${m.content}`
        : m.role === "assistant"
          ? `Assistant: ${m.content}`
          : `System: ${m.content}`,
    )
    .join("\n\n");
}

export class AgentSDKProvider implements Provider {
  readonly name = "agent" as const;

  constructor(private readonly queryImpl: typeof query = query) {}

  async complete(args: CompleteArgs): Promise<string> {
    const iterator = this.queryImpl({
      prompt: flattenPrompt(args),
      options: {
        model: "sonnet",
        systemPrompt: args.system,
        // Tool lockdown is enforced by canUseTool (deny) + maxTurns:1.
        // allowedTools is only an auto-approve list, not a restriction.
        allowedTools: [],
        settingSources: [],
        maxTurns: 1,
        canUseTool: async () => ({ behavior: "deny" as const, message: "tools disabled" }),
      },
    });

    let text = "";
    for await (const message of iterator) {
      const m = message as {
        type?: string;
        subtype?: string;
        result?: string;
        errors?: string[];
      };
      if (m.type !== "result") continue;
      if (m.subtype === "success") {
        text = m.result ?? "";
      } else {
        throw new Error(
          `AgentSDKProvider failed (${m.subtype}): ${m.errors?.join("; ") ?? "no result"}`,
        );
      }
    }
    return text;
  }

  stream(_args: CompleteArgs): AsyncIterable<string> {
    throw new Error(
      "AgentSDKProvider does not implement stream(); use LocalProvider for streaming roles.",
    );
  }
}
