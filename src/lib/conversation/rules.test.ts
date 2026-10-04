// @vitest-environment node
import { describe, it, expect } from "vitest";
import { canSend, finishOutcome, learnerTurnCount, shouldWrapUp, MAX_TURNS, TARGET_TURNS } from "./rules";

describe("conversation rules", () => {
  it("counts learner turns only", () => {
    expect(learnerTurnCount([{ role: "partner" }, { role: "learner" }, { role: "partner" }, { role: "learner" }])).toBe(2);
  });
  it("wraps up on the reply to the 8th learner turn only", () => {
    expect(TARGET_TURNS).toBe(8);
    expect(shouldWrapUp(7)).toBe(false);
    expect(shouldWrapUp(8)).toBe(true);
    expect(shouldWrapUp(9)).toBe(false);
  });
  it("allows sending only while active and under the cap", () => {
    expect(MAX_TURNS).toBe(12);
    expect(canSend("ACTIVE", 11)).toBe("ok");
    expect(canSend("ACTIVE", 12)).toBe("limit");
    expect(canSend("ANALYZED", 3)).toBe("closed");
    expect(canSend("SKIPPED", 0)).toBe("closed");
    expect(canSend(null, 0)).toBe("closed");
    expect(canSend("UNAVAILABLE", 0)).toBe("ok"); // a retry after an outage reopens the conversation
  });
  it("analyses from 2 learner turns", () => {
    expect(finishOutcome(1)).toBe("skip");
    expect(finishOutcome(2)).toBe("analyze");
  });
});
