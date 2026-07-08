import { describe, it, expect } from "vitest";
import { resolveProviderName } from "./llm-roles";

describe("resolveProviderName", () => {
  it("routes conversation to local by default", () => {
    expect(resolveProviderName("conversation", {})).toBe("local");
  });

  it("routes teaching roles to agent by default", () => {
    expect(resolveProviderName("lesson_generation", {})).toBe("agent");
    expect(resolveProviderName("translation_check", {})).toBe("agent");
  });

  it("honors an LLM_ROLE_<ROLE> override", () => {
    expect(
      resolveProviderName("conversation", { LLM_ROLE_CONVERSATION: "api" }),
    ).toBe("api");
  });

  it("ignores an invalid override value", () => {
    expect(
      resolveProviderName("lesson_generation", { LLM_ROLE_LESSON_GENERATION: "bogus" }),
    ).toBe("agent");
  });
});
