"use client";

import { Loader2, Send, WifiOff } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { WarmupState } from "@/lib/conversation/session";
import { MAX_TURN_CHARS, MAX_TURNS, MIN_TURNS_FOR_REVIEW, TARGET_TURNS } from "@/lib/conversation/rules";
import { ConversationReview } from "./ConversationReview";
import { useConversation } from "./useConversation";

const SECONDARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 font-display font-bold text-foreground enabled:hover:bg-surface-2 disabled:opacity-40";
const PRIMARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-display font-bold text-on-primary enabled:hover:opacity-90 disabled:opacity-40";

function Bubble({ role, children }: { role: "partner" | "learner"; children: ReactNode }) {
  return role === "partner" ? (
    <li className="flex justify-start">
      <span className="sr-only">Partner: </span>
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-2 text-foreground">{children}</p>
    </li>
  ) : (
    <li className="flex justify-end">
      <span className="sr-only">You: </span>
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-on-primary">{children}</p>
    </li>
  );
}

export function ConversationPanel({ lessonId, initial, onDone }: { lessonId: string; initial: WarmupState; onDone: () => void }) {
  const c = useConversation(lessonId, initial, onDone);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const wasStreaming = useRef(false);

  // back to the textarea once the partner has answered
  useEffect(() => {
    if (wasStreaming.current && !c.streaming) inputRef.current?.focus();
    wasStreaming.current = c.streaming;
  }, [c.streaming]);

  // the transcript list is the scroll container: keep it pinned to the newest message
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [c.turns.length, c.pending]);

  useEffect(() => {
    if (c.phase === "analysisFailed") retryRef.current?.focus();
  }, [c.phase]);

  if (c.phase === "review" && c.reviewState) {
    return <ConversationReview state={c.reviewState} onContinue={onDone} />;
  }
  if (c.phase === "done") return null;

  if (c.phase === "finishing") {
    return (
      <section className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface p-8 shadow-sm">
        <Loader2 size={28} className="text-primary motion-safe:animate-spin" aria-hidden />
        <p role="status" className="font-display font-bold">Analysing your conversation...</p>
      </section>
    );
  }

  if (c.phase === "analysisFailed") {
    return (
      <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm">
        <p role="alert" className="text-danger">
          {c.finishError ?? "Couldn't analyse your conversation - your messages are saved."}
        </p>
        {c.error && <p role="alert" className="text-danger">{c.error}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={() => void c.skip()} disabled={c.skipping} className={SECONDARY_BTN}>Continue without review</button>
          <button ref={retryRef} type="button" onClick={() => void c.finish()} disabled={c.skipping} className={PRIMARY_BTN}>Try again</button>
        </div>
      </section>
    );
  }

  const atLimit = c.learnerTurns >= MAX_TURNS;
  const canFinish = c.learnerTurns >= MIN_TURNS_FOR_REVIEW && !c.streaming && c.phase === "chat";
  const locked = c.phase !== "chat";

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void c.send();
  }

  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-bold">Warm-up conversation</h2>
        <p className="text-sm tabular-nums text-muted-foreground">
          <span className="sr-only">Your messages: </span>
          <span>{c.learnerTurns} of {TARGET_TURNS}</span>
        </p>
      </header>

      {c.phase === "starting" && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden />
          Starting the conversation...
        </p>
      )}
      {c.phase === "startFailed" && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-danger">{c.error}</p>
          <button type="button" onClick={() => void c.start()} className={SECONDARY_BTN}>Try again</button>
        </div>
      )}

      <ol ref={listRef} aria-label="Conversation" aria-live="polite" aria-busy={c.streaming} className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {c.turns.map((t) => (
          <Bubble key={t.id} role={t.role}>{t.text}</Bubble>
        ))}
        {c.pending !== null && (
          <Bubble role="partner">
            {c.pending ? (
              c.pending
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden />
                Partner is typing...
              </span>
            )}
          </Bubble>
        )}
      </ol>

      {c.notice && <p role="status" className="text-sm text-warning">{c.notice}</p>}

      {c.offline && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger p-3">
          <WifiOff size={18} className="shrink-0 text-danger" aria-hidden />
          <div className="flex flex-1 flex-col">
            <p className="font-semibold">Conversation partner is offline</p>
            <p className="text-sm text-muted-foreground">Your message is kept. Try again, or skip the conversation.</p>
          </div>
          <button type="button" onClick={() => void c.send()} disabled={c.streaming || !c.draft.trim()} className={SECONDARY_BTN}>
            Try again
          </button>
        </div>
      )}
      {c.error && c.phase !== "startFailed" && <p role="alert" className="text-danger">{c.error}</p>}

      {c.phase !== "starting" && c.phase !== "startFailed" && (atLimit ? (
        <p className="rounded-xl bg-surface-2 p-3 text-center font-semibold">You&apos;ve reached the turn limit</p>
      ) : (
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            aria-label="Your message"
            rows={2}
            maxLength={MAX_TURN_CHARS}
            value={c.draft}
            disabled={c.streaming || c.skipping || locked}
            onChange={(e) => c.setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type your reply - Enter to send, Shift+Enter for a new line"
            className="min-h-11 flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button type="button" aria-label="Send" onClick={() => void c.send()} disabled={c.streaming || c.skipping || locked || !c.draft.trim()}
            className={`${PRIMARY_BTN} min-w-11 px-3`}>
            <Send size={18} aria-hidden />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={() => void c.skip()} disabled={c.skipping || c.phase === "starting"}
          className="min-h-11 rounded-xl px-4 py-3 font-display font-bold text-muted-foreground enabled:hover:text-foreground disabled:opacity-40">
          Skip conversation
        </button>
        <button type="button" onClick={() => void c.finish()} disabled={!canFinish}
          className={c.learnerTurns >= TARGET_TURNS ? PRIMARY_BTN : SECONDARY_BTN}>
          Finish &amp; review
        </button>
      </div>
    </section>
  );
}
