"use client";

import { useCallback, useState } from "react";
import { OptionList } from "./OptionList";
import type { CardProps } from "./types";

export function ChoiceCard({ view, disabled, result, onChange }: CardProps<"mcq">) {
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
      <p className="text-lg">{view.prompt}</p>
      <OptionList
        label="Options"
        options={view.options}
        selected={selected}
        disabled={disabled}
        correctText={result?.parts[0]?.expected ?? null}
        onSelect={select}
      />
    </div>
  );
}
