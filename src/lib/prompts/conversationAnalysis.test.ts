// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ANALYSIS_LIMITS as L, conversationAnalysisPrompt, conversationAnalysisSchema, type AnalysisInput } from "./conversationAnalysis";

const turns: AnalysisInput["turns"] = [
  { id: "t1", role: "partner", text: "What did you do yesterday?" },
  { id: "t2", role: "learner", text: "I go to the cinema with my friend." },
  { id: "t3", role: "partner", text: "Sounds fun! What did you watch?" },
  { id: "t4", role: "learner", text: "We watched a new action movie." },
];

const grammarTopics = [
  { id: "g1", title: "past simple" },
  { id: "g2", title: "present perfect" },
];

const input: AnalysisInput = { level: "B1", turns, grammarTopics };

describe("conversationAnalysisPrompt", () => {
  it("lists learner turns with ids and partner turns as context in the user message", () => {
    const args = conversationAnalysisPrompt(input);
    const transcript = args.messages[0].content;
    expect(transcript).toContain("[t2] I go to the cinema with my friend.");
    expect(transcript).toContain("[t4] We watched a new action movie.");
    expect(transcript).toContain("What did you do yesterday?");
    expect(transcript).toContain("Sounds fun! What did you watch?");
    expect(transcript).not.toContain("[t1]");
    expect(transcript).not.toContain("[t3]");
  });

  it("lists the grammar topics with ids and states only learner turns are judged", () => {
    const system = conversationAnalysisPrompt(input).system ?? "";
    expect(system).toContain("[g1] past simple");
    expect(system).toContain("[g2] present perfect");
    expect(system).toMatch(/only.*learner/i);
  });

  it("states the grammarTopicId constraint, category rules and severity definitions", () => {
    const system = conversationAnalysisPrompt(input).system ?? "";
    expect(system).toMatch(/grammarTopicId/);
    expect(system).toMatch(/one of these ids, or null/i);
    expect(system).toContain('"vocab: <word>"');
    expect(system).toContain("general");
    expect(system).toContain('"major"');
    expect(system).toContain('"moderate"');
    expect(system).toContain('"minor"');
  });

  it("asks for strict JSON with findings and topIssues, empty arrays when no mistakes", () => {
    const system = conversationAnalysisPrompt(input).system ?? "";
    expect(system).toContain('{"findings":[...],"topIssues":[...]}');
    expect(system).toMatch(/empty arrays/i);
  });
});

describe("conversationAnalysisSchema", () => {
  const finding = {
    turnId: "t2",
    original: "I go to the cinema",
    corrected: "I went to the cinema",
    explanation: "Past simple for a finished action.",
    category: "past simple",
    severity: "major",
    grammarTopicId: "g1",
  };

  it("accepts a valid payload", () => {
    const parsed = conversationAnalysisSchema.parse({ findings: [finding], topIssues: ["Mixes present and past tense"] });
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.topIssues).toHaveLength(1);
  });

  it("defaults findings and topIssues to [] when missing", () => {
    expect(conversationAnalysisSchema.parse({})).toEqual({ findings: [], topIssues: [] });
  });

  it("rejects an unknown severity", () => {
    expect(conversationAnalysisSchema.safeParse({ findings: [{ ...finding, severity: "critical" }] }).success).toBe(false);
  });

  it("rejects more than 3 topIssues", () => {
    expect(conversationAnalysisSchema.safeParse({ topIssues: ["a", "b", "c", "d"] }).success).toBe(false);
  });

  it("rejects a corrected longer than 300 characters", () => {
    expect(conversationAnalysisSchema.safeParse({ findings: [{ ...finding, corrected: "x".repeat(L.text + 1) }] }).success).toBe(false);
  });
});
