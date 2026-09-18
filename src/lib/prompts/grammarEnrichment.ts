import type { CefrBand, GrammarVariant } from "../curriculum/parse";

export interface GrammarEnrichmentInput {
  level: CefrBand;
  topics: { name: string; variants: GrammarVariant[] }[];
}

const SYSTEM = [
  "You are an experienced EFL curriculum designer preparing a grammar syllabus for one adult Russian-speaking learner whose goal is conversational fluency.",
  "",
  "You receive grammar items from the CEFR-J Grammar Profile. They are CORPUS PATTERN LABELS, not teaching topics: each has a raw name, one or more variants (a shorthand code plus a sentence type such as AFF. DEC., NEG. DEC., AFF. INT.) and sometimes a note in Japanese describing a corpus extraction constraint (for example: sentence-initial position only). Treat all variants of an item as ONE teaching topic covering that pattern family.",
  "",
  "For every item return an object with exactly these fields:",
  '- "name": the raw item name copied VERBATIM (it is a join key - do not fix, shorten or translate it).',
  '- "title": a learner-facing title in standard textbook terminology, 3-80 characters, e.g. "Past Perfect (had done)".',
  '- "description": 1-2 plain-English sentences (20-400 characters): how the structure is formed and when it is used.',
  '- "example": one natural spoken-English sentence at the given CEFR level that uses the structure (5-200 characters).',
  '- "teachable": false when the item is not worth a lesson of its own at this level - it is trivially below the level, exists only as a corpus-position artefact, or is not a learnable point on its own. Otherwise true.',
  '- "importance": 1, 2 or 3, judged RELATIVE to the other items of the same level in this request. 1 = core for conversational fluency at this level (tenses and aspect, modals, conditionals, passive, question forms, reported speech, relative clauses). 2 = useful. 3 = peripheral or mostly written/formal.',
  '- "note": empty string when teachable is true; when teachable is false, a short reason (max 200 characters).',
  "",
  "Return ONLY a JSON array with one object per input item, in the input order. No prose, no markdown fences, no extra fields.",
].join("\n");

/** One-off grammar topic enrichment (M3b-1). Output is validated with enrichmentSchema. */
export function grammarEnrichmentPrompt(input: GrammarEnrichmentInput): { system: string; user: string } {
  const user =
    `Enrich these ${input.topics.length} CEFR ${input.level} grammar items.\n` +
    JSON.stringify({ level: input.level, topics: input.topics }, null, 2);
  return { system: SYSTEM, user };
}
