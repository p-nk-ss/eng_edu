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

export async function parseJsonWithRetry<T>(
  schema: z.ZodType<T>,
  produce: (reminder?: string) => Promise<string>,
): Promise<T> {
  const first = schema.safeParse(tryParse(stripFences(await produce())));
  if (first.success) return first.data;

  const second = schema.safeParse(tryParse(stripFences(await produce(RETRY_REMINDER))));
  if (second.success) return second.data;

  throw new Error(`LLM JSON validation failed: ${second.error.message}`);
}
