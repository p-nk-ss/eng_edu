import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { WarmupState } from "@/lib/conversation/session";
import { ConversationReview } from "./ConversationReview";

const finding = (turnId: string, original: string, corrected: string, severity: "minor" | "moderate" | "major") => ({
  turnId, original, corrected, explanation: `Explain ${original}.`, category: "grammar", severity, grammarTopicId: null,
});

const analyzed = (): WarmupState => ({
  status: "ANALYZED",
  turns: [
    { id: "t0", role: "partner", text: "Hi! How was your week?", turnIndex: 0, corrections: null },
    { id: "t1", role: "learner", text: "I goed to the office every day.", turnIndex: 1, corrections: [finding("t1", "goed", "went", "major")] },
    { id: "t2", role: "partner", text: "Sounds busy.", turnIndex: 2, corrections: null },
    { id: "t3", role: "learner", text: "Yes it was very busy week.", turnIndex: 3, corrections: [finding("t3", "very busy week", "a very busy week", "moderate"), finding("t3", "absent words", "present words", "minor")] },
    { id: "t4", role: "partner", text: "Nice.", turnIndex: 4, corrections: null },
    { id: "t5", role: "learner", text: "Thanks.", turnIndex: 5, corrections: [] },
  ],
  review: { topIssues: ["Irregular past tense", "Articles before adjectives"], counts: { minor: 1, moderate: 1, major: 1 }, errorsAdded: 2 },
});

describe("ConversationReview", () => {
  it("lists the top issues", () => {
    render(<ConversationReview state={analyzed()} onContinue={() => {}} />);
    const list = screen.getByRole("list", { name: "Top issues" });
    expect(within(list).getByText("Irregular past tense")).toBeInTheDocument();
    expect(within(list).getByText("Articles before adjectives")).toBeInTheDocument();
  });

  it("highlights each finding's original fragment with a severity text label, plus corrected text and explanation", () => {
    const { container } = render(<ConversationReview state={analyzed()} onContinue={() => {}} />);
    const marks = Array.from(container.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marks).toEqual(["goed", "very busy week"]);
    expect(container.querySelector("mark")).toHaveClass("text-danger");
    expect(screen.getAllByText("major").length).toBeGreaterThan(0);
    expect(screen.getAllByText("moderate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("minor").length).toBeGreaterThan(0);
    expect(screen.getByText("went")).toBeInTheDocument();
    expect(screen.getByText("Explain goed.")).toBeInTheDocument();
    expect(screen.getByText("a very busy week")).toBeInTheDocument();
    // a fragment that is not in the turn text is still listed, just not highlighted
    expect(screen.getByText("present words")).toBeInTheDocument();
    expect(screen.getByText("Explain absent words.")).toBeInTheDocument();
  });

  it("shows how many mistakes were added and continues", () => {
    const onContinue = vi.fn();
    render(<ConversationReview state={analyzed()} onContinue={onContinue} />);
    expect(screen.getByText("2 mistakes added to your review list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue to exercises" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("uses the singular for one added mistake and says so when nothing was found", () => {
    const one = analyzed();
    one.review = { topIssues: [], counts: { minor: 0, moderate: 0, major: 0 }, errorsAdded: 1 };
    const { unmount } = render(<ConversationReview state={one} onContinue={() => {}} />);
    expect(screen.getByText("1 mistake added to your review list")).toBeInTheDocument();
    unmount();
    const clean: WarmupState = { ...analyzed(), turns: analyzed().turns.map((t) => ({ ...t, corrections: t.role === "learner" ? [] : null })) };
    clean.review = { topIssues: [], counts: { minor: 0, moderate: 0, major: 0 }, errorsAdded: 0 };
    render(<ConversationReview state={clean} onContinue={() => {}} />);
    expect(screen.getByText("No mistakes found - nice work.")).toBeInTheDocument();
    expect(screen.queryByText(/added to your review list/)).not.toBeInTheDocument();
  });
});
