import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { stripFences, parseJsonWithRetry } from "./json";

const schema = z.object({ ok: z.boolean() });

describe("stripFences", () => {
  it("removes ```json fences", () => {
    expect(stripFences('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });
  it("passes through bare JSON", () => {
    expect(stripFences('{"ok":true}')).toBe('{"ok":true}');
  });
});

describe("parseJsonWithRetry", () => {
  it("parses clean JSON on the first try", async () => {
    const produce = vi.fn().mockResolvedValue('{"ok":true}');
    await expect(parseJsonWithRetry(schema, produce)).resolves.toEqual({ ok: true });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("retries once, telling the model plainly its first output was not JSON at all", async () => {
    const produce = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"ok":true}');
    await expect(parseJsonWithRetry(schema, produce)).resolves.toEqual({ ok: true });
    expect(produce).toHaveBeenCalledTimes(2);
    const reminder = produce.mock.calls[1][0] as string;
    expect(reminder).toMatch(/not valid JSON/i);
    expect(reminder).toMatch(/Return ONLY valid JSON, no prose, no markdown fences\./);
  });

  it("retries once with a compact summary of the zod issues when the first output is JSON but fails the schema", async () => {
    const produce = vi
      .fn()
      .mockResolvedValueOnce('{"ok":"nope"}')
      .mockResolvedValueOnce('{"ok":true}');
    await expect(parseJsonWithRetry(schema, produce)).resolves.toEqual({ ok: true });
    expect(produce).toHaveBeenCalledTimes(2);
    const reminder = produce.mock.calls[1][0] as string;
    expect(reminder).toMatch(/Return ONLY valid JSON, no prose, no markdown fences\./);
    expect(reminder).toContain("ok:");
    expect(reminder).not.toMatch(/not valid JSON/i);
  });

  it("caps the issue summary at 10 issues and about 800 characters", async () => {
    const bigSchema = z.object(
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, z.boolean()])),
    );
    const produce = vi.fn().mockResolvedValueOnce("{}").mockResolvedValueOnce("{}");
    await expect(parseJsonWithRetry(bigSchema, produce)).rejects.toThrow();
    const reminder = produce.mock.calls[1][0] as string;
    expect(reminder.length).toBeLessThanOrEqual(900);
    const issueCount = (reminder.match(/field\d+:/g) ?? []).length;
    expect(issueCount).toBeLessThanOrEqual(10);
  });

  it("throws if the retry is still invalid", async () => {
    const produce = vi.fn().mockResolvedValue("still not json");
    await expect(parseJsonWithRetry(schema, produce)).rejects.toThrow(/validation failed/i);
  });
});
