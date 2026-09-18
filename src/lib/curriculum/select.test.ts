// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Theme } from "./themes";
import { parseLevel, pickTheme, pickGrammarFocus, pickVocab, type GrammarCandidate, type VocabCandidate } from "./select";

const T = (key: string): Theme => ({ key, label: key, description: key });
const themes = [T("a"), T("b"), T("c"), T("d")];

describe("parseLevel", () => {
  it("normalizes profile levels to a CEFR band", () => {
    expect(parseLevel("B1+")).toBe("B1");
    expect(parseLevel(" b2 ")).toBe("B2");
    expect(parseLevel("A1.2")).toBe("A1");
  });
  it("throws on an unrecognised level", () => {
    expect(() => parseLevel("intermediate")).toThrow(/level/i);
  });
});

describe("pickTheme", () => {
  it("starts with preferred themes, in THEMES order, when nothing was used yet", () => {
    expect(pickTheme(themes, ["c", "b"], []).key).toBe("b");
    expect(pickTheme(themes, [], []).key).toBe("a");
  });

  it("visits every never-used theme before repeating one", () => {
    expect(pickTheme(themes, ["b"], ["b"]).key).toBe("a");
    expect(pickTheme(themes, ["b"], ["a", "b"]).key).toBe("c");
    expect(pickTheme(themes, ["b"], ["c", "a", "b"]).key).toBe("d");
  });

  it("brings a preferred theme back about twice as fast", () => {
    // ages: d=1, c=2, a=3, b=4 -> scores: d=1, c=2, a=3, b=8 (preferred x2)
    expect(pickTheme(themes, ["b"], ["d", "c", "a", "b"]).key).toBe("b");
    // ages: b=1, d=2, c=3, a=4 -> scores: b=2, d=2, c=3, a=4
    expect(pickTheme(themes, ["b"], ["b", "d", "c", "a"]).key).toBe("a");
    // ages: a=1, b=2, d=3, c=4 -> scores: a=1, b=4, d=3, c=4 -> tie b/c -> preferred wins
    expect(pickTheme(themes, ["b"], ["a", "b", "d", "c"]).key).toBe("b");
  });

  it("is deterministic", () => {
    const recent = ["d", "c", "a", "b"];
    expect(pickTheme(themes, ["b"], recent)).toBe(pickTheme(themes, ["b"], recent));
  });
});

const G = (
  name: string, cefrLevel: string, status: string, sortOrder: number, openErrors = 0,
  extra: Partial<Pick<GrammarCandidate, "teachable" | "importance">> = {},
): GrammarCandidate => ({ name, cefrLevel, status, sortOrder, openErrors, teachable: true, importance: 2, ...extra });

