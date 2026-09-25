import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { StartLessonButton } from "./StartLessonButton";

beforeEach(() => push.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("StartLessonButton", () => {
  it("starts the lesson and navigates to it", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    render(<StartLessonButton />);
    fireEvent.click(screen.getByRole("button", { name: /start today's lesson/i }));
    expect(screen.getByRole("button", { name: /preparing your lesson/i })).toBeDisabled();
    expect(fetch).toHaveBeenCalledWith("/api/lesson/start", { method: "POST" });
    resolve(new Response(JSON.stringify({ lessonId: "L7", reused: false }), { status: 200 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/lesson/L7"));
  });

  it("shows the server error and lets the learner try again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Lesson generation failed" }), { status: 502 })));
    render(<StartLessonButton />);
    fireEvent.click(screen.getByRole("button", { name: /start today's lesson/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lesson generation failed");
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});
