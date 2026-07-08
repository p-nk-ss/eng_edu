import type { CompleteArgs, Provider } from "@/lib/llm/types";

function toOpenAiMessages(args: CompleteArgs): { role: string; content: string }[] {
  const msgs: { role: string; content: string }[] = [];
  if (args.system) msgs.push({ role: "system", content: args.system });
  for (const m of args.messages) msgs.push({ role: m.role, content: m.content });
  return msgs;
}

export class LocalProvider implements Provider {
  readonly name = "local" as const;

  constructor(
    private readonly url = process.env.LOCAL_LLM_URL ?? "http://localhost:1234/v1",
    private readonly model = process.env.LOCAL_LLM_MODEL ?? "qwen3-14b",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(args: CompleteArgs): Promise<string> {
    let out = "";
    for await (const delta of this.stream(args)) out += delta;
    return out;
  }

  async *stream(args: CompleteArgs): AsyncIterable<string> {
    const res = await this.fetchImpl(`${this.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAiMessages(args),
        stream: true,
        max_tokens: args.maxTokens ?? 1024,
        // Qwen3: disable reasoning so <think> blocks don't blow the latency budget
        chat_template_kwargs: { enable_thinking: false },
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`LocalProvider HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const delta: string | undefined = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // ignore keep-alive / partial lines
        }
      }
    }
  }
}
