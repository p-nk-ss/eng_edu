import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WarmupState, WarmupTurn } from "@/lib/conversation/session";
import { ConversationPanel } from "./ConversationPanel";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const enc = new TextEncoder();
const textStream = (...chunks: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { status: 200 });
/** A stream the test feeds by hand. */
function manualStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const res = new Response(new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } }), { status: 200 });
  return { res, push: (s: string) => ctrl.enqueue(enc.encode(s)), close: () => ctrl.close() };
}

const OPENING = "Hi! Let's talk about work. What do you do?";
const turnsWith = (learner: number): WarmupTurn[] => {
  const turns: WarmupTurn[] = [{ id: "p0", role: "partner", text: OPENING, turnIndex: 0, corrections: null }];
  for (let i = 1; i <= learner; i++) {
    turns.push({ id: `l${i}`, role: "learner", text: `Learner message ${i}`, turnIndex: 2 * i - 1, corrections: null });
    turns.push({ id: `p${i}`, role: "partner", text: `Partner reply ${i}`, turnIndex: 2 * i, corrections: null });
  }
  return turns;
};
const active = (learner = 0): WarmupState => ({ status: "ACTIVE", turns: turnsWith(learner), review: null });
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const textarea = () => screen.getByRole("textbox", { name: "Your message" });
const type = (text: string) => fireEvent.change(textarea(), { target: { value: text } });
const enter = (shiftKey = false) => fireEvent.keyDown(textarea(), { key: "Enter", shiftKey });

const analyzedState = (): WarmupState => ({
  status: "ANALYZED",
  turns: [
    { id: "p0", role: "partner", text: OPENING, turnIndex: 0, corrections: null },
    { id: "l1", role: "learner", text: "I goed to work.", turnIndex: 1, corrections: [{ turnId: "l1", original: "goed", corrected: "went", explanation: "Irregular past.", category: "grammar", severity: "major", grammarTopicId: null }] },
    { id: "p1", role: "partner", text: "Nice.", turnIndex: 2, corrections: null },
    { id: "l2", role: "learner", text: "Yes.", turnIndex: 3, corrections: [] },
  ],
  review: { topIssues: ["Irregular past tense"], counts: { minor: 0, moderate: 0, major: 1 }, errorsAdded: 2 },
});

