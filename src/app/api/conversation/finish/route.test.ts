// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/conversation/analyze", () => ({
  finishWarmup: vi.fn(),
  AnalysisUnavailableError: class AnalysisUnavailableError extends Error {
    constructor() {
      super("Conversation analysis unavailable");
      this.name = "AnalysisUnavailableError";
    }
  },
}));
vi.mock("@/lib/conversation/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/conversation/session")>()),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { finishWarmup, AnalysisUnavailableError } from "@/lib/conversation/analyze";
import { LessonNotFoundError } from "@/lib/conversation/session";
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/conversation/finish", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => vi.mocked(finishWarmup).mockReset());

describe("POST /api/conversation/finish", () => {
  it("400 on a bad body or an invalid action", async () => {
    const expectedError = { error: 'Body must be { lessonId: string, action: "review" | "skip" }' };
    const res1 = await POST(req("not json"));
    expect(res1.status).toBe(400);
    expect(await res1.json()).toEqual(expectedError);
    const res2 = await POST(req({ lessonId: "l1" }));
    expect(res2.status).toBe(400);
    expect(await res2.json()).toEqual(expectedError);
    const res3 = await POST(req({ lessonId: "l1", action: "done" }));
    expect(res3.status).toBe(400);
    expect(await res3.json()).toEqual(expectedError);
  });

  it("404 when the lesson is missing", async () => {
    vi.mocked(finishWarmup).mockRejectedValue(new LessonNotFoundError("l9"));
    const res = await POST(req({ lessonId: "l9", action: "skip" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Lesson l9: not found" });
  });

  it("502 when analysis is unavailable, logging without secrets", async () => {
    vi.mocked(finishWarmup).mockRejectedValue(new AnalysisUnavailableError());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(req({ lessonId: "l1", action: "review" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Conversation analysis unavailable" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("200 with the resulting state", async () => {
    vi.mocked(finishWarmup).mockResolvedValue({ status: "SKIPPED", turns: [], review: null });
    const res = await POST(req({ lessonId: "l1", action: "skip" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "SKIPPED", turns: [], review: null });
    expect(finishWarmup).toHaveBeenCalledWith("l1", "skip");
  });

  it("500 on an unexpected error", async () => {
    vi.mocked(finishWarmup).mockRejectedValue(new Error("boom"));
    const res = await POST(req({ lessonId: "l1", action: "skip" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
