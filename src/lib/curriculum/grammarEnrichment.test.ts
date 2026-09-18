// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { GrammarSeed } from "./parse";
import {
  enrichmentSchema, batchByLevel, pendingTopics, validateBatch,
  parseEnrichmentFile, serializeEnrichmentFile, pilotSample, type GrammarEnrichment,
} from "./grammarEnrichment";

const T = (name: string, cefrLevel: GrammarSeed["cefrLevel"], sortOrder: number): GrammarSeed =>
  ({ name, cefrLevel, category: null, sortOrder });

const rec = (over: Partial<GrammarEnrichment> = {}): GrammarEnrichment => ({
  name: "TENSE/ASPECT: PAST PERFECT",
  title: "Past Perfect (had done)",
  description: "Use had + past participle for an action completed before another past moment.",
  example: "When I arrived, the meeting had already started.",
  teachable: true,
  importance: 1,
  note: "",
  ...over,
});

describe("enrichmentSchema", () => {
  it("accepts a full record and defaults note", () => {
    const { note, ...noNote } = rec();
    expect(enrichmentSchema.parse(noNote)).toEqual(rec());
  });

  it("requires a note when the topic is not teachable", () => {
    expect(enrichmentSchema.safeParse(rec({ teachable: false, note: "  " })).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ teachable: false, note: "trivial at B1" })).success).toBe(true);
  });

  it("restricts importance to 1, 2 or 3 and enforces length limits", () => {
    expect(enrichmentSchema.safeParse({ ...rec(), importance: 4 }).success).toBe(false);
    expect(enrichmentSchema.safeParse({ ...rec(), importance: "1" }).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ title: "ab" })).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ description: "too short" })).success).toBe(false);
    expect(enrichmentSchema.safeParse(rec({ title: "x".repeat(81) })).success).toBe(false);
  });
});

describe("batchByLevel", () => {
  it("never mixes levels, keeps sortOrder inside a level, walks A1 to C2", () => {
    const topics = [T("b1-2", "B1", 2), T("a2-1", "A2", 1), T("b1-1", "B1", 1), T("b1-3", "B1", 3)];
    expect(batchByLevel(topics, 2).map((b) => [b.level, b.topics.map((t) => t.name)])).toEqual([
      ["A2", ["a2-1"]],
      ["B1", ["b1-1", "b1-2"]],
      ["B1", ["b1-3"]],
    ]);
  });

  it("defaults to 15 per batch", () => {
    const topics = Array.from({ length: 31 }, (_, i) => T(`t${i}`, "A1", i));
    expect(batchByLevel(topics).map((b) => b.topics.length)).toEqual([15, 15, 1]);
  });
});

describe("pendingTopics", () => {
  it("drops topics that are already enriched", () => {
    expect(pendingTopics([T("a", "A1", 1), T("b", "A1", 2)], [{ name: "a" }]).map((t) => t.name)).toEqual(["b"]);
  });
});

describe("validateBatch", () => {
  it("passes when every requested name is returned exactly once", () => {
    expect(() => validateBatch(["a", "b"], [{ name: "b" }, { name: "a" }])).not.toThrow();
  });
  it("names missing, unexpected and duplicated topics", () => {
    expect(() => validateBatch(["a", "b"], [{ name: "a" }])).toThrow(/missing.*"b"/);
    expect(() => validateBatch(["a"], [{ name: "a" }, { name: "zzz" }])).toThrow(/unexpected.*"zzz"/);
    expect(() => validateBatch(["a"], [{ name: "a" }, { name: "a" }])).toThrow(/duplicate.*"a"/);
  });
});

describe("enrichment file", () => {
  it("round-trips, sorted by name, pretty-printed with a trailing newline", () => {
    const text = serializeEnrichmentFile([rec({ name: "b" }), rec({ name: "a" })]);
    expect(text.endsWith("]\n")).toBe(true);
    expect(text).toContain('\n  {\n    "name": "a"');
    expect(parseEnrichmentFile(text).map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("treats an empty file as no records and rejects invalid content with the file name", () => {
    expect(parseEnrichmentFile("  \n")).toEqual([]);
    expect(() => parseEnrichmentFile("{ nope")).toThrow(/grammar-topics/);
    expect(() => parseEnrichmentFile(JSON.stringify([{ name: "x" }]))).toThrow(/grammar-topics/);
  });
});

describe("pilotSample", () => {
  it("takes the first 15 A2 and first 15 B1 topics by sortOrder", () => {
    const topics = [
      ...Array.from({ length: 20 }, (_, i) => T(`a2-${i}`, "A2", 20 - i)),
      ...Array.from({ length: 3 }, (_, i) => T(`b1-${i}`, "B1", i)),
      T("a1", "A1", 1),
    ];
    const sample = pilotSample(topics);
    expect(sample).toHaveLength(18);
    expect(sample[0].name).toBe("a2-19"); // sortOrder 1
    expect(sample.some((t) => t.cefrLevel === "A1")).toBe(false);
  });
});
