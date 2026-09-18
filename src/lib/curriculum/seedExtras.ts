import { z } from "zod";
import { parseTopicRows } from "./classify";
import { parseLevel } from "./select";
import { isTopicKey, THEME_KEYS } from "./themes";

export interface TopicAssignment {
  headword: string;
  pos: string;
  topic: string;
}

/** data/vocab-topics.csv -> rows for the seed's bulk UPDATE. Unknown topic keys abort the seed. */
export function buildTopicAssignments(csvText: string): TopicAssignment[] {
  return parseTopicRows(csvText).map((r) => {
    if (!isTopicKey(r.topic)) {
      throw new Error(`vocab-topics.csv: unknown topic "${r.topic}" for "${r.headword}" — not a key in themes.ts`);
    }
    return { headword: r.headword, pos: r.pos, topic: r.topic };
  });
}

const profileSchema = z.object({
  level: z.string().refine(
    (v) => {
      try {
        parseLevel(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "level must contain a CEFR band, e.g. \"B1\" or \"B1+\"" },
  ),
  goals: z.string(),
  interests: z.string(),
  nativeLang: z.string().default("ru"),
  preferredThemes: z
    .array(z.string())
    .superRefine((keys, ctx) => {
      for (const k of keys) {
        if (!THEME_KEYS.has(k)) ctx.addIssue({ code: "custom", message: `unknown theme key "${k}" (see src/lib/curriculum/themes.ts)` });
      }
    })
    .default([]),
});

export type ProfileSeed = z.infer<typeof profileSchema>;

export function parseProfile(jsonText: string): ProfileSeed {
  const res = profileSchema.safeParse(JSON.parse(jsonText));
  if (!res.success) {
    throw new Error("data/profile.json is invalid: " + res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return res.data;
}
