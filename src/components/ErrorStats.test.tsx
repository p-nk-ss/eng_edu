import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ErrorStats } from "./ErrorStats";

describe("ErrorStats", () => {
  it("renders the due-today count, bars per group (each with its own count), and a link to /errors", () => {
    render(
      <ErrorStats
        stats={{
          dueToday: 2,
          openByGroup: [
            { group: "grammar", label: "Grammar", count: 2 },
            { group: "vocab", label: "Vocabulary", count: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByText("2 due today")).toBeInTheDocument();

    const rows = screen.getAllByRole("listitem");
    const grammarRow = rows.find((r) => r.textContent?.includes("Grammar"));
    const vocabRow = rows.find((r) => r.textContent?.includes("Vocabulary"));
    expect(grammarRow).toBeDefined();
    expect(vocabRow).toBeDefined();
    // each count must be scoped to its own row, so swapped counts would fail this
    expect(within(grammarRow!).getByText("2")).toBeInTheDocument();
    expect(within(vocabRow!).getByText("1")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /see all mistakes/i });
    expect(link).toHaveAttribute("href", "/errors");
  });

  it("shows 'Nothing due today' when dueToday is 0", () => {
    render(<ErrorStats stats={{ dueToday: 0, openByGroup: [] }} />);
    expect(screen.getByText("Nothing due today")).toBeInTheDocument();
  });

  it("shows 'No open mistakes' when there are no groups", () => {
    render(<ErrorStats stats={{ dueToday: 0, openByGroup: [] }} />);
    expect(screen.getByText("No open mistakes")).toBeInTheDocument();
  });

  it("renders '-' when stats are null", () => {
    render(<ErrorStats stats={null} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
