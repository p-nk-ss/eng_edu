import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { toExerciseView, type ViewOf } from "@/lib/lesson/lessonView";
import { VALID_EXERCISES as E } from "@/lib/lesson/fixtures";
import { FillBlankCard } from "./FillBlankCard";
import { DictationCard } from "./DictationCard";
import { ErrorCorrectCard } from "./ErrorCorrectCard";
import { TranslationCard, WritingCard } from "./FreeTextCard";

afterEach(() => vi.unstubAllGlobals());
const v = <T,>(id: string, c: unknown) => toExerciseView(id, c as never) as T;

describe("FillBlankCard", () => {
  it("shows the root word and emits {text: [...]} once a gap is filled", () => {
    const onChange = vi.fn();
    render(<FillBlankCard view={v<ViewOf<"open_cloze">>("e1", E.FILL_BLANK)} disabled={false} result={null} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: /gap 1/i });
    expect(screen.getByText(/\(BEAUTY\)/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "   " } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: "beautiful" } });
    expect(onChange).toHaveBeenLastCalledWith({ text: ["beautiful"] });
  });
});

describe("DictationCard", () => {
  it("speaks the sentence on Play and emits {text}", () => {
    const speakSpy = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak: speakSpy, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; lang = ""; rate = 1; voice = null; constructor(t: string) { this.text = t; } });
    const onChange = vi.fn();
    render(<DictationCard view={v<ViewOf<"dictation">>("e1", E.DICTATION)} disabled={false} result={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy.mock.calls[0][0].text).toBe("I'd like a coffee, please.");
    expect(speakSpy.mock.calls[0][0].rate).toBe(0.9);
    expect(screen.queryByText("I'd like a coffee, please.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "I'd like a coffee" } });
    expect(onChange).toHaveBeenLastCalledWith({ text: "I'd like a coffee" });
  });

  it("says when audio is unavailable but still accepts typing", () => {
    const onChange = vi.fn();
    render(<DictationCard view={v<ViewOf<"dictation">>("e1", E.DICTATION)} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText(/audio isn't available/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    expect(onChange).toHaveBeenLastCalledWith({ text: "x" });
  });
});

describe("ErrorCorrectCard", () => {
  it("needs a picked token and a fix; the fix field starts with the token", () => {
    const onChange = vi.fn();
    render(<ErrorCorrectCard view={v<ViewOf<"error_correct">>("e1", E.ERROR_CORRECTION)} disabled={false} result={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "don't" }));
    const fix = screen.getByRole("textbox", { name: /correction/i });
    expect(fix).toHaveValue("don't");
    expect(onChange).toHaveBeenLastCalledWith({ index: 1, fix: "don't" });
    fireEvent.change(fix, { target: { value: "doesn't" } });
    expect(onChange).toHaveBeenLastCalledWith({ index: 1, fix: "doesn't" });
    fireEvent.change(fix, { target: { value: " " } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "don't" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("TranslationCard / WritingCard", () => {
  it("translation: shows the Russian source, caps at 500 characters and emits {text}", () => {
    const onChange = vi.fn();
    render(<TranslationCard view={v<ViewOf<"translation">>("e1", E.TRANSLATION)} disabled={false} result={null} onChange={onChange} />);
    expect(screen.getByText((E.TRANSLATION as { source: string }).source)).toBeInTheDocument();
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("maxLength", "500");
    fireEvent.change(box, { target: { value: "I finished it." } });
    expect(onChange).toHaveBeenLastCalledWith({ text: "I finished it." });
    expect(screen.getByText("14 / 500")).toBeInTheDocument();
  });

  it("writing: counts words against the minimum", () => {
    const onChange = vi.fn();
    render(<WritingCard view={v<ViewOf<"open_writing">>("e1", E.OPEN_WRITING)} disabled={false} result={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "one two  three" } });
    expect(screen.getByText("3 / 60 words")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ text: "one two  three" });
  });

  it("writing: says in text (not colour alone) when the minimum is reached", () => {
    render(<WritingCard view={v<ViewOf<"open_writing">>("e1", E.OPEN_WRITING)} disabled={false} result={null} onChange={vi.fn()} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "word ".repeat(59) } });
    expect(screen.queryByText(/minimum reached/i)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "word ".repeat(60) } });
    expect(screen.getByText(/minimum reached/i)).toBeInTheDocument();
  });

  it("Enter adds a newline, Ctrl+Enter submits", () => {
    const onSubmit = vi.fn();
    render(<WritingCard view={v<ViewOf<"open_writing">>("e1", E.OPEN_WRITING)} disabled={false} result={null} onChange={vi.fn()} onSubmit={onSubmit} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
