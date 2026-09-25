// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/grading/checkAnswer", async (orig) => ({
  ...(await orig<typeof import("@/lib/grading/checkAnswer")>()),
  checkAnswer: vi.fn(),
}));
vi.mock("@/lib/grading/liveJudgeDeps", () => ({ liveJudgeDeps: vi.fn(() => ({})) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { checkAnswer, ExerciseNotFoundError, InvalidAnswerError } from "@/lib/grading/checkAnswer";
import { GradingUnavailableError } from "@/lib/grading/judge";
import { POST } from "./route";

const req = (body: unknown) => new Request("http://localhost/api/exercise/check", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

afterEach(() => vi.mocked(checkAnswer).mockReset());

describe("POST /api/exercise/check", () => {
  it("returns the grade", async () => {
    vi.mocked(checkAnswer).mockResolvedValue({ exerciseId: "e1", isCorrect: true, alreadyAnswered: false } as never);
    const res = await POST(req({ exerciseId: "e1", answer: { selected: 1 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isCorrect: true });
    expect(vi.mocked(checkAnswer).mock.calls[0].slice(0, 2)).toEqual(["e1", { selected: 1 }]);
  });

  it("maps a bad body and a malformed answer to 400", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({ answer: {} }))).status).toBe(400);
    vi.mocked(checkAnswer).mockRejectedValue(new InvalidAnswerError("selected: out of range"));
    expect((await POST(req({ exerciseId: "e1", answer: { selected: 9 } }))).status).toBe(400);
  });

  it("maps a missing exercise to 404 and an unavailable judge to 502", async () => {
    vi.mocked(checkAnswer).mockRejectedValueOnce(new ExerciseNotFoundError("e9"));
    expect((await POST(req({ exerciseId: "e9", answer: {} }))).status).toBe(404);
    vi.mocked(checkAnswer).mockRejectedValueOnce(new GradingUnavailableError("Translation feedback failed"));
    expect((await POST(req({ exerciseId: "e1", answer: { text: "x" } }))).status).toBe(502);
  });

  it("maps anything else to 500 without a stack", async () => {
    vi.mocked(checkAnswer).mockRejectedValue(new Error("connection refused"));
    const res = await POST(req({ exerciseId: "e1", answer: {} }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "connection refused" });
  });
});
