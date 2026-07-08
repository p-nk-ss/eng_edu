import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { complete, stream, completeJson, __setProvider, __resetProviders } from "./index";
import type { Provider } from "./types";

function stubProvider(name: Provider["name"], text: string, canStream = false): Provider {
  return {
    name,
    complete: vi.fn().mockResolvedValue(text),
    stream: canStream
      ? async function* () {
          yield text;
        }
      : () => {
          throw new Error("stream not supported");
        },
  };
}

beforeEach(() => __resetProviders());

describe("llm facade", () => {
  it("routes a teaching role to the agent provider", async () => {
    __setProvider("agent", stubProvider("agent", "lesson-json"));
    await expect(
      complete("lesson_generation", { messages: [{ role: "user", content: "x" }] }),
    ).resolves.toBe("lesson-json");
  });

  it("routes conversation to the local provider and streams", async () => {
    __setProvider("local", stubProvider("local", "hi", true));
    const out: string[] = [];
    for await (const d of stream("conversation", { messages: [{ role: "user", content: "x" }] })) {
      out.push(d);
    }
    expect(out).toEqual(["hi"]);
  });

  it("throws when streaming a non-local role", () => {
    __setProvider("agent", stubProvider("agent", "nope"));
    expect(() => stream("lesson_generation", { messages: [] })).toThrow(/stream/i);
  });

  it("completeJson validates against the schema", async () => {
    __setProvider("agent", stubProvider("agent", '{"n":5}'));
    const schema = z.object({ n: z.number() });
    await expect(
      completeJson("lesson_generation", { messages: [{ role: "user", content: "x" }] }, schema),
    ).resolves.toEqual({ n: 5 });
  });
});
