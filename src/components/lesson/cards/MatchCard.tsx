"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import type { CardProps } from "./types";

/** pairs[i] = displayed right index for left i; sent as ORIGINAL right indices via view.rightOrder. */
export function MatchCard({ view, disabled, onChange }: CardProps<"match">) {
  const [pairs, setPairs] = useState<(number | null)[]>(() => view.left.map(() => null));
  const [active, setActive] = useState<number | null>(null);

  function update(next: (number | null)[]) {
    setPairs(next);
    onChange(next.every((p) => p !== null) ? { pairs: next.map((k) => view.rightOrder[k as number]) } : null);
  }

  function clickLeft(i: number) {
    if (pairs[i] !== null && active === i) {
      update(pairs.map((p, j) => (j === i ? null : p)));
      setActive(null);
      return;
    }
    setActive(i);
  }

  function clickRight(k: number) {
    if (active === null) return;
    update(pairs.map((p, j) => (j === active ? k : p === k ? null : p)));
    setActive(null);
  }

  const btn = "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left";
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2" aria-label="Words">
        {view.left.map((l, i) => (
          <button key={i} type="button" disabled={disabled} aria-pressed={active === i} onClick={() => clickLeft(i)}
            className={`${btn} ${active === i ? "border-primary bg-surface-2" : pairs[i] !== null ? "border-primary bg-surface" : "border-border bg-surface"}`}>
            <span>{l}</span>
            {pairs[i] !== null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Link2 size={14} aria-hidden /> {pairs[i]! + 1}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2" aria-label="Meanings">
        {view.right.map((r, k) => {
          const owner = pairs.indexOf(k);
          return (
            <button key={k} type="button" disabled={disabled || active === null} onClick={() => clickRight(k)}
              className={`${btn} ${owner >= 0 ? "border-primary bg-surface" : "border-border bg-surface"} disabled:opacity-100`}>
              <span>{r}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{k + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
