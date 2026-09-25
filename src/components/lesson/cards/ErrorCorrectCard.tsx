"use client";

import { useState } from "react";
import type { CardProps } from "./types";

export function ErrorCorrectCard({ view, disabled, onChange }: CardProps<"error_correct">) {
  const [index, setIndex] = useState<number | null>(null);
  const [fix, setFix] = useState("");

  function emit(i: number | null, f: string) {
    onChange(i !== null && f.trim() ? { index: i, fix: f } : null);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Tap the wrong word, then type the correction.</p>
      <p className="flex flex-wrap gap-2 text-lg">
        {view.tokens.map((t, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={index === i}
            disabled={disabled}
            onClick={() => {
              setIndex(i);
              setFix(t);
              emit(i, t);
            }}
            className={`min-h-11 rounded-xl border px-3 py-1 ${index === i ? "border-danger bg-surface-2 line-through" : "border-border bg-surface hover:bg-surface-2"}`}
          >
            {t}
          </button>
        ))}
      </p>
      {index !== null && (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Correction</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={fix}
            disabled={disabled}
            onChange={(e) => {
              setFix(e.target.value);
              emit(index, e.target.value);
            }}
            className="min-h-11 rounded-xl border border-border bg-surface px-3 py-2"
          />
        </label>
      )}
    </div>
  );
}
