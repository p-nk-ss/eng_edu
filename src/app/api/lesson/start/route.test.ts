// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/lesson/startLesson", () => ({ startLesson: vi.fn() }));
vi.mock("@/lib/lesson/liveDeps", () => ({ liveGenerationDeps: vi.fn(() => ({ ask: vi.fn(), gate: vi.fn() })) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { ProfileMissingError } from "@/lib/curriculum/lessonInputs";
import { LessonGenerationError } from "@/lib/lesson/generateLesson";
import { startLesson } from "@/lib/lesson/startLesson";
import { POST } from "./route";

afterEach(() => vi.mocked(startLesson).mockReset());

describe("POST /api/lesson/start", () => {
  it("returns the lesson id", async () => {
    vi.mocked(startLesson).mockResolvedValue({ lessonId: "L1", reused: false });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lessonId: "L1", reused: false });
  });

  it("maps a missing profile to 409", async () => {
    vi.mocked(startLesson).mockRejectedValue(new ProfileMissingError());
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/prisma db seed/);
  });

  it("maps a generation failure to 502 with the drop reasons", async () => {
    vi.mocked(startLesson).mockRejectedValue(new LessonGenerationError("failed twice", [{ attempt: 1, index: 0, reason: "mcq: answer index 9" }]));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "failed twice", drops: ["attempt 1 #0: mcq: answer index 9"] });
  });

  it("formats a typed drop the same way as formatDrop (plan.meta.dropReasons), including the exercise type", async () => {
    vi.mocked(startLesson).mockRejectedValue(
      new LessonGenerationError("failed twice", [{ attempt: 2, index: 3, type: "MULTIPLE_CHOICE", reason: "gate: below threshold" }]),
    );
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "failed twice", drops: ["attempt 2 #3 MULTIPLE_CHOICE: gate: below threshold"] });
  });

  it("maps anything else to 500 without leaking a stack", async () => {
    vi.mocked(startLesson).mockRejectedValue(new Error("connection refused"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "connection refused" });
  });
});
