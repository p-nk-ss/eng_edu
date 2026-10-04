import type { CompleteArgs, Provider } from "@/lib/llm/types";

/** Abort when no content delta has arrived this long after the request (covers LM Studio JIT model loading). */
export const FIRST_DELTA_TIMEOUT_MS = 60_000;
/** Abort when no chunk has arrived for this long after the first content delta. */
export const IDLE_TIMEOUT_MS = 30_000;

export interface LocalTimeouts {
  firstDeltaMs: number;
  idleMs: number;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

function toOpenAiMessages(args: CompleteArgs): { role: string; content: string }[] {
  const msgs: { role: string; content: string }[] = [];
  if (args.system) msgs.push({ role: "system", content: args.system });
  for (const m of args.messages) msgs.push({ role: m.role, content: m.content });
  return msgs;
}

/** Length of the longest suffix of `s` that is a proper prefix of `tag` (a possibly split tag). */
function partialTagSuffix(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
    if (s.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Streaming filter that removes `<think>...</think>` blocks (tags may be split across deltas) and
 * the whitespace before the first visible character of the reply.
 */
export class ThinkStripper {
  private buf = "";
  private inThink = false;
  private started = false;

  push(delta: string): string {
    this.buf += delta;
    let out = "";
    for (;;) {
      if (this.inThink) {
        const end = this.buf.indexOf(CLOSE_TAG);
        if (end < 0) {
          // keep only what could be the start of a split closing tag
          this.buf = this.buf.slice(this.buf.length - partialTagSuffix(this.buf, CLOSE_TAG));
          break;
        }
        this.buf = this.buf.slice(end + CLOSE_TAG.length);
        this.inThink = false;
        continue;
      }
      const open = this.buf.indexOf(OPEN_TAG);
      if (open >= 0) {
        out += this.buf.slice(0, open);
        this.buf = this.buf.slice(open + OPEN_TAG.length);
        this.inThink = true;
        continue;
      }
      const hold = partialTagSuffix(this.buf, OPEN_TAG);
      out += this.buf.slice(0, this.buf.length - hold);
      this.buf = this.buf.slice(this.buf.length - hold);
      break;
    }
    return this.visible(out);
  }

  /** Text held back at the end of the stream (an incomplete opening tag is plain text). */
  flush(): string {
    const rest = this.inThink ? "" : this.buf;
    this.buf = "";
    return this.visible(rest);
  }

  private visible(out: string): string {
    if (!this.started) {
      out = out.trimStart();
      if (out) this.started = true;
    }
    return out;
  }
}

export class LocalProvider implements Provider {
  readonly name = "local" as const;

  constructor(
    private readonly url = process.env.LOCAL_LLM_URL ?? "http://localhost:1234/v1",
    private readonly model = process.env.LOCAL_LLM_MODEL ?? "qwen3-14b",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeouts: LocalTimeouts = { firstDeltaMs: FIRST_DELTA_TIMEOUT_MS, idleMs: IDLE_TIMEOUT_MS },
  ) {}

  async complete(args: CompleteArgs): Promise<string> {
    let out = "";
    for await (const delta of this.stream(args)) out += delta;
    return out;
  }

  async *stream(args: CompleteArgs): AsyncIterable<string> {
    const controller = new AbortController();
    let timeoutError: Error | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number, what: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timeoutError = new Error(`LocalProvider timeout: ${what} for ${ms} ms`);
        controller.abort(timeoutError);
      }, ms);
    };
    // Rejects once the request is aborted, so a hung fetch/read surfaces as a thrown error.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(timeoutError ?? new Error("LocalProvider aborted")), { once: true });
    });
    aborted.catch(() => {});

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      arm(this.timeouts.firstDeltaMs, "no reply");
      const res = await Promise.race([
        this.fetchImpl(`${this.url}/chat/completions`, {
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
          signal: controller.signal,
        }),
        aborted,
      ]);

      if (!res.ok || !res.body) {
        throw new Error(`LocalProvider HTTP ${res.status}`);
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      const stripper = new ThinkStripper();
      let buffer = "";
      let gotDelta = false;
      let finished = false;

      while (!finished) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        if (gotDelta) arm(this.timeouts.idleMs, "no data");
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            finished = true;
            break;
          }
          let delta: string | undefined;
          try {
            delta = JSON.parse(data).choices?.[0]?.delta?.content;
          } catch {
            // ignore keep-alive / partial lines
          }
          if (!delta) continue;
          if (!gotDelta) {
            gotDelta = true;
            arm(this.timeouts.idleMs, "no data");
          }
          const visible = stripper.push(delta);
          if (visible) {
            // a slow consumer is not an idle server: pause the idle timer while suspended at yield
            clearTimeout(timer);
            yield visible;
            arm(this.timeouts.idleMs, "no data");
          }
        }
      }
      const rest = stripper.flush();
      if (rest) yield rest;
    } finally {
      clearTimeout(timer);
      // Release the HTTP body (also when the consumer stops early) so LM Studio stops generating.
      reader?.cancel().catch(() => {});
    }
  }
}
