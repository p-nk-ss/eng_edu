// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/conversation/session", () => ({ getWarmup: vi.fn() }));

import { getWarmup } from "@/lib/conversation/session";
import { GET } from "./route";

const req = (url: string) => new Request(url);

afterEach(() => vi.mocked(getWarmup).mockReset());

describe("GET /api/conversation", () => {
  it("400 when lessonId is missing", async () => {
    const res = await GET(req("http://localhost/api/conversation"));
    expect(res.status).toBe(400);
  });

  it("200 with the warm-up state", async () => {
    vi.mocked(getWarmup).mockResolvedValue({ status: "ACTIVE", turns: [], review: null });
    const res = await GET(req("http://localhost/api/conversation?lessonId=l1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ACTIVE", turns: [], review: null });
    expect(getWarmup).toHaveBeenCalledWith("l1");
  });

  it("500 on an unexpected error", async () => {
    vi.mocked(getWarmup).mockRejectedValue(new Error("boom"));
    const res = await GET(req("http://localhost/api/conversation?lessonId=l1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
