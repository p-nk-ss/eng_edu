import { describe, it, expect, vi } from "vitest";
import { DirectAPIProvider } from "./directApi";

function mockClient(create: ReturnType<typeof vi.fn>) {
  return { messages: { create } } as unknown as ConstructorParameters<typeof DirectAPIProvider>[0];
}

describe("DirectAPIProvider", () => {
  it("joins text blocks from the response", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    });
    const p = new DirectAPIProvider(mockClient(create));
    await expect(
      p.complete({ system: "sys", messages: [{ role: "user", content: "Hi" }] }),
    ).resolves.toBe("Hello world");
  });

  it("sends model, system, and non-system messages", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const p = new DirectAPIProvider(mockClient(create));
    await p.complete({ system: "sys", messages: [{ role: "user", content: "Hi" }] });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.system).toBe("sys");
    expect(params.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("does not implement stream()", () => {
    const p = new DirectAPIProvider(mockClient(vi.fn()));
    expect(() => p.stream({ messages: [] })).toThrow(/stream/i);
  });
});
