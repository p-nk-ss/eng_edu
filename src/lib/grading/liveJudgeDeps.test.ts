// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm/index", () => ({ completeJson: vi.fn().mockResolvedValue({}) }));
vi.mock("../typesafe/client", () => ({ createTypeSafeClient: vi.fn() }));

import { completeJson } from "../llm/index";
import { translationFeedbackSchema } from "../prompts/translationFeedback";
import { writingFeedbackSchema } from "../prompts/writingFeedback";
import { createTypeSafeClient } from "../typesafe/client";
import { liveJudgeDeps } from "./liveJudgeDeps";

beforeEach(() => vi.clearAllMocks());
const args = { system: "s", messages: [{ role: "user" as const, content: "u" }] };

describe("liveJudgeDeps", () => {
  it("routes translation and writing feedback through the facade with their roles and schemas", async () => {
    const d = liveJudgeDeps();
    await d.askTranslation(args);
    await d.askWriting(args);
    expect(completeJson).toHaveBeenNthCalledWith(1, "translation_check", args, translationFeedbackSchema);
    expect(completeJson).toHaveBeenNthCalledWith(2, "writing_feedback", args, writingFeedbackSchema);
  });

  it("creates the Jev client once, lazily", () => {
    const client = { systemOne: vi.fn() };
    vi.mocked(createTypeSafeClient).mockReturnValue(client as never);
    const d = liveJudgeDeps();
    expect(createTypeSafeClient).not.toHaveBeenCalled();
    expect(d.jev()).toBe(client);
    expect(d.jev()).toBe(client);
    expect(createTypeSafeClient).toHaveBeenCalledTimes(1);
  });

  it("returns null when the key is missing", () => {
    vi.mocked(createTypeSafeClient).mockImplementation(() => {
      throw new Error("TYPESAFE_API_KEY is not set");
    });
    expect(liveJudgeDeps().jev()).toBeNull();
  });
});
