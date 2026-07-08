import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";

describe("DashboardPage", () => {
  it("renders the nav items and the start button", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    for (const label of ["Dashboard", "Lesson", "Errors", "History"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /start today's lesson/i })).toBeInTheDocument();
    expect(screen.getByText(/streak/i)).toBeInTheDocument();
    expect(screen.getByText(/syllabus progress/i)).toBeInTheDocument();
  });
});
