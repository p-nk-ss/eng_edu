import type { z } from "zod";

export function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : t).trim();
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const RETRY_REMINDER = "Return ONLY valid JSON, no prose, no markdown fences.";
const NOT_JSON_REMINDER = `Your previous response was not valid JSON. ${RETRY_REMINDER}`;
const MAX_ISSUES = 10;
const MAX_ISSUES_LENGTH = 800;

/** Compact "path: message" summary of zod issues, capped in count and length, for the retry prompt. */
function summarizeIssues(error: z.ZodError): string {
  const summary = error.issues
    .slice(0, MAX_ISSUES)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return summary.length > MAX_ISSUES_LENGTH ? `${summary.slice(0, MAX_ISSUES_LENGTH)}...` : summary;
}

/** RETRY_REMINDER plus, when the first answer parsed as JSON but failed the schema, a compact issue summary. */
function reminderFor(parsed: unknown, error: z.ZodError): string {
  if (parsed === undefined) return NOT_JSON_REMINDER;
  return `${RETRY_REMINDER} Fix these validation issues: ${summarizeIssues(error)}`;
}

export async function parseJsonWithRetry<T>(
  schema: z.ZodType<T>,
  produce: (reminder?: string) => Promise<string>,
): Promise<T> {
  const firstParsed = tryParse(stripFences(await produce()));
  const first = schema.safeParse(firstParsed);
  if (first.success) return first.data;

  const second = schema.safeParse(tryParse(stripFences(await produce(reminderFor(firstParsed, first.error)))));
  if (second.success) return second.data;

  throw new Error(`LLM JSON validation failed: ${second.error.message}`);
}
