"use client";

import { Fragment, useState } from "react";
import { splitGaps } from "@/lib/lesson/clozeParts";
import type { CardProps } from "./types";

export function FillBlankCard({ view, disabled, onChange }: CardProps<"open_cloze">) {
  const [values, setValues] = useState<string[]>(() => view.gaps.map(() => ""));
  const segments = splitGaps(view.text);

  function set(i: number, value: string) {
    const next = values.map((v, j) => (j === i ? value : v));
    setValues(next);
    onChange(next.some((v) => v.trim() !== "") ? { text: next } : null);
  }

  return (
    <p className="text-lg leading-loose">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg}
          {i < view.gaps.length && (
            <input
              type="text"
              aria-label={`Gap ${i + 1}`}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={values[i]}
              disabled={disabled}
              onChange={(e) => set(i, e.target.value)}
              className="mx-1 min-h-11 w-40 border-b-2 border-primary bg-transparent px-1 text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </Fragment>
      ))}
    </p>
  );
}
