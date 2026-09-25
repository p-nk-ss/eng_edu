// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitGaps } from "./clozeParts";

describe("splitGaps", () => {
  it("splits at every gap", () => {
    expect(splitGaps("I have worked here ___ 2019, ___ five years.")).toEqual(["I have worked here ", " 2019, ", " five years."]);
    expect(splitGaps("___ starts")).toEqual(["", " starts"]);
    expect(splitGaps("no gap")).toEqual(["no gap"]);
  });
});
