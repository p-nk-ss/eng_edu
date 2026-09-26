import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SyllabusProgress } from "./syllabus-progress";

describe("SyllabusProgress", () => {
  it("renders the mastered and in-progress bar segments with a Tailwind-generated colour class", () => {
    const { container } = render(
      <SyllabusProgress
        data={[
          {
            level: "A1",
            grammarTotal: 20,
            grammarMastered: 5,
            grammarInProgress: 3,
            vocabTotal: 100,
            vocabKnown: 10,
            vocabLearning: 4,
          },
        ]}
      />,
    );
    const segments = container.querySelectorAll(".bg-success");
    // the mastered segment (bg-success) and the in-progress segment (bg-success + opacity)
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const inProgress = segments[1] as HTMLElement;
    expect(inProgress).toHaveClass("bg-success", "opacity-40");
    expect(inProgress).toHaveStyle({ width: "15%" });
  });

  it("shows an empty state when there is no data", () => {
    render(<SyllabusProgress data={null} />);
    expect(screen.getByText(/curriculum not seeded yet/i)).toBeInTheDocument();
  });
});
