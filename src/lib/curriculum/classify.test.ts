// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { VocabSeed } from "./parse";
import type { ChoiceAnswer } from "../typesafe/client";
import {
  wordKey, TOPIC_CRITERIA, buildBatch, resolveTopic, stratifiedSample, pendingWords, chunk,
  TOPIC_CSV_HEADER, toCsvLine, parseTopicRows, sortTopicRows,
} from "./classify";

const w = (headword: string, pos: string | null, cefrLevel: VocabSeed["cefrLevel"] = "A1"): VocabSeed => ({
  headword, pos, cefrLevel, isPhrase: false, topic: null,
});

describe("classify helpers", () => {
  it("builds one Choice question per word, referencing its state path", () => {
    const { state, questions } = buildBatch([w("bread", "noun"), w("the", null, "A1")]);
    expect(state.words).toEqual([
      { headword: "bread", pos: "noun", cefr: "A1" },
      { headword: "the", pos: "", cefr: "A1" },
    ]);
    expect(Object.keys(questions)).toEqual(["w0", "w1"]);
    expect(questions.w1.type).toBe("choice");
    expect(String(questions.w1.instructions)).toContain("`words[1]`");
    expect(questions.w0.criteria).toBe(TOPIC_CRITERIA);
  });

  it("offers all 21 themes plus general as criteria", () => {
    expect(Object.keys(TOPIC_CRITERIA)).toHaveLength(22);
    expect(TOPIC_CRITERIA.general).toMatch(/function words/);
  });

  it("keeps a confident choice and demotes an unsure one to general", () => {
    const ans = (choice: string, confidence: number): ChoiceAnswer =>
      ({ type: "choice", choice, probabilities: {}, confidence });
    expect(resolveTopic(ans("food", 0.91), 0.5)).toEqual({ topic: "food", confidence: 0.91, rawTopic: "food" });
    expect(resolveTopic(ans("food", 0.31), 0.5)).toEqual({ topic: "general", confidence: 0.31, rawTopic: "food" });
  });

  it("samples evenly and deterministically within each CEFR level", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => w(`a${i}`, "noun", "A1")),
      ...Array.from({ length: 3 }, (_, i) => w(`b${i}`, "noun", "B1")),
    ];
    const sample = stratifiedSample(items, 5);
    expect(sample.map((s) => s.headword)).toEqual(["a0", "a2", "a4", "a6", "a8", "b0", "b1", "b2"]);
    expect(stratifiedSample(items, 5)).toEqual(sample);
  });

  it("skips words that are already classified (resume)", () => {
    const vocab = [w("bread", "noun"), w("the", null)];
    const done = [{ headword: "the", pos: "", topic: "general", confidence: 0.9, rawTopic: "general" }];
    expect(pendingWords(vocab, done).map((v) => v.headword)).toEqual(["bread"]);
    expect(wordKey("the", null)).toBe(wordKey("the", ""));
  });

  it("chunks into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("round-trips CSV rows, quoting commas and quotes", () => {
    const rows = [
      { headword: 'well, "now"', pos: "adverb", topic: "general", confidence: 0.4213, rawTopic: "communication" },
      { headword: "bread", pos: "", topic: "food", confidence: 0.9, rawTopic: "food" },
    ];
    const text = [TOPIC_CSV_HEADER, ...rows.map(toCsvLine)].join("\n") + "\n";
    expect(text.split("\n")[0]).toBe("headword,pos,topic,confidence,rawTopic");
    expect(parseTopicRows(text)).toEqual([
      { ...rows[0], confidence: 0.421 },
      rows[1],
    ]);
  });

  it("sorts rows by headword then pos for stable diffs", () => {
    const r = (headword: string, pos: string) => ({ headword, pos, topic: "general", confidence: 1, rawTopic: "general" });
    expect(sortTopicRows([r("b", "noun"), r("a", "verb"), r("a", "noun")]).map((x) => `${x.headword}/${x.pos}`))
      .toEqual(["a/noun", "a/verb", "b/noun"]);
  });
});
