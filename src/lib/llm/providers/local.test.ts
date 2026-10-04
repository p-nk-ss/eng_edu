import { describe, it, expect, vi } from "vitest";
import { FIRST_DELTA_TIMEOUT_MS, IDLE_TIMEOUT_MS, LocalProvider } from "./local";

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

const okChunks = [
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
  'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
  "data: [DONE]\n",
];

describe("LocalProvider", () => {
  it("aggregates streamed deltas in complete()", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(okChunks));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).resolves.toBe("Hello");
  });

  it("posts to /chat/completions with streaming + thinking disabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(okChunks));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    await p.complete({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("yields deltas from stream()", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(okChunks));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    const out: string[] = [];
    for await (const d of p.stream({ messages: [{ role: "user", content: "hi" }] })) out.push(d);
    expect(out).toEqual(["Hel", "lo"]);
  });

  it("drops a think block that arrives in one delta", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([delta("<think>\nhmm, plan\n</think>\n\nHello there"), delta("!"), "data: [DONE]\n"]));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).resolves.toBe("Hello there!");
  });

  it("drops a think block whose tags are split across deltas", async () => {
    const parts = ["<th", "ink>", "secret ", "reasoning</th", "in", "k>", "\n\n", "Hi", " you"];
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([...parts.map(delta), "data: [DONE]\n"]));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    const out: string[] = [];
    for await (const d of p.stream({ messages: [{ role: "user", content: "hi" }] })) out.push(d);
    expect(out.join("")).toBe("Hi you");
    expect(out.join("")).not.toMatch(/secret|think/);
  });

  it("leaves a reply without a think block unchanged (inner whitespace and < kept)", async () => {
    const parts = ["I think ", "2 <", " 3", " is true.\n", "Right?"];
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([...parts.map(delta), "data: [DONE]\n"]));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).resolves.toBe("I think 2 < 3 is true.\nRight?");
  });

  it("removes a whitespace-only prefix before the first visible character", async () => {
    const parts = ["\n", "  \n", " Hello", " world"];
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([...parts.map(delta), "data: [DONE]\n"]));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    const out: string[] = [];
    for await (const d of p.stream({ messages: [{ role: "user", content: "hi" }] })) out.push(d);
    expect(out).toEqual(["Hello", " world"]);
  });

  it("cancels the HTTP body when the consumer stops early", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(delta("one")));
        controller.enqueue(enc.encode(delta("two")));
        // left open: the server would keep generating
      },
      cancel,
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    for await (const d of p.stream({ messages: [{ role: "user", content: "hi" }] })) {
      expect(d).toBe("one");
      break;
    }
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("exports the timeout constants", () => {
    expect(FIRST_DELTA_TIMEOUT_MS).toBe(60_000);
    expect(IDLE_TIMEOUT_MS).toBe(30_000);
  });

  it("aborts when the request never answers within the first-delta timeout", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch, { firstDeltaMs: 20, idleMs: 1000 });
    await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/timeout/i);
    expect(signal?.aborted).toBe(true);
  });

  it("aborts when no content delta arrives within the first-delta timeout, even with keep-alive chunks", async () => {
    let tick: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        tick = setInterval(() => controller.enqueue(enc.encode(": keep-alive\n")), 5);
      },
      cancel() {
        clearInterval(tick);
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch, { firstDeltaMs: 40, idleMs: 1000 });
    try {
      await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/timeout/i);
    } finally {
      clearInterval(tick);
    }
  });

  it("aborts when no chunk arrives for the idle timeout after the first delta", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(delta("Hel")));
        // then silence
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch, { firstDeltaMs: 1000, idleMs: 20 });
    const out: string[] = [];
    await expect(
      (async () => {
        for await (const d of p.stream({ messages: [{ role: "user", content: "hi" }] })) out.push(d);
      })(),
    ).rejects.toThrow(/timeout/i);
    expect(out).toEqual(["Hel"]);
  });

  it("throws on non-OK HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/500/);
  });
});
