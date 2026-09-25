"use client";

import { Check } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { CardProps } from "./types";

export const TRANSLATION_MAX = 500;
const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface SubmitProp {
  /** Ctrl/Cmd+Enter; plain Enter inserts a newline */
  onSubmit?: () => void;
}

function useFreeText(onChange: (a: { text: string } | null) => void, onSubmit?: () => void) {
  const [text, setText] = useState("");
  return {
    text,
    onTextChange: (value: string) => {
      setText(value);
      onChange(value.trim() ? { text: value } : null);
    },
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSubmit?.();
      }
    },
  };
}

const boxClass = "min-h-32 w-full rounded-xl border border-border bg-surface px-3 py-2 leading-relaxed";

export function TranslationCard({ view, disabled, onChange, onSubmit }: CardProps<"translation"> & SubmitProp) {
  const t = useFreeText(onChange, onSubmit);
  return (
    <div className="flex flex-col gap-3">
      <p lang="ru" className="text-lg">{view.source}</p>
      {view.hint && <p className="text-sm text-muted-foreground">Hint: {view.hint}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Your translation</span>
        <textarea value={t.text} maxLength={TRANSLATION_MAX} disabled={disabled} onChange={(e) => t.onTextChange(e.target.value)} onKeyDown={t.onKeyDown} className={boxClass} />
      </label>
      <p className="self-end text-sm tabular-nums text-muted-foreground">{t.text.length} / {TRANSLATION_MAX}</p>
    </div>
  );
}

export function WritingCard({ view, disabled, onChange, onSubmit }: CardProps<"open_writing"> & SubmitProp) {
  const t = useFreeText(onChange, onSubmit);
  const words = countWords(t.text);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg">{view.prompt}</p>
      {view.hint && <p className="text-sm text-muted-foreground">Hint: {view.hint}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Your text</span>
        <textarea value={t.text} disabled={disabled} onChange={(e) => t.onTextChange(e.target.value)} onKeyDown={t.onKeyDown} className={`${boxClass} min-h-48`} />
      </label>
      <p className={`flex items-center gap-1 self-end text-sm tabular-nums ${words >= view.minWords ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {words >= view.minWords && <Check size={16} className="text-success" aria-hidden />}
        {words} / {view.minWords} words
        {words >= view.minWords && <span className="sr-only"> - minimum reached</span>}
      </p>
    </div>
  );
}
