// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MAX_REVIEW, planReview, type DueError } from "./planReview";

const d = (id: string, category: string, over: Partial<DueError> = {}): DueError => ({
  id, category, grammarTopicId: null, description: "- a -> b", nextReviewAt: new Date("2026-09-27T06:00:00Z"), createdAt: new Date("2026-09-26T06:00:00Z"), ...over,
});
const titles = new Map([["g1", "Comparative with more"]]);

describe("planReview", () => {
  it("takes at most MAX_REVIEW, most overdue first, with total tie-breaks", () => {
    const due = [
      d("e3", "general", { nextReviewAt: new Date("2026-09-28T00:00:00Z") }),
      d("e2", "general", { createdAt: new Date("2026-09-25T00:00:00Z") }),
      d("e1", "general"),
      d("e0", "general"),
      d("e9", "general", { nextReviewAt: new Date("2026-09-20T00:00:00Z") }),
    ];
    expect(MAX_REVIEW).toBe(3);
    expect(planReview(due, titles).map((r) => r.errorId)).toEqual(["e9", "e2", "e0"]);
  });

  it("chooses the exercise type from the error", () => {
    const due = [
      d("a", "Comparative with more", { grammarTopicId: "g1", nextReviewAt: new Date("2026-09-20T00:00:00Z") }),
      d("b", "Comparative with more", { grammarTopicId: "g1", nextReviewAt: new Date("2026-09-21T00:00:00Z") }),
      d("c", "translation: meaning", { nextReviewAt: new Date("2026-09-22T00:00:00Z") }),
    ];
    expect(planReview(due, titles).map((r) => [r.type, r.grammarTitle])).toEqual([
      ["FILL_BLANK", "Comparative with more"],
      ["ERROR_CORRECTION", "Comparative with more"],
      ["TRANSLATION", null],
    ]);
    const more = [d("v", "vocab: deadline"), d("g", "general"), d("l", "listening/spelling"), d("w", "writing: grammar"), d("x", "something else")];
    expect(more.map((e) => planReview([e], titles)[0].type)).toEqual(["MULTIPLE_CHOICE", "MULTIPLE_CHOICE", "DICTATION", "ERROR_CORRECTION", "MULTIPLE_CHOICE"]);
  });

  it("keeps the last three examples without the list marker", () => {
    const e = d("a", "general", { description: "- one -> 1\n- two -> 2\n- three -> 3\n- four -> 4" });
    expect(planReview([e], titles)[0].examples).toEqual(["two -> 2", "three -> 3", "four -> 4"]);
  });

  it("returns nothing for no due errors", () => {
    expect(planReview([], titles)).toEqual([]);
  });
});
