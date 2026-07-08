import { describe, it, expect, vi } from "vitest";
import { AgentSDKProvider } from "./agentSdk";

async function* fakeQueryMessages() {
  yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
  yield { type: "result", subtype: "success", result: "Hello from Claude" };
}

describe("AgentSDKProvider", () => {
  it("returns the final result text", async () => {
    const queryImpl = vi.fn().mockReturnValue(fakeQueryMessages());
    const p = new AgentSDKProvider(queryImpl as never);
    await expect(
      p.complete({ system: "You are a tutor.", messages: [{ role: "user", content: "Hi" }] }),
    ).resolves.toBe("Hello from Claude");
  });

  it("configures a restricted, tool-less single-turn query", async () => {
    const queryImpl = vi.fn().mockReturnValue(fakeQueryMessages());
    const p = new AgentSDKProvider(queryImpl as never);
    await p.complete({ system: "sys", messages: [{ role: "user", content: "Hi" }] });
    const arg = queryImpl.mock.calls[0][0];
    expect(arg.options.model).toBe("sonnet");
    expect(arg.options.allowedTools).toEqual([]);
    expect(arg.options.settingSources).toEqual([]);
    expect(arg.options.maxTurns).toBe(1);
    expect(arg.options.systemPrompt).toBe("sys");
    expect(arg.prompt).toContain("User: Hi");
    const decision = await arg.options.canUseTool("Bash", {}, {});
    expect(decision.behavior).toBe("deny");
  });

  it("throws on a non-success result (error subtype)", async () => {
    async function* errMsgs() {
      yield { type: "result", subtype: "error_max_turns", errors: ["hit turn limit"] };
    }
    const p = new AgentSDKProvider(vi.fn().mockReturnValue(errMsgs()) as never);
    await expect(
      p.complete({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/error_max_turns/);
  });

  it("does not implement stream()", () => {
    const p = new AgentSDKProvider(vi.fn() as never);
    expect(() => p.stream({ messages: [] })).toThrow(/stream/i);
  });
});
