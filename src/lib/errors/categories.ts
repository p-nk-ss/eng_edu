export const ERROR_GROUPS = ["grammar", "translation", "vocab", "listening", "writing", "general"] as const;
export type ErrorGroup = (typeof ERROR_GROUPS)[number];

export const GROUP_LABELS: Record<ErrorGroup, string> = {
  grammar: "Grammar",
  translation: "Translation",
  vocab: "Vocabulary",
  listening: "Listening",
  writing: "Writing",
  general: "General",
};

type ErrorKey = { category: string; grammarTopicId: string | null };

export function categoryGroup(e: ErrorKey): ErrorGroup {
  if (e.grammarTopicId) return "grammar";
  if (e.category.startsWith("translation:")) return "translation";
  if (e.category.startsWith("vocab:")) return "vocab";
  if (e.category === "listening/spelling") return "listening";
  if (e.category.startsWith("writing:")) return "writing";
  return "general";
}

const PREFIX: Record<string, string> = { "translation:": "Translation", "vocab:": "Word", "writing:": "Writing" };

/** Learner-facing title: the grammar topic's title, else the humanised category. */
export function errorTitle(e: ErrorKey, topicTitle: string | null): string {
  if (e.grammarTopicId && topicTitle) return topicTitle;
  for (const [prefix, label] of Object.entries(PREFIX)) {
    if (e.category.startsWith(prefix)) return `${label} - ${e.category.slice(prefix.length).trim().replace(/_/g, " ")}`;
  }
  if (e.category === "listening/spelling") return "Listening and spelling";
  if (e.category === "general") return "General";
  return e.category;
}
