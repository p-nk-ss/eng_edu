// @vitest-environment node
import { describe, it, expect } from "vitest";
import { grammarEnrichmentPrompt, ENRICHMENT_LIMITS } from "./grammarEnrichment";

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
    const { messages } = grammarEnrichmentPrompt(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const content = messages[0].content;
    const payload = JSON.parse(content.slice(content.indexOf("{")));
    expect(payload.level).toBe("B1");
    expect(payload.topics.map((t: { name: string }) => t.name)).toEqual(["You are", "TENSE/ASPECT: PRESENT PERFECT"]);
    expect(content).toContain("TA.PRPF.NEG");
    expect(content).toContain("NEG. DEC.");
    expect(content).toContain("文頭位置に限定");
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

  it("builds the system prompt's stated limits from ENRICHMENT_LIMITS so they cannot drift", () => {
    const { system } = grammarEnrichmentPrompt(input);
    expect(system).toContain(`${ENRICHMENT_LIMITS.title.min}-${ENRICHMENT_LIMITS.title.max}`);
    expect(system).toContain(`${ENRICHMENT_LIMITS.description.min}-${ENRICHMENT_LIMITS.description.max}`);
    expect(system).toContain(`${ENRICHMENT_LIMITS.example.min}-${ENRICHMENT_LIMITS.example.max}`);
    expect(system).toContain(`${ENRICHMENT_LIMITS.noteMax}`);
  });
});
