// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildGrammarEnrichment, buildTopicAssignments, parseProfile } from "./seedExtras";

const csv = (lines: string[]) => ["headword,pos,topic,confidence,rawTopic", ...lines].join("\n") + "\n";

describe("buildTopicAssignments", () => {
  it("maps CSV rows to (headword, pos, topic) with '' for a missing pos", () => {
    expect(buildTopicAssignments(csv(["bread,noun,food,0.910,food", "the,,general,0.300,communication"]))).toEqual([
      { headword: "bread", pos: "noun", topic: "food" },
      { headword: "the", pos: "", topic: "general" },
    ]);
  });

  it("fails loudly on an unknown topic key", () => {
    expect(() => buildTopicAssignments(csv(["bread,noun,bakery,0.9,bakery"]))).toThrow(/bakery/);
  });
});

describe("parseProfile", () => {
  const valid = {
    level: "B1", goals: "fluency", interests: "IT, QA", nativeLang: "ru", preferredThemes: ["technology", "work"],
  };

  it("accepts a valid profile", () => {
    expect(parseProfile(JSON.stringify(valid))).toEqual(valid);
  });

  it("defaults nativeLang and preferredThemes", () => {
    const { nativeLang, preferredThemes, ...rest } = valid;
    expect(parseProfile(JSON.stringify(rest))).toEqual({ ...rest, nativeLang: "ru", preferredThemes: [] });
  });

  it("rejects an unknown preferred theme, naming it", () => {
    expect(() => parseProfile(JSON.stringify({ ...valid, preferredThemes: ["gaming"] }))).toThrow(/gaming/);
  });

  it("rejects 'general' as a preferred theme and an unparseable level", () => {
    expect(() => parseProfile(JSON.stringify({ ...valid, preferredThemes: ["general"] }))).toThrow(/general/);
    expect(() => parseProfile(JSON.stringify({ ...valid, level: "intermediate" }))).toThrow(/level/i);
  });

  it("names the file on malformed JSON", () => {
    expect(() => parseProfile("{ not json")).toThrow(/data\/profile\.json/);
    expect(() => parseProfile("{ not json")).toThrow(/JSON/i);
  });
});

describe("buildGrammarEnrichment", () => {
  const record = (name: string) => ({
    name, title: "Past Perfect (had done)",
    description: "Use had + past participle for an action completed before another past moment.",
    example: "When I arrived, the meeting had already started.", teachable: true, importance: 1, note: "",
  });
  const known = new Set(["A", "B"]);

  it("returns validated records for known topics", () => {
    expect(buildGrammarEnrichment(JSON.stringify([record("A"), record("B")]), known).map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("fails naming a topic that is not in the syllabus", () => {
    expect(() => buildGrammarEnrichment(JSON.stringify([record("Ghost")]), known)).toThrow(/Ghost/);
  });

  it("fails naming a duplicated topic", () => {
    expect(() => buildGrammarEnrichment(JSON.stringify([record("A"), record("A")]), known)).toThrow(/duplicate.*"A"/);
  });
});
