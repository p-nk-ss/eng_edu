import { z } from "zod";
import type { CefrBand, GrammarVariant } from "../curriculum/parse";
import type { CompleteArgs } from "../llm/types";

export interface GrammarEnrichmentInput {
  level: CefrBand;
  topics: { name: string; variants: GrammarVariant[] }[];
}

/**
 * Response contract for grammar topic enrichment (M3b-1) — the single source of truth for both
 * the SYSTEM prompt text below and `enrichmentSchema`, so the two limits cannot drift apart.
 */
export const ENRICHMENT_LIMITS = {
  title: { min: 3, max: 80 },
  description: { min: 20, max: 400 },
  example: { min: 5, max: 200 },
  noteMax: 200,
} as const;

/** One enriched grammar topic, as stored in data/grammar-topics.json. Join key: `name`. */
export const enrichmentSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(ENRICHMENT_LIMITS.title.min).max(ENRICHMENT_LIMITS.title.max),
    description: z.string().min(ENRICHMENT_LIMITS.description.min).max(ENRICHMENT_LIMITS.description.max),
    example: z.string().min(ENRICHMENT_LIMITS.example.min).max(ENRICHMENT_LIMITS.example.max),
    teachable: z.boolean(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    note: z.string().max(ENRICHMENT_LIMITS.noteMax).default(""),
  })
  .refine((e) => e.teachable || e.note.trim().length > 0, {
    message: "note is required when teachable is false",
    path: ["note"],
  });

export type GrammarEnrichment = z.infer<typeof enrichmentSchema>;

const SYSTEM = [
  "You are an experienced EFL curriculum designer preparing a grammar syllabus for one adult Russian-speaking learner whose goal is conversational fluency.",
  "",
  "You receive grammar items from the CEFR-J Grammar Profile. They are CORPUS PATTERN LABELS, not teaching topics: each has a raw name, one or more variants (a shorthand code plus a sentence type such as AFF. DEC., NEG. DEC., AFF. INT.) and sometimes a note in Japanese describing a corpus extraction constraint (for example: sentence-initial position only). Treat all variants of an item as ONE teaching topic covering that pattern family.",
  "",
  "For every item return an object with exactly these fields:",
  '- "name": the raw item name copied VERBATIM (it is a join key - do not fix, shorten or translate it).',
  `- "title": a learner-facing title in standard textbook terminology, ${ENRICHMENT_LIMITS.title.min}-${ENRICHMENT_LIMITS.title.max} characters, e.g. "Past Perfect (had done)".`,
  `- "description": 1-2 plain-English sentences (${ENRICHMENT_LIMITS.description.min}-${ENRICHMENT_LIMITS.description.max} characters): how the structure is formed and when it is used.`,
  `- "example": one natural spoken-English sentence at the given CEFR level that uses the structure (${ENRICHMENT_LIMITS.example.min}-${ENRICHMENT_LIMITS.example.max} characters).`,
  '- "teachable": false when the item is not worth a lesson of its own at this level - it is trivially below the level, exists only as a corpus-position artefact, or is not a learnable point on its own. Otherwise true.',
  '- "importance": 1, 2 or 3, judged RELATIVE to the other items of the same level in this request. 1 = core for conversational fluency at this level (tenses and aspect, modals, conditionals, passive, question forms, reported speech, relative clauses). 2 = useful. 3 = peripheral or mostly written/formal.',
  `- "note": empty string when teachable is true; when teachable is false, a short reason (max ${ENRICHMENT_LIMITS.noteMax} characters).`,
  "",
  "Return ONLY a JSON array with one object per input item, in the input order. No prose, no markdown fences, no extra fields.",
].join("\n");

/** One-off grammar topic enrichment (M3b-1). Output is validated with enrichmentSchema. */
export function grammarEnrichmentPrompt(input: GrammarEnrichmentInput): CompleteArgs {
  const content =
    `Enrich these ${input.topics.length} CEFR ${input.level} grammar items.\n` +
    JSON.stringify({ level: input.level, topics: input.topics }, null, 2);
  return { system: SYSTEM, messages: [{ role: "user", content }] };
}
