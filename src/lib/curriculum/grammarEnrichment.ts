import { z } from "zod";
import { CEFR_BANDS, type CefrBand, type GrammarSeed } from "./parse";

/** One enriched grammar topic, as stored in data/grammar-topics.json. Join key: `name`. */
export const enrichmentSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(3).max(80),
    description: z.string().min(20).max(400),
    example: z.string().min(5).max(200),
    teachable: z.boolean(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    note: z.string().max(200).default(""),
  })
  .refine((e) => e.teachable || e.note.trim().length > 0, {
    message: "note is required when teachable is false",
    path: ["note"],
  });

export type GrammarEnrichment = z.infer<typeof enrichmentSchema>;

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
      `${FILE_LABEL} is invalid: ` + res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
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
