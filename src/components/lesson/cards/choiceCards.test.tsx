import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { toExerciseView, type ViewOf } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import type { GradeResult } from "@/lib/grading/types";
import { ChoiceCard } from "./ChoiceCard";
import { DialogueCard } from "./DialogueCard";
import { ClozeSelectCard } from "./ClozeSelectCard";

const mcq = toExerciseView("e1", E.MULTIPLE_CHOICE) as ViewOf<"mcq">;
const dialogue = toExerciseView("e2", E.DIALOGUE_GAP) as ViewOf<"dialogue_gap">;
const cloze = toExerciseView("e3", E.CLOZE_DROPDOWN) as ViewOf<"cloze_mc">;
const graded = (given: string, expected: string, isCorrect = false) =>
  ({ isCorrect, parts: [{ correct: isCorrect, given, expected }] }) as unknown as GradeResult;

describe("ChoiceCard", () => {
  it("emits {selected} for the clicked option and shows the prompt", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText(mcq.prompt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /had finished/ }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: 1 });
    expect(screen.getByRole("radio", { name: /had finished/ })).toBeChecked();
  });

  it("selects with number keys 1-5", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled={false} result={null} onChange={onChange} />);
    fireEvent.keyDown(window, { key: "3" });
    expect(onChange).toHaveBeenLastCalledWith({ selected: 2 });
  });

  it("ignores number keys held with Ctrl/Alt/Meta (browser shortcuts, tab switching)", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled={false} result={null} onChange={onChange} />);
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    fireEvent.keyDown(window, { key: "3", altKey: true });
    fireEvent.keyDown(window, { key: "3", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores clicks and keys when disabled, and marks the chosen and the correct option after grading", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled result={graded("finishing", "had finished")} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /finish$/ }));
    fireEvent.keyDown(window, { key: "1" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /had finished/ })).toHaveAccessibleDescription(/correct answer/i);
  });

  it("marks the chosen option with a non-colour indicator, not any other option", () => {
    const onChange = vi.fn();
    render(<ChoiceCard view={mcq} disabled={false} result={null} onChange={onChange} />);
    const chosen = screen.getByRole("radio", { name: /had finished/ });
    fireEvent.click(chosen);
    expect(within(chosen).getByTestId("selected-mark")).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) {
      if (radio === chosen) continue;
      expect(within(radio).queryByTestId("selected-mark")).not.toBeInTheDocument();
    }
  });
});

describe("DialogueCard", () => {
  it("shows the turns and emits {selected}", () => {
    const onChange = vi.fn();
    render(<DialogueCard view={dialogue} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText("A: Sorry I am late.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /no worries/i }));
    expect(onChange).toHaveBeenLastCalledWith({ selected: 0 });
  });
});

describe("ClozeSelectCard", () => {
  it("emits null until every gap is chosen, then {selected: [...]}", () => {
    const onChange = vi.fn();
    render(<ClozeSelectCard view={cloze} disabled={false} result={null} onChange={onChange} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(selects[1], { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith({ selected: [0, 1] });
    expect(selects[0]).toHaveAccessibleName("Gap 1");
  });
});
