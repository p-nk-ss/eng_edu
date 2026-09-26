// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isBelowLevelCore, isParked, lessonsToMaster, nextTopicState, writtenBlockScore } from "./advancement";

const item = (answered: boolean, correct: boolean | null = answered ? true : null) => ({ answered, correct });

describe("writtenBlockScore", () => {
  it("is incomplete while any item is unanswered", () => {
    expect(writtenBlockScore([item(true), item(false)])).toEqual({ complete: false, score: null });
  });
  it("scores correct / total once every item is answered", () => {
    expect(writtenBlockScore([item(true, true), item(true, false), item(true, true), item(true, true)])).toEqual({ complete: true, score: 0.75 });
  });
  it("counts a missing verdict as not correct", () => {
    expect(writtenBlockScore([item(true, true), item(true, null)])).toEqual({ complete: true, score: 0.5 });
  });
  it("an empty block never completes", () => {
    expect(writtenBlockScore([])).toEqual({ complete: false, score: null });
  });
});

describe("nextTopicState", () => {
  const std = { belowLevelCore: false };
  it("leaves a topic without completed lessons as it is", () => {
    expect(nextTopicState("INTRODUCED", [], std)).toEqual({ status: "INTRODUCED", lessonsCompleted: 0, goodLessons: 0 });
    expect(nextTopicState("NOT_STARTED", [], std)).toEqual({ status: "NOT_STARTED", lessonsCompleted: 0, goodLessons: 0 });
  });
  it("moves to PRACTICING after the first completed lesson, even a weak one", () => {
    expect(nextTopicState("INTRODUCED", [0.71], std)).toEqual({ status: "PRACTICING", lessonsCompleted: 1, goodLessons: 0 });
  });
  it("masters after 3 good lessons, not necessarily consecutive", () => {
    expect(nextTopicState("PRACTICING", [0.85, 0.6, 0.9], std).status).toBe("PRACTICING");
    expect(nextTopicState("PRACTICING", [0.85, 0.6, 0.9, 0.8], std)).toEqual({ status: "MASTERED", lessonsCompleted: 4, goodLessons: 3 });
  });
  it("treats exactly 80% as good", () => {
    expect(nextTopicState("PRACTICING", [0.8, 0.8, 0.8], std).status).toBe("MASTERED");
    expect(nextTopicState("PRACTICING", [0.79, 0.8, 0.8], std).status).toBe("PRACTICING");
  });
  it("masters a below-level core topic after one good lesson", () => {
    expect(nextTopicState("INTRODUCED", [0.86], { belowLevelCore: true })).toEqual({ status: "MASTERED", lessonsCompleted: 1, goodLessons: 1 });
    expect(nextTopicState("INTRODUCED", [0.71], { belowLevelCore: true }).status).toBe("PRACTICING");
  });
  it("never reverts MASTERED", () => {
    expect(nextTopicState("MASTERED", [0.1], std)).toEqual({ status: "MASTERED", lessonsCompleted: 1, goodLessons: 0 });
  });
});

describe("isBelowLevelCore", () => {
  it("is true for a core (importance 1) topic strictly below the learner's level", () => {
    expect(isBelowLevelCore({ importance: 1, cefrLevel: "A2" }, "B1")).toBe(true);
  });
  it("is false when the topic is not core (importance !== 1)", () => {
    expect(isBelowLevelCore({ importance: 2, cefrLevel: "A2" }, "B1")).toBe(false);
  });
  it("is false when the learner level is null", () => {
    expect(isBelowLevelCore({ importance: 1, cefrLevel: "A2" }, null)).toBe(false);
  });
  it("is false when the core topic is at the learner's level, not below it", () => {
    expect(isBelowLevelCore({ importance: 1, cefrLevel: "B1" }, "B1")).toBe(false);
  });
});

describe("lessonsToMaster / isParked", () => {
  it("needs 1 or 3 good lessons", () => {
    expect(lessonsToMaster(true)).toBe(1);
    expect(lessonsToMaster(false)).toBe(3);
  });
  it("parks a PRACTICING topic after 5 completed lessons", () => {
    expect(isParked({ status: "PRACTICING", lessonsCompleted: 4 })).toBe(false);
    expect(isParked({ status: "PRACTICING", lessonsCompleted: 5 })).toBe(true);
    expect(isParked({ status: "INTRODUCED", lessonsCompleted: 9 })).toBe(false);
    expect(isParked({ status: "MASTERED", lessonsCompleted: 9 })).toBe(false);
  });
});
