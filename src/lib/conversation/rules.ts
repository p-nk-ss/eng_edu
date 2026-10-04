export const TARGET_TURNS = 8;
export const MAX_TURNS = 12;
export const MIN_TURNS_FOR_REVIEW = 2;
export const MAX_TURN_CHARS = 600;

export type ConversationStatusName = "ACTIVE" | "ANALYZED" | "SKIPPED" | "UNAVAILABLE";

export const learnerTurnCount = (turns: { role: string }[]): number => turns.filter((t) => t.role === "learner").length;
/** True for the partner reply that answers the TARGET_TURNS-th learner turn. */
export const shouldWrapUp = (learnerTurnsIncludingThis: number): boolean => learnerTurnsIncludingThis === TARGET_TURNS;

export function canSend(status: ConversationStatusName | null, learnerTurns: number): "ok" | "closed" | "limit" {
  if (status !== "ACTIVE" && status !== "UNAVAILABLE") return "closed";
  return learnerTurns >= MAX_TURNS ? "limit" : "ok";
}

export const finishOutcome = (learnerTurns: number): "analyze" | "skip" => (learnerTurns >= MIN_TURNS_FOR_REVIEW ? "analyze" : "skip");

/** Appended to the client turn stream (never persisted) when the partner drops mid-reply. */
export const CONNECTION_LOST_MARKER = "\n[connection lost]";
