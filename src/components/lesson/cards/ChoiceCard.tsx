"use client";

import { OptionList } from "./OptionList";
import type { CardProps } from "./types";
import { useSingleSelect } from "./useSingleSelect";

export function ChoiceCard({ view, disabled, result, onChange }: CardProps<"mcq">) {
  const { selected, select } = useSingleSelect(onChange);
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