describe("ConversationPanel", () => {
  it("starts the session when it has not been started and shows the partner opening", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(active()));
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationPanel lessonId="L1" initial={{ status: null, turns: [], review: null }} onDone={() => {}} />);
    expect(await screen.findByText(OPENING)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/conversation/start");
    expect(body(fetchMock.mock.calls[0])).toEqual({ lessonId: "L1" });
  });

  it("sends on Enter, shows the learner bubble at once and streams the partner reply", async () => {
    const s = manualStream();
    const fetchMock = vi.fn().mockResolvedValueOnce(s.res);
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
    expect(screen.getByText("Warm-up conversation")).toBeInTheDocument();
    expect(screen.getByText("0 of 8")).toBeInTheDocument();
    type("I work in a bank.");
    enter();
    expect(screen.getByText("I work in a bank.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/conversation/turn");
    expect(body(fetchMock.mock.calls[0])).toEqual({ lessonId: "L1", text: "I work in a bank." });
    await waitFor(() => expect(textarea()).toBeDisabled());
    s.push("That sounds ");
    expect(await screen.findByText("That sounds")).toBeInTheDocument();
    s.push("interesting!");
    s.close();
    expect(await screen.findByText("That sounds interesting!")).toBeInTheDocument();
    await waitFor(() => expect(textarea()).toBeEnabled());
    expect(screen.getByText("1 of 8")).toBeInTheDocument();
    expect(textarea()).toHaveValue("");
  });

  it("keeps the transcript scrolled to the newest message", async () => {
    const s = manualStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(s.res));
    const setScrollTop = vi.spyOn(Element.prototype, "scrollTop", "set");
    try {
      render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
      const list = screen.getByRole("list", { name: "Conversation" });
      setScrollTop.mockClear();
      type("New message");
      enter();
      expect(setScrollTop.mock.contexts).toContain(list);
      setScrollTop.mockClear();
      s.push("Streaming reply");
      await screen.findByText("Streaming reply");
      expect(setScrollTop.mock.contexts).toContain(list);
      s.close();
      await waitFor(() => expect(textarea()).toBeEnabled());
    } finally {
      setScrollTop.mockRestore();
    }
  });

  it("409 busy removes the learner bubble, restores the text and explains", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: "busy" }, 409)));
    render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
    type("Second try");
    enter();
    expect(await screen.findByText("The partner is still replying - wait a moment and send again.")).toBeInTheDocument();
    expect(textarea()).toHaveValue("Second try");
    expect(within(screen.getByRole("list", { name: "Conversation" })).queryByText("Second try")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 8")).toBeInTheDocument();
    await waitFor(() => expect(textarea()).toBeEnabled());
  });

  it("strips the connection-lost marker even when it arrives split across chunks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(textStream("Sure, let", "'s go\n[conne", "ction lost]")));
    render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
    type("Hello");
    enter();
    expect(await screen.findByText("Sure, let's go")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/connection was lost/i);
    expect(screen.queryByText(/\[conne/)).not.toBeInTheDocument();
    await waitFor(() => expect(textarea()).toBeEnabled());
  });

  it("Shift+Enter does not send", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
    type("Line one");
    enter(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a dropped connection as a notice, not as partner text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(textStream("Well, I ", "think\n[connection lost]")));
    render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
    type("Hello");
    enter();
    expect(await screen.findByText("Well, I think")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/connection was lost/i);
    expect(screen.queryByText(/\[connection lost\]/)).not.toBeInTheDocument();
    await waitFor(() => expect(textarea()).toBeEnabled());
  });

  it("Finish & review is disabled below 2 learner turns, enabled from 2, primary from 8", () => {
    const { unmount } = render(<ConversationPanel lessonId="L1" initial={active(1)} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Finish & review" })).toBeDisabled();
    unmount();
    const r2 = render(<ConversationPanel lessonId="L1" initial={active(2)} onDone={() => {}} />);
    const finish2 = screen.getByRole("button", { name: "Finish & review" });
    expect(finish2).toBeEnabled();
    expect(finish2).not.toHaveClass("bg-primary");
    r2.unmount();
    render(<ConversationPanel lessonId="L1" initial={active(8)} onDone={() => {}} />);
    expect(screen.getByRole("button", { name: "Finish & review" })).toHaveClass("bg-primary");
    expect(screen.getByText("8 of 8")).toBeInTheDocument();
  });

  it("replaces the textarea at the turn limit", () => {
    render(<ConversationPanel lessonId="L1" initial={active(12)} onDone={() => {}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("You've reached the turn limit")).toBeInTheDocument();
  });

  it("offline keeps the text: 503 shows the offline state, Try again resends the same text", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "partner_unavailable" }, 503))
      .mockResolvedValueOnce(textStream("Welcome back!"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationPanel lessonId="L1" initial={active()} onDone={() => {}} />);
    type("Are you there?");
    enter();
    expect(await screen.findByText("Conversation partner is offline")).toBeInTheDocument();
    expect(textarea()).toHaveValue("Are you there?");
    expect(screen.queryByText("Are you there?", { selector: "li *, li" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip conversation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Welcome back!")).toBeInTheDocument();
    expect(body(fetchMock.mock.calls[1])).toEqual({ lessonId: "L1", text: "Are you there?" });
    expect(screen.queryByText("Conversation partner is offline")).not.toBeInTheDocument();
    await waitFor(() => expect(textarea()).toBeEnabled());
  });

  it("Skip finishes with skip and calls onDone", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ status: "SKIPPED", turns: [], review: null }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ConversationPanel lessonId="L1" initial={active(1)} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip conversation" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/conversation/finish");
    expect(body(fetchMock.mock.calls[0])).toEqual({ lessonId: "L1", action: "skip" });
  });

  it("Skip stays enabled while a turn is pending: it aborts the turn, posts skip, calls onDone, shows no error", async () => {
    let turnSignal: AbortSignal | undefined;
    const pendingTurn = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        turnSignal = init.signal ?? undefined;
        turnSignal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    const fetchMock = vi.fn()
      .mockImplementationOnce(pendingTurn)
      .mockResolvedValueOnce(json({ status: "SKIPPED", turns: [], review: null }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ConversationPanel lessonId="L1" initial={active(2)} onDone={onDone} />);
    type("Hello there");
    enter();
    await waitFor(() => expect(textarea()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Finish & review" })).toBeDisabled();
    const skipBtn = screen.getByRole("button", { name: "Skip conversation" });
    expect(skipBtn).toBeEnabled();
    expect(turnSignal?.aborted).toBe(false);

    fireEvent.click(skipBtn);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(turnSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/conversation/finish");
    expect(body(fetchMock.mock.calls[1])).toEqual({ lessonId: "L1", action: "skip" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Conversation partner is offline")).not.toBeInTheDocument();
  });

  it("Skip while the reply streams aborts the turn and finishes with skip", async () => {
    const s = manualStream();
    let turnSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        turnSignal = init.signal ?? undefined;
        return Promise.resolve(s.res);
      })
      .mockResolvedValueOnce(json({ status: "SKIPPED", turns: [], review: null }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ConversationPanel lessonId="L1" initial={active(2)} onDone={onDone} />);
    type("Hello there");
    enter();
    s.push("Half a rep");
    expect(await screen.findByText("Half a rep")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish & review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Skip conversation" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(turnSignal?.aborted).toBe(true);
    expect(body(fetchMock.mock.calls[1])).toEqual({ lessonId: "L1", action: "skip" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Finish analyses, then shows the review; Continue calls onDone", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ConversationPanel lessonId="L1" initial={active(2)} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
    expect(await screen.findByText("Analysing your conversation...")).toBeInTheDocument();
    expect(body(fetchMock.mock.calls[0])).toEqual({ lessonId: "L1", action: "review" });
    resolve(json(analyzedState()));
    expect(await screen.findByText("Top issues")).toBeInTheDocument();
    expect(screen.getByText("goed", { selector: "mark" })).toBeInTheDocument();
    expect(screen.getAllByText("major").length).toBeGreaterThan(0);
    expect(screen.getByText("went")).toBeInTheDocument();
    expect(screen.getByText("Irregular past.")).toBeInTheDocument();
    expect(screen.getByText("2 mistakes added to your review list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue to exercises" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("analysis failure offers Try again and Continue without review (skip, then onDone)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "analysis unavailable" }, 502))
      .mockResolvedValueOnce(json({ error: "analysis unavailable" }, 502))
      .mockResolvedValueOnce(json({ status: "SKIPPED", turns: [], review: null }));
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ConversationPanel lessonId="L1" initial={active(3)} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
    expect(await screen.findByText(/Couldn't analyse/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" })));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Couldn't analyse/)).toBeInTheDocument();
    expect(body(fetchMock.mock.calls[1])).toEqual({ lessonId: "L1", action: "review" });
    fireEvent.click(screen.getByRole("button", { name: "Continue without review" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(body(fetchMock.mock.calls[2])).toEqual({ lessonId: "L1", action: "skip" });
  });

  it("a non-502 finish failure shows the server error, not the analysis copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: "Lesson L1: not found" }, 404)));
    render(<ConversationPanel lessonId="L1" initial={active(2)} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish & review" }));
    expect(await screen.findByText("Lesson L1: not found")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't analyse/)).not.toBeInTheDocument();
  });

  it("renders the review directly for an analysed session", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ConversationPanel lessonId="L1" initial={analyzedState()} onDone={() => {}} />);
    expect(screen.getByText("Top issues")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["SKIPPED", "UNAVAILABLE"] as const)("calls onDone immediately for a %s session", async (status) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(<ConversationPanel lessonId="L1" initial={{ status, turns: turnsWith(1), review: null }} onDone={onDone} />);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
