// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildTopicAssignments, parseProfile } from "./seedExtras";

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
