import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentlyMastered } from "./RecentlyMastered";

describe("RecentlyMastered", () => {
  it("renders rows with label, kind text and date", () => {
    render(
      <RecentlyMastered
        items={[
          { kind: "grammar", label: "Comparative with more", at: new Date(2026, 9, 4) },
          { kind: "word", label: "deadline", at: new Date(2026, 9, 3) },
          { kind: "mistake", label: "Translation - meaning", at: new Date(2026, 9, 2) },
        ]}
      />,
    );
    expect(screen.getByText("Comparative with more")).toBeInTheDocument();
    expect(screen.getByText("Grammar")).toBeInTheDocument();
    expect(screen.getByText("deadline")).toBeInTheDocument();
    expect(screen.getByText("Word")).toBeInTheDocument();
    expect(screen.getByText("Translation - meaning")).toBeInTheDocument();
    expect(screen.getByText("Mistake")).toBeInTheDocument();
    expect(screen.getAllByText("4 Oct").length).toBeGreaterThan(0);
    expect(screen.getByText("3 Oct")).toBeInTheDocument();
    expect(screen.getByText("2 Oct")).toBeInTheDocument();
  });

  it("shows 'Nothing mastered yet.' when items is empty", () => {
    render(<RecentlyMastered items={[]} />);
    expect(screen.getByText("Nothing mastered yet.")).toBeInTheDocument();
  });

  it("renders '-' when items is null", () => {
    render(<RecentlyMastered items={null} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
