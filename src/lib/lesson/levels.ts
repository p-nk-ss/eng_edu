const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** "B1+" counts as its base level "B1" for ordering purposes. */
function normalize(level: string): string {
  return level.endsWith("+") ? level.slice(0, -1) : level;
}

/** Whether `topicLevel` is strictly below `learnerLevel` in CEFR order. Unknown values -> false. */
export function isBelowLevel(topicLevel: string, learnerLevel: string): boolean {
  const topicIndex = CEFR_ORDER.indexOf(normalize(topicLevel));
  const learnerIndex = CEFR_ORDER.indexOf(normalize(learnerLevel));
  if (topicIndex === -1 || learnerIndex === -1) return false;
  return topicIndex < learnerIndex;
}
