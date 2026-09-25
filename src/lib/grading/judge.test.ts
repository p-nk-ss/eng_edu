// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { VALID_EXERCISES as E } from "../lesson/fixtures";
import type { TypeSafeClient } from "../typesafe/client";
import { gradeLocally } from "./graders";
import { countWords, GradingUnavailableError, runJudge, type JudgeDeps } from "./judge";
import type { Answer, TranslationFeedback, WritingFeedback } from "./types";

afterEach(() => vi.restoreAllMocks());

const ctx = { grammar: { id: "g1", title: "Past Simple", description: "Finished past actions." }, level: "B1" };

function jevReturning(answers: Record<string, unknown>) {
  const systemOne = vi.fn(async () => ({ answers, usage: { input_tokens: 1, output_tokens: 1 } }));
  return { client: { systemOne } as unknown as TypeSafeClient, systemOne };
}
const deps = (over: Partial<JudgeDeps> = {}): JudgeDeps => ({
  jev: () => null,
  askTranslation: vi.fn(),
  askWriting: vi.fn(),
  ...over,
});
const judge = (content: (typeof E)[keyof typeof E], answer: Answer, d: JudgeDeps) => runJudge(content, answer, gradeLocally(content, answer), ctx, d);

describe("runJudge - typed variants", () => {
  const typo: Answer = { type: "open_cloze", text: ["beautifull"] };

  it("returns the local verdict without calling Jev when nothing needs checking", async () => {
    const jev = jevReturning({});
    const out = await judge(E.MULTIPLE_CHOICE, { type: "mcq", selected: 1 }, deps({ jev: () => jev.client }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "local" });
    expect(jev.systemOne).not.toHaveBeenCalled();
  });

  it("accepts a confidently equivalent variant", async () => {
    const jev = jevReturning({ equivalent: { type: "noul", noul: 0.93 } });
    const out = await judge(E.FILL_BLANK, typo, deps({ jev: () => jev.client }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "jev", jevScores: { variant_0: 0.93 } });
    expect(jev.systemOne).toHaveBeenCalledTimes(1);
  });

  it("keeps the answer wrong when Jev is not confident", async () => {
    const jev = jevReturning({ equivalent: { type: "noul", noul: 0.5 } });
    expect((await judge(E.FILL_BLANK, typo, deps({ jev: () => jev.client }))).isCorrect).toBe(false);
  });

  it("grades strictly without Jev", async () => {
    expect(await judge(E.FILL_BLANK, typo, deps())).toMatchObject({ isCorrect: false, gradedBy: "local" });
  });

  it("falls back to strict grading when Jev throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = { systemOne: vi.fn().mockRejectedValue(new Error("HTTP 504")) } as unknown as TypeSafeClient;
    await expect(judge(E.FILL_BLANK, typo, deps({ jev: () => client }))).resolves.toMatchObject({ isCorrect: false, gradedBy: "local" });
  });

  it("logs the error message (not the request) when Jev fails during variant checking", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = { systemOne: vi.fn().mockRejectedValue(new Error("HTTP 504")) } as unknown as TypeSafeClient;
    await judge(E.FILL_BLANK, typo, deps({ jev: () => client }));
    expect(warn).toHaveBeenCalledWith("[judge] Jev unavailable:", "HTTP 504");
  });
});

