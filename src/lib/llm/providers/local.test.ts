import { describe, it, expect, vi } from "vitest";
import { LocalProvider } from "./local";

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

  it("throws on non-OK HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const p = new LocalProvider("http://x/v1", "m", fetchImpl as unknown as typeof fetch);
    await expect(p.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/500/);
  });
});
