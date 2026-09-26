import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { toExerciseView } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import type { PlayerLesson } from "@/lib/lesson/loadLesson";
import { LessonIntro } from "./LessonIntro";

const grammarLesson: PlayerLesson = {
  lessonId: "L1",
  themeLabel: "Work & careers",
  grammarTitle: "Comparative with more",
  items: [
    { view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: null },
    { view: toExerciseView("e2", E.DIALOGUE_GAP), result: null },
  ],
  intro: {
    learnerLevel: "B1",
    grammar: {
      title: "Comparative with more",
      level: "A2",
      description: "Use more + adjective to compare two things.",
      example: "This book is more interesting than that one.",
    },
    topicLessonNumber: 3,
    vocab: ["apple", "cherry"],
  },
};

const vocabOnlyLesson: PlayerLesson = {
  lessonId: "L2",
  themeLabel: "Food & drink",
  grammarTitle: null,
  items: [{ view: toExerciseView("e1", E.MULTIPLE_CHOICE), result: null }],
  intro: { learnerLevel: "B1", grammar: null, topicLessonNumber: null, vocab: ["bread", "milk"] },
};

describe("LessonIntro", () => {
  it("shows the grammar focus, level, below-level note, description, example, topic lesson number, theme, words and exercise count", () => {
    render(<LessonIntro lesson={grammarLesson} onStart={vi.fn()} />);
    expect(screen.getByText("Today's lesson")).toBeInTheDocument();
    expect(screen.getByText("Comparative with more")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getByText("Review of A2 basics - closing gaps below your B1 level")).toBeInTheDocument();
    expect(screen.getByText("Use more + adjective to compare two things.")).toBeInTheDocument();
    expect(screen.getByText("This book is more interesting than that one.")).toBeInTheDocument();
    expect(screen.getByText("Lesson 3 on this topic")).toBeInTheDocument();
    expect(screen.getByText("Work & careers")).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
    expect(screen.getByText("cherry")).toBeInTheDocument();
    expect(screen.getByText("2 exercises")).toBeInTheDocument();
  });

  it("says 'First lesson on this topic' when this is the topic's first lesson", () => {
    render(<LessonIntro lesson={{ ...grammarLesson, intro: { ...grammarLesson.intro, topicLessonNumber: 1 } }} onStart={vi.fn()} />);
    expect(screen.getByText("First lesson on this topic")).toBeInTheDocument();
  });

  it("omits the below-level note when the topic is at or above the learner's level", () => {
    render(<LessonIntro lesson={{ ...grammarLesson, intro: { ...grammarLesson.intro, grammar: { ...grammarLesson.intro.grammar!, level: "B1" } } }} onStart={vi.fn()} />);
    expect(screen.queryByText(/closing gaps below/i)).not.toBeInTheDocument();
  });

  it("renders no grammar block for a vocab-only lesson, but shows the theme, words and exercise count", () => {
    render(<LessonIntro lesson={vocabOnlyLesson} onStart={vi.fn()} />);
    expect(screen.queryByText("Comparative with more")).not.toBeInTheDocument();
    expect(screen.queryByText(/lesson.*on this topic/i)).not.toBeInTheDocument();
    expect(screen.getByText("Food & drink")).toBeInTheDocument();
    expect(screen.getByText("bread")).toBeInTheDocument();
    expect(screen.getByText("1 exercises")).toBeInTheDocument();
  });

  it("calls onStart when Start is clicked", () => {
    const onStart = vi.fn();
    render(<LessonIntro lesson={grammarLesson} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
