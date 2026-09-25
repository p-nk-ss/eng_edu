import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GradeResult } from "@/lib/grading/types";
import { ResultPanel } from "./ResultPanel";

const base: GradeResult = {
  version: 1, exerciseId: "e1", isCorrect: false, parts: [{ correct: false, given: "finishing", expected: "had finished" }],
  correctAnswer: "had finished", explain: "Past Perfect shows an earlier past action.", feedback: null, gradedBy: "local", vocabCredit: [],
};

describe("ResultPanel", () => {
  it("shows a wrong verdict with icon text, the key and the explanation open", () => {
    render(<ResultPanel result={base} type="mcq" />);
    expect(screen.getByRole("status")).toHaveTextContent(/not quite/i);
    expect(screen.getByText(/correct answer:/i).parentElement).toHaveTextContent("had finished");
    expect(screen.getByText(base.explain)).toBeVisible();
  });

  it("shows a correct verdict with the explanation collapsed", () => {
    render(<ResultPanel result={{ ...base, isCorrect: true, parts: [{ correct: true, given: "had finished", expected: "had finished" }] }} type="mcq" />);
    expect(screen.getByRole("status")).toHaveTextContent(/correct/i);
    expect(screen.getByText("Why?").closest("details")).not.toHaveAttribute("open");
  });

  it("notes an accepted variant", () => {
    render(<ResultPanel result={{ ...base, isCorrect: true, gradedBy: "jev", correctAnswer: "It was a beautiful day.", parts: [{ correct: true, given: "lovely", expected: "beautiful" }] }} type="open_cloze" />);
    expect(screen.getByText(/accepted - the key was: it was a beautiful day\./i)).toBeInTheDocument();
  });

  it("lists parts when there is more than one", () => {
    render(<ResultPanel result={{ ...base, parts: [{ correct: true, given: "since", expected: "since" }, { correct: false, given: "since", expected: "for" }] }} type="cloze_mc" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent(/you: since/i);
    expect(items[1]).toHaveTextContent(/answer: for/i);
  });

  it("shows MCQ rationales", () => {
    render(<ResultPanel result={{ ...base, rationales: ["base form", "correct: completed before a past moment"] }} type="mcq" />);
    expect(screen.getByText("base form")).toBeInTheDocument();
  });

  it("shows translation feedback", () => {
    render(<ResultPanel result={{ ...base, feedback: { corrected: "I finished the report.", explanation: "Use the article.", category: "grammar" } }} type="translation" />);
    expect(screen.getByText(/better:/i).parentElement).toHaveTextContent("I finished the report.");
    expect(screen.getByText("Use the article.")).toBeInTheDocument();
  });

  it("shows writing feedback with severity as text and hides the empty key", () => {
    render(
      <ResultPanel
        result={{ ...base, correctAnswer: "", parts: [{ correct: false, given: "t", expected: "" }], feedback: {
          summary: "Clear text with one tense slip.", wordCount: 64,
          corrections: [{ original: "I have a meeting yesterday", corrected: "I had a meeting yesterday", explanation: "Past simple for yesterday.", category: "grammar", severity: "major", relatesToFocus: false }],
        } }}
        type="open_writing"
      />,
    );
    expect(screen.getByText("Clear text with one tense slip.")).toBeInTheDocument();
    expect(screen.getByText("major")).toBeInTheDocument();
    expect(screen.getByText(/64 words/)).toBeInTheDocument();
    expect(screen.queryByText(/correct answer:/i)).not.toBeInTheDocument();
  });
});