describe("pickGrammarFocus", () => {
  it("prioritises PRACTICING-with-errors > PRACTICING > INTRODUCED > NOT_STARTED, then sortOrder", () => {
    const topics = [
      G("new-1", "B1", "NOT_STARTED", 1),
      G("intro", "B1", "INTRODUCED", 9),
      G("practising", "B1", "PRACTICING", 8),
      G("practising-err", "B1", "PRACTICING", 7, 2),
      G("done", "B1", "MASTERED", 0),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("practising-err");
    expect(pickGrammarFocus(topics.filter((t) => t.openErrors === 0), "B1")?.name).toBe("practising");
    expect(pickGrammarFocus([topics[0], topics[1]], "B1")?.name).toBe("intro");
    expect(pickGrammarFocus([G("x", "B1", "NOT_STARTED", 5), G("y", "B1", "NOT_STARTED", 2)], "B1")?.name).toBe("y");
  });

  it("ignores other levels until the current one is exhausted, then moves up", () => {
    const topics = [G("a2", "A2", "NOT_STARTED", 1), G("b1-done", "B1", "MASTERED", 1), G("b2", "B2", "NOT_STARTED", 1)];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("b2");
  });

  it("returns null when everything from the level upward is mastered", () => {
    expect(pickGrammarFocus([G("x", "C2", "MASTERED", 1)], "C2")).toBeNull();
    expect(pickGrammarFocus([], "B1")).toBeNull();
  });

  it("never picks a non-teachable topic", () => {
    const topics = [G("trivial", "B1", "NOT_STARTED", 1, 0, { teachable: false }), G("real", "B1", "NOT_STARTED", 2)];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("real");
  });

  it("orders by importance before sortOrder inside a status group", () => {
    const topics = [
      G("peripheral", "B1", "NOT_STARTED", 1, 0, { importance: 3 }),
      G("useful", "B1", "NOT_STARTED", 2, 0, { importance: 2 }),
      G("core", "B1", "NOT_STARTED", 9, 0, { importance: 1 }),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("core");
  });

  it("keeps the status group above importance", () => {
    const topics = [
      G("core-new", "B1", "NOT_STARTED", 1, 0, { importance: 1 }),
      G("practising-peripheral", "B1", "PRACTICING", 9, 0, { importance: 3 }),
    ];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("practising-peripheral");
  });

  it("treats a band with only non-teachable topics as exhausted", () => {
    const topics = [G("trivial", "B1", "NOT_STARTED", 1, 0, { teachable: false }), G("b2", "B2", "NOT_STARTED", 1)];
    expect(pickGrammarFocus(topics, "B1")?.name).toBe("b2");
    expect(pickGrammarFocus([topics[0]], "B1")).toBeNull();
  });
});

const V = (
  headword: string, cefrLevel: string, topic: string | null, status = "NEW", lastSeenAt: Date | null = null,
): VocabCandidate => ({ id: headword, headword, cefrLevel, topic, status, lastSeenAt });

describe("pickVocab", () => {
  it("mixes up to 3 LEARNING items (oldest first) with NEW theme words at the level", () => {
    const items = [
      V("learn-new", "A2", "food", "LEARNING", new Date("2026-09-10")),
      V("learn-old", "A2", "city", "LEARNING", new Date("2026-09-01")),
      V("learn-never", "B1", "city", "LEARNING", null),
      V("learn-4th", "B1", "city", "LEARNING", new Date("2026-09-15")),
      ...["f", "e", "d", "c", "b", "a"].map((h) => V(h, "B1", "food")),
      V("known", "B1", "food", "KNOWN"),
      V("other-theme", "B1", "city"),
    ];
    expect(pickVocab(items, "food", "B1").map((v) => v.headword)).toEqual([
      "learn-never", "learn-old", "learn-new", "a", "b", "c", "d", "e",
    ]);
  });

  it("falls back: next band in theme -> general at level -> any NEW at level", () => {
    const items = [
      V("theme-b1", "B1", "food"),
      V("theme-b2", "B2", "food"),
      V("general-b1", "B1", "general"),
      V("untagged-b1", "B1", null),
      V("other-b1", "B1", "city"),
      V("theme-c1", "C1", "food"),
    ];
    expect(pickVocab(items, "food", "B1").map((v) => v.headword)).toEqual([
      "theme-b1", "theme-b2", "general-b1", "other-b1", "untagged-b1",
    ]);
  });

  it("clamps the target to 6..10 and never repeats an item", () => {
    const items = Array.from({ length: 30 }, (_, i) => V(`w${String(i).padStart(2, "0")}`, "B1", "food"));
    expect(pickVocab(items, "food", "B1", 50)).toHaveLength(10);
    expect(pickVocab(items, "food", "B1", 1)).toHaveLength(6);
    const picked = pickVocab(items, "food", "B1");
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
  });

  it("is a total order: same-headword NEW items tie-break on id, regardless of input order", () => {
    const dupA: VocabCandidate = { id: "id-a", headword: "limit", cefrLevel: "B1", topic: "food", status: "NEW", lastSeenAt: null };
    const dupB: VocabCandidate = { id: "id-b", headword: "limit", cefrLevel: "B1", topic: "food", status: "NEW", lastSeenAt: null };
    expect(pickVocab([dupA, dupB], "food", "B1").map((v) => v.id)).toEqual(["id-a", "id-b"]);
    expect(pickVocab([dupB, dupA], "food", "B1").map((v) => v.id)).toEqual(["id-a", "id-b"]);
  });
});
