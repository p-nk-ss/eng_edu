// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/conversation/turn", () => ({ runTurn: vi.fn() }));
vi.mock("@/lib/conversation/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/conversation/session")>()),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { runTurn } from "@/lib/conversation/turn";
import { LessonNotFoundError, PartnerUnavailableError, TurnRejectedError } from "@/lib/conversation/session";
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/conversation/turn", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

afterEach(() => vi.mocked(runTurn).mockReset());

describe("POST /api/conversation/turn", () => {
  it("400 on a bad body", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({ lessonId: "l1" }))).status).toBe(400);
  });

  it("400 when the turn is invalid", async () => {
    vi.mocked(runTurn).mockRejectedValue(new TurnRejectedError("invalid"));
    const res = await POST(req({ lessonId: "l1", text: "" }));
    expect(res.status).toBe(400);
  });

  it("409 when the turn is closed, limited, or busy", async () => {
    for (const reason of ["closed", "limit", "busy"] as const) {
      vi.mocked(runTurn).mockRejectedValueOnce(new TurnRejectedError(reason));
      const res = await POST(req({ lessonId: "l1", text: "hi" }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: reason });
    }
  });

  it("404 when the lesson is missing", async () => {
    vi.mocked(runTurn).mockRejectedValue(new LessonNotFoundError("l9"));
    const res = await POST(req({ lessonId: "l9", text: "hi" }));
    expect(res.status).toBe(404);
  });

  it("503 when the partner is unavailable, logging without secrets", async () => {
    vi.mocked(runTurn).mockRejectedValue(new PartnerUnavailableError());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(req({ lessonId: "l1", text: "hi" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "partner_unavailable" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("200 with the streamed text and the right headers", async () => {
    vi.mocked(runTurn).mockResolvedValue(streamOf("Hello there"));
    const res = await POST(req({ lessonId: "l1", text: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("Hello there");
    expect(runTurn).toHaveBeenCalledWith("l1", "hi");
  });

  it("500 on an unexpected error", async () => {
    vi.mocked(runTurn).mockRejectedValue(new Error("boom"));
    const res = await POST(req({ lessonId: "l1", text: "hi" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
