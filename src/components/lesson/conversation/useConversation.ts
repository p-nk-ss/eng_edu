"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WarmupState, WarmupTurn } from "@/lib/conversation/session";
import { CONNECTION_LOST_MARKER as CONNECTION_LOST, learnerTurnCount } from "@/lib/conversation/rules";

/** Drops the marker, or any partial prefix of it, from the end of the streamed text. */
const stripMarker = (s: string): string => {
  for (let k = CONNECTION_LOST.length; k > 0; k--) {
    if (s.endsWith(CONNECTION_LOST.slice(0, k))) return s.slice(0, -k);
  }
  return s;
};

export type ConversationPhase =
  | "starting" // POST /start in flight (status null on mount)
  | "startFailed"
  | "chat"
  | "finishing" // finish(review) in flight: "Analysing your conversation..."
  | "analysisFailed"
  | "review"
  | "done";

const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

const readError = async (res: Response): Promise<string | undefined> => {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === "string" ? body.error : undefined;
};

const TURN_ERRORS: Record<string, string> = {
  closed: "This conversation is already finished.",
  limit: "You've reached the turn limit.",
  busy: "The partner is still replying - wait a moment and send again.",
  invalid: "Your message could not be sent - check its length.",
};

const isState = (v: unknown): v is WarmupState =>
  typeof v === "object" && v !== null && "status" in v && Array.isArray((v as WarmupState).turns);

/**
 * Client state machine of the warm-up conversation: start -> chat (streamed turns) -> finish ->
 * review / skip. The local transcript is authoritative for display once a turn completes.
 */
export function useConversation(lessonId: string, initial: WarmupState, onDone: () => void) {
  const initialPhase = (): ConversationPhase => {
    if (initial.status === null) return "starting";
    if (initial.status === "ACTIVE") return "chat";
    if (initial.status === "ANALYZED") return "review";
    return "done";
  };
  const [phase, setPhase] = useState<ConversationPhase>(initialPhase);
  const [turns, setTurns] = useState<WarmupTurn[]>(initial.turns);
  const [reviewState, setReviewState] = useState<WarmupState | null>(initial.status === "ANALYZED" ? initial : null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const busy = useRef(false);
  const skipBusy = useRef(false);
  /** Aborts the in-flight turn (request and streamed body) when the learner skips. */
  const turnAbort = useRef<AbortController | null>(null);
  const localId = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const start = useCallback(async () => {
    setPhase("starting");
    setError(null);
    try {
      const res = await post("/api/conversation/start", { lessonId });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !isState(body)) {
        setError("Couldn't start the conversation.");
        setPhase("startFailed");
        return;
      }
      setTurns(body.turns);
      setPhase(body.status === "ANALYZED" ? "review" : body.status === "ACTIVE" ? "chat" : "done");
      if (body.status === "ANALYZED") setReviewState(body);
    } catch {
      setError("Couldn't start the conversation.");
      setPhase("startFailed");
    }
  }, [lessonId]);

  const started = useRef(false);
  useEffect(() => {
    if (initial.status === null && !started.current) {
      started.current = true;
      void start();
    }
  }, [initial.status, start]);

  useEffect(() => {
    if (phase === "done") onDoneRef.current();
  }, [phase]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy.current || skipBusy.current) return;
    busy.current = true;
    const id = `local-${++localId.current}`;
    setTurns((prev) => [...prev, { id, role: "learner", text, turnIndex: prev.length, corrections: null }]);
    setDraft("");
    setStreaming(true);
    setPending("");
    setNotice(null);
    setError(null);
    const fail = (message: string | null, isOffline = false) => {
      setTurns((prev) => prev.filter((t) => t.id !== id));
      setDraft(text);
      setOffline(isOffline);
      setError(message);
    };
    let received = "";
    const abort = new AbortController();
    turnAbort.current = abort;
    const keepPartial = () => {
      const reply = stripMarker(received).trimEnd();
      if (reply) setTurns((prev) => [...prev, { id: `${id}-reply`, role: "partner", text: reply, turnIndex: prev.length, corrections: null }]);
    };
    try {
      const res = await post("/api/conversation/turn", { lessonId, text }, abort.signal);
      if (abort.signal.aborted) return;
      if (!res.ok || !res.body) {
        const code = await readError(res);
        if (res.status === 503) fail(null, true);
        else fail((code && TURN_ERRORS[code]) ?? code ?? `Request failed (${res.status})`);
        return;
      }
      setOffline(false);
      const reader = res.body.getReader();
      abort.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
      const decoder = new TextDecoder();
      let lost = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
          setPending(stripMarker(received));
        }
        received += decoder.decode();
      } catch {
        lost = true;
      }
      // skipped mid-reply: keep what arrived, no connection notice
      if (abort.signal.aborted) return keepPartial();
      if (received.endsWith(CONNECTION_LOST)) {
        lost = true;
        received = received.slice(0, -CONNECTION_LOST.length);
      }
      const reply = received.trimEnd();
      setTurns((prev) => (reply ? [...prev, { id: `${id}-reply`, role: "partner", text: reply, turnIndex: prev.length, corrections: null }] : prev));
      if (lost) setNotice("The connection was lost mid-reply. You can keep talking or finish.");
    } catch {
      // aborted by Skip: not an error; otherwise the request itself failed (network down / dev server
      // unreachable): treat as offline
      if (abort.signal.aborted) keepPartial();
      else fail(null, true);
    } finally {
      if (turnAbort.current === abort) turnAbort.current = null;
      setPending(null);
      setStreaming(false);
      busy.current = false;
    }
  }, [draft, lessonId]);

  const finish = useCallback(async () => {
    if (busy.current || skipBusy.current) return;
    busy.current = true;
    setPhase("finishing");
    setError(null);
    setFinishError(null);
    try {
      const res = await post("/api/conversation/finish", { lessonId, action: "review" });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !isState(body)) {
        // only a 502 is the analysis failing; anything else surfaces the server's message
        const serverError = typeof (body as { error?: unknown } | null)?.error === "string" ? (body as { error: string }).error : null;
        setFinishError(res.status === 502 ? null : serverError ?? `Request failed (${res.status})`);
        setPhase("analysisFailed");
        return;
      }
      if (body.status === "ANALYZED") {
        setReviewState(body);
        setPhase("review");
      } else {
        setPhase("done");
      }
    } catch {
      setPhase("analysisFailed");
    } finally {
      busy.current = false;
    }
  }, [lessonId]);

  /** Allowed while a turn is pending or streaming: the turn is aborted first. */
  const skip = useCallback(async () => {
    if (skipBusy.current) return;
    if (busy.current && !turnAbort.current) return; // a finish is in flight
    skipBusy.current = true;
    turnAbort.current?.abort();
    setSkipping(true);
    setError(null);
    setOffline(false);
    try {
      const res = await post("/api/conversation/finish", { lessonId, action: "skip" });
      if (!res.ok) throw new Error(String(res.status));
      setPhase("done");
    } catch {
      setError("Couldn't skip right now - try again.");
    } finally {
      setSkipping(false);
      skipBusy.current = false;
    }
  }, [lessonId]);

  return {
    phase,
    turns,
    learnerTurns: learnerTurnCount(turns),
    reviewState,
    draft,
    setDraft,
    streaming,
    pending,
    offline,
    notice,
    error,
    skipping,
    finishError,
    start,
    send,
    finish,
    skip,
  };
}
