"use client";

import { isBelowLevel } from "@/lib/lesson/levels";
import type { PlayerLesson } from "@/lib/lesson/loadLesson";

export function LessonIntro({ lesson, onStart }: { lesson: PlayerLesson; onStart: () => void }) {
  const { intro, themeLabel, items } = lesson;
  const grammar = intro.grammar;
  const belowLevel = grammar !== null && intro.learnerLevel !== null && isBelowLevel(grammar.level, intro.learnerLevel);

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-xl font-bold">Today's lesson</h2>
      {intro.learnerLevel && <p className="text-sm text-muted-foreground">Your level: {intro.learnerLevel}</p>}

      {grammar && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2">
            <span className="font-display text-lg font-bold">{grammar.title}</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">{grammar.level}</span>
          </p>
          {belowLevel && (
            <p className="text-sm text-muted-foreground">
              Review of {grammar.level} basics - closing gaps below your {intro.learnerLevel} level
            </p>
          )}
          {grammar.description && <p className="text-sm">{grammar.description}</p>}
          {grammar.example && (
            <blockquote className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">{grammar.example}</blockquote>
          )}
          <p className="text-sm text-muted-foreground">
            {intro.topicLessonNumber === 1 ? "First lesson on this topic" : `Lesson ${intro.topicLessonNumber} on this topic`}
          </p>
        </div>
      )}

      {themeLabel && <p className="text-sm text-muted-foreground">Theme: {themeLabel}</p>}

      {intro.vocab.length > 0 && (
        <div className="flex flex-col gap-1">
          <p id="lesson-intro-words-label" className="text-sm font-semibold">
            Words in this lesson
          </p>
          <ul aria-labelledby="lesson-intro-words-label" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {intro.vocab.map((word) => (
              <li key={word}>{word}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {items.length} {items.length === 1 ? "exercise" : "exercises"}
      </p>

      <button
        type="button"
        autoFocus
        onClick={onStart}
        className="min-h-11 self-end rounded-xl bg-primary px-6 py-3 font-display font-bold text-on-primary hover:opacity-90"
      >
        Start
      </button>
    </div>
  );
}
