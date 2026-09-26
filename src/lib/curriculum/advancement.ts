import { isBelowLevel } from "../lesson/levels";

export const GOOD_LESSON_SCORE = 0.8;
export const LESSONS_TO_MASTER = 3;
export const LESSONS_TO_MASTER_BELOW_LEVEL = 1;
export const PARK_AFTER_LESSONS = 5;

export type TopicStatusName = "NOT_STARTED" | "INTRODUCED" | "PRACTICING" | "MASTERED";

/** True for a core topic (importance 1) whose CEFR level is strictly below the learner's. */
export function isBelowLevelCore(topic: { importance: number; cefrLevel: string }, learnerLevel: string | null): boolean {
  return topic.importance === 1 && learnerLevel !== null && isBelowLevel(topic.cefrLevel, learnerLevel);
}

/** The written block is complete when every playable written exercise has an answer. */
export function writtenBlockScore(items: { answered: boolean; correct: boolean | null }[]): { complete: boolean; score: number | null } {
  if (items.length === 0 || items.some((i) => !i.answered)) return { complete: false, score: null };
  return { complete: true, score: items.filter((i) => i.correct === true).length / items.length };
}

export const lessonsToMaster = (belowLevelCore: boolean): number => (belowLevelCore ? LESSONS_TO_MASTER_BELOW_LEVEL : LESSONS_TO_MASTER);

/** Status and cached counters derived from the writtenScore history of completed lessons with this focus. */
export function nextTopicState(
  current: TopicStatusName,
  scores: number[],
  opts: { belowLevelCore: boolean },
): { status: TopicStatusName; lessonsCompleted: number; goodLessons: number } {
  const lessonsCompleted = scores.length;
  const goodLessons = scores.filter((s) => s >= GOOD_LESSON_SCORE).length;
  let status = current;
  if (current !== "MASTERED" && lessonsCompleted > 0) {
    status = goodLessons >= lessonsToMaster(opts.belowLevelCore) ? "MASTERED" : "PRACTICING";
  }
  return { status, lessonsCompleted, goodLessons };
}

/** A topic that did not stick after PARK_AFTER_LESSONS lessons is chosen only after untouched topics. */
export const isParked = (t: { status: string; lessonsCompleted: number }): boolean =>
  t.status === "PRACTICING" && t.lessonsCompleted >= PARK_AFTER_LESSONS;
