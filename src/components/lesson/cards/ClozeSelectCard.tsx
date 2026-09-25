"use client";

import { Fragment, useState } from "react";
import { splitGaps } from "@/lib/lesson/clozeParts";
import type { CardProps } from "./types";

export function ClozeSelectCard({ view, disabled, onChange }: CardProps<"cloze_mc">) {
  const [values, setValues] = useState<(number | null)[]>(() => view.gaps.map(() => null));
  const segments = splitGaps(view.text);

  function set(i: number, raw: string) {
    const next = values.map((v, j) => (j === i ? (raw === "" ? null : Number(raw)) : v));
    setValues(next);
    onChange(next.every((v) => v !== null) ? { selected: next as number[] } : null);
  }

  return (
    <p className="text-lg leading-loose">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg}
          {i < view.gaps.length && (
            <select
              aria-label={`Gap ${i + 1}`}
              value={values[i] ?? ""}
              disabled={disabled}
              onChange={(e) => set(i, e.target.value)}
              className="mx-1 min-h-11 max-w-full rounded-xl border border-border bg-surface px-3 py-1 font-semibold"
            >
              <option value="">...</option>
              {view.gaps[i].options.map((o, k) => (
                <option key={k} value={k}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </Fragment>
      ))}
    </p>
  );
}
