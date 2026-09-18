import { describe, it, expect } from "vitest";
import {
  normalizeCefrLevel,
  parseGrammarRows,
  parseVocabRows,
  mergeVocab,
  collectGrammarVariants,
} from "./parse";

describe("normalizeCefrLevel", () => {
  it("strips sub-levels and markers", () => {
    expect(normalizeCefrLevel("A1.1")).toBe("A1");
    expect(normalizeCefrLevel("B2.2*")).toBe("B2");
    expect(normalizeCefrLevel("A1")).toBe("A1");
  });
  it("takes the first band from a range", () => {
    expect(normalizeCefrLevel("A1-A2")).toBe("A1");
  });
  it("returns null for empty or non-band values", () => {
    expect(normalizeCefrLevel("")).toBeNull();
    expect(normalizeCefrLevel(undefined)).toBeNull();
    expect(normalizeCefrLevel("(SUBORDINATE CLAUSE)")).toBeNull();
  });
});

describe("parseGrammarRows", () => {
  const header = [
    "ID","Shorthand Code","Grammatical Item","Sentence Type",
    "CEFR-J Level","FREQ*DISP","Core Inventory","EGP","GSELO","Notes",
  ];

  it("maps name + normalized level and orders within a level", () => {
    const rows = [
      header,
      ["1", "PP.I_am", "I am", "AFF. DEC.", "A1.1", "A1", "A1", "A1", "A1", ""],
      ["2", "PP.you_are", "you are", "AFF. DEC.", "A1.2", "A1", "A1", "A1", "A1", ""],
    ];
    expect(parseGrammarRows(rows)).toEqual([
      { name: "I am", cefrLevel: "A1", category: null, sortOrder: 1 },
      { name: "you are", cefrLevel: "A1", category: null, sortOrder: 2 },
    ]);
  });

  it("falls back to Core Inventory when CEFR-J Level is blank", () => {
    const rows = [header, ["1-2", "PP.am_I", "Am I ...?", "AFF. INT.", "", "", "A2", "A1-A2", "A1", ""]];
    expect(parseGrammarRows(rows)[0]).toMatchObject({ name: "Am I ...?", cefrLevel: "A2" });
  });

  it("skips rows with no usable level or no name", () => {
    const rows = [
      header,
      ["9", "X", "", "", "A1", "", "", "", "", ""], // no name
      ["10", "Y", "orphan", "", "", "", "", "", "", ""], // no level anywhere
    ];
    expect(parseGrammarRows(rows)).toEqual([]);
  });

  it("dedups by name (keeps first)", () => {
    const rows = [
      header,
      ["1", "a", "I am", "", "A1", "", "", "", "", ""],
      ["2", "b", "I am", "", "B1", "", "", "", "", ""],
    ];
    expect(parseGrammarRows(rows)).toEqual([
      { name: "I am", cefrLevel: "A1", category: null, sortOrder: 1 },
    ]);
  });
});

describe("parseVocabRows", () => {
  const header = ["headword", "pos", "CEFR", "x", "y", "z"];

  it("maps headword/pos/level with topic null and isPhrase from opts", () => {
    const rows = [header, ["abandon", "verb", "B1", "", "", ""]];
    expect(parseVocabRows(rows)).toEqual([
      { headword: "abandon", pos: "verb", cefrLevel: "B1", isPhrase: false, topic: null },
    ]);
    expect(parseVocabRows(rows, { isPhrase: true })[0].isPhrase).toBe(true);
  });

  it("skips rows without a valid level", () => {
    const rows = [header, ["weird", "noun", "", "", "", ""]];
    expect(parseVocabRows(rows)).toEqual([]);
  });
});

describe("mergeVocab", () => {
  it("keeps the first source on (headword,pos) collision", () => {
    const a = [{ headword: "set", pos: "verb", cefrLevel: "A2" as const, isPhrase: false, topic: null }];
    const b = [
      { headword: "set", pos: "verb", cefrLevel: "C1" as const, isPhrase: false, topic: null },
      { headword: "cloak", pos: "noun", cefrLevel: "C1" as const, isPhrase: false, topic: null },
    ];
    const merged = mergeVocab(a, b);
    expect(merged).toEqual([
      { headword: "set", pos: "verb", cefrLevel: "A2", isPhrase: false, topic: null },
      { headword: "cloak", pos: "noun", cefrLevel: "C1", isPhrase: false, topic: null },
    ]);
  });
});

describe("collectGrammarVariants", () => {
  const header = ["ID", "Shorthand Code", "Grammatical Item", "Sentence Type", "CEFR-J Level", "F", "CI", "EGP", "GSELO", "Notes"];
  const rows = [
    header,
    ["62", "TA.PRPF.AFF", "TENSE/ASPECT: PRESENT PERFECT", "AFF. DEC.", "A2.2", "", "", "", "", ""],
    ["62-1", "TA.PRPF.NEG", " TENSE/ASPECT: PRESENT PERFECT ", "NEG. DEC.", "B1.1", "", "", "", "", "note-neg"],
    ["2", "PP.you_are", "You are", "AFF. DEC.", "B1.1", "", "", "", "", "note-you"],
    ["x", "NO.NAME", "  ", "AFF. DEC.", "A1", "", "", "", "", ""],
    ["short"],
  ];

  it("groups every row by trimmed name, in file order", () => {
    const v = collectGrammarVariants(rows);
    expect([...v.keys()]).toEqual(["TENSE/ASPECT: PRESENT PERFECT", "You are"]);
    expect(v.get("TENSE/ASPECT: PRESENT PERFECT")).toEqual([
      { shorthand: "TA.PRPF.AFF", sentenceType: "AFF. DEC.", note: "" },
      { shorthand: "TA.PRPF.NEG", sentenceType: "NEG. DEC.", note: "note-neg" },
    ]);
    expect(v.get("You are")).toEqual([{ shorthand: "PP.you_are", sentenceType: "AFF. DEC.", note: "note-you" }]);
  });

  it("skips the header, blank names and short rows", () => {
    expect(collectGrammarVariants([header]).size).toBe(0);
    expect(collectGrammarVariants(rows).has("")).toBe(false);
  });
});
