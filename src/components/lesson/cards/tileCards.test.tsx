import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { toExerciseView, type ViewOf } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import { WordBankCard } from "./WordBankCard";
import { MatchCard } from "./MatchCard";
import { ExerciseBody } from "./ExerciseBody";

const bank = toExerciseView("wb1", E.WORD_BANK) as ViewOf<"word_bank">;
const match = toExerciseView("m1", E.MATCH) as ViewOf<"match">;

describe("WordBankCard", () => {
  it("moves tiles into the answer tray and back, emitting {tokens}", () => {
    const onChange = vi.fn();
    render(<WordBankCard view={bank} disabled={false} result={null} onChange={onChange} />);
    const pool = screen.getByRole("group", { name: /word tiles/i });
    const tray = screen.getByRole("group", { name: /your sentence/i });
    for (const w of ["I", "go", "to", "work"]) fireEvent.click(within(pool).getByRole("button", { name: w }));
    expect(onChange).toHaveBeenLastCalledWith({ tokens: ["I", "go", "to", "work"] });
    fireEvent.click(within(tray).getByRole("button", { name: "go" }));
    expect(onChange).toHaveBeenLastCalledWith({ tokens: ["I", "to", "work"] });
    expect(within(pool).getByRole("button", { name: "go" })).toBeInTheDocument();
    for (const w of ["I", "to", "work"]) fireEvent.click(within(tray).getByRole("button", { name: w }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("MatchCard", () => {
  const rightIdx = (text: string) => match.right.indexOf(text);
  const pickPair = (l: string, r: string) => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${l}`) }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${r}`) }));
  };

  it("pairs left and right, sending ORIGINAL right indices once every left is paired", () => {
    const onChange = vi.fn();
    render(<MatchCard view={match} disabled={false} result={null} onChange={onChange} />);
    pickPair("frankly", "to be honest");
    pickPair("broke", "with no money");
    expect(onChange).toHaveBeenLastCalledWith(null);
    pickPair("colleague", "a person you work with");
    expect(onChange).toHaveBeenLastCalledWith({ pairs: [2, 0, 1] });
    expect(match.rightOrder[rightIdx("to be honest")]).toBe(2);
  });

  it("moves a right item that is already paired", () => {
    const onChange = vi.fn();
    render(<MatchCard view={match} disabled={false} result={null} onChange={onChange} />);
    pickPair("frankly", "with no money");
    pickPair("broke", "with no money");
    pickPair("frankly", "to be honest");
    pickPair("colleague", "a person you work with");
    expect(onChange).toHaveBeenLastCalledWith({ pairs: [2, 0, 1] });
  });

  it("undoes a pair when its left item is clicked again", () => {
    const onChange = vi.fn();
    render(<MatchCard view={match} disabled={false} result={null} onChange={onChange} />);
    pickPair("frankly", "to be honest");
    pickPair("broke", "with no money");
    pickPair("colleague", "a person you work with");
    fireEvent.click(screen.getByRole("button", { name: /^frankly/ }));
    fireEvent.click(screen.getByRole("button", { name: /^frankly/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("ExerciseBody", () => {
  it("renders the card for every exercise type", () => {
    for (const [name, content] of Object.entries(E)) {
      const { unmount, container } = render(
        <ExerciseBody view={toExerciseView("x-" + name, content)} disabled={false} result={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
      );
      expect(container.firstChild, name).not.toBeNull();
      unmount();
    }
  });
});
