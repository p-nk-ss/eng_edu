// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { TypeSafeClient } from "../typesafe/client";
import { VALID_EXERCISES } from "./fixtures";
import { runQualityGate } from "./qualityGate";

const grammar = { title: "Past Perfect (had done)", description: "had + past participle." };
const E = VALID_EXERCISES;

function fakeClient(scoreFor: (state: Record<string, unknown>) => Partial<Record<string, number>>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const systemOne = vi.fn(async (req: { state: unknown; questions: Record<string, unknown> }) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const scores = scoreFor(req.state as Record<string, unknown>);
    const answers = Object.fromEntries(Object.keys(req.questions).map((k) => [k, { type: "noul", noul: scores[k] ?? 0.9 }]));
    return { answers, usage: { input_tokens: 1, output_tokens: 1 } };
  });
  return { client: { systemOne } as unknown as TypeSafeClient, systemOne, max: () => maxInFlight };
}

describe("runQualityGate", () => {
  it("sends ONE exercise per request and skips ungated types", async () => {
    const f = fakeClient(() => ({ other_correct: 0.05 }));
    const res = await runQualityGate([E.MULTIPLE_CHOICE, E.MATCH, E.TRANSLATION, E.FILL_BLANK], grammar, f.client);
    expect(f.systemOne).toHaveBeenCalledTimes(2);
    expect(res.status).toBe("passed");
    expect(res.verdicts.map((v) => [v.index, v.gated, v.drop])).toEqual([
      [0, true, false], [1, false, false], [2, false, false], [3, true, false],
    ]);
  });

  it("drops an exercise on a confident failure and reports partial", async () => {
    const f = fakeClient((state) => (String(state.sentence).startsWith("She had") ? { key_correct: 0.05, other_correct: 0.05 } : { other_correct: 0.05 }));
    const res = await runQualityGate([E.MULTIPLE_CHOICE, E.DIALOGUE_GAP], grammar, f.client);
    expect(res.status).toBe("partial");
    expect(res.verdicts[0]).toMatchObject({ drop: true });
    expect(res.verdicts[0].reason).toMatch(/keyed answer/);
    expect(res.verdicts[1]).toMatchObject({ drop: false });
  });

  it("keeps an exercise when Jev is unsure", async () => {
    const f = fakeClient(() => ({ key_correct: 0.5, other_correct: 0.5, on_focus: 0.5 }));
    expect((await runQualityGate([E.MULTIPLE_CHOICE], grammar, f.client)).verdicts[0].drop).toBe(false);
  });

  it("never has more than 4 requests in flight", async () => {
    const f = fakeClient(() => ({ other_correct: 0.05 }));
    await runQualityGate(Array.from({ length: 10 }, () => E.MULTIPLE_CHOICE), grammar, f.client);
    expect(f.systemOne).toHaveBeenCalledTimes(10);
    expect(f.max()).toBeLessThanOrEqual(4);
  });

  it("is skipped (nothing dropped) without a client or when the client fails", async () => {
    const none = await runQualityGate([E.MULTIPLE_CHOICE], grammar, null);
    expect(none).toMatchObject({ status: "skipped" });
    expect(none.verdicts[0].drop).toBe(false);

    const failing = { systemOne: vi.fn().mockRejectedValue(new Error("HTTP 504")) } as unknown as TypeSafeClient;
    const res = await runQualityGate([E.MULTIPLE_CHOICE, E.DIALOGUE_GAP], grammar, failing);
    expect(res.status).toBe("skipped");
    expect(res.verdicts.every((v) => !v.drop)).toBe(true);
  });
});
