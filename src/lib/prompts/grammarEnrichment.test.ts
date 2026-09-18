// @vitest-environment node
import { describe, it, expect } from "vitest";
import { grammarEnrichmentPrompt } from "./grammarEnrichment";

const input = {
  level: "B1" as const,
  topics: [
    { name: "You are", variants: [{ shorthand: "PP.you_are", sentenceType: "AFF. DEC.", note: "文頭位置に限定" }] },
    {
      name: "TENSE/ASPECT: PRESENT PERFECT",
      variants: [
        { shorthand: "TA.PRPF.AFF", sentenceType: "AFF. DEC.", note: "" },
        { shorthand: "TA.PRPF.NEG", sentenceType: "NEG. DEC.", note: "" },
      ],
    },
  ],
};

describe("grammarEnrichmentPrompt", () => {
  it("puts the level and every topic with its variants into the user message as JSON", () => {
    const { user } = grammarEnrichmentPrompt(input);
    const payload = JSON.parse(user.slice(user.indexOf("{")));
    expect(payload.level).toBe("B1");
    expect(payload.topics.map((t: { name: string }) => t.name)).toEqual(["You are", "TENSE/ASPECT: PRESENT PERFECT"]);
    expect(user).toContain("TA.PRPF.NEG");
    expect(user).toContain("NEG. DEC.");
    expect(user).toContain("文頭位置に限定");
  });

  it("states the output contract in the system prompt", () => {
    const { system } = grammarEnrichmentPrompt(input);
    expect(system).toMatch(/ONLY.*JSON array/i);
    for (const field of ["name", "title", "description", "example", "teachable", "importance", "note"]) {
      expect(system).toContain(`"${field}"`);
    }
    expect(system).toMatch(/verbatim/i);
    expect(system).toMatch(/conversational fluency/i);
    expect(system).toMatch(/1\s*=\s*core/i);
  });
});
