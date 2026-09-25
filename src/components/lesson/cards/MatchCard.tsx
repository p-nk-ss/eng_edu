"use client";

import { Link2, MousePointerClick } from "lucide-react";
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
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {active === null ? "Pick a word, then its meaning." : `Now pick the meaning for "${view.left[active]}"`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div role="group" className="flex flex-col gap-2" aria-label="Words">
          {view.left.map((l, i) => (
            <button key={i} type="button" disabled={disabled} aria-pressed={active === i} onClick={() => clickLeft(i)}
              className={`${btn} ${active === i ? "border-primary bg-surface-2" : pairs[i] !== null ? "border-primary bg-surface" : "border-border bg-surface"}`}>
              <span className="min-w-0 break-words">{l}</span>
              {active === i ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <MousePointerClick size={14} aria-hidden />
                  <span className="sr-only">selected</span>
                </span>
              ) : pairs[i] !== null ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Link2 size={14} aria-hidden /> {pairs[i]! + 1}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div role="group" className="flex flex-col gap-2" aria-label="Meanings">
          {view.right.map((r, k) => {
            const owner = pairs.indexOf(k);
            const isTaken = owner >= 0;
            return (
              <button key={k} type="button" disabled={disabled || active === null} onClick={() => clickRight(k)}
                className={`${btn} ${isTaken ? "border-primary bg-surface" : "border-border bg-surface"} disabled:opacity-60`}>
                <span className="min-w-0 break-words">{r}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                  {isTaken && <Link2 size={14} aria-hidden />}
                  {isTaken ? owner + 1 : k + 1}
                  {isTaken && <span className="sr-only"> paired with {view.left[owner]}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
