// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm/index", () => ({ completeJson: vi.fn().mockResolvedValue({ exercises: [] }) }));
vi.mock("./qualityGate", () => ({ runQualityGate: vi.fn().mockResolvedValue({ status: "skipped", verdicts: [] }) }));
vi.mock("../typesafe/client", () => ({ createTypeSafeClient: vi.fn() }));

import { completeJson } from "../llm/index";
import { lessonEnvelopeSchema } from "../prompts/lessonGeneration";
import { createTypeSafeClient } from "../typesafe/client";
import { liveGenerationDeps } from "./liveDeps";
import { runQualityGate } from "./qualityGate";

beforeEach(() => vi.clearAllMocks());

describe("liveGenerationDeps", () => {
  it("asks Claude through the facade with the lesson_generation role and the envelope schema", async () => {
    const args = { system: "s", messages: [{ role: "user" as const, content: "u" }] };
    await liveGenerationDeps().ask(args);
    expect(completeJson).toHaveBeenCalledWith("lesson_generation", args, lessonEnvelopeSchema);
  });

  it("creates the Jev client once and passes it to the gate", async () => {
    const client = { systemOne: vi.fn() };
    vi.mocked(createTypeSafeClient).mockReturnValue(client as never);
    const deps = liveGenerationDeps();
    await deps.gate([], null);
    await deps.gate([], null);
    expect(createTypeSafeClient).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runQualityGate).mock.calls[0][2]).toBe(client);
  });

  it("runs the gate without a client when the key is missing", async () => {
    vi.mocked(createTypeSafeClient).mockImplementation(() => {
      throw new Error("TYPESAFE_API_KEY is not set");
    });
    await liveGenerationDeps().gate([], null);
    expect(vi.mocked(runQualityGate).mock.calls[0][2]).toBeNull();
  });
});
