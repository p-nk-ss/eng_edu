import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TYPE_LABELS, toExerciseView } from "@/lib/lesson/lessonView";
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
  intro: {
    learnerLevel: "B1",
    grammar: {
      title: "Past Perfect (had done)",
      level: "B2",
      description: "An earlier past action.",
      example: "She had finished.",
      status: "PRACTICING",
      goodLessons: 1,
      lessonsToMaster: 3,
      lastScore: 0.5,
    },
    topicLessonNumber: 2,
    vocab: ["apple", "cherry"],
  },
  items: [
    { view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: results[0] },
    { view: toExerciseView("e2", E.DIALOGUE_GAP), result: results[1] },
  ],
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const start = () => fireEvent.click(screen.getByRole("button", { name: "Start" }));

describe("LessonPlayer", () => {
  it("shows the intro first for a fresh lesson; Start moves to exercise 1 with its heading focused", () => {
    render(<LessonPlayer lesson={lesson([null, null])} />);
    expect(screen.getByText("Today's lesson")).toBeInTheDocument();
    expect(screen.queryByText("Exercise 1 of 2")).not.toBeInTheDocument();
    start();
    expect(screen.getByText("Exercise 1 of 2")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: TYPE_LABELS[toExerciseView("e1", E.MULTIPLE_CHOICE).type] }));
  });

  it("resumes directly (no intro) when at least one exercise is answered", () => {
    render(<LessonPlayer lesson={lesson([grade("e1", true), null])} />);
    expect(screen.queryByText("Today's lesson")).not.toBeInTheDocument();
    expect(screen.getByText("Exercise 2 of 2")).toBeInTheDocument();
  });

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
    start();
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
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /written block done/i }));
  });

  it("checks on Enter (window or the card heading), not just click, once an answer is chosen", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ ...grade("e1", true), alreadyAnswered: false }))
      .mockResolvedValueOnce(ok({ ...grade("e2", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    start();
    fireEvent.click(screen.getByRole("radio", { name: /finishing/ }));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: /no worries/i }));
    fireEvent.keyDown(screen.getByRole("heading", { name: /complete the dialogue/i }), { key: "Enter" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await screen.findByText("Correct");
  });

  it("Enter on an unselected option does not check the previous choice (the native click selects it instead)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    start();
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    const option3 = screen.getByRole("radio", { name: /finishing/ });
    fireEvent.keyDown(option3, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
    // the browser's own Enter-activation of the focused button fires this click; the handler must
    // not have called preventDefault, or that click would never happen
    fireEvent.click(option3);
    expect(option3).toBeChecked();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Enter on the already-checked radio checks", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ ...grade("e1", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    start();
    const option = screen.getByRole("radio", { name: /had finished/ });
    fireEvent.click(option);
    fireEvent.keyDown(option, { key: "Enter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await screen.findByText("Correct");
  });

  it("does not check on Enter while focus is on a select gap", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const clozeLesson: PlayerLesson = {
      lessonId: "L4", themeLabel: null, grammarTitle: null,
      intro: { learnerLevel: null, grammar: null, topicLessonNumber: null, vocab: [] },
      items: [{ view: toExerciseView("e4", E.CLOZE_DROPDOWN), result: null }],
    };
    render(<LessonPlayer lesson={clozeLesson} />);
    start();
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.keyDown(select, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not check on Enter while focus is on a word-bank tile", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wordBankLesson: PlayerLesson = {
      lessonId: "L2", themeLabel: null, grammarTitle: null,
      intro: { learnerLevel: null, grammar: null, topicLessonNumber: null, vocab: [] },
      items: [{ view: toExerciseView("e3", E.WORD_BANK), result: null }],
    };
    render(<LessonPlayer lesson={wordBankLesson} />);
    start();
    const tile = screen.getByRole("button", { name: "work" });
    fireEvent.click(tile);
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a repeated Enter (key held down)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    start();
    fireEvent.click(screen.getByRole("radio", { name: /finishing/ }));
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 200 with invalid or incomplete JSON as an error, not a stored result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(ok({ ...grade("e1", true), alreadyAnswered: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    start();
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't check right now/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByText("Correct");
  });

  it("sends one request when Check is clicked twice", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonPlayer lesson={lesson([null, null])} />);
    start();
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
    start();
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
    expect(screen.getByText("She ___ the report before the deadline yesterday.")).toBeInTheDocument();
  });

  it("says so when the lesson has no exercises, with a link back to the dashboard", () => {
    render(<LessonPlayer lesson={{ ...lesson([]), items: [] }} />);
    expect(screen.getByText(/this lesson has no exercises/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
  });
});
