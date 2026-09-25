"use client";

import { useCallback, useState } from "react";

/** Shared single-choice state for ChoiceCard/DialogueCard: picks an index and emits {selected}. */
export function useSingleSelect(onChange: (answer: { selected: number }) => void) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = useCallback(
    (i: number) => {
      setSelected(i);
      onChange({ selected: i });
    },
    [onChange],
  );
  return { selected, select };
}
