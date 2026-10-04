import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/lib/errors/queries", () => ({ listErrors: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/errors" }));

import { listErrors } from "@/lib/errors/queries";
import type { ErrorView } from "@/lib/errors/queries";
import ErrorsPage from "./page";

const itemA: ErrorView = {
  id: "A",
  title: "Comparative with more",
  group: "grammar",
  examples: ["as -> than"],
  status: "NEW",
  correctStreak: 1,
  streakTarget: 3,
  due: { label: "Overdue since 27 Sep", isDue: true },
  createdAt: new Date(2026, 8, 26), // 26 Sep
  attempts: [{ at: new Date(2026, 9, 2), correct: true }], // 2 Oct
};

const itemB: ErrorView = {
  id: "B",
  title: "Translation - meaning",
  group: "translation",
  examples: ["mean -> meaning"],
  status: "REVIEWING",
  correctStreak: 2,
  streakTarget: 3,
  due: { label: "Due today", isDue: true },
  createdAt: new Date(2026, 8, 20),
  attempts: [],
};

const counts = {
  status: { open: 2, mastered: 0, all: 2 },
  group: { all: 2, grammar: 1, translation: 1, vocab: 0, listening: 0, writing: 0, general: 0 },
};

describe("/errors", () => {
  it("renders the heading, nav and one card per item", async () => {
    vi.mocked(listErrors).mockResolvedValue({ items: [itemA, itemB], counts });

    render(await ErrorsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Mistakes" })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();

    expect(screen.getByText("Comparative with more")).toBeInTheDocument();
    expect(screen.getByText("Grammar")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 correct in a row")).toBeInTheDocument();
    expect(screen.getByText("Overdue since 27 Sep")).toBeInTheDocument();
    expect(screen.getByText("First seen 26 Sep")).toBeInTheDocument();
    expect(screen.getByText("as -> than")).toBeInTheDocument();
    expect(screen.getAllByText("Review history")).toHaveLength(2);
    expect(screen.getByText("2 Oct")).toBeInTheDocument();
    expect(screen.getByText("correct")).toBeInTheDocument();

    expect(screen.getByText("Reviewing")).toBeInTheDocument();
    expect(screen.getByText("Translation - meaning")).toBeInTheDocument();
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
  });

  it("renders filter links with counts, active aria-current, and hrefs keeping the other filter", async () => {
    vi.mocked(listErrors).mockResolvedValue({ items: [itemA, itemB], counts });

    render(await ErrorsPage({ searchParams: Promise.resolve({ status: "open", category: "translation" }) }));

    expect(listErrors).toHaveBeenCalledWith({ status: "open", group: "translation" }, expect.any(Date));

    const statusGroup = within(screen.getByRole("group", { name: "Filter by status" }));
    const categoryGroup = within(screen.getByRole("group", { name: "Filter by category" }));

    const openLink = statusGroup.getByRole("link", { name: "Open (2)" });
    expect(openLink).toHaveAttribute("aria-current", "page");
    const masteredLink = statusGroup.getByRole("link", { name: "Mastered (0)" });
    expect(masteredLink).not.toHaveAttribute("aria-current");
    const allStatusLink = statusGroup.getByRole("link", { name: "All (2)" });
    expect(allStatusLink).toHaveAttribute("href", "/errors?status=all&category=translation");

    const translationLink = categoryGroup.getByRole("link", { name: "Translation (1)" });
    expect(translationLink).toHaveAttribute("aria-current", "page");
    expect(translationLink).toHaveAttribute("href", "/errors?status=open&category=translation");
    const grammarLink = categoryGroup.getByRole("link", { name: "Grammar (1)" });
    expect(grammarLink).not.toHaveAttribute("aria-current");
    expect(grammarLink).toHaveAttribute("href", "/errors?status=open&category=grammar");
  });

  it("falls back unknown filter values to open/all", async () => {
    vi.mocked(listErrors).mockResolvedValue({ items: [], counts });

    render(await ErrorsPage({ searchParams: Promise.resolve({ status: "foo", category: "bar" }) }));

    expect(listErrors).toHaveBeenCalledWith({ status: "open", group: "all" }, expect.any(Date));
  });

  it("shows an empty state when there are no items", async () => {
    vi.mocked(listErrors).mockResolvedValue({
      items: [],
      counts: { status: { open: 0, mastered: 0, all: 0 }, group: { all: 0, grammar: 0, translation: 0, vocab: 0, listening: 0, writing: 0, general: 0 } },
    });

    render(await ErrorsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("No mistakes here yet.")).toBeInTheDocument();
  });
});
