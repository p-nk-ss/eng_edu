// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createTypeSafeClient, choice, noul, TypeSafeError } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => {};

const okBody = {
  model: "jev-latest",
  answers: {
    topic: { type: "choice", choice: "food", probabilities: { food: 0.9, general: 0.1 }, confidence: 0.8 },
    ok: { type: "noul", noul: 0.95 },
  },
  usage: { input_tokens: 100, output_tokens: 10 },
};

describe("createTypeSafeClient", () => {
  it("throws when no API key is available", () => {
    const prev = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => createTypeSafeClient()).toThrow(/TYPESAFE_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.TYPESAFE_API_KEY = prev;
    }
  });

  it("POSTs state + questions with bearer auth and returns typed answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(okBody));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep });

    const res = await client.systemOne({
      state: { word: "bread" },
      questions: {
        topic: choice("Which theme?", { food: "Food", general: "Other" }),
        ok: noul("Is it a word?", { true: "yes", false: "no" }),
      },
    });

    expect(res.answers.topic.choice).toBe("food");
    expect(res.answers.ok.noul).toBe(0.95);
    expect(res.usage.input_tokens).toBe(100);

    const [url, init] = (fetchImpl.mock.calls[0] as any[]);
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer k");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("jev-latest");
    expect(sent.state).toEqual({ word: "bread" });
    expect(sent.questions.topic).toEqual({
      type: "choice",
      instructions: "Which theme?",
      criteria: { food: "Food", general: "Other" },
    });
  });

  it("retries 429 and 529 with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "slow down" }, 429))
      .mockResolvedValueOnce(json({ error: "overloaded" }, 529))
      .mockResolvedValueOnce(json(okBody));
    const sleep = vi.fn(noSleep);
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep });

    const res = await client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } });

    expect(res.answers.ok.noul).toBe(0.95);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((sleep.mock.calls as any[]).map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after maxRetries and throws TypeSafeError with status and body", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ error: "slow down" }, 429));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep, maxRetries: 2 });

    const err = await client
      .systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } })
      .catch((e) => e);

    expect(err).toBeInstanceOf(TypeSafeError);
    expect(err.status).toBe(429);
    expect(err.body).toContain("slow down");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it("does not retry non-retryable errors (422)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "bad question" }, 422));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep });

    await expect(
      client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 504 with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "gateway timeout" }, 504))
      .mockResolvedValueOnce(json(okBody));
    const sleep = vi.fn(noSleep);
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep });

    const res = await client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } });

    expect(res.answers.ok.noul).toBe(0.95);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure (fetch rejects), then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(json(okBody));
    const sleep = vi.fn(noSleep);
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep });

    const res = await client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } });

    expect(res.answers.ok.noul).toBe(0.95);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries on a persistent network failure, throwing TypeSafeError(status 0) with the cause", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep, maxRetries: 2 });

    const err = await client
      .systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } })
      .catch((e) => e);

    expect(err).toBeInstanceOf(TypeSafeError);
    expect(err.status).toBe(0);
    expect(err.body).toContain("ECONNRESET");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it("passes an AbortSignal (per-request timeout) to fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(okBody));
    const client = createTypeSafeClient({ apiKey: "k", fetchImpl, sleep: noSleep });

    await client.systemOne({ state: "x", questions: { ok: noul("?", { true: "y", false: "n" }) } });

    const [, init] = (fetchImpl.mock.calls[0] as any[]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
