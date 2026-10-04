// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/conversation/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/conversation/session")>()),
  startWarmup: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { startWarmup, LessonNotFoundError } from "@/lib/conversation/session";
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/conversation/start", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => vi.mocked(startWarmup).mockReset());

describe("POST /api/conversation/start", () => {
  it("400 on a bad body", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
  });

  it("404 when the lesson is missing", async () => {
    vi.mocked(startWarmup).mockRejectedValue(new LessonNotFoundError("l9"));
    const res = await POST(req({ lessonId: "l9" }));
    expect(res.status).toBe(404);
  });

  it("200 with the warm-up state", async () => {
    vi.mocked(startWarmup).mockResolvedValue({ status: "ACTIVE", turns: [], review: null });
    const res = await POST(req({ lessonId: "l1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ACTIVE", turns: [], review: null });
    expect(startWarmup).toHaveBeenCalledWith("l1");
  });

  it("500 on an unexpected error", async () => {
    vi.mocked(startWarmup).mockRejectedValue(new Error("boom"));
    const res = await POST(req({ lessonId: "l1" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
