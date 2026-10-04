import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WarmupState, WarmupTurn } from "@/lib/conversation/session";
import { toExerciseView } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import type { PlayerItem, PlayerLesson } from "@/lib/lesson/loadLesson";
import type { GradeResult } from "@/lib/grading/types";
import { LessonResults } from "./LessonResults";

const grade = (exerciseId: string, isCorrect: boolean): GradeResult => ({
  version: 1, exerciseId, isCorrect, parts: [{ correct: isCorrect, given: "x", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Because.", feedback: null, gradedBy: "local", vocabCredit: [],
});
const items: PlayerItem[] = [{ view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: grade("e1", true), section: "written" }];
const finding = { original: "goed", corrected: "went", explanation: "Irregular past.", category: "general", severity: "major", grammarTopicId: null };
const turns: WarmupTurn[] = [
  { id: "p0", role: "partner", text: "Hi!", turnIndex: 0, corrections: null },
  { id: "l1", role: "learner", text: "I goed.", turnIndex: 1, corrections: [finding, finding] },
  { id: "p1", role: "partner", text: "Nice.", turnIndex: 2, corrections: null },
  { id: "l2", role: "learner", text: "Yes.", turnIndex: 3, corrections: [] },
  { id: "p2", role: "partner", text: "Good.", turnIndex: 4, corrections: null },
  { id: "l3", role: "learner", text: "I has a dog.", turnIndex: 5, corrections: [finding] },
];
const warmup = (available: boolean, state: WarmupState): PlayerLesson["warmup"] => ({ available, theme: "Work & careers", state });

describe("LessonResults", () => {
  it("shows 'Conversation: N turns, M corrections' for an analysed warm-up (learner turns, total findings)", () => {
    render(<LessonResults items={items} warmup={warmup(true, { status: "ANALYZED", turns, review: null })} />);
    expect(screen.getByText("Conversation: 3 turns, 3 corrections")).toBeInTheDocument();
  });

  it("shows 'Conversation: skipped' for a skipped or unavailable warm-up", () => {
    const { unmount } = render(<LessonResults items={items} warmup={warmup(true, { status: "SKIPPED", turns: [], review: null })} />);
    expect(screen.getByText("Conversation: skipped")).toBeInTheDocument();
    unmount();
    render(<LessonResults items={items} warmup={warmup(true, { status: "UNAVAILABLE", turns: [], review: null })} />);
    expect(screen.getByText("Conversation: skipped")).toBeInTheDocument();
  });

  it("shows no conversation line when the lesson has no warm-up", () => {
    render(<LessonResults items={items} warmup={warmup(false, { status: "ANALYZED", turns, review: null })} />);
    expect(screen.queryByText(/^Conversation:/)).not.toBeInTheDocument();
  });

  it("shows no conversation line when the warm-up never happened (old lesson) or without warm-up data", () => {
    const { unmount } = render(<LessonResults items={items} warmup={warmup(true, { status: null, turns: [], review: null })} />);
    expect(screen.queryByText(/^Conversation:/)).not.toBeInTheDocument();
    unmount();
    render(<LessonResults items={items} />);
    expect(screen.queryByText(/^Conversation:/)).not.toBeInTheDocument();
    expect(screen.getByText("1 of 1 correct")).toBeInTheDocument();
  });
});
