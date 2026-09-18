import type { ExerciseContent } from "./exerciseSchemas";
import { gateQuestions, gateState, gateVerdict, isGated, type GateGrammar } from "../prompts/exerciseGate";
import type { TypeSafeClient } from "../typesafe/client";

export interface GateVerdict {
  index: number;
  gated: boolean;
  drop: boolean;
  reason?: string;
  scores?: Record<string, number>;
}
export interface GateResult {
  status: "passed" | "partial" | "skipped";
  verdicts: GateVerdict[];
}

const CONCURRENCY = 4;

/**
 * Jev answer-key gate. One exercise per request (shared state contaminates answers), at most
 * 4 in flight. Best effort: no client or ANY client error -> "skipped", nothing dropped.
 */
export async function runQualityGate(
  exercises: ExerciseContent[],
  grammar: GateGrammar | null,
  client: TypeSafeClient | null,
): Promise<GateResult> {
  const keepAll = (): GateVerdict[] => exercises.map((c, index) => ({ index, gated: isGated(c), drop: false }));
  if (!client) return { status: "skipped", verdicts: keepAll() };

  const verdicts = keepAll();
  const queue = verdicts.filter((v) => v.gated).map((v) => v.index);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < queue.length) {
      const index = queue[next++];
      const c = exercises[index];
      const res = await client!.systemOne({ state: gateState(c, grammar), questions: gateQuestions(c, grammar) });
      const scores = Object.fromEntries(Object.entries(res.answers).map(([k, a]) => [k, "noul" in a ? a.noul : 0]));
      const reason = gateVerdict(scores);
      verdicts[index] = { index, gated: true, drop: reason !== null, scores, ...(reason ? { reason } : {}) };
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } catch {
    return { status: "skipped", verdicts: keepAll() };
  }
  return { status: verdicts.some((v) => v.drop) ? "partial" : "passed", verdicts };
}
