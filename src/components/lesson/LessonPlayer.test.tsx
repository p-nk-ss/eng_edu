import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toExerciseView } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import type { PlayerLesson } from "@/lib/lesson/loadLesson";
import type { GradeResult } from "@/lib/grading/types";
import { LessonPlayer } from "./LessonPlayer";

afterEach(() => vi.unstubAllGlobals());

const grade = (exerciseId: string, isCorrect: boolean): GradeResult => ({
  version: 1, exerciseId, isCorrect, parts: [{ correct: isCorrect, given: "x", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Because.", feedback: null, gradedBy: "local", vocabCredit: [],
});
const lesson = (results: (GradeResult | null)[]): PlayerLesson => ({
  lessonId: "L1", themeLabel: "Work & careers", grammarTitle: "Past Perfect (had done)",
  items: [
    { view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: results[0] },
    { view: toExerciseView("e2", E.DIALOGUE_GAP), result: results[1] },
  ],
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("LessonPlayer", () => {
  it("starts at the first unanswered exercise and shows progress", () => {
    render(<LessonPlayer lesson={lesson([grade("e1", true), null])} />);
    expect(screen.getByText("Exercise 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("A: Sorry I am late.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("checks, shows the result, then moves on and ends on the results screen", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ ...grade("e1", false), alreadyAnswered: false }))
      .mockResolvedValueOnce(ok({ ...grade("e2", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    const check = screen.getByRole("button", { name: "Check" });
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /finishing/ }));
    fireEvent.click(check);
    expect(fetchMock).toHaveBeenCalledWith("/api/exercise/check", expect.objectContaining({ method: "POST", body: JSON.stringify({ exerciseId: "e1", answer: { selected: 2 } }) }));
    expect(await screen.findByText(/not quite/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: /no worries/i }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
    expect(screen.getByText("1 of 2 correct")).toBeInTheDocument();
  });

  it("sends one request when Check is clicked twice", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    fireEvent.click(screen.getByRole("button", { name: /checking/i }));
    fireEvent.submit(screen.getByRole("button", { name: /checking/i }).closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(ok({ ...grade("e1", true), alreadyAnswered: false }));
    await screen.findByText("Correct");
  });

  it("keeps the answer after a 502 and succeeds on Try again", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Translation feedback failed" }), { status: 502 }))
      .mockResolvedValueOnce(ok({ ...grade("e1", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't check right now/i);
    expect(screen.getByRole("radio", { name: /had finished/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByText("Correct");
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ exerciseId: "e1", answer: { selected: 1 } }));
  });

  it("shows the results screen directly when every exercise is answered", () => {
    render(<LessonPlayer lesson={lesson([grade("e1", true), grade("e2", true)])} />);
    expect(screen.getByText("2 of 2 correct")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
  });

  it("says so when the lesson has no exercises", () => {
    render(<LessonPlayer lesson={{ ...lesson([]), items: [] }} />);
    expect(screen.getByText(/this lesson has no exercises/i)).toBeInTheDocument();
  });
});
