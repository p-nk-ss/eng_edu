// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isBelowLevel } from "./levels";

describe("isBelowLevel", () => {
  it("is true when the topic level is strictly below the learner level", () => {
    expect(isBelowLevel("A2", "B1")).toBe(true);
  });

  it("treats B1+ as B1, so B1 is not below B1+", () => {
    expect(isBelowLevel("B1", "B1+")).toBe(false);
  });

  it("is false when the topic level is above the learner level", () => {
    expect(isBelowLevel("C1", "B2")).toBe(false);
  });

  it("is false for unknown level values", () => {
    expect(isBelowLevel("XX", "B1")).toBe(false);
    expect(isBelowLevel("A2", "XX")).toBe(false);
  });
});
