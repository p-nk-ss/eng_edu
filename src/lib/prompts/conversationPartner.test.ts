// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PARTNER_MAX_TOKENS, conversationPartnerPrompt, type PartnerInput } from "./conversationPartner";

const baseHistory: PartnerInput["history"] = [
  { role: "partner", text: "Hi! Ready to chat about your weekend?" },
  { role: "learner", text: "Yes, I went hiking." },
  { role: "partner", text: "Nice! Where did you go?" },
  { role: "learner", text: "I went to the mountains near my city." },
];

const input: PartnerInput = {
  level: "B1",
  interests: "hiking, photography",
  theme: "weekend activities",
  intro: "The learner just got back from a trip.",
  questions: ["What did you see?", "Was the weather good?"],
  grammar: { title: "past simple", description: "regular and irregular verbs in the past" },
  vocab: ["trail", "scenery"],
  wrapUp: false,
  history: baseHistory,
};

describe("conversationPartnerPrompt", () => {
  it("maps history to assistant/user messages in order, ending on the latest learner turn", () => {
    const args = conversationPartnerPrompt(input);
    expect(args.messages).toEqual([
      { role: "assistant", content: baseHistory[0].text },
      { role: "user", content: baseHistory[1].text },
      { role: "assistant", content: baseHistory[2].text },
      { role: "user", content: baseHistory[3].text },
    ]);
    expect(args.messages[args.messages.length - 1]).toEqual({ role: "user", content: baseHistory[3].text });
  });

  it("sets maxTokens to PARTNER_MAX_TOKENS", () => {
    expect(conversationPartnerPrompt(input).maxTokens).toBe(PARTNER_MAX_TOKENS);
  });

  it("includes the core rules, theme, grammar title, every vocab word and the level", () => {
    const system = conversationPartnerPrompt(input).system ?? "";
    expect(system).toContain("Never correct");
    expect(system).toContain("no grammar explanations");
    expect(system).toContain("2-4 short sentences");
    expect(system).toContain("weekend activities");
    expect(system).toContain("past simple");
    expect(system).toContain("trail");
    expect(system).toContain("scenery");
    expect(system).toContain("B1");
  });

  it("adds wrap-up instructions only when wrapUp is true", () => {
    const withWrapUp = conversationPartnerPrompt({ ...input, wrapUp: true }).system ?? "";
    expect(withWrapUp).toContain("wrap up");
    expect(withWrapUp).toContain("Do not ask a new question");

    const withoutWrapUp = conversationPartnerPrompt({ ...input, wrapUp: false }).system ?? "";
    expect(withoutWrapUp).not.toContain("wrap up");
    expect(withoutWrapUp).not.toContain("Do not ask a new question");
  });

  it("produces no null/undefined text when theme and grammar are absent", () => {
    const system = conversationPartnerPrompt({ ...input, theme: null, grammar: null, vocab: [] }).system ?? "";
    expect(system).not.toMatch(/null/i);
    expect(system).not.toMatch(/undefined/i);
  });

  it("produces no null/undefined text when grammar has no description", () => {
    const system = conversationPartnerPrompt({ ...input, grammar: { title: "past simple", description: null } }).system ?? "";
    expect(system).not.toMatch(/null/i);
    expect(system).not.toMatch(/undefined/i);
    expect(system).toContain("past simple");
  });
});
