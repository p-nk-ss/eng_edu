"use client";

import { useState } from "react";
import type { CardProps } from "./types";

const tile = "min-h-11 max-w-full break-words rounded-xl border px-3 py-1 font-semibold motion-safe:transition-transform motion-safe:active:scale-95";

/** Tiles are tracked by index into view.tiles so duplicate words stay distinct. */
export function WordBankCard({ view, disabled, onChange }: CardProps<"word_bank">) {
  const [tray, setTray] = useState<number[]>([]);

  function update(next: number[]) {
    setTray(next);
    onChange(next.length ? { tokens: next.map((k) => view.tiles[k]) } : null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Your sentence" className="flex min-h-16 flex-wrap gap-2 rounded-xl border-2 border-dashed border-border p-3">
        {tray.length === 0 && <span className="text-muted-foreground">Tap the words in order</span>}
        {tray.map((k, pos) => (
          <button key={k} type="button" disabled={disabled} onClick={() => update(tray.filter((_, p) => p !== pos))} className={`${tile} border-primary bg-surface-2`}>
            {view.tiles[k]}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Word tiles" className="flex flex-wrap gap-2">
        {view.tiles.map((w, k) =>
          tray.includes(k) ? null : (
            <button key={k} type="button" disabled={disabled} onClick={() => update([...tray, k])} className={`${tile} border-border bg-surface hover:bg-surface-2`}>
              {w}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
