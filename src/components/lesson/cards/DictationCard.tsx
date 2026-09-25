"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { speak, speechAvailable } from "@/lib/speech";
import type { CardProps } from "./types";

export function DictationCard({ view, disabled, onChange }: CardProps<"dictation">) {
  const [text, setText] = useState("");
  const [played, setPlayed] = useState(false);
  const [canSpeak, setCanSpeak] = useState(true);
  useEffect(() => setCanSpeak(speechAvailable()), []);

  return (
    <div className="flex flex-col gap-4">
      {canSpeak ? (
        <button
          type="button"
          onClick={() => setPlayed(speak(view.tts) || played)}
          className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-primary px-4 py-2 font-semibold text-primary"
        >
          <Volume2 size={20} aria-hidden /> {played ? "Play again" : "Play"}
        </button>
      ) : (
        <p className="text-sm text-warning">Audio isn&apos;t available in this browser.</p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Type what you hear</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() ? { text: e.target.value } : null);
          }}
          className="min-h-11 rounded-xl border border-border bg-surface px-3 py-2"
        />
      </label>
    </div>
  );
}
