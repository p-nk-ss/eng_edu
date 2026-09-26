"use client";

import { Check, CircleDot } from "lucide-react";
import { useEffect, useId } from "react";

interface Props {
  options: string[];
  selected: number | null;
  disabled: boolean;
  /** option text marked as the key after grading (from GradeResult.parts[0].expected) */
  correctText: string | null;
  onSelect: (index: number) => void;
  label: string;
}

/** Radio-group of big option buttons; number keys 1-5 pick an option when focus is not in a field. */
export function OptionList({ options, selected, disabled, correctText, onSelect, label }: Props) {
  const hintId = useId();

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) onSelect(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, options.length, onSelect]);

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      <span id={hintId} className="sr-only">
        Correct answer
      </span>
      {options.map((opt, i) => {
        const isKey = correctText !== null && opt === correctText;
        const isChosen = selected === i;
        const showCircleDot = isChosen && !isKey;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={isChosen}
            aria-describedby={isKey ? hintId : undefined}
            disabled={disabled}
            onClick={() => onSelect(i)}
            className={[
              "flex min-h-11 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
              isKey ? "border-success bg-surface-2" : isChosen ? "border-primary bg-surface-2" : "border-border bg-surface hover:bg-surface-2",
              disabled ? "cursor-default" : "",
            ].join(" ")}
          >
            <span
              className={[
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums",
                showCircleDot ? "border-primary bg-primary text-on-primary" : "border-border",
              ].join(" ")}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 break-words">{opt}</span>
            {isKey && <Check data-testid={isChosen ? "selected-mark" : undefined} size={18} className="text-success" aria-hidden />}
            {showCircleDot && <CircleDot data-testid="selected-mark" size={18} className="text-primary" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
