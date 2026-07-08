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

  it("retries once with a reminder when the first output is invalid", async () => {
    const produce = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"ok":true}');
    await expect(parseJsonWithRetry(schema, produce)).resolves.toEqual({ ok: true });
    expect(produce).toHaveBeenCalledTimes(2);
    expect(produce).toHaveBeenLastCalledWith(
      "Return ONLY valid JSON, no prose, no markdown fences.",
    );
  });

  it("throws if the retry is still invalid", async () => {
    const produce = vi.fn().mockResolvedValue("still not json");
    await expect(parseJsonWithRetry(schema, produce)).rejects.toThrow(/validation failed/i);
  });
});
