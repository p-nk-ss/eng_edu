import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/curriculum/progress", () => ({
  getSyllabusProgress: vi.fn().mockResolvedValue([
    {
      level: "A1",
      grammarTotal: 84,
      grammarMastered: 3,
      grammarInProgress: 1,
      vocabTotal: 1164,
      vocabKnown: 10,
      vocabLearning: 8,
    },
  ]),
}));
vi.mock("@/lib/stats/streak", () => ({ getStreak: vi.fn().mockResolvedValue({ days: 4, atRisk: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  it("renders the nav, start button, and syllabus progress", async () => {
    render(await DashboardPage());
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    for (const label of ["Dashboard", "Lesson", "Errors", "History"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /start today's lesson/i })).toBeInTheDocument();
    expect(screen.getByText(/streak/i)).toBeInTheDocument();
    expect(screen.getByText(/syllabus progress/i)).toBeInTheDocument();
    expect(screen.getByText(/grammar 3\/84 \(1 in progress\)/i)).toBeInTheDocument();
    expect(screen.getByText(/4 days/i)).toBeInTheDocument();
    expect(screen.getByText(/answer one exercise today to keep it/i)).toBeInTheDocument();
  });
});