describe("runJudge - translation", () => {
  const answer: Answer = { type: "translation", text: "I finished the report before the deadline." };
  const fb: TranslationFeedback = { isCorrect: false, corrected: "I finished the report before the deadline.", explanation: "Use the definite article.", category: "grammar", relatesToFocus: false };

  it("accepts a Jev-confident translation without calling Claude", async () => {
    const jev = jevReturning({ acceptable: { type: "noul", noul: 0.95 }, error_type: { type: "choice", choice: "none", probabilities: {}, confidence: 0.9 } });
    const askTranslation = vi.fn();
    const out = await judge(E.TRANSLATION, answer, deps({ jev: () => jev.client, askTranslation }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "jev" });
    expect(askTranslation).not.toHaveBeenCalled();
  });

  it("asks Claude with the Jev category hint when Jev is not confident", async () => {
    const jev = jevReturning({ acceptable: { type: "noul", noul: 0.3 }, error_type: { type: "choice", choice: "grammar", probabilities: {}, confidence: 0.7 } });
    const askTranslation = vi.fn().mockResolvedValue(fb);
    const out = await judge(E.TRANSLATION, answer, deps({ jev: () => jev.client, askTranslation }));
    expect(out).toMatchObject({ isCorrect: false, gradedBy: "claude", translation: fb });
    expect(askTranslation.mock.calls[0][0].messages[0].content).toContain('"jev_category": "grammar"');
  });

  it("goes straight to Claude without Jev", async () => {
    const askTranslation = vi.fn().mockResolvedValue({ ...fb, isCorrect: true, category: "none" });
    expect(await judge(E.TRANSLATION, answer, deps({ askTranslation }))).toMatchObject({ isCorrect: true, gradedBy: "claude" });
  });

  it("stores error_type_confidence only when Jev returns a number", async () => {
    const jev = jevReturning({ acceptable: { type: "noul", noul: 0.3 }, error_type: { type: "choice", choice: "grammar", probabilities: {}, confidence: "high" } });
    const askTranslation = vi.fn().mockResolvedValue(fb);
    const out = await judge(E.TRANSLATION, answer, deps({ jev: () => jev.client, askTranslation }));
    expect(out.jevScores).toEqual({ acceptable: 0.3 });
  });

  it("passes jevCategory to Claude only when it is a known translation category", async () => {
    const jev = jevReturning({ acceptable: { type: "noul", noul: 0.3 }, error_type: { type: "choice", choice: "not_a_real_category", probabilities: {}, confidence: 0.7 } });
    const askTranslation = vi.fn().mockResolvedValue(fb);
    await judge(E.TRANSLATION, answer, deps({ jev: () => jev.client, askTranslation }));
    expect(askTranslation.mock.calls[0][0].messages[0].content).toContain('"jev_category": null');
  });

  it("logs the error message (not the request) when Jev fails during translation acceptance", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = { systemOne: vi.fn().mockRejectedValue(new Error("network down")) } as unknown as TypeSafeClient;
    const askTranslation = vi.fn().mockResolvedValue(fb);
    await judge(E.TRANSLATION, answer, deps({ jev: () => client, askTranslation }));
    expect(warn).toHaveBeenCalledWith("[judge] Jev unavailable:", "network down");
  });

  it("raises GradingUnavailableError when Claude fails", async () => {
    const askTranslation = vi.fn().mockRejectedValue(new Error("LLM JSON validation failed"));
    await expect(judge(E.TRANSLATION, answer, deps({ askTranslation }))).rejects.toBeInstanceOf(GradingUnavailableError);
  });
});

describe("runJudge - open writing", () => {
  const long = Array.from({ length: 65 }, (_, i) => `word${i}`).join(" ");
  const fb = (severities: ("minor" | "moderate" | "major")[]): WritingFeedback => ({
    summary: "A clear text with a few slips.",
    corrections: severities.map((severity) => ({ original: "a", corrected: "b", explanation: "Because of a reason.", category: "grammar", severity, relatesToFocus: false })),
  });

  it("is correct with enough words and no major error", async () => {
    const out = await judge(E.OPEN_WRITING, { type: "open_writing", text: long }, deps({ askWriting: vi.fn().mockResolvedValue(fb(["minor", "moderate"])) }));
    expect(out).toMatchObject({ isCorrect: true, gradedBy: "claude" });
    expect(out.writing?.wordCount).toBe(65);
  });

  it("is wrong with a major error or too few words", async () => {
    expect((await judge(E.OPEN_WRITING, { type: "open_writing", text: long }, deps({ askWriting: vi.fn().mockResolvedValue(fb(["major"])) }))).isCorrect).toBe(false);
    expect((await judge(E.OPEN_WRITING, { type: "open_writing", text: "Too short." }, deps({ askWriting: vi.fn().mockResolvedValue(fb([])) }))).isCorrect).toBe(false);
  });

  it("counts words on whitespace", () => {
    expect(countWords("  one two\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});
