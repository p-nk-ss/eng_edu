import { z } from "zod";
import { CEFR_BANDS, type CefrBand, type GrammarSeed, type GrammarVariant } from "./parse";
import { enrichmentSchema, grammarEnrichmentPrompt, type GrammarEnrichment } from "../prompts/grammarEnrichment";
import type { CompleteArgs } from "../llm/types";

/**
 * The response contract (schema + limits) lives next to the prompt that produces it — see
 * `src/lib/prompts/grammarEnrichment.ts`. Re-exported here so existing imports keep working.
 */
export { enrichmentSchema, type GrammarEnrichment };

export interface GrammarBatch {
  level: CefrBand;
  topics: GrammarSeed[];
}

/** Same-level batches (importance is judged relative to peers), A1 -> C2, sortOrder inside a level. */
export function batchByLevel(topics: GrammarSeed[], size = 15): GrammarBatch[] {
  const out: GrammarBatch[] = [];
  for (const level of CEFR_BANDS) {
    const atLevel = topics.filter((t) => t.cefrLevel === level).sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < atLevel.length; i += size) out.push({ level, topics: atLevel.slice(i, i + size) });
  }
  return out;
}

export function pendingTopics(topics: GrammarSeed[], done: { name: string }[]): GrammarSeed[] {
  const seen = new Set(done.map((d) => d.name));
  return topics.filter((t) => !seen.has(t.name));
}

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

/** Every requested name must come back exactly once, and nothing else. Throws naming offenders. */
export function validateBatch(requested: string[], returned: { name: string }[]): void {
  const want = new Set(requested);
  const counts = new Map<string, number>();
  for (const r of returned) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const missing = requested.filter((n) => !counts.has(n));
  const unexpected = [...counts.keys()].filter((n) => !want.has(n));
  const duplicate = [...counts].filter(([, c]) => c > 1).map(([n]) => n);
  const problems = [
    missing.length ? `missing ${quote(missing)}` : "",
    unexpected.length ? `unexpected ${quote(unexpected)}` : "",
    duplicate.length ? `duplicate ${quote(duplicate)}` : "",
  ].filter(Boolean);
  if (problems.length) throw new Error(`Enrichment batch mismatch: ${problems.join("; ")}`);
}

const FILE_LABEL = "grammar-topics JSON";
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `issue.path[0]` is the array index; if that element has a string `name`, name it in the message
 *  (this file is hand-edited by a person, 266 records deep — an index alone is not enough). */
function describeIssue(issue: { path: PropertyKey[]; message: string }, raw: unknown): string {
  const [index, ...rest] = issue.path;
  const field = rest.map(String).join(".");
  if (typeof index === "number" && Array.isArray(raw)) {
    const name = (raw[index] as { name?: unknown } | undefined)?.name;
    if (typeof name === "string") {
      return `record "${name}" (index ${index})${field ? ` ${field}` : ""}: ${issue.message}`;
    }
  }
  return `${issue.path.join(".")}: ${issue.message}`;
}

export function parseEnrichmentFile(jsonText: string): GrammarEnrichment[] {
  if (jsonText.trim() === "") return [];
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`${FILE_LABEL} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const res = z.array(enrichmentSchema).safeParse(raw);
  if (!res.success) {
    throw new Error(
      `${FILE_LABEL} is invalid: ` + res.error.issues.map((i) => describeIssue(i, raw)).join("; "),
    );
  }
  return res.data;
}

/** Sorted by name, 2-space JSON, trailing newline — stable diffs for a hand-editable file. */
export function serializeEnrichmentFile(records: GrammarEnrichment[]): string {
  return JSON.stringify([...records].sort((a, b) => cmp(a.name, b.name)), null, 2) + "\n";
}

const PILOT_LEVELS: CefrBand[] = ["A2", "B1"];
const PILOT_PER_LEVEL = 15;

/** Deterministic pilot: the first 15 A2 and first 15 B1 topics by sortOrder. */
export function pilotSample(topics: GrammarSeed[]): GrammarSeed[] {
  return PILOT_LEVELS.flatMap((level) =>
    topics
      .filter((t) => t.cefrLevel === level)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, PILOT_PER_LEVEL),
  );
}

export type AskEnrichment = (args: CompleteArgs) => Promise<GrammarEnrichment[]>;

/**
 * Enrich one same-level batch. `ask` is the LLM call (injected so this stays testable);
 * its own failures propagate. A name mismatch in the answer gets exactly one retry, with a
 * second user message telling the model exactly what was wrong and asking for the full corrected array.
 */
export async function enrichBatch(
  batch: GrammarBatch,
  variants: Map<string, GrammarVariant[]>,
  ask: AskEnrichment,
): Promise<GrammarEnrichment[]> {
  const names = batch.topics.map((t) => t.name);
  const args = grammarEnrichmentPrompt({
    level: batch.level,
    topics: names.map((name) => ({ name, variants: variants.get(name) ?? [] })),
  });
  let mismatch = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const request: CompleteArgs =
      attempt === 0
        ? args
        : {
            ...args,
            messages: [
              ...args.messages,
              {
                role: "user",
                content: `${mismatch}. Return the complete corrected JSON array with exactly the requested names, one object per input item.`,
              },
            ],
          };
    const records = await ask(request);
    try {
      validateBatch(names, records);
      return records;
    } catch (e) {
      mismatch = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Grammar enrichment failed twice for the ${batch.level} batch starting at "${names[0]}": ${mismatch}`);
}
