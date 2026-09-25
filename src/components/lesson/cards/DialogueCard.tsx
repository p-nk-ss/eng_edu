"use client";

import { useCallback, useState } from "react";
import { OptionList } from "./OptionList";
import type { CardProps } from "./types";

export function DialogueCard({ view, disabled, result, onChange }: CardProps<"dialogue_gap">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = useCallback(
    (i: number) => {
      setSelected(i);
      onChange({ selected: i });
    },
    [onChange],
  );
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2" aria-label="Dialogue">
        {view.turns.map((t, i) => {
          const isGap = t.includes("___");
          return (
            <li
              key={i}
              className={`max-w-[85%] rounded-2xl px-4 py-2 ${i % 2 === 0 ? "self-start bg-surface-2" : "self-end border border-primary bg-surface"} ${isGap ? "font-semibold" : ""}`}
            >
              {t}
            </li>
          );
        })}
      </ol>
      <OptionList
        label="Replies"
        options={view.options}
        selected={selected}
        disabled={disabled}
        correctText={result?.parts[0]?.expected ?? null}
        onSelect={select}
      />
    </div>
  );
}
